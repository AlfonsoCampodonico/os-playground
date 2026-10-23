import { PyRandom } from '../lib/pyrandom';

/**
 * Limited Direct Execution (OSTEP ch. 6), one protocol row per step, like the
 * book's Figures 6.2 (syscalls, no interrupts) and 6.3 (timer interrupt and
 * context switch). Process A runs a program the student composes; process B,
 * when needed (timer or a blocking read), is an endless compute loop.
 *
 * Numbers follow xv6, the teaching kernel: trap vectors 13 (general
 * protection), 32 (timer), 46 (disk), 64 (syscall); SYS_exit = 2,
 * SYS_read = 5, SYS_getpid = 11, SYS_write = 16, syscall number in %eax.
 */

export type OpKind = 'compute' | 'write' | 'getpid' | 'read' | 'exit' | 'priv';
export interface Op {
  kind: OpKind;
  /** Instructions, for `compute` (1..20). */
  n: number;
  /** The exit() a program reaches by returning from main. */
  implicit?: boolean;
}

export interface SyscallsConfig {
  program: Op[];
  /** Include the boot rows (trap table, timer, process creation). */
  boot: boolean;
  /** Timer interrupt every N user instructions; 0 = no timer. */
  timer: number;
  /** User instructions B runs before the disk answers a read(). */
  disk: number;
}

export type Pid = 'A' | 'B';
export const PIDS: Pid[] = ['A', 'B'];
export const PIDNUM: Record<Pid, number> = { A: 3, B: 4 };
export type Lane = 'os' | 'hw' | 'user';
export type Mode = 'user' | 'kernel';
export type Sys = 'write' | 'getpid' | 'read' | 'exit';
export type RegName = 'eip' | 'esp' | 'eax' | 'ebx';
export const REGS: RegName[] = ['eip', 'esp', 'eax', 'ebx'];
export interface Regs {
  eip: number;
  esp: number;
  eax: number;
  ebx: number;
}
export interface Ctx {
  eip: number;
  esp: number;
}
export type ProcState = 'none' | 'ready' | 'running' | 'blocked' | 'done' | 'killed';
export interface Proc {
  pid: Pid;
  state: ProcState;
  /** Trap frame on the process's kernel stack: user registers saved by the hardware. */
  frame: Regs | null;
  /** Kernel registers saved by switch() in proc_t. */
  ctx: Ctx | null;
}
export interface Cpu {
  mode: Mode;
  regs: Regs;
  /** Whose address space / kernel stack the CPU is on (null: boot or idle). */
  pid: Pid | null;
  stack: 'boot' | 'user' | 'kernel';
  /** Symbol of the code at %eip. */
  sym: string;
  /** What %eax holds right now, when it means something. */
  eaxNote: 'sysno' | 'ret' | null;
  /** Trap table base the hardware remembers (IDTR). */
  idtr: number | null;
}
export interface Counts {
  modeSwitches: number;
  toKernel: number;
  toUser: number;
  syscalls: number;
  interrupts: number;
  faults: number;
  kernelRows: number;
  userRows: number;
  hwRows: number;
  ctxSwitches: number;
}
export interface Snapshot {
  cpu: Cpu;
  procs: Record<Pid, Proc>;
  trapTable: boolean;
  timerOn: boolean;
  timerLeft: number;
  diskLeft: number | null;
  console: string;
  counts: Counts;
}

export type RowKind =
  | 'boot-trap-table'
  | 'hw-remember'
  | 'boot-timer'
  | 'hw-timer-start'
  | 'os-create'
  | 'os-rft'
  | 'hw-rft'
  | 'user-compute'
  | 'user-syscall'
  | 'user-priv'
  | 'hw-trap'
  | 'hw-irq'
  | 'hw-fault'
  | 'os-syscall'
  | 'os-read-block'
  | 'os-disk'
  | 'os-timer'
  | 'os-switch'
  | 'os-kill'
  | 'os-exit'
  | 'os-idle';

export interface Effects {
  push?: Pid;
  pop?: Pid;
  save?: Pid;
  restore?: Pid;
  modeFlip?: boolean;
  /** The kernel wrote a return value into this process's trap frame. */
  ret?: Pid;
  console?: string;
}

