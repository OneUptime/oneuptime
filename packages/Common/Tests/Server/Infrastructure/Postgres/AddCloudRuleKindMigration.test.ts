import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddCloudRuleKind1808760000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808760000000-AddCloudRuleKind";
import CloudResourceLabelRule from "../../../../Models/DatabaseModels/CloudResourceLabelRule";
import CloudResourceOwnerRule from "../../../../Models/DatabaseModels/CloudResourceOwnerRule";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind each product's own cloud rules: Cloud and App
 * Platforms became two products over one CloudResource table, and an owner
 * or label rule now names the kind of row it is for. One nullable column
 * on each rule table, added without a default and without touching a row,
 * so every rule a project has stays a rule for both kinds and keeps
 * matching exactly what it matched - and on a big table it is a catalogue
 * change, not a rewrite (online: no lock held while rows are written).
 *
 * Run against a fake QueryRunner, so the statements are what is pinned;
 * the schema drift check holds them to the models, and the migration ran
 * up, down and up again on a real Postgres 15 when it was written.
 */

const MIGRATION_TIMESTAMP: string = "1808760000000";
const MIGRATION_BASE_NAME: string = "AddCloudRuleKind";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

async function statementsOf(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface = new AddCloudRuleKind1808760000000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddCloudRuleKind1808760000000", () => {
  test("adds one nullable column to each cloud rule table, with no default and no row written", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "CloudResourceLabelRule" ADD "cloudResourceKind" character varying(100)`,
      `ALTER TABLE "CloudResourceOwnerRule" ADD "cloudResourceKind" character varying(100)`,
    ]);

    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(/NOT NULL|DEFAULT|UPDATE /);
    }
  });

  test.each([
    ["CloudResourceLabelRule", CloudResourceLabelRule],
    ["CloudResourceOwnerRule", CloudResourceOwnerRule],
  ])(
    "%s declares the column as the migration makes it: optional, short text",
    (_name: string, modelType: { new (): unknown }) => {
      const model: {
        getTableColumnMetadata: (column: string) => {
          type: TableColumnType;
          required?: boolean;
        };
      } = new modelType() as never;

      expect(model.getTableColumnMetadata("cloudResourceKind").type).toBe(
        TableColumnType.ShortText,
      );
      expect(
        Boolean(model.getTableColumnMetadata("cloudResourceKind").required),
      ).toBe(false);
    },
  );

  test("down takes away exactly what up added, in reverse", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "CloudResourceOwnerRule" DROP COLUMN "cloudResourceKind"`,
      `ALTER TABLE "CloudResourceLabelRule" DROP COLUMN "cloudResourceKind"`,
    ]);
  });

  test("is registered once, under its own name, after every migration before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );

    expect(
      names.filter((name: string): boolean => {
        return name === MIGRATION_CLASS_NAME;
      }),
    ).toHaveLength(1);
    expect(new AddCloudRuleKind1808760000000().name).toBe(MIGRATION_CLASS_NAME);

    // It runs after every migration with an earlier timestamp.
    const earlier: Array<string> = names.filter((name: string): boolean => {
      const timestamp: number = Number(name.match(/(\d{13})$/)?.[1] || 0);
      return timestamp > 0 && timestamp < Number(MIGRATION_TIMESTAMP);
    });

    for (const name of earlier) {
      expect({
        name,
        before: names.indexOf(name) < names.indexOf(MIGRATION_CLASS_NAME),
      }).toEqual({
        name,
        before: true,
      });
    }

    expect(
      fs.existsSync(
        path.join(
          MIGRATION_DIRECTORY,
          `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`,
        ),
      ),
    ).toBe(true);
  });
});
