import clsx from 'clsx';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { POLICIES, jobName, pyFixed, type Job, type Policy, type SchedRun, type SchedStep } from '../../sim/scheduling';
import { jobBg, spring } from './colors';
import type { Strings } from './strings';

const avgOf = (xs: number[]) => (xs.length ? pyFixed(xs.reduce((a, b) => a + b, 0) / xs.length) : '—');

export function MetricsTable({
  jobs,
  run,
  step,
  hover,
  setHover,
  onSeek,
  s,
}: {
  jobs: Job[];
  run: SchedRun;
  step: SchedStep;
  hover: number | null;
  setHover: (j: number | null) => void;
  onSeek: (i: number) => void;
  s: Strings;
}) {
  const rows = jobs.map((job, j) => {
    const f = step.firstRun[j];
    const c = step.completion[j];
    return {
      job,
      f,
      c,
      response: f === null ? null : f - job.arrival,
      turnaround: c === null ? null : c - job.arrival,
      // once a job is done its final numbers are known
      wait: c === null ? null : (run.results[j]?.wait ?? null),
    };
  });
  const known = (k: 'response' | 'turnaround' | 'wait') => rows.map((r) => r[k]).filter((x): x is number => x !== null);

  const val = (v: number | null, key: string, tone?: string) => (
    <span key={`${key}${v}`} className={clsx('inline-block tabular-nums', v === null ? 'text-ink-3' : clsx('animate-pop', tone))}>
      {v === null ? '·' : v}
    </span>
  );
  const jump = (v: number | null, target: number | null, key: string) =>
    v === null || target === null ? (
      val(null, key)
    ) : (
      <button type="button" title={s.jumpTo(v)} onClick={() => onSeek(target)} className="rounded px-1 underline decoration-line-strong decoration-dotted underline-offset-4 transition-colors hover:bg-chip hover:text-accent">
        {val(v, key)}
      </button>
    );

  const th = 'border-b border-line px-3 py-2.5 font-medium whitespace-nowrap';
  const td = 'px-3 py-2 text-right';

  return (
    <div className="overflow-x-auto">
      <table className="w-full font-mono text-[12.5px]">
        <thead>
          <tr className="text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
            <th className={clsx(th, 'text-left')}>{s.job}</th>
            {[s.arrival, s.length, s.firstRun, s.completion, s.response, s.turnaround, s.wait].map((h) => (
              <th key={h} className={clsx(th, 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, j) => (
            <tr
              key={j}
              onMouseEnter={() => setHover(j)}
              onMouseLeave={() => setHover(null)}
              className={clsx('border-b border-line transition-colors duration-200', hover === j ? 'bg-chip' : r.c !== null && 'bg-ok-soft/40')}
            >
              <td className="px-3 py-2">
                <span className="flex items-center gap-2">
                  <span className={clsx('size-2.5 rounded-full', jobBg(j))} />
                  {jobName(j)}
                  <span className="text-[10.5px] text-ink-3">#{j}</span>
                </span>
              </td>
              <td className={clsx(td, 'text-ink-2')}>{r.job.arrival}</td>
              <td className={clsx(td, 'text-ink-2')}>{r.job.length}</td>
              <td className={td}>{jump(r.f, r.f === null ? null : r.f + 1, 'f')}</td>
              <td className={td}>{jump(r.c, r.c, 'c')}</td>
              <td className={td}>{val(r.response, 'r', 'text-info')}</td>
              <td className={td}>{val(r.turnaround, 't', 'text-accent')}</td>
              <td className={td}>{val(r.wait, 'w')}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="text-ink">
            <td className="px-3 py-2.5 text-[10.5px] uppercase tracking-[0.06em] text-ink-3" colSpan={5}>
              {s.average}
            </td>
            <td className={clsx(td, 'font-semibold text-info')}>{avgOf(known('response'))}</td>
            <td className={clsx(td, 'font-semibold text-accent')}>{avgOf(known('turnaround'))}</td>
            <td className={clsx(td, 'font-semibold')}>{avgOf(known('wait'))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function Compare({
  all,
  policy,
  quantum,
  onPick,
  s,
}: {
  all: Record<Policy, SchedRun>;
  policy: Policy;
  quantum: number;
  onPick: (p: Policy) => void;
  s: Strings;
}) {
  const label = (p: Policy) => (p === 'rr' ? `RR q=${quantum}` : p.toUpperCase());
  const block = (title: ReactNode, k: 'turnaround' | 'response', tone: string, soft: string) => {
    const vals = POLICIES.map((p) => all[p].avg[k]);
    const max = Math.max(...vals, 1);
    const best = Math.min(...vals);
    return (
      <div>
        <div className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-3">{title}</div>
        <div className="space-y-1">
          {POLICIES.map((p) => {
            const v = all[p].avg[k];
            const on = p === policy;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onPick(p)}
                title={s.policyTitles[p]}
                className={clsx('group grid w-full grid-cols-[4.75rem_minmax(0,1fr)_3.5rem] items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors', on ? 'bg-chip' : 'hover:bg-chip/60')}
              >
                <span className={clsx('truncate font-mono text-[11.5px]', on ? 'font-semibold text-ink' : 'text-ink-2')}>{label(p)}</span>
                <span className="relative h-3.5 overflow-hidden rounded-full bg-sunken">
                  <motion.span
                    className={clsx('absolute inset-y-0 left-0 rounded-full', on ? tone : soft)}
                    initial={false}
                    animate={{ width: `${(v / max) * 100}%` }}
                    transition={spring}
                  />
                </span>
                <span className={clsx('text-right font-mono text-[12px] tabular-nums', v === best ? 'font-semibold text-ok' : 'text-ink-2')}>
                  {pyFixed(v)}
                  {v === best && <span className="ml-0.5">★</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };
  return (
    <div className="grid gap-5">
      {block(s.avgTurnaround, 'turnaround', 'bg-accent', 'bg-accent/35')}
      {block(s.avgResponse, 'response', 'bg-info', 'bg-info/35')}
    </div>
  );
}
