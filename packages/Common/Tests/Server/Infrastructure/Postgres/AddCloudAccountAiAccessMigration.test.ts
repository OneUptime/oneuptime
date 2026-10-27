import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddCloudAccountAiAccess1808200000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808200000000-AddCloudAccountAiAccess";
import CloudAccount from "../../../../Models/DatabaseModels/CloudAccount";
import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind OneUptime AI on cloud accounts: the AI access
 * columns every resource an AI agent serves carries (DockerHost's), and
 * whether an investigation may read the account's logs.
 *
 * The statements are executed against a fake QueryRunner, so up() and down()
 * are told apart. Every column has a constant default or none, so Postgres
 * adds it without rewriting the table; nothing is backfilled and nothing
 * scans it. The migration has to be registered, named for its class and
 * ordered after every migration before it, or it never runs; the schema
 * drift check holds its statements to the model.
 */

const MIGRATION_TIMESTAMP: string = "1808200000000";
const MIGRATION_BASE_NAME: string = "AddCloudAccountAiAccess";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const COLUMNS: Array<[string, string]> = [
  ["isAiInvestigationEnabled", "boolean NOT NULL DEFAULT true"],
  ["isAiLogReadEnabled", "boolean NOT NULL DEFAULT false"],
  ["aiRemediationMode", "character varying(100) NOT NULL DEFAULT 'Disabled'"],
  ["aiCommandAllowlist", "jsonb"],
  ["aiAccessLastVerifiedAt", "TIMESTAMP WITH TIME ZONE"],
  ["aiAccessLastError", "character varying"],
  ["aiAccessConfiguredAt", "TIMESTAMP WITH TIME ZONE"],
];

async function statementsOf(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface =
    new AddCloudAccountAiAccess1808200000000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

function columnsOf(model: BaseModel): Array<string> {
  return model.getTableColumns().columns;
}

describe("AddCloudAccountAiAccess1808200000000", () => {
  test("adds each AI access column to CloudAccount, with its default", async () => {
    expect(await statementsOf("up")).toEqual(
      COLUMNS.map(([column, type]: [string, string]): string => {
        return `ALTER TABLE "CloudAccount" ADD "${column}" ${type}`;
      }),
    );
  });

  test("investigation starts on, log reading and fixes off", async () => {
    const up: Array<string> = await statementsOf("up");

    expect(up).toContain(
      `ALTER TABLE "CloudAccount" ADD "isAiInvestigationEnabled" boolean NOT NULL DEFAULT true`,
    );
    expect(up).toContain(
      `ALTER TABLE "CloudAccount" ADD "isAiLogReadEnabled" boolean NOT NULL DEFAULT false`,
    );
    expect(up).toContain(
      `ALTER TABLE "CloudAccount" ADD "aiRemediationMode" character varying(100) NOT NULL DEFAULT 'Disabled'`,
    );
  });

  test("builds no index, adds no key and touches no other table", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(/CREATE (UNIQUE )?INDEX|FOREIGN KEY/i);
      expect(statement).toMatch(/^ALTER TABLE "CloudAccount" ADD "[A-Za-z]+" /);
    }
  });

  test("down drops every column up added, in reverse, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual(
      [...COLUMNS].reverse().map(([column]: [string, string]): string => {
        return `ALTER TABLE "CloudAccount" DROP COLUMN "${column}"`;
      }),
    );
  });

  test("the model declares exactly the columns it adds, as a resource with an AI agent does", () => {
    const cloudAccount: Array<string> = columnsOf(new CloudAccount());
    const dockerHost: Array<string> = columnsOf(new DockerHost());

    for (const [column] of COLUMNS) {
      expect(cloudAccount).toContain(column);
    }

    // The AI access columns DockerHost has, and the log switch on top.
    for (const column of [
      "isAiInvestigationEnabled",
      "aiRemediationMode",
      "aiCommandAllowlist",
      "aiAccessLastVerifiedAt",
      "aiAccessLastError",
      "aiAccessConfiguredAt",
    ]) {
      expect(dockerHost).toContain(column);
    }

    const model: CloudAccount = new CloudAccount();
    expect(model.getTableColumnMetadata("isAiLogReadEnabled").type).toBe(
      TableColumnType.Boolean,
    );
    expect(model.getTableColumnMetadata("aiCommandAllowlist").type).toBe(
      TableColumnType.JSON,
    );
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
    expect(new AddCloudAccountAiAccess1808200000000().name).toBe(
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

    expect(Math.max(...timestamps)).toBeGreaterThanOrEqual(
      Number(MIGRATION_TIMESTAMP),
    );
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
