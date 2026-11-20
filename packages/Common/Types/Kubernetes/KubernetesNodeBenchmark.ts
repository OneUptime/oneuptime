/*
 * WHAT KUBE-BENCH FOUND ON A NODE (#9873).
 *
 * The CIS Kubernetes Benchmark's node and control plane controls can only be
 * read on the nodes. The kubernetes-agent chart's compliance.nodeBenchmark
 * runs kube-bench there on a schedule, in pods labelled component:
 * node-benchmark, and each pod's kube-bench container writes what it found as
 * its termination message (templates/_node-benchmark.tpl):
 *
 *   {"oneuptimeNodeBenchmark":1,"benchmark":"cis-1.12",
 *    "targets":"master etcd controlplane node",
 *    "pass":"1.1.1 1.1.2 ...","fail":"1.2.15 4.1.1","warn":"","manual":"1.1.9 ..."}
 *
 * each check's number by its result - a scored check that passed, failed, or
 * could not be checked, and the checks the benchmark marks manual - and never
 * the benchmark's text, which CIS licenses for non-commercial use. Or, when
 * kube-bench could not finish, why:
 *
 *   {"oneuptimeNodeBenchmark":1,"benchmark":"cis-1.12","error":"..."}
 *
 * The kubelet keeps that message in the pod's status, which the agent's
 * resource snapshots already carry. The inventory reads it into a block of
 * the pod's stored spec (spec.nodeBenchmark), with when the run finished, as
 * it reads a pod's security (KubernetesPodSecurity); the Compliance page
 * scores the blocks. Pure: the ingest, the scoring and their tests read it.
 */

// The label the chart's kube-bench pods carry, and its value.
export const NODE_BENCHMARK_COMPONENT_LABEL: string = "component";
export const NODE_BENCHMARK_COMPONENT: string = "node-benchmark";

// The container whose termination message holds the results.
export const NODE_BENCHMARK_CONTAINER: string = "kube-bench";

// The message's own version: what the chart writes.
export const NODE_BENCHMARK_MESSAGE_VERSION: number = 1;

// Raised when the stored block changes shape, so a reader can tell an old one apart.
export const NODE_BENCHMARK_BLOCK_VERSION: number = 1;

/*
 * The kubelet keeps at most 4096 bytes of a container's termination message;
 * a control plane node's results come to well under 1 KB.
 */
export const NODE_BENCHMARK_MESSAGE_MAX_LENGTH: number = 4096;

// The most checks one block keeps of each result: every benchmark has fewer.
const MAX_CHECKS: number = 500;

// The longest reason kube-bench could not finish that a block keeps.
export const NODE_BENCHMARK_ERROR_MAX_LENGTH: number = 300;

// kube-bench's targets whose checks the Compliance page scores.
export enum NodeBenchmarkTarget {
  Master = "master",
  Etcd = "etcd",
  ControlPlane = "controlplane",
  Node = "node",
}

const TARGETS: ReadonlyArray<string> = Object.values(NodeBenchmarkTarget);

// A check's number in a benchmark: "1.2.15", "2.1", "3.2.9".
const CHECK_ID: RegExp = /^[0-9]{1,3}(\.[0-9]{1,3}){0,4}$/;

// A benchmark as kube-bench names its configuration: "cis-1.12", "eks-1.8.0".
const BENCHMARK_NAME: RegExp = /^[a-z][a-z0-9]*(-[a-z0-9.]+)+$/;

export interface KubernetesNodeBenchmarkBlock {
  version: number;
  // The benchmark kube-bench scored: "cis-1.12".
  benchmark: string;
  // The targets it ran on this node: the control plane's only where they run.
  targets: Array<NodeBenchmarkTarget>;
  // Scored checks, by their result.
  pass: Array<string>;
  fail: Array<string>;
  // Scored checks kube-bench could not check, or skipped.
  warn: Array<string>;
  // The checks the benchmark marks manual: never scored.
  manual: Array<string>;
  // Why kube-bench could not finish, as it said: no results then.
  error?: string | undefined;
  // When the run finished, as the kubelet says.
  finishedAt?: string | undefined;
}

type Plain = Record<string, unknown>;

function asObject(value: unknown): Plain | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Plain)
    : null;
}

function compareCheckIds(a: string, b: string): number {
  const left: Array<number> = a.split(".").map(Number);
  const right: Array<number> = b.split(".").map(Number);

  for (
    let index: number = 0;
    index < Math.max(left.length, right.length);
    index++
  ) {
    const difference: number = (left[index] ?? -1) - (right[index] ?? -1);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

export function sortCheckIds(ids: Iterable<string>): Array<string> {
  return Array.from(new Set(ids)).sort(compareCheckIds);
}

export function isNodeBenchmarkCheckId(value: unknown): value is string {
  return typeof value === "string" && CHECK_ID.test(value);
}

export function isNodeBenchmarkName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    BENCHMARK_NAME.test(value)
  );
}

