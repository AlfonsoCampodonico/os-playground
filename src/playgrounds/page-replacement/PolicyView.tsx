import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useRef, type ReactNode } from 'react';
import { Badge, useStrings } from '../../components/kit';
import type { FutureUse, Policy, PrRun, PrStep } from '../../sim/page-replacement';
import { S } from './strings';

const spring = { type: 'spring', stiffness: 480, damping: 32 } as const;

interface ViewProps {
  run: PrRun;
  index: number;
  policy: Policy;
  frames: number;
  clockBits: number;
  circular: boolean;
  hover: number | null;
  setHover: (p: number | null) => void;
}

/** The policy's own bookkeeping: FIFO queue, LRU stack, OPT next use, CLOCK ring, RAND pick. */
export function PolicyView(props: ViewProps) {
  const { policy } = props;
  if (policy === 'FIFO') return <Queue {...props} />;
  if (policy === 'LRU' || policy === 'MRU') return <Stack {...props} />;
  if (policy === 'OPT' || policy === 'UNOPT') return <Future {...props} />;
  if (policy === 'CLOCK') return <Ring {...props} />;
  return <RandList {...props} />;
}

export function policyViewTitle(policy: Policy, s: (typeof S)['es']): string {
  if (policy === 'FIFO') return s.queue;
  if (policy === 'LRU' || policy === 'MRU') return s.stack;
  if (policy === 'OPT' || policy === 'UNOPT') return s.future;
  if (policy === 'CLOCK') return s.ring;
  return s.rand;
}

function Chip({ page, tone, hover, setHover, wide, className }: { page: number; tone?: 'ok' | 'bad' | 'warn'; hover: number | null; setHover: (p: number | null) => void; wide?: boolean; className?: string }) {
  return (
    <span
      onMouseEnter={() => setHover(page)}
      onMouseLeave={() => setHover(null)}
      className={clsx(
        'grid place-items-center rounded-xl border',
        wide ? 'h-9 w-14' : 'h-10 w-10',
        'border font-mono text-[15px] font-semibold transition-colors duration-300',
        tone === 'ok' && 'border-transparent bg-ok-soft text-ok',
        tone === 'bad' && 'border-transparent bg-bad-soft text-bad',
        tone === 'warn' && 'border-warn/50 bg-warn-soft text-warn',
        !tone && 'border-line-strong bg-surface text-ink',
        hover === page && 'ring-2 ring-ink/70',
        className,
      )}
    >
      {page}
    </span>
  );
}

const toneOf = (st: PrStep | undefined, page: number) => (st && st.page === page ? (st.hit ? 'ok' : 'bad') : undefined);
const full = (st: PrStep | undefined, frames: number) => !!st && st.memory.length === frames;

