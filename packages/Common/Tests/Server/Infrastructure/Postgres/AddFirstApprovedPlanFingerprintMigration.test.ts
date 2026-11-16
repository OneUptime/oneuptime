import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddFirstApprovedPlanFingerprint1809181730000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809181730000-AddFirstApprovedPlanFingerprint";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind binding the first of two approvals to what it
 * approved (#6421): AutoRemediationSuggestion.firstApprovedPlanFingerprint,
 * the fix's plan fingerprint when it was approved first. A second approval
 * runs the fix only while it still runs exactly that.
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read as
 * text, so up() and down() are told apart. Nothing is backfilled: a first
 * approval given before it was kept has none and counts for nothing - and a
 * nullable column with no default rewrites no row. Beyond the SQL, the
 * migration has to be registered, named consistently and ordered after
 * every migration already registered, or it silently never runs.
 */

const MIGRATION_TIMESTAMP: string = "1809181730000";
const MIGRATION_BASE_NAME: string = "AddFirstApprovedPlanFingerprint";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

// A migration's 13-digit timestamp, read off its class name.
const TIMESTAMP_OF_NAME: RegExp = /(\d{13})$/;

async function statementsOf(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface =
    new AddFirstApprovedPlanFingerprint1809181730000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddFirstApprovedPlanFingerprint1809181730000", () => {
  test("adds what the first of two approvals approved, empty on every fix there is", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "AutoRemediationSuggestion" ADD "firstApprovedPlanFingerprint" character varying(100)`,
    ]);
  });

  test("builds no index and adds no key or default: nothing scans, locks or rewrites the table", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(/CREATE (UNIQUE )?INDEX|FOREIGN KEY/i);
      expect(statement).not.toMatch(/DEFAULT|NOT NULL/i);
      expect(statement).not.toMatch(/UPDATE|INSERT/i);
    }
  });

  test("down drops the column up added, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "firstApprovedPlanFingerprint"`,
    ]);
  });

  test("is registered, named for its class, and ordered after every migration before it", () => {
    const registered: Array<string> = (
      SchemaMigrations as Array<{ name: string }>
    ).map((migration: { name: string }): string => {
      return migration.name;
    });

    expect(registered).toContain(MIGRATION_CLASS_NAME);
    expect(new AddFirstApprovedPlanFingerprint1809181730000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      fs.existsSync(
        path.join(
          MIGRATION_DIRECTORY,
          `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`,
        ),
      ),
    ).toBe(true);

    const timestamps: Array<number> = registered.map((name: string): number => {
      const match: RegExpMatchArray | null = name.match(TIMESTAMP_OF_NAME);
      return match ? parseInt(match[1]!, 10) : 0;
    });
    const at: number = registered.indexOf(MIGRATION_CLASS_NAME);

    for (const earlier of timestamps.slice(0, at)) {
      expect(earlier).toBeLessThan(parseInt(MIGRATION_TIMESTAMP, 10));
    }
  });

  test("matches the model it was generated from", () => {
    const suggestion: AutoRemediationSuggestion =
      new AutoRemediationSuggestion();
    const column: ReturnType<typeof suggestion.getTableColumnMetadata> =
      suggestion.getTableColumnMetadata("firstApprovedPlanFingerprint");

    expect(column.type).toBe(TableColumnType.ShortText);
    expect(column.required).toBe(false);
  });

  test("no one in a project may write it: only an approval on the server does", () => {
    const suggestion: AutoRemediationSuggestion =
      new AutoRemediationSuggestion();

    expect(
      suggestion.getColumnAccessControlFor("firstApprovedPlanFingerprint")
        ?.create,
    ).toEqual([]);
    expect(
      suggestion.getColumnAccessControlFor("firstApprovedPlanFingerprint")
        ?.update,
    ).toEqual([]);
  });
});
