import clsx from 'clsx';
import { motion } from 'motion/react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Bench,
  Button,
  Explain,
  Field,
  Icons,
  LangProvider,
  Narration,
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
} from '../../components/kit';
import type { Lang } from '../../lib/i18n';
import { PRESETS, SHELL_PID, TTY_PATH, parseCommandLine, randomCommand, simulatePipes, straceCommand, type ParseError, type PresetId, type Stage } from '../../sim/pipes';
import { Diagram, PC, type Hover } from './Diagram';
import { S, type PipesStrings } from './strings';

const DEFAULTS = {
  cmd: PRESETS.three as string,
  forget: false,
  parent: false,
  data: true,
};

export default function PipesPlayground({ lang }: { lang: Lang }) {
  return (
    <LangProvider lang={lang}>
      <Pipes />
    </LangProvider>
  );
}

function errorText(e: ParseError, s: PipesStrings): string {
  const E = s.errors;
  switch (e.code) {
    case 'empty':
      return E.empty;
    case 'pipeStart':
      return E.pipeStart;
    case 'pipeEnd':
      return E.pipeEnd;
    case 'emptyStage':
      return E.emptyStage(e.n);
    case 'noCommand':
      return E.noCommand(e.n);
    case 'missingFile':
      return E.missingFile(e.op);
    case 'unsupported':
      return E.unsupported(e.op);
    case 'quote':
      return E.quote;
    case 'badFd':
      return E.badFd(e.fd);
    case 'badDup':
      return E.badDup(e.op);
    case 'tooMany':
      return E.tooMany(e.max);
  }
}

const FALLBACK = (parseCommandLine(PRESETS.three) as { ok: true; stages: Stage[] }).stages;

