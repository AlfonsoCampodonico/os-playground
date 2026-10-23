/**
 * Trap-and-emulate virtualization, following OSTEP Appendix B (Virtual
 * Machine Monitors). There is no homework simulator for this appendix: each
 * scenario is a protocol, the same "who does what, in which order" tables the
 * appendix draws, run twice — on a bare machine and under a VMM — so the
 * extra traps and mode changes can be counted side by side.
 *
 * The VMM column comes in four flavours: classic trap-and-emulate (the
 * appendix), hardware assisted (VT-x / AMD-V, with EPT/NPT for memory),
 * paravirtualized (the guest calls the VMM with hypercalls) and both at once.
 */
import { PyRandom } from '../lib/pyrandom';

export const SCENARIOS = ['syscall', 'boot', 'cli', 'timer', 'tlb', 'shadow', 'idle'] as const;
export type Scenario = (typeof SCENARIOS)[number];

/** te = trap-and-emulate, hw = VT-x/AMD-V, pv = paravirtualization, pvh = both. */
export type Mode = 'te' | 'hw' | 'pv' | 'pvh';

export function modeOf(assist: boolean, paravirt: boolean): Mode {
  return assist ? (paravirt ? 'pvh' : 'hw') : paravirt ? 'pv' : 'te';
}

/** Layers of the virtualized machine (top to bottom) and of the bare one. */
export type VLayer = 'app' | 'guest' | 'vmm' | 'hw';
export type NLayer = 'app' | 'os' | 'hw';
export const V_LAYERS: VLayer[] = ['app', 'guest', 'vmm', 'hw'];
export const N_LAYERS: NLayer[] = ['app', 'os', 'hw'];

/**
 * Real CPU privilege. `root` / `nonroot-*` only exist with hardware assist:
 * the VMM runs in VMX root mode, the guest in non-root mode, where ring 0 is
 * real ring 0 but every sensitive operation can be configured to exit.
 */
export type Priv = 'user' | 'kernel' | 'root' | 'nonroot-kernel' | 'nonroot-user';
/** What the running guest code believes about its own privilege. `aware`: a paravirtualized guest knows it is not in charge. */
export type Belief = 'user' | 'kernel' | 'aware';
/** How control reached the actor of a step (drawn on the token). */
export type Via = 'trap' | 'reflect' | 'return' | 'hypercall' | 'exit' | 'entry' | 'interrupt';
export type StepTone = 'neutral' | 'ok' | 'bad' | 'warn' | 'info';

/** The example address of the TLB scenarios: VA → guest "physical" → machine. */
export const ADDR = { va: 0x4010, vpn: 0x4, offset: 0x010, pfn: 0xa, mfn: 0x19 } as const;
export const PAGE = 0x1000;

/** Guest trap handlers, as the guest OS installs them at boot. */
export const GUEST_HANDLERS = [
  { trap: 'syscall', addr: 0xc0001000 },
  { trap: 'tlb', addr: 0xc0002000 },
  { trap: 'timer', addr: 0xc0003000 },
] as const;

