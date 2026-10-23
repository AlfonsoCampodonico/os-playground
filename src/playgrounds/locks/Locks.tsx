import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  ShareButton,
  Stat,
  StatGrid,
  StepControls,
  TextField,
  Toggle,
  useLang,
  useStepper,
  useStrings,
  useUi,
  useUrlState,
  type Tone,
} from '../../components/kit';
import type { Lang } from '../../lib/i18n';
import { PyRandom } from '../../lib/pyrandom';
import {
  configFromFlags,
  findViolation,
  formatCommand,
  formatTrace,
  labelFor,
  PRESETS,
  programByFile,
  programFile,
  programSource,
  REG,
  REG_NAMES,
  simulateLocks,
  toggleSwitch,
  X86_DEFAULTS,
  type LocksRun,
  type LocksStep,
  type PresetGroup,
  type Snapshot,
  type X86Config,
} from '../../sim/locks';
import { T_BG, T_TEXT, tc, usedRegisters, type Hover } from './common';
import { MemoryView } from './MemoryView';
import { S, type LocksStrings } from './strings';
import { ThreadView } from './ThreadView';
import { Timeline } from './Timeline';

const DEFAULTS = {
  prog: 'counter',
  code: '',
  t: 2,
  i: 2,
  r: false,
  s: 0,
  P: '',
  a: '',
  M: 'counter',
  R: 'ax',
  C: false,
  L: 1000,
  m: 128,
};
type UrlState = typeof DEFAULTS;

const toCfg = (u: UrlState): X86Config => ({
  threads: u.t,
  intfreq: u.i,
  intrand: u.r,
  seed: u.s,
  procsched: u.P,
  argv: u.a,
  memtrace: u.M,
  regtrace: u.R,
  cctrace: u.C,
  loadAddr: u.L,
  memsize: u.m,
});
const fromCfg = (c: X86Config) => ({ t: c.threads, i: c.intfreq, r: c.intrand, s: c.seed, P: c.procsched, a: c.argv, M: c.memtrace, R: c.regtrace, C: c.cctrace, L: c.loadAddr, m: c.memsize });

const presetCfg = (flags: Partial<X86Config>) => ({ ...X86_DEFAULTS, ...flags });

/** Programs a "random problem" may pick, with whether they loop on %bx. */
const RANDOM_POOL = ['counter', 'counter-tas', 'looping-race', 'flag', 'test-and-set', 'peterson', 'ticket', 'yield', 'test-and-test-and-set'];

export default function LocksPlayground({ lang }: { lang: Lang }) {
  return (
    <LangProvider lang={lang}>
      <Locks />
    </LangProvider>
  );
}