function Pipes() {
  const s = useStrings(S);
  const t = useUi();
  const [cfg, set, reset] = useUrlState(DEFAULTS);
  const parsed = useMemo(() => parseCommandLine(cfg.cmd), [cfg.cmd]);
  const lastGood = useRef<Stage[]>(FALLBACK);
  if (parsed.ok) lastGood.current = parsed.stages;
  const stages = parsed.ok ? parsed.stages : lastGood.current;
  const run = useMemo(() => simulatePipes({ stages, forgetClose: cfg.forget, redirectInParent: cfg.parent, data: cfg.data }), [stages, cfg.forget, cfg.parent, cfg.data]);
  const stepper = useStepper(run.steps.length, { startAt: 'first' });
  const [hover, setHover] = useState<Hover>(null);

  const cur = stepper.index > 0 ? run.steps[stepper.index - 1] : undefined;
  const state = cur?.state ?? run.initial;
  const stats = cur?.stats ?? run.initialStats;

  const fileLabel = (id: string | null) => {
    if (!id) return s.closed;
    const fi = run.fileInfo[id];
    if (!fi) return id;
    const o = run.objInfo[fi.obj];
    if (o.kind === 'tty') return TTY_PATH;
    if (o.kind === 'pipe') return `pipe ${o.n} · ${fi.end === 'r' ? s.readEnd : s.writeEnd}`;
    return o.name;
  };
  const fileShort = (id: string | null) => {
    if (!id) return s.closed;
    const fi = run.fileInfo[id];
    if (!fi) return id;
    const o = run.objInfo[fi.obj];
    if (o.kind === 'tty') return s.term;
    if (o.kind === 'pipe') return `pipe ${o.n} · ${fi.end}`;
    return o.name;
  };

  const activePreset = (Object.keys(PRESETS) as PresetId[]).find((id) => PRESETS[id] === cfg.cmd.trim());
  const ctx = { who: cur?.who ?? 'sh', file: fileLabel, parentDup: cfg.parent };

  // Practice, computed from the current setup.
  const before = run.shellFdsBeforeWait;
  const lastReader = run.pipeCount > 0 ? stages[run.pipeCount].argv[0] : '';

  const setup = (
    <Panel
      title={t.setup}
      actions={
        <Button size="sm" variant="ghost" icon={<Icons.reset className="size-3.5" />} onClick={reset}>
          {t.reset}
        </Button>
      }
      bodyClassName="p-4"
      footer={<Explain>{s.explain}</Explain>}
    >
      <Field primary label={s.preset}>
        <Segmented
          size="sm"
          value={activePreset ?? ('' as PresetId)}
          options={(Object.keys(PRESETS) as PresetId[]).map((id) => ({ value: id, label: s.presets[id] }))}
          onChange={(id) => set({ cmd: PRESETS[id] })}
        />
      </Field>
      <Field label={s.cmd} hint={s.cmdHint} error={!parsed.ok && errorText(parsed.error, s)}>
        <TextField value={cfg.cmd} onChange={(cmd) => set({ cmd })} invalid={!parsed.ok} ariaLabel={s.cmd} />
      </Field>
      <div className="mb-4 space-y-3 rounded-xl border border-line p-3">
        <div>
          <Toggle checked={cfg.forget} onChange={(forget) => set({ forget })} label={<span className={clsx(cfg.forget && 'font-medium text-bad')}>{s.forget}</span>} />
          <p className="mt-0.5 text-[11.5px] text-ink-3">{s.forgetHint}</p>
        </div>
        <div>
          <Toggle checked={cfg.parent} onChange={(parent) => set({ parent })} label={<span className={clsx(cfg.parent && 'font-medium text-bad')}>{s.parent}</span>} />
          <p className="mt-0.5 text-[11.5px] text-ink-3">{s.parentHint}</p>
        </div>
        <div>
          <Toggle checked={cfg.data} onChange={(data) => set({ data })} label={s.data} />
          <p className="mt-0.5 text-[11.5px] text-ink-3">{s.dataHint}</p>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button icon={<Icons.dice className="size-3.5" />} onClick={() => set({ cmd: randomCommand(Math.floor(Math.random() * 1e9)) })}>
          {t.random}
        </Button>
        <ShareButton />
      </div>
      <Field label={s.tryIt}>
        <code className="block select-all break-all rounded-lg bg-sunken px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink-2">{straceCommand(stages.map((st) => st.text).join(' | '))}</code>
      </Field>
    </Panel>
  );

  const finalHang = run.hang && stepper.index === stepper.total;

  return (
    <Bench setup={setup} watch={3}>
      <Panel
        title={t.stepOf(stepper.index, stepper.total)}
        actions={
          <>
            {cfg.forget && <Badge tone="bad">close()</Badge>}
            {cfg.parent && <Badge tone="bad">dup2 ↑ fork</Badge>}
            {finalHang && <Badge tone="bad">{s.hangBadge}</Badge>}
          </>
        }
      >
        <StepControls stepper={stepper} />

        {/* pipeline: one chip per process */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5 font-mono text-[12px]">
          <button
            type="button"
            onMouseEnter={() => setHover({ k: 'proc', pid: SHELL_PID })}
            onMouseLeave={() => setHover(null)}
            className={clsx('flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-ink-2 transition-colors hover:bg-chip', cur?.pid === SHELL_PID && 'bg-chip')}
          >
            <span className={clsx('size-2 rounded-full', PC.bg[1])} />
            sh {SHELL_PID}
          </button>
          <span className="text-ink-3">$</span>
          {stages.map((st, i) => {
            const pid = SHELL_PID + 1 + i;
            const color = Math.min(6, i + 2);
            return (
              <Fragment key={i}>
                {i > 0 && <span className="text-ink-3">|</span>}
                <button
                  type="button"
                  onMouseEnter={() => setHover({ k: 'proc', pid })}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => {
                    const j = run.steps.findIndex((x) => x.pid === pid);
                    if (j >= 0) stepper.setIndex(j + 1);
                  }}
                  className={clsx('flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-ink transition-colors hover:bg-chip', cur?.pid === pid && clsx('ring-2', PC.ring[color]))}
                >
                  <span className={clsx('size-2 rounded-full', PC.bg[color])} />
                  {st.text}
                </button>
              </Fragment>
            );
          })}
        </div>

        {/* the current syscall */}
        <div className="mt-3 flex min-h-11 items-center gap-2 overflow-x-auto rounded-xl border border-line bg-sunken px-3 py-2 font-mono text-[13px]">
          {cur ? (
            <>
              <span className={clsx('size-2.5 shrink-0 rounded-full', PC.bg[cur.color])} />
              <span className="shrink-0 text-ink-3">[{cur.pid}]</span>
              <span className={clsx('shrink-0 font-semibold', PC.text[cur.color])}>{cur.who}</span>
              <motion.span
                key={stepper.index}
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                className="whitespace-nowrap text-ink"
              >
                {cur.call}
                {cur.ret && <span className={clsx(cur.ret === '…' || cur.ret.startsWith('-1') ? 'text-bad' : 'text-ink-3')}> = {cur.ret}</span>}
              </motion.span>
            </>
          ) : (
            <span className="whitespace-nowrap text-ink-3">$ {stages.map((st) => st.text).join(' | ')}</span>
          )}
        </div>

        <div className="mt-4">
          <Diagram
            state={state}
            step={cur}
            stepIndex={stepper.index}
            s={s}
            fileLabel={fileLabel}
            fileShort={fileShort}
            hover={hover}
            setHover={setHover}
            onJump={(i) => stepper.setIndex(i)}
          />
        </div>

        <div className="mt-4">
          {cur ? (
            <Narration key={stepper.index} tone={cur.tone}>
              <span className="font-sans text-[13.5px] leading-relaxed">{s.note(cur.note, ctx)}</span>
            </Narration>
          ) : (
            <Narration>
              <span className="font-sans text-[13.5px] leading-relaxed">{s.start}</span>
            </Narration>
          )}
          {cur && cur.deltas.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.07em] text-ink-3">{s.changed}</span>
              {cur.deltas.map((d) => (
                <button
                  key={d.file}
                  type="button"
                  onMouseEnter={() => setHover({ k: 'file', id: d.file })}
                  onMouseLeave={() => setHover(null)}
                  className={clsx('rounded-full px-2 py-0.5 font-mono text-[11.5px] animate-rise', d.to > d.from ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad')}
                >
                  {fileLabel(d.file)}: {d.from} → {d.to}
                  {d.to === 0 && ` (${s.freed})`}
                </button>
              ))}
            </div>
          )}
        </div>
      </Panel>

      <Panel bodyClassName="p-0">
        <StatGrid cols={4}>
          <Stat label={s.syscalls} value={stats.syscalls} />
          <Stat label={s.pipes} value={stats.pipes} sub={`/ ${run.pipeCount}`} tone="info" />
          <Stat label={s.openFds} value={stats.openFds} tone="accent" />
          <Stat label={s.procs} value={stats.procs} />
        </StatGrid>
      </Panel>

      <SyscallLog run={run} index={stepper.index} s={s} onJump={(i) => stepper.setIndex(i)} setHover={setHover} />

      <Panel title={s.practice}>
        <div className="grid gap-3 md:grid-cols-2">
          <Reveal question={s.q1}>
            {s.a1(
              before.length,
              before.map((x) => `fd ${x.fd} → ${fileLabel(x.file)}`).join(', '),
              before.length > 3,
              before.some((x) => x.fd <= 2 && x.file !== 'tty'),
            )}
          </Reveal>
          {run.pipeCount > 0 ? <Reveal question={s.q2(lastReader, run.pipeCount)}>{s.a2(lastReader)}</Reveal> : <Reveal question={s.q2b}>{s.a2b}</Reveal>}
          <Reveal question={s.q3}>{s.a3(run.ttyRefAfterLastFork)}</Reveal>
        </div>
      </Panel>
    </Bench>
  );
}

