import { JSONObject } from "../../../Types/JSON";
import {
  KUBERNETES_ATTENTION_KIND_ORDER,
  KUBERNETES_FAILING_WAIT_REASONS,
  KUBERNETES_HEALTH_GRACE_MS,
  KUBERNETES_HEALTH_RECENT_MS,
  KUBERNETES_REASON_AS_WRITTEN,
  KubernetesAttentionFinding,
  KubernetesHealthAssessment,
  KubernetesHealthRow,
  KubernetesHealthSeverity,
  KubernetesHealthText,
  assessKubernetesAutoscaler,
  assessKubernetesCronJob,
  assessKubernetesCronJobWithRuns,
  assessKubernetesDaemonSet,
  assessKubernetesDeployment,
  assessKubernetesDeploymentConfig,
  assessKubernetesJob,
  assessKubernetesNamespace,
  assessKubernetesNode,
  assessKubernetesPod,
  assessKubernetesResource,
  assessKubernetesStatefulSet,
  assessKubernetesVolume,
  assessKubernetesVolumeClaim,
  getDeploymentConfigNameFromReplicationController,
  getDeploymentNameFromReplicaSet,
  getKubernetesAttentionFindings,
  getKubernetesClusterHealth,
  getKubernetesHealthSeverity,
  getKubernetesJobCronJob,
  getKubernetesOwners,
  getKubernetesPodWorkload,
  getNewestKubernetesJobs,
  kubernetesObjectKey,
  sortKubernetesAttentionFindings,
} from "../../../Types/Kubernetes/KubernetesHealth";
import { describe, expect, test } from "@jest/globals";

/*
 * KubernetesHealth is the one set of rules the Overview's Needs attention,
 * the health pill, a part's page, the lists, the Topology and the ingest
 * (healthSeverity) all read. These pin every rule, both severities, the
 * grace windows that keep a starting object quiet, the time the rules
 * measure against (the snapshot's, never the clock), and how a cluster's
 * findings fold pods into their workloads and Jobs into their CronJobs.
 */

