import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import TelemetryEntityService from "../../../Server/Services/TelemetryEntityService";
import { reconcileByNaturalKey } from "../../../Server/Utils/Telemetry/EntityRegistry";
import TelemetryEntity from "../../../Models/DatabaseModels/TelemetryEntity";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The entity registry had the same defect as the Service heartbeat, one layer
 * down and harder to see.
 *
 * Its fence keys on (project + the whole set of promoted entity keys), which
 * in practice is unique per POD — a pod's own key is in the set. But the
 * writes it gates are per ROW: the single TelemetryEntity row for a Kubernetes
 * cluster receives one UPDATE per pod in that cluster per window, the
 * namespace row one per pod in the namespace. When throttle granularity is
 * finer than write granularity, the throttle does not bound the writes at all,
 * and the mismatch factor is the pod count.
 *
 * So there are now two fences: the cheap set-level one, and a per-row one
 * claimed atomically before the lookup — which also removes the redundant
 * SELECT, not just the redundant UPDATE. The bump itself is the SKIP LOCKED
 * write, so shared rows (a cluster, a namespace) cannot convoy the way Service
 * did.
 *
 * Everything external is mocked — no Postgres, no Redis.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const ROW_ID: ObjectID = ObjectID.generate();

type BumpCall = { id: ObjectID; data: Record<string, unknown> };

let cache: Map<string, string>;
let deletedKeys: Array<string>;
let bumps: Array<BumpCall>;
let reads: number;
let existing: TelemetryEntity | null;
let bumpLands: boolean;

function existingRow(): TelemetryEntity {
  const row: TelemetryEntity = new TelemetryEntity();
  row.id = ROW_ID;
  row._id = ROW_ID.toString();
  return row;
}

function reconcile(rowFenceId: string): Promise<void> {
  return reconcileByNaturalKey<TelemetryEntity>({
    service: TelemetryEntityService,
    query: { projectId: PROJECT_ID, entityKey: "k8s-cluster/prod" },
    lastSeenAt: new Date(),
    describe: "entity k8s-cluster/prod",
    rowFenceId: rowFenceId,
    buildModel: (): TelemetryEntity => {
      return existingRow();
    },
  });
}