function SyscallLog({
  run,
  index,
  s,
  onJump,
  setHover,
}: {
  run: ReturnType<typeof simulatePipes>;
  index: number;
  s: PipesStrings;
  onJump: (i: number) => void;
  setHover: (h: Hover) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    const row = el?.querySelector<HTMLElement>(`[data-row="${index}"]`);
    if (!el || !row) return;
    el.scrollTo({ top: row.offsetTop - el.clientHeight / 2 + row.offsetHeight / 2, behavior: 'smooth' });
  }, [index]);
  return (
    <Panel title={s.log} actions={<span className="hidden text-[11px] text-ink-3 sm:inline">{s.logHint}</span>} bodyClassName="p-0">
      <div ref={box} className="relative max-h-[320px] overflow-y-auto py-1" onMouseLeave={() => setHover(null)}>
        {run.steps.map((st, i) => {
          const n = i + 1;
          const newPhase = i === 0 || run.steps[i - 1].phase !== st.phase;
          return (
            <Fragment key={i}>
              {newPhase && <div className="px-4 pb-1 pt-2 font-mono text-[10.5px] uppercase tracking-[0.07em] text-ink-3">{s.phases[st.phase]}</div>}
              <button
                type="button"
                data-row={n}
                onClick={() => onJump(n)}
                onMouseEnter={() => setHover({ k: 'proc', pid: st.pid })}
                className={clsx(
                  'flex w-full items-center gap-2 px-4 py-[3px] text-left font-mono text-[12px] transition-colors duration-150',
                  n === index ? 'bg-accent-soft' : 'hover:bg-chip',
                  n > index && 'opacity-55',
                )}
              >
                <span className="w-6 shrink-0 text-right text-[10.5px] text-ink-3">{n}</span>
                <span className={clsx('size-2 shrink-0 rounded-full', PC.bg[st.color])} />
                <span className="w-[74px] shrink-0 truncate text-ink-2">
                  {st.pid} {st.who}
                </span>
                <span className={clsx('truncate', st.tone === 'bad' ? 'text-bad' : st.tone === 'warn' ? 'text-warn' : 'text-ink')}>
                  {st.call}
                  {st.ret && <span className="text-ink-3"> = {st.ret}</span>}
                </span>
              </button>
            </Fragment>
          );
        })}
      </div>
    </Panel>
  );
}