export const MSGS = [
  // shared
  'app.exec', 'app.resume', 'nat.hw.toKernel', 'nat.hw.toUser', 'nat.os.rti', 'guest.rti', 'vmm.rti', 'guest.hyperIret', 'vmm.hyperIret',
  // syscall
  'sys.app.trap', 'nat.sys.handler', 'sys.vmm.reflect', 'sys.guest.handler', 'sys.hw.direct', 'sys.guest.rtiHw', 'sys.hw.return',
  // boot
  'nat.boot.start', 'nat.boot.lidt', 'nat.boot.hwSaves', 'boot.cont', 'boot.vmm.own', 'boot.guest.start', 'boot.guest.lidt', 'boot.vmm.record',
  'boot.guest.hyper', 'boot.vmm.hyper', 'boot.vmm.vmcs', 'boot.guest.startHw', 'boot.guest.lidtHw', 'boot.hw.vmcs',
  // cli
  'cli.enter', 'cli.crit', 'cli.after', 'nat.cli.cli', 'nat.cli.sti', 'cli.guest.cli', 'cli.vmm.cli', 'cli.guest.sti',
  'cli.vmm.sti', 'cli.pv.mask', 'cli.pv.unmask', 'cli.hw.cli', 'cli.hw.sti',
  // timer
  'tmr.nat.runA', 'tmr.nat.irq', 'tmr.nat.switch', 'tmr.nat.runB', 'tmr.app1', 'tmr.vmm.irq', 'tmr.vmm.save', 'tmr.vmm.restore', 'tmr.app2', 'tmr.hw.exit',
  'tmr.hw.switch',
  // tlb (software-managed TLB, as in the appendix)
  'tlb.app.miss', 'tlb.nat.handler', 'tlb.app.hit', 'tlb.app.missHw', 'tlb.nat.walk', 'tlb.vmm.reflect', 'tlb.guest.lookup', 'tlb.guest.write',
  'tlb.vmm.install', 'tlb.pv.lookup', 'tlb.pv.hyper', 'tlb.pv.install', 'tlb.hw.walkGuest', 'tlb.hw.walkNested',
  // shadow page tables (hardware-managed TLB)
  'shd.hw.walkShadow', 'shd.vmm.hidden', 'shd.vmm.fill', 'shd.hw.rewalk', 'shd.pv.walk',
  // idle
  'idle.none', 'idle.nat.spin', 'idle.nat.irq', 'idle.nat.wake', 'idle.guest.spin', 'idle.vmm.timer', 'idle.vmm.switch', 'idle.app2', 'idle.hw.timer',
  'idle.hw.switch', 'idle.pv.block', 'idle.pv.switch',
] as const;
export type MsgId = (typeof MSGS)[number];

export interface Counters {
  /** Traps (or VM exits) into the VMM — or into the OS, in the bare-machine column. */
  traps: number;
  hypercalls: number;
  /** Real CPU privilege changes. */
  modeSwitches: number;
  /** Privileged instructions the VMM had to decode and emulate in software. */
  emulated: number;
  /** Idle-loop iterations burned while another VM had work. */
  wasted: number;
  /** Rough time units: 1 per step, +1 per mode change, +2 per emulated instruction, + saving/restoring state. */
  cost: number;
}

export interface VmmView {
  /** Where the real hardware's trap table points. */
  hwTable: 'none' | 'vmm' | 'os' | 'vmcs';
  /** What the VMM knows about the guest's own trap handlers. */
  guestTable: 'none' | 'vmm' | 'hyper' | 'vmcs';
  /** Guest's *virtual* privilege mode, as the VMM tracks it. */
  vMode: 'kernel' | 'user';
  /** Guest's virtual interrupt flag (interrupts enabled?). */
  vIF: boolean;
  vms: { id: 1 | 2; state: 'run' | 'saved' | 'ready' }[];
  /** Which piece of state the current step reads or writes, for highlighting. */
  used: 'guestTable' | 'vIF' | 'pmap' | 'vms' | 'shadow' | 'hwTable' | null;
}

export interface Xlate {
  /** 0: nothing translated yet, 1: VA → PFN (guest page table), 2: PFN → MFN (VMM's map). */
  hop: 0 | 1 | 2;
  /** What the real TLB holds for the VPN. */
  tlb: null | { frame: number; kind: 'pfn' | 'mfn' };
  shadow: 'none' | 'missing' | 'filled';
  /** Paravirtualized "direct paging": the guest page table already holds machine frames. */
  direct: boolean;
  /** Hardware nested paging (EPT/NPT): the MMU walks both tables itself. */
  nested: boolean;
}

export interface MachineState<L extends string> {
  actor: L;
  vm: 1 | 2;
  real: Priv;
  believes: Belief | null;
  counters: Counters;
  vmm: VmmView;
  xlate: Xlate | null;
}

