import { AddCloudAccountAiAgentKeys1808994400000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1808994400000-AddCloudAccountAiAgentKeys";
import { AddCloudRightSizingEvidenceAndBudgetUnusualDays1808994300000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1808994300000-AddCloudRightSizingEvidenceAndBudgetUnusualDays";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { MigrationInterface, QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * "CloudAccount"."aiAgentKeys": the hashes of the keys a cloud account's
 * Cloud AI agent connects with (Types/CloudConnection/CloudAiAgentKey).
 *
 *   - a nullable jsonb column with no default: every account there is keeps
 *     no keys, so its agent goes on connecting with the project's telemetry
 *     ingestion key until its setup command runs again - nothing breaks on
 *     upgrade - and adding it rewrites no row;
 *   - down drops it, and nothing else;
 *   - registered, once, after the one before it: a migration missing from
 *     Index.ts never runs, and every registration would read a column that
 *     is not there;
 *   - the model's column no role may create, read or update: only the
 *     server, as root, ever touches the hashes.
 */

function recordingRunner(): { runner: QueryRunner; statements: Array<string> } {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;

  return { runner, statements };
}

describe("AddCloudAccountAiAgentKeys1808994400000", () => {
  test("up adds one nullable jsonb column, with no default", async () => {
    const { runner, statements } = recordingRunner();

    await new AddCloudAccountAiAgentKeys1808994400000().up(runner);

    expect(statements).toEqual([
      `ALTER TABLE "CloudAccount" ADD "aiAgentKeys" jsonb`,
    ]);
    expect(statements[0]).not.toContain("NOT NULL");
    expect(statements[0]).not.toContain("DEFAULT");
  });

  test("down drops it again, and nothing else", async () => {
    const { runner, statements } = recordingRunner();

    await new AddCloudAccountAiAgentKeys1808994400000().down(runner);

    expect(statements).toEqual([
      `ALTER TABLE "CloudAccount" DROP COLUMN "aiAgentKeys"`,
    ]);
  });

  test("is registered, after the migration before it, under its own name", () => {
    const registered: Array<{ new (): MigrationInterface }> =
      SchemaMigrations as unknown as Array<{ new (): MigrationInterface }>;
    const at: number = registered.indexOf(
      AddCloudAccountAiAgentKeys1808994400000,
    );

    expect(at).toBeGreaterThan(-1);
    expect(registered.indexOf(AddCloudAccountAiAgentKeys1808994400000)).toBe(
      registered.lastIndexOf(AddCloudAccountAiAgentKeys1808994400000),
    );
    expect(at).toBeGreaterThan(
      registered.indexOf(
        AddCloudRightSizingEvidenceAndBudgetUnusualDays1808994300000,
      ),
    );
    expect(new AddCloudAccountAiAgentKeys1808994400000().name).toBe(
      "AddCloudAccountAiAgentKeys1808994400000",
    );
  });

  test("the model's column: JSON, nullable, and no role may create, read or update it", () => {
    const account: CloudAccount = new CloudAccount();
    const access: ColumnAccessControl | null =
      account.getColumnAccessControlFor("aiAgentKeys");

    expect(access).not.toBeNull();
    expect({
      create: access!.create,
      read: access!.read,
      update: access!.update,
    }).toEqual({ create: [], read: [], update: [] });
    expect(account.getTableColumnMetadata("aiAgentKeys")?.type).toBe(
      TableColumnType.JSON,
    );
    expect(account.getTableColumnMetadata("aiAgentKeys")?.required).toBe(
      false,
    );
  });
});
