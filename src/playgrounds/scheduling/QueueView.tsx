import clsx from 'clsx';
import { LayoutGroup, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { jobName, type Job, type MlfqParams, type SchedRun, type SchedStep } from '../../sim/scheduling';
import { jobBg, jobRing, spring } from './colors';
import type { Strings } from './strings';

export function QueueView({
  run,
  step,
  jobs,
  mlfq,
  hover,
  setHover,
  s,
}: {
  run: SchedRun;
  step: SchedStep;
  jobs: Job[];
  mlfq: MlfqParams;
  hover: number | null;
  setHover: (j: number | null) => void;
  s: Strings;
}) {
  const isMlfq = run.policy === 'mlfq';
  const cur = step.running;
  const finishedNow = cur !== null && step.completion[cur] !== null;
  const inIo = new Map(step.io.map((x) => [x.job, x.until]));
  const queued = new Set(step.queues.flat());
  const notYet = jobs.map((_, j) => j).filter((j) => j !== cur && !queued.has(j) && !inIo.has(j) && step.completion[j] === null);
  const done = jobs
    .map((_, j) => j)
    .filter((j) => j !== cur && step.completion[j] !== null)
    .sort((a, b) => step.completion[a]! - step.completion[b]!);

  const chip = (j: number, sub?: ReactNode, big = false) => (
    <motion.button
      type="button"
      key={j}
      layout
      layoutId={`sched-job-${j}`}
      transition={spring}
      onMouseEnter={() => setHover(j)}
      onMouseLeave={() => setHover(null)}
      onFocus={() => setHover(j)}
      onBlur={() => setHover(null)}
      className={clsx(
        'relative flex shrink-0 items-center gap-1.5 rounded-lg font-mono font-semibold text-surface shadow-sm transition-[box-shadow,opacity] duration-200',
        jobBg(j),
        big ? 'h-11 px-3.5 text-[15px]' : 'h-8 px-2.5 text-[12.5px]',
        hover === j && clsx('ring-2 ring-offset-2 ring-offset-surface', jobRing(j)),
        hover !== null && hover !== j && 'opacity-45',
      )}
      title={`${jobName(j)} · ${s.left(step.remaining[j])}`}
    >
      {jobName(j)}
      {sub !== undefined && <span className="text-[10.5px] font-medium opacity-85">{sub}</span>}
    </motion.button>
  );

  const box = (title: ReactNode, children: ReactNode, aside?: ReactNode, className?: string) => (
    <div className={clsx('min-w-0 rounded-xl border border-line p-2.5', className)}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-3">{title}</span>
        {aside && <span className="truncate text-[11px] text-ink-3">{aside}</span>}
      </div>
      <div className="flex min-h-8 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
  const emptyNote = <span className="text-[12px] italic text-ink-3">{s.empty}</span>;

  const levels = isMlfq ? Array.from({ length: run.levels }, (_, i) => run.levels - 1 - i) : [0];

  return (
    <LayoutGroup id="sched-queues">
      <div className="grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
        {/* the CPU */}
        <div
          className={clsx(
            'flex flex-col rounded-xl border p-2.5 transition-colors duration-300',
            cur === null ? 'border-line bg-sunken' : finishedNow ? 'border-ok/40 bg-ok-soft' : 'border-accent/40 bg-accent-soft',
          )}
        >
          <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-3">{s.cpu}</span>
          <div className="flex flex-1 items-center gap-2 py-2">
            {cur === null ? (
              <span className="text-[12.5px] italic text-ink-3">{step === run.initial ? '—' : s.idle}</span>
            ) : (
              <>
                {chip(cur, step.remaining[cur] > 0 ? step.remaining[cur] : '✓', true)}
                <span className="font-mono text-[11px] leading-tight text-ink-2">
                  {isMlfq && step.level !== null && <span className="block">Q{step.level}</span>}
                  <span className="block">{finishedNow ? s.endsAt(step.t + 1) : s.left(step.remaining[cur])}</span>
                </span>
              </>
            )}
          </div>
        </div>

        {/* ready queue(s) */}
        <div className="flex min-w-0 flex-col gap-1.5">
          {levels.map((level, k) => {
            const q = step.queues[level] ?? [];
            const head = isMlfq ? `${mlfq.quanta[k]}` : '';
            return (
              <div key={level} className={clsx('flex min-h-12 items-center gap-2 rounded-xl border border-dashed px-2.5 py-1.5 transition-colors duration-300', step.level === level && cur !== null ? 'border-accent/50' : 'border-line-strong')}>
                <div className="w-14 shrink-0 font-mono text-[10.5px] leading-tight text-ink-3">
                  {isMlfq ? (
                    <>
                      <span className="block font-medium text-ink-2">Q{level}</span>
                      <span className="block">
                        q={head} a={mlfq.allotments[k]}
                      </span>
                    </>
                  ) : (
                    <span className="block uppercase tracking-[0.07em]">{s.ready}</span>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{q.length ? q.map((j) => chip(j, step.remaining[j])) : emptyNote}</div>
              </div>
            );
          })}
          {(run.policy === 'sjf' || run.policy === 'stcf') && <span className="pl-1 text-[11px] text-ink-3">{s.readySorted}</span>}
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {box(s.inIo, inIo.size ? [...inIo].map(([j, until]) => chip(j, s.until(until))) : emptyNote)}
        {box(s.notYet, notYet.length ? notYet.map((j) => chip(j, s.at(jobs[j].arrival))) : emptyNote)}
        {box(s.done, done.length ? done.map((j) => chip(j, '✓')) : emptyNote)}
      </div>
    </LayoutGroup>
  );
}
