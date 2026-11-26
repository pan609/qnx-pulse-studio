# QNX SDP 8.0 Native Cross-Compilation Makefile
# Targets: aarch64le (macOS/Linux QEMU virt-7.2 / Raspberry Pi 5) or x86_64

ARCH ?= aarch64le

ifeq ($(ARCH),aarch64le)
  QCC_VARIANT := gcc_ntoaarch64le
else ifeq ($(ARCH),x86_64)
  QCC_VARIANT := gcc_ntox86_64
else
  $(error Unsupported ARCH=$(ARCH). Use aarch64le or x86_64)
endif

CC      := qcc -V$(QCC_VARIANT)
CFLAGS  := -Wall -Wextra -O2 -std=gnu11 -Iinclude
LDFLAGS := -lm
SOCKLIB := -lsocket

BUILD_DIR := build/$(ARCH)
TARGETS   := $(BUILD_DIR)/pulse_scope_resmgr \
             $(BUILD_DIR)/ipc_lab_workload \
             $(BUILD_DIR)/telemetry_agent

.PHONY: all clean

all: $(BUILD_DIR) $(TARGETS)

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(BUILD_DIR)/pulse_scope_resmgr: src/pulse_scope_resmgr.c include/pulse_scope.h
	$(CC) $(CFLAGS) -o $@ src/pulse_scope_resmgr.c $(LDFLAGS)

$(BUILD_DIR)/ipc_lab_workload: src/ipc_lab_workload.c include/pulse_scope.h
	$(CC) $(CFLAGS) -o $@ src/ipc_lab_workload.c $(LDFLAGS)

$(BUILD_DIR)/telemetry_agent: src/telemetry_agent.c src/control_json.c src/control_json.h include/pulse_scope.h
	$(CC) $(CFLAGS) -o $@ src/telemetry_agent.c src/control_json.c $(SOCKLIB)

clean:
	rm -rf build
