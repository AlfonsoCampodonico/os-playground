import clsx from 'clsx';
import { motion } from 'motion/react';
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
  TextField,
  useStepper,
  useStrings,
  useUi,
  useUrlState,
} from '../../components/kit';
import type { Lang } from '../../lib/i18n';
import {
  PRESETS,
  buildTree,
  counts,
  dumpLines,
  lookup,
  opToText,
  opToVsfs,
  parseFlags,
  parseOps,
  simulateFs,
  vsfsCommand,
  type Effect,
  type FsState,
  type Op,
  type OpKind,
  type PresetId,
  type QuizMode,
  type TreeNode,
} from '../../sim/filesystem';
import { DirTree } from './DirTree';
import { DiskLayout } from './DiskLayout';
import { NO_MARKS, lastChange, marksOf, related, spring, type Focus } from './model';
import { OpBuilder } from './OpBuilder';
import { PathLookup } from './PathLookup';
import { S, type Strings } from './strings';

const MODES: QuizMode[] = ['all', 'op', 'state'];

const DEFAULTS = {
  seed: PRESETS.empty.seed,
  inodes: PRESETS.empty.numInodes,
  data: PRESETS.empty.numData,
  n: PRESETS.empty.numRequests,
  ops: PRESETS.empty.ops,
  mode: 'all' as string,
  path: '/foo/bar',
};

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : lo)));

const kindChip: Record<OpKind, string> = {
  mkdir: 'bg-c2/12 text-c2',
  creat: 'bg-c1/12 text-c1',
  write: 'bg-c5/15 text-c5',
  link: 'bg-c4/12 text-c4',
  unlink: 'bg-c6/12 text-c6',
};

/** Every path in the tree, deepest first (files win ties). */
function allPaths(t: TreeNode): { path: string; depth: number; type: 'd' | 'f' }[] {
  const out: { path: string; depth: number; type: 'd' | 'f' }[] = [];
  const walk = (n: TreeNode, d: number) => {
    if (d > 0) out.push({ path: n.path, depth: d, type: n.type });
    n.children.forEach((c) => walk(c, d + 1));
  };
  walk(t, 0);
  return out.sort((a, b) => b.depth - a.depth || (a.type === b.type ? 0 : a.type === 'f' ? -1 : 1));
}

function deepestPath(s: FsState): string {
  return allPaths(buildTree(s))[0]?.path ?? '/';
}

export default function FilesystemPlayground({ lang }: { lang: Lang }) {
  return (
    <LangProvider lang={lang}>
      <Filesystem />
    </LangProvider>
  );
}