function Locks() {
  const s = useStrings(S);
  const t = useUi();
  const lang = useLang();
  const [u, set, reset] = useUrlState(DEFAULTS);
  const cfg = useMemo(() => toCfg(u), [u]);
  const bundled = programSource(u.prog, lang) ?? '';
  const source = u.code !== '' ? u.code : bundled;
  const file = programFile(u.prog);
  const flavor = u.prog.startsWith('intro/') ? 'intro' : 'locks';

  const run = useMemo(() => simulateLocks(source, cfg), [source, cfg]);
  const stepper = useStepper(run.steps.length);
  const [hover, setHover] = useState<Hover>({});
  const [gapMsg, setGapMsg] = useState('');
  const msgTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(msgTimer.current), []);

  const idx = stepper.index;
  const cur: LocksStep | undefined = idx > 0 ? run.steps[idx - 1] : undefined;
  const snap: Snapshot = cur ?? run.initial;
  const prev: Snapshot = idx > 1 ? run.steps[idx - 2] : run.initial;
  const last = run.steps.at(-1);
  const regs = useMemo(() => usedRegisters(run.asm, run.raw?.prep.regtrace ?? []), [run]);
  const showCC = cfg.cctrace || run.asm.program.some((i) => i.op.k.startsWith('test'));

  const activePreset = PRESETS.find((p) => p.prog === u.prog && u.code === '' && JSON.stringify(fromCfg(presetCfg(p.flags))) === JSON.stringify(fromCfg(cfg)));
  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)!;
    set({ prog: p.prog, code: '', ...fromCfg(presetCfg(p.flags)) });
    stepper.setIndex(0);
  };

  const flash = (msg: string) => {
    setGapMsg(msg);
    window.clearTimeout(msgTimer.current);
    msgTimer.current = window.setTimeout(() => setGapMsg(''), 2600);
  };
  const onGap = (gap: number) => {
    if (!run.raw) return;
    const r = toggleSwitch(run.asm, cfg, run.raw, gap);
    if (r.ok) set({ P: r.procsched });
    else if (s.forced[r.reason]) flash(s.forced[r.reason]);
  };

  const traceText = useMemo(() => (run.raw ? formatTrace(run.asm, run.raw, cfg, { flavor }) : ''), [run, cfg, flavor]);

  /* ---------- practice ---------- */
  const practice = useMemo(() => {
    if (!run.ok) return null;
    const i1 = simulateLocks(source, { ...cfg, intfreq: 1, procsched: '', intrand: false });
    const violation = run.cs.length > 0 && cfg.threads >= 2 ? findViolation(run.asm, { ...cfg, procsched: '' }, run.cs) : null;
    return { i1, violation };
  }, [run, source, cfg]);

  /* ---------- setup ---------- */
  const errs = [...run.errors.map((e) => `${s.line(e.line)}: ${s.asm[e.code](e.detail)}`)];
  const cfgErr = (flag: string) =>
    run.configErrors
      .filter((e) => e.flag === flag)
      .map((e) => s.cfgErr[e.code](e.detail))
      .join(' · ') || undefined;

  const groups: PresetGroup[] = ['counter', 'ch26', 'ch28'];
  const setup = (
    <Panel
      title={t.setup}
      actions={
        <Button
          size="sm"
          variant="ghost"
          icon={<Icons.reset className="size-3.5" />}
          onClick={() => {
            reset();
            stepper.setIndex(0);
          }}
        >
          {t.reset}
        </Button>
      }
      footer={<Explain>{s.explain}</Explain>}
    >
      <Field label={s.presets}>
        <div className="space-y-2">
          {groups.map((g) => (
            <div key={g}>
              <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">{s.groups[g]}</div>
              <div className="flex flex-wrap gap-1">
                {PRESETS.filter((p) => p.group === g).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(p.id)}
                    className={clsx(
                      'rounded-lg px-2 py-1 font-mono text-[11.5px] transition-all duration-150',
                      activePreset?.id === p.id ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)] ring-1 ring-accent' : 'bg-sunken text-ink-2 hover:text-ink',
                    )}
                  >
                    {s.presetNames[p.id]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Field>

      <Field
        label={
          <span className="flex items-center gap-2">
            {s.program} <span className="font-mono text-ink">{file}</span>
            {u.code !== '' && <Badge tone="warn">{s.edited}</Badge>}
          </span>
        }
        hint={
          u.code !== '' && bundled ? (
            <button type="button" className="text-accent hover:underline" onClick={() => set({ code: '' })}>
              {s.restore}
            </button>
          ) : undefined
        }
        error={errs.length > 0 && <span className="block space-y-0.5">{errs.slice(0, 4).map((e) => <span key={e} className="block">{e}</span>)}</span>}
      >
        <TextField multiline rows={10} value={source} invalid={errs.length > 0} ariaLabel={s.program} onChange={(v) => set({ code: v === bundled ? '' : v })} />
      </Field>

      <div className="grid grid-cols-2 gap-x-3">
        <Field label={s.threads} error={cfgErr('-t')}>
          <NumberField value={u.t} min={1} max={6} onChange={(v) => set({ t: v, P: '' })} ariaLabel={s.threads} />
        </Field>
        <div className={clsx(u.P !== '' && 'pointer-events-none opacity-45')}>
          <Field label={s.intfreq} error={cfgErr('-i')}>
            <NumberField value={u.i} min={1} max={1000} onChange={(v) => set({ i: v })} ariaLabel={s.intfreq} />
          </Field>
        </div>
      </div>
      <div className={clsx('mb-4 space-y-3', u.P !== '' && 'pointer-events-none opacity-45')}>
        <Toggle checked={u.r} onChange={(r) => set({ r })} label={s.intrand} />
        {u.r && (
          <Field label={s.seed}>
            <NumberField value={u.s} min={0} max={99999} onChange={(v) => set({ s: v })} ariaLabel={s.seed} />
          </Field>
        )}
      </div>
      <Field
        label={s.sched}
        hint={
          u.P !== '' ? (
            <button type="button" className="text-accent hover:underline" onClick={() => set({ P: '' })}>
              {s.schedClear}
            </button>
          ) : (
            s.schedHint
          )
        }
        error={cfgErr('-P')}
      >
        <TextField multiline={u.P.length > 30} rows={2} value={u.P} placeholder="0011" invalid={!!cfgErr('-P')} ariaLabel={s.sched} onChange={(v) => set({ P: v.replace(/\s+/g, '') })} />
        {u.P !== '' && <p className="mt-1.5 font-mono text-[11px] text-ink-3">{runLengths(u.P)} · {s.schedOverrides}</p>}
      </Field>
      <Field label={s.argv} hint={s.argvHint} error={cfgErr('-a')}>
        <TextField value={u.a} placeholder="bx=2,bx=2" invalid={!!cfgErr('-a')} ariaLabel={s.argv} onChange={(v) => set({ a: v.trim() })} />
      </Field>
      <div className="grid grid-cols-2 gap-x-3">
        <Field label={s.memtrace} error={cfgErr('-M')}>
          <TextField value={u.M} placeholder="count" invalid={!!cfgErr('-M')} ariaLabel={s.memtrace} onChange={(v) => set({ M: v.trim() })} />
        </Field>
        <Field label={s.regtrace} error={cfgErr('-R')}>
          <TextField value={u.R} placeholder="ax,bx" invalid={!!cfgErr('-R')} ariaLabel={s.regtrace} onChange={(v) => set({ R: v.trim() })} />
        </Field>
      </div>
      <div className="mb-4">
        <Toggle checked={u.C} onChange={(C) => set({ C })} label={s.cctrace} />
      </div>
      <PasteFlags
        s={s}
        onApply={(cmd) => {
          const p = configFromFlags(cmd);
          let prog = u.prog;
          if (p.prog) {
            const found = programByFile(p.prog, u.prog);
            if (!found) return { error: s.pasteProg(p.prog) };
            prog = found;
          }
          if (p.bad.length) return { error: s.pasteBad(p.bad) };
          set({ prog, code: p.prog ? '' : u.code, ...fromCfg(p.cfg) });
          stepper.setIndex(0);
          return {};
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          icon={<Icons.dice className="size-3.5" />}
          onClick={() => {
            const r = new PyRandom(Math.floor(Math.random() * 1e9));
            const p = PRESETS.find((x) => x.id === r.choice(RANDOM_POOL))!;
            const c = presetCfg(p.flags);
            const loops = /bx=/.test(c.argv);
            const bx = r.randint(1, 3);
            const argv = !loops ? c.argv : p.id === 'peterson' ? c.argv : r.random() < 0.5 ? `bx=${bx}` : `bx=${bx},bx=${r.randint(1, 3)}`;
            const intrand = r.random() < 0.4;
            set({ prog: p.prog, code: '', ...fromCfg({ ...c, argv, intfreq: r.randint(1, 7), intrand, seed: intrand ? r.randint(0, 99) : 0, procsched: '' }) });
            stepper.setIndex(0);
          }}
        >
          {t.random}
        </Button>
        <ShareButton />
      </div>
    </Panel>
  );

  /* ---------- machine ---------- */
  const modeBadge = u.P !== '' ? `-P ${u.P.length > 10 ? u.P.slice(0, 10) + '…' : u.P}` : u.r ? `-r -i ${u.i} -s ${u.s}` : `-i ${u.i}`;
  const totalSpins = snap.spins.reduce((a, b) => a + b, 0);
  const firstOverlap = run.steps.find((x) => x.overlap);
  const command = formatCommand(file, cfg);

  const jumpToLine = (tid: number, lineIdx: number) => {
    const after = run.steps.findIndex((x, k) => k >= idx && x.tid === tid && x.idx === lineIdx);
    const any = after === -1 ? run.steps.findIndex((x) => x.tid === tid && x.idx === lineIdx) : after;
    if (any !== -1) stepper.setIndex(any + 1);
  };
  const jumpToWrite = (addr: number) => {
    const after = run.steps.findIndex((x, k) => k >= idx && x.res.writes.some((w) => w.addr === addr));
    const any = after === -1 ? run.steps.findIndex((x) => x.res.writes.some((w) => w.addr === addr)) : after;
    if (any !== -1) stepper.setIndex(any + 1);
  };

  return (
    <Bench setup={setup}>
      <Panel title={t.stepOf(idx, stepper.total)} actions={<Badge tone="accent">{modeBadge}</Badge>}>
        <StepControls stepper={stepper} />
        {!run.ok ? (
          <div className="mt-4">
            <Narration tone="bad">{s.noRun}</Narration>
          </div>
        ) : (
          <>
            <div className="mt-5">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-[11px] font-medium uppercase tracking-[0.07em] text-ink-3">{s.timeline}</span>
                <span className="text-[11.5px] text-ink-3">{s.timelineHint}</span>
              </div>
              <Timeline run={run} index={idx} onSelect={stepper.setIndex} onGap={onGap} hover={hover} setHover={setHover} s={s} />
              <div className="min-h-5 text-[12px]">
                {gapMsg ? (
                  <span className="text-warn animate-rise">{gapMsg}</span>
                ) : hover.step !== undefined ? (
                  <HoverLine run={run} n={hover.step} />
                ) : null}
              </div>
            </div>
            <div className="mt-2">
              {cur ? <StepNarration key={idx} run={run} step={cur} prev={prev} s={s} /> : <Narration>{s.start(run.initial.running ?? 0)}</Narration>}
            </div>
            {(run.truncated || run.fault) && idx === stepper.total && (
              <p className="mt-2 text-[12.5px] text-warn animate-rise">
                {run.fault ? `${s.faultAt(run.fault.tid, run.fault.pc)}: ${s.fault[run.fault.code](run.fault.addr)}` : s.truncated(run.steps.length)}
              </p>
            )}
          </>
        )}
        <div className="-mx-4 -mb-4 mt-4 border-t border-line">
          <StatGrid cols={4}>
            <Stat label={s.stats.instr} value={cur?.n ?? 0} sub={`/ ${run.steps.length}`} />
            <Stat label={s.stats.switches} value={snap.switches} tone="info" />
            <Stat
              label={s.stats.final}
              value={snap.counter ? `${snap.counter.value}/${snap.counter.expected}` : '—'}
              tone={snap.counter ? (snap.counter.value < snap.counter.expected ? 'bad' : 'ok') : 'neutral'}
            />
            <Stat label={s.stats.spins} value={totalSpins} tone={totalSpins > 0 ? 'warn' : 'neutral'} sub={snap.spins.length > 1 ? s.spinsSub(snap.spins) : undefined} />
          </StatGrid>
        </div>
      </Panel>

      {run.ok && (
        <Panel title={`Threads · ${snap.threads.length}`}>
          <ThreadView run={run} snap={snap} prev={prev} step={cur} stepKey={idx} regs={regs} showCC={showCC} hover={hover} setHover={setHover} onLine={jumpToLine} s={s} />
        </Panel>
      )}

      {run.ok && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Panel title={s.memory}>
            <MemoryView run={run} snap={snap} step={cur} stepKey={idx} hover={hover} setHover={setHover} onCell={jumpToWrite} s={s} />
          </Panel>
          <Panel title={s.result}>
            {snap.counter && last?.counter ? (
              <div className="space-y-3">
                <div className="flex items-baseline gap-3">
                  <span key={snap.counter.value} className={clsx('font-serif text-[44px] leading-none tabular-nums animate-pop', idx === stepper.total ? (last.counter.value < last.counter.expected ? 'text-bad' : 'text-ok') : 'text-ink')}>
                    {snap.counter.value}
                  </span>
                  <span className="font-mono text-[13px] text-ink-3">
                    {run.counterLabel} · {s.expected} {snap.counter.expected}
                  </span>
                </div>
                {idx === stepper.total && !run.truncated && !run.fault ? (
                  <Narration tone={last.counter.value < last.counter.expected ? 'bad' : 'ok'}>{s.expectedLine(last.counter.expected, last.counter.value)}</Narration>
                ) : (
                  <p className="text-[13px] text-ink-2">{s.soFar(snap.counter.expected, snap.counter.value)}</p>
                )}
                <p className={clsx('flex flex-wrap items-center gap-2 text-[13px]', firstOverlap ? 'text-bad' : 'text-ok')}>
                  {firstOverlap ? s.overlapAt(firstOverlap.n) : s.noOverlap}
                  {firstOverlap && (
                    <Button size="sm" variant="ghost" onClick={() => stepper.setIndex(firstOverlap.n)}>
                      {s.goTo} →
                    </Button>
                  )}
                </p>
              </div>
            ) : (
              <p className="text-[13px] text-ink-2">{s.noCounter}</p>
            )}
          </Panel>
        </div>
      )}

      <Panel title={t.sameAsOstep}>
        <OstepLine command={command} s={s} />
        {!u.prog.includes('/') || u.code !== '' ? <p className="mt-2 text-[12px] text-ink-3">{s.ostepNote(u.code !== '' ? 'prog.s' : file)}</p> : null}
        {run.ok && run.raw && (
          <details className="group mt-3">
            <summary className="cursor-pointer list-none text-[12.5px] font-medium text-accent hover:underline [&::-webkit-details-marker]:hidden">{s.output}</summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-sunken p-3 font-mono text-[11px] leading-[1.45] text-ink-2">{traceText}</pre>
          </details>
        )}
      </Panel>

      {run.ok && practice && last && (
        <Panel title={s.practice}>
          <div className="grid gap-3 md:grid-cols-2">
            {practice.i1.steps.at(-1)?.counter ? (
              <Reveal question={s.q1(run.counterLabel ?? '')}>
                {s.a1(practice.i1.steps.at(-1)!.counter!.value, practice.i1.steps.at(-1)!.counter!.expected)}{' '}
                <TryIt label={s.tryIt} onClick={() => set({ i: 1, P: '', r: false })} />
              </Reveal>
            ) : (
              <Reveal question={s.q1b}>
                {s.a1b(practice.i1.steps.length)} <TryIt label={s.tryIt} onClick={() => set({ i: 1, P: '', r: false })} />
              </Reveal>
            )}
            {run.cs.length > 0 && cfg.threads >= 2 && (
              <Reveal question={s.q2(file)}>
                {practice.violation ? (
                  <>
                    {s.a2(practice.violation.segments)}{' '}
                    <TryIt
                      label={`${s.tryIt}: -P ${practice.violation.procsched.length > 16 ? practice.violation.procsched.slice(0, 16) + '…' : practice.violation.procsched}`}
                      onClick={() => {
                        set({ P: practice.violation!.procsched });
                        stepper.setIndex(practice.violation!.at);
                      }}
                    />
                  </>
                ) : (
                  s.a2none(3)
                )}
              </Reveal>
            )}
            {last.counter ? (
              <Reveal question={s.q3(run.counterLabel ?? '')}>{s.a3(last.counter.value, last.counter.expected, run.steps.length)}</Reveal>
            ) : (
              <Reveal question={s.q3b}>{s.a1b(run.steps.length)}</Reveal>
            )}
          </div>
        </Panel>
      )}
    </Bench>
  );
}

function runLengths(p: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < p.length && out.length < 8) {
    let j = i;
    while (j < p.length && p[j] === p[i]) j++;
    out.push(`T${p[i]}×${j - i}`);
    i = j;
  }
  return out.join(' ') + (i < p.length ? ' …' : '');
}

function TryIt({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mt-1 inline-flex items-center gap-1 font-mono text-[12px] font-medium text-accent hover:underline">
      {label} <Icons.arrow className="size-3.5" />
    </button>
  );
}

function HoverLine({ run, n }: { run: LocksRun; n: number }) {
  const st = run.steps[n - 1];
  if (!st) return null;
  return (
    <span className="font-mono text-ink-2">
      #{st.n} · <span className={tc(T_TEXT, st.tid)}>T{st.tid}</span> · {st.pc} {run.asm.program[st.idx].text}
    </span>
  );
}

function OstepLine({ command, s }: { command: string; s: LocksStrings }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-sunken py-1.5 pl-3 pr-1.5">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12.5px] text-ink">{command}</code>
      <Button
        size="sm"
        variant="ghost"
        icon={copied ? <Icons.check className="size-3.5 text-ok" /> : undefined}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            window.prompt(s.copy, command);
          }
        }}
      >
        {copied ? s.copied : s.copy}
      </Button>
    </div>
  );
}

