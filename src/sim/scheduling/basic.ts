import { averages, initialStep, results } from './common';
import { MAX_TICKS, type Job, type JobState, type SchedEvent, type SchedRun, type SchedStep } from './types';

export type BasicPolicy = 'fifo' | 'sjf' | 'stcf' | 'rr';

/**
 * FIFO, SJF, STCF and RR, one time unit per step.
 *
 * With every job arriving at 0 and no I/O this is exactly OSTEP's
 * `scheduler.py` (FIFO in job order, SJF = stable sort by length, RR with a
 * FIFO run list). Arrivals, I/O and STCF are extensions; ties are broken so:
 *  - newcomers (arrivals, then I/O completions, by job number) join the ready
 *    queue *before* a job whose RR slice expired at that same instant;
 *  - SJF / STCF pick the least remaining time, then the earliest arrival, then
 *    the lowest job number; STCF keeps the running job on a tie (no needless
 *    switch).
 */
export function simulateBasic(policy: BasicPolicy, jobs: Job[], quantum: number, ioTime: number): SchedRun {
  const n = jobs.length;
  const remaining = jobs.map((j) => j.length);
  const ran = jobs.map(() => 0);
  const ios = jobs.map(() => 0);
  const firstRun: (number | null)[] = jobs.map(() => null);
  const completion: (number | null)[] = jobs.map(() => null);
  const ioUntil: (number | null)[] = jobs.map(() => null);
  let ready: number[] = [];
  let running: number | null = null;
  let slice = 0;
  let lastRan: number | null = null;
  let switches = 0;
  let finished = 0;
  const steps: SchedStep[] = [];

  const key = (j: number) => [remaining[j], jobs[j].arrival, j];
  const better = (a: number, b: number) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i];
    return false;
  };
  const takeBest = () => {
    let best = ready[0];
    for (const j of ready) if (better(j, best)) best = j;
    ready = ready.filter((j) => j !== best);
    return best;
  };

  let t = 0;
  while (finished < n && t < MAX_TICKS) {
    const pre: SchedEvent[] = [];
    const post: SchedEvent[] = [];
    for (let j = 0; j < n; j++) {
      if (jobs[j].arrival === t) {
        ready.push(j);
        pre.push({ k: 'arrive', job: j });
      }
    }
    for (let j = 0; j < n; j++) {
      if (ioUntil[j] === t) {
        ioUntil[j] = null;
        ready.push(j);
        pre.push({ k: 'ioDone', job: j, bump: false });
      }
    }
    if (policy === 'rr' && running !== null && slice === 0) {
      ready.push(running);
      pre.push({ k: 'slice', job: running });
      running = null;
    }

    if (policy === 'stcf') {
      if (ready.length) {
        let best: number = running ?? ready[0];
        for (const j of ready) if (better(j, best)) best = j;
        if (best !== running) {
          ready = ready.filter((j) => j !== best);
          if (running !== null) {
            ready.push(running);
            pre.push({ k: 'preempt', job: running, by: best });
          }
          running = best;
        }
      }
    } else if (running === null && ready.length) {
      running = policy === 'sjf' ? takeBest() : ready.shift()!;
      slice = quantum;
    }

    const dispatched = running !== null && running !== lastRan;
    if (dispatched && lastRan !== null) switches++;
    if (running !== null) lastRan = running;

    const shownReady = policy === 'sjf' || policy === 'stcf' ? [...ready].sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0)) : [...ready];
    const states: JobState[] = jobs.map((_, j) =>
      j === running ? 'run' : ready.includes(j) ? 'ready' : ioUntil[j] !== null ? 'io' : completion[j] !== null ? 'done' : 'out',
    );
    const io = jobs.flatMap((_, j) => (ioUntil[j] !== null ? [{ job: j, until: ioUntil[j]! }] : []));
    const cur = running;

    if (cur !== null) {
      remaining[cur]--;
      ran[cur]++;
      slice--;
      if (firstRun[cur] === null) firstRun[cur] = t;
      if (remaining[cur] === 0) {
        completion[cur] = t + 1;
        finished++;
        post.push({ k: 'finish', job: cur });
        running = null;
      } else if (jobs[cur].ioFreq > 0 && ran[cur] % jobs[cur].ioFreq === 0) {
        ioUntil[cur] = t + 1 + ioTime;
        ios[cur]++;
        post.push({ k: 'ioStart', job: cur, until: t + 1 + ioTime });
        running = null;
      }
    } else {
      pre.push({ k: 'idle' });
    }

    steps.push({
      t,
      running: cur,
      level: cur === null ? null : 0,
      queues: [shownReady],
      io,
      states,
      pre,
      post,
      remaining: [...remaining],
      firstRun: [...firstRun],
      completion: [...completion],
      switches,
      dispatched,
    });
    t++;
  }

  const rs = results(jobs, firstRun, completion, ios, ioTime);
  return {
    policy,
    levels: 1,
    initial: initialStep(jobs, 1),
    steps,
    results: rs,
    avg: averages(rs),
    switches,
    makespan: t,
    truncated: finished < n,
  };
}
