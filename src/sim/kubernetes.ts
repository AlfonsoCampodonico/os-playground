/**
 * A tiny Kubernetes control loop: API server + etcd, scheduler (filter +
 * LeastAllocated score), controllers, kubelets, cgroup limits and Services.
 * Everything is deterministic; the UI renders `steps[i].state`.
 * CPU is in millicores, memory in MiB.
 */

export type Scenario = 'create' | 'pending' | 'deploy' | 'oom' | 'service';
export const SCENARIOS: Scenario[] = ['create', 'pending', 'deploy', 'oom', 'service'];

export type Phase = 'Pending' | 'ContainerCreating' | 'Running' | 'Terminating' | 'OOMKilled' | 'CrashLoopBackOff';

export interface NodeSpec {
  cpu: number;
  mem: number;
}

export interface NodeState extends NodeSpec {
  name: string;
  ready: boolean;
}

export interface PodState {
  name: string;
  app: string;
  cpu: number;
  mem: number;
  cpuLim: number;
  memLim: number;
  node: number | null;
  phase: Phase;
  ready: boolean;
  restarts: number;
  ip?: string;
  /** Pre-existing workload (not part of the scenario). */
  system?: boolean;
}

export interface ClusterState {
  nodes: NodeState[];
  pods: PodState[];
  /** Service endpoints (pod names), when a Service exists. */
  endpoints?: string[];
  /** Container memory/CPU usage in the OOM scenario. */
  usage?: { mem: number; cpu: number };
}

export type Comp = 'user' | 'api' | 'etcd' | 'scheduler' | 'controller' | 'node0' | 'node1' | 'node2';
export type NodePart = 'kubelet' | 'runtime' | 'proxy';

export type FilterReason = 'notReady' | 'cpu' | 'memory';
export interface NodeScore {
  node: number;
  fits: boolean;
  reasons: FilterReason[];
  /** LeastAllocated score 0..100, only for nodes that pass the filter. */
  score?: number;
}

export type StepKind =
  | 'apply'
  | 'validate'
  | 'store'
  | 'watch'
  | 'filter'
  | 'score'
  | 'bind'
  | 'unschedulable'
  | 'kubeletSees'
  | 'sandbox'
  | 'pull'
  | 'start'
  | 'probe'
  | 'running'
  | 'retry'
  | 'deployCreated'
  | 'rsCreated'
  | 'podsCreated'
  | 'allRunning'
  | 'scale'
  | 'scaleDown'
  | 'nodeDown'
  | 'evict'
  | 'replace'
  | 'cgroup'
  | 'throttle'
  | 'memGrow'
  | 'oom'
  | 'backoff'
  | 'restart'
  | 'fits'
  | 'svcPods'
  | 'svcCreate'
  | 'proxyRules'
  | 'request'
  | 'probeFail'
  | 'probeOk';

export interface Step {
  kind: StepKind;
  token: Comp;
  part?: NodePart;
  pod?: string;
  /** Other pods this step touches (for hover cross-highlighting). */
  pods?: string[];
  node?: number;
  scores?: NodeScore[];
  /** kube-scheduler style message, e.g. "0/3 nodes are available: 3 Insufficient memory." */
  message?: string;
  n?: number;
  m?: number;
  state: ClusterState;
}

export interface Run {
  initial: ClusterState;
  steps: Step[];
}

export interface K8sConfig {
  scenario: Scenario;
  nodes: NodeSpec[];
  /** Pod requests/limits. */
  cpu: number;
  mem: number;
  cpuLim: number;
  memLim: number;
  replicas: number;
  scaleTo: number;
  /** Node that fails in the Deployment scenario. */
  failNode: number;
  /** Peak memory the app tries to use (OOM scenario). */
  usage: number;
}