export interface Step<L extends string> extends MachineState<L> {
  n: number;
  msg: MsgId;
  /** Row group shared by both columns, so the bare machine can be shown "at the same point". */
  phase: number;
  via?: Via;
  entry?: 'trap' | 'hyper';
  emu: boolean;
  waste: boolean;
  modeSwitch: boolean;
  cost: number;
  tone: StepTone;
}

export interface Trace<L extends string> {
  initial: MachineState<L>;
  steps: Step<L>[];
}

export interface VirtConfig {
  scenario: Scenario;
  assist: boolean;
  paravirt: boolean;
  /** Idle-loop iterations before the timer fires (idle scenario). */
  spins: number;
}

export interface VirtRun {
  scenario: Scenario;
  mode: Mode;
  virt: Trace<VLayer>;
  native: Trace<NLayer>;
  /** Index into `native` (0 = initial) to show while the VMM column is at `virtIndex`. */
  nativeIndex: (virtIndex: number) => number;
  multiVm: boolean;
  hasXlate: boolean;
}

interface Op<L extends string> {
  a: L;
  m: MsgId;
  p: number;
  via?: Via;
  entry?: 'trap' | 'hyper';
  emu?: boolean;
  waste?: boolean;
  extra?: number;
  real?: Priv;
  vm?: 1 | 2;
  tone?: StepTone;
  set?: Partial<VmmView>;
  x?: Partial<Xlate>;
}

const ZERO: Counters = { traps: 0, hypercalls: 0, modeSwitches: 0, emulated: 0, wasted: 0, cost: 0 };

function build<L extends string>(
  ops: Op<L>[],
  privOf: (a: L) => Priv,
  believeOf: (a: L) => Belief | null,
  vmm: VmmView,
  xlate: Xlate | null,
): Trace<L> {
  const first = ops[0];
  const initial: MachineState<L> = {
    actor: first.a,
    vm: first.vm ?? 1,
    real: first.real ?? privOf(first.a),
    believes: believeOf(first.a),
    counters: { ...ZERO },
    vmm,
    xlate,
  };
  let prev: MachineState<L> = initial;
  const steps = ops.map((op, k): Step<L> => {
    const real = op.real ?? (op.a === 'hw' ? prev.real : privOf(op.a));
    const modeSwitch = k > 0 && real !== prev.real;
    const emu = !!op.emu;
    const waste = !!op.waste;
    const cost = 1 + (modeSwitch ? 1 : 0) + (emu ? 2 : 0) + (op.extra ?? 0);
    const c = prev.counters;
    const counters: Counters = {
      traps: c.traps + (op.entry === 'trap' ? 1 : 0),
      hypercalls: c.hypercalls + (op.entry === 'hyper' ? 1 : 0),
      modeSwitches: c.modeSwitches + (modeSwitch ? 1 : 0),
      emulated: c.emulated + (emu ? 1 : 0),
      wasted: c.wasted + (waste ? 1 : 0),
      cost: c.cost + cost,
    };
    const vMode = op.a === 'app' ? 'user' : op.a === 'guest' || op.a === 'os' ? 'kernel' : prev.vmm.vMode;
    const nextVmm: VmmView = { ...prev.vmm, vMode, used: null, ...op.set };
    const nextX = prev.xlate && op.x ? { ...prev.xlate, ...op.x } : prev.xlate;
    const tone: StepTone =
      op.tone ??
      (waste ? 'bad' : emu ? 'info' : op.entry === 'hyper' ? 'info' : op.entry === 'trap' ? 'warn' : op.via === 'return' || op.via === 'entry' ? 'ok' : 'neutral');
    const st: Step<L> = {
      n: k + 1,
      actor: op.a,
      vm: op.vm ?? prev.vm,
      real,
      believes: op.a === 'hw' ? null : believeOf(op.a),
      counters,
      vmm: nextVmm,
      xlate: nextX,
      msg: op.m,
      phase: op.p,
      via: op.via,
      entry: op.entry,
      emu,
      waste,
      modeSwitch,
      cost,
      tone,
    };
    prev = st;
    return st;
  });
  return { initial, steps };
}

