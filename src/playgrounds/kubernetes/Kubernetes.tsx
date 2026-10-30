import clsx from 'clsx';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Badge,
  Bench,
  Button,
  Explain,
  Field,
  Icons,
  LangProvider,
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
  type Tone,
} from '../../components/kit';
import type { Lang } from '../../lib/i18n';
import {
  BACKOFFS,
  CLUSTER_IP,
  DEFAULT_CONFIG,
  EVICTION_SECONDS,
  SCENARIOS,
  qosClass,
  scoreNodes,
  simulate,
  used,
  type ClusterState,
  type Comp,
  type FilterReason,
  type K8sConfig,
  type NodeScore,
  type NodePart,
  type Phase,
  type PodState,
  type Scenario,
  type Step,
} from '../../sim/kubernetes';

const nn = (i: number) => `node-${i + 1}`;
const mi = (n: number) => (n >= 1024 && n % 1024 === 0 ? `${n / 1024}Gi` : `${n}Mi`);
const mc = (n: number) => (n % 1000 === 0 ? `${n / 1000}` : `${n}m`);
const list = (xs: string[] | undefined) => (xs && xs.length ? xs.join(', ') : '—');

const S = {
  es: {
    scenario: 'Escenario',
    scenarios: { create: 'Crear un pod', pending: 'Pending', deploy: 'Deployment', oom: 'Límites y OOMKilled', service: 'Service' } as Record<Scenario, string>,
    pod: 'Pod (por contenedor)',
    cpuReq: 'CPU request',
    memReq: 'Memoria request',
    cpuLim: 'CPU limit',
    memLim: 'Memoria limit',
    usage: 'Memoria que usa la app (pico)',
    replicas: 'Réplicas',
    scaleTo: 'Escalar a',
    failNode: 'Nodo que se cae',
    nodes: 'Nodos (allocatable)',
    cpu: 'CPU',
    mem: 'Memoria',
    controlPlane: 'Control plane',
    user: 'kubectl',
    client: 'cliente',
    comps: { api: 'API server', etcd: 'etcd', scheduler: 'scheduler', controller: 'controller-manager' } as Record<string, string>,
    passes: '✓ pasa el filtro',
    unscheduled: 'Sin nodo',
    noneUnscheduled: 'ningún pod esperando',
    events: 'Eventos',
    cgroup: 'cgroup del contenedor',
    service: 'Service web',
    endpoints: 'Endpoints',
    noEndpoints: 'sin endpoints listos',
    start: 'Mirá el cluster: un control plane y tres nodos, con algo ya corriendo en node-1 y node-2. Dale play o usá → para avanzar.',
    reason: { notReady: 'NotReady', cpu: 'Insufficient cpu', memory: 'Insufficient memory' } as Record<FilterReason, string>,
    phase: (p: Phase) => p,
    say: (st: Step): string => {
      const pod = st.pod ?? '';
      const node = st.node !== undefined ? nn(st.node) : '';
      switch (st.kind) {
        case 'apply':
          return st.pod ? `kubectl apply manda el manifiesto del pod ${pod} al API server.` : `kubectl apply manda un Deployment con replicas: ${st.n}.`;
        case 'validate':
          return 'El API server autentica, autoriza (RBAC), corre los admission controllers y valida el objeto.';
        case 'store':
          return `Lo guarda en etcd. El pod ${pod} existe, pero no tiene nodo: queda Pending.`;
        case 'watch':
          return `El scheduler tiene un watch sobre pods sin spec.nodeName: ve a ${pod} en su cola.`;
        case 'filter': {
          const ok = st.scores!.filter((s) => s.fits).length;
          return `Filtrado: descarta los nodos sin CPU o memoria libre para los requests (y los NotReady). Pasan ${ok} de ${st.scores!.length}.`;
        }
        case 'score':
          return `Scoring (LeastAllocated): gana el nodo que queda más libre. Elige ${node}.`;
        case 'bind':
          return st.token === 'api' ? `Binding: el scheduler escribe spec.nodeName = ${node}. El API server lo guarda en etcd.` : `El scheduler bindea ${pod} a ${node}.`;
        case 'unschedulable':
          return `${pod}: ningún nodo pasa el filtro. ${st.message}`;
        case 'retry':
          return `${pod} queda Pending (evento FailedScheduling). El scheduler reintenta cuando cambie el cluster: un nodo nuevo, o que se libere lugar.`;
        case 'kubeletSees':
          return `El kubelet de ${node} mira los pods asignados a su nodo y ve a ${pod}.`;
        case 'sandbox':
          return 'El kubelet le pide al runtime (containerd → runc) el sandbox: el contenedor pause, que crea los namespaces de red e IPC compartidos y el cgroup del pod.';
        case 'pull':
          return 'containerd baja la imagen del registry (si no estaba en caché) y arma el filesystem del contenedor.';
        case 'start':
          return 'runc hace clone() con namespaces nuevos (PID, mount, UTS) unido a la red del pause, lo mete en el cgroup y hace exec del proceso. Running.';
        case 'probe':
          return 'El kubelet corre la readiness probe. Hasta que pase, el pod no recibe tráfico.';
        case 'running':
          return st.token === 'api' ? `La probe pasa: ${pod} está Running y Ready. El kubelet reporta el estado al API server.` : `${pod} corre en ${node}.`;
        case 'deployCreated':
          return 'El API server guarda el Deployment en etcd.';
        case 'rsCreated':
          return `El controller de Deployments crea un ReplicaSet con replicas: ${st.n}.`;
        case 'podsCreated':
          return `El controller del ReplicaSet ve que faltan pods y crea ${st.n}: ${list(st.pods)}. Todos Pending.`;
        case 'allRunning':
          return `Los kubelets arrancan los contenedores: ${list(st.pods)} Running.`;
        case 'scale':
          return `kubectl scale: replicas ${st.m} → ${st.n}.`;
        case 'scaleDown':
          return `Sobran ${st.n}: el ReplicaSet borra ${list(st.pods)} (SIGTERM, y SIGKILL si no terminan).`;
        case 'nodeDown':
          return `${node} deja de mandar heartbeats: el node controller lo marca NotReady y le pone el taint unreachable. ${st.pods!.length ? `Sus pods (${list(st.pods)}) dejan de estar Ready.` : 'No tenía pods de web.'}`;
        case 'evict':
          return st.pods!.length ? `Pasan ${st.n} s (tolerationSeconds del taint): se desalojan ${list(st.pods)}.` : `Pasan ${st.n} s; no hay nada que desalojar.`;
        case 'replace':
          return `El ReplicaSet ve menos réplicas de las pedidas y crea ${st.n} nuevas: ${list(st.pods)}.`;
        case 'cgroup':
          return 'El runtime escribe los limits en el cgroup del contenedor: memory.max y cpu.max (cuota CFS por período de 100 ms).';
        case 'throttle':
          return `La app quiere ${mc(st.n!)} CPU pero el limit es ${mc(st.m!)}: el kernel la frena (throttling) cuando agota la cuota. Va más lenta, pero no se muere.`;
        case 'memGrow':
          return `La app reserva memoria: ya usa ${mi(st.n!)}.`;
        case 'oom':
          return `Quiere ${mi(st.n!)} y el limit es ${mi(st.m!)}: el OOM killer del kernel mata el proceso dentro del cgroup (SIGKILL, exit 137). OOMKilled.`;
        case 'backoff':
          return `restartPolicy: Always. El kubelet espera ${st.n} s antes de reiniciar (backoff exponencial)${st.m! > 1 ? ': CrashLoopBackOff' : ''}.`;
        case 'restart':
          return `Reinicia el contenedor (restarts: ${st.m}). Mismo código, misma memoria: va a volver a pasar.`;
        case 'fits':
          return `Usa ${mi(st.n!)} de ${mi(st.m!)}: entra en el limit, sigue Running.`;
        case 'svcPods':
          return `Hay ${st.n} pods con la label app=web corriendo, cada uno con su IP.`;
        case 'svcCreate':
          return `Se crea el Service web (selector app=web, ClusterIP ${CLUSTER_IP}). El controller de EndpointSlices lista los pods Ready: ${list(st.pods)}.`;
        case 'proxyRules':
          return `kube-proxy en cada nodo programa reglas (iptables/IPVS) que traducen ${CLUSTER_IP}:80 a alguno de los endpoints.`;
        case 'request':
          return st.pod ? `Request #${st.n} a ${CLUSTER_IP}: las reglas de kube-proxy lo mandan a ${pod} en ${node}.` : `Request #${st.n} a ${CLUSTER_IP}: no hay endpoints listos, la conexión se rechaza.`;
        case 'probeFail':
          return `La readiness probe de ${pod} falla: deja de estar Ready y sale de los endpoints (quedan ${st.n}). El contenedor sigue vivo.`;
        case 'probeOk':
          return `La probe de ${pod} vuelve a pasar: vuelve a los endpoints (${st.n}).`;
      }
    },
    running: 'Running',
    pending: 'Pending',
    restarts: 'Restarts',
    nodesReady: 'Nodos Ready',
    qos: 'QoS',
    eps: 'Endpoints',
    practice: 'Practicá',
    qWhere: 'Con estos requests, ¿en qué nodo cae el pod?',
    aWhere: (node: string, sc: string) => `En ${node}. Scores: ${sc}.`,
    qWhy: '¿Por qué no elige otro nodo?',
    aWhy: (r: string) => r,
    qPending: '¿Por qué queda Pending?',
    aPending: (msg: string, free: string, req: string) => `${msg} El nodo con más memoria libre tiene ${free} y el pod pide ${req}. Los requests se reservan aunque nadie los use.`,
    qMax: '¿Cuánta memoria podría pedir como máximo para entrar en algún nodo?',
    aMax: (m: string) => `${m} (la memoria libre del mejor nodo que además tiene CPU).`,
    qEnd: '¿En qué nodos terminan las réplicas?',
    aEnd: (x: string) => x,
    qWait: '¿Por qué tarda en reemplazar los pods del nodo caído?',
    aWait: `El control plane no sabe si el nodo murió o solo perdió la red. Espera unos 40 s sin heartbeats para marcarlo NotReady y después ${EVICTION_SECONDS} s (tolerationSeconds) antes de desalojar.`,
    qOom: '¿Cuántas veces se reinicia y en qué estado queda?',
    aOom: (r: number, oom: boolean) =>
      oom ? `${r} reinicios en esta simulación (esperas de ${BACKOFFS.join(', ')} s, el backoff sigue hasta 5 min). Queda en CrashLoopBackOff: el problema es la memoria, no el arranque.` : 'Ninguno: el pico entra en el limit.',
    qCpu: '¿Y si se pasa del limit de CPU?',
    aCpu: 'No pasa nada grave: la CPU es compresible. El kernel deja de darle tiempo de CPU hasta el próximo período (throttling). La memoria no se puede «devolver», por eso el exceso termina en OOM.',
    qReq: '¿A qué pod va cada request?',
    aReq: (x: string) => x,
    qOne: 'Si hubiera una sola réplica y falla su readiness probe, ¿qué pasa con los requests?',
    aOne: 'El Service se queda sin endpoints y las conexiones se rechazan, aunque el contenedor siga corriendo. Por eso conviene más de una réplica.',
    explain: (
      <>
        <p>
          Un <b>pod</b> no es una máquina virtual: son procesos comunes del nodo, encerrados en <b>namespaces</b> (PID, red, mount, UTS, IPC) y limitados por <b>cgroups</b>. Todos los pods de un nodo comparten el mismo kernel. El contenedor <code>pause</code> sostiene los namespaces que comparten los contenedores del pod.
        </p>
        <p>
          El <b>scheduler</b> se parece al de CPU, pero en vez de repartir tiempo reparte espacio: es un problema de <b>bin packing</b>. Primero <b>filtra</b> los nodos donde no entran los <b>requests</b> (lo reservado, no lo usado) y después les da un <b>score</b>; acá, LeastAllocated: gana el que queda más libre.
        </p>
        <p>
          Nadie le da órdenes directas a nadie: cada componente <b>mira</b> (watch) el API server y corrige la diferencia entre lo deseado y lo real. Así funcionan los controllers del Deployment y del ReplicaSet, y el kubelet en cada nodo.
        </p>
        <p>
          Los <b>limits</b> van al cgroup: pasarse de <code>memory.max</code> despierta al OOM killer; pasarse de <code>cpu.max</code> solo te frena. Un <b>Service</b> es una IP virtual: kube-proxy reescribe los paquetes hacia un pod Ready.
        </p>
      </>
    ),
  },
  en: {
    scenario: 'Scenario',
    scenarios: { create: 'Create a pod', pending: 'Pending', deploy: 'Deployment', oom: 'Limits and OOMKilled', service: 'Service' } as Record<Scenario, string>,
    pod: 'Pod (per container)',
    cpuReq: 'CPU request',
    memReq: 'Memory request',
    cpuLim: 'CPU limit',
    memLim: 'Memory limit',
    usage: 'Memory the app uses (peak)',
    replicas: 'Replicas',
    scaleTo: 'Scale to',
    failNode: 'Node that fails',
    nodes: 'Nodes (allocatable)',
    cpu: 'CPU',
    mem: 'Memory',
    controlPlane: 'Control plane',
    user: 'kubectl',
    client: 'client',
    comps: { api: 'API server', etcd: 'etcd', scheduler: 'scheduler', controller: 'controller-manager' } as Record<string, string>,
    passes: '✓ passes the filter',
    unscheduled: 'Unscheduled',
    noneUnscheduled: 'no pod waiting',
    events: 'Events',
    cgroup: 'Container cgroup',
    service: 'Service web',
    endpoints: 'Endpoints',
    noEndpoints: 'no ready endpoints',
    start: 'Look at the cluster: a control plane and three nodes, with something already running on node-1 and node-2. Press play or use → to advance.',
    reason: { notReady: 'NotReady', cpu: 'Insufficient cpu', memory: 'Insufficient memory' } as Record<FilterReason, string>,
    phase: (p: Phase) => p,
    say: (st: Step): string => {
      const pod = st.pod ?? '';
      const node = st.node !== undefined ? nn(st.node) : '';
      switch (st.kind) {
        case 'apply':
          return st.pod ? `kubectl apply sends pod ${pod}'s manifest to the API server.` : `kubectl apply sends a Deployment with replicas: ${st.n}.`;
        case 'validate':
          return 'The API server authenticates, authorizes (RBAC), runs admission controllers and validates the object.';
        case 'store':
          return `It stores it in etcd. Pod ${pod} exists but has no node: it is Pending.`;
        case 'watch':
          return `The scheduler watches pods with no spec.nodeName: ${pod} shows up in its queue.`;
        case 'filter': {
          const ok = st.scores!.filter((s) => s.fits).length;
          return `Filtering: drops nodes without free CPU or memory for the requests (and NotReady ones). ${ok} of ${st.scores!.length} pass.`;
        }
        case 'score':
          return `Scoring (LeastAllocated): the node left with the most room wins. It picks ${node}.`;
        case 'bind':
          return st.token === 'api' ? `Binding: the scheduler writes spec.nodeName = ${node}. The API server stores it in etcd.` : `The scheduler binds ${pod} to ${node}.`;
        case 'unschedulable':
          return `${pod}: no node passes the filter. ${st.message}`;
        case 'retry':
          return `${pod} stays Pending (FailedScheduling event). The scheduler retries when the cluster changes: a new node, or freed capacity.`;
        case 'kubeletSees':
          return `The kubelet on ${node} watches pods bound to its node and sees ${pod}.`;
        case 'sandbox':
          return 'The kubelet asks the runtime (containerd → runc) for the sandbox: the pause container, which creates the shared network and IPC namespaces and the pod cgroup.';
        case 'pull':
          return 'containerd pulls the image from the registry (unless cached) and sets up the container filesystem.';
        case 'start':
          return 'runc clone()s with new namespaces (PID, mount, UTS) joined to pause’s network, puts it in the cgroup and execs the process. Running.';
        case 'probe':
          return 'The kubelet runs the readiness probe. Until it passes, the pod gets no traffic.';
        case 'running':
          return st.token === 'api' ? `The probe passes: ${pod} is Running and Ready. The kubelet reports status to the API server.` : `${pod} runs on ${node}.`;
        case 'deployCreated':
          return 'The API server stores the Deployment in etcd.';
        case 'rsCreated':
          return `The Deployment controller creates a ReplicaSet with replicas: ${st.n}.`;
        case 'podsCreated':
          return `The ReplicaSet controller sees missing pods and creates ${st.n}: ${list(st.pods)}. All Pending.`;
        case 'allRunning':
          return `The kubelets start the containers: ${list(st.pods)} Running.`;
        case 'scale':
          return `kubectl scale: replicas ${st.m} → ${st.n}.`;
        case 'scaleDown':
          return `${st.n} too many: the ReplicaSet deletes ${list(st.pods)} (SIGTERM, then SIGKILL if they don't exit).`;
        case 'nodeDown':
          return `${node} stops sending heartbeats: the node controller marks it NotReady and taints it unreachable. ${st.pods!.length ? `Its pods (${list(st.pods)}) stop being Ready.` : 'It had no web pods.'}`;
        case 'evict':
          return st.pods!.length ? `${st.n} s go by (the taint's tolerationSeconds): ${list(st.pods)} are evicted.` : `${st.n} s go by; nothing to evict.`;
        case 'replace':
          return `The ReplicaSet sees fewer replicas than desired and creates ${st.n} new ones: ${list(st.pods)}.`;
        case 'cgroup':
          return 'The runtime writes the limits into the container cgroup: memory.max and cpu.max (a CFS quota per 100 ms period).';
        case 'throttle':
          return `The app wants ${mc(st.n!)} CPU but the limit is ${mc(st.m!)}: the kernel throttles it once the quota runs out. Slower, but alive.`;
        case 'memGrow':
          return `The app allocates memory: now using ${mi(st.n!)}.`;
        case 'oom':
          return `It wants ${mi(st.n!)} and the limit is ${mi(st.m!)}: the kernel OOM killer kills the process inside the cgroup (SIGKILL, exit 137). OOMKilled.`;
        case 'backoff':
          return `restartPolicy: Always. The kubelet waits ${st.n} s before restarting (exponential backoff)${st.m! > 1 ? ': CrashLoopBackOff' : ''}.`;
        case 'restart':
          return `The container restarts (restarts: ${st.m}). Same code, same memory: it will happen again.`;
        case 'fits':
          return `Uses ${mi(st.n!)} of ${mi(st.m!)}: within the limit, still Running.`;
        case 'svcPods':
          return `${st.n} pods labelled app=web are running, each with its own IP.`;
        case 'svcCreate':
          return `Service web is created (selector app=web, ClusterIP ${CLUSTER_IP}). The EndpointSlice controller lists the Ready pods: ${list(st.pods)}.`;
        case 'proxyRules':
          return `kube-proxy on every node programs rules (iptables/IPVS) that translate ${CLUSTER_IP}:80 to one of the endpoints.`;
        case 'request':
          return st.pod ? `Request #${st.n} to ${CLUSTER_IP}: kube-proxy's rules send it to ${pod} on ${node}.` : `Request #${st.n} to ${CLUSTER_IP}: no ready endpoints, the connection is refused.`;
        case 'probeFail':
          return `${pod}'s readiness probe fails: it is no longer Ready and leaves the endpoints (${st.n} left). The container is still alive.`;
        case 'probeOk':
          return `${pod}'s probe passes again: back in the endpoints (${st.n}).`;
      }
    },
    running: 'Running',
    pending: 'Pending',
    restarts: 'Restarts',
    nodesReady: 'Nodes Ready',
    qos: 'QoS',
    eps: 'Endpoints',
    practice: 'Practice',
    qWhere: 'With these requests, which node does the pod land on?',
    aWhere: (node: string, sc: string) => `${node}. Scores: ${sc}.`,
    qWhy: 'Why not another node?',
    aWhy: (r: string) => r,
    qPending: 'Why does it stay Pending?',
    aPending: (msg: string, free: string, req: string) => `${msg} The node with the most free memory has ${free} and the pod asks for ${req}. Requests are reserved even if nobody uses them.`,
    qMax: 'What is the most memory it could request and still fit somewhere?',
    aMax: (m: string) => `${m} (the free memory of the best node that also has the CPU).`,
    qEnd: 'Which nodes do the replicas end up on?',
    aEnd: (x: string) => x,
    qWait: 'Why does replacing the failed node’s pods take so long?',
    aWait: `The control plane can't tell a dead node from a network blip. It waits ~40 s without heartbeats to mark it NotReady and then ${EVICTION_SECONDS} s (tolerationSeconds) before evicting.`,
    qOom: 'How many times does it restart and what state does it end in?',
    aOom: (r: number, oom: boolean) =>
      oom ? `${r} restarts in this simulation (waits of ${BACKOFFS.join(', ')} s; the backoff keeps doubling up to 5 min). It ends in CrashLoopBackOff: the problem is memory, not startup.` : 'None: the peak fits within the limit.',
    qCpu: 'And if it goes over the CPU limit?',
    aCpu: 'Nothing dramatic: CPU is compressible. The kernel stops giving it CPU time until the next period (throttling). Memory cannot be “given back”, which is why going over ends in OOM.',
    qReq: 'Which pod does each request go to?',
    aReq: (x: string) => x,
    qOne: 'With a single replica whose readiness probe fails, what happens to requests?',
    aOne: 'The Service has no endpoints and connections are refused, even though the container keeps running. That is why you want more than one replica.',
    explain: (
      <>
        <p>
          A <b>pod</b> is not a virtual machine: it is ordinary processes on the node, wrapped in <b>namespaces</b> (PID, network, mount, UTS, IPC) and limited by <b>cgroups</b>. All pods on a node share the same kernel. The <code>pause</code> container holds the namespaces the pod’s containers share.
        </p>
        <p>
          The <b>scheduler</b> is like the CPU scheduler, but it hands out space instead of time: it is <b>bin packing</b>. It first <b>filters</b> out nodes where the <b>requests</b> (reserved, not used) don’t fit, then <b>scores</b> the rest; here, LeastAllocated: the emptiest node wins.
        </p>
        <p>
          No one gives anyone direct orders: each component <b>watches</b> the API server and fixes the gap between desired and actual state. That is how the Deployment and ReplicaSet controllers work, and the kubelet on every node.
        </p>
        <p>
          <b>Limits</b> go into the cgroup: exceeding <code>memory.max</code> wakes the OOM killer; exceeding <code>cpu.max</code> only slows you down. A <b>Service</b> is a virtual IP: kube-proxy rewrites packets towards a Ready pod.
        </p>
      </>
    ),
  },
};

