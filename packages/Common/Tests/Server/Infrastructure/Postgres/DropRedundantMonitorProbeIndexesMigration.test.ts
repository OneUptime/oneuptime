import MonitorProbe from "../../../../Models/DatabaseModels/MonitorProbe";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { DropRedundantMonitorProbeIndexes1809150400000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809150400000-DropRedundantMonitorProbeIndexes";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * MONITORPROBE'S REDUNDANT INDEXES GO (issue #7921).
 *
 * Every probe claim moves a monitor probe's "nextPingAt", which is indexed,
 * so no claim is a HOT update: each one writes a new entry into every index
 * on the table. Two of its seven indexes repeated the leading column of
 * another one - ("probeId") of ("probeId", "isEnabled", "nextPingAt"), and
 * ("monitorId") of ("monitorId", "probeId") and ("monitorId", "projectId") -
 * so they served nothing the composites do not, and cost every claim two of
 * its seven index writes. The migration drops them online (DROP INDEX
 * CONCURRENTLY through OnlineDdl), outside a transaction: probes claim and
 * store results on this table all the time.
 *
 * Pure SQL-contract assertions against a fake QueryRunner; OnlineDdl's own
 * steps are recorded as "online: <statement>". The index names are worked
 * out with TypeORM's own naming strategy, so the drift check finds nothing
 * to change.
 */

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

const PROBE_ID_INDEX: string = namingStrategy.indexName("MonitorProbe", [
  "probeId",
]);

const MONITOR_ID_INDEX: string = namingStrategy.indexName("MonitorProbe", [
  "monitorId",
]);

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

describe("DropRedundantMonitorProbeIndexes1809150400000", () => {
  test("the indexes it drops are the ones TypeORM named for the bare columns", () => {
    expect(PROBE_ID_INDEX).toBe("IDX_2d50a0e0e624369e7f90a62e8d");
    expect(MONITOR_ID_INDEX).toBe("IDX_a540272f483ef1de68f7e64748");
  });

  test("drops both online, outside a transaction - and nothing else", async () => {
    const migration: DropRedundantMonitorProbeIndexes1809150400000 =
      new DropRedundantMonitorProbeIndexes1809150400000();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return migration.up(runner);
        },
        { isTransactionActive: false },
      ),
    ).toEqual([
      `online: DROP INDEX "public"."${PROBE_ID_INDEX}"`,
      `online: DROP INDEX "public"."${MONITOR_ID_INDEX}"`,
    ]);
  });

  test("down() builds both again as the generator wrote them, in the transaction TypeORM reverts in", async () => {
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return new DropRedundantMonitorProbeIndexes1809150400000().down(
            runner,
          );
        },
        { isTransactionActive: true },
      ),
    ).toEqual([
      `CREATE INDEX "${MONITOR_ID_INDEX}" ON "MonitorProbe" ("monitorId") `,
      `CREATE INDEX "${PROBE_ID_INDEX}" ON "MonitorProbe" ("probeId") `,
    ]);
  });

  test("is registered once, after the migration before it, and named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const names: Array<string> = registered.map((migration: unknown) => {
      return (migration as { name: string }).name;
    });

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === DropRedundantMonitorProbeIndexes1809150400000;
      }),
    ).toHaveLength(1);
    expect(
      names.indexOf("DropRedundantMonitorProbeIndexes1809150400000"),
    ).toBeGreaterThan(
      names.indexOf("AddNotifySubscribersOfNewIncidentsByDefault1809150300000"),
    );
    expect(new DropRedundantMonitorProbeIndexes1809150400000().name).toBe(
      "DropRedundantMonitorProbeIndexes1809150400000",
    );
  });
});

describe("the MonitorProbe model says the same", () => {
  function declared(): Array<Array<string>> {
    return getMetadataArgsStorage()
      .indices.filter((index: IndexMetadataArgs): boolean => {
        return index.target === MonitorProbe;
      })
      .map((index: IndexMetadataArgs): Array<string> => {
        if (!Array.isArray(index.columns)) {
          throw new Error(
            "A MonitorProbe index declares its columns as a function; list them.",
          );
        }
        return index.columns as Array<string>;
      });
  }

  test("its indexes: the project, the two monitor composites and the claim's", () => {
    expect(
      declared()
        .map((columns: Array<string>): string => {
          return columns.join(", ");
        })
        .sort(),
    ).toEqual([
      "monitorId, probeId",
      "monitorId, projectId",
      "probeId, isEnabled, nextPingAt",
      "projectId",
    ]);
  });

  /*
   * What makes the two dropped indexes redundant: a btree serves any read -
   * and the ON DELETE CASCADE of a monitor or a probe - by its leading
   * column. So every column a cascade or a lookup reads alone still leads
   * an index.
   */
  test("monitorId, probeId and projectId each still lead an index", () => {
    const leading: Set<string> = new Set(
      declared().map((columns: Array<string>): string => {
        return columns[0]!;
      }),
    );

    expect(leading).toEqual(new Set(["monitorId", "probeId", "projectId"]));
  });

  test("no index repeats the leading columns of another: each one would cost every claim a write for nothing", () => {
    const indexes: Array<Array<string>> = declared();
    const redundant: Array<string> = [];

    for (const index of indexes) {
      for (const other of indexes) {
        if (
          index !== other &&
          index.length < other.length &&
          index.every((column: string, position: number): boolean => {
            return other[position] === column;
          })
        ) {
          redundant.push(`(${index.join(", ")}) of (${other.join(", ")})`);
        }
      }
    }

    expect(redundant).toEqual([]);
  });
});
