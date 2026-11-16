import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MonitorService from "Common/Server/Services/MonitorService";
import { FIRST_MEASURED_AT_UPTIME_HISTORY_MIGRATION_NAME } from "Common/Server/Services/MonitorStatusTimelineService";
import logger from "Common/Server/Utils/Logger";
import BackfillMonitorFirstMeasuredAtForUptimeHistory, {
  BACKFILL_FINISHED_AT_SQL,
  BACKFILL_MIGRATION_NAME,
  PAGE_SIZE,
  STAMP_MONITORS_MEASURED_BEFORE_SQL,
} from "../../../FeatureSet/Workers/DataMigrations/BackfillMonitorFirstMeasuredAtForUptimeHistory";
import fs from "fs";
import path from "path";

/*
 * BackfillMonitorFirstMeasuredAtForUptimeHistory (issue #8960): since a
 * monitor's uptime history leaves out the time before its first check, a
 * monitor measured before Monitor.firstMeasuredAt existed must hold the time
 * it was created - not the upgrade's, which a result stamped it with before
 * BackfillMonitorFirstMeasuredAt could reach it, and not nothing, for the
 * monitors OneUptime measures itself without leaving a trace. Pinned here,
 * against a stubbed table: it is registered once, right after that
 * backfill, before the last slot; it reads when the backfill finished and
 * does nothing without it; it walks every monitor a page of ids at a time;
 * each page's stamp names those ids and the backfill's finishing time; a
 * page that fails is logged and the rest go on; and what the statement
 * says. Which monitors it stamps is run against a real Postgres in
 * BackfillMonitorFirstMeasuredAtForUptimeHistoryPostgres.
 */
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const MIGRATION_NAME: string = "BackfillMonitorFirstMeasuredAtForUptimeHistory";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const BACKFILL_FINISHED_AT: Date = new Date("2026-11-20T10:15:00.000Z");

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

