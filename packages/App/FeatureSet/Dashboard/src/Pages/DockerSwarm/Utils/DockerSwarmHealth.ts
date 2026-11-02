import DockerSwarmResource from "Common/Models/DatabaseModels/DockerSwarmResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
  ResourceHealth,
  getResourceAttentionHealth,
  mergeResourceAttentionSeverity,
  sortResourceAttention,
} from "../../../Components/ResourcePart/ResourceAttention";
import { ResourcePartStatus } from "../../../Components/ResourcePart/ResourcePartTypes";
import { OpenIssueRecord } from "../../../Components/ResourceTopology/ResourceTopologyIssues";
import { ResourceTopologyHealth } from "../../../Components/ResourceTopology/ResourceTopologyModel";

/*
 * WHAT ON A DOCKER SWARM NEEDS SOMEONE, AND HOW BAD IT IS.
 *
 * One set of rules for every page that says it: the cluster's Overview (its
 * health pill and Needs attention card), a node's, a service's and a task's
 * own page, the Nodes, Services and Tasks lists and the Topology. They read
 * the inventory the agent's poller keeps (DockerSwarmResource), in Docker's
 * own words where Docker has them - `docker node ls`, `docker service ls`'s
 * REPLICAS 2/3 and `docker service ps`'s ERROR column.
 *
 *   Critical - broken, or about to be:
 *     a node that is down or disconnected; a manager the others cannot
 *     reach; a swarm that has lost its managers' majority (it schedules
 *     nothing and changes nothing until it has it back); a service none of
 *     whose replicas run.
 *   Warning - needs a look soon:
 *     a node whose state Swarm does not know; a swarm that can lose no more
 *     managers; a service short of replicas while no rolling update
 *     explains it; a service whose update paused, is rolling back, or was
 *     rolled back in the last day; a service whose tasks failed three times
 *     or more in the last hour (a crash loop: Swarm replaces each one, so
 *     the service may still read full); a task that failed, was rejected,
 *     is pending with an error (no node can run it) or lost its node; a
 *     task using more than 85% of its memory limit (the High Task Memory
 *     Usage alert's line: past it, the kernel kills it).
 *
 * What is never a problem by itself: a drained or paused node (draining one
 * is routine; it is the node's badge, as a cordoned Kubernetes node's is), a
 * service scaled to zero, a job service that ran to completion, a rolling
 * update under way, a task still starting, and a busy CPU (a multi-threaded
 * task uses several cores by design; its bar turns amber past the High Task
 * CPU Usage alert's line, and the alert says the rest).
 *
 * The words are English, marked as keys of the Dashboard's locales and
 * looked up where they are drawn. Docker's own messages - a task's error,
 * an update's message - are shown as Docker wrote them, in every language.
 *
 * React-free (no Route building: pages hand in routeFor), so App tests can
 * read it.
 */

export type DockerSwarmPartKind = "Node" | "Service" | "Task";

// The template lines the pages colour by: past them the alerts fire.
export const DOCKER_SWARM_TASK_MEMORY_WARNING_PERCENT: number = 85;
export const DOCKER_SWARM_TASK_CPU_WARNING_PERCENT: number = 80;

// Failed tasks within the agent's window (an hour) that make a crash loop.
export const DOCKER_SWARM_FAILED_TASKS_WARNING: number = 3;

// A rollback stays worth a look for this long after it completed.
export const DOCKER_SWARM_ROLLBACK_RECENT_MS: number = 24 * 60 * 60 * 1000;

// Latest readings older than this are no readings (the cleanup's cutoff).
export const DOCKER_SWARM_READINGS_STALE_MS: number = 15 * 60 * 1000;

export interface DockerSwarmAssessment {
  severity: ResourceAttentionSeverity | null;
  // The part's state in one word or sentence, coloured by how it is doing.
  status: ResourcePartStatus;
  // Why it needs attention, most urgent first; empty when it does not.
  reasons: Array<ResourceAttentionText>;
  // Docker's own words about it (a task's error, an update's message).
  message?: string | undefined;
}

export type DockerSwarmRouteFor = (
  kind: DockerSwarmPartKind,
  externalId: string,
) => Route | undefined;

/*
 * ---------------------------------------------------------------------------
 * Words
 * ---------------------------------------------------------------------------
 */
const STATUS_READY: string = translationKey("Ready");
const STATUS_DOWN: string = translationKey("Down");
const STATUS_DISCONNECTED: string = translationKey("Disconnected");
const STATUS_STATE_UNKNOWN: string = translationKey("State unknown");
const STATUS_UNREACHABLE: string = translationKey("Unreachable");
const STATUS_DRAINED: string = translationKey("Drained");
const STATUS_PAUSED: string = translationKey("Paused");
const STATUS_NO_DATA: string = translationKey("No data yet");

