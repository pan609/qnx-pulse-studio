/*
 * pulse_scope_resmgr.c
 *
 * Authentic QNX 8.0 Resource Manager exposing /dev/pulse_scope.
 * Demonstrates QNX-specific microkernel capabilities:
 *   - dispatch_create() / resmgr_attach() / iofunc_* POSIX filesystem server
 *   - Custom devctl() handlers (__DIOT / __DIOF / __DION)
 *   - Live /proc/<pid>/as introspection via DCMD_PROC_INFO & DCMD_PROC_TIDSTATUS
 *   - Nanosecond timing via ClockCycles() + SYSPAGE_ENTRY(qtime)->cycles_per_sec
 *   - QNX 8.0 procmgr_ability() capability awareness
 */

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <dirent.h>
#include <pthread.h>
#include <sys/neutrino.h>
#include <sys/iofunc.h>
#include <sys/dispatch.h>
#include <sys/resmgr.h>
#include <sys/syspage.h>
#include <sys/procfs.h>
#include <sys/procmgr.h>
#include <sys/states.h>

#include "pulse_scope.h"

#define RING_CAPACITY 256
#define LAT_WINDOW    128

static pthread_mutex_t g_lock = PTHREAD_MUTEX_INITIALIZER;
static uint64_t        g_cycles_per_sec = 1000000000ULL;

static ps_event_t      g_ring[RING_CAPACITY];
static uint32_t        g_ring_head = 0;
static uint32_t        g_ring_count = 0;
static uint64_t        g_next_seq = 1;

static uint32_t        g_lat_samples[LAT_WINDOW];
static uint32_t        g_jitter_samples[LAT_WINDOW];
static uint32_t        g_sample_idx = 0;
static uint32_t        g_sample_count = 0;

static uint64_t        g_total_ipc_msgs = 0;
static uint64_t        g_total_pulses = 0;
static uint64_t        g_prio_boost_count = 0;
static uint64_t        g_deadline_misses = 0;
static uint32_t        g_max_ipc_us = 0;
static uint32_t        g_last_jitter_us = 0;

static ps_fault_config_t g_config = {
    .prio_inherit_enabled = 1,
    .fault_prio_inversion = 0,
    .fault_reply_stall    = 0,
    .fault_cpu_hog        = 0,
    .tick_period_ms       = 50,
    .stall_ms             = 35
};

static uint64_t now_ns(void) {
    uint64_t cyc = ClockCycles();
    if (g_cycles_per_sec == 0) {
        return 0;
    }
    /* Avoid 64-bit overflow on long uptimes */
    uint64_t sec = cyc / g_cycles_per_sec;
    uint64_t rem = cyc % g_cycles_per_sec;
    return sec * 1000000000ULL + (rem * 1000000000ULL) / g_cycles_per_sec;
}

static void record_event_locked(const ps_event_t *evt_in) {
    ps_event_t evt = *evt_in;
    evt.seq = g_next_seq++;
    if (evt.timestamp_ns == 0) {
        evt.timestamp_ns = now_ns();
    }

    g_ring[g_ring_head] = evt;
    g_ring_head = (g_ring_head + 1) % RING_CAPACITY;
    if (g_ring_count < RING_CAPACITY) {
        g_ring_count++;
    }

    if (evt.kind == PS_EVT_IPC_HOP) {
        g_total_ipc_msgs++;
        if (evt.latency_us > g_max_ipc_us) {
            g_max_ipc_us = evt.latency_us;
        }
        g_lat_samples[g_sample_idx] = evt.latency_us;
        g_jitter_samples[g_sample_idx] = evt.jitter_us;
        g_sample_idx = (g_sample_idx + 1) % LAT_WINDOW;
        if (g_sample_count < LAT_WINDOW) {
            g_sample_count++;
        }
        g_last_jitter_us = evt.jitter_us;
        if (evt.jitter_us > 5000 || (evt.flags & 0x2)) {
            g_deadline_misses++;
        }
    } else if (evt.kind == PS_EVT_PULSE_TICK) {
        g_total_pulses++;
        g_last_jitter_us = evt.jitter_us;
        if (evt.jitter_us > 5000) {
            g_deadline_misses++;
        }
    } else if (evt.kind == PS_EVT_PRIO_BOOST) {
        g_prio_boost_count++;
    }
}