type Strings = (typeof S)['es'];

const DEFAULTS = {
  scenario: 'create' as Scenario,
  n1c: 2000,
  n1m: 4096,
  n2c: 2000,
  n2m: 4096,
  n3c: 2000,
  n3m: 4096,
  cpu: DEFAULT_CONFIG.cpu,
  mem: DEFAULT_CONFIG.mem,
  cpuLim: DEFAULT_CONFIG.cpuLim,
  memLim: DEFAULT_CONFIG.memLim,
  replicas: DEFAULT_CONFIG.replicas,
  scaleTo: DEFAULT_CONFIG.scaleTo,
  failNode: DEFAULT_CONFIG.failNode,
  usage: DEFAULT_CONFIG.usage,
};

/** What each scenario loads when picked, so the interesting thing happens. */
const PRESET: Record<Scenario, Partial<typeof DEFAULTS>> = {
  create: { cpu: 500, mem: 512, cpuLim: 1000, memLim: 768 },
  pending: { cpu: 500, mem: 5120, cpuLim: 1000, memLim: 5120 },
  deploy: { cpu: 500, mem: 512, cpuLim: 1000, memLim: 768, replicas: 3, scaleTo: 4, failNode: 2 },
  oom: { cpu: 250, mem: 256, cpuLim: 500, memLim: 512, usage: 1024 },
  service: { cpu: 250, mem: 256, cpuLim: 500, memLim: 512, replicas: 3 },
};

