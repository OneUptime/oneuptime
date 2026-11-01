import { beforeAll, describe, expect, test } from "@jest/globals";
import Route from "Common/Types/API/Route";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  KUBERNETES_REASON_AS_WRITTEN,
  KubernetesHealthSeverity,
} from "Common/Types/Kubernetes/KubernetesHealth";
import {
  KubernetesAlertTemplate,
  getAllKubernetesAlertTemplates,
} from "Common/Types/Monitor/KubernetesAlertTemplates";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import type { ResourcePartStatus } from "../../FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartTypes";
import type { OpenIssueRecord } from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyIssues";
import type {
  KubernetesPartRead,
  KubernetesPartRow,
  KubernetesPodFacts,
} from "../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesPartFacts";

type AttentionModule =
  typeof import("../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAttention");
type FactsModule =
  typeof import("../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesPartFacts");
type RoutesModule =
  typeof import("../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesPartRoutes");
type UtilsModule =
  typeof import("../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesResourceUtils");

let KUBERNETES_CURRENT_PART_LABELS: AttentionModule["KUBERNETES_CURRENT_PART_LABELS"];
let NAMESPACED_KUBERNETES_KINDS: AttentionModule["NAMESPACED_KUBERNETES_KINDS"];
let getKubernetesKindChip: AttentionModule["getKubernetesKindChip"];
let parseKubernetesNeedsAttention: AttentionModule["parseKubernetesNeedsAttention"];
let toKubernetesAttentionItem: AttentionModule["toKubernetesAttentionItem"];
let KUBERNETES_PART_ALERT_TEMPLATE_IDS: FactsModule["KUBERNETES_PART_ALERT_TEMPLATE_IDS"];
let KUBERNETES_PART_COPY: FactsModule["KUBERNETES_PART_COPY"];
let assessKubernetesPart: FactsModule["assessKubernetesPart"];
let getKubernetesPartAttentionItems: FactsModule["getKubernetesPartAttentionItems"];
let getKubernetesPodFacts: FactsModule["getKubernetesPodFacts"];
let isKubernetesIssueAbout: FactsModule["isKubernetesIssueAbout"];
let parseKubernetesPartRead: FactsModule["parseKubernetesPartRead"];
let sortKubernetesPodFacts: FactsModule["sortKubernetesPodFacts"];
let toResourcePartStatus: FactsModule["toResourcePartStatus"];
let KUBERNETES_NAMESPACE_QUERY_PARAM: RoutesModule["KUBERNETES_NAMESPACE_QUERY_PARAM"];
let KUBERNETES_PART_PAGES: RoutesModule["KUBERNETES_PART_PAGES"];
let getKubernetesPartRoute: RoutesModule["getKubernetesPartRoute"];
let kubernetesHealthTextInEnglish: UtilsModule["kubernetesHealthTextInEnglish"];

/*
 * Common/UI/Config reads `window` the moment it loads, and the routes pull
 * it in through RouteMap, so the browser stub exists before the deferred
 * imports run (as AIInsightExplorerLinks.test.ts does).
 */
beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  ({
    KUBERNETES_CURRENT_PART_LABELS,
    NAMESPACED_KUBERNETES_KINDS,
    getKubernetesKindChip,
    parseKubernetesNeedsAttention,
    toKubernetesAttentionItem,
  } = await import(
    "../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesAttention"
  ));
  ({
    KUBERNETES_PART_ALERT_TEMPLATE_IDS,
    KUBERNETES_PART_COPY,
    assessKubernetesPart,
    getKubernetesPartAttentionItems,
    getKubernetesPodFacts,
    isKubernetesIssueAbout,
    parseKubernetesPartRead,
    sortKubernetesPodFacts,
    toResourcePartStatus,
  } = await import(
    "../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesPartFacts"
  ));
  ({
    KUBERNETES_NAMESPACE_QUERY_PARAM,
    KUBERNETES_PART_PAGES,
    getKubernetesPartRoute,
  } = await import(
    "../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesPartRoutes"
  ));
  ({ kubernetesHealthTextInEnglish } = await import(
    "../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesResourceUtils"
  ));
});

/*
 * A Kubernetes object's own page - a pod's, a workload's, a node's - reads
 * the object with what it runs (POST /kubernetes-resource/part/:clusterId)
 * and says, by the cluster's own rules (KubernetesHealth), what its status
 * is, what about it and its pods needs attention, which open incidents and
 * alerts are about it, and each of its pods' facts. Every link to a
 * namespaced object carries its namespace, so two `checkout` Deployments in
 * two namespaces never open each other's page.
 */

