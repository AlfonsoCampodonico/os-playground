import clsx from 'clsx';
import { Children, createContext, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useUi } from './lang';

/* ---------- Layout ---------- */

/**
 * Where `primary` fields from the setup render: the "pick a scenario" stage.
 * Null until Bench mounts, so server and first client render match.
 */
const PickSlot = createContext<HTMLElement | null>(null);
/** True inside the pick stage, so selectors render larger there. */
const InPick = createContext(false);

/** One numbered stage of the flow, joined to the next by a line like the slides' timeline. */
function Stage({ n, title, hint, last, children }: { n: number; title: ReactNode; hint?: ReactNode; last?: boolean; children: ReactNode }) {
  return (
    <section className="relative grid grid-cols-[36px_minmax(0,1fr)] gap-x-4 sm:grid-cols-[44px_minmax(0,1fr)]">
      <div className="relative flex justify-center">
        <span className="z-10 grid size-9 place-items-center rounded-full bg-accent text-[15px] font-bold text-accent-ink shadow-sm sm:size-11 sm:text-[17px]">{n}</span>
        {!last && <span aria-hidden="true" className="absolute top-11 bottom-0 w-0.5 bg-accent/30" />}
      </div>
      <div className={clsx('min-w-0', !last && 'pb-10')}>
        <h2 className="pt-1 font-serif text-[22px] leading-tight sm:pt-2 sm:text-[24px]">{title}</h2>
        {hint && <p className="mt-1 text-[14px] text-ink-2">{hint}</p>}
        <div className="mt-4 flex min-w-0 flex-col gap-4">{children}</div>
      </div>
    </section>
  );
}

/**
 * The page as a three-stage flow: ① pick a scenario, ② watch it step by step,
 * ③ understand the result. Fields marked `primary` in the setup show in stage
 * ①; the full setup stays one click away under "Advanced settings". The first
 * `watch` children are the machine and the views that move with each step
 * (stage ②); the rest (comparisons, practice) make up stage ③.
 */
export function Bench({ setup, watch = 1, children, className }: { setup: ReactNode; watch?: number; children: ReactNode; className?: string }) {
  const t = useUi();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const all = Children.toArray(children);
  const first = all.slice(0, watch);
  const rest = all.slice(watch);
  return (
    <div className={clsx('flex flex-col', className)}>
      <Stage n={1} title={t.flowPick} hint={t.flowPickHint}>
        <div ref={setSlot} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 shadow-panel empty:hidden sm:p-5" />
        <details className="group rounded-2xl border border-line bg-surface shadow-panel">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[14px] font-semibold text-ink-2 hover:text-accent [&::-webkit-details-marker]:hidden">
            <Icons.next className="size-4 text-ink-3 transition-transform group-open:rotate-90" />
            {t.advanced}
          </summary>
          <div className="border-t border-line p-3 sm:p-4 [&>section]:max-w-3xl [&>section]:border-0 [&>section]:shadow-none">
            <PickSlot.Provider value={slot}>{setup}</PickSlot.Provider>
          </div>
        </details>
      </Stage>
      <Stage n={2} title={t.flowWatch} hint={t.flowWatchHint} last={rest.length === 0}>
        {first}
      </Stage>
      {rest.length > 0 && (
        <Stage n={3} title={t.flowUnderstand} hint={t.flowUnderstandHint} last>
          {rest}
        </Stage>
      )}
    </div>
  );
}

export function Panel({
  title,
  actions,
  children,
  footer,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx('overflow-hidden rounded-2xl border border-line bg-surface shadow-panel', className)}>
      {(title || actions) && (
        <header className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-4 py-2">
          <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={clsx('p-4', bodyClassName)}>{children}</div>
      {footer && <div className="border-t border-line">{footer}</div>}
    </section>
  );
}

/* ---------- Form controls ---------- */

/**
 * A labelled setup field. `primary` fields (the mechanism, the mode, the
 * examples) are the first decision a student makes, so Bench shows them up
 * front in the "pick a scenario" stage instead of inside the advanced setup.
 */
export function Field({ label, hint, error, primary, children }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; primary?: boolean; children: ReactNode }) {
  const slot = useContext(PickSlot);
  if (primary && slot)
    return createPortal(
      <InPick.Provider value={true}>
        <div>
          <div className="mb-2 text-[14px] font-semibold text-ink">{label}</div>
          {children}
          {hint && <p className="mt-1.5 text-[12.5px] text-ink-3">{hint}</p>}
          {error && <p className="mt-1.5 text-[12.5px] text-bad animate-rise">{error}</p>}
        </div>
      </InPick.Provider>,
      slot,
    );
  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-medium text-ink-2">{label}</span>
        {hint && <span className="text-[11.5px] text-ink-3">{hint}</span>}
      </div>
      {children}
      {error && <p className="mt-1.5 text-[12px] text-bad animate-rise">{error}</p>}
    </div>
  );
}

