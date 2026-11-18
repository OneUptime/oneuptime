import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddBiLineageSummaryAndDashboardUpstream1809183870000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809183870000-AddBiLineageSummaryAndDashboardUpstream";
import DataBiConnection from "../../../../Models/DatabaseModels/DataBiConnection";
import DataDashboard from "../../../../Models/DatabaseModels/DataDashboard";
import Permission from "../../../../Types/Permission";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind why a BI tool's dashboards are, or are not, tied to
 * watched tables (#9507): DataBiConnection.lineageSummary holds each
 * tool's last read - the tables its dashboards read and how many matched,
 * the data sources behind them, what keeps the rest from matching - and
 * DataDashboard.upstream what each dashboard is built on, as its tool says.
 *
 * The statements run against a fake QueryRunner, so up() and down() are
 * told apart. Additive and nullable (Docs/migrations/README.md): two JSON
 * columns, no default, no index, no key, nothing backfilled. The migration
 * has to be registered, named for its class and ordered after every
 * migration before it, or it never runs; the schema drift check holds its
 * statements to the models.
 */

const MIGRATION_TIMESTAMP: string = "1809183870000";
const MIGRATION_BASE_NAME: string = "AddBiLineageSummaryAndDashboardUpstream";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
// The last migration registered before it.
const PREVIOUS_MIGRATION: string = "AddEmailLogTemplateType1809183830000";

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
    new AddBiLineageSummaryAndDashboardUpstream1809183870000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddBiLineageSummaryAndDashboardUpstream1809183870000", () => {
  test("adds lineageSummary to DataBiConnection and upstream to DataDashboard, nullable JSON columns", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "DataBiConnection" ADD "lineageSummary" jsonb`,
      `ALTER TABLE "DataDashboard" ADD "upstream" jsonb`,
    ]);
  });

  test("builds no index, adds no key or default and backfills nothing", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
      expect(statement).toMatch(
        /^ALTER TABLE "(DataBiConnection|DataDashboard)" ADD /,
      );
    }
  });

  test("down drops the columns up added, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "DataDashboard" DROP COLUMN "upstream"`,
      `ALTER TABLE "DataBiConnection" DROP COLUMN "lineageSummary"`,
    ]);
  });

  test("the models declare the columns: JSON, not required, written by OneUptime and read by whoever reads the record", () => {
    const connection: DataBiConnection = new DataBiConnection();
    const dashboard: DataDashboard = new DataDashboard();

    for (const [model, column] of [
      [connection, "lineageSummary"],
      [dashboard, "upstream"],
    ] as Array<[DataBiConnection | DataDashboard, string]>) {
      expect(model.getTableColumns().columns).toContain(column);
      expect(model.getTableColumnMetadata(column).type).toBe(
        TableColumnType.JSON,
      );
      expect(model.getTableColumnMetadata(column).required).toBeFalsy();

      const access: {
        create: Array<Permission>;
        read: Array<Permission>;
        update: Array<Permission>;
      } = model.getColumnAccessControlFor(column)!;

      expect(access.create).toEqual([]);
      expect(access.update).toEqual([]);
      expect(access.read).toContain(Permission.ReadDataAsset);
      expect(access.read).toContain(Permission.ProjectMember);
    }
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
    expect(
      new AddBiLineageSummaryAndDashboardUpstream1809183870000().name,
    ).toBe(MIGRATION_CLASS_NAME);

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
          return value <= 1809183830000;
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
