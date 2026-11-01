import { JSONObject } from "../JSON";

/*
 * WHAT IN A KUBERNETES CLUSTER NEEDS SOMEONE, AND HOW BAD IT IS.
 *
 * One set of rules for every place that says it: the cluster's Overview
 * (its health pill and Needs attention card), the page of a workload, a pod
 * or a node, the lists and the Topology - and the ingest, which stores each
 * object's verdict (KubernetesResource.healthSeverity) so the Overview reads
 * only what needs attention instead of the whole inventory. They all read
 * the same snapshot rows (the k8sobjects pull the agent sends every five
 * minutes), so none of them can disagree about what is wrong.
 *
 *   Critical - broken, or about to be:
 *     a node not ready, or with its network unavailable; a container that
 *     cannot run (CrashLoopBackOff, ImagePullBackOff, ErrImagePull,
 *     CreateContainerConfigError, ...), its init containers too; a
 *     Deployment, StatefulSet or DaemonSet with none of its replicas
 *     available; a rollout past its progress deadline; a volume claim that
 *     lost its volume; a volume whose reclaim failed.
 *   Warning - needs a look soon:
 *     a node under memory, disk or PID pressure; a workload short of
 *     replicas while no rollout explains it; a DaemonSet on nodes it
 *     should not run on; a pod pending or not ready for more than five
 *     minutes (with the scheduler's reason); a container OOMKilled in the
 *     last hour; a pod evicted or failed in the last hour; a Job that
 *     failed (the newest run of a CronJob); a claim waiting for a volume;
 *     an autoscaler at its maximum or unable to scale.
 *
 * What is never a problem by itself: a completed pod or Job, a workload
 * scaled to zero or paused, a suspended CronJob, a cordoned node (it is a
 * badge: draining one is routine), a rollout in progress before its
 * deadline, and anything younger than five minutes that is still starting.
 * Every rule is measured against the snapshot's own time (the row's
 * lastSeenAt), never the reader's clock, so the stored verdict and a page's
 * reading of the same row always agree.
 *
 * The words are English. Kubernetes' own reasons (CrashLoopBackOff,
 * OOMKilled, BackoffLimitExceeded) and messages are shown as Kubernetes
 * wrote them, in every language, as kubectl does; the rest are keys of the
 * Dashboard's locales, marked below and looked up where they are drawn.
 *
 * React-free and server-safe: the ingest, the API and App tests call it.
 */

/*
 * Marks an English text as a key of the Dashboard's locales - the same
 * marker as Common/UI/Utils/TranslateTemplate's translationKey, kept here so
 * this file stays free of the UI (the Dashboard's extractor reads this file
 * as a "keys" root). It returns the text unchanged.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

// A pod, workload or claim younger than this may still be starting.
export const KUBERNETES_HEALTH_GRACE_MS: number = 5 * 60 * 1000;

// How long an OOM kill, an eviction or a failed pod stays worth a look.
export const KUBERNETES_HEALTH_RECENT_MS: number = 60 * 60 * 1000;

export enum KubernetesHealthSeverity {
  Critical = "critical",
  Warning = "warning",
}

export type KubernetesHealthTone =
  | "positive"
  | "warning"
  | "danger"
  | "neutral";

/*
 * One reason or status word, as an English template and its values. A
 * count-dependent one carries its "one" form and the count; `text` is then
 * its general form. A template with no words of its own ("{{reason}}") is
 * drawn as its values in every language: Kubernetes' own reasons.
 */
export interface KubernetesHealthText {
  text: string;
  values?: Record<string, string> | undefined;
  plural?: { one: string; count: number } | undefined;
}

export interface KubernetesHealthAssessment {
  severity: KubernetesHealthSeverity | null;
  // The word a list, a hero or a card shows: "CrashLoopBackOff", "Ready".
  status: KubernetesHealthText;
  tone: KubernetesHealthTone;
  // Why it needs attention, most telling first. Empty when it does not.
  reasons: Array<KubernetesHealthText>;
  /*
   * What Kubernetes itself says about it, as it wrote it: the scheduler's
   * "0/3 nodes are available: 3 Insufficient memory.", the kubelet's
   * "Back-off pulling image ...", an eviction's reason.
   */
  message?: string | undefined;
}

/*
 * An inventory row as the rules read it: the KubernetesResource columns,
 * whether they come from Postgres on the server or from ModelAPI in the
 * Dashboard. spec and status hold what KubernetesObjectParser parsed.
 */
export interface KubernetesHealthRow {
  kind?: string | null | undefined;
  namespaceKey?: string | null | undefined;
  name?: string | null | undefined;
  phase?: string | null | undefined;
  isReady?: boolean | null | undefined;
  hasMemoryPressure?: boolean | null | undefined;
  hasDiskPressure?: boolean | null | undefined;
  hasPidPressure?: boolean | null | undefined;
  labels?: JSONObject | null | undefined;
  ownerReferences?: JSONObject | null | undefined;
  spec?: JSONObject | null | undefined;
  status?: JSONObject | null | undefined;
  lastSeenAt?: Date | string | null | undefined;
  resourceCreationTimestamp?: Date | string | null | undefined;
}

export interface KubernetesHealthOptions {
  // The time the rules measure against when the row has no lastSeenAt.
  now?: Date | undefined;
}

/*
 * ---------------------------------------------------------------------------
 * Words
 * ---------------------------------------------------------------------------
 */

// A template with no words: Kubernetes' reason, as it wrote it.
export const KUBERNETES_REASON_AS_WRITTEN: string = "{{reason}}";

const STATUS_RUNNING: string = translationKey("Running");
const STATUS_PENDING: string = translationKey("Pending");
const STATUS_COMPLETED: string = translationKey("Completed");
const STATUS_FAILED: string = translationKey("Failed");
const STATUS_EVICTED: string = translationKey("Evicted");
const STATUS_UNKNOWN: string = translationKey("Unknown");
const STATUS_NOT_READY: string = translationKey("Not ready");
const STATUS_READY: string = translationKey("Ready");
const STATUS_STOPPED_REPORTING: string = translationKey("Stopped reporting");
const STATUS_SCHEDULING_DISABLED: string = translationKey(
  "Scheduling disabled",
);
const STATUS_AVAILABLE: string = translationKey("Available");
const STATUS_ROLLING_OUT: string = translationKey("Rolling out");
const STATUS_ROLLOUT_STUCK: string = translationKey("Rollout stuck");
const STATUS_PAUSED: string = translationKey("Paused");
const STATUS_SCALED_TO_ZERO: string = translationKey("Scaled to zero");
const STATUS_SUSPENDED: string = translationKey("Suspended");
const STATUS_SCHEDULED: string = translationKey("Scheduled");
const STATUS_ACTIVE: string = translationKey("Active");
const STATUS_TERMINATING: string = translationKey("Terminating");
const STATUS_BOUND: string = translationKey("Bound");
const STATUS_LOST: string = translationKey("Lost");
const STATUS_RELEASED: string = translationKey("Released");
const STATUS_AT_MAXIMUM: string = translationKey("At maximum");
const STATUS_CANNOT_SCALE: string = translationKey("Can't scale");
const STATUS_LAST_RUN_FAILED: string = translationKey("Last run failed");
const STATUS_NO_DATA: string = translationKey("No data yet");
const STATUS_NO_NODES: string = translationKey("No nodes to run on");

