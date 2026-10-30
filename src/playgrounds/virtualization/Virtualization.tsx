import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
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
} from '../../components/kit';
import type { Lang } from '../../lib/i18n';
import {
  N_LAYERS,
  SCENARIOS,
  V_LAYERS,
  hasAppendixTable,
  randomSetup,
  simulateVirt,
  type Belief,
  type NLayer,
  type Priv,
  type Scenario,
  type Step,
  type VLayer,
} from '../../sim/virtualization';
import { Contrast, Protocol, Stack, VmmPanel, XlatePanel, type Hover } from './parts';
import { S } from './strings';
import { M, type Kind } from './modeStrings';
import { Compare, ContainersMode, MicrovmMode } from './Modes';

const DEFAULTS = { sc: 'syscall', hw: false, pv: false, spins: 3 };

/** Bare-machine layer that plays the same role as a VMM-column layer. */
const twin: Record<string, string> = { app: 'app', guest: 'os', os: 'guest', hw: 'hw' };

export default function VirtualizationPlayground({ lang }: { lang: Lang }) {
  return (
    <LangProvider lang={lang}>
      <Virtualization />
    </LangProvider>
  );
}

function Virtualization() {
  const m = useStrings(M);
  const [k, setK] = useUrlState({ kind: 'vm' });
  const kind: Kind = k.kind === 'microvm' || k.kind === 'containers' ? k.kind : 'vm';
  const picker = (
    <Field label={m.kind}>
      <Segmented value={kind} options={(['vm', 'microvm', 'containers'] as const).map((v) => ({ value: v, label: m.kinds[v] }))} onChange={(v) => setK({ kind: v })} ariaLabel={m.kind} />
    </Field>
  );
  const extra = <Compare kind={kind} />;
  if (kind === 'microvm') return <MicrovmMode picker={picker} extra={extra} />;
  if (kind === 'containers') return <ContainersMode picker={picker} extra={extra} />;
  return <VmMode picker={picker} extra={extra} />;
}

