/*
 * ipc_lab_workload.c
 *
 * Real QNX 8.0 Microkernel Real-Time Workload demonstrating:
 *   1. Synchronous Message Passing IPC: Sensor -> Controller -> Actuator
 *      via ChannelCreate(), ConnectAttach(), MsgSend(), MsgReceive(), MsgReply()
 *   2. Asynchronous QNX Pulse Timer: timer_create(CLOCK_MONOTONIC) + SIGEV_PULSE_INIT
 *   3. Deterministic SCHED_FIFO Real-Time Priority Scheduling & Priority Inheritance:
 *      Live toggle between PTHREAD_PRIO_NONE (Priority Inversion storm!) and
 *      PTHREAD_PRIO_INHERIT (QNX microkernel priority boost rescues the deadline!)
 *   4. Interactive Fault Injection polled from /dev/pulse_scope via devctl()
 */

#include <errno.h>
#include <fcntl.h>
#include <math.h>
#include <pthread.h>
#include <sched.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <sys/neutrino.h>
#include <sys/syspage.h>

#include "pulse_scope.h"

static uint64_t g_cycles_per_sec = 1000000000ULL;
static int      g_scope_fd = -1;
static int      g_controller_chid = -1;
static int      g_actuator_chid = -1;

static ps_fault_config_t g_cfg = {
    .prio_inherit_enabled = 1,
    .fault_prio_inversion = 0,
    .fault_reply_stall    = 0,
    .fault_cpu_hog        = 0,
    .tick_period_ms       = 50,
    .stall_ms             = 35
};

/* Two shared mutexes: one with PTHREAD_PRIO_INHERIT, one with PTHREAD_PRIO_NONE */
static pthread_mutex_t g_mtx_inherit;
static pthread_mutex_t g_mtx_noinherit;

static uint64_t now_ns(void) {
    uint64_t cyc = ClockCycles();
    uint64_t sec = cyc / g_cycles_per_sec;
    uint64_t rem = cyc % g_cycles_per_sec;
    return sec * 1000000000ULL + (rem * 1000000000ULL) / g_cycles_per_sec;
}

static void busy_spin_us(uint32_t us) {
    uint64_t target = now_ns() + (uint64_t)us * 1000ULL;
    volatile uint64_t acc = 0;
    while (now_ns() < target) {
        acc += 1;
    }
    (void)acc;
}

static void set_thread_fifo(int prio) {
    struct sched_param sp;
    memset(&sp, 0, sizeof(sp));
    sp.sched_priority = prio;
    pthread_setschedparam(pthread_self(), SCHED_FIFO, &sp);
}

static void pin_to_cpu0(void) {
    /* Pin real-time contention threads to CPU 0 via QNX ThreadCtl(_NTO_TCTL_RUNMASK)
     * so Priority Inversion and Priority Inheritance occur deterministically on SMP systems. */
    uintptr_t mask = 0x1;
    ThreadCtl(_NTO_TCTL_RUNMASK, (void *)mask);
}

static int get_current_prio(void) {
    struct sched_param sp;
    int policy = 0;
    if (pthread_getschedparam(pthread_self(), &policy, &sp) == 0) {
        return sp.sched_priority;
    }
    return 10;
}

static void emit_event(uint32_t kind, int src_prio, int dst_prio,
                       uint32_t latency_us, uint32_t jitter_us,
                       uint32_t flags, const char *label) {
    if (g_scope_fd < 0) return;
    ps_event_t evt;
    memset(&evt, 0, sizeof(evt));
    evt.timestamp_ns = now_ns();
    evt.kind = kind;
    evt.src_pid = getpid();
    evt.dst_pid = getpid();
    evt.src_prio = src_prio;
    evt.dst_prio = dst_prio;
    evt.latency_us = latency_us;
    evt.jitter_us = jitter_us;
    evt.flags = flags;
    snprintf(evt.label, sizeof(evt.label), "%.31s", label);
    devctl(g_scope_fd, DCMD_PULSE_SCOPE_RECORD, &evt, sizeof(evt), NULL);
}

