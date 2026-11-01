import clsx from 'clsx';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Badge,
  Bench,
  Button,
  Explain,
  Field,
  Icons,
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
  useStepper,
  useStrings,
  useUi,
  type Tone,
} from '../../components/kit';
import { CODE_PRESETS, INIT_PID, randomProgram, runC, SHELL_PID, ROOT_PID, type CodeEvent, type CodePresetId, type CodeRun, type Policy, type ProcSnap, type ProcState } from '../../sim/fork/code';
import { proc, SPRING } from './colors';
import type { ForkCfg, SetCfg } from './Fork';
import { ProcTree } from './ProcTree';
import { S, type ForkStrings } from './strings';

const POLICIES: Policy[] = ['parent', 'child', 'random'];
const STATE_TEXT: Record<ProcState, string> = {
  running: 'text-accent',
  ready: 'text-ink-3',
  waiting: 'text-info',
  sleeping: 'text-info',
  zombie: 'text-warn',
  done: 'text-ink-3',
};
const live = (p: ProcSnap) => p.state !== 'zombie' && p.state !== 'done';

export function CodeMode({ cfg, set, reset, modeField }: { cfg: ForkCfg; set: SetCfg; reset: () => void; modeField: ReactNode }) {
  const s = useStrings(S);
  const t = useUi();
  const runs = useMemo(() => {
    const out = {} as Record<Policy, CodeRun>;
    for (const policy of POLICIES) out[policy] = runC({ src: cfg.code, policy, seed: cfg.cseed });
    return out;
  }, [cfg.code, cfg.cseed]);
  const run = runs[cfg.sched];
  const stepper = useStepper(run.steps.length, { startAt: 'first' });
  const [hoverPid, setHoverPid] = useState<number | null>(null);

  const idx = stepper.index;
  const total = run.steps.length;
  const cur = idx > 0 ? run.steps[idx - 1] : undefined;
  const procs = cur?.procs ?? run.initial;
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const outLen = cur?.outLen ?? 0;
  const compileError = run.error && run.steps.length === 0 ? run.error : undefined;
  const errorLine = run.error && (compileError || idx === total) ? run.error.line : null;
  const activePreset = (Object.keys(CODE_PRESETS) as CodePresetId[]).find((id) => CODE_PRESETS[id] === cfg.code);
  const dim = (pid: number) => hoverPid !== null && hoverPid !== pid;

  const setup = (
    <Panel
      title={t.setup}
      actions={
        <Button size="sm" variant="ghost" icon={<Icons.reset className="size-3.5" />} onClick={reset}>
          {t.reset}
        </Button>
      }
      bodyClassName="p-4"
      footer={<Explain>{s.codeExplain}</Explain>}
    >
      {modeField}
      <Field primary label={s.preset}>
        <Segmented
          size="sm"
          value={activePreset ?? ('' as CodePresetId)}
          options={(Object.keys(CODE_PRESETS) as CodePresetId[]).map((id) => ({ value: id, label: s.codePresets[id] }))}
          onChange={(id) => set({ code: CODE_PRESETS[id] })}
        />
      </Field>
      <Field label={s.program} hint={s.programHint} error={compileError && s.errorAt(compileError.line) + s.err(compileError)}>
        <TextField multiline rows={Math.min(16, Math.max(5, cfg.code.split('\n').length + 1))} value={cfg.code} onChange={(code) => set({ code })} invalid={!!compileError} ariaLabel={s.program} />
      </Field>
      <Field label={s.sched}>
        <Segmented size="sm" value={cfg.sched} options={POLICIES.map((p) => ({ value: p, label: s.scheds[p] }))} onChange={(sched) => set({ sched })} />
      </Field>
      {cfg.sched === 'random' && (
        <Field label={s.schedSeed}>
          <NumberField value={cfg.cseed} min={0} max={99999} onChange={(cseed) => set({ cseed })} ariaLabel={s.schedSeed} />
        </Field>
      )}
      <div className="mb-4 rounded-xl border border-line bg-sunken px-3 py-2.5">
        <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.07em] text-ink-3">{s.realRun}</div>
        <code className="block break-all font-mono text-[12.5px] text-ink">gcc fork.c -o fork &amp;&amp; ./fork</code>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button icon={<Icons.dice className="size-3.5" />} onClick={() => set({ code: randomProgram(Math.floor(Math.random() * 1e9)) })}>
          {t.random}
        </Button>
        <ShareButton />
      </div>
    </Panel>
  );

  /* ---------- tree ---------- */
  const childrenOf = (id: string): string[] => {
    const n = Number(id);
    const kids = procs.filter((p) => p.ppid === n).map((p) => String(p.pid));
    if (n === INIT_PID) return [String(SHELL_PID), ...kids];
    if (n === SHELL_PID) return procs.some((p) => p.pid === ROOT_PID) ? [String(ROOT_PID)] : [];
    return kids;
  };
  const isNew = (id: string) => !!cur?.events.some((e) => e.k === 'fork' && String(e.child) === id);
  const node = (id: string) => {
    const pid = Number(id);
    if (pid === INIT_PID || pid === SHELL_PID)
      return (
        <span className="flex items-center gap-1.5 rounded-lg border border-dashed border-line-strong px-2.5 py-1 font-mono text-[12.5px] text-ink-3">
          {pid === INIT_PID ? 'init' : 'bash'} <span className="text-ink-3/80">{pid}</span>
        </span>
      );
    const p = byPid.get(pid)!;
    const c = proc(p.color);
    const actor = cur?.pid === pid;
    return (
      <button
        type="button"
        onMouseEnter={() => setHoverPid(pid)}
        onMouseLeave={() => setHoverPid(null)}
        onClick={() => stepper.setIndex(p.bornAt)}
        title={`PID ${pid} · PPID ${p.ppid}`}
        className={clsx(
          'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[12.5px] transition-all duration-200',
          p.state === 'done' ? 'border-line text-ink-3 opacity-55' : p.state === 'zombie' ? 'border-dashed border-warn bg-warn-soft text-ink' : clsx(c.border, c.soft, 'text-ink'),
          actor && 'ring-2 ring-accent ring-offset-1 ring-offset-sunken',
          hoverPid === pid && !actor && 'ring-2 ring-ink-3',
          dim(pid) && 'opacity-45',
        )}
      >
        <span className={clsx('size-2 rounded-full', p.state === 'done' ? 'bg-ink-3' : c.dot)} />
        <span className={clsx(p.state === 'done' && 'line-through')}>P{pid}</span>
        {p.image !== 'a.out' && <span className="text-ink-2">{p.image}</span>}
        <span className={clsx('text-[11px] transition-colors duration-300', STATE_TEXT[p.state])}>{s.states[p.state]}</span>
        {p.orphan && (
          <Badge tone="warn" className="px-1.5 py-0 text-[10.5px]">
            {s.orphan}
          </Badge>
        )}
      </button>
    );
  };

  /* ---------- narration ---------- */
  const narration = () => {
    if (compileError)
      return (
        <Narration tone="bad">
          {s.errorAt(compileError.line)}
          {s.err(compileError)}
        </Narration>
      );
    if (!cur) return <Narration>{s.codeStart}</Narration>;
    const { parts, tone } = describe(cur.events, s, byPid);
    const actor = byPid.get(cur.pid);
    return (
      <Narration key={idx} tone={tone}>
        <b className={clsx('font-semibold', tone === 'neutral' && actor && proc(actor.color).text)}>{s.at(cur.pid, cur.line)}</b>
        {parts.length ? parts.map((p, i) => <span key={i}>{p}</span>) : <span className="opacity-70">…</span>}
      </Narration>
    );
  };

  /* ---------- practice ---------- */
  const practice = useMemo(() => {
    const last = run.steps.at(-1);
    if (!last || run.error) return null;
    const freq = new Map<string, number>();
    for (const o of run.output) freq.set(o.text, (freq.get(o.text) ?? 0) + 1);
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
    const word = top && top[1] >= 2 ? top[0] : null;
    const count = word ? top[1] : run.output.length;
    const orphan = last.procs.find((p) => p.orphan);
    const zombie = findZombie(run);
    const other: Policy = cfg.sched === 'parent' ? 'child' : 'parent';
    const sameOrder = runs[other].output.map((o) => o.text).join('\n') === run.output.map((o) => o.text).join('\n');
    return { word, count, procs: last.created + 1, forks: last.created, orphan, zombie, other, sameOrder, lines: run.output.length };
  }, [run, runs, cfg.sched]);

  const counts = POLICIES.map((p) => (runs[p].error || runs[p].truncated ? null : runs[p].output.length));
  const sameCount = counts.every((c) => c === counts[0]);

  return (
    <Bench setup={setup} watch={2}>
      <Panel title={t.stepOf(idx, total)} actions={<Badge tone="accent">{s.scheds[cfg.sched]}</Badge>}>
        <StepControls stepper={stepper} />
        <LayoutGroup id="fork-code">
          <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.07em] text-ink-3">{s.code}</div>
              <CodeView src={cfg.code} procs={procs} ranLine={cur?.line ?? null} ranColor={cur ? byPid.get(cur.pid)?.color : undefined} errorLine={errorLine} hoverPid={hoverPid} setHoverPid={setHoverPid} />
            </div>
            <div className="min-w-0">
              <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.07em] text-ink-3">{s.tree}</div>
              <div className="overflow-x-auto rounded-xl border border-line bg-sunken p-3">
                <ProcTree roots={[String(INIT_PID)]} childrenOf={childrenOf} renderNode={node} isNew={isNew} idPrefix="fc" />
              </div>
            </div>
          </div>
        </LayoutGroup>

        <div className="mt-4 space-y-2">
          {narration()}
          {idx === total && total > 0 && !run.error && !run.truncated && <Narration tone="ok">{s.done(run.output.length, (cur?.created ?? 0) + 1)}</Narration>}
          {idx === total && run.truncated && <Narration tone="warn">{s.truncated(total)}</Narration>}
          {idx === total && run.error && !compileError && (
            <Narration tone="bad">
              {s.errorAt(run.error.line)}
              {s.err(run.error)}
            </Narration>
          )}
        </div>

        <div className="-mx-4 -mb-4 mt-4 border-t border-line">
          <StatGrid cols={4}>
            <Stat label={s.created} value={cur?.created ?? 0} tone="ok" sub={s.createdSub((cur?.created ?? 0) + (compileError ? 0 : 1))} />
            <Stat label={s.lines} value={outLen} />
            <Stat label={s.zombies} value={cur?.zombies ?? 0} tone="warn" sub={s.zombiesSub} />
            <Stat label={s.orphans} value={cur?.orphans ?? 0} tone="warn" sub={s.orphansSub} />
          </StatGrid>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={s.console} bodyClassName="p-0">
          <div className="max-h-80 overflow-auto bg-sunken/50 py-2 font-mono text-[12.5px]">
            {outLen === 0 && <p className="px-4 py-2 text-ink-3">{s.consoleEmpty}</p>}
            <AnimatePresence initial={false}>
              {run.output.slice(0, outLen).map((o, i) => {
                const p = byPid.get(o.pid);
                const c = proc(p?.color ?? 0);
                return (
                  <motion.button
                    key={i}
                    type="button"
                    layout="position"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: dim(o.pid) ? 0.35 : 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={SPRING}
                    onClick={() => stepper.setIndex(o.step)}
                    onMouseEnter={() => setHoverPid(o.pid)}
                    onMouseLeave={() => setHoverPid(null)}
                    className={clsx('flex w-full items-baseline gap-2.5 border-l-2 px-4 py-0.5 text-left hover:bg-chip', c.bar, o.step === idx && 'bg-chip')}
                  >
                    <span className={clsx('w-11 shrink-0 text-[11px]', c.text)}>P{o.pid}</span>
                    {o.stream === 'err' && <span className="shrink-0 text-[10.5px] text-bad">stderr</span>}
                    {o.image && <span className="shrink-0 text-[10.5px] text-ink-3">{o.image}</span>}
                    <span className="whitespace-pre text-ink">{o.text || ' '}</span>
                  </motion.button>
                );
              })}
            </AnimatePresence>
            {procs
              .filter((p) => p.buf && p.state !== 'done')
              .map((p) => (
                <div key={`b${p.pid}`} className="mx-4 mt-1.5 flex items-baseline gap-2.5 rounded-md border border-dashed border-line-strong px-2 py-0.5 text-ink-3">
                  <span className={clsx('w-11 shrink-0 text-[11px]', proc(p.color).text)}>P{p.pid}</span>
                  <span className="whitespace-pre">«{p.buf.replace(/\n/g, '\\n')}»</span>
                  <span className="ml-auto text-[10.5px]">{s.pending}</span>
                </div>
              ))}
          </div>
        </Panel>

        <Panel title={s.vars} actions={<span className="text-[11.5px] text-ink-3">{s.varsSub}</span>}>
          <div className="grid gap-2 sm:grid-cols-2">
            <AnimatePresence initial={false}>
              {procs.map((p) => {
                const c = proc(p.color);
                const changed = new Set(cur?.events.filter((e): e is Extract<CodeEvent, { k: 'set' }> => e.k === 'set' && e.pid === p.pid).map((e) => e.name));
                return (
                  <motion.div
                    key={p.pid}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: p.state === 'done' ? 0.5 : dim(p.pid) ? 0.4 : 1, scale: 1 }}
                    transition={SPRING}
                    onMouseEnter={() => setHoverPid(p.pid)}
                    onMouseLeave={() => setHoverPid(null)}
                    className={clsx('rounded-xl border p-2.5 transition-colors duration-300', cur?.pid === p.pid ? 'border-accent' : 'border-line', hoverPid === p.pid && 'bg-chip')}
                  >
                    <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[12px]">
                      <span className={clsx('size-2 rounded-full', c.dot)} />
                      <span className="text-ink">P{p.pid}</span>
                      <span className="text-ink-3">ppid {p.ppid}</span>
                      <span className={clsx('ml-auto text-[11px]', STATE_TEXT[p.state])}>{s.states[p.state]}</span>
                    </div>
                    <div className="space-y-0.5 font-mono text-[12.5px]">
                      {p.image !== 'a.out' ? (
                        <div className="text-ink-3">{s.newImage(p.image)}</div>
                      ) : p.vars.length === 0 ? (
                        <div className="text-ink-3">{s.noVars}</div>
                      ) : (
                        p.vars.map(([name, v]) => (
                          <div key={name} className="flex justify-between gap-2">
                            <span className="text-ink-2">{name}</span>
                            <span key={`${name}${v}`} className={clsx('tabular-nums', changed.has(name) ? 'animate-pop font-semibold text-accent' : 'text-ink')}>
                              {v}
                            </span>
                          </div>
                        ))
                      )}
                      {p.buf && (
                        <div className="flex justify-between gap-2 border-t border-line pt-0.5 text-[11.5px]">
                          <span className="text-ink-3">{s.buffer}</span>
                          <span className="truncate text-ink-2">«{p.buf.replace(/\n/g, '\\n')}»</span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </Panel>
      </div>

      {!compileError && (
        <Panel title={s.compare} bodyClassName="p-0">
          <div className="divide-y divide-line">
            {POLICIES.map((pol) => {
              const r = runs[pol];
              const colorOf = new Map((r.steps.at(-1)?.procs ?? r.initial).map((p) => [p.pid, p.color]));
              return (
                <button
                  key={pol}
                  type="button"
                  onClick={() => set({ sched: pol })}
                  className={clsx('flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-chip', pol === cfg.sched && 'bg-accent-soft/50')}
                >
                  <span className="w-28 shrink-0 text-[12.5px] font-medium text-ink">
                    {s.scheds[pol]}
                    {pol === cfg.sched && <span className="block font-mono text-[10.5px] font-normal text-accent">{s.current}</span>}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                    {r.output.slice(0, 24).map((o, i) => (
                      <span key={i} className={clsx('max-w-[9rem] truncate rounded px-1.5 py-0.5 font-mono text-[11px]', proc(colorOf.get(o.pid) ?? 0).soft, proc(colorOf.get(o.pid) ?? 0).text)} title={`P${o.pid}: ${o.text}`}>
                        {o.text || '·'}
                      </span>
                    ))}
                    {r.output.length > 24 && <span className="font-mono text-[11px] text-ink-3">+{r.output.length - 24}</span>}
                  </span>
                  <span className="shrink-0 font-serif text-[22px] tabular-nums text-ink">{r.output.length}</span>
                </button>
              );
            })}
          </div>
          <div className="border-t border-line px-4 py-2.5">
            <span className={clsx('text-[12.5px]', sameCount ? 'text-ok' : 'text-warn')}>{sameCount ? s.compareSame(counts[0] ?? 0) : s.compareDiff}</span>
          </div>
        </Panel>
      )}

      {practice && (
        <Panel title={s.practice}>
          <div className="grid gap-3 md:grid-cols-2">
            <Reveal question={s.codePractice.countQ(practice.word)}>{s.codePractice.countA(practice.count, practice.procs)}</Reveal>
            <Reveal question={s.codePractice.procsQ}>{s.codePractice.procsA(practice.procs, practice.forks)}</Reveal>
            {practice.orphan ? (
              <Reveal question={s.codePractice.orphanQ(practice.orphan.pid)}>{s.codePractice.orphanA(practice.orphan.pid, practice.orphan.origPpid)}</Reveal>
            ) : practice.zombie ? (
              <Reveal question={s.codePractice.zombieQ}>{s.codePractice.zombieA(practice.zombie.pid, practice.zombie.from, practice.zombie.to, practice.zombie.reaper)}</Reveal>
            ) : (
              <Reveal question={s.codePractice.orderQ(s.scheds[practice.other])}>{practice.sameOrder ? s.codePractice.orderSame : s.codePractice.orderDiff(practice.lines)}</Reveal>
            )}
          </div>
        </Panel>
      )}
    </Bench>
  );
}

interface ZombieSpan {
  pid: number;
  from: number;
  to: number | null;
  reaper: number | null;
}

/** The first process that became a zombie: steps it spent as one and who reaped it. */
function findZombie(run: CodeRun): ZombieSpan | null {
  let z: ZombieSpan | null = null;
  for (let i = 0; i < run.steps.length; i++) {
    const st = run.steps[i];
    for (const p of st.procs) {
      if (!z && p.state === 'zombie') z = { pid: p.pid, from: i + 1, to: null, reaper: null };
      if (z && z.pid === p.pid && z.to === null && p.state === 'done') {
        z.to = i + 1;
        const ev = st.events.find((e) => e.k === 'reap' && e.child === p.pid);
        z.reaper = ev && ev.k === 'reap' ? ev.pid : null;
      }
    }
  }
  return z;
}

/** The source with line numbers and one colored dot per process on the line it runs next. */
function CodeView({
  src,
  procs,
  ranLine,
  ranColor,
  errorLine,
  hoverPid,
  setHoverPid,
}: {
  src: string;
  procs: ProcSnap[];
  ranLine: number | null;
  ranColor?: number;
  errorLine: number | null;
  hoverPid: number | null;
  setHoverPid: (p: number | null) => void;
}) {
  const lines = src.split('\n');
  const at = new Map<number, ProcSnap[]>();
  for (const p of procs) if (live(p) && p.line !== null) at.set(p.line, [...(at.get(p.line) ?? []), p]);
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-sunken py-2 font-mono text-[12.5px] leading-[1.65]">
      {lines.map((text, i) => {
        const n = i + 1;
        const here = at.get(n) ?? [];
        return (
          <div
            key={i}
            className={clsx(
              'flex min-w-max items-center transition-colors duration-300',
              errorLine === n ? 'bg-bad-soft' : ranLine === n && ranColor !== undefined ? proc(ranColor).soft : '',
            )}
          >
            <span className="w-8 shrink-0 select-none pr-2 text-right text-[11px] text-ink-3">{n}</span>
            <span className="flex w-[54px] shrink-0 items-center gap-[3px]">
              {here.slice(0, 5).map((p) => (
                <motion.span
                  key={p.pid}
                  layoutId={`dot-${p.pid}`}
                  transition={SPRING}
                  onMouseEnter={() => setHoverPid(p.pid)}
                  onMouseLeave={() => setHoverPid(null)}
                  title={`P${p.pid}`}
                  className={clsx(
                    'size-2.5 shrink-0 rounded-full',
                    p.state === 'waiting' || p.state === 'sleeping' ? clsx('bg-transparent ring-2 ring-inset', proc(p.color).ring) : proc(p.color).dot,
                    p.state === 'ready' && 'opacity-60',
                    hoverPid === p.pid && 'ring-2 ring-ink ring-offset-1 ring-offset-sunken',
                  )}
                />
              ))}
              {here.length > 5 && <span className="text-[10px] text-ink-3">+{here.length - 5}</span>}
            </span>
            <span className={clsx('whitespace-pre pr-4', errorLine === n ? 'text-bad' : 'text-ink')}>{text || ' '}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Narration pieces for one step's events, and the tone of the most important one. */
function describe(events: CodeEvent[], s: ForkStrings, byPid: Map<number, ProcSnap>): { parts: ReactNode[]; tone: Tone } {
  const parts: ReactNode[] = [];
  const rank: Record<Tone, number> = { neutral: 0, accent: 0, info: 1, ok: 2, warn: 3, bad: 4 };
  let tone: Tone = 'neutral';
  const bump = (t: Tone) => {
    if (rank[t] > rank[tone]) tone = t;
  };
  const sets: string[] = [];
  const flushSets = () => {
    if (sets.length) parts.push(sets.splice(0).join(', '));
  };
  for (const e of events) {
    if (e.k === 'set') {
      sets.push(s.ev.set(e.name, e.value));
      continue;
    }
    flushSets();
    switch (e.k) {
      case 'first':
        parts.push(s.ev.first(e.pid));
        break;
      case 'fork':
        parts.push(s.ev.fork(e.pid, e.child));
        if (e.bufCopied) parts.push(s.ev.bufCopied(e.bufCopied));
        bump('ok');
        break;
      case 'forkFail':
        parts.push(s.ev.forkFail);
        bump('bad');
        break;
      case 'print':
        parts.push(e.flushed ? (e.text === '' ? s.ev.flush : s.ev.print(e.text)) : s.ev.buffered(e.text));
        break;
      case 'err':
        parts.push(s.ev.err(e.text));
        break;
      case 'exit':
        parts.push(e.to === 'zombie' ? s.ev.exitZombie(e.pid, e.code, byPid.get(e.pid)?.ppid ?? 0) : e.reaper === INIT_PID ? s.ev.exitInit(e.pid, e.code) : s.ev.exitShell(e.pid, e.code));
        if (e.lostBuf) parts.push(s.ev.lostBuf(e.lostBuf));
        bump(e.to === 'zombie' ? 'warn' : 'info');
        break;
      case 'orphan':
        parts.push(s.ev.orphan(e.pid));
        bump('warn');
        break;
      case 'wake':
        parts.push(s.ev.wake(e.pid, e.by));
        bump('info');
        break;
      case 'block':
        parts.push(s.ev.block(e.target));
        bump('info');
        break;
      case 'reap':
        parts.push(e.pid === INIT_PID ? s.ev.initReap(e.child) : s.ev.reap(e.child, e.code));
        bump('info');
        break;
      case 'waitNone':
        parts.push(s.ev.waitNone);
        break;
      case 'sleep':
        parts.push(s.ev.sleep(e.secs));
        bump('info');
        break;
      case 'wakeSleep':
        parts.push(s.ev.wakeSleep(e.pid));
        break;
      case 'exec':
        parts.push(e.ok ? s.ev.exec(e.argv) : s.ev.execFail(e.argv[0]));
        if (e.ok && e.lostBuf) parts.push(s.ev.lostBuf(e.lostBuf));
        bump(e.ok ? 'info' : 'warn');
        break;
      case 'image':
        parts.push(s.ev.image(e.image));
        break;
      case 'branch':
        parts.push(e.loop ? (e.taken ? s.ev.loopTrue : s.ev.loopFalse) : e.taken ? s.ev.ifTrue : s.ev.ifFalse);
        break;
    }
  }
  flushSets();
  return { parts, tone };
}
