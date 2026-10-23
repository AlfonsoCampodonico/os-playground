import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { Badge, type Tone } from '../../components/kit';
import { REGS, SYSCALLS, TRAP_BASE, TRAP_TABLE, hex, type Mode, type Pid, type Proc, type RegName, type Snapshot, type Step } from '../../sim/syscalls';
import type { Strings } from './strings';

export const spring = { type: 'spring', stiffness: 520, damping: 36 } as const;

export interface Hover {
  from: 'row' | 'op' | 'proc' | 'table' | 'reg';
  op?: number | null;
  pid?: Pid | null;
  vector?: number;
  sysno?: number;
  reg?: RegName;
}

export const PID_DOT: Record<Pid, string> = { A: 'bg-c3', B: 'bg-c4' };
export const PID_TEXT: Record<Pid, string> = { A: 'text-c3', B: 'text-c4' };

export function PidTag({ pid }: { pid: Pid }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 font-mono text-[11px] font-semibold', PID_TEXT[pid])}>
      <span className={clsx('size-2 rounded-full', PID_DOT[pid])} />
      {pid}
    </span>
  );
}

/* ---------- Mode bit ---------- */

export function ModeBit({ mode, s }: { mode: Mode; s: Strings }) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.07em] text-ink-3">{s.modeBit}</div>
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-sunken p-1">
        {(['user', 'kernel'] as const).map((m) => {
          const on = mode === m;
          return (
            <div key={m} className="relative grid h-14 place-items-center rounded-xl">
              {on && <motion.div layoutId="sc-mode-knob" transition={spring} className={clsx('absolute inset-0 rounded-xl shadow-sm transition-colors duration-300', m === 'user' ? 'bg-info' : 'bg-accent')} />}
              <span className={clsx('relative flex flex-col items-center font-mono leading-tight transition-colors duration-200', on ? 'text-accent-ink' : 'text-ink-3')}>
                <span className="text-[14px] font-semibold uppercase tracking-[0.08em]">{m === 'user' ? s.user : s.kernel}</span>
                <span className="text-[10.5px] opacity-80">CPL {m === 'user' ? 3 : 0}</span>
              </span>
            </div>
          );
        })}
      </div>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={mode} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1.5 text-[12px] text-ink-3">
          {s.cpl(mode)}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ---------- Registers ---------- */