export const DEFAULT_CONFIG: K8sConfig = {
  scenario: 'create',
  nodes: [
    { cpu: 2000, mem: 4096 },
    { cpu: 2000, mem: 4096 },
    { cpu: 2000, mem: 4096 },
  ],
  cpu: 500,
  mem: 512,
  cpuLim: 1000,
  memLim: 768,
  replicas: 3,
  scaleTo: 4,
  failNode: 2,
  usage: 1024,
};

export const CLUSTER_IP = '10.96.0.10';
/** node.kubernetes.io/unreachable toleration added to every pod by default. */
export const EVICTION_SECONDS = 300;
export const BACKOFFS = [10, 20, 40];

const clone = (s: ClusterState): ClusterState => ({
  nodes: s.nodes.map((n) => ({ ...n })),
  pods: s.pods.map((p) => ({ ...p })),
  endpoints: s.endpoints ? [...s.endpoints] : undefined,
  usage: s.usage ? { ...s.usage } : undefined,
});

/** Requests already bound to a node (terminating pods still hold theirs). */
export function used(state: ClusterState, node: number): { cpu: number; mem: number } {
  let cpu = 0;
  let mem = 0;
  for (const p of state.pods) {
    if (p.node === node) {
      cpu += p.cpu;
      mem += p.mem;
    }
  }
  return { cpu, mem };
}

/** Filter + LeastAllocated scoring, as kube-scheduler's default plugins do. */
export function scoreNodes(state: ClusterState, pod: { cpu: number; mem: number }): NodeScore[] {
  return state.nodes.map((n, i) => {
    const u = used(state, i);
    const reasons: FilterReason[] = [];
    if (!n.ready) reasons.push('notReady');
    else {
      if (u.cpu + pod.cpu > n.cpu) reasons.push('cpu');
      if (u.mem + pod.mem > n.mem) reasons.push('memory');
    }
    if (reasons.length) return { node: i, fits: false, reasons };
    const cpuFree = ((n.cpu - u.cpu - pod.cpu) / n.cpu) * 100;
    const memFree = ((n.mem - u.mem - pod.mem) / n.mem) * 100;
    return { node: i, fits: true, reasons, score: Math.floor((cpuFree + memFree) / 2) };
  });
}

/** Highest score wins; ties go to the lowest index (the real scheduler picks at random). */
export function pick(scores: NodeScore[]): number | null {
  let best: NodeScore | null = null;
  for (const s of scores) if (s.fits && (best === null || s.score! > best.score!)) best = s;
  return best ? best.node : null;
}

export function unschedulableMessage(scores: NodeScore[]): string {
  const label: Record<FilterReason, string> = {
    notReady: "node(s) had untolerated taint {node.kubernetes.io/unreachable: }",
    cpu: 'Insufficient cpu',
    memory: 'Insufficient memory',
  };
  const counts = new Map<FilterReason, number>();
  for (const s of scores) for (const r of s.reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([r, c]) => `${c} ${label[r]}`);
  const fit = scores.filter((s) => s.fits).length;
  return `${fit}/${scores.length} nodes are available: ${parts.join(', ')}.`;
}

const nodeComp = (i: number) => `node${i}` as Comp;

function baseCluster(cfg: K8sConfig): ClusterState {
  const nodes = cfg.nodes.map((n, i) => ({ ...n, name: `node-${i + 1}`, ready: true }));
  const sys = (name: string, node: number, cpu: number, mem: number): PodState => ({
    name, app: name, cpu, mem, cpuLim: cpu, memLim: mem, node, phase: 'Running', ready: true, restarts: 0, system: true,
    ip: `10.244.${node + 1}.2`,
  });
  // Something already runs on the cluster, so the scores differ per node.
  const pods = [sys('postgres', 0, 1000, 2048), sys('redis', 1, 500, 1024)].filter((p) => p.node! < nodes.length);
  return { nodes, pods };
}

