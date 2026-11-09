import RumApplication from "../../Models/DatabaseModels/RumApplication";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumnType from "../../Types/Database/TableColumnType";
import {
  RUM_TELEMETRY_SIGNAL_COLUMNS,
  RumTelemetrySignal,
} from "../../Types/Rum/RumTelemetrySignal";
import { AddRumSignalArrivals1809063215770 } from "../../Server/Infrastructure/Postgres/SchemaMigrations/1809063215770-AddRumSignalArrivals";
import SchemaMigrations from "../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { describe, expect, test } from "@jest/globals";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import fs from "fs";
import path from "path";

/*
 * WHEN EACH KIND OF TELEMETRY LAST ARRIVED FROM A RUM APPLICATION (issue
 * #5770): tracesLastReceivedAt, logsLastReceivedAt, metricsLastReceivedAt
 * and signalArrivalsTrackedSince on RumApplication, with the migration that
 * adds them.
 *
 *   - The three stamps are nullable dates: nothing has arrived until
 *     something does. Ingest writes them as root; nobody sets them by hand,
 *     and whoever may read the application's lastSeenAt may read them.
 *   - signalArrivalsTrackedSince defaults to now() in the model and in the
 *     migration: a new application is tracked from its creation, and every
 *     application that existed before the migration from the moment it ran
 *     - so "no logs have arrived since <that date>" is never a claim about
 *     the time before it.
 *   - The migration is executed against a recording query runner rather
 *     than read as text, so up() and down() cannot swap unnoticed.
 */

const STAMP_COLUMNS: ReadonlyArray<string> = [
  "tracesLastReceivedAt",
  "logsLastReceivedAt",
  "metricsLastReceivedAt",
];
const TRACKED_SINCE: string = "signalArrivalsTrackedSince";
const NEW_COLUMNS: ReadonlyArray<string> = [...STAMP_COLUMNS, TRACKED_SINCE];

// The column these are read beside, and governed as.
const LAST_SEEN: string = "lastSeenAt";

const MIGRATIONS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

// A statement that writes rows rather than the table's shape.
const ROW_STATEMENT: RegExp = /\b(UPDATE|INSERT|DELETE)\b/i;

// The 13-digit timestamp a migration class is named after.
function timestampOf(migrationClass: unknown): number | null {
  const name: string = (migrationClass as { name?: string }).name || "";
  const match: RegExpMatchArray | null = name.match(/(\d{13})$/);
  return match ? Number(match[1]) : null;
}

function typeOrmColumn(column: string): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (candidate: ColumnMetadataArgs): boolean => {
      return (
        candidate.target === RumApplication && candidate.propertyName === column
      );
    },
  );
}

function accessControlFor(column: string): ColumnAccessControl | null {
  return new RumApplication().getColumnAccessControlFor(column);
}

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner;

  await run(runner);

  return statements;
}

describe("RumApplication's signal arrival columns", () => {
  test("are nullable dates, and none is required", () => {
    const app: RumApplication = new RumApplication();

    for (const column of NEW_COLUMNS) {
      expect({
        column,
        type: app.getTableColumnMetadata(column)?.type,
        required: Boolean(app.getTableColumnMetadata(column)?.required),
        databaseType: typeOrmColumn(column)?.options.type,
        nullable: typeOrmColumn(column)?.options.nullable,
      }).toEqual({
        column,
        type: TableColumnType.Date,
        required: false,
        databaseType: ColumnType.Date,
        nullable: true,
      });
    }
  });

  test("are read by whoever reads the application's lastSeenAt, and set by nobody", () => {
    const lastSeen: ColumnAccessControl | null = accessControlFor(LAST_SEEN);

    expect(lastSeen?.read?.length).toBeGreaterThan(0);

    for (const column of NEW_COLUMNS) {
      expect({ column, access: accessControlFor(column) }).toEqual({
        column,
        access: { create: [], read: lastSeen?.read, update: [] },
      });
    }
  });

  test("the stamps have no default; the tracked-since date is now() when a row is made", () => {
    for (const column of STAMP_COLUMNS) {
      expect({
        column,
        default: typeOrmColumn(column)?.options.default,
      }).toEqual({ column, default: undefined });
    }

    const trackedSinceDefault: unknown =
      typeOrmColumn(TRACKED_SINCE)?.options.default;
    expect(typeof trackedSinceDefault).toBe("function");
    expect((trackedSinceDefault as () => string)()).toBe("now()");
  });

  test("each signal ingest stamps has a column of its own on the model", () => {
    expect(
      Object.values(RumTelemetrySignal).map(
        (signal: RumTelemetrySignal): string => {
          return RUM_TELEMETRY_SIGNAL_COLUMNS[signal];
        },
      ),
    ).toEqual([...STAMP_COLUMNS]);

    const app: RumApplication = new RumApplication();
    for (const column of STAMP_COLUMNS) {
      expect({ column, isColumn: app.isTableColumn(column) }).toEqual({
        column,
        isColumn: true,
      });
    }
  });
});

