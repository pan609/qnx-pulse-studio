/*
 * telemetry_agent.c
 *
 * Native QNX 8.0 HTTP/JSON + CORS telemetry and control bridge.
 * Queries /dev/pulse_scope via QNX devctl() (DCMD_PULSE_SCOPE_SNAPSHOT / SET_CFG / RESET)
 * and serves real-time JSON snapshots over TCP port 8080 (forwarded by QEMU hostfwd).
 *
 * Hardened HTTP & JSON layer:
 *   - Loops recv() until full HTTP headers + Content-Length body arrive (handles split TCP POSTs)
 *   - Escapes all string fields (proc_name, thread_name, event label, utsname) for RFC 8259 JSON
 *   - Exposes strict separated E2E Response Time & Pulse Wakeup Jitter metrics + /proc scope control
 */

#include <arpa/inet.h>
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/states.h>
#include <sys/time.h>
#include <sys/utsname.h>
#include <unistd.h>

#include "pulse_scope.h"

static int g_scope_fd = -1;

static const char *qnx_state_name(uint32_t st) {
    switch (st) {
    case STATE_DEAD:        return "DEAD";
    case STATE_RUNNING:     return "RUNNING";
    case STATE_READY:       return "READY";
    case STATE_STOPPED:     return "STOPPED";
    case STATE_SEND:        return "SEND";
    case STATE_RECEIVE:     return "RECEIVE";
    case STATE_REPLY:       return "REPLY";
    case STATE_WAITPAGE:    return "WAITPAGE";
    case STATE_SIGSUSPEND:  return "SIGSUSPEND";
    case STATE_SIGWAITINFO: return "SIGWAITINFO";
    case STATE_NANOSLEEP:   return "NANOSLEEP";
    case STATE_MUTEX:       return "MUTEX";
    case STATE_CONDVAR:     return "CONDVAR";
    case STATE_JOIN:        return "JOIN";
    case STATE_INTR:        return "INTR";
    case STATE_SEM:         return "SEM";
    default:                return "OTHER";
    }
}

static const char *qnx_policy_name(uint32_t pol) {
    switch (pol) {
    case SCHED_FIFO:  return "SCHED_FIFO";
    case SCHED_RR:    return "SCHED_RR";
    case SCHED_OTHER: return "SCHED_OTHER";
    default:          return "SCHED_OTHER";
    }
}

static const char *scope_mode_name(uint32_t m) {
    switch (m) {
    case PS_SCOPE_ALL: return "all";
    case PS_SCOPE_PID: return "pid";
    default:           return "lab";
    }
}

/* Safe RFC 8259 JSON string escaper */
static void json_escape(char *dst, size_t dst_sz, const char *src) {
    size_t j = 0;
    for (size_t i = 0; src[i] != '\0' && j + 6 < dst_sz; i++) {
        unsigned char c = (unsigned char)src[i];
        if (c == '"' || c == '\\') {
            dst[j++] = '\\';
            dst[j++] = (char)c;
        } else if (c == '\n') {
            dst[j++] = '\\';
            dst[j++] = 'n';
        } else if (c == '\r') {
            dst[j++] = '\\';
            dst[j++] = 'r';
        } else if (c == '\t') {
            dst[j++] = '\\';
            dst[j++] = 't';
        } else if (c < 0x20 || c == 0x7f) {
            /* skip raw control bytes */
        } else {
            dst[j++] = (char)c;
        }
    }
    dst[j] = '\0';
}

static void send_all(int cfd, const char *buf, size_t len) {
    size_t sent = 0;
    while (sent < len) {
        ssize_t n = send(cfd, buf + sent, len - sent, 0);
        if (n <= 0) {
            break;
        }
        sent += (size_t)n;
    }
}

