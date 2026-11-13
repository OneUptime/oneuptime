import {
  NetworkDevicePollVerdict,
  Service as NetworkDeviceServiceType,
} from "../../../Server/Services/NetworkDeviceService";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * NetworkDeviceService.writePollVerdict: what one poll found about a device's
 * health, written only when the device holds no verdict from a poll received
 * after it (OneUptime issue #7389).
 *
 * During a queue backlog a poll can wait many minutes for a worker, and two
 * polls of one device are not always processed in the order they were
 * received: a retried job goes back behind the backlog, and one job can wait
 * longer than the poll after it. The poll processed last used to win, so an
 * older poll put its reachability back over a newer one's.
 *
 * These pin the statement's shape against a mocked query runner: the guard
 * is in the UPDATE's own WHERE (so the check and the write cannot drift
 * apart), the last-seen times only move forward, and nothing outside the
 * verdict is written. Postgres running it, including two polls processed in
 * reverse order and two written at once, is
 * NetworkDevicePollOrderPostgres.test.ts.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const RECEIVED_AT: Date = new Date("2026-11-12T10:00:00.000Z");
// Ten minutes in the queue.
const PROCESSED_AT: Date = new Date("2026-11-12T10:10:00.000Z");

/*
 * Every column the statement may write. A column outside it is either one a
 * device update hook watches (sysName, siteId, monitorId, ...), which only
 * the hooked write may carry, or one the poll does not own.
 */
const VERDICT_COLUMNS: Array<string> = [
  "lastPollReceivedAt",
  "lastPolledAt",
  "isReachable",
  "isSnmpReachable",
  "lastSeenAt",
  "lastSnmpSeenAt",
  "interfacesTotal",
  "interfacesUp",
  "interfacesDown",
  "updatedAt",
];

// The column one SET assignment writes: `"isReachable" = $5::boolean`.
const ASSIGNED_COLUMN: RegExp = /^"([A-Za-z]+)"\s*=/;

type QueryFunction = (
  sql: string,
  parameters: Array<unknown>,
) => Promise<unknown>;