export interface Step extends Snapshot {
  lane: Lane;
  kind: RowKind;
  phase: 'boot' | 'run';
  /** Process the row acts for. */
  pid: Pid | null;
  /** Index of A's program op this row belongs to. */
  op: number | null;
  n?: number;
  sys?: Sys;
  sysno?: number;
  vector?: number;
  irq?: 'timer' | 'disk';
  from?: Pid;
  to?: Pid;
  saved?: boolean;
  ret?: number;
  first?: boolean;
  fx: Effects;
}

export interface SyscallsRun {
  initial: Snapshot;
  steps: Step[];
  /** The program as run (with the implicit exit, if any). */
  program: Op[];
  executed: boolean[];
  /** Index into `steps` of each op's first row. */
  firstStep: (number | null)[];
  hasB: boolean;
  figure: '6.2' | '6.3';
  truncated: boolean;
}

/* ---------- The machine ---------- */

export const SYSCALLS: { no: number; sys: Sys; fn: string }[] = [
  { no: 2, sys: 'exit', fn: 'sys_exit' },
  { no: 5, sys: 'read', fn: 'sys_read' },
  { no: 11, sys: 'getpid', fn: 'sys_getpid' },
  { no: 16, sys: 'write', fn: 'sys_write' },
];
export const SYSNO: Record<Sys, number> = { exit: 2, read: 5, getpid: 11, write: 16 };

export type TrapEvent = 'gp' | 'timer' | 'disk' | 'syscall';
export const TRAP_TABLE: { vector: number; event: TrapEvent; handler: string; addr: number }[] = [
  { vector: 13, event: 'gp', handler: 'gp_handler', addr: 0x80105f62 },
  { vector: 32, event: 'timer', handler: 'timer_handler', addr: 0x80106018 },
  { vector: 46, event: 'disk', handler: 'disk_handler', addr: 0x801060d4 },
  { vector: 64, event: 'syscall', handler: 'syscall_handler', addr: 0x8010618a },
];
export const VEC = { gp: 13, timer: 32, disk: 46, syscall: 64 } as const;
export const TRAP_BASE = 0x8010b5a0;

export const KSYM: Record<string, number> = {
  main: 0x80102eb0,
  tvinit: 0x80105a40,
  timerinit: 0x80102c10,
  userinit: 0x80103b10,
  trapret: 0x80105c3a,
  sys_exit: 0x80104b30,
  sys_read: 0x80104e20,
  sys_getpid: 0x80104cd0,
  sys_write: 0x80104f60,
  switch: 0x80104a6b,
  sched: 0x80103f2c,
  scheduler: 0x80103d80,
  gp_handler: 0x80105f62,
  timer_handler: 0x80106018,
  disk_handler: 0x801060d4,
  syscall_handler: 0x8010618a,
};

export const USER_BASE = 0x1000;
export const USTACK: Record<Pid, number> = { A: 0x2fd4, B: 0x2fb8 };
export const KSTACK_TOP: Record<Pid, number> = { A: 0x8dfff000, B: 0x8dffd000 };
const BOOT_STACK = 0x8010a5c0;
/** Size of the trap frame and of what switch() pushes, in bytes. */
const FRAME = 0x4c;
const CTX = 0x6c;
const READ_BYTES = 512;
const WRITE_TEXT = 'hola\n';
const MAX_STEPS = 600;

export function userSym(pid: Pid, eip: number): string {
  const fn = pid === 'A' ? 'main' : 'loop';
  const off = eip - USER_BASE;
  return off === 0 ? fn : `${fn}+0x${off.toString(16)}`;
}

export function hex(n: number, digits = 0): string {
  return '0x' + n.toString(16).padStart(digits, '0');
}

/** Appends exit() when the program can return from main; caps the length. */
export function withExit(program: Op[]): Op[] {
  const ops = program.slice(0, MAX_OPS).map((o) => ({ ...o }));
  if (!ops.some((o) => o.kind === 'exit')) ops.push({ kind: 'exit', n: 0, implicit: true });
  return ops;
}

class Stop extends Error {}

function emptyCounts(): Counts {
  return { modeSwitches: 0, toKernel: 0, toUser: 0, syscalls: 0, interrupts: 0, faults: 0, kernelRows: 0, userRows: 0, hwRows: 0, ctxSwitches: 0 };
}

