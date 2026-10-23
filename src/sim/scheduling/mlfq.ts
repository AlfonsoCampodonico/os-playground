import { averages, initialStep, results } from './common';
import { MAX_TICKS, type Job, type JobState, type MlfqParams, type SchedEvent, type SchedRun, type SchedStep } from './types';

/**
 * Line-by-line port of OSTEP's `mlfq.py` (cpu-sched-mlfq), one tick per step.
 * Levels use the script's numbering: n-1 is the top queue, 0 the bottom.
 * Its quirks are kept on purpose (e.g. with -S an I/O that coincides with the
 * end of a slice still costs allotment), so traces match `-c` exactly.
 */
export function simulateMlfq(jobs: Job[], p: MlfqParams, ioTime: number): SchedRun {
  const numQueues = p.quanta.length;
  const hi = numQueues - 1;
  // python: quantum[qc] with qc counting down from the top
  const quantum: number[] = [];
  const allotment: number[] = [];
  for (let i = 0; i < numQueues; i++) {
    quantum[hi - i] = p.quanta[i];
    allotment[hi - i] = p.allotments[i] ?? p.allotments[p.allotments.length - 1] ?? 1;
  }

  const n = jobs.length;
  const currPri = jobs.map(() => hi);
  const ticksLeft = jobs.map(() => quantum[hi]);
  const allotLeft = jobs.map(() => allotment[hi]);
  const timeLeft = jobs.map((j) => j.length);
  const doingIO = jobs.map(() => false);
  const ioUntil: (number | null)[] = jobs.map(() => null);
  const firstRun: (number | null)[] = jobs.map(() => null);
  const endTime: (number | null)[] = jobs.map(() => null);
  const ios = jobs.map(() => 0);

  const ioDone = new Map<number, { j: number; begins: boolean }[]>();
  const at = (time: number) => {
    let l = ioDone.get(time);
    if (!l) ioDone.set(time, (l = []));
    return l;
  };
  jobs.forEach((j, i) => at(j.arrival).push({ j: i, begins: true }));

  const queue: number[][] = Array.from({ length: numQueues }, () => []);
  const findQueue = () => {
    for (let q = hi; q >= 0; q--) if (queue[q].length > 0) return q;
    return -1;
  };

  let currTime = 0;
  let finished = 0;
  let lastRan: number | null = null;
  /** The last job to run is still at the head of its queue mid-slice. */
  let lastKept = false;
  let switches = 0;
  const steps: SchedStep[] = [];

  const snapshot = (cur: number | null, level: number | null, pre: SchedEvent[], dispatched: boolean): SchedStep => {
    const queues = queue.map((q, lvl) => (lvl === level && q[0] === cur ? q.slice(1) : [...q]));
    const waiting = new Set(queues.flat());
    const states: JobState[] = jobs.map((_, j) =>
      j === cur ? 'run' : waiting.has(j) ? 'ready' : doingIO[j] ? 'io' : endTime[j] !== null ? 'done' : 'out',
    );
    return {
      t: currTime,
      running: cur,
      level,
      queues,
      io: jobs.flatMap((_, j) => (doingIO[j] && ioUntil[j] !== null ? [{ job: j, until: ioUntil[j]! }] : [])),
      states,
      pre,
      post: [],
      remaining: [],
      firstRun: [],
      completion: [],
      switches,
      dispatched,
    };
  };
  const finish = (s: SchedStep) => {
    s.remaining = [...timeLeft];
    s.firstRun = [...firstRun];
    s.completion = [...endTime];
    s.mlfq = { pri: [...currPri], ticksLeft: [...ticksLeft], allotLeft: [...allotLeft] };
    steps.push(s);
  };

  while (finished < n && currTime < MAX_TICKS) {
    const pre: SchedEvent[] = [];

    if (p.boost > 0 && currTime !== 0 && currTime % p.boost === 0) {
      pre.push({ k: 'boost' });
      for (let q = 0; q < numQueues - 1; q++) {
        for (const j of queue[q]) if (!doingIO[j]) queue[hi].push(j);
        queue[q] = [];
      }
      for (let j = 0; j < n; j++) {
        if (timeLeft[j] > 0) {
          currPri[j] = hi;
          ticksLeft[j] = quantum[hi];
          allotLeft[j] = allotment[hi];
        }
      }
    }

    for (const { j, begins } of ioDone.get(currTime) ?? []) {
      const q = currPri[j];
      doingIO[j] = false;
      ioUntil[j] = null;
      pre.push(begins ? { k: 'arrive', job: j } : { k: 'ioDone', job: j, bump: p.iobump });
      if (!p.iobump || begins) queue[q].push(j);
      else queue[q].unshift(j);
    }

    const currQueue = findQueue();
    if (currQueue === -1) {
      pre.push({ k: 'idle' });
      finish(snapshot(null, null, pre, false));
      currTime++;
      continue;
    }

    const currJob = queue[currQueue][0];
    const dispatched = currJob !== lastRan;
    if (dispatched && lastRan !== null) {
      switches++;
      if (lastKept && endTime[lastRan] === null) pre.push({ k: 'preempt', job: lastRan, by: currJob });
    }
    lastRan = currJob;
    const step = snapshot(currJob, currQueue, pre, dispatched);

    timeLeft[currJob]--;
    ticksLeft[currJob]--;
    if (firstRun[currJob] === null) firstRun[currJob] = currTime;
    const runTime = jobs[currJob].length;
    const ioFreq = jobs[currJob].ioFreq;
    const ticks = ticksLeft[currJob];
    const left = timeLeft[currJob];

    currTime++;
    lastKept = false;

    if (left === 0) {
      endTime[currJob] = currTime;
      finished++;
      queue[currQueue].shift();
      step.post.push({ k: 'finish', job: currJob });
      finish(step);
      continue;
    }

    let issuedIO = false;
    if (ioFreq > 0 && (runTime - left) % ioFreq === 0) {
      issuedIO = true;
      queue[currQueue].shift();
      doingIO[currJob] = true;
      ios[currJob]++;
      if (p.stay) {
        ticksLeft[currJob] = quantum[currQueue];
        allotLeft[currJob] = allotment[currQueue];
      }
      const future = currTime + ioTime;
      ioUntil[currJob] = future;
      at(future).push({ j: currJob, begins: false });
      step.post.push({ k: 'ioStart', job: currJob, until: future });
    }

    if (ticks === 0) {
      if (!issuedIO) queue[currQueue].shift();
      allotLeft[currJob]--;
      if (allotLeft[currJob] === 0) {
        if (currQueue > 0) {
          currPri[currJob] = currQueue - 1;
          ticksLeft[currJob] = quantum[currQueue - 1];
          allotLeft[currJob] = allotment[currQueue - 1];
          if (!issuedIO) queue[currQueue - 1].push(currJob);
          step.post.push({ k: 'demote', job: currJob, from: currQueue, to: currQueue - 1 });
        } else {
          ticksLeft[currJob] = quantum[currQueue];
          allotLeft[currJob] = allotment[currQueue];
          if (!issuedIO) queue[currQueue].push(currJob);
          if (!issuedIO) step.post.push({ k: 'requeue', job: currJob, level: currQueue, bottom: true });
        }
      } else {
        ticksLeft[currJob] = quantum[currQueue];
        if (!issuedIO) queue[currQueue].push(currJob);
        if (!issuedIO) step.post.push({ k: 'requeue', job: currJob, level: currQueue, bottom: false });
      }
    } else if (!issuedIO) {
      lastKept = true;
    }
    finish(step);
  }

  const rs = results(jobs, firstRun, endTime, ios, ioTime);
  return {
    policy: 'mlfq',
    levels: numQueues,
    initial: initialStep(jobs, numQueues, { quanta: p.quanta, allotments: p.allotments }),
    steps,
    results: rs,
    avg: averages(rs),
    switches,
    makespan: currTime,
    truncated: finished < n,
  };
}
