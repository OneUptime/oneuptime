import MonitorProbe from "../../../../Models/DatabaseModels/MonitorProbe";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { SwapMonitorProbeClaimIndexForClaimOrder1809187821386 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187821386-SwapMonitorProbeClaimIndexForClaimOrder";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE PROBE CLAIM'S INDEX HOLDS ITS ORDER (issue #11386).
 *
 * A probe's claim (MonitorProbeService.claimMonitorProbesForProbing) hands
 * out the rows due at the same moment by when each was last handed out,
 * oldest first: ORDER BY "nextPingAt", "lastPingAt". It reads them from
 * ("probeId", "isEnabled", "nextPingAt", "lastPingAt") in that order, which
 * takes the place of ("probeId", "isEnabled", "nextPingAt"): the old one
 * leads with the same columns and would cost every claim an index write
 * for nothing. The migration builds the new one before it drops the old,
 * both online (OnlineDdl), outside a transaction: probes claim on this
 * table all the time.
 *
 * Pure SQL-contract assertions against a fake QueryRunner; OnlineDdl's own
 * steps are recorded as "online: <statement>". The index names are worked
 * out with TypeORM's own naming strategy, so the drift check finds nothing
 * to change. MonitorProbeClaimOrderPostgres runs the claim on the migrated
 * index; ProbeDispatchQueryPlansPostgres holds its plan to it, with no sort.
 */

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

const CLAIM_ORDER_COLUMNS: Array<string> = [
  "probeId",
  "isEnabled",
  "nextPingAt",
  "lastPingAt",
];
const OLD_COLUMNS: Array<string> = ["probeId", "isEnabled", "nextPingAt"];

const CLAIM_ORDER_INDEX: string = namingStrategy.indexName(
  "MonitorProbe",
  CLAIM_ORDER_COLUMNS,
);
const OLD_INDEX: string = namingStrategy.indexName("MonitorProbe", OLD_COLUMNS);

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
  options: { isTransactionActive: boolean },
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
    isTransactionActive: options.isTransactionActive,
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

describe("SwapMonitorProbeClaimIndexForClaimOrder1809187821386", () => {
  test("the indexes it builds and drops are the ones TypeORM names for their columns", () => {
    expect(CLAIM_ORDER_INDEX).toBe("IDX_d9a0169b03234c77c5c66d0217");
    expect(OLD_INDEX).toBe("IDX_4bf4109d325af5e5b5a5665bc7");
  });

  test("builds the claim order's index, then drops the old one, both online and outside a transaction - and nothing else", async () => {
    const migration: SwapMonitorProbeClaimIndexForClaimOrder1809187821386 =
      new SwapMonitorProbeClaimIndexForClaimOrder1809187821386();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return migration.up(runner);
        },
        { isTransactionActive: false },
      ),
    ).toEqual([
      `online: CREATE INDEX "${CLAIM_ORDER_INDEX}" ON "MonitorProbe" ("probeId", "isEnabled", "nextPingAt", "lastPingAt") `,
      `online: DROP INDEX "public"."${OLD_INDEX}"`,
    ]);
  });

  test("down() builds the old index again in its own column order, before the new one goes, in the transaction TypeORM reverts in", async () => {
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return new SwapMonitorProbeClaimIndexForClaimOrder1809187821386().down(
            runner,
          );
        },
        { isTransactionActive: true },
      ),
    ).toEqual([
      // The old index's order, not the table's ("probeId", "nextPingAt", "isEnabled").
      `CREATE INDEX "${OLD_INDEX}" ON "MonitorProbe" ("probeId", "isEnabled", "nextPingAt") `,
      `online: DROP INDEX "public"."${CLAIM_ORDER_INDEX}"`,
    ]);
  });

  test("is registered once, last, after the migration before it, and named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const names: Array<string> = registered.map((migration: unknown) => {
      return (migration as { name: string }).name;
    });

    expect(
      registered.filter((candidate: unknown): boolean => {
        return (
          candidate === SwapMonitorProbeClaimIndexForClaimOrder1809187821386
        );
      }),
    ).toHaveLength(1);
    expect(
      names.indexOf("SwapMonitorProbeClaimIndexForClaimOrder1809187821386"),
    ).toBeGreaterThan(
      names.indexOf("AddVMwareHealthSettingsAndSwapRates1809187811157"),
    );
    // The newest of the registry: it runs after every migration before it.
    expect(names[names.length - 1]).toBe(
      "SwapMonitorProbeClaimIndexForClaimOrder1809187821386",
    );
    expect(
      new SwapMonitorProbeClaimIndexForClaimOrder1809187821386().name,
    ).toBe("SwapMonitorProbeClaimIndexForClaimOrder1809187821386");
  });
});

describe("the MonitorProbe model declares the claim order's index, and not the old one", () => {
  const declared: Array<Array<string>> = getMetadataArgsStorage()
    .indices.filter((index: IndexMetadataArgs): boolean => {
      return index.target === MonitorProbe;
    })
    .map((index: IndexMetadataArgs): Array<string> => {
      return Array.isArray(index.columns)
        ? (index.columns as Array<string>)
        : [];
    });

  test("its scheduler index is (probeId, isEnabled, nextPingAt, lastPingAt)", () => {
    expect(declared).toContainEqual(CLAIM_ORDER_COLUMNS);
    expect(declared).not.toContainEqual(OLD_COLUMNS);
  });

  /*
   * The claim's ORDER BY has to be the index's columns after its two
   * equalities, in its order and direction, for Postgres to read the rows
   * in that order and stop at its batch.
   */
  test("the claim orders by the index's columns after its equalities, in the index's order", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "Server",
        "Services",
        "MonitorProbeService.ts",
      ),
      "utf8",
    );
    const read: string = source.slice(
      source.indexOf('WITH "claimable" AS ('),
      source.indexOf('"schedule" AS ('),
    );

    expect(read).toContain(
      `WHERE mp."${CLAIM_ORDER_COLUMNS[0]}" = $1\n            AND mp."${CLAIM_ORDER_COLUMNS[1]}" = true\n            AND mp."${CLAIM_ORDER_COLUMNS[2]}" <= $2`,
    );
    expect(read).toContain(
      `ORDER BY ${CLAIM_ORDER_COLUMNS.slice(2)
        .map((column: string): string => {
          return `mp."${column}" ASC`;
        })
        .join(
          ", ",
        )}\n          LIMIT $3\n          FOR NO KEY UPDATE OF mp SKIP LOCKED`,
    );
  });
});
