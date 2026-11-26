#ifndef CONTROL_JSON_H
#define CONTROL_JSON_H
#include <stdint.h>
#include <stddef.h>
enum { PS_CTL_PI, PS_CTL_INVERSION, PS_CTL_REPLY, PS_CTL_HOG, PS_CTL_TICK,
       PS_CTL_STALL, PS_CTL_SCOPE, PS_CTL_PID, PS_CTL_RESET, PS_CTL_COUNT };
typedef struct { uint32_t present; int32_t value[PS_CTL_COUNT]; } ps_control_patch_t;
/* Flat control-object schema. Unknown scalar members are ignored, nested values rejected. */
int ps_parse_control_json(const char *body, ps_control_patch_t *patch);
/* Reject unsupported TE, duplicate CL and ambiguous/malformed header framing. */
int ps_http_content_length(const char *headers, size_t length, size_t *content_length);
#endif
