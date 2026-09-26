import { AddIncidentTemplateStatusPageScopeFlag1795500000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1795500000000-AddIncidentTemplateStatusPageScopeFlag";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import IncidentTemplate from "../../../../Models/DatabaseModels/IncidentTemplate";
import ColumnType from "../../../../Types/Database/ColumnType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * IncidentTemplate.isScopedToStatusPages: whether a template limits the
 * incidents declared from it to status pages, kept apart from its list of
 * pages so a template whose pages were all deleted does not start declaring
 * incidents that reach every status page.
 *
 * It pins that the column matches the model (a mismatch is a red Schema Drift
 * job), that templates already listing status pages come out scoped and no
 * other template changes, that down() undoes up(), and that the migration is
 * registered after the ones before it. Fake QueryRunner only; generating the
 * migration against a fully migrated database, applying it and generating
 * again to "No changes" is how the schema half was verified.
 */

const OWN_CLASS_NAME: string =
  "AddIncidentTemplateStatusPageScopeFlag1795500000000";

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
  "1795500000000-AddIncidentTemplateStatusPageScopeFlag.ts",
);

const registeredNames: Array<string> = (
  SchemaMigrations as unknown as Array<{ name: string }>
).map((migration: { name: string }): string => {
  return migration.name;
});

function timestampOfClassName(className: string): number | null {
  const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
  return match ? Number(match[1]) : null;
}

async function recordQueries(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  await new AddIncidentTemplateStatusPageScopeFlag1795500000000()[direction](
    queryRunner,
  );

  return statements;
}

describe("AddIncidentTemplateStatusPageScopeFlag migration - identity and registration", () => {
  test("lives at its round stamp, with a class and name that carry it", () => {
    const source: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(source).toContain(`export class ${OWN_CLASS_NAME}`);
    expect(source).toContain(`public name: string = "${OWN_CLASS_NAME}";`);
    expect(new AddIncidentTemplateStatusPageScopeFlag1795500000000().name).toBe(
      OWN_CLASS_NAME,
    );
  });

  test("is registered once, right after the incident scope migration", () => {
    expect(
      registeredNames.filter((name: string): boolean => {
        return name === OWN_CLASS_NAME;
      }),
    ).toHaveLength(1);

    expect(registeredNames.indexOf(OWN_CLASS_NAME)).toBe(
      registeredNames.indexOf("AddIncidentStatusPageScope1795400000000") + 1,
    );
  });

  test("its timestamp keeps it behind every migration registered before it", () => {
    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);
    const ownTimestamp: number = timestampOfClassName(OWN_CLASS_NAME)!;

    const notBehind: Array<string> = registeredNames
      .slice(0, ownIndex)
      .filter((className: string): boolean => {
        const timestamp: number | null = timestampOfClassName(className);
        return timestamp !== null && timestamp >= ownTimestamp;
      });

    expect(notBehind).toEqual([]);
  });
});

describe("AddIncidentTemplateStatusPageScopeFlag migration - up() and down()", () => {
  test("adds the column as the model declares it", async () => {
    const declared: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find(
        (column: ColumnMetadataArgs): boolean => {
          return (
            column.target === IncidentTemplate &&
            column.propertyName === "isScopedToStatusPages"
          );
        },
      );

    expect(declared?.options.type).toBe(ColumnType.Boolean);
    expect(declared?.options.nullable).toBe(false);
    expect(declared?.options.default).toBe(false);

    const statements: Array<string> = await recordQueries("up");

    expect(statements[0]).toBe(
      `ALTER TABLE "IncidentTemplate" ADD "isScopedToStatusPages" boolean NOT NULL DEFAULT false`,
    );
  });

  test("scopes the templates that already list status pages, and only those", async () => {
    const statements: Array<string> = await recordQueries("up");

    expect(statements).toHaveLength(2);
    expect(statements[1]).toBe(
      `UPDATE "IncidentTemplate" SET "isScopedToStatusPages" = true WHERE "_id" IN (SELECT "incidentTemplateId" FROM "IncidentTemplateStatusPage")`,
    );
  });

  test("touches no other table", async () => {
    for (const statement of await recordQueries("up")) {
      expect(statement).not.toMatch(/"Incident"\s/);
      expect(statement).not.toMatch(/ALTER TABLE "(?!IncidentTemplate")/);
    }
  });

  test("down() drops the column", async () => {
    expect(await recordQueries("down")).toEqual([
      `ALTER TABLE "IncidentTemplate" DROP COLUMN "isScopedToStatusPages"`,
    ]);
  });
});
