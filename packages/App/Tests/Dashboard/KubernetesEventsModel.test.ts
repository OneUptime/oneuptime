import { describe, expect, test } from "@jest/globals";
import Includes from "Common/Types/BaseDatabase/Includes";
import StartsWith from "Common/Types/BaseDatabase/StartsWith";
import KubernetesEventAttribute from "Common/Types/Kubernetes/KubernetesEvent";
import {
  KubernetesEventFields,
  StoredKubernetesEventLog,
  issue5179Events,
  normalPodEvent,
  storedKubernetesEventLog,
} from "Common/Tests/Helpers/KubernetesEventRecords";
import {
  KUBERNETES_CLUSTER_NAME_ATTRIBUTE,
  KubernetesEventRow,
  KubernetesEventsAttributeFilter,
  KubernetesEventsTypeFilter,
  KubernetesWarningSummary,
  KubernetesWorkloadKind,
  WORKLOAD_EVENT_KINDS,
  buildKubernetesEventsAttributes,
  countKubernetesEventRows,
  filterKubernetesEventRowsByType,
  getKubernetesEventPickerValues,
  groupKubernetesEvents,
  isKubernetesEventAboutWorkload,
  isUnstampedKubernetesEventLog,
  keepRowsOfScope,
  mergeKubernetesEventRows,
  sortKubernetesEventRows,
  summarizeKubernetesWarnings,
  toKubernetesEvent,
} from "../../FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesEventsModel";

/*
 * What the Kubernetes Events views read and show (issue #5179): one row per
 * Event out of its many records, the server-side filter every view sends,
 * and which Pods, ReplicaSets and Jobs belong to a workload's page.
 */

const CLUSTER: string = "aks-prod-westeurope";
const NOW: Date = new Date("2026-10-22T10:00:00.000Z");
const EVENTS: Array<KubernetesEventFields> = issue5179Events(NOW);
const OOM: KubernetesEventFields = EVENTS[0]!;
const ISTIOD_METRIC: KubernetesEventFields = EVENTS[3]!;

function stored(
  fields: KubernetesEventFields,
  options: {
    watchType?: "ADDED" | "MODIFIED" | "DELETED";
    stamped?: boolean;
  } = {},
): StoredKubernetesEventLog {
  return storedKubernetesEventLog({
    fields: fields,
    clusterName: CLUSTER,
    watchType: options.watchType,
    stamped: options.stamped,
  });
}

function row(fields: Partial<KubernetesEventRow>): KubernetesEventRow {
  return {
    id: "id",
    type: "Warning",
    isWarning: true,
    reason: "BackOff",
    message: "",
    objectKind: "Pod",
    objectName: "web-1",
    objectFieldPath: "",
    namespace: "shop",
    source: "kubelet",
    sourceHost: "",
    count: 1,
    firstSeenAt: null,
    lastSeenAt: null,
    ...fields,
  };
}

describe("toKubernetesEvent", () => {
  test("reads a stamped record from its attributes alone, without a body", () => {
    const log: StoredKubernetesEventLog = stored(OOM);
    const event: ReturnType<typeof toKubernetesEvent> = toKubernetesEvent({
      time: log.time,
      attributes: log.attributes,
    });

    expect(event?.reason).toBe("OOMKilling");
    expect(event?.type).toBe("Warning");
    expect(event?.object.kind).toBe("Node");
    expect(event?.reportingController).toBe("kernel-monitor");
    expect(event?.count).toBe(2);
  });

  test("reads a record stored before ingest stamped it, from its body", () => {
    const log: StoredKubernetesEventLog = stored(ISTIOD_METRIC, {
      stamped: false,
    });

    expect(isUnstampedKubernetesEventLog(log)).toBe(true);
    expect(toKubernetesEvent(log)?.reason).toBe("FailedGetResourceMetric");
    expect(toKubernetesEvent(log)?.namespace).toBe("aks-istio-system");
  });

  test("a legacy record whose body was not read is no Event", () => {
    const log: StoredKubernetesEventLog = stored(OOM, { stamped: false });

    expect(
      toKubernetesEvent({ time: log.time, attributes: log.attributes }),
    ).toBeNull();
  });

  test("an Event that says no time happened when its record did", () => {
    const time: Date = new Date("2026-10-22T09:59:00.000Z");
    const event: ReturnType<typeof toKubernetesEvent> = toKubernetesEvent({
      time: time,
      attributes: {
        [KubernetesEventAttribute.Uid]: "u-1",
        [KubernetesEventAttribute.Reason]: "BackOff",
      },
    });

    expect(event?.lastSeenAt).toEqual(time);
    expect(event?.firstSeenAt).toEqual(time);
  });
});

