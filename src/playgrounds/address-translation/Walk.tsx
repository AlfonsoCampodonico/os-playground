import clsx from 'clsx';
import { motion } from 'motion/react';
import { Fragment } from 'react';
import { hex, isPow2, type Run, type Step } from '../../sim/address-translation/index';
import type { Strings } from './strings';

type Tone = 'accent' | 'warn' | 'info' | 'neutral';
interface Group {
  label: string;
  bits: string;
  value: number;
  tone: Tone;
}

const BOX: Record<Tone, string> = {
  accent: 'bg-accent-soft text-accent',
  warn: 'bg-warn-soft text-warn',
  info: 'bg-info-soft text-info',
  neutral: 'bg-sunken text-ink-2',
};

const bin = (n: number, w: number) => n.toString(2).padStart(w, '0');

function split(n: number, width: number, parts: { label: string; w: number; tone: Tone }[]): Group[] {
  const str = bin(n, width);
  const out: Group[] = [];
  let at = 0;
  for (const p of parts) {
    const bits = str.slice(at, at + p.w);
    out.push({ label: p.label, bits, value: bits ? parseInt(bits, 2) : 0, tone: p.tone });
    at += p.w;
  }
  return out;
}

function vaGroups(run: Run, step: Step, s: Strings): Group[] {
  const w = Math.max(run.vaBits, bin(step.va, 1).length);
  if (run.lin) return split(step.va, w, [
    { label: s.vpn, w: w - run.lin.pageBits, tone: 'accent' },
    { label: s.offset, w: run.lin.pageBits, tone: 'neutral' },
  ]);
  if (run.ml)
    return split(step.va, w, [
      { label: s.pdIndex, w: run.ml.pdBits, tone: 'accent' },
      { label: s.ptIndex, w: run.ml.ptBits, tone: 'warn' },
      { label: s.offset, w: run.ml.pageBits, tone: 'neutral' },
    ]);
  if (run.seg && isPow2(run.asize))
    return split(step.va, w, [
      { label: s.segBits, w: run.seg.segBits, tone: 'accent' },
      { label: s.offset, w: w - run.seg.segBits, tone: 'neutral' },
    ]);
  return split(step.va, w, [{ label: 'VA', w, tone: 'neutral' }]);
}

function paGroups(run: Run, step: Step, s: Strings): Group[] | null {
  if (step.pa === null) return null;
  const w = Math.max(run.paBits, bin(step.pa, 1).length);
  const pageBits = run.lin?.pageBits ?? run.ml?.pageBits;
  if (pageBits !== undefined)
    return split(step.pa, w, [
      { label: s.pfn, w: w - pageBits, tone: 'info' },
      { label: s.offset, w: pageBits, tone: 'neutral' },
    ]);
  return split(step.pa, w, [{ label: 'PA', w, tone: 'info' }]);
}

