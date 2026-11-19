import {
  KubernetesHealthAssessment,
  KubernetesHealthRow,
  KubernetesHealthSeverity,
  KubernetesHealthText,
  KubernetesObjectRef,
  KubernetesPodStatusBucket,
  KubernetesPodStatusBucketOf,
  assessKubernetesNode,
  assessKubernetesPod,
  getKubernetesPodStatusBucket,
  getKubernetesPodWorkload,
  kubernetesObjectKey,
} from "Common/Types/Kubernetes/KubernetesHealth";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { KubernetesEventRow } from "../../../Components/Kubernetes/KubernetesEventsModel";
import {
  ResourceAttentionEvent,
  ResourceAttentionFact,
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
} from "../../../Components/ResourcePart/ResourceAttention";
import {
  KubernetesPartRouteFor,
  getKubernetesKindChip,
  getKubernetesKindIcon,
} from "./KubernetesAttention";

/*
 * WHAT FAILED IN A KUBERNETES CLUSTER, AND WHY: THE ROWS A COUNT OPENS.
 *
 * The cluster's hero counts its pods the way kubectl's STATUS column says
 * them - Running, Pending, CrashLoopBackOff, Failed - and its nodes that are
 * not ready (KubernetesHealth.getKubernetesPodStatusBucket). Each count of
 * something wrong opens the list of exactly those pods or nodes
 * (ResourceAttentionDialog): for each, why in Kubernetes' own words - the
 * container's waiting or terminated reason, its exit code, how its last run
 * ended, the scheduler's or the kubelet's message - which one it is (its
 * namespace, the workload that owns it, its node, the container), since
 * when it has been failing, its latest warning Events (an OOM kill, an
 * image that will not pull, no node to schedule on), and View.
 *
 * The rules are the cluster's (KubernetesHealth), so a pod reads here as it
 * reads in Needs attention, on its own page and in the Pods list.
 *
 * React-free (pages hand in routeFor), so App tests can read it.
 */

export enum KubernetesProblemKind {
  // Pods with a container that cannot run: one count per reason.
  CannotRun = "cannotRun",
  Pending = "pending",
  Failed = "failed",
  // Pods in Kubernetes' Unknown phase.
  Unknown = "unknown",
  NodesNotReady = "nodesNotReady",
  /*
   * Pods the rules say need attention, whatever their state: a namespace's,
   * a Job's that failed. Each row says since when in its own state's words.
   */
  NeedsAttention = "needsAttention",
}

export interface KubernetesProblemQuery {
  kind: KubernetesProblemKind;
  /*
   * For CannotRun: kubectl's word for the pods to list ("CrashLoopBackOff",
   * "Init:Error"); left out or empty, every pod that cannot run.
   */
  reason?: string | undefined;
}

/*
 * ---------------------------------------------------------------------------
 * Words
 * ---------------------------------------------------------------------------
 */

const SINCE_FAILING: string = translationKey("Failing since {{time}}");
const SINCE_FAILED: string = translationKey("Failed {{time}}");
const SINCE_PENDING: string = translationKey("Pending since {{time}}");
const SINCE_UNKNOWN: string = translationKey("State unknown since {{time}}");
const SINCE_NOT_READY: string = translationKey("Not ready since {{time}}");

export const KUBERNETES_PROBLEM_FACT_LABELS: {
  namespace: string;
  workload: string;
  node: string;
  container: string;
  restarts: string;
} = {
  namespace: translationKey("Namespace"),
  // The Deployment, StatefulSet, DaemonSet or Job that runs the pod.
  workload: translationKey("Workload"),
  node: translationKey("Node"),
  container: translationKey("Container"),
  restarts: translationKey("Restarts"),
};

const SINCE_TEMPLATES: Record<KubernetesProblemKind, string> = {
  [KubernetesProblemKind.CannotRun]: SINCE_FAILING,
  [KubernetesProblemKind.Pending]: SINCE_PENDING,
  [KubernetesProblemKind.Failed]: SINCE_FAILED,
  [KubernetesProblemKind.Unknown]: SINCE_UNKNOWN,
  [KubernetesProblemKind.NodesNotReady]: SINCE_NOT_READY,
  [KubernetesProblemKind.NeedsAttention]: SINCE_FAILING,
};