const CLUSTER_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-0000000000c1",
);
const SEEN: string = "2026-11-01T12:00:00.000Z";

function ago(minutes: number): string {
  return new Date(new Date(SEEN).getTime() - minutes * 60 * 1000).toISOString();
}

function owners(kind: string, name: string): JSONObject {
  return {
    items: [{ kind: kind, name: name, uid: `${kind}-${name}` }],
  } as unknown as JSONObject;
}

function container(fields: {
  ready: boolean;
  restartCount?: number;
  state?: string;
  reason?: string;
}): JSONObject {
  return {
    name: "app",
    ready: fields.ready,
    restartCount: fields.restartCount ?? 0,
    state: fields.state ?? "running",
    reason: fields.reason ?? "",
    image: "registry.example.com/app:1.4.2",
  } as unknown as JSONObject;
}

function pod(fields: {
  name: string;
  namespace?: string;
  owner?: [string, string];
  node?: string;
  containers?: Array<JSONObject>;
  ready?: boolean;
  id?: string;
}): KubernetesPartRow {
  return {
    _id: fields.id,
    kind: "Pod",
    namespaceKey: fields.namespace ?? "shop",
    name: fields.name,
    phase: "Running",
    ownerReferences: fields.owner
      ? owners(fields.owner[0], fields.owner[1])
      : ({ items: [] } as unknown as JSONObject),
    spec: { nodeName: fields.node ?? "node-a" } as unknown as JSONObject,
    status: {
      phase: "Running",
      conditions: [
        {
          type: "Ready",
          status: fields.ready === false ? "False" : "True",
          lastTransitionTime: ago(600),
        },
      ],
      containerStatuses: fields.containers ?? [container({ ready: true })],
      initContainerStatuses: [],
    } as unknown as JSONObject,
    lastSeenAt: SEEN,
    resourceCreationTimestamp: ago(600),
  };
}

function deployment(fields: {
  name?: string;
  namespace?: string;
  replicas: number;
  available: number;
}): KubernetesPartRow {
  return {
    _id: "dddddddd-0000-4000-8000-000000000001",
    kind: "Deployment",
    namespaceKey: fields.namespace ?? "shop",
    name: fields.name ?? "checkout",
    spec: { replicas: fields.replicas } as unknown as JSONObject,
    status: {
      replicas: fields.replicas,
      readyReplicas: fields.available,
      availableReplicas: fields.available,
      conditions: [
        {
          type: "Progressing",
          status: "True",
          reason: "NewReplicaSetAvailable",
          lastTransitionTime: ago(600),
        },
      ],
    } as unknown as JSONObject,
    lastSeenAt: SEEN,
    resourceCreationTimestamp: ago(6000),
  };
}

function job(fields: {
  name: string;
  failed?: boolean;
  createdMinutesAgo: number;
}): KubernetesPartRow {
  return {
    kind: "Job",
    namespaceKey: "shop",
    name: fields.name,
    ownerReferences: owners("CronJob", "nightly"),
    spec: { completions: 1 } as unknown as JSONObject,
    status: fields.failed
      ? ({
          failed: 1,
          conditions: [
            {
              type: "Failed",
              status: "True",
              reason: "BackoffLimitExceeded",
              message: "Job has reached the specified backoff limit",
              lastTransitionTime: ago(fields.createdMinutesAgo - 1),
            },
          ],
        } as unknown as JSONObject)
      : ({
          succeeded: 1,
          conditions: [{ type: "Complete", status: "True" }],
        } as unknown as JSONObject),
    lastSeenAt: SEEN,
    resourceCreationTimestamp: ago(fields.createdMinutesAgo),
  };
}

const CRASH_LOOPING: Array<JSONObject> = [
  container({
    ready: false,
    restartCount: 14,
    state: "waiting",
    reason: "CrashLoopBackOff",
  }),
];

function routeFor(part: {
  kind: string;
  name: string;
  namespace: string;
}): Route | undefined {
  return getKubernetesPartRoute(CLUSTER_ID, part);
}

function routeOf(item: ResourceAttentionItem): string {
  return item.route ? item.route.toString() : "";
}