describe("NetworkDeviceService.writePollVerdict (issue #7389)", () => {
  let service: NetworkDeviceServiceType;
  let query: Mock<QueryFunction>;

  beforeEach(() => {
    service = new NetworkDeviceServiceType();
    // Postgres's answer when the guard let the write through.
    query = jest.fn<QueryFunction>(async (): Promise<unknown> => {
      return [{ _id: DEVICE_ID.toString() }];
    });
    jest
      .spyOn(service, "getRepository")
      .mockReturnValue({ manager: { query } } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const write: (verdict: NetworkDevicePollVerdict) => Promise<boolean> = (
    verdict: NetworkDevicePollVerdict,
  ): Promise<boolean> => {
    return service.writePollVerdict({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
      receivedAt: RECEIVED_AT,
      processedAt: PROCESSED_AT,
      verdict,
    });
  };

  const REACHABLE_WALKED: NetworkDevicePollVerdict = {
    isReachable: true,
    isSnmpReachable: true,
    interfaceCounts: { total: 48, up: 40, down: 2 },
  };

  const sentSql: () => string = (): string => {
    expect(query).toHaveBeenCalledTimes(1);
    return query.mock.calls[0]![0];
  };

  const sentParameters: () => Array<unknown> = (): Array<unknown> => {
    expect(query).toHaveBeenCalledTimes(1);
    return query.mock.calls[0]![1];
  };

  // The SET list, one assignment per entry, keyed by column.
  const assignments: () => Map<string, string> = (): Map<string, string> => {
    const setList: string = sentSql()
      .split(/\bSET\b/)[1]!
      .split(/\bWHERE\b/)[0]!;

    return new Map(
      setList
        .split(/,\s*\n/)
        .map((assignment: string) => {
          return assignment.trim();
        })
        .filter((assignment: string) => {
          return assignment.length > 0;
        })
        .map((assignment: string): [string, string] => {
          const column: string = ASSIGNED_COLUMN.exec(assignment)![1]!;
          return [column, assignment];
        }),
    );
  };

  const whereClause: () => string = (): string => {
    return sentSql()
      .split(/\bWHERE\b/)[1]!
      .split(/\bRETURNING\b/)[0]!;
  };

  describe("the statement", () => {
    test("is one statement that answers with the rows it wrote", async () => {
      await write(REACHABLE_WALKED);

      const sql: string = sentSql();
      /*
       * In a CTE: TypeORM answers a top-level UPDATE ... RETURNING with
       * [rows, rowCount], an array whether or not it wrote anything.
       */
      expect(sql).toMatch(/WITH "written" AS \(\s*UPDATE "NetworkDevice"/);
      expect(sql).toContain('RETURNING "_id"');
      expect(sql).toMatch(/SELECT "_id" FROM "written"\s*$/);
      expect(sql.match(/\bUPDATE\b/g)).toHaveLength(1);
    });

    test("writes only when the device holds no verdict from a poll received later", async () => {
      await write(REACHABLE_WALKED);

      expect(whereClause()).toContain(
        '("lastPollReceivedAt" IS NULL OR "lastPollReceivedAt" < $3::timestamptz)',
      );
      // $3 is this poll's receipt time, not when it was processed.
      expect(sentParameters()[2]).toBe(RECEIVED_AT);
    });

    test("is scoped to the device and its project, and never writes a deleted device", async () => {
      await write(REACHABLE_WALKED);

      const where: string = whereClause();
      expect(where).toContain('"_id" = $1');
      expect(where).toContain('"projectId" = $2');
      expect(where).toContain('"deletedAt" IS NULL');
      expect(sentParameters()[0]).toBe(DEVICE_ID.toString());
      expect(sentParameters()[1]).toBe(PROJECT_ID.toString());
    });

    /*
     * Not SKIP LOCKED, and no NOWAIT: the writer holding the row may be an
     * older poll, and a statement that skipped it would leave the older
     * verdict standing. One that waits asks its WHERE again on the row the
     * other writer left, so the newer verdict stands whichever commits first.
     */
    test("waits for a device another writer holds rather than skipping it", async () => {
      await write(REACHABLE_WALKED);

      expect(sentSql()).not.toContain("SKIP LOCKED");
      expect(sentSql()).not.toContain("NOWAIT");
    });

    test("every placeholder is bound, and every bound value is used", async () => {
      for (const verdict of [
        REACHABLE_WALKED,
        { isReachable: false, isSnmpReachable: null },
        { isReachable: true, isSnmpReachable: null, interfaceCounts: null },
      ] as Array<NetworkDevicePollVerdict>) {
        query.mockClear();
        await write(verdict);

        const used: Set<number> = new Set(
          Array.from(sentSql().matchAll(/\$(\d+)/g)).map(
            (match: RegExpMatchArray) => {
              return Number(match[1]);
            },
          ),
        );
        expect(
          Array.from(used).sort((a: number, b: number) => {
            return a - b;
          }),
        ).toEqual(
          Array.from(
            { length: sentParameters().length },
            (_value: unknown, index: number) => {
              return index + 1;
            },
          ),
        );
      }
    });

    test("writes no column outside the verdict", async () => {
      await write(REACHABLE_WALKED);

      expect(Array.from(assignments().keys()).sort()).toEqual(
        [...VERDICT_COLUMNS].sort(),
      );
    });

    // As the hooked write that used to carry the verdict did.
    test("moves updatedAt", async () => {
      await write({ isReachable: false, isSnmpReachable: null });

      expect(assignments().get("updatedAt")).toBe(
        '"updatedAt" = CURRENT_TIMESTAMP',
      );
    });

    /*
     * Hook-free: it is one statement on the repository's manager, never the
     * hooked update path. No device update hook reads a verdict column
     * (NetworkDeviceWalkLogWritePath.test.ts pins the hooked payload).
     */
    test("never goes through the hooked update path", async () => {
      const updateOneById: ReturnType<typeof jest.spyOn> = jest.spyOn(
        service,
        "updateOneById",
      );
      const updateBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        service,
        "updateBy",
      );

      await write(REACHABLE_WALKED);

      expect(updateOneById).not.toHaveBeenCalled();
      expect(updateBy).not.toHaveBeenCalled();
    });
  });

  describe("the two times", () => {
    /*
     * lastPollReceivedAt is the guard's own column. lastPolledAt stays the
     * time OneUptime took the poll in: the stale-poll check and the
     * topology's backstop read it as "polls are still arriving", and a
     * backlog does not stop them arriving.
     */
    test("the guard column takes the receipt time, lastPolledAt the processing time", async () => {
      await write(REACHABLE_WALKED);

      expect(assignments().get("lastPollReceivedAt")).toBe(
        '"lastPollReceivedAt" = $3::timestamptz',
      );
      expect(assignments().get("lastPolledAt")).toBe(
        '"lastPolledAt" = $4::timestamptz',
      );
      expect(sentParameters()[2]).toBe(RECEIVED_AT);
      expect(sentParameters()[3]).toBe(PROCESSED_AT);
    });
  });

  describe("reachability", () => {
    test.each([
      [true, true],
      [true, false],
      [true, null],
      [false, false],
      [false, null],
    ] as Array<[boolean, boolean | null]>)(
      "isReachable %p and isSnmpReachable %p are written as they are",
      async (isReachable: boolean, isSnmpReachable: boolean | null) => {
        await write({ isReachable, isSnmpReachable });

        expect(assignments().get("isReachable")).toBe(
          '"isReachable" = $5::boolean',
        );
        expect(assignments().get("isSnmpReachable")).toBe(
          '"isSnmpReachable" = $6::boolean',
        );
        expect(sentParameters()[4]).toBe(isReachable);
        expect(sentParameters()[5]).toBe(isSnmpReachable);
      },
    );

    /*
     * When the device answered is when the poll was received, and it never
     * moves backwards: a time stamped before the upgrade was a processing
     * time, later than the receipt times of the polls queued behind it.
     */
    test("a reachable poll moves lastSeenAt forward to its receipt time, never back", async () => {
      await write({ isReachable: true, isSnmpReachable: null });

      expect(assignments().get("lastSeenAt")).toBe(
        '"lastSeenAt" = GREATEST("lastSeenAt", $3::timestamptz)',
      );
    });

    test("an unreachable poll leaves lastSeenAt as it is", async () => {
      await write({ isReachable: false, isSnmpReachable: false });

      expect(assignments().has("lastSeenAt")).toBe(false);
    });

    test("a successful walk moves lastSnmpSeenAt forward to its receipt time, never back", async () => {
      await write({ isReachable: true, isSnmpReachable: true });

      expect(assignments().get("lastSnmpSeenAt")).toBe(
        '"lastSnmpSeenAt" = GREATEST("lastSnmpSeenAt", $3::timestamptz)',
      );
    });

    test.each([
      ["a failed walk", false],
      ["no walk (a ping-only poll)", null],
    ] as Array<[string, boolean | null]>)(
      "%s leaves lastSnmpSeenAt as it is",
      async (_label: string, isSnmpReachable: boolean | null) => {
        await write({ isReachable: true, isSnmpReachable });

        expect(assignments().has("lastSnmpSeenAt")).toBe(false);
      },
    );
  });

  describe("the cached interface counts", () => {
    test("a walk's counts are written in the order total, up, down", async () => {
      await write(REACHABLE_WALKED);

      expect(assignments().get("interfacesTotal")).toBe(
        '"interfacesTotal" = $7::integer',
      );
      expect(assignments().get("interfacesUp")).toBe(
        '"interfacesUp" = $8::integer',
      );
      expect(assignments().get("interfacesDown")).toBe(
        '"interfacesDown" = $9::integer',
      );
      expect(sentParameters().slice(6)).toEqual([48, 40, 2]);
    });

    // A ping-only poll walks nothing: the last walk's counts would be residue.
    test("null clears them", async () => {
      await write({
        isReachable: true,
        isSnmpReachable: null,
        interfaceCounts: null,
      });

      expect(assignments().has("interfacesTotal")).toBe(true);
      expect(assignments().has("interfacesUp")).toBe(true);
      expect(assignments().has("interfacesDown")).toBe(true);
      expect(sentParameters().slice(6)).toEqual([null, null, null]);
    });

    // A failed walk keeps the last good counts: the best estimate there is.
    test("undefined leaves them as they are", async () => {
      await write({ isReachable: false, isSnmpReachable: false });

      for (const column of [
        "interfacesTotal",
        "interfacesUp",
        "interfacesDown",
      ]) {
        expect(assignments().has(column)).toBe(false);
      }
      expect(sentParameters()).toHaveLength(6);
    });
  });

  describe("the answer", () => {
    test("true when it wrote", async () => {
      expect(await write(REACHABLE_WALKED)).toBe(true);
    });

    /*
     * The guard refused it (the device holds a newer verdict), or the
     * device was deleted or moved to another project meanwhile.
     */
    test("false when it wrote nothing", async () => {
      query.mockResolvedValue([]);

      expect(await write(REACHABLE_WALKED)).toBe(false);
    });

    test("false for an answer that is not rows", async () => {
      query.mockResolvedValue(undefined);

      expect(await write(REACHABLE_WALKED)).toBe(false);
    });

    // The caller leaves the poll to the next one and writes the rest.
    test("a lock timeout is thrown to the caller", async () => {
      const lockTimeout: Error & { driverError?: { code: string } } = new Error(
        "canceling statement due to lock timeout",
      );
      lockTimeout.driverError = { code: "55P03" };
      query.mockRejectedValue(lockTimeout);

      await expect(write(REACHABLE_WALKED)).rejects.toBe(lockTimeout);
    });
  });
});
