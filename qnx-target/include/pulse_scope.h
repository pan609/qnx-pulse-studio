#ifndef PULSE_SCOPE_H
#define PULSE_SCOPE_H

#include <stdint.h>
#include <devctl.h>
#include <sys/iomsg.h>

/* QNX pathname registered by pulse_scope_resmgr via resmgr_attach() */
#define PULSE_SCOPE_DEV_PATH        "/dev/pulse_scope"

/* QNX GNS / name_attach() endpoints for the 3-stage IPC lab */
#define PULSE_LAB_CONTROLLER_NAME   "pulse_studio_controller"
#define PULSE_LAB_ACTUATOR_NAME     "pulse_studio_actuator"

/* QNX Pulse codes (_PULSE_CODE_MINAVAIL = 0) */
#define PULSE_CODE_TIMER_TICK       (_PULSE_CODE_MINAVAIL + 1)
#define PULSE_CODE_FAULT_NOTIFY     (_PULSE_CODE_MINAVAIL + 2)
#define PULSE_CODE_ACTUATOR_ACK     (_PULSE_CODE_MINAVAIL + 3)

/* Custom QNX IPC message types for MsgSend / MsgReceive / MsgReply */
#define MSG_TYPE_SENSOR_FRAME       (_IO_MAX + 10)
#define MSG_TYPE_ACTUATOR_CMD       (_IO_MAX + 11)

/* Event kinds captured into /dev/pulse_scope ring buffer */
typedef enum {
    PS_EVT_IPC_HOP        = 1,
    PS_EVT_PULSE_TICK     = 2,
    PS_EVT_PRIO_BOOST     = 3,
    PS_EVT_FAULT_TOGGLE   = 4,
    PS_EVT_DEVCTL_CMD     = 5
} ps_event_kind_t;

/* Single real-time telemetry event recorded with QNX ClockCycles() */
typedef struct {
    uint64_t seq;
    uint64_t timestamp_ns;
    uint32_t kind;
    int32_t  src_pid;
    int32_t  dst_pid;
    int32_t  src_prio;
    int32_t  dst_prio;
    uint32_t latency_us;
    uint32_t jitter_us;
    uint32_t flags;          /* bit0: prio_inherit_active, bit1: anomaly */
    char     label[32];
} ps_event_t;

/* Live fault-injection & scheduler lab configuration */
typedef struct {
    uint32_t prio_inherit_enabled;   /* 1 = PTHREAD_PRIO_INHERIT, 0 = PTHREAD_PRIO_NONE */
    uint32_t fault_prio_inversion;   /* 1 = inject lock contention + medium-prio CPU hog */
    uint32_t fault_reply_stall;      /* 1 = delay MsgReply() in actuator -> REPLY-BLOCKED */
    uint32_t fault_cpu_hog;          /* 1 = saturate CPU at prio 24 */
    uint32_t tick_period_ms;         /* Pulse timer cadence (default 50ms = 20Hz) */
    uint32_t stall_ms;               /* MsgReply stall duration in ms (default 35ms) */
} ps_fault_config_t;

/* Observed QNX thread state snapshot from /proc/<pid>/as (DCMD_PROC_TIDSTATUS) */
#define PS_MAX_THREADS  24
#define PS_MAX_EVENTS   64

typedef struct {
    int32_t  pid;
    int32_t  tid;
    int32_t  priority;       /* effective priority (reflects QNX priority inheritance!) */
    int32_t  real_priority;  /* base/assigned priority */
    uint32_t state;          /* QNX STATE_RUNNING / STATE_SEND / STATE_REPLY / STATE_MUTEX ... */
    uint32_t policy;         /* SCHED_FIFO / SCHED_RR / SCHED_OTHER */
    uint32_t blocked_on_pid; /* target pid if SEND/REPLY blocked */
    uint32_t last_cpu;
    char     proc_name[24];
} ps_thread_snap_t;

/* Aggregate metrics + recent events + thread states returned by DCMD_PULSE_SCOPE_GET_SNAPSHOT */
typedef struct {
    uint64_t snapshot_ns;
    uint64_t cycles_per_sec;
    uint64_t total_ipc_msgs;
    uint64_t total_pulses;
    uint64_t prio_boost_count;
    uint64_t deadline_misses;
    uint32_t avg_ipc_us;
    uint32_t max_ipc_us;
    uint32_t p99_jitter_us;
    uint32_t last_jitter_us;
    ps_fault_config_t config;
    uint32_t thread_count;
    ps_thread_snap_t threads[PS_MAX_THREADS];
    uint32_t event_count;
    ps_event_t events[PS_MAX_EVENTS];
} ps_snapshot_t;

/* Structured QNX IPC payload between Sensor -> Controller -> Actuator */
typedef struct {
    struct _pulse hdr;       /* allows server to handle pulses & messages cleanly */
    uint64_t      cycle_id;
    uint64_t      sent_ns;
    double        sensor_value;
    uint32_t      flags;
} ps_ipc_msg_t;

typedef struct {
    uint64_t cycle_id;
    uint64_t handled_ns;
    double   control_output;
    int32_t  server_prio;
    int32_t  status;
} ps_ipc_reply_t;

/* Custom QNX devctl() command codes for /dev/pulse_scope */
#define _DCMD_PULSE_SCOPE           _DCMD_MISC
#define DCMD_PULSE_SCOPE_RECORD     __DIOT(_DCMD_PULSE_SCOPE,  1, ps_event_t)
#define DCMD_PULSE_SCOPE_SNAPSHOT   __DIOF(_DCMD_PULSE_SCOPE,  2, ps_snapshot_t)
#define DCMD_PULSE_SCOPE_SET_CFG    __DIOT(_DCMD_PULSE_SCOPE,  3, ps_fault_config_t)
#define DCMD_PULSE_SCOPE_GET_CFG    __DIOF(_DCMD_PULSE_SCOPE,  4, ps_fault_config_t)
#define DCMD_PULSE_SCOPE_RESET      __DION(_DCMD_PULSE_SCOPE,  5)

#endif /* PULSE_SCOPE_H */