describe("a link to a Kubernetes object's page", () => {
  test("names a namespaced object's namespace, so a same-named object elsewhere never opens", () => {
    const shop: string = routeFor({
      kind: "Deployment",
      name: "checkout",
      namespace: "shop",
    })!.toString();
    const payments: string = routeFor({
      kind: "Deployment",
      name: "checkout",
      namespace: "payments",
    })!.toString();

    expect(shop).toContain("/deployments/checkout");
    expect(shop).toContain(`${KUBERNETES_NAMESPACE_QUERY_PARAM}=shop`);
    expect(payments).toContain(`${KUBERNETES_NAMESPACE_QUERY_PARAM}=payments`);
    expect(shop).not.toBe(payments);
  });

  test("a node, a namespace and a volume live in no namespace, and say none", () => {
    for (const kind of ["Node", "Namespace", "PersistentVolume"]) {
      expect(NAMESPACED_KUBERNETES_KINDS.has(kind)).toBe(false);
      expect(
        routeFor({ kind: kind, name: "node-a", namespace: "shop" })!.toString(),
      ).not.toContain(`${KUBERNETES_NAMESPACE_QUERY_PARAM}=`);
    }
  });

  test("a kind with no page, or no name, has no link", () => {
    expect(
      routeFor({ kind: "ReplicaSet", name: "web-7d9f", namespace: "shop" }),
    ).toBeUndefined();
    expect(
      routeFor({ kind: "Deployment", name: "", namespace: "shop" }),
    ).toBeUndefined();
  });

  test("every namespaced kind with a page reads its namespace", () => {
    for (const kind of Object.keys(KUBERNETES_PART_PAGES)) {
      if (!NAMESPACED_KUBERNETES_KINDS.has(kind)) {
        continue;
      }
      expect({
        kind,
        link: routeFor({ kind: kind, name: "web", namespace: "shop" })!
          .toString()
          .includes(`${KUBERNETES_NAMESPACE_QUERY_PARAM}=shop`),
      }).toEqual({ kind, link: true });
    }
  });
});

describe("what needs attention on a workload's page", () => {
  const read: KubernetesPartRead = {
    part: deployment({ replicas: 3, available: 2 }),
    pods: [
      pod({
        name: "checkout-7d9f8b6c5-a1",
        owner: ["ReplicaSet", "checkout-7d9f8b6c5"],
      }),
      pod({
        name: "checkout-7d9f8b6c5-b2",
        owner: ["ReplicaSet", "checkout-7d9f8b6c5"],
        containers: CRASH_LOOPING,
        ready: false,
      }),
    ],
    jobs: [],
    isPodsTruncated: false,
  };

  test("its own row first, then each pod that needs a look, a step from its own page", () => {
    const items: Array<ResourceAttentionItem> = getKubernetesPartAttentionItems(
      { read: read, routeFor: routeFor },
    );

    expect(
      items.map((item: ResourceAttentionItem): [string, string, string] => {
        return [item.kind, item.name, item.severity];
      }),
    ).toEqual([
      ["Deployment", "checkout", ResourceAttentionSeverity.Warning],
      ["Pod", "checkout-7d9f8b6c5-b2", ResourceAttentionSeverity.Critical],
    ]);

    // The Deployment's shortfall, in the product's words.
    expect(items[0]!.reasons).toEqual([
      {
        text: "{{available}} of {{desired}} available",
        values: { available: "2", desired: "3" },
      },
    ]);
    // The pod's reason as Kubernetes wrote it, drawn as written.
    expect(items[1]!.reasons).toEqual([
      {
        text: KUBERNETES_REASON_AS_WRITTEN,
        values: { reason: "CrashLoopBackOff" },
      },
    ]);
    expect(routeOf(items[1]!)).toContain("/pods/checkout-7d9f8b6c5-b2");
    expect(routeOf(items[1]!)).toContain(
      `${KUBERNETES_NAMESPACE_QUERY_PARAM}=shop`,
    );
    // Kinds read as kubectl writes them, in every language.
    expect(
      items.every((item: ResourceAttentionItem) => {
        return item.kindAsWritten === true;
      }),
    ).toBe(true);
  });

  test("the hero's pill is the part's own verdict, with the card's words", () => {
    const status: ResourcePartStatus = toResourcePartStatus(
      assessKubernetesPart(read)!,
    );

    expect(status).toEqual(
      expect.objectContaining({
        label: "{{available}} of {{desired}} available",
        values: { available: "2", desired: "3" },
        tone: "warning",
      }),
    );
    expect(status.description).toContain("latest inventory");
  });

  test("a workload with nothing to say has an empty list, and a healthy pill", () => {
    const calm: KubernetesPartRead = {
      ...read,
      part: deployment({ replicas: 3, available: 3 }),
      pods: [read.pods[0]!],
    };

    expect(
      getKubernetesPartAttentionItems({ read: calm, routeFor: routeFor }),
    ).toEqual([]);
    expect(toResourcePartStatus(assessKubernetesPart(calm)!).tone).toBe(
      "positive",
    );
  });

  test("before the read arrives there is nothing to say", () => {
    expect(
      getKubernetesPartAttentionItems({
        read: { part: null, pods: [], jobs: [], isPodsTruncated: false },
        routeFor: routeFor,
      }),
    ).toEqual([]);
    expect(assessKubernetesPart({ part: null, jobs: [] })).toBeNull();
  });
});