export function Registers({ snap, prev, s, hover, setHover }: { snap: Snapshot; prev: Snapshot; s: Strings; hover: Hover | null; setHover: (h: Hover | null) => void }) {
  const { cpu } = snap;
  const sysName = SYSCALLS.find((x) => x.no === cpu.regs.eax)?.sys;
  const sub: Record<RegName, string> = {
    eip: `${cpu.mode === 'user' && cpu.pid ? s.codeOf(cpu.pid) : s.kernelCode} · ${cpu.sym}`,
    esp: cpu.stack === 'boot' || !cpu.pid ? s.stackOf.boot : s.stackOf[cpu.stack](cpu.pid),
    eax: cpu.eaxNote === 'sysno' ? `${s.sysno}: SYS_${sysName ?? '?'}` : cpu.eaxNote === 'ret' ? s.retval : '—',
    ebx: s.counter,
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      {REGS.map((r) => {
        const v = cpu.regs[r];
        const changed = prev.cpu.regs[r] !== v;
        const big = r === 'eip' || r === 'esp';
        const hot = hover?.reg === r;
        return (
          <div
            key={r}
            onMouseEnter={() => setHover({ from: 'reg', reg: r })}
            onMouseLeave={() => setHover(null)}
            className={clsx(
              'min-w-0 rounded-xl border px-3 py-2 transition-colors duration-300',
              changed ? 'border-accent/30 bg-accent-soft' : 'border-line bg-sunken',
              hot && 'ring-2 ring-ink-3/40',
            )}
          >
            <div className="flex items-baseline justify-between gap-2 font-mono text-[11px] text-ink-3">
              <span className="font-semibold text-ink-2">%{r}</span>
            </div>
            <div className="relative h-6 overflow-hidden font-mono text-[15px] tabular-nums text-ink">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div key={v} initial={{ y: -14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 14, opacity: 0 }} transition={spring}>
                  {big ? hex(v, 4) : v}
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="truncate font-mono text-[11px] text-ink-3" title={sub[r]}>
              {sub[r]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function CpuExtras({ snap, s, T }: { snap: Snapshot; s: Strings; T: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-[11.5px] text-ink-3">
      <span className={clsx('rounded-full px-2 py-0.5 transition-colors', snap.cpu.idtr ? 'bg-chip text-ink-2' : 'bg-warn-soft text-warn')}>
        IDTR · {s.idtr} {snap.cpu.idtr ? hex(TRAP_BASE) : s.notLoaded}
      </span>
      {snap.timerOn ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-chip px-2 py-0.5 text-ink-2">
          {s.timerLeft(snap.timerLeft)}
          <span className="flex gap-0.5">
            {Array.from({ length: T }, (_, i) => (
              <span key={i} className={clsx('h-2 w-1.5 rounded-sm transition-colors duration-300', i < snap.timerLeft ? 'bg-warn' : 'bg-line-strong')} />
            ))}
          </span>
        </span>
      ) : (
        <span className="rounded-full bg-chip px-2 py-0.5">{s.timerOff}</span>
      )}
    </div>
  );
}

/* ---------- Processes ---------- */

const stateTone: Record<Proc['state'], Tone> = { none: 'neutral', ready: 'info', running: 'ok', blocked: 'warn', done: 'neutral', killed: 'bad' };

export function ProcCard({
  proc,
  snap,
  step,
  s,
  hover,
  setHover,
  onJump,
}: {
  proc: Proc;
  snap: Snapshot;
  step: Step | undefined;
  s: Strings;
  hover: Hover | null;
  setHover: (h: Hover | null) => void;
  onJump: () => void;
}) {
  const p = proc.pid;
  const alive = proc.state !== 'none' && proc.state !== 'done' && proc.state !== 'killed';
  const onUser = snap.cpu.pid === p && snap.cpu.stack === 'user';
  const onKernel = snap.cpu.pid === p && snap.cpu.stack === 'kernel';
  const fx = step?.fx ?? {};
  const hot = hover?.pid === p;
  const uFrames = p === 'A' ? ['argc, argv', 'main()'] : ['loop()'];
  return (
    <div
      onMouseEnter={() => setHover({ from: 'proc', pid: p })}
      onMouseLeave={() => setHover(null)}
      className={clsx('rounded-xl border p-3 transition-colors duration-200', hot ? 'border-line-strong bg-sunken/60' : 'border-line', !alive && proc.state !== 'none' && 'opacity-70')}
    >
      <button type="button" onClick={onJump} className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-left">
        <span className={clsx('size-2.5 rounded-full', PID_DOT[p])} />
        <span className="text-[13.5px] font-medium text-ink">{s.proc(p)}</span>
        <span className="font-mono text-[11px] text-ink-3">{s.pid(p)}</span>
        {p === 'B' && <span className="text-[11.5px] text-ink-3">· {s.procB}</span>}
        <span className="ml-auto">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={proc.state} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} transition={spring} className="inline-block">
              <Badge tone={stateTone[proc.state]}>{s.state[proc.state]}</Badge>
            </motion.span>
          </AnimatePresence>
        </span>
      </button>

      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <StackBox title={s.uStack} active={onUser} tone="info" sp={s.sp}>
          {alive ? (
            uFrames.map((f) => (
              <div key={f} className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
                {f}
              </div>
            ))
          ) : (
            <Empty>{s.empty}</Empty>
          )}
        </StackBox>
        <StackBox title={s.kStack} active={onKernel} tone="accent" sp={s.sp}>
          <AnimatePresence initial={false} mode="popLayout">
            {proc.frame ? (
              <motion.div
                key="frame"
                layout
                initial={{ opacity: 0, y: -14, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -14, scale: 0.94 }}
                transition={spring}
                className={clsx('rounded-lg border bg-surface p-1 transition-shadow', fx.push === p ? 'border-warn/50 ring-2 ring-warn/40' : 'border-accent/30')}
              >
                <div className="px-1 pb-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-accent">{s.trapFrame}</div>
                {REGS.map((r, i) => {
                  const ret = r === 'eax' && fx.ret === p;
                  return (
                    <motion.div
                      key={r}
                      initial={fx.push === p ? { opacity: 0, x: -8 } : false}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ ...spring, delay: fx.push === p ? i * 0.05 : 0 }}
                      className={clsx(
                        'flex justify-between gap-1 rounded px-1 font-mono text-[11px] transition-colors duration-300',
                        ret ? 'bg-ok-soft text-ok' : 'text-ink-2',
                        hover?.reg === r && 'bg-chip text-ink',
                      )}
                    >
                      <span>%{r}</span>
                      <span className="truncate tabular-nums">{r === 'eip' || r === 'esp' ? hex(proc.frame![r]) : proc.frame![r]}</span>
                    </motion.div>
                  );
                })}
              </motion.div>
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Empty>{s.empty}</Empty>
              </motion.div>
            )}
          </AnimatePresence>
        </StackBox>
      </div>

      <div
        className={clsx(
          'mt-2 rounded-lg border px-2 py-1.5 transition-colors duration-300',
          fx.save === p ? 'border-accent/40 bg-accent-soft' : fx.restore === p ? 'border-ok/40 bg-ok-soft' : 'border-dashed border-line',
        )}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
          <span>{s.context(p)}</span>
          <span className="normal-case tracking-normal">{s.ctxHint}</span>
        </div>
        <div className="mt-0.5 min-h-5">
          <AnimatePresence mode="popLayout" initial={false}>
            {proc.ctx ? (
              <motion.div key="ctx" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={spring} className="flex flex-wrap gap-x-3 font-mono text-[11.5px] text-ink">
                <span>
                  <span className="text-ink-3">%eip</span> {hex(proc.ctx.eip)}
                </span>
                <span>
                  <span className="text-ink-3">%esp</span> {hex(proc.ctx.esp)}
                </span>
              </motion.div>
            ) : (
              <motion.div key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="font-mono text-[11.5px] text-ink-3">
                —
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function StackBox({ title, active, tone, sp, children }: { title: string; active: boolean; tone: 'info' | 'accent'; sp: string; children: ReactNode }) {
  return (
    <div
      className={clsx(
        'relative min-w-0 rounded-lg border p-1.5 transition-all duration-300',
        active ? (tone === 'info' ? 'border-info/50 bg-info-soft ring-2 ring-info/30' : 'border-accent/50 bg-accent-soft ring-2 ring-accent/30') : 'border-line bg-sunken',
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-1 px-0.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
        <span className="truncate">{title}</span>
        <AnimatePresence>
          {active && (
            <motion.span
              layoutId="sc-sp"
              transition={spring}
              className={clsx('shrink-0 rounded px-1 normal-case tracking-normal', tone === 'info' ? 'bg-info text-accent-ink' : 'bg-accent text-accent-ink')}
            >
              {sp}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="px-1 py-0.5 font-mono text-[11px] text-ink-3">{children}</div>;
}

/* ---------- Trap table & syscall table ---------- */

const vecTone: Record<number, string> = { 13: 'bg-bad-soft', 32: 'bg-warn-soft', 46: 'bg-warn-soft', 64: 'bg-accent-soft' };

export function TrapTable({
  snap,
  step,
  s,
  hover,
  setHover,
  jumpVector,
  jumpSys,
}: {
  snap: Snapshot;
  step: Step | undefined;
  s: Strings;
  hover: Hover | null;
  setHover: (h: Hover | null) => void;
  jumpVector: (v: number) => void;
  jumpSys: (n: number) => void;
}) {
  const used = step && (step.kind === 'hw-trap' || step.kind === 'hw-irq' || step.kind === 'hw-fault') ? step.vector : undefined;
  const lookingUp = step && ['user-syscall', 'hw-trap', 'os-syscall', 'os-read-block', 'os-exit'].includes(step.kind) ? step.sysno : undefined;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-[12px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
              <th className="border-b border-line px-4 py-2 font-medium">#</th>
              <th className="border-b border-line px-2 py-2 font-medium">{s.colEvent}</th>
              <th className="border-b border-line px-4 py-2 font-medium">{s.colHandler}</th>
            </tr>
          </thead>
          <tbody>
            {TRAP_TABLE.map((e, i) => {
              const now = used === e.vector;
              const hot = hover?.vector === e.vector;
              return (
                <tr
                  key={e.vector}
                  onMouseEnter={() => setHover({ from: 'table', vector: e.vector })}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => jumpVector(e.vector)}
                  className={clsx('cursor-pointer border-b border-line transition-colors duration-300 last:border-b-0', now ? vecTone[e.vector] : hot ? 'bg-chip' : 'hover:bg-chip/60')}
                >
                  <td className="px-4 py-2 text-ink">{e.vector}</td>
                  <td className="px-2 py-2 font-sans text-[12px] text-ink-2">{s.events[e.event]}</td>
                  <td className="px-4 py-2">
                    <AnimatePresence mode="popLayout" initial={false}>
                      {snap.trapTable ? (
                        <motion.span key="h" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring, delay: i * 0.06 }} className="flex flex-col">
                          <span className="text-ink">{e.handler}</span>
                          <span className="text-[10.5px] text-ink-3">{hex(e.addr)}</span>
                        </motion.span>
                      ) : (
                        <motion.span key="x" exit={{ opacity: 0 }} className="text-ink-3">
                          —
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line px-4 py-3">
        <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">{s.sysTable}</div>
        <div className="flex flex-wrap gap-1.5">
          {SYSCALLS.map((c) => {
            const now = lookingUp === c.no;
            const hot = hover?.sysno === c.no;
            return (
              <button
                key={c.no}
                type="button"
                onClick={() => jumpSys(c.no)}
                onMouseEnter={() => setHover({ from: 'table', sysno: c.no })}
                onMouseLeave={() => setHover(null)}
                className={clsx(
                  'rounded-lg border px-2 py-1 font-mono text-[11.5px] transition-all duration-300',
                  now ? 'border-accent/40 bg-accent-soft text-ink ring-2 ring-accent/30' : hot ? 'border-line-strong bg-chip text-ink' : 'border-line text-ink-2 hover:bg-chip',
                )}
              >
                <span className="text-ink-3">{c.no}</span> {c.fn}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function Console({ text, s, fresh }: { text: string; s: Strings; fresh: boolean }) {
  const lines = text.split('\n').filter((l, i, a) => l !== '' || i < a.length - 1);
  return (
    <div className="rounded-xl border border-line bg-sunken px-3 py-2">
      <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">{s.console}</div>
      <div className={clsx('min-h-6 font-mono text-[12.5px] text-ink transition-colors duration-500', fresh && 'text-ok')}>
        {lines.length === 0 ? (
          <span className="text-ink-3">{s.consoleEmpty}</span>
        ) : (
          <AnimatePresence initial={false}>
            {lines.map((l, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring}>
                <span className="text-ink-3">$ </span>
                {l}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
