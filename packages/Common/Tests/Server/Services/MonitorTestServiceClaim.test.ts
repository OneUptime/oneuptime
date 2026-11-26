import { Service as MonitorTestServiceType } from "../../../Server/Services/MonitorTestService";
import ProbeSchedulingMetrics from "../../../Server/Utils/Probe/ProbeSchedulingMetrics";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import {
  CapturedStatement,
  captureClaimQueries,
  normalizeSql,
} from "../TestingUtils/PastDueMonitoringClaimSql";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * THE MONITOR TEST CLAIM IS ONE STATEMENT (OneUptime issue #7392).
 *
 * A probe asks for the monitor tests someone started from the dashboard
 * ("Test monitor") on every tick. The claim used to be a transaction - a
 * SELECT ... FOR UPDATE SKIP LOCKED, an UPDATE of the ids, COMMIT - four
 * round trips each tick, even with nothing queued, holding FOR UPDATE for
 * as long as a busy pod took to come back to its connection. It is now one
 * self-committing statement that locks FOR NO KEY UPDATE SKIP LOCKED and
 * takes the tests out of the queue as it locks them.
 *
 * The statement is captured at getRepository().manager.query, with
 * executeTransaction made to throw, so a claim that opens a transaction
 * again fails here. OnDemandProbeJobClaimsPostgres runs it on a real
 * Postgres.
 */

const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const TEST_ID: string = "44444444-4444-4444-8444-444444444444";
const SECOND_TEST_ID: string = "55555555-5555-4555-8555-555555555555";

const NOW: Date = new Date("2026-11-16T10:00:00.000Z");

// A claim older than this that never got an answer is handed out again.
const STALE_CLAIM_IN_MINUTES: number = 10;

function buildService(): MonitorTestServiceType {
  return new MonitorTestServiceType();
}

// The part of the statement that picks and locks the tests.
function pendingPart(sql: string): string {
  return sql.slice(
    sql.indexOf('WITH "pending" AS ('),
    sql.indexOf('"claimed" AS ('),
  );
}

// The part that takes them out of the queue.
function claimedPart(sql: string): string {
  return sql.slice(sql.indexOf('"claimed" AS ('));
}

describe("MonitorTestService.claimMonitorTestsForProbing", () => {
  beforeEach(() => {
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function claim(
    claimedRows: unknown,
    limit: number = 10,
  ): Promise<{
    ids: Array<ObjectID>;
    statements: Array<CapturedStatement>;
    service: MonitorTestServiceType;
  }> {
    const service: MonitorTestServiceType = buildService();
    const statements: Array<CapturedStatement> = captureClaimQueries(
      service,
      claimedRows as Array<Record<string, unknown>>,
    );

    const ids: Array<ObjectID> = await service.claimMonitorTestsForProbing({
      probeId: PROBE_ID,
      limit: limit,
    });

    return { ids, statements, service };
  }

  test("is one statement, never a transaction", async () => {
    const { statements, service } = await claim([{ _id: TEST_ID }]);

    expect(statements).toHaveLength(1);
    expect(service.executeTransaction).not.toHaveBeenCalled();
  });

  test("locks this probe's tests still in the queue, or claimed long ago and never answered, oldest first, skipping locked ones", async () => {
    const { statements } = await claim([], 7);
    const statement: CapturedStatement = statements[0]!;
    const sql: string = normalizeSql(statement.sql);
    const pending: string = pendingPart(sql);

    expect(pending).toContain('FROM "MonitorTest" mt');
    expect(pending).toContain('mt."probeId" = $1');
    // The stale re-claim, exactly as it was.
    expect(pending).toContain(
      '( mt."isInQueue" = true OR ( mt."isInQueue" = false AND mt."updatedAt" <= $3 ) )',
    );
    expect(pending).toContain('mt."monitorStepProbeResponse" IS NULL');
    expect(pending).toContain('mt."deletedAt" IS NULL');
    expect(pending).toContain('ORDER BY mt."createdAt" ASC LIMIT $2');
    expect(pending).toContain("FOR NO KEY UPDATE OF mt SKIP LOCKED");
    // FOR UPDATE holds up the foreign-key checks of rows that name a test.
    expect(sql).not.toContain("FOR UPDATE");

    expect(statement.parameters).toEqual([
      PROBE_ID.toString(),
      7,
      OneUptimeDate.addRemoveMinutes(NOW, -STALE_CLAIM_IN_MINUTES),
    ]);
  });

  test("takes the tests it locked out of the queue by the same statement, and answers them in claim order", async () => {
    const { statements } = await claim([{ _id: TEST_ID }]);
    const sql: string = normalizeSql(statements[0]!.sql);

    expect(claimedPart(sql)).toContain(
      'UPDATE "MonitorTest" AS mt SET "isInQueue" = false, "updatedAt" = now() FROM "pending" WHERE mt."_id" = "pending"."_id" RETURNING mt."_id"',
    );
    // The rows it wrote, in the order it locked them: oldest first.
    expect(sql).toMatch(
      /SELECT "pending"\."_id", "pending"\."createdAt", "pending"\."wasQueued" FROM "pending" INNER JOIN "claimed" ON "claimed"\."_id" = "pending"\."_id" ORDER BY "pending"\."createdAt" ASC$/,
    );
    // Whether each was in the queue: read before the statement takes it out.
    expect(pendingPart(sql)).toContain(
      'SELECT mt."_id", mt."createdAt", mt."isInQueue" AS "wasQueued"',
    );
  });

  /*
   * How long each Test Monitor run waited for a probe (issue #10819,
   * ProbeSchedulingMetrics): from when it was asked for to this claim. A
   * stale test handed out again was counted when it was first handed out.
   */
  describe("Test Monitor wait", () => {
    test("each test taken out of the queue is counted with how long it waited", async () => {
      const record: SpyInstance<
        typeof ProbeSchedulingMetrics.recordMonitorTestsHandedOut
      > = jest
        .spyOn(ProbeSchedulingMetrics, "recordMonitorTestsHandedOut")
        .mockImplementation((): void => {
          return undefined;
        });

      await claim([
        {
          _id: TEST_ID,
          createdAt: new Date(NOW.getTime() - 4000),
          wasQueued: true,
        },
        {
          _id: SECOND_TEST_ID,
          createdAt: new Date(NOW.getTime() - 9000).toISOString(),
          wasQueued: true,
        },
      ]);

      expect(record).toHaveBeenCalledWith({
        handedOutAt: NOW,
        askedAt: [
          new Date(NOW.getTime() - 4000),
          new Date(NOW.getTime() - 9000),
        ],
      });
    });

    test("a stale test handed out again is not counted twice", async () => {
      const record: SpyInstance<
        typeof ProbeSchedulingMetrics.recordMonitorTestsHandedOut
      > = jest
        .spyOn(ProbeSchedulingMetrics, "recordMonitorTestsHandedOut")
        .mockImplementation((): void => {
          return undefined;
        });

      await claim([
        {
          _id: TEST_ID,
          createdAt: new Date(NOW.getTime() - 15 * 60 * 1000),
          wasQueued: false,
        },
      ]);

      expect(record).not.toHaveBeenCalled();
    });

    test("nothing claimed, or no readable time, counts nothing", async () => {
      const record: SpyInstance<
        typeof ProbeSchedulingMetrics.recordMonitorTestsHandedOut
      > = jest
        .spyOn(ProbeSchedulingMetrics, "recordMonitorTestsHandedOut")
        .mockImplementation((): void => {
          return undefined;
        });

      await claim([]);
      await claim([{ _id: TEST_ID, createdAt: "not a time", wasQueued: true }]);
      await claim([{ _id: TEST_ID, createdAt: null, wasQueued: true }]);

      expect(record).not.toHaveBeenCalled();
    });
  });

  test("hands the claimed ids back as ObjectIDs, in claim order", async () => {
    const { ids } = await claim([{ _id: TEST_ID }, { _id: SECOND_TEST_ID }]);

    expect(
      ids.map((id: ObjectID): string => {
        expect(id).toBeInstanceOf(ObjectID);
        return id.toString();
      }),
    ).toEqual([TEST_ID, SECOND_TEST_ID]);
  });

  test("with nothing queued it is still one statement, and returns nothing", async () => {
    const { ids, statements } = await claim([]);

    expect(ids).toEqual([]);
    expect(statements).toHaveLength(1);
  });

  test("an answer that is not a list of rows returns nothing", async () => {
    const { ids } = await claim("unexpected");

    expect(ids).toEqual([]);
  });
});