// When the agent saw the rows: every rule measures against it.
const SEEN: Date = new Date("2026-11-01T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

function ago(minutes: number): string {
  return new Date(SEEN.getTime() - minutes * MINUTE).toISOString();
}

function owners(...items: Array<[string, string]>): JSONObject {
  return {
    items: items.map(([kind, name]: [string, string]) => {
      return { kind: kind, name: name, uid: `${kind}-${name}` };
    }),
  } as unknown as JSONObject;
}

interface ContainerFields {
  name?: string;
  ready?: boolean;
  state?: string;
  reason?: string;
  message?: string;
  restartCount?: number;
  lastTerminationReason?: string;
  lastTerminationExitCode?: number | null;
  lastTerminatedAt?: string;
}

function container(fields: ContainerFields = {}): JSONObject {
  return {
    name: fields.name ?? "app",
    ready: fields.ready ?? true,
    restartCount: fields.restartCount ?? 0,
    state: fields.state ?? "running",
    reason: fields.reason ?? "",
    image: "registry.example.com/app:1.4.2",
    ...(fields.message !== undefined ? { message: fields.message } : {}),
    ...(fields.lastTerminationReason !== undefined
      ? {
          lastTerminationReason: fields.lastTerminationReason,
          lastTerminationExitCode: fields.lastTerminationExitCode ?? null,
          lastTerminatedAt: fields.lastTerminatedAt ?? "",
        }
      : {}),
  } as unknown as JSONObject;
}

function condition(
  type: string,
  status: string,
  fields: { reason?: string; message?: string; at?: string } = {},
): JSONObject {
  return {
    type: type,
    status: status,
    reason: fields.reason ?? "",
    message: fields.message ?? "",
    lastTransitionTime: fields.at ?? ago(600),
  } as unknown as JSONObject;
}

interface PodFields {
  name?: string;
  namespace?: string;
  phase?: string;
  containers?: Array<JSONObject>;
  initContainers?: Array<JSONObject>;
  conditions?: Array<JSONObject>;
  reason?: string;
  message?: string;
  ownerReferences?: JSONObject;
  labels?: JSONObject;
  createdMinutesAgo?: number;
}

function pod(fields: PodFields = {}): KubernetesHealthRow {
  const phase: string = fields.phase ?? "Running";
  return {
    kind: "Pod",
    namespaceKey: fields.namespace ?? "payments",
    name: fields.name ?? "checkout-7d9f8b6c5-x2k4q",
    phase: phase,
    labels: fields.labels ?? ({} as JSONObject),
    ownerReferences: fields.ownerReferences ?? owners(),
    spec: { nodeName: "node-1", containers: [] } as unknown as JSONObject,
    status: {
      phase: phase,
      conditions: fields.conditions ?? [condition("Ready", "True")],
      containerStatuses: fields.containers ?? [container()],
      initContainerStatuses: fields.initContainers ?? [],
      ...(fields.reason ? { reason: fields.reason } : {}),
      ...(fields.message ? { message: fields.message } : {}),
    } as unknown as JSONObject,
    lastSeenAt: SEEN,
    resourceCreationTimestamp: ago(fields.createdMinutesAgo ?? 600),
  };
}

function node(fields: {
  name?: string;
  isReady?: boolean | null;
  conditions?: Array<JSONObject>;
  memory?: boolean;
  disk?: boolean;
  pid?: boolean;
  unschedulable?: boolean;
}): KubernetesHealthRow {
  return {
    kind: "Node",
    namespaceKey: "",
    name: fields.name ?? "node-1",
    isReady: fields.isReady === undefined ? true : fields.isReady,
    hasMemoryPressure: fields.memory ?? false,
    hasDiskPressure: fields.disk ?? false,
    hasPidPressure: fields.pid ?? false,
    spec: {
      unschedulable: fields.unschedulable ?? false,
      taints: [],
    } as unknown as JSONObject,
    status: {
      conditions: fields.conditions ?? [condition("Ready", "True")],
    } as unknown as JSONObject,
    lastSeenAt: SEEN,
    resourceCreationTimestamp: ago(60 * 24 * 30),
  };
}

function workload(
  kind: string,
  fields: {
    name?: string;
    namespace?: string;
    spec?: Record<string, unknown>;
    status?: Record<string, unknown>;
    ownerReferences?: JSONObject;
    createdMinutesAgo?: number;
    phase?: string;
  } = {},
): KubernetesHealthRow {
  return {
    kind: kind,
    namespaceKey: fields.namespace ?? "payments",
    name: fields.name ?? "checkout",
    phase: fields.phase ?? null,
    ownerReferences: fields.ownerReferences ?? owners(),
    spec: (fields.spec ?? {}) as unknown as JSONObject,
    status: (fields.status ?? {}) as unknown as JSONObject,
    lastSeenAt: SEEN,
    resourceCreationTimestamp: ago(fields.createdMinutesAgo ?? 600),
  };
}

function deployment(
  desired: number,
  available: number,
  fields: {
    name?: string;
    namespace?: string;
    progressing?: JSONObject;
    paused?: boolean;
    createdMinutesAgo?: number;
  } = {},
): KubernetesHealthRow {
  return workload("Deployment", {
    name: fields.name ?? "checkout",
    namespace: fields.namespace ?? "payments",
    createdMinutesAgo: fields.createdMinutesAgo ?? 600,
    spec: {
      replicas: desired,
      strategy: "RollingUpdate",
      selector: {},
      paused: fields.paused ?? false,
    },
    status: {
      replicas: desired,
      readyReplicas: available,
      availableReplicas: available,
      unavailableReplicas: Math.max(desired - available, 0),
      updatedReplicas: desired,
      conditions: [
        fields.progressing ??
          condition("Progressing", "True", {
            reason: "NewReplicaSetAvailable",
          }),
      ],
    },
  });
}

// The words of a reason or status, as the Dashboard would fill them in English.
function words(value: KubernetesHealthText): string {
  let filled: string = value.plural
    ? value.plural.count === 1
      ? value.plural.one
      : value.text
    : value.text;
  for (const [key, replacement] of Object.entries({
    ...(value.values || {}),
    ...(value.plural ? { count: String(value.plural.count) } : {}),
  })) {
    filled = filled.split(`{{${key}}}`).join(replacement);
  }
  return filled;
}

function reasonWords(assessment: {
  reasons: Array<KubernetesHealthText>;
}): Array<string> {
  return assessment.reasons.map(words);
}

describe("the time the rules measure against", () => {
  test("is the row's own lastSeenAt, so a stored verdict and a page agree", () => {
    const pending: KubernetesHealthRow = pod({
      phase: "Pending",
      containers: [],
      createdMinutesAgo: 3,
    });

    // Three minutes old when seen: still starting, whatever time it is now.
    expect(assessKubernetesPod(pending).severity).toBeNull();
    expect(
      assessKubernetesPod(pending, {
        now: new Date(SEEN.getTime() + 60 * MINUTE),
      }).severity,
    ).toBeNull();
  });

  test("falls back to the given now when a row has no lastSeenAt", () => {
    const pending: KubernetesHealthRow = {
      ...pod({ phase: "Pending", containers: [], createdMinutesAgo: 3 }),
      lastSeenAt: null,
    };
    expect(assessKubernetesPod(pending, { now: SEEN }).severity).toBeNull();
    expect(
      assessKubernetesPod(pending, {
        now: new Date(SEEN.getTime() + 10 * MINUTE),
      }).severity,
    ).toBe(KubernetesHealthSeverity.Warning);
  });

  test("reads timestamps written as strings as well as Dates", () => {
    const fromStrings: KubernetesHealthRow = {
      ...pod({ phase: "Pending", containers: [], createdMinutesAgo: 30 }),
      lastSeenAt: SEEN.toISOString(),
    };
    expect(assessKubernetesPod(fromStrings).severity).toBe(
      KubernetesHealthSeverity.Warning,
    );
  });
});

describe("a pod", () => {
  test("that runs, ready, needs nothing", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(pod());
    expect(assessment.severity).toBeNull();
    expect(words(assessment.status)).toBe("Running");
    expect(assessment.tone).toBe("positive");
    expect(assessment.reasons).toEqual([]);
  });

  test("that completed is neutral, never a problem", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        phase: "Succeeded",
        containers: [
          container({ state: "terminated", reason: "Completed", ready: false }),
        ],
      }),
    );
    expect(assessment.severity).toBeNull();
    expect(words(assessment.status)).toBe("Completed");
    expect(assessment.tone).toBe("neutral");
  });

  test.each(Array.from(KUBERNETES_FAILING_WAIT_REASONS))(
    "whose container waits in %s is critical, in Kubernetes' own word",
    (reason: string) => {
      const assessment: KubernetesHealthAssessment = assessKubernetesPod(
        pod({
          containers: [
            container({
              ready: false,
              state: "waiting",
              reason: reason,
              message: `the kubelet's words about ${reason}`,
            }),
          ],
        }),
      );
      expect(assessment.severity).toBe(KubernetesHealthSeverity.Critical);
      expect(assessment.tone).toBe("danger");
      expect(words(assessment.status)).toBe(reason);
      expect(reasonWords(assessment)).toEqual([reason]);
      // Drawn as written in every language: a template with no words.
      expect(assessment.status.text).toBe(KUBERNETES_REASON_AS_WRITTEN);
      expect(assessment.message).toBe(`the kubelet's words about ${reason}`);
    },
  );

  test("in CrashLoopBackOff says how its last run ended", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        containers: [
          container({
            ready: false,
            state: "waiting",
            reason: "CrashLoopBackOff",
            restartCount: 14,
            lastTerminationReason: "OOMKilled",
            lastTerminationExitCode: 137,
            lastTerminatedAt: ago(1),
          }),
        ],
      }),
    );
    expect(reasonWords(assessment)).toEqual([
      "CrashLoopBackOff",
      "Last restart: OOMKilled",
    ]);
  });

  test("names the exit code of a run that ended in an error, not of an OOM kill", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        containers: [
          container({
            ready: false,
            state: "waiting",
            reason: "CrashLoopBackOff",
            lastTerminationReason: "Error",
            lastTerminationExitCode: 1,
            lastTerminatedAt: ago(1),
          }),
        ],
      }),
    );
    expect(reasonWords(assessment)).toEqual([
      "CrashLoopBackOff",
      "Last restart: Error, exit code 1",
    ]);
  });

  test("waiting in ContainerCreating is starting, not failing", () => {
    expect(
      assessKubernetesPod(
        pod({
          phase: "Pending",
          containers: [
            container({
              ready: false,
              state: "waiting",
              reason: "ContainerCreating",
            }),
          ],
          createdMinutesAgo: 1,
        }),
      ).severity,
    ).toBeNull();
  });

  test("stuck in ContainerCreating past five minutes needs a look, with the reason", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        phase: "Pending",
        containers: [
          container({
            ready: false,
            state: "waiting",
            reason: "ContainerCreating",
            message: "",
          }),
        ],
        createdMinutesAgo: 20,
      }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(words(assessment.status)).toBe("Pending");
    expect(reasonWords(assessment)).toEqual(["ContainerCreating"]);
  });

  test("whose init container crash-loops is critical, as kubectl writes it", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        phase: "Pending",
        initContainers: [
          container({
            name: "migrate",
            ready: false,
            state: "waiting",
            reason: "CrashLoopBackOff",
          }),
        ],
        containers: [
          container({
            ready: false,
            state: "waiting",
            reason: "PodInitializing",
          }),
        ],
        createdMinutesAgo: 1,
      }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Critical);
    expect(words(assessment.status)).toBe("Init:CrashLoopBackOff");
  });

  test("whose init container ended in an error is critical; one that completed is not", () => {
    expect(
      words(
        assessKubernetesPod(
          pod({
            phase: "Pending",
            initContainers: [
              container({
                name: "migrate",
                state: "terminated",
                reason: "Error",
              }),
            ],
            containers: [
              container({
                ready: false,
                state: "waiting",
                reason: "PodInitializing",
              }),
            ],
          }),
        ).status,
      ),
    ).toBe("Init:Error");

    expect(
      assessKubernetesPod(
        pod({
          initContainers: [
            container({
              name: "migrate",
              state: "terminated",
              reason: "Completed",
            }),
          ],
        }),
      ).severity,
    ).toBeNull();
  });

  test("pending under five minutes old is still being scheduled", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        phase: "Pending",
        containers: [],
        conditions: [
          condition("PodScheduled", "False", {
            reason: "Unschedulable",
            message: "0/3 nodes are available: 3 Insufficient memory.",
          }),
        ],
        createdMinutesAgo: KUBERNETES_HEALTH_GRACE_MS / MINUTE - 1,
      }),
    );
    expect(assessment.severity).toBeNull();
    expect(assessment.reasons).toEqual([]);
    expect(words(assessment.status)).toBe("Pending");
  });

  test("that cannot be scheduled says so, with the scheduler's words", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        phase: "Pending",
        containers: [],
        conditions: [
          condition("PodScheduled", "False", {
            reason: "Unschedulable",
            message: "0/3 nodes are available: 3 Insufficient memory.",
          }),
        ],
        createdMinutesAgo: KUBERNETES_HEALTH_GRACE_MS / MINUTE,
      }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(reasonWords(assessment)).toEqual(["Can't be scheduled"]);
    expect(assessment.message).toBe(
      "0/3 nodes are available: 3 Insufficient memory.",
    );
  });

  test("pending with nothing to say reads Pending", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        phase: "Pending",
        containers: [],
        conditions: [],
        createdMinutesAgo: 30,
      }),
    );
    expect(reasonWords(assessment)).toEqual(["Pending"]);
  });

  test("running but not ready for more than five minutes needs a look", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        containers: [container({ ready: false })],
        conditions: [
          condition("Ready", "False", {
            reason: "ContainersNotReady",
            message: "containers with unready status: [app]",
            at: ago(12),
          }),
        ],
      }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(words(assessment.status)).toBe("Not ready");
    expect(reasonWords(assessment)).toEqual(["Not ready"]);
    expect(assessment.message).toBe("containers with unready status: [app]");
  });

  test("not ready for under five minutes is warming up: no attention, but it reads Not ready", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        containers: [container({ ready: false })],
        conditions: [condition("Ready", "False", { at: ago(2) })],
      }),
    );
    expect(assessment.severity).toBeNull();
    expect(words(assessment.status)).toBe("Not ready");
    expect(assessment.tone).toBe("warning");
  });

  test("OOMKilled within the hour needs a look though it runs again", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        containers: [
          container({
            restartCount: 3,
            lastTerminationReason: "OOMKilled",
            lastTerminationExitCode: 137,
            lastTerminatedAt: ago(20),
          }),
        ],
      }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(words(assessment.status)).toBe("Running");
    expect(reasonWords(assessment)).toEqual(["Last restart: OOMKilled"]);
  });

  test("an OOM kill more than an hour ago is history", () => {
    expect(
      assessKubernetesPod(
        pod({
          containers: [
            container({
              lastTerminationReason: "OOMKilled",
              lastTerminationExitCode: 137,
              lastTerminatedAt: ago(KUBERNETES_HEALTH_RECENT_MS / MINUTE + 1),
            }),
          ],
        }),
      ).severity,
    ).toBeNull();
  });

  test("a restart that ended in an error, and that it came back from, is not a problem by itself", () => {
    expect(
      assessKubernetesPod(
        pod({
          containers: [
            container({
              restartCount: 1,
              lastTerminationReason: "Error",
              lastTerminationExitCode: 1,
              lastTerminatedAt: ago(5),
            }),
          ],
        }),
      ).severity,
    ).toBeNull();
  });

  test("whose container just ended is being restarted: a warning in its own word", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        containers: [
          container({
            ready: false,
            state: "terminated",
            reason: "OOMKilled",
            message: "",
          }),
        ],
        conditions: [condition("Ready", "False", { at: ago(0) })],
      }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(words(assessment.status)).toBe("OOMKilled");
  });

  test("evicted in the last hour needs a look, with the eviction's reason", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        phase: "Failed",
        reason: "Evicted",
        message: "The node was low on resource: memory.",
        containers: [
          container({ ready: false, state: "terminated", reason: "" }),
        ],
        conditions: [condition("Ready", "False", { at: ago(10) })],
        ownerReferences: owners(["ReplicaSet", "checkout-7d9f8b6c5"]),
      }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(words(assessment.status)).toBe("Evicted");
    // Coloured as Needs attention colours it: something to look at.
    expect(assessment.tone).toBe("warning");
    expect(reasonWords(assessment)).toEqual(["Evicted"]);
    expect(assessment.message).toBe("The node was low on resource: memory.");
  });

  test("evicted long ago is history: it still reads Evicted, but needs nothing", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        phase: "Failed",
        reason: "Evicted",
        conditions: [condition("Ready", "False", { at: ago(60 * 24 * 7) })],
      }),
    );
    expect(assessment.severity).toBeNull();
    expect(words(assessment.status)).toBe("Evicted");
    expect(assessment.tone).toBe("neutral");
  });

  test("failed recently names the container's reason", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        phase: "Failed",
        containers: [
          container({
            ready: false,
            state: "terminated",
            reason: "Error",
            message: "panic: config not found",
          }),
        ],
        conditions: [condition("Ready", "False", { at: ago(3) })],
      }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(reasonWords(assessment)).toEqual(["Failed", "Error"]);
    expect(assessment.message).toBe("panic: config not found");
  });

  test("failed with no time to tell when is not flagged", () => {
    expect(
      assessKubernetesPod(pod({ phase: "Failed", conditions: [] })).severity,
    ).toBeNull();
  });

  test("a Job's failed pod is the Job's to report", () => {
    expect(
      assessKubernetesPod(
        pod({
          phase: "Failed",
          conditions: [condition("Ready", "False", { at: ago(2) })],
          ownerReferences: owners(["Job", "nightly-28844160"]),
        }),
      ).severity,
    ).toBeNull();
  });

  test("in phase Unknown lost its node", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({ phase: "Unknown" }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(words(assessment.status)).toBe("Unknown");
    expect(reasonWords(assessment)).toEqual(["State unknown"]);
  });

  test("with no status yet reads No data yet", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod({
      kind: "Pod",
      name: "new",
      namespaceKey: "x",
      lastSeenAt: SEEN,
    });
    expect(assessment.severity).toBeNull();
    expect(words(assessment.status)).toBe("No data yet");
  });

  test("reads its phase from status when the column is empty", () => {
    const row: KubernetesHealthRow = {
      ...pod({ phase: "Succeeded" }),
      phase: null,
    };
    expect(words(assessKubernetesPod(row).status)).toBe("Completed");
  });
});

