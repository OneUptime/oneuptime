import DataStore from "../../../../Models/DatabaseModels/DataStore";
import OpenStackCloudCheck from "../../../../Models/DatabaseModels/OpenStackCloudCheck";
import OnlineDdl, {
  OnlineIndex,
} from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddProbeCollectionClaimIndexes1809150400000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809150400000-AddProbeCollectionClaimIndexes";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE INDEXES THE PROBES' CHECK AND DATA STORE CLAIMS READ IN ORDER
 * (OneUptime issue #7919).
 *
 * A probe claims its due OpenStack checks of each kind, and its data
 * stores' table collections and content scans, oldest first:
 * `due <= now ORDER BY due LIMIT n`, a range of a (probe, due) index that
 * stops at its limit. These are those indexes, named as TypeORM names them
 * from the models' declarations, so the schema drift check finds nothing to
 * change, and built online, outside a transaction (OnlineDdl): both tables
 * already hold data.
 *
 * Pure SQL-contract assertions against a fake QueryRunner; OnlineDdl's own
 * steps are recorded as "online: <statement>".
 * ProbeCollectionClaimSetAsidePostgres reads the plans on a migrated
 * Postgres.
 */

const naming: DefaultNamingStrategy = new DefaultNamingStrategy();

const INDEXES: Array<{ table: string; columns: Array<string> }> = [
  {
    table: "OpenStackCloudCheck",
    columns: ["probeId", "nextLifecycleCheckAt"],
  },
  { table: "OpenStackCloudCheck", columns: ["probeId", "nextApiCheckAt"] },
  { table: "DataStore", columns: ["scanProbeId", "nextContentScanAt"] },
  {
    table: "DataStore",
    columns: ["scanProbeId", "nextTableHealthCollectionAt"],
  },
];

function nameOf(index: { table: string; columns: Array<string> }): string {
  return naming.indexName(index.table, index.columns);
}

function createStatementOf(index: {
  table: string;
  columns: Array<string>;
}): string {
  return `CREATE INDEX "${nameOf(index)}" ON "${index.table}" (${index.columns
    .map((column: string): string => {
      return `"${column}"`;
    })
    .join(", ")}) `;
}

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

describe("AddProbeCollectionClaimIndexes1809150400000", () => {
  test("each index is named as TypeORM names it: the drift check finds nothing", () => {
    expect(INDEXES.map(nameOf)).toEqual([
      "IDX_7e8835d5f6bcdd48650485e16d",
      "IDX_2642d786f1ea9e8c99548d14de",
      "IDX_d16db6fe6b4a4248de1516669f",
      "IDX_80db6f55b33c8a5f4d6c05b5ac",
    ]);
  });

  test("builds the four indexes online, outside a transaction - and nothing else", async () => {
    const migration: AddProbeCollectionClaimIndexes1809150400000 =
      new AddProbeCollectionClaimIndexes1809150400000();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual(
      INDEXES.map((index: { table: string; columns: Array<string> }) => {
        return `online: ${createStatementOf(index)}`;
      }),
    );
  });

  test.each(INDEXES)(
    "OnlineDdl reads the build on $table ($columns) as one it can run concurrently",
    (index: { table: string; columns: Array<string> }) => {
      const parsed: OnlineIndex = OnlineDdl.parseCreateIndex(
        createStatementOf(index),
      );

      expect(parsed.name).toBe(nameOf(index));
      expect(parsed.quotedTable).toBe(`"${index.table}"`);
      expect(parsed.build).toContain("CREATE INDEX CONCURRENTLY");
    },
  );

  test("down() takes them away, online, in the reverse order", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddProbeCollectionClaimIndexes1809150400000().down(runner);
      }),
    ).toEqual(
      [...INDEXES]
        .reverse()
        .map((index: { table: string; columns: Array<string> }) => {
          return `online: DROP INDEX "public"."${nameOf(index)}"`;
        }),
    );
  });

  test("is registered once, after the migrations before it, and named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const names: Array<string> = registered.map((migration: unknown) => {
      return (migration as { name: string }).name;
    });

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddProbeCollectionClaimIndexes1809150400000;
      }),
    ).toHaveLength(1);
    expect(
      names.indexOf("AddProbeCollectionClaimIndexes1809150400000"),
    ).toBeGreaterThan(
      names.indexOf("AddNotifySubscribersOfNewIncidentsByDefault1809150300000"),
    );
    expect(new AddProbeCollectionClaimIndexes1809150400000().name).toBe(
      "AddProbeCollectionClaimIndexes1809150400000",
    );
  });
});

describe("the models say the same", () => {
  function declaredOn(target: unknown): Array<Array<string>> {
    return getMetadataArgsStorage()
      .indices.filter((index: IndexMetadataArgs) => {
        return (
          index.target === target &&
          Array.isArray(index.columns) &&
          index.columns.length === 2 &&
          !index.unique &&
          !index.where
        );
      })
      .map((index: IndexMetadataArgs): Array<string> => {
        return index.columns as Array<string>;
      });
  }

  test("OpenStackCloudCheck: its probe, then each kind's due time", () => {
    expect(declaredOn(OpenStackCloudCheck)).toEqual(
      expect.arrayContaining([
        ["probeId", "nextApiCheckAt"],
        ["probeId", "nextLifecycleCheckAt"],
      ]),
    );
  });

  test("DataStore: its scan probe, then each collection's due time", () => {
    expect(declaredOn(DataStore)).toEqual(
      expect.arrayContaining([
        ["scanProbeId", "nextTableHealthCollectionAt"],
        ["scanProbeId", "nextContentScanAt"],
      ]),
    );
  });
});
