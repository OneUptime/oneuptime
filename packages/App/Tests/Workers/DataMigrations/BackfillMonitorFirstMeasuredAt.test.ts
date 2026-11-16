import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import BackfillMonitorFirstMeasuredAt, {
  PAGE_SIZE,
  STAMP_MEASURED_MONITORS_SQL,
} from "../../../FeatureSet/Workers/DataMigrations/BackfillMonitorFirstMeasuredAt";
import fs from "fs";
import path from "path";

/*
 * BackfillMonitorFirstMeasuredAt (issue #8899) stamps Monitor.firstMeasuredAt
 * on every monitor that had been measured before the column existed: the
 * lists and status pages say a monitor whose column is empty is waiting for
 * its first check. Pinned here, against a stubbed table: it is registered
 * once, before the slot AddAuditLogMcpClientColumns keeps last; it walks
 * every monitor a page of ids at a time on a stable id order, to the last
 * short page; each page's stamp names those ids and only them; a page that
 * fails is logged and the rest go on; and what each statement says. Which
 * monitors count as measured is run against a real Postgres in
 * BackfillMonitorFirstMeasuredAtPostgres.
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

const MIGRATION_NAME: string = "BackfillMonitorFirstMeasuredAt";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

// Ids that sort as text, as Postgres orders a uuid.
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
 * A Monitor table of these ids, and a stamp that answers, as TypeORM's
 * Postgres driver does, [rows written, count] - every other id of the page
 * written, unless the page is one that fails.
 */