const STATUS_REPLICAS: string = translationKey(
  "{{running}} of {{desired}} running",
);
const STATUS_SCALED_TO_ZERO: string = translationKey("Scaled to zero");
const STATUS_UPDATING: string = translationKey("Updating");
const STATUS_JOB_COMPLETED: string = translationKey("Completed");
const STATUS_JOB_RUNNING: string = translationKey("Running");

const STATUS_TASK_RUNNING: string = translationKey("Running");
const STATUS_TASK_FAILED: string = translationKey("Failed");
const STATUS_TASK_REJECTED: string = translationKey("Rejected");
const STATUS_TASK_PENDING: string = translationKey("Pending");
const STATUS_TASK_ORPHANED: string = translationKey("Orphaned");
const STATUS_TASK_STARTING: string = translationKey("Starting");
const STATUS_TASK_SHUT_DOWN: string = translationKey("Shut down");
const STATUS_TASK_COMPLETE: string = translationKey("Complete");

const REASON_DOWN: string = translationKey("Down");
const REASON_DISCONNECTED: string = translationKey("Disconnected");
const REASON_STATE_UNKNOWN: string = translationKey("State unknown");
const REASON_MANAGER_UNREACHABLE: string = translationKey(
  "Manager unreachable",
);
const REASON_NONE_RUNNING: string = translationKey(
  "None of its {{desired}} replicas run",
);
const REASON_SHORT: string = translationKey(
  "{{running}} of {{desired}} replicas run",
);
const REASON_UPDATE_PAUSED: string = translationKey("Update paused");
const REASON_ROLLING_BACK: string = translationKey("Rolling back");
const REASON_ROLLBACK_PAUSED: string = translationKey("Rollback paused");
const REASON_ROLLED_BACK: string = translationKey("Update rolled back");
const REASON_FAILED_TASKS: { one: string; other: string } = {
  one: "{{count}} failed task in the last hour",
  other: "{{count}} failed tasks in the last hour",
};
const REASON_TASK_FAILED: string = translationKey("Failed");
const REASON_TASK_REJECTED: string = translationKey("Rejected");
const REASON_TASK_PENDING: string = translationKey("Pending");
const REASON_TASK_ORPHANED: string = translationKey("Node lost");
const REASON_MEMORY_LIMIT: string = translationKey(
  "Memory at {{percent}} of its limit",
);
const REASON_QUORUM_LOST: string = translationKey("Manager quorum lost");
const REASON_NO_TOLERANCE: string = translationKey(
  "Can lose no more managers",
);
const REASON_MANAGERS_REACHABLE: string = translationKey(
  "{{reachable}} of {{total}} managers reachable",
);

export const DOCKER_SWARM_KIND_CLUSTER: string = translationKey("Swarm");
export const DOCKER_SWARM_KIND_NODE: string = translationKey("Node");
export const DOCKER_SWARM_KIND_SERVICE: string = translationKey("Service");
export const DOCKER_SWARM_KIND_TASK: string = translationKey("Task");

// The order Needs attention lists the kinds in, at one severity.
export const DOCKER_SWARM_ATTENTION_KIND_ORDER: Array<string> = [
  DOCKER_SWARM_KIND_CLUSTER,
  DOCKER_SWARM_KIND_NODE,
  DOCKER_SWARM_KIND_SERVICE,
  DOCKER_SWARM_KIND_TASK,
];

// The key of the swarm's own row in Needs attention (its managers' quorum).
export const DOCKER_SWARM_CLUSTER_ATTENTION_KEY: string = "Swarm";

/*
 * ---------------------------------------------------------------------------
 * Reading a row
 * ---------------------------------------------------------------------------
 */
export function toDockerSwarmNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number: number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function toDockerSwarmDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  const date: Date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

// A value of the row's kind-specific attributes, as text ("" when absent).
export function getDockerSwarmAttribute(
  row: Pick<DockerSwarmResource, "attributes">,
  key: string,
): string {
  const attributes: Record<string, unknown> =
    (row.attributes as JSONObject | undefined) || {};
  const value: unknown = attributes[key];
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value).trim();
}

export function getDockerSwarmDisplayName(
  row: Pick<DockerSwarmResource, "name" | "externalId">,
): string {
  if (row.name) {
    return row.name;
  }
  const externalId: string = row.externalId || "";
  const slashIndex: number = externalId.indexOf("/");
  return slashIndex >= 0 ? externalId.substring(slashIndex + 1) : externalId;
}