/*
 * Since when, in the words of the state a pod is in, for a list of pods in
 * several states: "Pending since", "Failed", "Not ready since".
 */
function sinceTemplateOf(
  kind: KubernetesProblemKind,
  row: KubernetesHealthRow,
): string {
  if (kind !== KubernetesProblemKind.NeedsAttention) {
    return SINCE_TEMPLATES[kind];
  }
  switch (getKubernetesPodStatusBucket(row).bucket) {
    case KubernetesPodStatusBucket.Pending:
      return SINCE_PENDING;
    case KubernetesPodStatusBucket.Failed:
      return SINCE_FAILED;
    case KubernetesPodStatusBucket.Unknown:
      return SINCE_UNKNOWN;
    case KubernetesPodStatusBucket.Running:
      // Running, and not ready or killed for its memory lately.
      return SINCE_NOT_READY;
    default:
      return SINCE_FAILING;
  }
}

// How many of an object's recent warnings a row keeps.
export const KUBERNETES_PROBLEM_EVENTS_KEPT: number = 3;

/*
 * ---------------------------------------------------------------------------
 * Which rows a count lists
 * ---------------------------------------------------------------------------
 */

/*
 * The pods a count is about, from the rows its read returned: the rules say
 * each pod's bucket the way the hero counted it, so a Pending pod whose
 * image will not pull is listed under ImagePullBackOff, never Pending too.
 */
export function selectKubernetesProblemPods<T extends KubernetesHealthRow>(
  rows: Array<T>,
  query: KubernetesProblemQuery,
): Array<T> {
  return rows.filter((row: T): boolean => {
    const of: KubernetesPodStatusBucketOf = getKubernetesPodStatusBucket(row);
    switch (query.kind) {
      case KubernetesProblemKind.CannotRun:
        return (
          of.bucket === KubernetesPodStatusBucket.CannotRun &&
          (!query.reason || of.reason === query.reason)
        );
      case KubernetesProblemKind.Pending:
        return of.bucket === KubernetesPodStatusBucket.Pending;
      case KubernetesProblemKind.Failed:
        return of.bucket === KubernetesPodStatusBucket.Failed;
      case KubernetesProblemKind.Unknown:
        return of.bucket === KubernetesPodStatusBucket.Unknown;
      case KubernetesProblemKind.NeedsAttention:
        return assessKubernetesPod(row).severity !== null;
      default:
        return false;
    }
  });
}

/*
 * ---------------------------------------------------------------------------
 * A row as the dialog draws it
 * ---------------------------------------------------------------------------
 */

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function readString(source: Json, key: string): string {
  const value: unknown = source[key];
  return typeof value === "string" ? value.trim() : "";
}

function toAttentionText(text: KubernetesHealthText): ResourceAttentionText {
  const result: ResourceAttentionText = { text: text.text };
  if (text.values) {
    result.values = text.values;
  }
  if (text.plural) {
    result.plural = text.plural;
  }
  return result;
}

// Every restart of every container in the pod, as kubectl's RESTARTS says.
function countRestarts(status: Json): number {
  const containers: unknown = status["containerStatuses"];
  if (!Array.isArray(containers)) {
    return 0;
  }
  return containers.reduce((total: number, container: unknown): number => {
    const count: number = Number(asObject(container)["restartCount"]);
    return total + (Number.isFinite(count) && count > 0 ? count : 0);
  }, 0);
}

/*
 * The warnings Kubernetes reported about the object, newest first, one per
 * reason and message: the same back-off reported by two Events is one line.
 */
