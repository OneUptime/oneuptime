import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import MonitorStatusTimelineReconciler, {
  DEFAULT_RESTORE_BATCH_SIZE,
  RESTORE_GRACE_PERIOD_IN_MINUTES,
  RESTORED_STATUS_EVENT_ROOT_CAUSE,
  RestoreMissingStatusTimelinesResult,
} from "../../../../Server/Utils/Monitor/MonitorStatusTimelineReconciler";
import DatabaseNotConnectedException from "../../../../Types/Exception/DatabaseNotConnectedException";
import ObjectID from "../../../../Types/ObjectID";

/*
 * MONITORS WITH NO STATUS TIMELINE LEFT GET THEIR CURRENT STATUS BACK.
 *
 * The statement - which monitors, the row it writes, the advisory lock that
 * keeps two runs from restoring one monitor twice - is run on Postgres in
 * StateTimelineRowsKeptPostgres. This pins the orchestration around it: a
 * statement per batch until one comes back short, the values it is handed,
 * and what the run answers.
 */

const NOW: Date = new Date("2026-10-14T12:00:00.000Z");

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

let statements: Array<Statement> = [];

// What each statement answers: the monitors it restored, batch by batch.
let batches: Array<Array<string>> = [];

const fakeDataSource: { query: jest.Mock } = {
  query: jest.fn(
    async (
      sql: string,
      parameters: Array<unknown>,
    ): Promise<Array<{ monitorId: string }>> => {
      statements.push({ sql, parameters });

      return (batches.shift() || []).map((monitorId: string) => {
        return { monitorId };
      });
    },
  ),
};

function monitorIds(count: number, from: number = 0): Array<string> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return `6d000000-0000-4000-8000-${String(from + index).padStart(12, "0")}`;
  });
}

beforeEach(() => {
  statements = [];
  batches = [];
  fakeDataSource.query.mockClear();
  jest
    .spyOn(PostgresAppInstance, "getDataSource")
    .mockReturnValue(fakeDataSource as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("restores nothing, in one statement, when no monitor is without a status timeline", async () => {
  const result: RestoreMissingStatusTimelinesResult =
    await MonitorStatusTimelineReconciler.restoreMissingStatusTimelines({
      now: NOW,
    });

  expect(result).toEqual({ restored: 0, restoredMonitorIds: [] });
  expect(statements.length).toBe(1);
});

test("runs a statement per batch until one comes back short, and answers every monitor restored", async () => {
  batches = [monitorIds(2), monitorIds(2, 2), monitorIds(1, 4)];

  const result: RestoreMissingStatusTimelinesResult =
    await MonitorStatusTimelineReconciler.restoreMissingStatusTimelines({
      batchSize: 2,
      now: NOW,
    });

  expect(statements.length).toBe(3);
  expect(result.restored).toBe(5);
  expect(
    result.restoredMonitorIds.map((id: ObjectID): string => {
      return id.toString();
    }),
  ).toEqual(monitorIds(5));
});

test("stops after a full batch followed by an empty one", async () => {
  batches = [monitorIds(2), []];

  const result: RestoreMissingStatusTimelinesResult =
    await MonitorStatusTimelineReconciler.restoreMissingStatusTimelines({
      batchSize: 2,
      now: NOW,
    });

  expect(statements.length).toBe(2);
  expect(result.restored).toBe(2);
});

test("hands the statement the grace period, the batch, the root cause, the feed's status change and now", async () => {
  await MonitorStatusTimelineReconciler.restoreMissingStatusTimelines({
    now: NOW,
  });

  expect(statements[0]!.parameters).toEqual([
    new Date(NOW.getTime() - RESTORE_GRACE_PERIOD_IN_MINUTES * 60 * 1000),
    DEFAULT_RESTORE_BATCH_SIZE,
    RESTORED_STATUS_EVENT_ROOT_CAUSE,
    "MonitorStatusChanged",
    NOW,
  ]);
});

test("writes one open row per monitor with no live row, guarded against a second run at once", async () => {
  await MonitorStatusTimelineReconciler.restoreMissingStatusTimelines({
    now: NOW,
  });

  const sql: string = statements[0]!.sql;

  // Only one statement at a time restores.
  expect(sql).toContain("pg_try_advisory_xact_lock");
  expect(sql).toContain('WHERE (SELECT "mayRun" FROM run)');

  // Monitors that are live, have a current status and no live row.
  expect(sql).toContain('m."deletedAt" IS NULL');
  expect(sql).toContain('m."currentMonitorStatusId" IS NOT NULL');
  expect(sql).toContain('t."deletedAt" IS NULL');
  expect(sql).toContain("NOT EXISTS");

  // A status of the monitor's own project only.
  expect(sql).toContain('s."projectId" = m."projectId"');

  // Notifies nobody, and is the current status: open.
  expect(sql).toContain('"isOwnerNotified"');
  expect(sql).not.toContain('"endsAt"');
});

test("keeps the root cause readable: it says the history was deleted and where the status is recorded from", () => {
  expect(RESTORED_STATUS_EVENT_ROOT_CAUSE).toBe(
    "Restored by OneUptime. This monitor's status history had been deleted, so OneUptime recorded its current status again, from the last status change it has a record of (or from when the monitor was created).",
  );
  expect(RESTORE_GRACE_PERIOD_IN_MINUTES).toBe(60);
});

test("fails plainly when the database is not connected", async () => {
  jest
    .spyOn(PostgresAppInstance, "getDataSource")
    .mockReturnValue(null as never);

  await expect(
    MonitorStatusTimelineReconciler.restoreMissingStatusTimelines({
      now: NOW,
    }),
  ).rejects.toThrow(DatabaseNotConnectedException);
});