function Filesystem() {
  const s = useStrings(S);
  const t = useUi();
  const [cfg, set, reset] = useUrlState(DEFAULTS);
  const mode: QuizMode = (MODES as string[]).includes(cfg.mode) ? (cfg.mode as QuizMode) : 'all';
  const numInodes = clampInt(cfg.inodes, 2, 32);
  const numData = clampInt(cfg.data, 2, 32);
  const numRequests = clampInt(cfg.n, 0, 60);
  const seed = clampInt(cfg.seed, 0, 999999);

  const parsed = useMemo(() => parseOps(cfg.ops), [cfg.ops]);
  const run = useMemo(() => simulateFs({ seed, numInodes, numData, numRequests, ops: parsed.ops }), [seed, numInodes, numData, numRequests, parsed.ops]);
  const finalState = run.steps.at(-1)?.state ?? run.initial;
  const effectsPerStep = useMemo(() => run.steps.map((st) => st.effects), [run]);

  const stepper = useStepper(run.steps.length);
  const jump = useRef<'first' | 'last' | null>(null);
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    if (jump.current === 'last') stepper.setIndex(run.steps.length);
    else if (jump.current === 'first') stepper.setIndex(0);
    jump.current = null;
    setRevealed(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  const idx = stepper.index;
  const cur = idx > 0 ? run.steps[idx - 1] : undefined;
  const prevState = idx > 1 ? run.steps[idx - 2].state : run.initial;
  const isRevealed = revealed.has(idx);
  const hideOp = !!cur && cur.source === 'gen' && mode === 'op' && !isRevealed;
  const hideState = !!cur && cur.source === 'gen' && mode === 'state' && !isRevealed;
  const shown = hideState ? prevState : (cur?.state ?? run.initial);
  const marks = cur && !hideState ? marksOf(cur.effects) : NO_MARKS;
  const reveal = () => setRevealed((r) => new Set(r).add(idx));

  // focus: hover is transient, click pins
  const [hover, setHover] = useState<Focus>(null);
  const [pinned, setPinned] = useState<Focus>(null);
  const focus = hover ?? pinned;
  const rel = useMemo(() => related(shown, focus), [shown, focus]);
  const pin = (f: Focus) => setPinned((p) => (p && f && p.kind === f.kind && (p.kind === 'inode' ? p.i === (f as { i: number }).i : p.b === (f as { b: number }).b) ? null : f));

  const tree = useMemo(() => buildTree(shown), [shown]);
  const c = counts(shown);

  // path lookup
  const lk = useMemo(() => lookup(shown, cfg.path.trim()), [shown, cfg.path]);
  const lkStepper = useStepper(lk.steps.length, { keyboard: false, startAt: 'last' });
  useEffect(() => {
    lkStepper.last();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.path]);
  const lkStep = lkStepper.index > 0 && lkStepper.index < lk.steps.length ? lk.steps[lkStepper.index - 1] : undefined;
  const lookupMark: Focus = lkStep ? (lkStep.kind === 'inode' ? { kind: 'inode', i: lkStep.inum } : { kind: 'block', b: lkStep.block }) : null;
  const suggestions = useMemo(() => {
    const ps = allPaths(tree);
    const pick = ps.slice(0, 5).map((p) => p.path);
    const file = ps.find((p) => p.type === 'f');
    if (file) pick.push(`${file.path}/x`);
    pick.push('/nope');
    return [...new Set(pick)];
  }, [tree]);

  const activePreset = (Object.keys(PRESETS) as PresetId[]).find((id) => {
    const p = PRESETS[id];
    return p.seed === seed && p.numInodes === numInodes && p.numData === numData && p.numRequests === numRequests && p.ops === cfg.ops;
  });

  const loadProblem = (p: { seed: number; numInodes: number; numData: number; numRequests: number; ops: string }, extra: Partial<typeof DEFAULTS> = {}) => {
    const r = simulateFs({ ...p, ops: parseOps(p.ops).ops });
    jump.current = 'first';
    setPinned(null);
    set({ seed: p.seed, inodes: p.numInodes, data: p.numData, n: p.numRequests, ops: p.ops, path: deepestPath(r.steps.at(-1)?.state ?? r.initial), ...extra });
  };

  const addOp = (op: Op) => {
    jump.current = 'last';
    const text = opToText(op);
    set({ ops: cfg.ops.trim() ? `${cfg.ops.trim().replace(/;\s*$/, '')}; ${text}` : text });
  };

  const [flagText, setFlagText] = useState('');
  const flagParse = useMemo(() => (flagText.trim() ? parseFlags(flagText) : null), [flagText]);
  const applyFlags = () => {
    if (!flagParse || flagParse.bad.length) return;
    const f = flagParse.flags;
    loadProblem(
      { seed: f.seed ?? 0, numInodes: clampInt(f.numInodes ?? 8, 2, 32), numData: clampInt(f.numData ?? 8, 2, 32), numRequests: clampInt(f.numRequests ?? 10, 0, 60), ops: '' },
      { mode: f.mode ?? 'op' },
    );
  };

  const cmd = vsfsCommand({ seed, numInodes, numData, numRequests, mode });
  const nextData = String.fromCharCode(97 + (run.steps.filter((x) => x.op.kind === 'write').length % 26));

  /* ---------- setup ---------- */
  const setup = (
    <Panel
      title={t.setup}
      actions={
        <Button
          size="sm"
          variant="ghost"
          icon={<Icons.reset className="size-3.5" />}
          onClick={() => {
            jump.current = 'first';
            setPinned(null);
            reset();
          }}
        >
          {t.reset}
        </Button>
      }
      bodyClassName="p-4"
      footer={<Explain>{s.explain}</Explain>}
    >
      <Field primary label={s.preset}>
        <Segmented size="sm" value={activePreset ?? ('' as PresetId)} options={(Object.keys(PRESETS) as PresetId[]).map((id) => ({ value: id, label: s.presets[id] }))} onChange={(id) => loadProblem(PRESETS[id])} />
      </Field>

      <Field label={s.problem}>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {(
            [
              ['seed', s.seed, seed, 0, 999999],
              ['n', s.numRequests, numRequests, 0, 60],
              ['inodes', s.numInodes, numInodes, 2, 32],
              ['data', s.numData, numData, 2, 32],
            ] as const
          ).map(([key, label, value, lo, hi]) => (
            <label key={key} className="min-w-0">
              <span className="mb-1 block truncate font-mono text-[11px] text-ink-3">{label}</span>
              <NumberField
                value={value}
                min={lo}
                max={hi}
                ariaLabel={label}
                onChange={(v) => {
                  jump.current = 'first';
                  set({ [key]: v } as Partial<typeof DEFAULTS>);
                }}
              />
            </label>
          ))}
        </div>
      </Field>

      <Field label={s.mode} hint={s.modeHint[mode]}>
        <Segmented size="sm" value={mode} options={MODES.map((m) => ({ value: m, label: s.modes[m] }))} onChange={(m) => set({ mode: m })} />
      </Field>

      <Field label={t.sameAsOstep}>
        <div className="overflow-x-auto rounded-lg bg-sunken px-3 py-2 font-mono text-[12.5px] whitespace-nowrap text-ink">{cmd}</div>
        {parsed.ops.length > 0 && <p className="mt-1.5 text-[12px] text-ink-3">{s.extraOps(parsed.ops.length)}</p>}
      </Field>

      <Field label={s.flags} error={flagParse && flagParse.bad.length > 0 && s.badFlags(flagParse.bad)}>
        <div
          className="flex gap-2"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              applyFlags();
            }
          }}
        >
          <TextField value={flagText} onChange={setFlagText} placeholder={s.flagsPh} ariaLabel={s.flags} invalid={!!flagParse?.bad.length} />
          <Button disabled={!flagParse || flagParse.bad.length > 0} onClick={applyFlags}>
            {s.apply}
          </Button>
        </div>
      </Field>

      <Field label={s.yourOps} hint={s.yourOpsHint} error={parsed.bad.length > 0 && s.badOps(parsed.bad)}>
        <OpBuilder state={finalState} nextData={nextData} onAdd={addOp} s={s} />
        <div className="mt-2">
          <TextField multiline rows={3} value={cfg.ops} onChange={(v) => set({ ops: v })} placeholder={s.opsPh} invalid={parsed.bad.length > 0} ariaLabel={s.yourOps} />
        </div>
        {cfg.ops.trim() && (
          <Button size="sm" variant="ghost" className="mt-1" icon={<Icons.x className="size-3.5" />} onClick={() => set({ ops: '' })}>
            {s.clearOps}
          </Button>
        )}
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button
          icon={<Icons.dice className="size-3.5" />}
          onClick={() => loadProblem({ seed: Math.floor(Math.random() * 1000), numInodes, numData, numRequests: numRequests || 10, ops: '' })}
        >
          {t.random}
        </Button>
        <ShareButton />
      </div>
    </Panel>
  );

  /* ---------- focus info ---------- */
  const prevChange = lastChange(effectsPerStep, hideState ? idx - 1 : idx, focus);
  const nextChange = focus ? (() => {
    for (let k = idx + 1; k <= run.steps.length; k++) if (lastChange([effectsPerStep[k - 1]], 1, focus)) return k;
    return null;
  })() : null;

  const halted = run.halted && idx === run.userStart;

  return (
    <Bench setup={setup} watch={2}>
      <Panel title={t.stepOf(idx, stepper.total)} actions={<Badge tone="accent">{s.modes[mode]}</Badge>}>
        <StepControls stepper={stepper} />

        {run.steps.length > 0 && (
          <ol className="mt-5 flex flex-wrap gap-1.5" aria-label={s.ops}>
            {run.steps.map((st, k) => {
              const seen = k < idx;
              const now = k === idx - 1;
              const masked = st.source === 'gen' && mode === 'op' && !revealed.has(k + 1);
              return (
                <li key={k}>
                  <button
                    type="button"
                    onClick={() => stepper.setIndex(k + 1)}
                    title={masked ? undefined : opToVsfs(st.op)}
                    className={clsx(
                      'rounded-md px-2 py-1 font-mono text-[12px] transition-all duration-200',
                      st.source === 'user' && 'outline-1 outline-dashed outline-line-strong',
                      seen ? (st.ok ? kindChip[st.op.kind] : 'bg-bad-soft text-bad line-through') : 'bg-sunken text-ink-3 hover:text-ink',
                      now && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
                    )}
                  >
                    <span className="opacity-60">{k + 1}</span> {masked ? s.hiddenOp : opToText(st.op)}
                  </button>
                </li>
              );
            })}
          </ol>
        )}

        <div className="mt-4 flex flex-col gap-2">
          {!cur ? (
            <Narration>{s.start}</Narration>
          ) : hideOp ? (
            <Narration key={`h${idx}`} tone="info">
              <span>{s.guessOp}</span>
              <Button size="sm" className="ml-auto" icon={<Icons.eye className="size-3.5" />} onClick={reveal}>
                {s.revealOp}
              </Button>
            </Narration>
          ) : hideState ? (
            <Narration key={`s${idx}`} tone="info">
              <b className="font-semibold">{opToVsfs(cur.op)}</b>
              <span>{s.guessState}</span>
              <Button size="sm" className="ml-auto" icon={<Icons.eye className="size-3.5" />} onClick={reveal}>
                {s.revealState}
              </Button>
            </Narration>
          ) : (
            <Narration key={`n${idx}`} tone={cur.ok ? 'ok' : 'bad'}>
              <b className="font-semibold break-all">{opToVsfs(cur.op)}</b>
              {cur.ok ? <Effects effects={cur.effects} s={s} /> : <span>→ {s.err(cur.error!)} · {s.unchanged}</span>}
            </Narration>
          )}
          {halted && run.halted && <Narration tone="warn">{s.halted(run.halted)}</Narration>}
        </div>
      </Panel>

      <Panel title={s.disk} bodyClassName="p-0" actions={<Legend s={s} />}>
        <div className={clsx('relative p-4 transition-opacity duration-300', hideState && 'opacity-60')}>
          <DiskLayout state={shown} marks={marks} rel={rel} focused={!!focus} lookupMark={lookupMark} onHover={setHover} onPin={pin} s={s} />
        </div>
        <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2 font-mono text-[12px] text-ink-2">
          {focus ? (
            <>
              <b className="font-medium text-accent">{focus.kind === 'inode' ? s.focusInode(focus.i) : s.focusBlock(focus.b)}</b>
              {prevChange ? (
                <button type="button" className="text-ink-2 underline decoration-dotted underline-offset-2 hover:text-accent" onClick={() => stepper.setIndex(prevChange)}>
                  {s.lastChanged} {prevChange}
                </button>
              ) : (
                <span className="text-ink-3">{s.neverChanged}</span>
              )}
              {nextChange && (
                <button type="button" className="text-ink-3 underline decoration-dotted underline-offset-2 hover:text-accent" onClick={() => stepper.setIndex(nextChange)}>
                  → {nextChange}
                </button>
              )}
              {pinned && !hover && <span className="ml-auto text-[11px] text-ink-3">{s.pinned}</span>}
            </>
          ) : (
            <span className="text-ink-3">{s.explainHover}</span>
          )}
        </div>
        <Notation state={shown} prev={cur && !hideState ? prevState : undefined} s={s} />
        <div className="border-t border-line">
          <StatGrid cols={5}>
            <Stat label={s.inodesUsed} value={`${c.inodesUsed}/${shown.inodes.length}`} sub={s.freeOf(c.inodesFree)} tone={c.inodesFree === 0 ? 'bad' : 'neutral'} />
            <Stat label={s.blocksUsed} value={`${c.blocksUsed}/${shown.blocks.length}`} sub={s.freeOf(c.blocksFree)} tone={c.blocksFree === 0 ? 'bad' : 'neutral'} />
            <Stat label={s.dirs} value={c.dirs} />
            <Stat label={s.files} value={c.files} />
            <Stat label={s.hardLinks} value={c.extraLinks} sub={s.hardLinksSub(c.multiLinked)} tone={c.extraLinks ? 'accent' : 'neutral'} />
          </StatGrid>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={s.tree}>
          <div className={clsx('transition-opacity duration-300', hideState && 'opacity-60')}>
            <DirTree
              tree={tree}
              rel={rel}
              focused={!!focus}
              marks={marks}
              activePath={cfg.path.trim()}
              onHover={setHover}
              onPick={(n) => {
                set({ path: n.path });
                setPinned({ kind: 'inode', i: n.inum });
              }}
              s={s}
            />
          </div>
        </Panel>
        <Panel title={s.lookupTitle}>
          <PathLookup path={cfg.path} setPath={(p) => set({ path: p })} lk={lk} stepper={lkStepper} suggestions={suggestions} onHover={setHover} s={s} />
        </Panel>
      </div>

      <Practice run={run} idx={idx} finalState={finalState} s={s} />
    </Bench>
  );
}

