import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
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
} from '../../components/kit';
import type { Lang } from '../../lib/i18n';
import { PRESETS, hex, parseTrace, randomProblem, simulateTlb, type PresetId, type TlbPolicy } from '../../sim/tlb';

const S = {
  es: {
    preset: 'Ejemplo',
    presets: { array: 'Arreglo (fig. 19.2)', twice: 'Dos pasadas', loop: 'Bucle > TLB', locality: 'Mixto' } as Record<PresetId, string>,
    pageSize: 'Tamaño de página',
    entries: 'Entradas en la TLB',
    policy: 'Política de reemplazo',
    seed: 'Semilla',
    trace: 'Traza de direcciones virtuales',
    traceHint: 'hex, decimal o binario',
    bad: (t: string[]) => `No entiendo: ${t.join(', ')}`,
    machine: 'TLB',
    pageTable: 'Tabla de páginas',
    walked: 'recorrida',
    slot: 'Slot',
    valid: 'V',
    loaded: 'Cargada',
    used: 'Último uso',
    empty: 'vacía',
    hits: 'Hits',
    misses: 'Misses',
    hitRate: 'Hit rate',
    memAccesses: 'Accesos a memoria',
    memSub: '1 por hit, 2 por miss',
    start: 'La TLB arranca vacía. Dale play o usá → para procesar el primer acceso.',
    hit: 'TLB HIT',
    miss: 'TLB MISS',
    walk: 'recorre la tabla de páginas',
    evict: (v: string) => `expulsa VPN ${v}`,
    fill: (s: number) => `carga en slot ${s}`,
    done: (h: number, n: number) => `Terminó: ${h} hits de ${n} accesos.`,
    va: 'Dirección virtual',
    pa: 'Dirección física',
    vpn: 'VPN',
    offset: 'offset',
    pfn: 'PFN',
    practice: 'Practicá',
    q: (n: number, e: number, p: string) => `Antes de darle play: con ${e} entradas y ${p}, ¿cuántos de los ${n} accesos son misses?`,
    a: (m: number, h: number, r: string) => `${m} misses y ${h} hits (hit rate ${r}).`,
    q2: '¿Qué pasaría con el hit rate si duplicás el tamaño de página?',
    a2: 'Entran el doble de direcciones en cada página, así que direcciones vecinas comparten traducción: con buena localidad espacial, hay menos misses. Probalo cambiando el tamaño de página.',
    nextVictim: 'próxima víctima',
    explain: (
      <>
        <p>
          Cada dirección virtual se parte en <b>VPN</b> (número de página virtual, los bits altos) y <b>offset</b> (los bits bajos, que no cambian al traducir).
        </p>
        <p>
          La <b>TLB</b> es una caché chica, dentro de la MMU, de traducciones VPN → PFN. Si la VPN está: <b>hit</b>, la traducción sale gratis. Si no: <b>miss</b>, hay que leer la tabla de páginas en memoria (acá, un acceso extra) y guardar la traducción en la TLB, expulsando otra si está llena.
        </p>
        <p>
          <b>LRU</b> expulsa la que se usó hace más tiempo; <b>FIFO</b>, la que se cargó primero; <b>Random</b>, cualquiera. El ejemplo «Bucle &gt; TLB» muestra el peor caso de LRU: recorrer una página más de las que entran hace que todo sea miss.
        </p>
      </>
    ),
  },
  en: {
    preset: 'Example',
    presets: { array: 'Array (fig. 19.2)', twice: 'Two passes', loop: 'Loop > TLB', locality: 'Mixed' } as Record<PresetId, string>,
    pageSize: 'Page size',
    entries: 'TLB entries',
    policy: 'Replacement policy',
    seed: 'Seed',
    trace: 'Virtual address trace',
    traceHint: 'hex, decimal or binary',
    bad: (t: string[]) => `Can't parse: ${t.join(', ')}`,
    machine: 'TLB',
    pageTable: 'Page table',
    walked: 'walked',
    slot: 'Slot',
    valid: 'V',
    loaded: 'Loaded',
    used: 'Last used',
    empty: 'empty',
    hits: 'Hits',
    misses: 'Misses',
    hitRate: 'Hit rate',
    memAccesses: 'Memory accesses',
    memSub: '1 per hit, 2 per miss',
    start: 'The TLB starts empty. Press play or use → to process the first access.',
    hit: 'TLB HIT',
    miss: 'TLB MISS',
    walk: 'walks the page table',
    evict: (v: string) => `evicts VPN ${v}`,
    fill: (s: number) => `fills slot ${s}`,
    done: (h: number, n: number) => `Done: ${h} hits out of ${n} accesses.`,
    va: 'Virtual address',
    pa: 'Physical address',
    vpn: 'VPN',
    offset: 'offset',
    pfn: 'PFN',
    practice: 'Practice',
    q: (n: number, e: number, p: string) => `Before pressing play: with ${e} entries and ${p}, how many of the ${n} accesses miss?`,
    a: (m: number, h: number, r: string) => `${m} misses and ${h} hits (hit rate ${r}).`,
    q2: 'What would happen to the hit rate if you doubled the page size?',
    a2: 'Each page holds twice as many addresses, so neighbouring addresses share a translation: with good spatial locality there are fewer misses. Try it by changing the page size.',
    nextVictim: 'next victim',
    explain: (
      <>
        <p>
          Every virtual address splits into the <b>VPN</b> (virtual page number, the high bits) and the <b>offset</b> (the low bits, which translation leaves alone).
        </p>
        <p>
          The <b>TLB</b> is a small cache inside the MMU holding VPN → PFN translations. If the VPN is there: <b>hit</b>, the translation is free. If not: <b>miss</b>, the page table in memory must be read (here, one extra access) and the translation stored in the TLB, evicting another one if it is full.
        </p>
        <p>
          <b>LRU</b> evicts the least recently used; <b>FIFO</b>, the one loaded first; <b>Random</b>, any. The “Loop &gt; TLB” example shows LRU’s worst case: cycling through one page more than fits makes every access miss.
        </p>
      </>
    ),
  },
};

