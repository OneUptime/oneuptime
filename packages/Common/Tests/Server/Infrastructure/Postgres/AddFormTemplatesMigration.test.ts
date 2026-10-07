import { AddFormTemplates1799500000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1799500000000-AddFormTemplates";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import Form from "../../../../Models/DatabaseModels/Form";
import ColumnType from "../../../../Types/Database/ColumnType";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage, QueryRunner } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * AddFormTemplates: a form's templates (Form.templates), a nullable JSON
 * list. The statement only adds the column - no default, nothing rewritten
 * - so every existing form starts with no templates and a public page
 * exactly as it was.
 */

const MIGRATION_NAME: string = "AddFormTemplates1799500000000";

async function record(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const queryRunner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;

  await new AddFormTemplates1799500000000()[direction](queryRunner);

  return statements;
}

describe("AddFormTemplates migration", () => {
  test("lives at its stamp, with a name that carries it", () => {
    expect(new AddFormTemplates1799500000000().name).toBe(MIGRATION_NAME);
  });

  test("is registered once, directly after the migration it was numbered to follow", () => {
    const names: Array<string> = (
      SchemaMigrations as unknown as Array<{ name: string }>
    ).map((migration: { name: string }): string => {
      return migration.name;
    });

    expect(
      names.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(
      names.indexOf(
        "AddAutomaticRemediationSwitchesAndInvestigationRules1799400000000",
      ),
    ).toBe(names.indexOf(MIGRATION_NAME) - 1);
  });

  test("up adds the nullable jsonb column, and only that", async () => {
    expect(await record("up")).toEqual([
      `ALTER TABLE "Form" ADD "templates" jsonb`,
    ]);
  });

  test("down drops it again", async () => {
    expect(await record("down")).toEqual([
      `ALTER TABLE "Form" DROP COLUMN "templates"`,
    ]);
  });

  test("matches the model: a nullable JSON column with no default", () => {
    const column: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
      .columns.filter((entry: ColumnMetadataArgs): boolean => {
        return entry.target === Form && entry.propertyName === "templates";
      })
      .pop();

    expect(column).toBeDefined();
    expect(column!.options.type).toBe(ColumnType.JSON);
    expect(ColumnType.JSON).toBe("jsonb");
    expect(column!.options.nullable).toBe(true);
    expect(column!.options.default).toBeUndefined();
  });
});
