import {
  extractContainersFromPod,
  ParsedKubernetesContainerRow,
} from "../../../Types/Kubernetes/KubernetesInventoryExtractor";
import { KubernetesPodObject } from "../../../Types/Kubernetes/KubernetesObjectParser";
import { describe, expect, test } from "@jest/globals";

/*
 * extractContainersFromPod used to iterate spec.containers ONLY, so a pod
 * stuck in `Init:CrashLoopBackOff` produced no KubernetesContainer row at
 * all — the failing container was invisible to the inventory, to
 * query_infrastructure, and to any detector filtering that table.
 */

const LAST_SEEN_AT: Date = new Date("2026-07-28T12:00:00.000Z");

function buildPod(data: {
  containers?: Array<{ name: string; image?: string }>;
  initContainers?: Array<{ name: string; image?: string }>;
  containerStatuses?: Array<Record<string, unknown>>;
  initContainerStatuses?: Array<Record<string, unknown>>;
}): KubernetesPodObject {
  const emptySpec: (entry: {
    name: string;
    image?: string;
  }) => unknown = (entry: { name: string; image?: string }): unknown => {
    return {
      name: entry.name,
      image: entry.image || "registry.example.com/app:1.0.0",
      imagePullPolicy: "IfNotPresent",
      command: [],
      args: [],
      env: [],
      ports: [],
      resources: { requests: {}, limits: { memory: "512Mi" } },
      volumeMounts: [],
      livenessProbe: null,
      readinessProbe: null,
      startupProbe: null,
    };
  };

  return {
    metadata: {
      name: "checkout-7d9f8b6c4-x2k9p",
      namespace: "production",
    },
    spec: {
      containers: (data.containers || []).map(emptySpec),
      initContainers: (data.initContainers || []).map(emptySpec),
    },
    status: {
      containerStatuses: data.containerStatuses || [],
      initContainerStatuses: data.initContainerStatuses || [],
    },
  } as unknown as KubernetesPodObject;
}

describe("extractContainersFromPod", () => {
  test("emits a row for an init container in CrashLoopBackOff", () => {
    const pod: KubernetesPodObject = buildPod({
      containers: [{ name: "checkout" }],
      initContainers: [{ name: "migrate" }],
      initContainerStatuses: [
        {
          name: "migrate",
          ready: false,
          restartCount: 6,
          state: "waiting",
          reason: "CrashLoopBackOff",
          message: "",
          lastState: {
            type: "terminated",
            reason: "Error",
            exitCode: 1,
            message: "",
            signal: null,
            startedAt: "",
            finishedAt: "2026-07-28T11:58:00Z",
          },
        },
      ],
    });

    const rows: Array<ParsedKubernetesContainerRow> = extractContainersFromPod({
      parsedPod: pod,
      lastSeenAt: LAST_SEEN_AT,
    });

    const init: ParsedKubernetesContainerRow | undefined = rows.find(
      (row: ParsedKubernetesContainerRow) => {
        return row.name === "migrate";
      },
    );

    expect(init).toBeDefined();
    expect(init?.isInitContainer).toBe(true);
    expect(init?.reason).toBe("CrashLoopBackOff");
    expect(init?.restartCount).toBe(6);
    expect(init?.lastTerminatedReason).toBe("Error");
    expect(init?.lastTerminatedExitCode).toBe(1);
    expect(init?.lastTerminatedFinishedAt).toBeInstanceOf(Date);
  });

  test("main containers are still emitted and not marked as init", () => {
    const pod: KubernetesPodObject = buildPod({
      containers: [{ name: "checkout" }],
      initContainers: [{ name: "migrate" }],
      containerStatuses: [
        {
          name: "checkout",
          ready: false,
          restartCount: 14,
          state: "waiting",
          reason: "CrashLoopBackOff",
          message: "back-off 5m0s restarting failed container",
          lastState: {
            type: "terminated",
            reason: "OOMKilled",
            exitCode: 137,
            message: "",
            signal: null,
            startedAt: "",
            finishedAt: "2026-07-28T11:59:00Z",
          },
        },
      ],
    });

    const rows: Array<ParsedKubernetesContainerRow> = extractContainersFromPod({
      parsedPod: pod,
      lastSeenAt: LAST_SEEN_AT,
    });

    const main: ParsedKubernetesContainerRow | undefined = rows.find(
      (row: ParsedKubernetesContainerRow) => {
        return row.name === "checkout";
      },
    );

    expect(rows).toHaveLength(2);
    expect(main?.isInitContainer).toBe(false);
    expect(main?.lastTerminatedReason).toBe("OOMKilled");
    expect(main?.lastTerminatedExitCode).toBe(137);
    expect(main?.waitingMessage).toBe(
      "back-off 5m0s restarting failed container",
    );
    // spec.resources.limits.memory = 512Mi
    expect(main?.memoryLimitBytes).toBe(536870912);
  });

  test("a container with no status still produces a row with null evidence", () => {
    const pod: KubernetesPodObject = buildPod({
      containers: [{ name: "checkout" }],
    });

    const rows: Array<ParsedKubernetesContainerRow> = extractContainersFromPod({
      parsedPod: pod,
      lastSeenAt: LAST_SEEN_AT,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.lastTerminatedReason).toBeNull();
    expect(rows[0]?.lastTerminatedExitCode).toBeNull();
    expect(rows[0]?.lastTerminatedFinishedAt).toBeNull();
    expect(rows[0]?.waitingMessage).toBeNull();
  });

  test("a clean exit 0 is preserved rather than collapsing to null", () => {
    const pod: KubernetesPodObject = buildPod({
      containers: [{ name: "job" }],
      containerStatuses: [
        {
          name: "job",
          ready: false,
          restartCount: 2,
          state: "waiting",
          reason: "CrashLoopBackOff",
          message: "",
          lastState: {
            type: "terminated",
            reason: "Completed",
            exitCode: 0,
            message: "",
            signal: null,
            startedAt: "",
            finishedAt: "",
          },
        },
      ],
    });

    const rows: Array<ParsedKubernetesContainerRow> = extractContainersFromPod({
      parsedPod: pod,
      lastSeenAt: LAST_SEEN_AT,
    });

    expect(rows[0]?.lastTerminatedExitCode).toBe(0);
    // Unparseable/absent finishedAt must be null, never an Invalid Date.
    expect(rows[0]?.lastTerminatedFinishedAt).toBeNull();
  });

  test("an over-long kubelet message is clamped to the column width", () => {
    const pod: KubernetesPodObject = buildPod({
      containers: [{ name: "checkout" }],
      containerStatuses: [
        {
          name: "checkout",
          ready: false,
          restartCount: 1,
          state: "waiting",
          reason: "CreateContainerConfigError",
          message: "x".repeat(900),
          lastState: null,
        },
      ],
    });

    const rows: Array<ParsedKubernetesContainerRow> = extractContainersFromPod({
      parsedPod: pod,
      lastSeenAt: LAST_SEEN_AT,
    });

    expect(rows[0]?.waitingMessage).toHaveLength(500);
  });
});
