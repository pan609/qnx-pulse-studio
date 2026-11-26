/*
 * pulse_scope_resmgr.c
 *
 * Authentic QNX 8.0 User-Space Resource Manager exposing /dev/pulse_scope.
 * Demonstrates QNX-specific microkernel capabilities:
 *   - dispatch_create() / resmgr_attach() / iofunc_* POSIX filesystem server
 *   - Safe synchronous MsgReply() + _RESMGR_NOREPLY in io_read() (zero stack UAF)
 *   - Custom devctl() handlers (__DIOT / __DIOF / __DION)
 *   - System-wide /proc/<pid>/as introspection via DCMD_PROC_TIDSTATUS &
 *     DCMD_PROC_THREADCTL (_NTO_TCTL_NAME) with scope=lab|all|pid:<N>
 *   - Strict separated statistical buckets (E2E Response Time vs Pulse Wakeup Jitter)
 *   - Nanosecond timing via ClockCycles() + SYSPAGE_ENTRY(qtime)->cycles_per_sec
 *   - QNX 8.0 procmgr_ability() capability awareness
 */

#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/neutrino.h>
#include <sys/iofunc.h>
#include <sys/dispatch.h>
#include <sys/resmgr.h>
#include <sys/procfs.h>
#include <sys/procmgr.h>
#include <sys/states.h>
#include <sys/syspage.h>

#include "pulse_scope.h"

#define RING_CAPACITY 256
#define STAT_WINDOW   128
#define RT_DEADLINE_US 5000U

static pthread_mutex_t g_lock = PTHREAD_MUTEX_INITIALIZER;
static uint64_t        g_cycles_per_sec = 62500000ULL;

static ps_event_t      g_ring[RING_CAPACITY];
static uint32_t        g_ring_head = 0;
static uint32_t        g_ring_count = 0;
static uint64_t        g_next_seq = 1;

/* Strictly separated E2E response-time bucket (PS_EVT_E2E_CYCLE only) */
static uint32_t        g_e2e_samples[STAT_WINDOW];
static uint32_t        g_e2e_idx = 0;
static uint32_t        g_e2e_count = 0;
static uint32_t        g_max_e2e_us = 0;
static uint32_t        g_last_e2e_us = 0;

/* Strictly separated Pulse wakeup-jitter bucket (PS_EVT_PULSE_TICK only) */
static uint32_t        g_jitter_samples[STAT_WINDOW];
static uint32_t        g_jitter_idx = 0;
static uint32_t        g_jitter_count = 0;
static uint32_t        g_max_jitter_us = 0;
static uint32_t        g_last_jitter_us = 0;

static uint64_t        g_total_ipc_msgs = 0;
static uint64_t        g_total_cycles = 0;
static uint64_t        g_total_pulses = 0;
static uint64_t        g_prio_boost_count = 0;
static uint64_t        g_deadline_misses = 0;

static ps_fault_config_t g_config = {
    .prio_inherit_enabled = 1,
    .fault_prio_inversion = 0,
    .fault_reply_stall    = 0,
    .fault_cpu_hog        = 0,
    .tick_period_ms       = 50,
    .stall_ms             = 35,
    .scope_mode           = PS_SCOPE_LAB,
    .generation           = 1,
    .scope_pid            = 0
};

static uint64_t now_ns(void) {
    uint64_t cyc = ClockCycles();
    if (g_cycles_per_sec == 0) {
        return 0;
    }
    uint64_t sec = cyc / g_cycles_per_sec;
    uint64_t rem = cyc % g_cycles_per_sec;
    return sec * 1000000000ULL + (rem * 1000000000ULL) / g_cycles_per_sec;
}

static void sanitize_label(char *dst, size_t dst_sz, const char *src) {
    size_t j = 0;
    for (size_t i = 0; src[i] != '\0' && j + 1 < dst_sz; i++) {
        unsigned char c = (unsigned char)src[i];
        if (c < 0x20 || c == 0x7f) {
            continue;
        }
        if (c == '"' || c == '\\') {
            dst[j++] = '_';
        } else {
            dst[j++] = (char)c;
        }
    }
    dst[j] = '\0';
}

static void reset_stats_locked(void) {
    g_ring_head = 0;
    g_ring_count = 0;
    g_e2e_idx = 0;
    g_e2e_count = 0;
    g_max_e2e_us = 0;
    g_last_e2e_us = 0;
    g_jitter_idx = 0;
    g_jitter_count = 0;
    g_max_jitter_us = 0;
    g_last_jitter_us = 0;
    g_total_ipc_msgs = 0;
    g_total_cycles = 0;
    g_total_pulses = 0;
    g_prio_boost_count = 0;
    g_deadline_misses = 0;
}

