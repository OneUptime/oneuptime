/**
 * @timezone UTC
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * "3 Failed" on a Kubernetes cluster's hero said nothing about which pods or
 * why (#9537). Each count of something wrong now opens the list of exactly
 * those pods or nodes, and these pin what that list says and reads:
 *
 *   - which rows a count lists, by the rules' own bucket for each pod;
 *   - each row's why (Kubernetes' reason, the exit code, how its last run
 *     ended, its message), which one it is (namespace, workload, node,
 *     container, restarts - each a step from its page), since when, and
 *     its newest warning Events;
 *   - the order: what breaks the cluster first, then what needs a look,
 *     then history, the newest first;
 *   - the hero's chips, read from the server's counts (or an older server's
 *     phases), each with what a press opens;
 *   - what OpenShift adds to a Degraded cluster's reasons;
 *   - the read itself: the inventory's list narrowed by a column, the
 *     Events in one more read that never breaks the list when it fails.
 */

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (): void => {},
      getQueryStringByName: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

const mockListCalls: Array<Record<string, unknown>> = [];
let mockListRows: Array<Record<string, unknown>> = [];
let mockListCount: number | null = null;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: Record<string, unknown>): Promise<unknown> => {
        mockListCalls.push(request);
        return Promise.resolve({
          data: mockListRows,
          count: mockListCount ?? mockListRows.length,
          skip: 0,
          limit: 200,
        });
      },
    },
  };
});

const mockEventReads: Array<Record<string, unknown>> = [];
let mockEventRows: Array<Record<string, unknown>> | Error = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesEventsApi",
  () => {
    return {
      __esModule: true,
      fetchKubernetesEvents: (request: Record<string, unknown>) => {
        mockEventReads.push(request);
        return mockEventRows instanceof Error
          ? Promise.reject(mockEventRows)
          : Promise.resolve({ rows: mockEventRows, hasMore: false });
      },
    };
  },
);

