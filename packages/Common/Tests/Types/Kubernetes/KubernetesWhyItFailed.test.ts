import { JSONObject } from "../../../Types/JSON";
import {
  KUBERNETES_HEALTH_GRACE_MS,
  KUBERNETES_REASON_AS_WRITTEN,
  KubernetesContainerAssessment,
  KubernetesHealthAssessment,
  KubernetesHealthRow,
  KubernetesHealthSeverity,
  KubernetesHealthText,
  assessKubernetesContainer,
  assessKubernetesDeployment,
  assessKubernetesDeploymentConfig,
  assessKubernetesNamespace,
  assessKubernetesResource,
  getKubernetesAttentionFindings,
  getKubernetesHealthSeverity,
} from "../../../Types/Kubernetes/KubernetesHealth";
import {
  ExtractedInventoryRecord,
  extractInventoryResource,
} from "../../../Types/Kubernetes/KubernetesInventoryExtractor";
import {
  KubernetesNamespaceObject,
  getKvStringList,
  parseNamespaceObject,
} from "../../../Types/Kubernetes/KubernetesObjectParser";
import { describe, expect, test } from "@jest/globals";

/*
 * KUBERNETES OBJECTS THAT SAY WHY THEY FAILED (#9595).
 *
 * A DeploymentConfig's page said "Unavailable" and nothing else, a
 * container's page only its name, and a namespace "Terminating" with no
 * reason. The cluster's rules (KubernetesHealth) now read what Kubernetes
 * and OpenShift report about each: a rollout's conditions, a container's
 * own state, and the conditions and finalizers that hold a namespace being
 * deleted. Each is measured against the snapshot's own time, as every rule
 * is, so the stored verdict (healthSeverity) and a page agree.
 */

