import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  Toggle,
  useStepper,
  useStrings,
  useUi,
  useUrlState,
  type Tone,
} from '../../components/kit';
import type { Lang } from '../../lib/i18n';
import {
  MAX_COMPUTE,
  MAX_OPS,
  PIDS,
  PRESETS,
  encodeProgram,
  parseProgram,
  randomProblem,
  simulateSyscalls,
  type Lane,
  type Op,
  type OpKind,
  type PresetId,
  type Snapshot,
  type Step,
  type SyscallsRun,
} from '../../sim/syscalls';
import { Console, CpuExtras, ModeBit, PidTag, ProcCard, Registers, TrapTable, spring, type Hover } from './Machine';
import { S, type Ctx, type Strings } from './strings';

const DEFAULTS = {
  prog: PRESETS.write.prog as string,
  boot: PRESETS.write.boot as boolean,
  timer: PRESETS.write.timer as number,
  disk: PRESETS.write.disk as number,
};

export default function SyscallsPlayground({ lang }: { lang: Lang }) {
  return (
    <LangProvider lang={lang}>
      <Syscalls />
    </LangProvider>
  );
}

function toneOf(st: Step): Tone {
  if (st.kind === 'hw-fault' || st.kind === 'user-priv' || st.kind === 'os-kill') return 'bad';
  if (st.lane === 'user') return 'info';
  if (st.kind === 'hw-trap' || st.kind === 'hw-irq') return 'warn';
  if (st.kind === 'hw-rft') return 'ok';
  if (st.lane === 'os') return 'accent';
  return 'neutral';
}

