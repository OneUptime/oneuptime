import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../Types/JSON";
import {
  KubernetesHealthRow,
  KubernetesHealthSeverity,
} from "../../Types/Kubernetes/KubernetesHealth";
import {
  KubernetesPartReadAnswer,
  readKubernetesNeedsAttention,
  readKubernetesPart,
} from "./KubernetesPartReads";

/*
 * The browser fixtures answer a Kubernetes page's reads with these, so they
 * must give what KubernetesResourceService gives. The cases are the ones
 * KubernetesResourceHealthPostgres pins on a migrated database, on the same
 * rows: a page's pods are its own - never a longer-named neighbour's, never
 * another namespace's - and what needs attention folds pods into their
 * workloads.
 */

const SEEN: Date = new Date("2026-11-01T12:00:00.000Z");

function ago(minutes: number): Date {
  return new Date(SEEN.getTime() - minutes * 60 * 1000);
}

function owners(...items: Array<[string, string]>): JSONObject {
  return {
    items: items.map(([kind, name]: [string, string]) => {
      return { kind: kind, name: name, uid: `${kind}-${name}` };
    }),
  } as unknown as JSONObject;
}

function resource(fields: KubernetesHealthRow): KubernetesHealthRow {
  return {
    namespaceKey: "payments",
    ownerReferences: owners(),
    spec: {} as unknown as JSONObject,
    status: {} as unknown as JSONObject,
    lastSeenAt: SEEN,
    resourceCreationTimestamp: ago(600),
    ...fields,
  };
}

function pod(
  name: string,
  fields: {
    namespace?: string;
    owner?: [string, string];
    labels?: Record<string, string>;
    nodeName?: string;
    crashLooping?: boolean;
    seenMinutesAgo?: number;
  } = {},
): KubernetesHealthRow {
  return resource({
    kind: "Pod",
    name: name,
    namespaceKey: fields.namespace ?? "payments",
    phase: "Running",
    labels: (fields.labels || {}) as unknown as JSONObject,
    ownerReferences: fields.owner ? owners(fields.owner) : owners(),
    spec: { nodeName: fields.nodeName ?? "node-1" } as unknown as JSONObject,
    status: {
      phase: "Running",
      conditions: [
        {
          type: "Ready",
          status: fields.crashLooping ? "False" : "True",
          lastTransitionTime: ago(600).toISOString(),
        },
      ],
      containerStatuses: [
        fields.crashLooping
          ? {
              name: "app",
              ready: false,
              restartCount: 12,
              state: "waiting",
              reason: "CrashLoopBackOff",
            }
          : { name: "app", ready: true, restartCount: 0, state: "running" },
      ],
      initContainerStatuses: [],
    } as unknown as JSONObject,
    lastSeenAt: ago(fields.seenMinutesAgo ?? 0),
  });
}

function deployment(
  name: string,
  replicas: number,
  namespace: string = "payments",
): KubernetesHealthRow {
  return resource({
    kind: "Deployment",
    name: name,
    namespaceKey: namespace,
    spec: { replicas: replicas } as unknown as JSONObject,
    status: {
      replicas: replicas,
      readyReplicas: replicas,
      availableReplicas: replicas,
      conditions: [
        {
          type: "Progressing",
          status: "True",
          reason: "NewReplicaSetAvailable",
        },
      ],
    } as unknown as JSONObject,
  });
}

const ROWS: Array<KubernetesHealthRow> = [
  deployment("checkout", 3),
  deployment("checkout-v2", 3),
  deployment("checkout", 3, "shop"),
  pod("checkout-7d9f8b6c5-aaaaa", {
    owner: ["ReplicaSet", "checkout-7d9f8b6c5"],
    labels: { "pod-template-hash": "7d9f8b6c5" },
    nodeName: "node-1",
  }),
  pod("checkout-v2-5c8d7f9b4-bbbbb", {
    owner: ["ReplicaSet", "checkout-v2-5c8d7f9b4"],
    labels: { "pod-template-hash": "5c8d7f9b4" },
    nodeName: "node-2",
  }),
  pod("checkout-7d9f8b6c5-shop1", {
    namespace: "shop",
    owner: ["ReplicaSet", "checkout-7d9f8b6c5"],
    nodeName: "node-1",
    seenMinutesAgo: 1,
  }),
  resource({
    kind: "StatefulSet",
    name: "postgres",
    spec: { replicas: 2 } as unknown as JSONObject,
    status: { readyReplicas: 2 } as unknown as JSONObject,
  }),
  pod("postgres-0", { owner: ["StatefulSet", "postgres"], nodeName: "node-2" }),
  pod("postgres-1", {
    owner: ["StatefulSet", "postgres"],
    nodeName: "node-1",
    seenMinutesAgo: 2,
  }),
  pod("postgres-backup-0", {
    owner: ["StatefulSet", "postgres-backup"],
    nodeName: "node-1",
    seenMinutesAgo: 3,
  }),
  resource({ kind: "Node", name: "node-1", namespaceKey: "", isReady: true }),
  resource({
    kind: "CronJob",
    name: "invoice-run",
    spec: { schedule: "0 2 * * *" } as unknown as JSONObject,
  }),
  resource({
    kind: "Job",
    name: "invoice-run-28845600",
    ownerReferences: owners(["CronJob", "invoice-run"]),
    resourceCreationTimestamp: ago(60),
  }),
  resource({
    kind: "Job",
    name: "invoice-run-v2-28845600",
    ownerReferences: owners(["CronJob", "invoice-run-v2"]),
  }),
  pod("invoice-run-28845600-q8xz2", {
    owner: ["Job", "invoice-run-28845600"],
    nodeName: "node-2",
  }),
  pod("invoice-run-v2-28845600-zz9", {
    owner: ["Job", "invoice-run-v2-28845600"],
    nodeName: "node-2",
  }),
];