describe("groupKubernetesEvents: one row per Event", () => {
  test("an Event's added, repeated and deleted records are one row with its latest count", () => {
    const added: StoredKubernetesEventLog = stored(
      { ...OOM, count: 1, lastSeen: OOM.firstSeen },
      { watchType: "ADDED" },
    );
    const repeated: StoredKubernetesEventLog = stored(OOM, {
      watchType: "MODIFIED",
    });
    const deleted: StoredKubernetesEventLog = stored(OOM, {
      watchType: "DELETED",
    });

    const rows: Array<KubernetesEventRow> = groupKubernetesEvents([
      deleted,
      repeated,
      added,
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: OOM.uid,
      reason: "OOMKilling",
      isWarning: true,
      objectKind: "Node",
      objectName: "aks-userpool-11935137-vmss00000o",
      namespace: "default",
      source: "kernel-monitor",
      sourceHost: "aks-userpool-11935137-vmss00000o",
      count: 2,
    });
    expect(rows[0]!.firstSeenAt).toEqual(new Date(OOM.firstSeen));
    expect(rows[0]!.lastSeenAt).toEqual(new Date(OOM.lastSeen));
  });

  test("every Event of the issue is a row, newest first", () => {
    const rows: Array<KubernetesEventRow> = groupKubernetesEvents(
      EVENTS.map((fields: KubernetesEventFields) => {
        return stored(fields);
      }),
    );

    expect(rows).toHaveLength(EVENTS.length);
    for (let index: number = 1; index < rows.length; index++) {
      expect(rows[index - 1]!.lastSeenAt!.getTime()).toBeGreaterThanOrEqual(
        rows[index]!.lastSeenAt!.getTime(),
      );
    }
    expect(
      rows.map((eventRow: KubernetesEventRow) => {
        return eventRow.reason;
      }),
    ).toEqual(
      expect.arrayContaining([
        "OOMKilling",
        "FailedGetResourceMetric",
        "FailedComputeMetricsReplicas",
      ]),
    );
  });

  test("stamped and legacy records of one Event are one row", () => {
    const rows: Array<KubernetesEventRow> = groupKubernetesEvents([
      stored(OOM, { watchType: "MODIFIED" }),
      stored(OOM, { watchType: "ADDED", stamped: false }),
    ]);

    expect(rows).toHaveLength(1);
  });

  test("Events without a uid are told apart by what they say", () => {
    const logs: Array<{ attributes: Record<string, string> }> = [
      "first",
      "second",
      "first",
    ].map((message: string) => {
      return {
        attributes: {
          [KubernetesEventAttribute.Reason]: "BackOff",
          [KubernetesEventAttribute.Type]: "Warning",
          [KubernetesEventAttribute.ObjectKind]: "Pod",
          [KubernetesEventAttribute.ObjectName]: "web-1",
          [KubernetesEventAttribute.Message]: message,
        },
      };
    });

    expect(groupKubernetesEvents(logs)).toHaveLength(2);
  });

  test("a record that is no Event is left out", () => {
    expect(
      groupKubernetesEvents([
        { attributes: { "k8s.resource.name": "events" }, body: "{}" },
        { attributes: {}, body: "not json" },
      ]),
    ).toEqual([]);
  });
});

