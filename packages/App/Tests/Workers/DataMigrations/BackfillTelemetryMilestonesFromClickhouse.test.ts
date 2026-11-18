import TelemetryMilestoneBackfill, {
  TELEMETRY_MILESTONE_BACKFILL_TABLES,
  TelemetryMilestoneBackfillOptions,
  TelemetryMilestoneBackfillResult,
  TelemetryMilestoneBackfillTable,
} from "Common/Server/Utils/Activation/TelemetryMilestoneBackfill";
import logger from "Common/Server/Utils/Logger";
import ActivationMilestone from "Common/Types/Analytics/ActivationMilestone";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import BackfillTelemetryMilestonesFromClickhouse from "../../../FeatureSet/Workers/DataMigrations/BackfillTelemetryMilestonesFromClickhouse";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * The first-data marks of telemetry sent before the marks were kept
 * (#9454), as the workers run them: registered once, after the first
 * backfill whose metered usage missed them and before the slot
 * AddAuditLogMcpClientColumns keeps last; run on a clustered install too,
 * since it reads the Distributed tables every install has; handing the work
 * to TelemetryMilestoneBackfill (whose statements run on a real ClickHouse
 * in BackfillTelemetryMilestonesFromClickhouseClickhouse, and on a real
 * Postgres in Common's ProjectMilestonePostgres) with ClickHouse's own
 * answer to which tables exist; and saying what it kept, and what it could
 * not read, in the log.
 */

const MIGRATION_NAME: string = "BackfillTelemetryMilestonesFromClickhouse";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

function registeredMigrations(): Array<string> {
  const index: string = fs
    .readFileSync(path.join(DATA_MIGRATIONS_DIR, "Index.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  expect(index).toContain(
    `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
  );

  return Array.from(index.matchAll(/new ([A-Za-z0-9]+)\(\)/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

function resultOf(
  data: Partial<TelemetryMilestoneBackfillResult>,
): TelemetryMilestoneBackfillResult {
  return {
    projects: 0,
    keptByMilestone: {},
    missingTables: [],
    uncheckedTables: [],
    failedReads: 0,
    unkeptMarks: 0,
    isStoppedByTimeBudget: false,
    lastError: null,
    ...data,
  };
}

interface Logged {
  info: Array<string>;
  warn: Array<string>;
}

function captureLog(): Logged {
  const logged: Logged = { info: [], warn: [] };

  jest.spyOn(logger, "info").mockImplementation(((message: unknown): void => {
    logged.info.push(String(message));
  }) as never);
  jest.spyOn(logger, "warn").mockImplementation(((message: unknown): void => {
    logged.warn.push(String(message));
  }) as never);

  return logged;
}

describe("BackfillTelemetryMilestonesFromClickhouse", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is named after itself, so it runs once", () => {
    expect(new BackfillTelemetryMilestonesFromClickhouse().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("is registered once, after the first backfill and before the last slot", () => {
    const registered: Array<string> = registeredMigrations();

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      registered.indexOf("BackfillProjectMilestones"),
    );
    expect(registered.indexOf("BackfillProjectMilestones")).toBeGreaterThan(-1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
  });

  test("runs on a clustered install too: it reads the Distributed tables every install has", () => {
    expect(
      new BackfillTelemetryMilestonesFromClickhouse().runsInClusterMode(),
    ).toBe(true);
  });

  test("hands the work to TelemetryMilestoneBackfill, with ClickHouse's own answer to which tables exist, and says what it kept", async () => {
    const backfill: SpyInstance<typeof TelemetryMilestoneBackfill.backfill> =
      jest.spyOn(TelemetryMilestoneBackfill, "backfill").mockResolvedValue(
        resultOf({
          projects: 42,
          keptByMilestone: {
            [ActivationMilestone.FirstLogsReceived]: 3,
            [ActivationMilestone.FirstTracesReceived]: 0,
            [ActivationMilestone.FirstExceptionsReceived]: 2,
          },
        }),
      );
    const tableExists: SpyInstance<typeof ClickHouseMigrationUtil.tableExists> =
      jest
        .spyOn(ClickHouseMigrationUtil, "tableExists")
        .mockResolvedValue(true);
    const logged: Logged = captureLog();

    await new BackfillTelemetryMilestonesFromClickhouse().migrate();

    expect(backfill).toHaveBeenCalledTimes(1);

    const options: TelemetryMilestoneBackfillOptions =
      backfill.mock.calls[0]![0];

    await expect(options.tableExists("LogItemV3")).resolves.toBe(true);
    expect(tableExists).toHaveBeenCalledWith("LogItemV3");
    // Every other choice is the backfill's own: batches, budget, readers.
    expect(Object.keys(options)).toEqual(["tableExists"]);

    expect(logged).toEqual({
      info: [
        `${MIGRATION_NAME}: read 42 project(s) and kept 3 first_logs_received, 2 first_exceptions_received.`,
      ],
      warn: [],
    });
  });

  test("with nothing to keep it says so", async () => {
    jest
      .spyOn(TelemetryMilestoneBackfill, "backfill")
      .mockResolvedValue(resultOf({ projects: 7 }));
    const logged: Logged = captureLog();

    await new BackfillTelemetryMilestonesFromClickhouse().migrate();

    expect(logged).toEqual({
      info: [`${MIGRATION_NAME}: read 7 project(s) and kept no marks.`],
      warn: [],
    });
  });

  test("names the tables it skipped, and with none at all says it had nothing to read", async () => {
    jest.spyOn(TelemetryMilestoneBackfill, "backfill").mockResolvedValue(
      resultOf({
        projects: 2,
        keptByMilestone: { [ActivationMilestone.FirstLogsReceived]: 1 },
        missingTables: ["ProfileItemV3", "ProfileSampleItemV3"],
      }),
    );
    let logged: Logged = captureLog();

    await new BackfillTelemetryMilestonesFromClickhouse().migrate();

    expect(logged.info).toEqual([
      `${MIGRATION_NAME}: read 2 project(s) and kept 1 first_logs_received.`,
      `${MIGRATION_NAME}: skipped the tables this install does not have: ProfileItemV3, ProfileSampleItemV3.`,
    ]);

    jest.restoreAllMocks();

    const everyTable: Array<string> = TELEMETRY_MILESTONE_BACKFILL_TABLES.map(
      (table: TelemetryMilestoneBackfillTable): string => {
        return table.tableName;
      },
    );

    jest
      .spyOn(TelemetryMilestoneBackfill, "backfill")
      .mockResolvedValue(resultOf({ missingTables: everyTable }));
    logged = captureLog();

    await new BackfillTelemetryMilestonesFromClickhouse().migrate();

    expect(logged).toEqual({
      info: [
        `${MIGRATION_NAME}: this install has no telemetry tables (${everyTable.join(", ")}); nothing to read.`,
      ],
      warn: [],
    });
  });

  test("warns of reads it could not make, marks it could not write and a budget spent, with the last error - and does not fail", async () => {
    jest.spyOn(TelemetryMilestoneBackfill, "backfill").mockResolvedValue(
      resultOf({
        projects: 400,
        keptByMilestone: { [ActivationMilestone.FirstMetricsReceived]: 5 },
        failedReads: 12,
        unkeptMarks: 1,
        isStoppedByTimeBudget: true,
        lastError: "Timeout exceeded",
      }),
    );
    const logged: Logged = captureLog();

    await expect(
      new BackfillTelemetryMilestonesFromClickhouse().migrate(),
    ).resolves.toBeUndefined();

    expect(logged).toEqual({
      info: [
        `${MIGRATION_NAME}: read 400 project(s) and kept 5 first_metrics_received.`,
      ],
      warn: [
        `${MIGRATION_NAME}: stopped at its time budget, 12 read(s) of a project's table failed, 1 mark(s) could not be written; those projects get their marks with their next data (last error: Timeout exceeded).`,
      ],
    });
  });

  test("warns of the tables ClickHouse could not say it has, which it did not read", async () => {
    jest.spyOn(TelemetryMilestoneBackfill, "backfill").mockResolvedValue(
      resultOf({
        projects: 3,
        uncheckedTables: ["SpanItemV3"],
        lastError: "connect ECONNREFUSED 127.0.0.1:8123",
      }),
    );
    const logged: Logged = captureLog();

    await new BackfillTelemetryMilestonesFromClickhouse().migrate();

    expect(logged.warn).toEqual([
      `${MIGRATION_NAME}: did not read SpanItemV3, which ClickHouse could not say it has; those projects get their marks with their next data (last error: connect ECONNREFUSED 127.0.0.1:8123).`,
    ]);
  });

  test("a failure to read the projects is the runner's to see: it is not swallowed, so the migration runs again", async () => {
    jest
      .spyOn(TelemetryMilestoneBackfill, "backfill")
      .mockRejectedValue(new Error("Connection terminated"));

    await expect(
      new BackfillTelemetryMilestonesFromClickhouse().migrate(),
    ).rejects.toThrow("Connection terminated");
  });

  test("rolling it back undoes nothing", async () => {
    await expect(
      new BackfillTelemetryMilestonesFromClickhouse().rollback(),
    ).resolves.toBeUndefined();
  });
});
