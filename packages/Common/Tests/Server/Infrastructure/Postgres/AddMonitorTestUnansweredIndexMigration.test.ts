import MonitorTest from "../../../../Models/DatabaseModels/MonitorTest";
import OnlineDdl, {
  OnlineIndex,
} from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddMonitorTestUnansweredIndex1809187690819 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187690819-AddMonitorTestUnansweredIndex";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A PROBE'S TEST MONITOR CLAIM READS ONLY THE TESTS NOT YET ANSWERED
 * (issue #10819).
 *
 * Every replica of every probe claims its Test Monitor runs every ten
 * seconds (MonitorTestService.claimMonitorTestsForProbing). Answered tests
 * are kept two days and are almost all of a probe's rows, and the claim's
 * only index was by probe: it read every one of them to find the few
 * waiting. The index holds only the unanswered tests, by probe, oldest
 * first - the claim's own predicate and order.
 *
 * Pure SQL-contract assertions against a fake QueryRunner; OnlineDdl's own
 * steps are recorded as "online: <statement>". The name is TypeORM's own,
 * so the drift check finds nothing to change. ProbeDispatchQueryPlans-
 * Postgres.test.ts holds the claim's plan on a real Postgres.
 */

const UNANSWERED_INDEX: string = new DefaultNamingStrategy().indexName(
  "MonitorTest",
  ["probeId", "createdAt"],
  '"monitorStepProbeResponse" IS NULL AND "deletedAt" IS NULL',
);

const CREATE: string = `CREATE INDEX "${UNANSWERED_INDEX}" ON "MonitorTest" ("probeId", "createdAt") WHERE "monitorStepProbeResponse" IS NULL AND "deletedAt" IS NULL`;

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

describe("AddMonitorTestUnansweredIndex1809187690819", () => {
  test("the index is named as TypeORM names it", () => {
    expect(UNANSWERED_INDEX).toBe("IDX_3757a5e288a418e78a71a91316");
  });

  test("builds it online, outside a transaction", async () => {
    const migration: AddMonitorTestUnansweredIndex1809187690819 =
      new AddMonitorTestUnansweredIndex1809187690819();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([`online: ${CREATE}`]);
  });

  test("OnlineDdl reads it as an index it can build concurrently, partial as declared", () => {
    const parsed: OnlineIndex = OnlineDdl.parseCreateIndex(CREATE);

    expect(parsed.name).toBe(UNANSWERED_INDEX);
    expect(parsed.quotedTable).toBe('"MonitorTest"');
    expect(parsed.build).toBe(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${UNANSWERED_INDEX}" ON "MonitorTest" ("probeId", "createdAt") WHERE "monitorStepProbeResponse" IS NULL AND "deletedAt" IS NULL`,
    );
  });

  test("down() drops it online", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddMonitorTestUnansweredIndex1809187690819().down(runner);
      }),
    ).toEqual([`online: DROP INDEX "public"."${UNANSWERED_INDEX}"`]);
  });

  test("is registered once, after the migrations before it, and named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const names: Array<string> = registered.map((migration: unknown) => {
      return (migration as { name: string }).name;
    });

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddMonitorTestUnansweredIndex1809187690819;
      }),
    ).toHaveLength(1);
    expect(
      names.indexOf("AddMonitorTestUnansweredIndex1809187690819"),
    ).toBeGreaterThan(
      names.indexOf(
        "AddProjectStartIncidentsDeclaredByHandAcknowledged1809187680000",
      ),
    );
    expect(new AddMonitorTestUnansweredIndex1809187690819().name).toBe(
      "AddMonitorTestUnansweredIndex1809187690819",
    );
  });
});

describe("the MonitorTest model says the same", () => {
  test("it declares the index on the claim's own predicate, in the claim's order", () => {
    const declared: Array<IndexMetadataArgs> =
      getMetadataArgsStorage().indices.filter(
        (index: IndexMetadataArgs): boolean => {
          return index.target === MonitorTest;
        },
      );

    expect(
      declared.filter((index: IndexMetadataArgs): boolean => {
        return (
          Array.isArray(index.columns) &&
          (index.columns as Array<string>).join(",") === "probeId,createdAt" &&
          index.where ===
            '"monitorStepProbeResponse" IS NULL AND "deletedAt" IS NULL'
        );
      }),
    ).toHaveLength(1);
  });
});
