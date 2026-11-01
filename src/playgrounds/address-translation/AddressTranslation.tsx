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
  useStepper,
  useStrings,
  useUi,
  useUrlState,
  type Tone,
} from '../../components/kit';
import type { Lang } from '../../lib/i18n';
import {
  PRESETS,
  SETUP_DEFAULTS,
  activePreset,
  convertSize,
  hex,
  human,
  parseFlags,
  randomPatch,
  runSetup,
  tableText,
  type Mech,
  type PresetId,
  type Run,
  type Setup,
  type SetupKey,
  type Step,
} from '../../sim/address-translation/index';
import { MemoryMap } from './MemoryMap';
import { MlWalk, PageTable, RegistersTable } from './Tables';
import { BitSplit, Flow } from './Walk';
import { S, type Strings } from './strings';

const MECHS: Mech[] = ['bb', 'seg', 'lin', 'ml'];

export default function AddressTranslationPlayground({ lang }: { lang: Lang }) {
  return (
    <LangProvider lang={lang}>
      <AddressTranslation />
    </LangProvider>
  );
}

/** Which URL key holds the typed VAs for the current mechanism/variant. */
function vaKey(c: Setup): SetupKey {
  if (c.mech === 'bb') return 'bbV';
  if (c.mech === 'seg') return c.sgBook ? 'sgBV' : 'sgV';
  if (c.mech === 'lin') return 'lnV';
  return c.mlBook ? 'mlBV' : 'mlV';
}

const outcomeTone = (st: Step): Tone => (st.outcome === 'ok' ? 'ok' : st.outcome === 'violation' ? 'bad' : 'warn');

function AddressTranslation() {
  const s = useStrings(S);
  const t = useUi();
  const [cfg, set, reset] = useUrlState(SETUP_DEFAULTS);
  const { run, bad } = useMemo(() => runSetup(cfg), [cfg]);
  const stepper = useStepper(run.steps.length, { startAt: 'first' });
  const [hover, setHover] = useState<string | null>(null);
  const cur = stepper.index > 0 ? run.steps[stepper.index - 1] : undefined;
  const digits = Math.max(2, Math.ceil(run.vaBits / 4));

  /** Jump to the next step (after the current one, wrapping) that uses this region. */
  const pick = (pred: (st: Step) => boolean) => {
    const n = run.steps.length;
    for (let k = 1; k <= n; k++) {
      const i = (stepper.index - 1 + k + n) % n;
      if (pred(run.steps[i])) return stepper.setIndex(i + 1);
    }
  };
  const pickRegion = (id: string) => pick((st) => st.region === id || (id.startsWith('pt') && st.region === null && `pt${st.pdi}` === id));

  const setup = <SetupPanel cfg={cfg} set={set} reset={reset} run={run} bad={bad} s={s} />;

  return (
    <Bench setup={setup}>
      <Panel title={t.stepOf(stepper.index, stepper.total)} actions={<Badge tone="accent">{s.mechs[cfg.mech]}</Badge>} bodyClassName="p-4 pb-0">
        {run.error ? (
          <Narration tone="bad">
            <span>{s.setupError}</span>
            <b className="font-semibold">{s.errors[run.error.code]}</b>
            <span className="opacity-75">Error: {run.error.msg}</span>
          </Narration>
        ) : (
          <>
            <StepControls stepper={stepper} />
            <div className="mt-5 flex flex-wrap gap-1.5">
              {run.steps.map((st, i) => {
                const seen = i < stepper.index;
                const now = i === stepper.index - 1;
                const tone = outcomeTone(st);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => stepper.setIndex(i + 1)}
                    onMouseEnter={() => setHover(st.region)}
                    onMouseLeave={() => setHover(null)}
                    className={clsx(
                      'rounded-md px-2 py-1 font-mono text-[12.5px] transition-all duration-200',
                      seen ? { ok: 'bg-ok-soft text-ok', bad: 'bg-bad-soft text-bad', warn: 'bg-warn-soft text-warn' }[tone as 'ok' | 'bad' | 'warn'] : 'bg-sunken text-ink-3 hover:text-ink',
                      now && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
                      hover !== null && hover === st.region && !now && 'ring-1 ring-ink-3',
                    )}
                    title={`${st.va}`}
                  >
                    {hex(st.va, digits)}
                  </button>
                );
              })}
            </div>
            <div className="mt-4">
              <StepNarration run={run} step={cur} s={s} digits={digits} />
            </div>
            {cur && <BitSplit key={`b${stepper.index}`} run={run} step={cur} s={s} />}
            {cur && <Flow key={`f${stepper.index}`} run={run} step={cur} s={s} />}
          </>
        )}
        <div className="-mx-4 mt-4 border-t border-line">
          <Stats run={run} step={cur} s={s} />
        </div>
      </Panel>

      {!run.error && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title={s.map}>
            <MemoryMap run={run} step={cur} hover={hover} setHover={setHover} onPick={pickRegion} s={s} />
          </Panel>
          {run.lin ? (
            <Panel
              title={s.pageTable}
              bodyClassName="p-0"
              actions={
                run.notes.includes('editedTable') ? (
                  <Button size="sm" variant="ghost" icon={<Icons.reset className="size-3.5" />} onClick={() => set({ lnT: '' })}>
                    {s.restoreTable}
                  </Button>
                ) : (
                  <span className="text-[11px] text-ink-3">{s.pageTableSub}</span>
                )
              }
            >
              <PageTable run={run} step={cur} hover={hover} setHover={setHover} s={s} onEdit={(tb) => set({ lnT: tableText(tb) })} onPickVpn={(vpn) => pick((st) => st.vpn === vpn)} />
            </Panel>
          ) : run.ml ? (
            <Panel title={s.walk}>
              <MlWalk run={run} step={cur} hover={hover} setHover={setHover} s={s} />
            </Panel>
          ) : (
            <Panel title={s.registers} bodyClassName="p-0">
              <RegistersTable run={run} step={cur} hover={hover} setHover={setHover} s={s} onPick={pickRegion} />
            </Panel>
          )}
        </div>
      )}

      <OstepPanel run={run} s={s} title={t.sameAsOstep} />

      {!run.error && run.steps.length > 0 && <Practice run={run} step={cur ?? run.steps[0]} s={s} digits={digits} />}
    </Bench>
  );
}

