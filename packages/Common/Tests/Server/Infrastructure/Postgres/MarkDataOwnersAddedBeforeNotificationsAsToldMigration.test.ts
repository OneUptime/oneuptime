import {
  DATA_OWNER_TABLES,
  getMarkDataOwnersToldStatement,
  MarkDataOwnersAddedBeforeNotificationsAsTold1809184930000,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809184930000-MarkDataOwnersAddedBeforeNotificationsAsTold";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import DataAssetOwnerTeam from "../../../../Models/DatabaseModels/DataAssetOwnerTeam";
import DataAssetOwnerUser from "../../../../Models/DatabaseModels/DataAssetOwnerUser";
import DataPipelineOwnerTeam from "../../../../Models/DatabaseModels/DataPipelineOwnerTeam";
import DataPipelineOwnerUser from "../../../../Models/DatabaseModels/DataPipelineOwnerUser";
import DataStoreOwnerTeam from "../../../../Models/DatabaseModels/DataStoreOwnerTeam";
import DataStoreOwnerUser from "../../../../Models/DatabaseModels/DataStoreOwnerUser";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";

/*
 * THE OWNERS ALREADY WAITING ARE MARKED TOLD (#9681).
 *
 * Every table, pipeline and data store owner row written before the owner
 * jobs came is still marked not notified (isOwnerNotified false): an owner
 * rule whose Notify Owners was on wrote it so, and so did every owner added
 * on an Owners page, but no job read them. The jobs that tell them come in
 * the same release, and this migration marks every such row told before
 * any worker of the release reads them, so nobody is sent news that is
 * months old. What it must hold to:
 *
 *   - it marks the rows of each of the six owner tables the three jobs
 *     read, and only rows not notified yet - it never touches another
 *     column, nor another product's owner rows;
 *   - it runs with the schema migrations (registered once, after the
 *     migration that made the pipeline owner tables), so the rows are
 *     marked before a worker starts;
 *   - running it twice changes nothing, and down() restores nothing.
 *
 * Fake QueryRunner here; the Schema Drift job applies it to a migrated
 * database.
 */

const MIGRATION_NAME: string =
  "MarkDataOwnersAddedBeforeNotificationsAsTold1809184930000";

async function upStatements(): Promise<Array<string>> {
  const statements: Array<string> = [];

  await new MarkDataOwnersAddedBeforeNotificationsAsTold1809184930000().up({
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner);

  return statements;
}

function registeredNames(): Array<string> {
  return (SchemaMigrations as unknown as Array<{ name: string }>).map(
    (registered: { name: string }): string => {
      return registered.name;
    },
  );
}

const OWNER_MODELS: Array<BaseModel> = [
  new DataAssetOwnerTeam(),
  new DataAssetOwnerUser(),
  new DataPipelineOwnerTeam(),
  new DataPipelineOwnerUser(),
  new DataStoreOwnerTeam(),
  new DataStoreOwnerUser(),
];

describe("MarkDataOwnersAddedBeforeNotificationsAsTold1809184930000", () => {
  test("is registered once, under the name its class carries, after the pipeline owner tables were made", () => {
    expect(
      new MarkDataOwnersAddedBeforeNotificationsAsTold1809184930000().name,
    ).toBe(MIGRATION_NAME);
    expect(SchemaMigrations).toContain(
      MarkDataOwnersAddedBeforeNotificationsAsTold1809184930000,
    );

    const names: Array<string> = registeredNames();

    expect(
      names.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);

    for (const earlier of [
      // The data store owner tables.
      "AddDataSecurity1808500000000",
      // The table owner tables.
      "AddDataAssetOwnersAndFeedback1808992700000",
      // The pipeline owner tables.
      "AddDataObservabilityAttentionColumnsAndPipelineOwners1809184550000",
    ]) {
      expect(names.indexOf(earlier)).toBeGreaterThan(-1);
      expect(names.indexOf(MIGRATION_NAME)).toBeGreaterThan(
        names.indexOf(earlier),
      );
    }
  });

  test("marks the not-notified rows of each owner table the three jobs read, one statement each", async () => {
    const tables: Array<string> = OWNER_MODELS.map(
      (model: BaseModel): string => {
        return model.tableName!;
      },
    );

    expect([...DATA_OWNER_TABLES].sort()).toEqual([...tables].sort());
    expect(await upStatements()).toEqual(
      DATA_OWNER_TABLES.map((table: string): string => {
        return `UPDATE "${table}" SET "isOwnerNotified" = true WHERE "isOwnerNotified" = false`;
      }),
    );
  });

  test("sets the one column and picks only the rows still waiting", () => {
    const statement: string =
      getMarkDataOwnersToldStatement("DataAssetOwnerUser");
    const assignments: string = statement.slice(
      statement.indexOf(" SET "),
      statement.indexOf(" WHERE "),
    );

    expect(assignments.split("=")).toHaveLength(2);
    expect(assignments).toContain(`"isOwnerNotified" = true`);
    expect(statement.slice(statement.indexOf(" WHERE "))).toBe(
      ` WHERE "isOwnerNotified" = false`,
    );
    expect(statement).not.toContain(" OR ");
  });

  test("the column it reads and writes is each owner table's own: whether its owners were told", () => {
    for (const model of OWNER_MODELS) {
      expect({
        table: model.tableName,
        type: model.getTableColumnMetadata("isOwnerNotified").type,
      }).toEqual({ table: model.tableName, type: TableColumnType.Boolean });
    }
  });

  test("never touches another product's owner rows", async () => {
    for (const statement of await upStatements()) {
      expect(statement).toMatch(/^UPDATE "Data(Asset|Pipeline|Store)Owner/);
    }
  });

  test("down() changes nothing", async () => {
    const statements: Array<string> = [];

    await new MarkDataOwnersAddedBeforeNotificationsAsTold1809184930000().down({
      query: async (statement: string): Promise<void> => {
        statements.push(statement);
      },
    } as unknown as QueryRunner);

    expect(statements).toEqual([]);
  });
});