const REASON_NOT_READY: string = translationKey("Not ready");
const REASON_STOPPED_REPORTING: string = translationKey("Stopped reporting");
const REASON_NETWORK_UNAVAILABLE: string = translationKey(
  "Network unavailable",
);
const REASON_MEMORY_PRESSURE: string = translationKey("Memory pressure");
const REASON_DISK_PRESSURE: string = translationKey("Disk pressure");
const REASON_PID_PRESSURE: string = translationKey("PID pressure");
const REASON_LAST_RESTART: string = translationKey("Last restart: {{reason}}");
const REASON_LAST_RESTART_WITH_CODE: string = translationKey(
  "Last restart: {{reason}}, exit code {{code}}",
);
const REASON_CANNOT_BE_SCHEDULED: string = translationKey("Can't be scheduled");
const REASON_PENDING: string = translationKey("Pending");
const REASON_EVICTED: string = translationKey("Evicted");
const REASON_FAILED: string = translationKey("Failed");
const REASON_UNKNOWN_STATE: string = translationKey("State unknown");
const REASON_AVAILABLE_OF: string = translationKey(
  "{{available}} of {{desired}} available",
);
const REASON_READY_OF: string = translationKey(
  "{{ready}} of {{desired}} ready",
);
const REASON_READY_ON_NODES: string = translationKey(
  "Ready on {{ready}} of {{desired}} nodes",
);
const REASON_MISSCHEDULED: { one: string; other: string } = {
  one: translationKey("Runs on {{count}} node it should not"),
  other: translationKey("Runs on {{count}} nodes it should not"),
};
const REASON_ROLLOUT_STUCK: string = translationKey("Rollout stuck");
const REASON_WAITING_FOR_VOLUME: string = translationKey(
  "Waiting for a volume",
);
const REASON_VOLUME_LOST: string = translationKey("Lost its volume");
const REASON_RECLAIM_FAILED: string = translationKey("Reclaim failed");
const REASON_AT_MAXIMUM: { one: string; other: string } = {
  one: translationKey("At its maximum of {{count}} replica"),
  other: translationKey("At its maximum of {{count}} replicas"),
};
const REASON_CANNOT_SCALE: string = translationKey("Can't scale: {{reason}}");
const REASON_LAST_RUN_FAILED: string = translationKey("Last run failed");

/*
 * ---------------------------------------------------------------------------
 * Reading rows
 * ---------------------------------------------------------------------------
 */

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function asArray(value: unknown): Array<Json> {
  return Array.isArray(value)
    ? (value.filter((item: unknown): boolean => {
        return Boolean(item) && typeof item === "object";
      }) as Array<Json>)
    : [];
}