export function isDockerSwarmManager(
  row: Pick<DockerSwarmResource, "kind" | "role">,
): boolean {
  return row.kind === "Node" && (row.role || "").toLowerCase() === "manager";
}

export function isDockerSwarmLeader(
  row: Pick<DockerSwarmResource, "attributes">,
): boolean {
  return (
    getDockerSwarmAttribute(row, "isLeader") === "true" ||
    getDockerSwarmAttribute(row, "managerStatus").toLowerCase() === "leader"
  );
}

export function isDockerSwarmManagerUnreachable(
  row: Pick<DockerSwarmResource, "kind" | "role" | "attributes">,
): boolean {
  return (
    isDockerSwarmManager(row) &&
    getDockerSwarmAttribute(row, "managerStatus").toLowerCase() ===
      "unreachable"
  );
}

export function isDockerSwarmJobService(
  row: Pick<DockerSwarmResource, "serviceMode">,
): boolean {
  const mode: string = (row.serviceMode || "").toLowerCase();
  return mode === "replicated-job" || mode === "global-job";
}

/* A task Swarm wants running now, rather than one a slot replaced. */
export function isCurrentDockerSwarmTask(
  row: Pick<DockerSwarmResource, "kind" | "state" | "attributes">,
): boolean {
  if (row.kind !== "Task") {
    return false;
  }
  const desired: string = getDockerSwarmAttribute(
    row,
    "desiredState",
  ).toLowerCase();
  if (desired) {
    return desired === "running" || desired === "ready";
  }
  const state: string = (row.state || "").toLowerCase();
  return state !== "shutdown" && state !== "complete";
}

/*
 * A task's latest CPU and memory, or null when it has sent none for longer
 * than the cleanup keeps a row (DOCKER_SWARM_READINGS_STALE_MS): a bar must
 * never show a task's old readings as its current ones.
 */
export function getDockerSwarmTaskReadings(
  row: Pick<
    DockerSwarmResource,
    | "latestCpuPercent"
    | "latestMemoryBytes"
    | "latestMemoryPercent"
    | "maxMemoryBytes"
    | "metricsUpdatedAt"
  >,
  now: Date,
): {
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryPercent: number | null;
} {
  const updatedAt: Date | null = toDockerSwarmDate(row.metricsUpdatedAt);
  if (
    !updatedAt ||
    now.getTime() - updatedAt.getTime() > DOCKER_SWARM_READINGS_STALE_MS
  ) {
    return { cpuPercent: null, memoryBytes: null, memoryPercent: null };
  }
  return {
    cpuPercent: toDockerSwarmNumber(row.latestCpuPercent),
    memoryBytes: toDockerSwarmNumber(row.latestMemoryBytes),
    memoryPercent: toDockerSwarmNumber(row.latestMemoryPercent),
  };
}

function formatPercentForReason(percent: number): string {
  return `${Math.round(percent)}%`;
}

function status(
  label: string,
  tone: ResourcePartStatus["tone"],
  values?: Record<string, string> | undefined,
): ResourcePartStatus {
  return values ? { label, tone, values } : { label, tone };
}

/*
 * ---------------------------------------------------------------------------
 * The rules, one kind at a time
 * ---------------------------------------------------------------------------
 */
export function assessDockerSwarmNode(
  row: DockerSwarmResource,
): DockerSwarmAssessment {
  const state: string = (row.state || "").toLowerCase();
  const availability: string = getDockerSwarmAttribute(
    row,
    "availability",
  ).toLowerCase();
  const message: string = getDockerSwarmAttribute(row, "message") || "";
  const reasons: Array<ResourceAttentionText> = [];
  const severities: Array<ResourceAttentionSeverity> = [];
  let partStatus: ResourcePartStatus;

  if (state === "down") {
    partStatus = status(STATUS_DOWN, "danger");
    reasons.push({ text: REASON_DOWN });
    severities.push(ResourceAttentionSeverity.Critical);
  } else if (state === "disconnected") {
    partStatus = status(STATUS_DISCONNECTED, "danger");
    reasons.push({ text: REASON_DISCONNECTED });
    severities.push(ResourceAttentionSeverity.Critical);
  } else if (state === "unknown") {
    partStatus = status(STATUS_STATE_UNKNOWN, "warning");
    reasons.push({ text: REASON_STATE_UNKNOWN });
    severities.push(ResourceAttentionSeverity.Warning);
  } else if (state === "ready") {
    partStatus =
      availability === "drain"
        ? status(STATUS_DRAINED, "neutral")
        : availability === "pause"
          ? status(STATUS_PAUSED, "neutral")
          : status(STATUS_READY, "positive");
  } else if (row.isReady === false) {
    partStatus = status(STATUS_DOWN, "danger");
    reasons.push({ text: REASON_DOWN });
    severities.push(ResourceAttentionSeverity.Critical);
  } else {
    partStatus = status(STATUS_NO_DATA, "neutral");
  }

  /*
   * A manager the others cannot reach takes the swarm closer to losing its
   * majority, whatever its node's own state says.
   */
  if (isDockerSwarmManagerUnreachable(row)) {
    reasons.push({ text: REASON_MANAGER_UNREACHABLE });
    severities.push(ResourceAttentionSeverity.Critical);
    if (partStatus.tone !== "danger") {
      partStatus = status(STATUS_UNREACHABLE, "danger");
    }
  }

  return {
    severity: mergeResourceAttentionSeverity(severities),
    status: partStatus,
    reasons: reasons,
    message: reasons.length > 0 && message ? message : undefined,
  };
}