// A list of check numbers, as the message or a stored block holds one.
function readCheckIds(value: unknown): Array<string> {
  const items: Array<unknown> =
    typeof value === "string"
      ? value.split(/\s+/)
      : Array.isArray(value)
        ? value
        : [];

  return sortCheckIds(
    items.filter(isNodeBenchmarkCheckId).slice(0, MAX_CHECKS),
  );
}

function readTargets(value: unknown): Array<NodeBenchmarkTarget> {
  const items: Array<unknown> =
    typeof value === "string"
      ? value.split(/\s+/)
      : Array.isArray(value)
        ? value
        : [];
  const named: Set<string> = new Set<string>(
    items.filter((item: unknown): item is string => {
      return typeof item === "string";
    }),
  );

  // In kube-bench's own order.
  return TARGETS.filter((target: string): boolean => {
    return named.has(target);
  }) as Array<NodeBenchmarkTarget>;
}

/*
 * Why a run could not finish, on one line: its end, where a log says what
 * stopped it, when it is longer than a block keeps.
 */
function readError(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const text: string = value.replace(/\s+/g, " ").trim();

  return text
    ? text.slice(Math.max(0, text.length - NODE_BENCHMARK_ERROR_MAX_LENGTH))
    : undefined;
}

function readTime(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) {
    return undefined;
  }

  const time: number = new Date(value).getTime();

  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/*
 * A check is said once: a number both passed and failed - which the message
 * never holds - reads as failing, and one marked manual is never scored.
 */
function withoutRepeats(
  block: KubernetesNodeBenchmarkBlock,
): KubernetesNodeBenchmarkBlock {
  const fail: Set<string> = new Set<string>(block.fail);
  const warn: Set<string> = new Set<string>(
    block.warn.filter((id: string): boolean => {
      return !fail.has(id);
    }),
  );
  const pass: Array<string> = block.pass.filter((id: string): boolean => {
    return !fail.has(id) && !warn.has(id);
  });
  const scored: Set<string> = new Set<string>([...fail, ...warn, ...pass]);

  return {
    ...block,
    pass,
    fail: Array.from(fail),
    warn: Array.from(warn),
    manual: block.manual.filter((id: string): boolean => {
      return !scored.has(id);
    }),
  };
}

function readBlock(
  plain: Plain,
  finishedAt: unknown,
): KubernetesNodeBenchmarkBlock | null {
  const benchmark: unknown = plain["benchmark"];

  if (!isNodeBenchmarkName(benchmark)) {
    return null;
  }

  const error: string | undefined = readError(plain["error"]);
  const block: KubernetesNodeBenchmarkBlock = withoutRepeats({
    version: NODE_BENCHMARK_BLOCK_VERSION,
    benchmark,
    targets: readTargets(plain["targets"]),
    pass: error ? [] : readCheckIds(plain["pass"]),
    fail: error ? [] : readCheckIds(plain["fail"]),
    warn: error ? [] : readCheckIds(plain["warn"]),
    manual: error ? [] : readCheckIds(plain["manual"]),
  });

  if (error) {
    block.error = error;
  }

  const time: string | undefined = readTime(finishedAt);

  if (time) {
    block.finishedAt = time;
  }

  // A run that reported nothing at all, and no reason, said nothing.
  if (
    !block.error &&
    block.pass.length +
      block.fail.length +
      block.warn.length +
      block.manual.length ===
      0
  ) {
    return null;
  }

  return block;
}

/*
 * A kube-bench container's termination message read, defensively: the
 * chart's message of this version, every check a number, at most what the
 * kubelet keeps. Anything else - another container's message, a truncated
 * one, a forged block of text - is null, and the pod reads as having no
 * results rather than as one whose node passes.
 */
export function readNodeBenchmarkMessage(
  message: string,
  finishedAt?: string | undefined,
): KubernetesNodeBenchmarkBlock | null {
  if (
    typeof message !== "string" ||
    message.length > NODE_BENCHMARK_MESSAGE_MAX_LENGTH
  ) {
    return null;
  }

  let parsed: unknown = null;

  try {
    parsed = JSON.parse(message.trim());
  } catch {
    return null;
  }

  const plain: Plain | null = asObject(parsed);

  if (
    !plain ||
    plain["oneuptimeNodeBenchmark"] !== NODE_BENCHMARK_MESSAGE_VERSION
  ) {
    return null;
  }

  return readBlock(plain, finishedAt);
}

// A stored block read back, defensively; anything else is null.
export function toNodeBenchmarkBlock(
  value: unknown,
): KubernetesNodeBenchmarkBlock | null {
  const plain: Plain | null = asObject(value);

  if (!plain || plain["version"] !== NODE_BENCHMARK_BLOCK_VERSION) {
    return null;
  }

  return readBlock(plain, plain["finishedAt"]);
}

