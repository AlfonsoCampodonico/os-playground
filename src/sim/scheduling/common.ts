import type { Averages, Job, JobResult, JobState, SchedStep } from './types';

export function results(jobs: Job[], firstRun: (number | null)[], completion: (number | null)[], ios: number[], ioTime: number): (JobResult | null)[] {
  return jobs.map((j, i) => {
    const f = firstRun[i];
    const c = completion[i];
    if (f === null || c === null) return null;
    const turnaround = c - j.arrival;
    return {
      arrival: j.arrival,
      length: j.length,
      firstRun: f,
      completion: c,
      response: f - j.arrival,
      turnaround,
      wait: turnaround - j.length - ios[i] * ioTime,
      ios: ios[i],
    };
  });
}

export function averages(rs: (JobResult | null)[]): Averages {
  const done = rs.filter((r): r is JobResult => r !== null);
  const n = done.length || 1;
  const sum = (k: keyof Averages) => done.reduce((a, r) => a + r[k], 0) / n;
  return { response: sum('response'), turnaround: sum('turnaround'), wait: sum('wait') };
}

/** The picture before the first tick: jobs that arrive at 0 are already waiting. */
export function initialStep(jobs: Job[], levels: number, ticks?: { quanta: number[]; allotments: number[] }): SchedStep {
  const queues: number[][] = Array.from({ length: levels }, () => []);
  jobs.forEach((j, i) => j.arrival === 0 && queues[levels - 1].push(i));
  const states: JobState[] = jobs.map((j) => (j.arrival === 0 ? 'ready' : 'out'));
  return {
    t: 0,
    running: null,
    level: null,
    queues,
    io: [],
    states,
    pre: [],
    post: [],
    remaining: jobs.map((j) => j.length),
    firstRun: jobs.map(() => null),
    completion: jobs.map(() => null),
    switches: 0,
    dispatched: false,
    mlfq: ticks && {
      pri: jobs.map(() => levels - 1),
      ticksLeft: jobs.map(() => ticks.quanta[0]),
      allotLeft: jobs.map(() => ticks.allotments[0]),
    },
  };
}
