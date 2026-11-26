import ObjectID from "../../../../Types/ObjectID";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import XcpNgPoolEventsIngest, {
  XcpNgPoolEventsPreparation,
  XcpNgPoolEventsStore,
} from "../../../../Server/Utils/XcpNg/XcpNgPoolEventsIngest";
import {
  XcpNgFeedLine,
  XcpNgPoolEventColumns,
  XcpNgStoredPool,
  XcpNgStoredResource,
  XcpNgVmBackupUpdate,
} from "../../../../Server/Utils/XcpNg/XcpNgPoolEventsProcessing";
import {
  XCP_NG_PATCH_CHECK_INTERVAL_MS,
  XcpNgEventsJobState,
  XcpNgEventsReport,
  XcpNgHostPatches,
} from "../../../../Types/XcpNg/XcpNgPoolEvents";
import { XcpNgEventSource } from "../../../../Types/XcpNg/XcpNgPoolEventState";
import XcpNgResourceKind from "../../../../Types/XcpNg/XcpNgResourceKind";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A collection's events taken in (XcpNgPoolEventsIngest), with the store in
 * memory: prepared first, the payloads handed back for the route to queue,
 * then committed - and the next job read from what was committed.
 */

const PROJECT: ObjectID = new ObjectID("8f3b2a10-0000-4000-8000-0000000000aa");
const PRODUCTION_ID: ObjectID = new ObjectID(
  "6b3f2a10-0000-4000-8000-0000000000aa",
);
const LAB_ID: ObjectID = new ObjectID("6b3f2a10-0000-4000-8000-0000000000bb");
const PRODUCTION: string = "b7569d99-30f8-178a-7d94-801de3e29b5b";
const LAB: string = "2ad2c2ec-1d43-4a5c-9c62-e8d0b6a4c3f1";
const WEB_01: string = "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
const PROD_01: string = "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d";
const NOW: Date = new Date(1795000100 * 1000);

class MemoryStore implements XcpNgPoolEventsStore {
  public pools: Map<string, XcpNgStoredPool> = new Map();
  public inventories: Map<string, Array<XcpNgStoredResource>> = new Map();
  public poolWrites: Array<{ id: string; columns: XcpNgPoolEventColumns }> = [];
  public vmBackupWrites: Array<XcpNgVmBackupUpdate> = [];
  public patchWrites: Array<XcpNgHostPatches> = [];
  public feed: Array<XcpNgFeedLine> = [];
  public failWritesFor: Set<string> = new Set<string>();

  public async readPools(data: {
    projectId: ObjectID;
    xcpNgPoolIds: Array<ObjectID>;
  }): Promise<Array<XcpNgStoredPool>> {
    expect(data.projectId.toString()).toBe(PROJECT.toString());
    return data.xcpNgPoolIds
      .map((id: ObjectID): XcpNgStoredPool | undefined => {
        const pool: XcpNgStoredPool | undefined = this.pools.get(id.toString());
        return pool
          ? (JSON.parse(JSON.stringify(pool)) as XcpNgStoredPool)
          : undefined;
      })
      .filter((pool: XcpNgStoredPool | undefined): pool is XcpNgStoredPool => {
        return Boolean(pool);
      });
  }

  public async readInventory(data: {
    xcpNgPoolId: ObjectID;
  }): Promise<Array<XcpNgStoredResource>> {
    return this.inventories.get(data.xcpNgPoolId.toString()) || [];
  }

  public async writePool(data: {
    xcpNgPoolId: ObjectID;
    columns: XcpNgPoolEventColumns;
  }): Promise<void> {
    if (this.failWritesFor.has(data.xcpNgPoolId.toString())) {
      throw new Error("the database went away");
    }
    this.poolWrites.push({
      id: data.xcpNgPoolId.toString(),
      columns: data.columns,
    });
    const pool: XcpNgStoredPool = this.pools.get(
      data.xcpNgPoolId.toString(),
    ) as XcpNgStoredPool;
    const columns: XcpNgPoolEventColumns = JSON.parse(
      JSON.stringify(data.columns),
    ) as XcpNgPoolEventColumns;
    this.pools.set(data.xcpNgPoolId.toString(), {
      ...pool,
      eventState: columns.eventState,
      isHaEnabled:
        columns.isHaEnabled === undefined
          ? pool.isHaEnabled
          : columns.isHaEnabled ?? null,
      masterHostExternalId:
        columns.masterHostExternalId === undefined
          ? pool.masterHostExternalId
          : columns.masterHostExternalId ?? null,
      backupJobs: columns.backupJobs ?? pool.backupJobs,
      patchesCheckedAt: columns.patchesCheckedAt
        ? new Date(columns.patchesCheckedAt)
        : pool.patchesCheckedAt,
    });
  }

