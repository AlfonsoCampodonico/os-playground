import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { byteLen, TTY_PATH, type KObj, type OpenFile, type Proc, type Snapshot, type Step } from '../../sim/pipes';
import type { PipesStrings } from './strings';

export type Hover = { k: 'fd'; pid: number; fd: number } | { k: 'file'; id: string } | { k: 'obj'; id: string } | { k: 'proc'; pid: number } | null;

/** Literal class names per categorical color so Tailwind sees them. */
export const PC = {
  bg: ['', 'bg-c1', 'bg-c2', 'bg-c3', 'bg-c4', 'bg-c5', 'bg-c6'],
  text: ['', 'text-c1', 'text-c2', 'text-c3', 'text-c4', 'text-c5', 'text-c6'],
  ring: ['', 'ring-c1', 'ring-c2', 'ring-c3', 'ring-c4', 'ring-c5', 'ring-c6'],
  border: ['', 'border-c1', 'border-c2', 'border-c3', 'border-c4', 'border-c5', 'border-c6'],
};

const spring = { type: 'spring', stiffness: 420, damping: 34 } as const;

interface Chain {
  fds: Set<string>;
  files: Set<string>;
  objs: Set<string>;
}

/** Everything connected to the hovered element. */
export function chainOf(state: Snapshot, hover: Hover): Chain | null {
  if (!hover) return null;
  const fds = new Set<string>();
  const files = new Set<string>();
  const objs = new Set<string>();
  const objOf = (id: string) => state.files.find((f) => f.id === id)?.obj;
  const fdsTo = (fileIds: Set<string>) => {
    for (const p of state.procs) p.fds.forEach((f, fd) => f && fileIds.has(f) && fds.add(`${p.pid}:${fd}`));
  };
  if (hover.k === 'fd' || hover.k === 'proc') {
    const p = state.procs.find((x) => x.pid === hover.pid);
    p?.fds.forEach((f, fd) => {
      if (!f || (hover.k === 'fd' && fd !== hover.fd)) return;
      fds.add(`${p.pid}:${fd}`);
      files.add(f);
      const o = objOf(f);
      if (o) objs.add(o);
    });
  } else if (hover.k === 'file') {
    files.add(hover.id);
    const o = objOf(hover.id);
    if (o) objs.add(o);
    fdsTo(files);
  } else {
    objs.add(hover.id);
    for (const f of state.files) if (f.obj === hover.id) files.add(f.id);
    fdsTo(files);
  }
  return { fds, files, objs };
}