const phaseTone: Record<Phase, string> = {
  Pending: 'bg-warn-soft text-warn ring-warn/40',
  ContainerCreating: 'bg-info-soft text-info ring-info/40',
  Running: 'bg-ok-soft text-ok ring-ok/40',
  Terminating: 'bg-chip text-ink-3 ring-line-strong',
  OOMKilled: 'bg-bad-soft text-bad ring-bad/40',
  CrashLoopBackOff: 'bg-bad-soft text-bad ring-bad/40',
};

function stepTone(st: Step): Tone {
  if (['unschedulable', 'retry', 'oom', 'nodeDown', 'probeFail'].includes(st.kind)) return 'bad';
  if (['backoff', 'throttle', 'evict', 'scaleDown'].includes(st.kind) || (st.kind === 'request' && !st.pod)) return 'warn';
  if (['running', 'allRunning', 'fits', 'probeOk'].includes(st.kind)) return 'ok';
  return 'neutral';
}

const touches = (st: Step, pod: string) => st.pod === pod || !!st.pods?.includes(pod);

export default function KubernetesPlayground({ lang }: { lang: Lang }) {
  return (
    <LangProvider lang={lang}>
      <Kubernetes />
    </LangProvider>
  );
}

function Kubernetes() {
  const s = useStrings(S);
  const t = useUi();
  const [c, set, reset] = useUrlState(DEFAULTS);
  const cfg: K8sConfig = useMemo(
    () => ({
      scenario: SCENARIOS.includes(c.scenario) ? c.scenario : 'create',
      nodes: [
        { cpu: c.n1c, mem: c.n1m },
        { cpu: c.n2c, mem: c.n2m },
        { cpu: c.n3c, mem: c.n3m },
      ],
      cpu: c.cpu,
      mem: c.mem,
      cpuLim: Math.max(c.cpuLim, c.cpu),
      memLim: Math.max(c.memLim, c.mem),
      replicas: c.replicas,
      scaleTo: c.scaleTo,
      failNode: c.failNode,
      usage: c.usage,
    }),
    [c],
  );
  const run = useMemo(() => simulate(cfg), [cfg]);
  const stepper = useStepper(run.steps.length, { startAt: 'first' });
  const [hover, setHover] = useState<string | null>(null);

  const cur = stepper.index > 0 ? run.steps[stepper.index - 1] : undefined;
  const state = cur?.state ?? run.initial;
  const last = run.steps.at(-1)!;
  const sc = cfg.scenario;
  const ours = (st: ClusterState) => st.pods.filter((p) => !p.system);
  const hoverNode = hover ? state.pods.find((p) => p.name === hover)?.node ?? null : null;

  const num = (label: string, key: keyof typeof DEFAULTS, min: number, max: number, step: number, suffix: string) => (
    <Field label={label}>
      <NumberField value={c[key] as number} min={min} max={max} step={step} suffix={suffix} ariaLabel={label} onChange={(v) => set({ [key]: v } as Partial<typeof DEFAULTS>)} />
    </Field>
  );

  const setup = (
    <Panel
      title={t.setup}
      actions={
        <Button size="sm" variant="ghost" icon={<Icons.reset className="size-3.5" />} onClick={reset}>
          {t.reset}
        </Button>
      }
      bodyClassName="p-4"
      footer={<Explain>{s.explain}</Explain>}
    >
      <Field label={s.scenario}>
        <Segmented size="sm" value={sc} options={SCENARIOS.map((id) => ({ value: id, label: s.scenarios[id] }))} onChange={(id) => set({ scenario: id, ...PRESET[id] })} />
      </Field>
      <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.07em] text-ink-3">{s.pod}</div>
      <div className="grid grid-cols-2 gap-x-3">
        {num(s.cpuReq, 'cpu', 100, 4000, 100, 'm')}
        {num(s.memReq, 'mem', 128, 8192, 128, 'Mi')}
        {num(s.cpuLim, 'cpuLim', 100, 4000, 100, 'm')}
        {num(s.memLim, 'memLim', 128, 8192, 128, 'Mi')}
      </div>
      {sc === 'oom' && num(s.usage, 'usage', 128, 8192, 128, 'Mi')}
      {(sc === 'deploy' || sc === 'service') && (
        <div className="grid grid-cols-2 gap-x-3">
          {num(s.replicas, 'replicas', 1, 8, 1, '')}
          {sc === 'deploy' && num(s.scaleTo, 'scaleTo', 0, 8, 1, '')}
        </div>
      )}
      {sc === 'deploy' && (
        <Field label={s.failNode}>
          <Segmented size="sm" value={c.failNode} options={[0, 1, 2].map((i) => ({ value: i, label: nn(i) }))} onChange={(failNode) => set({ failNode })} />
        </Field>
      )}
      <div className="mb-2 mt-1 text-[11px] font-medium uppercase tracking-[0.07em] text-ink-3">{s.nodes}</div>
      {([0, 1, 2] as const).map((i) => (
        <div key={i} className="grid grid-cols-[52px_1fr_1fr] items-center gap-2 [&_.mb-4]:mb-2">
          <span className="pb-2 font-mono text-[12px] text-ink-2">{nn(i)}</span>
          {num(s.cpu, `n${i + 1}c` as keyof typeof DEFAULTS, 500, 8000, 250, 'm')}
          {num(s.mem, `n${i + 1}m` as keyof typeof DEFAULTS, 512, 16384, 512, 'Mi')}
        </div>
      ))}
      <div className="mt-2 flex flex-wrap gap-2">
        <ShareButton />
      </div>
    </Panel>
  );

  const pending = ours(state).filter((p) => p.node === null);
  const running = ours(state).filter((p) => p.phase === 'Running').length;
  const restarts = ours(state).reduce((a, p) => a + p.restarts, 0);

  return (
    <Bench setup={setup}>
      <Panel title={t.stepOf(stepper.index, stepper.total)} actions={<Badge tone="accent">{s.scenarios[sc]}</Badge>}>
        <StepControls stepper={stepper} />
        <div className="mt-4">
          {cur ? (
            <Narration key={stepper.index} tone={stepTone(cur)}>
              {s.say(cur)}
            </Narration>
          ) : (
            <Narration>{s.start}</Narration>
          )}
        </div>
      </Panel>

      <LayoutGroup>
        <Panel title={s.controlPlane} bodyClassName="p-3 sm:p-4">
          <div className="flex flex-wrap items-stretch gap-2">
            <CompBox comp="user" cur={cur} label={sc === 'service' ? s.client : s.user} mono />
            <CompBox comp="api" cur={cur} label={s.comps.api} />
            <CompBox comp="etcd" cur={cur} label={s.comps.etcd} />
            <CompBox comp="scheduler" cur={cur} label={s.comps.scheduler} />
            <CompBox comp="controller" cur={cur} label={s.comps.controller} />
          </div>
          <div className="mt-3 flex min-h-11 flex-wrap items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-3">{s.unscheduled}</span>
            <AnimatePresence mode="popLayout">
              {pending.map((p) => (
                <PodChip key={p.name} p={p} hover={hover} setHover={setHover} />
              ))}
            </AnimatePresence>
            {pending.length === 0 && <span className="text-[12px] text-ink-3">{s.noneUnscheduled}</span>}
          </div>
          {cur?.message && <p className="mt-2 font-mono text-[12px] text-bad">{cur.message}</p>}
        </Panel>

        <div className="grid gap-3 md:grid-cols-3">
          {state.nodes.map((_, i) => (
            <NodeCard
              key={i}
              i={i}
              state={state}
              cur={cur}
              s={s}
              hover={hover}
              setHover={setHover}
              highlighted={hoverNode === i}
              score={cur?.scores?.find((x) => x.node === i)}
              showProxy={sc === 'service'}
            />
          ))}
        </div>
      </LayoutGroup>

      {sc === 'oom' && <CgroupPanel state={state} cfg={cfg} s={s} />}
      {sc === 'service' && <ServicePanel state={state} cur={cur} s={s} hover={hover} setHover={setHover} />}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title={s.events} bodyClassName="p-0">
          <ol className="max-h-80 overflow-y-auto py-1">
            {run.steps.map((st, k) => {
              const now = k === stepper.index - 1;
              const lit = hover !== null && touches(st, hover);
              return (
                <li key={k}>
                  <button
                    type="button"
                    onClick={() => stepper.setIndex(k + 1)}
                    onMouseEnter={() => st.pod && setHover(st.pod)}
                    onMouseLeave={() => setHover(null)}
                    className={clsx(
                      'flex w-full gap-2 px-4 py-1.5 text-left text-[12.5px] leading-snug transition-colors duration-200',
                      now ? 'bg-accent-soft text-ink' : lit ? 'bg-chip text-ink' : k < stepper.index ? 'text-ink-2 hover:bg-chip' : 'text-ink-3 hover:bg-chip',
                    )}
                  >
                    <span className="w-6 shrink-0 text-right font-mono text-ink-3">{k + 1}</span>
                    <span className={clsx('mt-1.5 size-1.5 shrink-0 rounded-full', { bad: 'bg-bad', warn: 'bg-warn', ok: 'bg-ok', neutral: 'bg-line-strong', info: 'bg-info', accent: 'bg-accent' }[stepTone(st)])} />
                    <span className="min-w-0">{s.say(st)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </Panel>
        <Panel title={s.scenarios[sc]} bodyClassName="p-0">
          <StatGrid cols={2}>
            <Stat label={s.running} value={running} tone="ok" />
            <Stat label={s.pending} value={pending.length} tone={pending.length ? 'warn' : 'neutral'} />
            {sc === 'oom' ? (
              <>
                <Stat label={s.restarts} value={restarts} tone={restarts ? 'bad' : 'neutral'} />
                <Stat label={s.qos} value={<span className="text-[22px]">{qosClass(cfg)}</span>} />
              </>
            ) : sc === 'service' ? (
              <>
                <Stat label={s.eps} value={state.endpoints?.length ?? 0} tone="info" />
                <Stat label={s.nodesReady} value={`${state.nodes.filter((n) => n.ready).length}/3`} />
              </>
            ) : (
              <>
                <Stat label={s.nodesReady} value={`${state.nodes.filter((n) => n.ready).length}/3`} tone={state.nodes.every((n) => n.ready) ? 'neutral' : 'bad'} />
                <Stat label={s.qos} value={<span className="text-[22px]">{qosClass(cfg)}</span>} />
              </>
            )}
          </StatGrid>
        </Panel>
      </div>

      <Practice cfg={cfg} last={last} run={run} s={s} />
    </Bench>
  );
}

function Token() {
  return <motion.span layoutId="k8s-token" transition={{ type: 'spring', stiffness: 380, damping: 30 }} className="absolute -right-1 -top-1 size-3 rounded-full bg-accent shadow ring-2 ring-surface" />;
}

function CompBox({ comp, cur, label, mono }: { comp: Comp; cur?: Step; label: string; mono?: boolean }) {
  const on = cur?.token === comp;
  return (
    <div
      className={clsx(
        'relative flex min-w-[88px] flex-1 items-center justify-center rounded-xl border px-3 py-2.5 text-center font-mono text-[12px] transition-colors duration-300',
        on ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong bg-sunken text-ink-2',
        mono && 'border-dashed',
      )}
    >
      {label}
      {on && <Token />}
    </div>
  );
}

function PodChip({ p, hover, setHover, endpoint }: { p: PodState; hover: string | null; setHover: (n: string | null) => void; endpoint?: boolean }) {
  const lit = hover === p.name;
  return (
    <motion.div
      layout
      layoutId={endpoint ? `ep-${p.name}` : `pod-${p.name}`}
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: p.phase === 'Terminating' ? 0.5 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.6 }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      onMouseEnter={() => setHover(p.name)}
      onMouseLeave={() => setHover(null)}
      title={`${p.name} · ${p.phase}${p.ip ? ` · ${p.ip}` : ''}`}
      className={clsx(
        'inline-flex cursor-default items-center gap-1.5 rounded-lg px-2 py-1 font-mono text-[11.5px] ring-1 transition-colors duration-300',
        p.system ? 'bg-chip text-ink-3 ring-line' : phaseTone[p.phase],
        lit && 'ring-2 ring-accent',
      )}
    >
      <span className={clsx('size-1.5 rounded-full', p.ready ? 'bg-ok' : 'bg-line-strong')} />
      {p.name}
      {!p.system && <span className="opacity-70">{p.phase === 'Running' ? '' : p.phase}</span>}
      {p.restarts > 0 && <span className="opacity-70">↻{p.restarts}</span>}
    </motion.div>
  );
}

function Bar({ label, used: u, total, fmt }: { label: string; used: number; total: number; fmt: (n: number) => string }) {
  const pct = Math.min(100, (u / total) * 100);
  return (
    <div>
      <div className="flex justify-between font-mono text-[11px] text-ink-3">
        <span>{label}</span>
        <span>
          {fmt(u)} / {fmt(total)}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-sunken">
        <motion.div className={clsx('h-full rounded-full', pct > 90 ? 'bg-bad' : pct > 70 ? 'bg-warn' : 'bg-accent')} animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 200, damping: 30 }} />
      </div>
    </div>
  );
}

function NodeCard({
  i,
  state,
  cur,
  s,
  hover,
  setHover,
  highlighted,
  score,
  showProxy,
}: {
  i: number;
  state: ClusterState;
  cur?: Step;
  s: Strings;
  hover: string | null;
  setHover: (n: string | null) => void;
  highlighted: boolean;
  score?: NodeScore;
  showProxy: boolean;
}) {
  const node = state.nodes[i];
  const u = used(state, i);
  const here = cur?.token === `node${i}`;
  const parts: NodePart[] = showProxy ? ['kubelet', 'runtime', 'proxy'] : ['kubelet', 'runtime'];
  const partLabel = { kubelet: 'kubelet', runtime: 'containerd', proxy: 'kube-proxy' };
  const pods = state.pods.filter((p) => p.node === i);
  return (
    <section
      className={clsx(
        'relative min-w-0 rounded-2xl border bg-surface p-3 shadow-panel transition-colors duration-300',
        !node.ready ? 'border-bad bg-bad-soft' : highlighted ? 'border-accent' : here ? 'border-accent/60' : 'border-line',
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <span className="font-mono text-[12.5px] font-medium text-ink">{node.name}</span>
        <Badge tone={node.ready ? 'ok' : 'bad'}>{node.ready ? 'Ready' : 'NotReady'}</Badge>
      </header>
      <div className="mt-2 flex flex-wrap gap-1">
        {parts.map((part) => {
          const on = here && cur?.part === part;
          return (
            <span
              key={part}
              className={clsx('relative rounded-md px-1.5 py-0.5 font-mono text-[10.5px] transition-colors duration-300', on ? 'bg-accent-soft text-accent ring-1 ring-accent' : 'bg-sunken text-ink-3')}
            >
              {partLabel[part]}
              {on && <Token />}
            </span>
          );
        })}
      </div>
      <div className="mt-3 space-y-2">
        <Bar label="cpu" used={u.cpu} total={node.cpu} fmt={mc} />
        <Bar label="mem" used={u.mem} total={node.mem} fmt={mi} />
      </div>
      <AnimatePresence>
        {score && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={clsx('mt-2 rounded-lg px-2 py-1 font-mono text-[11.5px]', score.fits ? (cur?.node === i ? 'bg-ok-soft text-ok' : 'bg-sunken text-ink-2') : 'bg-bad-soft text-bad')}
          >
            {score.fits ? (score.score !== undefined ? `✓ score ${score.score}` : s.passes) : `✗ ${score.reasons.map((r) => s.reason[r]).join(', ')}`}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="mt-3 flex min-h-8 flex-wrap gap-1.5">
        <AnimatePresence mode="popLayout">
          {pods.map((p) => (
            <PodChip key={p.name} p={p} hover={hover} setHover={setHover} />
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}

function CgroupPanel({ state, cfg, s }: { state: ClusterState; cfg: K8sConfig; s: Strings }) {
  const app = state.pods.find((p) => p.name === 'app');
  const mem = state.usage?.mem ?? 0;
  const cpu = state.usage?.cpu ?? 0;
  return (
    <Panel title={s.cgroup} actions={app && <Badge tone={app.phase === 'Running' ? 'ok' : 'bad'}>{app.phase}</Badge>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Bar label={`memory.current / memory.max`} used={mem} total={cfg.memLim} fmt={mi} />
          <p className="mt-1.5 font-mono text-[11px] text-ink-3">
            {s.usage}: {mi(cfg.usage)}
          </p>
        </div>
        <div>
          <Bar label={`cpu / cpu.max (${cfg.cpuLim * 100} 100000)`} used={cpu} total={cfg.cpuLim} fmt={mc} />
          <p className="mt-1.5 font-mono text-[11px] text-ink-3">requests: {mc(cfg.cpu)} cpu · {mi(cfg.mem)}</p>
        </div>
      </div>
    </Panel>
  );
}

function ServicePanel({ state, cur, s, hover, setHover }: { state: ClusterState; cur?: Step; s: Strings; hover: string | null; setHover: (n: string | null) => void }) {
  const eps = state.endpoints;
  const target = cur?.kind === 'request' ? cur.pod : undefined;
  return (
    <Panel title={s.service} actions={<Badge tone="info">{CLUSTER_IP}</Badge>}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.07em] text-ink-3">{s.endpoints}</span>
        {eps === undefined ? (
          <span className="text-[12px] text-ink-3">—</span>
        ) : eps.length === 0 ? (
          <span className="text-[12px] text-bad">{s.noEndpoints}</span>
        ) : (
          <AnimatePresence mode="popLayout">
            {eps.map((name) => {
              const p = state.pods.find((x) => x.name === name)!;
              return (
                <motion.div key={name} layout className={clsx('rounded-lg', target === name && 'ring-2 ring-accent ring-offset-2 ring-offset-surface')}>
                  <PodChip p={p} hover={hover} setHover={setHover} endpoint />
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
      {target && (
        <p className="mt-3 font-mono text-[12px] text-ink-2">
          {CLUSTER_IP}:80 → {state.pods.find((p) => p.name === target)?.ip}:8080
        </p>
      )}
    </Panel>
  );
}

function Practice({ cfg, last, run, s }: { cfg: K8sConfig; last: Step; run: ReturnType<typeof simulate>; s: Strings }) {
  const qs: { q: ReactNode; a: ReactNode }[] = [];
  const end = last.state;
  const web = end.pods.filter((p) => !p.system);
  if (cfg.scenario === 'create') {
    const scores = scoreNodes(run.initial, cfg);
    const fmt = scores.map((x) => `${nn(x.node)} ${x.fits ? x.score : '✗'}`).join(', ');
    const node = web[0]?.node;
    qs.push({ q: s.qWhere, a: node !== null && node !== undefined ? s.aWhere(nn(node), fmt) : s.aWhere('—', fmt) });
    qs.push({
      q: s.qWhy,
      a: s.aWhy(scores.map((x) => `${nn(x.node)}: ${x.fits ? `score ${x.score}` : x.reasons.map((r) => s.reason[r]).join(', ')}`).join(' · ')),
    });
  } else if (cfg.scenario === 'pending') {
    const scores = scoreNodes(run.initial, cfg);
    const frees = run.initial.nodes.map((n, i) => ({ mem: n.mem - used(run.initial, i).mem, cpu: n.cpu - used(run.initial, i).cpu }));
    const maxFree = Math.max(...frees.map((f) => f.mem));
    const fitCpu = frees.filter((f) => f.cpu >= cfg.cpu).map((f) => f.mem);
    const msg = last.message ?? '';
    qs.push({ q: s.qPending, a: msg ? s.aPending(msg, mi(maxFree), mi(cfg.mem)) : scores.some((x) => x.fits) ? '—' : msg });
    qs.push({ q: s.qMax, a: s.aMax(fitCpu.length ? mi(Math.max(...fitCpu)) : '—') });
  } else if (cfg.scenario === 'deploy') {
    qs.push({ q: s.qEnd, a: s.aEnd(web.map((p) => `${p.name} → ${p.node === null ? 'Pending' : nn(p.node)}`).join(', ') || '—') });
    qs.push({ q: s.qWait, a: s.aWait });
  } else if (cfg.scenario === 'oom') {
    const app = web[0];
    qs.push({ q: s.qOom, a: s.aOom(app?.restarts ?? 0, cfg.usage > cfg.memLim) });
    qs.push({ q: s.qCpu, a: s.aCpu });
  } else {
    const reqs = run.steps.filter((x) => x.kind === 'request').map((x) => `#${x.n} → ${x.pod ?? '✗'}`);
    qs.push({ q: s.qReq, a: s.aReq(reqs.join(', ')) });
    qs.push({ q: s.qOne, a: s.aOne });
  }
  return (
    <Panel title={s.practice}>
      <div className="grid gap-3 md:grid-cols-2">
        {qs.map((x, k) => (
          <Reveal key={`${cfg.scenario}-${k}`} question={x.q}>
            {x.a}
          </Reveal>
        ))}
      </div>
    </Panel>
  );
}