export interface Option<T extends string | number> {
  value: T;
  label: ReactNode;
  title?: string;
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = 'md',
  ariaLabel,
}: {
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}) {
  // In the pick stage the choices are the main thing on screen: make them big.
  if (useContext(InPick)) {
    return (
      <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={on}
              title={o.title}
              onClick={() => onChange(o.value)}
              className={clsx(
                'rounded-xl border px-4 py-2.5 text-left text-[14px] font-semibold transition-all duration-150 active:scale-[0.98]',
                on ? 'border-accent bg-accent text-accent-ink shadow-sm' : 'border-line-strong bg-sunken text-ink hover:border-accent hover:text-accent',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-1 rounded-xl bg-sunken p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={clsx(
              'flex-1 whitespace-nowrap rounded-lg font-mono font-medium transition-all duration-150',
              size === 'sm' ? 'px-2 py-1 text-[11.5px]' : 'px-2.5 py-1.5 text-[12.5px]',
              on ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)] ring-1 ring-line-strong' : 'text-ink-3 hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function NumberField({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  suffix,
  ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: ReactNode;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (n: number) => onChange(Math.max(min, Math.min(max, n)));
  const btn = 'grid w-9 place-items-center text-ink-3 transition-colors hover:bg-chip hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <div className="flex h-9 items-stretch overflow-hidden rounded-lg border border-line-strong bg-sunken focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
      <button type="button" className={btn} aria-label="−" disabled={value <= min} onClick={() => commit(value - step)}>
        −
      </button>
      <input
        aria-label={ariaLabel}
        inputMode="numeric"
        className="w-full min-w-0 bg-transparent text-center font-mono text-[13px] outline-none"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={() => setDraft(String(value))}
      />
      {suffix && <span className="grid place-items-center pr-1 font-mono text-[11.5px] text-ink-3">{suffix}</span>}
      <button type="button" className={btn} aria-label="+" disabled={value >= max} onClick={() => commit(value + step)}>
        +
      </button>
    </div>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  invalid,
  multiline,
  rows = 3,
  ariaLabel,
  mono = true,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
  multiline?: boolean;
  rows?: number;
  ariaLabel?: string;
  mono?: boolean;
}) {
  const cls = clsx(
    'w-full rounded-lg border bg-sunken px-3 py-2 text-[13px] leading-relaxed outline-none transition-colors placeholder:text-ink-3 focus:ring-2',
    mono && 'font-mono',
    invalid ? 'border-bad focus:ring-bad/20' : 'border-line-strong focus:border-accent focus:ring-accent/20',
  );
  return multiline ? (
    <textarea aria-label={ariaLabel} spellCheck={false} rows={rows} className={clsx(cls, 'resize-y')} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input aria-label={ariaLabel} spellCheck={false} className={cls} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-[13px] text-ink-2">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line-strong')}
      >
        <span className={clsx('absolute top-0.5 size-4 rounded-full bg-surface shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
    </label>
  );
}

/* ---------- Buttons ---------- */

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md'; icon?: ReactNode };

export function Button({ variant = 'secondary', size = 'md', icon, className, children, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      {...rest}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-9 px-3.5 text-[13px]',
        variant === 'primary' && 'bg-accent text-accent-ink shadow-sm hover:brightness-110',
        variant === 'secondary' && 'border border-line-strong bg-surface text-ink hover:bg-chip',
        variant === 'ghost' && 'text-ink-2 hover:bg-chip hover:text-ink',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={clsx(
        'grid size-9 place-items-center rounded-lg border border-line-strong bg-surface text-ink-2 transition-all hover:bg-chip hover:text-ink active:scale-95 disabled:pointer-events-none disabled:opacity-35',
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ---------- Icons (inline, stroke) ---------- */

const icon = (d: string) =>
  function Icon({ className = 'size-4' }: { className?: string }) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={d} />
      </svg>
    );
  };

export const Icons = {
  first: icon('M18 6 9 12l9 6V6ZM6 6v12'),
  prev: icon('m15 18-6-6 6-6'),
  next: icon('m9 18 6-6-6-6'),
  last: icon('M6 6l9 6-9 6V6Zm12 0v12'),
  play: icon('M7 4.5v15l12.5-7.5L7 4.5Z'),
  pause: icon('M8 5v14M16 5v14'),
  reset: icon('M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5'),
  share: icon('M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1m2 5a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1'),
  dice: icon('M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm3.5 5h.01M15.5 8h.01M12 12h.01M8.5 16h.01m7 0h.01'),
  check: icon('M20 6 9 17l-5-5'),
  eye: icon('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'),
  book: icon('M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14Zm0 0A2.5 2.5 0 0 0 6.5 22H20v-5'),
  plus: icon('M12 5v14M5 12h14'),
  x: icon('M18 6 6 18M6 6l12 12'),
  arrow: icon('M5 12h14m-6-6 6 6-6 6'),
};

/* ---------- Data display ---------- */

export type Tone = 'neutral' | 'ok' | 'bad' | 'warn' | 'info' | 'accent';

const toneText: Record<Tone, string> = {
  neutral: 'text-ink',
  ok: 'text-ok',
  bad: 'text-bad',
  warn: 'text-warn',
  info: 'text-info',
  accent: 'text-accent',
};

export const toneChip: Record<Tone, string> = {
  neutral: 'bg-chip text-ink-2',
  ok: 'bg-ok-soft text-ok',
  bad: 'bg-bad-soft text-bad',
  warn: 'bg-warn-soft text-warn',
  info: 'bg-info-soft text-info',
  accent: 'bg-accent-soft text-accent',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11.5px] font-medium', toneChip[tone], className)}>{children}</span>;
}

/** A number that pops whenever its value changes. */
export function Stat({ label, value, tone = 'neutral', sub }: { label: ReactNode; value: ReactNode; tone?: Tone; sub?: ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3.5">
      <div className="truncate text-[13px] font-semibold text-ink-2">{label}</div>
      <div key={String(value)} className={clsx('mt-0.5 font-serif text-[32px] leading-tight tracking-[-0.02em] tabular-nums animate-pop', toneText[tone])}>
        {value}
      </div>
      {sub && <div className="text-[12px] text-ink-3">{sub}</div>}
    </div>
  );
}

export function StatGrid({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 | 5 }) {
  const c = { 2: 'grid-cols-2', 3: 'grid-cols-2 sm:grid-cols-3', 4: 'grid-cols-2 sm:grid-cols-4', 5: 'grid-cols-2 sm:grid-cols-5' }[cols];
  return <div className={clsx('grid divide-line [&>*]:border-line [&>*]:border-r [&>*]:border-b sm:[&>*]:border-b-0 [&>*:last-child]:border-r-0', c)}>{children}</div>;
}

/** The one-line "what just happened" narration under the machine. */
export function Narration({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <div
      aria-live="polite"
      className={clsx(
        'flex min-h-14 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border-l-4 px-4 py-3 text-[15px] leading-snug animate-rise',
        tone === 'neutral' ? 'border-accent bg-sunken text-ink' : clsx('border-current', toneChip[tone]),
      )}
    >
      {children}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-surface px-1 font-mono text-[10.5px] text-ink-2">{children}</kbd>;
}

/* ---------- Teaching aids ---------- */

/** Collapsible "¿Qué estoy viendo?" refresher. */
export function Explain({ children, title }: { children: ReactNode; title?: ReactNode }) {
  const t = useUi();
  return (
    <details className="group border-t border-line">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[13px] font-medium text-ink hover:text-accent [&::-webkit-details-marker]:hidden">
        <Icons.book className="size-4 text-accent" />
        {title ?? t.whatAmISeeing}
        <Icons.next className="ml-auto size-4 text-ink-3 transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-2.5 px-4 pb-4 text-[13.5px] leading-relaxed text-ink-2 [&_b]:font-medium [&_b]:text-ink [&_code]:rounded [&_code]:bg-chip [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-ink">
        {children}
      </div>
    </details>
  );
}

/** A practice question whose answer stays hidden until asked for. */
export function Reveal({ question, children }: { question: ReactNode; children: ReactNode }) {
  const t = useUi();
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-dashed border-line-strong p-3.5">
      <div className="text-[13.5px] text-ink">{question}</div>
      {open ? (
        <div className="mt-2.5 animate-rise rounded-lg bg-ok-soft px-3 py-2 text-[13px] text-ink">{children}</div>
      ) : null}
      <button type="button" className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-accent hover:underline" onClick={() => setOpen((o) => !o)}>
        <Icons.eye className="size-3.5" />
        {open ? t.hide : t.reveal}
      </button>
    </div>
  );
}

export function ShareButton({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const t = useUi();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <Button
      size={size}
      icon={copied ? <Icons.check className="size-3.5 text-ok" /> : <Icons.share className="size-3.5" />}
      onClick={async () => {
        // Give the URL writer a moment to flush the latest setup.
        await new Promise((r) => setTimeout(r, 300));
        try {
          await navigator.clipboard.writeText(window.location.href);
        } catch {
          window.prompt(t.share, window.location.href);
        }
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? t.copied : t.share}
    </Button>
  );
}

/** Unique, stable id for aria wiring. */
export const useAriaId = useId;