import Route from "../../../Types/API/Route";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  KubernetesHealthRow,
  KubernetesHealthSeverity,
} from "../../../Types/Kubernetes/KubernetesHealth";
import {
  OpenShiftClusterOperatorState,
  OpenShiftClusterVersionState,
} from "../../../Types/Kubernetes/OpenShiftObjectParser";
import {
  KubernetesEventRow,
  KubernetesEventsTypeFilter,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesEventsModel";
import { KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/KubernetesClusterMetricDescriptions";
import {
  ResourceAttentionEvent,
  ResourceAttentionFact,
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import { ResourceAttentionDialogRead } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttentionDialog";
import {
  KUBERNETES_PROBLEM_EVENTS_KEPT,
  KUBERNETES_PROBLEM_FACT_LABELS,
  KubernetesProblemKind,
  buildKubernetesProblemItems,
  getKubernetesProblemEvents,
  getKubernetesProblemObjectKind,
  selectKubernetesProblemPods,
  toKubernetesNodeProblemItem,
  toKubernetesPodProblemItem,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesProblemItems";
import {
  KUBERNETES_PROBLEM_EVENTS_DEFAULT_HOURS,
  KUBERNETES_PROBLEM_EVENTS_MAX_DAYS,
  KUBERNETES_PROBLEM_ROW_LIMIT,
  getKubernetesProblemEventsWindow,
  getKubernetesProblemModelQuery,
  loadKubernetesProblemItems,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesProblemLoader";
import {
  KubernetesPodStatusCountsRead,
  KubernetesStatusChip,
  countKubernetesPodsThatCannotRun,
  getKubernetesStatusChipValues,
  getKubernetesStatusChips,
  parseKubernetesPodStatusCounts,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesPodStatus";
import {
  OpenShiftClusterHealth,
  getOpenShiftAttentionItems,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesOpenShiftHealth";

const NOW: Date = new Date("2026-11-01T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const CLUSTER: ObjectID = new ObjectID("0193c0de-7777-4aaa-8bbb-000000000007");

function ago(minutes: number): string {
  return new Date(NOW.getTime() - minutes * MINUTE).toISOString();
}

function routeFor(part: {
  kind: string;
  name: string;
  namespace: string;
}): Route {
  return new Route(
    `/k8s/${part.kind}/${part.namespace ? `${part.namespace}/` : ""}${part.name}`,
  );
}

function condition(type: string, status: string, at: string): JSONObject {
  return {
    type: type,
    status: status,
    reason: "",
    message: "",
    lastTransitionTime: at,
  } as unknown as JSONObject;
}

function pod(
  name: string,
  fields: {
    namespace?: string | undefined;
    phase?: string;
    containers?: Array<Record<string, unknown>>;
    conditions?: Array<JSONObject>;
    owner?: [string, string] | undefined;
    labels?: Record<string, string>;
    reason?: string;
    message?: string;
    nodeName?: string;
    createdMinutesAgo?: number;
  } = {},
): KubernetesHealthRow {
  const phase: string = fields.phase ?? "Running";
  return {
    kind: "Pod",
    namespaceKey: fields.namespace ?? "shop",
    name: name,
    phase: phase,
    labels: (fields.labels ?? {}) as JSONObject,
    ownerReferences: {
      items: fields.owner
        ? [{ kind: fields.owner[0], name: fields.owner[1], uid: "o-1" }]
        : [],
    } as unknown as JSONObject,
    spec: {
      nodeName: fields.nodeName ?? "node-2",
      containers: [],
    } as unknown as JSONObject,
    status: {
      phase: phase,
      conditions: fields.conditions ?? [condition("Ready", "True", ago(600))],
      containerStatuses: fields.containers ?? [
        {
          name: "app",
          ready: true,
          restartCount: 0,
          state: "running",
          reason: "",
        },
      ],
      initContainerStatuses: [],
      ...(fields.reason ? { reason: fields.reason } : {}),
      ...(fields.message ? { message: fields.message } : {}),
    } as unknown as JSONObject,
    lastSeenAt: NOW,
    resourceCreationTimestamp: ago(fields.createdMinutesAgo ?? 600),
  };
}

function crashLooping(
  name: string,
  notReadyMinutesAgo: number,
  fields: { namespace?: string; restarts?: number; reason?: string } = {},
): KubernetesHealthRow {
  return pod(name, {
    namespace: fields.namespace,
    owner: ["ReplicaSet", "checkout-7d9f8b6c5"],
    labels: { "pod-template-hash": "7d9f8b6c5" },
    containers: [
      {
        name: "app",
        ready: false,
        restartCount: fields.restarts ?? 14,
        state: "waiting",
        reason: fields.reason ?? "CrashLoopBackOff",
        message: "back-off 5m0s restarting failed container=app",
        lastTerminationReason: "OOMKilled",
        lastTerminationExitCode: 137,
        lastTerminatedAt: ago(2),
      },
    ],
    conditions: [condition("Ready", "False", ago(notReadyMinutesAgo))],
  });
}

function failed(
  name: string,
  minutesAgo: number,
  owner?: [string, string],
): KubernetesHealthRow {
  return pod(name, {
    phase: "Failed",
    owner: owner,
    containers: [
      {
        name: "worker",
        ready: false,
        restartCount: 0,
        state: "terminated",
        reason: "Error",
        exitCode: 1,
        message: "panic: config not found",
      },
    ],
    conditions: [condition("Ready", "False", ago(minutesAgo))],
  });
}

function event(
  fields: Partial<KubernetesEventRow> & { reason: string; objectName: string },
): KubernetesEventRow {
  return {
    id: `${fields.reason}-${fields.objectName}-${fields.message || ""}`,
    type: "Warning",
    isWarning: true,
    message: "",
    objectKind: "Pod",
    objectFieldPath: "",
    namespace: "shop",
    source: "kubelet",
    sourceHost: "node-2",
    count: 1,
    firstSeenAt: null,
    lastSeenAt: new Date(NOW.getTime() - 60 * 1000),
    ...fields,
  };
}

function textOf(item: ResourceAttentionItem): Array<string> {
  return item.reasons.map((reason: ResourceAttentionText) => {
    let filled: string = reason.text;
    for (const [key, value] of Object.entries(reason.values || {})) {
      filled = filled.split(`{{${key}}}`).join(value);
    }
    return filled;
  });
}

describe("which pods a count lists", () => {
  const rows: Array<KubernetesHealthRow> = [
    pod("web-1"),
    crashLooping("checkout-1", 30),
    crashLooping("checkout-2", 20, { reason: "ImagePullBackOff" }),
    pod("queued", { phase: "Pending", containers: [], createdMinutesAgo: 20 }),
    pod("pulling", {
      phase: "Pending",
      containers: [
        { name: "app", ready: false, state: "waiting", reason: "ErrImagePull" },
      ],
    }),
    failed("batch-1", 5),
    pod("lost", { phase: "Unknown" }),
  ];

  function names(kind: KubernetesProblemKind, reason?: string): Array<string> {
    return selectKubernetesProblemPods(rows, {
      kind: kind,
      reason: reason,
    }).map((row: KubernetesHealthRow): string => {
      return row.name || "";
    });
  }

  test("a word for pods that cannot run lists exactly those pods", () => {
    expect(names(KubernetesProblemKind.CannotRun, "CrashLoopBackOff")).toEqual([
      "checkout-1",
    ]);
    expect(names(KubernetesProblemKind.CannotRun, "ImagePullBackOff")).toEqual([
      "checkout-2",
    ]);
  });

  test("no word lists every pod that cannot run", () => {
    expect(names(KubernetesProblemKind.CannotRun)).toEqual([
      "checkout-1",
      "checkout-2",
      "pulling",
    ]);
  });

  test("Pending leaves out a pending pod whose image will not pull: it is counted under its word", () => {
    expect(names(KubernetesProblemKind.Pending)).toEqual(["queued"]);
  });

  test("Failed and Unknown list their phase", () => {
    expect(names(KubernetesProblemKind.Failed)).toEqual(["batch-1"]);
    expect(names(KubernetesProblemKind.Unknown)).toEqual(["lost"]);
  });

  test("a node count reads nodes", () => {
    expect(
      getKubernetesProblemObjectKind({
        kind: KubernetesProblemKind.NodesNotReady,
      }),
    ).toBe("Node");
    expect(
      getKubernetesProblemObjectKind({ kind: KubernetesProblemKind.Failed }),
    ).toBe("Pod");
  });
});

describe("a pod's row", () => {
  test("says why in Kubernetes' words, which one it is, since when and its page", () => {
    const item: ResourceAttentionItem = toKubernetesPodProblemItem({
      row: crashLooping("checkout-7d9f8b6c5-x2k4q", 95),
      kind: KubernetesProblemKind.CannotRun,
      routeFor: routeFor,
    });

    expect(item.key).toBe("Pod:shop/checkout-7d9f8b6c5-x2k4q");
    expect(item.kind).toBe("Pod");
    expect(item.kindAsWritten).toBe(true);
    expect(item.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(textOf(item)).toEqual([
      "CrashLoopBackOff",
      "Last restart: OOMKilled",
    ]);
    expect(item.message).toBe("back-off 5m0s restarting failed container=app");
    expect(item.route?.toString()).toBe(
      "/k8s/Pod/shop/checkout-7d9f8b6c5-x2k4q",
    );

    expect(item.since?.template).toBe("Failing since {{time}}");
    expect(item.since?.at.toISOString()).toBe(ago(95));

    expect(item.facts).toEqual([
      {
        key: "namespace",
        label: KUBERNETES_PROBLEM_FACT_LABELS.namespace,
        value: "shop",
        route: routeFor({ kind: "Namespace", name: "shop", namespace: "" }),
      },
      {
        key: "workload",
        label: KUBERNETES_PROBLEM_FACT_LABELS.workload,
        valueKind: "Deployment",
        value: "checkout",
        route: routeFor({
          kind: "Deployment",
          name: "checkout",
          namespace: "shop",
        }),
      },
      {
        key: "node",
        label: KUBERNETES_PROBLEM_FACT_LABELS.node,
        value: "node-2",
        route: routeFor({ kind: "Node", name: "node-2", namespace: "" }),
      },
      {
        key: "container",
        label: KUBERNETES_PROBLEM_FACT_LABELS.container,
        value: "app",
        // Its own page, this pod's (#9732).
        route: routeFor({ kind: "Container", name: "app", namespace: "shop" }),
      },
      {
        key: "restarts",
        label: KUBERNETES_PROBLEM_FACT_LABELS.restarts,
        value: "14",
        isCount: true,
      },
    ]);
  });

  test("its container links with its pod: a container's page is named by it", () => {
    const asked: Array<{
      kind: string;
      name: string;
      namespace: string;
      pod?: string | undefined;
    }> = [];
    toKubernetesPodProblemItem({
      row: crashLooping("checkout-7d9f8b6c5-x2k4q", 14),
      kind: KubernetesProblemKind.CannotRun,
      routeFor: (part: {
        kind: string;
        name: string;
        namespace: string;
        pod?: string | undefined;
      }): Route => {
        asked.push(part);
        return routeFor(part);
      },
    });
    expect(
      asked.find((part: { kind: string }): boolean => {
        return part.kind === "Container";
      }),
    ).toEqual({
      kind: "Container",
      name: "app",
      namespace: "shop",
      pod: "checkout-7d9f8b6c5-x2k4q",
    });
  });

  test("a failed pod says its container's exit code and when it failed", () => {
    const item: ResourceAttentionItem = toKubernetesPodProblemItem({
      row: failed("batch-1", 5, ["Job", "nightly-29001000"]),
      kind: KubernetesProblemKind.Failed,
      routeFor: routeFor,
    });

    expect(textOf(item)).toEqual(["Failed", "Error, exit code 1"]);
    expect(item.message).toBe("panic: config not found");
    expect(item.since?.template).toBe("Failed {{time}}");
    expect(
      item.facts?.find((fact: ResourceAttentionFact): boolean => {
        return fact.key === "workload";
      }),
    ).toMatchObject({
      valueKind: "Job",
      value: "nightly-29001000",
    });
    expect(
      item.facts?.find((fact: ResourceAttentionFact): boolean => {
        return fact.key === "container";
      })?.value,
    ).toBe("worker");
    // A pod that never restarted says nothing about restarts.
    expect(
      item.facts?.some((fact: ResourceAttentionFact): boolean => {
        return fact.key === "restarts";
      }),
    ).toBe(false);
  });

  test("an evicted pod says why the node evicted it", () => {
    const item: ResourceAttentionItem = toKubernetesPodProblemItem({
      row: pod("api-1", {
        phase: "Failed",
        reason: "Evicted",
        message: "The node was low on resource: memory.",
        containers: [
          { name: "app", ready: false, state: "terminated", reason: "" },
        ],
        conditions: [condition("Ready", "False", ago(60 * 24 * 2))],
      }),
      kind: KubernetesProblemKind.Failed,
      routeFor: routeFor,
    });

    expect(textOf(item)).toEqual(["Evicted"]);
    expect(item.message).toBe("The node was low on resource: memory.");
  });

  test("a pod still starting has no reason yet, and reads as its status", () => {
    const item: ResourceAttentionItem = toKubernetesPodProblemItem({
      row: pod("new-1", {
        phase: "Pending",
        containers: [],
        conditions: [],
        createdMinutesAgo: 1,
      }),
      kind: KubernetesProblemKind.Pending,
      routeFor: routeFor,
    });

    expect(textOf(item)).toEqual(["Pending"]);
    expect(item.since?.template).toBe("Pending since {{time}}");
  });

  test("a pod nothing owns has no workload, and one with no node no node", () => {
    const item: ResourceAttentionItem = toKubernetesPodProblemItem({
      row: pod("bare", { phase: "Pending", containers: [], nodeName: "" }),
      kind: KubernetesProblemKind.Pending,
      routeFor: routeFor,
    });

    expect(
      item.facts?.map((fact: { key: string }): string => {
        return fact.key;
      }),
    ).toEqual(["namespace"]);
  });

  test("carries its newest warning Events, one per reason and message, the newest first", () => {
    const events: Array<KubernetesEventRow> = [
      event({
        reason: "BackOff",
        objectName: "checkout-1",
        message: "Back-off restarting failed container app",
        count: 12,
        lastSeenAt: new Date(NOW.getTime() - MINUTE),
      }),
      event({
        reason: "BackOff",
        objectName: "checkout-1",
        message: "Back-off restarting failed container app",
        count: 3,
        lastSeenAt: new Date(NOW.getTime() - 30 * MINUTE),
      }),
      event({
        reason: "OOMKilling",
        objectName: "checkout-1",
        message: "Memory cgroup out of memory: Killed process 4242",
        lastSeenAt: new Date(NOW.getTime() - 3 * MINUTE),
      }),
      event({
        reason: "Unhealthy",
        objectName: "checkout-1",
        message: "Readiness probe failed",
        lastSeenAt: new Date(NOW.getTime() - 4 * MINUTE),
      }),
      event({
        reason: "FailedMount",
        objectName: "checkout-1",
        message: "MountVolume.SetUp failed",
        lastSeenAt: new Date(NOW.getTime() - 5 * MINUTE),
      }),
      // Another namespace's pod of the same name, a Normal event, a node's.
      event({
        reason: "BackOff",
        objectName: "checkout-1",
        namespace: "payments",
      }),
      event({
        reason: "Pulled",
        objectName: "checkout-1",
        isWarning: false,
        type: "Normal",
      }),
      event({
        reason: "NodeNotReady",
        objectName: "checkout-1",
        objectKind: "Node",
        namespace: "",
      }),
    ];

    const item: ResourceAttentionItem = toKubernetesPodProblemItem({
      row: crashLooping("checkout-1", 30),
      kind: KubernetesProblemKind.CannotRun,
      routeFor: routeFor,
      events: events,
    });

    expect(item.events?.length).toBe(KUBERNETES_PROBLEM_EVENTS_KEPT);
    expect(
      item.events?.map((row: { reason: string; count: number }) => {
        return [row.reason, row.count];
      }),
    ).toEqual([
      ["BackOff", 12],
      ["OOMKilling", 1],
      ["Unhealthy", 1],
    ]);
  });
});

describe("a node's row", () => {
  test("says why it is not ready, since when, and Kubernetes' message", () => {
    const item: ResourceAttentionItem = toKubernetesNodeProblemItem({
      row: {
        kind: "Node",
        namespaceKey: "",
        name: "node-3",
        isReady: false,
        status: {
          conditions: [
            {
              type: "Ready",
              status: "Unknown",
              reason: "NodeStatusUnknown",
              message: "Kubelet stopped posting node status.",
              lastTransitionTime: ago(33),
            },
          ],
        } as unknown as JSONObject,
        spec: {} as JSONObject,
        lastSeenAt: NOW,
      },
      routeFor: routeFor,
      events: [
        event({
          reason: "NodeNotReady",
          objectKind: "Node",
          objectName: "node-3",
          namespace: "",
          message: "Node node-3 status is now: NodeNotReady",
        }),
      ],
    });

    expect(item.key).toBe("Node:node-3");
    expect(item.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(textOf(item)).toEqual(["Unreachable"]);
    expect(item.message).toBe("Kubelet stopped posting node status.");
    expect(item.since?.template).toBe("Not ready since {{time}}");
    expect(item.since?.at.toISOString()).toBe(ago(33));
    expect(item.route?.toString()).toBe("/k8s/Node/node-3");
    expect(item.events?.[0]?.reason).toBe("NodeNotReady");
  });
});

describe("the list, most urgent first", () => {
  test("what breaks the cluster, then what needs a look, then history; the newest first in each", () => {
    const items: Array<ResourceAttentionItem> = buildKubernetesProblemItems({
      rows: [
        failed("old-failure", 60 * 24 * 3),
        failed("fresh-failure", 4),
        failed("job-failure", 2, ["Job", "nightly-1"]),
        failed("recent-failure", 30),
        failed("no-time", 1),
      ].map((row: KubernetesHealthRow, index: number) => {
        // The last one says no time.
        return index === 4
          ? {
              ...row,
              status: {
                ...(row.status as JSONObject),
                conditions: [],
              } as JSONObject,
            }
          : row;
      }),
      query: { kind: KubernetesProblemKind.Failed },
      routeFor: routeFor,
    });

    expect(
      items.map((item: ResourceAttentionItem): string => {
        return item.name;
      }),
    ).toEqual([
      // In the last hour, not a Job's: each marks the cluster Degraded.
      "fresh-failure",
      "recent-failure",
      // History: a Job's pod, an old failure, then one that says no time.
      "job-failure",
      "old-failure",
      "no-time",
    ]);
  });

  test("a crash loop comes before a pod that is only pending", () => {
    const items: Array<ResourceAttentionItem> = buildKubernetesProblemItems({
      rows: [
        pod("queued", {
          phase: "Pending",
          containers: [],
          createdMinutesAgo: 20,
        }),
        crashLooping("checkout-1", 30),
      ],
      query: { kind: KubernetesProblemKind.CannotRun },
      routeFor: routeFor,
    });

    expect(items[0]?.name).toBe("checkout-1");
    expect(items[0]?.severity).toBe(ResourceAttentionSeverity.Critical);
  });
});

describe("the warning Events a row keeps", () => {
  test("none when Kubernetes reported none", () => {
    expect(
      getKubernetesProblemEvents([], {
        kind: "Pod",
        name: "a",
        namespace: "shop",
      }),
    ).toEqual([]);
  });

  test("an Event that says no time still counts, after those that do", () => {
    const events: Array<ResourceAttentionEvent> = getKubernetesProblemEvents(
      [
        event({
          reason: "FailedScheduling",
          objectName: "a",
          lastSeenAt: null,
        }),
        event({ reason: "BackOff", objectName: "a" }),
      ],
      { kind: "Pod", name: "a", namespace: "shop" },
    );
    expect(
      events.map((row: ResourceAttentionEvent): string => {
        return row.reason;
      }),
    ).toEqual(["BackOff", "FailedScheduling"]);
    expect(events[1]?.lastSeenAt).toBeUndefined();
  });
});

describe("the hero's counts", () => {
  test("are read from the server's podStatusCounts", () => {
    expect(
      parseKubernetesPodStatusCounts({
        podStatusCounts: {
          running: 69,
          pending: 1,
          failed: 3,
          succeeded: 4,
          unknown: 1,
          cannotRun: [
            { reason: "CrashLoopBackOff", count: 2 },
            { reason: "", count: 1 },
            { reason: "ImagePullBackOff", count: 0 },
            { count: "x" },
            null,
          ],
        },
        podPhaseCounts: { running: 71, pending: 2, failed: 3, succeeded: 4 },
      } as unknown as JSONObject),
    ).toEqual({
      running: 69,
      pending: 1,
      failed: 3,
      succeeded: 4,
      unknown: 1,
      cannotRun: [
        { reason: "CrashLoopBackOff", count: 2 },
        { reason: "", count: 1 },
      ],
    });
  });

  test("fall back to an older server's phases, with nothing counted as unable to run", () => {
    expect(
      parseKubernetesPodStatusCounts({
        podPhaseCounts: {
          running: 71,
          pending: 0,
          failed: 3,
          succeeded: 2,
          unknown: 5,
        },
      } as unknown as JSONObject),
    ).toEqual({
      running: 71,
      pending: 0,
      failed: 3,
      succeeded: 2,
      unknown: 0,
      cannotRun: [],
    });
  });

  test("read a broken or missing answer as nothing", () => {
    const nothing: KubernetesPodStatusCountsRead = {
      running: 0,
      pending: 0,
      failed: 0,
      succeeded: 0,
      unknown: 0,
      cannotRun: [],
    };
    expect(parseKubernetesPodStatusCounts(null)).toEqual(nothing);
    expect(
      parseKubernetesPodStatusCounts({
        podStatusCounts: { running: "7", failed: -1, cannotRun: "nope" },
      } as unknown as JSONObject),
    ).toEqual(nothing);
  });

  test("count every pod that cannot run, whatever the word", () => {
    expect(
      countKubernetesPodsThatCannotRun({
        running: 1,
        pending: 0,
        failed: 0,
        succeeded: 0,
        unknown: 0,
        cannotRun: [
          { reason: "CrashLoopBackOff", count: 2 },
          { reason: "Init:Error", count: 1 },
        ],
      }),
    ).toBe(3);
  });
});

describe("the hero's chips", () => {
  const chips: Array<KubernetesStatusChip> = getKubernetesStatusChips({
    pods: {
      running: 69,
      pending: 1,
      failed: 3,
      succeeded: 4,
      unknown: 1,
      cannotRun: [
        { reason: "CrashLoopBackOff", count: 2 },
        { reason: "", count: 1 },
      ],
    },
    nodesNotReady: 1,
  });

  test("Running first, then each problem, the nodes last; nothing for Succeeded", () => {
    expect(
      chips.map((chip: KubernetesStatusChip): [string, number] => {
        return [chip.name, chip.count];
      }),
    ).toEqual([
      ["Running", 69],
      ["CrashLoopBackOff", 2],
      ["Can't run", 1],
      ["Pending", 1],
      ["Failed", 3],
      ["Unknown", 1],
      ["Nodes Not Ready", 1],
    ]);
  });

  test("Running is fine, explained by its (i), and opens nothing", () => {
    const running: KubernetesStatusChip = chips[0]!;
    expect(running.tone).toBe("positive");
    expect(running.problem).toBeUndefined();
    expect(running.description).toBe(
      KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS.podsRunning,
    );
  });

  test("every other chip opens exactly its pods or nodes, with words of its own", () => {
    const crash: KubernetesStatusChip = chips[1]!;
    expect(crash.tone).toBe("danger");
    expect(crash.reasonAsWritten).toBe("CrashLoopBackOff");
    expect(crash.word).toBeUndefined();
    expect(getKubernetesStatusChipValues(crash)).toEqual({
      reason: "CrashLoopBackOff",
    });
    expect(crash.problem?.query).toEqual({
      kind: KubernetesProblemKind.CannotRun,
      reason: "CrashLoopBackOff",
    });
    expect(crash.problem?.title).toEqual({
      one: "{{count}} pod in {{reason}}",
      other: "{{count}} pods in {{reason}}",
    });
    expect(crash.problem?.description).toBe(
      KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS.podsCannotRun,
    );

    // No word read: every pod that cannot run, in words of its own.
    const unnamed: KubernetesStatusChip = chips[2]!;
    expect(unnamed.word).toBe("Can't run");
    expect(unnamed.problem?.query).toEqual({
      kind: KubernetesProblemKind.CannotRun,
      reason: undefined,
    });

    expect(chips[3]?.problem?.query.kind).toBe(KubernetesProblemKind.Pending);
    expect(chips[3]?.tone).toBe("warning");
    expect(chips[3]?.problem?.description).toBe(
      KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS.podsPending,
    );
    expect(chips[4]?.problem?.query.kind).toBe(KubernetesProblemKind.Failed);
    expect(chips[4]?.problem?.title).toEqual({
      one: "{{count}} failed pod",
      other: "{{count}} failed pods",
    });
    expect(chips[5]?.problem?.query.kind).toBe(KubernetesProblemKind.Unknown);
    expect(chips[6]?.problem?.query.kind).toBe(
      KubernetesProblemKind.NodesNotReady,
    );
    expect(chips[6]?.plural).toEqual({
      one: "{{count}} Node Not Ready",
      other: "{{count}} Nodes Not Ready",
    });
    expect(chips[6]?.problem?.hint).toBe("Show which nodes and why");
    expect(chips[4]?.problem?.hint).toBe("Show which pods and why");
  });

  test("a quiet cluster draws no chip", () => {
    expect(
      getKubernetesStatusChips({
        pods: parseKubernetesPodStatusCounts(null),
        nodesNotReady: 0,
      }),
    ).toEqual([]);
  });
});

describe("what OpenShift adds to a Degraded cluster's reasons", () => {
  function health(
    fields: Partial<OpenShiftClusterHealth>,
  ): OpenShiftClusterHealth {
    return {
      version: "4.16.3",
      desiredVersion: "4.16.3",
      channel: "stable-4.16",
      updateState: OpenShiftClusterVersionState.Available,
      updateReason: "",
      updateMessage: "",
      updateStartedAt: "",
      availableUpdateCount: 0,
      operators: [],
      operatorsToReview: [],
      counts: {
        total: 0,
        healthy: 0,
        available: 0,
        progressing: 0,
        degraded: 0,
        unavailable: 0,
        unknown: 0,
      },
      health: "Healthy",
      ...fields,
    };
  }

  function operator(
    name: string,
    state: OpenShiftClusterOperatorState,
  ): OpenShiftClusterHealth["operatorsToReview"][number] {
    return {
      name: name,
      state: state,
      available: "",
      progressing: "",
      degraded: "",
      version: "4.16.3",
      reason:
        state === OpenShiftClusterOperatorState.Degraded
          ? "RouteHealthDegraded"
          : "",
      message: `${name} says so`,
      since: ago(42),
    };
  }

  test("an operator that is down is critical, one degraded is to look at, one rolling out is neither", () => {
    const items: Array<ResourceAttentionItem> = getOpenShiftAttentionItems(
      health({
        operatorsToReview: [
          operator("ingress", OpenShiftClusterOperatorState.Degraded),
          operator("etcd", OpenShiftClusterOperatorState.Unavailable),
          operator("dns", OpenShiftClusterOperatorState.Progressing),
          operator("console", OpenShiftClusterOperatorState.Unknown),
        ],
      }),
    );

    expect(
      items.map((item: ResourceAttentionItem) => {
        return [item.name, item.severity, textOf(item)];
      }),
    ).toEqual([
      ["etcd", ResourceAttentionSeverity.Critical, ["Unavailable"]],
      [
        "ingress",
        ResourceAttentionSeverity.Warning,
        ["Degraded", "RouteHealthDegraded"],
      ],
    ]);
    expect(items[0]?.kind).toBe("ClusterOperator");
    expect(items[0]?.message).toBe("etcd says so");
    expect(items[0]?.since?.template).toBe("Unavailable since {{time}}");
    expect(items[1]?.since?.template).toBe("Degraded since {{time}}");
    expect(items[0]?.route).toBeUndefined();
  });

  test("an update that fails needs a look, with why", () => {
    const items: Array<ResourceAttentionItem> = getOpenShiftAttentionItems(
      health({
        desiredVersion: "4.16.4",
        updateState: OpenShiftClusterVersionState.Failing,
        updateReason: "ClusterOperatorDegraded",
        updateMessage: "Cluster operator ingress is degraded",
      }),
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("ClusterVersion");
    expect(items[0]?.name).toBe("4.16.4");
    expect(textOf(items[0]!)).toEqual([
      "Update failing",
      "ClusterOperatorDegraded",
    ]);
    expect(items[0]?.message).toBe("Cluster operator ingress is degraded");
  });

  test("nothing for a healthy platform, or no OpenShift at all", () => {
    expect(getOpenShiftAttentionItems(health({}))).toEqual([]);
    expect(getOpenShiftAttentionItems(null)).toEqual([]);
  });
});

describe("the read a count's dialog makes", () => {
  beforeEach(() => {
    mockListCalls.length = 0;
    mockListRows = [];
    mockListCount = null;
    mockEventReads.length = 0;
    mockEventRows = [];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("narrows the inventory's list by the column that matches the count", () => {
    expect(
      getKubernetesProblemModelQuery({
        clusterId: CLUSTER,
        query: {
          kind: KubernetesProblemKind.CannotRun,
          reason: "CrashLoopBackOff",
        },
      }),
    ).toEqual({
      kubernetesClusterId: CLUSTER,
      kind: "Pod",
      healthSeverity: KubernetesHealthSeverity.Critical,
    });
    expect(
      getKubernetesProblemModelQuery({
        clusterId: CLUSTER,
        query: { kind: KubernetesProblemKind.Pending },
      }),
    ).toEqual({ kubernetesClusterId: CLUSTER, kind: "Pod", phase: "Pending" });
    expect(
      getKubernetesProblemModelQuery({
        clusterId: CLUSTER,
        query: { kind: KubernetesProblemKind.Failed },
      }),
    ).toEqual({ kubernetesClusterId: CLUSTER, kind: "Pod", phase: "Failed" });
    expect(
      getKubernetesProblemModelQuery({
        clusterId: CLUSTER,
        query: { kind: KubernetesProblemKind.Unknown },
      }),
    ).toEqual({ kubernetesClusterId: CLUSTER, kind: "Pod", phase: "Unknown" });
    expect(
      getKubernetesProblemModelQuery({
        clusterId: CLUSTER,
        query: { kind: KubernetesProblemKind.NodesNotReady },
      }),
    ).toEqual({ kubernetesClusterId: CLUSTER, kind: "Node", isReady: false });
  });

  test("reads Events from an hour before the oldest began failing, a week back at most, a day when none says when", () => {
    const window: InBetween<Date> = getKubernetesProblemEventsWindow({
      sinceTimes: [NOW.getTime() - 30 * MINUTE, NOW.getTime() - 90 * MINUTE],
      now: NOW,
    });
    expect(window.startValue.toISOString()).toBe(ago(150));
    expect(window.endValue.toISOString()).toBe(NOW.toISOString());

    const capped: InBetween<Date> = getKubernetesProblemEventsWindow({
      sinceTimes: [NOW.getTime() - 30 * 24 * 60 * MINUTE],
      now: NOW,
    });
    expect(capped.startValue.toISOString()).toBe(
      ago(KUBERNETES_PROBLEM_EVENTS_MAX_DAYS * 24 * 60),
    );

    const unknown: InBetween<Date> = getKubernetesProblemEventsWindow({
      sinceTimes: [],
      now: NOW,
    });
    expect(unknown.startValue.toISOString()).toBe(
      ago(KUBERNETES_PROBLEM_EVENTS_DEFAULT_HOURS * 60),
    );
  });

  test("lists the count's pods, the newest first, with their warning Events, in one more read", async () => {
    mockListRows = [
      crashLooping("checkout-1", 30),
      crashLooping("checkout-2", 10, { reason: "ImagePullBackOff" }),
      crashLooping("checkout-3", 5),
    ] as unknown as Array<Record<string, unknown>>;
    mockEventRows = [
      event({
        reason: "BackOff",
        objectName: "checkout-3",
        message: "Back-off restarting",
      }),
    ] as unknown as Array<Record<string, unknown>>;

    const read: ResourceAttentionDialogRead = await loadKubernetesProblemItems({
      clusterId: CLUSTER,
      clusterIdentifier: "production-us-east-1",
      query: {
        kind: KubernetesProblemKind.CannotRun,
        reason: "CrashLoopBackOff",
      },
    });

    expect(mockListCalls).toHaveLength(1);
    expect(mockListCalls[0]?.["query"]).toEqual({
      kubernetesClusterId: CLUSTER,
      kind: "Pod",
      healthSeverity: KubernetesHealthSeverity.Critical,
    });
    expect(mockListCalls[0]?.["limit"]).toBe(KUBERNETES_PROBLEM_ROW_LIMIT);
    expect(
      Object.keys(mockListCalls[0]?.["select"] as Record<string, unknown>),
    ).toEqual(
      expect.arrayContaining([
        "status",
        "spec",
        "ownerReferences",
        "labels",
        "phase",
      ]),
    );

    // Only the count's word, the newest failure first.
    expect(
      read.items.map((item: ResourceAttentionItem): string => {
        return item.name;
      }),
    ).toEqual(["checkout-3", "checkout-1"]);
    expect(read.isTruncated).toBe(false);

    expect(mockEventReads).toHaveLength(1);
    expect(mockEventReads[0]?.["clusterIdentifier"]).toBe(
      "production-us-east-1",
    );
    expect(mockEventReads[0]?.["scope"]).toEqual({
      kind: "objects",
      objectKind: "Pod",
      objectNames: ["checkout-1", "checkout-2", "checkout-3"].filter(
        (name: string): boolean => {
          return name !== "checkout-2";
        },
      ),
    });
    expect(mockEventReads[0]?.["filters"]).toEqual({
      type: KubernetesEventsTypeFilter.Warning,
    });
    expect(read.items[0]?.events?.[0]?.reason).toBe("BackOff");
  });

  test("still lists the pods, with why from their status, when their Events cannot be read", async () => {
    mockListRows = [failed("batch-1", 5)] as unknown as Array<
      Record<string, unknown>
    >;
    mockEventRows = new Error("ClickHouse is down");

    const read: ResourceAttentionDialogRead = await loadKubernetesProblemItems({
      clusterId: CLUSTER,
      clusterIdentifier: "production-us-east-1",
      query: { kind: KubernetesProblemKind.Failed },
    });

    expect(read.items).toHaveLength(1);
    expect(textOf(read.items[0]!)).toEqual(["Failed", "Error, exit code 1"]);
    expect(read.items[0]?.events).toEqual([]);
  });

  test("says when more matched than one read lists", async () => {
    mockListRows = [failed("batch-1", 5)] as unknown as Array<
      Record<string, unknown>
    >;
    mockListCount = 450;

    const read: ResourceAttentionDialogRead = await loadKubernetesProblemItems({
      clusterId: CLUSTER,
      clusterIdentifier: "production-us-east-1",
      query: { kind: KubernetesProblemKind.Failed },
    });

    expect(read.isTruncated).toBe(true);
  });

  test("asks for no Events when nothing matched, or the cluster has no name to find them by", async () => {
    const empty: ResourceAttentionDialogRead = await loadKubernetesProblemItems(
      {
        clusterId: CLUSTER,
        clusterIdentifier: "production-us-east-1",
        query: { kind: KubernetesProblemKind.Pending },
      },
    );
    expect(empty.items).toEqual([]);

    mockListRows = [failed("batch-1", 5)] as unknown as Array<
      Record<string, unknown>
    >;
    await loadKubernetesProblemItems({
      clusterId: CLUSTER,
      clusterIdentifier: "",
      query: { kind: KubernetesProblemKind.Failed },
    });

    expect(mockEventReads).toHaveLength(0);
  });

  test("lists the nodes that are not ready, reading node Events", async () => {
    mockListRows = [
      {
        kind: "Node",
        namespaceKey: "",
        name: "node-3",
        isReady: false,
        status: {
          conditions: [
            {
              type: "Ready",
              status: "False",
              reason: "KubeletNotReady",
              message: "container runtime network not ready",
              lastTransitionTime: ago(12),
            },
          ],
        },
        spec: {},
        lastSeenAt: NOW,
      },
    ];

    const read: ResourceAttentionDialogRead = await loadKubernetesProblemItems({
      clusterId: CLUSTER,
      clusterIdentifier: "production-us-east-1",
      query: { kind: KubernetesProblemKind.NodesNotReady },
    });

    expect(
      read.items.map((item: ResourceAttentionItem) => {
        return item.name;
      }),
    ).toEqual(["node-3"]);
    expect(textOf(read.items[0]!)).toEqual(["Not ready"]);
    expect(read.items[0]?.message).toBe("container runtime network not ready");
    expect(
      (mockEventReads[0]?.["scope"] as Record<string, unknown>)["objectKind"],
    ).toBe("Node");
  });
});