function stubTable(data: {
  ids: Array<string>;
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

      if (statement.sql === STAMP_MEASURED_MONITORS_SQL) {
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

function stampsOf(statements: Array<Statement>): Array<Array<string>> {
  return statements
    .filter((statement: Statement): boolean => {
      return statement.sql === STAMP_MEASURED_MONITORS_SQL;
    })
    .map((statement: Statement): Array<string> => {
      return statement.parameters[0] as Array<string>;
    });
}

function readsOf(statements: Array<Statement>): Array<Statement> {
  return statements.filter((statement: Statement): boolean => {
    return statement.sql !== STAMP_MEASURED_MONITORS_SQL;
  });
}

describe("BackfillMonitorFirstMeasuredAt", () => {
  const migration: BackfillMonitorFirstMeasuredAt =
    new BackfillMonitorFirstMeasuredAt();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  test("is registered once, after the migrations of #6479 and before the last slot", () => {
    const registered: Array<string> = registeredMigrations();

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    /*
     * Right before the migration that puts the column right for uptime
     * history (issue #8960), which reads when this one finished.
     */
    expect(registered.indexOf(MIGRATION_NAME)).toBe(
      registered.indexOf("BackfillMonitorFirstMeasuredAtForUptimeHistory") - 1,
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 1,
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      registered.indexOf("ResolveWhatMonitorsTurnedOffWouldHaveResolved"),
    );
  });

  test("has the name it is recorded under, and reads and writes Postgres only", () => {
    expect(migration.name).toBe(MIGRATION_NAME);
    expect(migration.runsInClusterMode()).toBe(true);
  });

  test("walks every monitor a page of ids at a time, on a stable id order, to the last short page", async () => {
    const ids: Array<string> = Array.from(
      { length: PAGE_SIZE * 2 + 3 },
      (_: unknown, index: number): string => {
        return idOf(index + 1);
      },
    );
    const statements: Array<Statement> = stubTable({ ids: [...ids].reverse() });

    await migration.migrate();

    const reads: Array<Statement> = readsOf(statements);

    expect(reads).toHaveLength(3);
    expect(reads[0]!.sql).toBe(
      `SELECT "_id" FROM "Monitor" ORDER BY "_id" ASC LIMIT $1`,
    );
    expect(reads[0]!.parameters).toEqual([PAGE_SIZE]);
    expect(reads[1]!.sql).toBe(
      `SELECT "_id" FROM "Monitor" WHERE "_id" > $2 ORDER BY "_id" ASC LIMIT $1`,
    );
    expect(reads[1]!.parameters).toEqual([PAGE_SIZE, idOf(PAGE_SIZE)]);
    expect(reads[2]!.parameters).toEqual([PAGE_SIZE, idOf(PAGE_SIZE * 2)]);

    // Each page is stamped by its own ids, and every id is in one page.
    const stamped: Array<Array<string>> = stampsOf(statements);

    expect(stamped).toHaveLength(3);
    expect(stamped[0]).toEqual(ids.slice(0, PAGE_SIZE));
    expect(stamped[1]).toEqual(ids.slice(PAGE_SIZE, PAGE_SIZE * 2));
    expect(stamped[2]).toEqual(ids.slice(PAGE_SIZE * 2));
    expect(stamped.flat()).toEqual(ids);
  });

  test("an exactly full last page is followed by an empty read, and nothing is stamped for it", async () => {
    const ids: Array<string> = Array.from(
      { length: PAGE_SIZE },
      (_: unknown, index: number): string => {
        return idOf(index + 1);
      },
    );
    const statements: Array<Statement> = stubTable({ ids: ids });

    await migration.migrate();

    expect(readsOf(statements)).toHaveLength(2);
    expect(stampsOf(statements)).toHaveLength(1);
  });

  test("a table with no monitors reads once and stamps nothing", async () => {
    const statements: Array<Statement> = stubTable({ ids: [] });

    await migration.migrate();

    expect(statements).toHaveLength(1);
    expect(stampsOf(statements)).toHaveLength(0);
  });

  test("says how many it stamped and how many it read", async () => {
    stubTable({
      ids: [idOf(1), idOf(2), idOf(3), idOf(4)],
    });

    await migration.migrate();

    expect(logger.info).toHaveBeenCalledWith(
      "BackfillMonitorFirstMeasuredAt: 2 of 4 monitors had been measured, 0 could not be read.",
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
      `BackfillMonitorFirstMeasuredAt: 1 of ${PAGE_SIZE + 2} monitors had been measured, ${PAGE_SIZE} could not be read.`,
    );
  });

  test("rollback changes nothing", async () => {
    const statements: Array<Statement> = stubTable({ ids: [idOf(1)] });

    await migration.rollback();

    expect(statements).toHaveLength(0);
  });

  test("counts what the driver hands back, in either shape", () => {
    expect(
      BackfillMonitorFirstMeasuredAt.countRows([
        [{ _id: "a" }, { _id: "b" }],
        2,
      ]),
    ).toBe(2);
    expect(
      BackfillMonitorFirstMeasuredAt.countRows([{ _id: "a" }, { _id: "b" }]),
    ).toBe(2);
    expect(BackfillMonitorFirstMeasuredAt.countRows([[], 0])).toBe(0);
    expect(BackfillMonitorFirstMeasuredAt.countRows(undefined)).toBe(0);
  });
});

describe("what the stamp writes, and when", () => {
  test("only a monitor of the page whose column is still empty, with its creation time", () => {
    expect(STAMP_MEASURED_MONITORS_SQL).toMatch(
      /^UPDATE "Monitor" AS "monitor" SET "firstMeasuredAt" = COALESCE\("monitor"\."createdAt", now\(\)\) WHERE "monitor"\."_id" = ANY\(\$1::uuid\[\]\) AND "monitor"\."firstMeasuredAt" IS NULL AND \(/,
    );
    expect(STAMP_MEASURED_MONITORS_SQL).toMatch(/ RETURNING "monitor"\."_id"$/);
  });

  test("a monitor counts as measured by any trace it left, and every manual monitor does", () => {
    for (const trace of [
      `"monitor"."monitorType" = 'Manual'`,
      `"monitor"."serverMonitorRequestReceivedAt" IS NOT NULL`,
      `"monitor"."incomingMonitorRequest" IS NOT NULL`,
      `"monitor"."incomingRequestWithSecretAt" IS NOT NULL`,
      `"monitor"."incomingRequestWithoutSecretAt" IS NOT NULL`,
      `"monitor"."incomingEmailMonitorLastEmailReceivedAt" IS NOT NULL`,
      `"monitor"."incomingEmailMonitorRequest" IS NOT NULL`,
      `"monitor"."telemetryMonitorLastMonitorAt" IS NOT NULL`,
      // A probe's result on one of its probe rows.
      `EXISTS (SELECT 1 FROM "MonitorProbe" AS "probe" WHERE "probe"."monitorId" = "monitor"."_id" AND "probe"."lastMonitoringLog" IS NOT NULL AND "probe"."lastMonitoringLog" <> '{}'::jsonb AND "probe"."lastMonitoringLog" <> 'null'::jsonb)`,
      // A second event on its status timeline.
      `EXISTS (SELECT 1 FROM "MonitorStatusTimeline" AS "timeline" WHERE "timeline"."monitorId" = "monitor"."_id" OFFSET 1 LIMIT 1)`,
    ]) {
      expect({
        trace,
        isRead: STAMP_MEASURED_MONITORS_SQL.includes(trace),
      }).toEqual({ trace, isRead: true });
    }
  });

  test("every column it reads is one of the models'", () => {
    const columns: Array<string> = Array.from(
      STAMP_MEASURED_MONITORS_SQL.matchAll(/"monitor"\."([A-Za-z]+)"/g),
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