const isHw = (m: Mode) => m === 'hw' || m === 'pvh';
const isPv = (m: Mode) => m === 'pv' || m === 'pvh';

/* ---------------- scenarios: the VMM column ---------------- */

type VOps = Op<VLayer>[];

function virtOps(sc: Scenario, mode: Mode, spins: number): VOps {
  const hw = isHw(mode);
  switch (sc) {
    case 'syscall':
      if (hw)
        return [
          { a: 'app', m: 'app.exec', p: 0 },
          { a: 'app', m: 'sys.app.trap', p: 1 },
          { a: 'hw', m: 'sys.hw.direct', p: 1, via: 'trap', real: 'nonroot-kernel', set: { used: 'guestTable' } },
          { a: 'guest', m: 'sys.guest.handler', p: 2 },
          { a: 'guest', m: 'sys.guest.rtiHw', p: 3 },
          { a: 'hw', m: 'sys.hw.return', p: 3, real: 'nonroot-user' },
          { a: 'app', m: 'app.resume', p: 4, via: 'return' },
        ];
      return [
        { a: 'app', m: 'app.exec', p: 0 },
        { a: 'app', m: 'sys.app.trap', p: 1 },
        { a: 'vmm', m: 'sys.vmm.reflect', p: 1, via: 'trap', entry: 'trap', set: { used: 'guestTable' } },
        { a: 'guest', m: 'sys.guest.handler', p: 2, via: 'reflect' },
        mode === 'pv' ? { a: 'guest', m: 'guest.hyperIret', p: 3 } : { a: 'guest', m: 'guest.rti', p: 3 },
        mode === 'pv'
          ? { a: 'vmm', m: 'vmm.hyperIret', p: 3, via: 'hypercall', entry: 'hyper' }
          : { a: 'vmm', m: 'vmm.rti', p: 3, via: 'trap', entry: 'trap', emu: true },
        { a: 'app', m: 'app.resume', p: 4, via: 'return' },
      ];

    case 'boot':
      if (hw)
        return [
          { a: 'vmm', m: 'boot.vmm.vmcs', p: 0, set: { hwTable: 'vmcs', used: 'hwTable' } },
          { a: 'guest', m: 'boot.guest.startHw', p: 0, via: 'entry' },
          { a: 'guest', m: 'boot.guest.lidtHw', p: 1 },
          { a: 'hw', m: 'boot.hw.vmcs', p: 1, set: { guestTable: 'vmcs', used: 'guestTable' } },
          { a: 'guest', m: 'boot.cont', p: 2 },
        ];
      return [
        { a: 'vmm', m: 'boot.vmm.own', p: 0, set: { hwTable: 'vmm', used: 'hwTable' } },
        { a: 'guest', m: 'boot.guest.start', p: 0, via: 'reflect' },
        mode === 'pv' ? { a: 'guest', m: 'boot.guest.hyper', p: 1 } : { a: 'guest', m: 'boot.guest.lidt', p: 1 },
        mode === 'pv'
          ? { a: 'vmm', m: 'boot.vmm.hyper', p: 1, via: 'hypercall', entry: 'hyper', set: { guestTable: 'hyper', used: 'guestTable' } }
          : { a: 'vmm', m: 'boot.vmm.record', p: 1, via: 'trap', entry: 'trap', emu: true, set: { guestTable: 'vmm', used: 'guestTable' } },
        { a: 'guest', m: 'boot.cont', p: 2, via: 'return' },
      ];

    case 'cli':
      if (mode === 'pv')
        return [
          { a: 'guest', m: 'cli.enter', p: 0 },
          { a: 'guest', m: 'cli.pv.mask', p: 1, set: { vIF: false, used: 'vIF' } },
          { a: 'guest', m: 'cli.crit', p: 2 },
          { a: 'guest', m: 'cli.pv.unmask', p: 3, set: { vIF: true, used: 'vIF' } },
          { a: 'guest', m: 'cli.after', p: 4 },
        ];
      if (hw)
        return [
          { a: 'guest', m: 'cli.enter', p: 0 },
          { a: 'guest', m: 'cli.hw.cli', p: 1, set: { vIF: false, used: 'vIF' } },
          { a: 'guest', m: 'cli.crit', p: 2 },
          { a: 'guest', m: 'cli.hw.sti', p: 3, set: { vIF: true, used: 'vIF' } },
          { a: 'guest', m: 'cli.after', p: 4 },
        ];
      return [
        { a: 'guest', m: 'cli.enter', p: 0 },
        { a: 'guest', m: 'cli.guest.cli', p: 1 },
        { a: 'vmm', m: 'cli.vmm.cli', p: 1, via: 'trap', entry: 'trap', emu: true, set: { vIF: false, used: 'vIF' } },
        { a: 'guest', m: 'cli.crit', p: 2, via: 'return' },
        { a: 'guest', m: 'cli.guest.sti', p: 3 },
        { a: 'vmm', m: 'cli.vmm.sti', p: 3, via: 'trap', entry: 'trap', emu: true, set: { vIF: true, used: 'vIF' } },
        { a: 'guest', m: 'cli.after', p: 4, via: 'return' },
      ];

    case 'timer': {
      const after = { vms: [{ id: 1, state: 'saved' }, { id: 2, state: 'run' }] as VmmView['vms'], used: 'vms' as const };
      if (hw)
        return [
          { a: 'app', m: 'tmr.app1', p: 0, vm: 1 },
          { a: 'vmm', m: 'tmr.hw.exit', p: 1, via: 'exit', entry: 'trap' },
          { a: 'vmm', m: 'tmr.hw.switch', p: 2, extra: 4, set: after },
          { a: 'app', m: 'tmr.app2', p: 4, vm: 2, via: 'entry' },
        ];
      return [
        { a: 'app', m: 'tmr.app1', p: 0, vm: 1 },
        { a: 'vmm', m: 'tmr.vmm.irq', p: 1, via: 'interrupt', entry: 'trap' },
        { a: 'vmm', m: 'tmr.vmm.save', p: 2, extra: 2, set: { vms: [{ id: 1, state: 'saved' }, { id: 2, state: 'ready' }], used: 'vms' } },
        { a: 'vmm', m: 'tmr.vmm.restore', p: 2, extra: 2, vm: 2, set: after },
        { a: 'app', m: 'tmr.app2', p: 4, vm: 2, via: 'return' },
      ];
    }

    case 'tlb':
      if (hw)
        return [
          { a: 'app', m: 'tlb.app.missHw', p: 0 },
          { a: 'hw', m: 'tlb.hw.walkGuest', p: 2, x: { hop: 1 } },
          { a: 'hw', m: 'tlb.hw.walkNested', p: 2, extra: 1, x: { hop: 2, tlb: { frame: ADDR.mfn, kind: 'mfn' } } },
          { a: 'app', m: 'tlb.app.hit', p: 4, tone: 'ok' },
        ];
      if (mode === 'pv')
        return [
          { a: 'app', m: 'tlb.app.miss', p: 0 },
          { a: 'vmm', m: 'tlb.vmm.reflect', p: 1, via: 'trap', entry: 'trap' },
          { a: 'guest', m: 'tlb.pv.lookup', p: 2, via: 'reflect', x: { hop: 2 } },
          { a: 'guest', m: 'tlb.pv.hyper', p: 2 },
          { a: 'vmm', m: 'tlb.pv.install', p: 2, via: 'hypercall', entry: 'hyper', set: { used: 'pmap' }, x: { tlb: { frame: ADDR.mfn, kind: 'mfn' } } },
          { a: 'guest', m: 'guest.hyperIret', p: 3, via: 'return' },
          { a: 'vmm', m: 'vmm.hyperIret', p: 3, via: 'hypercall', entry: 'hyper' },
          { a: 'app', m: 'tlb.app.hit', p: 4, via: 'return', tone: 'ok' },
        ];
      return [
        { a: 'app', m: 'tlb.app.miss', p: 0 },
        { a: 'vmm', m: 'tlb.vmm.reflect', p: 1, via: 'trap', entry: 'trap' },
        { a: 'guest', m: 'tlb.guest.lookup', p: 2, via: 'reflect', x: { hop: 1 } },
        { a: 'guest', m: 'tlb.guest.write', p: 2 },
        { a: 'vmm', m: 'tlb.vmm.install', p: 2, via: 'trap', entry: 'trap', emu: true, set: { used: 'pmap' }, x: { hop: 2, tlb: { frame: ADDR.mfn, kind: 'mfn' } } },
        { a: 'guest', m: 'guest.rti', p: 3, via: 'return' },
        { a: 'vmm', m: 'vmm.rti', p: 3, via: 'trap', entry: 'trap', emu: true },
        { a: 'app', m: 'tlb.app.hit', p: 4, via: 'return', tone: 'ok' },
      ];

    case 'shadow':
      if (hw) return virtOps('tlb', mode, spins);
      if (mode === 'pv')
        return [
          { a: 'app', m: 'tlb.app.missHw', p: 0 },
          { a: 'hw', m: 'shd.pv.walk', p: 2, x: { hop: 2, tlb: { frame: ADDR.mfn, kind: 'mfn' } } },
          { a: 'app', m: 'tlb.app.hit', p: 4, tone: 'ok' },
        ];
      return [
        { a: 'app', m: 'tlb.app.missHw', p: 0 },
        { a: 'hw', m: 'shd.hw.walkShadow', p: 1, tone: 'warn', set: { used: 'shadow' } },
        { a: 'vmm', m: 'shd.vmm.hidden', p: 2, via: 'trap', entry: 'trap', x: { hop: 1 } },
        { a: 'vmm', m: 'shd.vmm.fill', p: 2, extra: 1, set: { used: 'shadow' }, x: { hop: 2, shadow: 'filled' } },
        { a: 'hw', m: 'shd.hw.rewalk', p: 3, via: 'return', real: 'user', x: { tlb: { frame: ADDR.mfn, kind: 'mfn' } } },
        { a: 'app', m: 'tlb.app.hit', p: 4, tone: 'ok' },
      ];

    case 'idle': {
      const after = { vms: [{ id: 1, state: 'saved' }, { id: 2, state: 'run' }] as VmmView['vms'], used: 'vms' as const };
      if (isPv(mode))
        return [
          { a: 'guest', m: 'idle.none', p: 0, vm: 1 },
          { a: 'guest', m: 'idle.pv.block', p: 1 },
          { a: 'vmm', m: 'idle.pv.switch', p: 2, via: 'hypercall', entry: 'hyper', extra: 4, set: after },
          { a: 'app', m: 'idle.app2', p: 3, vm: 2, via: hw ? 'entry' : 'return' },
        ];
      const spin: VOps = Array.from({ length: spins }, () => ({ a: 'guest' as const, m: 'idle.guest.spin' as const, p: 1, waste: true }));
      return [
        { a: 'guest', m: 'idle.none', p: 0, vm: 1 },
        ...spin,
        hw ? { a: 'vmm', m: 'idle.hw.timer', p: 2, via: 'exit', entry: 'trap' } : { a: 'vmm', m: 'idle.vmm.timer', p: 2, via: 'interrupt', entry: 'trap' },
        { a: 'vmm', m: hw ? 'idle.hw.switch' : 'idle.vmm.switch', p: 2, extra: 4, set: after },
        { a: 'app', m: 'idle.app2', p: 3, vm: 2, via: hw ? 'entry' : 'return' },
      ];
    }
  }
}