  public async writeVmBackups(data: {
    updates: Array<XcpNgVmBackupUpdate>;
  }): Promise<void> {
    this.vmBackupWrites.push(...data.updates);
  }

  public async writeVmIntervals(): Promise<void> {
    // Read back through the inventory in these tests when they need it.
  }

  public async writeHostPatches(data: {
    hosts: Array<XcpNgHostPatches>;
  }): Promise<void> {
    this.patchWrites.push(...data.hosts);
  }

  public async writeFeed(data: { lines: Array<XcpNgFeedLine> }): Promise<void> {
    this.feed.push(...data.lines);
  }
}

function pool(id: ObjectID, identifier: string, name: string): XcpNgStoredPool {
  return {
    xcpNgPoolId: id.toString(),
    poolIdentifier: identifier,
    name: name,
    reportedName: name,
    xenOrchestraName: "xo-paris",
    isHaEnabled: null,
    haHostFailuresToTolerate: null,
    haPlanExistsFor: null,
    isHaOvercommitted: null,
    masterHostExternalId: null,
    backupJobs: null,
    eventState: null,
    patchesCheckedAt: null,
  };
}

function resource(
  kind: string,
  externalId: string,
  name: string,
): XcpNgStoredResource {
  return {
    kind: kind,
    externalId: externalId,
    name: name,
    isUp: true,
    isEnabled: true,
    isControlDomain: false,
    lastSuccessfulBackupAt: null,
    backupIntervalSeconds: null,
    missingPatchCount: null,
  };
}

let store: MemoryStore;

beforeEach(() => {
  store = new MemoryStore();
  store.pools.set(
    PRODUCTION_ID.toString(),
    pool(PRODUCTION_ID, PRODUCTION, "Production"),
  );
  store.pools.set(LAB_ID.toString(), pool(LAB_ID, LAB, "Pool 2ad2c2ec"));
  store.inventories.set(PRODUCTION_ID.toString(), [
    resource(XcpNgResourceKind.Host, PROD_01, "xcp-prod-01"),
    resource(XcpNgResourceKind.VM, WEB_01, "web-01"),
  ]);
});