function cloneSnap(s: Snapshot): Snapshot {
  const p = (x: Proc): Proc => ({ ...x, frame: x.frame && { ...x.frame }, ctx: x.ctx && { ...x.ctx } });
  return { ...s, cpu: { ...s.cpu, regs: { ...s.cpu.regs } }, procs: { A: p(s.procs.A), B: p(s.procs.B) }, counts: { ...s.counts } };
}

function initialState(boot: boolean, hasB: boolean, T: number): Snapshot {
  const none = (pid: Pid): Proc => ({ pid, state: 'none', frame: null, ctx: null });
  if (boot) {
    return {
      cpu: { mode: 'kernel', regs: { eip: KSYM.main, esp: BOOT_STACK, eax: 0, ebx: 0 }, pid: null, stack: 'boot', sym: 'main', eaxNote: null, idtr: null },
      procs: { A: none('A'), B: none('B') },
      trapTable: false,
      timerOn: false,
      timerLeft: 0,
      diskLeft: null,
      console: '',
      counts: emptyCounts(),
    };
  }
  return {
    cpu: { mode: 'user', regs: { eip: USER_BASE, esp: USTACK.A, eax: 0, ebx: 0 }, pid: 'A', stack: 'user', sym: 'main', eaxNote: null, idtr: TRAP_BASE },
    procs: {
      A: { pid: 'A', state: 'running', frame: null, ctx: null },
      // B was preempted earlier: user registers on its kernel stack, kernel registers in proc_t(B).
      B: hasB
        ? { pid: 'B', state: 'ready', frame: { eip: USER_BASE + 8, esp: USTACK.B, eax: 0, ebx: 40 }, ctx: { eip: KSYM.sched, esp: KSTACK_TOP.B - CTX } }
        : none('B'),
    },
    trapTable: true,
    timerOn: T > 0,
    timerLeft: T,
    diskLeft: null,
    console: '',
    counts: emptyCounts(),
  };
}

export const MAX_OPS = 12;
export const MAX_COMPUTE = 20;

