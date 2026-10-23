import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import {
  ADDR,
  GUEST_HANDLERS,
  hex,
  type Belief,
  type MachineState,
  type Mode,
  type Priv,
  type Scenario,
  type Step,
  type VmmView,
  type Xlate,
} from '../../sim/virtualization';
import type { Str } from './strings';

export const spring = { type: 'spring', stiffness: 460, damping: 34 } as const;

const stripe: Record<string, string> = { app: 'bg-c1', guest: 'bg-c2', os: 'bg-c2', vmm: 'bg-c3', hw: 'bg-c4' };

export interface Hover {
  layer?: string;
  phase?: number;
}

/* ---------------- the layered machine ---------------- */

export function Stack<L extends string>({
  layers,
  labels,
  state,
  step,
  multiVm,
  vms,
  privFor,
  beliefFor,
  tokenId,
  hot,
  onHover,
  onPick,
  s,
  trapCount,
  compact,
}: {
  layers: L[];
  labels: Record<L, string>;
  state: MachineState<L>;
  step?: Step<L>;
  multiVm?: boolean;
  vms?: VmmView['vms'];
  privFor: (l: L) => Priv | null;
  beliefFor: (l: L) => Belief | null;
  tokenId: string;
  hot: (l: L) => boolean;
  onHover: (l: L | null) => void;
  onPick: (l: L, vm: 1 | 2) => void;
  s: Str;
  trapCount?: { layer: L; value: number; label: string };
  compact?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {layers.map((l) => {
        const split = !!multiVm && (l === 'app' || l === 'guest');
        const cells: (1 | 2)[] = split ? [1, 2] : [state.vm];
        return (
          <div key={l} className={clsx('grid gap-1.5', split && 'grid-cols-2')}>
            {cells.map((vm) => {
              const active = state.actor === l && (!split || state.vm === vm);
              const vmState = split ? vms?.find((v) => v.id === vm)?.state : undefined;
              const priv = privFor(l);
              const belief = beliefFor(l);
              const fooled = belief === 'kernel' && priv === 'user';
              return (
                <motion.button
                  key={split ? `${l}${vm}` : l}
                  type="button"
                  layout
                  transition={spring}
                  onClick={() => onPick(l, vm)}
                  onMouseEnter={() => onHover(l)}
                  onMouseLeave={() => onHover(null)}
                  className={clsx(
                    'relative flex w-full min-w-0 items-center gap-2.5 rounded-xl border text-left transition-colors duration-300',
                    compact ? 'min-h-12 px-2.5 py-1.5' : 'min-h-[60px] px-3 py-2',
                    active ? 'border-accent bg-accent-soft' : hot(l) ? 'border-line-strong bg-chip' : 'border-line bg-sunken hover:border-line-strong',
                    vmState === 'saved' && !active && 'opacity-60',
                  )}
                >
                  <span className={clsx('w-1 shrink-0 self-stretch rounded-full', stripe[l])} />
                  <span className="min-w-0 flex-1">
                    <span className={clsx('block truncate font-medium text-ink', compact ? 'text-[12.5px]' : 'text-[13px]')}>
                      {labels[l]}
                      {split && <span className="font-mono text-[11px] text-ink-3"> · VM {vm}</span>}
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {priv && (
                        <Chip tone={priv === 'kernel' || priv === 'root' ? 'strong' : 'plain'}>
                          {s.runsIn}: {s.priv[priv]}
                        </Chip>
                      )}
                      {belief && belief !== 'user' && (
                        <Chip tone={fooled ? 'warn' : belief === 'aware' ? 'ok' : 'info'}>
                          {s.thinks}: {s.belief[belief]}
                        </Chip>
                      )}
                      {vmState && vmState !== 'run' && <Chip tone="plain">{s.vmState[vmState]}</Chip>}
                      {trapCount && trapCount.layer === l && trapCount.value > 0 && (
                        <span key={trapCount.value} className="animate-pop rounded-md bg-warn-soft px-1.5 py-px font-mono text-[10.5px] text-warn">
                          {trapCount.value} {trapCount.value === 1 ? singular(trapCount.label) : trapCount.label}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="relative flex h-6 shrink-0 items-center justify-end gap-1.5">
                    <AnimatePresence>
                      {active && step?.via && !compact && (
                        <motion.span
                          key={step.n}
                          initial={{ opacity: 0, x: 8 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.22 }}
                          className="hidden whitespace-nowrap rounded-full bg-surface px-1.5 py-px font-mono text-[10.5px] text-accent ring-1 ring-accent/30 sm:inline"
                        >
                          {s.via[step.via]}
                        </motion.span>
                      )}
                    </AnimatePresence>
                    <span className="grid size-5 place-items-center">
                      {active && <motion.span layoutId={tokenId} transition={spring} className="block size-3.5 rounded-full bg-accent shadow-sm ring-4 ring-accent/25" />}
                    </span>
                  </span>
                </motion.button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function Chip({ tone, children }: { tone: 'plain' | 'strong' | 'warn' | 'ok' | 'info'; children: React.ReactNode }) {
  return (
    <span
      className={clsx(
        'whitespace-nowrap rounded-md px-1.5 py-px font-mono text-[10.5px] transition-colors duration-300',
        tone === 'plain' && 'bg-surface text-ink-3 ring-1 ring-line',
        tone === 'strong' && 'bg-surface text-ink ring-1 ring-line-strong',
        tone === 'warn' && 'bg-warn-soft text-warn',
        tone === 'ok' && 'bg-ok-soft text-ok',
        tone === 'info' && 'bg-info-soft text-info',
      )}
    >
      {children}
    </span>
  );
}

/* ---------------- believes vs. really ---------------- */

type Verdict = keyof Str['verdict'];

export function verdictOf(st: MachineState<string>): Verdict {
  if (st.actor === 'vmm') return 'vmm';
  if (st.actor === 'hw') return 'hw';
  if (st.actor === 'app') return 'match';
  if (st.believes === 'aware') return 'aware';
  if (st.real === 'nonroot-kernel') return 'nonroot';
  return st.real === 'user' ? 'fooled' : 'match';
}

export function Contrast({ state, s }: { state: MachineState<string>; s: Str }) {
  const v = verdictOf(state);
  const guestRuns = state.actor === 'app' || state.actor === 'guest';
  const believed = guestRuns && state.believes ? s.belief[state.believes] : s.frozen;
  const real = s.priv[state.real];
  const tone = { fooled: 'warn', nonroot: 'info', aware: 'ok', match: 'ok', vmm: 'neutral', hw: 'neutral' }[v];
  const toneText = { warn: 'text-warn', info: 'text-info', ok: 'text-ok', neutral: 'text-ink' }[tone]!;
  const toneSoft = { warn: 'bg-warn-soft text-warn', info: 'bg-info-soft text-info', ok: 'bg-ok-soft text-ok', neutral: 'bg-chip text-ink-2' }[tone]!;
  const same = v === 'match';
  return (
    <div className="mt-4 rounded-2xl border border-line p-3.5 sm:p-4">
      <div className="font-mono text-[11px] font-medium uppercase tracking-[0.07em] text-ink-3">{s.contrastTitle}</div>
      <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3">
        <Big label={s.believes} value={believed} className={guestRuns ? 'text-accent' : 'text-ink-3'} small={!guestRuns} />
        <span className={clsx('grid size-9 place-items-center rounded-full font-serif text-[20px] transition-colors duration-300', toneSoft)}>
          {v === 'vmm' || v === 'hw' ? '·' : same ? '=' : '≠'}
        </span>
        <Big label={s.really} value={real} className={toneText} />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={v}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          className="mt-2.5 text-[13px] leading-snug text-ink-2"
        >
          {s.verdict[v]}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

function Big({ label, value, className, small }: { label: string; value: string; className?: string; small?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl bg-sunken px-3 py-2.5">
      <div className="text-[11.5px] leading-tight text-ink-3">{label}</div>
      <div className="relative mt-1 min-h-[28px]">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={value}
            initial={{ y: 14, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -14, opacity: 0 }}
            transition={spring}
            className={clsx('font-serif leading-[1.15] tracking-[-0.01em] transition-colors duration-300', small ? 'text-[14px]' : 'text-[19px] sm:text-[24px]', className)}
          >
            {value}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---------------- protocol table ---------------- */

export function Protocol<L extends string>({
  steps,
  layers,
  labels,
  index,
  s,
  hot,
  onHover,
  onJump,
  minW,
}: {
  steps: Step<L>[];
  layers: L[];
  labels: Record<L, string>;
  /** 1-based index of the step being shown (0 = none yet). */
  index: number;
  s: Str;
  hot: (st: Step<L>) => boolean;
  onHover: (st: Step<L> | null) => void;
  onJump: (n: number) => void;
  minW: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className={clsx('w-full table-fixed text-[12.5px]', minW)}>
        <thead>
          <tr className="text-left font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
            <th className="w-9 border-b border-line px-2 py-2 font-medium">{s.step}</th>
            {layers.map((l) => (
              <th key={l} className="border-b border-line px-2.5 py-2 font-medium">
                <span className="flex items-center gap-1.5">
                  <span className={clsx('size-2 rounded-full', stripe[l])} />
                  {labels[l]}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {steps.map((st) => {
            const now = st.n === index;
            const done = st.n < index;
            return (
              <tr
                key={st.n}
                onClick={() => onJump(st.n)}
                onMouseEnter={() => onHover(st)}
                onMouseLeave={() => onHover(null)}
                className={clsx(
                  'cursor-pointer border-b border-line align-top transition-colors duration-200 last:border-b-0',
                  now ? 'bg-accent-soft' : hot(st) ? 'bg-chip' : 'hover:bg-chip',
                  !now && !done && 'text-ink-3',
                )}
              >
                <td className="px-2 py-2 font-mono text-[11px] text-ink-3">
                  <button type="button" className="hover:text-accent" onClick={() => onJump(st.n)} aria-label={`${s.step}${st.n}`}>
                    {st.n}
                  </button>
                </td>
                {layers.map((l) => (
                  <td key={l} className="px-2.5 py-2 leading-snug">
                    {st.actor === l && (
                      <>
                        {st.via && (
                          <span className={clsx('mb-1 mr-1 inline-block rounded px-1 font-mono text-[10px]', now || done ? 'bg-surface text-accent ring-1 ring-accent/25' : 'bg-sunken')}>
                            {s.via[st.via]}
                          </span>
                        )}
                        {st.emu && <span className="mb-1 mr-1 inline-block rounded bg-info-soft px-1 font-mono text-[10px] text-info">{s.emu}</span>}
                        <span className={clsx(now || done ? 'text-ink' : 'text-ink-3')}>{s.msg[st.msg]}</span>
                      </>
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- VMM knowledge ---------------- */

function Row({ label, hot, children }: { label: string; hot?: boolean; children: React.ReactNode }) {
  return (
    <div className={clsx('flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg px-3 py-2 transition-colors duration-300', hot ? 'bg-warn-soft' : 'bg-transparent')}>
      <span className="text-[12.5px] text-ink-2">{label}</span>
      <span className="min-w-0 text-right font-mono text-[12.5px] text-ink">{children}</span>
    </div>
  );
}

function Swap({ k, children, className }: { k: string; children: React.ReactNode; className?: string }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span key={k} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={spring} className={clsx('inline-block', className)}>
        {children}
      </motion.span>
    </AnimatePresence>
  );
}

export function VmmPanel({ view, scenario, multiVm, s }: { view: VmmView; scenario: Scenario; mode: Mode; multiVm: boolean; s: Str }) {
  const known = view.guestTable !== 'none';
  return (
    <div className="space-y-0.5">
      <Row label={s.hwTable} hot={view.used === 'hwTable'}>
        <Swap k={view.hwTable}>{s.hwTableV[view.hwTable]}</Swap>
      </Row>
      <Row label={s.guestTable} hot={view.used === 'guestTable'}>
        <Swap k={view.guestTable}>{s.guestTableV[view.guestTable]}</Swap>
      </Row>
      <AnimatePresence initial={false}>
        {known && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="mx-3 mb-1 flex flex-wrap gap-1.5">
              {GUEST_HANDLERS.map((h, i) => (
                <motion.span
                  key={h.trap}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ ...spring, delay: i * 0.05 }}
                  className={clsx(
                    'rounded-md px-1.5 py-0.5 font-mono text-[11px] transition-colors duration-300',
                    view.used === 'guestTable' && (scenario === 'boot' || h.trap === 'syscall') ? 'bg-warn-soft text-warn' : 'bg-sunken text-ink-2',
                  )}
                >
                  {s.handlers[h.trap]} → {hex(h.addr)}
                </motion.span>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <Row label={s.vMode}>
        <Swap k={view.vMode} className={view.vMode === 'kernel' ? 'text-accent' : ''}>
          {s.belief[view.vMode]}
        </Swap>
      </Row>
      {scenario === 'cli' && (
        <>
          <Row label={s.vIF} hot={view.used === 'vIF'}>
            <Swap k={String(view.vIF)} className={view.vIF ? 'text-ok' : 'text-bad'}>
              {view.vIF ? s.on : s.off}
            </Swap>
          </Row>
          <Row label={s.realIF}>
            <span className="text-ok">{s.on}</span>
          </Row>
        </>
      )}
      {multiVm && (
        <Row label={s.vms} hot={view.used === 'vms'}>
          <span className="flex flex-wrap justify-end gap-1.5">
            {view.vms.map((v) => (
              <motion.span
                key={v.id}
                layout
                transition={spring}
                className={clsx(
                  'rounded-md px-1.5 py-0.5 text-[11px] transition-colors duration-300',
                  v.state === 'run' ? 'bg-accent-soft text-accent' : v.state === 'saved' ? 'bg-chip text-ink-2' : 'bg-sunken text-ink-3',
                )}
              >
                VM {v.id}: {s.vmState[v.state]}
              </motion.span>
            ))}
          </span>
        </Row>
      )}
    </div>
  );
}

/* ---------------- address translation ---------------- */

export function XlatePanel({ x, nx, scenario, mode, s }: { x: Xlate; nx: Xlate | null; scenario: Scenario; mode: Mode; s: Str }) {
  const vpn = hex(ADDR.vpn);
  const box = (lit: boolean, label: string, value: string, sub?: string, struck?: boolean) => (
    <motion.div
      animate={{ scale: lit ? 1 : 0.97 }}
      transition={spring}
      className={clsx(
        'min-w-0 rounded-xl border px-2.5 py-2 text-center transition-colors duration-300',
        lit ? 'border-accent/40 bg-accent-soft' : 'border-line bg-sunken',
        struck && 'opacity-45',
      )}
    >
      <div className="truncate text-[10.5px] uppercase tracking-[0.05em] text-ink-3">{label}</div>
      <div className={clsx('font-mono text-[14px]', lit ? 'text-accent' : 'text-ink-3', struck && 'line-through')}>{value}</div>
      {sub && <div className="truncate font-mono text-[10.5px] text-ink-3">{sub}</div>}
    </motion.div>
  );
  const arrow = (lit: boolean) => (
    <div className="flex min-w-0 flex-col items-center px-0.5">
      <span className={clsx('font-mono text-[16px] transition-colors duration-300', lit ? 'text-accent' : 'text-ink-3')}>→</span>
    </div>
  );
  const hop2Label = x.direct ? s.direct : x.nested ? s.hop2Nested : s.hop2;
  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
        {box(true, s.vaL, hex(ADDR.va), `VPN ${vpn}`)}
        {arrow(x.hop >= 1 || x.direct)}
        {box(x.hop >= 1 && !x.direct, s.pfnL, hex(ADDR.pfn * 0x1000 + ADDR.offset), `PFN ${hex(ADDR.pfn)}`, x.direct)}
        {arrow(x.hop >= 2)}
        {box(x.hop >= 2, s.mfnL, hex(ADDR.mfn * 0x1000 + ADDR.offset), `MFN ${hex(ADDR.mfn)}`)}
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-2 text-[11px] text-ink-3">
        <span className="text-center">① {s.hop1}</span>
        <span className="text-center">② {hop2Label}</span>
      </div>
      <div className="mt-3 space-y-0.5">
        <Row label={s.tlbRow} hot={!!x.tlb}>
          <Swap k={x.tlb ? 'f' : 'e'} className={x.tlb ? 'text-ok' : 'text-ink-3'}>
            {x.tlb ? `VPN ${vpn} → ${x.tlb.kind.toUpperCase()} ${hex(x.tlb.frame)}` : s.tlbEmpty(vpn)}
          </Swap>
        </Row>
        {scenario === 'shadow' && mode === 'te' && (
          <Row label={s.shadowRow} hot={x.shadow === 'filled'}>
            <Swap k={x.shadow} className={x.shadow === 'filled' ? 'text-ok' : 'text-bad'}>
              {x.shadow === 'filled' ? `VPN ${vpn} → MFN ${hex(ADDR.mfn)}` : s.shadowMissing(vpn)}
            </Swap>
          </Row>
        )}
        {nx && (
          <Row label={`${s.bare} · ${s.tlbRow}`}>
            <Swap k={nx.tlb ? 'f' : 'e'} className={nx.tlb ? 'text-ink' : 'text-ink-3'}>
              {nx.tlb ? `VPN ${vpn} → PFN ${hex(nx.tlb.frame)} (${s.paL.toLowerCase()})` : s.tlbEmpty(vpn)}
            </Swap>
          </Row>
        )}
      </div>
    </div>
  );
}

/** "traps" → "trap", "entradas" → "entrada", "entries" → "entry". */
function singular(word: string): string {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  return word.endsWith('s') ? word.slice(0, -1) : word;
}