class Builder {
  state: ClusterState;
  steps: Step[] = [];
  private ipSeq = [10, 10, 10];
  constructor(public cfg: K8sConfig, initial: ClusterState) {
    this.state = clone(initial);
  }
  push(s: Omit<Step, 'state'>) {
    this.steps.push({ ...s, state: clone(this.state) });
  }
  pod(name: string) {
    return this.state.pods.find((p) => p.name === name)!;
  }
  newPod(name: string, app = 'web'): PodState {
    const c = this.cfg;
    const p: PodState = { name, app, cpu: c.cpu, mem: c.mem, cpuLim: c.cpuLim, memLim: c.memLim, node: null, phase: 'Pending', ready: false, restarts: 0 };
    this.state.pods.push(p);
    return p;
  }
  bind(p: PodState, node: number) {
    p.node = node;
    p.ip = `10.244.${node + 1}.${this.ipSeq[node]++}`;
  }
  /** One scheduling cycle collapsed into a single step (Deployment / Service). */
  scheduleOne(name: string): boolean {
    const p = this.pod(name);
    const scores = scoreNodes(this.state, p);
    const n = pick(scores);
    if (n === null) {
      this.push({ kind: 'unschedulable', token: 'scheduler', pod: name, scores, message: unschedulableMessage(scores) });
      return false;
    }
    this.bind(p, n);
    p.phase = 'ContainerCreating';
    this.push({ kind: 'bind', token: 'scheduler', pod: name, node: n, scores });
    return true;
  }
  startAll(names: string[]) {
    const started = names.filter((n) => this.pod(n).node !== null);
    if (!started.length) return;
    for (const n of started) Object.assign(this.pod(n), { phase: 'Running', ready: true });
    const node = this.pod(started[0]).node!;
    this.push({ kind: 'allRunning', token: nodeComp(node), part: 'kubelet', pods: started, n: started.length });
  }
}

function simCreate(b: Builder, pending: boolean) {
  const name = pending ? 'big' : 'web';
  b.push({ kind: 'apply', token: 'user', pod: name });
  b.push({ kind: 'validate', token: 'api', pod: name });
  const p = b.newPod(name, name);
  b.push({ kind: 'store', token: 'etcd', pod: name });
  b.push({ kind: 'watch', token: 'scheduler', pod: name });
  const scores = scoreNodes(b.state, p);
  b.push({ kind: 'filter', token: 'scheduler', pod: name, scores: scores.map((s) => ({ ...s, score: undefined })) });
  const n = pick(scores);
  if (n === null) {
    const message = unschedulableMessage(scores);
    b.push({ kind: 'unschedulable', token: 'scheduler', pod: name, scores, message });
    b.push({ kind: 'retry', token: 'scheduler', pod: name, message });
    return;
  }
  b.push({ kind: 'score', token: 'scheduler', pod: name, scores, node: n });
  b.bind(p, n);
  b.push({ kind: 'bind', token: 'api', pod: name, node: n, scores });
  b.push({ kind: 'kubeletSees', token: nodeComp(n), part: 'kubelet', pod: name, node: n });
  p.phase = 'ContainerCreating';
  b.push({ kind: 'sandbox', token: nodeComp(n), part: 'runtime', pod: name, node: n });
  b.push({ kind: 'pull', token: nodeComp(n), part: 'runtime', pod: name, node: n });
  p.phase = 'Running';
  b.push({ kind: 'start', token: nodeComp(n), part: 'runtime', pod: name, node: n });
  b.push({ kind: 'probe', token: nodeComp(n), part: 'kubelet', pod: name, node: n });
  p.ready = true;
  b.push({ kind: 'running', token: 'api', pod: name, node: n });
}