function PasteFlags({ s, onApply }: { s: LocksStrings; onApply: (cmd: string) => { error?: string } }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | undefined>();
  const apply = () => {
    if (!draft.trim()) return;
    const r = onApply(draft);
    setError(r.error);
    if (!r.error) setDraft('');
  };
  return (
    <Field label={s.paste} error={error}>
      <div className="flex gap-2" onKeyDown={(e) => e.key === 'Enter' && apply()}>
        <div className="min-w-0 flex-1">
          <TextField
            value={draft}
            placeholder={s.pastePh}
            invalid={!!error}
            ariaLabel={s.paste}
            onChange={(v) => {
              setDraft(v);
              setError(undefined);
            }}
          />
        </div>
        <Button onClick={apply}>{s.apply}</Button>
      </div>
    </Field>
  );
}

/* ---------- narration ---------- */

function StepNarration({ run, step, prev, s }: { run: LocksRun; step: LocksStep; prev: Snapshot; s: LocksStrings }) {
  const { asm } = run;
  const parts: ReactNode[] = [];
  const before = prev.threads[step.tid]?.regs ?? [];
  const after = step.threads[step.tid].regs;
  const memBefore = (addr: number) => {
    const i = run.cells.findIndex((c) => c.addr === addr);
    return i === -1 ? undefined : prev.mem[i];
  };
  const op = asm.program[step.idx].op;
  if (op.k === 'xchg') parts.push(<span key="x">{s.xchg}:</span>);
  for (const a of step.res.reads) {
    const v = memBefore(a);
    if (v !== undefined && op.k !== 'xchg' && op.k !== 'fetchadd') parts.push(<span key={`r${a}`}>{s.reads(labelFor(asm, a), v)}</span>);
  }
  after.forEach((v, r) => {
    if (r !== 0 && before[r] !== v && r !== REG.sp) parts.push(<span key={`g${r}`}>%{REG_NAMES[r]}: {before[r]} → <b className="font-semibold">{v}</b></span>);
  });
  for (const w of step.res.writes) if (memBefore(w.addr) !== undefined) parts.push(<span key={`w${w.addr}`}><b className="font-semibold">{s.writes(labelFor(asm, w.addr), w.value)}</b></span>);
  if (step.res.test) parts.push(<span key="t">{s.test(step.res.test.src, step.res.test.dst)}</span>);
  if (step.res.jump) parts.push(<span key="j">{step.res.jump.taken ? s.jumpTaken(step.res.jump.label) : s.jumpNot}</span>);
  if (step.res.rc === -1) parts.push(<span key="h">{s.halt}</span>);

  const evs: ReactNode[] = step.events.map((e, i) => (
    <span key={`e${i}`} className="opacity-90">
      ⚡ {e.kind === 'halt' ? s.haltSwitch(e.to) : e.kind === 'yield' ? s.yielded(e.from, e.to) : e.from === e.to ? s.interruptSame(e.from) : s.interrupt(e.from, e.to)}
    </span>
  ));
  const switched = step.events.some((e) => e.from !== e.to);
  const tone: Tone = step.lost || step.overlap ? 'bad' : step.spin ? 'warn' : switched ? 'info' : step.res.rc === -1 ? 'ok' : 'neutral';
  const flag = step.lost ? s.lost : step.overlap ? s.overlap : step.spin ? s.spin : undefined;

  return (
    <Narration tone={tone}>
      <span className={clsx('inline-flex items-center gap-1.5 font-semibold', tc(T_TEXT, step.tid))}>
        <span className={clsx('size-2 rounded-full', tc(T_BG, step.tid))} />T{step.tid}
      </span>
      <span>
        {step.pc} <b className="font-semibold">{asm.program[step.idx].text}</b>
      </span>
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-2">
          <span className="opacity-50">→</span>
          {p}
        </span>
      ))}
      {flag && <b className="font-semibold">· {flag}</b>}
      {evs.length > 0 && <span className="basis-full" />}
      {evs}
    </Narration>
  );
}
