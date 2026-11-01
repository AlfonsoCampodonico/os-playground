import clsx from 'clsx';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Badge,
  Bench,
  Button,
  Explain,
  Field,
  Icons,
  LangProvider,
  Narration,
  NumberField,
  Panel,
  Reveal,
  Segmented,
  ShareButton,
  Stat,
  StatGrid,
  StepControls,
  TextField,
  Toggle,
  useStepper,
  useStrings,
  useUi,
  useUrlState,
  type Tone,
} from '../../components/kit';
import type { Lang } from '../../lib/i18n';
import {
  LIMITS,
  POLICIES,
  PRESETS,
  PRESET_IDS,
  compareAll,
  formatGen,
  formatJobs,
  formatList,
  genJobs,
  jobName,
  ostepCommand,
  parseGen,
  parseJobs,
  parseList,
  parseOstepFlags,
  presetConfig,
  pyFixed,
  simulate,
  type Gen,
  type Job,
  type Policy,
  type PresetId,
  type SchedConfig,
  type SchedEvent,
  type SchedStep,
} from '../../sim/scheduling';
import { Gantt } from './Gantt';
import { JobsEditor } from './JobsEditor';
import { Compare, MetricsTable } from './Metrics';
import { QueueView } from './QueueView';
import { S, type Strings } from './strings';

const DEFAULT_JOBS: Job[] = PRESETS.fifo.jobs;

const DEFAULTS = {
  policy: 'fifo' as string,
  jobs: formatJobs(DEFAULT_JOBS),
  q: 1,
  qs: '10,10,10',
  as: '1,1,1',
  boost: 0,
  io: 5,
  stay: false,
  bump: false,
  /** Seed-generated problem: "s<seed>,<jobs>,<maxlen>" (scheduler.py) or "m<seed>,<jobs>,<maxlen>,<maxio>" (mlfq.py). */
  gen: '',
};
type Url = typeof DEFAULTS;

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : lo);

function configOf(u: Url): SchedConfig {
  const policy = (POLICIES as string[]).includes(u.policy) ? (u.policy as Policy) : 'fifo';
  const parsed = parseJobs(u.jobs);
  const jobs = parsed.bad.length === 0 && parsed.jobs.length > 0 ? parsed.jobs : DEFAULT_JOBS;
  const quanta = (parseList(u.qs, 1, LIMITS.quantum) ?? [10, 10, 10]).slice(0, LIMITS.queues);
  const a = parseList(u.as, 1, LIMITS.allotment) ?? [1];
  const allotments = quanta.map((_, i) => a[i] ?? a[a.length - 1]);
  return {
    policy,
    jobs,
    quantum: clamp(u.q, 1, LIMITS.quantum),
    ioTime: clamp(u.io, 1, LIMITS.ioTime),
    mlfq: { quanta, allotments, boost: clamp(u.boost, 0, LIMITS.boost), stay: u.stay, iobump: u.bump },
  };
}

function urlOf(cfg: SchedConfig): Partial<Url> {
  return {
    policy: cfg.policy,
    jobs: formatJobs(cfg.jobs),
    q: cfg.quantum,
    qs: formatList(cfg.mlfq.quanta),
    as: formatList(cfg.mlfq.allotments),
    boost: cfg.mlfq.boost,
    io: cfg.ioTime,
    stay: cfg.mlfq.stay,
    bump: cfg.mlfq.iobump,
  };
}

function sameJobs(a: Job[], b: Job[]) {
  return formatJobs(a) === formatJobs(b);
}

function matchesPreset(id: PresetId, cfg: SchedConfig): boolean {
  const p = presetConfig(id);
  if (p.policy !== cfg.policy || !sameJobs(p.jobs, cfg.jobs)) return false;
  if (p.policy === 'rr') return p.quantum === cfg.quantum;
  if (p.policy === 'mlfq') return urlOf(p).qs === urlOf(cfg).qs && urlOf(p).as === urlOf(cfg).as && p.mlfq.boost === cfg.mlfq.boost && p.mlfq.stay === cfg.mlfq.stay && p.mlfq.iobump === cfg.mlfq.iobump && p.ioTime === cfg.ioTime;
  return !cfg.jobs.some((j) => j.ioFreq > 0) || p.ioTime === cfg.ioTime;
}