describe("mergeKubernetesEventRows and sortKubernetesEventRows", () => {
  test("an Event in both reads is one row, as the read that saw it happen more often says it", () => {
    const earlier: KubernetesEventRow = row({
      id: "e1",
      count: 2,
      firstSeenAt: new Date("2026-10-22T08:00:00Z"),
      lastSeenAt: new Date("2026-10-22T08:30:00Z"),
    });
    const later: KubernetesEventRow = row({
      id: "e1",
      count: 5,
      message: "newer",
      firstSeenAt: new Date("2026-10-22T08:10:00Z"),
      lastSeenAt: new Date("2026-10-22T09:00:00Z"),
    });
    const other: KubernetesEventRow = row({
      id: "e2",
      lastSeenAt: new Date("2026-10-22T09:30:00Z"),
    });

    const merged: Array<KubernetesEventRow> = mergeKubernetesEventRows(
      [earlier, other],
      [later],
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]!.id).toBe("e2");
    expect(merged[1]).toMatchObject({ id: "e1", count: 5, message: "newer" });
    expect(merged[1]!.firstSeenAt).toEqual(new Date("2026-10-22T08:00:00Z"));
    expect(merged[1]!.lastSeenAt).toEqual(new Date("2026-10-22T09:00:00Z"));
  });

  test("rows at the same moment: the one that happened more often first", () => {
    const at: Date = new Date("2026-10-22T09:00:00Z");
    const sorted: Array<KubernetesEventRow> = sortKubernetesEventRows([
      row({ id: "a", count: 1, lastSeenAt: at }),
      row({ id: "b", count: 7, lastSeenAt: at }),
    ]);

    expect(
      sorted.map((eventRow: KubernetesEventRow) => {
        return eventRow.id;
      }),
    ).toEqual(["b", "a"]);
  });
});