function crashReport(): XcpNgEventsReport {
  return {
    pools: [
      {
        poolId: PRODUCTION,
        poolState: {
          poolId: PRODUCTION,
          haEnabled: true,
          masterHostUuid: PROD_01,
        },
        messages: [
          {
            uuid: "m-crash",
            poolId: PRODUCTION,
            name: "VM_CRASHED",
            priority: 2,
            objectClass: "vm",
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

function recordsOf(preparation: XcpNgPoolEventsPreparation): Array<JSONObject> {
  return preparation.resourceLogs.flatMap((logs: JSONObject) => {
    return (logs["scopeLogs"] as JSONArray).flatMap((scope: unknown) => {
      return (scope as JSONObject)["logRecords"] as Array<JSONObject>;
    });
  });
}

describe("prepare, then commit", () => {
  test("the payloads come first; nothing is written until commit", async () => {
    const preparation: XcpNgPoolEventsPreparation =
      await XcpNgPoolEventsIngest.prepare(
        {
          projectId: PROJECT,
          source: XcpNgEventSource.XenOrchestra,
          pools: [{ xcpNgPoolId: PRODUCTION_ID, poolIdentifier: PRODUCTION }],
          events: crashReport(),
          xenOrchestraName: "xo-paris",
          now: NOW,
        },
        store,
      );

    expect(recordsOf(preparation)).toHaveLength(1);
    const resource0: JSONObject = (preparation.resourceLogs[0] as JSONObject)[
      "resource"
    ] as JSONObject;
    expect(resource0["attributes"]).toEqual([
      { key: "xcp_ng.pool.id", value: { stringValue: PRODUCTION } },
      { key: "xcp_ng.pool.name", value: { stringValue: "Production" } },
      { key: "xen_orchestra.name", value: { stringValue: "xo-paris" } },
    ]);
    // HA on, one host up and enabled: the reading says it cannot tolerate one.
    expect(preparation.resourceMetrics).toHaveLength(1);
    expect(store.poolWrites).toEqual([]);
    expect(store.feed).toEqual([]);

    await preparation.commit();
    expect(store.poolWrites).toHaveLength(1);
    expect(store.feed).toHaveLength(1);
    expect(store.poolWrites[0]?.columns.isHaEnabled).toBe(true);
    expect(store.poolWrites[0]?.columns.masterHostExternalId).toBe(PROD_01);
  });

  test("only the pools the connection may write are touched", async () => {
    const report: XcpNgEventsReport = crashReport();
    report.pools.push({
      poolId: LAB,
      messages: [],
      messageWatermark: {
        readUntil: new Date(0).toISOString(),
        uuidsAtReadUntil: [],
      },
      clearedMessageIds: [],
    });

    const preparation: XcpNgPoolEventsPreparation =
      await XcpNgPoolEventsIngest.prepare(
        {
          projectId: PROJECT,
          source: XcpNgEventSource.XenOrchestra,
          // Another connection reads the lab pool.
          pools: [{ xcpNgPoolId: PRODUCTION_ID, poolIdentifier: PRODUCTION }],
          events: report,
          now: NOW,
        },
        store,
      );
    await preparation.commit();
    expect(
      store.poolWrites.map((write: { id: string }) => {
        return write.id;
      }),
    ).toEqual([PRODUCTION_ID.toString()]);
  });

  test("a pool Xen Orchestra did not report is left as it was", async () => {
    const preparation: XcpNgPoolEventsPreparation =
      await XcpNgPoolEventsIngest.prepare(
        {
          projectId: PROJECT,
          source: XcpNgEventSource.XenOrchestra,
          pools: [
            { xcpNgPoolId: PRODUCTION_ID, poolIdentifier: PRODUCTION },
            { xcpNgPoolId: LAB_ID, poolIdentifier: LAB },
          ],
          events: crashReport(),
          now: NOW,
        },
        store,
      );
    await preparation.commit();
    expect(
      store.poolWrites.map((write: { id: string }) => {
        return write.id;
      }),
    ).toEqual([PRODUCTION_ID.toString()]);
  });

  test("one pool's failed write is logged, and the others are still written", async () => {
    store.failWritesFor.add(PRODUCTION_ID.toString());
    const report: XcpNgEventsReport = crashReport();
    report.pools.push({
      poolId: LAB,
      messages: [],
      messageWatermark: {
        readUntil: new Date(0).toISOString(),
        uuidsAtReadUntil: [],
      },
      clearedMessageIds: [],
    });
    const preparation: XcpNgPoolEventsPreparation =
      await XcpNgPoolEventsIngest.prepare(
        {
          projectId: PROJECT,
          source: XcpNgEventSource.XenOrchestra,
          pools: [
            { xcpNgPoolId: PRODUCTION_ID, poolIdentifier: PRODUCTION },
            { xcpNgPoolId: LAB_ID, poolIdentifier: LAB },
          ],
          events: report,
          now: NOW,
        },
        store,
      );
    await expect(preparation.commit()).resolves.toBeUndefined();
    expect(
      store.poolWrites.map((write: { id: string }) => {
        return write.id;
      }),
    ).toEqual([LAB_ID.toString()]);
    // Production's watermark did not move: its messages are read again.
    expect(store.pools.get(PRODUCTION_ID.toString())?.eventState).toBeNull();
  });

  test("straight from XAPI: the report's own messages and pool states", async () => {
    const preparation: XcpNgPoolEventsPreparation =
      await XcpNgPoolEventsIngest.prepare(
        {
          projectId: PROJECT,
          source: XcpNgEventSource.Xapi,
          pools: [{ xcpNgPoolId: PRODUCTION_ID, poolIdentifier: PRODUCTION }],
          xapiMessages: [
            {
              uuid: "x1",
              poolId: PRODUCTION.toUpperCase(),
              name: "ALARM",
              priority: 1,
              objectClass: "Host",
              objectUuid: PROD_01,
              timestamp: new Date(1795000050 * 1000).toISOString(),
              body: 'value: 0.99\nconfig:\n<variable>\n<name value="cpu_usage"/>\n</variable>',
            },
          ],
          xapiMessagesRead: true,
          xapiPoolStates: [
            {
              poolId: PRODUCTION,
              haEnabled: true,
              haHostFailuresToTolerate: 1,
              haPlanExistsFor: 1,
              haOvercommitted: false,
              masterHostUuid: PROD_01,
            },
          ],
          now: NOW,
        },
        store,
      );
    const [record] = recordsOf(preparation);
    expect(record?.["severityText"]).toBe("FATAL");
    await preparation.commit();
    const columns: XcpNgPoolEventColumns = store.poolWrites[0]
      ?.columns as XcpNgPoolEventColumns;
    expect(columns.eventReadStatus.source).toBe(XcpNgEventSource.Xapi);
    expect(columns.haPlanExistsFor).toBe(1);
    expect(columns.eventsReadAt).toEqual(NOW);
  });
});

describe("the next job, from what was committed", () => {
  test("a pool read for the first time starts with no watermark", async () => {
    const job: XcpNgEventsJobState = await XcpNgPoolEventsIngest.getJobState({
      projectId: PROJECT,
      pools: [{ xcpNgPoolId: PRODUCTION_ID, poolIdentifier: PRODUCTION }],
      now: NOW,
      store: store,
    });
    expect(job).toEqual({
      pools: [{ poolId: PRODUCTION, openMessageIds: [] }],
      checkPatches: true,
    });
  });

  test("the watermark and open messages a restarted probe starts from", async () => {
    const preparation: XcpNgPoolEventsPreparation =
      await XcpNgPoolEventsIngest.prepare(
        {
          projectId: PROJECT,
          source: XcpNgEventSource.XenOrchestra,
          pools: [{ xcpNgPoolId: PRODUCTION_ID, poolIdentifier: PRODUCTION }],
          events: {
            ...crashReport(),
            hostPatches: [{ hostId: PROD_01, patchCount: 0, patches: [] }],
            backupRuns: [],
            backupWatermark: {
              readSince: 1794996000000,
              deliveredRunIds: ["1794996000000"],
              trackedRuns: [],
            },
          },
          now: NOW,
        },
        store,
      );
    await preparation.commit();

    const job: XcpNgEventsJobState = await XcpNgPoolEventsIngest.getJobState({
      projectId: PROJECT,
      pools: [{ xcpNgPoolId: PRODUCTION_ID, poolIdentifier: PRODUCTION }],
      now: new Date(NOW.getTime() + 60000),
      store: store,
    });
    expect(job.pools).toEqual([
      {
        poolId: PRODUCTION,
        openMessageIds: ["m-crash"],
        messageWatermark: {
          readUntil: new Date(1795000030 * 1000).toISOString(),
          uuidsAtReadUntil: ["m-crash"],
        },
      },
    ]);
    expect(job.backupWatermark).toEqual({
      readSince: 1794996000000,
      deliveredRunIds: ["1794996000000"],
      trackedRuns: [],
    });
    // Checked a minute ago: not due for six hours.
    expect(job.checkPatches).toBe(false);

    const later: XcpNgEventsJobState = await XcpNgPoolEventsIngest.getJobState({
      projectId: PROJECT,
      pools: [{ xcpNgPoolId: PRODUCTION_ID, poolIdentifier: PRODUCTION }],
      now: new Date(NOW.getTime() + XCP_NG_PATCH_CHECK_INTERVAL_MS),
      store: store,
    });
    expect(later.checkPatches).toBe(true);
  });

  test("the most advanced backup watermark of a Xen Orchestra's pools", async () => {
    store.pools.set(PRODUCTION_ID.toString(), {
      ...pool(PRODUCTION_ID, PRODUCTION, "Production"),
      eventState: {
        openMessages: [],
        backupWatermark: {
          readSince: 10,
          deliveredRunIds: ["a"],
          trackedRuns: [],
        },
      },
    });
    store.pools.set(LAB_ID.toString(), {
      ...pool(LAB_ID, LAB, "Pool 2ad2c2ec"),
      eventState: {
        openMessages: [],
        backupWatermark: {
          readSince: 20,
          deliveredRunIds: ["b"],
          trackedRuns: [],
        },
      },
    });
    const job: XcpNgEventsJobState = await XcpNgPoolEventsIngest.getJobState({
      projectId: PROJECT,
      pools: [
        { xcpNgPoolId: PRODUCTION_ID, poolIdentifier: PRODUCTION },
        { xcpNgPoolId: LAB_ID, poolIdentifier: LAB },
      ],
      now: NOW,
      store: store,
    });
    expect(job.backupWatermark?.readSince).toBe(20);
    expect(job.backupWatermark?.deliveredRunIds).toEqual(["b"]);
  });

  test("a stored state from an older release, or hand-edited, never breaks a job", async () => {
    store.pools.set(PRODUCTION_ID.toString(), {
      ...pool(PRODUCTION_ID, PRODUCTION, "Production"),
      eventState: {
        openMessages: [{ id: 5 }, "x", { id: "ok", name: "ALARM" }],
        messageWatermark: { readUntil: 12 },
        backupWatermark: { readSince: "x" },
        jobVmIds: { a: [1, "vm"], b: "nope" },
      },
    });
    const job: XcpNgEventsJobState = await XcpNgPoolEventsIngest.getJobState({
      projectId: PROJECT,
      pools: [{ xcpNgPoolId: PRODUCTION_ID, poolIdentifier: PRODUCTION }],
      now: NOW,
      store: store,
    });
    expect(job.pools).toEqual([{ poolId: PRODUCTION, openMessageIds: ["ok"] }]);
    expect(job.backupWatermark).toBeUndefined();
  });
});
