export type Policy = 'fifo' | 'sjf' | 'stcf' | 'rr' | 'mlfq';
export const POLICIES: Policy[] = ['fifo', 'sjf', 'stcf', 'rr', 'mlfq'];

export interface Job {
  /** Time the job enters the system. */
  arrival: number;
  /** Total CPU time it needs. */
  length: number;
  /** Issues an I/O every `ioFreq` units of CPU it runs (0 = never), like mlfq.py's z. */
  ioFreq: number;
}

export interface MlfqParams {
  /** Time slice per level, highest priority first (mlfq.py -Q order). */
  quanta: number[];
  /** Allotment per level in time slices, highest priority first (-A order). */
  allotments: number[];
  /** Boost every `boost` ticks (0 = never), -B. */
  boost: number;
  /** -S: reset quantum/allotment and stay at the same level when issuing I/O. */
  stay: boolean;
  /** -I: a job that finishes I/O goes to the front of its queue. */
  iobump: boolean;
}

export interface SchedConfig {
  policy: Policy;
  jobs: Job[];
  /** RR time slice. */
  quantum: number;
  /** How long each I/O lasts (mlfq.py -i). */
  ioTime: number;
  mlfq: MlfqParams;
}

/** What a job is doing during one tick (drives the Gantt lanes). */
export type JobState = 'out' | 'ready' | 'run' | 'io' | 'done';

export type SchedEvent =
  | { k: 'arrive'; job: number }
  | { k: 'ioDone'; job: number; bump: boolean }
  | { k: 'boost' }
  /** RR: the slice ran out, so the job goes to the back of the queue. */
  | { k: 'slice'; job: number }
  /** STCF / MLFQ: a job with a better claim took the CPU. */
  | { k: 'preempt'; job: number; by: number }
  | { k: 'idle' }
  | { k: 'finish'; job: number }
  | { k: 'ioStart'; job: number; until: number }
  /** MLFQ: used up its allotment at `from`. */
  | { k: 'demote'; job: number; from: number; to: number }
  /** MLFQ: used up a slice but stays at `level` (allotment left, or already at the bottom). */
  | { k: 'requeue'; job: number; level: number; bottom: boolean };

/** State of the machine during tick [t, t+1). */
export interface SchedStep {
  t: number;
  running: number | null;
  /** MLFQ priority the running job ran at (python numbering: n-1 is the top). */
  level: number | null;
  /** Waiting jobs per level, index = priority level. FIFO/SJF/STCF/RR use one level. */
  queues: number[][];
  io: { job: number; until: number }[];
  states: JobState[];
  /** Events at the start of the tick (arrivals, boost, preemption…). */
  pre: SchedEvent[];
  /** Events at the end of the tick (finish, I/O, demotion…). */
  post: SchedEvent[];
  /** CPU time left per job after the tick. */
  remaining: number[];
  firstRun: (number | null)[];
  completion: (number | null)[];
  /** Context switches so far (a different job takes the CPU; idle gaps in between don't count as one). */
  switches: number;
  /** This tick put a different job on the CPU than the last one that ran. */
  dispatched: boolean;
  /** MLFQ bookkeeping after the tick. */
  mlfq?: { pri: number[]; ticksLeft: number[]; allotLeft: number[] };
}

export interface JobResult {
  arrival: number;
  length: number;
  firstRun: number;
  completion: number;
  response: number;
  turnaround: number;
  /** Time spent ready but not running: turnaround − length − time in I/O. */
  wait: number;
  ios: number;
}

export interface Averages {
  response: number;
  turnaround: number;
  wait: number;
}

export interface SchedRun {
  policy: Policy;
  /** Number of priority levels (1 unless MLFQ). */
  levels: number;
  initial: SchedStep;
  steps: SchedStep[];
  /** One entry per job; null if it never finished (truncated run). */
  results: (JobResult | null)[];
  avg: Averages;
  switches: number;
  makespan: number;
  /** Stopped at MAX_TICKS before every job finished. */
  truncated: boolean;
}

export const MAX_TICKS = 4000;