export function simulateSyscalls(cfg: SyscallsConfig): SyscallsRun {
  const T = Math.max(0, Math.floor(cfg.timer) || 0);
  const D = Math.max(1, Math.floor(cfg.disk) || 1);
  const program = withExit(cfg.program);
  const hasB = T > 0 || program.some((o) => o.kind === 'read');
  const steps: Step[] = [];
  const executed = program.map(() => false);
  const firstStep: (number | null)[] = program.map(() => null);
  const st = initialState(cfg.boot, hasB, T);
  const initial = cloneSnap(st);
  let phase: 'boot' | 'run' = cfg.boot ? 'boot' : 'run';
  let curOp: number | null = null;
  let ended = false;
  let truncated = false;
  let bCount = 2;
  const opOf = (pid: Pid | null) => (pid === 'A' ? curOp : null);

  type Row = Omit<Step, keyof Snapshot | 'phase' | 'fx' | 'op'> & { fx?: Effects; op?: number | null };
  const emit = (row: Row) => {
    if (steps.length >= MAX_STEPS) throw new Stop();
    if (row.lane === 'os') st.counts.kernelRows++;
    else if (row.lane === 'user') st.counts.userRows++;
    else st.counts.hwRows++;
    steps.push({ ...cloneSnap(st), phase, ...row, op: row.op === undefined ? opOf(row.pid) : row.op, fx: row.fx ?? {} });
  };

  const kernelAt = (sym: string, pid: Pid | null, depth = 0x20) => {
    st.cpu.regs.eip = KSYM[sym];
    st.cpu.sym = sym;
    if (pid) st.cpu.regs.esp = KSTACK_TOP[pid] - FRAME - depth;
  };

  const trapIn = (p: Pid, kind: 'hw-trap' | 'hw-irq' | 'hw-fault', vector: number, extra: Partial<Row> = {}) => {
    const r = st.cpu.regs;
    // A trap saves the PC after the trap instruction; a fault, the faulting one;
    // an interrupt arrives between instructions, so %eip already points to the next.
    st.procs[p].frame = { ...r, eip: kind === 'hw-trap' ? r.eip + 4 : r.eip };
    const entry = TRAP_TABLE.find((e) => e.vector === vector)!;
    st.cpu.mode = 'kernel';
    st.cpu.stack = 'kernel';
    st.cpu.regs = { ...r, eip: entry.addr, esp: KSTACK_TOP[p] - FRAME };
    st.cpu.sym = entry.handler;
    st.counts.modeSwitches++;
    st.counts.toKernel++;
    if (kind === 'hw-irq') st.counts.interrupts++;
    if (kind === 'hw-fault') st.counts.faults++;
    emit({ lane: 'hw', kind, pid: p, vector, fx: { push: p, modeFlip: true }, ...extra });
  };

  const rft = (p: Pid, opts: { first?: boolean; op?: number | null } = {}) => {
    st.cpu.pid = p;
    st.cpu.stack = 'kernel';
    kernelAt('trapret', p, 0);
    emit({ lane: 'os', kind: 'os-rft', pid: p, first: opts.first, op: opts.op });
    const f = st.procs[p].frame!;
    const wasRet = st.cpu.eaxNote === 'ret';
    st.procs[p].frame = null;
    st.procs[p].state = 'running';
    st.cpu = { ...st.cpu, mode: 'user', stack: 'user', regs: { ...f }, pid: p, sym: userSym(p, f.eip), eaxNote: wasRet ? 'ret' : null };
    st.counts.modeSwitches++;
    st.counts.toUser++;
    emit({ lane: 'hw', kind: 'hw-rft', pid: p, first: opts.first, op: opts.op, fx: { pop: p, modeFlip: true } });
  };

  const switchTo = (from: Pid, to: Pid, save: boolean, op?: number | null) => {
    if (save) st.procs[from].ctx = { eip: KSYM.sched, esp: KSTACK_TOP[from] - CTX };
    const c = st.procs[to].ctx!;
    st.procs[to].ctx = null;
    st.procs[to].state = 'running';
    st.cpu.pid = to;
    st.cpu.regs.eip = KSYM.switch;
    st.cpu.regs.esp = c.esp;
    st.cpu.sym = 'switch';
    st.counts.ctxSwitches++;
    // Each process the scheduler picks gets a full quantum.
    if (st.timerOn) st.timerLeft = T;
    emit({ lane: 'os', kind: 'os-switch', pid: to, from, to, saved: save, op: op === undefined ? opOf(from) : op, fx: { save: save ? from : undefined, restore: to } });
  };

  const userRun = (p: Pid, n: number) => {
    st.cpu.regs.eip += 4 * n;
    st.cpu.regs.ebx += p === 'A' ? n : 2 * n;
    if (p === 'B') {
      bCount += n;
      st.cpu.regs.eip = USER_BASE + 4 * (bCount % 6);
    }
    st.cpu.sym = userSym(p, st.cpu.regs.eip);
    st.cpu.eaxNote = null;
    if (st.timerOn) st.timerLeft -= n;
    if (st.diskLeft !== null && p === 'B') st.diskLeft -= n;
    emit({ lane: 'user', kind: 'user-compute', pid: p, n });
  };

  /** Timer fired while `p` was in user mode. */
  const timerTick = (p: Pid) => {
    trapIn(p, 'hw-irq', VEC.timer, { irq: 'timer' });
    st.timerLeft = T;
    const other: Pid = p === 'A' ? 'B' : 'A';
    const can = hasB && st.procs[other].state === 'ready';
    st.procs[p].state = can ? 'ready' : 'running';
    kernelAt('timer_handler', p);
    emit({ lane: 'os', kind: 'os-timer', pid: p, to: can ? other : undefined });
    if (can) {
      switchTo(p, other, true);
      rft(other);
      if (other === 'B') runB();
    } else rft(p);
  };

  /** B computes until the timer or the disk takes the CPU back (and A is on it again). */
  const runB = () => {
    while (!ended && st.cpu.pid === 'B' && st.cpu.mode === 'user') {
      const limits = [st.timerOn ? st.timerLeft : Infinity, st.diskLeft ?? Infinity];
      const chunk = Math.min(...limits);
      if (!Number.isFinite(chunk)) return;
      if (chunk > 0) userRun('B', chunk);
      if (st.diskLeft !== null && st.diskLeft <= 0) diskIrq();
      else if (st.timerOn && st.timerLeft <= 0) timerTick('B');
    }
  };

  const diskIrq = () => {
    const readOp = curOp;
    trapIn('B', 'hw-irq', VEC.disk, { irq: 'disk', op: readOp });
    st.diskLeft = null;
    st.procs.B.state = 'ready';
    st.procs.A.state = 'ready';
    st.procs.A.frame!.eax = READ_BYTES;
    kernelAt('disk_handler', 'B');
    emit({ lane: 'os', kind: 'os-disk', pid: 'A', ret: READ_BYTES, op: readOp, fx: { ret: 'A' } });
    switchTo('B', 'A', true, readOp);
    st.cpu.eaxNote = 'ret';
    rft('A', { op: readOp });
  };

  /** A is gone: run B if there is one, or idle. */
  const finish = () => {
    if (hasB && st.procs.B.state === 'ready') {
      switchTo('A', 'B', false);
      rft('B', { op: null });
    } else {
      st.cpu.pid = null;
      st.cpu.stack = 'boot';
      kernelAt('scheduler', null);
      st.cpu.regs.esp = BOOT_STACK;
      emit({ lane: 'os', kind: 'os-idle', pid: null });
    }
    ended = true;
  };

  const syscall = (sys: Sys) => {
    const no = SYSNO[sys];
    st.cpu.regs.eax = no;
    st.cpu.regs.eip += 4; // past `mov $no, %eax`; now at `int $64`
    st.cpu.sym = userSym('A', st.cpu.regs.eip);
    st.cpu.eaxNote = 'sysno';
    st.counts.syscalls++;
    emit({ lane: 'user', kind: 'user-syscall', pid: 'A', sys, sysno: no });
    trapIn('A', 'hw-trap', VEC.syscall, { sys, sysno: no });
    const fn = SYSCALLS.find((s) => s.sys === sys)!.fn;
    kernelAt(fn, 'A');
    const A = st.procs.A;
    if (sys === 'write' || sys === 'getpid') {
      const ret = sys === 'write' ? WRITE_TEXT.length : PIDNUM.A;
      A.frame!.eax = ret;
      if (sys === 'write') st.console += WRITE_TEXT;
      emit({ lane: 'os', kind: 'os-syscall', pid: 'A', sys, sysno: no, ret, fx: { ret: 'A', console: sys === 'write' ? WRITE_TEXT : undefined } });
      st.cpu.eaxNote = 'ret';
      rft('A');
    } else if (sys === 'read') {
      A.state = 'blocked';
      st.diskLeft = D;
      emit({ lane: 'os', kind: 'os-read-block', pid: 'A', sys, sysno: no });
      switchTo('A', 'B', true);
      rft('B');
      runB();
    } else {
      A.state = 'done';
      A.frame = null;
      emit({ lane: 'os', kind: 'os-exit', pid: 'A', sys, sysno: no });
      finish();
    }
  };

  try {
    if (cfg.boot) {
      kernelAt('tvinit', null);
      st.trapTable = true;
      emit({ lane: 'os', kind: 'boot-trap-table', pid: null });
      st.cpu.idtr = TRAP_BASE;
      emit({ lane: 'hw', kind: 'hw-remember', pid: null });
      if (T > 0) {
        kernelAt('timerinit', null);
        emit({ lane: 'os', kind: 'boot-timer', pid: null });
        st.timerOn = true;
        st.timerLeft = T;
        emit({ lane: 'hw', kind: 'hw-timer-start', pid: null, n: T });
      }
      phase = 'run';
      kernelAt('userinit', null);
      st.procs.A = { pid: 'A', state: 'ready', frame: { eip: USER_BASE, esp: USTACK.A, eax: 0, ebx: 0 }, ctx: null };
      emit({ lane: 'os', kind: 'os-create', pid: 'A', op: null, fx: { push: 'A' } });
      if (hasB) {
        st.procs.B = { pid: 'B', state: 'ready', frame: { eip: USER_BASE, esp: USTACK.B, eax: 0, ebx: 0 }, ctx: { eip: KSYM.trapret, esp: KSTACK_TOP.B - FRAME } };
        bCount = 0;
        emit({ lane: 'os', kind: 'os-create', pid: 'B', op: null, fx: { push: 'B' } });
      }
      rft('A', { first: true, op: null });
    }

    for (let i = 0; i < program.length && !ended; i++) {
      curOp = i;
      executed[i] = true;
      firstStep[i] = steps.length;
      const op = program[i];
      if (op.kind === 'compute') {
        let left = Math.max(1, Math.min(MAX_COMPUTE, Math.floor(op.n) || 1));
        while (left > 0 && !ended) {
          const chunk = st.timerOn ? Math.min(left, st.timerLeft) : left;
          userRun('A', chunk);
          left -= chunk;
          if (st.timerOn && st.timerLeft <= 0) timerTick('A');
        }
      } else if (op.kind === 'priv') {
        emit({ lane: 'user', kind: 'user-priv', pid: 'A' });
        trapIn('A', 'hw-fault', VEC.gp);
        kernelAt('gp_handler', 'A');
        st.procs.A.state = 'killed';
        st.procs.A.frame = null;
        emit({ lane: 'os', kind: 'os-kill', pid: 'A' });
        finish();
      } else {
        syscall(op.kind);
      }
    }
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    truncated = true;
  }

  return { initial, steps, program, executed, firstStep, hasB, figure: T > 0 ? '6.3' : '6.2', truncated };
}

