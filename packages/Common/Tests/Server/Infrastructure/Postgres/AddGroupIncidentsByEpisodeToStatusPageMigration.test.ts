import { AddGroupIncidentsByEpisodeToStatusPage1809187560767 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187560767-AddGroupIncidentsByEpisodeToStatusPage";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import ColumnType from "../../../../Types/Database/ColumnType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * Show Incidents Grouped by Episode (StatusPage.groupIncidentsByEpisode, #10767):
 * on for a new status page, off for every page made before it, so an
 * existing page shows what it always showed until someone turns it on.
 *
 * This pins the migration's statements against the model - the column ends
 * as the model declares it, so the Schema Drift job finds nothing - and that
 * it gets there by adding the column off before making on its default, with
 * no write to a row. Fake QueryRunner only; the Postgres test beside it
 * (AddGroupIncidentsByEpisodeToStatusPagePostgres) runs it on real rows.
 */

const OWN_CLASS_NAME: string =
  "AddGroupIncidentsByEpisodeToStatusPage1809187560767";

const MIGRATION_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
  "1809187560767-AddGroupIncidentsByEpisodeToStatusPage.ts",
);

function timestampOfClassName(className: string): number | null {
  const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
  return match ? Number(match[1]) : null;
}

const registeredNames: Array<string> = (
  SchemaMigrations as unknown as Array<{ name: string }>
).map((migration: { name: string }): string => {
  return migration.name;
});

async function recordQueries(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  await new AddGroupIncidentsByEpisodeToStatusPage1809187560767()[direction](
    queryRunner,
  );

  return statements;
}

function declaredColumn(property: string): ColumnMetadataArgs {
  const declared: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find(
      (column: ColumnMetadataArgs): boolean => {
        return column.target === StatusPage && column.propertyName === property;
      },
    );

  if (!declared) {
    throw new Error(`StatusPage declares no column ${property}`);
  }

  return declared;
}

describe("AddGroupIncidentsByEpisodeToStatusPage migration - identity and registration", () => {
  test("its class and name carry its stamp", () => {
    const source: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(source).toContain(`export class ${OWN_CLASS_NAME}`);
    expect(source).toContain(`public name: string = "${OWN_CLASS_NAME}";`);
    expect(new AddGroupIncidentsByEpisodeToStatusPage1809187560767().name).toBe(
      OWN_CLASS_NAME,
    );
  });

  test("is registered, so the column reaches every database", () => {
    expect(registeredNames).toContain(OWN_CLASS_NAME);
  });

  test("runs after every migration registered before it", () => {
    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);
    const ownTimestamp: number = timestampOfClassName(OWN_CLASS_NAME)!;

    expect(ownIndex).toBeGreaterThan(0);

    const notBehind: Array<string> = registeredNames
      .slice(0, ownIndex)
      .filter((className: string): boolean => {
        const timestamp: number | null = timestampOfClassName(className);
        return timestamp !== null && timestamp >= ownTimestamp;
      });

    expect(notBehind).toEqual([]);
  });
});

describe("AddGroupIncidentsByEpisodeToStatusPage migration - up()", () => {
  test("adds the column off, then makes on its default, in that order", async () => {
    expect(await recordQueries("up")).toEqual([
      `ALTER TABLE "StatusPage" ADD "groupIncidentsByEpisode" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "StatusPage" ALTER COLUMN "groupIncidentsByEpisode" SET DEFAULT true`,
    ]);
  });

  test("ends where the model is: a boolean that is never null, on by default", () => {
    const declared: ColumnMetadataArgs = declaredColumn(
      "groupIncidentsByEpisode",
    );

    expect(declared.options.type).toBe(ColumnType.Boolean);
    expect(declared.options.nullable).toBe(false);
    expect(declared.options.default).toBe(true);
  });

  test("the model says on for a new page, as the column's default does", () => {
    const page: StatusPage = new StatusPage();

    expect(
      page.getTableColumnMetadata("groupIncidentsByEpisode")?.defaultValue,
    ).toBe(true);
    expect(
      page.getTableColumnMetadata("groupIncidentsByEpisode")
        ?.isDefaultValueColumn,
    ).toBe(true);
  });

  test("writes no row: every existing page reads off from the column's first default", async () => {
    const statements: Array<string> = await recordQueries("up");
    const writesARow: RegExp = /^(UPDATE|INSERT|DELETE)/i;

    expect(
      statements.filter((statement: string): boolean => {
        return writesARow.test(statement.trim());
      }),
    ).toEqual([]);
  });

  test("touches only the status page table", async () => {
    for (const statement of await recordQueries("up")) {
      expect(statement).toMatch(/^ALTER TABLE "StatusPage" /);
    }
  });

  test("builds no index and adds no key, so nothing scans the table", async () => {
    for (const statement of await recordQueries("up")) {
      expect(statement).not.toMatch(/CREATE INDEX|FOREIGN KEY|CONSTRAINT/);
    }
  });
});

describe("AddGroupIncidentsByEpisodeToStatusPage migration - down()", () => {
  test("drops the column again", async () => {
    expect(await recordQueries("down")).toEqual([
      `ALTER TABLE "StatusPage" DROP COLUMN "groupIncidentsByEpisode"`,
    ]);
  });
});
