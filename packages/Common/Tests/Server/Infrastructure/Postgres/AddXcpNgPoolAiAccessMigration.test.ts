import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddXcpNgPoolAiAccess1809187721998 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187721998-AddXcpNgPoolAiAccess";
import { AddXcpNgPoolTables1809187720000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187720000-AddXcpNgPoolTables";
import XcpNgPool from "../../../../Models/DatabaseModels/XcpNgPool";
import ProxmoxCluster from "../../../../Models/DatabaseModels/ProxmoxCluster";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { ResourceAiRemediationMode } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";

/*
 * The migration behind OneUptime AI's access to an XCP-ng pool (#10998):
 * the AI access columns every resource an AI agent works for keeps, on the
 * XCP-ng pool table, which came after the migrations that gave the others
 * theirs.
 *
 * The statements are executed against a fake QueryRunner, so up() and
 * down() are told apart. The two settings take a constant default (an
 * existing pool is investigated, and never fixed, until someone chooses
 * otherwise), which Postgres adds without rewriting the table; the rest are
 * nullable with no default. The schema drift check holds the statements to
 * the model; this test holds them to what each column means.
 */

const MIGRATION_TIMESTAMP: string = "1809187721998";
const MIGRATION_BASE_NAME: string = "AddXcpNgPoolAiAccess";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const UP: Array<string> = [
  `ALTER TABLE "XcpNgPool" ADD "isAiInvestigationEnabled" boolean NOT NULL DEFAULT true`,
  `ALTER TABLE "XcpNgPool" ADD "aiRemediationMode" character varying(100) NOT NULL DEFAULT 'Disabled'`,
  `ALTER TABLE "XcpNgPool" ADD "aiCommandAllowlist" jsonb`,
  `ALTER TABLE "XcpNgPool" ADD "aiAccessLastVerifiedAt" TIMESTAMP WITH TIME ZONE`,
  `ALTER TABLE "XcpNgPool" ADD "aiAccessLastError" character varying`,
  `ALTER TABLE "XcpNgPool" ADD "aiAccessConfiguredAt" TIMESTAMP WITH TIME ZONE`,
  `ALTER TABLE "XcpNgPool" ADD "aiAgentResetAt" TIMESTAMP WITH TIME ZONE`,
];

const COLUMNS: Array<string> = [
  "isAiInvestigationEnabled",
  "aiRemediationMode",
  "aiCommandAllowlist",
  "aiAccessLastVerifiedAt",
  "aiAccessLastError",
  "aiAccessConfiguredAt",
  "aiAgentResetAt",
];

async function statementsOf(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface = new AddXcpNgPoolAiAccess1809187721998();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddXcpNgPoolAiAccess1809187721998", () => {
  test("adds the seven AI access columns to the XCP-ng pool table", async () => {
    expect(await statementsOf("up")).toEqual(UP);
  });

  test("builds no index, adds no key, backfills nothing and touches no other table", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).toMatch(/^ALTER TABLE "XcpNgPool" ADD "[A-Za-z]+" /);
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|UPDATE /i,
      );
    }
  });

  test("only the two settings are NOT NULL, each with the default a new pool starts from", async () => {
    const withDefault: Array<string> = (await statementsOf("up")).filter(
      (statement: string): boolean => {
        return statement.includes("NOT NULL");
      },
    );

    expect(withDefault).toEqual([
      `ALTER TABLE "XcpNgPool" ADD "isAiInvestigationEnabled" boolean NOT NULL DEFAULT true`,
      `ALTER TABLE "XcpNgPool" ADD "aiRemediationMode" character varying(100) NOT NULL DEFAULT '${ResourceAiRemediationMode.Disabled}'`,
    ]);
  });

  test("down drops every column up added, in reverse, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual(
      [...COLUMNS].reverse().map((column: string): string => {
        return `ALTER TABLE "XcpNgPool" DROP COLUMN "${column}"`;
      }),
    );
  });

  test("the XCP-ng pool model declares every column it adds, as the Proxmox cluster declares its own", () => {
    const pool: XcpNgPool = new XcpNgPool();
    const cluster: ProxmoxCluster = new ProxmoxCluster();

    for (const column of COLUMNS) {
      expect(pool.getTableColumns().columns).toContain(column);
      expect(pool.getTableColumnMetadata(column).type).toBe(
        cluster.getTableColumnMetadata(column).type,
      );
      expect(Boolean(pool.getTableColumnMetadata(column).required)).toBe(
        Boolean(cluster.getTableColumnMetadata(column).required),
      );
    }

    expect(pool.getTableColumnMetadata("isAiInvestigationEnabled").type).toBe(
      TableColumnType.Boolean,
    );
    expect(
      pool.getTableColumnMetadata("isAiInvestigationEnabled").defaultValue,
    ).toBe(true);
    expect(pool.getTableColumnMetadata("aiRemediationMode").defaultValue).toBe(
      ResourceAiRemediationMode.Disabled,
    );
  });

  test("is registered once, under its own name, after the migration that made the XCP-ng pool table", () => {
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
    expect(new AddXcpNgPoolAiAccess1809187721998().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(names.indexOf(MIGRATION_CLASS_NAME)).toBeGreaterThan(
      names.indexOf(new AddXcpNgPoolTables1809187720000().name),
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
