import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge } from '../../components/kit';
import { hex, type Run, type Step } from '../../sim/address-translation/index';
import { FILL } from './MemoryMap';
import type { Strings } from './strings';

interface Common {
  run: Run;
  step: Step | undefined;
  hover: string | null;
  setHover: (id: string | null) => void;
  s: Strings;
}

const th = 'border-b border-line px-3 py-2.5 text-left font-medium';

/** Base/bounds or segment registers, one row each. */
export function RegistersTable({ run, step, hover, setHover, s, onPick }: Common & { onPick: (id: string) => void }) {
  const rows = run.bb
    ? [{ id: 'proc', kind: 'proc' as const, base: run.bb.base, size: run.bb.limit, grows: 1 as const, color: 1 }]
    : (run.seg?.segments ?? []).map((g) => ({ id: g.id, kind: g.kind, base: g.base, size: g.size, grows: g.grows, color: run.regions.find((r) => r.id === g.id)?.color ?? 1 }));
  return (
    <div className="overflow-x-auto">
      <table className="w-full font-mono text-[12.5px]">
        <thead>
          <tr className="text-[11px] uppercase tracking-[0.06em] text-ink-3">
            <th className={th}>{run.bb ? '' : s.segBits}</th>
            <th className={th}>{s.baseCol}</th>
            <th className={th}>{run.bb ? s.limitCol : s.sizeCol}</th>
            {!run.bb && <th className={th}>{s.growsCol}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const cur = step?.region === r.id;
            return (
              <tr
                key={r.id}
                onMouseEnter={() => setHover(r.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onPick(r.id)}
                className={clsx(
                  'cursor-pointer border-b border-line transition-colors duration-300 last:border-b-0',
                  cur && (step!.outcome === 'ok' ? 'bg-ok-soft' : 'bg-bad-soft'),
                  !cur && hover === r.id && 'bg-chip',
                )}
              >
                <td className="px-3 py-2.5">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={clsx('size-2 rounded-sm', FILL[r.color]?.swatch)} />
                    {s.segName[r.kind]}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  {hex(r.base)} <span className="text-ink-3">({r.base})</span>
                </td>
                <td className="px-3 py-2.5">{r.size}</td>
                {!run.bb && <td className="px-3 py-2.5 text-ink-2">{r.grows === 1 ? s.up : s.down}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PfnInput({ value, max, onChange, label }: { value: number; max: number; onChange: (n: number) => void; label: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      aria-label={label}
      inputMode="numeric"
      value={draft}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (/^\d+$/.test(e.target.value) && n < max) onChange(n);
      }}
      onBlur={() => setDraft(String(value))}
      className="w-14 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-right outline-none transition-colors hover:border-line-strong focus:border-accent focus:bg-sunken"
    />
  );
}

/** Linear page table: one PTE per virtual page, editable. */
export function PageTable({ run, step, hover, setHover, s, onEdit, onPickVpn }: Common & { onEdit: (t: number[]) => void; onPickVpn: (vpn: number) => void }) {
  const lin = run.lin!;
  const box = useRef<HTMLDivElement>(null);
  const curVpn = step?.vpn;
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(`[data-vpn="${curVpn}"]`);
    const c = box.current;
    if (!el || !c) return;
    if (el.offsetTop < c.scrollTop + 32 || el.offsetTop + el.offsetHeight > c.scrollTop + c.clientHeight) c.scrollTo({ top: el.offsetTop - c.clientHeight / 2, behavior: 'smooth' });
  }, [curVpn]);
  const set = (vpn: number, pfn: number) => {
    const t = [...lin.table];
    t[vpn] = pfn;
    onEdit(t);
  };
  const free = () => {
    for (let p = 0; p < lin.pages; p++) if (!lin.table.includes(p)) return p;
    return 0;
  };
  return (
    <div ref={box} className="relative max-h-[420px] overflow-auto">
      <table className="w-full font-mono text-[12.5px]">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="text-[11px] uppercase tracking-[0.06em] text-ink-3">
            <th className={th}>{s.vpn}</th>
            <th className={th}>V</th>
            <th className={clsx(th, 'text-right')}>{s.pfn}</th>
            <th className={th}>{s.pteRaw}</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {lin.table.map((pfn, vpn) => {
            const valid = pfn >= 0;
            const cur = curVpn === vpn;
            const id = `p${vpn}`;
            const changed = pfn !== lin.generated[vpn];
            return (
              <tr
                key={vpn}
                data-vpn={vpn}
                onMouseEnter={() => setHover(valid ? id : null)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onPickVpn(vpn)}
                className={clsx(
                  'cursor-pointer border-b border-line transition-colors duration-300 last:border-b-0',
                  cur && (step!.outcome === 'ok' ? 'bg-ok-soft' : 'bg-bad-soft'),
                  !cur && hover === id && 'bg-chip',
                )}
              >
                <td className="px-3 py-1.5 text-ink-2">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={clsx('size-2 rounded-sm', valid ? FILL[(vpn % 6) + 1].swatch : 'bg-line-strong')} />
                    {vpn}
                  </span>
                </td>
                <td className="px-3 py-1.5">
                  <button
                    type="button"
                    aria-label={`V ${vpn}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      set(vpn, valid ? -1 : free());
                    }}
                    className={clsx('grid size-6 place-items-center rounded-md border transition-colors', valid ? 'border-ok/40 bg-ok-soft text-ok' : 'border-line-strong text-ink-3 hover:text-ink')}
                  >
                    {valid ? 1 : 0}
                  </button>
                </td>
                <td className="px-2 py-1.5 text-right">{valid ? <PfnInput value={pfn} max={lin.pages} onChange={(n) => set(vpn, n)} label={`${s.pfn} ${vpn}`} /> : <span className="pr-1 text-ink-3">—</span>}</td>
                <td className={clsx('px-3 py-1.5', valid ? 'text-ink' : 'text-ink-3')}>
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span key={pfn} className="inline-block" initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 8, opacity: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 32 }}>
                      {hex(valid ? 0x80000000 + pfn : 0, 8)}
                    </motion.span>
                  </AnimatePresence>
                </td>
                <td className="pr-3 text-right">{changed && <Badge tone="warn">{s.edited}</Badge>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- multi-level ---------- */

type DumpTone = 'accent' | 'warn' | 'info';
const DUMP_ON: Record<DumpTone, string> = {
  accent: 'bg-accent text-accent-ink',
  warn: 'bg-warn text-surface',
  info: 'bg-info text-surface',
};

function HexDump({
  memory,
  page,
  pageSize,
  entryBytes,
  hit,
  tone,
  soft,
  entryTitle,
  onHoverEntry,
  isValid,
}: {
  memory: Uint8Array;
  page: number;
  pageSize: number;
  entryBytes: number;
  hit: number | null;
  tone: DumpTone;
  soft: number | null;
  entryTitle: (i: number) => string;
  onHoverEntry?: (i: number | null) => void;
  isValid?: (i: number) => boolean;
}) {
  const bytes = Array.from(memory.subarray(page * pageSize, (page + 1) * pageSize));
  return (
    <div className="grid grid-cols-8 gap-px font-mono text-[11px] sm:grid-cols-16" onMouseLeave={() => onHoverEntry?.(null)}>
      {bytes.map((b, k) => {
        const e = Math.floor(k / entryBytes);
        const on = hit === e;
        const valid = isValid ? isValid(e) : true;
        return (
          <span
            key={k}
            title={`${hex(page * pageSize + k)} · ${entryTitle(e)}`}
            onMouseEnter={() => onHoverEntry?.(e)}
            className={clsx(
              'grid h-6 place-items-center rounded-[4px] transition-colors duration-200',
              on ? DUMP_ON[tone] : soft === e ? 'bg-chip text-ink ring-1 ring-line-strong' : valid ? 'bg-sunken text-ink' : 'bg-sunken text-ink-3',
              entryBytes > 1 && k % entryBytes === 0 && 'ml-0.5',
            )}
          >
            {b.toString(16).padStart(2, '0')}
          </span>
        );
      })}
    </div>
  );
}

function Card({ title, children, sub }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <motion.div layout className="rounded-xl border border-line p-3" transition={{ type: 'spring', stiffness: 400, damping: 34 }}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-2">{title}</span>
        {sub && <span className="font-mono text-[11px] text-ink-3">{sub}</span>}
      </div>
      {children}
    </motion.div>
  );
}

/** PDBR → page directory → page-table page → data page, as hex dumps with the bytes the MMU reads lit up. */
export function MlWalk({ run, step, hover, setHover, s }: Common) {
  const m = run.ml!;
  const pageSize = 2 ** m.pageBits;
  const ptEntries = 2 ** m.ptBits;
  const hv = hover && /^p\d+$/.test(hover) ? Number(hover.slice(1)) : null;
  const hoverPd = hover?.startsWith('pt') ? Number(hover.slice(2)) : hv !== null ? Math.floor(hv / ptEntries) : null;
  const ptPage = step?.pdeValid ? step.ptPage! : null;
  const ptPdi = step?.pdi ?? null;
  const hoverPt = hv !== null && ptPdi !== null && Math.floor(hv / ptEntries) === ptPdi ? hv % ptEntries : null;
  const entry = (page: number, i: number) => {
    let raw = 0;
    for (let k = 0; k < m.pteBytes; k++) raw = raw * 256 + m.memory[page * pageSize + i * m.pteBytes + k];
    return raw;
  };
  const top = 2 ** (8 * m.pteBytes - 1);
  const pdValid = (i: number) => entry(m.pdbr, i) >= top;
  const d = m.pteBytes * 2;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 font-mono text-[12.5px]">
        <span className="rounded-lg bg-accent-soft px-2.5 py-1 text-accent">
          {s.pdbr} = {m.pdbr}
        </span>
        <span className="text-[11.5px] text-ink-3">{s.pdbrSub}</span>
      </div>
      <Card title={s.pdPage(m.pdbr)} sub={step ? `${s.pdIndex} ${step.pdi}` : undefined}>
        <HexDump
          memory={m.memory}
          page={m.pdbr}
          pageSize={pageSize}
          entryBytes={m.pteBytes}
          hit={step ? step.pdi! : null}
          tone="accent"
          soft={hoverPd}
          isValid={pdValid}
          entryTitle={(i) => `PDE ${i} = ${hex(entry(m.pdbr, i), d)}`}
          onHoverEntry={(i) => setHover(i !== null && pdValid(i) ? `pt${i}` : null)}
        />
      </Card>
      <AnimatePresence mode="popLayout" initial={false}>
        {ptPage !== null ? (
          <Card key={`pt${ptPage}`} title={s.ptPage(ptPage)} sub={`${s.ptIndex} ${step!.pti}`}>
            <HexDump
              memory={m.memory}
              page={ptPage}
              pageSize={pageSize}
              entryBytes={m.pteBytes}
              hit={step!.pti!}
              tone="warn"
              soft={hoverPt}
              isValid={(i) => entry(ptPage, i) >= top}
              entryTitle={(i) => `PTE ${i} = ${hex(entry(ptPage, i), d)}`}
              onHoverEntry={(i) => setHover(i !== null && entry(ptPage, i) >= top ? `p${ptPdi! * ptEntries + i}` : null)}
            />
          </Card>
        ) : (
          <motion.div key="nopt" layout className="rounded-xl border border-dashed border-line p-3 font-mono text-[11.5px] text-ink-3">
            {s.ptTitle} · {s.notReached}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence mode="popLayout" initial={false}>
        {step?.outcome === 'ok' ? (
          <Card key={`d${step.pfn}`} title={s.dataPage(step.pfn!)} sub={`${s.offset} ${step.offset} → ${s.value} ${hex(step.value!, 2)}`}>
            <HexDump memory={m.memory} page={step.pfn!} pageSize={pageSize} entryBytes={1} hit={step.offset!} tone="info" soft={null} entryTitle={(i) => `${s.offset} ${i}`} />
          </Card>
        ) : (
          <motion.div key="nodata" layout className="rounded-xl border border-dashed border-line p-3 font-mono text-[11.5px] text-ink-3">
            {s.dataTitle} · {s.notReached}
          </motion.div>
        )}
      </AnimatePresence>
      <FullDump run={run} step={step} s={s} />
    </div>
  );
}

function FullDump({ run, step, s }: { run: Run; step: Step | undefined; s: Strings }) {
  const [open, setOpen] = useState(false);
  const m = run.ml!;
  const pageSize = 2 ** m.pageBits;
  const pages = new Map<number, DumpTone>();
  if (step) {
    pages.set(m.pdbr, 'accent');
    if (step.pdeValid) pages.set(step.ptPage!, 'warn');
    if (step.outcome === 'ok') pages.set(step.pfn!, 'info');
  }
  const hot = new Set([step?.pdeAddr, step?.pteAddr, step?.pa ?? undefined].filter((x): x is number => x !== undefined));
  const hotSpan = (addr: number) => [...hot].some((h) => addr >= h && addr < h + (h === step?.pa ? 1 : m.pteBytes));
  return (
    <details className="rounded-xl border border-line" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer px-3 py-2.5 text-[12.5px] font-medium text-ink-2 hover:text-accent">{s.fullDump}</summary>
      {open && (
        <div className="max-h-[360px] overflow-auto border-t border-line px-3 py-2 font-mono text-[11px] leading-[18px]">
          {Array.from({ length: m.physPages }, (_, p) => {
            const tone = pages.get(p);
            const base = p * pageSize;
            return (
              <div key={p} className={clsx('whitespace-pre', tone ? 'text-ink' : 'text-ink-3')}>
                <span className={clsx(tone && { accent: 'text-accent', warn: 'text-warn', info: 'text-info' }[tone])}>{`page ${String(p).padStart(3)}:`}</span>
                {tone
                  ? Array.from(m.memory.subarray(base, base + pageSize), (b, k) => (
                      <span key={k} className={clsx(hotSpan(base + k) && clsx('rounded-sm', DUMP_ON[tone]))}>
                        {b.toString(16).padStart(2, '0')}
                      </span>
                    ))
                  : Array.from(m.memory.subarray(base, base + pageSize), (b) => b.toString(16).padStart(2, '0')).join('')}
              </div>
            );
          })}
        </div>
      )}
    </details>
  );
}