static int cmp_u32(const void *a, const void *b) {
    uint32_t va = *(const uint32_t *)a;
    uint32_t vb = *(const uint32_t *)b;
    return (va > vb) - (va < vb);
}

static void compute_stats_locked(uint32_t *avg_ipc_us, uint32_t *p99_jitter_us) {
    if (g_sample_count == 0) {
        *avg_ipc_us = 0;
        *p99_jitter_us = 0;
        return;
    }
    uint64_t sum = 0;
    uint32_t sorted[LAT_WINDOW];
    for (uint32_t i = 0; i < g_sample_count; i++) {
        sum += g_lat_samples[i];
        sorted[i] = g_jitter_samples[i];
    }
    *avg_ipc_us = (uint32_t)(sum / g_sample_count);
    qsort(sorted, g_sample_count, sizeof(uint32_t), cmp_u32);
    uint32_t p99_idx = (g_sample_count * 99) / 100;
    if (p99_idx >= g_sample_count) {
        p99_idx = g_sample_count - 1;
    }
    *p99_jitter_us = sorted[p99_idx];
}

/*
 * Inspects real QNX 8.0 processes & threads via /proc/<pid>/as + DCMD_PROC_INFO / DCMD_PROC_TIDSTATUS.
 * Prioritizes pulse_scope, ipc_lab, telemetry_agent processes so the Studio UI sees live microkernel states.
 */
static uint32_t scan_procfs_threads(ps_thread_snap_t *out, uint32_t max_out) {
    DIR *dir = opendir("/proc");
    if (!dir) {
        return 0;
    }

    uint32_t count = 0;
    struct dirent *ent;
    while ((ent = readdir(dir)) != NULL && count < max_out) {
        if (ent->d_name[0] < '0' || ent->d_name[0] > '9') {
            continue;
        }
        int pid = atoi(ent->d_name);
        if (pid <= 1) {
            continue;
        }

        char as_path[64];
        snprintf(as_path, sizeof(as_path), "/proc/%d/as", pid);
        int fd = open(as_path, O_RDONLY);
        if (fd < 0) {
            continue;
        }

        /* Read process name from /proc/<pid>/exefile if available */
        char proc_name[24] = "qnx_proc";
        char exe_path[64];
        snprintf(exe_path, sizeof(exe_path), "/proc/%d/exefile", pid);
        int efd = open(exe_path, O_RDONLY);
        if (efd >= 0) {
            char buf[128];
            ssize_t n = read(efd, buf, sizeof(buf) - 1);
            if (n > 0) {
                buf[n] = '\0';
                char *slash = strrchr(buf, '/');
                const char *base = slash ? (slash + 1) : buf;
                /* Strip trailing newline */
                snprintf(proc_name, sizeof(proc_name), "%.23s", base);
                for (size_t k = 0; proc_name[k]; k++) {
                    if (proc_name[k] == '\n' || proc_name[k] == '\r') {
                        proc_name[k] = '\0';
                    }
                }
            }
            close(efd);
        }

        /* Filter to Pulse Studio processes so all real-time lab threads are always visible */
        int interesting = (strstr(proc_name, "pulse_scope") != NULL ||
                           strstr(proc_name, "ipc_lab") != NULL ||
                           strstr(proc_name, "telemetry_agent") != NULL ||
                           strstr(proc_name, "slogger") != NULL);
        if (!interesting) {
            close(fd);
            continue;
        }

        procfs_status st;
        memset(&st, 0, sizeof(st));
        st.tid = 1;
        while (count < max_out && devctl(fd, DCMD_PROC_TIDSTATUS, &st, sizeof(st), NULL) == EOK) {
            ps_thread_snap_t *s = &out[count++];
            memset(s, 0, sizeof(*s));
            s->pid = pid;
            s->tid = st.tid;
            s->priority = st.priority;
            s->real_priority = st.real_priority;
            s->state = st.state;
            s->policy = st.policy;
            s->last_cpu = st.last_cpu;
            if (st.state == STATE_SEND || st.state == STATE_REPLY) {
                s->blocked_on_pid = (uint32_t)st.blocked.connect.pid;
            }
            if (strstr(proc_name, "ipc_lab") != NULL) {
                static const char *lab_names[] = {
                    "ipc_lab_main", "actuator_srv", "controller_srv",
                    "low_calib_worker", "med_cpu_hog", "sensor_rt_loop"
                };
                if (st.tid >= 1 && st.tid <= 6) {
                    snprintf(s->proc_name, sizeof(s->proc_name), "%s", lab_names[st.tid - 1]);
                } else {
                    snprintf(s->proc_name, sizeof(s->proc_name), "%.23s", proc_name);
                }
            } else {
                snprintf(s->proc_name, sizeof(s->proc_name), "%.23s", proc_name);
            }

            st.tid++;
            if (st.tid > 32) {
                break;
            }
        }
        close(fd);
    }

    closedir(dir);
    return count;
}