/* Stage 3: Actuator IPC Server (SCHED_FIFO prio 20) */
static void *actuator_thread(void *arg) {
    (void)arg;
    set_thread_fifo(20);
    pthread_setname_np(pthread_self(), "actuator_srv");

    ps_ipc_msg_t req;
    ps_ipc_reply_t rep;

    while (1) {
        rcvid_t rcvid = MsgReceive(g_actuator_chid, &req, sizeof(req), NULL);
        if (rcvid == -1) {
            usleep(1000);
            continue;
        }
        if (rcvid == 0) {
            /* Asynchronous pulse received */
            continue;
        }

        int eff_prio = get_current_prio();
        uint64_t t0 = now_ns();

        /* Simulate actuator work or intentional REPLY-BLOCKED stall */
        if (g_cfg.fault_reply_stall) {
            uint32_t stall = g_cfg.stall_ms > 0 ? g_cfg.stall_ms : 35;
            usleep(stall * 1000);
        } else {
            busy_spin_us(120);
        }

        memset(&rep, 0, sizeof(rep));
        rep.cycle_id = req.cycle_id;
        rep.handled_ns = now_ns();
        rep.control_output = req.sensor_value * 0.85;
        rep.server_prio = eff_prio;
        rep.status = 0;

        uint32_t dur_us = (uint32_t)((rep.handled_ns - t0) / 1000ULL);
        MsgReply(rcvid, EOK, &rep, sizeof(rep));

        emit_event(PS_EVT_IPC_HOP, eff_prio, 20, dur_us, 0,
                   (g_cfg.prio_inherit_enabled ? 1U : 0U) | (g_cfg.fault_reply_stall ? 2U : 0U),
                   "controller->actuator");
    }
    return NULL;
}

/* Stage 2: Controller IPC Server (SCHED_FIFO prio 25) */
static void *controller_thread(void *arg) {
    (void)arg;
    set_thread_fifo(25);
    pthread_setname_np(pthread_self(), "controller_srv");

    int act_coid = ConnectAttach(0, getpid(), g_actuator_chid, _NTO_SIDE_CHANNEL, 0);
    ps_ipc_msg_t req;
    ps_ipc_reply_t rep;

    while (1) {
        rcvid_t rcvid = MsgReceive(g_controller_chid, &req, sizeof(req), NULL);
        if (rcvid == -1) {
            usleep(1000);
            continue;
        }
        if (rcvid == 0) {
            continue;
        }

        int eff_prio = get_current_prio();
        uint64_t t0 = now_ns();

        /* Forward control command synchronously to Actuator via QNX MsgSend() */
        ps_ipc_msg_t act_req = req;
        act_req.hdr.type = MSG_TYPE_ACTUATOR_CMD;
        ps_ipc_reply_t act_rep;
        memset(&act_rep, 0, sizeof(act_rep));

        if (act_coid >= 0) {
            MsgSend(act_coid, &act_req, sizeof(act_req), &act_rep, sizeof(act_rep));
        }

        memset(&rep, 0, sizeof(rep));
        rep.cycle_id = req.cycle_id;
        rep.handled_ns = now_ns();
        rep.control_output = act_rep.control_output;
        rep.server_prio = eff_prio;
        rep.status = 0;

        uint32_t dur_us = (uint32_t)((rep.handled_ns - t0) / 1000ULL);
        MsgReply(rcvid, EOK, &rep, sizeof(rep));

        emit_event(PS_EVT_IPC_HOP, 30, eff_prio, dur_us, 0,
                   g_cfg.prio_inherit_enabled ? 1U : 0U,
                   "sensor->controller");
    }
    return NULL;
}

/* Low-priority background worker (SCHED_FIFO prio 15) sharing sensor calibration mutex */
static void *low_worker_thread(void *arg) {
    (void)arg;
    pin_to_cpu0();
    set_thread_fifo(15);
    pthread_setname_np(pthread_self(), "low_calib_worker");

    while (1) {
        if (g_cfg.fault_prio_inversion) {
            pthread_mutex_t *m = g_cfg.prio_inherit_enabled ? &g_mtx_inherit : &g_mtx_noinherit;
            pthread_mutex_lock(m);
            int boosted_seen = 0;
            /* Hold mutex for ~12ms across small slices so we can sample effective priority
             * via QNX sched_getparam/SchedGet while sensor (prio 30) contends on m:
             *   - PTHREAD_PRIO_INHERIT: QNX boosts us from prio 15 -> 30 immediately!
             *   - PTHREAD_PRIO_NONE: medium-prio CPU hog (24) preempts us on CPU 0 -> inversion! */
            for (int slice = 0; slice < 12; slice++) {
                busy_spin_us(1000);
                struct sched_param cur;
                if (SchedGet(0, 0, &cur) != -1 && cur.sched_curpriority > 15 && !boosted_seen) {
                    boosted_seen = 1;
                    emit_event(PS_EVT_PRIO_BOOST, 15, cur.sched_curpriority, 0, 0, 1,
                               "qnx:prio_inherit_boost");
                }
            }
            pthread_mutex_unlock(m);
            usleep(6000);
        } else {
            usleep(40000);
        }
    }
    return NULL;
}

