import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, qosClass, simulate, type K8sConfig } from './kubernetes';

const cfg = (p: Partial<K8sConfig>): K8sConfig => ({ ...DEFAULT_CONFIG, ...p });

describe('create a pod', () => {
  it('goes API → etcd → scheduler → kubelet → runtime and ends Running on the least allocated node', () => {
    const run = simulate(cfg({ scenario: 'create' }));
    expect(run.steps.map((s) => s.kind)).toEqual(['apply', 'validate', 'store', 'watch', 'filter', 'score', 'bind', 'kubeletSees', 'sandbox', 'pull', 'start', 'probe', 'running']);
    const score = run.steps.find((s) => s.kind === 'score')!;
    expect(score.scores!.map((s) => s.score)).toEqual([31, 56, 81]);
    const web = run.steps.at(-1)!.state.pods.find((p) => p.name === 'web')!;
    expect(web).toMatchObject({ node: 2, phase: 'Running', ready: true });
  });

  it('filters out nodes without enough free memory', () => {
    const run = simulate(cfg({ scenario: 'create', mem: 2500 }));
    const f = run.steps.find((s) => s.kind === 'filter')!;
    expect(f.scores!.map((s) => s.fits)).toEqual([false, true, true]);
    expect(f.scores![0].reasons).toEqual(['memory']);
  });
});

describe('pending', () => {
  it('stays Pending with the scheduler message when no node fits', () => {
    const run = simulate(cfg({ scenario: 'pending', mem: 5000, memLim: 5000 }));
    const last = run.steps.at(-1)!;
    expect(last.message).toBe('0/3 nodes are available: 3 Insufficient memory.');
    expect(last.state.pods.find((p) => p.name === 'big')).toMatchObject({ node: null, phase: 'Pending' });
  });

  it('counts each reason separately', () => {
    const run = simulate(cfg({ scenario: 'pending', cpu: 1600, mem: 3800, nodes: [...DEFAULT_CONFIG.nodes.slice(0, 2), { cpu: 2000, mem: 3000 }] }));
    expect(run.steps.at(-1)!.message).toBe('0/3 nodes are available: 3 Insufficient memory, 2 Insufficient cpu.');
  });
});

describe('deployment', () => {
  it('spreads replicas, scales and replaces pods from a failed node', () => {
    const run = simulate(cfg({ scenario: 'deploy', replicas: 3, scaleTo: 4, failNode: 2 }));
    const allRun = run.steps.find((s) => s.kind === 'allRunning')!;
    const web = allRun.state.pods.filter((p) => !p.system);
    expect(web.map((p) => p.node)).toEqual([2, 2, 1]);
    const end = run.steps.at(-1)!.state;
    const live = end.pods.filter((p) => !p.system);
    expect(live).toHaveLength(4);
    expect(live.every((p) => p.node !== 2 && p.phase === 'Running')).toBe(true);
    expect(run.steps.some((s) => s.kind === 'evict' && s.n === 300)).toBe(true);
  });

  it('scale down removes pods', () => {
    const run = simulate(cfg({ scenario: 'deploy', replicas: 3, scaleTo: 1, failNode: 0 }));
    expect(run.steps.find((s) => s.kind === 'scaleDown')!.n).toBe(2);
  });
});

describe('limits', () => {
  it('OOMKills a container over its memory limit and backs off into CrashLoopBackOff', () => {
    const run = simulate(cfg({ scenario: 'oom', memLim: 768, usage: 1024 }));
    expect(run.steps.filter((s) => s.kind === 'oom')).toHaveLength(3);
    expect(run.steps.filter((s) => s.kind === 'backoff').map((s) => s.n)).toEqual([10, 20, 40]);
    expect(run.steps.some((s) => s.state.pods.some((p) => p.phase === 'CrashLoopBackOff'))).toBe(true);
    expect(run.steps.at(-1)!.state.pods.find((p) => p.name === 'app')!.restarts).toBe(3);
  });

  it('only throttles CPU, and a pod under its memory limit keeps running', () => {
    const run = simulate(cfg({ scenario: 'oom', memLim: 2048, usage: 1024 }));
    expect(run.steps.some((s) => s.kind === 'throttle')).toBe(true);
    expect(run.steps.some((s) => s.kind === 'oom')).toBe(false);
    expect(run.steps.at(-1)!.kind).toBe('fits');
  });

  it('classifies QoS', () => {
    expect(qosClass({ cpu: 500, mem: 512, cpuLim: 500, memLim: 512 })).toBe('Guaranteed');
    expect(qosClass({ cpu: 500, mem: 512, cpuLim: 1000, memLim: 512 })).toBe('Burstable');
  });
});

describe('service', () => {
  it('load-balances over ready endpoints and drops a pod that fails readiness', () => {
    const run = simulate(cfg({ scenario: 'service', replicas: 3 }));
    const reqs = run.steps.filter((s) => s.kind === 'request').map((s) => s.pod);
    expect(reqs).toEqual(['web-a', 'web-b', 'web-c', 'web-b', 'web-c', 'web-c']);
    const fail = run.steps.find((s) => s.kind === 'probeFail')!;
    expect(fail.state.endpoints).toEqual(['web-b', 'web-c']);
    expect(run.steps.at(-1)!.state.endpoints).toHaveLength(3);
  });

  it('with one replica, a failed probe leaves no endpoints', () => {
    const run = simulate(cfg({ scenario: 'service', replicas: 1 }));
    const after = run.steps.filter((s) => s.kind === 'request' && s.pod === undefined);
    expect(after.length).toBeGreaterThan(0);
  });
});