function Effects({ effects, s }: { effects: Effect[]; s: Strings }) {
  return (
    <span className="flex flex-wrap gap-1">
      {effects.map((e, k) => (
        <motion.span
          key={k}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.03 * k }}
          className="rounded-md bg-surface/70 px-1.5 py-0.5 text-[11.5px]"
        >
          {s.effect(e)}
        </motion.span>
      ))}
    </span>
  );
}

function Legend({ s }: { s: Strings }) {
  const item = (cls: string, label: string) => (
    <span className="flex items-center gap-1">
      <span className={clsx('size-2.5 rounded-sm border', cls)} />
      {label}
    </span>
  );
  return (
    <span className="hidden items-center gap-2.5 font-mono text-[10.5px] text-ink-3 sm:flex">
      {item('bg-ok-soft border-ok/50', s.legend.alloc)}
      {item('bg-bad-soft border-bad/50', s.legend.free)}
      {item('bg-warn-soft border-warn/50', s.legend.update)}
    </span>
  );
}

const LABELS = ['inode bitmap', 'inodes', 'data bitmap', 'data'];

function Notation({ state, prev, s }: { state: FsState; prev?: FsState; s: Strings }) {
  const lines = dumpLines(state);
  const before = prev ? dumpLines(prev) : lines;
  return (
    <details className="group border-t border-line">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 font-mono text-[11.5px] uppercase tracking-[0.07em] text-ink-2 hover:text-accent [&::-webkit-details-marker]:hidden">
        {s.notation}
        <Icons.next className="ml-auto size-4 text-ink-3 transition-transform group-open:rotate-90" />
      </summary>
      <div className="overflow-x-auto px-4 pb-3">
        <pre className="w-max font-mono text-[12px] leading-relaxed">
          {lines.map((l, k) => (
            <div key={k} className={clsx('rounded px-1 transition-colors duration-300', l !== before[k] && 'bg-warn-soft')}>
              <span className="inline-block w-[13ch] text-ink-3">{LABELS[k]}</span>
              <span className="text-ink">{l}</span>
            </div>
          ))}
        </pre>
      </div>
    </details>
  );
}