const SEEN: Date = new Date("2026-11-01T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

function ago(minutes: number): string {
  return new Date(SEEN.getTime() - minutes * MINUTE).toISOString();
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

/*
 * ---------------------------------------------------------------------------
 * A DeploymentConfig's rollout
 * ---------------------------------------------------------------------------
 */

function deploymentConfig(fields: {
  desired?: number;
  available?: number;
  paused?: boolean;
  conditions?: Array<JSONObject>;
  createdMinutesAgo?: number;
}): KubernetesHealthRow {
  return {
    kind: "DeploymentConfig",
    namespaceKey: "legacy",
    name: "frontend",
    spec: {
      replicas: fields.desired ?? 3,
      paused: fields.paused ?? false,
    } as unknown as JSONObject,
    status: {
      availableReplicas: fields.available ?? 0,
      latestVersion: 4,
      conditions: fields.conditions ?? [],
    } as unknown as JSONObject,
    lastSeenAt: SEEN,
    resourceCreationTimestamp: ago(fields.createdMinutesAgo ?? 6000),
  };
}

describe("a DeploymentConfig's rollout says why it failed", () => {
  test("past its deadline: critical, Rollout stuck, OpenShift's message and since when", () => {
    const assessment: KubernetesHealthAssessment =
      assessKubernetesDeploymentConfig(
        deploymentConfig({
          available: 2,
          conditions: [
            condition("Available", "True", {
              reason: "MinimumReplicasAvailable",
            }),
            condition("Progressing", "False", {
              reason: "ProgressDeadlineExceeded",
              message:
                'replication controller "frontend-4" has failed progressing',
              at: ago(42),
            }),
          ],
        }),
      );

    expect(assessment.severity).toBe(KubernetesHealthSeverity.Critical);
    expect(assessment.tone).toBe("danger");
    expect(words(assessment.status)).toBe("Rollout stuck");
    expect(reasonWords(assessment)).toEqual([
      "Rollout stuck",
      "2 of 3 available",
    ]);
    expect(assessment.message).toBe(
      'replication controller "frontend-4" has failed progressing',
    );
    expect(assessment.since).toBe(new Date(ago(42)).getTime());
  });

  test("a version OpenShift could not create: Rollout failed, in OpenShift's word", () => {
    const assessment: KubernetesHealthAssessment =
      assessKubernetesDeploymentConfig(
        deploymentConfig({
          available: 3,
          conditions: [
            condition("Progressing", "False", {
              reason: "ReplicationControllerCreateError",
              message:
                'replicationcontrollers "frontend-5" is forbidden: exceeded quota: compute',
            }),
          ],
        }),
      );

    expect(assessment.severity).toBe(KubernetesHealthSeverity.Critical);
    expect(words(assessment.status)).toBe("Rollout failed");
    expect(assessment.reasons).toEqual([
      { text: "Rollout failed" },
      {
        text: KUBERNETES_REASON_AS_WRITTEN,
        values: { reason: "ReplicationControllerCreateError" },
      },
    ]);
    expect(assessment.message).toContain("exceeded quota");
  });

  test("pods it cannot create say so, beside a stuck rollout", () => {
    const assessment: KubernetesHealthAssessment =
      assessKubernetesDeploymentConfig(
        deploymentConfig({
          available: 1,
          conditions: [
            condition("Progressing", "False", {
              reason: "ProgressDeadlineExceeded",
            }),
            condition("ReplicaFailure", "True", {
              reason: "FailedCreate",
              message: 'pods "frontend-4-x" is forbidden: exceeded quota',
            }),
          ],
        }),
      );

    expect(reasonWords(assessment)).toEqual([
      "Rollout stuck",
      "1 of 3 available",
      "Can't create pods: FailedCreate",
    ]);
    // The rollout's own message says nothing: the pods' failure does.
    expect(assessment.message).toBe(
      'pods "frontend-4-x" is forbidden: exceeded quota',
    );
  });

  test("short of replicas because its pods cannot be created is a warning, not a rollout", () => {
    const assessment: KubernetesHealthAssessment =
      assessKubernetesDeploymentConfig(
        deploymentConfig({
          available: 2,
          conditions: [
            condition("ReplicaFailure", "True", {
              reason: "FailedCreate",
              message: "admission webhook denied the request",
              at: ago(30),
            }),
          ],
        }),
      );

    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(words(assessment.status)).toBe("2 of 3 available");
    expect(reasonWords(assessment)).toEqual([
      "2 of 3 available",
      "Can't create pods: FailedCreate",
    ]);
    expect(assessment.message).toBe("admission webhook denied the request");
    expect(assessment.since).toBe(new Date(ago(30)).getTime());
  });

  test("none available, and why: its pods cannot be created", () => {
    const assessment: KubernetesHealthAssessment =
      assessKubernetesDeploymentConfig(
        deploymentConfig({
          available: 0,
          conditions: [
            condition("ReplicaFailure", "True", { reason: "FailedCreate" }),
          ],
        }),
      );

    expect(assessment.severity).toBe(KubernetesHealthSeverity.Critical);
    expect(reasonWords(assessment)).toEqual([
      "0 of 3 available",
      "Can't create pods: FailedCreate",
    ]);
  });

  test("a rollout someone cancelled is no failure: its replicas decide", () => {
    const cancelled: KubernetesHealthAssessment =
      assessKubernetesDeploymentConfig(
        deploymentConfig({
          available: 3,
          conditions: [
            condition("Progressing", "False", { reason: "RolloutCancelled" }),
          ],
        }),
      );
    expect(cancelled.severity).toBeNull();
    expect(words(cancelled.status)).toBe("Available");
  });

  test("paused wins over a rollout that failed: someone chose to stop it", () => {
    const paused: KubernetesHealthAssessment = assessKubernetesDeploymentConfig(
      deploymentConfig({
        paused: true,
        conditions: [
          condition("Progressing", "False", {
            reason: "ProgressDeadlineExceeded",
          }),
        ],
      }),
    );
    expect(paused.severity).toBeNull();
    expect(words(paused.status)).toBe("Paused");
  });

  test("part way through a rollout, with nothing failing, is rolling out", () => {
    const rolling: KubernetesHealthAssessment =
      assessKubernetesDeploymentConfig(
        deploymentConfig({
          available: 1,
          conditions: [
            condition("Progressing", "True", {
              reason: "ReplicationControllerUpdated",
            }),
          ],
        }),
      );
    expect(rolling.severity).toBeNull();
    expect(words(rolling.status)).toBe("Rolling out");
  });

  test("a new one whose pods cannot be created yet is still starting", () => {
    expect(
      assessKubernetesDeploymentConfig(
        deploymentConfig({
          available: 1,
          createdMinutesAgo: 2,
          conditions: [
            condition("ReplicaFailure", "True", { reason: "FailedCreate" }),
          ],
        }),
      ).severity,
    ).toBeNull();
  });

  test("the stored verdict is the page's", () => {
    const row: KubernetesHealthRow = deploymentConfig({
      available: 2,
      conditions: [
        condition("Progressing", "False", {
          reason: "ProgressDeadlineExceeded",
        }),
      ],
    });
    expect(getKubernetesHealthSeverity(row)).toBe(
      KubernetesHealthSeverity.Critical,
    );
    expect(assessKubernetesResource(row).status).toEqual({
      text: "Rollout stuck",
    });
  });
});

describe("a Deployment short of replicas says when its pods cannot be created", () => {
  function deployment(
    available: number,
    conditions: Array<JSONObject>,
  ): KubernetesHealthRow {
    return {
      kind: "Deployment",
      namespaceKey: "shop",
      name: "checkout",
      spec: { replicas: 3 } as unknown as JSONObject,
      status: {
        availableReplicas: available,
        conditions: conditions,
      } as unknown as JSONObject,
      lastSeenAt: SEEN,
      resourceCreationTimestamp: ago(6000),
    };
  }

  test("a shortfall gains the controller's reason and its message", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesDeployment(
      deployment(2, [
        condition("Progressing", "True", {
          reason: "NewReplicaSetAvailable",
        }),
        condition("ReplicaFailure", "True", {
          reason: "FailedCreate",
          message: 'pods "checkout-7d9f8b6c5-q" is forbidden: exceeded quota',
        }),
      ]),
    );

    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(reasonWords(assessment)).toEqual([
      "2 of 3 available",
      "Can't create pods: FailedCreate",
    ]);
    expect(assessment.message).toBe(
      'pods "checkout-7d9f8b6c5-q" is forbidden: exceeded quota',
    );
  });

  test("a stuck rollout says since when, and why its pods are missing", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesDeployment(
      deployment(1, [
        condition("Progressing", "False", {
          reason: "ProgressDeadlineExceeded",
          at: ago(15),
        }),
        condition("ReplicaFailure", "True", { reason: "FailedCreate" }),
      ]),
    );

    expect(reasonWords(assessment)).toEqual([
      "Rollout stuck",
      "1 of 3 available",
      "Can't create pods: FailedCreate",
    ]);
    expect(assessment.since).toBe(new Date(ago(15)).getTime());
  });

  test("every replica available: a leftover ReplicaFailure changes nothing", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesDeployment(
      deployment(3, [
        condition("ReplicaFailure", "True", { reason: "FailedCreate" }),
      ]),
    );
    expect(assessment.severity).toBeNull();
    expect(assessment.reasons).toEqual([]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * A namespace being deleted
 * ---------------------------------------------------------------------------
 */

function namespace(fields: {
  phase?: string;
  conditions?: Array<JSONObject>;
  finalizers?: Array<string>;
}): KubernetesHealthRow {
  return {
    kind: "Namespace",
    namespaceKey: "",
    name: "old-shop",
    spec: {
      finalizers: fields.finalizers ?? ["kubernetes"],
    } as unknown as JSONObject,
    status: {
      phase: fields.phase ?? "Terminating",
      conditions: fields.conditions ?? [],
    } as unknown as JSONObject,
    lastSeenAt: SEEN,
    resourceCreationTimestamp: ago(60 * 24 * 90),
  };
}

// The five conditions the namespace controller sets as it starts deleting.
function deletionConditions(fields: {
  at: string;
  contentRemaining?: string;
  finalizersRemaining?: string;
  contentFailure?: string;
}): Array<JSONObject> {
  return [
    condition("NamespaceDeletionDiscoveryFailure", "False", {
      reason: "ResourcesDiscovered",
      message: "All resources successfully discovered",
      at: fields.at,
    }),
    condition("NamespaceDeletionGroupVersionParsingFailure", "False", {
      reason: "ParsedGroupVersions",
      message: "All legacy kube types successfully parsed",
      at: fields.at,
    }),
    condition(
      "NamespaceDeletionContentFailure",
      fields.contentFailure ? "True" : "False",
      {
        reason: fields.contentFailure
          ? "ContentDeletionFailed"
          : "ContentDeleted",
        message: fields.contentFailure || "All content successfully deleted",
        at: fields.at,
      },
    ),
    condition(
      "NamespaceContentRemaining",
      fields.contentRemaining ? "True" : "False",
      {
        reason: fields.contentRemaining
          ? "SomeResourcesRemain"
          : "ContentRemoved",
        message: fields.contentRemaining || "All content successfully removed",
        at: fields.at,
      },
    ),
    condition(
      "NamespaceFinalizersRemaining",
      fields.finalizersRemaining ? "True" : "False",
      {
        reason: fields.finalizersRemaining
          ? "SomeFinalizersRemain"
          : "ContentHasNoFinalizers",
        message:
          fields.finalizersRemaining ||
          "All content-preserving finalizers finished",
        at: fields.at,
      },
    ),
  ];
}

describe("a namespace stuck while it is deleted says why", () => {
  test("resources and finalizers that remain past the grace period: a warning, in Kubernetes' words, since it began", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesNamespace(
      namespace({
        conditions: deletionConditions({
          at: ago(45),
          contentRemaining:
            "Some resources are remaining: persistentvolumeclaims. has 1 resource instances",
          finalizersRemaining:
            "Some content in the namespace has finalizers remaining: kubernetes.io/pvc-protection in 1 resource instances",
        }),
      }),
    );

    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(assessment.tone).toBe("warning");
    expect(words(assessment.status)).toBe("Terminating");
    expect(reasonWords(assessment)).toEqual([
      "Resources remain",
      "Finalizers remain",
    ]);
    expect(assessment.message).toBe(
      "Some resources are remaining: persistentvolumeclaims. has 1 resource instances; Some content in the namespace has finalizers remaining: kubernetes.io/pvc-protection in 1 resource instances",
    );
    expect(assessment.since).toBe(new Date(ago(45)).getTime());
  });

  test("a deletion that failed is a problem at once, whatever its age", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesNamespace(
      namespace({
        conditions: deletionConditions({
          at: ago(1),
          contentFailure:
            'Failed to delete all resource types, 1 remaining: Internal error occurred: failed calling webhook "validate.example.com"',
        }),
      }),
    );

    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(reasonWords(assessment)).toEqual(["Can't delete its content"]);
    expect(assessment.message).toContain("failed calling webhook");
  });

  test("still deleting within the grace period is only Terminating", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesNamespace(
      namespace({
        conditions: deletionConditions({
          at: ago(2),
          contentRemaining:
            "Some resources are remaining: pods. has 3 resource instances",
        }),
      }),
    );

    expect(assessment.severity).toBeNull();
    expect(assessment.reasons).toEqual([]);
    expect(words(assessment.status)).toBe("Terminating");
    expect(assessment.tone).toBe("warning");
  });

  test("an operator's finalizer on the namespace itself holds it after its content is gone", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesNamespace(
      namespace({
        finalizers: ["kubernetes", "example.com/cleanup"],
        conditions: deletionConditions({ at: ago(30) }),
      }),
    );

    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(reasonWords(assessment)).toEqual(["Finalizers remain"]);
    // Which one, as Kubernetes names it; never the controller's own.
    expect(assessment.message).toBe("example.com/cleanup");
  });

  test("the controller's own finalizer alone, its content gone, holds nothing", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesNamespace(
      namespace({ conditions: deletionConditions({ at: ago(30) }) }),
    );
    expect(assessment.severity).toBeNull();
    expect(assessment.reasons).toEqual([]);
  });

  test("a namespace stored before its conditions were read is only Terminating", () => {
    expect(
      assessKubernetesNamespace({
        kind: "Namespace",
        name: "old",
        status: { phase: "Terminating" } as unknown as JSONObject,
      }).severity,
    ).toBeNull();
  });

  test("an Active namespace is fine, whatever conditions it once had", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesNamespace(
      namespace({
        phase: "Active",
        conditions: deletionConditions({
          at: ago(300),
          contentRemaining: "left over",
        }),
      }),
    );
    expect(assessment.severity).toBeNull();
    expect(words(assessment.status)).toBe("Active");
  });

  test("it is measured against the snapshot's time, so ingest and the page agree", () => {
    const row: KubernetesHealthRow = namespace({
      conditions: deletionConditions({
        at: new Date(SEEN.getTime() - KUBERNETES_HEALTH_GRACE_MS).toISOString(),
        contentRemaining: "Some resources are remaining: pods.",
      }),
    });
    expect(getKubernetesHealthSeverity(row)).toBe(
      KubernetesHealthSeverity.Warning,
    );
    expect(
      getKubernetesHealthSeverity(row, {
        now: new Date(SEEN.getTime() + 60 * MINUTE),
      }),
    ).toBe(KubernetesHealthSeverity.Warning);
  });

  test("a stuck namespace is one of the cluster's findings, with its reasons", () => {
    const findings: ReturnType<typeof getKubernetesAttentionFindings> =
      getKubernetesAttentionFindings([
        namespace({
          conditions: deletionConditions({
            at: ago(45),
            contentRemaining: "Some resources are remaining: pods.",
          }),
        }),
      ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("Namespace");
    expect(findings[0]!.key).toBe("Namespace:old-shop");
    expect(reasonWords(findings[0]!)).toEqual(["Resources remain"]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * One container of a pod
 * ---------------------------------------------------------------------------
 */

function podWith(fields: {
  phase?: string;
  containers?: Array<Record<string, unknown>>;
  initContainers?: Array<Record<string, unknown>>;
  ready?: { status: string; at: string; message?: string };
}): KubernetesHealthRow {
  return {
    kind: "Pod",
    namespaceKey: "shop",
    name: "checkout-7d9f8b6c5-x2k4q",
    phase: fields.phase ?? "Running",
    spec: { nodeName: "node-b" } as unknown as JSONObject,
    status: {
      phase: fields.phase ?? "Running",
      conditions: [
        condition("Ready", fields.ready?.status ?? "True", {
          at: fields.ready?.at ?? ago(600),
          message: fields.ready?.message ?? "",
        }),
      ],
      containerStatuses: fields.containers ?? [],
      initContainerStatuses: fields.initContainers ?? [],
    } as unknown as JSONObject,
    lastSeenAt: SEEN,
    resourceCreationTimestamp: ago(600),
  };
}

function containerStatus(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return {
    name: "app",
    ready: true,
    restartCount: 0,
    state: "running",
    reason: "",
    image: "registry.example.com/app:1.4.2",
    ...fields,
  };
}

describe("a container says why it is not running", () => {
  test("one that cannot run: critical, in Kubernetes' word, how its last run ended, its restarts and since when", () => {
    const assessment: KubernetesContainerAssessment | null =
      assessKubernetesContainer(
        podWith({
          ready: { status: "False", at: ago(90) },
          containers: [
            containerStatus({ name: "sidecar" }),
            containerStatus({
              ready: false,
              restartCount: 14,
              state: "waiting",
              reason: "CrashLoopBackOff",
              message: "back-off 5m0s restarting failed container=app",
              lastTerminationReason: "Error",
              lastTerminationExitCode: 2,
              lastTerminatedAt: ago(3),
            }),
          ],
        }),
        { name: "app" },
      );

    expect(assessment).not.toBeNull();
    expect(assessment!.severity).toBe(KubernetesHealthSeverity.Critical);
    expect(assessment!.tone).toBe("danger");
    expect(words(assessment!.status)).toBe("CrashLoopBackOff");
    expect(reasonWords(assessment!)).toEqual([
      "CrashLoopBackOff",
      "Last restart: Error, exit code 2",
    ]);
    expect(assessment!.message).toBe(
      "back-off 5m0s restarting failed container=app",
    );
    // Failing since it stopped being ready, not since its last restart.
    expect(assessment!.since).toBe(new Date(ago(90)).getTime());
    expect(assessment!.container).toBe("app");
    expect(assessment!.isInit).toBe(false);
    expect(assessment!.restarts).toBe(14);
    expect(assessment!.ready).toBe(false);
    expect(assessment!.lastTermination).toEqual({
      reason: "Error",
      exitCode: 2,
      at: new Date(ago(3)).getTime(),
    });
  });

  test("one that ended in an error says how, with its exit code", () => {
    const assessment: KubernetesContainerAssessment | null =
      assessKubernetesContainer(
        podWith({
          phase: "Failed",
          ready: { status: "False", at: ago(20) },
          containers: [
            containerStatus({
              ready: false,
              state: "terminated",
              reason: "Error",
              exitCode: 1,
              message: "panic: connection refused",
            }),
          ],
        }),
        { name: "app" },
      );

    expect(assessment!.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(assessment!.tone).toBe("danger");
    expect(words(assessment!.status)).toBe("Error, exit code 1");
    expect(reasonWords(assessment!)).toEqual(["Error, exit code 1"]);
    expect(assessment!.exitCode).toBe(1);
    expect(assessment!.message).toBe("panic: connection refused");
    expect(assessment!.since).toBe(new Date(ago(20)).getTime());
  });

  test("an OOM kill says its word without the code, which adds nothing", () => {
    const assessment: KubernetesContainerAssessment | null =
      assessKubernetesContainer(
        podWith({
          containers: [
            containerStatus({
              state: "terminated",
              reason: "OOMKilled",
              exitCode: 137,
              ready: false,
            }),
          ],
        }),
        { name: "app" },
      );
    expect(words(assessment!.status)).toBe("OOMKilled");
  });

  test("an init container is found among the init containers, and says so", () => {
    const assessment: KubernetesContainerAssessment | null =
      assessKubernetesContainer(
        podWith({
          phase: "Pending",
          initContainers: [
            containerStatus({
              name: "migrate",
              ready: false,
              state: "waiting",
              reason: "CrashLoopBackOff",
            }),
          ],
          containers: [
            containerStatus({
              state: "waiting",
              reason: "PodInitializing",
              ready: false,
            }),
          ],
        }),
        { name: "migrate" },
      );

    expect(assessment!.isInit).toBe(true);
    expect(words(assessment!.status)).toBe("CrashLoopBackOff");
    expect(assessment!.severity).toBe(KubernetesHealthSeverity.Critical);
  });

  test("one still starting waits in Kubernetes' word, and is no problem yet", () => {
    const assessment: KubernetesContainerAssessment | null =
      assessKubernetesContainer(
        podWith({
          phase: "Pending",
          containers: [
            containerStatus({
              state: "waiting",
              reason: "ContainerCreating",
              ready: false,
            }),
          ],
        }),
        { name: "app" },
      );
    expect(assessment!.severity).toBeNull();
    expect(words(assessment!.status)).toBe("ContainerCreating");
    expect(assessment!.tone).toBe("warning");
  });

  test("one that finished its work is Completed, quietly", () => {
    const assessment: KubernetesContainerAssessment | null =
      assessKubernetesContainer(
        podWith({
          phase: "Succeeded",
          containers: [
            containerStatus({
              state: "terminated",
              reason: "Completed",
              exitCode: 0,
              ready: false,
            }),
          ],
        }),
        { name: "app" },
      );
    expect(assessment!.severity).toBeNull();
    expect(words(assessment!.status)).toBe("Completed");
    expect(assessment!.tone).toBe("neutral");
  });

  test("running but not ready past the grace period says so, with the kubelet's words", () => {
    const assessment: KubernetesContainerAssessment | null =
      assessKubernetesContainer(
        podWith({
          ready: {
            status: "False",
            at: ago(12),
            message: "containers with unready status: [app]",
          },
          containers: [containerStatus({ ready: false })],
        }),
        { name: "app" },
      );
    expect(assessment!.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(words(assessment!.status)).toBe("Not ready");
    expect(reasonWords(assessment!)).toEqual(["Not ready"]);
    expect(assessment!.message).toBe("containers with unready status: [app]");
    expect(assessment!.since).toBe(new Date(ago(12)).getTime());
  });

  test("not ready for a moment is no problem yet", () => {
    const assessment: KubernetesContainerAssessment | null =
      assessKubernetesContainer(
        podWith({
          ready: { status: "False", at: ago(1) },
          containers: [containerStatus({ ready: false })],
        }),
        { name: "app" },
      );
    expect(assessment!.severity).toBeNull();
    expect(words(assessment!.status)).toBe("Not ready");
  });

  test("running after an OOM kill in the last hour is worth a look", () => {
    const assessment: KubernetesContainerAssessment | null =
      assessKubernetesContainer(
        podWith({
          containers: [
            containerStatus({
              restartCount: 3,
              lastTerminationReason: "OOMKilled",
              lastTerminationExitCode: 137,
              lastTerminatedAt: ago(20),
            }),
          ],
        }),
        { name: "app" },
      );
    expect(assessment!.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(words(assessment!.status)).toBe("Running");
    expect(reasonWords(assessment!)).toEqual(["Last restart: OOMKilled"]);
    expect(assessment!.restarts).toBe(3);
  });

  test("running and ready is fine, and keeps how its last run ended", () => {
    const assessment: KubernetesContainerAssessment | null =
      assessKubernetesContainer(
        podWith({
          containers: [
            containerStatus({
              restartCount: 1,
              lastTerminationReason: "Error",
              lastTerminationExitCode: 1,
              lastTerminatedAt: ago(60 * 24),
            }),
          ],
        }),
        { name: "app" },
      );
    expect(assessment!.severity).toBeNull();
    expect(words(assessment!.status)).toBe("Running");
    expect(assessment!.lastTermination?.reason).toBe("Error");
  });

  test("a container the pod does not report has no verdict", () => {
    expect(
      assessKubernetesContainer(
        podWith({ containers: [containerStatus({})] }),
        {
          name: "missing",
        },
      ),
    ).toBeNull();
    expect(
      assessKubernetesContainer(
        podWith({ containers: [containerStatus({})] }),
        {
          name: "app",
          isInit: true,
        },
      ),
    ).toBeNull();
  });
});

/*
 * ---------------------------------------------------------------------------
 * What the parser keeps of a namespace
 * ---------------------------------------------------------------------------
 */

function kv(entries: Array<[string, JSONObject]>): JSONObject {
  return {
    values: entries.map(([key, value]: [string, JSONObject]) => {
      return { key, value };
    }),
  };
}

function str(value: string): JSONObject {
  return { stringValue: value };
}

function obj(kvList: JSONObject): JSONObject {
  return { kvlistValue: kvList };
}

function strings(items: Array<string>): JSONObject {
  return {
    arrayValue: {
      values: items.map((item: string) => {
        return { stringValue: item };
      }),
    },
  };
}

function objects(items: Array<JSONObject>): JSONObject {
  return {
    arrayValue: {
      values: items.map((item: JSONObject) => {
        return { kvlistValue: item };
      }),
    },
  };
}

const TERMINATING_NAMESPACE: JSONObject = kv([
  [
    "metadata",
    obj(
      kv([
        ["name", str("old-shop")],
        ["creationTimestamp", str("2026-08-01T00:00:00Z")],
        ["finalizers", strings(["example.com/cleanup"])],
      ]),
    ),
  ],
  ["spec", obj(kv([["finalizers", strings(["kubernetes"])]]))],
  [
    "status",
    obj(
      kv([
        ["phase", str("Terminating")],
        [
          "conditions",
          objects([
            kv([
              ["type", str("NamespaceContentRemaining")],
              ["status", str("True")],
              ["reason", str("SomeResourcesRemain")],
              [
                "message",
                str(
                  "Some resources are remaining: pods. has 2 resource instances",
                ),
              ],
              ["lastTransitionTime", str(ago(30))],
            ]),
          ]),
        ],
      ]),
    ),
  ],
]);

describe("a namespace's finalizers and conditions are kept", () => {
  test("its finalizers, the controller's then an operator's, and its conditions", () => {
    const parsed: KubernetesNamespaceObject | null = parseNamespaceObject(
      TERMINATING_NAMESPACE,
    );

    expect(parsed?.spec?.finalizers).toEqual([
      "kubernetes",
      "example.com/cleanup",
    ]);
    expect(parsed?.status.phase).toBe("Terminating");
    expect(parsed?.status.conditions).toEqual([
      {
        type: "NamespaceContentRemaining",
        status: "True",
        reason: "SomeResourcesRemain",
        message: "Some resources are remaining: pods. has 2 resource instances",
        lastTransitionTime: ago(30),
      },
    ]);
  });

  test("a namespace with no spec or conditions keeps none, as before", () => {
    const parsed: KubernetesNamespaceObject | null = parseNamespaceObject(
      kv([
        ["metadata", obj(kv([["name", str("prod")]]))],
        ["status", obj(kv([["phase", str("Active")]]))],
      ]),
    );
    expect(parsed?.spec?.finalizers).toEqual([]);
    expect(parsed?.status.conditions).toEqual([]);
  });

  test("a list of strings keeps its order and drops what is not a string", () => {
    expect(
      getKvStringList(
        kv([
          [
            "finalizers",
            {
              arrayValue: {
                values: [
                  { stringValue: "a" },
                  { intValue: 3 },
                  { string_value: " b " },
                  { stringValue: "" },
                ],
              },
            } as unknown as JSONObject,
          ],
        ]),
        "finalizers",
      ),
    ).toEqual(["a", "b"]);
    expect(getKvStringList(kv([]), "finalizers")).toEqual([]);
    expect(
      getKvStringList(kv([["finalizers", str("kubernetes")]]), "finalizers"),
    ).toEqual([]);
  });

  test("ingest stores them, and flags a namespace stuck deleting", () => {
    const record: ExtractedInventoryRecord | null = extractInventoryResource({
      resourceType: "namespaces",
      logBody: JSON.stringify({ kvlistValue: TERMINATING_NAMESPACE }),
      lastSeenAt: SEEN,
    });

    expect(record?.resource.kind).toBe("Namespace");
    expect(record?.resource.namespaceKey).toBe("");
    expect(
      (record?.resource.spec as unknown as { finalizers: Array<string> })
        .finalizers,
    ).toEqual(["kubernetes", "example.com/cleanup"]);
    expect(
      (
        record?.resource.status as unknown as {
          conditions: Array<{ type: string }>;
        }
      ).conditions[0]!.type,
    ).toBe("NamespaceContentRemaining");
    expect(record?.resource.healthSeverity).toBe(
      KubernetesHealthSeverity.Warning,
    );
  });
});
