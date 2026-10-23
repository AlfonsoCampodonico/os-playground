import clsx from 'clsx';
import { motion } from 'motion/react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { jobName, type Job, type JobState, type SchedRun } from '../../sim/scheduling';
import { colorIndex, jobBg, jobFill, jobStroke, spring } from './colors';
import type { Strings } from './strings';

const ROW = 20;
const GAP = 4;
const SECTION = 12;
const AXIS = 20;
const PAD = 2;

interface Seg {
  job: number;
  from: number;
  to: number;
  kind: 'run' | 'ready' | 'io';
}

/** Collapses per-tick values into [from, to) runs. */
function runs<T>(values: T[], keep: (v: T) => boolean): { v: T; from: number; to: number }[] {
  const out: { v: T; from: number; to: number }[] = [];
  values.forEach((v, t) => {
    const last = out.at(-1);
    if (last && last.v === v && last.to === t) last.to = t + 1;
    else if (keep(v)) out.push({ v, from: t, to: t + 1 });
  });
  return out;
}

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function Gantt({
  run,
  jobs,
  index,
  hover,
  setHover,
  onSeek,
  s,
}: {
  run: SchedRun;
  jobs: Job[];
  index: number;
  hover: number | null;
  setHover: (j: number | null) => void;
  onSeek: (i: number) => void;
  s: Strings;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useIsoLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const T = Math.max(run.steps.length, 1);
  const unit = Math.min(40, Math.max(3, (width - 2) / T));
  const W = Math.ceil(unit * T) + 1;
  const mlfq = run.policy === 'mlfq';
  const top = mlfq ? Array.from({ length: run.levels }, (_, i) => run.levels - 1 - i) : [0];

  const { topSegs, laneSegs, boosts } = useMemo(() => {
    const topSegs = top.map((level) =>
      runs(
        run.steps.map((st) => (st.running !== null && (!mlfq || st.level === level) ? st.running : -1)),
        (v) => v >= 0,
      ).map((r): Seg => ({ job: r.v, from: r.from, to: r.to, kind: 'run' })),
    );
    const laneSegs = jobs.map((_, j) =>
      runs<JobState>(
        run.steps.map((st) => st.states[j]),
        (v) => v === 'run' || v === 'ready' || v === 'io',
      ).map((r): Seg => ({ job: j, from: r.from, to: r.to, kind: r.v as Seg['kind'] })),
    );
    const boosts = run.steps.filter((st) => st.pre.some((e) => e.k === 'boost')).map((st) => st.t);
    return { topSegs, laneSegs, boosts };
  }, [run, jobs, mlfq, run.levels]);

  const topH = top.length * (ROW + GAP) - GAP;
  const laneY = (j: number) => PAD + topH + SECTION + j * (ROW + GAP);
  const rowY = (k: number) => PAD + k * (ROW + GAP);
  const H = laneY(jobs.length) - GAP + 6 + AXIS;
  const axisY = H - AXIS + 4;

  const stepPx = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000].find((k) => k * unit >= 30) ?? 1000;
  const ticks: number[] = [];
  for (let t = 0; t <= T; t += stepPx) ticks.push(t);

  // keep the cursor in view while playing
  useEffect(() => {
    const el = scroller.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const x = index * unit;
    if (x < el.scrollLeft + 24 || x > el.scrollLeft + el.clientWidth - 24) el.scrollTo({ left: Math.max(0, x - el.clientWidth / 2), behavior: 'smooth' });
  }, [index, unit]);

  const seek = (e: MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = Math.floor((e.clientX - r.left) / unit);
    if (t >= 0 && t < run.steps.length) onSeek(t + 1);
  };

  const rect = (g: Seg, y: number, label: boolean, key: string) => {
    const x = g.from * unit;
    const w = (g.to - g.from) * unit;
    const dim = hover !== null && hover !== g.job;
    const base = g.kind === 'ready' ? 0.2 : 1;
    return (
      <g key={key} onMouseEnter={() => setHover(g.job)} style={{ opacity: dim ? base * 0.3 : base }} className="transition-opacity duration-200">
        <rect
          x={x + 0.5}
          y={y}
          width={Math.max(w - 1, 1)}
          height={ROW}
          rx={Math.min(4, w / 3)}
          className={g.kind === 'io' ? undefined : jobFill(g.job)}
          fill={g.kind === 'io' ? `url(#${uid}-h${colorIndex(g.job)})` : undefined}
        >
          <title>{`${jobName(g.job)} · t=${g.from}–${g.to} · ${g.kind === 'run' ? s.legendRun : g.kind === 'ready' ? s.legendReady : s.legendIo}`}</title>
        </rect>
        {label && w >= 14 && (
          <text x={x + w / 2} y={y + ROW / 2 + 3.5} textAnchor="middle" className="pointer-events-none fill-surface font-mono text-[10px] font-semibold">
            {jobName(g.job)}
          </text>
        )}
      </g>
    );
  };

  const layer = (
    <>
      {topSegs.map((segs, k) => segs.map((g, i) => rect(g, rowY(k), true, `t${k}-${i}`)))}
      {laneSegs.map((segs, j) => segs.map((g, i) => rect(g, laneY(j), false, `l${j}-${i}`)))}
    </>
  );

  const labelCls = 'flex items-center font-mono text-[11px] text-ink-3';

  return (
    <div>
      <div className="flex gap-2">
        {/* row labels stay put while the chart scrolls */}
        <div className="relative w-9 shrink-0" style={{ height: H }}>
          {top.map((level, k) => (
            <div key={level} className={clsx(labelCls, 'absolute')} style={{ top: rowY(k), height: ROW }}>
              {mlfq ? `Q${level}` : s.cpu}
            </div>
          ))}
          {jobs.map((_, j) => (
            <div
              key={j}
              className={clsx(labelCls, 'absolute gap-1.5 transition-colors', hover === j && 'text-ink')}
              style={{ top: laneY(j), height: ROW }}
              onMouseEnter={() => setHover(j)}
              onMouseLeave={() => setHover(null)}
            >
              <span className={clsx('size-2 rounded-full', jobBg(j))} />
              {jobName(j)}
            </div>
          ))}
        </div>

        <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain pb-1">
          <svg width={W} height={H} className="block cursor-pointer select-none" onClick={seek} onMouseLeave={() => setHover(null)} role="img" aria-label={s.gantt}>
            <defs>
              {[0, 1, 2, 3, 4, 5].map((c) => (
                <pattern key={c} id={`${uid}-h${c}`} width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width={5} height={5} className={jobFill(c)} opacity={0.14} />
                  <line x1={0} y1={0} x2={0} y2={5} className={jobStroke(c)} strokeWidth={2.2} />
                </pattern>
              ))}
              <clipPath id={`${uid}-reveal`}>
                <motion.rect x={0} y={0} height={H} initial={false} animate={{ width: index * unit }} transition={spring} />
              </clipPath>
            </defs>

            {/* row tracks */}
            {top.map((level, k) => (
              <rect key={`bg${level}`} x={0} y={rowY(k)} width={W} height={ROW} rx={4} className="fill-sunken" />
            ))}
            {jobs.map((_, j) => (
              <rect key={`lbg${j}`} x={0} y={laneY(j)} width={W} height={ROW} rx={4} className={clsx('transition-colors duration-200', hover === j ? 'fill-chip' : 'fill-sunken')} />
            ))}

            {/* time grid */}
            {ticks.map((t) => (
              <line key={`g${t}`} x1={t * unit + 0.5} x2={t * unit + 0.5} y1={PAD} y2={axisY - 6} className="stroke-line" strokeWidth={1} />
            ))}

            {/* the whole schedule, faint; the part already run, solid */}
            <g opacity={0.22}>{layer}</g>
            <g clipPath={`url(#${uid}-reveal)`}>{layer}</g>

            {/* boosts */}
            {boosts.map((t) => (
              <line key={`b${t}`} x1={t * unit} x2={t * unit} y1={PAD - 1} y2={PAD + topH + 1} className="stroke-warn" strokeWidth={1.5} strokeDasharray="3 2" />
            ))}

            {/* arrivals */}
            {jobs.map((job, j) => (
              <path key={`a${j}`} d={`M${Math.max(3.5, job.arrival * unit) - 3.5},${laneY(j) - 3} h7 l-3.5,4.5 z`} className="fill-ink-3" pointerEvents="none" />
            ))}

            {/* current tick + now cursor */}
            {index > 0 && (
              <motion.rect
                y={PAD - 1}
                height={laneY(jobs.length) - GAP - PAD + 2}
                width={unit}
                initial={false}
                animate={{ x: (index - 1) * unit }}
                transition={spring}
                className="fill-accent"
                opacity={0.12}
                pointerEvents="none"
              />
            )}
            <motion.g initial={false} animate={{ x: index * unit }} transition={spring} pointerEvents="none">
              <line x1={0} x2={0} y1={0} y2={axisY - 4} className="stroke-accent" strokeWidth={2} />
              <circle cx={0} cy={axisY - 4} r={3} className="fill-accent" />
            </motion.g>

            {/* axis */}
            {ticks.map((t) => (
              <text
                key={`x${t}`}
                x={t * unit}
                y={axisY + 10}
                textAnchor={t === 0 ? 'start' : t * unit > W - 12 ? 'end' : 'middle'}
                className="fill-ink-3 font-mono text-[10px] tabular-nums"
              >
                {t}
              </text>
            ))}
          </svg>
        </div>
      </div>

      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 pl-11 text-[11.5px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-ink-3" /> {s.legendRun}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-ink-3/25" /> {s.legendReady}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-[repeating-linear-gradient(45deg,var(--ink-3)_0_2px,transparent_2px_5px)]" /> {s.legendIo}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-0 border-x-[4px] border-t-[5px] border-x-transparent border-t-ink-3" /> {s.arrival.toLowerCase()}
        </span>
      </div>
    </div>
  );
}