describe("buildKubernetesEventsAttributes: the filter each view sends", () => {
  test("every view asks for its own cluster's Event records only", () => {
    expect(
      buildKubernetesEventsAttributes({
        clusterIdentifier: CLUSTER,
        scope: { kind: "cluster" },
        filters: { type: KubernetesEventsTypeFilter.All },
      }),
    ).toEqual({
      "event.domain": "k8s",
      "k8s.resource.name": "events",
      [KUBERNETES_CLUSTER_NAME_ATTRIBUTE]: CLUSTER,
    });
  });

  test("the warnings are asked for on the server, not picked out afterwards", () => {
    expect(
      buildKubernetesEventsAttributes({
        clusterIdentifier: CLUSTER,
        scope: { kind: "cluster" },
        filters: { type: KubernetesEventsTypeFilter.Warning },
      })[KubernetesEventAttribute.Type],
    ).toBe("Warning");
    expect(
      buildKubernetesEventsAttributes({
        clusterIdentifier: CLUSTER,
        scope: { kind: "cluster" },
        filters: { type: KubernetesEventsTypeFilter.Normal },
      })[KubernetesEventAttribute.Type],
    ).toBe("Normal");
  });

  test("a node's view asks for the Events about that node", () => {
    expect(
      buildKubernetesEventsAttributes({
        clusterIdentifier: CLUSTER,
        scope: {
          kind: "object",
          objectKind: "Node",
          objectName: "aks-userpool-11935137-vmss00000o",
        },
        filters: { type: KubernetesEventsTypeFilter.All },
      }),
    ).toMatchObject({
      [KubernetesEventAttribute.ObjectKind]: "Node",
      [KubernetesEventAttribute.ObjectName]: "aks-userpool-11935137-vmss00000o",
    });
  });

  test("an HPA's view asks for its Events in its namespace", () => {
    expect(
      buildKubernetesEventsAttributes({
        clusterIdentifier: CLUSTER,
        scope: {
          kind: "object",
          objectKind: "HorizontalPodAutoscaler",
          objectName: "istiod",
          namespace: "aks-istio-system",
        },
        filters: { type: KubernetesEventsTypeFilter.All },
      }),
    ).toMatchObject({
      [KubernetesEventAttribute.ObjectKind]: "HorizontalPodAutoscaler",
      [KubernetesEventAttribute.ObjectName]: "istiod",
      [KubernetesEventAttribute.Namespace]: "aks-istio-system",
    });
  });

  test("a namespace's view asks for every Event in it", () => {
    const attributes: Record<string, KubernetesEventsAttributeFilter> =
      buildKubernetesEventsAttributes({
        clusterIdentifier: CLUSTER,
        scope: { kind: "namespace", namespace: "app-routing-system" },
        filters: {
          type: KubernetesEventsTypeFilter.All,
          // The scope already fixes the namespace.
          namespace: "elsewhere",
        },
      });

    expect(attributes[KubernetesEventAttribute.Namespace]).toBe(
      "app-routing-system",
    );
    expect(attributes[KubernetesEventAttribute.ObjectKind]).toBeUndefined();
  });

  test("a workload's view asks for its Kinds by its name's prefix", () => {
    const attributes: Record<string, KubernetesEventsAttributeFilter> =
      buildKubernetesEventsAttributes({
        clusterIdentifier: CLUSTER,
        scope: {
          kind: "workload",
          workloadKind: KubernetesWorkloadKind.Deployment,
          name: "checkout",
          namespace: "shop",
        },
        filters: { type: KubernetesEventsTypeFilter.All },
      });

    const kinds: Includes = attributes[
      KubernetesEventAttribute.ObjectKind
    ] as Includes;
    expect(kinds).toBeInstanceOf(Includes);
    expect(kinds.values).toEqual(["Deployment", "ReplicaSet", "Pod"]);
    const name: StartsWith<string> = attributes[
      KubernetesEventAttribute.ObjectName
    ] as StartsWith<string>;
    expect(name).toBeInstanceOf(StartsWith);
    expect(name.value).toBe("checkout");
    expect(attributes[KubernetesEventAttribute.Namespace]).toBe("shop");
  });

  test("the cluster page's pickers narrow on the server", () => {
    expect(
      buildKubernetesEventsAttributes({
        clusterIdentifier: CLUSTER,
        scope: { kind: "cluster" },
        filters: {
          type: KubernetesEventsTypeFilter.Warning,
          namespace: "aks-istio-system",
          reason: "FailedGetResourceMetric",
          objectKind: "HorizontalPodAutoscaler",
        },
      }),
    ).toEqual({
      "event.domain": "k8s",
      "k8s.resource.name": "events",
      [KUBERNETES_CLUSTER_NAME_ATTRIBUTE]: CLUSTER,
      [KubernetesEventAttribute.Type]: "Warning",
      [KubernetesEventAttribute.Namespace]: "aks-istio-system",
      [KubernetesEventAttribute.Reason]: "FailedGetResourceMetric",
      [KubernetesEventAttribute.ObjectKind]: "HorizontalPodAutoscaler",
    });
  });

  test("a Kind picker on an object's or a workload's view is no filter", () => {
    expect(
      buildKubernetesEventsAttributes({
        clusterIdentifier: CLUSTER,
        scope: { kind: "object", objectKind: "Node", objectName: "n1" },
        filters: {
          type: KubernetesEventsTypeFilter.All,
          objectKind: "Pod",
        },
      })[KubernetesEventAttribute.ObjectKind],
    ).toBe("Node");
  });
});

