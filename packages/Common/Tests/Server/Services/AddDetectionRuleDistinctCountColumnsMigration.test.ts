import { AddDetectionRuleDistinctCountColumns1789512000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1789512000000-AddDetectionRuleDistinctCountColumns";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ColumnType from "../../../Types/Database/ColumnType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind detection-rule correlation semantics (issue #3398).
 *
 * DetectionRule gains distinctCountField (what a rule counts: unique
 * values of a field instead of raw matching events) and
 * matchCountThreshold (how many of that count a group needs in one
 * evaluation window before the rule fires). Three things have to hold or
 * a deployed instance breaks on upgrade:
 *
 *   1. up() adds exactly those two columns — distinctCountField nullable
 *      with NO default (NULL means "count raw events", the behavior every
 *      existing rule was saved with), matchCountThreshold NOT NULL
 *      DEFAULT '1' so every existing row keeps fire-on-any-match without
 *      a backfill;
 *   2. down() removes exactly what up() added;
 *   3. the migration is registered in SchemaMigrations/Index.ts — an
 *      unregistered migration never runs on boot, so the evaluator's
 *      SELECT of the two columns would 500 on every evaluation cycle.
 *
 * Pure SQL-contract assertions against a fake QueryRunner. No Postgres.
 * The registry-wide ordering guard lives in
 * SchemaMigrationsOrdering.test.ts and is not repeated here; what is
 * asserted here is about THIS migration and stays true forever.
 */

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const MIGRATION_TIMESTAMP: string = "1789512000000";

const MIGRATION_NAME: string = `AddDetectionRuleDistinctCountColumns${MIGRATION_TIMESTAMP}`;

type MakeQueryRunnerResult = {
  runner: QueryRunner;
  statements: Array<string>;
};

type MakeQueryRunnerFunction = () => MakeQueryRunnerResult;

const makeQueryRunner: MakeQueryRunnerFunction = (): MakeQueryRunnerResult => {
  const statements: Array<string> = [];

  const query: (...args: Array<unknown>) => Promise<undefined> = (
    ...args: Array<unknown>
  ): Promise<undefined> => {
    statements.push(String(args[0]));
    return Promise.resolve(undefined);
  };

  return {
    runner: { query } as unknown as QueryRunner,
    statements,
  };
};

describe("AddDetectionRuleDistinctCountColumns1789512000000 — SQL contract", () => {
  test("up() adds exactly the two columns with their exact types and defaults", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddDetectionRuleDistinctCountColumns1789512000000().up(runner);

    expect(statements).toEqual([
      `ALTER TABLE "DetectionRule" ADD "distinctCountField" character varying(100)`,
      `ALTER TABLE "DetectionRule" ADD "matchCountThreshold" integer NOT NULL DEFAULT '1'`,
    ]);
  });

  /*
   * NULL is a meaning on distinctCountField: it is what the evaluator
   * reads as "threshold the raw match count", i.e. the semantics every
   * rule saved before this migration was created with. A default would
   * silently switch existing rules to distinct counting.
   */
  test("distinctCountField is nullable with no default", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddDetectionRuleDistinctCountColumns1789512000000().up(runner);

    const addDistinctCountField: string = statements.find((sql: string) => {
      return sql.includes(`ADD "distinctCountField"`);
    })!;

    expect(addDistinctCountField).not.toContain("NOT NULL");
    expect(addDistinctCountField).not.toContain("DEFAULT");
  });

  /*
   * The opposite for matchCountThreshold: the DB default IS the
   * compatibility story. Every pre-existing row gets threshold 1 —
   * fire-on-any-match — the instant the column appears, with no backfill
   * statement to forget.
   */
  test("matchCountThreshold is NOT NULL with DEFAULT '1'", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddDetectionRuleDistinctCountColumns1789512000000().up(runner);

    const addMatchCountThreshold: string = statements.find((sql: string) => {
      return sql.includes(`ADD "matchCountThreshold"`);
    })!;

    expect(addMatchCountThreshold).toContain("integer NOT NULL DEFAULT '1'");
  });

  test("down() drops exactly what up() added, in reverse order", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddDetectionRuleDistinctCountColumns1789512000000().down(runner);

    expect(statements).toEqual([
      `ALTER TABLE "DetectionRule" DROP COLUMN "matchCountThreshold"`,
      `ALTER TABLE "DetectionRule" DROP COLUMN "distinctCountField"`,
    ]);
  });

  /*
   * Not just "same count": the exact column names, derived from the two
   * statement sets rather than restated, so adding a column to up()
   * without adding it to down() fails here.
   */
  test("up() and down() name the same columns", async () => {
    const { runner: upRunner, statements: upStatements } = makeQueryRunner();
    const { runner: downRunner, statements: downStatements } =
      makeQueryRunner();

    await new AddDetectionRuleDistinctCountColumns1789512000000().up(upRunner);
    await new AddDetectionRuleDistinctCountColumns1789512000000().down(
      downRunner,
    );

    const columnsIn: (
      statements: Array<string>,
      keyword: string,
    ) => Array<string> = (
      statements: Array<string>,
      keyword: string,
    ): Array<string> => {
      return statements
        .filter((sql: string) => {
          return sql.includes(keyword);
        })
        .map((sql: string) => {
          return sql.split(`${keyword} "`)[1]!.split('"')[0]!;
        })
        .sort();
    };

    expect(columnsIn(downStatements, "DROP COLUMN")).toEqual(
      columnsIn(upStatements, "ADD"),
    );
  });
});

