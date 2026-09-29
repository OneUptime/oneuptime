import {
  INVENTORIED_RESOURCE_TYPES,
  ParsedKubernetesContainerRow,
  extractContainersFromPod,
  extractInventoryResource,
  kindFromResourceType,
} from "../../../Types/Kubernetes/KubernetesInventoryExtractor";
import { KubernetesPodObject } from "../../../Types/Kubernetes/KubernetesObjectParser";
import { describe, expect, test } from "@jest/globals";

const lastSeenAt: Date = new Date("2026-07-31T12:00:00.000Z");

// Build a minimally-typed Pod object; only the fields the extractor reads.
const makePod: (input: unknown) => KubernetesPodObject = (
  input: unknown,
): KubernetesPodObject => {
  return input as KubernetesPodObject;
};

describe("kindFromResourceType", () => {
  test("maps every inventoried plural resource type to its PascalCase Kind", () => {
    expect(kindFromResourceType("pods")).toBe("Pod");
    expect(kindFromResourceType("nodes")).toBe("Node");
    expect(kindFromResourceType("namespaces")).toBe("Namespace");
    expect(kindFromResourceType("deployments")).toBe("Deployment");
    expect(kindFromResourceType("statefulsets")).toBe("StatefulSet");
    expect(kindFromResourceType("daemonsets")).toBe("DaemonSet");
    expect(kindFromResourceType("jobs")).toBe("Job");
    expect(kindFromResourceType("cronjobs")).toBe("CronJob");
    expect(kindFromResourceType("persistentvolumeclaims")).toBe(
      "PersistentVolumeClaim",
    );
    expect(kindFromResourceType("persistentvolumes")).toBe("PersistentVolume");
    expect(kindFromResourceType("horizontalpodautoscalers")).toBe(
      "HorizontalPodAutoscaler",
    );
    expect(kindFromResourceType("verticalpodautoscalers")).toBe(
      "VerticalPodAutoscaler",
    );
  });

  test("is case-insensitive on the resource type", () => {
    expect(kindFromResourceType("Pods")).toBe("Pod");
    expect(kindFromResourceType("CRONJOBS")).toBe("CronJob");
  });

  test("returns null for unrecognized resource types", () => {
    expect(kindFromResourceType("secrets")).toBeNull();
    expect(kindFromResourceType("")).toBeNull();
    expect(kindFromResourceType("configmaps")).toBeNull();
  });

  test("INVENTORIED_RESOURCE_TYPES only contains recognized types", () => {
    for (const resourceType of INVENTORIED_RESOURCE_TYPES) {
      expect(kindFromResourceType(resourceType)).not.toBeNull();
    }
    expect(INVENTORIED_RESOURCE_TYPES).toContain("pods");
    expect(INVENTORIED_RESOURCE_TYPES.length).toBe(12);
  });
});