const policyLabel = (p: Policy, q: number) => (p === 'rr' ? `RR q=${q}` : p.toUpperCase());

export default function SchedulingPlayground({ lang }: { lang: Lang }) {
  return (
    <LangProvider lang={lang}>
      <Scheduling />
    </LangProvider>
  );
}

function Scheduling() {
  const s = useStrings(S);
  const t = useUi();
  const [u, set, reset] = useUrlState(DEFAULTS);
  const cfg = useMemo(() => configOf(u), [u]);
  const run = useMemo(() => simulate(cfg), [cfg]);
  const all = useMemo(() => compareAll(cfg), [cfg]);
  const rr2 = useMemo(() => simulate({ ...cfg, policy: 'rr', quantum: 2 }), [cfg]);
  const stepper = useStepper(run.steps.length, { startAt: 'first' });
  const [hover, setHover] = useState<number | null>(null);
  const [flags, setFlags] = useState('');
  const [flagErr, setFlagErr] = useState<string | null>(null);

  const step: SchedStep = stepper.index > 0 ? run.steps[stepper.index - 1] : run.initial;
  const { policy, jobs } = cfg;
  const gen = useMemo((): Gen | null => {
    const kind = u.gen[0] === 'm' ? 'mlfq' : u.gen[0] === 's' ? 'scheduler' : null;
    if (!kind || (kind === 'mlfq') !== (policy === 'mlfq')) return null;
    return parseGen(u.gen.slice(1));
  }, [u.gen, policy]);
  const cmd = ostepCommand({ ...cfg, gen });
  const hasIo = jobs.some((j) => j.ioFreq > 0);
  const activePreset = PRESET_IDS.find((id) => matchesPreset(id, cfg));

  const setJobs = (js: Job[]) => set({ jobs: formatJobs(js) });
  const setQueues = (quanta: number[], allotments: number[]) => set({ qs: formatList(quanta), as: formatList(allotments) });

  const applyFlags = () => {
    const p = parseOstepFlags(flags);
    if (!p.ok) {
      setFlagErr(s.flagError(p.error));
      return;
    }
    setFlagErr(null);
    const v = p.value;
    const g = v.gen ? (v.kind === 'mlfq' ? 'm' : 's') + formatGen(v.gen, v.kind) : '';
    if (v.kind === 'scheduler') set({ policy: v.policy, jobs: formatJobs(v.jobs), q: v.quantum ?? u.q, gen: g });
    else if (v.mlfq) set({ ...urlOf({ ...cfg, policy: 'mlfq', jobs: v.jobs, ioTime: v.ioTime ?? 5, mlfq: v.mlfq }), gen: g });
  };

  const randomize = () => {
    const seed = Math.floor(Math.random() * 1000);
    if (policy === 'mlfq') {
      const g: Gen = { seed, count: 3, maxlen: 100, maxio: 10 };
      set({ jobs: formatJobs(genJobs(g, 'mlfq')), gen: 'm' + formatGen(g, 'mlfq') });
    } else {
      const g: Gen = { seed, count: 3 + Math.floor(Math.random() * 3), maxlen: 10, maxio: 10 };
      set({ jobs: formatJobs(genJobs(g, 'scheduler')), gen: 's' + formatGen(g, 'scheduler') });
    }
  };

  /* ---------- setup ---------- */

  const presetRow = (chapter: 7 | 8) => {
    const ids = PRESET_IDS.filter((id) => PRESETS[id].chapter === chapter);
    return (
      <Field primary label={chapter === 7 ? s.presetsCh7 : s.presetsCh8}>
        <Segmented
          size="sm"
          value={activePreset && ids.includes(activePreset) ? activePreset : ('' as PresetId)}
          options={ids.map((id) => ({ value: id, label: s.presets[id], title: s.presetTitles[id] }))}
          onChange={(id) => set({ ...urlOf(presetConfig(id)), gen: '' })}
        />
      </Field>
    );
  };

  const n = cfg.mlfq.quanta.length;
  const setup = (
    <Panel
      title={t.setup}
      actions={
        <Button size="sm" variant="ghost" icon={<Icons.reset className="size-3.5" />} onClick={reset}>
          {t.reset}
        </Button>
      }
      footer={<Explain>{s.explain}</Explain>}
    >
      {presetRow(7)}
      {presetRow(8)}

      <Field primary label={s.policy}>
        <Segmented value={policy} options={POLICIES.map((p) => ({ value: p, label: p.toUpperCase(), title: s.policyTitles[p] }))} onChange={(p) => set({ policy: p })} />
      </Field>

      {policy === 'rr' && (
        <Field label={s.quantum} hint="-q">
          <NumberField value={cfg.quantum} min={1} max={LIMITS.quantum} onChange={(q) => set({ q })} ariaLabel={s.quantum} />
        </Field>
      )}

      {policy === 'mlfq' && (
        <div className="mb-4 animate-rise rounded-xl border border-line bg-sunken/50 p-3">
          <Field label={s.queues} hint="-n">
            <NumberField
              value={n}
              min={1}
              max={LIMITS.queues}
              ariaLabel={s.queues}
              onChange={(k) => {
                const grow = <T,>(xs: T[]) => Array.from({ length: k }, (_, i) => xs[i] ?? xs[xs.length - 1]);
                setQueues(grow(cfg.mlfq.quanta), grow(cfg.mlfq.allotments));
              }}
            />
          </Field>
          <Field label={s.perLevel} hint="-Q · -A">
            <div className="space-y-1.5">
              <div className="grid grid-cols-[4.5rem_1fr_1fr] gap-2 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
                <span />
                <span className="text-center">quantum</span>
                <span className="text-center">allotment</span>
              </div>
              {cfg.mlfq.quanta.map((qv, k) => (
                <div key={k} className="grid grid-cols-[4.5rem_1fr_1fr] items-center gap-2">
                  <span className="font-mono text-[11.5px] text-ink-2">{s.level(n - 1 - k, k === 0 && n > 1, k === n - 1 && n > 1)}</span>
                  <NumberField
                    value={qv}
                    min={1}
                    max={LIMITS.quantum}
                    ariaLabel={`Q${n - 1 - k} quantum`}
                    onChange={(v) => setQueues(cfg.mlfq.quanta.map((x, i) => (i === k ? v : x)), cfg.mlfq.allotments)}
                  />
                  <NumberField
                    value={cfg.mlfq.allotments[k]}
                    min={1}
                    max={LIMITS.allotment}
                    ariaLabel={`Q${n - 1 - k} allotment`}
                    onChange={(v) => setQueues(cfg.mlfq.quanta, cfg.mlfq.allotments.map((x, i) => (i === k ? v : x)))}
                  />
                </div>
              ))}
              <p className="text-[11.5px] text-ink-3">{s.allotHint}</p>
            </div>
          </Field>
          <Field label={s.boost} hint={s.boostHint}>
            <NumberField value={cfg.mlfq.boost} min={0} max={LIMITS.boost} step={10} onChange={(boost) => set({ boost })} ariaLabel={s.boost} />
          </Field>
          <div className="space-y-2.5">
            <Toggle checked={cfg.mlfq.stay} onChange={(stay) => set({ stay })} label={s.stay} />
            <Toggle checked={cfg.mlfq.iobump} onChange={(bump) => set({ bump })} label={s.iobump} />
          </div>
        </div>
      )}

      <JobsEditor jobs={jobs} onChange={setJobs} hover={hover} setHover={setHover} s={s} />

      {(policy === 'mlfq' || hasIo) && (
        <Field label={s.ioTime} hint={s.ioTimeHint}>
          <NumberField value={cfg.ioTime} min={1} max={LIMITS.ioTime} onChange={(io) => set({ io })} ariaLabel={s.ioTime} />
        </Field>
      )}

      <div className={clsx('mb-4 rounded-xl border px-3 py-2.5', cmd.ok ? 'border-line bg-sunken' : 'border-transparent bg-warn-soft')}>
        <div className="mb-1 flex items-center gap-2 text-[12px] font-medium text-ink-2">
          <span className={clsx('size-1.5 rounded-full', cmd.ok ? 'bg-ok' : 'bg-warn')} />
          {s.ostep}
        </div>
        {cmd.ok ? <code className="block break-all font-mono text-[12px] leading-relaxed text-ink">{cmd.cmd}</code> : <p className="text-[12.5px] text-warn">{s.ext[cmd.reason]}</p>}
      </div>

      <Field label={s.paste} error={flagErr}>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1" onKeyDown={(e) => e.key === 'Enter' && applyFlags()}>
            <TextField
              value={flags}
              placeholder={s.pastePh}
              invalid={flagErr !== null}
              ariaLabel={s.paste}
              onChange={(v) => {
                setFlags(v);
                setFlagErr(null);
              }}
            />
          </div>
          <Button onClick={applyFlags} disabled={flags.trim() === ''}>
            {s.apply}
          </Button>
        </div>
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button icon={<Icons.dice className="size-3.5" />} onClick={randomize}>
          {t.random}
        </Button>
        <ShareButton />
      </div>
    </Panel>
  );

  /* ---------- machine ---------- */

  const finishedNow = jobs.map((_, j) => j).filter((j) => step.completion[j] !== null);
  const startedNow = jobs.map((_, j) => j).filter((j) => step.firstRun[j] !== null);
  const avg = (xs: number[]) => (xs.length ? pyFixed(xs.reduce((a, b) => a + b, 0) / xs.length) : '—');
  const done = (j: number) => run.results[j]!;

  const rrLast = rr2.results.reduce<{ j: number; c: number } | null>((best, r, j) => (r && (!best || r.completion > best.c) ? { j, c: r.completion } : best), null);

  return (
    <Bench setup={setup}>
      <Panel
        title={t.stepOf(stepper.index, stepper.total)}
        actions={<Badge tone="accent">{policy === 'mlfq' ? `MLFQ · ${n}Q` : policyLabel(policy, cfg.quantum)}</Badge>}
        footer={
        <StatGrid cols={4}>
          <Stat label={s.avgTurnaround} value={avg(finishedNow.map((j) => done(j).turnaround))} tone="accent" sub={s.ofDone(finishedNow.length, jobs.length)} />
          <Stat label={s.avgResponse} value={avg(startedNow.map((j) => step.firstRun[j]! - jobs[j].arrival))} tone="info" sub={s.ofStarted(startedNow.length, jobs.length)} />
          <Stat label={s.avgWait} value={avg(finishedNow.map((j) => done(j).wait))} sub={s.ofDone(finishedNow.length, jobs.length)} />
          <Stat label={<span title={s.switchesTitle}>{s.switches}</span>} value={step.switches} sub={`${run.switches} total`} />
        </StatGrid>
        }
      >
        <StepControls stepper={stepper} />

        <div className="mt-4">
          {stepper.index === 0 ? (
            <Narration>{s.startNarr}</Narration>
          ) : (
            <Narration key={stepper.index} tone={toneOf(step)}>
              {narrate(step, s, policy === 'mlfq')}
            </Narration>
          )}
          {run.truncated && <p className="mt-2 text-[12px] text-warn">{s.truncated(run.makespan)}</p>}
        </div>

        <div className="mt-5">
          <Gantt run={run} jobs={jobs} index={stepper.index} hover={hover} setHover={setHover} onSeek={stepper.setIndex} s={s} />
        </div>

        <div className="mt-5">
          <QueueView run={run} step={step} jobs={jobs} mlfq={cfg.mlfq} hover={hover} setHover={setHover} s={s} />
        </div>
        <div className="h-4" />
      </Panel>


      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title={s.metrics} bodyClassName="p-0" footer={<p className="px-4 py-2.5 text-[11.5px] leading-relaxed text-ink-3">{s.metricsHint}</p>}>
          <MetricsTable jobs={jobs} run={run} step={step} hover={hover} setHover={setHover} onSeek={stepper.setIndex} s={s} />
        </Panel>
        <Panel title={s.compare} footer={hasIo ? <p className="px-4 py-2.5 text-[11.5px] text-ink-3">{s.compareIo}</p> : undefined}>
          <p className="mb-3 text-[12.5px] text-ink-3">{s.compareHint}</p>
          <Compare all={all} policy={policy} quantum={cfg.quantum} onPick={(p) => set({ policy: p })} s={s} />
        </Panel>
      </div>

      <Panel title={s.practice}>
        <div className="grid gap-3 md:grid-cols-3">
          <Reveal key={`p1${u.jobs}`} question={s.pq1}>
            {s.pa1(pyFixed(all.sjf.avg.turnaround), pyFixed(all.fifo.avg.turnaround), pyFixed(all.stcf.avg.turnaround))}
          </Reveal>
          <Reveal key={`p2${u.jobs}`} question={s.pq2}>
            {rrLast ? s.pa2(jobName(rrLast.j), rrLast.c) : '—'}
          </Reveal>
          <Reveal key={`p3${u.jobs}${policy}`} question={s.pq3(policy === 'mlfq' ? 'MLFQ' : policyLabel(policy, cfg.quantum))}>
            {s.pa3(run.results.map((r, j) => `${jobName(j)}: ${r ? r.response : '—'}`).join(' · '), pyFixed(run.avg.response))}
          </Reveal>
        </div>
      </Panel>
    </Bench>
  );
}