/* ---------- setup ---------- */

function SetupPanel({ cfg, set, reset, run, bad, s }: { cfg: Setup; set: (p: Partial<Setup>) => void; reset: () => void; run: Run; bad: string[]; s: Strings }) {
  const t = useUi();
  const [flags, setFlags] = useState('');
  const [flagsBad, setFlagsBad] = useState<string[]>([]);
  const preset = activePreset(cfg);
  const presets = PRESETS[cfg.mech];
  const vk = vaKey(cfg);

  const size = (key: SetupKey, label: string, hint?: string) => {
    const v = String(cfg[key]);
    return (
      <Field label={label} hint={hint}>
        <TextField value={v} onChange={(x) => set({ [key]: x } as Partial<Setup>)} invalid={!Number.isFinite(convertSize(v))} ariaLabel={label} />
      </Field>
    );
  };
  const num = (key: SetupKey, label: string, min: number, max: number) => (
    <Field label={label}>
      <NumberField value={Number(cfg[key])} min={min} max={max} onChange={(x) => set({ [key]: x } as Partial<Setup>)} ariaLabel={label} />
    </Field>
  );

  let params: ReactNode;
  if (cfg.mech === 'bb') {
    params = (
      <div className="grid grid-cols-2 gap-x-3">
        {num('bbS', s.seed, 0, 99999)}
        {num('bbN', s.num, 0, 30)}
        {size('bbA', s.asize)}
        {size('bbP', s.psize)}
        {size('bbB', s.base, s.randomHint)}
        {size('bbL', s.limit, s.randomHint)}
      </div>
    );
  } else if (cfg.mech === 'seg') {
    params = (
      <>
        <Field label={s.variant}>
          <Segmented
            size="sm"
            value={cfg.sgBook ? 'book' : 'ostep'}
            options={[
              { value: 'ostep', label: s.ostepVariant(2) },
              { value: 'book', label: s.bookSeg },
            ]}
            onChange={(v) => set({ sgBook: v === 'book' })}
          />
        </Field>
        {cfg.sgBook ? (
          <>
            <div className="grid grid-cols-2 gap-x-3">
              {size('sgBA', s.asize)}
              {size('sgBP', s.psize)}
            </div>
            <Field label={s.segRegs}>
              <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-2 gap-y-1.5">
                <span />
                <span className="text-[11px] text-ink-3">{s.baseCol}</span>
                <span className="text-[11px] text-ink-3">{s.sizeCol}</span>
                {(
                  [
                    ['code', 'sgCb', 'sgCs'],
                    ['heap', 'sgHb', 'sgHs'],
                    ['stack', 'sgSb', 'sgSs'],
                  ] as const
                ).map(([kind, b, z]) => (
                  <RegRow key={kind} label={s.segName[kind]} base={String(cfg[b])} size={String(cfg[z])} onBase={(x) => set({ [b]: x })} onSize={(x) => set({ [z]: x })} />
                ))}
              </div>
            </Field>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-x-3">
            {num('sgS', s.seed, 0, 99999)}
            {num('sgN', s.num, 0, 30)}
            {size('sgA', s.asize)}
            {size('sgP', s.psize)}
            {size('sgB0', s.base0, s.randomHint)}
            {size('sgL0', s.len0, s.randomHint)}
            {size('sgB1', s.base1, s.randomHint)}
            {size('sgL1', s.len1, s.randomHint)}
          </div>
        )}
      </>
    );
  } else if (cfg.mech === 'lin') {
    params = (
      <div className="grid grid-cols-2 gap-x-3">
        {num('lnS', s.seed, 0, 99999)}
        {num('lnN', s.num, 0, 30)}
        {size('lnA', s.asize)}
        {size('lnP', s.psize)}
        {size('lnPg', s.pagesize)}
        {num('lnU', s.used, 0, 100)}
      </div>
    );
  } else {
    params = (
      <>
        <Field label={s.variant}>
          <Segmented
            size="sm"
            value={cfg.mlBook ? 'book' : 'ostep'}
            options={[
              { value: 'ostep', label: s.ostepMl },
              { value: 'book', label: s.bookMl },
            ]}
            onChange={(v) => set({ mlBook: v === 'book' })}
          />
        </Field>
        {!cfg.mlBook && (
          <div className="grid grid-cols-2 gap-x-3">
            {num('mlS', s.seed, 0, 99999)}
            {num('mlN', s.num, 0, 30)}
            {num('mlA', s.allocated, 0, 120)}
          </div>
        )}
      </>
    );
  }

  const vaText = String(cfg[vk]);
  const generated = run.vas.map((v) => hex(v)).join(' ');

  return (
    <Panel
      title={t.setup}
      actions={
        <Button size="sm" variant="ghost" icon={<Icons.reset className="size-3.5" />} onClick={reset}>
          {t.reset}
        </Button>
      }
      bodyClassName="p-4"
      footer={<Explain>{s.explain[cfg.mech]}</Explain>}
    >
      <Field primary label={s.mech}>
        <Segmented size="sm" value={cfg.mech} options={MECHS.map((m) => ({ value: m, label: s.mechs[m] }))} onChange={(mech) => set({ mech })} ariaLabel={s.mech} />
      </Field>
      <Field primary label={s.preset}>
        <Segmented
          size="sm"
          value={preset ?? ('' as PresetId)}
          options={(Object.keys(presets) as PresetId[]).map((id) => ({ value: id, label: s.presets[cfg.mech][id], title: s.presetTitles[cfg.mech][id] }))}
          onChange={(id) => set(presets[id]!)}
          ariaLabel={s.preset}
        />
      </Field>
      {params}
      <Field label={s.vas} hint={s.vasHint} error={bad.length > 0 && s.bad(bad)}>
        <TextField multiline rows={2} value={vaText} placeholder={generated ? s.vasPlaceholder(generated) : ''} onChange={(v) => set({ [vk]: v } as Partial<Setup>)} invalid={bad.length > 0} ariaLabel={s.vas} />
      </Field>
      <Field label={s.paste} hint={s.pasteHint} error={flagsBad.length > 0 && s.badFlags(flagsBad)}>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!flags.trim()) return;
            const r = parseFlags(flags, cfg.mech);
            setFlagsBad(r.bad);
            set(r.patch);
          }}
        >
          <TextField value={flags} onChange={setFlags} placeholder={s.pastePlaceholder} ariaLabel={s.paste} />
          <Button type="submit" disabled={!flags.trim()}>
            {s.apply}
          </Button>
        </form>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button icon={<Icons.dice className="size-3.5" />} onClick={() => set(randomPatch(cfg, Math.floor(Math.random() * 1000)))}>
          {t.random}
        </Button>
        <ShareButton />
      </div>
    </Panel>
  );
}

