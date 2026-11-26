export type Lang = 'en' | 'zh';

export interface Dict {
  brandSub: string;
  livePill: string;
  simPill: string;
  autoProbe: string;
  demoLocked: string;
  resetRing: string;
  guideToggle: string;
  guideTitle: string;
  guideSteps: { step: string; title: string; desc: string }[];
  kpiAvgIpc: string;
  kpiMax: string;
  kpiP99Jitter: string;
  kpiDeadline: string;
  kpiBoosts: string;
  kpiPiEnabled: string;
  kpiPiDisabled: string;
  kpiMisses: string;
  kpiMissFoot: string;
  kpiMsgCount: string;
  kpiTimerPulses: string;
  topoKicker: string;
  topoTitle: string;
  legendIpc: string;
  legendBoost: string;
  legendReplyBlk: string;
  legendInversion: string;
  topoPreempts: string;
  topoBlocked: string;
  topoIdle: string;
  topoBurning: string;
  topoSleeping: string;
  topoState: string;
  topoJitter: string;
  topoEffPrio: string;
  topoMutexHolder: string;
  topoInterference: string;
  topoResmgrKicker: string;
  topoMsgsBoosts: (msgs: string, boosts: number) => string;
  labKicker: string;
  labTitle: string;
  scenarios: {
    key: 'nominal' | 'inversion' | 'rescue' | 'stall';
    title: string;
    desc: string;
  }[];
  toggles: {
    piTitle: string;
    piDesc: string;
    invTitle: string;
    invDesc: string;
    stallTitle: string;
    stallDesc: (ms: number) => string;
    hogTitle: string;
    hogDesc: string;
    onPi: string;
    off: string;
    active: string;
    stalled: string;
    running: string;
  };
  oscKicker: string;
  oscTitle: string;
  oscE2e: string;
  oscJitter: string;
  oscBoostWin: string;
  oscDeadlineLine: (ms: string) => string;
  threadsKicker: string;
  threadsTitle: string;
  thThread: string;
  thPolicy: string;
  thEffPrio: string;
  thState: string;
  thCpu: string;
  consoleKicker: string;
  consoleTitle: string;
  consoleReady: string;
  consoleRun: string;
  copilotKicker: string;
  copilotTitle: string;
  byokActive: string;
  byokBtn: string;
  analyzeBtn: string;
  analyzingBtn: string;
  byokHint: string;
  rootCauseHead: string;
  evidenceHead: string;
  copyPatch: string;
  copied: string;
  engineKernel: string;
  engineLlm: string;
  sevLabels: Record<'nominal' | 'warning' | 'critical', string>;
}