beforeEach(() => {
  cache = new Map<string, string>();
  deletedKeys = [];
  bumps = [];
  reads = 0;
  existing = existingRow();
  bumpLands = true;

  jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockImplementation(async (namespace: string, key: string) => {
      const full: string = `${namespace}:${key}`;
      if (cache.has(full)) {
        return false;
      }
      cache.set(full, "1");
      return true;
    });

  jest
    .spyOn(GlobalCache, "deleteKey")
    .mockImplementation(async (namespace: string, key: string) => {
      const full: string = `${namespace}:${key}`;
      deletedKeys.push(full);
      cache.delete(full);
    });

  jest
    .spyOn(TelemetryEntityService, "findOneBy")
    .mockImplementation(async () => {
      reads++;
      return existing;
    });

  jest
    .spyOn(TelemetryEntityService, "updateColumnsByIdIfUnlockedWithoutHooks")
    .mockImplementation(async (input: { id: ObjectID; data: unknown }) => {
      bumps.push({
        id: input.id,
        data: { ...(input.data as Record<string, unknown>) },
      });
      return bumpLands;
    });

  jest
    .spyOn(TelemetryEntityService, "create")
    .mockImplementation(async (input: { data: TelemetryEntity }) => {
      return input.data;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("reconcileByNaturalKey — the per-row fence", () => {
  test("bumps the row on first contact", async () => {
    await reconcile("project:k8s-cluster:prod");

    expect(bumps).toHaveLength(1);
    expect(bumps[0]!.id.toString()).toBe(ROW_ID.toString());
    expect(bumps[0]!.data["lastSeenAt"]).toBeInstanceOf(Date);
  });

  /*
   * The defect, reproduced: many pods, one shared row. Before the per-row
   * fence, each pod's distinct set-level fence let it straight through to the
   * same cluster row.
   */
  test("many callers for the same row produce one bump per window", async () => {
    for (let pod: number = 0; pod < 50; pod++) {
      await reconcile("project:k8s-cluster:prod");
    }

    expect(bumps).toHaveLength(1);
  });

  /*
   * Claimed BEFORE the lookup. The redundant SELECTs were as much of the pool
   * pressure as the redundant UPDATEs.
   */
  test("a fenced caller does not even read the row", async () => {
    await reconcile("project:k8s-cluster:prod");
    const readsAfterFirst: number = reads;

    await reconcile("project:k8s-cluster:prod");

    expect(reads).toBe(readsAfterFirst);
  });

  test("different rows are fenced independently", async () => {
    await reconcile("project:k8s-cluster:prod");
    await reconcile("project:k8s-namespace:default");

    expect(bumps).toHaveLength(2);
  });

  test("claims the fence atomically, never read-then-write", async () => {
    jest.spyOn(GlobalCache, "getString");
    jest.spyOn(GlobalCache, "setString");

    await reconcile("project:k8s-cluster:prod");

    expect(GlobalCache.setStringIfNotExists).toHaveBeenCalled();
    expect(GlobalCache.getString).not.toHaveBeenCalled();
    expect(GlobalCache.setString).not.toHaveBeenCalled();
  });

  /*
   * The fence id concatenates entity keys and is unbounded in length. Hashing
   * keeps the Redis key fixed-width — a pod reporting hundreds of entities
   * would otherwise produce a multi-kilobyte key.
   */
  test("hashes the fence id to a fixed-width key", async () => {
    const longId: string = `project:${"k".repeat(5000)}`;

    await reconcile(longId);

    const key: string = (GlobalCache.setStringIfNotExists as jest.Mock).mock
      .calls[0]![1] as string;

    expect(key.length).toBeLessThan(100);
    expect(key).not.toContain("kkkk");
  });

  test("a cache outage fails open so liveness still advances", async () => {
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockRejectedValue(new Error("redis down"));

    await reconcile("project:k8s-cluster:prod");

    expect(bumps).toHaveLength(1);
  });
});

describe("reconcileByNaturalKey — contention and failure re-open the window", () => {
  test("uses the non-blocking write primitive", async () => {
    await reconcile("project:k8s-cluster:prod");

    expect(
      TelemetryEntityService.updateColumnsByIdIfUnlockedWithoutHooks,
    ).toHaveBeenCalled();
  });

  /*
   * A skipped bump means the row was locked, so nothing was written — but the
   * fence is already claimed and would suppress the next attempt for the whole
   * window. Release it so the next batch retries; each attempt is
   * non-blocking, so this cannot become a retry storm.
   */
  test("a skipped bump releases the row fence", async () => {
    bumpLands = false;

    await reconcile("project:k8s-cluster:prod");

    expect(deletedKeys).toHaveLength(1);
  });

  test("the released fence actually lets the next attempt through", async () => {
    bumpLands = false;
    await reconcile("project:k8s-cluster:prod");

    bumpLands = true;
    await reconcile("project:k8s-cluster:prod");

    expect(bumps).toHaveLength(2);
  });

  /*
   * An over-budget skip writes nothing, so holding the window would suppress
   * the gate's own re-evaluation for a decision that had no effect.
   */
  test("an over-budget create releases the row fence", async () => {
    existing = null;

    await reconcileByNaturalKey<TelemetryEntity>({
      service: TelemetryEntityService,
      query: { projectId: PROJECT_ID, entityKey: "k8s-cluster/prod" },
      lastSeenAt: new Date(),
      describe: "entity k8s-cluster/prod",
      rowFenceId: "project:k8s-cluster:prod",
      buildModel: (): TelemetryEntity => {
        return existingRow();
      },
      beforeCreate: async (): Promise<boolean> => {
        return false;
      },
    });

    expect(deletedKeys).toHaveLength(1);
  });

  test("an invalid create releases the row fence so the warning keeps surfacing", async () => {
    existing = null;

    jest
      .spyOn(TelemetryEntityService, "create")
      .mockRejectedValue(new Error("null value in column violates not-null"));

    await reconcile("project:k8s-cluster:prod");

    expect(deletedKeys).toHaveLength(1);
  });

  test("a lost create race bumps the winner instead of failing", async () => {
    existing = null;

    jest
      .spyOn(TelemetryEntityService, "create")
      .mockRejectedValue(new Error("duplicate key value violates unique"));

    jest
      .spyOn(TelemetryEntityService, "findOneBy")
      .mockImplementationOnce(async () => {
        reads++;
        return null;
      })
      .mockImplementation(async () => {
        reads++;
        return existingRow();
      });

    await reconcile("project:k8s-cluster:prod");

    expect(bumps).toHaveLength(1);
    expect(deletedKeys).toHaveLength(0);
  });

  test("a successful bump leaves the fence claimed", async () => {
    await reconcile("project:k8s-cluster:prod");

    expect(deletedKeys).toHaveLength(0);
  });
});
