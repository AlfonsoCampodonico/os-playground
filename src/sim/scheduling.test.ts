import { describe, expect, it } from 'vitest';
import {
  compareAll,
  formatJobs,
  ostepCommand,
  parseJobs,
  parseOstepFlags,
  presetConfig,
  pyFixed,
  simulate,
  DEFAULT_MLFQ,
  type SchedConfig,
  type SchedRun,
} from './scheduling';
import { GOLDEN } from './scheduling/golden';

function fromFlags(flags: string): SchedConfig {
  const p = parseOstepFlags(flags);
  if (!p.ok) throw new Error(`bad flags ${flags}: ${JSON.stringify(p.error)}`);
  const v = p.value;
  return { policy: v.policy, jobs: v.jobs, quantum: v.quantum ?? 1, ioTime: v.ioTime ?? 5, mlfq: v.mlfq ?? DEFAULT_MLFQ };
}

const cpu = (run: SchedRun) => run.steps.map((s) => s.running);

describe('matches scheduler.py -c (golden)', () => {
  for (const g of GOLDEN.scheduler) {
    it(`./scheduler.py ${g.flags}`, () => {
      const cfg = fromFlags(`./scheduler.py ${g.flags}`);
      expect(cfg.jobs.map((j) => j.length)).toEqual(g.lengths);
      const run = simulate(cfg);
      expect(cpu(run)).toEqual(g.ticks);
      run.results.forEach((r, i) => {
        expect(r).not.toBeNull();
        expect([r!.response, r!.turnaround, r!.wait]).toEqual([g.jobs[i].response, g.jobs[i].turnaround, g.jobs[i].wait]);
      });
      expect([pyFixed(run.avg.response), pyFixed(run.avg.turnaround), pyFixed(run.avg.wait)]).toEqual(g.avg);
    });
  }
});

describe('matches mlfq.py -c (golden)', () => {
  for (const g of GOLDEN.mlfq) {
    it(`./mlfq.py ${g.flags}`, () => {
      const cfg = fromFlags(`./mlfq.py ${g.flags}`);
      expect(cfg.jobs.map((j) => [j.arrival, j.length, j.ioFreq])).toEqual(g.jobs);
      const run = simulate(cfg);
      const ticks = run.steps.map((s) => (s.running === null ? '-' : `${s.running}.${s.level}`)).join(' ');
      expect(ticks).toBe(g.ticks);
      expect(run.results.map((r) => [r!.response, r!.turnaround])).toEqual(g.stats);
      expect([pyFixed(run.avg.response), pyFixed(run.avg.turnaround)]).toEqual(g.avg);
    });
  }
});

describe('book examples (OSTEP ch. 7)', () => {
  const avgT = (id: Parameters<typeof presetConfig>[0], policy?: SchedConfig['policy']) => {
    const cfg = presetConfig(id);
    return simulate(policy ? { ...cfg, policy } : cfg).avg;
  };
  it('FIFO, three jobs of 10: average turnaround 20 (fig. 7.1)', () => expect(avgT('fifo').turnaround).toBe(20));
  it('convoy: FIFO 110 vs SJF 50 (figs. 7.2–7.3)', () => {
    expect(avgT('convoy').turnaround).toBe(110);
    expect(avgT('convoy', 'sjf').turnaround).toBe(50);
  });
  it('late arrivals: SJF 103.33, STCF 50 (figs. 7.4–7.5)', () => {
    expect(avgT('sjfLate').turnaround.toFixed(2)).toBe('103.33');
    expect(avgT('stcf').turnaround).toBe(50);
  });
  it('RR q=1 vs SJF on three jobs of 5: response 1 vs 5, turnaround 14 vs 10 (figs. 7.6–7.7)', () => {
    expect(avgT('rr').response).toBe(1);
    expect(avgT('rr').turnaround).toBe(14);
    expect(avgT('rr', 'sjf').response).toBe(5);
    expect(avgT('rr', 'sjf').turnaround).toBe(10);
  });
});