function Syscalls() {
  const s = useStrings(S);
  const t = useUi();
  const [cfg, set, reset] = useUrlState(DEFAULTS);
  const program = useMemo(() => parseProgram(cfg.prog), [cfg.prog]);
  const run = useMemo(() => simulateSyscalls({ program, boot: cfg.boot, timer: cfg.timer, disk: cfg.disk }), [program, cfg.boot, cfg.timer, cfg.disk]);
  const stepper = useStepper(run.steps.length, { startAt: 'first' });
  const [hover, setHover] = useState<Hover | null>(null);

  const cur: Step | undefined = stepper.index > 0 ? run.steps[stepper.index - 1] : undefined;
  const snap: Snapshot = cur ?? run.initial;
  const prev: Snapshot = stepper.index > 1 ? run.steps[stepper.index - 2] : run.initial;
  const last = run.steps.at(-1);
  const ctx: Ctx = { T: cfg.timer };
  const hasRead = program.some((o) => o.kind === 'read');
  const hasPriv = program.some((o) => o.kind === 'priv');

  const activePreset = (Object.keys(PRESETS) as PresetId[]).find((id) => {
    const p = PRESETS[id];
    return p.prog === cfg.prog && p.boot === cfg.boot && p.timer === cfg.timer && (!hasRead || p.disk === cfg.disk);
  });

  /** Next step (after the current one, wrapping) matching `pred`. */
  const jumpTo = (pred: (st: Step) => boolean) => {
    const n = run.steps.length;
    for (let k = 1; k <= n; k++) {
      const i = (stepper.index - 1 + k + n) % n;
      if (pred(run.steps[i])) {
        stepper.setIndex(i + 1);
        return;
      }
    }
  };

  const setOps = (ops: Op[]) => set({ prog: encodeProgram(ops) });
  const addOp = (kind: OpKind) => {
    if (program.length >= MAX_OPS) return;
    const op: Op = { kind, n: kind === 'compute' ? 3 : 0 };
    const ops = [...program];
    // keep a trailing exit() last
    if (kind !== 'exit' && ops.at(-1)?.kind === 'exit') ops.splice(ops.length - 1, 0, op);
    else ops.push(op);
    setOps(ops);
  };

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
      <Field label={s.preset}>
        <Segmented
          size="sm"
          value={activePreset ?? ('' as PresetId)}
          options={(Object.keys(PRESETS) as PresetId[]).map((id) => ({ value: id, label: s.presets[id] }))}
          onChange={(id) => set({ ...PRESETS[id] })}
        />
      </Field>
      <Field label={s.program} hint={program.length >= MAX_OPS ? s.full : s.programHint}>
        <ProgramEditor run={run} ops={program} s={s} hover={hover} setHover={setHover} current={cur?.op ?? null} onChange={setOps} onJump={(i) => stepper.setIndex(i)} />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(['compute', 'write', 'getpid', 'read', 'priv', 'exit'] as OpKind[]).map((k) => (
            <Button key={k} size="sm" disabled={program.length >= MAX_OPS} icon={<Icons.plus className="size-3" />} onClick={() => addOp(k)} title={`${s.add} ${s.ops[k]}`}>
              <span className="font-mono">{s.addOps[k]}</span>
            </Button>
          ))}
        </div>
      </Field>
      <div className="mb-4 space-y-3">
        <Toggle
          checked={cfg.boot}
          onChange={(boot) => set({ boot })}
          label={
            <span>
              {s.boot} <span className="text-[11.5px] text-ink-3">· {s.bootHint}</span>
            </span>
          }
        />
        <Toggle checked={cfg.timer > 0} onChange={(on) => set({ timer: on ? 3 : 0 })} label={s.timer} />
        {cfg.timer > 0 && (
          <div className="animate-rise">
            <Field label={s.every} hint={s.timerHint}>
              <NumberField value={cfg.timer} min={1} max={12} onChange={(timer) => set({ timer })} ariaLabel={s.timer} suffix="instr." />
            </Field>
          </div>
        )}
      </div>
      {hasRead && (
        <Field label={s.disk} hint={s.diskHint}>
          <NumberField value={cfg.disk} min={1} max={12} onChange={(disk) => set({ disk })} ariaLabel={s.disk} suffix="instr." />
        </Field>
      )}
      <div className="flex flex-wrap gap-2">
        <Button icon={<Icons.dice className="size-3.5" />} onClick={() => set(randomProblem(Math.floor(Math.random() * 1e9)))}>
          {t.random}
        </Button>
        <ShareButton />
      </div>
    </Panel>
  );

  // Practice answers, from the whole run.
  const firstSwitch = run.steps.findIndex((x) => x.kind === 'os-switch' && x.saved && x.from === 'A');
  const entry = firstSwitch >= 0 ? run.steps.slice(0, firstSwitch).findLastIndex((x) => x.pid === 'A' && (x.kind === 'hw-irq' || x.kind === 'hw-trap')) : -1;

  return (
    <Bench setup={setup}>
      <Panel title={t.stepOf(stepper.index, stepper.total)} actions={<Badge tone="accent">fig. {run.figure}</Badge>}>
        <StepControls stepper={stepper} />

        <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
          <div className="space-y-3">
            <ModeBit mode={snap.cpu.mode} s={s} />
            <CpuExtras snap={snap} s={s} T={cfg.timer} />
          </div>
          <Registers snap={snap} prev={prev} s={s} hover={hover} setHover={setHover} />
        </div>

        <div className="mt-4">
          {cur ? (
            <Narration key={stepper.index} tone={toneOf(cur)}>
              <span className="font-semibold">{s.lanes[cur.lane]}</span>
              {cur.pid && <PidTag pid={cur.pid} />}
              <span className="opacity-50">·</span>
              <span className="font-sans text-[13.5px] leading-snug">{s.narrate(cur, ctx)}</span>
            </Narration>
          ) : (
            <Narration>
              <span className="font-sans text-[13.5px] leading-snug">{s.start(cfg.boot, cfg.timer, run.hasB)}</span>
            </Narration>
          )}
          {run.truncated && (
            <div className="mt-2">
              <Narration tone="warn">{s.truncated}</Narration>
            </div>
          )}
        </div>
      </Panel>

      <Panel title={s.timeline} bodyClassName="p-0" actions={<Badge tone={run.figure === '6.3' ? 'warn' : 'neutral'}>{cfg.timer > 0 ? s.timerBadge(cfg.timer) : s.timerOff}</Badge>}>
        <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
          <span className="inline-flex flex-wrap items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[12.5px] text-ink-2">
            <span className="size-1.5 rounded-full bg-ok" />
            {s.same(run.figure)}
            {!cfg.boot && <span className="text-ink-3">· {s.noBoot}</span>}
          </span>
          {(hasRead || hasPriv) && (
            <span className="rounded-full bg-warn-soft px-3 py-1 text-[12px] text-warn">{s.ext([hasRead && s.extRead, hasPriv && s.extPriv].filter(Boolean) as string[])}</span>
          )}
        </div>
        <Timeline run={run} index={stepper.index} onJump={stepper.setIndex} hover={hover} setHover={setHover} s={s} />
        <div className="border-t border-line">
          <StatGrid cols={4}>
            <Stat label={s.modeSwitches} value={snap.counts.modeSwitches} tone="accent" sub={s.modeSub(snap.counts.toKernel, snap.counts.toUser)} />
            <Stat label={s.syscalls} value={snap.counts.syscalls} />
            <Stat label={s.kVsU} value={`${snap.counts.kernelRows}/${snap.counts.userRows}`} sub={s.kVsUSub} />
            <Stat label={s.ctxSwitches} value={snap.counts.ctxSwitches} tone={snap.counts.ctxSwitches ? 'warn' : 'neutral'} />
          </StatGrid>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <Panel title={s.procs}>
          <div className={clsx('grid gap-3', run.hasB && 'md:grid-cols-2')}>
            {PIDS.filter((p) => p === 'A' || run.hasB).map((p) => (
              <ProcCard
                key={p}
                proc={snap.procs[p]}
                snap={snap}
                step={cur}
                s={s}
                hover={hover}
                setHover={setHover}
                onJump={() => jumpTo((x) => x.pid === p && x.lane === 'user')}
              />
            ))}
          </div>
          <div className="mt-3">
            <Console text={snap.console} s={s} fresh={!!cur?.fx.console} />
          </div>
        </Panel>
        <Panel
          title={s.trapTable}
          bodyClassName="p-0"
          actions={!snap.trapTable ? <Badge tone="warn">{s.notInit}</Badge> : undefined}
        >
          <TrapTable
            snap={snap}
            step={cur}
            s={s}
            hover={hover}
            setHover={setHover}
            jumpVector={(v) => jumpTo((x) => x.vector === v && x.lane === 'hw')}
            jumpSys={(n) => jumpTo((x) => x.sysno === n && x.kind === 'user-syscall')}
          />
        </Panel>
      </div>

      {last && (
        <Panel title={s.practice}>
          <div className="grid gap-3 md:grid-cols-2">
            <Reveal question={s.q1}>
              {s.a1(last.counts.modeSwitches, last.counts.toKernel, last.counts.toUser, s.parts(last.counts.syscalls, last.counts.interrupts, last.counts.faults))}
            </Reveal>
            <Reveal question={s.q2}>{s.a2}</Reveal>
            {firstSwitch >= 0 && entry >= 0 ? (
              <Reveal question={s.q3sw}>{s.a3sw(run.steps[entry].kind === 'hw-irq' ? s.causeTimer : s.causeRead, entry + 1, firstSwitch + 1)}</Reveal>
            ) : (
              <Reveal question={s.q3loop}>{s.a3loop(cfg.timer)}</Reveal>
            )}
          </div>
        </Panel>
      )}
    </Bench>
  );
}

