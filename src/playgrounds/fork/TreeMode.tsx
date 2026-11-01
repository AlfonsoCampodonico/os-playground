import clsx from 'clsx';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
  Toggle,
  useStepper,
  useStrings,
  useUi,
} from '../../components/kit';
import { PyRandom } from '../../lib/pyrandom';
import { forkPyCommand, forkPyOutput, parseForkPyFlags, preorder, printTree, simulateForkPy, type ForkPyConfig, type TreeSnap } from '../../sim/fork/tree';
import { proc } from './colors';
import type { ForkCfg, SetCfg } from './Fork';
import { ProcTree } from './ProcTree';
import { S, type TreePresetId, type TreeView } from './strings';

const BASE_TREE = { seed: 4, actions: 5, forks: 0.7, alist: '', R: false, L: false, view: 'solve' as TreeView, F: false };
const TREE_PRESETS: Record<TreePresetId, typeof BASE_TREE> = {
  readme: BASE_TREE,
  hw1: { ...BASE_TREE, seed: 10, view: 'tree' },
  hw2: { ...BASE_TREE, seed: 1, actions: 100, forks: 0.1 },
  hw4: { ...BASE_TREE, alist: 'a+b,b+c,c+d,c+e,c-' },
  hw4R: { ...BASE_TREE, alist: 'a+b,b+c,c+d,c+e,c-', R: true },
  hw6: { ...BASE_TREE, seed: 2, view: 'action', F: true },
};
const PRESET_KEYS = Object.keys(BASE_TREE) as (keyof typeof BASE_TREE)[];
const FORK_PCTS = [0.1, 0.3, 0.5, 0.7, 0.9];

const toPy = (cfg: ForkCfg): ForkPyConfig => ({ seed: cfg.seed, actions: cfg.actions, forkPct: cfg.forks, actionList: cfg.alist, localReparent: cfg.R, leafOnly: cfg.L });
/** fork.py's tree text without its 31-space left margin. */
const treeText = (t: TreeSnap) =>
  printTree(t)
    .split('\n')
    .map((l) => l.slice(31))
    .join('\n')
    .trimEnd();

