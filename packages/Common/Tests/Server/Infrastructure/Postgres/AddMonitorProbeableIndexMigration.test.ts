import Monitor from "../../../../Models/DatabaseModels/Monitor";
import OnlineDdl, {
  OnlineIndex,
} from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddMonitorProbeableIndex1809187791119 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187791119-AddMonitorProbeableIndex";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A PROBE'S PENDING COUNT JOINS ITS DUE ROWS TO THE MONITORS IT MAY CHECK BY
 * THEIR OWN INDEX (issue #11119).
 *
 * The count a probe's KEDA autoscaler reads applies the claim's rule to
 * thousands of due monitor probes. Their monitors' half of the rule - not
 * archived, paused or deleted - was read from "Monitor" itself, and with
 * thousands due Postgres read all of it to do so: 9,925 of the count's
 * 10,689 pages at 39,700 monitors. The index holds the id of each monitor
 * that may be probed, so the count reads the ids alone.
 *
 * Pure SQL-contract assertions against a fake QueryRunner; OnlineDdl's own
 * steps are recorded as "online: <statement>". The name is TypeORM's own,
 * so the drift check finds nothing to change. ProbeDispatchQueryPlans-
 * Postgres.test.ts and ProbeDispatchTwoProbesAtScalePostgres.test.ts hold
 * the count's plan on a real Postgres, and MonitorIndexesPostgres.test.ts
 * the table's indexes.
 */

// The monitor's half of MonitorProbeService.getProbeableSql.
const PROBEABLE: string =
  '"isArchived" = false AND "disableActiveMonitoring" = false AND "disableActiveMonitoringBecauseOfManualIncident" = false AND "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent" = false AND "deletedAt" IS NULL';

const PROBEABLE_INDEX: string = new DefaultNamingStrategy().indexName(
  "Monitor",
  ["_id"],
  PROBEABLE,
);

const CREATE: string = `CREATE INDEX "${PROBEABLE_INDEX}" ON "Monitor" ("_id") WHERE ${PROBEABLE}`;

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

describe("AddMonitorProbeableIndex1809187791119", () => {
  test("the index is named as TypeORM names it", () => {
    expect(PROBEABLE_INDEX).toBe("IDX_35665422ae411fa9290bc619e9");
  });

  test("builds it online, outside a transaction: Monitor is written all the time", async () => {
    const migration: AddMonitorProbeableIndex1809187791119 =
      new AddMonitorProbeableIndex1809187791119();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([`online: ${CREATE}`]);
  });

  test("OnlineDdl reads it as an index it can build concurrently, partial as declared", () => {
    const parsed: OnlineIndex = OnlineDdl.parseCreateIndex(CREATE);

    expect(parsed.name).toBe(PROBEABLE_INDEX);
    expect(parsed.quotedTable).toBe('"Monitor"');
    expect(parsed.build).toBe(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${PROBEABLE_INDEX}" ON "Monitor" ("_id") WHERE ${PROBEABLE}`,
    );
  });

  test("down() drops it online", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddMonitorProbeableIndex1809187791119().down(runner);
      }),
    ).toEqual([`online: DROP INDEX "public"."${PROBEABLE_INDEX}"`]);
  });

  test("is registered once, after the migrations before it, and named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const names: Array<string> = registered.map((migration: unknown) => {
      return (migration as { name: string }).name;
    });

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddMonitorProbeableIndex1809187791119;
      }),
    ).toHaveLength(1);
    expect(
      names.indexOf("AddMonitorProbeableIndex1809187791119"),
    ).toBeGreaterThan(names.indexOf("AddStorageArrayConnections1809187781104"));
    expect(new AddMonitorProbeableIndex1809187791119().name).toBe(
      "AddMonitorProbeableIndex1809187791119",
    );
  });
});

describe("the Monitor model says the same", () => {
  test("it declares the index on the monitor's half of the claim's rule", () => {
    const declared: Array<IndexMetadataArgs> =
      getMetadataArgsStorage().indices.filter(
        (index: IndexMetadataArgs): boolean => {
          return index.target === Monitor;
        },
      );

    expect(
      declared.filter((index: IndexMetadataArgs): boolean => {
        return (
          Array.isArray(index.columns) &&
          (index.columns as Array<string>).join(",") === "_id" &&
          index.where === PROBEABLE
        );
      }),
    ).toHaveLength(1);
  });

  /*
   * The columns the busiest writes move (MonitorIndexesPostgres holds the
   * migrated table to the same list): an update that changes a column an
   * index names in its key or its WHERE cannot be HOT.
   */
  test("names no column a frequent write moves, so those writes stay HOT", () => {
    for (const column of [
      "telemetryMonitorLastMonitorAt",
      "telemetryMonitorNextMonitorAt",
      "incomingRequestMonitorHeartbeatCheckedAt",
      "incomingEmailMonitorHeartbeatCheckedAt",
      "incomingEmailMonitorLastEmailReceivedAt",
      "incomingEmailMonitorRequest",
      "incomingMonitorRequest",
      "incomingMonitorRequestAsReceived",
      "serverMonitorRequestReceivedAt",
      "serverMonitorResponse",
      "updatedAt",
      "version",
      // A status change is not a pause: it does not touch the index either.
      "currentMonitorStatusId",
    ]) {
      expect(CREATE).not.toContain(`"${column}"`);
    }
  });
});
