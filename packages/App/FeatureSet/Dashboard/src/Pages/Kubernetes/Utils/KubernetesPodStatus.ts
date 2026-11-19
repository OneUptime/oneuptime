import { JSONObject } from "Common/Types/JSON";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { ResourcePartTone } from "../../../Components/ResourcePart/ResourcePartTypes";
import { KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/KubernetesClusterMetricDescriptions";
import {
  KubernetesProblemKind,
  KubernetesProblemQuery,
} from "./KubernetesProblemItems";

/*
 * THE POD AND NODE COUNTS ON A KUBERNETES CLUSTER'S HERO.
 *
 * Each pod once, the way kubectl's STATUS column says it (the server's
 * podStatusCounts, KubernetesHealth.getKubernetesPodStatusBucket): Running,
 * then each word for a container that cannot run - "2 CrashLoopBackOff",
 * "1 ImagePullBackOff" - then Pending, Failed and Unknown, and the nodes
 * that are not ready. The hero counted phases, so "71 Running" held the pods
 * that crash-looped, and "3 Failed" was a pill with an (i) that said what
 * Failed means but never which pods or why (#9537). Every count of
 * something wrong now opens the list of exactly those pods or nodes, why
 * and since when (KubernetesProblemItems).
 *
 * React-free, so App tests can read it.
 */

export interface KubernetesPodStatusCountsRead {
  running: number;
  pending: number;
  failed: number;
  succeeded: number;
  unknown: number;
  // By kubectl's word, the most first; "" when the server read no word.
  cannotRun: Array<{ reason: string; count: number }>;
}

function readCount(source: unknown, key: string): number {
  if (!source || typeof source !== "object") {
    return 0;
  }
  const value: unknown = (source as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

/*
 * The counts from the inventory summary. Defensive: an answer from an older
 * server has only the phases (podPhaseCounts), which are read as they
 * always were - nothing counted as unable to run.
 */
export function parseKubernetesPodStatusCounts(
  summary: JSONObject | null | undefined,
): KubernetesPodStatusCountsRead {
  const status: unknown = summary?.["podStatusCounts"];

  if (status && typeof status === "object" && !Array.isArray(status)) {
    const cannotRun: Array<{ reason: string; count: number }> = [];
    const rows: unknown = (status as Record<string, unknown>)["cannotRun"];
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const count: number = readCount(row, "count");
        const reason: unknown = (row as Record<string, unknown> | null)?.[
          "reason"
        ];
        if (count > 0) {
          cannotRun.push({
            reason: typeof reason === "string" ? reason : "",
            count: count,
          });
        }
      }
    }
    return {
      running: readCount(status, "running"),
      pending: readCount(status, "pending"),
      failed: readCount(status, "failed"),
      succeeded: readCount(status, "succeeded"),
      unknown: readCount(status, "unknown"),
      cannotRun: cannotRun,
    };
  }

  const phases: unknown = summary?.["podPhaseCounts"];
  return {
    running: readCount(phases, "running"),
    pending: readCount(phases, "pending"),
    failed: readCount(phases, "failed"),
    succeeded: readCount(phases, "succeeded"),
    unknown: 0,
    cannotRun: [],
  };
}

// Every pod that cannot run, whatever the word.
export function countKubernetesPodsThatCannotRun(
  counts: KubernetesPodStatusCountsRead,
): number {
  return counts.cannotRun.reduce(
    (total: number, row: { count: number }): number => {
      return total + row.count;
    },
    0,
  );
}

/*
 * ---------------------------------------------------------------------------
 * The chips
 * ---------------------------------------------------------------------------
 */

/*
 * What pressing a chip opens: the count's pods or nodes, and the dialog's
 * words. The title is a plural template (its count is the chip's); the
 * rest are English, looked up where drawn.
 */
export interface KubernetesStatusChipProblem {
  query: KubernetesProblemQuery;
  title: PluralTemplate;
  description: string;
  emptyMessage: string;
  whatFailed: string;
  hint: string;
}

/*
 * A chip's words are its count and one of these, as the hero always drew
 * them: a status word looked up in the reader's language ("Failed"), a
 * Kubernetes word drawn as written ("CrashLoopBackOff"), or a plural
 * sentence where the words follow the count ("1 Node Not Ready").
 */
export interface KubernetesStatusChip {
  // Stable, for React and a test: "running", "cannotRun:CrashLoopBackOff".
  key: string;
  // What a test reads in data-chip: "Running", "CrashLoopBackOff", "Failed".
  name: string;
  count: number;
  tone: ResourcePartTone;
  // An English status word after the count, looked up where drawn.
  word?: string | undefined;
  // Kubernetes' own word after the count, drawn as written.
  reasonAsWritten?: string | undefined;
  // A sentence the count goes into.
  plural?: PluralTemplate | undefined;
  /*
   * What a press opens; none for Running, which is fine and is explained
   * by its (i) (description).
   */
  problem?: KubernetesStatusChipProblem | undefined;
  description?: string | undefined;
}

/*
 * The values the dialog's title takes: Kubernetes' word, as written, for a
 * count of pods that cannot run.
 */
export function getKubernetesStatusChipValues(
  chip: KubernetesStatusChip,
): Record<string, string> | undefined {
  return chip.reasonAsWritten ? { reason: chip.reasonAsWritten } : undefined;
}

// The status words after a chip's count: the words the hero always drew.
const STATUS_RUNNING: string = translationKey("Running");
const STATUS_PENDING: string = translationKey("Pending");
const STATUS_FAILED: string = translationKey("Failed");
const STATUS_UNKNOWN: string = translationKey("Unknown");
// A pod that cannot run whose word the server could not read.
const STATUS_CANNOT_RUN: string = translationKey("Can't run");

// What a press shows, and what a read that failed says, wherever pods are counted.
export const KUBERNETES_POD_HINT: string = translationKey(
  "Show which pods and why",
);
const POD_HINT: string = KUBERNETES_POD_HINT;
export const KUBERNETES_NODE_HINT: string = translationKey(
  "Show which nodes and why",
);
const NODE_HINT: string = KUBERNETES_NODE_HINT;
export const KUBERNETES_PODS_WHAT_FAILED: string = translationKey(
  "Couldn't read these pods.",
);
const PODS_WHAT_FAILED: string = KUBERNETES_PODS_WHAT_FAILED;
export const KUBERNETES_NODES_WHAT_FAILED: string = translationKey(
  "Couldn't read these nodes.",
);
const NODES_WHAT_FAILED: string = KUBERNETES_NODES_WHAT_FAILED;

const CANNOT_RUN_EMPTY: string = translationKey(
  "No pod is failing this way now: it recovered or was replaced since the count was read.",
);
const PENDING_EMPTY: string = translationKey(
  "No pod is pending now: each has started or gone since the count was read.",
);
export const KUBERNETES_FAILED_PODS_EMPTY: string = translationKey(
  "No failed pods now: they were cleaned up since the count was read.",
);
const FAILED_EMPTY: string = KUBERNETES_FAILED_PODS_EMPTY;
const UNKNOWN_EMPTY: string = translationKey(
  "No pod is in an unknown state now.",
);
export const KUBERNETES_NODES_EMPTY: string = translationKey(
  "Every node is ready now.",
);
const NODES_EMPTY: string = KUBERNETES_NODES_EMPTY;

/*
 * What pressing a count of pods that cannot run opens: those of one word
 * ("CrashLoopBackOff"), or every one of them when no word is given - the
 * Pod Health bar's "Can't run".
 */
export function getKubernetesCannotRunProblem(
  reason?: string | undefined,
): KubernetesStatusChipProblem {
  return {
    query: {
      kind: KubernetesProblemKind.CannotRun,
      reason: reason || undefined,
    },
    title: reason
      ? {
          one: "{{count}} pod in {{reason}}",
          other: "{{count}} pods in {{reason}}",
        }
      : {
          one: "{{count}} pod with a container that can't run",
          other: "{{count}} pods with a container that can't run",
        },
    description: KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS.podsCannotRun,
    emptyMessage: CANNOT_RUN_EMPTY,
    whatFailed: PODS_WHAT_FAILED,
    hint: POD_HINT,
  };
}

export const KUBERNETES_PENDING_PODS_PROBLEM: KubernetesStatusChipProblem = {
  query: { kind: KubernetesProblemKind.Pending },
  title: {
    one: "{{count}} pending pod",
    other: "{{count}} pending pods",
  },
  description: KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS.podsPending,
  emptyMessage: PENDING_EMPTY,
  whatFailed: PODS_WHAT_FAILED,
  hint: POD_HINT,
};

export const KUBERNETES_FAILED_PODS_PROBLEM: KubernetesStatusChipProblem = {
  query: { kind: KubernetesProblemKind.Failed },
  title: { one: "{{count}} failed pod", other: "{{count}} failed pods" },
  description: KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS.podsFailed,
  emptyMessage: FAILED_EMPTY,
  whatFailed: PODS_WHAT_FAILED,
  hint: POD_HINT,
};

export const KUBERNETES_UNKNOWN_PODS_PROBLEM: KubernetesStatusChipProblem = {
  query: { kind: KubernetesProblemKind.Unknown },
  title: {
    one: "{{count}} pod in an unknown state",
    other: "{{count}} pods in an unknown state",
  },
  description: KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS.podsUnknown,
  emptyMessage: UNKNOWN_EMPTY,
  whatFailed: PODS_WHAT_FAILED,
  hint: POD_HINT,
};

export const KUBERNETES_NODES_NOT_READY_PROBLEM: KubernetesStatusChipProblem = {
  query: { kind: KubernetesProblemKind.NodesNotReady },
  title: {
    one: "{{count}} node not ready",
    other: "{{count}} nodes not ready",
  },
  description: KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS.nodesNotReady,
  emptyMessage: NODES_EMPTY,
  whatFailed: NODES_WHAT_FAILED,
  hint: NODE_HINT,
};

export function getKubernetesStatusChips(data: {
  pods: KubernetesPodStatusCountsRead;
  nodesNotReady: number;
}): Array<KubernetesStatusChip> {
  const chips: Array<KubernetesStatusChip> = [];
  const pods: KubernetesPodStatusCountsRead = data.pods;

  if (pods.running > 0) {
    chips.push({
      key: "running",
      name: "Running",
      count: pods.running,
      tone: "positive",
      word: STATUS_RUNNING,
      description: KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS.podsRunning,
    });
  }

  for (const row of data.pods.cannotRun) {
    const hasWord: boolean = Boolean(row.reason);
    chips.push({
      key: `cannotRun:${row.reason}`,
      name: hasWord ? row.reason : STATUS_CANNOT_RUN,
      count: row.count,
      tone: "danger",
      reasonAsWritten: hasWord ? row.reason : undefined,
      word: hasWord ? undefined : STATUS_CANNOT_RUN,
      problem: getKubernetesCannotRunProblem(row.reason || undefined),
    });
  }

  if (pods.pending > 0) {
    chips.push({
      key: "pending",
      name: "Pending",
      count: pods.pending,
      tone: "warning",
      word: STATUS_PENDING,
      problem: KUBERNETES_PENDING_PODS_PROBLEM,
    });
  }

  if (pods.failed > 0) {
    chips.push({
      key: "failed",
      name: "Failed",
      count: pods.failed,
      tone: "danger",
      word: STATUS_FAILED,
      problem: KUBERNETES_FAILED_PODS_PROBLEM,
    });
  }

  if (pods.unknown > 0) {
    chips.push({
      key: "unknown",
      name: "Unknown",
      count: pods.unknown,
      tone: "warning",
      word: STATUS_UNKNOWN,
      problem: KUBERNETES_UNKNOWN_PODS_PROBLEM,
    });
  }

  if (data.nodesNotReady > 0) {
    chips.push({
      key: "nodesNotReady",
      name: "Nodes Not Ready",
      count: data.nodesNotReady,
      tone: "danger",
      plural: {
        one: "{{count}} Node Not Ready",
        other: "{{count}} Nodes Not Ready",
      },
      problem: KUBERNETES_NODES_NOT_READY_PROBLEM,
    });
  }

  return chips;
}
