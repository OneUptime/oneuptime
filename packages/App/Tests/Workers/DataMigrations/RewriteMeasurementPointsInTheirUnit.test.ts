import DatabaseService from "Common/Server/Services/DatabaseService";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import RewriteMeasurementPointsInTheirUnit from "../../../FeatureSet/Workers/DataMigrations/RewriteMeasurementPointsInTheirUnit";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A measurement's unit used to be free text, and its chart points were
 * written in seconds whatever it said - "minutes" charted an hour and a half
 * as 5,400 minutes. The metric writer now writes each point in the unit, and
 * this migration has the backfill worker write the old points again for
 * every measurement whose unit is minutes, hours or days.
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts (as text - an unregistered
 *      migration never runs), once, before the slot AddAuditLogMcpClientColumns
 *      keeps last;
 *   2. it covers the incident, alert and scheduled maintenance measurements;
 *   3. it restarts the backfill of exactly the measurements whose unit is not
 *      seconds - a unit that reads as seconds had its points right already;
 *   4. one table's failure is logged and the rest still run.
 */

const MIGRATION_NAME: string = "RewriteMeasurementPointsInTheirUnit";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

interface Update {
  table: string;
  id: string;
  data: Record<string, unknown>;
}

describe("RewriteMeasurementPointsInTheirUnit", () => {
  const migration: RewriteMeasurementPointsInTheirUnit =
    new RewriteMeasurementPointsInTheirUnit();

  // Kept for the whole suite, emptied before each test.
  const updates: Array<Update> = [];
  const failing: Set<string> = new Set<string>();
  const errorLogs: Array<string> = [];
  const units: Record<string, Array<string>> = {};

  beforeEach(() => {
    updates.length = 0;
    failing.clear();
    errorLogs.length = 0;

    for (const table of Object.keys(units)) {
      delete units[table];
    }

    jest.spyOn(logger, "error").mockImplementation((message: unknown): void => {
      errorLogs.push(String(message));
      return undefined;
    });
    jest.spyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });

    for (const service of RewriteMeasurementPointsInTheirUnit.getServices()) {
      const table: string = service.getModel().tableName || "";

      jest.spyOn(service, "findAllBy").mockImplementation((async (args: {
        query: Record<string, unknown>;
        props: { isRoot?: boolean };
      }) => {
        if (failing.has(table)) {
          throw new Error(`${table} is locked`);
        }

        expect(Object.keys(args.query)).toEqual(["unit"]);
        expect(args.props.isRoot).toBe(true);

        return (units[table] || []).map((unit: string, index: number) => {
          return { _id: `${table}-${index}`, unit };
        });
      }) as never);

      jest.spyOn(service, "updateOneById").mockImplementation((async (args: {
        id: ObjectID;
        data: Record<string, unknown>;
      }) => {
        updates.push({
          table,
          id: args.id.toString(),
          data: args.data,
        });
      }) as never);
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is named after itself, so it runs once", () => {
    expect(migration.name).toBe(MIGRATION_NAME);
  });

  test("is registered once, before the slot AddAuditLogMcpClientColumns keeps last", () => {
    const index: string = fs
      .readFileSync(path.join(DATA_MIGRATIONS_DIR, "Index.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

    expect(index).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

    const registered: Array<string> = Array.from(
      index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 1,
    );
  });

  test("covers the incident, alert and scheduled maintenance measurements", () => {
    expect(
      RewriteMeasurementPointsInTheirUnit.getServices()
        .map((service: DatabaseService<any>): string => {
          return service.getModel().tableName || "";
        })
        .sort(),
    ).toEqual([
      "AlertMeasurement",
      "IncidentMeasurement",
      "ScheduledMaintenanceMeasurement",
    ]);
  });

  test("restarts the backfill of each measurement in minutes, hours or days, from the beginning", async () => {
    units["IncidentMeasurement"] = ["minutes", "seconds", "Hours"];
    units["AlertMeasurement"] = ["d"];
    units["ScheduledMaintenanceMeasurement"] = ["secs"];

    await migration.migrate();

    expect(
      updates.map((update: Update): string => {
        return update.id;
      }),
    ).toEqual([
      "IncidentMeasurement-0",
      "IncidentMeasurement-2",
      "AlertMeasurement-0",
    ]);

    for (const update of updates) {
      expect(update.data["backfillRequestedAt"]).toBeInstanceOf(Date);
      expect(update.data["backfillCursorCreatedAt"]).toBeNull();
      expect(update.data["backfillCompletedAt"]).toBeNull();
      expect(Object.keys(update.data).sort()).toEqual([
        "backfillCompletedAt",
        "backfillCursorCreatedAt",
        "backfillRequestedAt",
      ]);
    }
  });

  test("leaves alone a unit that reads as seconds, whose points were right already", async () => {
    units["IncidentMeasurement"] = ["seconds", "s", "Second", "", "widgets"];

    await migration.migrate();

    expect(updates).toEqual([]);
  });

  test("logs a table it cannot read and goes on with the rest, so it never halts the migrations after it", async () => {
    failing.add("IncidentMeasurement");
    units["AlertMeasurement"] = ["minutes"];

    await expect(migration.migrate()).resolves.toBeUndefined();

    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0]).toContain("IncidentMeasurement");
    expect(
      updates.map((update: Update): string => {
        return update.id;
      }),
    ).toEqual(["AlertMeasurement-0"]);
  });

  test("has nothing to roll back", async () => {
    await expect(migration.rollback()).resolves.toBeUndefined();
  });
});