/** The address as bit boxes, split the way the MMU reads it. */
export function BitSplit({ run, step, s }: { run: Run; step: Step; s: Strings }) {
  const va = vaGroups(run, step, s);
  const pa = paGroups(run, step, s);
  const row = (label: string, groups: Group[] | null, delay: number) => (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <span className="w-32 shrink-0 pt-1.5 text-[11px] uppercase tracking-[0.06em] text-ink-3">{label}</span>
      {groups ? (
        <div className="flex gap-2">
          {groups.map((g, gi) => (
            <div key={gi} className="flex flex-col items-center gap-1">
              <div className="flex gap-px">
                {[...g.bits].map((b, i) => (
                  <motion.span
                    key={i}
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: delay + (gi * 4 + i) * 0.01, type: 'spring', stiffness: 500, damping: 30 }}
                    className={clsx('grid h-7 w-4 place-items-center rounded-[4px] text-[12px] sm:w-[18px]', BOX[g.tone])}
                  >
                    {b}
                  </motion.span>
                ))}
              </div>
              <span className={clsx('whitespace-nowrap text-[10.5px]', g.tone === 'neutral' ? 'text-ink-3' : BOX[g.tone].split(' ')[1])}>
                {g.label} = {g.value}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <span className="pt-1.5 text-[12px] text-bad">{s.noPa}</span>
      )}
    </div>
  );
  return (
    <div className="mt-4 space-y-2 overflow-x-auto rounded-xl border border-line p-3 font-mono">
      {row(s.va, va, 0)}
      {row(s.pa, pa, 0.15)}
    </div>
  );
}

type ChipTone = 'neutral' | 'ok' | 'bad' | 'info';
const CHIP: Record<ChipTone, string> = {
  neutral: 'border-line bg-sunken text-ink-2',
  ok: 'border-transparent bg-ok-soft text-ok',
  bad: 'border-transparent bg-bad-soft text-bad',
  info: 'border-transparent bg-info-soft text-info',
};

function chips(run: Run, step: Step, s: Strings): { text: string; tone: ChipTone }[] {
  const ok = step.outcome === 'ok';
  const paHex = step.pa !== null ? hex(step.pa) : '';
  if (run.bb) {
    return [
      { text: `${s.flowVa} = ${hex(step.va)} (${step.va})`, tone: 'neutral' },
      { text: s.flowCmp(String(step.va), String(run.bb.limit), ok), tone: ok ? 'ok' : 'bad' },
      ...(ok ? [{ text: `${s.flowPa} = ${run.bb.base} + ${step.va} = ${step.pa} (${paHex})`, tone: 'info' as const }] : []),
    ];
  }
  if (run.seg) {
    const { segments, segBits, maxSeg } = run.seg;
    const seg = segments.find((g) => g.selector === step.seg);
    const name = seg ? s.segName[seg.kind] : s.flowNoSeg;
    const out: { text: string; tone: ChipTone }[] = [{ text: `${s.flowVa} = ${hex(step.va)} (${step.va})`, tone: 'neutral' }];
    if (isPow2(run.asize)) out.push({ text: s.flowSel(bin(step.seg!, segBits), name), tone: seg ? 'neutral' : 'bad' });
    else out.push({ text: s.flowSelHalf(step.seg === 1, name), tone: 'neutral' });
    if (!seg) return out;
    const off = step.segOffset!;
    if (seg.grows === -1) {
      out.push({ text: s.flowNeg(String(off + maxSeg), String(maxSeg), String(off)), tone: 'neutral' });
      out.push({ text: s.flowSegCmp(`|${off}|`, String(seg.size), ok, true), tone: ok ? 'ok' : 'bad' });
    } else {
      out.push({ text: s.flowSegCmp(String(off), String(seg.size), ok, false), tone: ok ? 'ok' : 'bad' });
    }
    if (ok) out.push({ text: `${s.flowSegPa(seg.grows === -1)} = ${seg.base} ${off < 0 ? '−' : '+'} ${Math.abs(off)} = ${step.pa} (${paHex})`, tone: 'info' });
    return out;
  }
  if (run.lin) {
    return [
      { text: `${s.vpn} = ${step.vpn} · ${s.offset} = ${hex(step.offset!)}`, tone: 'neutral' },
      { text: s.flowPte(step.vpn!, hex(step.pte!, 8)), tone: 'neutral' },
      { text: s.flowValid(ok, step.pfn), tone: ok ? 'ok' : 'bad' },
      ...(ok ? [{ text: `${s.flowPaPage} = ${hex(step.pa!)}`, tone: 'info' as const }] : []),
    ];
  }
  if (run.ml) {
    const d = run.ml.pteBytes * 2;
    const out: { text: string; tone: ChipTone }[] = [
      { text: s.flowPdbr(run.ml.pdbr), tone: 'neutral' },
      { text: s.flowPde(hex(step.pdeAddr!), hex(step.pde!, d), !!step.pdeValid, step.ptPage ?? 0), tone: step.pdeValid ? 'ok' : 'bad' },
    ];
    if (step.pdeValid) out.push({ text: s.flowPteMl(hex(step.pteAddr!), hex(step.pte!, d), !!step.pteValid, step.pfn ?? 0), tone: step.pteValid ? 'ok' : 'bad' });
    if (ok) out.push({ text: `PA = ${hex(step.pa!)}`, tone: 'info' }, { text: s.flowValue(hex(step.value!, 2)), tone: 'info' });
    return out;
  }
  return [];
}

/** The hardware check, as a little left-to-right flow. */
export function Flow({ run, step, s }: { run: Run; step: Step; s: Strings }) {
  const list = chips(run, step, s);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {list.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-ink-3">→</span>}
          <motion.span
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.07, type: 'spring', stiffness: 480, damping: 32 }}
            className={clsx('rounded-lg border px-2.5 py-1 font-mono text-[12px]', CHIP[c.tone])}
          >
            {c.text}
          </motion.span>
        </Fragment>
      ))}
    </div>
  );
}
