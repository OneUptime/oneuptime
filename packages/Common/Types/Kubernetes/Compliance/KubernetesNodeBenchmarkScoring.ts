import {
  KubernetesNodeBenchmarkBlock,
  MANAGED_NODE_BENCHMARK_FAMILIES,
  NODE_BENCHMARK_FOR_PROVIDER,
  NodeBenchmarkFamily,
  NodeBenchmarkTarget,
  getNodeBenchmarkFamily,
  getNodeBenchmarkRequirement,
  sortCheckIds,
} from "../KubernetesNodeBenchmark";
import {
  KubernetesComplianceNodeBenchmark,
  KubernetesComplianceNodeBenchmarkNode,
} from "./KubernetesComplianceApiTypes";
import {
  KubernetesComplianceDetail,
  KubernetesComplianceFinding,
} from "./KubernetesComplianceFinding";
import { KubernetesComplianceNodeBenchmarkRun } from "./KubernetesComplianceSnapshot";

/*
 * WHAT THE CIS BENCHMARK'S NODE AND CONTROL PLANE CONTROLS SCORE (#9873).
 *
 * kube-bench runs on a node per node group, and on a control plane node
 * where the cluster runs its own (KubernetesNodeBenchmark). Each node's
 * newest run is what counts: the CronJobs keep the last one's pod for its
 * results, and a run that could not finish after it is said, not scored.
 * Runs of one benchmark family are scored together - the family of the
 * newest run - so a cluster moved from the generic benchmark to EKS's is
 * scored by EKS's once it runs, and the generic one's older pods fall away.
 *
 * A check is scored when kube-bench scored it on a node: failing when a node
 * fails it, by that node; passing when nodes pass it and none fails; and not
 * evaluated when kube-bench could not check it anywhere. A check the
 * benchmark marks manual is never scored: the page lists it with the
 * benchmark's other controls a person reviews.
 *
 * Pure: the scoring reads it, and its tests pin it.
 */

// The scope of a cluster's kube-bench runs that are scored.
export interface NodeBenchmarkScope {
  family: NodeBenchmarkFamily;
  // The benchmark the newest run scored: "eks-1.8.0".
  benchmark: string;
  // Each node's newest run that finished with results, by node.
  runs: Array<KubernetesComplianceNodeBenchmarkRun>;
  // Each node's newest run that could not finish, when newer than its results.
  failedRuns: Array<KubernetesComplianceNodeBenchmarkRun>;
  // The scored checks any node reported, in the benchmark's order.
  checks: Array<string>;
  // The checks the benchmark marks manual, never scored.
  manual: Array<string>;
}

function finishedAt(run: KubernetesComplianceNodeBenchmarkRun): number {
  const time: number = run.result.finishedAt
    ? new Date(run.result.finishedAt).getTime()
    : 0;

  return Number.isNaN(time) ? 0 : time;
}

// The newest first; of two finished at once, the one named first.
function compareNewest(
  a: KubernetesComplianceNodeBenchmarkRun,
  b: KubernetesComplianceNodeBenchmarkRun,
): number {
  return finishedAt(b) - finishedAt(a) || a.pod.name.localeCompare(b.pod.name);
}

function hasResults(result: KubernetesNodeBenchmarkBlock): boolean {
  return !result.error;
}

/*
 * The runs that are scored: of the family of the newest run kube-bench
 * finished, each node's newest; null when no run of a benchmark the page
 * scores reached OneUptime.
 */
export function getNodeBenchmarkScope(
  runs: ReadonlyArray<KubernetesComplianceNodeBenchmarkRun> | undefined,
): NodeBenchmarkScope | null {
  const known: Array<KubernetesComplianceNodeBenchmarkRun> = (runs || [])
    .filter((run: KubernetesComplianceNodeBenchmarkRun): boolean => {
      return (
        Boolean(run.node) &&
        getNodeBenchmarkFamily(run.result.benchmark) !== null
      );
    })
    .sort(compareNewest);
  const newest: KubernetesComplianceNodeBenchmarkRun | undefined =
    known.find((run: KubernetesComplianceNodeBenchmarkRun): boolean => {
      return hasResults(run.result);
    }) || known[0];

  if (!newest) {
    return null;
  }

  const family: NodeBenchmarkFamily = getNodeBenchmarkFamily(
    newest.result.benchmark,
  )!;
  const scored: Map<string, KubernetesComplianceNodeBenchmarkRun> = new Map();
  const failed: Map<string, KubernetesComplianceNodeBenchmarkRun> = new Map();

  for (const run of known) {
    if (getNodeBenchmarkFamily(run.result.benchmark) !== family) {
      continue;
    }

    if (hasResults(run.result)) {
      if (!scored.has(run.node)) {
        scored.set(run.node, run);
      }
    } else if (!scored.has(run.node) && !failed.has(run.node)) {
      // Newest first: a failure is said only while no newer run has results.
      failed.set(run.node, run);
    }
  }

  const scoredRuns: Array<KubernetesComplianceNodeBenchmarkRun> = Array.from(
    scored.values(),
  ).sort(
    (
      a: KubernetesComplianceNodeBenchmarkRun,
      b: KubernetesComplianceNodeBenchmarkRun,
    ): number => {
      return a.node.localeCompare(b.node);
    },
  );
  const checks: Array<string> = sortCheckIds(
    scoredRuns.flatMap(
      (run: KubernetesComplianceNodeBenchmarkRun): Array<string> => {
        return [...run.result.pass, ...run.result.fail, ...run.result.warn];
      },
    ),
  );
  const checked: Set<string> = new Set<string>(checks);

  return {
    family,
    benchmark: newest.result.benchmark,
    runs: scoredRuns,
    failedRuns: Array.from(failed.values()).sort(
      (
        a: KubernetesComplianceNodeBenchmarkRun,
        b: KubernetesComplianceNodeBenchmarkRun,
      ): number => {
        return a.node.localeCompare(b.node);
      },
    ),
    checks,
    manual: sortCheckIds(
      scoredRuns.flatMap(
        (run: KubernetesComplianceNodeBenchmarkRun): Array<string> => {
          return run.result.manual;
        },
      ),
    ).filter((id: string): boolean => {
      return !checked.has(id);
    }),
  };
}