static void record_event_locked(const ps_event_t *evt_in) {
    ps_event_t evt = *evt_in;
    evt.label[sizeof(evt.label) - 1] = '\0';
    evt.seq = g_next_seq++;
    if (evt.timestamp_ns == 0) {
        evt.timestamp_ns = now_ns();
    }
    char clean[sizeof(evt.label)] = {0};
    sanitize_label(clean, sizeof(clean), evt.label);
    memcpy(evt.label, clean, sizeof(evt.label));

    g_ring[g_ring_head] = evt;
    g_ring_head = (g_ring_head + 1) % RING_CAPACITY;
    if (g_ring_count < RING_CAPACITY) {
        g_ring_count++;
    }

    switch (evt.kind) {
    case PS_EVT_E2E_CYCLE:
        g_total_cycles++;
        if (evt.latency_us > g_max_e2e_us) {
            g_max_e2e_us = evt.latency_us;
        }
        g_last_e2e_us = evt.latency_us;
        g_e2e_samples[g_e2e_idx] = evt.latency_us;
        g_e2e_idx = (g_e2e_idx + 1) % STAT_WINDOW;
        if (g_e2e_count < STAT_WINDOW) {
            g_e2e_count++;
        }
        /* Strictly count at most ONE deadline miss per real-time cycle */
        if (evt.latency_us > RT_DEADLINE_US) {
            g_deadline_misses++;
        }
        break;

    case PS_EVT_IPC_HOP:
        /* Single-hop IPC events only increment message counter (never dilute E2E/jitter) */
        g_total_ipc_msgs++;
        break;

    case PS_EVT_PULSE_TICK:
        g_total_pulses++;
        if (evt.jitter_us > g_max_jitter_us) {
            g_max_jitter_us = evt.jitter_us;
        }
        g_last_jitter_us = evt.jitter_us;
        g_jitter_samples[g_jitter_idx] = evt.jitter_us;
        g_jitter_idx = (g_jitter_idx + 1) % STAT_WINDOW;
        if (g_jitter_count < STAT_WINDOW) {
            g_jitter_count++;
        }
        break;

    case PS_EVT_PRIO_BOOST:
        g_prio_boost_count++;
        break;

    default:
        break;
    }
}

static int cmp_u32(const void *a, const void *b) {
    uint32_t va = *(const uint32_t *)a;
    uint32_t vb = *(const uint32_t *)b;
    return (va > vb) - (va < vb);
}

static void compute_bucket_stats(const uint32_t *samples, uint32_t count,
                                 uint32_t *avg_out, uint32_t *p99_out) {
    if (count == 0) {
        *avg_out = 0;
        *p99_out = 0;
        return;
    }
    uint64_t sum = 0;
    uint32_t sorted[STAT_WINDOW];
    for (uint32_t i = 0; i < count; i++) {
        sum += samples[i];
        sorted[i] = samples[i];
    }
    *avg_out = (uint32_t)(sum / count);
    qsort(sorted, count, sizeof(uint32_t), cmp_u32);
    uint32_t p99_idx = (count * 99 + 99) / 100 - 1;
    if (p99_idx >= count) {
        p99_idx = count - 1;
    }
    *p99_out = sorted[p99_idx];
}

static int is_lab_process(const char *proc_name) {
    return (strstr(proc_name, "pulse_scope") != NULL ||
            strstr(proc_name, "ipc_lab") != NULL ||
            strstr(proc_name, "telemetry_agent") != NULL ||
            strstr(proc_name, "slogger") != NULL);
}

static void read_proc_exename(int pid, char *out, size_t out_sz) {
    snprintf(out, out_sz, "pid_%d", pid);
    char exe_path[64];
    snprintf(exe_path, sizeof(exe_path), "/proc/%d/exefile", pid);
    int efd = open(exe_path, O_RDONLY);
    if (efd < 0) {
        return;
    }
    char buf[160];
    ssize_t n = read(efd, buf, sizeof(buf) - 1);
    close(efd);
    if (n <= 0) {
        return;
    }
    buf[n] = '\0';
    char *slash = strrchr(buf, '/');
    const char *base = slash ? (slash + 1) : buf;
    sanitize_label(out, out_sz, base);
    if (out[0] == '\0') {
        snprintf(out, out_sz, "pid_%d", pid);
    }
}