function simDeploy(b: Builder) {
  const c = b.cfg;
  let seq = 0;
  const names = () => b.state.pods.filter((p) => !p.system && p.phase !== 'Terminating').map((p) => p.name);
  const create = (k: number) => {
    const created: string[] = [];
    for (let i = 0; i < k; i++) created.push(b.newPod(`web-${String.fromCharCode(97 + seq++)}`).name);
    return created;
  };
  b.push({ kind: 'apply', token: 'user', n: c.replicas });
  b.push({ kind: 'deployCreated', token: 'etcd', n: c.replicas });
  b.push({ kind: 'rsCreated', token: 'controller', n: c.replicas });
  const first = create(c.replicas);
  b.push({ kind: 'podsCreated', token: 'controller', pods: first, n: first.length });
  for (const p of first) b.scheduleOne(p);
  b.startAll(first);

  if (c.scaleTo !== c.replicas) {
    b.push({ kind: 'scale', token: 'user', n: c.scaleTo, m: c.replicas });
    if (c.scaleTo > c.replicas) {
      const more = create(c.scaleTo - c.replicas);
      b.push({ kind: 'podsCreated', token: 'controller', pods: more, n: more.length });
      for (const p of more) b.scheduleOne(p);
      b.startAll(more);
    } else {
      // The ReplicaSet deletes the newest pods first (and unscheduled ones before that).
      const live = names();
      const victims = [...live.filter((n) => b.pod(n).node === null), ...live.filter((n) => b.pod(n).node !== null).reverse()].slice(0, c.replicas - c.scaleTo);
      for (const v of victims) b.pod(v).phase = 'Terminating';
      b.push({ kind: 'scaleDown', token: 'controller', pods: victims, n: victims.length });
      b.state.pods = b.state.pods.filter((p) => !victims.includes(p.name));
    }
  }

  const f = Math.min(c.failNode, b.state.nodes.length - 1);
  b.state.nodes[f].ready = false;
  const onIt = b.state.pods.filter((p) => !p.system && p.node === f).map((p) => p.name);
  for (const n of onIt) b.pod(n).ready = false;
  b.push({ kind: 'nodeDown', token: 'controller', node: f, pods: onIt });
  for (const n of onIt) b.pod(n).phase = 'Terminating';
  b.push({ kind: 'evict', token: 'controller', node: f, pods: onIt, n: EVICTION_SECONDS });
  b.state.pods = b.state.pods.filter((p) => !onIt.includes(p.name));
  if (onIt.length) {
    const repl = create(onIt.length);
    b.push({ kind: 'replace', token: 'controller', pods: repl, n: repl.length });
    for (const p of repl) b.scheduleOne(p);
    b.startAll(repl);
  }
}

function simOom(b: Builder) {
  const c = b.cfg;
  const p = b.newPod('app', 'app');
  const scores = scoreNodes(b.state, p);
  const n = pick(scores);
  if (n === null) {
    b.push({ kind: 'unschedulable', token: 'scheduler', pod: 'app', scores, message: unschedulableMessage(scores) });
    return;
  }
  b.bind(p, n);
  Object.assign(p, { phase: 'Running', ready: true });
  b.state.usage = { mem: Math.round(Math.min(c.usage, c.memLim) * 0.25), cpu: Math.round(c.cpuLim / 2) };
  b.push({ kind: 'running', token: nodeComp(n), part: 'kubelet', pod: 'app', node: n });
  b.push({ kind: 'cgroup', token: nodeComp(n), part: 'runtime', pod: 'app', node: n });
  b.state.usage = { mem: b.state.usage.mem, cpu: c.cpuLim };
  b.push({ kind: 'throttle', token: nodeComp(n), part: 'runtime', pod: 'app', node: n, n: c.cpuLim * 2, m: c.cpuLim });
  b.state.usage.cpu = Math.round(c.cpuLim / 2);
  if (c.usage <= c.memLim) {
    b.state.usage.mem = c.usage;
    b.push({ kind: 'memGrow', token: nodeComp(n), part: 'runtime', pod: 'app', node: n, n: c.usage });
    b.push({ kind: 'fits', token: nodeComp(n), part: 'kubelet', pod: 'app', node: n, n: c.usage, m: c.memLim });
    return;
  }
  BACKOFFS.forEach((secs, i) => {
    b.state.usage!.mem = Math.round(c.memLim * 0.9);
    b.push({ kind: 'memGrow', token: nodeComp(n), part: 'runtime', pod: 'app', node: n, n: b.state.usage!.mem });
    b.state.usage!.mem = 0;
    Object.assign(p, { phase: 'OOMKilled', ready: false });
    p.restarts++;
    b.push({ kind: 'oom', token: nodeComp(n), part: 'runtime', pod: 'app', node: n, n: c.usage, m: c.memLim });
    p.phase = i === 0 ? 'OOMKilled' : 'CrashLoopBackOff';
    b.push({ kind: 'backoff', token: nodeComp(n), part: 'kubelet', pod: 'app', node: n, n: secs, m: p.restarts });
    Object.assign(p, { phase: 'Running', ready: true });
    b.state.usage!.mem = Math.round(Math.min(c.usage, c.memLim) * 0.25);
    b.push({ kind: 'restart', token: nodeComp(n), part: 'runtime', pod: 'app', node: n, m: p.restarts });
  });
}

