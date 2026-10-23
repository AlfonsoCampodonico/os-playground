import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Button, Field, Icons, TextField } from '../../components/kit';
import { LIMITS, formatJobs, jobName, parseJobs, type Job } from '../../sim/scheduling';
import { jobBg, jobRing, spring } from './colors';
import type { Strings } from './strings';

/** A small numeric cell for the jobs table (the kit's NumberField is too wide for three per row). */
function Cell({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const bad = draft.trim() === '' || !/^\d+$/.test(draft.trim()) || Number(draft) < min || Number(draft) > max;
  return (
    <input
      aria-label={label}
      inputMode="numeric"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (/^\d+$/.test(e.target.value.trim()) && n >= min && n <= max) onChange(n);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          onChange(Math.max(min, Math.min(max, value + (e.key === 'ArrowUp' ? 1 : -1))));
        }
      }}
      onBlur={() => setDraft(String(value))}
      className={clsx(
        'h-8 w-full min-w-0 rounded-md border bg-sunken px-1.5 text-center font-mono text-[12.5px] tabular-nums outline-none transition-colors focus:ring-2',
        bad ? 'border-bad focus:ring-bad/20' : 'border-line-strong focus:border-accent focus:ring-accent/20',
      )}
    />
  );
}

export function JobsEditor({
  jobs,
  onChange,
  hover,
  setHover,
  s,
}: {
  jobs: Job[];
  onChange: (jobs: Job[]) => void;
  hover: number | null;
  setHover: (j: number | null) => void;
  s: Strings;
}) {
  const text = formatJobs(jobs);
  const [draft, setDraft] = useState(text);
  // only overwrite what the user is typing when the jobs changed from elsewhere
  useEffect(() => setDraft((d) => (formatJobs(parseJobs(d).jobs) === text ? d : text)), [text]);
  const parsed = parseJobs(draft);
  const invalid = parsed.bad.length > 0 || parsed.jobs.length === 0;

  const patch = (i: number, p: Partial<Job>) => onChange(jobs.map((j, k) => (k === i ? { ...j, ...p } : j)));

  return (
    <Field label={s.jobs} hint={`${jobs.length}/${LIMITS.jobs}`}>
      <div className="overflow-hidden rounded-xl border border-line">
        <div className="grid grid-cols-[2.25rem_1fr_1fr_1fr_2rem] items-center gap-1.5 border-b border-line bg-sunken px-2 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
          <span />
          <span className="text-center">{s.arrival}</span>
          <span className="text-center">{s.length}</span>
          <span className="text-center" title={s.ioFreqTitle}>
            {s.ioFreq}
          </span>
          <span />
        </div>
        <AnimatePresence initial={false}>
          {jobs.map((job, i) => (
            <motion.div
              key={i}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={spring}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              className={clsx('grid grid-cols-[2.25rem_1fr_1fr_1fr_2rem] items-center gap-1.5 px-2 py-1 transition-colors duration-200', hover === i && 'bg-chip')}
            >
              <span
                className={clsx(
                  'grid size-6 place-items-center rounded-md font-mono text-[11.5px] font-semibold text-surface transition-shadow',
                  jobBg(i),
                  hover === i && clsx('ring-2 ring-offset-1 ring-offset-surface', jobRing(i)),
                )}
              >
                {jobName(i)}
              </span>
              <Cell label={`${jobName(i)} ${s.arrival}`} value={job.arrival} min={0} max={LIMITS.arrival} onChange={(arrival) => patch(i, { arrival })} />
              <Cell label={`${jobName(i)} ${s.length}`} value={job.length} min={1} max={LIMITS.length} onChange={(length) => patch(i, { length })} />
              <Cell label={`${jobName(i)} ${s.ioFreq}`} value={job.ioFreq} min={0} max={LIMITS.ioFreq} onChange={(ioFreq) => patch(i, { ioFreq })} />
              <button
                type="button"
                aria-label={s.removeJob(jobName(i))}
                title={s.removeJob(jobName(i))}
                disabled={jobs.length <= 1}
                onClick={() => {
                  setHover(null);
                  onChange(jobs.filter((_, k) => k !== i));
                }}
                className="grid size-7 place-items-center rounded-md text-ink-3 transition-colors hover:bg-bad-soft hover:text-bad disabled:pointer-events-none disabled:opacity-30"
              >
                <Icons.x className="size-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
        <div className="border-t border-line p-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="w-full"
            icon={<Icons.plus className="size-3.5" />}
            disabled={jobs.length >= LIMITS.jobs}
            onClick={() => {
              const last = jobs.at(-1);
              onChange([...jobs, { arrival: last?.arrival ?? 0, length: last?.length ?? 10, ioFreq: 0 }]);
            }}
          >
            {s.addJob}
          </Button>
        </div>
      </div>

      <div className="mt-2.5">
        <div className="mb-1 flex items-baseline justify-between gap-2 text-[11.5px] text-ink-3">
          <span>{s.jobsText}</span>
          <span className="truncate">{s.jobsTextHint}</span>
        </div>
        <TextField
          value={draft}
          ariaLabel={s.jobsText}
          invalid={invalid}
          onChange={(v) => {
            setDraft(v);
            const p = parseJobs(v);
            if (p.bad.length === 0 && p.jobs.length > 0) onChange(p.jobs);
          }}
        />
        {invalid && <p className="mt-1.5 animate-rise text-[12px] text-bad">{s.badJobs(parsed.bad)}</p>}
      </div>
    </Field>
  );
}