interface Pt {
  l: number;
  r: number;
  y: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
/** Horizontal-tangent cubic segment from (x1,y1) to (x2,y2), in either direction. */
const cseg = (x1: number, y1: number, x2: number, y2: number) => {
  const dx = Math.max(20, Math.abs(x2 - x1) * 0.5) * (x2 >= x1 ? 1 : -1);
  return `C ${r1(x1 + dx)} ${r1(y1)}, ${r1(x2 - dx)} ${r1(y2)}, ${r1(x2)} ${r1(y2)}`;
};
const curve = (x1: number, y1: number, x2: number, y2: number) => `M ${r1(x1)} ${r1(y1)} ${cseg(x1, y1, x2, y2)}`;

export interface DiagramProps {
  state: Snapshot;
  step: Step | undefined;
  stepIndex: number;
  s: PipesStrings;
  fileLabel: (id: string | null) => string;
  fileShort: (id: string | null) => string;
  hover: Hover;
  setHover: (h: Hover) => void;
  onJump: (i: number) => void;
}

export function Diagram({ state, step, stepIndex, s, fileLabel, fileShort, hover, setHover, onJump }: DiagramProps) {
  const root = useRef<HTMLDivElement>(null);
  const [pts, setPts] = useState<Record<string, Pt>>({});
  const chain = useMemo(() => chainOf(state, hover), [state, hover]);

  const measure = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const next: Record<string, Pt> = {};
    el.querySelectorAll<HTMLElement>('[data-anchor]').forEach((a) => {
      let x = 0;
      let y = 0;
      let e: HTMLElement | null = a;
      while (e && e !== el) {
        x += e.offsetLeft;
        y += e.offsetTop;
        e = e.offsetParent as HTMLElement | null;
      }
      if (e !== el) return;
      next[a.dataset.anchor!] = { l: x, r: x + a.offsetWidth, y: y + a.offsetHeight / 2 };
    });
    setPts(next);
  }, []);

  useLayoutEffect(measure, [measure, state]);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [measure]);

  const touched = useMemo(() => new Set(step?.fds.map((f) => `${f.pid}:${f.fd}`) ?? []), [step]);
  const deltas = useMemo(() => new Map(step?.deltas.map((d) => [d.file, d]) ?? []), [step]);

  const lines: { key: string; d: string; color: string; on: boolean; bold: boolean }[] = [];
  for (const p of state.procs) {
    p.fds.forEach((f, fd) => {
      if (!f) return;
      const a = pts[`fd:${p.pid}:${fd}`];
      const b = pts[`of:${f}`];
      if (!a || !b) return;
      const k = `${p.pid}:${fd}`;
      lines.push({ key: `a:${k}`, d: curve(a.r, a.y, b.l, b.y), color: `var(--c${p.color})`, on: !chain || chain.fds.has(k), bold: touched.has(k) || !!chain?.fds.has(k) });
    });
  }
  for (const f of state.files) {
    const a = pts[`of:${f.id}`];
    const b = pts[`ob:${f.obj}`];
    if (!a || !b) continue;
    lines.push({ key: `b:${f.id}`, d: curve(a.r, a.y, b.l, b.y), color: 'var(--ink-3)', on: !chain || chain.files.has(f.id), bold: deltas.has(f.id) || !!chain?.files.has(f.id) });
  }

  // Bytes travelling along fd → entry → object (or back, for reads).
  let flowPath: string | null = null;
  const flow = step?.flow;
  if (flow) {
    const a = pts[`fd:${flow.pid}:${flow.fd}`];
    const b = pts[`of:${flow.file}`];
    const c = pts[`ob:${flow.obj}`];
    if (a && b && c) {
      flowPath =
        flow.dir === 'out'
          ? `${curve(a.r, a.y, b.l, b.y)} L ${r1(b.r)} ${r1(b.y)} ${cseg(b.r, b.y, c.l, c.y)}`
          : `${curve(c.l, c.y, b.r, b.y)} L ${r1(b.l)} ${r1(b.y)} ${cseg(b.l, b.y, a.r, a.y)}`;
    }
  }
  const flowColor = flow ? (state.procs.find((p) => p.pid === flow.pid)?.color ?? 1) : 1;

  const col = 'flex min-w-0 flex-col gap-2.5';
  const head = 'mb-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-3';

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1" onMouseLeave={() => setHover(null)}>
      <div ref={root} className="relative grid min-w-[760px] grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-14 py-1">
        <svg className="pointer-events-none absolute inset-0 z-0 size-full overflow-visible" aria-hidden="true">
          <AnimatePresence initial={false}>
            {lines.map((l) => (
              <motion.path
                key={l.key}
                fill="none"
                stroke={l.color}
                strokeLinecap="round"
                initial={{ d: l.d, pathLength: 0, opacity: 0 }}
                animate={{ d: l.d, pathLength: 1, opacity: l.on ? 0.9 : 0.12, strokeWidth: l.bold ? 2.5 : 1.5 }}
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                transition={spring}
              />
            ))}
          </AnimatePresence>
        </svg>

        <div className={clsx(col, 'relative z-10')}>
          <div className={head}>{s.colFds}</div>
          <AnimatePresence mode="popLayout" initial={false}>
            {state.procs.map((p) => (
              <ProcCard
                key={p.pid}
                p={p}
                s={s}
                active={step?.pid === p.pid}
                chain={chain}
                touched={touched}
                fileShort={fileShort}
                fileLabel={fileLabel}
                setHover={setHover}
                onJump={onJump}
              />
            ))}
          </AnimatePresence>
        </div>

        <div className={clsx(col, 'relative z-10')}>
          <div className={head}>{s.colFiles}</div>
          <AnimatePresence mode="popLayout" initial={false}>
            {state.files.map((f) => (
              <FileRow key={f.id} f={f} s={s} label={fileLabel(f.id)} delta={deltas.get(f.id)} dim={!!chain && !chain.files.has(f.id)} hot={!!chain?.files.has(f.id)} setHover={setHover} onJump={onJump} />
            ))}
          </AnimatePresence>
          {step &&
            step.deltas
              .filter((d) => d.to === 0)
              .map((d) => (
                <motion.div
                  key={`gone-${stepIndex}-${d.file}`}
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 0.85 }}
                  className="rounded-xl border border-dashed border-line-strong px-3 py-2 font-mono text-[11.5px] text-ink-3 line-through decoration-ink-3/50"
                >
                  {fileLabel(d.file)} · {s.freed}
                </motion.div>
              ))}
        </div>

        <div className={clsx(col, 'relative z-10')}>
          <div className={head}>{s.colObjs}</div>
          <AnimatePresence mode="popLayout" initial={false}>
            {state.objs.map((o) => (
              <ObjCard
                key={o.id}
                o={o}
                s={s}
                state={state}
                dim={!!chain && !chain.objs.has(o.id)}
                hot={!!chain?.objs.has(o.id) || flow?.obj === o.id}
                blocked={step?.note.k === 'block' && `pipe${step.note.pipe}` === o.id}
                stepIndex={stepIndex}
                setHover={setHover}
              />
            ))}
          </AnimatePresence>
        </div>

        {flow && flowPath && (
          <motion.div
            key={`flow-${stepIndex}`}
            className="pointer-events-none absolute left-0 top-0 z-20"
            style={{ offsetPath: `path("${flowPath}")`, offsetRotate: '0deg' }}
            initial={{ offsetDistance: '0%', opacity: 0 }}
            animate={{ offsetDistance: '100%', opacity: [0, 1, 1, 0] }}
            transition={{ duration: 0.9, ease: 'easeInOut', times: [0, 0.12, 0.85, 1] }}
          >
            <span className={clsx('block whitespace-nowrap rounded-full px-1.5 py-px font-mono text-[10.5px] font-semibold text-surface shadow', PC.bg[flowColor])}>{flow.bytes} B</span>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function stateLabel(p: Proc, s: PipesStrings): { text: string; cls: string } {
  if (p.state === 'zombie') return { text: s.states.zombie, cls: 'bg-warn-soft text-warn' };
  if (p.state === 'blocked') return { text: s.states.blocked, cls: 'bg-bad-soft text-bad' };
  if (p.state === 'waiting') return { text: s.states.waiting, cls: 'bg-chip text-ink-2' };
  if (!p.execd) return { text: s.states.preExec, cls: 'bg-chip text-ink-3' };
  return { text: s.states.running, cls: 'bg-ok-soft text-ok' };
}

function ProcCard({
  p,
  s,
  active,
  chain,
  touched,
  fileShort,
  fileLabel,
  setHover,
  onJump,
}: {
  p: Proc;
  s: PipesStrings;
  active: boolean;
  chain: Chain | null;
  touched: Set<string>;
  fileShort: (id: string | null) => string;
  fileLabel: (id: string | null) => string;
  setHover: (h: Hover) => void;
  onJump: (i: number) => void;
}) {
  const st = stateLabel(p, s);
  const procDim = !!chain && !p.fds.some((_, fd) => chain.fds.has(`${p.pid}:${fd}`));
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -12, scale: 0.97 }}
      animate={{ opacity: procDim ? 0.45 : 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
      transition={spring}
      className={clsx('overflow-hidden rounded-xl border border-line bg-surface transition-shadow duration-200', active && clsx('ring-2', PC.ring[p.color]))}
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5" onMouseEnter={() => setHover({ k: 'proc', pid: p.pid })}>
        <span className={clsx('size-2.5 shrink-0 rounded-full', PC.bg[p.color])} />
        <span className="font-mono text-[12px] text-ink-3">{p.pid}</span>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={p.name}
            initial={{ y: -8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={spring}
            className={clsx('font-mono text-[13px] font-semibold', PC.text[p.color])}
          >
            {p.role === 'shell' ? `sh (${s.shell})` : p.name}
          </motion.span>
        </AnimatePresence>
        <span className={clsx('ml-auto truncate rounded-full px-2 py-0.5 font-mono text-[10.5px] font-medium transition-colors duration-300', st.cls)}>{st.text}</span>
      </div>
      <div className="py-1">
        {p.fds.length === 0 && <div className="px-3 py-1 font-mono text-[11.5px] text-ink-3">—</div>}
        <AnimatePresence initial={false}>
          {p.fds.map((f, fd) => {
            const k = `${p.pid}:${fd}`;
            const hot = !!chain?.fds.has(k);
            const now = touched.has(k);
            return (
              <motion.button
                key={fd}
                type="button"
                layout="position"
                data-anchor={f ? `fd:${k}` : undefined}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={spring}
                onMouseEnter={() => f && setHover({ k: 'fd', pid: p.pid, fd })}
                onClick={() => onJump(p.fdSince[fd] ?? 0)}
                title={f ? `${fileLabel(f)} · ${s.jump}` : s.closed}
                className={clsx(
                  'flex w-full items-center gap-2 px-3 py-[3px] text-left font-mono text-[12px] transition-colors duration-200',
                  now ? 'bg-accent-soft' : hot ? 'bg-chip' : 'hover:bg-chip',
                )}
              >
                <span className={clsx('grid h-5 w-6 shrink-0 place-items-center rounded-md text-[11.5px] transition-colors', f ? 'bg-sunken text-ink' : 'border border-dashed border-line-strong text-ink-3')}>
                  {fd}
                </span>
                <span className="w-11 shrink-0 text-[10.5px] text-ink-3">{s.std[fd] ?? ''}</span>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={f ?? 'x'}
                    initial={{ x: 8, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: -8, opacity: 0 }}
                    transition={spring}
                    className={clsx('truncate', f ? 'text-ink' : 'text-ink-3')}
                  >
                    {f ? fileShort(f) : s.closed}
                  </motion.span>
                </AnimatePresence>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function FileRow({
  f,
  s,
  label,
  delta,
  dim,
  hot,
  setHover,
  onJump,
}: {
  f: OpenFile;
  s: PipesStrings;
  label: string;
  delta: { from: number; to: number } | undefined;
  dim: boolean;
  hot: boolean;
  setHover: (h: Hover) => void;
  onJump: (i: number) => void;
}) {
  const d = delta ? delta.to - delta.from : 0;
  const mode = f.append ? `${f.mode} · ${s.appendMode}` : f.mode;
  return (
    <motion.button
      type="button"
      layout
      data-anchor={`of:${f.id}`}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: dim ? 0.45 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      transition={spring}
      onMouseEnter={() => setHover({ k: 'file', id: f.id })}
      onClick={() => onJump(f.since)}
      title={s.jump}
      className={clsx(
        'flex items-center gap-3 rounded-xl border bg-surface px-3 py-2 text-left transition-colors duration-200',
        delta ? 'border-accent ring-2 ring-accent/25' : hot ? 'border-line-strong bg-chip' : 'border-line hover:border-line-strong',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[12.5px] text-ink">{label}</div>
        <div className="truncate font-mono text-[10.5px] text-ink-3">
          {s.mode} {mode} · {s.offset} {f.offset ?? '—'}
        </div>
      </div>
      <div className="relative flex shrink-0 flex-col items-end">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.07em] text-ink-3">{s.ref}</span>
        <span key={f.ref} className={clsx('font-serif text-[24px] leading-none tabular-nums', delta && 'animate-pop', f.ref > 1 ? 'text-ink' : 'text-ink-2')}>
          {f.ref}
        </span>
        {delta && d !== 0 && (
          <span className={clsx('absolute -left-7 top-3 rounded-full px-1 font-mono text-[10.5px] font-semibold animate-rise', d > 0 ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad')}>
            {d > 0 ? `+${d}` : `−${-d}`}
          </span>
        )}
      </div>
    </motion.button>
  );
}

const tail = (text: string, n: number) => {
  const ls = text.split('\n');
  return ls.slice(Math.max(0, ls.length - n)).join('\n');
};

function ObjCard({
  o,
  s,
  state,
  dim,
  hot,
  blocked,
  stepIndex,
  setHover,
}: {
  o: KObj;
  s: PipesStrings;
  state: Snapshot;
  dim: boolean;
  hot: boolean;
  blocked: boolean;
  stepIndex: number;
  setHover: (h: Hover) => void;
}) {
  const entries = state.files.filter((f) => f.obj === o.id);
  return (
    <motion.div
      layout
      data-anchor={`ob:${o.id}`}
      initial={{ opacity: 0, x: 12, scale: 0.97 }}
      animate={{ opacity: dim ? 0.45 : o.kind === 'file' && entries.length === 0 ? 0.7 : 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.2 } }}
      transition={spring}
      onMouseEnter={() => setHover({ k: 'obj', id: o.id })}
      className={clsx('rounded-xl border bg-surface px-3 py-2 transition-colors duration-200', blocked ? 'border-bad ring-2 ring-bad/25' : hot ? 'border-line-strong bg-chip' : 'border-line')}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-[12.5px] font-semibold text-ink">{o.kind === 'tty' ? `${s.term} ${TTY_PATH}` : o.name}</span>
        {o.inode !== undefined && (
          <span className="shrink-0 font-mono text-[10.5px] text-ink-3">
            {s.inode} {o.inode}
          </span>
        )}
      </div>
      {o.kind === 'tty' && (
        <pre key={o.screen.length} className={clsx('mt-1.5 min-h-[2.6em] overflow-hidden whitespace-pre-wrap break-all rounded-lg bg-sunken px-2 py-1.5 font-mono text-[11px] leading-snug text-ink', o.screen && 'animate-rise')}>
          {tail(o.screen, 5)}
          <span className="inline-block h-3 w-1.5 translate-y-0.5 animate-pulse bg-ink-3" />
        </pre>
      )}
      {o.kind === 'pipe' && <PipeBody o={o} s={s} entries={entries} blocked={blocked} stepIndex={stepIndex} />}
      {o.kind === 'file' && (
        <>
          <div className="mt-0.5 font-mono text-[10.5px] text-ink-3">
            {s.bytes(byteLen(o.content))}
            {entries.length === 0 && ` · ${s.onDisk}`}
          </div>
          {o.content && (
            <pre key={o.content.length} className="mt-1 max-h-[4.2em] overflow-hidden whitespace-pre-wrap break-all rounded-lg bg-sunken px-2 py-1 font-mono text-[11px] leading-snug text-ink-2 animate-rise">
              {tail(o.content.replace(/\n$/, ''), 3)}
            </pre>
          )}
        </>
      )}
    </motion.div>
  );
}

function PipeBody({ o, s, entries, blocked, stepIndex }: { o: KObj; s: PipesStrings; entries: OpenFile[]; blocked: boolean; stepIndex: number }) {
  const n = byteLen(o.buffer);
  const readers = entries.find((f) => f.end === 'r')?.ref ?? 0;
  const writers = entries.find((f) => f.end === 'w')?.ref ?? 0;
  return (
    <>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="relative h-4 flex-1 overflow-hidden rounded-full border border-line-strong bg-sunken">
          <motion.div className="h-full rounded-full bg-info-soft" initial={false} animate={{ width: `${Math.min(100, n === 0 ? 0 : 8 + (n / 256) * 92)}%` }} transition={spring} />
          <span className="absolute inset-0 grid place-items-center font-mono text-[10px] text-ink-2">{n ? s.bytes(n) : s.empty}</span>
        </div>
      </div>
      {o.buffer && (
        <pre key={stepIndex} className="mt-1 max-h-[3.4em] overflow-hidden whitespace-pre-wrap break-all font-mono text-[10.5px] leading-snug text-ink-3 animate-rise">
          {o.buffer.split('\n').slice(0, 2).join('⏎ ')}…
        </pre>
      )}
      <div className="mt-1 flex gap-1.5 font-mono text-[10.5px]">
        <span className={clsx('rounded-full px-1.5 py-px transition-colors', readers ? 'bg-chip text-ink-2' : 'bg-warn-soft text-warn')}>
          {s.readers} {readers}
        </span>
        <span className={clsx('rounded-full px-1.5 py-px transition-colors', blocked ? 'bg-bad-soft text-bad' : writers ? 'bg-chip text-ink-2' : 'bg-ok-soft text-ok')}>
          {s.writers} {writers}
        </span>
      </div>
    </>
  );
}
