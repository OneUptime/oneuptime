import { JSONObject } from "../JSON";

/*
 * ============================================================
 * KubernetesFailureExplainer
 *
 * Pure, dependency-light rules that turn raw pod/node status
 * JSON (as stored in KubernetesResource.spec/.status, or as
 * fetched client-side) into human-readable failure explanations
 * with evidence and actionable recommendations.
 *
 * Every field access is defensive: these JSON blobs come from
 * arbitrary clusters and may be missing or malformed.
 * ============================================================
 */

export type KubernetesFailureSeverity = "critical" | "warning" | "info";

export interface KubernetesFailureEvidence {
  label: string;
  value: string;
}

export interface KubernetesFailureExplanation {
  id: string;
  severity: KubernetesFailureSeverity;
  title: string;
  summary: string;
  evidence: Array<KubernetesFailureEvidence>;
  recommendation: string;
}

export interface KubernetesPodFailureInput {
  podName: string;
  namespace?: string | undefined;
  phase?: string | undefined;
  spec?: JSONObject | undefined;
  status?: JSONObject | undefined;
  recentEvents?:
    | Array<{
        type: string;
        reason: string;
        message: string;
        timestamp?: Date | undefined;
      }>
    | undefined;
  /*
   * Wall-clock reference for time-based rules (stuck terminating).
   * Passed in rather than read inside so the function stays pure.
   */
  now?: Date | undefined;
}

export interface KubernetesNodeConditionInput {
  nodeName: string;
  status?: JSONObject | undefined;
}

// --- defensive JSON accessors ---------------------------------------

function toObject(value: unknown): JSONObject | null {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  ) {
    return value as JSONObject;
  }
  return null;
}

function toObjectArray(value: unknown): Array<JSONObject> {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: Array<JSONObject> = [];
  for (const item of value) {
    const obj: JSONObject | null = toObject(item);
    if (obj) {
      result.push(obj);
    }
  }
  return result;
}

