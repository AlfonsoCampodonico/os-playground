import { simulateBasic } from './basic';
import { simulateMlfq } from './mlfq';
import type { Job, MlfqParams, Policy, SchedConfig, SchedRun } from './types';

export * from './types';
export * from './jobs';
export { simulateBasic } from './basic';
export { simulateMlfq } from './mlfq';

export function simulate(cfg: SchedConfig): SchedRun {
  return cfg.policy === 'mlfq' ? simulateMlfq(cfg.jobs, cfg.mlfq, cfg.ioTime) : simulateBasic(cfg.policy, cfg.jobs, cfg.quantum, cfg.ioTime);
}

/** Every policy on the same jobs (RR with the current slice, MLFQ with its current setup). */
export function compareAll(cfg: SchedConfig): Record<Policy, SchedRun> {
  return {
    fifo: simulate({ ...cfg, policy: 'fifo' }),
    sjf: simulate({ ...cfg, policy: 'sjf' }),
    stcf: simulate({ ...cfg, policy: 'stcf' }),
    rr: simulate({ ...cfg, policy: 'rr' }),
    mlfq: simulate({ ...cfg, policy: 'mlfq' }),
  };
}

export const DEFAULT_MLFQ: MlfqParams = { quanta: [10, 10, 10], allotments: [1, 1, 1], boost: 0, stay: false, iobump: false };

const j = (arrival: number, length: number, ioFreq = 0): Job => ({ arrival, length, ioFreq });

export interface Preset {
  chapter: 7 | 8;
  policy: Policy;
  jobs: Job[];
  quantum?: number;
  ioTime?: number;
  mlfq?: Partial<MlfqParams>;
}

/** The book's examples (OSTEP ch. 7 figures 7.1–7.7, ch. 8 figures 8.2–8.5). */
export type PresetId = 'fifo' | 'convoy' | 'sjfLate' | 'stcf' | 'rr' | 'mlfqLong' | 'mlfqShort' | 'mlfqIo' | 'starve' | 'boost';

export const PRESETS: Record<PresetId, Preset> = {
  fifo: { chapter: 7, policy: 'fifo', jobs: [j(0, 10), j(0, 10), j(0, 10)] },
  convoy: { chapter: 7, policy: 'fifo', jobs: [j(0, 100), j(0, 10), j(0, 10)] },
  sjfLate: { chapter: 7, policy: 'sjf', jobs: [j(0, 100), j(10, 10), j(10, 10)] },
  stcf: { chapter: 7, policy: 'stcf', jobs: [j(0, 100), j(10, 10), j(10, 10)] },
  rr: { chapter: 7, policy: 'rr', quantum: 1, jobs: [j(0, 5), j(0, 5), j(0, 5)] },
  mlfqLong: { chapter: 8, policy: 'mlfq', jobs: [j(0, 200)] },
  mlfqShort: { chapter: 8, policy: 'mlfq', jobs: [j(0, 200), j(100, 20)] },
  mlfqIo: { chapter: 8, policy: 'mlfq', ioTime: 4, mlfq: { stay: true }, jobs: [j(0, 200), j(50, 20, 1)] },
  starve: { chapter: 8, policy: 'mlfq', ioTime: 5, mlfq: { stay: true }, jobs: [j(0, 200), j(100, 50, 5), j(100, 50, 5)] },
  boost: { chapter: 8, policy: 'mlfq', ioTime: 5, mlfq: { stay: true, boost: 50 }, jobs: [j(0, 200), j(100, 50, 5), j(100, 50, 5)] },
};

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

/** Full setup for a preset (unset fields take the defaults: RR q=1, -i 5, mlfq.py defaults). */
export function presetConfig(id: PresetId): SchedConfig {
  const p = PRESETS[id];
  return { policy: p.policy, jobs: p.jobs, quantum: p.quantum ?? 1, ioTime: p.ioTime ?? 5, mlfq: { ...DEFAULT_MLFQ, ...p.mlfq } };
}