describe("a node", () => {
  test("ready reads Ready", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesNode(
      node({}),
    );
    expect(assessment.severity).toBeNull();
    expect(words(assessment.status)).toBe("Ready");
  });

  test("not ready is critical, with the kubelet's message", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesNode(
      node({
        isReady: false,
        conditions: [
          condition("Ready", "False", {
            reason: "KubeletNotReady",
            message: "PLEG is not healthy: pleg was last seen active 3m ago",
          }),
        ],
      }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Critical);
    expect(words(assessment.status)).toBe("Not ready");
    expect(reasonWords(assessment)).toEqual(["Not ready"]);
    expect(assessment.message).toBe(
      "PLEG is not healthy: pleg was last seen active 3m ago",
    );
  });

  test("whose Ready is Unknown is unreachable: crashed, off or cut off", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesNode(
      node({
        isReady: false,
        conditions: [
          condition("Ready", "Unknown", {
            reason: "NodeStatusUnknown",
            message: "Kubelet stopped posting node status.",
          }),
        ],
      }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Critical);
    // Kubernetes' own word, from the taint it puts on such a node.
    expect(words(assessment.status)).toBe("Unreachable");
    expect(reasonWords(assessment)).toEqual(["Unreachable"]);
    expect(assessment.message).toBe("Kubelet stopped posting node status.");
  });

  test("reads not ready from its conditions when the column is empty", () => {
    expect(
      assessKubernetesNode(
        node({ isReady: null, conditions: [condition("Ready", "False")] }),
      ).severity,
    ).toBe(KubernetesHealthSeverity.Critical);
  });

  test("with its network unavailable is critical", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesNode(
      node({
        conditions: [
          condition("Ready", "True"),
          condition("NetworkUnavailable", "True", {
            message: "RouteController failed to create a route",
          }),
        ],
      }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Critical);
    expect(reasonWords(assessment)).toEqual(["Network unavailable"]);
  });

  test("not ready and cut off from the network says both", () => {
    expect(
      reasonWords(
        assessKubernetesNode(
          node({
            isReady: false,
            conditions: [
              condition("Ready", "False"),
              condition("NetworkUnavailable", "True"),
            ],
          }),
        ),
      ),
    ).toEqual(["Not ready", "Network unavailable"]);
  });

  test.each([
    ["memory", "Memory pressure"],
    ["disk", "Disk pressure"],
    ["pid", "PID pressure"],
  ])("under %s pressure needs a look", (flag: string, word: string) => {
    const assessment: KubernetesHealthAssessment = assessKubernetesNode(
      node({ [flag]: true }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(words(assessment.status)).toBe(word);
    expect(reasonWords(assessment)).toEqual([word]);
  });

  test("under several pressures lists each", () => {
    expect(
      reasonWords(assessKubernetesNode(node({ memory: true, disk: true }))),
    ).toEqual(["Memory pressure", "Disk pressure"]);
  });

  test("reads a pressure from its conditions too", () => {
    expect(
      assessKubernetesNode(
        node({
          conditions: [
            condition("Ready", "True"),
            condition("DiskPressure", "True", { message: "ephemeral storage" }),
          ],
        }),
      ).message,
    ).toBe("ephemeral storage");
  });

  test("cordoned is a state, not a problem", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesNode(
      node({ unschedulable: true }),
    );
    expect(assessment.severity).toBeNull();
    expect(words(assessment.status)).toBe("Scheduling disabled");
    expect(assessment.tone).toBe("neutral");
  });

  test("cordoned and not ready is still not ready", () => {
    expect(
      assessKubernetesNode(node({ unschedulable: true, isReady: false }))
        .severity,
    ).toBe(KubernetesHealthSeverity.Critical);
  });

  test("that reported nothing yet reads No data yet", () => {
    expect(
      words(
        assessKubernetesNode(node({ isReady: null, conditions: [] })).status,
      ),
    ).toBe("No data yet");
  });
});