export function getKubernetesProblemEvents(
  events: Array<KubernetesEventRow>,
  object: { kind: string; name: string; namespace: string },
): Array<ResourceAttentionEvent> {
  const seen: Set<string> = new Set<string>();
  const result: Array<ResourceAttentionEvent> = [];

  const sorted: Array<KubernetesEventRow> = events
    .filter((event: KubernetesEventRow): boolean => {
      return (
        event.isWarning &&
        event.objectKind === object.kind &&
        event.objectName === object.name &&
        (event.namespace || "") === (object.namespace || "")
      );
    })
    .sort((a: KubernetesEventRow, b: KubernetesEventRow): number => {
      return (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0);
    });

  for (const event of sorted) {
    const key: string = `${event.reason}\u0000${event.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const item: ResourceAttentionEvent = {
      key: event.id || key,
      reason: event.reason,
      message: event.message,
      count: event.count,
    };
    if (event.lastSeenAt) {
      item.lastSeenAt = event.lastSeenAt;
    }
    result.push(item);
    if (result.length >= KUBERNETES_PROBLEM_EVENTS_KEPT) {
      break;
    }
  }

  return result;
}

function severityOf(
  assessment: KubernetesHealthAssessment,
): ResourceAttentionSeverity {
  return assessment.severity === KubernetesHealthSeverity.Critical
    ? ResourceAttentionSeverity.Critical
    : ResourceAttentionSeverity.Warning;
}

/*
 * One pod as a count's dialog draws it: why, which one it is, since when,
 * its latest warnings and its page.
 */
export function toKubernetesPodProblemItem(data: {
  row: KubernetesHealthRow;
  kind: KubernetesProblemKind;
  routeFor: KubernetesPartRouteFor;
  events?: Array<KubernetesEventRow> | undefined;
}): ResourceAttentionItem {
  const row: KubernetesHealthRow = data.row;
  const name: string = row.name || "";
  const namespace: string = row.namespaceKey || "";
  const assessment: KubernetesHealthAssessment = assessKubernetesPod(row);
  const status: Json = asObject(row.status);
  const nodeName: string = readString(asObject(row.spec), "nodeName");
  const workload: KubernetesObjectRef | null = getKubernetesPodWorkload(row);
  const restarts: number = countRestarts(status);

  const facts: Array<ResourceAttentionFact> = [];
  if (namespace) {
    facts.push({
      key: "namespace",
      label: KUBERNETES_PROBLEM_FACT_LABELS.namespace,
      value: namespace,
      route: data.routeFor({
        kind: "Namespace",
        name: namespace,
        namespace: "",
      }),
    });
  }
  if (workload) {
    facts.push({
      key: "workload",
      label: KUBERNETES_PROBLEM_FACT_LABELS.workload,
      valueKind: workload.kind,
      value: workload.name,
      route: data.routeFor(workload),
    });
  }
  if (nodeName) {
    facts.push({
      key: "node",
      label: KUBERNETES_PROBLEM_FACT_LABELS.node,
      value: nodeName,
      route: data.routeFor({ kind: "Node", name: nodeName, namespace: "" }),
    });
  }
  if (assessment.container) {
    facts.push({
      key: "container",
      label: KUBERNETES_PROBLEM_FACT_LABELS.container,
      value: assessment.container,
    });
  }
  if (restarts > 0) {
    facts.push({
      key: "restarts",
      label: KUBERNETES_PROBLEM_FACT_LABELS.restarts,
      value: String(restarts),
      isCount: true,
    });
  }

  /*
   * Why, in the rules' words; a pod still starting (pending for less than
   * five minutes) has no reason yet, and reads as its status.
   */
  const reasons: Array<ResourceAttentionText> = (
    assessment.reasons.length > 0 ? assessment.reasons : [assessment.status]
  ).map(toAttentionText);

  const item: ResourceAttentionItem = {
    key: kubernetesObjectKey("Pod", namespace, name),
    kind: getKubernetesKindChip("Pod"),
    kindAsWritten: true,
    icon: getKubernetesKindIcon("Pod"),
    name: name,
    severity: severityOf(assessment),
    reasons: reasons,
    message: assessment.message || undefined,
    route: data.routeFor({ kind: "Pod", name: name, namespace: namespace }),
    facts: facts,
    events: getKubernetesProblemEvents(data.events || [], {
      kind: "Pod",
      name: name,
      namespace: namespace,
    }),
  };

  if (assessment.since !== undefined) {
    item.since = {
      at: new Date(assessment.since),
      template: sinceTemplateOf(data.kind, row),
    };
  }

  return item;
}

// One node that is not ready, as the dialog draws it.
export function toKubernetesNodeProblemItem(data: {
  row: KubernetesHealthRow;
  routeFor: KubernetesPartRouteFor;
  events?: Array<KubernetesEventRow> | undefined;
}): ResourceAttentionItem {
  const row: KubernetesHealthRow = data.row;
  const name: string = row.name || "";
  const assessment: KubernetesHealthAssessment = assessKubernetesNode(row);
  const reasons: Array<ResourceAttentionText> = (
    assessment.reasons.length > 0 ? assessment.reasons : [assessment.status]
  ).map(toAttentionText);

  const item: ResourceAttentionItem = {
    key: kubernetesObjectKey("Node", "", name),
    kind: getKubernetesKindChip("Node"),
    kindAsWritten: true,
    icon: getKubernetesKindIcon("Node"),
    name: name,
    severity: severityOf(assessment),
    reasons: reasons,
    message: assessment.message || undefined,
    route: data.routeFor({ kind: "Node", name: name, namespace: "" }),
    events: getKubernetesProblemEvents(data.events || [], {
      kind: "Node",
      name: name,
      namespace: "",
    }),
  };

  if (assessment.since !== undefined) {
    item.since = {
      at: new Date(assessment.since),
      template: SINCE_NOT_READY,
    };
  }

  return item;
}

/*
 * ---------------------------------------------------------------------------
 * The list, most urgent first
 * ---------------------------------------------------------------------------
 *
 * What breaks the cluster first (critical), then what needs a look, then
 * what is history - a pod that failed days ago, or a finished Job's - and
 * within each the newest first: what broke a minute ago is what the reader
 * is looking for. A row with no time to tell comes last of its group.
 */

function rankOf(severity: KubernetesHealthSeverity | null): number {
  if (severity === KubernetesHealthSeverity.Critical) {
    return 0;
  }
  if (severity === KubernetesHealthSeverity.Warning) {
    return 1;
  }
  return 2;
}

export function buildKubernetesProblemItems(data: {
  rows: Array<KubernetesHealthRow>;
  query: KubernetesProblemQuery;
  routeFor: KubernetesPartRouteFor;
  events?: Array<KubernetesEventRow> | undefined;
}): Array<ResourceAttentionItem> {
  const isNodes: boolean =
    data.query.kind === KubernetesProblemKind.NodesNotReady;

  const ranked: Array<{
    row: KubernetesHealthRow;
    rank: number;
    since: number;
    name: string;
  }> = data.rows.map((row: KubernetesHealthRow) => {
    const assessment: KubernetesHealthAssessment = isNodes
      ? assessKubernetesNode(row)
      : assessKubernetesPod(row);
    return {
      row: row,
      rank: rankOf(assessment.severity),
      since: assessment.since ?? -Infinity,
      name: `${row.namespaceKey || ""}/${row.name || ""}`,
    };
  });

  ranked.sort(
    (
      a: { rank: number; since: number; name: string },
      b: { rank: number; since: number; name: string },
    ): number => {
      if (a.rank !== b.rank) {
        return a.rank - b.rank;
      }
      if (a.since !== b.since) {
        return b.since - a.since;
      }
      return a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    },
  );

  return ranked.map(
    (entry: { row: KubernetesHealthRow }): ResourceAttentionItem => {
      return isNodes
        ? toKubernetesNodeProblemItem({
            row: entry.row,
            routeFor: data.routeFor,
            events: data.events,
          })
        : toKubernetesPodProblemItem({
            row: entry.row,
            kind: data.query.kind,
            routeFor: data.routeFor,
            events: data.events,
          });
    },
  );
}

// The objects a count's rows are, for one read of their warning Events.
export function getKubernetesProblemObjectKind(
  query: KubernetesProblemQuery,
): "Pod" | "Node" {
  return query.kind === KubernetesProblemKind.NodesNotReady ? "Node" : "Pod";
}