function Note({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-[12.5px] leading-relaxed text-ink-3">{children}</p>;
}

function Queue({ run, index, frames, hover, setHover }: ViewProps) {
  const s = useStrings(S);
  const st = index > 0 ? run.steps[index - 1] : undefined;
  const memory = st?.memory ?? [];
  return (
    <div>
      <div className="flex items-center gap-2 overflow-x-auto py-1">
        <span className="shrink-0 font-mono text-[11px] text-ink-3">{s.queueOut} ←</span>
        <div className="flex min-h-12 items-center gap-1.5">
          <AnimatePresence mode="popLayout" initial={false}>
            {memory.map((p, i) => (
              <motion.div
                key={p}
                layout
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24, scale: 0.8 }}
                transition={spring}
                className="relative"
              >
                <Chip page={p} tone={toneOf(st, p) ?? (i === 0 && full(st, frames) ? 'warn' : undefined)} hover={hover} setHover={setHover} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <span className="shrink-0 font-mono text-[11px] text-ink-3">← {s.queueIn}</span>
      </div>
      {full(st, frames) && (
        <div className="mt-1 text-[11.5px] text-warn">
          {memory[0]}: {s.nextVictim}
        </div>
      )}
      <Note>{s.queueNote}</Note>
    </div>
  );
}

function Stack({ run, index, policy, frames, hover, setHover }: ViewProps) {
  const s = useStrings(S);
  const st = index > 0 ? run.steps[index - 1] : undefined;
  const top = [...(st?.memory ?? [])].reverse();
  const victimAt = policy === 'LRU' ? top.length - 1 : 0;
  return (
    <div>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">↑ {s.mru}</div>
      <div className="my-2 flex min-h-12 flex-col gap-1.5">
        <AnimatePresence mode="popLayout" initial={false}>
          {top.map((p, i) => (
            <motion.div
              key={p}
              layout
              initial={{ opacity: 0, y: -16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 24, scale: 0.8 }}
              transition={spring}
              className="flex items-center gap-3"
            >
              <Chip page={p} tone={toneOf(st, p) ?? (i === victimAt && full(st, frames) ? 'warn' : undefined)} hover={hover} setHover={setHover} wide />
              {i === victimAt && full(st, frames) && toneOf(st, p) === undefined && <span className="text-[11.5px] text-warn">{s.nextVictim}</span>}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">↓ {s.lru}</div>
      <Note>{policy === 'LRU' ? s.stackNote : s.mruNote}</Note>
    </div>
  );
}

function Future({ run, index, policy, hover, setHover }: ViewProps) {
  const s = useStrings(S);
  const st = index > 0 ? run.steps[index - 1] : undefined;
  const n = run.trace.length;
  const rows: FutureUse[] = useMemo(() => {
    if (!st) return [];
    if (st.future) return st.future;
    return st.memory.map((page) => {
      let next = n;
      for (let i = st.index + 1; i < n; i++)
        if (run.trace[i] === page) {
          next = i;
          break;
        }
      return { page, slot: st.slots.indexOf(page), next };
    });
  }, [st, n, run.trace]);
  const at = st?.index ?? 0;
  const maxD = Math.max(1, n - at);
  return (
    <div>
      <div className="mb-3 text-[12.5px] text-ink-2">{st?.future ? s.futureAt(at + 1) : s.futureNow}</div>
      <div className="space-y-1.5">
        <AnimatePresence initial={false} mode="popLayout">
          {rows.map((r) => {
            const isVictim = st?.future && r.page === st.victim;
            const never = r.next >= n;
            const d = r.next - at;
            return (
              <motion.div
                key={r.page}
                layout
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={spring}
                onMouseEnter={() => setHover(r.page)}
                onMouseLeave={() => setHover(null)}
                className={clsx(
                  'grid grid-cols-[2.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 rounded-lg px-2 py-1.5 font-mono text-[12.5px] transition-colors duration-300',
                  isVictim ? 'bg-bad-soft text-bad' : 'text-ink-2',
                  hover === r.page && !isVictim && 'bg-chip',
                )}
              >
                <span className="text-[15px] font-semibold">{r.page}</span>
                <div className="h-2 overflow-hidden rounded-full bg-sunken">
                  <motion.div
                    className={clsx('h-full rounded-full', isVictim ? 'bg-bad' : never ? 'bg-ink-3' : 'bg-info')}
                    initial={false}
                    animate={{ width: `${never ? 100 : Math.min(100, (d / maxD) * 100)}%` }}
                    transition={spring}
                  />
                </div>
                <span className="text-right">{never ? s.never : `#${r.next + 1}`}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      {st?.future && (
        <div className="mt-3">
          <Badge tone="bad">{policy === 'OPT' ? s.victimFar : s.victimNear}</Badge>
        </div>
      )}
      <Note>{s.futureNote}</Note>
    </div>
  );
}

function RandList({ run, index, hover, setHover }: ViewProps) {
  const s = useStrings(S);
  const st = index > 0 ? run.steps[index - 1] : undefined;
  const before = st?.memoryBefore ?? [];
  const showPick = st?.pick !== undefined;
  const list = showPick ? before : st?.memory ?? [];
  return (
    <div>
      <div className="flex min-h-16 items-end gap-1.5">
        {list.map((p, i) => (
          <div key={`${index}:${i}`} className="flex flex-col items-center gap-1">
            <Chip page={p} tone={showPick ? (i === st!.pick ? 'bad' : undefined) : toneOf(st, p)} hover={hover} setHover={setHover} className={clsx(showPick && i === st!.pick && 'animate-pop')} />
            <span className={clsx('font-mono text-[10.5px]', showPick && i === st!.pick ? 'text-bad' : 'text-ink-3')}>{i}</span>
          </div>
        ))}
      </div>
      {showPick && <div className="mt-3 animate-rise font-mono text-[12.5px] text-ink-2">{s.randPick(before.length, st!.pick!)} → {st!.victim}</div>}
      <Note>{s.randNote}</Note>
    </div>
  );
}

/** Unwraps a sequence of frame positions into ever-increasing angles, starting after `from`. */
function forwardAngles(from: number, slots: number[], frames: number): number[] {
  const out: number[] = [];
  let a = from;
  for (const sl of slots) {
    const target = (sl * 360) / frames;
    const delta = (((target - a) % 360) + 360) % 360;
    a += delta;
    out.push(a);
  }
  return out;
}

function Ring({ run, index, frames, clockBits, circular, hover, setHover }: ViewProps) {
  const s = useStrings(S);
  const st = index > 0 ? run.steps[index - 1] : undefined;
  const slots = st?.slots ?? run.initial.slots;
  // Remembers the last angle so the hand always turns forward; keyed so a
  // repeated render of the same step returns the same keyframes.
  const cache = useRef<{ run: PrRun | null; key: string; angles: number[] }>({ run: null, key: '', angles: [0] });

  const keyframes = useMemo(() => {
    const key = `${index}|${frames}|${circular}`;
    if (cache.current.run === run && cache.current.key === key) return cache.current.angles;
    const from = cache.current.angles[cache.current.angles.length - 1];
    let path: number[] = [];
    if (st?.scan) path = circular ? [...st.scan.map((l) => l.slot), st.hand] : st.scan.map((l) => l.slot);
    else if (st && circular) path = [st.hand];
    else if (!st) path = [0];
    const angles = path.length ? forwardAngles(from, path, frames) : [from];
    cache.current = { run, key, angles };
    return angles;
  }, [index, run, frames, circular, st]);

  const size = 232;
  const R = 84;
  const pos = (i: number) => {
    const th = ((-90 + (i * 360) / frames) * Math.PI) / 180;
    return { left: size / 2 + R * Math.cos(th), top: size / 2 + R * Math.sin(th) };
  };
  const victimSlot = st?.scan?.find((l) => l.victim)?.slot;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <div className="absolute rounded-full border border-dashed border-line-strong" style={{ inset: size / 2 - R }} />
        <motion.div
          className="absolute left-1/2 top-1/2 h-[64px] w-[3px] origin-bottom rounded-full bg-accent"
          style={{ marginLeft: -1.5, marginTop: -64 }}
          animate={{ rotate: keyframes }}
          transition={{ duration: Math.min(0.9, 0.22 * keyframes.length), ease: 'easeInOut' }}
        />
        <div className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" />
        {slots.map((p, i) => {
          const { left, top } = pos(i);
          const placed = st && st.slot === i;
          const ref = p !== null && st ? st.ref[p] : undefined;
          return (
            <div
              key={i}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left, top }}
              onMouseEnter={() => p !== null && setHover(p)}
              onMouseLeave={() => setHover(null)}
            >
              <div
                className={clsx(
                  'grid h-12 w-12 place-items-center rounded-2xl border font-mono transition-colors duration-300',
                  p === null && 'border-dashed border-line-strong bg-surface text-ink-3',
                  p !== null && !placed && 'border-line-strong bg-surface text-ink',
                  placed && (st!.hit ? 'border-transparent bg-ok-soft text-ok' : 'border-transparent bg-bad-soft text-bad'),
                  hover !== null && p === hover && 'ring-2 ring-ink/70',
                )}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={p ?? 'x'}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={spring}
                    className="text-[16px] font-semibold leading-none"
                  >
                    {p ?? '·'}
                  </motion.span>
                </AnimatePresence>
                {clockBits > 0 && p !== null && (
                  <span className="-mt-2 flex gap-0.5">
                    {Array.from({ length: clockBits }, (_, b) => (
                      <motion.span
                        key={b}
                        initial={false}
                        animate={{ scale: (ref ?? 0) > b ? 1 : 0.75 }}
                        className={clsx('size-1.5 rounded-full transition-colors duration-300', (ref ?? 0) > b ? 'bg-accent' : 'bg-line-strong')}
                      />
                    ))}
                  </span>
                )}
              </div>
              <div className={clsx('mt-0.5 text-center font-mono text-[9.5px]', victimSlot === i ? 'text-bad' : 'text-ink-3')}>
                {s.frame} {i}
              </div>
            </div>
          );
        })}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">{s.scanLog}</div>
        {st?.scan ? (
          <ol className="space-y-1">
            {st.scan.map((l, i) => (
              <motion.li
                key={`${index}:${i}`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(0.9, 0.22 * (i + 1)) }}
                onMouseEnter={() => setHover(l.page)}
                onMouseLeave={() => setHover(null)}
                className={clsx('flex flex-wrap justify-between gap-x-3 rounded-md px-2 py-1 font-mono text-[12px]', l.victim ? 'bg-bad-soft text-bad' : 'bg-sunken text-ink-2', hover === l.page && 'ring-1 ring-ink-3')}
              >
                <span>{s.look(l.slot, l.page)}</span>
                <span>{l.victim ? s.refZero : s.refDown(l.ref)}</span>
              </motion.li>
            ))}
          </ol>
        ) : (
          <div className="font-mono text-[12px] text-ink-3">—</div>
        )}
        <Note>
          {s.ringNote} {!circular && s.ringNoteOstep}
        </Note>
      </div>
    </div>
  );
}