export function TreeMode({ cfg, set, reset, modeField }: { cfg: ForkCfg; set: SetCfg; reset: () => void; modeField: ReactNode }) {
  const s = useStrings(S);
  const t = useUi();
  const py = useMemo(() => toPy(cfg), [cfg]);
  const run = useMemo(() => simulateForkPy(py), [py]);
  const stepper = useStepper(run.steps.length, { startAt: 'first' });
  const [hover, setHover] = useState<string | null>(null);
  const [shown, setShown] = useState<Set<number>>(new Set());
  const [paste, setPaste] = useState('');
  const [pasteErr, setPasteErr] = useState<string[]>([]);

  const sig = JSON.stringify(py) + cfg.view + cfg.F;
  useEffect(() => setShown(new Set()), [sig]);

  const idx = stepper.index;
  const total = run.steps.length;
  const cur = idx > 0 ? run.steps[idx - 1] : undefined;
  const prevTree = idx > 1 ? run.steps[idx - 2].tree : run.initial;
  const tree = cur?.tree ?? run.initial;

  // color and birth step of every process name
  const { color, born } = useMemo(() => {
    const color = new Map<string, number>([['a', 0]]);
    const born = new Map<string, number>([['a', 0]]);
    run.steps.forEach((st, i) => {
      if (st.kind === 'fork' && st.child) {
        color.set(st.child, color.size);
        born.set(st.child, i + 1);
      }
    });
    return { color, born };
  }, [run]);

  const activePreset = (Object.keys(TREE_PRESETS) as TreePresetId[]).find((id) => PRESET_KEYS.every((k) => TREE_PRESETS[id][k] === cfg[k]));
  const command = forkPyCommand(py, { showTree: cfg.view === 'action', finalOnly: cfg.F, solve: cfg.view === 'solve' });
  const actionHidden = (stepNo: number) => cfg.view === 'action' && !shown.has(stepNo);
  const treeHidden = idx > 0 && ((cfg.F && idx < total) || (cfg.view === 'tree' && !shown.has(idx)));
  const show = (i: number) => setShown((prev) => new Set(prev).add(i));

  // children shown for each node: the struck-out exited process stays where it was for one step
  const ghost = cur?.exited;
  const childrenOf = (id: string): string[] => {
    if (ghost && id === ghost.parent) {
      const now = tree.children[id] ?? [];
      const before = (prevTree.children[id] ?? []).filter((c) => c === ghost.name || now.includes(c));
      return [...before, ...now.filter((c) => !before.includes(c))];
    }
    if (ghost && id === ghost.name) return [];
    return tree.children[id] ?? [];
  };
  const orphanNames = new Set(cur?.orphans.map((o) => o.name));
  const involved = (i: number) => {
    const st = run.steps[i];
    return st ? [st.actor, st.child].filter(Boolean) : [];
  };

  const stats = useMemo(() => {
    const upto = run.steps.slice(0, idx);
    return {
      alive: preorder(tree).length,
      forks: upto.filter((x) => x.kind === 'fork').length,
      exits: upto.filter((x) => x.kind === 'exit').length,
      orphans: upto.reduce((n, x) => n + x.orphans.length, 0),
    };
  }, [run, idx, tree]);

  const applyPaste = () => {
    const { flags, errors } = parseForkPyFlags(paste);
    setPasteErr(errors);
    if (errors.length) return;
    set({
      seed: flags.seed ?? cfg.seed,
      actions: Math.max(1, Math.min(100, flags.actions ?? 5)),
      forks: flags.forkPct ?? 0.7,
      alist: flags.actionList ?? '',
      R: !!flags.localReparent,
      L: !!flags.leafOnly,
      view: flags.solve ? 'solve' : flags.showTree ? 'action' : 'tree',
      F: !!flags.finalOnly,
    });
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
      footer={<Explain>{s.treeExplain}</Explain>}
    >
      {modeField}
      <Field primary label={s.preset}>
        <Segmented
          size="sm"
          value={activePreset ?? ('' as TreePresetId)}
          options={(Object.keys(TREE_PRESETS) as TreePresetId[]).map((id) => ({ value: id, label: s.treePresets[id] }))}
          onChange={(id) => set(TREE_PRESETS[id])}
        />
      </Field>
      <Field label={s.actionList} hint={s.actionListHint} error={run.error && cfg.alist.trim() !== '' ? run.error.message : undefined}>
        <TextField value={cfg.alist} onChange={(alist) => set({ alist })} placeholder={s.actionListPh} invalid={!!run.error && cfg.alist.trim() !== ''} ariaLabel={s.actionList} />
      </Field>
      {cfg.alist.trim() === '' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label={s.seed}>
              <NumberField value={cfg.seed} min={0} max={99999} onChange={(seed) => set({ seed })} ariaLabel={s.seed} />
            </Field>
            <Field label={s.actions}>
              <NumberField value={cfg.actions} min={1} max={100} onChange={(actions) => set({ actions })} ariaLabel={s.actions} />
            </Field>
          </div>
          <Field label={s.forkPct} hint={s.forkPctHint}>
            <Segmented size="sm" value={cfg.forks} options={FORK_PCTS.map((v) => ({ value: v, label: String(v) }))} onChange={(forks) => set({ forks })} />
          </Field>
        </>
      )}
      <div className="mb-4 space-y-2.5">
        <Toggle checked={cfg.R} onChange={(R) => set({ R })} label={s.localReparent} />
        <Toggle checked={cfg.L} onChange={(L) => set({ L })} label={s.leafOnly} />
      </div>
      <Field label={s.view}>
        <Segmented size="sm" value={cfg.view} options={(['solve', 'tree', 'action'] as TreeView[]).map((v) => ({ value: v, label: s.views[v] }))} onChange={(view) => set({ view })} />
      </Field>
      <div className="mb-4">
        <Toggle checked={cfg.F} onChange={(F) => set({ F })} label={s.finalOnly} />
      </div>
      <Field label={s.pasteFlags} error={pasteErr.length > 0 && s.badFlags(pasteErr)}>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <TextField value={paste} onChange={setPaste} placeholder={s.pastePh} invalid={pasteErr.length > 0} ariaLabel={s.pasteFlags} />
          </div>
          <Button onClick={applyPaste} disabled={paste.trim() === ''}>
            {s.apply}
          </Button>
        </div>
      </Field>
      <div className="mb-4 rounded-xl border border-line bg-sunken px-3 py-2.5">
        <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.07em] text-ink-3">{t.sameAsOstep}</div>
        <code className="block break-all font-mono text-[12.5px] text-ink">{command}</code>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          icon={<Icons.dice className="size-3.5" />}
          onClick={() => {
            const r = new PyRandom(Math.floor(Math.random() * 1e9));
            set({ alist: '', seed: r.randint(0, 999), actions: r.randint(4, 10), forks: r.choice([0.3, 0.5, 0.7, 0.9]) });
          }}
        >
          {t.random}
        </Button>
        <ShareButton />
      </div>
    </Panel>
  );

  const node = (id: string) => {
    const c = proc(color.get(id) ?? 0);
    const isGhost = ghost?.name === id;
    const actor = cur && (cur.actor === id || cur.child === id) && !actionHidden(idx);
    return (
      <button
        type="button"
        onMouseEnter={() => setHover(id)}
        onMouseLeave={() => setHover(null)}
        onClick={() => stepper.setIndex(born.get(id) ?? 0)}
        className={clsx(
          'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[13px] transition-all duration-200',
          isGhost ? 'border-dashed border-line-strong text-ink-3 line-through opacity-60' : clsx(c.border, c.soft, 'text-ink'),
          actor && !isGhost && 'ring-2 ring-accent ring-offset-1 ring-offset-sunken',
          hover === id && 'ring-2 ring-ink-3',
        )}
      >
        <span className={clsx('size-2 rounded-full', isGhost ? 'bg-ink-3' : c.dot)} />
        {id}
        {orphanNames.has(id) && !actionHidden(idx) && (
          <Badge tone="warn" className="px-1.5 py-0 text-[10.5px]">
            {cfg.R ? '↑' : '→ a'}
          </Badge>
        )}
      </button>
    );
  };

  const narration = () => {
    if (!cur) return <Narration>{s.treeStart}</Narration>;
    if (actionHidden(idx))
      return (
        <Narration tone="info">
          <span>{s.hiddenAction}</span>
          <button type="button" className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline" onClick={() => show(idx)}>
            <Icons.eye className="size-3.5" /> {s.show}
          </button>
        </Narration>
      );
    const tone = cur.kind === 'fork' ? 'ok' : cur.kind === 'exitFailed' ? 'warn' : cur.orphans.length ? 'warn' : 'bad';
    const tos = [...new Set(cur.orphans.map((o) => o.to))];
    return (
      <Narration key={idx} tone={tone}>
        <code className="rounded bg-surface/60 px-1.5">{cur.action}</code>
        <span>{cur.kind === 'fork' ? s.forks(cur.actor, cur.child!) : cur.kind === 'exitFailed' ? s.exitFailed(cur.actor) : s.exits(cur.actor)}</span>
        {cur.orphans.length > 0 && <span>{s.orphansTo(cur.orphans.map((o) => o.name), tos.join(', '), cfg.R)}</span>}
      </Narration>
    );
  };

  // practice questions, computed from this setup
  const practice = useMemo(() => {
    if (total === 0) return null;
    const orphanStep = run.steps.findIndex((x) => x.orphans.length > 0);
    const k = orphanStep >= 0 ? orphanStep + 1 : total;
    const k2 = Math.max(1, Math.ceil(total / 2));
    const before = k2 > 1 ? run.steps[k2 - 2].tree : run.initial;
    let forkPct: { lo: number; hi: number } | null = null;
    if (cfg.alist.trim() === '') {
      const fin = (f: number) => {
        const r = simulateForkPy({ ...py, forkPct: f });
        return preorder(r.steps.at(-1)?.tree ?? r.initial).length;
      };
      forkPct = { lo: fin(0.1), hi: fin(0.9) };
    }
    return { k, k2, before, orphanStep, forkPct };
  }, [run, total, py, cfg.alist]);

  const pre = (txt: string) => <pre className="mt-2 overflow-x-auto rounded-lg bg-sunken px-3 py-2 font-mono text-[12.5px] leading-snug text-ink">{txt}</pre>;

  return (
    <Bench setup={setup}>
      <Panel title={t.stepOf(idx, total)} actions={<Badge tone="accent">{cfg.alist.trim() ? '-A' : `-s ${cfg.seed}`}</Badge>}>
        <StepControls stepper={stepper} />

        {/* actions */}
        <div className="mt-5 flex flex-wrap gap-1.5">
          {run.actions.map((a, i) => {
            const st = run.steps[i];
            const bad = run.error?.index === i;
            const skipped = !st && !bad;
            const seen = i < idx;
            const now = i === idx - 1;
            const hidden = actionHidden(i + 1);
            const hot = hover !== null && involved(i).includes(hover);
            return (
              <button
                key={i}
                type="button"
                disabled={skipped}
                onClick={() => (bad ? stepper.setIndex(total) : stepper.setIndex(i + 1))}
                onMouseEnter={() => st && setHover(st.child ?? st.actor)}
                onMouseLeave={() => setHover(null)}
                className={clsx(
                  'rounded-md px-2 py-1 font-mono text-[12.5px] transition-all duration-200',
                  bad
                    ? 'bg-bad-soft text-bad line-through'
                    : skipped
                      ? 'bg-sunken text-ink-3 line-through opacity-50'
                      : seen && !hidden
                        ? st.kind === 'fork'
                          ? 'bg-ok-soft text-ok'
                          : st.kind === 'exit'
                            ? 'bg-bad-soft text-bad'
                            : 'bg-warn-soft text-warn'
                        : 'bg-sunken text-ink-3 hover:text-ink',
                  now && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
                  hot && !now && !hidden && 'ring-1 ring-ink-3',
                )}
              >
                {hidden ? '?' : a}
              </button>
            );
          })}
        </div>

        {/* tree */}
        <div className="mt-4 min-h-[132px] overflow-x-auto rounded-xl border border-line bg-sunken p-3">
          {treeHidden ? (
            <div className="grid min-h-[106px] place-items-center text-center">
              <div>
                <p className="text-[13.5px] text-ink-2">{cfg.F && idx < total ? s.hiddenFinal : s.hiddenTree}</p>
                {!(cfg.F && idx < total) && (
                  <Button size="sm" className="mt-2" icon={<Icons.eye className="size-3.5" />} onClick={() => show(idx)}>
                    {s.show}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <ProcTree roots={['a']} childrenOf={childrenOf} renderNode={node} isNew={(id) => cur?.kind === 'fork' && cur.child === id} idPrefix="fp" />
          )}
        </div>

        <div className="mt-4 space-y-2">
          {narration()}
          {run.error && idx === total && (
            <Narration tone="bad">
              <span>{s.treeError}</span>
              <code>{run.error.message}</code>
            </Narration>
          )}
        </div>

        <div className="-mx-4 -mb-4 mt-4 border-t border-line">
          <StatGrid cols={4}>
            <Stat label={s.alive} value={treeHidden ? '?' : stats.alive} />
            <Stat label={s.forkCount} value={stats.forks} tone="ok" />
            <Stat label={s.exitCount} value={stats.exits} tone="bad" />
            <Stat label={s.reparented} value={stats.orphans} tone="warn" sub={s.reparentedSub} />
          </StatGrid>
          <details className="group border-t border-line">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[13px] font-medium text-ink hover:text-accent [&::-webkit-details-marker]:hidden">
              <span className="font-mono text-[12px] text-ink-3">$</span>
              {s.realOutput}
              <Icons.next className="ml-auto size-4 text-ink-3 transition-transform group-open:rotate-90" />
            </summary>
            <pre className="max-h-96 overflow-auto px-4 pb-4 font-mono text-[11.5px] leading-snug text-ink-2">{forkPyOutput(py, { showTree: cfg.view === 'action', finalOnly: cfg.F, solve: cfg.view === 'solve', style: 'fancy', seedArg: cfg.alist.trim() ? -1 : cfg.seed })}</pre>
          </details>
        </div>
      </Panel>

      {practice && (
        <Panel title={s.practice}>
          <div className="grid gap-3 md:grid-cols-2">
            <Reveal question={s.treePractice.afterQ(practice.k, run.steps[practice.k - 1].action)}>{pre(treeText(run.steps[practice.k - 1].tree))}</Reveal>
            <Reveal
              question={
                <>
                  <span>{s.treePractice.whichQ}</span>
                  {pre(treeText(practice.before))}
                  <span className="mt-2 block">{s.treePractice.whichQ2}</span>
                  {pre(treeText(run.steps[practice.k2 - 1].tree))}
                </>
              }
            >
              <code>{run.steps[practice.k2 - 1].action}</code> — {run.steps[practice.k2 - 1].text}
            </Reveal>
            {practice.orphanStep >= 0 ? (
              <Reveal question={s.treePractice.orphanQ(run.steps[practice.orphanStep].actor, (prevOf(run.steps, practice.orphanStep, run.initial).children[run.steps[practice.orphanStep].actor] ?? []).slice())}>
                {s.treePractice.orphanA('a', run.steps[practice.orphanStep].exited!.parent)}
              </Reveal>
            ) : (
              practice.forkPct && <Reveal question={s.treePractice.forkPctQ}>{s.treePractice.forkPctA(practice.forkPct.lo, practice.forkPct.hi)}</Reveal>
            )}
          </div>
        </Panel>
      )}
    </Bench>
  );
}

function prevOf(steps: { tree: TreeSnap }[], i: number, initial: TreeSnap): TreeSnap {
  return i > 0 ? steps[i - 1].tree : initial;
}
