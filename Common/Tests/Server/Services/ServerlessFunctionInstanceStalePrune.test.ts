import type { FindOperator } from "../../../Server/Types/Database/QueryHelper";
import ServerlessFunctionInstanceService from "../../../Server/Services/ServerlessFunctionInstanceService";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";

/*
 * Stale-instance pruning for the serverless function inventory.
 *
 * ServerlessFunctionInstance rows (faas.instance — one per warm
 * execution environment) are created by ingest and refreshed behind
 * the 5-minute maintenance fence, but nothing ever removed them, and
 * FaaS platforms mint a new environment on every cold start — so the
 * Instances tab counted every environment that ever ran the function.
 * The Serverless:CleanupStaleResources worker now ages them out through
 * the three helpers pinned here:
 *
 *   - deleteStaleForFunction issues ONE hard delete scoped to the given
 *     function AND a strictly-less-than lastSeenAt cutoff, as root (the
 *     worker has no tenant context), and returns the row count. A
 *     missing function predicate would prune every function in the
 *     table; a missing cutoff would prune warm instances.
 *   - getStaleThresholdMinutes parses SERVERLESS_INSTANCE_STALE_MINUTES
 *     with a 15-minute default and a 5-minute floor. The floor is the
 *     ingest maintenance fence TTL: a threshold at or below it would
 *     delete a live instance between two fence-gated refreshes.
 *   - getStaleThresholdDate subtracts that threshold from the anchor
 *     the worker passes (the function's own lastSeenAt), falling back
 *     to the wall clock only when no anchor is given. The worker relies
 *     on the anchor winning over the clock: that is what keeps an idle
 *     function's last-known instances from being wiped.
 */

const ENV_KEY: string = "SERVERLESS_INSTANCE_STALE_MINUTES";
const FUNCTION_ID: ObjectID = ObjectID.generate();
const CUTOFF: Date = new Date("2026-09-08T10:00:00.000Z");
const MINUTE_MS: number = 60 * 1000;

interface DeleteByArgs {
  query: {
    serverlessFunctionId?: ObjectID;
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

describe("ServerlessFunctionInstanceService.deleteStaleForFunction", () => {
  test("issues one root hard-delete scoped to the function with a lastSeenAt < cutoff predicate", async () => {
    const deleteBy: jest.SpyInstance = jest
      .spyOn(ServerlessFunctionInstanceService, "deleteBy")
      .mockResolvedValue(4);

    const deleted: number =
      await ServerlessFunctionInstanceService.deleteStaleForFunction({
        serverlessFunctionId: FUNCTION_ID,
        olderThan: CUTOFF,
      });

    expect(deleted).toBe(4);
    expect(deleteBy).toHaveBeenCalledTimes(1);

    const args: DeleteByArgs = deleteBy.mock
      .calls[0]![0] as unknown as DeleteByArgs;

    // Scoped to exactly this function — never a table-wide sweep.
    expect(args.query.serverlessFunctionId).toBe(FUNCTION_ID);

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
    jest
      .spyOn(ServerlessFunctionInstanceService, "deleteBy")
      .mockResolvedValue(0);

    const deleted: number =
      await ServerlessFunctionInstanceService.deleteStaleForFunction({
        serverlessFunctionId: FUNCTION_ID,
        olderThan: CUTOFF,
      });

    expect(deleted).toBe(0);
  });

  test("lets a delete failure propagate so the worker can log it per function and continue", async () => {
    jest
      .spyOn(ServerlessFunctionInstanceService, "deleteBy")
      .mockRejectedValue(new Error("db connection reset"));

    await expect(
      ServerlessFunctionInstanceService.deleteStaleForFunction({
        serverlessFunctionId: FUNCTION_ID,
        olderThan: CUTOFF,
      }),
    ).rejects.toThrow("db connection reset");
  });
});

describe("ServerlessFunctionInstanceService.getStaleThresholdMinutes", () => {
  test("defaults to 15 minutes — 3x the 5-minute ingest maintenance fence", () => {
    expect(ServerlessFunctionInstanceService.getStaleThresholdMinutes()).toBe(
      15,
    );
  });

  test("honours an override above the floor", () => {
    process.env[ENV_KEY] = "30";
    expect(ServerlessFunctionInstanceService.getStaleThresholdMinutes()).toBe(
      30,
    );
  });

  test("accepts the 10-minute floor itself", () => {
    process.env[ENV_KEY] = "10";
    expect(ServerlessFunctionInstanceService.getStaleThresholdMinutes()).toBe(
      10,
    );
  });

  test("ignores an override below the floor — it would prune warm instances", () => {
    for (const below of ["9", "5", "3"]) {
      process.env[ENV_KEY] = below;
      expect(ServerlessFunctionInstanceService.getStaleThresholdMinutes()).toBe(
        15,
      );
    }
  });

  test("ignores an unparseable or empty override", () => {
    process.env[ENV_KEY] = "garbage";
    expect(ServerlessFunctionInstanceService.getStaleThresholdMinutes()).toBe(
      15,
    );
    process.env[ENV_KEY] = "";
    expect(ServerlessFunctionInstanceService.getStaleThresholdMinutes()).toBe(
      15,
    );
  });
});

describe("ServerlessFunctionInstanceService.getStaleThresholdDate", () => {
  test("subtracts the threshold from the anchor the worker passes, not from the wall clock", () => {
    const anchor: Date = new Date("2026-09-08T09:00:00.000Z");
    // A wall clock years away from the anchor proves the anchor wins.
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date("2030-01-01T00:00:00.000Z"));

    const cutoff: Date =
      ServerlessFunctionInstanceService.getStaleThresholdDate(anchor);

    expect(cutoff.getTime()).toBe(anchor.getTime() - 15 * MINUTE_MS);
  });

  test("falls back to the wall clock when no anchor is given", () => {
    const now: Date = new Date("2026-09-08T10:00:00.000Z");
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(now);

    const cutoff: Date =
      ServerlessFunctionInstanceService.getStaleThresholdDate();

    expect(cutoff.getTime()).toBe(now.getTime() - 15 * MINUTE_MS);
  });

  test("applies the env override to the anchored cutoff", () => {
    process.env[ENV_KEY] = "30";
    const anchor: Date = new Date("2026-09-08T09:00:00.000Z");

    const cutoff: Date =
      ServerlessFunctionInstanceService.getStaleThresholdDate(anchor);

    expect(cutoff.getTime()).toBe(anchor.getTime() - 30 * MINUTE_MS);
  });
});
