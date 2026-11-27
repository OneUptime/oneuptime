import XcpNgProbeEvents, {
  XcpNgProbeEventsOutcome,
  XcpNgProbeEventsPools,
} from "../../../../Server/Utils/XcpNg/XcpNgProbeEvents";
import { XcpNgPoolEventsIngestPool } from "../../../../Server/Utils/XcpNg/XcpNgPoolEventsIngest";
import MemoryXcpNgPoolEventsStore, {
  makeXcpNgLabStore,
} from "../../../Helpers/XcpNg/MemoryXcpNgPoolEventsStore";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import XcpNgConnectionType from "../../../../Types/XcpNg/XcpNgConnectionType";
import {
  XcpNgEventsReport,
  XcpNgEventLogAttribute,
} from "../../../../Types/XcpNg/XcpNgPoolEvents";
import {
  XcpNgCollectionJob,
  XcpNgCollectionReport,
} from "../../../../Types/XcpNg/XcpNgProbeCollection";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Alarms, HA and backups on the probe's path (XcpNgProbeEvents): the claim
 * hands each job where reading stands, and a report's events are queued -
 * records for the logs ingest, derived series for the metrics ingest -
 * before what was read is committed. Against the in-memory store the
 * ingest's own tests use.
 */

const PROJECT: ObjectID = new ObjectID("8f3b2a10-0000-4000-8000-0000000000aa");
const CONNECTION: string = "3c1d2e4f-0000-4000-8000-0000000000cc";
const PRODUCTION_ID: string = "6b3f2a10-0000-4000-8000-0000000000aa";
const LAB_ID: string = "6b3f2a10-0000-4000-8000-0000000000bb";
const PRODUCTION: string = "b7569d99-30f8-178a-7d94-801de3e29b5b";
const LAB: string = "2ad2c2ec-1d43-4a5c-9c62-e8d0b6a4c3f1";
const WEB_01: string = "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
const NOW: Date = new Date(1795000100 * 1000);

const ALL_POOLS: Array<XcpNgPoolEventsIngestPool> = [
  { xcpNgPoolId: new ObjectID(PRODUCTION_ID), poolIdentifier: PRODUCTION },
  { xcpNgPoolId: new ObjectID(LAB_ID), poolIdentifier: LAB },
];

// The pools, as the pool service would find them.
const POOLS: XcpNgProbeEventsPools = {
  findForConnection: async (): Promise<Array<XcpNgPoolEventsIngestPool>> => {
    return ALL_POOLS;
  },
  findByIdentifiers: async (data: {
    poolIdentifiers: Array<string>;
  }): Promise<Array<XcpNgPoolEventsIngestPool>> => {
    return ALL_POOLS.filter((pool: XcpNgPoolEventsIngestPool): boolean => {
      return data.poolIdentifiers.includes(pool.poolIdentifier);
    });
  },
};

let store: MemoryXcpNgPoolEventsStore;
let queued: Array<string>;
let queuedLogs: Array<JSONObject>;

const queue: {
  queueLogs: (data: {
    projectId: ObjectID;
    resourceLogs: Array<JSONObject>;
  }) => Promise<void>;
  queueMetrics: (data: {
    projectId: ObjectID;
    resourceMetrics: Array<JSONObject>;
  }) => Promise<void>;
} = {
  queueLogs: async (data: {
    projectId: ObjectID;
    resourceLogs: Array<JSONObject>;
  }): Promise<void> => {
    expect(data.projectId.toString()).toBe(PROJECT.toString());
    // Queued before anything is written.
    expect(store.poolWrites).toEqual([]);
    queued.push("logs");
    queuedLogs.push(...data.resourceLogs);
  },
  queueMetrics: async (data: {
    projectId: ObjectID;
    resourceMetrics: Array<JSONObject>;
  }): Promise<void> => {
    expect(data.projectId.toString()).toBe(PROJECT.toString());
    expect(store.poolWrites).toEqual([]);
    queued.push("metrics");
  },
};

beforeEach(() => {
  store = makeXcpNgLabStore({ productionId: PRODUCTION_ID, labId: LAB_ID });
  queued = [];
  queuedLogs = [];
});

function crash(): XcpNgEventsReport {
  return {
    pools: [
      {
        poolId: PRODUCTION,
        poolState: {
          poolId: PRODUCTION,
          haEnabled: true,
          masterHostUuid: "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d",
        },
        messages: [
          {
            uuid: "m-crash",
            poolId: PRODUCTION,
            name: "VM_CRASHED",
            priority: 2,
            objectClass: "VM",
            objectUuid: WEB_01,
            timestamp: new Date(1795000030 * 1000).toISOString(),
            body: "",
          },
        ],
        messageWatermark: {
          readUntil: new Date(1795000030 * 1000).toISOString(),
          uuidsAtReadUntil: ["m-crash"],
        },
        clearedMessageIds: [],
      },
    ],
    problems: {},
    warnings: [],
  };
}