/*
 * How a service's last rolling update stands: what it says about the
 * service, if anything (a rollback a day old is history, not a problem).
 */
function assessDockerSwarmUpdate(
  row: DockerSwarmResource,
  now: Date,
): {
  isUpdating: boolean;
  reason: ResourceAttentionText | null;
} {
  const state: string = getDockerSwarmAttribute(
    row,
    "updateState",
  ).toLowerCase();

  if (state === "updating") {
    return { isUpdating: true, reason: null };
  }
  if (state === "paused") {
    return { isUpdating: false, reason: { text: REASON_UPDATE_PAUSED } };
  }
  if (state === "rollback_started") {
    return { isUpdating: true, reason: { text: REASON_ROLLING_BACK } };
  }
  if (state === "rollback_paused") {
    return { isUpdating: false, reason: { text: REASON_ROLLBACK_PAUSED } };
  }
  if (state === "rollback_completed") {
    const completedAt: Date | null = toDockerSwarmDate(
      getDockerSwarmAttribute(row, "updateCompletedAt"),
    );
    const isRecent: boolean =
      completedAt === null ||
      now.getTime() - completedAt.getTime() <= DOCKER_SWARM_ROLLBACK_RECENT_MS;
    return {
      isUpdating: false,
      reason: isRecent ? { text: REASON_ROLLED_BACK } : null,
    };
  }
  return { isUpdating: false, reason: null };
}

export function assessDockerSwarmService(
  row: DockerSwarmResource,
  now: Date,
): DockerSwarmAssessment {
  const running: number | null = toDockerSwarmNumber(row.runningReplicas);
  const desired: number | null = toDockerSwarmNumber(row.desiredReplicas);
  const reasons: Array<ResourceAttentionText> = [];
  const severities: Array<ResourceAttentionSeverity> = [];
  const lastTaskError: string = getDockerSwarmAttribute(row, "lastTaskError");
  const updateMessage: string = getDockerSwarmAttribute(row, "updateMessage");

  // A job runs its tasks to completion: there are no replicas to keep up.
  if (isDockerSwarmJobService(row)) {
    return {
      severity: null,
      status:
        running !== null && running > 0
          ? status(STATUS_JOB_RUNNING, "positive")
          : status(STATUS_JOB_COMPLETED, "neutral"),
      reasons: [],
    };
  }

  const update: {
    isUpdating: boolean;
    reason: ResourceAttentionText | null;
  } = assessDockerSwarmUpdate(row, now);

  let partStatus: ResourcePartStatus;

  if (desired === null) {
    partStatus = status(STATUS_NO_DATA, "neutral");
  } else if (desired === 0) {
    partStatus = status(STATUS_SCALED_TO_ZERO, "neutral");
  } else {
    const have: number = running ?? 0;
    const values: Record<string, string> = {
      running: String(have),
      desired: String(desired),
    };
    if (have === 0) {
      partStatus = status(STATUS_REPLICAS, "danger", values);
      reasons.push({
        text: REASON_NONE_RUNNING,
        values: { desired: String(desired) },
      });
      severities.push(ResourceAttentionSeverity.Critical);
    } else if (have < desired) {
      if (update.isUpdating && !update.reason) {
        // A rolling update replaces replicas a few at a time.
        partStatus = status(STATUS_UPDATING, "neutral");
      } else {
        partStatus = status(STATUS_REPLICAS, "warning", values);
        reasons.push({ text: REASON_SHORT, values: values });
        severities.push(ResourceAttentionSeverity.Warning);
      }
    } else {
      partStatus = update.isUpdating
        ? status(STATUS_UPDATING, "neutral")
        : status(STATUS_REPLICAS, "positive", values);
    }
  }

  if (update.reason) {
    reasons.push(update.reason);
    severities.push(ResourceAttentionSeverity.Warning);
    if (partStatus.tone === "positive" || partStatus.tone === "neutral") {
      partStatus = { ...partStatus, tone: "warning" };
    }
  }

  const failedTasks: number =
    toDockerSwarmNumber(getDockerSwarmAttribute(row, "recentFailedTasks")) ?? 0;
  if (failedTasks >= DOCKER_SWARM_FAILED_TASKS_WARNING) {
    reasons.push({
      text: REASON_FAILED_TASKS.other,
      plural: { one: REASON_FAILED_TASKS.one, count: failedTasks },
    });
    severities.push(ResourceAttentionSeverity.Warning);
    if (partStatus.tone === "positive") {
      partStatus = { ...partStatus, tone: "warning" };
    }
  }

  /*
   * Docker's own words for why: the newest failed task's error says why the
   * service runs short or keeps restarting; a paused update's message why
   * it stopped.
   */
  const message: string =
    update.reason && updateMessage ? updateMessage : lastTaskError;

  return {
    severity: mergeResourceAttentionSeverity(severities),
    status: partStatus,
    reasons: reasons,
    message: reasons.length > 0 && message ? message : undefined,
  };
}