/* Query genuine QNX 8.0 kernel thread name via DCMD_PROC_THREADCTL (_NTO_TCTL_NAME) */
static void query_qnx_thread_name(int proc_fd, uint32_t tid, const char *fallback,
                                  char *out, size_t out_sz) {
    procfs_threadctl tctl;
    memset(&tctl, 0, sizeof(tctl));
    tctl.tid = tid;
    tctl.cmd = _NTO_TCTL_NAME;
    struct _thread_name *tn = (struct _thread_name *)tctl.data;
    tn->new_name_len = -1; /* query only */
    tn->name_buf_len = _NTO_THREAD_NAME_MAX;

    if (devctl(proc_fd, DCMD_PROC_THREADCTL, &tctl, sizeof(tctl), NULL) == EOK &&
        tn->name_buf[0] != '\0') {
        sanitize_label(out, out_sz, tn->name_buf);
        if (out[0] != '\0') {
            return;
        }
    }
    snprintf(out, out_sz, "%s", fallback);
}

static void scan_single_pid(int pid, const char *proc_name,
                            ps_thread_snap_t *out, uint32_t max_out, uint32_t *count) {
    if (*count >= max_out) {
        return;
    }
    char as_path[64];
    snprintf(as_path, sizeof(as_path), "/proc/%d/as", pid);
    int fd = open(as_path, O_RDONLY);
    if (fd < 0) {
        return;
    }

    procfs_status st;
    memset(&st, 0, sizeof(st));
    st.tid = 1;
    uint32_t seen_for_pid = 0;
    while (*count < max_out && seen_for_pid < 16 &&
           devctl(fd, DCMD_PROC_TIDSTATUS, &st, sizeof(st), NULL) == EOK) {
        ps_thread_snap_t *s = &out[(*count)++];
        memset(s, 0, sizeof(*s));
        s->pid = pid;
        s->tid = (int32_t)st.tid;
        s->priority = st.priority;
        s->real_priority = st.real_priority;
        s->state = st.state;
        s->policy = st.policy;
        s->last_cpu = st.last_cpu;
        if (st.state == STATE_SEND || st.state == STATE_REPLY) {
            s->blocked_on_pid = (uint32_t)st.blocked.connect.pid;
        }
        snprintf(s->proc_name, sizeof(s->proc_name), "%.23s", proc_name);
        query_qnx_thread_name(fd, st.tid, proc_name, s->thread_name, sizeof(s->thread_name));

        seen_for_pid++;
        st.tid++;
    }
    close(fd);
}

/*
 * Inspects real QNX 8.0 processes & threads via /proc/<pid>/as + DCMD_PROC_TIDSTATUS
 * and DCMD_PROC_THREADCTL (_NTO_TCTL_NAME).
 * Supports 3 modes:
 *   - PS_SCOPE_LAB: Pulse Studio processes (default)
 *   - PS_SCOPE_ALL: System-wide QNX 8.0 processes (lab processes first, then all other PIDs)
 *   - PS_SCOPE_PID: Any specific user-selected PID on QNX 8.0
 */
static uint32_t scan_procfs_threads(ps_thread_snap_t *out, uint32_t max_out,
                                    uint32_t scope_mode, int32_t scope_pid) {
    uint32_t count = 0;

    if (scope_mode == PS_SCOPE_PID && scope_pid > 0) {
        char pname[24];
        read_proc_exename(scope_pid, pname, sizeof(pname));
        scan_single_pid(scope_pid, pname, out, max_out, &count);
        return count;
    }

    DIR *dir = opendir("/proc");
    if (!dir) {
        return 0;
    }

    int other_pids[128];
    uint32_t other_count = 0;

    struct dirent *ent;
    while ((ent = readdir(dir)) != NULL && count < max_out) {
        if (ent->d_name[0] < '0' || ent->d_name[0] > '9') {
            continue;
        }
        int pid = atoi(ent->d_name);
        if (pid <= 1) {
            continue;
        }
        char pname[24];
        read_proc_exename(pid, pname, sizeof(pname));

        if (is_lab_process(pname)) {
            scan_single_pid(pid, pname, out, max_out, &count);
        } else if (scope_mode == PS_SCOPE_ALL && other_count < 128) {
            other_pids[other_count++] = pid;
        }
    }
    closedir(dir);

    if (scope_mode == PS_SCOPE_ALL) {
        for (uint32_t i = 0; i < other_count && count < max_out; i++) {
            char pname[24];
            read_proc_exename(other_pids[i], pname, sizeof(pname));
            scan_single_pid(other_pids[i], pname, out, max_out, &count);
        }
    }

    return count;
}