function readString(source: Json, key: string): string {
  const value: unknown = source[key];
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(source: Json, key: string): number | null {
  const value: unknown = source[key];
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number: number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function readBoolean(source: Json, key: string): boolean {
  const value: unknown = source[key];
  return value === true || value === "true";
}

function toTime(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const time: number =
    value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(time) ? time : null;
}

function text(
  value: string,
  values?: Record<string, string> | undefined,
): KubernetesHealthText {
  return values ? { text: value, values: values } : { text: value };
}

function asWritten(reason: string): KubernetesHealthText {
  return { text: KUBERNETES_REASON_AS_WRITTEN, values: { reason: reason } };
}

function plural(
  forms: { one: string; other: string },
  count: number,
): KubernetesHealthText {
  return { text: forms.other, plural: { one: forms.one, count: count } };
}

interface Condition {
  type: string;
  status: string;
  reason: string;
  message: string;
  lastTransitionTime: number | null;
}

function readConditions(status: Json): Array<Condition> {
  return asArray(status["conditions"]).map((condition: Json): Condition => {
    return {
      type: readString(condition, "type"),
      status: readString(condition, "status"),
      reason: readString(condition, "reason"),
      message: readString(condition, "message"),
      lastTransitionTime: toTime(condition["lastTransitionTime"]),
    };
  });
}

function findCondition(
  conditions: Array<Condition>,
  type: string,
): Condition | undefined {
  return conditions.find((condition: Condition): boolean => {
    return condition.type === type;
  });
}

interface ContainerStatus {
  name: string;
  ready: boolean;
  state: string;
  reason: string;
  message: string;
  lastTerminationReason: string;
  lastTerminationExitCode: number | null;
  lastTerminatedAt: number | null;
}

function readContainerStatuses(
  status: Json,
  key: "containerStatuses" | "initContainerStatuses",
): Array<ContainerStatus> {
  return asArray(status[key]).map((container: Json): ContainerStatus => {
    return {
      name: readString(container, "name"),
      ready: readBoolean(container, "ready"),
      state: readString(container, "state"),
      reason: readString(container, "reason"),
      message: readString(container, "message"),
      lastTerminationReason: readString(container, "lastTerminationReason"),
      lastTerminationExitCode: readNumber(container, "lastTerminationExitCode"),
      lastTerminatedAt: toTime(container["lastTerminatedAt"]),
    };
  });
}

/*
 * Waits that mean a container cannot run as it is: it crashes, its image
 * cannot be pulled, or its configuration is wrong. A container waiting in
 * ContainerCreating or PodInitializing is starting.
 */
export const KUBERNETES_FAILING_WAIT_REASONS: ReadonlySet<string> =
  new Set<string>([
    "CrashLoopBackOff",
    "ImagePullBackOff",
    "ErrImagePull",
    "ErrImageNeverPull",
    "InvalidImageName",
    "CreateContainerConfigError",
    "CreateContainerError",
    "RunContainerError",
    "ContainerCannotRun",
    "PreStartHookError",
    "PostStartHookError",
  ]);

/*
 * ---------------------------------------------------------------------------
 * Owners
 * ---------------------------------------------------------------------------
 */

export interface KubernetesObjectRef {
  kind: string;
  namespace: string;
  name: string;
}

// The object's owners, as metadata.ownerReferences lists them.
export function getKubernetesOwners(
  row: Pick<KubernetesHealthRow, "ownerReferences">,
): Array<{ kind: string; name: string }> {
  const owners: unknown = row.ownerReferences;
  const items: Array<Json> = Array.isArray(owners)
    ? asArray(owners)
    : asArray(asObject(owners)["items"]);

  return items
    .map((owner: Json): { kind: string; name: string } => {
      return {
        kind: readString(owner, "kind"),
        name: readString(owner, "name"),
      };
    })
    .filter((owner: { kind: string; name: string }): boolean => {
      return Boolean(owner.kind && owner.name);
    });
}

/*
 * The Deployment a ReplicaSet belongs to: Kubernetes names a ReplicaSet
 * `<deployment>-<pod-template-hash>`, and the pod carries the hash as a
 * label. Without the label, the hash is the last dash-separated part.
 */
const POD_TEMPLATE_HASH: RegExp = /-[a-z0-9]{5,10}$/;

export function getDeploymentNameFromReplicaSet(
  replicaSet: string,
  podTemplateHash?: string | undefined,
): string {
  if (podTemplateHash && replicaSet.endsWith(`-${podTemplateHash}`)) {
    return replicaSet.substring(
      0,
      replicaSet.length - podTemplateHash.length - 1,
    );
  }
  return replicaSet.replace(POD_TEMPLATE_HASH, "");
}

/*
 * The DeploymentConfig a ReplicationController belongs to: OpenShift names
 * it `<deploymentconfig>-<version>` and labels the pods with the config's
 * name.
 */
const DEPLOYMENT_CONFIG_VERSION: RegExp = /-[0-9]+$/;

export function getDeploymentConfigNameFromReplicationController(
  replicationController: string,
  labels?: Json | undefined,
): string {
  const labelled: string = labels
    ? readString(labels, "openshift.io/deployment-config.name") ||
      readString(labels, "deploymentconfig")
    : "";
  return (
    labelled || replicationController.replace(DEPLOYMENT_CONFIG_VERSION, "")
  );
}

/*
 * The workload a pod belongs to - the one whose page a reader opens for it:
 * a ReplicaSet's Deployment, a ReplicationController's DeploymentConfig, a
 * StatefulSet, a DaemonSet or a Job. Null for a pod nothing owns, and for a
 * node's static pods.
 */
export function getKubernetesPodWorkload(
  row: KubernetesHealthRow,
): KubernetesObjectRef | null {
  const namespace: string = row.namespaceKey || "";
  const labels: Json = asObject(row.labels);

  for (const owner of getKubernetesOwners(row)) {
    if (owner.kind === "ReplicaSet") {
      return {
        kind: "Deployment",
        namespace: namespace,
        name: getDeploymentNameFromReplicaSet(
          owner.name,
          readString(labels, "pod-template-hash") || undefined,
        ),
      };
    }
    if (owner.kind === "ReplicationController") {
      return {
        kind: "DeploymentConfig",
        namespace: namespace,
        name: getDeploymentConfigNameFromReplicationController(
          owner.name,
          labels,
        ),
      };
    }
    if (
      owner.kind === "StatefulSet" ||
      owner.kind === "DaemonSet" ||
      owner.kind === "Job"
    ) {
      return { kind: owner.kind, namespace: namespace, name: owner.name };
    }
  }

  return null;
}

// The CronJob that created a Job, if one did.
export function getKubernetesJobCronJob(
  row: KubernetesHealthRow,
): KubernetesObjectRef | null {
  const owner: { kind: string; name: string } | undefined = getKubernetesOwners(
    row,
  ).find((candidate: { kind: string; name: string }): boolean => {
    return candidate.kind === "CronJob";
  });
  return owner
    ? { kind: "CronJob", namespace: row.namespaceKey || "", name: owner.name }
    : null;
}

/*
 * ---------------------------------------------------------------------------
 * The rules, kind by kind
 * ---------------------------------------------------------------------------
 */

interface Clock {
  observedAt: number;
  // How old the object was when it was observed; Infinity when unknown.
  age: number;
}

function clockOf(
  row: KubernetesHealthRow,
  options: KubernetesHealthOptions | undefined,
): Clock {
  const observedAt: number =
    toTime(row.lastSeenAt) ??
    (options?.now ? options.now.getTime() : Date.now());
  const createdAt: number | null = toTime(row.resourceCreationTimestamp);
  return {
    observedAt: observedAt,
    age: createdAt === null ? Infinity : observedAt - createdAt,
  };
}

function healthy(
  status: KubernetesHealthText,
  tone: KubernetesHealthTone = "positive",
): KubernetesHealthAssessment {
  return { severity: null, status: status, tone: tone, reasons: [] };
}

function worse(
  a: KubernetesHealthSeverity | null,
  b: KubernetesHealthSeverity | null,
): KubernetesHealthSeverity | null {
  if (
    a === KubernetesHealthSeverity.Critical ||
    b === KubernetesHealthSeverity.Critical
  ) {
    return KubernetesHealthSeverity.Critical;
  }
  return a || b;
}

function lastRestartReason(container: ContainerStatus): KubernetesHealthText {
  const reason: string = container.lastTerminationReason;
  if (
    container.lastTerminationExitCode !== null &&
    reason !== "OOMKilled" &&
    container.lastTerminationExitCode !== 0
  ) {
    return text(REASON_LAST_RESTART_WITH_CODE, {
      reason: reason,
      code: String(container.lastTerminationExitCode),
    });
  }
  return text(REASON_LAST_RESTART, { reason: reason });
}

export function assessKubernetesPod(
  row: KubernetesHealthRow,
  options?: KubernetesHealthOptions,
): KubernetesHealthAssessment {
  const clock: Clock = clockOf(row, options);
  const status: Json = asObject(row.status);
  const phase: string = row.phase || readString(status, "phase");
  const containers: Array<ContainerStatus> = readContainerStatuses(
    status,
    "containerStatuses",
  );
  const initContainers: Array<ContainerStatus> = readContainerStatuses(
    status,
    "initContainerStatuses",
  );
  const conditions: Array<Condition> = readConditions(status);
  const podReason: string = readString(status, "reason");
  const podMessage: string = readString(status, "message");
  const workload: KubernetesObjectRef | null = getKubernetesPodWorkload(row);

  if (phase === "Succeeded") {
    return healthy(text(STATUS_COMPLETED), "neutral");
  }

  /*
   * A container that cannot run says the most: why the pod is broken, in
   * Kubernetes' own word, and how its previous run ended.
   */
  const failingInit: ContainerStatus | undefined = initContainers.find(
    (container: ContainerStatus): boolean => {
      return (
        (container.state === "waiting" &&
          KUBERNETES_FAILING_WAIT_REASONS.has(container.reason)) ||
        (container.state === "terminated" &&
          Boolean(container.reason) &&
          container.reason !== "Completed")
      );
    },
  );
  const failing: ContainerStatus | undefined = containers.find(
    (container: ContainerStatus): boolean => {
      return (
        container.state === "waiting" &&
        KUBERNETES_FAILING_WAIT_REASONS.has(container.reason)
      );
    },
  );

  if (phase !== "Failed" && (failing || failingInit)) {
    const container: ContainerStatus = (failing || failingInit)!;
    const word: string = failing
      ? container.reason
      : `Init:${container.reason}`;
    const reasons: Array<KubernetesHealthText> = [asWritten(word)];
    if (container.lastTerminationReason) {
      reasons.push(lastRestartReason(container));
    }
    return {
      severity: KubernetesHealthSeverity.Critical,
      status: asWritten(word),
      tone: "danger",
      reasons: reasons,
      message: container.message || undefined,
    };
  }

  if (phase === "Failed") {
    const evicted: boolean = podReason === "Evicted";
    const word: KubernetesHealthText = evicted
      ? text(STATUS_EVICTED)
      : text(STATUS_FAILED);
    /*
     * When it failed: its Ready condition turned False then, and a
     * container's last run ended then. A pod whose controller replaced
     * it long ago is history, not a problem; a Job's pods are the Job's.
     */
    const ready: Condition | undefined = findCondition(conditions, "Ready");
    const endedAt: Array<number> = containers
      .map((container: ContainerStatus): number | null => {
        return container.lastTerminatedAt;
      })
      .filter((time: number | null): time is number => {
        return time !== null;
      });
    const failedAt: number | null =
      ready?.lastTransitionTime ??
      (endedAt.length > 0 ? Math.max(...endedAt) : null);
    const isRecent: boolean =
      failedAt !== null &&
      clock.observedAt - failedAt <= KUBERNETES_HEALTH_RECENT_MS;
    const failedContainer: ContainerStatus | undefined = containers.find(
      (container: ContainerStatus): boolean => {
        return (
          container.state === "terminated" &&
          Boolean(container.reason) &&
          container.reason !== "Completed"
        );
      },
    );
    const reasons: Array<KubernetesHealthText> = [
      evicted ? text(REASON_EVICTED) : text(REASON_FAILED),
    ];
    if (!evicted && failedContainer) {
      reasons.push(asWritten(failedContainer.reason));
    }
    return {
      severity:
        isRecent && workload?.kind !== "Job"
          ? KubernetesHealthSeverity.Warning
          : null,
      status: word,
      tone: "danger",
      reasons: reasons,
      message: podMessage || failedContainer?.message || undefined,
    };
  }

  if (phase === "Pending") {
    const scheduled: Condition | undefined = findCondition(
      conditions,
      "PodScheduled",
    );
    const unschedulable: boolean =
      scheduled?.status === "False" && scheduled.reason === "Unschedulable";
    const waiting: ContainerStatus | undefined = [
      ...initContainers,
      ...containers,
    ].find((container: ContainerStatus): boolean => {
      return container.state === "waiting" && Boolean(container.reason);
    });
    const stillStarting: boolean = clock.age < KUBERNETES_HEALTH_GRACE_MS;
    const reasons: Array<KubernetesHealthText> = unschedulable
      ? [text(REASON_CANNOT_BE_SCHEDULED)]
      : waiting
        ? [asWritten(waiting.reason)]
        : [text(REASON_PENDING)];
    return {
      severity: stillStarting ? null : KubernetesHealthSeverity.Warning,
      status: text(STATUS_PENDING),
      tone: "warning",
      reasons: stillStarting ? [] : reasons,
      message:
        (unschedulable ? scheduled?.message : waiting?.message) ||
        podMessage ||
        undefined,
    };
  }

  if (phase === "Running") {
    const notReady: Array<ContainerStatus> = containers.filter(
      (container: ContainerStatus): boolean => {
        return !container.ready;
      },
    );
    const ready: Condition | undefined = findCondition(conditions, "Ready");
    const notReadySince: number | null =
      ready && ready.status !== "True"
        ? ready.lastTransitionTime ??
          (Number.isFinite(clock.age) ? clock.observedAt - clock.age : null)
        : null;
    const notReadyLong: boolean =
      notReady.length > 0 &&
      (notReadySince === null
        ? clock.age >= KUBERNETES_HEALTH_GRACE_MS
        : clock.observedAt - notReadySince >= KUBERNETES_HEALTH_GRACE_MS);

    // A container that died just now and is being restarted.
    const justEnded: ContainerStatus | undefined = containers.find(
      (container: ContainerStatus): boolean => {
        return (
          container.state === "terminated" &&
          Boolean(container.reason) &&
          container.reason !== "Completed"
        );
      },
    );
    // A container the kernel killed for its memory limit within the hour.
    const oomKilled: ContainerStatus | undefined = containers.find(
      (container: ContainerStatus): boolean => {
        return (
          container.lastTerminationReason === "OOMKilled" &&
          container.lastTerminatedAt !== null &&
          clock.observedAt - container.lastTerminatedAt <=
            KUBERNETES_HEALTH_RECENT_MS
        );
      },
    );

    const reasons: Array<KubernetesHealthText> = [];
    if (justEnded) {
      reasons.push(asWritten(justEnded.reason));
    } else if (notReadyLong) {
      reasons.push(text(REASON_NOT_READY));
    }
    if (oomKilled) {
      reasons.push(lastRestartReason(oomKilled));
    }

    if (reasons.length > 0) {
      return {
        severity: KubernetesHealthSeverity.Warning,
        status: justEnded
          ? asWritten(justEnded.reason)
          : notReady.length > 0
            ? text(STATUS_NOT_READY)
            : text(STATUS_RUNNING),
        tone: justEnded || notReady.length > 0 ? "warning" : "positive",
        reasons: reasons,
        message:
          justEnded?.message ||
          (notReadyLong ? ready?.message : undefined) ||
          undefined,
      };
    }

    return notReady.length > 0
      ? healthy(text(STATUS_NOT_READY), "warning")
      : healthy(text(STATUS_RUNNING));
  }

  if (phase === "Unknown") {
    return {
      severity: KubernetesHealthSeverity.Warning,
      status: text(STATUS_UNKNOWN),
      tone: "warning",
      reasons: [text(REASON_UNKNOWN_STATE)],
      message: podMessage || undefined,
    };
  }

  return healthy(text(STATUS_NO_DATA), "neutral");
}

export function assessKubernetesNode(
  row: KubernetesHealthRow,
): KubernetesHealthAssessment {
  const status: Json = asObject(row.status);
  const spec: Json = asObject(row.spec);
  const conditions: Array<Condition> = readConditions(status);
  const ready: Condition | undefined = findCondition(conditions, "Ready");
  const network: Condition | undefined = findCondition(
    conditions,
    "NetworkUnavailable",
  );
  const isCordoned: boolean = readBoolean(spec, "unschedulable");

  const notReady: boolean =
    row.isReady === false || (ready !== undefined && ready.status !== "True");

  if (notReady) {
    /*
     * Unknown is a node that stopped talking to the API server: crashed,
     * powered off or cut off. False is a kubelet that says it is unwell.
     */
    const stoppedReporting: boolean = ready?.status === "Unknown";
    const reasons: Array<KubernetesHealthText> = [
      stoppedReporting
        ? text(REASON_STOPPED_REPORTING)
        : text(REASON_NOT_READY),
    ];
    if (network?.status === "True") {
      reasons.push(text(REASON_NETWORK_UNAVAILABLE));
    }
    return {
      severity: KubernetesHealthSeverity.Critical,
      status: stoppedReporting
        ? text(STATUS_STOPPED_REPORTING)
        : text(STATUS_NOT_READY),
      tone: "danger",
      reasons: reasons,
      message: ready?.message || undefined,
    };
  }

  if (network?.status === "True") {
    return {
      severity: KubernetesHealthSeverity.Critical,
      status: text(REASON_NETWORK_UNAVAILABLE),
      tone: "danger",
      reasons: [text(REASON_NETWORK_UNAVAILABLE)],
      message: network.message || undefined,
    };
  }

  const pressures: Array<{ word: string; condition: string; flag: boolean }> = [
    {
      word: REASON_MEMORY_PRESSURE,
      condition: "MemoryPressure",
      flag: row.hasMemoryPressure === true,
    },
    {
      word: REASON_DISK_PRESSURE,
      condition: "DiskPressure",
      flag: row.hasDiskPressure === true,
    },
    {
      word: REASON_PID_PRESSURE,
      condition: "PIDPressure",
      flag: row.hasPidPressure === true,
    },
  ].filter((pressure: { word: string; condition: string; flag: boolean }) => {
    return (
      pressure.flag ||
      findCondition(conditions, pressure.condition)?.status === "True"
    );
  });

  if (pressures.length > 0) {
    const first: { word: string; condition: string } = pressures[0]!;
    return {
      severity: KubernetesHealthSeverity.Warning,
      status: text(first.word),
      tone: "warning",
      reasons: pressures.map(
        (pressure: { word: string }): KubernetesHealthText => {
          return text(pressure.word);
        },
      ),
      message: findCondition(conditions, first.condition)?.message || undefined,
    };
  }

  if (isCordoned) {
    return healthy(text(STATUS_SCHEDULING_DISABLED), "neutral");
  }

  if (row.isReady === true || ready?.status === "True") {
    return healthy(text(STATUS_READY));
  }

  return healthy(text(STATUS_NO_DATA), "neutral");
}

/*
 * Replicas short of the ones wanted: all of them gone is critical once the
 * workload has had time to start; some of them, a warning - unless a
 * rollout under way explains it.
 */
function assessReplicaShortfall(data: {
  have: number;
  want: number;
  clock: Clock;
  isRollingOut: boolean;
  shortfall: KubernetesHealthText;
  healthyStatus: KubernetesHealthText;
}): KubernetesHealthAssessment {
  if (data.have >= data.want) {
    return healthy(data.healthyStatus);
  }

  const stillStarting: boolean = data.clock.age < KUBERNETES_HEALTH_GRACE_MS;

  if (data.have <= 0 && !stillStarting) {
    return {
      severity: KubernetesHealthSeverity.Critical,
      status: data.shortfall,
      tone: "danger",
      reasons: [data.shortfall],
    };
  }

  if (data.isRollingOut || stillStarting) {
    return healthy(text(STATUS_ROLLING_OUT), "neutral");
  }

  return {
    severity: KubernetesHealthSeverity.Warning,
    status: data.shortfall,
    tone: "warning",
    reasons: [data.shortfall],
  };
}

export function assessKubernetesDeployment(
  row: KubernetesHealthRow,
  options?: KubernetesHealthOptions,
): KubernetesHealthAssessment {
  const clock: Clock = clockOf(row, options);
  const spec: Json = asObject(row.spec);
  const status: Json = asObject(row.status);
  const desired: number | null = readNumber(spec, "replicas");
  const available: number = readNumber(status, "availableReplicas") ?? 0;
  const conditions: Array<Condition> = readConditions(status);
  const progressing: Condition | undefined = findCondition(
    conditions,
    "Progressing",
  );

  if (desired === null) {
    return healthy(text(STATUS_NO_DATA), "neutral");
  }

  // Past its progress deadline: Kubernetes itself gave up waiting.
  if (
    progressing?.status === "False" &&
    progressing.reason === "ProgressDeadlineExceeded"
  ) {
    const reasons: Array<KubernetesHealthText> = [text(REASON_ROLLOUT_STUCK)];
    if (available < desired) {
      reasons.push(
        text(REASON_AVAILABLE_OF, {
          available: String(available),
          desired: String(desired),
        }),
      );
    }
    return {
      severity: KubernetesHealthSeverity.Critical,
      status: text(STATUS_ROLLOUT_STUCK),
      tone: "danger",
      reasons: reasons,
      message: progressing.message || undefined,
    };
  }

  if (desired === 0) {
    return healthy(text(STATUS_SCALED_TO_ZERO), "neutral");
  }

  const isPaused: boolean = readBoolean(spec, "paused");

  return assessReplicaShortfall({
    have: available,
    want: desired,
    clock: clock,
    /*
     * A new ReplicaSet is being rolled out until Kubernetes reports
     * NewReplicaSetAvailable; its deadline turns a stuck one critical.
     */
    isRollingOut:
      progressing?.status === "True" &&
      progressing.reason === "ReplicaSetUpdated",
    shortfall: text(REASON_AVAILABLE_OF, {
      available: String(available),
      desired: String(desired),
    }),
    healthyStatus: isPaused ? text(STATUS_PAUSED) : text(STATUS_AVAILABLE),
  });
}

export function assessKubernetesStatefulSet(
  row: KubernetesHealthRow,
  options?: KubernetesHealthOptions,
): KubernetesHealthAssessment {
  const clock: Clock = clockOf(row, options);
  const spec: Json = asObject(row.spec);
  const status: Json = asObject(row.status);
  const desired: number | null = readNumber(spec, "replicas");
  const ready: number = readNumber(status, "readyReplicas") ?? 0;
  const currentRevision: string = readString(status, "currentRevision");
  const updateRevision: string = readString(status, "updateRevision");

  if (desired === null) {
    return healthy(text(STATUS_NO_DATA), "neutral");
  }

  if (desired === 0) {
    return healthy(text(STATUS_SCALED_TO_ZERO), "neutral");
  }

  return assessReplicaShortfall({
    have: ready,
    want: desired,
    clock: clock,
    // An update replaces the pods one at a time, each briefly not ready.
    isRollingOut: Boolean(
      currentRevision && updateRevision && currentRevision !== updateRevision,
    ),
    shortfall: text(REASON_READY_OF, {
      ready: String(ready),
      desired: String(desired),
    }),
    healthyStatus: text(STATUS_READY),
  });
}

export function assessKubernetesDaemonSet(
  row: KubernetesHealthRow,
  options?: KubernetesHealthOptions,
): KubernetesHealthAssessment {
  const clock: Clock = clockOf(row, options);
  const status: Json = asObject(row.status);
  const desired: number = readNumber(status, "desiredNumberScheduled") ?? 0;
  const ready: number = readNumber(status, "numberReady") ?? 0;
  const misscheduled: number = readNumber(status, "numberMisscheduled") ?? 0;
  const updated: number | null = readNumber(status, "updatedNumberScheduled");

  if (desired === 0) {
    return misscheduled > 0
      ? {
          severity: KubernetesHealthSeverity.Warning,
          status: text(STATUS_NO_NODES),
          tone: "warning",
          reasons: [plural(REASON_MISSCHEDULED, misscheduled)],
        }
      : healthy(text(STATUS_NO_NODES), "neutral");
  }

  const assessment: KubernetesHealthAssessment = assessReplicaShortfall({
    have: ready,
    want: desired,
    clock: clock,
    isRollingOut: updated !== null && updated < desired,
    shortfall: text(REASON_READY_ON_NODES, {
      ready: String(ready),
      desired: String(desired),
    }),
    healthyStatus: text(STATUS_READY),
  });

  if (misscheduled <= 0) {
    return assessment;
  }

  return {
    ...assessment,
    severity: worse(assessment.severity, KubernetesHealthSeverity.Warning),
    tone: assessment.tone === "danger" ? "danger" : "warning",
    reasons: [...assessment.reasons, plural(REASON_MISSCHEDULED, misscheduled)],
  };
}

export function assessKubernetesJob(
  row: KubernetesHealthRow,
): KubernetesHealthAssessment {
  const status: Json = asObject(row.status);
  const conditions: Array<Condition> = readConditions(status);
  const failed: Condition | undefined = conditions.find(
    (condition: Condition): boolean => {
      return condition.type === "Failed" && condition.status === "True";
    },
  );

  if (failed) {
    const reasons: Array<KubernetesHealthText> = [text(REASON_FAILED)];
    if (failed.reason) {
      reasons.push(asWritten(failed.reason));
    }
    return {
      severity: KubernetesHealthSeverity.Warning,
      status: text(STATUS_FAILED),
      tone: "danger",
      reasons: reasons,
      message: failed.message || undefined,
    };
  }

  const complete: boolean = conditions.some((condition: Condition): boolean => {
    return condition.type === "Complete" && condition.status === "True";
  });

  if (complete) {
    return healthy(text(STATUS_COMPLETED), "neutral");
  }

  if ((readNumber(status, "active") ?? 0) > 0) {
    return healthy(text(STATUS_RUNNING));
  }

  return healthy(text(STATUS_PENDING), "neutral");
}

export function assessKubernetesCronJob(
  row: KubernetesHealthRow,
): KubernetesHealthAssessment {
  const spec: Json = asObject(row.spec);
  const status: Json = asObject(row.status);

  if (readBoolean(spec, "suspend")) {
    return healthy(text(STATUS_SUSPENDED), "neutral");
  }

  if ((readNumber(status, "activeCount") ?? 0) > 0) {
    return healthy(text(STATUS_RUNNING));
  }

  return healthy(text(STATUS_SCHEDULED));
}

export function assessKubernetesVolumeClaim(
  row: KubernetesHealthRow,
  options?: KubernetesHealthOptions,
): KubernetesHealthAssessment {
  const clock: Clock = clockOf(row, options);
  const phase: string = readString(asObject(row.status), "phase");

  if (phase === "Lost") {
    return {
      severity: KubernetesHealthSeverity.Critical,
      status: text(STATUS_LOST),
      tone: "danger",
      reasons: [text(REASON_VOLUME_LOST)],
    };
  }

  if (phase === "Pending") {
    const stillStarting: boolean = clock.age < KUBERNETES_HEALTH_GRACE_MS;
    return {
      severity: stillStarting ? null : KubernetesHealthSeverity.Warning,
      status: text(STATUS_PENDING),
      tone: "warning",
      reasons: stillStarting ? [] : [text(REASON_WAITING_FOR_VOLUME)],
    };
  }

  if (phase === "Bound") {
    return healthy(text(STATUS_BOUND));
  }

  return healthy(phase ? asWritten(phase) : text(STATUS_NO_DATA), "neutral");
}

export function assessKubernetesVolume(
  row: KubernetesHealthRow,
): KubernetesHealthAssessment {
  const phase: string = readString(asObject(row.status), "phase");

  if (phase === "Failed") {
    return {
      severity: KubernetesHealthSeverity.Critical,
      status: text(STATUS_FAILED),
      tone: "danger",
      reasons: [text(REASON_RECLAIM_FAILED)],
    };
  }

  if (phase === "Bound") {
    return healthy(text(STATUS_BOUND));
  }

  if (phase === "Available") {
    return healthy(text(STATUS_AVAILABLE));
  }

  if (phase === "Released") {
    return healthy(text(STATUS_RELEASED), "neutral");
  }

  if (phase === "Pending") {
    return healthy(text(STATUS_PENDING), "warning");
  }

  return healthy(phase ? asWritten(phase) : text(STATUS_NO_DATA), "neutral");
}

export function assessKubernetesAutoscaler(
  row: KubernetesHealthRow,
): KubernetesHealthAssessment {
  const spec: Json = asObject(row.spec);
  const status: Json = asObject(row.status);
  const conditions: Array<Condition> = readConditions(status);
  const minReplicas: number = readNumber(spec, "minReplicas") ?? 1;
  const maxReplicas: number | null = readNumber(spec, "maxReplicas");
  const current: number | null = readNumber(status, "currentReplicas");

  /*
   * An autoscaler that cannot read its metrics, or cannot change its
   * target, holds the replica count wherever it is.
   */
  const stuck: Condition | undefined = conditions.find(
    (condition: Condition): boolean => {
      return (
        (condition.type === "ScalingActive" ||
          condition.type === "AbleToScale") &&
        condition.status === "False" &&
        // A target scaled to zero switches scaling off on purpose.
        condition.reason !== "ScalingDisabled"
      );
    },
  );

  if (stuck) {
    return {
      severity: KubernetesHealthSeverity.Warning,
      status: text(STATUS_CANNOT_SCALE),
      tone: "warning",
      reasons: [
        text(REASON_CANNOT_SCALE, { reason: stuck.reason || stuck.type }),
      ],
      message: stuck.message || undefined,
    };
  }

  if (
    maxReplicas !== null &&
    current !== null &&
    maxReplicas > minReplicas &&
    current >= maxReplicas
  ) {
    return {
      severity: KubernetesHealthSeverity.Warning,
      status: text(STATUS_AT_MAXIMUM),
      tone: "warning",
      reasons: [plural(REASON_AT_MAXIMUM, maxReplicas)],
      message:
        findCondition(conditions, "ScalingLimited")?.message || undefined,
    };
  }

  return healthy(text(STATUS_ACTIVE));
}

/*
 * An OpenShift DeploymentConfig, from its stored state (the phase ingest
 * writes, OpenShiftObjectParser.getDeploymentConfigState): none of its
 * replicas available is critical once it has had time to start. A
 * partial one may be mid-rollout, and its page says so.
 */
export function assessKubernetesDeploymentConfig(
  row: KubernetesHealthRow,
  options?: KubernetesHealthOptions,
): KubernetesHealthAssessment {
  const clock: Clock = clockOf(row, options);
  const spec: Json = asObject(row.spec);
  const status: Json = asObject(row.status);
  const desired: number = readNumber(spec, "replicas") ?? 0;
  const available: number = readNumber(status, "availableReplicas") ?? 0;

  if (readBoolean(spec, "paused")) {
    return healthy(text(STATUS_PAUSED), "neutral");
  }
  if (desired === 0) {
    return healthy(text(STATUS_SCALED_TO_ZERO), "neutral");
  }
  if (available >= desired) {
    return healthy(text(STATUS_AVAILABLE));
  }
  if (available > 0 || clock.age < KUBERNETES_HEALTH_GRACE_MS) {
    return healthy(text(STATUS_ROLLING_OUT), "neutral");
  }
  const shortfall: KubernetesHealthText = text(REASON_AVAILABLE_OF, {
    available: String(available),
    desired: String(desired),
  });
  return {
    severity: KubernetesHealthSeverity.Critical,
    status: shortfall,
    tone: "danger",
    reasons: [shortfall],
  };
}

export function assessKubernetesNamespace(
  row: KubernetesHealthRow,
): KubernetesHealthAssessment {
  const phase: string = readString(asObject(row.status), "phase");
  if (phase === "Terminating") {
    return healthy(text(STATUS_TERMINATING), "warning");
  }
  return healthy(
    phase === "Active" || !phase ? text(STATUS_ACTIVE) : asWritten(phase),
  );
}

/*
 * Any inventory row's verdict, by its kind. Kinds with no rules of their
 * own (a Service, a Route, OpenShift's operators, which their own card
 * reads) only say their state.
 */
export function assessKubernetesResource(
  row: KubernetesHealthRow,
  options?: KubernetesHealthOptions,
): KubernetesHealthAssessment {
  switch (row.kind) {
    case "Pod":
      return assessKubernetesPod(row, options);
    case "Node":
      return assessKubernetesNode(row);
    case "Deployment":
      return assessKubernetesDeployment(row, options);
    case "StatefulSet":
      return assessKubernetesStatefulSet(row, options);
    case "DaemonSet":
      return assessKubernetesDaemonSet(row, options);
    case "Job":
      return assessKubernetesJob(row);
    case "CronJob":
      return assessKubernetesCronJob(row);
    case "PersistentVolumeClaim":
      return assessKubernetesVolumeClaim(row, options);
    case "PersistentVolume":
      return assessKubernetesVolume(row);
    case "HorizontalPodAutoscaler":
      return assessKubernetesAutoscaler(row);
    case "DeploymentConfig":
      return assessKubernetesDeploymentConfig(row, options);
    case "Namespace":
      return assessKubernetesNamespace(row);
    default:
      return healthy(
        row.phase ? asWritten(row.phase) : text(STATUS_NO_DATA),
        row.isReady === false ? "warning" : "neutral",
      );
  }
}

// What ingest stores in KubernetesResource.healthSeverity.
export function getKubernetesHealthSeverity(
  row: KubernetesHealthRow,
  options?: KubernetesHealthOptions,
): KubernetesHealthSeverity | null {
  try {
    return assessKubernetesResource(row, options).severity;
  } catch {
    // A row the rules cannot read is never flagged; it never fails ingest.
    return null;
  }
}

/*
 * ---------------------------------------------------------------------------
 * What needs attention in a cluster
 * ---------------------------------------------------------------------------
 *
 * People run workloads, not pods: three replicas of `checkout` crash-looping
 * is one problem with one page to open - the Deployment - not three. So a
 * pod's findings fold into the workload it belongs to when that workload is
 * in the inventory: the Deployment's row says "1 of 3 available" and why
 * (CrashLoopBackOff, its last restart), with the message of the worst pod.
 * A pod nothing owns is its own finding. A Job is a CronJob's run: only the
 * newest run of each CronJob counts, and folds into the CronJob as "Last
 * run failed" - a run that failed last week and has succeeded since is
 * history.
 *
 * A part's own page passes `foldPods: false`: there each of its pods is a
 * row of its own, one step from that pod's page.
 */

export interface KubernetesAttentionFinding {
  // Unique in the cluster: "Deployment:payments/checkout", "Node:node-3".
  key: string;
  kind: string;
  namespace: string;
  name: string;
  severity: KubernetesHealthSeverity;
  reasons: Array<KubernetesHealthText>;
  message?: string | undefined;
  // How many of its pods need attention, for a workload that has some.
  podCount?: number | undefined;
}

// The order the kinds are listed in at one severity.
export const KUBERNETES_ATTENTION_KIND_ORDER: Array<string> = [
  "Node",
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "DeploymentConfig",
  "CronJob",
  "Job",
  "Pod",
  "PersistentVolumeClaim",
  "PersistentVolume",
  "HorizontalPodAutoscaler",
];

const WORKLOAD_KINDS: ReadonlySet<string> = new Set<string>([
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "Job",
  "CronJob",
  "DeploymentConfig",
]);

export function kubernetesObjectKey(
  kind: string,
  namespace: string,
  name: string,
): string {
  return namespace ? `${kind}:${namespace}/${name}` : `${kind}:${name}`;
}

function keyOfRow(row: KubernetesHealthRow): string {
  return kubernetesObjectKey(
    row.kind || "",
    row.namespaceKey || "",
    row.name || "",
  );
}

function sameText(a: KubernetesHealthText, b: KubernetesHealthText): boolean {
  return (
    a.text === b.text &&
    JSON.stringify(a.values || {}) === JSON.stringify(b.values || {}) &&
    (a.plural?.count ?? null) === (b.plural?.count ?? null)
  );
}

function addReasons(
  into: Array<KubernetesHealthText>,
  reasons: Array<KubernetesHealthText>,
): void {
  for (const reason of reasons) {
    if (
      !into.some((existing: KubernetesHealthText): boolean => {
        return sameText(existing, reason);
      })
    ) {
      into.push(reason);
    }
  }
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function sortKubernetesAttentionFindings(
  findings: Array<KubernetesAttentionFinding>,
): Array<KubernetesAttentionFinding> {
  const kindRank: (kind: string) => number = (kind: string): number => {
    const index: number = KUBERNETES_ATTENTION_KIND_ORDER.indexOf(kind);
    return index === -1 ? KUBERNETES_ATTENTION_KIND_ORDER.length : index;
  };

  return [...findings].sort(
    (a: KubernetesAttentionFinding, b: KubernetesAttentionFinding): number => {
      if (a.severity !== b.severity) {
        return a.severity === KubernetesHealthSeverity.Critical ? -1 : 1;
      }
      const kind: number = kindRank(a.kind) - kindRank(b.kind);
      if (kind !== 0) {
        return kind;
      }
      const namespace: number = compareNames(a.namespace, b.namespace);
      if (namespace !== 0) {
        return namespace;
      }
      return compareNames(a.name, b.name);
    },
  );
}

/*
 * The newest Job of each CronJob, by when it was created (Kubernetes names
 * them by their scheduled time, so a tie falls back to the name).
 */
export function getNewestKubernetesJobs(
  rows: Array<KubernetesHealthRow>,
): Map<string, KubernetesHealthRow> {
  const newest: Map<string, KubernetesHealthRow> = new Map<
    string,
    KubernetesHealthRow
  >();

  for (const row of rows) {
    if (row.kind !== "Job") {
      continue;
    }
    const cronJob: KubernetesObjectRef | null = getKubernetesJobCronJob(row);
    if (!cronJob) {
      continue;
    }
    const key: string = kubernetesObjectKey(
      "CronJob",
      cronJob.namespace,
      cronJob.name,
    );
    const current: KubernetesHealthRow | undefined = newest.get(key);
    if (!current) {
      newest.set(key, row);
      continue;
    }
    const rowTime: number = toTime(row.resourceCreationTimestamp) ?? 0;
    const currentTime: number = toTime(current.resourceCreationTimestamp) ?? 0;
    if (
      rowTime > currentTime ||
      (rowTime === currentTime &&
        compareNames(row.name || "", current.name || "") > 0)
    ) {
      newest.set(key, row);
    }
  }

  return newest;
}

interface FindingDraft {
  key: string;
  kind: string;
  namespace: string;
  name: string;
  severity: KubernetesHealthSeverity | null;
  reasons: Array<KubernetesHealthText>;
  message?: string | undefined;
  // The worst message among its pods, used when it has none of its own.
  podMessage?: string | undefined;
  podMessageSeverity?: KubernetesHealthSeverity | null | undefined;
  podCount: number;
}

export function getKubernetesAttentionFindings(
  rows: Array<KubernetesHealthRow>,
  options?: KubernetesHealthOptions & { foldPods?: boolean | undefined },
): Array<KubernetesAttentionFinding> {
  const foldPods: boolean = options?.foldPods !== false;
  const byKey: Map<string, KubernetesHealthRow> = new Map<
    string,
    KubernetesHealthRow
  >();

  for (const row of rows) {
    if (!row.kind || !row.name) {
      continue;
    }
    byKey.set(keyOfRow(row), row);
  }

  const newestJobs: Map<string, KubernetesHealthRow> = getNewestKubernetesJobs(
    Array.from(byKey.values()),
  );

  /*
   * A CronJob's run that a newer run replaced is history: neither it nor
   * its pods need attention.
   */
  const isSupersededJob: (job: KubernetesHealthRow) => boolean = (
    job: KubernetesHealthRow,
  ): boolean => {
    const cronJob: KubernetesObjectRef | null = getKubernetesJobCronJob(job);
    if (!cronJob) {
      return false;
    }
    const newest: KubernetesHealthRow | undefined = newestJobs.get(
      kubernetesObjectKey("CronJob", cronJob.namespace, cronJob.name),
    );
    return Boolean(newest) && keyOfRow(newest!) !== keyOfRow(job);
  };

  const drafts: Map<string, FindingDraft> = new Map<string, FindingDraft>();

  const draftFor: (row: KubernetesHealthRow) => FindingDraft = (
    row: KubernetesHealthRow,
  ): FindingDraft => {
    const key: string = keyOfRow(row);
    let draft: FindingDraft | undefined = drafts.get(key);
    if (!draft) {
      draft = {
        key: key,
        kind: row.kind || "",
        namespace: row.namespaceKey || "",
        name: row.name || "",
        severity: null,
        reasons: [],
        podCount: 0,
      };
      drafts.set(key, draft);
    }
    return draft;
  };

  for (const row of byKey.values()) {
    if (row.kind === "Pod") {
      continue;
    }
    if (row.kind === "Job" && isSupersededJob(row)) {
      continue;
    }
    const assessment: KubernetesHealthAssessment = assessKubernetesResource(
      row,
      options,
    );
    if (!assessment.severity) {
      continue;
    }
    const draft: FindingDraft = draftFor(row);
    draft.severity = worse(draft.severity, assessment.severity);
    addReasons(draft.reasons, assessment.reasons);
    draft.message = draft.message || assessment.message;
  }

  for (const row of byKey.values()) {
    if (row.kind !== "Pod") {
      continue;
    }
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      row,
      options,
    );
    if (!assessment.severity) {
      continue;
    }

    const workload: KubernetesObjectRef | null = getKubernetesPodWorkload(row);
    const owner: KubernetesHealthRow | undefined = workload
      ? byKey.get(
          kubernetesObjectKey(workload.kind, workload.namespace, workload.name),
        )
      : undefined;

    if (owner && owner.kind === "Job" && isSupersededJob(owner)) {
      continue;
    }

    if (!foldPods || !owner || !WORKLOAD_KINDS.has(owner.kind || "")) {
      const draft: FindingDraft = draftFor(row);
      draft.severity = worse(draft.severity, assessment.severity);
      addReasons(draft.reasons, assessment.reasons);
      draft.message = draft.message || assessment.message;
      continue;
    }

    const draft: FindingDraft = draftFor(owner);
    draft.severity = worse(draft.severity, assessment.severity);
    addReasons(draft.reasons, assessment.reasons);
    draft.podCount++;
    if (
      assessment.message &&
      (!draft.podMessage ||
        (assessment.severity === KubernetesHealthSeverity.Critical &&
          draft.podMessageSeverity !== KubernetesHealthSeverity.Critical))
    ) {
      draft.podMessage = assessment.message;
      draft.podMessageSeverity = assessment.severity;
    }
  }

  /*
   * A CronJob's newest run that needs attention is the CronJob's: "Last
   * run failed", and why. Folded only when the CronJob is in the
   * inventory, so the row always opens a page that exists.
   */
  if (foldPods) {
    for (const [cronJobKey, job] of newestJobs) {
      const jobDraft: FindingDraft | undefined = drafts.get(keyOfRow(job));
      const cronJob: KubernetesHealthRow | undefined = byKey.get(cronJobKey);
      if (!jobDraft || !jobDraft.severity || !cronJob) {
        continue;
      }
      const draft: FindingDraft = draftFor(cronJob);
      draft.severity = worse(draft.severity, jobDraft.severity);
      const failed: boolean = assessKubernetesJob(job).severity !== null;
      const reasons: Array<KubernetesHealthText> = jobDraft.reasons.filter(
        (reason: KubernetesHealthText): boolean => {
          return reason.text !== REASON_FAILED;
        },
      );
      addReasons(
        draft.reasons,
        failed ? [text(REASON_LAST_RUN_FAILED), ...reasons] : reasons,
      );
      draft.message = draft.message || jobDraft.message || jobDraft.podMessage;
      draft.podCount += jobDraft.podCount;
      drafts.delete(jobDraft.key);
    }
  }

  const findings: Array<KubernetesAttentionFinding> = [];

  for (const draft of drafts.values()) {
    if (!draft.severity) {
      continue;
    }
    const finding: KubernetesAttentionFinding = {
      key: draft.key,
      kind: draft.kind,
      namespace: draft.namespace,
      name: draft.name,
      severity: draft.severity,
      reasons: draft.reasons,
    };
    const message: string | undefined = draft.message || draft.podMessage;
    if (message) {
      finding.message = message;
    }
    if (draft.podCount > 0) {
      finding.podCount = draft.podCount;
    }
    findings.push(finding);
  }

  return sortKubernetesAttentionFindings(findings);
}

/*
 * A CronJob's own verdict once its runs are known: "Last run failed" when
 * its newest Job failed, else its schedule's state. Its page shows this in
 * its hero; the cluster's Needs attention gets it from the findings.
 */
export function assessKubernetesCronJobWithRuns(
  cronJob: KubernetesHealthRow,
  jobs: Array<KubernetesHealthRow>,
): KubernetesHealthAssessment {
  const own: KubernetesHealthAssessment = assessKubernetesCronJob(cronJob);
  const newest: KubernetesHealthRow | undefined = getNewestKubernetesJobs(
    jobs.filter((job: KubernetesHealthRow): boolean => {
      const owner: KubernetesObjectRef | null = getKubernetesJobCronJob(job);
      return (
        Boolean(owner) &&
        owner!.name === cronJob.name &&
        owner!.namespace === (cronJob.namespaceKey || "")
      );
    }),
  ).get(
    kubernetesObjectKey(
      "CronJob",
      cronJob.namespaceKey || "",
      cronJob.name || "",
    ),
  );

  if (!newest || readBoolean(asObject(cronJob.spec), "suspend")) {
    return own;
  }

  const run: KubernetesHealthAssessment = assessKubernetesJob(newest);
  if (!run.severity) {
    return own;
  }

  return {
    severity: run.severity,
    status: text(STATUS_LAST_RUN_FAILED),
    tone: "danger",
    reasons: [
      text(REASON_LAST_RUN_FAILED),
      ...run.reasons.filter((reason: KubernetesHealthText): boolean => {
        return reason.text !== REASON_FAILED;
      }),
    ],
    message: run.message,
  };
}

/*
 * The cluster's health from what needs attention in it: anything critical
 * makes it Unhealthy, anything else Degraded, nothing Healthy.
 */
export function getKubernetesClusterHealth(
  findings: Array<Pick<KubernetesAttentionFinding, "severity">>,
): "Healthy" | "Degraded" | "Unhealthy" {
  if (
    findings.some(
      (finding: Pick<KubernetesAttentionFinding, "severity">): boolean => {
        return finding.severity === KubernetesHealthSeverity.Critical;
      },
    )
  ) {
    return "Unhealthy";
  }
  return findings.length > 0 ? "Degraded" : "Healthy";
}