const TASK_STARTING_STATES: ReadonlySet<string> = new Set([
  "new",
  "allocated",
  "assigned",
  "accepted",
  "ready",
  "preparing",
  "starting",
]);

export function assessDockerSwarmTask(
  row: DockerSwarmResource,
  now: Date,
): DockerSwarmAssessment {
  const state: string = (row.state || "").toLowerCase();
  const error: string = getDockerSwarmAttribute(row, "error");
  const reasons: Array<ResourceAttentionText> = [];
  const severities: Array<ResourceAttentionSeverity> = [];
  let partStatus: ResourcePartStatus;

  if (state === "running") {
    partStatus = status(STATUS_TASK_RUNNING, "positive");
  } else if (state === "failed") {
    partStatus = status(STATUS_TASK_FAILED, "danger");
    reasons.push({ text: REASON_TASK_FAILED });
    severities.push(ResourceAttentionSeverity.Warning);
  } else if (state === "rejected") {
    partStatus = status(STATUS_TASK_REJECTED, "danger");
    reasons.push({ text: REASON_TASK_REJECTED });
    severities.push(ResourceAttentionSeverity.Warning);
  } else if (state === "orphaned") {
    partStatus = status(STATUS_TASK_ORPHANED, "warning");
    reasons.push({ text: REASON_TASK_ORPHANED });
    severities.push(ResourceAttentionSeverity.Warning);
  } else if (state === "pending") {
    /*
     * Pending with an error is a task no node can run ("no suitable node
     * (insufficient resources on 3 nodes)"); without one, Swarm is still
     * placing it.
     */
    if (error) {
      partStatus = status(STATUS_TASK_PENDING, "warning");
      reasons.push({ text: REASON_TASK_PENDING });
      severities.push(ResourceAttentionSeverity.Warning);
    } else {
      partStatus = status(STATUS_TASK_PENDING, "neutral");
    }
  } else if (TASK_STARTING_STATES.has(state)) {
    partStatus = status(STATUS_TASK_STARTING, "neutral");
  } else if (state === "shutdown" || state === "remove") {
    partStatus = status(STATUS_TASK_SHUT_DOWN, "neutral");
  } else if (state === "complete") {
    partStatus = status(STATUS_TASK_COMPLETE, "neutral");
  } else {
    partStatus = status(STATUS_NO_DATA, "neutral");
  }

  if (state === "running") {
    const memoryPercent: number | null = getDockerSwarmTaskReadings(
      row,
      now,
    ).memoryPercent;
    if (
      memoryPercent !== null &&
      memoryPercent > DOCKER_SWARM_TASK_MEMORY_WARNING_PERCENT
    ) {
      reasons.push({
        text: REASON_MEMORY_LIMIT,
        values: { percent: formatPercentForReason(memoryPercent) },
      });
      severities.push(ResourceAttentionSeverity.Warning);
      partStatus = { ...partStatus, tone: "warning" };
    }
  }

  return {
    severity: mergeResourceAttentionSeverity(severities),
    status: partStatus,
    reasons: reasons,
    message: reasons.length > 0 && error ? error : undefined,
  };
}