export function isManagedNodeBenchmarkFamily(
  family: NodeBenchmarkFamily,
): boolean {
  return MANAGED_NODE_BENCHMARK_FAMILIES.includes(family);
}

// Whether a run read the control plane: kube-bench found the API server there.
export function readsControlPlane(
  run: KubernetesComplianceNodeBenchmarkRun,
): boolean {
  return run.result.targets.includes(NodeBenchmarkTarget.Master);
}

export interface NodeBenchmarkCheckResult {
  // The nodes that fail it, by name.
  failing: Array<string>;
  // The nodes that pass it.
  passing: Array<string>;
}

// How the scored runs stand on one check.
export function getNodeBenchmarkCheckResult(
  scope: NodeBenchmarkScope,
  checkId: string,
): NodeBenchmarkCheckResult {
  const result: NodeBenchmarkCheckResult = { failing: [], passing: [] };

  for (const run of scope.runs) {
    if (run.result.fail.includes(checkId)) {
      result.failing.push(run.node);
    } else if (run.result.pass.includes(checkId)) {
      result.passing.push(run.node);
    }
  }

  return result;
}

/*
 * What the page says of the runs scored: each node's newest run, its
 * failure when one came after its results, the controls the benchmark marks
 * manual, and - where the cluster's platform has a benchmark of its own and
 * kube-bench ran the generic one - which to set. Null when none ran.
 */
export function summarizeNodeBenchmark(
  scope: NodeBenchmarkScope | null,
  provider: string | null,
): KubernetesComplianceNodeBenchmark | null {
  if (!scope) {
    return null;
  }

  const byNode: Map<string, KubernetesComplianceNodeBenchmarkNode> = new Map();

  for (const run of scope.runs) {
    byNode.set(run.node, {
      node: run.node,
      benchmark: run.result.benchmark,
      targets: [...run.result.targets],
      finishedAt: run.result.finishedAt || null,
      isControlPlane: readsControlPlane(run),
      error: null,
    });
  }

  for (const run of scope.failedRuns) {
    const scored: KubernetesComplianceNodeBenchmarkNode | undefined =
      byNode.get(run.node);

    byNode.set(run.node, {
      node: run.node,
      benchmark: run.result.benchmark,
      targets: scored?.targets || [...run.result.targets],
      finishedAt: run.result.finishedAt || null,
      isControlPlane: scored?.isControlPlane || readsControlPlane(run),
      error: run.result.error || null,
    });
  }

  const suggested: string | undefined = provider
    ? NODE_BENCHMARK_FOR_PROVIDER[provider]
    : undefined;

  return {
    benchmark: scope.benchmark,
    family: scope.family,
    nodes: Array.from(byNode.values()).sort(
      (
        a: KubernetesComplianceNodeBenchmarkNode,
        b: KubernetesComplianceNodeBenchmarkNode,
      ): number => {
        return a.node.localeCompare(b.node);
      },
    ),
    manual: scope.manual.map((checkId: string): string => {
      return getNodeBenchmarkRequirement(scope.family, checkId);
    }),
    suggestedBenchmark:
      scope.family === NodeBenchmarkFamily.Cis && suggested ? suggested : null,
  };
}

// A node a control fails on, as a finding names it: the node's own page.
export function getNodeFinding(
  node: string,
  details: Array<KubernetesComplianceDetail> = [],
): KubernetesComplianceFinding {
  return { object: { kind: "Node", namespace: "", name: node }, details };
}
