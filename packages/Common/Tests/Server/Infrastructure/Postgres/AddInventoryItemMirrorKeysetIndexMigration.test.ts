import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import OnlineDdl, {
  OnlineIndex,
} from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddInventoryItemMirrorKeysetIndex1809164100000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809164100000-AddInventoryItemMirrorKeysetIndex";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import EntitySource from "../../../../Types/Telemetry/EntitySource";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE INDEX THE INVENTORY MIRROR'S REVERSE PASS READS ITS PAGES FROM.
 *
 * Every fifteen minutes the mirror (InventoryEntityRegistry) reads each
 * type's mirrored registry rows in keyset pages: `entityType = $1 AND source
 * = 'inventory' AND _id > $cursor ORDER BY _id LIMIT 1000`. With nothing on
 * "InventoryItem" leading with entityType, a page walked the primary key
 * through every type's rows; this makes each page a range. Partial on the
 * mirrored rows, so the entities telemetry discovers carry none of it.
 *
 * Named as TypeORM names it from the model's declaration, so the schema
 * drift check finds nothing to change, and built online, outside a
 * transaction (OnlineDdl): InventoryItem already holds data. Pure
 * SQL-contract assertions against a fake QueryRunner; OnlineDdl's own steps
 * are recorded as "online: <statement>".
 */

const NAME: string = "IDX_5ba328d0cab9ac05fec674827e";
const WHERE: string = `"source" = 'inventory'`;
const CREATE: string = `CREATE INDEX "${NAME}" ON "InventoryItem" ("entityType", "_id") WHERE ${WHERE}`;

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  for (const step of ["createIndex", "dropIndex"] as const) {
    jest.spyOn(OnlineDdl, step).mockImplementation((async (
      _runner: QueryRunner,
      statement: string,
    ) => {
      statements.push(`online: ${statement}`);
    }) as never);
  }

  await run({
    isTransactionActive: false,
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AddInventoryItemMirrorKeysetIndex1809164100000", () => {
  test("the index is named as TypeORM names it: the drift check finds nothing", () => {
    expect(
      new DefaultNamingStrategy().indexName(
        "InventoryItem",
        ["entityType", "_id"],
        WHERE,
      ),
    ).toBe(NAME);
  });

  test("builds it online, outside a transaction - and nothing else", async () => {
    const migration: AddInventoryItemMirrorKeysetIndex1809164100000 =
      new AddInventoryItemMirrorKeysetIndex1809164100000();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([`online: ${CREATE}`]);
  });

  test("OnlineDdl reads the build as one it can run concurrently, its predicate kept", () => {
    const parsed: OnlineIndex = OnlineDdl.parseCreateIndex(CREATE);

    expect(parsed.name).toBe(NAME);
    expect(parsed.quotedTable).toBe(`"InventoryItem"`);
    expect(parsed.build).toContain("CREATE INDEX CONCURRENTLY");
    expect(parsed.build).toContain(`("entityType", "_id") WHERE ${WHERE}`);
  });

  test("down() takes it away, online", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddInventoryItemMirrorKeysetIndex1809164100000().down(
          runner,
        );
      }),
    ).toEqual([`online: DROP INDEX "public"."${NAME}"`]);
  });

  test("is registered once, after the migrations before it, and named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const names: Array<string> = registered.map((migration: unknown) => {
      return (migration as { name: string }).name;
    });

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddInventoryItemMirrorKeysetIndex1809164100000;
      }),
    ).toHaveLength(1);
    expect(
      names.indexOf("AddInventoryItemMirrorKeysetIndex1809164100000"),
    ).toBeGreaterThan(
      names.indexOf("SetNetworkInterfaceFillfactor1809164000000"),
    );
    expect(new AddInventoryItemMirrorKeysetIndex1809164100000().name).toBe(
      "AddInventoryItemMirrorKeysetIndex1809164100000",
    );
  });
});

describe("the model says the same", () => {
  test("InventoryItem declares (entityType, _id) on its mirrored rows", () => {
    const declared: Array<IndexMetadataArgs> =
      getMetadataArgsStorage().indices.filter((index: IndexMetadataArgs) => {
        return (
          index.target === InventoryItem &&
          Array.isArray(index.columns) &&
          (index.columns as Array<string>).join(",") === "entityType,_id"
        );
      });

    expect(declared).toHaveLength(1);
    expect(declared[0]!.where).toBe(WHERE);
    expect(declared[0]!.unique).toBeFalsy();
  });

  test("its predicate names the mirror's own source", () => {
    expect(WHERE).toBe(`"source" = '${EntitySource.Inventory}'`);
  });
});