export function assessDockerSwarmResource(
  row: DockerSwarmResource,
  now: Date,
): DockerSwarmAssessment | null {
  if (row.kind === "Node") {
    return assessDockerSwarmNode(row);
  }
  if (row.kind === "Service") {
    return assessDockerSwarmService(row, now);
  }
  if (row.kind === "Task") {
    return assessDockerSwarmTask(row, now);
  }
  return null;
}

/*
 * ---------------------------------------------------------------------------
 * The managers' majority
 * ---------------------------------------------------------------------------
 *
 * A swarm keeps working while more than half of its managers can reach each
 * other (Raft's quorum): three managers stand the loss of one, five of two.
 * Below the majority it runs what it runs but schedules nothing new and
 * changes nothing - no service update, no rescheduling off a dead node.
 */
export interface DockerSwarmManagerQuorum {
  total: number;
  reachable: number;
  // How many must stay reachable.
  majority: number;
  hasQuorum: boolean;
  // How many more managers it can lose and keep working.
  canLose: number;
}

export function getDockerSwarmManagerQuorum(
  rows: Array<DockerSwarmResource>,
): DockerSwarmManagerQuorum | null {
  const managers: Array<DockerSwarmResource> = rows.filter(
    (row: DockerSwarmResource): boolean => {
      return isDockerSwarmManager(row);
    },
  );
  if (managers.length === 0) {
    return null;
  }
  const reachable: number = managers.filter(
    (row: DockerSwarmResource): boolean => {
      return (
        (row.state || "").toLowerCase() === "ready" &&
        !isDockerSwarmManagerUnreachable(row)
      );
    },
  ).length;
  const majority: number = Math.floor(managers.length / 2) + 1;
  return {
    total: managers.length,
    reachable: reachable,
    majority: majority,
    hasQuorum: reachable >= majority,
    canLose: Math.max(0, reachable - majority),
  };
}

/*
 * ---------------------------------------------------------------------------
 * Needs attention
 * ---------------------------------------------------------------------------
 */
function iconOf(kind: DockerSwarmPartKind): IconProp {
  if (kind === "Node") {
    return IconProp.Server;
  }
  if (kind === "Service") {
    return IconProp.SquareStack;
  }
  return IconProp.QueueList;
}

function kindWordOf(kind: DockerSwarmPartKind): string {
  if (kind === "Node") {
    return DOCKER_SWARM_KIND_NODE;
  }
  if (kind === "Service") {
    return DOCKER_SWARM_KIND_SERVICE;
  }
  return DOCKER_SWARM_KIND_TASK;
}

export function getDockerSwarmAttentionKey(
  kind: DockerSwarmPartKind,
  externalId: string,
): string {
  return `${kind}:${externalId}`;
}

function toAttentionItem(data: {
  row: DockerSwarmResource;
  kind: DockerSwarmPartKind;
  assessment: DockerSwarmAssessment;
  routeFor: DockerSwarmRouteFor;
}): ResourceAttentionItem {
  const externalId: string = data.row.externalId || "";
  return {
    key: getDockerSwarmAttentionKey(data.kind, externalId),
    kind: kindWordOf(data.kind),
    icon: iconOf(data.kind),
    name: getDockerSwarmDisplayName(data.row),
    // A task says the node it was placed on; a node and a service only their name.
    detail:
      data.kind === "Task" && data.row.nodeHostname
        ? data.row.nodeHostname
        : undefined,
    severity: data.assessment.severity as ResourceAttentionSeverity,
    reasons: data.assessment.reasons,
    message: data.assessment.message,
    route: externalId ? data.routeFor(data.kind, externalId) : undefined,
  };
}

/*
 * Everything on the swarm that needs attention, most urgent first.
 *
 * `scope` says whose page draws it:
 *   - "cluster" (the Overview): the swarm's managers' majority, each node and
 *     each service, and a task only when its service is not in the
 *     inventory - a task's trouble is its service's (the service's row says
 *     its replicas run short; its page lists the task);
 *   - "part": every node, service and task the rows hold, as a node's or a
 *     service's own page lists itself and the tasks it runs.
 */