static void send_http_response(int cfd, int code, const char *status_text,
                               const char *content_type, const char *body) {
    char header[512];
    size_t body_len = body ? strlen(body) : 0;
    int hlen = snprintf(
        header, sizeof(header),
        "HTTP/1.1 %d %s\r\n"
        "Content-Type: %s\r\n"
        "Content-Length: %zu\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        "Access-Control-Allow-Headers: Content-Type\r\n"
        "Connection: close\r\n\r\n",
        code, status_text, content_type, body_len);
    if (hlen > 0) {
        send_all(cfd, header, (size_t)hlen);
    }
    if (body_len > 0) {
        send_all(cfd, body, body_len);
    }
}

static int parse_json_int(const char *body, const char *key, int fallback) {
    char needle[64];
    snprintf(needle, sizeof(needle), "\"%s\"", key);
    const char *p = strstr(body, needle);
    if (!p) return fallback;
    p = strchr(p + strlen(needle), ':');
    if (!p) return fallback;
    p++;
    while (*p == ' ' || *p == '\t') p++;
    if (strncmp(p, "true", 4) == 0) return 1;
    if (strncmp(p, "false", 5) == 0) return 0;
    if (*p == '"') {
        p++;
        if (strncmp(p, "all", 3) == 0) return (int)PS_SCOPE_ALL;
        if (strncmp(p, "pid", 3) == 0) return (int)PS_SCOPE_PID;
        if (strncmp(p, "lab", 3) == 0) return (int)PS_SCOPE_LAB;
    }
    return atoi(p);
}

static int parse_content_length(const char *headers, size_t hdr_len) {
    const char *p = headers;
    const char *end = headers + hdr_len;
    while (p < end) {
        if ((size_t)(end - p) >= 15 && strncasecmp(p, "Content-Length:", 15) == 0) {
            p += 15;
            while (p < end && (*p == ' ' || *p == '\t')) p++;
            char *tail = NULL;
            long val = strtol(p, &tail, 10);
            if (tail == p || val < 0 || val > 8191) return -1;
            while (tail < end && (*tail == ' ' || *tail == '\t' || *tail == '\r')) tail++;
            if (tail < end && *tail != '\n') return -1;
            return (int)val;
        }
        const char *nl = memchr(p, '\n', (size_t)(end - p));
        if (!nl) break;
        p = nl + 1;
    }
    return 0;
}

