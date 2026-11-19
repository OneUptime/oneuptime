import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddRuleEmptiedLimits1809182490000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182490000-AddRuleEmptiedLimits";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentOnCallRule from "../../../../Models/DatabaseModels/IncidentOnCallRule";
import RuleBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/RuleBaseModel";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { getRuleLimitLists } from "../../../../Server/Utils/Rules/RuleLimitLists";
import ModelImportExport from "../../../../Utils/ModelImportExport";

/*
 * The migration behind a rule switched off because what it was limited to
 * was deleted (#9066): RuleBaseModel.emptiedLimits, on the table of every
 * rule kind - the 152 match lists and 3 scope lists of RuleLimitLists are
 * all on such tables.
 *
 * The statements run against a fake QueryRunner, so up() and down() are told
 * apart. A nullable column with no default changes each table's catalog
 * entry only - nothing is scanned, rewritten or backfilled - and the column
 * is in no index. The migration has to be registered, named for its class
 * and ordered after every migration before it, or it never runs; the schema
 * drift check holds its statements to the model.
 */

const MIGRATION_TIMESTAMP: string = "1809182490000";
const MIGRATION_BASE_NAME: string = "AddRuleEmptiedLimits";
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
  const migration: MigrationInterface = new AddRuleEmptiedLimits1809182490000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

/*
 * Rule tables created after this migration shipped, each with emptiedLimits
 * in its own CREATE TABLE (the drift check holds it to the model): a
 * migration is a snapshot, never edited to cover a table it predates. Only
 * ever append here.
 */
const RULE_TABLES_CREATED_AFTER_MIGRATION: ReadonlyArray<string> = [
  // 1809184800000-AddDataPipelineOwnerRules
  "DataPipelineOwnerRule",
];

// The table of every rule kind this migration covers: every model built on RuleBaseModel.
const RULE_TABLES: Array<string> = (
  AllModelTypes as Array<{ new (): BaseModel }>
)
  .map((modelType: { new (): BaseModel }): BaseModel => {
    return new modelType();
  })
  .filter((model: BaseModel): boolean => {
    return model instanceof RuleBaseModel;
  })
  .map((model: BaseModel): string => {
    return model.tableName!;
  })
  .filter((tableName: string): boolean => {
    return !RULE_TABLES_CREATED_AFTER_MIGRATION.includes(tableName);
  })
  .sort();

function tablesOf(statements: Array<string>, pattern: RegExp): Array<string> {
  return statements
    .map((statement: string): string => {
      const match: RegExpMatchArray | null = statement.match(pattern);
      return match?.[1] || "";
    })
    .sort();
}

describe("AddRuleEmptiedLimits1809182490000", () => {
  test("adds emptiedLimits to the table of every rule kind, as nullable jsonb", async () => {
    const statements: Array<string> = await statementsOf("up");

    expect(RULE_TABLES.length).toBeGreaterThan(85);
    expect(
      tablesOf(statements, /^ALTER TABLE "(\w+)" ADD "emptiedLimits" jsonb$/),
    ).toEqual(RULE_TABLES);
  });

  test("covers the table of every rule a list can limit", () => {
    for (const list of getRuleLimitLists()) {
      expect(RULE_TABLES).toContain(list.ruleTable);
    }
  });

  test("builds no index, adds no key or default, and writes no row", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE |INSERT |DELETE /i,
      );
    }
  });

  test("down drops the column from every table up added it to, and nothing else", async () => {
    expect(
      tablesOf(
        await statementsOf("down"),
        /^ALTER TABLE "(\w+)" DROP COLUMN "emptiedLimits"$/,
      ),
    ).toEqual(RULE_TABLES);
  });

  test("the model declares the column: JSON, not required, written by OneUptime alone and read by everyone who reads the rule", () => {
    const rule: IncidentOnCallRule = new IncidentOnCallRule();

    expect(rule.getTableColumns().columns).toContain("emptiedLimits");
    expect(rule.getTableColumnMetadata("emptiedLimits").type).toBe(
      TableColumnType.JSON,
    );
    expect(rule.getTableColumnMetadata("emptiedLimits").required).toBeFalsy();
    expect(rule.getTableColumnMetadata("emptiedLimits").computed).toBe(true);
    expect(rule.getColumnAccessControlFor("emptiedLimits")?.create).toEqual([]);
    expect(rule.getColumnAccessControlFor("emptiedLimits")?.update).toEqual([]);
    expect(rule.getColumnAccessControlFor("emptiedLimits")?.read).toEqual(
      rule.readRecordPermissions,
    );
    expect(
      rule.getColumnAccessControlFor("emptiedLimits")?.read?.length,
    ).toBeGreaterThan(0);
  });

  test("is never exported or imported: a copy of a rule was switched off by nothing", () => {
    expect(
      ModelImportExport.getImportExportableColumnNames(IncidentOnCallRule),
    ).not.toContain("emptiedLimits");
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
    expect(new AddRuleEmptiedLimits1809182490000().name).toBe(
      MIGRATION_CLASS_NAME,
    );

    const timestamps: Array<number> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .map((file: string): number => {
        return Number(file.split("-")[0]);
      })
      .filter((value: number): boolean => {
        return Number.isFinite(value) && value > 0;
      });

    // After every migration whose file was there before it.
    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(
      Math.max(
        ...timestamps.filter((value: number): boolean => {
          return value <= 1809182480026;
        }),
      ),
    );
    expect(names.indexOf(MIGRATION_CLASS_NAME)).toBeGreaterThan(
      names.indexOf("AddCustomFieldsAndRemindersToUpdatesToPost1809182480026"),
    );
    expect(
      names.indexOf("AddCustomFieldsAndRemindersToUpdatesToPost1809182480026"),
    ).toBeGreaterThan(-1);
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
