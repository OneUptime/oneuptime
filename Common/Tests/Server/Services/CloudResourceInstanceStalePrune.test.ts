import type { FindOperator } from "../../../Server/Types/Database/QueryHelper";
import CloudResourceInstanceService from "../../../Server/Services/CloudResourceInstanceService";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";

/*
 * Stale-instance pruning for the cloud environment inventory.
 *
 * CloudResourceInstance rows are created by ingest and refreshed behind
 * the 5-minute maintenance fence, but nothing ever removed them — the
 * Instances tab and the overview's "running tasks" count grew forever.
 * The Cloud:CleanupStaleResources worker now ages them out through the
 * three helpers pinned here:
 *
 *   - deleteStaleForResource issues ONE hard delete scoped to the given
 *     environment AND a strictly-less-than lastSeenAt cutoff, as root
 *     (the worker has no tenant context), and returns the row count. A
 *     missing environment predicate would prune every environment in
 *     the table; a missing cutoff would prune live tasks.
 *   - getStaleThresholdMinutes parses CLOUD_INSTANCE_STALE_MINUTES with
 *     a 15-minute default and a 5-minute floor. The floor is the ingest
 *     maintenance fence TTL: a threshold at or below it would delete a
 *     live task between two fence-gated refreshes.
 *   - getStaleThresholdDate subtracts that threshold from the anchor
 *     the worker passes (the environment's own lastSeenAt), falling
 *     back to the wall clock only when no anchor is given. The worker
 *     relies on the anchor winning over the clock: that is what freezes
 *     the prune cutoff during a collector outage.
 */

const ENV_KEY: string = "CLOUD_INSTANCE_STALE_MINUTES";
const RESOURCE_ID: ObjectID = ObjectID.generate();
const CUTOFF: Date = new Date("2026-09-08T10:00:00.000Z");
const MINUTE_MS: number = 60 * 1000;

interface DeleteByArgs {
  query: {
    cloudResourceId?: ObjectID;
    lastSeenAt?: FindOperator<Date>;
  };
  limit: number;
  skip: number;
  props: { isRoot?: boolean };
}

let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (savedEnv === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = savedEnv;
  }
  jest.restoreAllMocks();
});

describe("CloudResourceInstanceService.deleteStaleForResource", () => {
  test("issues one root hard-delete scoped to the environment with a lastSeenAt < cutoff predicate", async () => {
    const deleteBy: jest.SpyInstance = jest
      .spyOn(CloudResourceInstanceService, "deleteBy")
      .mockResolvedValue(4);

    const deleted: number =
      await CloudResourceInstanceService.deleteStaleForResource({
        cloudResourceId: RESOURCE_ID,
        olderThan: CUTOFF,
      });

    expect(deleted).toBe(4);
    expect(deleteBy).toHaveBeenCalledTimes(1);

    const args: DeleteByArgs = deleteBy.mock
      .calls[0]![0] as unknown as DeleteByArgs;

    // Scoped to exactly this environment — never a table-wide sweep.
    expect(args.query.cloudResourceId).toBe(RESOURCE_ID);

    // Strictly older than the cutoff: a row refreshed AT the cutoff survives.
    const filter: FindOperator<Date> = args.query.lastSeenAt!;
    expect(filter.getSql!("lastSeenAt")).toMatch(/lastSeenAt < :/);
    expect(Object.values(filter.objectLiteralParameters!)).toEqual([CUTOFF]);

    // The worker has no tenant context, and one tick must cover the whole table.
    expect(args.props.isRoot).toBe(true);
    expect(args.limit).toBe(LIMIT_MAX);
    expect(args.skip).toBe(0);
  });

  test("reports zero when nothing was stale", async () => {
    jest.spyOn(CloudResourceInstanceService, "deleteBy").mockResolvedValue(0);

    const deleted: number =
      await CloudResourceInstanceService.deleteStaleForResource({
        cloudResourceId: RESOURCE_ID,
        olderThan: CUTOFF,
      });

    expect(deleted).toBe(0);
  });

  test("lets a delete failure propagate so the worker can log it per environment and continue", async () => {
    jest
      .spyOn(CloudResourceInstanceService, "deleteBy")
      .mockRejectedValue(new Error("db connection reset"));

    await expect(
      CloudResourceInstanceService.deleteStaleForResource({
        cloudResourceId: RESOURCE_ID,
        olderThan: CUTOFF,
      }),
    ).rejects.toThrow("db connection reset");
  });
});

describe("CloudResourceInstanceService.getStaleThresholdMinutes", () => {
  test("defaults to 15 minutes — 3x the 5-minute ingest maintenance fence", () => {
    expect(CloudResourceInstanceService.getStaleThresholdMinutes()).toBe(15);
  });

  test("honours an override above the floor", () => {
    process.env[ENV_KEY] = "30";
    expect(CloudResourceInstanceService.getStaleThresholdMinutes()).toBe(30);
  });

  test("accepts the 10-minute floor itself", () => {
    process.env[ENV_KEY] = "10";
    expect(CloudResourceInstanceService.getStaleThresholdMinutes()).toBe(10);
  });

  test("ignores an override below the floor — it would prune live tasks", () => {
    /*
     * 5 is the fence's nominal TTL, but the armed key carries jitter and a
     * negative memo sits in front of it, so a live row can be ~7 minutes
     * old; anything under 10 falls back to the default.
     */
    for (const below of ["9", "5", "3"]) {
      process.env[ENV_KEY] = below;
      expect(CloudResourceInstanceService.getStaleThresholdMinutes()).toBe(15);
    }
  });

  test("ignores an unparseable or empty override", () => {
    process.env[ENV_KEY] = "garbage";
    expect(CloudResourceInstanceService.getStaleThresholdMinutes()).toBe(15);
    process.env[ENV_KEY] = "";
    expect(CloudResourceInstanceService.getStaleThresholdMinutes()).toBe(15);
  });
});

describe("CloudResourceInstanceService.getStaleThresholdDate", () => {
  test("subtracts the threshold from the anchor the worker passes, not from the wall clock", () => {
    const anchor: Date = new Date("2026-09-08T09:00:00.000Z");
    // A wall clock years away from the anchor proves the anchor wins.
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date("2030-01-01T00:00:00.000Z"));

    const cutoff: Date =
      CloudResourceInstanceService.getStaleThresholdDate(anchor);

    expect(cutoff.getTime()).toBe(anchor.getTime() - 15 * MINUTE_MS);
  });

  test("falls back to the wall clock when no anchor is given", () => {
    const now: Date = new Date("2026-09-08T10:00:00.000Z");
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(now);

    const cutoff: Date = CloudResourceInstanceService.getStaleThresholdDate();

    expect(cutoff.getTime()).toBe(now.getTime() - 15 * MINUTE_MS);
  });

  test("applies the env override to the anchored cutoff", () => {
    process.env[ENV_KEY] = "30";
    const anchor: Date = new Date("2026-09-08T09:00:00.000Z");

    const cutoff: Date =
      CloudResourceInstanceService.getStaleThresholdDate(anchor);

    expect(cutoff.getTime()).toBe(anchor.getTime() - 30 * MINUTE_MS);
  });
});