/* ---------- Program text (for the URL) ---------- */

const CODE: Record<Exclude<OpKind, 'compute'>, string> = { write: 'w', getpid: 'g', read: 'r', exit: 'x', priv: 'p' };
const FROM_CODE: Record<string, OpKind> = { w: 'write', g: 'getpid', r: 'read', x: 'exit', p: 'priv' };

/** "c2 w g x" → compute 2, write, getpid, exit. Unknown tokens are dropped. */
export function parseProgram(text: string): Op[] {
  const ops: Op[] = [];
  for (const tok of text.toLowerCase().split(/[\s,;]+/).filter(Boolean)) {
    const m = /^c(\d+)$/.exec(tok);
    if (m) ops.push({ kind: 'compute', n: Math.max(1, Math.min(MAX_COMPUTE, Number(m[1]))) });
    else if (FROM_CODE[tok]) ops.push({ kind: FROM_CODE[tok], n: 0 });
  }
  return ops.slice(0, MAX_OPS);
}

export function encodeProgram(ops: Op[]): string {
  return ops
    .filter((o) => !o.implicit)
    .map((o) => (o.kind === 'compute' ? `c${o.n}` : CODE[o.kind]))
    .join(' ');
}

export interface Setup {
  prog: string;
  boot: boolean;
  timer: number;
  disk: number;
}

