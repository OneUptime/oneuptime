import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import StorageArrayService, {
  STORAGE_ARRAY_SNAPSHOT_KEYS,
  StorageArraySnapshotExtras,
} from "../../../Server/Services/StorageArrayService";
import StorageArrayFeedService from "../../../Server/Services/StorageArrayFeedService";
import StorageArrayLabelRuleEngineService from "../../../Server/Services/StorageArrayLabelRuleEngineService";
import StorageArrayOwnerRuleEngineService from "../../../Server/Services/StorageArrayOwnerRuleEngineService";
import UserService from "../../../Server/Services/UserService";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import ResourceHeartbeat from "../../../Server/Utils/Telemetry/ResourceHeartbeat";
import SingleFlight from "../../../Server/Utils/SingleFlight";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import logger from "../../../Server/Utils/Logger";
import { StorageArraySnapshotDerivedExtras } from "../../../Server/Utils/Telemetry/StorageArraySnapshotScan";
import StorageArray from "../../../Models/DatabaseModels/StorageArray";
import { StorageArrayFeedEventType } from "../../../Models/DatabaseModels/StorageArrayFeed";
import Label from "../../../Models/DatabaseModels/Label";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import BadDataException from "../../../Types/Exception/BadDataException";
import crypto from "crypto";

import FeedMarkdown, {
  MarkdownText,
} from "../../../Utils/Markdown/FeedMarkdown";
/*
 * StorageArrayService — the row one Storage Array Agent reports into.
 *
 * Pinned here:
 *   - findOrCreateByName: auto-registration from `storage.array.name` is
 *     case-insensitive on lookup, preserves the configured casing on create,
 *     and re-resolves instead of throwing when the unique guard (or a racing
 *     ingest worker — an agent's array, volumes and hosts scrapes arrive at
 *     once) rejects the insert.
 *   - updateLastSeen: only present keys are written (a partial batch never
 *     zeroes a column), 0 is a value, blank strings and non-finite numbers
 *     never reach Postgres, and the heartbeat is keyed per extras SHAPE so
 *     each scrape job's batch gets its own window.
 *   - attachLabels: additive, deduplicated, fingerprint-cached.
 *   - markDisconnectedArrays: 15-minute threshold.
 *   - Feed events on create / update / archive / restore, silence on
 *     heartbeats; rule engines run label-first and can never fail a create.
 *
 * Everything external is mocked — no Postgres, no Redis.
 */

const ARRAY_ID: ObjectID = ObjectID.generate();
const PROJECT_ID: ObjectID = ObjectID.generate();
const ACTING_USER_ID: ObjectID = ObjectID.generate();

const NAMESPACE: string = "storage-array-last-seen";

