import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, type ReactNode } from 'react';
import {
  Badge,
  Bench,
  Button,
  Explain,
  Field,
  Icons,
  Narration,
  NumberField,
  Panel,
  Reveal,
  Segmented,
  ShareButton,
  Stat,
  StatGrid,
  StepControls,
  useStepper,
  useStrings,
  useUi,
  useUrlState,
} from '../../components/kit';
import { CT_SCENARIOS, IMAGE_LAYERS, NAMESPACES, NS_VIEW, OVERLAY_OPS, lookup, simulateContainers, type CtScenario } from '../../sim/containers';
import {
  EMU_REGS_PER_REQ,
  FULL_BOOT,
  FULL_DEVICES,
  MICRO_BOOT,
  MICRO_DEVICES,
  MV_SCENARIOS,
  OVERHEAD_MIB,
  hostFootprint,
  simulateMicrovm,
  type MvScenario,
} from '../../sim/microvm';
import { actorSequence, simulateVirt } from '../../sim/virtualization';
import { M, type Kind } from './modeStrings';
import { spring } from './parts';

/* ---------------- shared bits ---------------- */

function Chip({ on, hot, tone = 'accent', onClick, children, className }: { on?: boolean; hot?: boolean; tone?: 'accent' | 'ok' | 'bad' | 'warn' | 'info'; onClick?: () => void; children: ReactNode; className?: string }) {
  const onCls = { accent: 'bg-accent text-accent-ink', ok: 'bg-ok-soft text-ok', bad: 'bg-bad-soft text-bad', warn: 'bg-warn-soft text-warn', info: 'bg-info-soft text-info' }[tone];
  return (
    <motion.button
      type="button"
      layout
      transition={spring}
      onClick={onClick}
      animate={{ scale: hot ? 1.06 : 1 }}
      className={clsx(
        'rounded-lg border px-2 py-1 font-mono text-[11.5px] transition-colors duration-200',
        on ? clsx(onCls, 'border-transparent') : 'border-line bg-sunken text-ink-3',
        hot && 'ring-2 ring-accent',
        onClick && 'cursor-pointer hover:border-line-strong',
        className,
      )}
    >
      {children}
    </motion.button>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.07em] text-ink-3">{children}</div>;
}

function useRun<S extends { focus: string }, T extends { n: number; state: S }>(steps: T[], key: string) {
  const stepper = useStepper(steps.length, { startAt: 'first' });
  const { first } = stepper;
  useEffect(() => first(), [key, first]);
  const jump = (focus: string) => {
    const after = steps.find((s) => s.n > stepper.index && s.state.focus === focus) ?? steps.find((s) => s.state.focus === focus);
    if (after) stepper.setIndex(after.n);
  };
  return { stepper, jump, cur: stepper.index > 0 ? steps[stepper.index - 1] : undefined };
}

function Setup({ picker, children, onReset, explain }: { picker: ReactNode; children: ReactNode; onReset: () => void; explain: ReactNode }) {
  const t = useUi();
  return (
    <Panel
      title={t.setup}
      actions={
        <Button size="sm" variant="ghost" icon={<Icons.reset className="size-3.5" />} onClick={onReset}>
          {t.reset}
        </Button>
      }
      bodyClassName="p-4"
      footer={<Explain>{explain}</Explain>}
    >
      {picker}
      {children}
      <div className="flex flex-wrap gap-2">
        <ShareButton />
      </div>
    </Panel>
  );
}

/* ---------------- microVM ---------------- */