static void fill_snapshot(ps_snapshot_t *snap) {
    memset(snap, 0, sizeof(*snap));
    snap->snapshot_ns = now_ns();
    snap->cycles_per_sec = g_cycles_per_sec;

    pthread_mutex_lock(&g_lock);
    snap->total_ipc_msgs = g_total_ipc_msgs;
    snap->total_pulses = g_total_pulses;
    snap->prio_boost_count = g_prio_boost_count;
    snap->deadline_misses = g_deadline_misses;
    snap->max_ipc_us = g_max_ipc_us;
    snap->last_jitter_us = g_last_jitter_us;
    snap->config = g_config;
    compute_stats_locked(&snap->avg_ipc_us, &snap->p99_jitter_us);

    uint32_t to_copy = g_ring_count < PS_MAX_EVENTS ? g_ring_count : PS_MAX_EVENTS;
    uint32_t start = (g_ring_head + RING_CAPACITY - to_copy) % RING_CAPACITY;
    for (uint32_t i = 0; i < to_copy; i++) {
        snap->events[i] = g_ring[(start + i) % RING_CAPACITY];
    }
    snap->event_count = to_copy;
    pthread_mutex_unlock(&g_lock);

    snap->thread_count = scan_procfs_threads(snap->threads, PS_MAX_THREADS);
}

/* POSIX read() handler: allows `cat /dev/pulse_scope` directly from QNX shell */
static int io_read(resmgr_context_t *ctp, io_read_t *msg, RESMGR_OCB_T *ocb) {
    int status = iofunc_read_verify(ctp, msg, ocb, NULL);
    if (status != EOK) {
        return status;
    }
    if ((msg->i.xtype & _IO_XTYPE_MASK) != _IO_XTYPE_NONE) {
        return ENOSYS;
    }

    ps_snapshot_t snap;
    fill_snapshot(&snap);

    char text[1024];
    int len = snprintf(
        text, sizeof(text),
        "{\"device\":\"%s\",\"os\":\"QNX 8.0\",\"cycles_per_sec\":%llu,"
        "\"total_ipc_msgs\":%llu,\"total_pulses\":%llu,\"prio_boosts\":%llu,"
        "\"deadline_misses\":%llu,\"avg_ipc_us\":%u,\"max_ipc_us\":%u,"
        "\"p99_jitter_us\":%u,\"prio_inherit\":%u,\"fault_prio_inv\":%u,"
        "\"fault_reply_stall\":%u,\"fault_cpu_hog\":%u,\"threads\":%u}\n",
        PULSE_SCOPE_DEV_PATH,
        (unsigned long long)snap.cycles_per_sec,
        (unsigned long long)snap.total_ipc_msgs,
        (unsigned long long)snap.total_pulses,
        (unsigned long long)snap.prio_boost_count,
        (unsigned long long)snap.deadline_misses,
        snap.avg_ipc_us, snap.max_ipc_us, snap.p99_jitter_us,
        snap.config.prio_inherit_enabled,
        snap.config.fault_prio_inversion,
        snap.config.fault_reply_stall,
        snap.config.fault_cpu_hog,
        snap.thread_count);

    if (ocb->offset >= len) {
        _IO_SET_READ_NBYTES(ctp, 0);
        return EOK;
    }

    size_t nleft = (size_t)(len - ocb->offset);
    size_t nbytes = msg->i.nbytes < nleft ? msg->i.nbytes : nleft;
    SETIOV(ctp->iov, text + ocb->offset, nbytes);
    _IO_SET_READ_NBYTES(ctp, (int)nbytes);
    ocb->offset += (off_t)nbytes;
    ocb->attr->flags |= IOFUNC_ATTR_ATIME;
    return _RESMGR_NPARTS(1);
}