describe('extensions', () => {
  it('STCF preempts the long job when shorter ones arrive, and keeps the runner on ties', () => {
    const run = simulate(presetConfig('stcf'));
    expect(run.steps[10].pre).toContainEqual({ k: 'preempt', job: 0, by: 1 });
    expect(cpu(run).slice(10, 30)).toEqual([...Array(10).fill(1), ...Array(10).fill(2)]);
    const tie = simulate({ ...presetConfig('stcf'), jobs: [{ arrival: 0, length: 5, ioFreq: 0 }, { arrival: 2, length: 3, ioFreq: 0 }] });
    expect(cpu(tie)).toEqual([0, 0, 0, 0, 0, 1, 1, 1]);
  });

  it('RR: an arrival joins the queue before the job whose slice just expired', () => {
    const run = simulate({ ...presetConfig('rr'), quantum: 2, jobs: [{ arrival: 0, length: 4, ioFreq: 0 }, { arrival: 2, length: 2, ioFreq: 0 }] });
    expect(cpu(run)).toEqual([0, 0, 1, 1, 0, 0]);
  });

  it('idle CPU until the first arrival; wait excludes time in I/O', () => {
    const run = simulate({ ...presetConfig('fifo'), jobs: [{ arrival: 3, length: 4, ioFreq: 2 }], ioTime: 2 });
    expect(cpu(run)).toEqual([null, null, null, 0, 0, null, null, 0, 0]);
    expect(run.results[0]).toMatchObject({ response: 0, turnaround: 6, wait: 0, ios: 1 });
    expect(run.steps[5].states[0]).toBe('io');
  });

  it('counts context switches only when a different job takes the CPU', () => {
    expect(simulate(presetConfig('fifo')).switches).toBe(2);
    expect(simulate(presetConfig('rr')).switches).toBe(14);
  });

  it('MLFQ demotes a lone long job one level per slice (fig. 8.2)', () => {
    const run = simulate(presetConfig('mlfqLong'));
    expect(run.steps[9].post).toContainEqual({ k: 'demote', job: 0, from: 2, to: 1 });
    expect(run.steps.map((s) => s.level).slice(0, 30)).toEqual([...Array(10).fill(2), ...Array(10).fill(1), ...Array(10).fill(0)]);
  });

  it('compares every policy on the same jobs', () => {
    const all = compareAll(presetConfig('convoy'));
    expect(all.fifo.avg.turnaround).toBe(110);
    expect(all.sjf.avg.turnaround).toBe(50);
    expect(all.stcf.avg.turnaround).toBe(50);
  });
});

describe('text and flags', () => {
  it('formats like python %.2f (ties to even)', () => {
    expect(pyFixed(66.125)).toBe('66.12');
    expect(pyFixed(66.375)).toBe('66.38');
    expect(pyFixed(103.33333333333333)).toBe('103.33');
    expect(pyFixed(5)).toBe('5.00');
  });

  it('round-trips the job text form and accepts mlfq.py -l lists', () => {
    expect(parseJobs('0,10 5,20,3').jobs).toEqual([
      { arrival: 0, length: 10, ioFreq: 0 },
      { arrival: 5, length: 20, ioFreq: 3 },
    ]);
    expect(parseJobs('0,100,0:10,20,2').jobs).toHaveLength(2);
    expect(parseJobs('10 20').jobs).toEqual([
      { arrival: 0, length: 10, ioFreq: 0 },
      { arrival: 0, length: 20, ioFreq: 0 },
    ]);
    expect(parseJobs('0,0 x').bad).toEqual(['0,0', 'x']);
    const jobs = parseJobs('0,10 5,20,3').jobs;
    expect(parseJobs(formatJobs(jobs)).jobs).toEqual(jobs);
  });

  it('parses long options and builds the equivalent command', () => {
    const p = parseOstepFlags('python3 scheduler.py --policy=RR --quantum 2 -l 3,7,4 -c');
    expect(p.ok && p.value.policy).toBe('rr');
    const cfg = fromFlags('./scheduler.py -p RR -q 2 -l 3,7,4');
    expect(ostepCommand(cfg)).toEqual({ ok: true, cmd: './scheduler.py -p RR -l 3,7,4 -q 2 -c' });
    expect(ostepCommand({ ...cfg, policy: 'stcf' })).toEqual({ ok: false, reason: 'stcf' });
    const s = parseOstepFlags('./scheduler.py -p SJF -s 3 -j 4');
    if (!s.ok) throw new Error();
    expect(ostepCommand({ ...cfg, policy: 'sjf', jobs: s.value.jobs, gen: s.value.gen })).toEqual({ ok: true, cmd: './scheduler.py -p SJF -s 3 -j 4 -c' });
    const m = presetConfig('boost');
    expect(ostepCommand(m)).toEqual({ ok: true, cmd: './mlfq.py -l 0,200,0:100,50,5:100,50,5 -B 50 -S -c' });
    expect(parseOstepFlags('./mlfq.py -Q 1,2 -A 1,2,3')).toEqual({ ok: false, error: { k: 'mismatch' } });
    expect(parseOstepFlags('./scheduler.py -p LOTTERY')).toEqual({ ok: false, error: { k: 'policy', value: 'LOTTERY' } });
  });

  it('every command it prints parses back to the same run', () => {
    for (const id of ['convoy', 'rr', 'mlfqIo', 'boost'] as const) {
      const cfg = presetConfig(id);
      const c = ostepCommand(cfg);
      if (!c.ok) throw new Error(id);
      expect(cpu(simulate(fromFlags(c.cmd)))).toEqual(cpu(simulate(cfg)));
    }
  });
});
