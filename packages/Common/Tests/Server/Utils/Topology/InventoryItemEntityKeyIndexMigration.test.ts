import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import {
  AddInventoryItemProjectEntityKeyIndex1795200000000,
  INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1795200000000-AddInventoryItemProjectEntityKeyIndex";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { describe, expect, test } from "@jest/globals";

/*
 * The ("projectId", "entityKey") index behind the Topology API's key
 * lookups. Three things must hold together:
 *
 *   1. The entity declares it BY NAME with synchronize: false, or the next
 *      generated migration drops it (the schema builder drops every index it
 *      cannot match by name) or tries to create a second copy.
 *   2. The migration bounds its lock wait and runtime, clears an INVALID
 *      leftover of a failed CONCURRENTLY pre-build, and is idempotent so an
 *      operator's pre-built index makes it a no-op.
 *   3. It is registered, last, so it actually runs.
 *
 * Pure metadata and a recording query runner — no database.
 */

type Recorded = { sql: string; params: Array<unknown> | undefined };

async function record(
  run: (queryRunner: QueryRunner) => Promise<void>,
  invalidLeftover: boolean,
): Promise<Array<Recorded>> {
  const recorded: Array<Recorded> = [];
  const queryRunner: QueryRunner = {
    query: async (sql: string, params?: Array<unknown>): Promise<unknown> => {
      recorded.push({ sql, params });
      if (sql.includes("pg_index")) {
        return invalidLeftover
          ? [{ relname: INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX }]
          : [];
      }
      return [];
    },
  } as unknown as QueryRunner;
  await run(queryRunner);
  return recorded;
}

describe("InventoryItem (projectId, entityKey) index", () => {
  test("the entity declares it by name, outside schema synchronization", () => {
    const declared: IndexMetadataArgs | undefined =
      getMetadataArgsStorage().indices.find(
        (index: IndexMetadataArgs): boolean => {
          return (
            index.target === InventoryItem &&
            index.name === INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX
          );
        },
      );
    expect(declared).toBeDefined();
    expect(declared?.synchronize).toBe(false);
    expect(declared?.columns).toEqual(["projectId", "entityKey"]);
    expect(declared?.unique).toBeFalsy();
  });

  test("up(): timeouts first, then the plain, idempotent, non-unique build", async () => {
    const recorded: Array<Recorded> = await record(
      async (queryRunner: QueryRunner): Promise<void> => {
        await new AddInventoryItemProjectEntityKeyIndex1795200000000().up(
          queryRunner,
        );
      },
      false,
    );
    const statements: Array<string> = recorded.map((entry: Recorded) => {
      return entry.sql.replace(/\s+/g, " ").trim();
    });
    expect(statements[0]).toBe(`SET LOCAL statement_timeout = '600s'`);
    expect(statements[1]).toBe(`SET LOCAL lock_timeout = '5s'`);
    expect(statements[2]).toContain("NOT x.indisvalid");
    expect(recorded[2]!.params).toEqual([
      INVENTORY_ITEM_PROJECT_ENTITY_KEY_INDEX,
    ]);
    expect(statements).toHaveLength(4);
    expect(statements[3]).toBe(
      `CREATE INDEX IF NOT EXISTS "IDX_INVENTORY_ITEM_PROJECT_ENTITY_KEY" ON "InventoryItem" ("projectId", "entityKey")`,
    );
    // Migrations run inside a transaction: CONCURRENTLY would abort the run.
    expect(statements.join(" ")).not.toContain("CONCURRENTLY");
    expect(statements.join(" ")).not.toContain("UNIQUE");
  });

  test("up(): an INVALID leftover of a failed online build is dropped first", async () => {
    const recorded: Array<Recorded> = await record(
      async (queryRunner: QueryRunner): Promise<void> => {
        await new AddInventoryItemProjectEntityKeyIndex1795200000000().up(
          queryRunner,
        );
      },
      true,
    );
    expect(
      recorded.map((entry: Recorded) => {
        return entry.sql;
      }),
    ).toEqual([
      `SET LOCAL statement_timeout = '600s'`,
      `SET LOCAL lock_timeout = '5s'`,
      expect.stringContaining("pg_index"),
      `DROP INDEX IF EXISTS "IDX_INVENTORY_ITEM_PROJECT_ENTITY_KEY"`,
      `CREATE INDEX IF NOT EXISTS "IDX_INVENTORY_ITEM_PROJECT_ENTITY_KEY" ON "InventoryItem" ("projectId", "entityKey")`,
    ]);
  });

  test("down() drops exactly that index", async () => {
    const recorded: Array<Recorded> = await record(
      async (queryRunner: QueryRunner): Promise<void> => {
        await new AddInventoryItemProjectEntityKeyIndex1795200000000().down(
          queryRunner,
        );
      },
      false,
    );
    expect(
      recorded.map((entry: Recorded) => {
        return entry.sql;
      }),
    ).toEqual([`DROP INDEX IF EXISTS "IDX_INVENTORY_ITEM_PROJECT_ENTITY_KEY"`]);
  });

  test("it is registered, after every earlier migration", () => {
    expect(SchemaMigrations).toContain(
      AddInventoryItemProjectEntityKeyIndex1795200000000,
    );
    const names: Array<string> = SchemaMigrations.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );
    const timestamps: Array<number> = names
      .map((name: string): number => {
        return Number(name.match(/(\d{13})$/)?.[1] || 0);
      })
      .filter((timestamp: number): boolean => {
        return timestamp > 0;
      });
    expect(Math.max(...timestamps)).toBeLessThanOrEqual(1795200000000);
  });
});