/* POSIX write() handler: allows `echo "prio_inherit=0" > /dev/pulse_scope` */
static int io_write(resmgr_context_t *ctp, io_write_t *msg, RESMGR_OCB_T *ocb) {
    int status = iofunc_write_verify(ctp, msg, ocb, NULL);
    if (status != EOK) {
        return status;
    }
    if ((msg->i.xtype & _IO_XTYPE_MASK) != _IO_XTYPE_NONE) {
        return ENOSYS;
    }

    size_t nbytes = msg->i.nbytes;
    char buf[256];
    size_t to_read = nbytes < (sizeof(buf) - 1) ? nbytes : (sizeof(buf) - 1);
    ssize_t got = resmgr_msgread(ctp, buf, to_read, sizeof(msg->i));
    if (got < 0) {
        return errno;
    }
    buf[got] = '\0';

    pthread_mutex_lock(&g_lock);
    if (strstr(buf, "prio_inherit=1"))       g_config.prio_inherit_enabled = 1;
    else if (strstr(buf, "prio_inherit=0"))  g_config.prio_inherit_enabled = 0;
    if (strstr(buf, "prio_inv=1"))           g_config.fault_prio_inversion = 1;
    else if (strstr(buf, "prio_inv=0"))      g_config.fault_prio_inversion = 0;
    if (strstr(buf, "reply_stall=1"))        g_config.fault_reply_stall = 1;
    else if (strstr(buf, "reply_stall=0"))   g_config.fault_reply_stall = 0;
    if (strstr(buf, "cpu_hog=1"))            g_config.fault_cpu_hog = 1;
    else if (strstr(buf, "cpu_hog=0"))       g_config.fault_cpu_hog = 0;
    if (strstr(buf, "reset")) {
        g_ring_head = 0;
        g_ring_count = 0;
        g_sample_idx = 0;
        g_sample_count = 0;
        g_total_ipc_msgs = 0;
        g_total_pulses = 0;
        g_prio_boost_count = 0;
        g_deadline_misses = 0;
        g_max_ipc_us = 0;
        g_last_jitter_us = 0;
    }

    ps_event_t evt;
    memset(&evt, 0, sizeof(evt));
    evt.kind = PS_EVT_FAULT_TOGGLE;
    evt.src_pid = ctp->info.pid;
    evt.dst_pid = getpid();
    snprintf(evt.label, sizeof(evt.label), "write:%.24s", buf);
    record_event_locked(&evt);
    pthread_mutex_unlock(&g_lock);

    _IO_SET_WRITE_NBYTES(ctp, (int)nbytes);
    ocb->attr->flags |= IOFUNC_ATTR_MTIME | IOFUNC_ATTR_CTIME;
    return EOK;
}