describe("what needs attention on a CronJob's page", () => {
  const cronJob: KubernetesPartRow = {
    kind: "CronJob",
    namespaceKey: "shop",
    name: "nightly",
    spec: { schedule: "0 2 * * *", suspend: false } as unknown as JSONObject,
    status: {} as unknown as JSONObject,
    lastSeenAt: SEEN,
    resourceCreationTimestamp: ago(60 * 24 * 30),
  };

  test("its newest run failed: the CronJob says so, with that run and its pods, never an older run", () => {
    const read: KubernetesPartRead = {
      part: cronJob,
      jobs: [
        job({ name: "nightly-29001", failed: true, createdMinutesAgo: 2880 }),
        job({ name: "nightly-29002", failed: true, createdMinutesAgo: 60 }),
      ],
      pods: [
        pod({
          name: "nightly-29001-old",
          owner: ["Job", "nightly-29001"],
          containers: CRASH_LOOPING,
          ready: false,
        }),
        pod({
          name: "nightly-29002-new",
          owner: ["Job", "nightly-29002"],
          containers: CRASH_LOOPING,
          ready: false,
        }),
      ],
      isPodsTruncated: false,
    };

    const items: Array<ResourceAttentionItem> = getKubernetesPartAttentionItems(
      { read: read, routeFor: routeFor },
    );
    const names: Array<string> = items.map((item: ResourceAttentionItem) => {
      return item.name;
    });

    expect(names[0]).toBe("nightly");
    // Why the run failed, as the Job's condition says it.
    expect(items[0]!.reasons).toEqual([
      { text: "Last run failed" },
      {
        text: KUBERNETES_REASON_AS_WRITTEN,
        values: { reason: "BackoffLimitExceeded" },
      },
    ]);
    expect(names).toContain("nightly-29002");
    expect(names).toContain("nightly-29002-new");
    expect(names).not.toContain("nightly-29001");
    expect(names).not.toContain("nightly-29001-old");
  });

  test("its newest run went well: an older failure is history", () => {
    const read: KubernetesPartRead = {
      part: cronJob,
      jobs: [
        job({ name: "nightly-29001", failed: true, createdMinutesAgo: 2880 }),
        job({ name: "nightly-29002", createdMinutesAgo: 60 }),
      ],
      pods: [],
      isPodsTruncated: false,
    };

    expect(
      getKubernetesPartAttentionItems({ read: read, routeFor: routeFor }),
    ).toEqual([]);
  });
});

describe("which open incidents and alerts are about the part", () => {
  const read: KubernetesPartRead = {
    part: deployment({ replicas: 2, available: 2 }),
    pods: [
      pod({
        id: "eeeeeeee-0000-4000-8000-000000000001",
        name: "checkout-7d9f8b6c5-a1",
        owner: ["ReplicaSet", "checkout-7d9f8b6c5"],
      }),
    ],
    jobs: [],
    isPodsTruncated: false,
  };

  function record(
    seriesLabels: Record<string, string> | null,
    relatedIds: Record<string, Array<string>> = {},
  ): Pick<OpenIssueRecord, "seriesLabels" | "relatedIds"> {
    return {
      seriesLabels: seriesLabels as unknown as JSONObject | null,
      relatedIds: relatedIds,
    };
  }

  test("one that names the part, in its namespace", () => {
    expect(
      isKubernetesIssueAbout(
        record({
          "resource.k8s.namespace.name": "shop",
          "resource.k8s.deployment.name": "checkout",
        }),
        read,
      ),
    ).toBe(true);
  });

  test("never the same name in another namespace", () => {
    expect(
      isKubernetesIssueAbout(
        record({
          "resource.k8s.namespace.name": "payments",
          "resource.k8s.deployment.name": "checkout",
        }),
        read,
      ),
    ).toBe(false);
  });

  test("one about one of its pods, by name or by the rows ingest linked it to", () => {
    expect(
      isKubernetesIssueAbout(
        record({
          "resource.k8s.namespace.name": "shop",
          "resource.k8s.pod.name": "checkout-7d9f8b6c5-a1",
        }),
        read,
      ),
    ).toBe(true);
    expect(
      isKubernetesIssueAbout(
        record(null, {
          kubernetesResources: ["eeeeeeee-0000-4000-8000-000000000001"],
        }),
        read,
      ),
    ).toBe(true);
  });

  test("one about something else in the cluster is not", () => {
    expect(
      isKubernetesIssueAbout(
        record({
          "resource.k8s.namespace.name": "shop",
          "resource.k8s.deployment.name": "cart",
        }),
        read,
      ),
    ).toBe(false);
    expect(isKubernetesIssueAbout(record(null), read)).toBe(false);
  });
});

