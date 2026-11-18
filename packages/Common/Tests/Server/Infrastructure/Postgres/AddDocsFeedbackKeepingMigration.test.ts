import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddDocsFeedbackKeeping1809183800000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809183800000-AddDocsFeedbackKeeping";
import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import ProductFeedback from "../../../../Models/DatabaseModels/ProductFeedback";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { DOCS_FEEDBACK_REASONS } from "../../../../Types/ProductFeedback/ProductFeedback";

/*
 * The migration behind keeping "Was this page helpful?" on the server for
 * its admins (#7209): the switch (GlobalConfig.keepDocsFeedback, off by
 * default, as disableProductFeedback is) and what went wrong with a docs
 * page (ProductFeedback.reason).
 *
 * The statements run against a fake QueryRunner, so up() and down() are
 * told apart. Additive (Docs/migrations/README.md): a boolean with a
 * constant default on the one-row GlobalConfig - no rewrite - and a
 * nullable column on ProductFeedback, no index, no key, nothing backfilled.
 * The migration has to be registered, named for its class and ordered after
 * every migration before it, or it never runs; the schema drift check holds
 * its statements to the models.
 */

const MIGRATION_TIMESTAMP: string = "1809183800000";
const MIGRATION_BASE_NAME: string = "AddDocsFeedbackKeeping";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
// The last migration registered before it.
const PREVIOUS_MIGRATION: string = "AddProbeDevicePollsLate1809183760000";

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
  const migration: MigrationInterface =
    new AddDocsFeedbackKeeping1809183800000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddDocsFeedbackKeeping1809183800000", () => {
  test("adds the switch, off by default, and a docs answer's reason, nullable", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "GlobalConfig" ADD "keepDocsFeedback" boolean DEFAULT false`,
      `ALTER TABLE "ProductFeedback" ADD "reason" character varying(100)`,
    ]);
  });

  test("builds no index, adds no key or required column, backfills nothing", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|NOT NULL|UPDATE /i,
      );
      expect(statement).toMatch(
        /^ALTER TABLE "(GlobalConfig|ProductFeedback)" ADD /,
      );
    }
  });

  test("down drops the columns up added, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "ProductFeedback" DROP COLUMN "reason"`,
      `ALTER TABLE "GlobalConfig" DROP COLUMN "keepDocsFeedback"`,
    ]);
  });

  test("the models declare the columns it adds: a switch off by default, and a reason only the docs page's four words fill", () => {
    const config: GlobalConfig = new GlobalConfig();

    expect(config.getTableColumnMetadata("keepDocsFeedback").type).toBe(
      TableColumnType.Boolean,
    );
    expect(
      config.getTableColumnMetadata("keepDocsFeedback").required,
    ).toBeFalsy();
    expect(config.getTableColumnMetadata("keepDocsFeedback").defaultValue).toBe(
      false,
    );

    const answer: ProductFeedback = new ProductFeedback();

    expect(answer.getTableColumnMetadata("reason").type).toBe(
      TableColumnType.ShortText,
    );
    expect(answer.getTableColumnMetadata("reason").required).toBeFalsy();
    expect(answer.getTableColumnMetadata("reason").allowedValues).toEqual([
      ...DOCS_FEEDBACK_REASONS,
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
    expect(new AddDocsFeedbackKeeping1809183800000().name).toBe(
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

    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(
      Math.max(
        ...timestamps.filter((value: number): boolean => {
          return value <= 1809183760000;
        }),
      ),
    );
    expect(names.indexOf(MIGRATION_CLASS_NAME)).toBeGreaterThan(
      names.indexOf(PREVIOUS_MIGRATION),
    );
    expect(names.indexOf(PREVIOUS_MIGRATION)).toBeGreaterThan(-1);
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
