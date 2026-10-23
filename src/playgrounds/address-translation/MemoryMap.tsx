import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import type { Region, Run, Step } from '../../sim/address-translation/index';
import { hex } from '../../sim/address-translation/index';
import type { Strings } from './strings';

const H = 360;
const spring = { type: 'spring', stiffness: 420, damping: 36 } as const;

/** Region fill per categorical color (static strings so Tailwind sees them). */
export const FILL: Record<number, { idle: string; on: string; text: string; swatch: string }> = {
  1: { idle: 'bg-c1/20 border-c1/50', on: 'bg-c1/45 border-c1', text: 'text-c1', swatch: 'bg-c1' },
  2: { idle: 'bg-c2/20 border-c2/50', on: 'bg-c2/45 border-c2', text: 'text-c2', swatch: 'bg-c2' },
  3: { idle: 'bg-c3/20 border-c3/50', on: 'bg-c3/45 border-c3', text: 'text-c3', swatch: 'bg-c3' },
  4: { idle: 'bg-c4/20 border-c4/50', on: 'bg-c4/45 border-c4', text: 'text-c4', swatch: 'bg-c4' },
  5: { idle: 'bg-c5/20 border-c5/50', on: 'bg-c5/45 border-c5', text: 'text-c5', swatch: 'bg-c5' },
  6: { idle: 'bg-c6/20 border-c6/50', on: 'bg-c6/45 border-c6', text: 'text-c6', swatch: 'bg-c6' },
};

export function regionLabel(r: Region, s: Strings): string {
  if (r.kind === 'page') return r.label;
  if (r.kind === 'pt') return r.label;
  return s.segName[r.kind];
}

interface Props {
  run: Run;
  step: Step | undefined;
  hover: string | null;
  setHover: (id: string | null) => void;
  onPick: (id: string) => void;
  s: Strings;
}