/* ---------------- scenarios: the bare machine ---------------- */

function nativeOps(sc: Scenario, mode: Mode): Op<NLayer>[] {
  const hwTlb = isHw(mode) || sc === 'shadow';
  switch (sc) {
    case 'syscall':
      return [
        { a: 'app', m: 'app.exec', p: 0 },
        { a: 'app', m: 'sys.app.trap', p: 1 },
        { a: 'hw', m: 'nat.hw.toKernel', p: 1, via: 'trap', entry: 'trap', real: 'kernel' },
        { a: 'os', m: 'nat.sys.handler', p: 2 },
        { a: 'os', m: 'nat.os.rti', p: 3 },
        { a: 'hw', m: 'nat.hw.toUser', p: 3, real: 'user' },
        { a: 'app', m: 'app.resume', p: 4, via: 'return' },
      ];
    case 'boot':
      return [
        { a: 'os', m: 'nat.boot.start', p: 0 },
        { a: 'os', m: 'nat.boot.lidt', p: 1 },
        { a: 'hw', m: 'nat.boot.hwSaves', p: 1, set: { hwTable: 'os', guestTable: 'none', used: 'hwTable' } },
        { a: 'os', m: 'boot.cont', p: 2 },
      ];
    case 'cli':
      return [
        { a: 'os', m: 'cli.enter', p: 0 },
        { a: 'os', m: 'nat.cli.cli', p: 1, set: { vIF: false, used: 'vIF' } },
        { a: 'os', m: 'cli.crit', p: 2 },
        { a: 'os', m: 'nat.cli.sti', p: 3, set: { vIF: true, used: 'vIF' } },
        { a: 'os', m: 'cli.after', p: 4 },
      ];
    case 'timer':
      return [
        { a: 'app', m: 'tmr.nat.runA', p: 0 },
        { a: 'hw', m: 'tmr.nat.irq', p: 1, via: 'interrupt', entry: 'trap', real: 'kernel' },
        { a: 'os', m: 'tmr.nat.switch', p: 2, extra: 2 },
        { a: 'os', m: 'nat.os.rti', p: 3 },
        { a: 'hw', m: 'nat.hw.toUser', p: 3, real: 'user' },
        { a: 'app', m: 'tmr.nat.runB', p: 4, via: 'return' },
      ];
    case 'tlb':
    case 'shadow':
      if (hwTlb)
        return [
          { a: 'app', m: 'tlb.app.missHw', p: 0 },
          { a: 'hw', m: 'tlb.nat.walk', p: 2, x: { hop: 1, tlb: { frame: ADDR.pfn, kind: 'pfn' } } },
          { a: 'app', m: 'tlb.app.hit', p: 4, tone: 'ok' },
        ];
      return [
        { a: 'app', m: 'tlb.app.miss', p: 0 },
        { a: 'hw', m: 'nat.hw.toKernel', p: 1, via: 'trap', entry: 'trap', real: 'kernel' },
        { a: 'os', m: 'tlb.nat.handler', p: 2, x: { hop: 1, tlb: { frame: ADDR.pfn, kind: 'pfn' } } },
        { a: 'os', m: 'nat.os.rti', p: 3 },
        { a: 'hw', m: 'nat.hw.toUser', p: 3, real: 'user' },
        { a: 'app', m: 'tlb.app.hit', p: 4, via: 'return', tone: 'ok' },
      ];
    case 'idle':
      return [
        { a: 'os', m: 'idle.none', p: 0 },
        { a: 'os', m: 'idle.nat.spin', p: 1 },
        { a: 'hw', m: 'idle.nat.irq', p: 2, via: 'interrupt' },
        { a: 'os', m: 'idle.nat.wake', p: 3 },
      ];
  }
}