function simService(b: Builder) {
  const c = b.cfg;
  const names: string[] = [];
  for (let i = 0; i < c.replicas; i++) {
    const p = b.newPod(`web-${String.fromCharCode(97 + i)}`);
    const n = pick(scoreNodes(b.state, p));
    if (n !== null) {
      b.bind(p, n);
      Object.assign(p, { phase: 'Running', ready: true });
    }
    names.push(p.name);
  }
  b.push({ kind: 'svcPods', token: 'api', pods: names, n: names.length });
  const ready = () => b.state.pods.filter((p) => !p.system && p.ready).map((p) => p.name);
  b.state.endpoints = ready();
  b.push({ kind: 'svcCreate', token: 'controller', pods: b.state.endpoints, n: b.state.endpoints.length });
  b.push({ kind: 'proxyRules', token: 'node0', part: 'proxy', pods: b.state.endpoints });
  let rr = 0;
  let req = 0;
  const request = () => {
    req++;
    const eps = b.state.endpoints!;
    if (!eps.length) {
      b.push({ kind: 'request', token: 'user', n: req });
      return;
    }
    const target = eps[rr++ % eps.length];
    const node = b.pod(target).node!;
    b.push({ kind: 'request', token: nodeComp(node), part: 'proxy', pod: target, node, n: req });
  };
  const count = Math.max(2, Math.min(3, b.state.endpoints.length));
  for (let i = 0; i < count; i++) request();
  const sick = b.state.endpoints[0];
  if (sick) {
    const sp = b.pod(sick);
    sp.ready = false;
    b.state.endpoints = ready();
    b.push({ kind: 'probeFail', token: nodeComp(sp.node!), part: 'kubelet', pod: sick, node: sp.node!, n: b.state.endpoints.length });
    rr = 0;
    request();
    request();
    sp.ready = true;
    b.state.endpoints = ready();
    b.push({ kind: 'probeOk', token: 'controller', pod: sick, node: sp.node!, n: b.state.endpoints.length });
    request();
  }
}

export function simulate(cfg: K8sConfig): Run {
  const initial = baseCluster(cfg);
  const b = new Builder(cfg, initial);
  if (cfg.scenario === 'create') simCreate(b, false);
  else if (cfg.scenario === 'pending') simCreate(b, true);
  else if (cfg.scenario === 'deploy') simDeploy(b);
  else if (cfg.scenario === 'oom') simOom(b);
  else simService(b);
  return { initial, steps: b.steps };
}

/** Requests == limits for every resource → Guaranteed; some request → Burstable. */
export function qosClass(p: { cpu: number; mem: number; cpuLim: number; memLim: number }): 'Guaranteed' | 'Burstable' | 'BestEffort' {
  if (!p.cpu && !p.mem && !p.cpuLim && !p.memLim) return 'BestEffort';
  return p.cpu === p.cpuLim && p.mem === p.memLim ? 'Guaranteed' : 'Burstable';
}