function toneOf(step: SchedStep): Tone {
  const ev = [...step.pre, ...step.post].map((e) => e.k);
  if (ev.includes('finish')) return 'ok';
  if (ev.includes('preempt') || ev.includes('demote') || ev.includes('boost')) return 'warn';
  if (step.running === null) return 'neutral';
  return 'info';
}

function narrate(step: SchedStep, s: Strings, mlfq: boolean): ReactNode {
  const N = s.narr;
  const say = (e: SchedEvent): string => {
    switch (e.k) {
      case 'arrive':
        return N.arrive(jobName(e.job));
      case 'ioDone':
        return N.ioDone(jobName(e.job), e.bump);
      case 'boost':
        return N.boost;
      case 'slice':
        return N.slice(jobName(e.job));
      case 'preempt':
        return N.preempt(jobName(e.job), jobName(e.by));
      case 'idle':
        return N.idle;
      case 'finish':
        return N.finish(jobName(e.job), step.t + 1);
      case 'ioStart':
        return N.ioStart(jobName(e.job), e.until);
      case 'demote':
        return N.demote(jobName(e.job), e.from, e.to);
      case 'requeue':
        return N.requeue(jobName(e.job), e.level, e.bottom);
    }
  };
  const parts: ReactNode[] = [<span key="t" className="opacity-70">{N.t(step.t)}</span>];
  step.pre.forEach((e, i) => parts.push(<span key={`p${i}`}>{say(e)}</span>));
  if (step.running !== null)
    parts.push(
      <b key="run" className="font-semibold">
        {mlfq && step.level !== null ? N.runAt(jobName(step.running), step.level) : N.run(jobName(step.running))}
      </b>,
    );
  step.post.forEach((e, i) => parts.push(<span key={`q${i}`}>{say(e)}</span>));
  return parts.flatMap((p, i) => (i === 0 ? [p] : [<span key={`a${i}`} className="opacity-50">→</span>, p]));
}