function toStringValue(value: unknown): string | null {
  if (typeof value === "string" && value !== "") {
    return value;
  }
  return null;
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function toDateValue(value: unknown): Date | null {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "string" && value !== "") {
    const parsed: Date = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

function toStringArray(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: Array<string> = [];
  for (const item of value) {
    if (typeof item === "string" && item !== "") {
      result.push(item);
    }
  }
  return result;
}

// --- shared pod-shape helpers ----------------------------------------

interface ContainerStatusEntry {
  containerStatus: JSONObject;
  isInitContainer: boolean;
}

function getAllContainerStatuses(
  status: JSONObject | undefined,
): Array<ContainerStatusEntry> {
  const entries: Array<ContainerStatusEntry> = [];
  if (!status) {
    return entries;
  }
  for (const containerStatus of toObjectArray(status["containerStatuses"])) {
    entries.push({ containerStatus, isInitContainer: false });
  }
  for (const containerStatus of toObjectArray(
    status["initContainerStatuses"],
  )) {
    entries.push({ containerStatus, isInitContainer: true });
  }
  return entries;
}

function getAllContainerSpecs(
  spec: JSONObject | undefined,
): Array<JSONObject> {
  if (!spec) {
    return [];
  }
  return [
    ...toObjectArray(spec["containers"]),
    ...toObjectArray(spec["initContainers"]),
  ];
}

function getContainerSpecByName(
  spec: JSONObject | undefined,
  containerName: string,
): JSONObject | null {
  for (const containerSpec of getAllContainerSpecs(spec)) {
    if (toStringValue(containerSpec["name"]) === containerName) {
      return containerSpec;
    }
  }
  return null;
}

function getResourceValue(
  containerSpec: JSONObject | null,
  section: "limits" | "requests",
  resourceName: string,
): string | null {
  if (!containerSpec) {
    return null;
  }
  const resources: JSONObject | null = toObject(containerSpec["resources"]);
  if (!resources) {
    return null;
  }
  const sectionObj: JSONObject | null = toObject(resources[section]);
  if (!sectionObj) {
    return null;
  }
  return toStringValue(sectionObj[resourceName]);
}

function getContainerName(
  entry: ContainerStatusEntry,
  fallbackIndex: number,
): string {
  const name: string | null = toStringValue(entry.containerStatus["name"]);
  const base: string = name || `container-${fallbackIndex}`;
  return entry.isInitContainer ? `${base} (init container)` : base;
}

function getWaitingState(containerStatus: JSONObject): JSONObject | null {
  const state: JSONObject | null = toObject(containerStatus["state"]);
  if (!state) {
    return null;
  }
  return toObject(state["waiting"]);
}

function getTerminatedState(
  containerStatus: JSONObject,
  from: "state" | "lastState",
): JSONObject | null {
  const state: JSONObject | null = toObject(containerStatus[from]);
  if (!state) {
    return null;
  }
  return toObject(state["terminated"]);
}

function describeExitCode(exitCode: number): string {
  if (exitCode === 137) {
    return "exit code 137 means the process was SIGKILLed — usually the OOM killer (memory limit exceeded) or a failing liveness probe";
  }
  if (exitCode === 143) {
    return "exit code 143 means the process received SIGTERM and shut down — often a normal stop that keeps recurring";
  }
  if (exitCode === 126) {
    return "exit code 126 means the container command was found but is not executable";
  }
  if (exitCode === 127) {
    return "exit code 127 means the container command was not found — check the image entrypoint/command";
  }
  if (exitCode === 1) {
    return "exit code 1 is a generic application error — the process exited on its own";
  }
  return `exit code ${exitCode} comes from the application itself — check its documentation`;
}

// --- pod failure rules -----------------------------------------------

function explainCrashLoopBackOff(
  input: KubernetesPodFailureInput,
): Array<KubernetesFailureExplanation> {
  const explanations: Array<KubernetesFailureExplanation> = [];
  const entries: Array<ContainerStatusEntry> = getAllContainerStatuses(
    input.status,
  );

  entries.forEach((entry: ContainerStatusEntry, index: number) => {
    const waiting: JSONObject | null = getWaitingState(entry.containerStatus);
    if (!waiting || toStringValue(waiting["reason"]) !== "CrashLoopBackOff") {
      return;
    }

    const containerName: string = getContainerName(entry, index);
    const evidence: Array<KubernetesFailureEvidence> = [
      { label: "Container", value: containerName },
    ];

    const restartCount: number | null = toNumberValue(
      entry.containerStatus["restartCount"],
    );
    if (restartCount !== null) {
      evidence.push({ label: "Restart count", value: String(restartCount) });
    }

    const lastTerminated: JSONObject | null = getTerminatedState(
      entry.containerStatus,
      "lastState",
    );
    const exitCode: number | null = lastTerminated
      ? toNumberValue(lastTerminated["exitCode"])
      : null;
    if (lastTerminated) {
      if (exitCode !== null) {
        evidence.push({ label: "Last exit code", value: String(exitCode) });
      }
      const terminatedReason: string | null = toStringValue(
        lastTerminated["reason"],
      );
      if (terminatedReason) {
        evidence.push({
          label: "Last termination reason",
          value: terminatedReason,
        });
      }
      const finishedAt: string | null = toStringValue(
        lastTerminated["finishedAt"],
      );
      if (finishedAt) {
        evidence.push({ label: "Last terminated at", value: finishedAt });
      }
    }

    const waitingMessage: string | null = toStringValue(waiting["message"]);
    if (waitingMessage) {
      evidence.push({ label: "Backoff message", value: waitingMessage });
    }

    const exitCodeDescription: string | null =
      exitCode !== null ? describeExitCode(exitCode) : null;
    const exitCodeHint: string = exitCodeDescription
      ? ` ${exitCodeDescription.charAt(0).toUpperCase()}${exitCodeDescription.slice(1)}.`
      : " Common exit codes: 137 = SIGKILL (OOM kill or liveness-probe kill), 1 = application error.";

    explanations.push({
      id: `crash-loop-backoff-${containerName}`,
      severity: "critical",
      title: `Container "${containerName}" is in CrashLoopBackOff`,
      summary: `The container keeps crashing shortly after starting, so Kubernetes is restarting it with an increasing backoff delay${
        restartCount !== null ? ` (${restartCount} restarts so far)` : ""
      }.`,
      evidence,
      recommendation:
        `Check the container logs for "${containerName}" (including previous-instance logs) to see why the process exits.${exitCodeHint}` +
        " Fix the underlying crash — the backoff will clear on its own once the container stays up.",
    });
  });

  return explanations;
}

function explainOOMKilled(
  input: KubernetesPodFailureInput,
): Array<KubernetesFailureExplanation> {
  const explanations: Array<KubernetesFailureExplanation> = [];
  const entries: Array<ContainerStatusEntry> = getAllContainerStatuses(
    input.status,
  );

  entries.forEach((entry: ContainerStatusEntry, index: number) => {
    const lastTerminated: JSONObject | null = getTerminatedState(
      entry.containerStatus,
      "lastState",
    );
    const currentTerminated: JSONObject | null = getTerminatedState(
      entry.containerStatus,
      "state",
    );

    const isOomKilled: boolean =
      (lastTerminated !== null &&
        toStringValue(lastTerminated["reason"]) === "OOMKilled") ||
      (currentTerminated !== null &&
        toStringValue(currentTerminated["reason"]) === "OOMKilled");
    if (!isOomKilled) {
      return;
    }

    const containerName: string = getContainerName(entry, index);
    const rawName: string | null = toStringValue(
      entry.containerStatus["name"],
    );
    const containerSpec: JSONObject | null = rawName
      ? getContainerSpecByName(input.spec, rawName)
      : null;
    const memoryLimit: string | null = getResourceValue(
      containerSpec,
      "limits",
      "memory",
    );

    const evidence: Array<KubernetesFailureEvidence> = [
      { label: "Container", value: containerName },
    ];
    if (memoryLimit) {
      evidence.push({ label: "Memory limit", value: memoryLimit });
    }
    const restartCount: number | null = toNumberValue(
      entry.containerStatus["restartCount"],
    );
    if (restartCount !== null) {
      evidence.push({ label: "Restart count", value: String(restartCount) });
    }

    explanations.push({
      id: `oom-killed-${containerName}`,
      severity: "critical",
      title: `Container "${containerName}" was OOMKilled`,
      summary: `The kernel killed the container because it exceeded its memory limit${
        memoryLimit ? ` of ${memoryLimit}` : ""
      }.`,
      evidence,
      recommendation:
        `Raise the memory limit for "${containerName}"${
          memoryLimit ? ` (currently ${memoryLimit})` : ""
        } if the workload legitimately needs more memory, or investigate a memory leak if usage grows unbounded.` +
        " Track the k8s.container.memory_limit_utilization metric to see how close the container runs to its limit.",
    });
  });

  return explanations;
}

const IMAGE_PULL_REASONS: Array<string> = [
  "ImagePullBackOff",
  "ErrImagePull",
  "InvalidImageName",
];

function explainImagePullFailure(
  input: KubernetesPodFailureInput,
): Array<KubernetesFailureExplanation> {
  const explanations: Array<KubernetesFailureExplanation> = [];
  const entries: Array<ContainerStatusEntry> = getAllContainerStatuses(
    input.status,
  );

  entries.forEach((entry: ContainerStatusEntry, index: number) => {
    const waiting: JSONObject | null = getWaitingState(entry.containerStatus);
    const waitingReason: string | null = waiting
      ? toStringValue(waiting["reason"])
      : null;
    if (!waiting || !waitingReason || !IMAGE_PULL_REASONS.includes(waitingReason)) {
      return;
    }

    const containerName: string = getContainerName(entry, index);
    const rawName: string | null = toStringValue(
      entry.containerStatus["name"],
    );
    const containerSpec: JSONObject | null = rawName
      ? getContainerSpecByName(input.spec, rawName)
      : null;
    const image: string | null =
      toStringValue(entry.containerStatus["image"]) ||
      (containerSpec ? toStringValue(containerSpec["image"]) : null);

    const evidence: Array<KubernetesFailureEvidence> = [
      { label: "Container", value: containerName },
      { label: "Waiting reason", value: waitingReason },
    ];
    if (image) {
      evidence.push({ label: "Image", value: image });
    }
    const waitingMessage: string | null = toStringValue(waiting["message"]);
    if (waitingMessage) {
      evidence.push({ label: "Registry error", value: waitingMessage });
    }

    explanations.push({
      id: `image-pull-failure-${containerName}`,
      severity: "critical",
      title: `Container "${containerName}" cannot pull its image (${waitingReason})`,
      summary: `Kubernetes cannot pull the image${
        image ? ` "${image}"` : ""
      }, so the container never starts.`,
      evidence,
      recommendation:
        "Verify the image name and tag exist in the registry (a typo or a deleted tag is the most common cause)." +
        " If the registry is private, make sure the pod references a valid imagePullSecret with pull access, and check the registry error message above for the exact rejection.",
    });
  });

  return explanations;
}

function explainUnschedulable(
  input: KubernetesPodFailureInput,
): Array<KubernetesFailureExplanation> {
  if (input.phase !== "Pending") {
    return [];
  }

  let schedulerMessage: string | null = null;
  let messageSource: string | null = null;

  const conditions: Array<JSONObject> = input.status
    ? toObjectArray(input.status["conditions"])
    : [];
  for (const condition of conditions) {
    if (
      toStringValue(condition["type"]) === "PodScheduled" &&
      toStringValue(condition["status"]) === "False"
    ) {
      schedulerMessage = toStringValue(condition["message"]);
      messageSource = "PodScheduled condition";
      break;
    }
  }

  if (!messageSource) {
    for (const event of input.recentEvents || []) {
      if (event && event.reason === "FailedScheduling") {
        schedulerMessage = toStringValue(event.message);
        messageSource = "FailedScheduling event";
        break;
      }
    }
  }

  if (!messageSource) {
    return [];
  }

  const evidence: Array<KubernetesFailureEvidence> = [];
  if (schedulerMessage) {
    evidence.push({
      label: `Scheduler message (${messageSource})`,
      value: schedulerMessage,
    });
  }

  const requestParts: Array<string> = [];
  for (const containerSpec of getAllContainerSpecs(input.spec)) {
    const name: string =
      toStringValue(containerSpec["name"]) || "unnamed-container";
    const cpuRequest: string | null = getResourceValue(
      containerSpec,
      "requests",
      "cpu",
    );
    const memoryRequest: string | null = getResourceValue(
      containerSpec,
      "requests",
      "memory",
    );
    if (cpuRequest || memoryRequest) {
      const parts: Array<string> = [];
      if (cpuRequest) {
        parts.push(`cpu=${cpuRequest}`);
      }
      if (memoryRequest) {
        parts.push(`memory=${memoryRequest}`);
      }
      requestParts.push(`${name}: ${parts.join(", ")}`);
    }
  }
  if (requestParts.length > 0) {
    evidence.push({
      label: "Pod resource requests",
      value: requestParts.join("; "),
    });
  }

  const lowerMessage: string = (schedulerMessage || "").toLowerCase();
  let recommendation: string;
  if (lowerMessage.includes("insufficient")) {
    recommendation =
      "No node has enough free CPU/memory for this pod's requests. Add nodes (or enable the cluster autoscaler), free capacity by moving other workloads, or lower the pod's resource requests if they are over-provisioned.";
  } else if (
    lowerMessage.includes("taint") ||
    lowerMessage.includes("untolerated")
  ) {
    recommendation =
      "The candidate nodes carry taints this pod does not tolerate. Add matching tolerations to the pod spec, or remove the taint from the nodes if it is no longer needed.";
  } else if (
    lowerMessage.includes("affinity") ||
    lowerMessage.includes("didn't match") ||
    lowerMessage.includes("node selector")
  ) {
    recommendation =
      "The pod's nodeSelector/affinity rules do not match any node. Review the pod's nodeSelector and affinity constraints against the labels actually present on your nodes.";
  } else {
    recommendation =
      "Read the scheduler message above — it states exactly why every node was rejected. Typical fixes: add capacity for insufficient resources, add tolerations for taints, or relax nodeSelector/affinity constraints.";
  }

  return [
    {
      id: "pod-unschedulable",
      severity: "critical",
      title: `Pod "${input.podName}" cannot be scheduled`,
      summary:
        "The pod is Pending because the scheduler could not find a node that satisfies its requirements.",
      evidence,
      recommendation,
    },
  ];
}

const CONTAINER_CONFIG_ERROR_REASONS: Array<string> = [
  "CreateContainerConfigError",
  "CreateContainerError",
];

function explainContainerConfigError(
  input: KubernetesPodFailureInput,
): Array<KubernetesFailureExplanation> {
  const explanations: Array<KubernetesFailureExplanation> = [];
  const entries: Array<ContainerStatusEntry> = getAllContainerStatuses(
    input.status,
  );

  entries.forEach((entry: ContainerStatusEntry, index: number) => {
    const waiting: JSONObject | null = getWaitingState(entry.containerStatus);
    const waitingReason: string | null = waiting
      ? toStringValue(waiting["reason"])
      : null;
    if (
      !waiting ||
      !waitingReason ||
      !CONTAINER_CONFIG_ERROR_REASONS.includes(waitingReason)
    ) {
      return;
    }

    const containerName: string = getContainerName(entry, index);
    const evidence: Array<KubernetesFailureEvidence> = [
      { label: "Container", value: containerName },
      { label: "Waiting reason", value: waitingReason },
    ];
    const waitingMessage: string | null = toStringValue(waiting["message"]);
    if (waitingMessage) {
      evidence.push({ label: "Error message", value: waitingMessage });
    }

    explanations.push({
      id: `container-config-error-${containerName}`,
      severity: "critical",
      title: `Container "${containerName}" failed to create (${waitingReason})`,
      summary:
        "Kubernetes could not construct the container — usually a referenced ConfigMap or Secret (env var or volume) does not exist.",
      evidence,
      recommendation:
        "The error message above names the missing or invalid object. Create the referenced ConfigMap/Secret in this namespace (or fix the key name in the pod spec), then the container will start on the next kubelet sync.",
    });
  });

  return explanations;
}

function explainProbeFailures(
  input: KubernetesPodFailureInput,
): Array<KubernetesFailureExplanation> {
  const explanations: Array<KubernetesFailureExplanation> = [];

  const probeKinds: Array<{
    marker: string;
    id: string;
    kind: string;
    recommendation: string;
  }> = [
    {
      marker: "liveness probe failed",
      id: "liveness-probe-failing",
      kind: "Liveness",
      recommendation:
        "Liveness probe failures make the kubelet RESTART the container, which can cause crash loops. Check that the probe endpoint responds within its timeout, and increase initialDelaySeconds/timeoutSeconds or failureThreshold if the app is just slow — do not paper over a genuinely hung process.",
    },
    {
      marker: "readiness probe failed",
      id: "readiness-probe-failing",
      kind: "Readiness",
      recommendation:
        "Readiness probe failures do NOT restart the container — they remove the pod from Service endpoints, so it silently receives no traffic. Check whether the app is overloaded or a dependency is down, and verify the probe path/port matches what the app actually serves.",
    },
  ];

  for (const probeKind of probeKinds) {
    let count: number = 0;
    let latestMessage: string | null = null;
    for (const event of input.recentEvents || []) {
      if (
        event &&
        event.reason === "Unhealthy" &&
        typeof event.message === "string" &&
        event.message.toLowerCase().includes(probeKind.marker)
      ) {
        count += 1;
        if (!latestMessage) {
          latestMessage = event.message;
        }
      }
    }
    if (count === 0) {
      continue;
    }

    const evidence: Array<KubernetesFailureEvidence> = [
      { label: "Recent failure count", value: String(count) },
    ];
    if (latestMessage) {
      evidence.push({ label: "Probe failure message", value: latestMessage });
    }

    explanations.push({
      id: probeKind.id,
      severity: "warning",
      title: `${probeKind.kind} probe is failing for pod "${input.podName}"`,
      summary: `${count} recent "Unhealthy" event(s) show the ${probeKind.kind.toLowerCase()} probe failing.`,
      evidence,
      recommendation: probeKind.recommendation,
    });
  }

  return explanations;
}

const STUCK_TERMINATING_THRESHOLD_MS: number = 10 * 60 * 1000;

function findMetadataField(
  input: KubernetesPodFailureInput,
  field: string,
): unknown {
  const sources: Array<JSONObject | undefined> = [input.status, input.spec];
  for (const source of sources) {
    if (!source) {
      continue;
    }
    if (source[field] !== undefined && source[field] !== null) {
      return source[field];
    }
    const metadata: JSONObject | null = toObject(source["metadata"]);
    if (metadata && metadata[field] !== undefined && metadata[field] !== null) {
      return metadata[field];
    }
  }
  return undefined;
}

function explainStuckTerminating(
  input: KubernetesPodFailureInput,
): Array<KubernetesFailureExplanation> {
  if (!input.now) {
    return [];
  }

  const rawDeletionTimestamp: unknown = findMetadataField(
    input,
    "deletionTimestamp",
  );
  const deletionTimestamp: Date | null = toDateValue(rawDeletionTimestamp);
  if (!deletionTimestamp) {
    return [];
  }

  const elapsedMs: number = input.now.getTime() - deletionTimestamp.getTime();
  if (elapsedMs <= STUCK_TERMINATING_THRESHOLD_MS) {
    return [];
  }

  const evidence: Array<KubernetesFailureEvidence> = [
    {
      label: "Deletion requested at",
      value:
        toStringValue(rawDeletionTimestamp) || deletionTimestamp.toISOString(),
    },
    {
      label: "Terminating for",
      value: `${Math.floor(elapsedMs / 60000)} minutes`,
    },
  ];

  const finalizers: Array<string> = toStringArray(
    findMetadataField(input, "finalizers"),
  );
  if (finalizers.length > 0) {
    evidence.push({ label: "Finalizers", value: finalizers.join(", ") });
  }

  return [
    {
      id: "pod-stuck-terminating",
      severity: "warning",
      title: `Pod "${input.podName}" is stuck terminating`,
      summary:
        "The pod was marked for deletion more than 10 minutes ago but has not gone away.",
      evidence,
      recommendation:
        (finalizers.length > 0
          ? `Finalizers (${finalizers.join(", ")}) are blocking deletion — find the controller responsible and fix it, or remove the finalizer manually if the controller is gone.`
          : "Check whether the node running the pod is unreachable (kubelet must confirm the containers stopped) and whether any finalizers are set.") +
        " As a last resort: kubectl delete pod --grace-period=0 --force — but only after confirming the workload is actually stopped, or you risk two instances running.",
    },
  ];
}

function explainFailedPhase(
  input: KubernetesPodFailureInput,
): Array<KubernetesFailureExplanation> {
  if (input.phase !== "Failed") {
    return [];
  }

  const reason: string | null = input.status
    ? toStringValue(input.status["reason"])
    : null;
  const message: string | null = input.status
    ? toStringValue(input.status["message"])
    : null;

  const evidence: Array<KubernetesFailureEvidence> = [];
  if (reason) {
    evidence.push({ label: "Reason", value: reason });
  }
  if (message) {
    evidence.push({ label: "Message", value: message });
  }

  const isEvicted: boolean = reason === "Evicted";

  return [
    {
      id: isEvicted ? "pod-evicted" : "pod-failed-phase",
      severity: "critical",
      title: isEvicted
        ? `Pod "${input.podName}" was evicted`
        : `Pod "${input.podName}" is in Failed phase${reason ? ` (${reason})` : ""}`,
      summary: isEvicted
        ? "The kubelet evicted this pod, almost always because the node ran out of a resource (memory, disk, or PIDs)."
        : "All containers terminated and the pod will not be restarted in place.",
      evidence,
      recommendation: isEvicted
        ? "Check the eviction message for which resource was under pressure on the node. Reduce node pressure (add capacity, set requests/limits so the scheduler packs realistically) and set appropriate pod priority — evicted pods owned by a controller are replaced automatically, but the underlying node pressure will recur."
        : "Read the reason/message above, then inspect the pod's events and container logs. Failed pods owned by a Deployment/Job are replaced automatically; bare pods must be recreated after fixing the cause.",
    },
  ];
}

// --- public API -------------------------------------------------------

const SEVERITY_ORDER: Record<KubernetesFailureSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function sortBySeverity(
  explanations: Array<KubernetesFailureExplanation>,
): Array<KubernetesFailureExplanation> {
  return [...explanations].sort(
    (a: KubernetesFailureExplanation, b: KubernetesFailureExplanation) => {
      return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    },
  );
}

export function explainPodFailures(
  input: KubernetesPodFailureInput,
): Array<KubernetesFailureExplanation> {
  const explanations: Array<KubernetesFailureExplanation> = [
    ...explainCrashLoopBackOff(input),
    ...explainOOMKilled(input),
    ...explainImagePullFailure(input),
    ...explainUnschedulable(input),
    ...explainContainerConfigError(input),
    ...explainProbeFailures(input),
    ...explainStuckTerminating(input),
    ...explainFailedPhase(input),
  ];

  return sortBySeverity(explanations);
}

interface NodePressureRule {
  conditionType: string;
  title: string;
  recommendation: string;
}

const NODE_PRESSURE_RULES: Array<NodePressureRule> = [
  {
    conditionType: "MemoryPressure",
    title: "Node is under memory pressure",
    recommendation:
      "The kubelet is evicting pods to reclaim memory. Move or right-size memory-heavy workloads (set realistic requests/limits), or add memory/nodes. Pods without requests are evicted first.",
  },
  {
    conditionType: "DiskPressure",
    title: "Node is under disk pressure",
    recommendation:
      "Free disk on the node: prune unused container images and stopped containers, rotate/ship large logs, and check for pods writing to local disk. Expand the disk if usage is legitimately high — under DiskPressure the kubelet evicts pods and refuses new ones.",
  },
  {
    conditionType: "PIDPressure",
    title: "Node is running out of process IDs",
    recommendation:
      "Some workload is leaking processes/threads (or fork-bombing). Find the pod with a runaway process count, and set a per-pod pids limit (podPidsLimit) so one workload cannot exhaust the node again.",
  },
];

export function explainNodeConditions(input: {
  nodeName: string;
  status?: JSONObject | undefined;
}): Array<KubernetesFailureExplanation> {
  const explanations: Array<KubernetesFailureExplanation> = [];
  const conditions: Array<JSONObject> = input.status
    ? toObjectArray(input.status["conditions"])
    : [];

  for (const condition of conditions) {
    const conditionType: string | null = toStringValue(condition["type"]);
    const conditionStatus: string | null = toStringValue(condition["status"]);
    if (!conditionType || !conditionStatus) {
      continue;
    }

    if (
      conditionType === "Ready" &&
      (conditionStatus === "False" || conditionStatus === "Unknown")
    ) {
      const evidence: Array<KubernetesFailureEvidence> = [
        { label: "Ready condition status", value: conditionStatus },
      ];
      const reason: string | null = toStringValue(condition["reason"]);
      if (reason) {
        evidence.push({ label: "Reason", value: reason });
      }
      const message: string | null = toStringValue(condition["message"]);
      if (message) {
        evidence.push({ label: "Message", value: message });
      }
      const lastTransitionTime: string | null = toStringValue(
        condition["lastTransitionTime"],
      );
      if (lastTransitionTime) {
        evidence.push({ label: "Since", value: lastTransitionTime });
      }

      explanations.push({
        id: "node-not-ready",
        severity: "critical",
        title: `Node "${input.nodeName}" is NotReady`,
        summary:
          conditionStatus === "Unknown"
            ? "The node controller has stopped hearing from the kubelet — the node may be down or partitioned from the control plane."
            : "The kubelet reports the node cannot accept pods.",
        evidence,
        recommendation:
          "Check whether the node/VM is up and the kubelet service is running (journalctl -u kubelet), and verify network connectivity to the API server. Pods on a NotReady node are rescheduled after the eviction timeout (~5 minutes by default).",
      });
      continue;
    }

    for (const rule of NODE_PRESSURE_RULES) {
      if (conditionType === rule.conditionType && conditionStatus === "True") {
        const evidence: Array<KubernetesFailureEvidence> = [
          { label: "Condition", value: `${conditionType}=True` },
        ];
        const message: string | null = toStringValue(condition["message"]);
        if (message) {
          evidence.push({ label: "Message", value: message });
        }

        explanations.push({
          id: `node-${rule.conditionType.toLowerCase()}`,
          severity: "warning",
          title: `${rule.title} ("${input.nodeName}")`,
          summary: `The ${rule.conditionType} condition is True on this node — the kubelet is taking protective action (evictions, refusing new pods).`,
          evidence,
          recommendation: rule.recommendation,
        });
      }
    }
  }

  return sortBySeverity(explanations);
}