function names(rows: Array<KubernetesHealthRow>): Array<string> {
  return rows.map((row: KubernetesHealthRow): string => {
    return row.name || "";
  });
}

describe("an object's own page, as the server reads it", () => {
  test("a Deployment's pods are its ReplicaSets' - never a longer-named neighbour's or another namespace's", () => {
    const payments: KubernetesPartReadAnswer<KubernetesHealthRow> =
      readKubernetesPart(ROWS, {
        kind: "Deployment",
        name: "checkout",
        namespace: "payments",
      });
    expect(payments.part?.namespaceKey).toBe("payments");
    expect(names(payments.pods)).toEqual(["checkout-7d9f8b6c5-aaaaa"]);
    expect(payments.jobs).toEqual([]);
    expect(payments.isPodsTruncated).toBe(false);

    expect(
      names(
        readKubernetesPart(ROWS, {
          kind: "Deployment",
          name: "checkout",
          namespace: "shop",
        }).pods,
      ),
    ).toEqual(["checkout-7d9f8b6c5-shop1"]);
  });

  test("without a namespace it is always the first of that name, by namespace", () => {
    expect(
      readKubernetesPart(ROWS, { kind: "Deployment", name: "checkout" }).part
        ?.namespaceKey,
    ).toBe("payments");
  });

  test("a StatefulSet owns its pods by name", () => {
    expect(
      names(
        readKubernetesPart(ROWS, {
          kind: "StatefulSet",
          name: "postgres",
          namespace: "payments",
        }).pods,
      ),
    ).toEqual(["postgres-0", "postgres-1"]);
  });

  test("a node's pods are the ones scheduled on it, in every namespace, the newest report first", () => {
    const node: KubernetesPartReadAnswer<KubernetesHealthRow> =
      readKubernetesPart(ROWS, { kind: "Node", name: "node-1" });
    expect(node.part?.kind).toBe("Node");
    expect(names(node.pods)).toEqual([
      "checkout-7d9f8b6c5-aaaaa",
      "checkout-7d9f8b6c5-shop1",
      "postgres-1",
      "postgres-backup-0",
    ]);
  });

  test("a CronJob's page reads its Jobs and their pods, not another CronJob's", () => {
    const cronJob: KubernetesPartReadAnswer<KubernetesHealthRow> =
      readKubernetesPart(ROWS, {
        kind: "CronJob",
        name: "invoice-run",
        namespace: "payments",
      });
    expect(names(cronJob.jobs)).toEqual(["invoice-run-28845600"]);
    expect(names(cronJob.pods)).toEqual(["invoice-run-28845600-q8xz2"]);
  });

  test("an object that is not in the inventory reads as none, with nothing it runs", () => {
    expect(
      readKubernetesPart(ROWS, {
        kind: "Deployment",
        name: "missing",
        namespace: "payments",
      }),
    ).toEqual({ part: null, pods: [], jobs: [], isPodsTruncated: false });
  });

  test("the longer-named neighbour's page has its own pods, and only those", () => {
    expect(
      names(
        readKubernetesPart(ROWS, {
          kind: "Deployment",
          name: "checkout-v2",
          namespace: "payments",
        }).pods,
      ),
    ).toEqual(["checkout-v2-5c8d7f9b4-bbbbb"]);
  });

  test("a kind that runs no pods reads only itself", () => {
    const rows: Array<KubernetesHealthRow> = [
      ...ROWS,
      resource({ kind: "Namespace", name: "payments", namespaceKey: "" }),
    ];
    const namespace: KubernetesPartReadAnswer<KubernetesHealthRow> =
      readKubernetesPart(rows, { kind: "Namespace", name: "payments" });
    expect(namespace.part?.name).toBe("payments");
    expect(namespace.pods).toEqual([]);
  });
});

describe("what needs attention, as the server reads it", () => {
  test("folds the crash-looping pods into their Deployment, read from the namespace's workloads", () => {
    const read: ReturnType<typeof readKubernetesNeedsAttention> =
      readKubernetesNeedsAttention([
        ...ROWS,
        pod("checkout-7d9f8b6c5-crash1", {
          owner: ["ReplicaSet", "checkout-7d9f8b6c5"],
          crashLooping: true,
        }),
        pod("checkout-7d9f8b6c5-crash2", {
          owner: ["ReplicaSet", "checkout-7d9f8b6c5"],
          crashLooping: true,
        }),
      ]);

    expect(read.isTruncated).toBe(false);
    expect(read.findings).toHaveLength(1);
    expect(read.findings[0]).toEqual(
      expect.objectContaining({
        kind: "Deployment",
        namespace: "payments",
        name: "checkout",
        severity: KubernetesHealthSeverity.Critical,
        podCount: 2,
      }),
    );
  });

  test("a calm cluster has nothing to say", () => {
    expect(readKubernetesNeedsAttention(ROWS)).toEqual({
      findings: [],
      isTruncated: false,
    });
  });
});