export const DICT: Record<Lang, Dict> = {
  en: {
    brandSub: 'REAL-TIME MICROKERNEL IPC · RESOURCE MANAGER · SCHED_FIFO OBSERVATORY',
    livePill: 'LIVE QNX 8.0 (QEMU)',
    simPill: 'QNX 8.0 SIM TRACE (DEMO)',
    autoProbe: 'Auto-Probe :8080',
    demoLocked: 'Demo Locked',
    resetRing: 'Reset Ring',
    guideToggle: 'How to Play',
    guideTitle: '4-Step Microkernel Experiment Guide (Click in Order)',
    guideSteps: [
      {
        step: 'STEP 1',
        title: 'Observe Nominal RT Baseline',
        desc: 'Click "1. Nominal Deterministic". QNX 8.0 runs 20Hz SIGEV_PULSE + 3-stage MsgSend/Reply under 1ms.',
      },
      {
        step: 'STEP 2',
        title: 'Trigger Priority Inversion Crisis',
        desc: 'Click "2. Priority Inversion (PI OFF)". A medium-prio CPU hog (P24) starves P15 holding P30’s mutex—watch jitter spike past 5ms!',
      },
      {
        step: 'STEP 3',
        title: 'Watch QNX Priority Inheritance Rescue',
        desc: 'Click "3. QNX PI Rescue (PI ON)". QNX kernel boosts P15→P30 immediately; watch jitter collapse & Priority Boosts climb!',
      },
      {
        step: 'STEP 4',
        title: 'Run AI Co-Pilot & /dev/pulse_scope',
        desc: 'Click "Analyze Live Trace" for QNX C patch diffs, or send POSIX commands directly to /dev/pulse_scope.',
      },
    ],
    kpiAvgIpc: 'Avg E2E IPC Latency',
    kpiMax: 'Max',
    kpiP99Jitter: 'P99 Wakeup Jitter',
    kpiDeadline: 'Deadline: 5,000 µs (5.0 ms)',
    kpiBoosts: 'QNX Priority Boosts',
    kpiPiEnabled: 'PI: PTHREAD_PRIO_INHERIT',
    kpiPiDisabled: 'PI: DISABLED (PTHREAD_PRIO_NONE)',
    kpiMisses: 'RT Deadline Misses',
    kpiMissFoot: 'Threshold > 5,000 µs',
    kpiMsgCount: 'MsgSend / Pulse Count',
    kpiTimerPulses: 'timer pulses',
    topoKicker: 'QNX 8.0 MICROKERNEL IPC FABRIC',
    topoTitle: 'Live Message Passing & Priority Inheritance Graph',
    legendIpc: 'MsgSend / MsgReply',
    legendBoost: 'Priority Boost',
    legendReplyBlk: 'REPLY-BLOCKED',
    legendInversion: 'Inversion',
    topoPreempts: 'PREEMPTS!',
    topoBlocked: 'BLOCKED',
    topoIdle: 'idle',
    topoBurning: 'BURNING CPU',
    topoSleeping: 'SLEEPING',
    topoState: 'State',
    topoJitter: 'Jitter',
    topoEffPrio: 'Eff Prio',
    topoMutexHolder: 'MUTEX HOLDER',
    topoInterference: 'INTERFERENCE',
    topoResmgrKicker: 'QNX RESOURCE MANAGER',
    topoMsgsBoosts: (msgs, boosts) => `${msgs} msgs · ${boosts} PI boosts`,
    labKicker: 'MICROKERNEL CHAOS & DETERMINISM LAB',
    labTitle: 'Live Fault Injection (devctl)',
    scenarios: [
      {
        key: 'nominal',
        title: '1. Nominal Deterministic',
        desc: 'Clean 20 Hz Pulse + sub-ms MsgSend/Reply',
      },
      {
        key: 'inversion',
        title: '2. Priority Inversion (PI OFF)',
        desc: 'P24 hog starves P30 via P15 mutex lock',
      },
      {
        key: 'rescue',
        title: '3. QNX PI Rescue (PI ON)',
        desc: 'Kernel boosts P15→P30; jitter collapses!',
      },
      {
        key: 'stall',
        title: '4. REPLY-BLOCKED Cascade',
        desc: 'Actuator delays MsgReply() by 35 ms',
      },
    ],
    toggles: {
      piTitle: 'Priority Inheritance Protocol',
      piDesc: 'PTHREAD_PRIO_INHERIT vs PTHREAD_PRIO_NONE',
      invTitle: 'Mutex Contention + Inversion Lab',
      invDesc: 'Shared calibration lock between P30 & P15',
      stallTitle: 'Actuator MsgReply() Stall',
      stallDesc: (ms) => `Holds controller_srv in STATE_REPLY (${ms}ms)`,
      hogTitle: 'Medium-Priority CPU Hog (P24)',
      hogDesc: 'Saturates CPU below P30 sensor, above P15 worker',
      onPi: 'ON (PI)',
      off: 'OFF',
      active: 'ACTIVE',
      stalled: 'STALLED',
      running: 'RUNNING',
    },
    oscKicker: 'REAL-TIME DETERMINISM OSCILLOSCOPE',
    oscTitle: 'ClockCycles() IPC Latency & Pulse Wakeup Jitter',
    oscE2e: 'E2E IPC (µs)',
    oscJitter: 'Wakeup Jitter (µs)',
    oscBoostWin: 'PI Boost Window',
    oscDeadlineLine: (ms) => `HARD RT DEADLINE (${ms} ms)`,
    threadsKicker: '/proc/<pid>/as · DCMD_PROC_TIDSTATUS',
    threadsTitle: 'Live QNX 8.0 Thread Scheduler States',
    thThread: 'Thread',
    thPolicy: 'Policy',
    thEffPrio: 'Eff Prio',
    thState: 'QNX State',
    thCpu: 'CPU',
    consoleKicker: 'QNX RESOURCE MANAGER INTERFACE',
    consoleTitle: '/dev/pulse_scope Interactive POSIX Console',
    consoleReady: 'Ready. Click any quick POSIX command or send a write() payload to /dev/pulse_scope.',
    consoleRun: 'Run',
    copilotKicker: 'AI MICROKERNEL CO-PILOT',
    copilotTitle: 'Trace Root-Cause & QNX C API Fix Generator',
    byokActive: 'BYOK Active',
    byokBtn: 'BYOK LLM',
    analyzeBtn: 'Analyze Live Trace',
    analyzingBtn: 'Analyzing...',
    byokHint:
      'Zero API key required (built-in deterministic QNX kernel analyzer runs offline). Optionally add an OpenAI-compatible key for deep LLM commentary:',
    rootCauseHead: 'Microkernel Root Cause',
    evidenceHead: 'Observed QNX 8.0 API Evidence',
    copyPatch: 'Copy C Patch',
    copied: 'Copied',
    engineKernel: 'Kernel Engine',
    engineLlm: 'LLM Co-Pilot',
    sevLabels: { nominal: 'NOMINAL', warning: 'WARNING', critical: 'CRITICAL' },
  },
  zh: {
    brandSub: 'QNX 8.0 实时微内核 IPC · 资源管理器 · SCHED_FIFO 调度观测台',
    livePill: '真机 QNX 8.0 (QEMU 实时连接)',
    simPill: 'QNX 8.0 仿真模式 (DEMO)',
    autoProbe: '自动直连 :8080',
    demoLocked: '锁定仿真模式',
    resetRing: '清空采样缓存',
    guideToggle: '玩法指南',
    guideTitle: '4 步上手体验指南（按顺序点一遍即可看懂 QNX 实时微内核的硬核威力）',
    guideSteps: [
      {
        step: '第 1 步',
        title: '看正常硬实时基线',
        desc: '点「1. 正常确定性基线」：QNX 8.0 以 20Hz 脉冲驱动 3 级同步消息传递，延迟稳稳控制在 1ms 内。',
      },
      {
        step: '第 2 步',
        title: '制造「优先级反转」事故',
        desc: '点「2. 优先级反转 (关闭 PI)」：中优先级 CPU 抢占线程 (P24) 饿死拿着锁的低优先级线程 (P15)，导致最高优先级传感器 (P30) 卡死，示波器红线瞬间爆表！',
      },
      {
        step: '第 3 步',
        title: '见证 QNX 优先级继承秒救',
        desc: '点「3. QNX 优先级继承救援 (开启 PI)」：内核瞬间把 P15 临时提权到 P30，反杀 P24 抢占，看抖动断崖回落、Boost 次数飙升！',
      },
      {
        step: '第 4 步',
        title: 'AI 诊断 & 敲设备文件命令',
        desc: '点左下「分析实时轨迹」让 AI 指出内核根因并给出 C 代码修复补丁；或在右下终端直接给 /dev/pulse_scope 发指令。',
      },
    ],
    kpiAvgIpc: '平均端到端 IPC 延迟',
    kpiMax: '峰值',
    kpiP99Jitter: 'P99 唤醒抖动 (Jitter)',
    kpiDeadline: '硬实时红线：5,000 µs (5.0 ms)',
    kpiBoosts: 'QNX 内核提权次数 (PI)',
    kpiPiEnabled: '已开启：PTHREAD_PRIO_INHERIT',
    kpiPiDisabled: '已关闭：PTHREAD_PRIO_NONE',
    kpiMisses: '硬实时超时次数',
    kpiMissFoot: '超过 5,000 µs 记为超期',
    kpiMsgCount: 'MsgSend 消息 / 脉冲总数',
    kpiTimerPulses: '次硬件定时脉冲',
    topoKicker: 'QNX 8.0 微内核消息总线拓扑',
    topoTitle: '实时消息传递 (IPC) 与优先级继承关系图',
    legendIpc: '同步 MsgSend/Reply',
    legendBoost: '内核提权救援',
    legendReplyBlk: 'REPLY-BLOCKED 阻塞',
    legendInversion: '优先级反转事故',
    topoPreempts: '正在抢占 CPU!',
    topoBlocked: '已被提权压制',
    topoIdle: '空闲',
    topoBurning: '满载抢占 CPU',
    topoSleeping: '休眠中',
    topoState: '内核状态',
    topoJitter: '抖动',
    topoEffPrio: '当前有效优先级',
    topoMutexHolder: '共享互斥锁持有者',
    topoInterference: '中优先级干扰源',
    topoResmgrKicker: 'QNX 资源管理器 (内核态接口)',
    topoMsgsBoosts: (msgs, boosts) => `${msgs} 条消息 · ${boosts} 次内核提权`,
    labKicker: '微内核混沌测试与确定性实验台',
    labTitle: '实时故障注入控制台 (通过 devctl 直控 QNX)',
    scenarios: [
      {
        key: 'nominal',
        title: '1. 正常确定性基线',
        desc: '健康 20Hz 脉冲 + 亚毫秒级 3 级同步 IPC',
      },
      {
        key: 'inversion',
        title: '2. 优先级反转 (关闭 PI)',
        desc: 'P24 抢占 CPU 拖死 P15 锁，导致 P30 严重超时',
      },
      {
        key: 'rescue',
        title: '3. QNX 优先级继承救援 (开启 PI)',
        desc: '内核自动将 P15 提权至 P30，抖动瞬间恢复！',
      },
      {
        key: 'stall',
        title: '4. REPLY-BLOCKED 级联阻塞',
        desc: '执行器故意延迟 MsgReply() 35ms，观察同步反压',
      },
    ],
    toggles: {
      piTitle: '优先级继承协议 (Priority Inheritance)',
      piDesc: '切换 PTHREAD_PRIO_INHERIT（开）与 PTHREAD_PRIO_NONE（关）',
      invTitle: '互斥锁竞争 + 反转实验',
      invDesc: '在 P30 传感器与 P15 后台校准线程间开启共享锁竞争',
      stallTitle: '执行器 MsgReply() 故意卡顿',
      stallDesc: (ms) => `让上游 controller_srv 悬停在 STATE_REPLY（延迟 ${ms}ms）`,
      hogTitle: '中优先级 CPU 抢占器 (P24)',
      hogDesc: '在 CPU 0 满载空转（优先级低于 P30 但高于 P15）',
      onPi: '已开启 (PI)',
      off: '已关闭',
      active: '注入中',
      stalled: '已卡顿',
      running: '满载中',
    },
    oscKicker: '实时确定性示波器',
    oscTitle: 'ClockCycles() 硬件计时 IPC 延迟与脉冲唤醒抖动曲线',
    oscE2e: '端到端 IPC (µs)',
    oscJitter: '唤醒抖动 (µs)',
    oscBoostWin: 'PI 提权保护区间',
    oscDeadlineLine: (ms) => `硬实时截止红线 (${ms} ms)`,
    threadsKicker: '/proc/<pid>/as · DCMD_PROC_TIDSTATUS 真机实时采样',
    threadsTitle: 'QNX 8.0 实时线程调度状态表',
    thThread: '线程名',
    thPolicy: '调度策略',
    thEffPrio: '有效优先级',
    thState: 'QNX 微内核状态',
    thCpu: '核心',
    consoleKicker: 'QNX 资源管理器 POSIX 交互接口',
    consoleTitle: '/dev/pulse_scope 交互式设备文件终端',
    consoleReady: '已就绪。点击上方快捷命令或输入指令，直接对 QNX 里的 /dev/pulse_scope 执行读写。',
    consoleRun: '执行',
    copilotKicker: 'AI 微内核轨迹诊断副驾驶',
    copilotTitle: '内核根因分析与 QNX C API 修复补丁生成',
    byokActive: '已配 LLM Key',
    byokBtn: '配置自定义 LLM',
    analyzeBtn: '分析当前实时轨迹',
    analyzingBtn: '分析中...',
    byokHint:
      '无需 API Key 即可离线秒出内核诊断；如需接入大模型深度问答，可在此填入 OpenAI 兼容接口与 Key（仅存浏览器内存）：',
    rootCauseHead: '微内核根因拆解',
    evidenceHead: '采集到的 QNX 8.0 实机 API 证据',
    copyPatch: '复制 C 修复代码',
    copied: '已复制',
    engineKernel: '内核诊断引擎',
    engineLlm: 'LLM 副驾驶',
    sevLabels: { nominal: '健康正常', warning: '阻塞告警', critical: '严重反转危机' },
  },
};
