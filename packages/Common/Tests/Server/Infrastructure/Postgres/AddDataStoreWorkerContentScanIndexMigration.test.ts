import DataStore from "../../../../Models/DatabaseModels/DataStore";
import OnlineDdl, {
  OnlineIndex,
} from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddDataStoreWorkerContentScanIndex1809179800000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809179800000-AddDataStoreWorkerContentScanIndex";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { CLAIM_DUE_DATA_STORES_FOR_WORKERS_STATEMENT } from "../../../../Server/Utils/DataSecurity/DataSecurityWorkerClaim";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE INDEX OF THE STORES ONEUPTIME'S WORKERS SCAN, BY KIND (OneUptime issue #8450).
 *
 * The workers' content-scan claim (DataSecurityWorkerClaim) read the whole DataStore table every
 * five minutes, most of it telemetry and cloud kinds no worker samples. With an index of
 * ("kind", "nextContentScanAt") over the stores no probe scans, Postgres reads each sampled
 * kind's due rows (a bitmap of `kind = ANY(...) AND (due IS NULL OR due <= now)`) and nothing
 * else. Named as TypeORM names it from the model's declaration, so the schema drift check finds
 * nothing to change, and built online, outside a transaction: the table already holds data.
 *
 * Pure SQL-contract assertions against a fake QueryRunner; OnlineDdl's own steps are recorded as
 * "online: <statement>". DataStoreProbeClaimPostgres reads the plan on a migrated Postgres.
 */

const naming: DefaultNamingStrategy = new DefaultNamingStrategy();

const TABLE: string = "DataStore";
const COLUMNS: Array<string> = ["kind", "nextContentScanAt"];
const WHERE: string = `"scanProbeId" IS NULL`;
const NAME: string = "IDX_b16e7b0369be808323916d80a7";
const CREATE: string = `CREATE INDEX "${NAME}" ON "DataStore" ("kind", "nextContentScanAt") WHERE "scanProbeId" IS NULL`;

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

describe("AddDataStoreWorkerContentScanIndex1809179800000", () => {
  test("the index is named as TypeORM names it, partial predicate included: the drift check finds nothing", () => {
    expect(naming.indexName(TABLE, COLUMNS, WHERE)).toBe(NAME);
  });

  test("builds the one index online, outside a transaction - and nothing else", async () => {
    const migration: AddDataStoreWorkerContentScanIndex1809179800000 =
      new AddDataStoreWorkerContentScanIndex1809179800000();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([`online: ${CREATE}`]);
  });

  test("OnlineDdl reads the build as one it can run concurrently, predicate and all", () => {
    const parsed: OnlineIndex = OnlineDdl.parseCreateIndex(CREATE);

    expect(parsed.name).toBe(NAME);
    expect(parsed.quotedTable).toBe(`"${TABLE}"`);
    expect(parsed.build).toContain("CREATE INDEX CONCURRENTLY");
    expect(parsed.build).toContain(`WHERE ${WHERE}`);
  });

  test("down() takes it away, online", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddDataStoreWorkerContentScanIndex1809179800000().down(
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
        return candidate === AddDataStoreWorkerContentScanIndex1809179800000;
      }),
    ).toHaveLength(1);
    expect(
      names.indexOf("AddDataStoreWorkerContentScanIndex1809179800000"),
    ).toBeGreaterThan(
      names.indexOf("AddOwnerNotificationDelivery1809179400000"),
    );
    expect(new AddDataStoreWorkerContentScanIndex1809179800000().name).toBe(
      "AddDataStoreWorkerContentScanIndex1809179800000",
    );
  });
});

describe("the model and the claim say the same", () => {
  test("DataStore declares the index: its kind, then its content scan's due time, of the stores no probe scans", () => {
    const declared: Array<IndexMetadataArgs> =
      getMetadataArgsStorage().indices.filter((index: IndexMetadataArgs) => {
        return (
          index.target === DataStore &&
          Array.isArray(index.columns) &&
          (index.columns as Array<string>).join(",") === COLUMNS.join(",")
        );
      });

    expect(declared).toHaveLength(1);
    expect(declared[0]!.where).toBe(WHERE);
    expect(declared[0]!.unique).toBeFalsy();
  });

  test("the claim reads what the index holds: the stores no probe scans, by kind, due or never scanned", () => {
    const claim: string = CLAIM_DUE_DATA_STORES_FOR_WORKERS_STATEMENT.replace(
      /\s+/g,
      " ",
    );

    // The predicate, word for word, so the planner can prove the index covers the claim.
    expect(claim).toContain(`WHERE ds."scanProbeId" IS NULL`);
    // The index's columns: the kinds a worker samples, and the due time.
    expect(claim).toContain(`ds."kind" = ANY($2::text[])`);
    expect(claim).toContain(
      `(ds."nextContentScanAt" IS NULL OR ds."nextContentScanAt" <= $1)`,
    );
  });
});
