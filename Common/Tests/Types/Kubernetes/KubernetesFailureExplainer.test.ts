import {
  KubernetesFailureExplanation,
  KubernetesPodFailureInput,
  explainNodeConditions,
  explainPodFailures,
} from "../../../Types/Kubernetes/KubernetesFailureExplainer";
import { JSONObject } from "../../../Types/JSON";

/*
 * Fixtures below are written as real Kubernetes API object shapes
 * (containerStatuses[].state.waiting, lastState.terminated, etc.)
 * because the explainer consumes raw spec/status JSONB from
 * arbitrary clusters.
 */

function findById(
  explanations: Array<KubernetesFailureExplanation>,
  id: string,
): KubernetesFailureExplanation | undefined {
  return explanations.find((e: KubernetesFailureExplanation) => {
    return e.id === id;
  });
}

function evidenceValue(
  explanation: KubernetesFailureExplanation,
  label: string,
): string | undefined {
  return explanation.evidence.find((e: { label: string; value: string }) => {
    return e.label === label;
  })?.value;
}

describe("explainPodFailures", () => {
  test("CrashLoopBackOff: reports container, restart count, last exit code and backoff message", () => {
    const status: JSONObject = {
      phase: "Running",
      containerStatuses: [
        {
          name: "api",
          ready: false,
          restartCount: 17,
          image: "registry.example.com/api:1.4.2",
          state: {
            waiting: {
              reason: "CrashLoopBackOff",
              message:
                "back-off 5m0s restarting failed container=api pod=api-6d5f7c9b8-x2v4q_prod",
            },
          },
          lastState: {
            terminated: {
              exitCode: 137,
              reason: "Error",
              startedAt: "2026-07-02T10:00:00Z",
              finishedAt: "2026-07-02T10:01:30Z",
            },
          },
        },
      ],
    };

    const result: Array<KubernetesFailureExplanation> = explainPodFailures({
      podName: "api-6d5f7c9b8-x2v4q",
      namespace: "prod",
      phase: "Running",
      status,
    });

    const explanation: KubernetesFailureExplanation | undefined = findById(
      result,
      "crash-loop-backoff-api",
    );
    expect(explanation).toBeDefined();
    expect(explanation!.severity).toBe("critical");
    expect(evidenceValue(explanation!, "Container")).toBe("api");
    expect(evidenceValue(explanation!, "Restart count")).toBe("17");
    expect(evidenceValue(explanation!, "Last exit code")).toBe("137");
    expect(evidenceValue(explanation!, "Last termination reason")).toBe(
      "Error",
    );
    expect(evidenceValue(explanation!, "Last terminated at")).toBe(
      "2026-07-02T10:01:30Z",
    );
    expect(evidenceValue(explanation!, "Backoff message")).toContain(
      "back-off 5m0s",
    );
    // Recommendation must mention logs and explain the exit code.
    expect(explanation!.recommendation).toContain("logs");
    expect(explanation!.recommendation).toContain("137");
  });

  test("CrashLoopBackOff: detected on init containers too", () => {
    const status: JSONObject = {
      phase: "Pending",
      initContainerStatuses: [
        {
          name: "run-migrations",
          restartCount: 4,
          state: {
            waiting: {
              reason: "CrashLoopBackOff",
              message: "back-off 1m20s restarting failed container",
            },
          },
          lastState: {
            terminated: { exitCode: 1, reason: "Error" },
          },
        },
      ],
    };

    const result: Array<KubernetesFailureExplanation> = explainPodFailures({
      podName: "worker-0",
      phase: "Pending",
      status,
    });

    const explanation: KubernetesFailureExplanation | undefined = findById(
      result,
      "crash-loop-backoff-run-migrations (init container)",
    );
    expect(explanation).toBeDefined();
    expect(evidenceValue(explanation!, "Container")).toBe(
      "run-migrations (init container)",
    );
  });

  test("OOMKilled: reports memory limit verbatim from spec and mentions the utilization metric", () => {
    const spec: JSONObject = {
      containers: [
        {
          name: "cache",
          image: "redis:7",
          resources: {
            requests: { cpu: "100m", memory: "256Mi" },
            limits: { cpu: "500m", memory: "512Mi" },
          },
        },
      ],
    };
    const status: JSONObject = {
      phase: "Running",
      containerStatuses: [
        {
          name: "cache",
          restartCount: 6,
          state: { running: { startedAt: "2026-07-02T11:00:00Z" } },
          lastState: {
            terminated: {
              exitCode: 137,
              reason: "OOMKilled",
              finishedAt: "2026-07-02T10:59:00Z",
            },
          },
        },
      ],
    };

    const result: Array<KubernetesFailureExplanation> = explainPodFailures({
      podName: "cache-0",
      phase: "Running",
      spec,
      status,
    });

    const explanation: KubernetesFailureExplanation | undefined = findById(
      result,
      "oom-killed-cache",
    );
    expect(explanation).toBeDefined();
    expect(explanation!.severity).toBe("critical");
    expect(evidenceValue(explanation!, "Memory limit")).toBe("512Mi");
    expect(evidenceValue(explanation!, "Restart count")).toBe("6");
    expect(explanation!.recommendation).toContain(
      "k8s.container.memory_limit_utilization",
    );
  });

  test("OOMKilled: also detected from current state.terminated", () => {
    const status: JSONObject = {
      phase: "Running",
      containerStatuses: [
        {
          name: "job-runner",
          restartCount: 0,
          state: {
            terminated: { exitCode: 137, reason: "OOMKilled" },
          },
        },
      ],
    };

    const result: Array<KubernetesFailureExplanation> = explainPodFailures({
      podName: "job-runner-abc",
      status,
    });

    expect(findById(result, "oom-killed-job-runner")).toBeDefined();
  });

  test("ImagePullBackOff: reports image and registry error, recommends checking tag and imagePullSecrets", () => {
    const status: JSONObject = {
      phase: "Pending",
      containerStatuses: [
        {
          name: "web",
          image: "ghcr.io/acme/web:v9.9.9",
          restartCount: 0,
          state: {
            waiting: {
              reason: "ImagePullBackOff",
              message:
                'Back-off pulling image "ghcr.io/acme/web:v9.9.9": rpc error: code = NotFound desc = manifest unknown',
            },
          },
        },
      ],
    };

    const result: Array<KubernetesFailureExplanation> = explainPodFailures({
      podName: "web-5b6c7d8e9f-abcde",
      phase: "Pending",
      status,
    });

    const explanation: KubernetesFailureExplanation | undefined = findById(
      result,
      "image-pull-failure-web",
    );
    expect(explanation).toBeDefined();
    expect(explanation!.severity).toBe("critical");
    expect(evidenceValue(explanation!, "Image")).toBe(
      "ghcr.io/acme/web:v9.9.9",
    );
    expect(evidenceValue(explanation!, "Registry error")).toContain(
      "manifest unknown",
    );
    expect(explanation!.recommendation).toContain("imagePullSecret");
  });

  test.each(["ErrImagePull", "InvalidImageName"])(
    "image pull rule also matches waiting reason %s",
    (reason: string) => {
      const status: JSONObject = {
        containerStatuses: [
          {
            name: "web",
            state: { waiting: { reason: reason, message: "pull error" } },
          },
        ],
      };

      const result: Array<KubernetesFailureExplanation> = explainPodFailures({
        podName: "web-1",
        status,
      });

      expect(findById(result, "image-pull-failure-web")).toBeDefined();
    },
  );

  test("Unschedulable: uses the PodScheduled condition message verbatim and reports pod requests", () => {
    const spec: JSONObject = {
      containers: [
        {
          name: "api",
          resources: {
            requests: { cpu: "2", memory: "4Gi" },
            limits: { cpu: "4", memory: "8Gi" },
          },
        },
      ],
    };
    const status: JSONObject = {
      phase: "Pending",
      conditions: [
        {
          type: "PodScheduled",
          status: "False",
          reason: "Unschedulable",
          message:
            "0/12 nodes are available: 12 Insufficient cpu. preemption: 0/12 nodes are available.",
        },
      ],
    };

    const result: Array<KubernetesFailureExplanation> = explainPodFailures({
      podName: "api-big-0",
      phase: "Pending",
      spec,
      status,
    });

    const explanation: KubernetesFailureExplanation | undefined = findById(
      result,
      "pod-unschedulable",
    );
    expect(explanation).toBeDefined();
    expect(explanation!.severity).toBe("critical");
    expect(
      evidenceValue(explanation!, "Scheduler message (PodScheduled condition)"),
    ).toBe(
      "0/12 nodes are available: 12 Insufficient cpu. preemption: 0/12 nodes are available.",
    );
    expect(evidenceValue(explanation!, "Pod resource requests")).toBe(
      "api: cpu=2, memory=4Gi",
    );
    // Insufficient-resources message -> capacity/requests recommendation.
    expect(explanation!.recommendation.toLowerCase()).toContain("requests");
  });

  test("Unschedulable: falls back to FailedScheduling event and tailors recommendation for taints", () => {
    const result: Array<KubernetesFailureExplanation> = explainPodFailures({
      podName: "api-0",
      phase: "Pending",
      status: { phase: "Pending" },
      recentEvents: [
        {
          type: "Warning",
          reason: "FailedScheduling",
          message:
            "0/3 nodes are available: 3 node(s) had untolerated taint {dedicated: gpu}.",
        },
      ],
    });

    const explanation: KubernetesFailureExplanation | undefined = findById(
      result,
      "pod-unschedulable",
    );
    expect(explanation).toBeDefined();
    expect(
      evidenceValue(explanation!, "Scheduler message (FailedScheduling event)"),
    ).toContain("untolerated taint");
    expect(explanation!.recommendation).toContain("toleration");
  });

  test("Unschedulable: not reported when phase is not Pending", () => {
    const result: Array<KubernetesFailureExplanation> = explainPodFailures({
      podName: "api-0",
      phase: "Running",
      recentEvents: [
        {
          type: "Warning",
          reason: "FailedScheduling",
          message: "0/3 nodes are available: 3 Insufficient memory.",
        },
      ],
    });

    expect(findById(result, "pod-unschedulable")).toBeUndefined();
  });

  test("CreateContainerConfigError: surfaces the missing ConfigMap/Secret message", () => {
    const status: JSONObject = {
      phase: "Pending",
      containerStatuses: [
        {
          name: "app",
          state: {
            waiting: {
              reason: "CreateContainerConfigError",
              message: 'secret "db-credentials" not found',
            },
          },
        },
      ],
    };

    const result: Array<KubernetesFailureExplanation> = explainPodFailures({
      podName: "app-0",
      phase: "Pending",
      status,
    });

    const explanation: KubernetesFailureExplanation | undefined = findById(
      result,
      "container-config-error-app",
    );
    expect(explanation).toBeDefined();
    expect(explanation!.severity).toBe("critical");
    expect(evidenceValue(explanation!, "Error message")).toBe(
      'secret "db-credentials" not found',
    );
    expect(explanation!.recommendation).toContain("ConfigMap/Secret");
  });

  test("probe failures: liveness and readiness produce distinct explanations with counts", () => {
    const result: Array<KubernetesFailureExplanation> = explainPodFailures({
      podName: "api-0",
      phase: "Running",
      recentEvents: [
        {
          type: "Warning",
          reason: "Unhealthy",
          message:
            "Liveness probe failed: Get \"http://10.0.0.5:8080/healthz\": context deadline exceeded",
        },
        {
          type: "Warning",
          reason: "Unhealthy",
          message:
            "Liveness probe failed: Get \"http://10.0.0.5:8080/healthz\": context deadline exceeded",
        },
        {
          type: "Warning",
          reason: "Unhealthy",
          message: "Readiness probe failed: HTTP probe failed with statuscode: 503",
        },
        {
          type: "Normal",
          reason: "Pulled",
          message: "Successfully pulled image",
        },
      ],
    });

    const liveness: KubernetesFailureExplanation | undefined = findById(
      result,
      "liveness-probe-failing",
    );
    expect(liveness).toBeDefined();
    expect(liveness!.severity).toBe("warning");
    expect(evidenceValue(liveness!, "Recent failure count")).toBe("2");
    expect(evidenceValue(liveness!, "Probe failure message")).toContain(
      "Liveness probe failed",
    );
    // Liveness recommendation must explain the restart behavior.
    expect(liveness!.recommendation.toLowerCase()).toContain("restart");

    const readiness: KubernetesFailureExplanation | undefined = findById(
      result,
      "readiness-probe-failing",
    );
    expect(readiness).toBeDefined();
    expect(evidenceValue(readiness!, "Recent failure count")).toBe("1");
    // Readiness recommendation must explain endpoint removal.
    expect(readiness!.recommendation.toLowerCase()).toContain("endpoint");
  });

  test("stuck terminating: flagged only when deletionTimestamp is older than 10 minutes relative to now", () => {
    const now: Date = new Date("2026-07-02T12:00:00Z");

    const stuck: Array<KubernetesFailureExplanation> = explainPodFailures({
      podName: "zombie-0",
      status: {
        metadata: {
          deletionTimestamp: "2026-07-02T11:30:00Z",
          finalizers: ["example.com/cleanup-hook"],
        },
        phase: "Running",
      },
      now,
    });
    const explanation: KubernetesFailureExplanation | undefined = findById(
      stuck,
      "pod-stuck-terminating",
    );
    expect(explanation).toBeDefined();
    expect(explanation!.severity).toBe("warning");
    expect(evidenceValue(explanation!, "Deletion requested at")).toBe(
      "2026-07-02T11:30:00Z",
    );
    expect(evidenceValue(explanation!, "Finalizers")).toBe(
      "example.com/cleanup-hook",
    );
    expect(explanation!.recommendation).toContain("finalizer");

    // 5 minutes old -> normal graceful termination, not flagged.
    const recent: Array<KubernetesFailureExplanation> = explainPodFailures({
      podName: "zombie-0",
      status: {
        metadata: { deletionTimestamp: "2026-07-02T11:55:00Z" },
      },
      now,
    });
    expect(findById(recent, "pod-stuck-terminating")).toBeUndefined();

    // No "now" reference -> rule never fires (pure function, no wall clock).
    const noNow: Array<KubernetesFailureExplanation> = explainPodFailures({
      podName: "zombie-0",
      status: {
        metadata: { deletionTimestamp: "2020-01-01T00:00:00Z" },
      },
    });
    expect(findById(noNow, "pod-stuck-terminating")).toBeUndefined();
  });

  test("stuck terminating: deletionTimestamp at the top level of status also works", () => {
    const result: Array<KubernetesFailureExplanation> = explainPodFailures({
      podName: "zombie-1",
      status: { deletionTimestamp: "2026-07-02T11:00:00Z" },
      now: new Date("2026-07-02T12:00:00Z"),
    });
    expect(findById(result, "pod-stuck-terminating")).toBeDefined();
  });

  test("Failed phase: eviction gets a node-pressure recommendation with reason and message evidence", () => {
    const result: Array<KubernetesFailureExplanation> = explainPodFailures({
      podName: "batch-7",
      phase: "Failed",
      status: {
        phase: "Failed",
        reason: "Evicted",
        message:
          "The node was low on resource: memory. Threshold quantity: 100Mi, available: 52Mi.",
      },
    });

    const explanation: KubernetesFailureExplanation | undefined = findById(
      result,
      "pod-evicted",
    );
    expect(explanation).toBeDefined();
    expect(explanation!.severity).toBe("critical");
    expect(evidenceValue(explanation!, "Reason")).toBe("Evicted");
    expect(evidenceValue(explanation!, "Message")).toContain(
      "low on resource: memory",
    );
    expect(explanation!.recommendation.toLowerCase()).toContain("pressure");
  });

  test("Failed phase: non-eviction failures use the generic explanation", () => {
    const result: Array<KubernetesFailureExplanation> = explainPodFailures({
      podName: "batch-8",
      phase: "Failed",
      status: { phase: "Failed", reason: "DeadlineExceeded" },
    });

    const explanation: KubernetesFailureExplanation | undefined = findById(
      result,
      "pod-failed-phase",
    );
    expect(explanation).toBeDefined();
    expect(evidenceValue(explanation!, "Reason")).toBe("DeadlineExceeded");
  });

  test("output is ordered critical first", () => {
    const result: Array<KubernetesFailureExplanation> = explainPodFailures({
      podName: "api-0",
      phase: "Running",
      status: {
        containerStatuses: [
          {
            name: "api",
            restartCount: 3,
            state: { waiting: { reason: "CrashLoopBackOff" } },
          },
        ],
      },
      recentEvents: [
        {
          type: "Warning",
          reason: "Unhealthy",
          message: "Readiness probe failed: connection refused",
        },
      ],
    });

    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]!.severity).toBe("critical");
    const severityRank: Record<string, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };
    for (let i: number = 1; i < result.length; i++) {
      expect(severityRank[result[i]!.severity]).toBeGreaterThanOrEqual(
        severityRank[result[i - 1]!.severity]!,
      );
    }
  });

  test("healthy running pod returns []", () => {
    const result: Array<KubernetesFailureExplanation> = explainPodFailures({
      podName: "healthy-0",
      namespace: "prod",
      phase: "Running",
      spec: {
        containers: [
          {
            name: "app",
            image: "app:1.0.0",
            resources: {
              requests: { cpu: "100m", memory: "128Mi" },
              limits: { cpu: "1", memory: "512Mi" },
            },
          },
        ],
      },
      status: {
        phase: "Running",
        conditions: [
          { type: "PodScheduled", status: "True" },
          { type: "Ready", status: "True" },
        ],
        containerStatuses: [
          {
            name: "app",
            ready: true,
            restartCount: 0,
            state: { running: { startedAt: "2026-07-01T00:00:00Z" } },
            lastState: {},
          },
        ],
      },
      recentEvents: [],
      now: new Date("2026-07-02T12:00:00Z"),
    });

    expect(result).toEqual([]);
  });

  test("tolerates empty and missing data", () => {
    expect(explainPodFailures({ podName: "empty-0", status: {} })).toEqual([]);
    expect(explainPodFailures({ podName: "empty-1" })).toEqual([]);
    expect(
      explainPodFailures({
        podName: "empty-2",
        phase: "Pending",
        spec: {},
        status: {},
        recentEvents: [],
      }),
    ).toEqual([]);
  });

  test("tolerates malformed shapes (wrong types everywhere)", () => {
    const malformed: KubernetesPodFailureInput = {
      podName: "weird-0",
      phase: "Failed",
      spec: {
        containers: "not-an-array",
        initContainers: [42, null, { name: 7 }],
      } as unknown as JSONObject,
      status: {
        phase: "Failed",
        reason: 123,
        conditions: { type: "PodScheduled" },
        containerStatuses: [
          "nope",
          null,
          { name: "x", state: "running", lastState: 5, restartCount: "3" },
          { state: { waiting: { reason: 42, message: {} } } },
        ],
        initContainerStatuses: {},
        metadata: { deletionTimestamp: "not-a-date", finalizers: [1, 2] },
      } as unknown as JSONObject,
      now: new Date("2026-07-02T12:00:00Z"),
    };

    const runRule: () => Array<KubernetesFailureExplanation> = () => {
      return explainPodFailures(malformed);
    };
    expect(runRule).not.toThrow();

    // Only the generic Failed-phase rule has enough valid data to fire.
    const result: Array<KubernetesFailureExplanation> = runRule();
    expect(findById(result, "pod-failed-phase")).toBeDefined();
    expect(findById(result, "pod-stuck-terminating")).toBeUndefined();
  });
});