function RegRow({ label, base, size, onBase, onSize }: { label: string; base: string; size: string; onBase: (v: string) => void; onSize: (v: string) => void }) {
  return (
    <>
      <span className="pr-1 font-mono text-[12px] text-ink-2">{label}</span>
      <TextField value={base} onChange={onBase} invalid={!Number.isFinite(convertSize(base))} ariaLabel={`${label} base`} />
      <TextField value={size} onChange={onSize} invalid={!Number.isFinite(convertSize(size))} ariaLabel={`${label} size`} />
    </>
  );
}

/* ---------- machine ---------- */

function Arrow() {
  return <span className="opacity-50">→</span>;
}

function StepNarration({ run, step, s, digits }: { run: Run; step: Step | undefined; s: Strings; digits: number }) {
  if (run.steps.length === 0) return <Narration>{s.noVas}</Narration>;
  if (!step) return <Narration>{s.start}</Narration>;
  const va = `VA ${hex(step.va, digits)}`;
  const tone = outcomeTone(step);
  let middle: ReactNode = null;
  let result: ReactNode;
  if (run.seg) {
    const seg = run.seg.segments.find((g) => g.selector === step.seg);
    middle = <span>{seg ? s.segName[seg.kind] : s.violationWhy.noSeg}</span>;
  } else if (run.lin) {
    middle = (
      <span>
        {s.vpn} {step.vpn} · {s.offset} {hex(step.offset!)}
      </span>
    );
  } else if (run.ml) {
    middle = (
      <span>
        PD[{step.pdi}] · PT[{step.pti}] · {s.offset} {hex(step.offset!)}
      </span>
    );
  }
  if (step.outcome === 'ok') {
    result = (
      <>
        <span>
          {s.okTo} <b className="font-semibold">{hex(step.pa!)}</b> <span className="opacity-75">({step.pa})</span>
        </span>
        {step.value !== undefined && (
          <>
            <Arrow />
            <span>
              {s.value} {hex(step.value, 2)}
            </span>
          </>
        )}
      </>
    );
  } else if (step.outcome === 'violation') {
    const why = run.bb ? s.violationWhy.bb(String(step.va), String(run.bb.limit)) : step.region ? s.violationWhy.seg(s.segName[run.regions.find((r) => r.id === step.region)!.kind]) : s.violationWhy.noSeg;
    result = (
      <>
        <b className="font-semibold">{s.violation}</b>
        <span className="opacity-80">({why})</span>
      </>
    );
  } else {
    result = <b className="font-semibold">{step.outcome === 'invalid' ? s.invalid(step.vpn!) : step.outcome === 'pdeFault' ? s.pdeFault : s.pteFault}</b>;
  }
  return (
    <Narration key={`${step.i}-${step.va}`} tone={tone}>
      <span>{va}</span>
      {middle && (
        <>
          <Arrow />
          {middle}
        </>
      )}
      <Arrow />
      {result}
    </Narration>
  );
}

