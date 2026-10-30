/**
 * Containers: processes on the shared host kernel, isolated with namespaces,
 * limited with cgroups and given a root filesystem made of overlay layers.
 * Each scenario is a protocol as `{ initial, steps[] }` snapshots.
 */
export const CT_SCENARIOS = ['syscall', 'namespaces', 'cgroups', 'overlay'] as const;
export type CtScenario = (typeof CT_SCENARIOS)[number];
export type Tone = 'neutral' | 'ok' | 'bad' | 'warn' | 'info';

export const NAMESPACES = ['pid', 'net', 'mnt', 'uts', 'ipc', 'user'] as const;
export type Ns = (typeof NAMESPACES)[number];

/** What the container process sees, inside vs on the host, per namespace. */
export const NS_VIEW: Record<Ns, { inside: string; host: string }> = {
  pid: { inside: 'PID 1', host: 'PID 4321' },
  net: { inside: 'eth0 10.0.0.2', host: 'veth3a1 ↔ docker0' },
  mnt: { inside: '/ = overlay', host: '/var/lib/…/merged' },
  uts: { inside: 'hostname web-1', host: 'hostname host' },
  ipc: { inside: 'shm propia', host: 'shm del host' },
  user: { inside: 'uid 0 (root)', host: 'uid 100000' },
};

/** Overlay layers, bottom to top. `upper` is the container's writable layer. */
export const IMAGE_LAYERS = [
  { id: 'base', files: ['/bin/sh', '/etc/os-release', '/lib/libc.so'] },
  { id: 'app', files: ['/app/server.js', '/etc/app.conf'] },
] as const;

export interface FsOp {
  op: 'read' | 'write' | 'create' | 'delete';
  path: string;
}
export const OVERLAY_OPS: FsOp[] = [
  { op: 'read', path: '/etc/os-release' },
  { op: 'read', path: '/app/server.js' },
  { op: 'write', path: '/etc/app.conf' },
  { op: 'read', path: '/etc/app.conf' },
  { op: 'create', path: '/tmp/cache' },
  { op: 'delete', path: '/bin/sh' },
  { op: 'read', path: '/bin/sh' },
];

export interface CtState {
  focus: string;
  /** syscall */
  traps: number;
  where: 'app' | 'kernel' | 'none';
  /** namespaces */
  ns: Ns[];
  /** cgroups (MiB, % of a CPU) */
  mem: number;
  throttled: boolean;
  killed: boolean;
  /** overlay */
  upper: string[];
  whiteouts: string[];
  lookup?: { op: FsOp['op']; path: string; from: 'base' | 'app' | 'upper' | 'missing'; copyUp?: boolean };
}

export interface CtStep {
  n: number;
  msg: string;
  tone: Tone;
  /** Formatting arguments for the message. */
  args?: Record<string, string | number>;
  state: CtState;
}
export interface CtRun {
  initial: CtState;
  steps: CtStep[];
}

export interface CtConfig {
  scenario: CtScenario;
  /** cgroups: memory.max (MiB) */
  memLimit: number;
  /** cgroups: memory the app tries to use (MiB) */
  want: number;
  /** cgroups: cpu.max as % of one CPU */
  cpuLimit: number;
}

export const CHUNK_MIB = 64;

export function simulateContainers(cfg: CtConfig): CtRun {
  const initial: CtState = { focus: '', traps: 0, where: 'app', ns: [], mem: 0, throttled: false, killed: false, upper: [], whiteouts: [] };
  const steps: CtStep[] = [];
  let st = initial;
  const push = (msg: string, tone: Tone, patch: Partial<CtState>, args?: CtStep['args']) => {
    st = { ...st, ...patch };
    steps.push({ n: steps.length + 1, msg, tone, args, state: st });
  };

  if (cfg.scenario === 'syscall') {
    push('sys.exec', 'neutral', { focus: 'app', where: 'app' });
    push('sys.trap', 'warn', { focus: 'kernel', where: 'kernel', traps: 1 });
    push('sys.handler', 'info', { focus: 'kernel' });
    push('sys.return', 'neutral', { focus: 'app', where: 'app' });
    push('sys.end', 'ok', { focus: 'app' });
  } else if (cfg.scenario === 'namespaces') {
    push('ns.clone', 'neutral', { focus: 'clone' });
    for (const ns of NAMESPACES) push(`ns.${ns}`, ns === 'pid' || ns === 'user' ? 'info' : 'neutral', { focus: ns, ns: [...st.ns, ns] });
    push('ns.end', 'ok', { focus: 'clone' });
  } else if (cfg.scenario === 'cgroups') {
    const limit = Math.max(CHUNK_MIB, Math.round(cfg.memLimit));
    const want = Math.max(CHUNK_MIB, Math.round(cfg.want));
    push('cg.create', 'neutral', { focus: 'cgroup' }, { limit, cpu: cfg.cpuLimit });
    push('cg.cpu', cfg.cpuLimit < 100 ? 'warn' : 'neutral', { focus: 'cpu', throttled: cfg.cpuLimit < 100 }, { cpu: cfg.cpuLimit });
    let mem = 0;
    while (mem < want) {
      const next = Math.min(want, mem + CHUNK_MIB);
      if (next > limit) {
        push('cg.reclaim', 'warn', { focus: 'mem', mem: limit }, { mem: next, limit });
        push('cg.oom', 'bad', { focus: 'mem', killed: true, mem: 0 }, { limit });
        return { initial, steps };
      }
      mem = next;
      push('cg.alloc', 'neutral', { focus: 'mem', mem }, { mem, limit });
    }
    push('cg.fits', 'ok', { focus: 'mem' }, { mem, limit });
  } else {
    for (const o of OVERLAY_OPS) {
      const from = lookup(o.path, st);
      if (o.op === 'read') {
        push(from === 'missing' ? 'ov.readMissing' : `ov.read.${from}`, from === 'missing' ? 'bad' : 'neutral', { focus: from, lookup: { op: 'read', path: o.path, from } }, { path: o.path });
      } else if (o.op === 'write') {
        const copyUp = from !== 'upper';
        push('ov.copyUp', 'warn', { focus: 'upper', upper: add(st.upper, o.path), lookup: { op: 'write', path: o.path, from, copyUp } }, { path: o.path, from });
      } else if (o.op === 'create') {
        push('ov.create', 'neutral', { focus: 'upper', upper: add(st.upper, o.path), lookup: { op: 'create', path: o.path, from: 'upper' } }, { path: o.path });
      } else {
        push('ov.whiteout', 'info', { focus: 'upper', whiteouts: add(st.whiteouts, o.path), upper: st.upper.filter((p) => p !== o.path), lookup: { op: 'delete', path: o.path, from } }, { path: o.path });
      }
    }
  }
  return { initial, steps };
}

const add = (xs: string[], x: string) => (xs.includes(x) ? xs : [...xs, x]);

/** Overlay lookup: upper first (a whiteout hides lower copies), then image layers top-down. */
export function lookup(path: string, st: Pick<CtState, 'upper' | 'whiteouts'>): 'base' | 'app' | 'upper' | 'missing' {
  if (st.whiteouts.includes(path)) return 'missing';
  if (st.upper.includes(path)) return 'upper';
  for (const l of [...IMAGE_LAYERS].reverse()) if ((l.files as readonly string[]).includes(path)) return l.id;
  return 'missing';
}
