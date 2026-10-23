jest.mock("Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "Common/Types/ObjectID",
        ) as { default: new (id: string) => unknown };

        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  KUBERNETES_EVENTS_FETCH_LIMIT,
  KubernetesEventsPage,
  fetchKubernetesEvents,
} from "../../FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesEventsApi";
import {
  KubernetesEventRow,
  KubernetesEventsTypeFilter,
  KubernetesWorkloadKind,
} from "../../FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesEventsModel";
import Log from "Common/Models/AnalyticsModels/Log";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import KubernetesEventAttribute from "Common/Types/Kubernetes/KubernetesEvent";
import ObjectID from "Common/Types/ObjectID";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import {
  KubernetesEventFields,
  StoredKubernetesEventLog,
  issue5179Events,
  normalPodEvent,
  storedKubernetesEventLog,
} from "Common/Tests/Helpers/KubernetesEventRecords";

/*
 * How the Kubernetes Events views read Events (issue #5179): one cluster's
 * Event records, filtered on the server, the newest first - without their
 * bodies, which only a record stored before ingest stamped its attributes
 * needs, and which a second read fetches for exactly those, by id.
 */

const CLUSTER: string = "aks-prod-westeurope";
const NOW: Date = new Date("2026-10-22T10:00:00.000Z");
const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-10-21T10:00:00.000Z"),
  NOW,
);
const EVENTS: Array<KubernetesEventFields> = issue5179Events(NOW);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getList: jest.Mock<any> =
  AnalyticsModelAPI.getList as unknown as jest.Mock<any>;

// Each record's own uuid, by the record's id, in the order they are first met.
const LOG_IDS: Map<string, string> = new Map();

function logIdOf(stored: StoredKubernetesEventLog): string {
  if (!LOG_IDS.has(stored._id)) {
    LOG_IDS.set(
      stored._id,
      `00000000-0000-4000-8000-${String(LOG_IDS.size + 1).padStart(12, "0")}`,
    );
  }
  return LOG_IDS.get(stored._id)!;
}