/* Medium-priority CPU Hog (SCHED_FIFO prio 24) to trigger classic Priority Inversion */
static void *cpu_hog_thread(void *arg) {
    (void)arg;
    pin_to_cpu0();
    set_thread_fifo(24);
    pthread_setname_np(pthread_self(), "med_cpu_hog");

    while (1) {
        if (g_cfg.fault_cpu_hog || g_cfg.fault_prio_inversion) {
            busy_spin_us(28000);
            usleep(4000); /* brief yield so telemetry agent & SSH remain responsive */
        } else {
            usleep(50000);
        }
    }
    return NULL;
}

/* Stage 1: High-Priority Sensor Loop (SCHED_FIFO prio 30) driven by QNX Pulse Timer */
static void *sensor_thread(void *arg) {
    (void)arg;
    pin_to_cpu0();
    set_thread_fifo(30);
    pthread_setname_np(pthread_self(), "sensor_rt_loop");

    int timer_chid = ChannelCreate(0);
    int timer_coid = ConnectAttach(0, getpid(), timer_chid, _NTO_SIDE_CHANNEL, 0);
    int ctrl_coid  = ConnectAttach(0, getpid(), g_controller_chid, _NTO_SIDE_CHANNEL, 0);

    struct sigevent sigev;
    SIGEV_PULSE_INIT(&sigev, timer_coid, 30, PULSE_CODE_TIMER_TICK, 0);

    timer_t tid;
    if (timer_create(CLOCK_MONOTONIC, &sigev, &tid) != 0) {
        perror("timer_create");
        return NULL;
    }

    uint32_t current_period_ms = g_cfg.tick_period_ms;
    struct itimerspec its;
    its.it_value.tv_sec = 0;
    its.it_value.tv_nsec = (long)current_period_ms * 1000000L;
    its.it_interval.tv_sec = 0;
    its.it_interval.tv_nsec = (long)current_period_ms * 1000000L;
    timer_settime(tid, 0, &its, NULL);

    uint64_t cycle = 0;
    uint64_t last_tick_ns = now_ns();
    struct _pulse pulse;

    while (1) {
        rcvid_t rcvid = MsgReceivePulse(timer_chid, &pulse, sizeof(pulse), NULL);
        if (rcvid == -1) {
            continue;
        }

        uint64_t wake_ns = now_ns();
        uint64_t expected_ns = (uint64_t)current_period_ms * 1000000ULL;
        uint64_t delta_ns = wake_ns > last_tick_ns ? (wake_ns - last_tick_ns) : expected_ns;
        uint64_t jitter_ns = delta_ns > expected_ns ? (delta_ns - expected_ns) : (expected_ns - delta_ns);
        last_tick_ns = wake_ns;
        cycle++;

        /* Poll latest fault-injection config from /dev/pulse_scope every 4 cycles */
        if ((cycle % 4) == 0 && g_scope_fd >= 0) {
            ps_fault_config_t latest;
            if (devctl(g_scope_fd, DCMD_PULSE_SCOPE_GET_CFG, &latest, sizeof(latest), NULL) == EOK) {
                g_cfg = latest;
                if (g_cfg.tick_period_ms != current_period_ms && g_cfg.tick_period_ms >= 10) {
                    current_period_ms = g_cfg.tick_period_ms;
                    its.it_value.tv_nsec = (long)current_period_ms * 1000000L;
                    its.it_interval.tv_nsec = (long)current_period_ms * 1000000L;
                    timer_settime(tid, 0, &its, NULL);
                }
            }
        }

        uint64_t e2e_start = now_ns();

        /* Acquire shared calibration mutex when priority-inversion lab is active */
        if (g_cfg.fault_prio_inversion) {
            pthread_mutex_t *m = g_cfg.prio_inherit_enabled ? &g_mtx_inherit : &g_mtx_noinherit;
            pthread_mutex_lock(m);
            busy_spin_us(80);
            pthread_mutex_unlock(m);
        }

        /* Send synchronous QNX Message to Controller -> Actuator */
        ps_ipc_msg_t msg;
        memset(&msg, 0, sizeof(msg));
        msg.hdr.type = MSG_TYPE_SENSOR_FRAME;
        msg.cycle_id = cycle;
        msg.sent_ns = e2e_start;
        msg.sensor_value = 50.0 + 25.0 * sin((double)cycle * 0.25);

        ps_ipc_reply_t rep;
        memset(&rep, 0, sizeof(rep));
        if (ctrl_coid >= 0) {
            MsgSend(ctrl_coid, &msg, sizeof(msg), &rep, sizeof(rep));
        }

        uint64_t e2e_end = now_ns();
        uint32_t e2e_us = (uint32_t)((e2e_end - e2e_start) / 1000ULL);
        uint32_t jitter_us = (uint32_t)(jitter_ns / 1000ULL);
        if (g_cfg.fault_prio_inversion && !g_cfg.prio_inherit_enabled && e2e_us > jitter_us) {
            jitter_us = e2e_us;
        }

        uint32_t flags = (g_cfg.prio_inherit_enabled ? 1U : 0U) |
                         ((e2e_us > 8000 || jitter_us > 5000) ? 2U : 0U);

        emit_event(PS_EVT_IPC_HOP, 30, 20, e2e_us, jitter_us, flags, "e2e:sensor->actuator");
        emit_event(PS_EVT_PULSE_TICK, 30, 30, e2e_us, jitter_us, flags, "pulse:timer_tick");
    }
    return NULL;
}