export function getDockerSwarmAttentionItems(data: {
  rows: Array<DockerSwarmResource>;
  clusterName?: string | undefined;
  routeFor: DockerSwarmRouteFor;
  now: Date;
  scope?: "cluster" | "part" | undefined;
}): Array<ResourceAttentionItem> {
  const scope: "cluster" | "part" = data.scope || "cluster";
  const items: Array<ResourceAttentionItem> = [];
  const serviceNames: Set<string> = new Set<string>();

  for (const row of data.rows) {
    if (row.kind === "Service" && row.name) {
      serviceNames.add(row.name);
    }
  }

  if (scope === "cluster") {
    const quorum: DockerSwarmManagerQuorum | null =
      getDockerSwarmManagerQuorum(data.rows);
    if (quorum && quorum.reachable < quorum.total) {
      const managers: ResourceAttentionText = {
        text: REASON_MANAGERS_REACHABLE,
        values: {
          reachable: String(quorum.reachable),
          total: String(quorum.total),
        },
      };
      if (!quorum.hasQuorum) {
        items.push({
          key: DOCKER_SWARM_CLUSTER_ATTENTION_KEY,
          kind: DOCKER_SWARM_KIND_CLUSTER,
          icon: IconProp.DockerSwarm,
          name: data.clusterName || "",
          severity: ResourceAttentionSeverity.Critical,
          reasons: [{ text: REASON_QUORUM_LOST }, managers],
        });
      } else if (quorum.canLose === 0) {
        items.push({
          key: DOCKER_SWARM_CLUSTER_ATTENTION_KEY,
          kind: DOCKER_SWARM_KIND_CLUSTER,
          icon: IconProp.DockerSwarm,
          name: data.clusterName || "",
          severity: ResourceAttentionSeverity.Warning,
          reasons: [{ text: REASON_NO_TOLERANCE }, managers],
        });
      }
    }
  }

  for (const row of data.rows) {
    const kind: DockerSwarmPartKind | null =
      row.kind === "Node" || row.kind === "Service" || row.kind === "Task"
        ? row.kind
        : null;
    if (!kind) {
      continue;
    }
    if (kind === "Task") {
      if (!isCurrentDockerSwarmTask(row)) {
        continue;
      }
      if (
        scope === "cluster" &&
        row.serviceName &&
        serviceNames.has(row.serviceName)
      ) {
        continue;
      }
    }
    const assessment: DockerSwarmAssessment | null = assessDockerSwarmResource(
      row,
      data.now,
    );
    if (!assessment || !assessment.severity) {
      continue;
    }
    items.push(
      toAttentionItem({
        row: row,
        kind: kind,
        assessment: assessment,
        routeFor: data.routeFor,
      }),
    );
  }

  return sortResourceAttention(items, DOCKER_SWARM_ATTENTION_KIND_ORDER);
}

/*
 * The service's own trouble and its current tasks', for its page: the
 * service first (its replicas), then each task that needs a look.
 */
export function getDockerSwarmServiceRows(data: {
  rows: Array<DockerSwarmResource>;
  service: DockerSwarmResource;
}): Array<DockerSwarmResource> {
  const name: string = data.service.name || "";
  return [
    data.service,
    ...data.rows.filter((row: DockerSwarmResource): boolean => {
      return (
        row.kind === "Task" &&
        Boolean(name) &&
        row.serviceName === name &&
        isCurrentDockerSwarmTask(row)
      );
    }),
  ];
}

// The node and the tasks placed on it, for its page.
export function getDockerSwarmNodeRows(data: {
  rows: Array<DockerSwarmResource>;
  node: DockerSwarmResource;
}): Array<DockerSwarmResource> {
  const hostname: string = (data.node.name || "").toLowerCase();
  return [
    data.node,
    ...data.rows.filter((row: DockerSwarmResource): boolean => {
      return (
        row.kind === "Task" &&
        Boolean(hostname) &&
        (row.nodeHostname || "").toLowerCase() === hostname &&
        isCurrentDockerSwarmTask(row)
      );
    }),
  ];
}

/*
 * The reasons a list's row draws under its status: not the ones its status
 * already says ("Down" under Down, "2 of 3 replicas run" under 2 of 3
 * running), which Needs attention needs because its rows have no status.
 */
const REASONS_THE_STATUS_SAYS: ReadonlySet<string> = new Set<string>([
  REASON_DOWN,
  REASON_DISCONNECTED,
  REASON_STATE_UNKNOWN,
  REASON_NONE_RUNNING,
  REASON_SHORT,
  REASON_TASK_FAILED,
  REASON_TASK_REJECTED,
  REASON_TASK_PENDING,
  REASON_TASK_ORPHANED,
]);

export function getDockerSwarmStatusReasons(
  assessment: DockerSwarmAssessment,
): Array<ResourceAttentionText> {
  return assessment.reasons.filter((reason: ResourceAttentionText): boolean => {
    if (REASONS_THE_STATUS_SAYS.has(reason.text)) {
      return false;
    }
    // "Manager unreachable" under Unreachable.
    return !(
      reason.text === REASON_MANAGER_UNREACHABLE &&
      assessment.status.label === STATUS_UNREACHABLE
    );
  });
}

