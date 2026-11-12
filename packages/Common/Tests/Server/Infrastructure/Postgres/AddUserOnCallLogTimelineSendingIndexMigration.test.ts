import UserOnCallLogTimeline from "../../../../Models/DatabaseModels/UserOnCallLogTimeline";
import OnlineDdl, {
  OnlineIndex,
} from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddUserOnCallLogTimelineSendingIndex1809120200000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809120200000-AddUserOnCallLogTimelineSendingIndex";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE NOTIFICATIONS STILL GOING OUT, INDEXED (issue #6873).
 *
 * The stuck check (OnCallStuckNotifications) reads, every five minutes, the
 * on-call notifications still Sending 15 minutes after their page wrote
 * them, oldest first. "UserOnCallLogTimeline" keeps every notification ever
 * sent to anybody on call; the ones that say Sending are a handful at any
 * moment. So the index is partial - only those - on "createdAt", named as
 * TypeORM names it from the model's declaration, so the schema drift check
 * finds nothing to change. It is built online, outside a transaction
 * (OnlineDdl): every page writes to the table.
 *
 * Pure SQL-contract assertions against a fake QueryRunner; OnlineDdl's own
 * steps are recorded as "online: <statement>".
 * OnCallStuckNotificationsPostgres.test.ts reads the plan on a migrated
 * Postgres.
 */

const PREDICATE: string = `"status" = 'Sending' AND "deletedAt" IS NULL`;

const INDEX: string = new DefaultNamingStrategy().indexName(
  "UserOnCallLogTimeline",
  ["createdAt"],
  PREDICATE,
);

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

describe("AddUserOnCallLogTimelineSendingIndex1809120200000", () => {
  test("the index is named as TypeORM names it, predicate and all: the drift check finds nothing", () => {
    expect(INDEX).toBe("IDX_81e54f86fd5162924492fa5919");
  });

  test("builds the partial index online, outside a transaction - and nothing else", async () => {
    const migration: AddUserOnCallLogTimelineSendingIndex1809120200000 =
      new AddUserOnCallLogTimelineSendingIndex1809120200000();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([
      `online: CREATE INDEX "${INDEX}" ON "UserOnCallLogTimeline" ("createdAt") WHERE ${PREDICATE}`,
    ]);
  });

  test("OnlineDdl reads the statement as a build it can run online, predicate kept", () => {
    const parsed: OnlineIndex = OnlineDdl.parseCreateIndex(
      `CREATE INDEX "${INDEX}" ON "UserOnCallLogTimeline" ("createdAt") WHERE ${PREDICATE}`,
    );

    expect(parsed.name).toBe(INDEX);
    expect(parsed.quotedName).toBe(`"${INDEX}"`);
    expect(parsed.quotedTable).toBe(`"UserOnCallLogTimeline"`);
    expect(parsed.build).toContain("CREATE INDEX CONCURRENTLY");
    expect(parsed.build).toContain(`WHERE ${PREDICATE}`);
  });

  test("down() takes the index away, online", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddUserOnCallLogTimelineSendingIndex1809120200000().down(
          runner,
        );
      }),
    ).toEqual([`online: DROP INDEX "public"."${INDEX}"`]);
  });

  test("is registered once, last, after the migrations before it, and named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const names: Array<string> = registered.map((migration: unknown) => {
      return (migration as { name: string }).name;
    });

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddUserOnCallLogTimelineSendingIndex1809120200000;
      }),
    ).toHaveLength(1);
    expect(
      names.indexOf("AddUserOnCallLogTimelineSendingIndex1809120200000"),
    ).toBeGreaterThan(names.indexOf("AddProjectMilestones1809110500000"));
    expect(new AddUserOnCallLogTimelineSendingIndex1809120200000().name).toBe(
      "AddUserOnCallLogTimelineSendingIndex1809120200000",
    );
  });
});

describe("the UserOnCallLogTimeline model says the same", () => {
  function declared(): Array<IndexMetadataArgs> {
    return getMetadataArgsStorage().indices.filter(
      (index: IndexMetadataArgs) => {
        return index.target === UserOnCallLogTimeline && Boolean(index.where);
      },
    );
  }

  test("one partial index: on the time, over the notifications that say Sending and are not deleted", () => {
    expect(
      declared().map((index: IndexMetadataArgs) => {
        return {
          columns: index.columns,
          where: index.where,
          unique: Boolean(index.unique),
          synchronize: index.synchronize,
        };
      }),
    ).toEqual([
      {
        columns: ["createdAt"],
        where: PREDICATE,
        unique: false,
        // Owned by the schema like any other: the migration builds it as named.
        synchronize: true,
      },
    ]);
  });

  test("its predicate names the status the stuck check reads, as the column stores it", () => {
    expect(PREDICATE).toContain(`'Sending'`);
  });
});
