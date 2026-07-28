import {
  KubernetesContainerStatus,
  KubernetesPodObject,
  parsePodObject,
} from "../../../Types/Kubernetes/KubernetesObjectParser";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The OTLP encoding these tests exercise is the shape the k8sobjects receiver
 * actually ships: every Kubernetes object arrives as a nested kvlistValue, and
 * a container's `state` / `lastState` is a single-key map whose KEY is the
 * state name and whose value carries the detail.
 *
 * These tests exist because the exit code is the load-bearing field for
 * crash-loop diagnosis and it was silently discarded before — and because the
 * refactor that started capturing it also had to leave the pre-existing
 * `state` / `reason` extraction (which the Kubernetes dashboard and the
 * inventory extractor both depend on) byte-for-byte unchanged.
 */

function str(value: string): JSONObject {
  return { stringValue: value };
}

function int(value: number): JSONObject {
  return { intValue: value };
}

function kvlist(entries: Record<string, JSONObject>): JSONObject {
  return {
    kvlistValue: {
      values: Object.entries(entries).map(
        ([key, value]: [string, JSONObject]) => {
          return { key, value };
        },
      ),
    },
  };
}

function arr(items: Array<JSONObject>): JSONObject {
  return { arrayValue: { values: items } };
}

// The kvlist a parser entry point receives (already unwrapped one level).
function objectKvList(entries: Record<string, JSONObject>): JSONObject {
  return {
    values: Object.entries(entries).map(
      ([key, value]: [string, JSONObject]) => {
        return { key, value };
      },
    ),
  };
}

/**
 * A pod whose container is in CrashLoopBackOff after being OOMKilled — the
 * exact payload shape the agent ships for the canonical case.
 */
function buildCrashLoopingPod(): JSONObject {
  return objectKvList({
    metadata: kvlist({
      name: str("checkout-7d9f8b6c4-x2k9p"),
      namespace: str("production"),
      uid: str("2f1c9c7e-1111-2222-3333-444455556666"),
    }),
    spec: kvlist({
      nodeName: str("ip-10-0-1-23"),
      containers: arr([
        kvlist({
          name: str("checkout"),
          image: str("registry.example.com/checkout:1.42.0"),
          imagePullPolicy: str("IfNotPresent"),
          resources: kvlist({
            limits: kvlist({ memory: str("512Mi"), cpu: str("500m") }),
            requests: kvlist({ memory: str("256Mi") }),
          }),
          livenessProbe: kvlist({
            initialDelaySeconds: int(3),
            periodSeconds: int(10),
            failureThreshold: int(3),
            httpGet: kvlist({ path: str("/healthz"), port: int(8080) }),
          }),
        }),
      ]),
    }),
    status: kvlist({
      phase: str("Running"),
      containerStatuses: arr([
        kvlist({
          name: str("checkout"),
          ready: str("false"),
          restartCount: int(14),
          image: str("registry.example.com/checkout:1.42.0"),
          state: kvlist({
            waiting: kvlist({
              reason: str("CrashLoopBackOff"),
              message: str("back-off 5m0s restarting failed container"),
            }),
          }),
          lastState: kvlist({
            terminated: kvlist({
              reason: str("OOMKilled"),
              exitCode: int(137),
              startedAt: str("2026-07-28T10:12:00Z"),
              finishedAt: str("2026-07-28T10:14:02Z"),
            }),
          }),
        }),
      ]),
    }),
  });
}