export function MicrovmMode({ picker, extra }: { picker: ReactNode; extra: ReactNode }) {
  const m = useStrings(M);
  const s = m.mv;
  const t = useUi();
  const [cfg, set, reset] = useUrlState({ mv: 'boot', batch: 4, n: 8 });
  const sc: MvScenario = (MV_SCENARIOS as readonly string[]).includes(cfg.mv) ? (cfg.mv as MvScenario) : 'boot';
  const batch = Math.max(1, Math.min(8, cfg.batch));
  const run = useMemo(() => simulateMicrovm({ scenario: sc, batch }), [sc, batch]);
  const { stepper, jump, cur } = useRun(run.steps, `${sc}-${batch}`);
  const st = cur?.state ?? run.initial;
  const foot = hostFootprint(Math.max(1, Math.min(32, cfg.n)));
  const maxMib = foot.full.mib;

  const setup = (
    <Setup picker={picker} onReset={reset} explain={s.explain}>
      <Field label={m.scenario}>
        <Segmented size="sm" value={sc} options={MV_SCENARIOS.map((v) => ({ value: v, label: s.presets[v] }))} onChange={(mv) => set({ mv })} ariaLabel={m.scenario} />
      </Field>
      {sc === 'virtio' && (
        <Field label={s.batch}>
          <NumberField value={batch} min={1} max={8} onChange={(b) => set({ batch: b })} ariaLabel={s.batch} />
        </Field>
      )}
      <Field label={s.vms}>
        <NumberField value={cfg.n} min={1} max={32} onChange={(n) => set({ n })} ariaLabel={s.vms} />
      </Field>
    </Setup>
  );

  const fullTotal = FULL_BOOT.reduce((a, b) => a + b.ms, 0);

  return (
    <Bench setup={setup}>
      <Panel title={t.stepOf(stepper.index, stepper.total)} actions={<Badge tone="accent">{s.presets[sc]}</Badge>} bodyClassName="p-0">
        <div className="p-4">
          <StepControls stepper={stepper} />
          <div className="mt-5 min-w-0">
            {sc === 'boot' && (
              <div className="space-y-5">
                {(
                  [
                    ['full', FULL_BOOT, st.fullStage, st.fullMs, FULL_DEVICES],
                    ['micro', MICRO_BOOT, st.microStage, st.microMs, MICRO_DEVICES],
                  ] as const
                ).map(([k, stages, at, ms, devs]) => (
                  <div key={k}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-2">
                      <Label>{k === 'full' ? s.full : s.micro}</Label>
                      <span key={ms} className="animate-pop font-mono text-[13px] tabular-nums text-ink">~{ms} ms</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {stages.map((b, j) => (
                        <Chip key={b.id} on={j <= at} hot={j === at} tone={k === 'full' && b.id === 'firmware' ? 'warn' : 'accent'} onClick={() => stepper.setIndex(Math.min(j + 1, run.steps.length))}>
                          {s.stages[b.id]} · {b.ms}
                        </Chip>
                      ))}
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-sunken">
                      <motion.div className={clsx('h-full rounded-full', k === 'full' ? 'bg-warn' : 'bg-ok')} animate={{ width: `${Math.max(1, (ms / fullTotal) * 100)}%` }} transition={spring} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {devs.map((d) => (
                        <span key={d} className={clsx('rounded px-1.5 py-0.5 font-mono text-[10.5px] transition-colors', at >= (k === 'full' ? 1 : 2) ? 'bg-info-soft text-info' : 'bg-sunken text-ink-3')}>
                          {d}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="text-[11.5px] text-ink-3">{m.approx}</p>
              </div>
            )}

            {sc === 'virtio' && (
              <div className="space-y-5">
                <div>
                  <Label>virtio</Label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip on={st.focus === 'driver' || st.focus === 'queue'} hot={st.focus === 'driver'} onClick={() => jump('driver')}>guest driver</Chip>
                    <span className="text-ink-3">→</span>
                    <Chip on={st.queued > 0} hot={st.focus === 'queue'} tone="info" onClick={() => jump('queue')}>
                      virtqueue
                      <span className="ml-1.5 inline-flex gap-0.5 align-middle">
                        {Array.from({ length: batch }, (_, j) => (
                          <motion.span key={j} className="inline-block size-2 rounded-sm" animate={{ opacity: j < st.queued ? 1 : 0.25 }} style={{ background: 'currentColor' }} />
                        ))}
                      </span>
                    </Chip>
                    <span className="text-ink-3">→</span>
                    <Chip on={st.exits >= 1} hot={st.focus === 'kick'} tone="warn" onClick={() => jump('kick')}>kick (exit)</Chip>
                    <span className="text-ink-3">→</span>
                    <Chip on={st.done > 0} hot={st.focus === 'backend'} tone="ok" onClick={() => jump('backend')}>VMM backend ✓{st.done}</Chip>
                    <span className="text-ink-3">→</span>
                    <Chip on={st.irqs > 0} hot={st.focus === 'irq'} tone="warn" onClick={() => jump('irq')}>IRQ</Chip>
                  </div>
                </div>
                <div>
                  <Label>
                    {s.devices}: {EMU_REGS_PER_REQ} × {batch}
                  </Label>
                  <div className="flex flex-wrap gap-1">
                    {Array.from({ length: EMU_REGS_PER_REQ * batch }, (_, j) => (
                      <motion.span
                        key={j}
                        className={clsx('size-3.5 rounded-sm transition-colors', j < st.emuExits ? 'bg-bad' : 'bg-sunken')}
                        initial={false}
                        animate={{ scale: j < st.emuExits ? 1 : 0.8 }}
                        transition={{ delay: j * 0.015 }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {sc === 'jail' && (
              <div className="space-y-2">
                <Jail st={st} jump={jump} />
              </div>
            )}
          </div>

          <div className="mt-4">
            {cur ? <Narration key={stepper.index} tone={cur.tone}>{s.msg[cur.msg]({})}</Narration> : <Narration>{s.intro[sc]}</Narration>}
          </div>
        </div>
        <div className="border-t border-line">
          <StatGrid cols={4}>
            <Stat label={s.stats.exits} value={st.exits} tone="warn" />
            <Stat label={s.stats.emu} value={st.emuExits} tone={st.emuExits ? 'bad' : 'neutral'} />
            <Stat label={s.stats.boot} value={`${st.microMs}`} sub={`ms · ${s.full}: ${st.fullMs} ms`} tone="ok" />
            <Stat label={s.stats.mem} value={`${OVERHEAD_MIB.micro}`} sub={`MiB · ${s.full}: ${OVERHEAD_MIB.full}`} tone="accent" />
          </StatGrid>
        </div>
      </Panel>

      <Panel title={`${s.hostTitle} (N = ${cfg.n})`}>
        <div className="space-y-4">
          {(['full', 'micro'] as const).map((k) => (
            <div key={k}>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-[12.5px]">
                <span className="font-medium text-ink">{k === 'full' ? s.full : s.micro}</span>
                <span className="font-mono text-ink-2">
                  {s.memory}: {foot[k].mib} MiB · {s.surface}: {foot[k].devices} {s.surfaceSub}
                </span>
              </div>
              <div className="flex flex-wrap gap-0.5">
                <AnimatePresence initial={false}>
                  {Array.from({ length: cfg.n }, (_, j) => (
                    <motion.span
                      key={j}
                      layout
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.5 }}
                      className={clsx('h-4 rounded-sm', k === 'full' ? 'w-5 bg-warn' : 'w-3 bg-ok')}
                    />
                  ))}
                </AnimatePresence>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-sunken">
                <motion.div className={clsx('h-full', k === 'full' ? 'bg-warn' : 'bg-ok')} animate={{ width: `${(foot[k].mib / maxMib) * 100}%` }} transition={spring} />
              </div>
            </div>
          ))}
          <p className="text-[11.5px] text-ink-3">{m.approx}</p>
        </div>
      </Panel>

      <Panel title={m.practice}>
        <div className="grid gap-3 md:grid-cols-2">
          {s.q.map(([q, a], j) => (
            <Reveal key={j} question={q}>
              {a(batch, EMU_REGS_PER_REQ * batch)}
            </Reveal>
          ))}
        </div>
      </Panel>
      {extra}
    </Bench>
  );
}

function Jail({ st, jump }: { st: ReturnType<typeof simulateMicrovm>['initial']; jump: (f: string) => void }) {
  const rings = [
    ['chroot', 'chroot / pivot_root', st.jailed.chroot],
    ['ns', 'namespaces', st.jailed.ns],
    ['uid', 'uid sin privilegios + cgroups', st.jailed.uid],
    ['seccomp', 'seccomp', st.jailed.seccomp],
    ['vmm', 'VMM (1 por microVM)', st.jailed.vmm],
    ['guest', 'guest kernel + app', st.jailed.guest],
  ] as const;
  const nest = (k: number): ReactNode => {
    if (k >= rings.length) return null;
    const [id, label, on] = rings[k];
    return (
      <motion.div
        layout
        transition={spring}
        onClick={(e) => {
          e.stopPropagation();
          jump(id);
        }}
        className={clsx(
          'cursor-pointer rounded-xl border-2 p-1.5 transition-colors sm:p-2',
          on ? (id === 'seccomp' && st.blocked ? 'border-ok bg-ok-soft' : 'border-accent bg-surface') : 'border-dashed border-line bg-sunken',
          st.focus === id && 'ring-2 ring-accent',
        )}
      >
        <div className="flex items-center justify-between gap-2 px-1 font-mono text-[11px] text-ink-2">
          <span>{label}</span>
          {id === 'vmm' && st.focus === 'vmm' && st.jailed.guest && !st.blocked && <Badge tone="bad">execve()</Badge>}
          {id === 'seccomp' && st.blocked && <Badge tone="ok">EPERM / kill</Badge>}
        </div>
        {nest(k + 1)}
      </motion.div>
    );
  };
  return <>{nest(0)}</>;
}

/* ---------------- containers ---------------- */

export function ContainersMode({ picker, extra }: { picker: ReactNode; extra: ReactNode }) {
  const m = useStrings(M);
  const s = m.ct;
  const t = useUi();
  const [cfg, set, reset] = useUrlState({ cs: 'syscall', mem: 256, want: 384, cpu: 50 });
  const sc: CtScenario = (CT_SCENARIOS as readonly string[]).includes(cfg.cs) ? (cfg.cs as CtScenario) : 'syscall';
  const run = useMemo(() => simulateContainers({ scenario: sc, memLimit: cfg.mem, want: cfg.want, cpuLimit: cfg.cpu }), [sc, cfg.mem, cfg.want, cfg.cpu]);
  const { stepper, jump, cur } = useRun(run.steps, `${sc}-${cfg.mem}-${cfg.want}-${cfg.cpu}`);
  const st = cur?.state ?? run.initial;
  const vm = useMemo(() => simulateVirt({ scenario: 'syscall', assist: false, paravirt: false, spins: 3 }), []);
  const vmSeq = actorSequence(vm.virt.steps);
  const vmTraps = vm.virt.steps[vm.virt.steps.length - 1].counters.traps;

  const setup = (
    <Setup picker={picker} onReset={reset} explain={s.explain}>
      <Field label={m.scenario}>
        <Segmented size="sm" value={sc} options={CT_SCENARIOS.map((v) => ({ value: v, label: s.presets[v] }))} onChange={(cs) => set({ cs })} ariaLabel={m.scenario} />
      </Field>
      {sc === 'cgroups' && (
        <>
          <Field label={s.memLimit} hint="MiB">
            <NumberField value={cfg.mem} min={64} max={1024} step={64} onChange={(mem) => set({ mem })} ariaLabel={s.memLimit} />
          </Field>
          <Field label={s.want} hint="MiB">
            <NumberField value={cfg.want} min={64} max={1024} step={64} onChange={(want) => set({ want })} ariaLabel={s.want} />
          </Field>
          <Field label={s.cpuLimit}>
            <NumberField value={cfg.cpu} min={10} max={200} step={10} onChange={(cpu) => set({ cpu })} ariaLabel={s.cpuLimit} />
          </Field>
        </>
      )}
    </Setup>
  );

  const allPaths = [...new Set([...IMAGE_LAYERS.flatMap((l) => [...l.files]), ...OVERLAY_OPS.map((o) => o.path)])];

  return (
    <Bench setup={setup}>
      <Panel title={t.stepOf(stepper.index, stepper.total)} actions={<Badge tone="accent">{s.presets[sc]}</Badge>} bodyClassName="p-0">
        <div className="p-4">
          <StepControls stepper={stepper} />
          <div className="mt-5 min-w-0">
            {sc === 'syscall' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-line p-2">
                  <Label>{s.host}</Label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[1, 2, 3].map((n) => (
                      <motion.button
                        key={n}
                        type="button"
                        onClick={() => n === 1 && jump('app')}
                        className={clsx('rounded-lg border px-1 py-2 text-center font-mono text-[11px] transition-colors', n === 1 && st.where === 'app' && stepper.index > 0 ? 'border-transparent bg-c1 text-accent-ink' : 'border-line bg-sunken text-ink-2')}
                      >
                        {s.container(n)}
                      </motion.button>
                    ))}
                  </div>
                  <motion.button
                    type="button"
                    onClick={() => jump('kernel')}
                    className={clsx('mt-1.5 w-full rounded-lg border px-2 py-2 font-mono text-[11.5px] transition-colors', st.where === 'kernel' ? 'border-transparent bg-c2 text-accent-ink' : 'border-line bg-sunken text-ink-2')}
                  >
                    {s.kernel}
                  </motion.button>
                  <div className="mt-1.5 rounded-lg bg-c4 px-2 py-1.5 text-center font-mono text-[11px] text-accent-ink">hardware</div>
                </div>
                <PathRow label={`${s.ctPath} · ${st.traps} ${s.trapsWord}`} seq={['app', 'kernel', 'app']} tone="ok" />
                <PathRow label={`${s.vmPath} · ${vmTraps} ${s.trapsWord}`} seq={vmSeq} tone="warn" />
              </div>
            )}

            {sc === 'namespaces' && (
              <div className="overflow-hidden rounded-xl border border-line">
                <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] bg-sunken px-2 py-1.5 font-mono text-[10.5px] uppercase text-ink-3">
                  <span>ns</span>
                  <span>{s.inside}</span>
                  <span>{s.onHost}</span>
                </div>
                {NAMESPACES.map((ns) => {
                  const on = st.ns.includes(ns);
                  return (
                    <motion.button
                      type="button"
                      key={ns}
                      layout
                      onClick={() => jump(ns)}
                      className={clsx(
                        'grid w-full grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-1 border-t border-line px-2 py-1.5 text-left font-mono text-[11px] transition-colors',
                        st.focus === ns ? 'bg-accent-soft' : on ? 'bg-surface' : 'bg-surface opacity-60',
                      )}
                    >
                      <span className="text-ink">{s.nsNames[ns]}</span>
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.span key={String(on)} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={clsx('break-words', on ? 'text-ok' : 'text-ink-3')}>
                          {on ? NS_VIEW[ns].inside : NS_VIEW[ns].host}
                        </motion.span>
                      </AnimatePresence>
                      <span className="break-words text-ink-2">{NS_VIEW[ns].host}</span>
                    </motion.button>
                  );
                })}
              </div>
            )}

            {sc === 'cgroups' && (
              <div className="space-y-4">
                <Bar label={`memory · ${st.mem} / ${cfg.mem} MiB`} pct={Math.min(100, (st.mem / Math.max(cfg.mem, cfg.want)) * 100)} limitPct={(cfg.mem / Math.max(cfg.mem, cfg.want)) * 100} tone={st.killed ? 'bad' : st.mem >= cfg.mem ? 'warn' : 'ok'} onClick={() => jump('mem')} />
                <Bar label={`cpu · ${st.throttled ? Math.min(cfg.cpu, 100) : stepper.index > 1 ? 100 : 0}%`} pct={stepper.index > 1 ? Math.min(100, st.throttled ? cfg.cpu : 100) / 2 : 0} limitPct={Math.min(100, cfg.cpu / 2)} tone={st.throttled ? 'warn' : 'info'} onClick={() => jump('cpu')} />
                <div className="flex flex-wrap gap-2">
                  <AnimatePresence>
                    {st.killed && (
                      <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}>
                        <Badge tone="bad">{s.killed}</Badge>
                      </motion.span>
                    )}
                    {st.throttled && (
                      <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}>
                        <Badge tone="warn">{s.throttled}</Badge>
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )}

            {sc === 'overlay' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  {(['upper', 'app', 'base'] as const).map((id) => {
                    const files = id === 'upper' ? st.upper : [...IMAGE_LAYERS.find((l) => l.id === id)!.files];
                    return (
                      <motion.button
                        key={id}
                        type="button"
                        layout
                        onClick={() => jump(id)}
                        className={clsx('w-full rounded-xl border p-2 text-left transition-colors', st.focus === id ? 'border-accent bg-accent-soft' : 'border-line bg-surface')}
                      >
                        <div className="mb-1 font-mono text-[10.5px] uppercase text-ink-3">{s.layers[id]}</div>
                        <div className="flex min-h-6 flex-wrap gap-1">
                          <AnimatePresence initial={false}>
                            {files.map((f) => (
                              <motion.span key={f} layout initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className={clsx('rounded px-1.5 py-0.5 font-mono text-[10.5px]', st.lookup?.path === f && (st.lookup.from === id || id === 'upper') ? 'bg-accent text-accent-ink' : 'bg-sunken text-ink-2')}>
                                {f}
                              </motion.span>
                            ))}
                            {id === 'upper' &&
                              st.whiteouts.map((f) => (
                                <motion.span key={`wo${f}`} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded bg-bad-soft px-1.5 py-0.5 font-mono text-[10.5px] text-bad line-through" title={s.whiteout}>
                                  {f}
                                </motion.span>
                              ))}
                          </AnimatePresence>
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
                <div>
                  <Label>{s.merged}</Label>
                  <ul className="space-y-1">
                    {allPaths.map((p) => {
                      const from = lookup(p, st);
                      return (
                        <motion.li key={p} layout className={clsx('flex items-center justify-between gap-2 rounded-lg px-2 py-1 font-mono text-[11px] transition-colors', st.lookup?.path === p ? 'bg-accent-soft' : 'bg-sunken', from === 'missing' && 'opacity-50 line-through')}>
                          <span className="truncate text-ink">{p}</span>
                          <span className={clsx('shrink-0', from === 'upper' ? 'text-warn' : 'text-ink-3')}>{from}</span>
                        </motion.li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4">
            {cur ? <Narration key={stepper.index} tone={cur.tone}>{s.msg[cur.msg](cur.args ?? {})}</Narration> : <Narration>{s.intro[sc]}</Narration>}
          </div>
        </div>
        <div className="border-t border-line">
          <StatGrid cols={4}>
            <Stat label={s.stats.traps} value={sc === 'syscall' ? st.traps : '—'} tone="warn" sub={`VM: ${vmTraps}`} />
            <Stat label={s.stats.extra} value={0} tone="ok" />
            <Stat label={sc === 'cgroups' ? s.stats.mem : s.stats.ns} value={sc === 'cgroups' ? `${st.mem}` : st.ns.length} tone={st.killed ? 'bad' : 'accent'} sub={sc === 'cgroups' ? 'MiB' : undefined} />
            <Stat label={s.stats.upper} value={st.upper.length} tone="info" />
          </StatGrid>
        </div>
      </Panel>

      <Panel title={m.practice}>
        <div className="grid gap-3 md:grid-cols-2">
          {s.q.map(([q, a], j) => (
            <Reveal key={j} question={q}>
              {a()}
            </Reveal>
          ))}
        </div>
      </Panel>
      {extra}
    </Bench>
  );
}

function PathRow({ label, seq, tone }: { label: string; seq: string[]; tone: 'ok' | 'warn' }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-1">
        {seq.map((a, j) => (
          <span key={j} className="flex items-center gap-1">
            {j > 0 && <span className="text-ink-3">→</span>}
            <span className={clsx('rounded px-1.5 py-0.5 font-mono text-[11px]', a === 'vmm' ? 'bg-warn-soft text-warn' : tone === 'ok' ? 'bg-ok-soft text-ok' : 'bg-sunken text-ink-2')}>{a}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Bar({ label, pct, limitPct, tone, onClick }: { label: string; pct: number; limitPct: number; tone: 'ok' | 'warn' | 'bad' | 'info'; onClick: () => void }) {
  const bg = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', info: 'bg-info' }[tone];
  return (
    <button type="button" onClick={onClick} className="block w-full text-left">
      <Label>{label}</Label>
      <div className="relative h-4 overflow-hidden rounded-full bg-sunken">
        <motion.div className={clsx('h-full rounded-full transition-colors', bg)} animate={{ width: `${pct}%` }} transition={spring} />
        <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${Math.min(99.5, limitPct)}%` }} />
      </div>
    </button>
  );
}

/* ---------------- comparison ---------------- */

export function Compare({ kind }: { kind: Kind }) {
  const c = useStrings(M).cmp;
  const col = { vm: 1, microvm: 2, containers: 3 }[kind];
  return (
    <Panel title={c.title} bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[12.5px]">
          <thead>
            <tr>
              {c.head.map((h, j) => (
                <th key={j} className={clsx('px-3 py-2 font-mono text-[11px] uppercase transition-colors', j === col ? 'bg-accent-soft text-accent' : 'text-ink-3')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                {r.map((cell, j) => (
                  <td key={j} className={clsx('px-3 py-2 align-top transition-colors', j === 0 ? 'font-medium text-ink' : 'text-ink-2', j === col && 'bg-accent-soft text-ink')}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