describe("a pod's facts, on the Pods tab", () => {
  test("its state by the rules, containers ready of all, restarts summed, its node and its workload", () => {
    const facts: KubernetesPodFacts = getKubernetesPodFacts(
      pod({
        name: "checkout-7d9f8b6c5-b2",
        owner: ["ReplicaSet", "checkout-7d9f8b6c5"],
        node: "node-b",
        containers: [
          container({ ready: true, restartCount: 1 }),
          ...CRASH_LOOPING,
        ],
        ready: false,
      }),
    );

    expect(facts.ready).toBe("1/2");
    expect(facts.restarts).toBe(15);
    expect(facts.nodeName).toBe("node-b");
    // A ReplicaSet's pod belongs to its Deployment.
    expect(facts.ownerName).toBe("checkout");
    expect(facts.assessment.severity).toBe(KubernetesHealthSeverity.Critical);
    expect(facts.assessment.status).toEqual({
      text: KUBERNETES_REASON_AS_WRITTEN,
      values: { reason: "CrashLoopBackOff" },
    });
  });

  test("the ones that need attention first, then by name as people number them", () => {
    const sorted: Array<string> = sortKubernetesPodFacts(
      [
        pod({ name: "web-10" }),
        pod({ name: "web-2" }),
        pod({ name: "web-3", containers: CRASH_LOOPING, ready: false }),
        pod({ name: "web-1" }),
      ].map(getKubernetesPodFacts),
    ).map((facts: KubernetesPodFacts): string => {
      return facts.name;
    });

    expect(sorted).toEqual(["web-3", "web-1", "web-2", "web-10"]);
  });
});

describe("the part read, as the server answers it", () => {
  test("keeps what it can read and leaves out what it cannot", () => {
    expect(
      parseKubernetesPartRead({
        part: { kind: "Pod", name: "web-1" },
        pods: [{ kind: "Pod", name: "web-1" }, null, "nonsense", 4],
        jobs: "not a list",
        isPodsTruncated: true,
      } as unknown as JSONObject),
    ).toEqual({
      part: { kind: "Pod", name: "web-1" },
      pods: [{ kind: "Pod", name: "web-1" }],
      jobs: [],
      isPodsTruncated: true,
    });
    expect(parseKubernetesPartRead(null)).toEqual({
      part: null,
      pods: [],
      jobs: [],
      isPodsTruncated: false,
    });
  });
});