describe("isKubernetesEventAboutWorkload: what a workload runs, by its names", () => {
  const deployment: { kind: KubernetesWorkloadKind; name: string } = {
    kind: KubernetesWorkloadKind.Deployment,
    name: "web",
  };

  test.each([
    ["Deployment", "web", true],
    ["ReplicaSet", "web-5d9c7b8f6", true],
    ["Pod", "web-5d9c7b8f6-x2x7q", true],
    // Another Deployment whose name starts the same way.
    ["Deployment", "web-api", false],
    ["ReplicaSet", "web-api-5d9c7b8f6", false],
    ["Pod", "web-api-5d9c7b8f6-x2x7q", false],
    // A DaemonSet named web-api: its Pods are not mistaken for web's.
    ["Pod", "web-api-x2x7q", false],
    ["Pod", "web", false],
    ["Pod", "webapp-5d9c7b8f6-x2x7q", false],
    ["Service", "web", false],
  ])(
    "a Deployment's page: %s %s is %s",
    (
      kind: string | boolean,
      name: string | boolean,
      expected: string | boolean,
    ) => {
      expect(
        isKubernetesEventAboutWorkload(
          { objectKind: kind as string, objectName: name as string },
          deployment,
        ),
      ).toBe(expected);
    },
  );

  test.each([
    ["StatefulSet", "db", true],
    ["Pod", "db-0", true],
    ["Pod", "db-12", true],
    ["Pod", "db-backup-0", false],
    ["Pod", "db-x2x7q", false],
  ])(
    "a StatefulSet's page: %s %s is %s",
    (
      kind: string | boolean,
      name: string | boolean,
      expected: string | boolean,
    ) => {
      expect(
        isKubernetesEventAboutWorkload(
          { objectKind: kind as string, objectName: name as string },
          { kind: KubernetesWorkloadKind.StatefulSet, name: "db" },
        ),
      ).toBe(expected);
    },
  );

  test.each([
    ["DaemonSet", "node-agent", true],
    ["Pod", "node-agent-x2x7q", true],
    ["Pod", "node-agent-0", false],
    ["Pod", "node-agent-metrics-x2x7q", false],
  ])(
    "a DaemonSet's page: %s %s is %s",
    (
      kind: string | boolean,
      name: string | boolean,
      expected: string | boolean,
    ) => {
      expect(
        isKubernetesEventAboutWorkload(
          { objectKind: kind as string, objectName: name as string },
          { kind: KubernetesWorkloadKind.DaemonSet, name: "node-agent" },
        ),
      ).toBe(expected);
    },
  );

  test.each([
    ["Job", "migrate", true],
    ["Pod", "migrate-x2x7q", true],
    // An indexed Job's Pod.
    ["Pod", "migrate-3-x2x7q", true],
    ["Pod", "migrate-v2-x2x7q", false],
  ])(
    "a Job's page: %s %s is %s",
    (
      kind: string | boolean,
      name: string | boolean,
      expected: string | boolean,
    ) => {
      expect(
        isKubernetesEventAboutWorkload(
          { objectKind: kind as string, objectName: name as string },
          { kind: KubernetesWorkloadKind.Job, name: "migrate" },
        ),
      ).toBe(expected);
    },
  );

  test.each([
    ["CronJob", "nightly", true],
    ["Job", "nightly-29353140", true],
    ["Pod", "nightly-29353140-x2x7q", true],
    ["Pod", "nightly-29353140-2-x2x7q", true],
    ["Job", "nightly-report", false],
    ["Pod", "nightly-report-x2x7q", false],
  ])(
    "a CronJob's page: %s %s is %s",
    (
      kind: string | boolean,
      name: string | boolean,
      expected: string | boolean,
    ) => {
      expect(
        isKubernetesEventAboutWorkload(
          { objectKind: kind as string, objectName: name as string },
          { kind: KubernetesWorkloadKind.CronJob, name: "nightly" },
        ),
      ).toBe(expected);
    },
  );

  test("every workload's page asks for the Kinds it keeps", () => {
    for (const kind of Object.values(KubernetesWorkloadKind)) {
      expect(WORKLOAD_EVENT_KINDS[kind]).toContain(kind);
      expect(WORKLOAD_EVENT_KINDS[kind]).toContain("Pod");
    }
  });

  test("keepRowsOfScope keeps a workload's own rows and leaves other scopes alone", () => {
    const rows: Array<KubernetesEventRow> = [
      row({ id: "1", objectKind: "Pod", objectName: "web-5d9c7b8f6-x2x7q" }),
      row({
        id: "2",
        objectKind: "Pod",
        objectName: "web-api-5d9c7b8f6-x2x7q",
      }),
    ];

    expect(
      keepRowsOfScope(rows, {
        kind: "workload",
        workloadKind: KubernetesWorkloadKind.Deployment,
        name: "web",
      }).map((eventRow: KubernetesEventRow) => {
        return eventRow.id;
      }),
    ).toEqual(["1"]);
    expect(keepRowsOfScope(rows, { kind: "cluster" })).toEqual(rows);
  });
});

