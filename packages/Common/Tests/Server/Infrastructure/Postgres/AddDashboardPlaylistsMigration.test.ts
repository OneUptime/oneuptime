import { AddScheduledMaintenancePublishOnStatusPageAt1807960000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1807960000000-AddScheduledMaintenancePublishOnStatusPageAt";
import { AddDashboardPlaylists1808070000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808070000000-AddDashboardPlaylists";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import DashboardPlaylist from "../../../../Models/DatabaseModels/DashboardPlaylist";
import { getTableColumns } from "../../../../Types/Database/TableColumn";
import { MigrationInterface, QueryRunner } from "typeorm";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind dashboard playlists (issue #5235): one new table,
 * DashboardPlaylist, with an index on its project and its keys to the
 * project and the users who created and deleted a playlist.
 *
 * The table is new, so its index is built and its keys checked on no rows
 * (SchemaMigrationsOnlineDdl leaves a table created in the same migration
 * alone). No existing row is read or written. Statements are recorded
 * against a fake QueryRunner; the schema drift check runs the migration on
 * Postgres against the model.
 */

const MIGRATION_NAME: string = "AddDashboardPlaylists1808070000000";
const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;
// A column of a CREATE TABLE: its quoted name, then its type.
const CREATED_COLUMN: RegExp = /(?:\(|, )"([A-Za-z_]+)" [A-Za-z]/g;
const CREATE_TABLE: RegExp = /^CREATE TABLE "([A-Za-z]+)"/;
const DROP_TABLE: RegExp = /^DROP TABLE "([A-Za-z]+)"$/;
const ADD_CONSTRAINT: RegExp = /ADD CONSTRAINT "([A-Za-z0-9_]+)"/;
const DROP_CONSTRAINT: RegExp = /DROP CONSTRAINT "([A-Za-z0-9_]+)"$/;
const CREATE_INDEX: RegExp = /^CREATE INDEX "([A-Za-z0-9_]+)"/;
const DROP_INDEX: RegExp = /^DROP INDEX "public"\."([A-Za-z0-9_]+)"$/;
const ROW_STATEMENT: RegExp = /^\s*(UPDATE|INSERT|DELETE|SELECT)\b/i;

type MigrationClass = new () => MigrationInterface;

async function record(direction: "up" | "down"): Promise<Array<string>> {
  const steps: Array<string> = [];
  const runner: QueryRunner = {
    isTransactionActive: true,
    query: async (sql: string): Promise<void> => {
      steps.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: AddDashboardPlaylists1808070000000 =
    new AddDashboardPlaylists1808070000000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return steps;
}

function timestampOf(migration: MigrationClass): number {
  const match: RegExpMatchArray | null =
    migration.name.match(TRAILING_TIMESTAMP);

  return match ? parseInt(match[1]!, 10) : 0;
}

// What each statement names, by the pattern that finds it.
function named(steps: Array<string>, pattern: RegExp): Array<string> {
  return steps.flatMap((step: string): Array<string> => {
    const match: RegExpMatchArray | null = step.match(pattern);

    return match ? [match[1]!] : [];
  });
}

function createStatement(steps: Array<string>): string {
  const statement: string | undefined = steps.find((step: string) => {
    return step.startsWith(`CREATE TABLE "DashboardPlaylist" `);
  });

  expect(statement).toBeDefined();

  return statement!;
}

function columnsCreated(statement: string): Array<string> {
  return Array.from(statement.matchAll(CREATED_COLUMN))
    .map((match: RegExpMatchArray): string => {
      return match[1]!;
    })
    .sort();
}

describe("the Dashboard Playlists migration", () => {
  test("names itself after its timestamp", () => {
    expect(new AddDashboardPlaylists1808070000000().name).toBe(MIGRATION_NAME);
  });

  test("is registered once, after AddScheduledMaintenancePublishOnStatusPageAt, above every migration before it", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(AddDashboardPlaylists1808070000000);

    expect(
      registered.filter((candidate: MigrationClass): boolean => {
        return candidate === AddDashboardPlaylists1808070000000;
      }),
    ).toHaveLength(1);
    expect(at).toBeGreaterThan(
      registered.indexOf(
        AddScheduledMaintenancePublishOnStatusPageAt1807960000000,
      ),
    );

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddDashboardPlaylists1808070000000),
      );
    }
  });

  test("is backed by exactly one file", () => {
    const files: Array<string> = fs.readdirSync(
      path.join(
        __dirname,
        "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
      ),
    );

    expect(
      files.filter((file: string): boolean => {
        return file.startsWith(
          `${timestampOf(AddDashboardPlaylists1808070000000)}-`,
        );
      }),
    ).toEqual(["1808070000000-AddDashboardPlaylists.ts"]);
  });

  test("runs inside the migration's transaction: everything it builds is on a new, empty table", () => {
    expect(
      (new AddDashboardPlaylists1808070000000() as { transaction?: boolean })
        .transaction,
    ).toBeUndefined();
  });

  test("creates the playlists' table with every column the model stores, and the base model's own", async () => {
    const playlist: DashboardPlaylist = new DashboardPlaylist();
    const stored: Array<string> = Object.keys(getTableColumns(playlist))
      .filter((column: string): boolean => {
        return !playlist.isEntityColumn(column);
      })
      .concat(["createdAt", "updatedAt", "deletedAt", "version"])
      .filter((column: string, index: number, all: Array<string>) => {
        return all.indexOf(column) === index;
      })
      .sort();

    expect(columnsCreated(createStatement(await record("up")))).toEqual(stored);
  });

  test("keeps the playlist's dashboards as JSON, its name required and its interval a minute unless set", async () => {
    const statement: string = createStatement(await record("up"));

    expect(statement).toContain(`"dashboards" jsonb,`);
    expect(statement).toContain(`"name" character varying(100) NOT NULL`);
    expect(statement).toContain(
      `"intervalInSeconds" integer NOT NULL DEFAULT '60'`,
    );
    expect(statement).toContain(`"projectId" uuid NOT NULL`);
  });

  test("indexes the project its lists are read by", async () => {
    expect(
      (await record("up")).filter((step: string): boolean => {
        return step.startsWith("CREATE INDEX ");
      }),
    ).toEqual([
      `CREATE INDEX "IDX_e1ca8e92828cf4117f8228007f" ON "DashboardPlaylist" ("projectId") `,
    ]);
  });

  test("a deleted project takes its playlists with it; a deleted user leaves them", async () => {
    const steps: Array<string> = await record("up");
    const keyOf: (column: string) => string | undefined = (
      column: string,
    ): string | undefined => {
      return steps.find((step: string): boolean => {
        return (
          step.startsWith(`ALTER TABLE "DashboardPlaylist" ADD CONSTRAINT `) &&
          step.includes(`FOREIGN KEY ("${column}")`)
        );
      });
    };

    expect(keyOf("projectId")).toContain(
      `REFERENCES "Project"("_id") ON DELETE CASCADE`,
    );
    expect(keyOf("createdByUserId")).toContain(
      `REFERENCES "User"("_id") ON DELETE SET NULL`,
    );
    expect(keyOf("deletedByUserId")).toContain(
      `REFERENCES "User"("_id") ON DELETE SET NULL`,
    );
  });

  test("touches no other table, and reads or writes no row", async () => {
    for (const step of await record("up")) {
      expect(step).toMatch(/"DashboardPlaylist"/);
    }

    for (const step of [...(await record("up")), ...(await record("down"))]) {
      expect(step).not.toMatch(ROW_STATEMENT);
    }
  });

  test("down drops exactly what up made, keys first and the table last", async () => {
    const up: Array<string> = await record("up");
    const down: Array<string> = await record("down");

    expect(named(down, DROP_TABLE)).toEqual(named(up, CREATE_TABLE));
    expect(named(down, DROP_CONSTRAINT).sort()).toEqual(
      named(up, ADD_CONSTRAINT).sort(),
    );
    expect(named(down, DROP_INDEX)).toEqual(named(up, CREATE_INDEX));
    expect(down[down.length - 1]).toBe(`DROP TABLE "DashboardPlaylist"`);
  });
});