describe("registration", () => {
  /*
   * The step AGENTS.md calls out and the one that fails silently: a
   * migration that is not in this array never runs, so the columns are
   * missing in a real deployment while the evaluator's rule SELECT and
   * the dashboard form both reference them.
   */
  test("the migration is registered so it runs on boot", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: new () => MigrationInterface): string => {
        return migration.name;
      },
    );

    expect(names).toContain(MIGRATION_NAME);
  });

  test("it is registered exactly once", () => {
    const occurrences: number = SchemaMigrations.filter(
      (migration: new () => MigrationInterface): boolean => {
        return migration.name === MIGRATION_NAME;
      },
    ).length;

    expect(occurrences).toBe(1);
  });

  /*
   * TypeORM records applied migrations by the `name` property, not the
   * file name. A mismatch re-runs the migration on every boot.
   */
  test("its declared name matches its class name", () => {
    expect(new AddDetectionRuleDistinctCountColumns1789512000000().name).toBe(
      MIGRATION_NAME,
    );
    expect(AddDetectionRuleDistinctCountColumns1789512000000.name).toBe(
      MIGRATION_NAME,
    );
  });
});

describe("identity on disk", () => {
  /*
   * The timestamp in the class name is the one on disk. A class renamed
   * without renaming its file — or two migrations landing on the same
   * timestamp — makes the registered ordering describe something that is
   * not what actually runs.
   */
  test("exactly one file on disk carries its timestamp, and it is this one", () => {
    const matching: Array<string> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .filter((file: string): boolean => {
        return file.startsWith(`${MIGRATION_TIMESTAMP}-`);
      });

    expect(matching).toEqual([
      `${MIGRATION_TIMESTAMP}-AddDetectionRuleDistinctCountColumns.ts`,
    ]);
  });
});

/*
 * The model side of the same contract. TypeORM generates the schema from
 * these decorators, so a column that exists in the migration but not on
 * the model (or vice versa, or with different nullability/defaults) is
 * exactly the drift the Postgres Schema Drift workflow fails on.
 */
describe("the DetectionRule model carries the columns the migration adds", () => {
  const columnArgs: (propertyName: string) => ColumnMetadataArgs = (
    propertyName: string,
  ): ColumnMetadataArgs => {
    const args: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
      .columns.filter((candidate: ColumnMetadataArgs) => {
        return candidate.target === DetectionRule;
      })
      .find((candidate: ColumnMetadataArgs) => {
        return candidate.propertyName === propertyName;
      });

    if (!args) {
      throw new Error(
        `DetectionRule.${propertyName} has no TypeORM @Column metadata`,
      );
    }

    return args;
  };

  test("distinctCountField is a nullable ShortText varchar(100), matching the migration", () => {
    const args: ColumnMetadataArgs = columnArgs("distinctCountField");

    expect(args.options.type).toBe(ColumnType.ShortText);
    expect(args.options.length).toBe(ColumnLength.ShortText);
    // character varying(100) in the migration.
    expect(ColumnLength.ShortText).toBe(100);
    expect(args.options.nullable).toBe(true);
    expect(args.options.default).toBeUndefined();
  });

  test("matchCountThreshold is a NOT NULL number defaulting to 1, matching the migration", () => {
    const args: ColumnMetadataArgs = columnArgs("matchCountThreshold");

    expect(args.options.type).toBe(ColumnType.Number);
    expect(args.options.nullable).toBe(false);
    expect(args.options.default).toBe(1);
  });

  test("distinctCountField's TableColumn is an optional ShortText", () => {
    const metadata: TableColumnMetadata =
      new DetectionRule().getTableColumnMetadata("distinctCountField");

    expect(metadata.type).toBe(TableColumnType.ShortText);
    expect(metadata.required).toBe(false);
  });

  /*
   * isDefaultValueColumn is the API-side half of the DB default: without
   * it, checkRequiredFields 400s every create payload written before the
   * column existed and the DEFAULT '1' can never apply.
   */
  test("matchCountThreshold's TableColumn is required with default 1 as a default-value column", () => {
    const metadata: TableColumnMetadata =
      new DetectionRule().getTableColumnMetadata("matchCountThreshold");

    expect(metadata.type).toBe(TableColumnType.Number);
    expect(metadata.required).toBe(true);
    expect(metadata.defaultValue).toBe(1);
    expect(metadata.isDefaultValueColumn).toBe(true);
  });

  test("both columns default to undefined on a fresh model instance", () => {
    const rule: DetectionRule = new DetectionRule();

    expect("distinctCountField" in rule).toBe(true);
    expect("matchCountThreshold" in rule).toBe(true);
    expect(rule.distinctCountField).toBeUndefined();
    expect(rule.matchCountThreshold).toBeUndefined();
  });
});