describe("a Deployment", () => {
  test("with every replica available reads Available", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesDeployment(
      deployment(3, 3),
    );
    expect(assessment.severity).toBeNull();
    expect(words(assessment.status)).toBe("Available");
  });

  test("with none available is critical", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesDeployment(
      deployment(3, 0),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Critical);
    expect(words(assessment.status)).toBe("0 of 3 available");
    expect(reasonWords(assessment)).toEqual(["0 of 3 available"]);
  });

  test("short of replicas with no rollout under way needs a look", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesDeployment(
      deployment(3, 1),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(reasonWords(assessment)).toEqual(["1 of 3 available"]);
  });

  test("every replica available while the new ones replace the old is rolling out, not just Available", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesDeployment(
      deployment(3, 3, {
        progressing: condition("Progressing", "True", {
          reason: "ReplicaSetUpdated",
        }),
      }),
    );
    expect(assessment.severity).toBeNull();
    expect(words(assessment.status)).toBe("Rolling out");
    expect(assessment.tone).toBe("neutral");
  });

  test("short of replicas while it rolls out is rolling out", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesDeployment(
      deployment(3, 2, {
        progressing: condition("Progressing", "True", {
          reason: "ReplicaSetUpdated",
        }),
      }),
    );
    expect(assessment.severity).toBeNull();
    expect(words(assessment.status)).toBe("Rolling out");
  });

  test("past its progress deadline is critical: the rollout is stuck", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesDeployment(
      deployment(3, 2, {
        progressing: condition("Progressing", "False", {
          reason: "ProgressDeadlineExceeded",
          message: 'ReplicaSet "checkout-5c9" has timed out progressing.',
        }),
      }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Critical);
    expect(words(assessment.status)).toBe("Rollout stuck");
    expect(reasonWords(assessment)).toEqual([
      "Rollout stuck",
      "2 of 3 available",
    ]);
    expect(assessment.message).toBe(
      'ReplicaSet "checkout-5c9" has timed out progressing.',
    );
  });

  test("new and not available yet is starting", () => {
    expect(
      assessKubernetesDeployment(deployment(3, 0, { createdMinutesAgo: 2 }))
        .severity,
    ).toBeNull();
  });

  test("scaled to zero is never a problem", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesDeployment(
      deployment(0, 0),
    );
    expect(assessment.severity).toBeNull();
    expect(words(assessment.status)).toBe("Scaled to zero");
  });

  test("paused reads Paused while it is available", () => {
    expect(
      words(
        assessKubernetesDeployment(deployment(2, 2, { paused: true })).status,
      ),
    ).toBe("Paused");
  });

  test("with no spec yet reads No data yet", () => {
    expect(
      words(
        assessKubernetesDeployment({
          kind: "Deployment",
          name: "x",
          namespaceKey: "y",
          lastSeenAt: SEEN,
        }).status,
      ),
    ).toBe("No data yet");
  });
});

describe("a StatefulSet", () => {
  function statefulSet(
    desired: number,
    ready: number,
    revisions: [string, string] = ["db-7c8", "db-7c8"],
  ): KubernetesHealthRow {
    return workload("StatefulSet", {
      name: "postgres",
      spec: { replicas: desired },
      status: {
        readyReplicas: ready,
        currentRevision: revisions[0],
        updateRevision: revisions[1],
      },
    });
  }

  test("ready reads Ready", () => {
    expect(words(assessKubernetesStatefulSet(statefulSet(3, 3)).status)).toBe(
      "Ready",
    );
  });

  test("with no replica ready is critical", () => {
    expect(assessKubernetesStatefulSet(statefulSet(3, 0)).severity).toBe(
      KubernetesHealthSeverity.Critical,
    );
  });

  test("short of ready replicas needs a look", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesStatefulSet(
      statefulSet(3, 2),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(reasonWords(assessment)).toEqual(["2 of 3 ready"]);
  });

  test("short while an update replaces its pods is rolling out", () => {
    expect(
      assessKubernetesStatefulSet(statefulSet(3, 2, ["db-7c8", "db-9a1"]))
        .severity,
    ).toBeNull();
  });

  test("with none ready is critical even mid-update: the update cannot go on", () => {
    expect(
      assessKubernetesStatefulSet(statefulSet(3, 0, ["db-7c8", "db-9a1"]))
        .severity,
    ).toBe(KubernetesHealthSeverity.Critical);
  });

  test("scaled to zero is never a problem", () => {
    expect(assessKubernetesStatefulSet(statefulSet(0, 0)).severity).toBeNull();
  });
});

