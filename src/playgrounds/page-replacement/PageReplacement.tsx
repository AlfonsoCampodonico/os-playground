import clsx from 'clsx';
import { useMemo, useState } from 'react';
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
  type Tone,
} from '../../components/kit';
import type { Lang } from '../../lib/i18n';
import {
  POLICIES,
  PRESETS,
  compareAll,
  configFromFlags,
  faultCurve,
  ostepCommand,
  parseAddresses,
  simulate,
  traceOf,
  type ClockHand,
  type Policy,
  type PrConfig,
  type PrStep,
} from '../../sim/page-replacement';
import { FaultCurve, PolicyBars } from './Compare';
import { FrameGrid } from './FrameGrid';
import { PolicyView, policyViewTitle } from './PolicyView';
import { S, type PresetKey, type PrStrings } from './strings';

const MAX_TRACE = 60;
const MAX_FRAMES = 8;

const DEFAULTS = {
  policy: 'FIFO' as string,
  frames: 3,
  bits: 2,
  hand: 'circular' as string,
  src: 'list' as string,
  trace: PRESETS.ch22.addresses as string,
  seed: 0,
  n: 10,
  max: 10,
};
type UrlCfg = typeof DEFAULTS;

const PRESET_KEYS: PresetKey[] = ['ch22', 'belady', 'loop', 's0', 's1', 's2'];

function presetPatch(id: PresetKey): Partial<UrlCfg> {
  if (id === 's0' || id === 's1' || id === 's2') return { src: 'gen', seed: Number(id[1]), n: 10, max: 10, frames: 3 };
  const p = PRESETS[id];
  return { src: 'list', trace: p.addresses, frames: p.cacheSize, ...('policy' in p ? { policy: p.policy } : {}) };
}

function presetActive(id: PresetKey, c: UrlCfg): boolean {
  if (id === 's0' || id === 's1' || id === 's2') return c.src === 'gen' && c.seed === Number(id[1]) && c.n === 10 && c.max === 10 && c.frames === 3;
  const p = PRESETS[id];
  return c.src === 'list' && c.frames === p.cacheSize && parseAddresses(c.trace).pages.join(',') === p.addresses;
}

export default function PageReplacementPlayground({ lang }: { lang: Lang }) {
  return (
    <LangProvider lang={lang}>
      <PageReplacement />
    </LangProvider>
  );
}