function idOf(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

function registeredMigrations(): Array<string> {
  const index: string = fs.readFileSync(
    path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
    "utf8",
  );

  expect(index).toContain(
    `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
  );

  return Array.from(
    index.replace(/\/\*[\s\S]*?\*\//g, " ").matchAll(/new ([A-Za-z0-9]+)\(\)/g),
  ).map((match: RegExpMatchArray): string => {
    return match[1]!;
  });
}

/*
 * A Monitor table of these ids, a DataMigrations row of the backfill (or
 * none), and a stamp that answers as TypeORM's Postgres driver does -
 * [rows written, count] - every other id of the page written, unless the
 * page is one that fails.
 */
function stubTable(data: {
  ids: Array<string>;
  backfillFinishedAt?: Date | string | null | undefined;
  failingPageStartsAt?: string | undefined;
}): Array<Statement> {
  const statements: Array<Statement> = [];

  const query: jest.Mock = jest.fn(
    async (sql: unknown, parameters: unknown): Promise<unknown> => {
      const statement: Statement = {
        sql: String(sql),
        parameters: (parameters as Array<unknown>) || [],
      };
      statements.push(statement);

      if (statement.sql === BACKFILL_FINISHED_AT_SQL) {
        return [
          {
            executedAt:
              data.backfillFinishedAt === undefined
                ? BACKFILL_FINISHED_AT
                : data.backfillFinishedAt,
          },
        ];
      }

      if (statement.sql === STAMP_MONITORS_MEASURED_BEFORE_SQL) {
        const pageIds: Array<string> = statement.parameters[0] as Array<string>;

        if (
          data.failingPageStartsAt &&
          pageIds[0] === data.failingPageStartsAt
        ) {
          throw new Error("canceling statement due to lock timeout");
        }

        const written: Array<{ _id: string }> = pageIds
          .filter((_id: string, index: number): boolean => {
            return index % 2 === 0;
          })
          .map((_id: string): { _id: string } => {
            return { _id: _id };
          });

        return [written, written.length];
      }

      const limit: number = statement.parameters[0] as number;
      const after: string | undefined = statement.parameters[1] as
        | string
        | undefined;

      return data.ids
        .filter((id: string): boolean => {
          return !after || id > after;
        })
        .sort()
        .slice(0, limit)
        .map((id: string): { _id: string } => {
          return { _id: id };
        });
    },
  ) as unknown as jest.Mock;

  jest
    .spyOn(
      MonitorService as unknown as DatabaseService<BaseModel>,
      "getRepository",
    )
    .mockReturnValue({
      metadata: { tableName: "Monitor" },
      manager: { query },
    } as never);

  return statements;
}

function stampsOf(statements: Array<Statement>): Array<Statement> {
  return statements.filter((statement: Statement): boolean => {
    return statement.sql === STAMP_MONITORS_MEASURED_BEFORE_SQL;
  });
}

function pageReadsOf(statements: Array<Statement>): Array<Statement> {
  return statements.filter((statement: Statement): boolean => {
    return statement.sql.startsWith(`SELECT "_id" FROM "Monitor"`);
  });
}

describe("BackfillMonitorFirstMeasuredAtForUptimeHistory", () => {
  const migration: BackfillMonitorFirstMeasuredAtForUptimeHistory =
    new BackfillMonitorFirstMeasuredAtForUptimeHistory();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  test("is registered once, right after the backfill it follows, and before the last slot", () => {
    const registered: Array<string> = registeredMigrations();

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered.indexOf(MIGRATION_NAME)).toBe(
      registered.indexOf(BACKFILL_MIGRATION_NAME) + 1,
    );
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    // Before the last slot; migrations added since sit between the two.
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 1,
    );
  });

  test("has the name the uptime statements wait for, and reads and writes Postgres only", () => {
    expect(migration.name).toBe(MIGRATION_NAME);
    expect(FIRST_MEASURED_AT_UPTIME_HISTORY_MIGRATION_NAME).toBe(
      MIGRATION_NAME,
    );
    expect(BACKFILL_MIGRATION_NAME).toBe("BackfillMonitorFirstMeasuredAt");
    expect(migration.runsInClusterMode()).toBe(true);
  });

  test("reads when the backfill finished first, and hands it to every page's stamp", async () => {
    const ids: Array<string> = Array.from(
      { length: PAGE_SIZE * 2 + 3 },
      (_: unknown, index: number): string => {
        return idOf(index + 1);
      },
    );
    const statements: Array<Statement> = stubTable({ ids: [...ids].reverse() });

    await migration.migrate();

    expect(statements[0]!.sql).toBe(BACKFILL_FINISHED_AT_SQL);
    expect(statements[0]!.parameters).toEqual([BACKFILL_MIGRATION_NAME]);

    const reads: Array<Statement> = pageReadsOf(statements);

    expect(reads).toHaveLength(3);
    expect(reads[0]!.sql).toBe(
      `SELECT "_id" FROM "Monitor" ORDER BY "_id" ASC LIMIT $1`,
    );
    expect(reads[1]!.sql).toBe(
      `SELECT "_id" FROM "Monitor" WHERE "_id" > $2 ORDER BY "_id" ASC LIMIT $1`,
    );
    expect(reads[1]!.parameters).toEqual([PAGE_SIZE, idOf(PAGE_SIZE)]);
    expect(reads[2]!.parameters).toEqual([PAGE_SIZE, idOf(PAGE_SIZE * 2)]);

    const stamps: Array<Statement> = stampsOf(statements);

    expect(stamps).toHaveLength(3);
    expect(
      stamps.flatMap((stamp: Statement): Array<string> => {
        return stamp.parameters[0] as Array<string>;
      }),
    ).toEqual(ids);

    for (const stamp of stamps) {
      expect(stamp.parameters[1]).toEqual(BACKFILL_FINISHED_AT);
    }
  });

  test("reads a finishing time the driver hands back as text", async () => {
    const statements: Array<Statement> = stubTable({
      ids: [idOf(1)],
      backfillFinishedAt: "2026-11-20T10:15:00.000Z",
    });

    await migration.migrate();

    expect(stampsOf(statements)[0]!.parameters[1]).toEqual(
      BACKFILL_FINISHED_AT,
    );
  });

  test.each([
    ["no row", null],
    ["a time that is no time", "not a date"],
  ])(
    "with %s for the backfill, stamps nothing and says why",
    async (_name: string, finishedAt: string | null) => {
      const statements: Array<Statement> = stubTable({
        ids: [idOf(1), idOf(2)],
        backfillFinishedAt: finishedAt,
      });

      await migration.migrate();

      expect(stampsOf(statements)).toHaveLength(0);
      expect(pageReadsOf(statements)).toHaveLength(0);
      expect(logger.info).toHaveBeenCalledWith(
        `${MIGRATION_NAME}: ${BACKFILL_MIGRATION_NAME} has not run, so no monitor was stamped during an upgrade.`,
      );
    },
  );

  test("says how many it stamped, out of how many, measured before when", async () => {
    stubTable({ ids: [idOf(1), idOf(2), idOf(3), idOf(4)] });

    await migration.migrate();

    expect(logger.info).toHaveBeenCalledWith(
      `${MIGRATION_NAME}: 2 of 4 monitors measured before 2026-11-20T10:15:00.000Z now count from their creation, 0 could not be read.`,
    );
  });

  test("a page that fails is logged, and the pages after it are stamped", async () => {
    const ids: Array<string> = Array.from(
      { length: PAGE_SIZE + 2 },
      (_: unknown, index: number): string => {
        return idOf(index + 1);
      },
    );
    const statements: Array<Statement> = stubTable({
      ids: ids,
      failingPageStartsAt: idOf(1),
    });

    await expect(migration.migrate()).resolves.toBe(undefined);

    expect(stampsOf(statements)).toHaveLength(2);
    expect(logger.error).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      `${MIGRATION_NAME}: 1 of ${PAGE_SIZE + 2} monitors measured before 2026-11-20T10:15:00.000Z now count from their creation, ${PAGE_SIZE} could not be read.`,
    );
  });

  test("rollback changes nothing", async () => {
    const statements: Array<Statement> = stubTable({ ids: [idOf(1)] });

    await migration.rollback();

    expect(statements).toHaveLength(0);
  });

  test("counts what the driver hands back, in either shape", () => {
    expect(
      BackfillMonitorFirstMeasuredAtForUptimeHistory.countRows([
        [{ _id: "a" }, { _id: "b" }],
        2,
      ]),
    ).toBe(2);
    expect(
      BackfillMonitorFirstMeasuredAtForUptimeHistory.countRows([{ _id: "a" }]),
    ).toBe(1);
    expect(
      BackfillMonitorFirstMeasuredAtForUptimeHistory.countRows(undefined),
    ).toBe(0);
  });
});

describe("what the stamp writes, and when", () => {
  test("a monitor of the page, created before the backfill finished, its column empty or later than its creation, gets its creation", () => {
    expect(STAMP_MONITORS_MEASURED_BEFORE_SQL).toMatch(
      /^UPDATE "Monitor" AS "monitor" SET "firstMeasuredAt" = "monitor"\."createdAt" WHERE "monitor"\."_id" = ANY\(\$1::uuid\[\]\) AND "monitor"\."monitorType" <> 'Manual' AND "monitor"\."createdAt" IS NOT NULL AND "monitor"\."createdAt" < \$2::timestamptz AND \("monitor"\."firstMeasuredAt" IS NULL OR "monitor"\."firstMeasuredAt" > "monitor"\."createdAt"\) AND \(/,
    );
    expect(STAMP_MONITORS_MEASURED_BEFORE_SQL).toMatch(
      / RETURNING "monitor"\."_id"$/,
    );
  });

  test("if it was measured before the backfill finished: stamped by a result first, or measured by OneUptime itself", () => {
    for (const evidence of [
      // A result got there before the backfill: it was being checked.
      `("monitor"."firstMeasuredAt" IS NOT NULL AND "monitor"."firstMeasuredAt" <= $2::timestamptz)`,
      // Evaluated every minute from the probes' connection.
      `"monitor"."monitorType" = 'Probe Status'`,
      // Evaluated on every poll of a device that has been polled.
      `"monitor"."monitorType" = 'Network Device' AND EXISTS (SELECT 1 FROM "MonitorNetworkDevice" AS "link" JOIN "NetworkDevice" AS "device" ON "device"."_id" = "link"."networkDeviceId" WHERE "link"."monitorId" = "monitor"."_id" AND ("device"."lastPolledAt" IS NOT NULL OR "device"."lastPollReceivedAt" IS NOT NULL OR "device"."lastSeenAt" IS NOT NULL))`,
    ]) {
      expect({
        evidence,
        isRead: STAMP_MONITORS_MEASURED_BEFORE_SQL.includes(evidence),
      }).toEqual({ evidence, isRead: true });
    }
  });

  test("the backfill's finishing time is read from its own DataMigrations row", () => {
    expect(BACKFILL_FINISHED_AT_SQL).toBe(
      `SELECT MIN("executedAt") AS "executedAt" FROM "DataMigrations" WHERE "name" = $1 AND "executed" = true AND "deletedAt" IS NULL`,
    );
  });

  test("every column of Monitor it reads is one of the model's", () => {
    const columns: Array<string> = Array.from(
      STAMP_MONITORS_MEASURED_BEFORE_SQL.matchAll(/"monitor"\."([A-Za-z]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    const monitorColumns: Array<string> = new Monitor().getTableColumns()
      .columns;

    for (const column of new Set<string>(columns)) {
      expect({
        column,
        isColumn: column === "_id" || monitorColumns.includes(column),
      }).toEqual({ column, isColumn: true });
    }
  });
});
