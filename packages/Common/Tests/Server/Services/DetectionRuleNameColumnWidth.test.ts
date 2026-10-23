import { describe, expect, jest, test } from "@jest/globals";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import { AddDetectionRuleAndGoogleSecOpsConnection1788000000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1788000000000-AddDetectionRuleAndGoogleSecOpsConnection";
import { WidenDetectionRuleName1806300000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1806300000000-WidenDetectionRuleName";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import ColumnLength, {
  getMaxLengthFromTableColumnType,
} from "../../../Types/Database/ColumnLength";
import ColumnType from "../../../Types/Database/ColumnType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { DETECTION_RULE_NAME_MAX_LENGTH } from "../../../Types/SecurityEvent/DetectionRuleName";
import { MigrationInterface, QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * A DETECTION RULE'S NAME HOLDS 100 CHARACTERS, AND THE MIGRATION THAT
 * WIDENS IT KEEPS EVERY NAME.
 *
 * DetectionRule.name was the 50-character Name type, so the Rule Library's
 * "Failed sign-ins, then a success from the same address" (53) failed Turn
 * on recommended. It is ShortText now, as 190 other models' names are.
 *
 * TypeORM generates the change as DROP COLUMN "name" + ADD "name" NOT NULL,
 * which would drop every rule's name - and fail outright on a table holding
 * a rule. WidenDetectionRuleName1806300000000 is ALTER COLUMN ... TYPE: the
 * same schema (the drift check passes), every name kept. Pure metadata and
 * recorded SQL here; TurnOnRecommendedPostgres runs it on a table that
 * holds rules.
 */

function nameColumnArgs(): ColumnMetadataArgs {
  const args: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .columns.filter((candidate: ColumnMetadataArgs) => {
      return candidate.target === DetectionRule;
    })
    .find((candidate: ColumnMetadataArgs) => {
      return candidate.propertyName === "name";
    });

  if (!args) {
    throw new Error("DetectionRule.name has no TypeORM @Column metadata");
  }

  return args;
}

function recordQueries(): {
  runner: QueryRunner;
  sql: () => Array<string>;
} {
  const query: jest.Mock = jest.fn(async (): Promise<void> => {
    return undefined;
  });

  return {
    runner: { query } as unknown as QueryRunner,
    sql: (): Array<string> => {
      return query.mock.calls.map((call: Array<unknown>): string => {
        return String(call[0]);
      });
    },
  };
}

describe("DetectionRule.name", () => {
  test("is a ShortText column: varchar(100), required, read on relations", () => {
    const metadata: TableColumnMetadata = new DetectionRule().getTableColumnMetadata(
      "name",
    );
    const args: ColumnMetadataArgs = nameColumnArgs();

    expect(metadata.type).toBe(TableColumnType.ShortText);
    expect(metadata.required).toBe(true);
    expect(metadata.canReadOnRelationQuery).toBe(true);
    expect(args.options.type).toBe(ColumnType.ShortText);
    expect(args.options.length).toBe(ColumnLength.ShortText);
    expect(args.options.nullable).toBe(false);
  });

  test("every check, the form and the database agree on its width", () => {
    const metadata: TableColumnMetadata = new DetectionRule().getTableColumnMetadata(
      "name",
    );

    // DatabaseService.checkMaxLengthOfFields and ModelForm read it from the type.
    expect(getMaxLengthFromTableColumnType(metadata.type)).toBe(100);
    expect(nameColumnArgs().options.length).toBe(100);
    expect(DETECTION_RULE_NAME_MAX_LENGTH).toBe(100);
  });

  test("is no longer the 50-character Name type it was", () => {
    expect(getMaxLengthFromTableColumnType(TableColumnType.Name)).toBe(50);
    expect(
      new DetectionRule().getTableColumnMetadata("name").type,
    ).not.toBe(TableColumnType.Name);
  });
});

describe("WidenDetectionRuleName1806300000000", () => {
  const migration: WidenDetectionRuleName1806300000000 =
    new WidenDetectionRuleName1806300000000();

  test("up() widens the column in place, keeping every name", async () => {
    const { runner, sql } = recordQueries();
    await migration.up(runner);

    expect(sql()).toEqual([
      `ALTER TABLE "DetectionRule" ALTER COLUMN "name" TYPE character varying(100)`,
    ]);

    for (const statement of sql()) {
      expect(statement).not.toContain("DROP");
      expect(statement).not.toContain("DELETE");
      expect(statement).not.toContain("UPDATE");
    }
  });

  test("down() cuts a longer name to fit before it narrows, so the revert cannot fail", async () => {
    const { runner, sql } = recordQueries();
    await migration.down(runner);

    expect(sql()).toEqual([
      `UPDATE "DetectionRule" SET "name" = LEFT("name", 50) WHERE LENGTH("name") > 50`,
      `ALTER TABLE "DetectionRule" ALTER COLUMN "name" TYPE character varying(50)`,
    ]);
  });

  test("down() restores exactly the width the table was created with", async () => {
    const { runner, sql } = recordQueries();
    await new AddDetectionRuleAndGoogleSecOpsConnection1788000000000().up(
      runner,
    );

    const created: string | undefined = sql().find((statement: string) => {
      return statement.startsWith(`CREATE TABLE "DetectionRule" (`);
    });

    expect(created).toBeDefined();
    expect(created).toContain(`"name" character varying(50) NOT NULL`);
  });

  test("is registered, after the migration that created the table", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migrationClass: new () => MigrationInterface): string => {
        return migrationClass.name;
      },
    );
    const widened: number = names.indexOf(
      "WidenDetectionRuleName1806300000000",
    );
    const created: number = names.indexOf(
      "AddDetectionRuleAndGoogleSecOpsConnection1788000000000",
    );

    expect(widened).toBeGreaterThan(-1);
    expect(created).toBeGreaterThan(-1);
    expect(widened).toBeGreaterThan(created);
  });

  test("its name carries its timestamp, as its file's does", () => {
    expect(migration.name).toBe("WidenDetectionRuleName1806300000000");
  });
});