describe("a DaemonSet", () => {
  function daemonSet(
    desired: number,
    ready: number,
    fields: { misscheduled?: number; updated?: number | null } = {},
  ): KubernetesHealthRow {
    return workload("DaemonSet", {
      name: "fluent-bit",
      namespace: "logging",
      status: {
        desiredNumberScheduled: desired,
        numberReady: ready,
        numberMisscheduled: fields.misscheduled ?? 0,
        ...(fields.updated === null
          ? {}
          : { updatedNumberScheduled: fields.updated ?? desired }),
      },
    });
  }

  test("ready on every node reads Ready", () => {
    expect(words(assessKubernetesDaemonSet(daemonSet(5, 5)).status)).toBe(
      "Ready",
    );
  });

  test("ready on no node is critical", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesDaemonSet(
      daemonSet(5, 0),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Critical);
    expect(reasonWords(assessment)).toEqual(["Ready on 0 of 5 nodes"]);
  });

  test("ready on some nodes needs a look", () => {
    expect(assessKubernetesDaemonSet(daemonSet(5, 4)).severity).toBe(
      KubernetesHealthSeverity.Warning,
    );
  });

  test("short while a rollout updates its pods is rolling out", () => {
    expect(
      assessKubernetesDaemonSet(daemonSet(5, 4, { updated: 3 })).severity,
    ).toBeNull();
  });

  test("stored before updatedNumberScheduled was read, short means short", () => {
    expect(
      assessKubernetesDaemonSet(daemonSet(5, 4, { updated: null })).severity,
    ).toBe(KubernetesHealthSeverity.Warning);
  });

  test("on nodes it should not run on needs a look", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesDaemonSet(
      daemonSet(5, 5, { misscheduled: 2 }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(reasonWords(assessment)).toEqual(["Runs on 2 nodes it should not"]);
  });

  test("ready nowhere and misscheduled stays critical, with both reasons", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesDaemonSet(
      daemonSet(3, 0, { misscheduled: 1 }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Critical);
    expect(assessment.tone).toBe("danger");
    expect(reasonWords(assessment)).toEqual([
      "Ready on 0 of 3 nodes",
      "Runs on 1 node it should not",
    ]);
  });

  test("with no node to run on is neutral", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesDaemonSet(
      daemonSet(0, 0),
    );
    expect(assessment.severity).toBeNull();
    expect(words(assessment.status)).toBe("No nodes to run on");
  });
});