/* ---------------- run ---------------- */

const XLATE0: Xlate = { hop: 0, tlb: null, shadow: 'none', direct: false, nested: false };

export function simulateVirt(cfg: VirtConfig): VirtRun {
  const { scenario } = cfg;
  const mode = modeOf(cfg.assist, cfg.paravirt);
  const spins = Math.max(1, Math.min(8, Math.round(cfg.spins)));
  const hw = isHw(mode);
  const multiVm = scenario === 'timer' || scenario === 'idle';
  const hasXlate = scenario === 'tlb' || scenario === 'shadow';

  const vPriv = (a: VLayer): Priv => {
    if (a === 'vmm') return hw ? 'root' : 'kernel';
    if (a === 'guest') return hw ? 'nonroot-kernel' : 'user';
    if (a === 'app') return hw ? 'nonroot-user' : 'user';
    return hw ? 'nonroot-user' : 'user';
  };
  const vBelief = (a: VLayer): Belief | null => (a === 'app' ? 'user' : a === 'guest' ? (isPv(mode) ? 'aware' : 'kernel') : null);
  const vmm0: VmmView = {
    hwTable: scenario === 'boot' ? 'none' : hw ? 'vmcs' : 'vmm',
    guestTable: scenario === 'boot' ? 'none' : hw ? 'vmcs' : isPv(mode) ? 'hyper' : 'vmm',
    vMode: 'kernel',
    vIF: true,
    vms: multiVm ? [{ id: 1, state: 'run' }, { id: 2, state: 'ready' }] : [{ id: 1, state: 'run' }],
    used: null,
  };
  const x0: Xlate | null = hasXlate
    ? { ...XLATE0, shadow: scenario === 'shadow' && mode === 'te' ? 'missing' : 'none', direct: mode === 'pv', nested: hw }
    : null;
  const virt = build<VLayer>(virtOps(scenario, mode, spins), vPriv, vBelief, vmm0, x0);

  const nPriv = (a: NLayer): Priv => (a === 'os' ? 'kernel' : 'user');
  const nBelief = (a: NLayer): Belief | null => (a === 'app' ? 'user' : a === 'os' ? 'kernel' : null);
  const n0: VmmView = { ...vmm0, hwTable: scenario === 'boot' ? 'none' : 'os', guestTable: 'none', vms: [{ id: 1, state: 'run' }] };
  const native = build<NLayer>(nativeOps(scenario, mode), nPriv, nBelief, n0, hasXlate ? { ...XLATE0 } : null);

  const nativeIndex = (i: number): number => {
    if (i <= 0) return 0;
    const st = virt.steps[Math.min(i, virt.steps.length) - 1];
    const p = st.phase;
    const sameSoFar = virt.steps.slice(0, i).filter((s) => s.phase === p).length;
    const before = native.steps.filter((s) => s.phase < p).length;
    const inPhase = native.steps.filter((s) => s.phase === p).length;
    const idx = before + Math.min(sameSoFar, inPhase);
    return i >= virt.steps.length ? native.steps.length : idx;
  };

  return { scenario, mode, virt, native, nativeIndex, multiVm, hasXlate };
}

/** Collapses a trace into its sequence of actors, like the columns of the appendix's protocol tables. */
export function actorSequence<L extends string>(steps: Step<L>[]): L[] {
  const out: L[] = [];
  for (const s of steps) if (out.at(-1) !== s.actor) out.push(s.actor);
  return out;
}

/** The appendix draws protocol tables for exactly these two (trap-and-emulate). */
export function hasAppendixTable(sc: Scenario, mode: Mode): boolean {
  return mode === 'te' && (sc === 'syscall' || sc === 'tlb');
}

/** "Problema aleatorio": a scenario with random toggles. */
export function randomSetup(seed: number): { scenario: Scenario; assist: boolean; paravirt: boolean; spins: number } {
  const r = new PyRandom(seed);
  const scenario = r.choice(SCENARIOS);
  const assist = r.random() < 0.4;
  const paravirt = r.random() < 0.4;
  const spins = r.randint(2, 5);
  return { scenario, assist, paravirt, spins };
}

export function hex(n: number, digits = 0): string {
  return '0x' + n.toString(16).padStart(digits, '0');
}