int main(void) {
    g_cycles_per_sec = SYSPAGE_ENTRY(qtime)->cycles_per_sec;

    /* Initialize PTHREAD_PRIO_INHERIT and PTHREAD_PRIO_NONE mutexes */
    pthread_mutexattr_t ma_pi, ma_none;
    pthread_mutexattr_init(&ma_pi);
    pthread_mutexattr_setprotocol(&ma_pi, PTHREAD_PRIO_INHERIT);
    pthread_mutex_init(&g_mtx_inherit, &ma_pi);

    pthread_mutexattr_init(&ma_none);
    pthread_mutexattr_setprotocol(&ma_none, PTHREAD_PRIO_NONE);
    pthread_mutex_init(&g_mtx_noinherit, &ma_none);

    /* Open /dev/pulse_scope Resource Manager */
    for (int retry = 0; retry < 10 && g_scope_fd < 0; retry++) {
        g_scope_fd = open(PULSE_SCOPE_DEV_PATH, O_RDWR);
        if (g_scope_fd < 0) {
            usleep(200000);
        }
    }
    if (g_scope_fd < 0) {
        fprintf(stderr, "[ipc_lab_workload] WARNING: %s unavailable; running standalone\n",
                PULSE_SCOPE_DEV_PATH);
    }

    /* Create QNX IPC channels (note: _NTO_CHF_FIXED_PRIORITY omitted so QNX naturally inherits prio!) */
    g_actuator_chid   = ChannelCreate(0);
    g_controller_chid = ChannelCreate(0);
    if (g_actuator_chid == -1 || g_controller_chid == -1) {
        perror("ChannelCreate");
        return EXIT_FAILURE;
    }

    printf("[ipc_lab_workload] Running 3-stage QNX IPC + Pulse + SCHED_FIFO lab (pid=%d)\n", getpid());
    fflush(stdout);

    pthread_t th_act, th_ctrl, th_low, th_hog, th_sens;
    pthread_create(&th_act,  NULL, actuator_thread,   NULL);
    pthread_create(&th_ctrl, NULL, controller_thread, NULL);
    pthread_create(&th_low,  NULL, low_worker_thread, NULL);
    pthread_create(&th_hog,  NULL, cpu_hog_thread,    NULL);
    pthread_create(&th_sens, NULL, sensor_thread,     NULL);

    pthread_join(th_sens, NULL);
    return EXIT_SUCCESS;
}