describe("AddRumSignalArrivals1809063215770", () => {
  const migration: MigrationInterface = new AddRumSignalArrivals1809063215770();

  test("up() adds the three stamps empty, and the tracked-since date as of now()", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner): Promise<void> => {
        return migration.up(runner);
      },
    );

    expect(statements).toEqual([
      `ALTER TABLE "RumApplication" ADD "tracesLastReceivedAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "RumApplication" ADD "logsLastReceivedAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "RumApplication" ADD "metricsLastReceivedAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "RumApplication" ADD "signalArrivalsTrackedSince" TIMESTAMP WITH TIME ZONE DEFAULT now()`,
    ]);
  });

  test("up() rewrites no row and backfills nothing: the column default does it", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner): Promise<void> => {
        return migration.up(runner);
      },
    );

    expect(
      statements.filter((sql: string): boolean => {
        return ROW_STATEMENT.test(sql);
      }),
    ).toEqual([]);
  });

  test("down() drops exactly what up() added, newest first", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner): Promise<void> => {
        return migration.down(runner);
      },
    );

    expect(statements).toEqual(
      [...NEW_COLUMNS].reverse().map((column: string): string => {
        return `ALTER TABLE "RumApplication" DROP COLUMN "${column}"`;
      }),
    );
  });

  test("is registered once, under its own name, in its file", () => {
    const className: string = AddRumSignalArrivals1809063215770.name;
    const timestamp: number | null = timestampOf(
      AddRumSignalArrivals1809063215770,
    );

    expect(timestamp).not.toBeNull();
    expect(
      SchemaMigrations.filter((entry: unknown): boolean => {
        return entry === AddRumSignalArrivals1809063215770;
      }),
    ).toHaveLength(1);
    expect((migration as { name?: string }).name).toBe(className);
    expect(
      fs.existsSync(
        path.join(MIGRATIONS_DIR, `${timestamp}-AddRumSignalArrivals.ts`),
      ),
    ).toBe(true);
  });

  /*
   * A fresh install runs the registry in its order, while one that already
   * ran every migration before this one runs it last: the two agree only if
   * it sorts above each of them. Migrations registered after it are theirs
   * to number (SchemaMigrationsOrdering holds the newest to that).
   */
  test("sorts above every migration registered before it", () => {
    const position: number = SchemaMigrations.indexOf(
      AddRumSignalArrivals1809063215770,
    );
    const timestamp: number = timestampOf(AddRumSignalArrivals1809063215770)!;

    expect(position).toBeGreaterThan(100);

    const higherBefore: Array<string> = SchemaMigrations.slice(0, position)
      .filter((entry: unknown): boolean => {
        const earlier: number | null = timestampOf(entry);
        return earlier !== null && earlier >= timestamp;
      })
      .map((entry: unknown): string => {
        return (entry as { name: string }).name;
      });

    expect(higherBefore).toEqual([]);
  });
});