describe("parsePodObject — container state", () => {
  test("captures the previous incarnation's terminated reason and exit code", () => {
    const pod: KubernetesPodObject | null = parsePodObject(
      buildCrashLoopingPod(),
    );

    expect(pod).not.toBeNull();

    const status: KubernetesContainerStatus | undefined =
      pod?.status.containerStatuses[0];

    expect(status?.lastState).not.toBeNull();
    expect(status?.lastState?.type).toBe("terminated");
    expect(status?.lastState?.reason).toBe("OOMKilled");
    // The whole point: an intValue survives as a real number, not "137".
    expect(status?.lastState?.exitCode).toBe(137);
    expect(status?.lastState?.finishedAt).toBe("2026-07-28T10:14:02Z");
  });

  test("keeps the pre-existing state and reason extraction unchanged", () => {
    const pod: KubernetesPodObject | null = parsePodObject(
      buildCrashLoopingPod(),
    );

    const status: KubernetesContainerStatus | undefined =
      pod?.status.containerStatuses[0];

    // These two feed the dashboard and the inventory extractor.
    expect(status?.state).toBe("waiting");
    expect(status?.reason).toBe("CrashLoopBackOff");
    expect(status?.name).toBe("checkout");
    expect(status?.ready).toBe(false);
    expect(status?.restartCount).toBe(14);
  });

  test("captures the current state's kubelet message", () => {
    const pod: KubernetesPodObject | null = parsePodObject(
      buildCrashLoopingPod(),
    );

    expect(pod?.status.containerStatuses[0]?.message).toBe(
      "back-off 5m0s restarting failed container",
    );
  });

  test("lastState is null when the container has never restarted", () => {
    const pod: JSONObject = objectKvList({
      metadata: kvlist({ name: str("fresh-pod"), namespace: str("default") }),
      status: kvlist({
        containerStatuses: arr([
          kvlist({
            name: str("app"),
            ready: str("true"),
            restartCount: int(0),
            state: kvlist({ running: kvlist({ startedAt: str("now") }) }),
          }),
        ]),
      }),
    });

    const parsed: KubernetesPodObject | null = parsePodObject(pod);
    const status: KubernetesContainerStatus | undefined =
      parsed?.status.containerStatuses[0];

    expect(status?.state).toBe("running");
    expect(status?.lastState).toBeNull();
  });

  test("a missing exit code stays null rather than becoming 0", () => {
    const pod: JSONObject = objectKvList({
      metadata: kvlist({ name: str("p"), namespace: str("default") }),
      status: kvlist({
        containerStatuses: arr([
          kvlist({
            name: str("app"),
            restartCount: int(1),
            state: kvlist({ waiting: kvlist({ reason: str("Whatever") }) }),
            lastState: kvlist({
              terminated: kvlist({ reason: str("Error") }),
            }),
          }),
        ]),
      }),
    });

    const parsed: KubernetesPodObject | null = parsePodObject(pod);

    expect(parsed?.status.containerStatuses[0]?.lastState?.exitCode).toBeNull();
  });

  test("an init container in CrashLoopBackOff is parsed too", () => {
    const pod: JSONObject = objectKvList({
      metadata: kvlist({ name: str("p"), namespace: str("default") }),
      status: kvlist({
        initContainerStatuses: arr([
          kvlist({
            name: str("migrate"),
            ready: str("false"),
            restartCount: int(6),
            state: kvlist({
              waiting: kvlist({ reason: str("CrashLoopBackOff") }),
            }),
            lastState: kvlist({
              terminated: kvlist({ reason: str("Error"), exitCode: int(1) }),
            }),
          }),
        ]),
      }),
    });

    const parsed: KubernetesPodObject | null = parsePodObject(pod);
    const init: KubernetesContainerStatus | undefined =
      parsed?.status.initContainerStatuses[0];

    expect(init?.name).toBe("migrate");
    expect(init?.reason).toBe("CrashLoopBackOff");
    expect(init?.lastState?.exitCode).toBe(1);
  });
});

describe("parsePodObject — container spec", () => {
  test("captures probe timings and the http target", () => {
    const pod: KubernetesPodObject | null = parsePodObject(
      buildCrashLoopingPod(),
    );

    const probe: KubernetesPodObject["spec"]["containers"][0]["livenessProbe"] =
      pod?.spec.containers[0]?.livenessProbe ?? null;

    expect(probe?.type).toBe("httpGet");
    expect(probe?.initialDelaySeconds).toBe(3);
    expect(probe?.periodSeconds).toBe(10);
    expect(probe?.failureThreshold).toBe(3);
    expect(probe?.httpPath).toBe("/healthz");
    expect(probe?.httpPort).toBe("8080");
  });

  test("keeps resource limits, which the OOM headline quotes", () => {
    const pod: KubernetesPodObject | null = parsePodObject(
      buildCrashLoopingPod(),
    );

    expect(pod?.spec.containers[0]?.resources.limits["memory"]).toBe("512Mi");
    expect(pod?.spec.containers[0]?.imagePullPolicy).toBe("IfNotPresent");
  });

  test("probes are null when the container declares none", () => {
    const pod: JSONObject = objectKvList({
      metadata: kvlist({ name: str("p"), namespace: str("default") }),
      spec: kvlist({
        containers: arr([kvlist({ name: str("app"), image: str("nginx") })]),
      }),
    });

    const parsed: KubernetesPodObject | null = parsePodObject(pod);

    expect(parsed?.spec.containers[0]?.livenessProbe).toBeNull();
    expect(parsed?.spec.containers[0]?.readinessProbe).toBeNull();
    expect(parsed?.spec.containers[0]?.startupProbe).toBeNull();
  });
});
