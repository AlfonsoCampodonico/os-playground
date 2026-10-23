import clsx from 'clsx';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useStrings } from '../../components/kit';
import { beladyPoints, type Policy } from '../../sim/page-replacement';
import { S } from './strings';

const spring = { type: 'spring', stiffness: 420, damping: 34 } as const;

/** Hit rate of every policy on the same trace; click a bar to switch policy. */
export function PolicyBars({
  rows,
  total,
  policy,
  onPick,
}: {
  rows: { policy: Policy; hits: number; misses: number }[];
  total: number;
  policy: Policy;
  onPick: (p: Policy) => void;
}) {
  const s = useStrings(S);
  const best = Math.max(...rows.map((r) => r.hits));
  return (
    <div className="space-y-1">
      {rows.map((r) => {
        const on = r.policy === policy;
        const pct = total ? (r.hits / total) * 100 : 0;
        return (
          <button
            key={r.policy}
            type="button"
            onClick={() => onPick(r.policy)}
            title={s.pickPolicy(r.policy)}
            className={clsx(
              'grid w-full grid-cols-[3.75rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-1.5 text-left font-mono text-[12px] transition-colors duration-200',
              on ? 'bg-accent-soft' : 'hover:bg-chip',
            )}
          >
            <span className={clsx('font-medium', on ? 'text-accent' : 'text-ink-2')}>{r.policy}</span>
            <span className="relative h-2.5 overflow-hidden rounded-full bg-sunken">
              <motion.span
                className={clsx('absolute inset-y-0 left-0 rounded-full', on ? 'bg-accent' : 'bg-ink-3/60')}
                initial={false}
                animate={{ width: `${pct}%` }}
                transition={spring}
              />
            </span>
            <span className="whitespace-nowrap text-right tabular-nums text-ink-2">
              <span className={clsx(r.hits === best && 'text-ok')}>{s.hitsOf(r.hits, total)}</span>
              <span className="text-ink-3"> · {s.faultsShort(r.misses)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

const SERIES: { policy: Policy; stroke: string; fill: string; dash?: string }[] = [
  { policy: 'FIFO', stroke: 'stroke-c1', fill: 'fill-c1' },
  { policy: 'LRU', stroke: 'stroke-c2', fill: 'fill-c2' },
  { policy: 'OPT', stroke: 'stroke-c3', fill: 'fill-c3', dash: '5 4' },
];

/** Faults vs. number of frames for FIFO, LRU and OPT, with Belady's anomaly annotated. */
export function FaultCurve({
  curves,
  frames,
  total,
  onFrames,
}: {
  curves: Record<'FIFO' | 'LRU' | 'OPT', number[]>;
  frames: number;
  total: number;
  onFrames: (k: number) => void;
}) {
  const s = useStrings(S);
  const [hoverK, setHoverK] = useState<number | null>(null);
  const F = curves.FIFO.length;
  const W = 340;
  const H = 200;
  const pad = { l: 30, r: 14, t: 34, b: 30 };
  const maxY = Math.max(1, total);
  const x = (k: number) => pad.l + (F <= 1 ? 0 : ((k - 1) / (F - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / maxY) * (H - pad.t - pad.b);
  const ticksY = [0, Math.round(maxY / 2), maxY];
  const anomalies = beladyPoints(curves.FIFO);
  const a = anomalies[0];
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i + 1)},${y(v)}`).join(' ');
  const colW = F <= 1 ? W : (W - pad.l - pad.r) / (F - 1);
  const shown = hoverK ?? frames;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11.5px] text-ink-2">
        {SERIES.map((sr) => (
          <span key={sr.policy} className="flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden="true">
              <line x1="1" y1="4" x2="17" y2="4" className={sr.stroke} strokeWidth={2} strokeDasharray={sr.dash} strokeLinecap="round" />
            </svg>
            {sr.policy}
            {shown <= F && <span className="text-ink-3 tabular-nums">{curves[sr.policy as 'FIFO'][shown - 1]}</span>}
          </span>
        ))}
        <span className="ml-auto text-ink-3">
          {shown} {s.framesAxis}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" role="img" aria-label={s.curve} onMouseLeave={() => setHoverK(null)}>
        {ticksY.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 3.5} textAnchor="end" className="fill-ink-3 font-mono text-[9.5px]">
              {t}
            </text>
          </g>
        ))}
        {Array.from({ length: F }, (_, i) => (
          <text key={i} x={x(i + 1)} y={H - pad.b + 14} textAnchor="middle" className={clsx('font-mono text-[9.5px]', i + 1 === frames ? 'fill-accent font-semibold' : 'fill-ink-3')}>
            {i + 1}
          </text>
        ))}
        <text x={W - pad.r} y={H - 3} textAnchor="end" className="fill-ink-3 font-mono text-[9px]">
          {s.framesAxis} →
        </text>

        {/* current frame count */}
        <motion.line
          initial={false}
          animate={{ x1: x(frames), x2: x(frames) }}
          transition={spring}
          y1={pad.t - 6}
          y2={H - pad.b}
          className="stroke-accent"
          strokeWidth={1.5}
          strokeDasharray="3 3"
        />
        {hoverK !== null && hoverK !== frames && <line x1={x(hoverK)} x2={x(hoverK)} y1={pad.t - 6} y2={H - pad.b} className="stroke-ink-3" strokeWidth={1} />}

        {/* Belady segment highlight */}
        {anomalies.map((k) => (
          <line key={k} x1={x(k)} y1={y(curves.FIFO[k - 1])} x2={x(k + 1)} y2={y(curves.FIFO[k])} className="stroke-warn/30" strokeWidth={9} strokeLinecap="round" />
        ))}

        {SERIES.map((sr) => (
          <motion.path
            key={sr.policy}
            initial={false}
            animate={{ d: path(curves[sr.policy as 'FIFO']) }}
            transition={spring}
            fill="none"
            className={sr.stroke}
            strokeWidth={2}
            strokeDasharray={sr.dash}
            strokeLinejoin="round"
          />
        ))}
        {SERIES.map((sr) =>
          curves[sr.policy as 'FIFO'].map((v, i) => (
            <motion.circle
              key={`${sr.policy}${i}`}
              initial={false}
              animate={{ cx: x(i + 1), cy: y(v) }}
              transition={spring}
              r={i + 1 === shown ? 4.5 : 3}
              className={clsx(sr.fill, 'stroke-surface')}
              strokeWidth={2}
            />
          )),
        )}

        {a !== undefined && (
          <g>
            <text x={Math.min(Math.max(x(a + 0.5), pad.l + 70), W - pad.r - 70)} y={14} textAnchor="middle" className="fill-warn font-mono text-[10px] font-semibold">
              {s.beladyShort(a, a + 1, curves.FIFO[a - 1], curves.FIFO[a])}
            </text>
            <line x1={x(a + 0.5)} x2={x(a + 0.5)} y1={18} y2={y((curves.FIFO[a - 1] + curves.FIFO[a]) / 2) - 8} className="stroke-warn" strokeWidth={1} />
          </g>
        )}

        {/* hit areas: hover shows values, click sets the frame count */}
        {Array.from({ length: F }, (_, i) => (
          <rect
            key={i}
            x={x(i + 1) - colW / 2}
            y={0}
            width={colW}
            height={H}
            fill="transparent"
            className="cursor-pointer"
            onMouseEnter={() => setHoverK(i + 1)}
            onClick={() => onFrames(i + 1)}
          >
            <title>{s.setFrames(i + 1)}</title>
          </rect>
        ))}
      </svg>
      <p className={clsx('mt-2 text-[12.5px] leading-relaxed', a !== undefined ? 'text-warn' : 'text-ink-3')}>
        {a !== undefined ? s.belady(a, a + 1, curves.FIFO[a - 1], curves.FIFO[a]) : s.noBelady} <span className="text-ink-3">{s.stackProp}</span>
      </p>
    </div>
  );
}