describe("explainNodeConditions", () => {
  test("NotReady (status False) is critical with reason and message evidence", () => {
    const result: Array<KubernetesFailureExplanation> = explainNodeConditions({
      nodeName: "node-a",
      status: {
        conditions: [
          {
            type: "Ready",
            status: "False",
            reason: "KubeletNotReady",
            message: "container runtime is down",
            lastTransitionTime: "2026-07-02T09:00:00Z",
          },
        ],
      },
    });

    const explanation: KubernetesFailureExplanation | undefined = findById(
      result,
      "node-not-ready",
    );
    expect(explanation).toBeDefined();
    expect(explanation!.severity).toBe("critical");
    expect(evidenceValue(explanation!, "Reason")).toBe("KubeletNotReady");
    expect(evidenceValue(explanation!, "Message")).toBe(
      "container runtime is down",
    );
    expect(explanation!.recommendation).toContain("kubelet");
  });

  test("NotReady (status Unknown) is also flagged", () => {
    const result: Array<KubernetesFailureExplanation> = explainNodeConditions({
      nodeName: "node-b",
      status: {
        conditions: [
          {
            type: "Ready",
            status: "Unknown",
            reason: "NodeStatusUnknown",
            message: "Kubelet stopped posting node status.",
          },
        ],
      },
    });

    const explanation: KubernetesFailureExplanation | undefined = findById(
      result,
      "node-not-ready",
    );
    expect(explanation).toBeDefined();
    expect(explanation!.summary.toLowerCase()).toContain("kubelet");
  });

  test.each([
    ["MemoryPressure", "node-memorypressure", "memory"],
    ["DiskPressure", "node-diskpressure", "disk"],
    ["PIDPressure", "node-pidpressure", "pid"],
  ])(
    "%s=True produces a warning with condition message evidence",
    (conditionType: string, expectedId: string, keyword: string) => {
      const result: Array<KubernetesFailureExplanation> =
        explainNodeConditions({
          nodeName: "node-c",
          status: {
            conditions: [
              { type: "Ready", status: "True" },
              {
                type: conditionType,
                status: "True",
                reason: `KubeletHasNo${conditionType}`,
                message: `kubelet has ${conditionType.toLowerCase()}`,
              },
            ],
          },
        });

      const explanation: KubernetesFailureExplanation | undefined = findById(
        result,
        expectedId,
      );
      expect(explanation).toBeDefined();
      expect(explanation!.severity).toBe("warning");
      expect(evidenceValue(explanation!, "Message")).toContain(
        conditionType.toLowerCase(),
      );
      expect(explanation!.recommendation.toLowerCase()).toContain(keyword);
    },
  );

  test("critical NotReady sorts before pressure warnings", () => {
    const result: Array<KubernetesFailureExplanation> = explainNodeConditions({
      nodeName: "node-d",
      status: {
        conditions: [
          { type: "MemoryPressure", status: "True", message: "low memory" },
          { type: "Ready", status: "False", message: "kubelet down" },
        ],
      },
    });

    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("node-not-ready");
    expect(result[1]!.id).toBe("node-memorypressure");
  });

  test("healthy node returns []", () => {
    const result: Array<KubernetesFailureExplanation> = explainNodeConditions({
      nodeName: "node-e",
      status: {
        conditions: [
          { type: "Ready", status: "True" },
          { type: "MemoryPressure", status: "False" },
          { type: "DiskPressure", status: "False" },
          { type: "PIDPressure", status: "False" },
        ],
      },
    });

    expect(result).toEqual([]);
  });

  test("tolerates missing and malformed status", () => {
    expect(explainNodeConditions({ nodeName: "node-f" })).toEqual([]);
    expect(explainNodeConditions({ nodeName: "node-g", status: {} })).toEqual(
      [],
    );
    expect(
      explainNodeConditions({
        nodeName: "node-h",
        status: {
          conditions: [null, "Ready", { type: 5, status: true }, {}],
        } as unknown as JSONObject,
      }),
    ).toEqual([]);
  });
});