function VmMode({ picker, extra }: { picker: React.ReactNode; extra: React.ReactNode }) {
  const s = useStrings(S);
  const t = useUi();
  const [cfg, set, reset] = useUrlState(DEFAULTS);
  const scenario: Scenario = (SCENARIOS as readonly string[]).includes(cfg.sc) ? (cfg.sc as Scenario) : 'syscall';
  const run = useMemo(() => simulateVirt({ scenario, assist: cfg.hw, paravirt: cfg.pv, spins: cfg.spins }), [scenario, cfg.hw, cfg.pv, cfg.spins]);
  const stepper = useStepper(run.virt.steps.length, { startAt: 'first' });
  const { first } = stepper;
  useEffect(() => first(), [scenario, first]);
  const [hover, setHover] = useState<Hover & { side?: 'v' | 'n' }>({});

  const i = stepper.index;
  const cur = i > 0 ? run.virt.steps[i - 1] : undefined;
  const vState = cur ?? run.virt.initial;
  const ni = run.nativeIndex(i);
  const nCur = ni > 0 ? run.native.steps[ni - 1] : undefined;
  const nState = nCur ?? run.native.initial;
  const nDone = ni === run.native.steps.length && i < run.virt.steps.length && i > 0;
  const vEnd = run.virt.steps[run.virt.steps.length - 1];
  const nEnd = run.native.steps[run.native.steps.length - 1];
  const mode = run.mode;
  const hwMode = mode === 'hw' || mode === 'pvh';
  const pvMode = mode === 'pv' || mode === 'pvh';

  const vc = vState.counters;
  const nc = nState.counters;
  const ratio = (v: number, n: number) => (n === 0 ? '—' : `×${(v / n).toFixed(1)}`);

  /* layer metadata for the stacks */
  const vPriv = (l: VLayer): Priv | null =>
    l === 'hw' ? null : l === 'vmm' ? (hwMode ? 'root' : 'kernel') : l === 'guest' ? (hwMode ? 'nonroot-kernel' : 'user') : hwMode ? 'nonroot-user' : 'user';
  const vBelief = (l: VLayer): Belief | null => (l === 'guest' ? (pvMode ? 'aware' : 'kernel') : null);
  const nPriv = (l: NLayer): Priv | null => (l === 'hw' ? null : l === 'os' ? 'kernel' : 'user');

  /* jumping from the visualization */
  const jumpVirtToLayer = (l: VLayer, vm: 1 | 2) => {
    const steps = run.virt.steps;
    const match = (st: Step<VLayer>) => st.actor === l && (!run.multiVm || (l !== 'app' && l !== 'guest') || st.vm === vm);
    const after = steps.find((st) => st.n > i && match(st)) ?? steps.find(match);
    if (after) stepper.setIndex(after.n);
  };
  const jumpToNative = (k: number) => {
    for (let j = 0; j <= run.virt.steps.length; j++)
      if (run.nativeIndex(j) >= k) {
        stepper.setIndex(j);
        return;
      }
  };
  const jumpNativeToLayer = (l: NLayer) => {
    const steps = run.native.steps;
    const after = steps.find((st) => st.n > ni && st.actor === l) ?? steps.find((st) => st.actor === l);
    if (after) jumpToNative(after.n);
  };

  const hotV = (l: string) => (hover.side === 'v' ? hover.layer === l : hover.layer !== undefined && twin[hover.layer] === l);
  const hotN = (l: string) => (hover.side === 'n' ? hover.layer === l : hover.layer !== undefined && twin[hover.layer] === l);
  const presetName = s.presets[scenario];
  const syscall = useMemo(() => simulateVirt({ scenario: 'syscall', assist: cfg.hw, paravirt: cfg.pv, spins: 3 }), [cfg.hw, cfg.pv]);
  const sysEnd = syscall.virt.steps[syscall.virt.steps.length - 1].counters;

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
      {picker}
      <Field label={s.scenario}>
        <Segmented size="sm" value={scenario} options={SCENARIOS.map((id) => ({ value: id, label: s.presets[id] }))} onChange={(sc) => set({ sc })} ariaLabel={s.scenario} />
      </Field>
      <Field label={s.toggles}>
        <div className="space-y-3 rounded-xl border border-line p-3">
          <Toggle checked={cfg.hw} onChange={(hw) => set({ hw })} label={s.assist} />
          <Toggle checked={cfg.pv} onChange={(pv) => set({ pv })} label={s.paravirt} />
          <div className="rounded-lg bg-sunken px-3 py-2">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={`${scenario}-${mode}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16 }}
                className="text-[12.5px] leading-snug text-ink-2"
              >
                <b className="font-medium text-ink">{s.modeName[mode]}:</b> {s.notes[scenario][mode]}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
      </Field>
      {scenario === 'idle' && !pvMode && (
        <Field label={s.spins}>
          <NumberField value={cfg.spins} min={1} max={8} onChange={(spins) => set({ spins })} ariaLabel={s.spins} />
        </Field>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          icon={<Icons.dice className="size-3.5" />}
          onClick={() => {
            const p = randomSetup(Math.floor(Math.random() * 1e9));
            set({ sc: p.scenario, hw: p.assist, pv: p.paravirt, spins: p.spins });
          }}
        >
          {t.random}
        </Button>
        <ShareButton />
      </div>
    </Panel>
  );

  return (
    <Bench setup={setup}>
      <Panel
        title={t.stepOf(i, stepper.total)}
        actions={<Badge tone="accent">{s.modeName[mode]}</Badge>}
        bodyClassName="p-0"
      >
        <div className="p-4">
          <StepControls stepper={stepper} />

          <div className="mt-5 grid gap-5 sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <ColumnTitle>{s.withVmm}</ColumnTitle>
              <Stack<VLayer>
                layers={V_LAYERS}
                labels={s.layers}
                state={vState}
                step={cur}
                multiVm={run.multiVm}
                vms={vState.vmm.vms}
                privFor={vPriv}
                beliefFor={vBelief}
                tokenId="virt-token"
                hot={hotV}
                onHover={(l) => setHover(l ? { side: 'v', layer: l } : {})}
                onPick={jumpVirtToLayer}
                trapCount={{ layer: 'vmm', value: vc.traps + vc.hypercalls, label: vc.hypercalls > 0 ? s.entriesWord : s.trapsWord }}
                s={s}
              />
            </div>
            <div className="min-w-0">
              <ColumnTitle>
                {s.bare}
                <AnimatePresence>
                  {nDone && (
                    <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="ml-2 inline-block">
                      <Badge tone="ok">
                        <Icons.check className="size-3" /> {s.finished(run.native.steps.length)}
                      </Badge>
                    </motion.span>
                  )}
                </AnimatePresence>
              </ColumnTitle>
              <Stack<NLayer>
                layers={N_LAYERS}
                labels={s.nlayers}
                state={nState}
                step={nCur}
                privFor={nPriv}
                beliefFor={() => null}
                tokenId="native-token"
                hot={hotN}
                onHover={(l) => setHover(l ? { side: 'n', layer: l } : {})}
                onPick={(l) => jumpNativeToLayer(l)}
                trapCount={{ layer: 'os', value: nc.traps, label: s.trapsWord }}
                s={s}
                compact
              />
              <div className="mt-2 min-h-10 rounded-lg bg-sunken px-3 py-2 text-[12.5px] leading-snug text-ink-2">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.p key={nCur?.n ?? 0} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                    {nCur ? s.msg[nCur.msg] : '—'}
                  </motion.p>
                </AnimatePresence>
              </div>
            </div>
          </div>

          <Contrast state={vState} s={s} />

          <div className="mt-4">
            {cur ? (
              <Narration key={i} tone={cur.tone}>
                {cur.via && <b className="font-semibold uppercase">{s.via[cur.via]}</b>}
                {cur.via && <span className="opacity-50">→</span>}
                <span>{s.msg[cur.msg]}</span>
                {cur.emu && <Badge tone="info">{s.emu}</Badge>}
              </Narration>
            ) : (
              <Narration>{s.intro[scenario]}</Narration>
            )}
          </div>
          {scenario === 'idle' && vc.wasted > 0 && (
            <div className="mt-2">
              <Badge key={vc.wasted} tone="bad" className="animate-pop">
                {s.wasted(vc.wasted)}
              </Badge>
            </div>
          )}
        </div>
        <div className="border-t border-line">
          <StatGrid cols={4}>
            <Stat label={s.traps} value={vc.traps} tone={vc.traps > 0 ? 'warn' : 'neutral'} sub={s.trapsSub(nc.traps, vc.hypercalls)} />
            <Stat label={s.modes} value={vc.modeSwitches} sub={s.modesSub(nc.modeSwitches)} />
            <Stat label={s.emulated} value={vc.emulated} tone={vc.emulated > 0 ? 'info' : 'neutral'} sub={s.emulatedSub} />
            <Stat label={s.cost} value={ratio(vc.cost, nc.cost)} tone="accent" sub={s.costSub(vc.cost, nc.cost)} />
          </StatGrid>
        </div>
      </Panel>

      <div className={run.hasXlate ? 'grid gap-4 xl:grid-cols-2' : 'grid gap-4'}>
        <Panel title={s.vmmKnows} bodyClassName="p-2">
          <VmmPanel view={vState.vmm} scenario={scenario} mode={mode} multiVm={run.multiVm} s={s} />
        </Panel>
        {run.hasXlate && vState.xlate && (
          <Panel title={s.xlate}>
            <XlatePanel x={vState.xlate} nx={nState.xlate} scenario={scenario} mode={mode} s={s} />
          </Panel>
        )}
      </div>

      <Panel title={s.protocol}>
        <p className="mb-3 flex items-start gap-2 text-[12.5px] text-ink-2">
          <span className={hasAppendixTable(scenario, mode) ? 'mt-1.5 size-1.5 shrink-0 rounded-full bg-ok' : 'mt-1.5 size-1.5 shrink-0 rounded-full bg-ink-3'} />
          <span>{hasAppendixTable(scenario, mode) ? s.appendix : s.noAppendix}</span>
        </p>
        <ColumnTitle>{s.withVmm}</ColumnTitle>
        <Protocol<VLayer>
          steps={run.virt.steps}
          layers={V_LAYERS}
          labels={s.layers}
          index={i}
          s={s}
          minW="min-w-[680px]"
          hot={(st) => (hover.phase !== undefined && hover.side === 'n' ? st.phase === hover.phase : hotV(st.actor))}
          onHover={(st) => setHover(st ? { side: 'v', layer: st.actor, phase: st.phase } : {})}
          onJump={(n) => stepper.setIndex(n)}
        />
        <div className="mt-4">
          <ColumnTitle>{s.bare}</ColumnTitle>
          <Protocol<NLayer>
            steps={run.native.steps}
            layers={N_LAYERS}
            labels={s.nlayers}
            index={ni}
            s={s}
            minW="min-w-[540px]"
            hot={(st) => (hover.phase !== undefined && hover.side === 'v' ? st.phase === hover.phase : hotN(st.actor))}
            onHover={(st) => setHover(st ? { side: 'n', layer: st.actor, phase: st.phase } : {})}
            onJump={jumpToNative}
          />
        </div>
      </Panel>

      <Panel title={s.practice}>
        <div className="grid gap-3 md:grid-cols-2">
          <Reveal question={s.q1(s.modeName[mode])}>{s.a1[mode](sysEnd.traps)}</Reveal>
          <Reveal question={s.q2}>{s.a2}</Reveal>
          <Reveal question={s.q3(presetName)}>{s.a3(vEnd.counters.modeSwitches, nEnd.counters.modeSwitches, ratio(vEnd.counters.cost, nEnd.counters.cost))}</Reveal>
        </div>
      </Panel>
      {extra}
    </Bench>
  );
}

function ColumnTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 flex min-h-6 items-center font-mono text-[11px] font-medium uppercase tracking-[0.07em] text-ink-3">{children}</div>;
}