function report(
  overrides: Partial<XcpNgCollectionReport> = {},
): XcpNgCollectionReport {
  return {
    xcpNgConnectionId: CONNECTION,
    settingsVersion: 1,
    collectedAt: NOW.toISOString(),
    status: "Succeeded",
    durationInMs: 1000,
    ...overrides,
  } as XcpNgCollectionReport;
}

function names(): Array<string | undefined> {
  return queuedLogs.flatMap((logs: JSONObject): Array<string | undefined> => {
    return ((logs["scopeLogs"] as JSONArray) || []).flatMap(
      (scope: unknown): Array<string | undefined> => {
        return ((scope as JSONObject)["logRecords"] as Array<JSONObject>).map(
          (record: JSONObject): string | undefined => {
            const found: JSONObject | undefined = (
              record["attributes"] as Array<JSONObject>
            ).find((entry: JSONObject): boolean => {
              return entry["key"] === XcpNgEventLogAttribute.MessageName;
            });
            return found
              ? String((found["value"] as JSONObject)["stringValue"])
              : undefined;
          },
        );
      },
    );
  });
}

function job(
  connectionType: XcpNgConnectionType,
  apiToken?: string,
): XcpNgCollectionJob {
  return {
    xcpNgConnectionId: CONNECTION,
    connectionName: "xo-paris",
    connectionType: connectionType,
    address: "https://xo.example.test",
    collectionIntervalInMinutes: 1,
    settingsVersion: 1,
    ...(apiToken ? { apiToken: apiToken } : {}),
  };
}

describe("the claim: where reading stands, on each job", () => {
  test("a Xen Orchestra job with a token, and an XAPI job, carry their pools' state", async () => {
    const xo: XcpNgCollectionJob = job(
      XcpNgConnectionType.XenOrchestra,
      "token",
    );
    const xapi: XcpNgCollectionJob = job(XcpNgConnectionType.Xapi);
    await XcpNgProbeEvents.attachEventsJobs({
      jobs: [xo, xapi],
      projectIdByConnectionId: new Map([[CONNECTION, PROJECT]]),
      now: NOW,
      pools: POOLS,
      store: store,
    });
    expect(
      xo.events?.pools.map((pool: { poolId: string }) => {
        return pool.poolId;
      }),
    ).toEqual([PRODUCTION, LAB]);
    // Never read yet: the patches are due.
    expect(xo.events?.checkPatches).toBe(true);
    expect(xapi.events?.pools).toHaveLength(2);
  });

  test("a Xen Orchestra job without a token, or a connection with no project, carries none", async () => {
    const xo: XcpNgCollectionJob = job(XcpNgConnectionType.XenOrchestra);
    const orphan: XcpNgCollectionJob = {
      ...job(XcpNgConnectionType.Xapi),
      xcpNgConnectionId: "00000000-0000-4000-8000-000000000000",
    };
    await XcpNgProbeEvents.attachEventsJobs({
      jobs: [xo, orphan],
      projectIdByConnectionId: new Map([[CONNECTION, PROJECT]]),
      pools: POOLS,
      store: store,
    });
    expect(xo.events).toBeUndefined();
    expect(orphan.events).toBeUndefined();
  });

  test("a state that cannot be read leaves the job without it: the metrics still go", async () => {
    const xo: XcpNgCollectionJob = job(
      XcpNgConnectionType.XenOrchestra,
      "token",
    );
    await XcpNgProbeEvents.attachEventsJobs({
      jobs: [xo],
      projectIdByConnectionId: new Map([[CONNECTION, PROJECT]]),
      pools: {
        ...POOLS,
        findForConnection: async (): Promise<
          Array<XcpNgPoolEventsIngestPool>
        > => {
          throw new Error("the database went away");
        },
      },
      store: store,
    });
    expect(xo.events).toBeUndefined();
  });
});