describe("counts, types and pickers", () => {
  const rows: Array<KubernetesEventRow> = groupKubernetesEvents([
    ...EVENTS.map((fields: KubernetesEventFields) => {
      return stored(fields);
    }),
    stored(normalPodEvent(1, NOW)),
    stored(normalPodEvent(2, NOW)),
  ]);

  test("counts Warning and Normal Events", () => {
    expect(countKubernetesEventRows(rows)).toEqual({
      all: EVENTS.length + 2,
      warning: EVENTS.length,
      normal: 2,
    });
  });

  test("filters by type", () => {
    expect(
      filterKubernetesEventRowsByType(rows, KubernetesEventsTypeFilter.Warning),
    ).toHaveLength(EVENTS.length);
    expect(
      filterKubernetesEventRowsByType(rows, KubernetesEventsTypeFilter.Normal),
    ).toHaveLength(2);
    expect(
      filterKubernetesEventRowsByType(rows, KubernetesEventsTypeFilter.All),
    ).toHaveLength(rows.length);
  });

  test("a picker offers what the rows have, the most frequent first, and keeps what is picked", () => {
    expect(getKubernetesEventPickerValues(rows, "namespace")).toEqual([
      "default",
      "aks-istio-system",
      "app-routing-system",
      "shop",
    ]);
    expect(getKubernetesEventPickerValues(rows, "objectKind")).toEqual([
      "HorizontalPodAutoscaler",
      "Node",
      "Pod",
    ]);
    expect(
      getKubernetesEventPickerValues(rows, "reason", "ImagePullBackOff"),
    ).toContain("ImagePullBackOff");
  });
});

describe("summarizeKubernetesWarnings: the Overview's lines", () => {
  test("one line per reason and object, counts summed, newest first, Normal events left out", () => {
    const rows: Array<KubernetesEventRow> = groupKubernetesEvents([
      ...EVENTS.map((fields: KubernetesEventFields) => {
        return stored(fields);
      }),
      stored(normalPodEvent(1, NOW)),
    ]);

    const summaries: Array<KubernetesWarningSummary> =
      summarizeKubernetesWarnings(rows, 10);

    // Two OOM kills on aks-agentpool-...0 are one line that says 3 times.
    const agentPool: KubernetesWarningSummary | undefined = summaries.find(
      (summary: KubernetesWarningSummary) => {
        return summary.objectName === "aks-agentpool-19172126-vmss000000";
      },
    );
    expect(agentPool).toMatchObject({ reason: "OOMKilling", count: 3 });
    // Two nodes, and two reasons on each of the two HPAs.
    expect(summaries).toHaveLength(6);
    expect(
      summaries.every((summary: KubernetesWarningSummary) => {
        return summary.reason !== "Pulled";
      }),
    ).toBe(true);
    // Newest first: the istiod warnings were last seen 4 minutes before NOW.
    expect(summaries[0]!.objectName).toBe("istiod");
  });

  test("holds to the limit", () => {
    const rows: Array<KubernetesEventRow> = groupKubernetesEvents(
      EVENTS.map((fields: KubernetesEventFields) => {
        return stored(fields);
      }),
    );

    expect(summarizeKubernetesWarnings(rows, 2)).toHaveLength(2);
  });
});