interface FeedCall {
  storageArrayId: ObjectID;
  projectId: ObjectID;
  storageArrayFeedEventType: StorageArrayFeedEventType;
  feedInfoInMarkdown: string;
  moreInformationInMarkdown?: string | undefined;
  userId?: ObjectID | undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const service: any = StorageArrayService as any;

function storageArray(overrides: Partial<StorageArray>): StorageArray {
  const model: StorageArray = new StorageArray(ARRAY_ID);
  model.projectId = PROJECT_ID;
  model.name = "pure-prod-01";
  Object.assign(model, overrides);
  return model;
}

// The heartbeat namespace the service derives for a set of written keys.
function shapeNamespace(keys: Array<string>): string {
  return `${NAMESPACE}-${crypto
    .createHash("sha1")
    .update(keys.join(","))
    .digest("hex")
    .substring(0, 12)}`;
}

/** Let the fire-and-forget rule/feed chain drain before asserting on it. */
function flushPromises(): Promise<void> {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("StorageArrayService.findOrCreateByName", () => {
  test("returns the existing row from a case-insensitive lookup without creating", async () => {
    const existing: StorageArray = storageArray({ name: "Pure-Prod-01" });
    const findOneBy: jest.SpyInstance = jest
      .spyOn(StorageArrayService, "findOneBy")
      .mockResolvedValue(existing);
    const create: jest.SpyInstance = jest
      .spyOn(StorageArrayService, "create")
      .mockResolvedValue(existing);
    const sameText: jest.SpyInstance = jest.spyOn(
      QueryHelper,
      "findWithSameText",
    );

    const result: StorageArray = await StorageArrayService.findOrCreateByName({
      projectId: PROJECT_ID,
      name: "  pure-prod-01 ",
    });

    expect(result).toBe(existing);
    expect(create).not.toHaveBeenCalled();
    expect(findOneBy).toHaveBeenCalledTimes(1);
    // The lookup goes through the case-insensitive helper with the trimmed name.
    expect(sameText).toHaveBeenCalledWith("pure-prod-01");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call: any = findOneBy.mock.calls[0]![0];
    expect(call.query.projectId).toBe(PROJECT_ID);
    expect(call.props.isRoot).toBe(true);
    expect(call.select).toEqual({ _id: true, projectId: true, name: true });
  });

  test("creates with the configured casing preserved, marked connected and seen now", async () => {
    jest.spyOn(StorageArrayService, "findOneBy").mockResolvedValue(null);
    const create: jest.SpyInstance = jest
      .spyOn(StorageArrayService, "create")
      .mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (input: any): Promise<StorageArray> => {
          return input.data as StorageArray;
        },
      );

    const before: number = Date.now();
    const result: StorageArray = await StorageArrayService.findOrCreateByName({
      projectId: PROJECT_ID,
      name: " Pure-Prod-01 ",
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].props.isRoot).toBe(true);
    expect(result.name).toBe("Pure-Prod-01");
    expect(result.projectId).toBe(PROJECT_ID);
    expect(result.otelCollectorStatus).toBe("connected");
    expect(result.lastSeenAt).toBeInstanceOf(Date);
    expect(result.lastSeenAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  test("re-resolves instead of throwing when a racing worker's insert wins", async () => {
    const winner: StorageArray = storageArray({ name: "pure-prod-01" });
    const findOneBy: jest.SpyInstance = jest
      .spyOn(StorageArrayService, "findOneBy")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    jest
      .spyOn(StorageArrayService, "create")
      .mockRejectedValue(new Error("storage array with this name exists"));

    const result: StorageArray = await StorageArrayService.findOrCreateByName({
      projectId: PROJECT_ID,
      name: "PURE-PROD-01",
    });

    expect(result).toBe(winner);
    expect(findOneBy).toHaveBeenCalledTimes(2);
    // The re-fetch is case-insensitive too.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const refetch: any = findOneBy.mock.calls[1]![0];
    expect(refetch.query.projectId).toBe(PROJECT_ID);
    expect(refetch.props.isRoot).toBe(true);
  });

  test("throws only when the row is still missing after the race re-fetch", async () => {
    jest.spyOn(StorageArrayService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(StorageArrayService, "create")
      .mockRejectedValue(new Error("database is on fire"));

    await expect(
      StorageArrayService.findOrCreateByName({
        projectId: PROJECT_ID,
        name: "pure-prod-01",
      }),
    ).rejects.toThrow("Failed to create or find storage array: pure-prod-01");
  });
});

describe("StorageArrayService.updateLastSeen", () => {
  type WriteCall = { id: ObjectID; data: Record<string, unknown> };

  let writes: Array<WriteCall>;
  let cache: Map<string, string>;

  /** A faithful in-memory Redis for the two atomic gate primitives. */
  function mockCache(): void {
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockImplementation(async (ns: string, key: string, value: string) => {
        const full: string = `${ns}:${key}`;
        if (cache.has(full)) {
          return false;
        }
        cache.set(full, value);
        return true;
      });
    jest
      .spyOn(GlobalCache, "setStringIfChanged")
      .mockImplementation(async (ns: string, key: string, value: string) => {
        const full: string = `${ns}:${key}`;
        if (cache.get(full) === value) {
          return false;
        }
        cache.set(full, value);
        return true;
      });
    jest
      .spyOn(GlobalCache, "deleteKey")
      .mockImplementation(async (ns: string, key: string) => {
        cache.delete(`${ns}:${key}`);
      });
  }

  function lastWrite(): Record<string, unknown> {
    return writes[writes.length - 1]!.data;
  }

  function livenessNamespaces(): Array<string> {
    // The liveness key is "<namespace>:<id>"; its gates add a suffix.
    return Array.from(cache.keys())
      .filter((key: string) => {
        return (
          key.endsWith(`:${ARRAY_ID.toString()}`) &&
          !key.includes("-fingerprint:") &&
          !key.includes("-write-window:")
        );
      })
      .map((key: string) => {
        return key.substring(0, key.lastIndexOf(":"));
      })
      .sort();
  }

  beforeEach(() => {
    writes = [];
    cache = new Map<string, string>();
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
    mockCache();
    jest
      .spyOn(StorageArrayService, "updateColumnsByIdIfUnlockedWithoutHooks")
      .mockImplementation(async (input: { id: ObjectID; data: unknown }) => {
        writes.push({
          id: input.id,
          data: { ...(input.data as Record<string, unknown>) },
        });
        return true;
      });
  });

  afterEach(() => {
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
  });

  test("writes liveness alone when no extras are supplied", async () => {
    await StorageArrayService.updateLastSeen(ARRAY_ID);

    expect(writes).toHaveLength(1);
    expect(writes[0]!.id.toString()).toBe(ARRAY_ID.toString());
    expect(Object.keys(lastWrite()).sort()).toEqual([
      "lastSeenAt",
      "otelCollectorStatus",
    ]);
    expect(lastWrite()["otelCollectorStatus"]).toBe("connected");
    expect(lastWrite()["lastSeenAt"]).toBeInstanceOf(Date);
    // No extras: the bare namespace.
    expect(livenessNamespaces()).toEqual([NAMESPACE]);
  });

  test("writes every snapshot column, and 0 is a value", async () => {
    const extras: Required<StorageArraySnapshotExtras> = {
      storageSystem: StorageSystem.PureStorageFlashArray,
      reportedName: "pure-prod-01",
      systemId: "6f2c9e1a",
      osName: "Purity//FA",
      osVersion: "6.7.3",
      agentVersion: "0.161.0",
      capacityBytes: 109951162777600,
      usedBytes: 0,
      capacityUsedPercent: 0,
      dataReductionRatio: 4.26,
      openAlertCount: 0,
      criticalAlertCount: 0,
      warningAlertCount: 0,
      volumeCount: 0,
      hostCount: 0,
      podCount: 0,
      fileSystemCount: 0,
      bucketCount: 0,
      hardwareComponentCount: 42,
      unhealthyHardwareCount: 0,
      healthStatus: 0,
    };
    await StorageArrayService.updateLastSeen(ARRAY_ID, extras);

    expect(writes).toHaveLength(1);
    expect(lastWrite()).toEqual({
      lastSeenAt: expect.any(Date),
      otelCollectorStatus: "connected",
      ...extras,
    });
  });

  test("every snapshot key is a StorageArray column, listed once", () => {
    const columns: Array<string> = new StorageArray().getTableColumns().columns;
    expect(new Set(STORAGE_ARRAY_SNAPSHOT_KEYS).size).toBe(
      STORAGE_ARRAY_SNAPSHOT_KEYS.length,
    );
    for (const key of STORAGE_ARRAY_SNAPSHOT_KEYS) {
      expect(columns).toContain(key);
    }
  });

  test("every column the snapshot scan derives is a key updateLastSeen writes", () => {
    // A derived key missing from STORAGE_ARRAY_SNAPSHOT_KEYS is silently dropped.
    const derived: Required<StorageArraySnapshotDerivedExtras> = {
      storageSystem: "",
      reportedName: "",
      systemId: "",
      osName: "",
      osVersion: "",
      capacityBytes: 0,
      usedBytes: 0,
      capacityUsedPercent: 0,
      dataReductionRatio: 0,
      openAlertCount: 0,
      criticalAlertCount: 0,
      warningAlertCount: 0,
      volumeCount: 0,
      hostCount: 0,
      podCount: 0,
      fileSystemCount: 0,
      bucketCount: 0,
      hardwareComponentCount: 0,
      unhealthyHardwareCount: 0,
      healthStatus: 0,
    };
    for (const key of Object.keys(derived)) {
      expect(STORAGE_ARRAY_SNAPSHOT_KEYS).toContain(key);
    }
  });

  test("a missing key is not written, so a partial batch never zeroes a column", async () => {
    await StorageArrayService.updateLastSeen(ARRAY_ID, {
      storageSystem: StorageSystem.PureStorageFlashArray,
      volumeCount: 12,
      // No alert or capacity series in a volumes batch: absent, not 0.
    });

    const data: Record<string, unknown> = lastWrite();
    expect(data["volumeCount"]).toBe(12);
    expect(data["storageSystem"]).toBe(StorageSystem.PureStorageFlashArray);
    for (const column of STORAGE_ARRAY_SNAPSHOT_KEYS) {
      if (column !== "volumeCount" && column !== "storageSystem") {
        expect(column in data).toBe(false);
      }
    }
  });

  test.each([
    ["an empty string", ""],
    ["a blank string", "   "],
  ])(
    "%s is never written over the last good value",
    async (_: string, blank: string) => {
      await StorageArrayService.updateLastSeen(ARRAY_ID, {
        reportedName: blank,
        osVersion: blank,
        agentVersion: blank,
        volumeCount: 3,
      });

      const data: Record<string, unknown> = lastWrite();
      expect("reportedName" in data).toBe(false);
      expect("osVersion" in data).toBe(false);
      expect("agentVersion" in data).toBe(false);
      expect(data["volumeCount"]).toBe(3);
    },
  );

  test.each([
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
  ])("%s never reaches Postgres", async (_: string, value: number) => {
    await StorageArrayService.updateLastSeen(ARRAY_ID, {
      capacityUsedPercent: value,
      volumeCount: value,
      hostCount: 2,
    });

    const data: Record<string, unknown> = lastWrite();
    expect("capacityUsedPercent" in data).toBe(false);
    expect("volumeCount" in data).toBe(false);
    expect(data["hostCount"]).toBe(2);
  });

  test("an identical snapshot inside the window costs no second write", async () => {
    const extras: StorageArraySnapshotExtras = {
      storageSystem: StorageSystem.PureStorageFlashArray,
      volumeCount: 12,
    };
    await StorageArrayService.updateLastSeen(ARRAY_ID, extras);
    SingleFlight.clear();
    await StorageArrayService.updateLastSeen(ARRAY_ID, extras);

    expect(writes).toHaveLength(1);
  });

  test("gauges that move every scrape cannot force a write per batch", async () => {
    for (let scrape: number = 0; scrape < 20; scrape++) {
      SingleFlight.clear();
      await StorageArrayService.updateLastSeen(ARRAY_ID, {
        storageSystem: StorageSystem.PureStorageFlashArray,
        capacityUsedPercent: 70 + scrape / 100,
        usedBytes: 70_000_000_000_000 + scrape * 1_048_576,
      });
    }

    expect(writes.length).toBeLessThanOrEqual(2);
  });

  test("the heartbeat namespace is keyed by the SHAPE of the extras: the set of keys written", async () => {
    await StorageArrayService.updateLastSeen(ARRAY_ID, {
      storageSystem: StorageSystem.PureStorageFlashArray,
      volumeCount: 12,
    });

    expect(livenessNamespaces()).toEqual([
      shapeNamespace(["storageSystem", "volumeCount"]),
    ]);
  });

  test("the same keys with different values share one namespace", async () => {
    await StorageArrayService.updateLastSeen(ARRAY_ID, {
      storageSystem: StorageSystem.PureStorageFlashArray,
      volumeCount: 12,
    });
    SingleFlight.clear();
    await StorageArrayService.updateLastSeen(ARRAY_ID, {
      storageSystem: StorageSystem.PureStorageFlashArray,
      volumeCount: 13,
    });

    expect(livenessNamespaces()).toHaveLength(1);
  });

  test("a value that is not written does not change the shape", async () => {
    // A blank or non-finite value is dropped, so it must not open a window.
    await StorageArrayService.updateLastSeen(ARRAY_ID, {
      storageSystem: StorageSystem.PureStorageFlashArray,
      volumeCount: 12,
    });
    SingleFlight.clear();
    await StorageArrayService.updateLastSeen(ARRAY_ID, {
      storageSystem: StorageSystem.PureStorageFlashArray,
      volumeCount: 12,
      reportedName: "",
      capacityUsedPercent: NaN,
    });

    expect(livenessNamespaces()).toEqual([
      shapeNamespace(["storageSystem", "volumeCount"]),
    ]);
    expect(writes).toHaveLength(1);
  });

  test("the shape ignores the order keys were passed in", async () => {
    await StorageArrayService.updateLastSeen(ARRAY_ID, {
      volumeCount: 1,
      storageSystem: StorageSystem.PureStorageFlashArray,
    });
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
    await StorageArrayService.updateLastSeen(ARRAY_ID, {
      storageSystem: StorageSystem.PureStorageFlashArray,
      volumeCount: 1,
    });
    expect(livenessNamespaces()).toHaveLength(1);
  });

  test("each scrape job's batch lands in the same window: the volumes and the hosts counts are both written", async () => {
    /*
     * With one key for every shape, the first batch of the window claimed
     * the enrichment gate and the next scrape job's counts were dropped —
     * volumeCount went stale for as long as the volumes batch arrived second.
     */
    await StorageArrayService.updateLastSeen(ARRAY_ID, {
      storageSystem: StorageSystem.PureStorageFlashArray,
      openAlertCount: 0,
      capacityUsedPercent: 70,
    });
    SingleFlight.clear();
    await StorageArrayService.updateLastSeen(ARRAY_ID, {
      storageSystem: StorageSystem.PureStorageFlashArray,
      volumeCount: 12,
    });
    SingleFlight.clear();
    await StorageArrayService.updateLastSeen(ARRAY_ID, {
      storageSystem: StorageSystem.PureStorageFlashArray,
      hostCount: 4,
    });

    expect(writes).toHaveLength(3);
    expect(writes[0]!.data["openAlertCount"]).toBe(0);
    expect(writes[1]!.data["volumeCount"]).toBe(12);
    expect(writes[2]!.data["hostCount"]).toBe(4);
    expect(livenessNamespaces()).toEqual(
      [
        shapeNamespace([
          "storageSystem",
          "capacityUsedPercent",
          "openAlertCount",
        ]),
        shapeNamespace(["storageSystem", "volumeCount"]),
        shapeNamespace(["storageSystem", "hostCount"]),
      ].sort(),
    );
  });

  test("uses its own namespace, distinct from the Ceph cluster one", async () => {
    await StorageArrayService.updateLastSeen(ARRAY_ID);

    expect(cache.has(`${NAMESPACE}:${ARRAY_ID.toString()}`)).toBe(true);
    expect(cache.has(`ceph-cluster-last-seen:${ARRAY_ID.toString()}`)).toBe(
      false,
    );
  });
});

describe("StorageArrayService.attachLabels", () => {
  interface Builder {
    loaded: Array<Label>;
    added: Array<Array<string>>;
    of: Array<string>;
    relation: Array<[unknown, string]>;
    failLoad: boolean;
  }

  let builder: Builder;
  let cached: Map<string, string>;
  let setString: jest.SpyInstance;

  function label(id: ObjectID): Label {
    const model: Label = new Label(id);
    return model;
  }

  beforeEach(() => {
    builder = { loaded: [], added: [], of: [], relation: [], failLoad: false };
    cached = new Map<string, string>();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queryBuilder: any = {
      createQueryBuilder: () => {
        return queryBuilder;
      },
      relation: (target: unknown, name: string) => {
        builder.relation.push([target, name]);
        return queryBuilder;
      },
      of: (id: string) => {
        builder.of.push(id);
        return queryBuilder;
      },
      loadMany: async () => {
        if (builder.failLoad) {
          throw new Error("connection terminated");
        }
        return builder.loaded;
      },
      add: async (ids: Array<string>) => {
        builder.added.push([...ids]);
      },
    };
    jest
      .spyOn(StorageArrayService, "getRepository")
      .mockReturnValue(queryBuilder);
    jest
      .spyOn(GlobalCache, "getString")
      .mockImplementation(async (ns: string, key: string) => {
        return cached.get(`${ns}:${key}`) ?? null;
      });
    setString = jest
      .spyOn(GlobalCache, "setString")
      .mockImplementation(async (ns: string, key: string, value: string) => {
        cached.set(`${ns}:${key}`, value);
      });
    jest.spyOn(logger, "warn").mockImplementation(() => {
      return undefined as never;
    });
  });

  test("an empty label set does nothing at all", async () => {
    await StorageArrayService.attachLabels({
      storageArrayId: ARRAY_ID,
      labelIds: [],
    });
    expect(builder.relation).toHaveLength(0);
    expect(GlobalCache.getString).not.toHaveBeenCalled();
  });

  test("adds only the labels not already attached, once each, through the labels relation", async () => {
    const existing: ObjectID = ObjectID.generate();
    const fresh: ObjectID = ObjectID.generate();
    builder.loaded = [label(existing)];

    await StorageArrayService.attachLabels({
      storageArrayId: ARRAY_ID,
      labelIds: [existing, fresh, fresh],
    });

    expect(builder.relation[0]).toEqual([StorageArray, "labels"]);
    expect(builder.of).toContain(ARRAY_ID.toString());
    expect(builder.added).toEqual([[fresh.toString()]]);
    expect(setString).toHaveBeenCalledWith(
      "storage-array-labels-applied",
      ARRAY_ID.toString(),
      expect.any(String),
      { expiresInSeconds: 60 },
    );
  });

  test("nothing new to add: no write, but the fingerprint is cached", async () => {
    const existing: ObjectID = ObjectID.generate();
    builder.loaded = [label(existing)];

    await StorageArrayService.attachLabels({
      storageArrayId: ARRAY_ID,
      labelIds: [existing],
    });

    expect(builder.added).toHaveLength(0);
    expect(setString).toHaveBeenCalledTimes(1);
  });

  test("the same label set again within the TTL costs one cache read and no query", async () => {
    const a: ObjectID = ObjectID.generate();
    const b: ObjectID = ObjectID.generate();

    await StorageArrayService.attachLabels({
      storageArrayId: ARRAY_ID,
      labelIds: [a, b],
    });
    const relationsAfterFirst: number = builder.relation.length;

    // Same set, other order: the fingerprint is order-insensitive.
    await StorageArrayService.attachLabels({
      storageArrayId: ARRAY_ID,
      labelIds: [b, a],
    });

    expect(builder.relation.length).toBe(relationsAfterFirst);
    expect(setString).toHaveBeenCalledTimes(1);
  });

  test("a different label set busts the cache", async () => {
    await StorageArrayService.attachLabels({
      storageArrayId: ARRAY_ID,
      labelIds: [ObjectID.generate()],
    });
    await StorageArrayService.attachLabels({
      storageArrayId: ARRAY_ID,
      labelIds: [ObjectID.generate()],
    });
    expect(builder.added).toHaveLength(2);
  });

  test("a failure is logged, never thrown, and never cached", async () => {
    builder.failLoad = true;

    await expect(
      StorageArrayService.attachLabels({
        storageArrayId: ARRAY_ID,
        labelIds: [ObjectID.generate()],
      }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("StorageArrayService.attachLabels failed"),
    );
    expect(setString).not.toHaveBeenCalled();
  });
});

describe("StorageArrayService.markDisconnectedArrays", () => {
  test("flips connected arrays unseen for 15 minutes to disconnected", async () => {
    const staleA: ObjectID = ObjectID.generate();
    const staleB: ObjectID = ObjectID.generate();
    const findBy: jest.SpyInstance = jest
      .spyOn(StorageArrayService, "findBy")
      .mockResolvedValue([
        storageArray({ _id: staleA.toString() }),
        storageArray({ _id: staleB.toString() }),
      ]);
    const updateOneById: jest.SpyInstance = jest
      .spyOn(StorageArrayService, "updateOneById")
      .mockResolvedValue(undefined as never);
    const lessThan: jest.SpyInstance = jest.spyOn(QueryHelper, "lessThan");

    const before: number = Date.now();
    await StorageArrayService.markDisconnectedArrays();
    const after: number = Date.now();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = findBy.mock.calls[0]![0].query;
    expect(query.otelCollectorStatus).toBe("connected");
    expect(findBy.mock.calls[0]![0].props.isRoot).toBe(true);

    /*
     * The threshold must stay well above the 5-minute ingest maintenance
     * fence and the agent's slowest regular scrape (2 minutes) — a
     * threshold equal to the fence flaps healthy arrays.
     */
    expect(lessThan).toHaveBeenCalledTimes(1);
    const threshold: Date = lessThan.mock.calls[0]![0] as Date;
    const fifteenMinutes: number = 15 * 60 * 1000;
    expect(before - threshold.getTime()).toBeGreaterThanOrEqual(
      fifteenMinutes - 1000,
    );
    expect(after - threshold.getTime()).toBeLessThanOrEqual(
      fifteenMinutes + 1000,
    );

    expect(updateOneById).toHaveBeenCalledTimes(2);
    expect(
      updateOneById.mock.calls.map((call: Array<unknown>) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (call[0] as any).id.toString();
      }),
    ).toEqual([staleA.toString(), staleB.toString()]);
    for (const call of updateOneById.mock.calls) {
      expect(call[0].data).toEqual({ otelCollectorStatus: "disconnected" });
      expect(call[0].props.isRoot).toBe(true);
    }
  });

  test("does nothing when every connected array has been seen recently", async () => {
    jest.spyOn(StorageArrayService, "findBy").mockResolvedValue([]);
    const updateOneById: jest.SpyInstance = jest
      .spyOn(StorageArrayService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await StorageArrayService.markDisconnectedArrays();

    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("skips a row the query returned without an id", async () => {
    const orphan: StorageArray = new StorageArray();
    jest.spyOn(StorageArrayService, "findBy").mockResolvedValue([orphan]);
    const updateOneById: jest.SpyInstance = jest
      .spyOn(StorageArrayService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await StorageArrayService.markDisconnectedArrays();

    expect(updateOneById).not.toHaveBeenCalled();
  });
});

describe("StorageArrayService names and links", () => {
  test("links to <dashboard>/<projectId>/storage-arrays/<id>", async () => {
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(
        URL.fromString("https://oneuptime.example.com/dashboard"),
      );

    const link: URL = await StorageArrayService.getStorageArrayLinkInDashboard(
      PROJECT_ID,
      ARRAY_ID,
    );

    expect(link.toString()).toContain(
      `/dashboard/${PROJECT_ID.toString()}/storage-arrays/${ARRAY_ID.toString()}`,
    );
  });

  test("renders [Storage Array <name>](<link>)", async () => {
    jest
      .spyOn(StorageArrayService, "findOneById")
      .mockResolvedValue(storageArray({ name: "pure-prod-01" }));
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(
        URL.fromString("https://oneuptime.example.com/dashboard"),
      );

    const link: string = (
      await StorageArrayService.getStorageArrayMarkdownLink(
        PROJECT_ID,
        ARRAY_ID,
      )
    ).toString();

    expect(link.startsWith("[Storage Array pure-prod-01](")).toBe(true);
    expect(link).toContain(
      `/dashboard/${PROJECT_ID.toString()}/storage-arrays/${ARRAY_ID.toString()}`,
    );
    expect(link.endsWith(")")).toBe(true);
  });

  test("names a deleted array with an empty string instead of throwing", async () => {
    const findOneById: jest.SpyInstance = jest
      .spyOn(StorageArrayService, "findOneById")
      .mockResolvedValue(null);

    await expect(
      StorageArrayService.getStorageArrayName({ storageArrayId: ARRAY_ID }),
    ).resolves.toBe("");
    expect(findOneById.mock.calls[0]![0].props.isRoot).toBe(true);
  });
});

describe("StorageArrayService rename guard", () => {
  test("a person's blank rename is refused in storage-array words", async () => {
    await expect(
      service.onBeforeUpdateUniqueCheck({
        query: { _id: ARRAY_ID.toString() },
        data: { name: "   " },
        props: { userId: ACTING_USER_ID },
      }),
    ).rejects.toThrow(
      new BadDataException(
        "Enter the name this storage array's telemetry reports.",
      ),
    );
  });

  test("ingest (root) writes are not held to it", async () => {
    await expect(
      service.onBeforeUpdateUniqueCheck({
        query: { _id: ARRAY_ID.toString() },
        data: { name: "   " },
        props: { isRoot: true },
      }),
    ).resolves.toBeUndefined();
  });

  test("a rename is trimmed before it is checked and saved", async () => {
    jest.spyOn(StorageArrayService, "findBy").mockResolvedValue([]);
    const updateBy: {
      query: Record<string, unknown>;
      data: { name: string };
      props: Record<string, unknown>;
    } = {
      query: { _id: ARRAY_ID.toString() },
      data: { name: "  pure-prod-02  " },
      props: { userId: ACTING_USER_ID },
    };

    await service.onBeforeUpdateUniqueCheck(updateBy);

    expect(updateBy.data.name).toBe("pure-prod-02");
  });
});

describe("StorageArray feed events", () => {
  let feedCalls: Array<FeedCall>;

  beforeEach(() => {
    feedCalls = [];

    jest
      .spyOn(StorageArrayFeedService, "createStorageArrayFeedItem")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((data: any): Promise<void> => {
        feedCalls.push(data as FeedCall);
        return Promise.resolve();
      });

    jest
      .spyOn(StorageArrayService, "getStorageArrayMarkdownLink")
      .mockImplementation((): Promise<MarkdownText> => {
        return Promise.resolve(
          FeedMarkdown.asMarkdown(
            "[Storage Array pure-prod-01](https://example.com/storage-arrays/x)",
          ),
        );
      });

    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockImplementation((): Promise<MarkdownText> => {
        return Promise.resolve(
          FeedMarkdown.asMarkdown("Jane Doe (jane@example.com)"),
        );
      });

    jest
      .spyOn(StorageArrayService, "findOneById")
      .mockImplementation((): Promise<StorageArray | null> => {
        return Promise.resolve(storageArray({}));
      });
  });

  test("a dashboard create is attributed to the acting user", async () => {
    await service.writeStorageArrayCreatedFeed(storageArray({}), {
      createBy: { props: { userId: ACTING_USER_ID } },
    });

    expect(feedCalls).toHaveLength(1);
    expect(feedCalls[0]!.storageArrayFeedEventType).toBe(
      StorageArrayFeedEventType.StorageArrayCreated,
    );
    expect(feedCalls[0]!.storageArrayId.toString()).toBe(ARRAY_ID.toString());
    expect(feedCalls[0]!.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(feedCalls[0]!.feedInfoInMarkdown).toContain("Jane Doe");
    expect(feedCalls[0]!.feedInfoInMarkdown).toContain(
      "[Storage Array pure-prod-01]",
    );
    expect(feedCalls[0]!.moreInformationInMarkdown).toContain(
      "**Automatically created from telemetry**: No.",
    );
    expect(feedCalls[0]!.userId).toBe(ACTING_USER_ID);
  });

  test("an ingest create says telemetry registered it", async () => {
    await service.writeStorageArrayCreatedFeed(storageArray({}), {
      createBy: { props: { isRoot: true } },
    });

    expect(feedCalls).toHaveLength(1);
    expect(feedCalls[0]!.moreInformationInMarkdown).toContain(
      "**Automatically created from telemetry**: Yes.",
    );
    expect(feedCalls[0]!.moreInformationInMarkdown).toContain(
      "OneUptime created this storage array on its own.",
    );
    expect(feedCalls[0]!.userId).toBeUndefined();
  });

  test("writes nothing for a row with no project", async () => {
    await service.writeStorageArrayCreatedFeed(new StorageArray(ARRAY_ID), {
      createBy: { props: {} },
    });

    expect(feedCalls).toHaveLength(0);
  });

  test("stays silent for a heartbeat carrying every snapshot column", async () => {
    await service.writeStorageArrayUpdatedFeed(
      {
        updateBy: {
          data: {
            lastSeenAt: new Date(),
            otelCollectorStatus: "connected",
            storageSystem: StorageSystem.PureStorageFlashArray,
            reportedName: "pure-prod-01",
            systemId: "6f2c9e1a",
            osName: "Purity//FA",
            osVersion: "6.7.3",
            agentVersion: "0.161.0",
            capacityBytes: 109951162777600,
            usedBytes: 76965813944320,
            capacityUsedPercent: 70,
            dataReductionRatio: 4.26,
            openAlertCount: 1,
            criticalAlertCount: 0,
            warningAlertCount: 1,
            volumeCount: 12,
            hostCount: 4,
            podCount: 1,
            fileSystemCount: 0,
            bucketCount: 0,
            hardwareComponentCount: 42,
            unhealthyHardwareCount: 1,
            healthStatus: 1,
          },
          props: {},
        },
      },
      [ARRAY_ID],
    );

    expect(feedCalls).toHaveLength(0);
  });

  test("records a rename and names the field", async () => {
    await service.writeStorageArrayUpdatedFeed(
      {
        updateBy: {
          data: { name: "pure-prod-02", lastSeenAt: new Date() },
          props: { userId: ACTING_USER_ID },
        },
      },
      [ARRAY_ID],
    );

    expect(feedCalls).toHaveLength(1);
    expect(feedCalls[0]!.storageArrayFeedEventType).toBe(
      StorageArrayFeedEventType.StorageArrayUpdated,
    );
    expect(feedCalls[0]!.moreInformationInMarkdown).toContain("`name`");
    expect(feedCalls[0]!.moreInformationInMarkdown).not.toContain(
      "`lastSeenAt`",
    );
    expect(feedCalls[0]!.userId).toBe(ACTING_USER_ID);
  });

  test("archiving and restoring get their own events", async () => {
    await service.writeStorageArrayUpdatedFeed(
      { updateBy: { data: { isArchived: true }, props: {} } },
      [ARRAY_ID],
    );

    expect(
      feedCalls.map((call: FeedCall) => {
        return call.storageArrayFeedEventType;
      }),
    ).toEqual([StorageArrayFeedEventType.StorageArrayArchived]);
    expect(feedCalls[0]!.feedInfoInMarkdown).toContain("was archived");

    feedCalls = [];

    await service.writeStorageArrayUpdatedFeed(
      { updateBy: { data: { isArchived: false }, props: {} } },
      [ARRAY_ID],
    );

    expect(
      feedCalls.map((call: FeedCall) => {
        return call.storageArrayFeedEventType;
      }),
    ).toEqual([StorageArrayFeedEventType.StorageArrayRestored]);
    expect(feedCalls[0]!.feedInfoInMarkdown).toContain("restored");
  });

  test("an archive that also renames records both, and not as one muddled entry", async () => {
    await service.writeStorageArrayUpdatedFeed(
      {
        updateBy: {
          data: { isArchived: true, name: "retired-array" },
          props: {},
        },
      },
      [ARRAY_ID],
    );

    expect(
      feedCalls.map((call: FeedCall) => {
        return call.storageArrayFeedEventType;
      }),
    ).toEqual([
      StorageArrayFeedEventType.StorageArrayArchived,
      StorageArrayFeedEventType.StorageArrayUpdated,
    ]);
    expect(feedCalls[1]!.moreInformationInMarkdown).toContain("`name`");
    expect(feedCalls[1]!.moreInformationInMarkdown).not.toContain(
      "`isArchived`",
    );
  });

  test("one feed item per updated array", async () => {
    const other: ObjectID = ObjectID.generate();
    await service.writeStorageArrayUpdatedFeed(
      { updateBy: { data: { description: "tier-1" }, props: {} } },
      [ARRAY_ID, other],
    );

    expect(
      feedCalls.map((call: FeedCall) => {
        return call.storageArrayId.toString();
      }),
    ).toEqual([ARRAY_ID.toString(), other.toString()]);
  });

  test("skips a row it can no longer resolve a project for", async () => {
    jest
      .spyOn(StorageArrayService, "findOneById")
      .mockImplementation((): Promise<StorageArray | null> => {
        return Promise.resolve(null);
      });

    await service.writeStorageArrayUpdatedFeed(
      { updateBy: { data: { name: "gone" }, props: {} } },
      [ARRAY_ID],
    );

    expect(feedCalls).toHaveLength(0);
  });

  test("onUpdateSuccess never lets a failing feed write fail the update", async () => {
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });
    jest
      .spyOn(service, "writeStorageArrayUpdatedFeed")
      .mockImplementation((): Promise<void> => {
        return Promise.reject(new Error("feed write blew up"));
      });

    const onUpdate: {
      updateBy: { data: { name: string }; props: Record<string, unknown> };
    } = {
      updateBy: { data: { name: "x" }, props: {} },
    };

    await expect(service.onUpdateSuccess(onUpdate, [ARRAY_ID])).resolves.toBe(
      onUpdate,
    );
  });
});

describe("StorageArrayService.onCreateSuccess", () => {
  let order: Array<string>;

  beforeEach(() => {
    order = [];
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });
    jest
      .spyOn(StorageArrayLabelRuleEngineService, "applyRulesToStorageArray")
      .mockImplementation(async (): Promise<void> => {
        order.push("label");
      });
    jest
      .spyOn(StorageArrayOwnerRuleEngineService, "applyRulesToStorageArray")
      .mockImplementation(async (): Promise<void> => {
        order.push("owner");
      });
    jest
      .spyOn(service, "writeStorageArrayCreatedFeed")
      .mockImplementation(async (): Promise<void> => {
        order.push("feed");
      });
  });

  test("runs the label-rule engine before the owner-rule engine so owner rules can match rule-added labels", async () => {
    const created: StorageArray = storageArray({});

    await expect(
      service.onCreateSuccess({ createBy: { props: {} } }, created),
    ).resolves.toBe(created);
    await flushPromises();

    expect(order.indexOf("label")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("owner")).toBeGreaterThan(order.indexOf("label"));
    expect(order).toContain("feed");
    expect(
      StorageArrayLabelRuleEngineService.applyRulesToStorageArray,
    ).toHaveBeenCalledWith(created);
    expect(
      StorageArrayOwnerRuleEngineService.applyRulesToStorageArray,
    ).toHaveBeenCalledWith(created);
  });

  test("skips the rule engines for a row without a project, but still writes the feed", async () => {
    const created: StorageArray = new StorageArray(ARRAY_ID);

    await service.onCreateSuccess({ createBy: { props: {} } }, created);
    await flushPromises();

    expect(order).toEqual(["feed"]);
  });

  test("a failing rule engine or feed write cannot fail the create", async () => {
    jest
      .spyOn(StorageArrayLabelRuleEngineService, "applyRulesToStorageArray")
      .mockRejectedValue(new Error("label engine down"));
    jest
      .spyOn(service, "writeStorageArrayCreatedFeed")
      .mockRejectedValue(new Error("feed write blew up"));

    const created: StorageArray = storageArray({});

    await expect(
      service.onCreateSuccess({ createBy: { props: {} } }, created),
    ).resolves.toBe(created);
    await flushPromises();

    // The chain stops at the first failure; the owner engine never runs.
    expect(order).not.toContain("owner");
  });
});