static ssize_t read_full_http_request(int cfd, char *buf, size_t cap, const char **body_out) {
    struct timeval tv;
    tv.tv_sec = 2;
    tv.tv_usec = 0;
    setsockopt(cfd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
    setsockopt(cfd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

    size_t total = 0;
    char *hdr_end = NULL;
    int content_len = 0;

    while (total + 1 < cap) {
        ssize_t n = recv(cfd, buf + total, cap - 1 - total, 0);
        if (n <= 0) {
            break;
        }
        total += (size_t)n;
        buf[total] = '\0';

        if (!hdr_end) {
            hdr_end = strstr(buf, "\r\n\r\n");
            if (hdr_end) {
                size_t hdr_bytes = (size_t)(hdr_end - buf);
                content_len = parse_content_length(buf, hdr_bytes);
                if (content_len < 0 || hdr_bytes + 4 + (size_t)content_len >= cap) return -1;
            }
        }
        if (hdr_end) {
            size_t body_got = total - (size_t)((hdr_end + 4) - buf);
            if ((int)body_got >= content_len) {
                break;
            }
        }
    }

    if (total == 0) return 0;
    if (!hdr_end || strstr(buf, "Transfer-Encoding:") || strstr(buf, "transfer-encoding:")) return -1;
    size_t body_got = total - (size_t)((hdr_end + 4) - buf);
    if (body_got < (size_t)content_len) return -1;
    *body_out = hdr_end + 4;
    ((char *)*body_out)[content_len] = '\0';
    return (ssize_t)total;
}

static void handle_snapshot(int cfd) {
    static ps_snapshot_t snap;
    if (g_scope_fd < 0) {
        g_scope_fd = open(PULSE_SCOPE_DEV_PATH, O_RDWR);
    }
    if (g_scope_fd < 0 ||
        devctl(g_scope_fd, DCMD_PULSE_SCOPE_SNAPSHOT, &snap, sizeof(snap), NULL) != EOK) {
        send_http_response(cfd, 503, "Service Unavailable", "application/json",
                           "{\"error\":\"/dev/pulse_scope unavailable\"}");
        return;
    }

    struct utsname uts;
    memset(&uts, 0, sizeof(uts));
    uname(&uts);

    char esc_sys[64], esc_rel[64], esc_mach[64], esc_node[64];
    json_escape(esc_sys, sizeof(esc_sys), uts.sysname);
    json_escape(esc_rel, sizeof(esc_rel), uts.release);
    json_escape(esc_mach, sizeof(esc_mach), uts.machine);
    json_escape(esc_node, sizeof(esc_node), uts.nodename);

    static char json[98304];
    int pos = 0;
    pos += snprintf(
        json + pos, sizeof(json) - (size_t)pos,
        "{\"source\":\"qnx-8.0-live\",\"host\":{\"sysname\":\"%s\",\"release\":\"%s\","
        "\"machine\":\"%s\",\"nodename\":\"%s\"},"
        "\"snapshot_ns\":%llu,\"cycles_per_sec\":%llu,"
        "\"metrics\":{\"total_ipc_msgs\":%llu,\"total_cycles\":%llu,\"total_pulses\":%llu,"
        "\"prio_boost_count\":%llu,\"deadline_misses\":%llu,"
        "\"avg_e2e_us\":%u,\"p99_e2e_us\":%u,\"max_e2e_us\":%u,\"last_e2e_us\":%u,"
        "\"avg_jitter_us\":%u,\"p99_jitter_us\":%u,\"max_jitter_us\":%u,\"last_jitter_us\":%u,"
        "\"avg_ipc_us\":%u,\"max_ipc_us\":%u},"
        "\"config\":{\"prio_inherit_enabled\":%s,\"fault_prio_inversion\":%s,"
        "\"fault_reply_stall\":%s,\"fault_cpu_hog\":%s,"
        "\"tick_period_ms\":%u,\"stall_ms\":%u,\"scope_mode\":\"%s\",\"scope_pid\":%d,\"generation\":%u},"
        "\"threads\":[",
        esc_sys, esc_rel, esc_mach, esc_node,
        (unsigned long long)snap.snapshot_ns,
        (unsigned long long)snap.cycles_per_sec,
        (unsigned long long)snap.total_ipc_msgs,
        (unsigned long long)snap.total_cycles,
        (unsigned long long)snap.total_pulses,
        (unsigned long long)snap.prio_boost_count,
        (unsigned long long)snap.deadline_misses,
        snap.avg_e2e_us, snap.p99_e2e_us, snap.max_e2e_us, snap.last_e2e_us,
        snap.avg_jitter_us, snap.p99_jitter_us, snap.max_jitter_us, snap.last_jitter_us,
        snap.avg_e2e_us, snap.max_e2e_us,
        snap.config.prio_inherit_enabled ? "true" : "false",
        snap.config.fault_prio_inversion ? "true" : "false",
        snap.config.fault_reply_stall ? "true" : "false",
        snap.config.fault_cpu_hog ? "true" : "false",
        snap.config.tick_period_ms, snap.config.stall_ms,
        scope_mode_name(snap.config.scope_mode), snap.config.scope_pid, snap.config.generation);

    for (uint32_t i = 0; i < snap.thread_count && pos < (int)sizeof(json) - 512; i++) {
        const ps_thread_snap_t *t = &snap.threads[i];
        char esc_proc[64], esc_tname[64];
        json_escape(esc_proc, sizeof(esc_proc), t->proc_name);
        json_escape(esc_tname, sizeof(esc_tname), t->thread_name[0] ? t->thread_name : t->proc_name);
        pos += snprintf(
            json + pos, sizeof(json) - (size_t)pos,
            "%s{\"pid\":%d,\"tid\":%d,\"proc_name\":\"%s\",\"name\":\"%s\",\"priority\":%d,"
            "\"real_priority\":%d,\"state\":\"%s\",\"policy\":\"%s\","
            "\"blocked_on_pid\":%u,\"cpu\":%u}",
            (i > 0 ? "," : ""),
            t->pid, t->tid, esc_proc, esc_tname, t->priority, t->real_priority,
            qnx_state_name(t->state), qnx_policy_name(t->policy),
            t->blocked_on_pid, t->last_cpu);
    }

    pos += snprintf(json + pos, sizeof(json) - (size_t)pos, "],\"events\":[");

    for (uint32_t i = 0; i < snap.event_count && pos < (int)sizeof(json) - 256; i++) {
        const ps_event_t *e = &snap.events[i];
        char esc_lbl[96];
        json_escape(esc_lbl, sizeof(esc_lbl), e->label);
        pos += snprintf(
            json + pos, sizeof(json) - (size_t)pos,
            "%s{\"seq\":%llu,\"ts_ns\":%llu,\"kind\":%u,\"src_pid\":%d,\"dst_pid\":%d,"
            "\"src_prio\":%d,\"dst_prio\":%d,\"latency_us\":%u,\"jitter_us\":%u,"
            "\"flags\":%u,\"label\":\"%s\"}",
            (i > 0 ? "," : ""),
            (unsigned long long)e->seq, (unsigned long long)e->timestamp_ns,
            e->kind, e->src_pid, e->dst_pid, e->src_prio, e->dst_prio,
            e->latency_us, e->jitter_us, e->flags, esc_lbl);
    }

    pos += snprintf(json + pos, sizeof(json) - (size_t)pos, "]}");
    send_http_response(cfd, 200, "OK", "application/json", json);
}

static void handle_control(int cfd, const char *body) {
    if (g_scope_fd < 0) {
        g_scope_fd = open(PULSE_SCOPE_DEV_PATH, O_RDWR);
    }
    if (g_scope_fd < 0) {
        send_http_response(cfd, 503, "Service Unavailable", "application/json",
                           "{\"error\":\"/dev/pulse_scope unavailable\"}");
        return;
    }

    if (strstr(body, "\"reset\":true") || strstr(body, "\"reset\": true")) {
        devctl(g_scope_fd, DCMD_PULSE_SCOPE_RESET, NULL, 0, NULL);
        send_http_response(cfd, 200, "OK", "application/json", "{\"ok\":true,\"action\":\"reset\"}");
        return;
    }

    ps_fault_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    devctl(g_scope_fd, DCMD_PULSE_SCOPE_GET_CFG, &cfg, sizeof(cfg), NULL);

    cfg.prio_inherit_enabled = (uint32_t)parse_json_int(body, "prio_inherit_enabled", (int)cfg.prio_inherit_enabled);
    cfg.fault_prio_inversion = (uint32_t)parse_json_int(body, "fault_prio_inversion", (int)cfg.fault_prio_inversion);
    cfg.fault_reply_stall    = (uint32_t)parse_json_int(body, "fault_reply_stall",    (int)cfg.fault_reply_stall);
    cfg.fault_cpu_hog        = (uint32_t)parse_json_int(body, "fault_cpu_hog",        (int)cfg.fault_cpu_hog);
    cfg.tick_period_ms       = (uint32_t)parse_json_int(body, "tick_period_ms",       (int)cfg.tick_period_ms);
    cfg.stall_ms             = (uint32_t)parse_json_int(body, "stall_ms",             (int)cfg.stall_ms);
    cfg.scope_mode           = (uint32_t)parse_json_int(body, "scope_mode",           (int)cfg.scope_mode);
    cfg.scope_pid            = (int32_t)parse_json_int(body,  "scope_pid",            (int)cfg.scope_pid);

    int rc = devctl(g_scope_fd, DCMD_PULSE_SCOPE_SET_CFG, &cfg, sizeof(cfg), NULL);
    if (rc != EOK) {
        send_http_response(cfd, 500, "Internal Server Error", "application/json",
                           "{\"error\":\"devctl SET_CFG failed\"}");
        return;
    }
    devctl(g_scope_fd, DCMD_PULSE_SCOPE_GET_CFG, &cfg, sizeof(cfg), NULL);
    char response[96];
    snprintf(response, sizeof(response), "{\"ok\":true,\"generation\":%u}", cfg.generation);
    send_http_response(cfd, 200, "OK", "application/json", response);
}

static void handle_raw_resmgr(int cfd, const char *body) {
    int fd = open(PULSE_SCOPE_DEV_PATH, O_RDWR);
    if (fd < 0) {
        send_http_response(cfd, 503, "Service Unavailable", "application/json",
                           "{\"error\":\"open /dev/pulse_scope failed\"}");
        return;
    }

    if (body && strlen(body) > 0) {
        (void)write(fd, body, strlen(body));
    }

    char out[1024];
    ssize_t n = read(fd, out, sizeof(out) - 1);
    close(fd);
    if (n < 0) n = 0;
    out[n] = '\0';
    send_http_response(cfd, 200, "OK", "application/json", out);
}

static void serve_client(int cfd) {
    char req[8192];
    const char *body = "";
    ssize_t n = read_full_http_request(cfd, req, sizeof(req), &body);
    if (n <= 0) {
        if (n < 0) send_http_response(cfd, 400, "Bad Request", "application/json", "{\"error\":\"incomplete or unsupported HTTP request\"}");
        return;
    }

    char method[16] = {0}, path[128] = {0};
    sscanf(req, "%15s %127s", method, path);

    if (strcmp(method, "OPTIONS") == 0) {
        send_http_response(cfd, 204, "No Content", "text/plain", "");
        return;
    }

    if (strcmp(path, "/api/health") == 0) {
        struct utsname uts;
        memset(&uts, 0, sizeof(uts));
        uname(&uts);
        char esc_sys[64], esc_rel[64], esc_mach[64];
        json_escape(esc_sys, sizeof(esc_sys), uts.sysname);
        json_escape(esc_rel, sizeof(esc_rel), uts.release);
        json_escape(esc_mach, sizeof(esc_mach), uts.machine);
        char resp[512];
        snprintf(resp, sizeof(resp),
                 "{\"ok\":true,\"sysname\":\"%s\",\"release\":\"%s\",\"machine\":\"%s\"}",
                 esc_sys, esc_rel, esc_mach);
        send_http_response(cfd, 200, "OK", "application/json", resp);
    } else if (strcmp(path, "/api/snapshot") == 0) {
        handle_snapshot(cfd);
    } else if (strcmp(path, "/api/control") == 0 && strcmp(method, "POST") == 0) {
        handle_control(cfd, body);
    } else if (strcmp(path, "/api/devctl") == 0) {
        handle_raw_resmgr(cfd, body);
    } else {
        send_http_response(cfd, 404, "Not Found", "application/json", "{\"error\":\"not found\"}");
    }
}

int main(int argc, char **argv) {
    signal(SIGPIPE, SIG_IGN);
    int port = (argc > 1) ? atoi(argv[1]) : 8080;

    g_scope_fd = open(PULSE_SCOPE_DEV_PATH, O_RDWR);

    int sfd = socket(AF_INET, SOCK_STREAM, 0);
    if (sfd < 0) {
        perror("socket");
        return EXIT_FAILURE;
    }

    int opt = 1;
    setsockopt(sfd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port = htons((uint16_t)port);

    if (bind(sfd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("bind");
        close(sfd);
        return EXIT_FAILURE;
    }

    if (listen(sfd, 16) < 0) {
        perror("listen");
        close(sfd);
        return EXIT_FAILURE;
    }

    printf("[telemetry_agent] QNX 8.0 HTTP Telemetry Server listening on 0.0.0.0:%d\n", port);
    fflush(stdout);

    while (1) {
        int cfd = accept(sfd, NULL, NULL);
        if (cfd < 0) {
            continue;
        }
        serve_client(cfd);
        close(cfd);
    }

    close(sfd);
    return EXIT_SUCCESS;
}