// Whether a pod is one of the chart's kube-bench pods, by its labels.
export function isNodeBenchmarkPod(
  labels: Record<string, string> | null | undefined,
): boolean {
  return (
    (labels || {})[NODE_BENCHMARK_COMPONENT_LABEL] === NODE_BENCHMARK_COMPONENT
  );
}

/*
 * ---------------------------------------------------------------------------
 * Benchmarks and their families
 * ---------------------------------------------------------------------------
 *
 * kube-bench's benchmarks come in families that number their controls one
 * way: the generic CIS Kubernetes Benchmark (cis-1.12, cis-1.11), whose
 * sections 1 to 4 number them as OneUptime's CIS Kubernetes Benchmark v2.0
 * does, and the managed platforms' (CIS Amazon EKS, GKE and AKS Benchmarks),
 * which score only the worker nodes, in a section 3 of their own. A family's
 * controls are scored as part of the CIS framework, under a requirement that
 * names the family where its numbers are its own: "EKS 3.2.1", never "3.2.1",
 * which is the generic benchmark's audit policy control.
 */
export enum NodeBenchmarkFamily {
  Cis = "cis",
  Eks = "eks",
  Gke = "gke",
  Aks = "aks",
}

// Each family's prefix on its requirements: none for the generic benchmark's.
export const NODE_BENCHMARK_FAMILY_PREFIX: Readonly<
  Record<NodeBenchmarkFamily, string>
> = {
  [NodeBenchmarkFamily.Cis]: "",
  [NodeBenchmarkFamily.Eks]: "EKS ",
  [NodeBenchmarkFamily.Gke]: "GKE ",
  [NodeBenchmarkFamily.Aks]: "AKS ",
};

// The managed platforms' families: their control plane is the provider's.
export const MANAGED_NODE_BENCHMARK_FAMILIES: ReadonlyArray<NodeBenchmarkFamily> =
  [NodeBenchmarkFamily.Eks, NodeBenchmarkFamily.Gke, NodeBenchmarkFamily.Aks];

/*
 * The benchmark each managed platform's cluster should run, by the provider
 * the agent names (KubernetesClusterProvider): what the chart's "auto" picks,
 * or, on AKS, what to set. The benchmark kube-bench v0.16.0 ships newest.
 */
export const NODE_BENCHMARK_FOR_PROVIDER: Readonly<Record<string, string>> = {
  EKS: "eks-1.8.0",
  GKE: "gke-1.9.0",
  AKS: "aks-1.8",
};

// The generic benchmark's names: "cis-1.12", never "k3s-cis-1.9".
const GENERIC_BENCHMARK: RegExp = /^cis-[0-9]/;

/*
 * A check's number as the benchmarks write it, in the sections kube-bench
 * reads: etcd's, section 2, in two parts ("2.1"), the others in three
 * ("1.2.16", "4.1.1"); a group's ("4.1") is no check. The generic
 * benchmark's are sections 1 to 4, as 5 is the API's; a managed platform's
 * are its worker node section, 3.
 */
const GENERIC_NODE_CHECK: RegExp =
  /^(2\.[0-9]{1,3}|[134]\.[0-9]{1,3}\.[0-9]{1,3})$/;
const MANAGED_NODE_CHECK: RegExp = /^3\.[0-9]{1,3}\.[0-9]{1,3}$/;

// A benchmark's family: null for one the page does not score (rh-1.9, k3s-cis-1.9).
export function getNodeBenchmarkFamily(
  benchmark: string,
): NodeBenchmarkFamily | null {
  if (GENERIC_BENCHMARK.test(benchmark)) {
    return NodeBenchmarkFamily.Cis;
  }

  for (const family of MANAGED_NODE_BENCHMARK_FAMILIES) {
    if (benchmark.startsWith(`${family}-`)) {
      return family;
    }
  }

  return null;
}

// The requirement a family's check is scored under: "4.2.1", "EKS 3.2.1".
export function getNodeBenchmarkRequirement(
  family: NodeBenchmarkFamily,
  checkId: string,
): string {
  return `${NODE_BENCHMARK_FAMILY_PREFIX[family]}${checkId}`;
}

/*
 * The family and check a requirement names, or null for one no family's
 * checks are scored under (GENERIC_NODE_CHECK, MANAGED_NODE_CHECK).
 */
export function readNodeBenchmarkRequirement(
  requirement: string,
): { family: NodeBenchmarkFamily; checkId: string } | null {
  for (const family of MANAGED_NODE_BENCHMARK_FAMILIES) {
    const prefix: string = NODE_BENCHMARK_FAMILY_PREFIX[family];

    if (requirement.startsWith(prefix)) {
      const checkId: string = requirement.slice(prefix.length);

      return MANAGED_NODE_CHECK.test(checkId) ? { family, checkId } : null;
    }
  }

  return GENERIC_NODE_CHECK.test(requirement)
    ? { family: NodeBenchmarkFamily.Cis, checkId: requirement }
    : null;
}

export function isNodeBenchmarkRequirement(requirement: string): boolean {
  return readNodeBenchmarkRequirement(requirement) !== null;
}