export function getDockerSwarmHealth(
  items: Array<ResourceAttentionItem>,
): ResourceHealth {
  return getResourceAttentionHealth(items);
}

/*
 * How the Topology colours a part: by the same assessment. A drained node,
 * a service scaled to zero and a finished job are "off" (grey); a part
 * still starting, or with no word yet, "unknown".
 */
export function getDockerSwarmTopologyHealth(
  assessment: DockerSwarmAssessment,
): ResourceTopologyHealth {
  if (assessment.severity === ResourceAttentionSeverity.Critical) {
    return "critical";
  }
  if (assessment.severity === ResourceAttentionSeverity.Warning) {
    return "warning";
  }
  if (assessment.status.tone === "positive") {
    return "healthy";
  }
  if (
    assessment.status.label === STATUS_DRAINED ||
    assessment.status.label === STATUS_PAUSED ||
    assessment.status.label === STATUS_SCALED_TO_ZERO ||
    assessment.status.label === STATUS_JOB_COMPLETED
  ) {
    return "off";
  }
  if (assessment.status.label === STATUS_UPDATING) {
    return "healthy";
  }
  return "unknown";
}

/*
 * ---------------------------------------------------------------------------
 * Which part an open incident or alert is about
 * ---------------------------------------------------------------------------
 *
 * The Swarm templates group by the task's container, `resource.container.name`
 * - `<service>.<slot>.<task id>` for a replicated service's task,
 * `<service>.<node id>.<task id>` for a global one's - and the Node Not
 * Ready and Service Replicas Mismatch alerts by `docker.swarm.node.name` and
 * `docker.swarm.service.name` (resource attributes, so `resource.`-prefixed).
 * A person's own monitor may group by the service's or the node's name too.
 */
export interface DockerSwarmIssueTarget {
  serviceName: string | null;
  nodeName: string | null;
  taskId: string | null;
}

function readLabel(labels: JSONObject | null, key: string): string | null {
  if (!labels) {
    return null;
  }
  for (const candidate of [key, `resource.${key}`]) {
    const value: unknown = (labels as Record<string, unknown>)[candidate];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function getDockerSwarmIssueTarget(
  record: Pick<OpenIssueRecord, "seriesLabels">,
): DockerSwarmIssueTarget | null {
  const labels: JSONObject | null = record.seriesLabels;
  const container: string | null = readLabel(labels, "container.name");
  let serviceName: string | null = readLabel(
    labels,
    "docker.swarm.service.name",
  );
  let taskId: string | null = null;

  if (container) {
    const segments: Array<string> = container.split(".");
    if (segments.length >= 3) {
      taskId = segments[segments.length - 1] || null;
      serviceName =
        serviceName || segments.slice(0, segments.length - 2).join(".") || null;
    }
  }

  const nodeName: string | null = readLabel(labels, "docker.swarm.node.name");

  if (!serviceName && !nodeName && !taskId) {
    return null;
  }
  return { serviceName, nodeName, taskId };
}

function sameText(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

const TASK_ID_PREFIX: string = "task/";

// A task's own id, from its externalId ("task/<id>").
export function getDockerSwarmTaskId(
  row: Pick<DockerSwarmResource, "externalId">,
): string {
  const externalId: string = row.externalId || "";
  return externalId.startsWith(TASK_ID_PREFIX)
    ? externalId.substring(TASK_ID_PREFIX.length)
    : externalId;
}

// Whether an open record is about this node, service or task.
export function isDockerSwarmIssueAbout(
  record: Pick<OpenIssueRecord, "seriesLabels">,
  row: Pick<
    DockerSwarmResource,
    "kind" | "externalId" | "name" | "serviceName" | "nodeHostname"
  >,
): boolean {
  const target: DockerSwarmIssueTarget | null =
    getDockerSwarmIssueTarget(record);
  if (!target) {
    return false;
  }
  if (row.kind === "Task") {
    const taskId: string = getDockerSwarmTaskId(row);
    return Boolean(target.taskId && taskId && target.taskId === taskId);
  }
  if (row.kind === "Service") {
    return sameText(target.serviceName, row.name);
  }
  if (row.kind === "Node") {
    return (
      sameText(target.nodeName, row.name) &&
      // A task's alert names its node too: it is the task's, not the node's.
      !target.taskId
    );
  }
  return false;
}