function DumpBlock({ title, state, other }: { title: string; state: FsState; other?: FsState }) {
  const lines = dumpLines(state);
  const ref = other ? dumpLines(other) : lines;
  return (
    <div className="min-w-0">
      <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">{title}</div>
      <div className="overflow-x-auto rounded-lg bg-sunken p-2">
        <pre className="w-max font-mono text-[11.5px] leading-relaxed">
          {lines.map((l, k) => (
            <div key={k} className={clsx('rounded px-1', l !== ref[k] && 'bg-warn-soft')}>
              <span className="inline-block w-[13ch] text-ink-3">{LABELS[k]}</span>
              {l}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

function Practice({ run, idx, finalState, s }: { run: ReturnType<typeof simulateFs>; idx: number; finalState: FsState; s: Strings }) {
  if (run.steps.length === 0) return null;
  const quizK = idx > 0 ? idx : 1;
  const qs = run.steps[quizK - 1];
  const before = quizK > 1 ? run.steps[quizK - 2].state : run.initial;
  const fc = counts(finalState);
  const deep = deepestPath(finalState);
  const lk = lookup(finalState, deep);
  const chain = lk.steps.map((x) => (x.kind === 'inode' ? s.readInode(x.inum) : s.readBlock(x.block))).join(' → ');
  return (
    <Panel title={s.practice}>
      <div className="grid gap-3">
        {qs.ok && (
          <Reveal
            key={quizK}
            question={
              <>
                <p>{s.qOp(quizK)}</p>
                <div className="mt-2.5 grid gap-2 md:grid-cols-2">
                  <DumpBlock title={s.before} state={before} />
                  <DumpBlock title={s.after} state={qs.state} other={before} />
                </div>
              </>
            }
          >
            <div className="mb-2 font-mono text-[12.5px]">
              {s.aOp} <b className="font-semibold">{opToVsfs(qs.op)}</b>
            </div>
            <span className="flex flex-wrap gap-1 font-mono">
              {qs.effects.map((e, k) => (
                <span key={k} className="rounded-md bg-surface/70 px-1.5 py-0.5 text-[11.5px]">
                  {s.effect(e)}
                </span>
              ))}
            </span>
          </Reveal>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <Reveal key={`f${run.steps.length}`} question={s.qFree(run.steps.length)}>
            {s.aFree(fc.inodesFree, finalState.inodes.length, fc.blocksFree, finalState.blocks.length)}
          </Reveal>
          {deep !== '/' && (
            <Reveal key={`r${deep}`} question={s.qReads(deep)}>
              {s.aReads(lk.reads, chain)}
            </Reveal>
          )}
        </div>
      </div>
    </Panel>
  );
}