/* ---------- Program editor ---------- */

const opDot: Record<OpKind, string> = {
  compute: 'bg-info',
  write: 'bg-accent',
  getpid: 'bg-accent',
  read: 'bg-warn',
  exit: 'bg-ink-3',
  priv: 'bg-bad',
};

function ProgramEditor({
  run,
  ops,
  s,
  hover,
  setHover,
  current,
  onChange,
  onJump,
}: {
  run: SyscallsRun;
  ops: Op[];
  s: Strings;
  hover: Hover | null;
  setHover: (h: Hover | null) => void;
  current: number | null;
  onChange: (ops: Op[]) => void;
  onJump: (stepIndex: number) => void;
}) {
  const rows = run.program;
  const edit = (f: (ops: Op[]) => void) => {
    const next = ops.map((o) => ({ ...o }));
    f(next);
    onChange(next);
  };
  const tiny = 'grid size-6 place-items-center rounded-md text-ink-3 transition-colors hover:bg-chip hover:text-ink disabled:opacity-25 disabled:hover:bg-transparent';
  return (
    <ol className="space-y-1">
      <AnimatePresence initial={false}>
        {rows.map((op, i) => {
          const ran = run.executed[i];
          const hot = hover?.op === i;
          const now = current === i;
          const first = run.firstStep[i];
          return (
            <motion.li
              key={op.implicit ? 'implicit' : `${i}-${op.kind}`}
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={spring}
              onMouseEnter={() => setHover({ from: 'op', op: i })}
              onMouseLeave={() => setHover(null)}
              className={clsx(
                'flex items-center gap-1.5 rounded-lg border px-2 py-1 transition-colors duration-200',
                op.implicit ? 'border-dashed border-line' : 'border-line bg-sunken',
                now && 'border-accent/50 ring-2 ring-accent/25',
                hot && !now && 'border-line-strong bg-chip',
              )}
            >
              <button
                type="button"
                disabled={first === null}
                onClick={() => first !== null && onJump(first + 1)}
                className={clsx('flex min-w-0 flex-1 items-center gap-2 text-left', !ran && 'opacity-45')}
              >
                <span className="w-4 shrink-0 text-right font-mono text-[11px] text-ink-3">{i + 1}</span>
                <span className={clsx('size-2 shrink-0 rounded-full', opDot[op.kind])} />
                <span title={op.implicit ? s.implicitExit : s.ops[op.kind]} className={clsx('truncate font-mono text-[12px]', op.implicit ? 'italic text-ink-3' : 'text-ink', !ran && 'line-through')}>
                  {op.implicit ? s.implicitExit : s.ops[op.kind]}
                </span>
                {!ran && <span className="shrink-0 text-[11px] text-ink-3">{s.notRun}</span>}
              </button>
              {op.kind === 'compute' && (
                <span className="flex shrink-0 items-center rounded-md border border-line-strong bg-surface font-mono text-[11.5px]">
                  <button type="button" className={tiny} aria-label="−" disabled={op.n <= 1} onClick={() => edit((o) => (o[i].n = Math.max(1, o[i].n - 1)))}>
                    −
                  </button>
                  <span className="w-5 text-center tabular-nums">{op.n}</span>
                  <button type="button" className={tiny} aria-label="+" disabled={op.n >= MAX_COMPUTE} onClick={() => edit((o) => (o[i].n = Math.min(MAX_COMPUTE, o[i].n + 1)))}>
                    +
                  </button>
                </span>
              )}
              {!op.implicit && (
                <span className="flex shrink-0 items-center">
                  <button type="button" className={tiny} aria-label={s.moveUp} title={s.moveUp} disabled={i === 0} onClick={() => edit((o) => o.splice(i - 1, 2, o[i], o[i - 1]))}>
                    <Icons.prev className="size-3.5 rotate-90" />
                  </button>
                  <button type="button" className={tiny} aria-label={s.moveDown} title={s.moveDown} disabled={i >= ops.length - 1} onClick={() => edit((o) => o.splice(i, 2, o[i + 1], o[i]))}>
                    <Icons.next className="size-3.5 rotate-90" />
                  </button>
                  <button type="button" className={clsx(tiny, 'hover:text-bad')} aria-label={s.remove} title={s.remove} onClick={() => edit((o) => o.splice(i, 1))}>
                    <Icons.x className="size-3.5" />
                  </button>
                </span>
              )}
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}

/* ---------- Swim-lane timeline ---------- */

const COL: Record<Lane, string> = { os: 'sm:col-start-1', hw: 'sm:col-start-2', user: 'sm:col-start-3' };
const INDENT: Record<Lane, string> = { os: 'ml-0', hw: 'ml-4 sm:ml-0', user: 'ml-8 sm:ml-0' };
const LANE_CELL: Record<Lane, string> = {
  os: 'border-accent/25 bg-accent-soft text-ink',
  hw: 'border-line-strong bg-surface text-ink',
  user: 'border-info/25 bg-info-soft text-ink',
};
const LANE_TAG: Record<Lane, string> = { os: 'text-accent', hw: 'text-ink-2', user: 'text-info' };

function Timeline({
  run,
  index,
  onJump,
  hover,
  setHover,
  s,
}: {
  run: SyscallsRun;
  index: number;
  onJump: (i: number) => void;
  hover: Hover | null;
  setHover: (h: Hover | null) => void;
  s: Strings;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = box.current;
    if (!c) return;
    if (index === 0) {
      c.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const el = c.querySelector<HTMLElement>(`[data-row="${index - 1}"]`);
    if (!el) return;
    const er = el.getBoundingClientRect();
    const cr = c.getBoundingClientRect();
    if (er.top < cr.top + 44 || er.bottom > cr.bottom - 8) {
      c.scrollTo({ top: c.scrollTop + (er.top - cr.top) - c.clientHeight / 2 + er.height / 2, behavior: 'smooth' });
    }
  }, [index]);

  const related = (st: Step) => {
    if (!hover) return false;
    if (hover.from === 'proc') return st.pid === hover.pid;
    if (hover.op != null && st.op === hover.op) return true;
    if (hover.vector != null && st.vector === hover.vector) return true;
    if (hover.sysno != null && st.sysno === hover.sysno) return true;
    return false;
  };
  const lanes: Lane[] = ['os', 'hw', 'user'];

  return (
    <motion.div ref={box} layoutScroll className="relative mt-3 max-h-[min(70vh,520px)] overflow-y-auto overscroll-contain px-4 pb-4">
      <div className="sticky top-0 z-10 -mx-4 hidden grid-cols-3 gap-2 border-b border-line bg-surface px-4 py-2 sm:grid">
        {lanes.map((l) => (
          <div key={l} className="font-mono text-[11px] font-medium uppercase tracking-[0.07em]">
            <span className={LANE_TAG[l]}>{s.lanes[l]}</span>
            {s.laneSub[l] && <span className="ml-1.5 normal-case tracking-normal text-ink-3">({s.laneSub[l]})</span>}
          </div>
        ))}
      </div>
      <div className="space-y-1 pt-2">
        {run.steps.map((st, i) => {
          const past = i < index - 1;
          const now = i === index - 1;
          const rel = related(st);
          const header = run.steps.some((x) => x.phase === 'boot') && (i === 0 || st.phase !== run.steps[i - 1].phase);
          return (
            <div key={i}>
              {header && (
                <div className="flex items-center gap-2 pb-1 pt-2 font-mono text-[10.5px] uppercase tracking-[0.07em] text-ink-3">
                  <span>{st.phase === 'boot' ? s.phaseBoot : s.phaseRun}</span>
                  <span className="h-px flex-1 bg-line" />
                </div>
              )}
              <button
                type="button"
                data-row={i}
                onClick={() => onJump(i + 1)}
                onMouseEnter={() => setHover({ from: 'row', op: st.op, pid: st.pid, vector: st.vector, sysno: st.sysno })}
                onMouseLeave={() => setHover(null)}
                className="grid w-full grid-cols-1 gap-2 text-left sm:grid-cols-3"
              >
                <span
                  className={clsx(
                    COL[st.lane],
                    INDENT[st.lane],
                    'relative block rounded-lg border px-2.5 py-1.5 text-[12.5px] leading-snug transition-all duration-200',
                    past || now ? LANE_CELL[st.lane] : 'border-dashed border-line bg-transparent text-ink-3 hover:text-ink-2',
                    rel && !now && 'ring-2 ring-ink-3/35',
                  )}
                >
                  {now && <motion.span layoutId="sc-cursor" transition={spring} className="pointer-events-none absolute -inset-px rounded-lg ring-2 ring-accent" />}
                  <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                    <span className="font-mono text-[10.5px] tabular-nums text-ink-3">{i + 1}</span>
                    <span className={clsx('font-mono text-[10.5px] font-semibold uppercase sm:hidden', LANE_TAG[st.lane])}>{s.lanes[st.lane]}</span>
                    {st.pid && <PidTag pid={st.pid} />}
                    <span>{s.label(st)}</span>
                    {st.fx.modeFlip && (
                      <span className={clsx('rounded px-1 font-mono text-[10.5px]', st.cpu.mode === 'kernel' ? 'bg-accent text-accent-ink' : 'bg-info text-accent-ink', !(past || now) && 'opacity-50')}>
                        → {st.cpu.mode === 'kernel' ? s.kernel : s.user}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