static void fill_snapshot(ps_snapshot_t *snap) {
    memset(snap, 0, sizeof(*snap));
    snap->snapshot_ns = now_ns();
    snap->cycles_per_sec = g_cycles_per_sec;

    uint32_t scope_mode = PS_SCOPE_LAB;
    int32_t scope_pid = 0;

    pthread_mutex_lock(&g_lock);
    snap->total_ipc_msgs = g_total_ipc_msgs;
    snap->total_cycles = g_total_cycles;
    snap->total_pulses = g_total_pulses;
    snap->prio_boost_count = g_prio_boost_count;
    snap->deadline_misses = g_deadline_misses;

    snap->max_e2e_us = g_max_e2e_us;
    snap->last_e2e_us = g_last_e2e_us;
    compute_bucket_stats(g_e2e_samples, g_e2e_count, &snap->avg_e2e_us, &snap->p99_e2e_us);

    snap->max_jitter_us = g_max_jitter_us;
    snap->last_jitter_us = g_last_jitter_us;
    compute_bucket_stats(g_jitter_samples, g_jitter_count, &snap->avg_jitter_us, &snap->p99_jitter_us);

    snap->config = g_config;
    scope_mode = g_config.scope_mode;
    scope_pid = g_config.scope_pid;

    uint32_t to_copy = g_ring_count < PS_MAX_EVENTS ? g_ring_count : PS_MAX_EVENTS;
    uint32_t start = (g_ring_head + RING_CAPACITY - to_copy) % RING_CAPACITY;
    for (uint32_t i = 0; i < to_copy; i++) {
        snap->events[i] = g_ring[(start + i) % RING_CAPACITY];
    }
    snap->event_count = to_copy;
    pthread_mutex_unlock(&g_lock);

    snap->thread_count = scan_procfs_threads(snap->threads, PS_MAX_THREADS, scope_mode, scope_pid);
}

/* POSIX read() handler: uses synchronous MsgReply() + _RESMGR_NOREPLY (zero stack UAF!) */
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

    const char *scope_str = (snap.config.scope_mode == PS_SCOPE_ALL) ? "all" :
                            (snap.config.scope_mode == PS_SCOPE_PID) ? "pid" : "lab";

    char text[1024];
    int raw_len = snprintf(
        text, sizeof(text),
        "{\"device\":\"%s\",\"os\":\"QNX 8.0\",\"cycles_per_sec\":%llu,"
        "\"total_ipc_msgs\":%llu,\"total_cycles\":%llu,\"total_pulses\":%llu,"
        "\"prio_boosts\":%llu,\"deadline_misses\":%llu,"
        "\"avg_e2e_us\":%u,\"p99_e2e_us\":%u,\"max_e2e_us\":%u,"
        "\"avg_jitter_us\":%u,\"p99_jitter_us\":%u,"
        "\"prio_inherit\":%u,\"fault_prio_inv\":%u,\"fault_reply_stall\":%u,"
        "\"fault_cpu_hog\":%u,\"scope\":\"%s\",\"scope_pid\":%d,\"threads\":%u}\n",
        PULSE_SCOPE_DEV_PATH,
        (unsigned long long)snap.cycles_per_sec,
        (unsigned long long)snap.total_ipc_msgs,
        (unsigned long long)snap.total_cycles,
        (unsigned long long)snap.total_pulses,
        (unsigned long long)snap.prio_boost_count,
        (unsigned long long)snap.deadline_misses,
        snap.avg_e2e_us, snap.p99_e2e_us, snap.max_e2e_us,
        snap.avg_jitter_us, snap.p99_jitter_us,
        snap.config.prio_inherit_enabled,
        snap.config.fault_prio_inversion,
        snap.config.fault_reply_stall,
        snap.config.fault_cpu_hog,
        scope_str, snap.config.scope_pid,
        snap.thread_count);

    size_t len = 0;
    if (raw_len > 0) {
        len = ((size_t)raw_len >= sizeof(text)) ? (sizeof(text) - 1) : (size_t)raw_len;
    }

    if ((size_t)ocb->offset >= len) {
        MsgReply(ctp->rcvid, 0, NULL, 0);
        return _RESMGR_NOREPLY;
    }

    size_t nleft = len - (size_t)ocb->offset;
    size_t nbytes = msg->i.nbytes < nleft ? msg->i.nbytes : nleft;
    ocb->offset += (off_t)nbytes;
    ocb->attr->flags |= IOFUNC_ATTR_ATIME;

    /* Reply synchronously while stack buffer `text` is still alive */
    MsgReply(ctp->rcvid, (int)nbytes, text + (ocb->offset - (off_t)nbytes), nbytes);
    return _RESMGR_NOREPLY;
}