/** Virtual address space and physical memory side by side, to scale, with the translation drawn between them. */
export function MemoryMap({ run, step, hover, setHover, onPick, s }: Props) {
  const vScale = Math.max(run.asize, ...run.vas.map((v) => v + 1), 1);
  const pScale = Math.max(run.psize, 1);
  const vRegions = run.regions.filter((r) => r.v);
  const digitsV = Math.max(2, Math.ceil(run.vaBits / 4));
  const digitsP = Math.max(2, Math.ceil(run.paBits / 4));
  const yv = step ? (step.va / vScale) * H : null;
  const yp = step?.pa != null ? (step.pa / pScale) * H : null;
  const ok = step?.outcome === 'ok';
  const hovered = run.regions.find((r) => r.id === hover);
  const curRegion = step?.region ?? null;
  const walkMarks =
    step && run.ml
      ? [
          { at: step.pdeAddr!, label: 'PDE' },
          ...(step.pteAddr !== undefined ? [{ at: step.pteAddr, label: 'PTE' }] : []),
        ]
      : [];

  const bar = (side: 'v' | 'p') => {
    const scale = side === 'v' ? vScale : pScale;
    const list = side === 'v' ? vRegions : run.regions;
    return (
      <div className="relative w-16 shrink-0 overflow-hidden rounded-xl border border-line-strong bg-sunken sm:w-24" style={{ height: H }}>
        {side === 'v' && vScale > run.asize && (
          <div
            className="absolute inset-x-0 bottom-0 bg-[repeating-linear-gradient(135deg,var(--color-line-strong)_0_2px,transparent_2px_7px)] opacity-70"
            style={{ top: `${(run.asize / vScale) * 100}%` }}
            title={s.outside}
          />
        )}
        {list.map((r) => {
          const [a, b] = side === 'v' ? r.v! : r.p;
          const px = ((b - a) / scale) * H;
          const on = hover === r.id || curRegion === r.id;
          const f = FILL[r.color] ?? FILL[1];
          return (
            <button
              key={r.id}
              type="button"
              aria-label={`${regionLabel(r, s)} ${hex(a)}–${hex(b - 1)}`}
              title={`${regionLabel(r, s)} · ${hex(a)}–${hex(b - 1)}`}
              onMouseEnter={() => setHover(r.id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(r.id)}
              onBlur={() => setHover(null)}
              onClick={() => onPick(r.id)}
              className={clsx(
                'absolute inset-x-1 overflow-hidden rounded-[5px] border text-left transition-[background-color,border-color,box-shadow] duration-200',
                on ? f.on : f.idle,
                hover === r.id && 'z-10 ring-2 ring-accent',
                r.kind === 'pd' && 'border-dashed',
              )}
              style={{ top: `${(a / scale) * 100}%`, height: Math.max(2, px) }}
            >
              {px >= 15 && (
                <span className={clsx('flex items-center gap-0.5 truncate px-1 font-mono text-[10px] leading-[14px]', f.text)}>
                  {r.grows === -1 && <span aria-hidden>↑</span>}
                  {regionLabel(r, s)}
                </span>
              )}
            </button>
          );
        })}
        {side === 'v' && yv !== null && (
          <motion.div className={clsx('pointer-events-none absolute inset-x-0 z-20 h-0.5', ok ? 'bg-accent' : 'bg-bad')} initial={false} animate={{ top: yv - 1 }} transition={spring} />
        )}
        {side === 'p' && yp !== null && <motion.div className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-accent" initial={false} animate={{ top: yp - 1 }} transition={spring} />}
        {side === 'p' &&
          walkMarks.map((m) => (
            <motion.div
              key={m.label}
              className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-info"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, top: (m.at / pScale) * H - 1 }}
              transition={spring}
            />
          ))}
      </div>
    );
  };

  type Mark = { y: number; text: string; tone: 'ink' | 'accent' | 'bad' | 'info' | 'dim'; key: string };
  const labels = (side: 'v' | 'p'): Mark[] => {
    const scale = side === 'v' ? vScale : pScale;
    const d = side === 'v' ? digitsV : digitsP;
    const out: Mark[] = [
      { y: 0, text: hex(0, d), tone: 'dim', key: 'top' },
      { y: H, text: hex(scale, d), tone: 'dim', key: 'bot' },
    ];
    if (hovered && (side === 'p' || hovered.v)) {
      const [a, b] = side === 'v' ? hovered.v! : hovered.p;
      out.push({ y: (a / scale) * H, text: hex(a, d), tone: 'ink', key: 'ha' }, { y: (b / scale) * H, text: hex(b, d), tone: 'ink', key: 'hb' });
    }
    if (side === 'v' && yv !== null) out.push({ y: yv, text: hex(step!.va, d), tone: ok ? 'accent' : 'bad', key: 'cur' });
    if (side === 'p' && yp !== null) out.push({ y: yp, text: hex(step!.pa!, d), tone: 'accent', key: 'cur' });
    if (side === 'p') for (const m of walkMarks) out.push({ y: (m.at / pScale) * H, text: m.label, tone: 'info', key: m.label });
    return out;
  };

  const labelCol = (side: 'v' | 'p') => (
    <div className={clsx('relative w-12 shrink-0 font-mono text-[10px] sm:w-16 sm:text-[10.5px]', side === 'v' ? 'text-right' : 'text-left')} style={{ height: H }}>
      <AnimatePresence initial={false}>
        {labels(side).map((m) => (
          <motion.span
            key={m.key}
            className={clsx(
              'absolute inset-x-0 block truncate leading-none',
              m.tone === 'dim' && 'text-ink-3',
              m.tone === 'ink' && 'text-ink',
              m.tone === 'accent' && 'font-semibold text-accent',
              m.tone === 'bad' && 'font-semibold text-bad',
              m.tone === 'info' && 'text-info',
            )}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, top: Math.min(H - 10, Math.max(0, m.y - 5)) }}
            exit={{ opacity: 0 }}
            transition={spring}
          >
            {m.text}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );

  const path = yv !== null ? (yp !== null ? `M0,${yv} C50,${yv} 50,${yp} 100,${yp}` : `M0,${yv} C20,${yv} 35,${yv} 50,${yv}`) : null;

  return (
    <div>
      <div className="mb-2 flex justify-between gap-4 font-mono text-[10.5px] uppercase tracking-[0.07em] text-ink-3">
        <span className="pl-12 sm:pl-16">{s.vSpace}</span>
        <span className="pr-12 sm:pr-16">{s.pSpace}</span>
      </div>
      <div className="flex items-stretch gap-1.5">
        {labelCol('v')}
        {bar('v')}
        <div className="relative min-w-6 flex-1" style={{ height: H }}>
          <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
            {path && (
              <motion.path
                key={ok ? 'ok' : 'bad'}
                d={path}
                fill="none"
                vectorEffect="non-scaling-stroke"
                className={ok ? 'stroke-accent' : 'stroke-bad'}
                strokeWidth={2}
                strokeDasharray={ok ? undefined : '4 4'}
                initial={{ pathLength: 0, d: path }}
                animate={{ pathLength: 1, d: path }}
                transition={{ pathLength: { duration: 0.35, ease: 'easeOut' }, d: spring }}
              />
            )}
          </svg>
          <AnimatePresence>
            {yv !== null && yp === null && (
              <motion.span
                key="x"
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1, top: yv - 9 }}
                exit={{ opacity: 0 }}
                transition={spring}
                className="absolute left-1/2 grid size-[18px] -translate-x-1/2 place-items-center rounded-full bg-bad text-[11px] font-bold text-surface"
              >
                ✕
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        {bar('p')}
        {labelCol('p')}
      </div>
      <Legend run={run} hover={hover} setHover={setHover} onPick={onPick} s={s} current={curRegion} />
    </div>
  );
}

function Legend({ run, hover, setHover, onPick, s, current }: { run: Run; hover: string | null; setHover: (id: string | null) => void; onPick: (id: string) => void; s: Strings; current: string | null }) {
  const items = run.regions.length <= 12 ? run.regions : run.regions.filter((r) => r.kind !== 'page' || r.id === current || r.id === hover);
  const pages = run.regions.filter((r) => r.kind === 'page').length;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {items.map((r) => {
        const f = FILL[r.color] ?? FILL[1];
        return (
          <button
            key={r.id}
            type="button"
            onMouseEnter={() => setHover(r.id)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onPick(r.id)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors',
              hover === r.id || current === r.id ? 'border-line-strong bg-chip text-ink' : 'border-line text-ink-2 hover:text-ink',
            )}
          >
            <span className={clsx('size-2 rounded-sm', f.swatch)} />
            {regionLabel(r, s)}
            {r.v && <span className="text-ink-3">{`${hex(r.v[0])}→${hex(r.p[0])}`}</span>}
          </button>
        );
      })}
      {run.regions.length > 12 && <span className="self-center font-mono text-[11px] text-ink-3">{`${pages} × ${s.segName.page}`}</span>}
    </div>
  );
}