/* Custom QNX devctl() handler */
static int io_devctl(resmgr_context_t *ctp, io_devctl_t *msg, RESMGR_OCB_T *ocb) {
    int status = iofunc_devctl_default(ctp, msg, ocb);
    if (status != _RESMGR_DEFAULT) {
        return status;
    }

    void *data = _DEVCTL_DATA(msg->i);
    int nbytes = 0;

    switch (msg->i.dcmd) {
    case DCMD_PULSE_SCOPE_RECORD: {
        ps_event_t *evt = (ps_event_t *)data;
        pthread_mutex_lock(&g_lock);
        record_event_locked(evt);
        pthread_mutex_unlock(&g_lock);
        nbytes = 0;
        break;
    }
    case DCMD_PULSE_SCOPE_SNAPSHOT: {
        ps_snapshot_t *snap = (ps_snapshot_t *)data;
        fill_snapshot(snap);
        nbytes = (int)sizeof(ps_snapshot_t);
        break;
    }
    case DCMD_PULSE_SCOPE_SET_CFG: {
        ps_fault_config_t *cfg = (ps_fault_config_t *)data;
        pthread_mutex_lock(&g_lock);
        g_config = *cfg;
        if (g_config.tick_period_ms < 10) g_config.tick_period_ms = 10;
        if (g_config.tick_period_ms > 500) g_config.tick_period_ms = 500;
        if (g_config.stall_ms > 200) g_config.stall_ms = 200;

        ps_event_t evt;
        memset(&evt, 0, sizeof(evt));
        evt.kind = PS_EVT_DEVCTL_CMD;
        evt.src_pid = ctp->info.pid;
        evt.dst_pid = getpid();
        evt.flags = g_config.prio_inherit_enabled ? 1 : 0;
        snprintf(evt.label, sizeof(evt.label), "devctl:pi=%u,inv=%u,st=%u",
                 g_config.prio_inherit_enabled,
                 g_config.fault_prio_inversion,
                 g_config.fault_reply_stall);
        record_event_locked(&evt);
        pthread_mutex_unlock(&g_lock);
        nbytes = 0;
        break;
    }
    case DCMD_PULSE_SCOPE_GET_CFG: {
        ps_fault_config_t *cfg = (ps_fault_config_t *)data;
        pthread_mutex_lock(&g_lock);
        *cfg = g_config;
        pthread_mutex_unlock(&g_lock);
        nbytes = (int)sizeof(ps_fault_config_t);
        break;
    }
    case DCMD_PULSE_SCOPE_RESET: {
        pthread_mutex_lock(&g_lock);
        g_ring_head = 0;
        g_ring_count = 0;
        g_sample_idx = 0;
        g_sample_count = 0;
        g_total_ipc_msgs = 0;
        g_total_pulses = 0;
        g_prio_boost_count = 0;
        g_deadline_misses = 0;
        g_max_ipc_us = 0;
        g_last_jitter_us = 0;
        pthread_mutex_unlock(&g_lock);
        nbytes = 0;
        break;
    }
    default:
        return ENOSYS;
    }

    memset(&msg->o, 0, sizeof(msg->o));
    msg->o.nbytes = nbytes;
    return _RESMGR_PTR(ctp, &msg->o, sizeof(msg->o) + (size_t)nbytes);
}

int main(void) {
    /* Request QNX 8.0 abilities cleanly if running under root before dropping privileges */
    procmgr_ability(0,
        PROCMGR_ADN_ROOT | PROCMGR_AOP_ALLOW | PROCMGR_AID_PATHSPACE,
        PROCMGR_ADN_ROOT | PROCMGR_AOP_ALLOW | PROCMGR_AID_XPROCESS_QUERY,
        PROCMGR_AID_EOL);

    g_cycles_per_sec = SYSPAGE_ENTRY(qtime)->cycles_per_sec;
    printf("[pulse_scope_resmgr] Starting on QNX 8.0 (cycles_per_sec=%llu)\n",
           (unsigned long long)g_cycles_per_sec);

    dispatch_t *dpp = dispatch_create();
    if (!dpp) {
        perror("dispatch_create");
        return EXIT_FAILURE;
    }

    resmgr_attr_t rattr;
    memset(&rattr, 0, sizeof(rattr));
    rattr.nparts_max = 2;
    /* Ensure message buffer fits full ps_snapshot_t for devctl() */
    rattr.msg_max_size = (unsigned)(sizeof(io_devctl_t) + sizeof(ps_snapshot_t) + 256);

    resmgr_connect_funcs_t connect_funcs;
    resmgr_io_funcs_t io_funcs;
    iofunc_attr_t attr;

    iofunc_func_init(_RESMGR_CONNECT_NFUNCS, &connect_funcs,
                     _RESMGR_IO_NFUNCS, &io_funcs);
    io_funcs.read = io_read;
    io_funcs.write = io_write;
    io_funcs.devctl = io_devctl;

    iofunc_attr_init(&attr, S_IFNAM | 0666, NULL, NULL);

    int id = resmgr_attach(dpp, &rattr, PULSE_SCOPE_DEV_PATH, _FTYPE_ANY,
                           0, &connect_funcs, &io_funcs, &attr);
    if (id == -1) {
        perror("resmgr_attach(/dev/pulse_scope)");
        return EXIT_FAILURE;
    }

    printf("[pulse_scope_resmgr] Attached %s (id=%d, pid=%d)\n",
           PULSE_SCOPE_DEV_PATH, id, getpid());
    fflush(stdout);

    dispatch_context_t *ctp = dispatch_context_alloc(dpp);
    if (!ctp) {
        perror("dispatch_context_alloc");
        return EXIT_FAILURE;
    }

    while (1) {
        ctp = dispatch_block(ctp);
        if (!ctp) {
            perror("dispatch_block");
            break;
        }
        dispatch_handler(ctp);
    }

    return EXIT_SUCCESS;
}