function PageReplacement() {
  const s = useStrings(S);
  const t = useUi();
  const [url, set, reset] = useUrlState(DEFAULTS);
  const [hover, setHover] = useState<number | null>(null);
  const [flags, setFlags] = useState('');
  const [flagMsg, setFlagMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const policy: Policy = (POLICIES as readonly string[]).includes(url.policy) ? (url.policy as Policy) : 'FIFO';
  const hand: ClockHand = url.hand === 'ostep' ? 'ostep' : 'circular';
  const listMode = url.src !== 'gen';
  const parsed = useMemo(() => parseAddresses(url.trace), [url.trace]);
  const tooLong = listMode && parsed.pages.length > MAX_TRACE;

  const cfg: PrConfig = useMemo(
    () => ({
      policy,
      cacheSize: url.frames,
      clockBits: url.bits,
      clockHand: hand,
      addresses: listMode ? parsed.pages.slice(0, MAX_TRACE) : null,
      numAddrs: url.n,
      maxPage: url.max,
      seed: url.seed,
    }),
    [policy, url.frames, url.bits, hand, listMode, parsed, url.n, url.max, url.seed],
  );
  const run = useMemo(() => simulate(cfg), [cfg]);
  const stepper = useStepper(run.steps.length, { startAt: 'first' });
  const cur: PrStep | undefined = stepper.index > 0 ? run.steps[stepper.index - 1] : undefined;
  const total = run.trace.length;

  // Comparison: every policy on the same trace, and faults vs. frames.
  const compare = useMemo(() => compareAll(cfg), [cfg]);
  const distinct = useMemo(() => new Set(run.trace).size, [run.trace]);
  const maxFrames = Math.min(10, Math.max(distinct, cfg.cacheSize + 1, 2));
  const curves = useMemo(
    () => ({ FIFO: faultCurve(cfg, 'FIFO', maxFrames), LRU: faultCurve(cfg, 'LRU', maxFrames), OPT: faultCurve(cfg, 'OPT', maxFrames) }),
    [cfg, maxFrames],
  );

  const hits = cur?.hits ?? 0;
  const misses = cur?.misses ?? 0;
  const evictions = cur?.evictions ?? 0;
  const done = hits + misses;
  const rate = (h: number, n: number) => (n === 0 ? '—' : `${Math.round((h / n) * 100)}%`);
  const circular = policy === 'CLOCK' && hand === 'circular';
  const ostepCfg: PrConfig = { ...cfg, clockHand: 'ostep' };

  const applyFlags = () => {
    if (!flags.trim()) return;
    const { cfg: c, errors } = configFromFlags(flags);
    if (errors.length) {
      setFlagMsg({ ok: false, text: s.flagErr(errors) });
      return;
    }
    set({
      policy: c.policy,
      frames: Math.max(1, Math.min(MAX_FRAMES, c.cacheSize)),
      bits: Math.max(0, Math.min(4, c.clockBits)),
      hand: 'ostep',
      src: c.addresses ? 'list' : 'gen',
      ...(c.addresses ? { trace: c.addresses.join(',') } : {}),
      seed: Math.max(0, c.seed),
      n: Math.max(1, Math.min(MAX_TRACE, c.numAddrs)),
      max: Math.max(1, Math.min(99, c.maxPage)),
    });
    setFlagMsg({ ok: true, text: s.applied });
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
          value={PRESET_KEYS.find((id) => presetActive(id, url)) ?? ('' as PresetKey)}
          options={PRESET_KEYS.map((id) => ({ value: id, label: s.presets[id], title: s.presetTitles[id] }))}
          onChange={(id) => set(presetPatch(id))}
        />
      </Field>
      <Field label={s.policy} hint={s.policyHint[policy]}>
        <Segmented value={policy} options={POLICIES.map((p) => ({ value: p, label: p }))} onChange={(p) => set({ policy: p })} />
      </Field>
      <Field label={s.frames} hint="-C">
        <NumberField value={url.frames} min={1} max={MAX_FRAMES} onChange={(frames) => set({ frames })} ariaLabel={s.frames} />
      </Field>
      {policy === 'CLOCK' && (
        <>
          <Field label={s.clockBits} hint={`-b · ${s.clockBitsHint}`}>
            <NumberField value={url.bits} min={0} max={4} onChange={(bits) => set({ bits })} ariaLabel={s.clockBits} />
          </Field>
          <Field label={s.hand} hint={hand === 'circular' ? s.handCircularHint : s.handOstepHint}>
            <Segmented
              size="sm"
              value={hand}
              options={[
                { value: 'circular', label: s.handCircular },
                { value: 'ostep', label: s.handOstep },
              ]}
              onChange={(h) => set({ hand: h })}
            />
          </Field>
        </>
      )}
      <Field label={s.source}>
        <Segmented
          size="sm"
          value={listMode ? 'list' : 'gen'}
          options={[
            { value: 'list', label: s.srcList },
            { value: 'gen', label: s.srcGen },
          ]}
          onChange={(src) => set(src === 'list' && !listMode ? { src, trace: run.trace.join(',') } : { src })}
        />
      </Field>
      {listMode ? (
        <Field label={s.trace} hint={s.traceHint} error={(parsed.bad.length > 0 && s.bad(parsed.bad)) || (tooLong && s.tooLong(MAX_TRACE))}>
          <TextField multiline rows={2} value={url.trace} onChange={(v) => set({ trace: v })} invalid={parsed.bad.length > 0 || tooLong} ariaLabel={s.trace} />
        </Field>
      ) : (
        <div className="mb-4 grid grid-cols-3 gap-2">
          <Field label={s.seed} hint="-s">
            <NumberField value={url.seed} min={0} max={99999} onChange={(seed) => set({ seed })} ariaLabel={s.seed} />
          </Field>
          <Field label={s.numAddrs} hint="-n">
            <NumberField value={url.n} min={1} max={MAX_TRACE} onChange={(n) => set({ n })} ariaLabel={s.numAddrs} />
          </Field>
          <Field label={s.maxPage} hint="-m">
            <NumberField value={url.max} min={1} max={99} onChange={(max) => set({ max })} ariaLabel={s.maxPage} />
          </Field>
        </div>
      )}
      {listMode && (policy === 'RAND' || (policy === 'CLOCK' && hand === 'ostep')) && (
        <Field label={s.seed} hint="-s">
          <NumberField value={url.seed} min={0} max={99999} onChange={(seed) => set({ seed })} ariaLabel={s.seed} />
        </Field>
      )}
      <Field label={s.paste} error={flagMsg && !flagMsg.ok && flagMsg.text}>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <TextField
              value={flags}
              onChange={(v) => {
                setFlags(v);
                setFlagMsg(null);
              }}
              placeholder={s.pastePh}
              invalid={!!flagMsg && !flagMsg.ok}
              ariaLabel={s.paste}
            />
          </div>
          <Button onClick={applyFlags} disabled={!flags.trim()}>
            {s.apply}
          </Button>
        </div>
        {flagMsg?.ok && <p className="mt-1.5 animate-rise text-[12px] text-ok">{flagMsg.text}</p>}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          icon={<Icons.dice className="size-3.5" />}
          onClick={() => {
            const seed = Math.floor(Math.random() * 1000);
            set({ src: 'gen', seed, n: url.src === 'gen' ? url.n : 10, max: url.src === 'gen' ? url.max : 10 });
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
        title={t.stepOf(stepper.index, stepper.total)}
        actions={
          <Badge tone="accent">
            {policy} · {cfg.cacheSize}
          </Badge>
        }
        footer={
          <StatGrid cols={4}>
            <Stat label={s.hits} value={hits} tone="ok" />
            <Stat label={s.faults} value={misses} tone="bad" sub={s.coldSub(misses - evictions)} />
            <Stat label={s.hitRate} value={rate(hits, done)} />
            <Stat label={s.evictions} value={evictions} />
          </StatGrid>
        }
      >
        <StepControls stepper={stepper} />
        <div className="mt-5">
          <FrameGrid
            run={run}
            index={stepper.index}
            policy={policy}
            circular={circular}
            frames={cfg.cacheSize}
            hover={hover}
            setHover={setHover}
            onJump={(i) => stepper.setIndex(i)}
          />
        </div>
        <div className="mt-4">
          <StepNarration step={cur} policy={policy} total={total} s={s} hover={hover} setHover={setHover} />
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title={policyViewTitle(policy, s)} actions={<Badge>{policy}</Badge>}>
          <PolicyView run={run} index={stepper.index} policy={policy} frames={cfg.cacheSize} clockBits={cfg.clockBits} circular={circular} hover={hover} setHover={setHover} />
        </Panel>
        <Panel title={s.ostep}>
          <code className="block overflow-x-auto whitespace-nowrap rounded-lg bg-sunken px-3 py-2 font-mono text-[12.5px] text-ink">{ostepCommand(ostepCfg)}</code>
          {circular && <p className="mt-2 text-[12px] leading-relaxed text-warn">{s.circularWarn}</p>}
          <div className="mt-4 mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">{s.scriptLine}</div>
          <pre className="overflow-x-auto rounded-lg border border-line px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink-2">
            {cur ? (
              <span key={stepper.index} className={clsx('block animate-rise', cur.hit ? 'text-ok' : 'text-bad')}>
                {cur.line}
              </span>
            ) : (
              <span className="text-ink-3">…</span>
            )}
            {stepper.index === total && total > 0 && <span className="mt-1 block text-ink">{run.finalLine}</span>}
          </pre>
        </Panel>
      </div>

      <Panel title={s.compare} actions={<span className="hidden font-mono text-[11px] text-ink-3 sm:inline">{s.sameTrace(total, cfg.cacheSize)}</span>}>
        <div className="grid gap-6 md:grid-cols-2">
          <PolicyBars rows={compare} total={total} policy={policy} onPick={(p) => set({ policy: p })} />
          <div>
            <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">{s.curve}</div>
            <FaultCurve curves={curves} frames={cfg.cacheSize} total={total} onFrames={(k) => set({ frames: Math.min(MAX_FRAMES, k) })} />
          </div>
        </div>
      </Panel>

      {total > 0 && <Practice cfg={cfg} s={s} />}
    </Bench>
  );
}

function StepNarration({
  step,
  policy,
  total,
  s,
  hover,
  setHover,
}: {
  step: PrStep | undefined;
  policy: Policy;
  total: number;
  s: PrStrings;
  hover: number | null;
  setHover: (p: number | null) => void;
}) {
  if (!step) return <Narration>{s.start}</Narration>;
  const tone: Tone = step.hit ? 'ok' : step.victim === null ? 'warn' : 'bad';
  const Page = ({ p }: { p: number }) => (
    <b className={clsx('cursor-default rounded px-1 font-semibold transition-colors', hover === p && 'bg-ink text-surface')} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}>
      {p}
    </b>
  );
  let why = '';
  if (step.victim !== null) {
    const v = step.victim;
    if (policy === 'FIFO' || policy === 'LRU' || policy === 'MRU') why = s.why[policy]();
    else if (policy === 'OPT' || policy === 'UNOPT') {
      const f = step.future!.find((x) => x.page === v)!;
      why = f.next >= total ? s.why[`${policy}never`]() : s.why[policy](f.next + 1);
    } else if (policy === 'RAND') why = s.why.RAND(step.pick!);
    else why = s.why.CLOCK(step.scan!.length);
  }
  return (
    <Narration key={step.index} tone={tone}>
      <span className="opacity-70">#{step.index + 1}</span>
      <span>
        {s.access.toLowerCase()} <Page p={step.page} />
      </span>
      <span className="opacity-50">→</span>
      <b className="font-semibold">{step.hit ? s.hit : `${s.miss} (${s.pf})`}</b>
      {step.hit ? (
        <span className="opacity-80">
          ({s.inFrame(step.slot)}
          {s.hitWhy[policy] && `, ${s.hitWhy[policy]}`})
        </span>
      ) : step.victim === null ? (
        <span className="opacity-80">({s.freeFrame(step.slot)})</span>
      ) : (
        <>
          <span className="opacity-80">
            {s.full}: {s.evicts(policy, step.victim)} ({why})
          </span>
          <span className="opacity-50">→</span>
          <span>{s.goesTo(step.page, step.slot)}</span>
        </>
      )}
    </Narration>
  );
}

function Practice({ cfg, s }: { cfg: PrConfig; s: PrStrings }) {
  const data = useMemo(() => {
    const fifo = simulate({ ...cfg, policy: 'FIFO' });
    const lru = simulate({ ...cfg, policy: 'LRU' });
    const opt = simulate({ ...cfg, policy: 'OPT' });
    // The most instructive OPT eviction: the first one where FIFO would pick differently.
    const evs = opt.steps.filter((st) => st.victim !== null);
    const q2 = evs.find((st) => fifo.steps[st.index].victim !== st.victim) ?? evs[0];
    const c = cfg.cacheSize;
    const more = { f0: fifo.misses, f1: simulate({ ...cfg, policy: 'FIFO', cacheSize: c + 1 }).misses, l0: lru.misses, l1: simulate({ ...cfg, policy: 'LRU', cacheSize: c + 1 }).misses };
    return { fifo, lru, opt, q2, more, n: traceOf(cfg).length };
  }, [cfg]);
  const { fifo, lru, opt, q2, more, n } = data;
  const f2 = q2?.future?.find((f) => f.page === q2.victim);
  return (
    <Panel title={s.practice}>
      <div className="grid gap-3 md:grid-cols-2">
        <Reveal question={s.q1(cfg.cacheSize)}>{s.a1(fifo.misses, fifo.hits, lru.misses, opt.misses)}</Reveal>
        {q2 && f2 && (
          <Reveal question={s.q2(q2.index + 1, q2.page)}>
            {f2.next >= n ? s.a2never(q2.victim!, q2.memoryBefore.join(', ')) : s.a2(q2.victim!, f2.next + 1, q2.memoryBefore.join(', '))}
          </Reveal>
        )}
        <Reveal question={s.q3(cfg.cacheSize)}>{s.a3(cfg.cacheSize, more.f0, more.f1, more.l0, more.l1)}</Reveal>
      </div>
    </Panel>
  );
}