/* POSIX write() handler: allows `echo "scope=all" > /dev/pulse_scope` */
static int io_write(resmgr_context_t *ctp, io_write_t *msg, RESMGR_OCB_T *ocb) {
    int status = iofunc_write_verify(ctp, msg, ocb, NULL);
    if (status != EOK) {
        return status;
    }
    if ((msg->i.xtype & _IO_XTYPE_MASK) != _IO_XTYPE_NONE) {
        return ENOSYS;
    }

    size_t nbytes = msg->i.nbytes;
    char raw[256];
    size_t to_read = nbytes < (sizeof(raw) - 1) ? nbytes : (sizeof(raw) - 1);
    ssize_t got = resmgr_msgread(ctp, raw, to_read, sizeof(msg->i));
    if (got < 0) {
        return errno;
    }
    raw[got] = '\0';

    char buf[256];
    sanitize_label(buf, sizeof(buf), raw);

    pthread_mutex_lock(&g_lock);
    if (strstr(buf, "prio_inherit=1"))       g_config.prio_inherit_enabled = 1;
    else if (strstr(buf, "prio_inherit=0"))  g_config.prio_inherit_enabled = 0;
    if (strstr(buf, "prio_inv=1"))           g_config.fault_prio_inversion = 1;
    else if (strstr(buf, "prio_inv=0"))      g_config.fault_prio_inversion = 0;
    if (strstr(buf, "reply_stall=1"))        g_config.fault_reply_stall = 1;
    else if (strstr(buf, "reply_stall=0"))   g_config.fault_reply_stall = 0;
    if (strstr(buf, "cpu_hog=1"))            g_config.fault_cpu_hog = 1;
    else if (strstr(buf, "cpu_hog=0"))       g_config.fault_cpu_hog = 0;

    if (strstr(buf, "scope=all")) {
        g_config.scope_mode = PS_SCOPE_ALL;
        g_config.scope_pid = 0;
    } else if (strstr(buf, "scope=lab")) {
        g_config.scope_mode = PS_SCOPE_LAB;
        g_config.scope_pid = 0;
    } else {
        const char *sp = strstr(buf, "scope=pid:");
        if (sp) {
            int target_pid = atoi(sp + 10);
            if (target_pid > 0) {
                g_config.scope_mode = PS_SCOPE_PID;
                g_config.scope_pid = target_pid;
            }
        }
    }

    if (strstr(buf, "reset")) {
        reset_stats_locked();
    }

    g_config.generation++;
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
        if (msg->i.nbytes < sizeof(ps_event_t)) return EINVAL;
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
        if (msg->i.nbytes < sizeof(ps_fault_config_t)) return EINVAL;
        ps_fault_config_t *cfg = (ps_fault_config_t *)data;
        pthread_mutex_lock(&g_lock);
        uint32_t generation = g_config.generation + 1;
        g_config = *cfg;
        g_config.generation = generation;
        if (g_config.tick_period_ms < 10) g_config.tick_period_ms = 10;
        if (g_config.tick_period_ms > 500) g_config.tick_period_ms = 500;
        if (g_config.stall_ms > 200) g_config.stall_ms = 200;
        if (g_config.scope_mode > PS_SCOPE_PID) g_config.scope_mode = PS_SCOPE_LAB;

        ps_event_t evt;
        memset(&evt, 0, sizeof(evt));
        evt.kind = PS_EVT_DEVCTL_CMD;
        evt.src_pid = ctp->info.pid;
        evt.dst_pid = getpid();
        evt.flags = g_config.prio_inherit_enabled ? 1 : 0;
        snprintf(evt.label, sizeof(evt.label), "devctl:pi=%u,inv=%u,sc=%u",
                 g_config.prio_inherit_enabled,
                 g_config.fault_prio_inversion,
                 g_config.scope_mode);
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
        reset_stats_locked();
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
    rattr.msg_max_size = (unsigned)(sizeof(io_devctl_t) + sizeof(ps_snapshot_t) + 512);

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