describe("the Overview's Needs attention, as the server answers it", () => {
  test("drops a finding it cannot trust and keeps the rest, with their words", () => {
    const read: ReturnType<typeof parseKubernetesNeedsAttention> =
      parseKubernetesNeedsAttention({
        findings: [
          {
            key: "Deployment/shop/checkout",
            kind: "Deployment",
            namespace: "shop",
            name: "checkout",
            severity: "critical",
            reasons: [
              { text: "{{reason}}", values: { reason: "CrashLoopBackOff" } },
              { text: "" },
              "nonsense",
            ],
            message: "back-off 5m0s restarting failed container",
            podCount: 2,
          },
          {
            key: "DaemonSet/kube-system/fluent-bit",
            kind: "DaemonSet",
            namespace: "kube-system",
            name: "fluent-bit",
            severity: "warning",
            reasons: [
              {
                text: "Runs on {{count}} nodes it should not",
                plural: {
                  one: "Runs on {{count}} node it should not",
                  count: 1,
                },
              },
            ],
          },
          { key: "x", kind: "Pod", name: "web", severity: "urgent" },
          { kind: "Pod", name: "web", severity: "warning" },
        ],
        isTruncated: true,
      } as unknown as JSONObject);

    expect(read.isTruncated).toBe(true);
    expect(read.findings).toHaveLength(2);
    expect(read.findings[0]).toEqual({
      key: "Deployment/shop/checkout",
      kind: "Deployment",
      namespace: "shop",
      name: "checkout",
      severity: KubernetesHealthSeverity.Critical,
      reasons: [{ text: "{{reason}}", values: { reason: "CrashLoopBackOff" } }],
      message: "back-off 5m0s restarting failed container",
      podCount: 2,
    });
    expect(read.findings[1]!.reasons[0]!.plural).toEqual({
      one: "Runs on {{count}} node it should not",
      count: 1,
    });
  });

  test("each finding opens its part's page, its kind shortened as the side menu does", () => {
    const item: ResourceAttentionItem = toKubernetesAttentionItem(
      {
        key: "PersistentVolumeClaim/shop/data-0",
        kind: "PersistentVolumeClaim",
        namespace: "shop",
        name: "data-0",
        severity: KubernetesHealthSeverity.Warning,
        reasons: [{ text: "Waiting for a volume" }],
      },
      routeFor,
    );

    expect(item.kind).toBe("PVC");
    expect(getKubernetesKindChip("Deployment")).toBe("Deployment");
    expect(item.detail).toBe("shop");
    expect(routeOf(item)).toContain("/pvcs/data-0");
    expect(routeOf(item)).toContain(`${KUBERNETES_NAMESPACE_QUERY_PARAM}=shop`);
  });
});

describe("the words of a part's page", () => {
  test("a status of the rules reads in English for a list's filter and sort, its values filled in", () => {
    expect(
      kubernetesHealthTextInEnglish({
        text: "{{available}} of {{desired}} available",
        values: { available: "1", desired: "3" },
      }),
    ).toBe("1 of 3 available");
    expect(
      kubernetesHealthTextInEnglish({
        text: "Runs on {{count}} nodes it should not",
        plural: { one: "Runs on {{count}} node it should not", count: 1 },
      }),
    ).toBe("Runs on 1 node it should not");
    expect(
      kubernetesHealthTextInEnglish({
        text: "Runs on {{count}} nodes it should not",
        plural: { one: "Runs on {{count}} node it should not", count: 3 },
      }),
    ).toBe("Runs on 3 nodes it should not");
    expect(
      kubernetesHealthTextInEnglish({
        text: KUBERNETES_REASON_AS_WRITTEN,
        values: { reason: "ImagePullBackOff" },
      }),
    ).toBe("ImagePullBackOff");
  });

  test("every kind with a page of its own words its cards, and names itself in its Needs attention", () => {
    for (const kind of [
      "Pod",
      "Deployment",
      "StatefulSet",
      "DaemonSet",
      "Job",
      "CronJob",
      "Node",
    ]) {
      expect(KUBERNETES_PART_COPY[kind]).toBeDefined();
      expect(KUBERNETES_CURRENT_PART_LABELS[kind]).toMatch(/^This /);
    }
  });

  test("the alerts each kind's page offers are the cluster's templates that watch that kind", () => {
    const templates: Map<string, KubernetesAlertTemplate> = new Map(
      getAllKubernetesAlertTemplates().map(
        (
          template: KubernetesAlertTemplate,
        ): [string, KubernetesAlertTemplate] => {
          return [template.id, template];
        },
      ),
    );

    for (const [kind, ids] of Object.entries(
      KUBERNETES_PART_ALERT_TEMPLATE_IDS,
    )) {
      expect({ kind, offers: ids.length > 0 }).toEqual({ kind, offers: true });
      for (const id of ids) {
        expect({ kind, id, exists: templates.has(id) }).toEqual({
          kind,
          id,
          exists: true,
        });
      }
    }

    // Each workload's page offers the template written for its kind.
    expect(KUBERNETES_PART_ALERT_TEMPLATE_IDS["StatefulSet"]).toContain(
      "k8s-statefulset-replica-mismatch",
    );
    expect(KUBERNETES_PART_ALERT_TEMPLATE_IDS["DaemonSet"]).toContain(
      "k8s-daemonset-pods-not-ready",
    );
    expect(KUBERNETES_PART_ALERT_TEMPLATE_IDS["Node"]).toContain(
      "k8s-node-pressure",
    );
  });
});