export const PRESETS = {
  write: { prog: 'c2 w x', boot: false, timer: 0, disk: 3 },
  getpid: { prog: 'c1 g c1 g x', boot: false, timer: 0, disk: 3 },
  boot: { prog: 'c2 w x', boot: true, timer: 0, disk: 3 },
  timer: { prog: 'c5 x', boot: true, timer: 3, disk: 3 },
  priv: { prog: 'c2 p c1 x', boot: false, timer: 0, disk: 3 },
  read: { prog: 'c1 r c1 w x', boot: false, timer: 0, disk: 3 },
} as const satisfies Record<string, Setup>;
export type PresetId = keyof typeof PRESETS;

/** A short random program for the "random problem" button. */
export function randomProblem(seed: number): Setup {
  const r = new PyRandom(seed);
  const kinds = ['compute', 'compute', 'compute', 'write', 'getpid', 'write', 'read', 'priv'] as const;
  const ops: Op[] = [];
  const len = r.randint(3, 6);
  for (let i = 0; i < len; i++) {
    const kind = r.choice(kinds);
    ops.push({ kind, n: kind === 'compute' ? r.randint(1, 5) : 0 });
  }
  if (r.random() < 0.7) ops.push({ kind: 'exit', n: 0 });
  const timer = r.choice([0, 0, 2, 3, 4]);
  const boot = r.random() < 0.3;
  const disk = r.randint(2, 4);
  return { prog: encodeProgram(ops), boot, timer, disk };
}