const PAGE_SIZES = [16, 64, 256, 1024, 4096];
const sizeLabel = (n: number) => (n >= 1024 ? `${n / 1024} KB` : `${n} B`);
const traceText = (t: readonly number[]) => t.map((v) => hex(v)).join(' ');

const DEFAULTS = {
  pageSize: PRESETS.array.pageSize as number,
  entries: PRESETS.array.entries as number,
  policy: 'lru' as TlbPolicy,
  seed: 0,
  trace: traceText(PRESETS.array.trace),
};

export default function TlbPlayground({ lang }: { lang: Lang }) {
  return (
    <LangProvider lang={lang}>
      <Tlb />
    </LangProvider>
  );
}

function Tlb() {
  const s = useStrings(S);
  const t = useUi();
  const [cfg, set, reset] = useUrlState(DEFAULTS);
  const { trace, bad } = useMemo(() => parseTrace(cfg.trace), [cfg.trace]);
  const run = useMemo(() => simulateTlb({ ...cfg, trace }), [cfg, trace]);
  const stepper = useStepper(run.steps.length, { startAt: 'first' });
  const [hoverVpn, setHoverVpn] = useState<number | null>(null);

  const cur = stepper.index > 0 ? run.steps[stepper.index - 1] : undefined;
  const tlb = cur?.tlb ?? run.initial;
  const last = run.steps.at(-1);
  const hits = cur?.hits ?? 0;
  const misses = cur?.misses ?? 0;
  const done = stepper.index > 0 ? hits + misses : 0;
  const rate = (h: number, n: number) => (n === 0 ? '—' : `${((h / n) * 100).toFixed(n % 3 === 0 || h === n ? 0 : 1)}%`);
  const activePreset = (Object.keys(PRESETS) as PresetId[]).find(
    (id) => PRESETS[id].pageSize === cfg.pageSize && PRESETS[id].entries === cfg.entries && traceText(PRESETS[id].trace) === cfg.trace,
  );
  const digits = Math.ceil(run.vaBits / 4);

  const setup = (
    <Panel
      title={t.setup}
      actions={
        <Button size="sm" variant="ghost" icon={<Icons.reset className="size-3.5" />} onClick={reset}>
          {t.reset}
        </Button>
      }
      bodyClassName="p-4"
      footer={
        <Explain>{s.explain}</Explain>
      }
    >
      <Field primary label={s.preset}>
        <Segmented
          size="sm"
          value={activePreset ?? ('' as PresetId)}
          options={(Object.keys(PRESETS) as PresetId[]).map((id) => ({ value: id, label: s.presets[id] }))}
          onChange={(id) => set({ pageSize: PRESETS[id].pageSize, entries: PRESETS[id].entries, trace: traceText(PRESETS[id].trace) })}
        />
      </Field>
      <Field label={s.pageSize} hint={`offset = ${run.offsetBits} bits`}>
        <Segmented size="sm" value={cfg.pageSize} options={PAGE_SIZES.map((n) => ({ value: n, label: sizeLabel(n) }))} onChange={(pageSize) => set({ pageSize })} />
      </Field>
      <Field label={s.entries}>
        <NumberField value={cfg.entries} min={1} max={16} onChange={(entries) => set({ entries })} ariaLabel={s.entries} />
      </Field>
      <Field primary label={s.policy}>
        <Segmented
          value={cfg.policy}
          options={[
            { value: 'lru', label: 'LRU' },
            { value: 'fifo', label: 'FIFO' },
            { value: 'random', label: 'Random' },
          ]}
          onChange={(policy) => set({ policy })}
        />
      </Field>
      {cfg.policy === 'random' && (
        <Field label={s.seed}>
          <NumberField value={cfg.seed} min={0} max={9999} onChange={(seed) => set({ seed })} ariaLabel={s.seed} />
        </Field>
      )}
      <Field label={s.trace} hint={s.traceHint} error={bad.length > 0 && s.bad(bad)}>
        <TextField multiline rows={3} value={cfg.trace} onChange={(v) => set({ trace: v })} invalid={bad.length > 0} ariaLabel={s.trace} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          icon={<Icons.dice className="size-3.5" />}
          onClick={() => {
            const p = randomProblem(Math.floor(Math.random() * 1e9));
            set({ pageSize: p.pageSize, entries: p.entries, policy: p.policy, trace: traceText(p.trace) });
          }}
        >
          {t.random}
        </Button>
        <ShareButton />
      </div>
    </Panel>
  );

  return (
    <Bench setup={setup} watch={2}>
      <Panel title={t.stepOf(stepper.index, stepper.total)} actions={<Badge tone="accent">{cfg.policy.toUpperCase()} · {cfg.entries}</Badge>}>
        <StepControls stepper={stepper} />

        {/* trace */}
        <div className="mt-5 flex flex-wrap gap-1.5">
          {trace.map((va, i) => {
            const st = run.steps[i];
            const seen = i < stepper.index;
            const now = i === stepper.index - 1;
            return (
              <button
                key={i}
                type="button"
                onClick={() => stepper.setIndex(i + 1)}
                onMouseEnter={() => setHoverVpn(st.vpn)}
                onMouseLeave={() => setHoverVpn(null)}
                className={clsx(
                  'rounded-md px-2 py-1 font-mono text-[12.5px] transition-all duration-200',
                  seen ? (st.hit ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad') : 'bg-sunken text-ink-3 hover:text-ink',
                  now && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
                  hoverVpn === st.vpn && !now && 'ring-1 ring-ink-3',
                )}
                title={`VPN ${st.vpn}`}
              >
                {hex(va)}
              </button>
            );
          })}
        </div>

        {/* narration */}
        <div className="mt-4">
          {cur ? (
            <Narration key={stepper.index} tone={cur.hit ? 'ok' : 'bad'}>
              <span>VA {hex(cur.va, digits)}</span>
              <Arrow />
              <span>
                {s.vpn} {hex(cur.vpn)} · {s.offset} {hex(cur.offset)}
              </span>
              <Arrow />
              <b className="font-semibold">{cur.hit ? s.hit : s.miss}</b>
              {!cur.hit && (
                <>
                  <span className="opacity-80">({s.walk}{cur.evicted !== undefined ? `, ${s.evict(hex(cur.evicted))}` : ''}, {s.fill(cur.slot)})</span>
                </>
              )}
              <Arrow />
              <span>
                PA <b className="font-semibold">{hex(cur.pa)}</b>
              </span>
            </Narration>
          ) : (
            <Narration>{s.start}</Narration>
          )}
        </div>

        {/* address split */}
        {cur && <AddressSplit key={`a${stepper.index}`} va={cur.va} pa={cur.pa} vaBits={run.vaBits} offsetBits={run.offsetBits} labels={s} />}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_240px]">
        <Panel title={s.machine} bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-ink-3">
                  {[s.slot, s.valid, s.vpn, s.pfn, s.loaded, s.used].map((h) => (
                    <th key={h} className="border-b border-line px-4 py-2.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tlb.map((e, i) => {
                  const touched = cur?.slot === i;
                  const lru = cfg.policy === 'lru' && e.valid && tlb.every((o) => !o.valid || o.lastUsed >= e.lastUsed) && tlb.every((o) => o.valid);
                  const fifo = cfg.policy === 'fifo' && e.valid && tlb.every((o) => !o.valid || o.loadedAt >= e.loadedAt) && tlb.every((o) => o.valid);
                  return (
                    <tr
                      key={i}
                      onMouseEnter={() => e.valid && setHoverVpn(e.vpn)}
                      onMouseLeave={() => setHoverVpn(null)}
                      className={clsx(
                        'border-b border-line transition-colors duration-300 last:border-b-0',
                        touched && (cur!.hit ? 'bg-ok-soft' : 'bg-bad-soft'),
                        !touched && hoverVpn !== null && e.valid && e.vpn === hoverVpn && 'bg-chip',
                      )}
                    >
                      <td className="px-4 py-2.5 text-ink-3">{i}</td>
                      <td className={clsx('px-4 py-2.5', e.valid ? 'text-ink' : 'text-ink-3')}>{e.valid ? 1 : 0}</td>
                      <td className="px-4 py-2.5">
                        <AnimatePresence mode="popLayout" initial={false}>
                          <motion.span
                            key={e.valid ? e.vpn : 'x'}
                            initial={{ y: -10, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 10, opacity: 0 }}
                            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                            className={clsx('inline-block', !e.valid && 'text-ink-3')}
                          >
                            {e.valid ? hex(e.vpn) : '—'}
                          </motion.span>
                        </AnimatePresence>
                      </td>
                      <td className={clsx('px-4 py-2.5', !e.valid && 'text-ink-3')}>{e.valid ? hex(e.pfn) : '—'}</td>
                      <td className="px-4 py-2.5 text-ink-2">{e.valid ? `#${e.loadedAt}` : ''}</td>
                      <td className="px-4 py-2.5 text-ink-2">
                        {e.valid ? `#${e.lastUsed}` : <span className="text-ink-3">{s.empty}</span>}
                        {(lru || fifo) && (
                          <Badge tone="warn" className="ml-2">
                            {s.nextVictim}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <StatGrid cols={4}>
            <Stat label={s.hits} value={hits} tone="ok" />
            <Stat label={s.misses} value={misses} tone="bad" />
            <Stat label={s.hitRate} value={rate(hits, done)} />
            <Stat label={s.memAccesses} value={hits + 2 * misses} sub={s.memSub} />
          </StatGrid>
        </Panel>

        <Panel title={s.pageTable} bodyClassName="p-0">
          <table className="w-full font-mono text-[12.5px]">
            <tbody>
              {run.pageTable.map((row) => {
                const walked = cur && !cur.hit && cur.vpn === row.vpn;
                return (
                  <tr key={row.vpn} className={clsx('border-b border-line transition-colors duration-300 last:border-b-0', walked && 'bg-info-soft', hoverVpn === row.vpn && !walked && 'bg-chip')}>
                    <td className="px-4 py-2 text-ink-2">{hex(row.vpn)}</td>
                    <td className="px-1 text-ink-3">→</td>
                    <td className="px-4 py-2">{hex(row.pfn)}</td>
                    <td className="pr-3 text-right">{walked && <Badge tone="info">{s.walked}</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </div>

      {last && (
        <Panel title={s.practice}>
          <div className="grid gap-3 md:grid-cols-2">
            <Reveal question={s.q(trace.length, cfg.entries, cfg.policy.toUpperCase())}>{s.a(last.misses, last.hits, rate(last.hits, trace.length))}</Reveal>
            <Reveal question={s.q2}>{s.a2}</Reveal>
          </div>
        </Panel>
      )}
    </Bench>
  );
}

function Arrow() {
  return <span className="opacity-50">→</span>;
}

/** The address as bits, VPN/PFN in color and the offset carried over unchanged. */
function AddressSplit({ va, pa, vaBits, offsetBits, labels }: { va: number; pa: number; vaBits: number; offsetBits: number; labels: (typeof S)['es'] }) {
  const paBits = Math.max(vaBits, pa.toString(2).length);
  const row = (n: number, bits: number, kind: 'v' | 'p') => {
    const str = n.toString(2).padStart(bits, '0');
    const hi = str.slice(0, bits - offsetBits);
    const lo = str.slice(bits - offsetBits);
    return (
      <div className="flex items-center gap-3">
        <span className="w-36 shrink-0 whitespace-nowrap text-[11px] uppercase tracking-[0.06em] text-ink-3">{kind === 'v' ? labels.va : labels.pa}</span>
        <div className="flex min-w-0 flex-wrap gap-px">
          {[...hi].map((b, i) => (
            <motion.span
              key={`h${i}`}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.012 + (kind === 'p' ? 0.15 : 0) }}
              className={clsx('grid h-7 w-[18px] place-items-center rounded-[4px] text-[12px]', kind === 'v' ? 'bg-accent-soft text-accent' : 'bg-info-soft text-info')}
            >
              {b}
            </motion.span>
          ))}
          <span className="w-1.5" />
          {[...lo].map((b, i) => (
            <span key={`l${i}`} className="grid h-7 w-[18px] place-items-center rounded-[4px] bg-sunken text-[12px] text-ink-2">
              {b}
            </span>
          ))}
        </div>
      </div>
    );
  };
  return (
    <div className="mt-4 space-y-1.5 overflow-x-auto rounded-xl border border-line p-3 font-mono">
      {row(va, vaBits, 'v')}
      {row(pa, paBits, 'p')}
      <div className="flex gap-4 pl-[156px] pt-1 text-[11px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-accent-soft ring-1 ring-accent/40" /> {labels.vpn}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-info-soft ring-1 ring-info/40" /> {labels.pfn}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-sunken ring-1 ring-line-strong" /> {labels.offset}
        </span>
      </div>
    </div>
  );
}