function Stats({ run, step, s }: { run: Run; step: Step | undefined; s: Strings }) {
  const paging = run.mech === 'lin' || run.mech === 'ml';
  let table: { value: string; sub: string };
  if (run.bb) table = { value: s.regs(2), sub: s.regsSub };
  else if (run.seg) table = { value: s.regs(2 * run.seg.segments.length), sub: s.regsSub };
  else if (run.lin) table = { value: human(run.tableBytes!), sub: s.ptesSub(run.lin.table.length) };
  else if (run.ml) table = { value: human(run.tableBytes!), sub: s.tableSub(human(run.linearBytes!)) };
  else table = { value: '—', sub: '' };
  return (
    <StatGrid cols={4}>
      <Stat label={s.valid} value={step?.valid ?? 0} tone="ok" />
      <Stat label={paging ? s.faults : s.violations} value={step?.faults ?? 0} tone={paging ? 'warn' : 'bad'} />
      <Stat label={s.reads} value={run.perTranslation} sub={s.readsSub(step?.totalReads ?? 0)} />
      <Stat label={s.tableSize} value={table.value} sub={table.sub} />
    </StatGrid>
  );
}

function OstepPanel({ run, s, title }: { run: Run; s: Strings; title: string }) {
  const [copied, setCopied] = useState(false);
  const notes = run.notes.map((n) => s.notes[n]).filter(Boolean);
  return (
    <Panel title={title}>
      {run.command && (
        <div className="flex items-start gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-sunken px-3 py-2 font-mono text-[12.5px] text-ink">{run.command}</code>
          <Button
            size="sm"
            className="mt-1"
            icon={copied ? <Icons.check className="size-3.5 text-ok" /> : undefined}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(run.command!);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              } catch {
                /* clipboard unavailable: the command is selectable */
              }
            }}
          >
            {copied ? s.copied : s.copy}
          </Button>
        </div>
      )}
      {notes.length > 0 && (
        <ul className={clsx('space-y-1 text-[12.5px] text-ink-2', run.command && 'mt-2.5')}>
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {run.output && (
        <details className="group mt-3 rounded-xl border border-line">
          <summary className="cursor-pointer list-none px-3 py-2.5 text-[12.5px] font-medium text-ink-2 hover:text-accent [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-1.5">
              <Icons.next className="size-3.5 transition-transform group-open:rotate-90" />
              {s.output}
            </span>
          </summary>
          <pre className="max-h-[360px] overflow-auto border-t border-line px-3 py-2 font-mono text-[11.5px] leading-[1.55] text-ink-2">{run.output}</pre>
        </details>
      )}
    </Panel>
  );
}