describe("a report's events: queued, then committed", () => {
  test("Xen Orchestra: the records and the derived series are queued before a watermark moves", async () => {
    const outcome: XcpNgProbeEventsOutcome = await XcpNgProbeEvents.ingest({
      projectId: PROJECT,
      connectionType: XcpNgConnectionType.XenOrchestra,
      connectionName: "xo-paris",
      report: report({ events: crash() }),
      poolIdsToKeep: new Set([PRODUCTION, LAB]),
      queue: queue,
      now: NOW,
      pools: POOLS,
      store: store,
    });

    expect(queued).toEqual(["logs", "metrics"]);
    expect(outcome.recordCount).toBe(1);
    expect(names()).toEqual(["VM_CRASHED"]);
    // Committed after: the watermark and the feed line.
    expect(store.poolWrites.length).toBeGreaterThan(0);
    expect(
      store.feed.some((line: { markdown: string }): boolean => {
        return line.markdown.startsWith("**VM crashed**: web-01.");
      }),
    ).toBe(true);
  });

  test("only the pools the connection reads now are touched", async () => {
    await XcpNgProbeEvents.ingest({
      projectId: PROJECT,
      connectionType: XcpNgConnectionType.XenOrchestra,
      report: report({ events: crash() }),
      // Production is read through another connection now.
      poolIdsToKeep: new Set([LAB]),
      queue: queue,
      now: NOW,
      pools: POOLS,
      store: store,
    });
    expect(names()).toEqual([]);
    expect(
      store.poolWrites.every((write: { id: string }): boolean => {
        return write.id === LAB_ID;
      }),
    ).toBe(true);
  });

  test("Xen Orchestra without events, or no pool kept: nothing is queued or written", async () => {
    const none: XcpNgProbeEventsOutcome = await XcpNgProbeEvents.ingest({
      projectId: PROJECT,
      connectionType: XcpNgConnectionType.XenOrchestra,
      report: report(),
      poolIdsToKeep: new Set([PRODUCTION]),
      queue: queue,
      pools: POOLS,
      store: store,
    });
    expect(none).toEqual({ recordCount: 0, derivedPoolCount: 0 });

    await XcpNgProbeEvents.ingest({
      projectId: PROJECT,
      connectionType: XcpNgConnectionType.XenOrchestra,
      report: report({ events: crash() }),
      poolIdsToKeep: new Set(),
      queue: queue,
      pools: POOLS,
      store: store,
    });
    expect(queued).toEqual([]);
    expect(store.poolWrites).toEqual([]);
  });

  test("a queue that fails writes nothing: the same events are read again next time", async () => {
    await expect(
      XcpNgProbeEvents.ingest({
        projectId: PROJECT,
        connectionType: XcpNgConnectionType.XenOrchestra,
        report: report({ events: crash() }),
        poolIdsToKeep: new Set([PRODUCTION]),
        queue: {
          ...queue,
          queueLogs: async (): Promise<void> => {
            throw new Error("the queue is down");
          },
        },
        now: NOW,
        pools: POOLS,
        store: store,
      }),
    ).rejects.toThrow("the queue is down");
    expect(store.poolWrites).toEqual([]);
    expect(store.feed).toEqual([]);
  });

  test("XAPI: its messages are records, alerts and feed lines; a dismissed one clears its alert", async () => {
    const xapiReport: XcpNgCollectionReport = report({
      messages: crash().pools[0]!.messages,
      poolStates: [
        {
          poolId: PRODUCTION,
          haEnabled: true,
          haHostFailuresToTolerate: 1,
          haPlanExistsFor: 1,
          haOvercommitted: false,
          masterHostUuid: "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d",
        },
      ],
    });
    await XcpNgProbeEvents.ingest({
      projectId: PROJECT,
      connectionType: XcpNgConnectionType.Xapi,
      report: xapiReport,
      poolIdsToKeep: new Set([PRODUCTION]),
      queue: queue,
      now: NOW,
      pools: POOLS,
      store: store,
    });
    expect(names()).toEqual(["VM_CRASHED"]);
    const stored: unknown = store.pools.get(PRODUCTION_ID)?.eventState;
    expect(JSON.stringify(stored)).toContain("m-crash");

    // Next collection: XAPI no longer lists it.
    queuedLogs = [];
    queued = [];
    store.poolWrites = [];
    await XcpNgProbeEvents.ingest({
      projectId: PROJECT,
      connectionType: XcpNgConnectionType.Xapi,
      report: report({
        messages: [],
        poolStates: xapiReport.poolStates,
        xapiClearedMessageIds: ["m-crash"],
      }),
      poolIdsToKeep: new Set([PRODUCTION]),
      queue: queue,
      now: new Date(NOW.getTime() + 60000),
      pools: POOLS,
      store: store,
    });
    const states: Array<string> = queuedLogs.flatMap(
      (logs: JSONObject): Array<string> => {
        return ((logs["scopeLogs"] as JSONArray) || []).flatMap(
          (scope: unknown): Array<string> => {
            return (
              (scope as JSONObject)["logRecords"] as Array<JSONObject>
            ).map((record: JSONObject): string => {
              const found: JSONObject | undefined = (
                record["attributes"] as Array<JSONObject>
              ).find((entry: JSONObject): boolean => {
                return entry["key"] === XcpNgEventLogAttribute.MessageState;
              });
              return String(
                ((found || {})["value"] as JSONObject | undefined)?.[
                  "stringValue"
                ],
              );
            });
          },
        );
      },
    );
    expect(states).toEqual(["cleared"]);
    expect(
      JSON.stringify(store.pools.get(PRODUCTION_ID)?.eventState),
    ).not.toContain("m-crash");
  });
});