function asLog(stored: StoredKubernetesEventLog, withBody: boolean): Log {
  const log: Log = new Log();
  log._id = new ObjectID(logIdOf(stored));
  log.time = stored.time;
  log.attributes = stored.attributes;
  if (withBody) {
    log.body = stored.body;
  }
  return log;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function requestAt(index: number): any {
  return getList.mock.calls[index]![0];
}

beforeEach(() => {
  getList.mockReset();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("fetchKubernetesEvents", () => {
  test("asks for one cluster's Event records, newest first, without their bodies", async () => {
    getList.mockResolvedValue({ data: [], hasMore: false });

    await fetchKubernetesEvents({
      clusterIdentifier: CLUSTER,
      scope: { kind: "cluster" },
      filters: { type: KubernetesEventsTypeFilter.Warning },
      window: WINDOW,
    });

    expect(getList).toHaveBeenCalledTimes(1);
    const request: {
      query: Record<string, unknown>;
      select: Record<string, boolean>;
      sort: Record<string, SortOrder>;
      limit: number;
    } = requestAt(0);
    expect(request.query["projectId"]).toBe(
      "10000000-0000-4000-8000-000000000001",
    );
    expect(request.query["time"]).toBe(WINDOW);
    expect(request.query["attributes"]).toEqual({
      "event.domain": "k8s",
      "k8s.resource.name": "events",
      "resource.k8s.cluster.name": CLUSTER,
      [KubernetesEventAttribute.Type]: "Warning",
    });
    expect(request.select).toEqual({ _id: true, time: true, attributes: true });
    expect(request.sort).toEqual({ time: SortOrder.Descending });
    expect(request.limit).toBe(KUBERNETES_EVENTS_FETCH_LIMIT);
  });

  test("turns the records into one row per Event", async () => {
    const records: Array<StoredKubernetesEventLog> = [
      ...EVENTS.map((fields: KubernetesEventFields) => {
        return storedKubernetesEventLog({
          fields: fields,
          clusterName: CLUSTER,
        });
      }),
      // A repeat of the first one: the same Event.
      storedKubernetesEventLog({
        fields: EVENTS[0]!,
        clusterName: CLUSTER,
        watchType: "DELETED",
      }),
    ];
    getList.mockResolvedValue({
      data: records.map((stored: StoredKubernetesEventLog) => {
        return asLog(stored, false);
      }),
      hasMore: false,
    });

    const page: KubernetesEventsPage = await fetchKubernetesEvents({
      clusterIdentifier: CLUSTER,
      scope: { kind: "cluster" },
      filters: { type: KubernetesEventsTypeFilter.Warning },
      window: WINDOW,
    });

    expect(page.rows).toHaveLength(EVENTS.length);
    expect(page.hasMore).toBe(false);
    // Nothing was stored before the stamp: one read only.
    expect(getList).toHaveBeenCalledTimes(1);
  });

  test("reads the bodies of the records stored before ingest stamped them, by id, and only those", async () => {
    const legacy: StoredKubernetesEventLog = storedKubernetesEventLog({
      fields: EVENTS[3]!,
      clusterName: CLUSTER,
      stamped: false,
      id: "legacy",
    });
    const stamped: StoredKubernetesEventLog = storedKubernetesEventLog({
      fields: EVENTS[0]!,
      clusterName: CLUSTER,
      id: "stamped",
    });
    getList
      .mockResolvedValueOnce({
        data: [asLog(legacy, false), asLog(stamped, false)],
        hasMore: true,
      })
      .mockResolvedValueOnce({ data: [asLog(legacy, true)], hasMore: false });

    const page: KubernetesEventsPage = await fetchKubernetesEvents({
      clusterIdentifier: CLUSTER,
      scope: { kind: "cluster" },
      filters: { type: KubernetesEventsTypeFilter.All },
      window: WINDOW,
    });

    expect(getList).toHaveBeenCalledTimes(2);
    const second: {
      query: Record<string, unknown>;
      select: Record<string, boolean>;
      limit: number;
    } = requestAt(1);
    const ids: Includes = second.query["_id"] as Includes;
    expect(ids).toBeInstanceOf(Includes);
    expect(ids.values).toEqual([asLog(legacy, false)._id!.toString()]);
    expect(second.select).toEqual({
      _id: true,
      time: true,
      attributes: true,
      body: true,
    });
    expect(second.limit).toBe(1);

    expect(
      page.rows
        .map((row: KubernetesEventRow) => {
          return row.reason;
        })
        .sort(),
    ).toEqual(["FailedGetResourceMetric", "OOMKilling"]);
    expect(page.hasMore).toBe(true);
  });

  test("a workload's view keeps its own Pods and drops another workload's that share the prefix", async () => {
    const ours: KubernetesEventFields = {
      ...normalPodEvent(1, NOW),
      object: {
        kind: "Pod",
        name: "checkout-5d9c7b8f6-x2x7q",
        namespace: "shop",
      },
      uid: "11111111-0000-4000-8000-000000000001",
    };
    const theirs: KubernetesEventFields = {
      ...normalPodEvent(2, NOW),
      object: {
        kind: "Pod",
        name: "checkout-api-5d9c7b8f6-x2x7q",
        namespace: "shop",
      },
      uid: "11111111-0000-4000-8000-000000000002",
    };
    getList.mockResolvedValue({
      data: [ours, theirs].map((fields: KubernetesEventFields) => {
        return asLog(
          storedKubernetesEventLog({ fields: fields, clusterName: CLUSTER }),
          false,
        );
      }),
      hasMore: false,
    });

    const page: KubernetesEventsPage = await fetchKubernetesEvents({
      clusterIdentifier: CLUSTER,
      scope: {
        kind: "workload",
        workloadKind: KubernetesWorkloadKind.Deployment,
        name: "checkout",
        namespace: "shop",
      },
      filters: { type: KubernetesEventsTypeFilter.All },
      window: WINDOW,
    });

    expect(
      page.rows.map((row: KubernetesEventRow) => {
        return row.objectName;
      }),
    ).toEqual(["checkout-5d9c7b8f6-x2x7q"]);
  });

  test("a failed read fails the call, for the view to say so", async () => {
    getList.mockRejectedValue(new Error("The query took too long."));

    await expect(
      fetchKubernetesEvents({
        clusterIdentifier: CLUSTER,
        scope: { kind: "cluster" },
        filters: { type: KubernetesEventsTypeFilter.All },
        window: WINDOW,
      }),
    ).rejects.toThrow("The query took too long.");
  });
});
