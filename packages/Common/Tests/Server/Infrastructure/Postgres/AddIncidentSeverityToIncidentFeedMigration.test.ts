import { describe, expect, test } from "@jest/globals";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddIncidentSeverityToIncidentFeed1809187781400 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187781400-AddIncidentSeverityToIncidentFeed";
import IncidentFeed from "../../../../Models/DatabaseModels/IncidentFeed";

const MIGRATION_TIMESTAMP: string = "1809187781400";
const MIGRATION_CLASS_NAME: string = `AddIncidentSeverityToIncidentFeed${MIGRATION_TIMESTAMP}`;
const PREVIOUS_MIGRATION: string = "AddStorageArrayConnections1809187781104";

async function statementsOf(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface =
    new AddIncidentSeverityToIncidentFeed1809187781400();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe(MIGRATION_CLASS_NAME, () => {
  test("adds the before and after severity names to IncidentFeed", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "IncidentFeed" ADD "incidentSeverityChangedFromName" character varying`,
      `ALTER TABLE "IncidentFeed" ADD "incidentSeverityChangedToName" character varying`,
    ]);
  });

  test("adds nullable values without a default, key, index or backfill", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
    }
  });

  test("drops only the columns it adds", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "IncidentFeed" DROP COLUMN "incidentSeverityChangedToName"`,
      `ALTER TABLE "IncidentFeed" DROP COLUMN "incidentSeverityChangedFromName"`,
    ]);
  });

  test("models the two severity names as readable and server-owned", () => {
    const model: IncidentFeed = new IncidentFeed();

    for (const column of [
      "incidentSeverityChangedFromName",
      "incidentSeverityChangedToName",
    ]) {
      expect(model.getTableColumns().columns).toContain(column);
      expect(model.getTableColumnMetadata(column).required).toBeFalsy();
      expect(model.getColumnAccessControlFor(column)?.create).toEqual([]);
      expect(model.getColumnAccessControlFor(column)?.update).toEqual([]);
    }
  });

  test("is registered once after every migration before it", () => {
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
    expect(names[names.indexOf(MIGRATION_CLASS_NAME) - 1]).toBe(
      PREVIOUS_MIGRATION,
    );
  });
});