function Practice({ run, step, s, digits }: { run: Run; step: Step; s: Strings; digits: number }) {
  const ans =
    step.outcome === 'ok' ? s.qPaAns.ok(`${hex(step.pa!)} (${step.pa})${step.value !== undefined ? ` · ${s.value} ${hex(step.value, 2)}` : ''}`) : s.qPaAns[step.outcome];
  const items: { q: string; a: string }[] = [{ q: s.qPa(`${hex(step.va, digits)} (${step.va})`), a: ans }];
  if (run.bb) {
    items.push({ q: s.qBbMin, a: s.aBbMin(Math.max(...run.vas) + 1) });
    items.push({ q: s.qBbRange(hex(run.bb.base), String(run.bb.limit)), a: s.aBbRange(hex(run.bb.base), hex(run.bb.base + run.bb.limit - 1)) });
  } else if (run.seg) {
    const up = run.regions.find((r) => r.grows !== -1 && r.v);
    const down = run.regions.find((r) => r.grows === -1 && r.v);
    if (up && down) items.push({ q: s.qSegEdge, a: s.aSegEdge(`${hex(up.v![1] - 1)} (${up.v![1] - 1})`, `${hex(down.v![0])} (${down.v![0]})`) });
  } else if (run.lin) {
    const n = run.lin.table.length;
    items.push({ q: s.qLinSize(human(run.asize), human(run.lin.pageSize)), a: s.aLinSize(n, human(n * 4), human(n * 2)) });
  } else if (run.ml) {
    items.push({ q: s.qMlSize, a: s.aMlSize(1 + run.ml.ptPages.size, human(run.tableBytes!), human(run.linearBytes!)) });
  }
  return (
    <Panel title={s.practice}>
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((it, i) => (
          <Reveal key={`${i}-${it.q}`} question={it.q}>
            {it.a}
          </Reveal>
        ))}
      </div>
    </Panel>
  );
}