describe("a Job and a CronJob", () => {
  function job(
    name: string,
    fields: {
      failed?: boolean;
      complete?: boolean;
      active?: number;
      cronJob?: string;
      createdMinutesAgo?: number;
    } = {},
  ): KubernetesHealthRow {
    const conditions: Array<JSONObject> = [];
    if (fields.failed) {
      conditions.push(
        condition("Failed", "True", {
          reason: "BackoffLimitExceeded",
          message: "Job has reached the specified backoff limit",
        }),
      );
    }
    if (fields.complete) {
      conditions.push(condition("Complete", "True"));
    }
    return workload("Job", {
      name: name,
      namespace: "billing",
      ownerReferences: fields.cronJob
        ? owners(["CronJob", fields.cronJob])
        : owners(),
      createdMinutesAgo: fields.createdMinutesAgo ?? 60,
      status: {
        active: fields.active ?? 0,
        succeeded: fields.complete ? 1 : 0,
        failed: fields.failed ? 6 : 0,
        conditions: conditions,
      },
    });
  }

  function cronJob(suspend: boolean = false): KubernetesHealthRow {
    return workload("CronJob", {
      name: "invoice-run",
      namespace: "billing",
      spec: { schedule: "0 2 * * *", suspend: suspend },
      status: { activeCount: 0 },
    });
  }

  test("a failed Job needs a look, with Kubernetes' reason and message", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesJob(
      job("backfill", { failed: true }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(words(assessment.status)).toBe("Failed");
    // Amber on its page, as its row in Needs attention.
    expect(assessment.tone).toBe("warning");
    expect(reasonWords(assessment)).toEqual(["Failed", "BackoffLimitExceeded"]);
    expect(assessment.message).toBe(
      "Job has reached the specified backoff limit",
    );
  });

  test("a complete, a running and a waiting Job need nothing", () => {
    expect(
      words(assessKubernetesJob(job("a", { complete: true })).status),
    ).toBe("Completed");
    expect(words(assessKubernetesJob(job("b", { active: 1 })).status)).toBe(
      "Running",
    );
    expect(words(assessKubernetesJob(job("c")).status)).toBe("Pending");
    expect(assessKubernetesJob(job("c")).severity).toBeNull();
  });

  test("a CronJob on its own reads Scheduled, Running or Suspended", () => {
    expect(words(assessKubernetesCronJob(cronJob()).status)).toBe("Scheduled");
    expect(words(assessKubernetesCronJob(cronJob(true)).status)).toBe(
      "Suspended",
    );
    expect(
      words(
        assessKubernetesCronJob({
          ...cronJob(),
          status: { activeCount: 1 } as unknown as JSONObject,
        }).status,
      ),
    ).toBe("Running");
  });

  test("a CronJob whose newest run failed reads Last run failed", () => {
    const assessment: KubernetesHealthAssessment =
      assessKubernetesCronJobWithRuns(cronJob(), [
        job("invoice-run-28844160", {
          complete: true,
          cronJob: "invoice-run",
          createdMinutesAgo: 60 * 24,
        }),
        job("invoice-run-28845600", {
          failed: true,
          cronJob: "invoice-run",
          createdMinutesAgo: 60,
        }),
      ]);
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(words(assessment.status)).toBe("Last run failed");
    expect(assessment.tone).toBe("warning");
    expect(reasonWords(assessment)).toEqual([
      "Last run failed",
      "BackoffLimitExceeded",
    ]);
  });

  test("a failed run that a newer run followed is history", () => {
    const assessment: KubernetesHealthAssessment =
      assessKubernetesCronJobWithRuns(cronJob(), [
        job("invoice-run-28844160", {
          failed: true,
          cronJob: "invoice-run",
          createdMinutesAgo: 60 * 24,
        }),
        job("invoice-run-28845600", {
          complete: true,
          cronJob: "invoice-run",
          createdMinutesAgo: 60,
        }),
      ]);
    expect(assessment.severity).toBeNull();
    expect(words(assessment.status)).toBe("Scheduled");
  });

  test("a suspended CronJob reads Suspended whatever its last run did", () => {
    expect(
      words(
        assessKubernetesCronJobWithRuns(cronJob(true), [
          job("invoice-run-1", { failed: true, cronJob: "invoice-run" }),
        ]).status,
      ),
    ).toBe("Suspended");
  });

  test("another CronJob's runs are not this one's", () => {
    expect(
      assessKubernetesCronJobWithRuns(cronJob(), [
        job("other-1", { failed: true, cronJob: "other" }),
      ]).severity,
    ).toBeNull();
  });

  test("the newest run is the one created last, then the later name", () => {
    const newest: Map<string, KubernetesHealthRow> = getNewestKubernetesJobs([
      job("invoice-run-1", { cronJob: "invoice-run", createdMinutesAgo: 30 }),
      job("invoice-run-3", { cronJob: "invoice-run", createdMinutesAgo: 10 }),
      job("invoice-run-2", { cronJob: "invoice-run", createdMinutesAgo: 10 }),
      job("standalone"),
    ]);
    expect(newest.size).toBe(1);
    expect(
      newest.get(kubernetesObjectKey("CronJob", "billing", "invoice-run"))
        ?.name,
    ).toBe("invoice-run-3");
  });
});

describe("volumes, autoscalers and the rest", () => {
  function claim(
    phase: string,
    createdMinutesAgo: number = 60,
  ): KubernetesHealthRow {
    return workload("PersistentVolumeClaim", {
      name: "data-postgres-0",
      createdMinutesAgo: createdMinutesAgo,
      status: { phase: phase },
    });
  }

  test("a bound claim reads Bound", () => {
    expect(words(assessKubernetesVolumeClaim(claim("Bound")).status)).toBe(
      "Bound",
    );
  });

  test("a claim waiting for a volume past five minutes needs a look", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesVolumeClaim(
      claim("Pending"),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(reasonWords(assessment)).toEqual(["Waiting for a volume"]);
    expect(
      assessKubernetesVolumeClaim(claim("Pending", 2)).severity,
    ).toBeNull();
  });

  test("a claim that lost its volume is critical", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesVolumeClaim(
      claim("Lost"),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Critical);
    expect(reasonWords(assessment)).toEqual(["Lost its volume"]);
  });

  test("a volume whose reclaim failed is critical; a released one is neutral", () => {
    const failed: KubernetesHealthAssessment = assessKubernetesVolume({
      kind: "PersistentVolume",
      name: "pv-1",
      status: { phase: "Failed" } as unknown as JSONObject,
      lastSeenAt: SEEN,
    });
    expect(failed.severity).toBe(KubernetesHealthSeverity.Critical);
    expect(reasonWords(failed)).toEqual(["Reclaim failed"]);

    const released: KubernetesHealthAssessment = assessKubernetesVolume({
      kind: "PersistentVolume",
      name: "pv-2",
      status: { phase: "Released" } as unknown as JSONObject,
      lastSeenAt: SEEN,
    });
    expect(released.severity).toBeNull();
    expect(released.tone).toBe("neutral");
    expect(words(released.status)).toBe("Released");
  });

  function autoscaler(
    current: number,
    fields: { min?: number; max?: number; conditions?: Array<JSONObject> } = {},
  ): KubernetesHealthRow {
    return workload("HorizontalPodAutoscaler", {
      name: "checkout",
      spec: { minReplicas: fields.min ?? 2, maxReplicas: fields.max ?? 10 },
      status: {
        currentReplicas: current,
        desiredReplicas: current,
        conditions: fields.conditions ?? [],
      },
    });
  }

  test("an autoscaler with headroom reads Active", () => {
    expect(words(assessKubernetesAutoscaler(autoscaler(4)).status)).toBe(
      "Active",
    );
  });

  test("an autoscaler at its maximum needs a look", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesAutoscaler(
      autoscaler(10),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(reasonWords(assessment)).toEqual(["At its maximum of 10 replicas"]);
  });

  test("an autoscaler whose minimum is its maximum is never at a limit", () => {
    expect(
      assessKubernetesAutoscaler(autoscaler(3, { min: 3, max: 3 })).severity,
    ).toBeNull();
  });

  test("an autoscaler that cannot read its metrics cannot scale", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesAutoscaler(
      autoscaler(4, {
        conditions: [
          condition("ScalingActive", "False", {
            reason: "FailedGetResourceMetric",
            message: "unable to get metrics for resource cpu",
          }),
        ],
      }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(reasonWords(assessment)).toEqual([
      "Can't scale: FailedGetResourceMetric",
    ]);
    expect(assessment.message).toBe("unable to get metrics for resource cpu");
  });

  test("an autoscaler of a target scaled to zero switched scaling off on purpose", () => {
    expect(
      assessKubernetesAutoscaler(
        autoscaler(0, {
          conditions: [
            condition("ScalingActive", "False", { reason: "ScalingDisabled" }),
          ],
        }),
      ).severity,
    ).toBeNull();
  });

  test("a DeploymentConfig with none available is critical; one part way is rolling out", () => {
    const config: (available: number) => KubernetesHealthRow = (
      available: number,
    ): KubernetesHealthRow => {
      return workload("DeploymentConfig", {
        name: "legacy-web",
        spec: { replicas: 2, paused: false },
        status: { availableReplicas: available },
      });
    };
    expect(assessKubernetesDeploymentConfig(config(0)).severity).toBe(
      KubernetesHealthSeverity.Critical,
    );
    expect(words(assessKubernetesDeploymentConfig(config(1)).status)).toBe(
      "Rolling out",
    );
    expect(words(assessKubernetesDeploymentConfig(config(2)).status)).toBe(
      "Available",
    );
  });

  test("a namespace reads Active or Terminating, and is never a problem", () => {
    const terminating: KubernetesHealthAssessment = assessKubernetesNamespace({
      kind: "Namespace",
      name: "old",
      status: { phase: "Terminating" } as unknown as JSONObject,
    });
    expect(terminating.severity).toBeNull();
    expect(words(terminating.status)).toBe("Terminating");
    expect(
      words(
        assessKubernetesNamespace({ kind: "Namespace", name: "default" })
          .status,
      ),
    ).toBe("Active");
  });

  test("a kind with no rules says its state and is never flagged", () => {
    const route: KubernetesHealthAssessment = assessKubernetesResource({
      kind: "Route",
      name: "frontend",
      phase: "Rejected",
      isReady: false,
    });
    expect(route.severity).toBeNull();
    expect(words(route.status)).toBe("Rejected");
    expect(route.tone).toBe("warning");
  });
});

describe("what ingest stores", () => {
  test("is the verdict of the row's own kind", () => {
    expect(getKubernetesHealthSeverity(deployment(3, 0))).toBe(
      KubernetesHealthSeverity.Critical,
    );
    expect(getKubernetesHealthSeverity(deployment(3, 3))).toBeNull();
    expect(getKubernetesHealthSeverity(node({ memory: true }))).toBe(
      KubernetesHealthSeverity.Warning,
    );
  });

  test("never throws on a row it cannot read", () => {
    const broken: KubernetesHealthRow = {
      kind: "Pod",
      name: "x",
      status: {
        containerStatuses: "not a list",
        conditions: 7,
      } as unknown as JSONObject,
    };
    expect(() => {
      return getKubernetesHealthSeverity(broken);
    }).not.toThrow();
  });
});

describe("owners", () => {
  test("are read from the stored {items} wrapper and from a bare list", () => {
    expect(
      getKubernetesOwners({ ownerReferences: owners(["ReplicaSet", "a-1"]) }),
    ).toEqual([{ kind: "ReplicaSet", name: "a-1" }]);
    expect(
      getKubernetesOwners({
        ownerReferences: [{ kind: "Job", name: "j" }] as unknown as JSONObject,
      }),
    ).toEqual([{ kind: "Job", name: "j" }]);
    expect(getKubernetesOwners({ ownerReferences: null })).toEqual([]);
  });

  test("a ReplicaSet's Deployment drops the pod template hash the pod carries", () => {
    expect(
      getDeploymentNameFromReplicaSet("api-gateway-v2-86f5d7d9c", "86f5d7d9c"),
    ).toBe("api-gateway-v2");
    // Without the label, the last part is taken for the hash.
    expect(getDeploymentNameFromReplicaSet("checkout-7d9f8b6c5")).toBe(
      "checkout",
    );
  });

  test("a ReplicationController's DeploymentConfig comes from the pod's label, else its name", () => {
    expect(
      getDeploymentConfigNameFromReplicationController("legacy-web-7", {
        "openshift.io/deployment-config.name": "legacy-web",
      }),
    ).toBe("legacy-web");
    expect(
      getDeploymentConfigNameFromReplicationController("legacy-web-12"),
    ).toBe("legacy-web");
  });

  test("a pod's workload follows its controller", () => {
    expect(
      getKubernetesPodWorkload(
        pod({
          ownerReferences: owners(["ReplicaSet", "checkout-7d9f8b6c5"]),
          labels: { "pod-template-hash": "7d9f8b6c5" } as unknown as JSONObject,
        }),
      ),
    ).toEqual({ kind: "Deployment", namespace: "payments", name: "checkout" });
    expect(
      getKubernetesPodWorkload(
        pod({ ownerReferences: owners(["StatefulSet", "pg"]) }),
      ),
    ).toEqual({ kind: "StatefulSet", namespace: "payments", name: "pg" });
    expect(
      getKubernetesPodWorkload(
        pod({ ownerReferences: owners(["Node", "node-1"]) }),
      ),
    ).toBeNull();
    expect(getKubernetesPodWorkload(pod())).toBeNull();
  });

  test("a Job's CronJob is its owner of that kind", () => {
    expect(
      getKubernetesJobCronJob(
        workload("Job", { ownerReferences: owners(["CronJob", "nightly"]) }),
      ),
    ).toEqual({ kind: "CronJob", namespace: "payments", name: "nightly" });
    expect(getKubernetesJobCronJob(workload("Job"))).toBeNull();
  });
});

// A pod of the checkout Deployment whose container keeps crashing, OOMKilled.
const crashLooping: (name: string) => KubernetesHealthRow = (
  name: string,
): KubernetesHealthRow => {
  return pod({
    name: name,
    ownerReferences: owners(["ReplicaSet", "checkout-7d9f8b6c5"]),
    labels: { "pod-template-hash": "7d9f8b6c5" } as unknown as JSONObject,
    containers: [
      container({
        ready: false,
        state: "waiting",
        reason: "CrashLoopBackOff",
        message: `back-off restarting failed container app in pod ${name}`,
        lastTerminationReason: "OOMKilled",
        lastTerminationExitCode: 137,
        lastTerminatedAt: ago(2),
      }),
    ],
  });
};

describe("a cluster's findings", () => {
  test("fold a Deployment's pods into the Deployment, one row with why", () => {
    const findings: Array<KubernetesAttentionFinding> =
      getKubernetesAttentionFindings([
        deployment(3, 1),
        crashLooping("checkout-7d9f8b6c5-aaaaa"),
        crashLooping("checkout-7d9f8b6c5-bbbbb"),
        pod({
          name: "checkout-7d9f8b6c5-ccccc",
          ownerReferences: owners(["ReplicaSet", "checkout-7d9f8b6c5"]),
        }),
      ]);

    expect(findings).toHaveLength(1);
    const finding: KubernetesAttentionFinding = findings[0]!;
    expect(finding.key).toBe("Deployment:payments/checkout");
    expect(finding.kind).toBe("Deployment");
    expect(finding.severity).toBe(KubernetesHealthSeverity.Critical);
    // Its own reason first, then its pods' - each once.
    expect(finding.reasons.map(words)).toEqual([
      "1 of 3 available",
      "CrashLoopBackOff",
      "Last restart: OOMKilled",
    ]);
    expect(finding.podCount).toBe(2);
    expect(finding.message).toBe(
      "back-off restarting failed container app in pod checkout-7d9f8b6c5-aaaaa",
    );
  });

  test("fold a pod into a healthy Deployment too: its pods are why it needs a look", () => {
    const findings: Array<KubernetesAttentionFinding> =
      getKubernetesAttentionFindings([
        deployment(3, 3),
        pod({
          ownerReferences: owners(["ReplicaSet", "checkout-7d9f8b6c5"]),
          containers: [
            container({
              lastTerminationReason: "OOMKilled",
              lastTerminatedAt: ago(10),
            }),
          ],
        }),
      ]);
    expect(
      findings.map((finding: KubernetesAttentionFinding) => {
        return [finding.key, finding.severity, finding.reasons.map(words)];
      }),
    ).toEqual([
      [
        "Deployment:payments/checkout",
        KubernetesHealthSeverity.Warning,
        ["Last restart: OOMKilled"],
      ],
    ]);
  });

  test("keep a pod whose workload is not in the inventory as a pod", () => {
    const findings: Array<KubernetesAttentionFinding> =
      getKubernetesAttentionFindings([crashLooping("rollout-7d9f8b6c5-aaaaa")]);
    expect(
      findings.map((finding: KubernetesAttentionFinding) => {
        return finding.key;
      }),
    ).toEqual(["Pod:payments/rollout-7d9f8b6c5-aaaaa"]);
  });

  test("never mix up same-named workloads of two namespaces", () => {
    const findings: Array<KubernetesAttentionFinding> =
      getKubernetesAttentionFindings([
        deployment(2, 2, { namespace: "shop" }),
        deployment(2, 2, { namespace: "payments" }),
        crashLooping("checkout-7d9f8b6c5-aaaaa"),
      ]);
    expect(
      findings.map((finding: KubernetesAttentionFinding) => {
        return finding.key;
      }),
    ).toEqual(["Deployment:payments/checkout"]);
  });

  test("list each pod on its own on a part's page (foldPods false)", () => {
    const findings: Array<KubernetesAttentionFinding> =
      getKubernetesAttentionFindings(
        [
          deployment(3, 1),
          crashLooping("checkout-7d9f8b6c5-aaaaa"),
          crashLooping("checkout-7d9f8b6c5-bbbbb"),
        ],
        { foldPods: false },
      );
    expect(
      findings.map((finding: KubernetesAttentionFinding) => {
        return [finding.key, finding.reasons.map(words)];
      }),
    ).toEqual([
      // The critical pods first; the Deployment's own shortfall is a warning.
      [
        "Pod:payments/checkout-7d9f8b6c5-aaaaa",
        ["CrashLoopBackOff", "Last restart: OOMKilled"],
      ],
      [
        "Pod:payments/checkout-7d9f8b6c5-bbbbb",
        ["CrashLoopBackOff", "Last restart: OOMKilled"],
      ],
      ["Deployment:payments/checkout", ["1 of 3 available"]],
    ]);
  });

  test("fold a CronJob's newest failed run into it, and forget a run a newer one followed", () => {
    const cronJob: KubernetesHealthRow = workload("CronJob", {
      name: "invoice-run",
      namespace: "billing",
      spec: { schedule: "0 2 * * *", suspend: false },
    });
    const failedRun: (name: string, minutes: number) => KubernetesHealthRow = (
      name: string,
      minutes: number,
    ): KubernetesHealthRow => {
      return workload("Job", {
        name: name,
        namespace: "billing",
        ownerReferences: owners(["CronJob", "invoice-run"]),
        createdMinutesAgo: minutes,
        status: {
          failed: 6,
          conditions: [
            condition("Failed", "True", {
              reason: "BackoffLimitExceeded",
              message: "Job has reached the specified backoff limit",
            }),
          ],
        },
      });
    };

    expect(
      getKubernetesAttentionFindings([
        cronJob,
        failedRun("invoice-run-1", 60 * 24),
        failedRun("invoice-run-2", 60),
      ]).map((finding: KubernetesAttentionFinding) => {
        return [finding.key, finding.reasons.map(words), finding.message];
      }),
    ).toEqual([
      [
        "CronJob:billing/invoice-run",
        ["Last run failed", "BackoffLimitExceeded"],
        "Job has reached the specified backoff limit",
      ],
    ]);

    const succeededSince: KubernetesHealthRow = workload("Job", {
      name: "invoice-run-3",
      namespace: "billing",
      ownerReferences: owners(["CronJob", "invoice-run"]),
      createdMinutesAgo: 5,
      status: { succeeded: 1, conditions: [condition("Complete", "True")] },
    });
    expect(
      getKubernetesAttentionFindings([
        cronJob,
        failedRun("invoice-run-2", 60),
        succeededSince,
      ]),
    ).toEqual([]);
  });

  test("keep a failed Job of a CronJob that is gone as the Job", () => {
    expect(
      getKubernetesAttentionFindings([
        workload("Job", {
          name: "orphan-1",
          namespace: "billing",
          ownerReferences: owners(["CronJob", "deleted"]),
          status: {
            conditions: [
              condition("Failed", "True", { reason: "DeadlineExceeded" }),
            ],
          },
        }),
      ]).map((finding: KubernetesAttentionFinding) => {
        return finding.key;
      }),
    ).toEqual(["Job:billing/orphan-1"]);
  });

  test("fold a crash-looping Job pod into its Job, and that Job into its CronJob", () => {
    const findings: Array<KubernetesAttentionFinding> =
      getKubernetesAttentionFindings([
        workload("CronJob", { name: "sync", namespace: "ops" }),
        workload("Job", {
          name: "sync-28845600",
          namespace: "ops",
          ownerReferences: owners(["CronJob", "sync"]),
          status: { active: 1 },
        }),
        pod({
          name: "sync-28845600-q8xz2",
          namespace: "ops",
          ownerReferences: owners(["Job", "sync-28845600"]),
          containers: [
            container({
              ready: false,
              state: "waiting",
              reason: "CrashLoopBackOff",
            }),
          ],
        }),
      ]);
    expect(
      findings.map((finding: KubernetesAttentionFinding) => {
        return [finding.key, finding.severity, finding.reasons.map(words)];
      }),
    ).toEqual([
      [
        "CronJob:ops/sync",
        KubernetesHealthSeverity.Critical,
        ["CrashLoopBackOff"],
      ],
    ]);
  });

  test("list the most urgent first: critical, then by kind, then by name", () => {
    const findings: Array<KubernetesAttentionFinding> =
      getKubernetesAttentionFindings([
        node({ name: "node-10", memory: true }),
        node({ name: "node-2", memory: true }),
        node({ name: "node-9", isReady: false }),
        deployment(3, 1, { name: "web" }),
        deployment(3, 0, { name: "api" }),
        workload("PersistentVolumeClaim", {
          name: "data-0",
          status: { phase: "Lost" },
        }),
      ]);
    expect(
      findings.map((finding: KubernetesAttentionFinding) => {
        return finding.key;
      }),
    ).toEqual([
      "Node:node-9",
      "Deployment:payments/api",
      "PersistentVolumeClaim:payments/data-0",
      "Node:node-2",
      "Node:node-10",
      "Deployment:payments/web",
    ]);
  });

  test("leave out what needs nothing, and rows with no kind or name", () => {
    expect(
      getKubernetesAttentionFindings([
        node({}),
        deployment(2, 2),
        pod(),
        { kind: "Pod", name: "" },
        { kind: "", name: "x" },
      ]),
    ).toEqual([]);
  });

  test("sorting keeps the kind order the card lists", () => {
    expect(KUBERNETES_ATTENTION_KIND_ORDER.slice(0, 3)).toEqual([
      "Node",
      "Deployment",
      "StatefulSet",
    ]);
    const unsorted: Array<KubernetesAttentionFinding> = [
      {
        key: "Pod:a/x",
        kind: "Pod",
        namespace: "a",
        name: "x",
        severity: KubernetesHealthSeverity.Warning,
        reasons: [],
      },
      {
        key: "Unlisted:y",
        kind: "Unlisted",
        namespace: "",
        name: "y",
        severity: KubernetesHealthSeverity.Warning,
        reasons: [],
      },
      {
        key: "Node:z",
        kind: "Node",
        namespace: "",
        name: "z",
        severity: KubernetesHealthSeverity.Warning,
        reasons: [],
      },
    ];
    expect(
      sortKubernetesAttentionFindings(unsorted).map(
        (finding: KubernetesAttentionFinding) => {
          return finding.key;
        },
      ),
    ).toEqual(["Node:z", "Pod:a/x", "Unlisted:y"]);
  });
});

describe("the cluster's health", () => {
  test("is Unhealthy with anything critical, Degraded with warnings, Healthy otherwise", () => {
    expect(getKubernetesClusterHealth([])).toBe("Healthy");
    expect(
      getKubernetesClusterHealth([
        { severity: KubernetesHealthSeverity.Warning },
      ]),
    ).toBe("Degraded");
    expect(
      getKubernetesClusterHealth([
        { severity: KubernetesHealthSeverity.Warning },
        { severity: KubernetesHealthSeverity.Critical },
      ]),
    ).toBe("Unhealthy");
  });

  test("is Unhealthy for a crash-looping Deployment whose pods all run - the pill that said Healthy", () => {
    const findings: Array<KubernetesAttentionFinding> =
      getKubernetesAttentionFindings([
        deployment(2, 0),
        crashLooping("checkout-7d9f8b6c5-aaaaa"),
      ]);
    expect(getKubernetesClusterHealth(findings)).toBe("Unhealthy");
  });
});