describe("extractContainersFromPod", () => {
  test("returns one row per spec container, merging status by name", () => {
    const pod: KubernetesPodObject = makePod({
      metadata: { name: "web-abc", namespace: "prod" },
      spec: {
        containers: [
          {
            name: "app",
            image: "nginx:1.25",
            resources: { limits: { memory: "256Mi" } },
          },
          { name: "sidecar", image: "envoy:1.29" },
        ],
      },
      status: {
        containerStatuses: [
          {
            name: "app",
            state: "running",
            reason: "",
            ready: true,
            restartCount: 2,
          },
        ],
      },
    });

    const rows: Array<ParsedKubernetesContainerRow> = extractContainersFromPod({
      parsedPod: pod,
      lastSeenAt,
    });

    expect(rows.length).toBe(2);

    const appRow: ParsedKubernetesContainerRow = rows[0]!;
    expect(appRow.podName).toBe("web-abc");
    expect(appRow.podNamespaceKey).toBe("prod");
    expect(appRow.name).toBe("app");
    expect(appRow.image).toBe("nginx:1.25");
    expect(appRow.state).toBe("running");
    expect(appRow.isReady).toBe(true);
    expect(appRow.restartCount).toBe(2);
    expect(appRow.memoryLimitBytes).toBe(256 * 1024 * 1024);
    expect(appRow.lastSeenAt).toBe(lastSeenAt);

    // No status for the sidecar -> status-derived fields stay null.
    const sidecarRow: ParsedKubernetesContainerRow = rows[1]!;
    expect(sidecarRow.name).toBe("sidecar");
    expect(sidecarRow.image).toBe("envoy:1.29");
    expect(sidecarRow.state).toBeNull();
    expect(sidecarRow.isReady).toBeNull();
    expect(sidecarRow.restartCount).toBeNull();
    expect(sidecarRow.memoryLimitBytes).toBeNull();
  });

  test("parses binary and decimal memory units to bytes", () => {
    const expectations: Array<[string, number]> = [
      ["512Ki", 512 * 1024],
      ["1Gi", 1024 * 1024 * 1024],
      ["2Ti", 2 * 1024 * 1024 * 1024 * 1024],
      ["512M", 512 * 1000 * 1000],
      ["1G", 1000 * 1000 * 1000],
      ["2048", 2048],
    ];

    for (const [raw, expected] of expectations) {
      const rows: Array<ParsedKubernetesContainerRow> =
        extractContainersFromPod({
          parsedPod: makePod({
            metadata: { name: "p", namespace: "n" },
            spec: {
              containers: [
                { name: "c", resources: { limits: { memory: raw } } },
              ],
            },
          }),
          lastSeenAt,
        });
      expect(rows[0]!.memoryLimitBytes).toBe(expected);
    }
  });

  test("leaves memoryLimitBytes null for an unparseable memory string", () => {
    const rows: Array<ParsedKubernetesContainerRow> = extractContainersFromPod({
      parsedPod: makePod({
        metadata: { name: "p", namespace: "n" },
        spec: {
          containers: [
            { name: "c", resources: { limits: { memory: "not-a-size" } } },
          ],
        },
      }),
      lastSeenAt,
    });
    expect(rows[0]!.memoryLimitBytes).toBeNull();
  });

  test("falls back to the status image when the spec image is empty", () => {
    const rows: Array<ParsedKubernetesContainerRow> = extractContainersFromPod({
      parsedPod: makePod({
        metadata: { name: "p", namespace: "n" },
        spec: { containers: [{ name: "c", image: "" }] },
        status: {
          containerStatuses: [
            { name: "c", image: "resolved@sha256:abc", ready: false },
          ],
        },
      }),
      lastSeenAt,
    });
    expect(rows[0]!.image).toBe("resolved@sha256:abc");
    expect(rows[0]!.isReady).toBe(false);
  });

  test("skips containers with no name and pods with no metadata name", () => {
    const skippedUnnamed: Array<ParsedKubernetesContainerRow> =
      extractContainersFromPod({
        parsedPod: makePod({
          metadata: { name: "p", namespace: "n" },
          spec: { containers: [{ name: "" }, { name: "real" }] },
        }),
        lastSeenAt,
      });
    expect(
      skippedUnnamed.map((r: ParsedKubernetesContainerRow) => {
        return r.name;
      }),
    ).toEqual(["real"]);

    const noPodName: Array<ParsedKubernetesContainerRow> =
      extractContainersFromPod({
        parsedPod: makePod({ metadata: {}, spec: { containers: [] } }),
        lastSeenAt,
      });
    expect(noPodName).toEqual([]);
  });

  test("defaults the namespace key to empty string when absent", () => {
    const rows: Array<ParsedKubernetesContainerRow> = extractContainersFromPod({
      parsedPod: makePod({
        metadata: { name: "cluster-pod" },
        spec: { containers: [{ name: "c" }] },
      }),
      lastSeenAt,
    });
    expect(rows[0]!.podNamespaceKey).toBe("");
  });
});

describe("extractInventoryResource", () => {
  test("returns null for an unrecognized resource type", () => {
    expect(
      extractInventoryResource({
        resourceType: "secrets",
        logBody: "{}",
        lastSeenAt,
      }),
    ).toBeNull();
  });

  test("returns null when the log body cannot be parsed into an object", () => {
    expect(
      extractInventoryResource({
        resourceType: "pods",
        logBody: "this is not a k8s object",
        lastSeenAt,
      }),
    ).toBeNull();
  });
});
