/**
 * MicroVMs (Firecracker-style): a minimal VMM that loads the guest kernel
 * directly and offers only a handful of virtio devices. Three protocols, each
 * as `{ initial, steps[] }` snapshots:
 *  - boot:   full VM vs microVM boot timelines (illustrative orders of magnitude);
 *  - virtio: one I/O request through a virtqueue vs a fully emulated device;
 *  - jail:   one VMM process per microVM, jailed and seccomp-filtered.
 */
export const MV_SCENARIOS = ['boot', 'virtio', 'jail'] as const;
export type MvScenario = (typeof MV_SCENARIOS)[number];
export type Tone = 'neutral' | 'ok' | 'bad' | 'warn' | 'info';

/** Boot stages. Times in ms and are approximate orders of magnitude, not measurements. */
export const FULL_BOOT = [
  { id: 'vmm', ms: 50 },
  { id: 'firmware', ms: 1500 },
  { id: 'bootloader', ms: 500 },
  { id: 'kernel', ms: 1500 },
  { id: 'init', ms: 1000 },
] as const;
export const MICRO_BOOT = [
  { id: 'vmm', ms: 5 },
  { id: 'loadKernel', ms: 10 },
  { id: 'kernel', ms: 100 },
  { id: 'init', ms: 30 },
] as const;
export type BootStage = (typeof FULL_BOOT)[number]['id'] | (typeof MICRO_BOOT)[number]['id'];

/** Devices each kind of VM exposes to the guest. Every one is code an attacker can poke. */
export const FULL_DEVICES = ['PCI', 'ACPI', 'USB', 'VGA', 'PS/2', 'RTC', 'IDE/SATA', 'e1000', 'sound', 'floppy', 'serial', 'PIT'] as const;
export const MICRO_DEVICES = ['virtio-net', 'virtio-block', 'serial'] as const;

/** Illustrative per-VM memory overhead (VMM + emulated hardware), MiB. */
export const OVERHEAD_MIB = { full: 130, micro: 5 } as const;

/** Register accesses an emulated (non-virtio) disk controller needs per request. */
export const EMU_REGS_PER_REQ = 6;

export interface MvState {
  /** Element highlighted on the diagram. */
  focus: string;
  fullMs: number;
  microMs: number;
  fullStage: number;
  microStage: number;
  /** VM exits so far, on each lane. */
  exits: number;
  emuExits: number;
  /** Requests the device backend has completed. */
  done: number;
  /** Descriptors waiting in the virtqueue. */
  queued: number;
  irqs: number;
  /** jail scenario */
  jailed: { chroot: boolean; ns: boolean; uid: boolean; seccomp: boolean; vmm: boolean; guest: boolean };
  blocked: boolean;
}

export interface MvStep {
  n: number;
  msg: string;
  tone: Tone;
  state: MvState;
}
export interface MvRun {
  initial: MvState;
  steps: MvStep[];
}

export interface MvConfig {
  scenario: MvScenario;
  /** virtio: requests the guest batches before a single kick (1..8). */
  batch: number;
}

const blank = (): MvState => ({
  focus: '',
  fullMs: 0,
  microMs: 0,
  fullStage: -1,
  microStage: -1,
  exits: 0,
  emuExits: 0,
  done: 0,
  queued: 0,
  irqs: 0,
  jailed: { chroot: false, ns: false, uid: false, seccomp: false, vmm: false, guest: false },
  blocked: false,
});

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(x)));

export function simulateMicrovm(cfg: MvConfig): MvRun {
  const initial = blank();
  const steps: MvStep[] = [];
  let st = initial;
  const push = (msg: string, tone: Tone, patch: Omit<Partial<MvState>, 'jailed'> & { jailed?: Partial<MvState['jailed']> }) => {
    st = { ...st, ...patch, jailed: { ...st.jailed, ...(patch.jailed ?? {}) } };
    steps.push({ n: steps.length + 1, msg, tone, state: st });
  };

  if (cfg.scenario === 'boot') {
    const n = Math.max(FULL_BOOT.length, MICRO_BOOT.length);
    for (let k = 0; k < n; k++) {
      const f = Math.min(k, FULL_BOOT.length - 1);
      const m = Math.min(k, MICRO_BOOT.length - 1);
      push(`boot.${k}`, k === n - 1 ? 'ok' : k === 1 ? 'warn' : 'neutral', {
        focus: FULL_BOOT[f].id,
        fullStage: f,
        microStage: m,
        fullMs: FULL_BOOT.slice(0, f + 1).reduce((a, s) => a + s.ms, 0),
        microMs: MICRO_BOOT.slice(0, m + 1).reduce((a, s) => a + s.ms, 0),
      });
    }
  } else if (cfg.scenario === 'virtio') {
    const b = clamp(cfg.batch, 1, 8);
    // emulated lane: every register access traps
    push('io.desc', 'neutral', { focus: 'queue', queued: b, emuExits: EMU_REGS_PER_REQ * b });
    push('io.kick', 'warn', { focus: 'kick', exits: 1 });
    push('io.backend', 'info', { focus: 'backend', queued: 0, done: b });
    push('io.irq', 'neutral', { focus: 'irq', irqs: 1, exits: 2 });
    push('io.end', 'ok', { focus: 'driver' });
  } else {
    push('jail.chroot', 'neutral', { focus: 'chroot', jailed: { chroot: true } });
    push('jail.ns', 'neutral', { focus: 'ns', jailed: { ns: true } });
    push('jail.uid', 'neutral', { focus: 'uid', jailed: { uid: true } });
    push('jail.seccomp', 'info', { focus: 'seccomp', jailed: { seccomp: true } });
    push('jail.vmm', 'neutral', { focus: 'vmm', jailed: { vmm: true } });
    push('jail.guest', 'neutral', { focus: 'guest', jailed: { guest: true } });
    push('jail.escape', 'warn', { focus: 'vmm' });
    push('jail.blocked', 'ok', { focus: 'seccomp', blocked: true });
  }
  return { initial, steps };
}

/** Host totals for N VMs of each kind. */
export function hostFootprint(n: number, guestMib = 128) {
  return {
    full: { mib: n * (guestMib + OVERHEAD_MIB.full), devices: FULL_DEVICES.length, bootMs: FULL_BOOT.reduce((a, s) => a + s.ms, 0) },
    micro: { mib: n * (guestMib + OVERHEAD_MIB.micro), devices: MICRO_DEVICES.length, bootMs: MICRO_BOOT.reduce((a, s) => a + s.ms, 0) },
  };
}
