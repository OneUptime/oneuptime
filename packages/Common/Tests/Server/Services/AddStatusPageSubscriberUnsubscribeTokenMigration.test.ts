import { AddStatusPageSubscriberUnsubscribeToken1795600000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1795600000000-AddStatusPageSubscriberUnsubscribeToken";
import { AddStatusPageSubscriberIsAddedByTeam1795700000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1795700000000-AddStatusPageSubscriberIsAddedByTeam";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * The migrations behind unsubscribing without signing in: they add
 * StatusPageSubscriber.unsubscribedAt, .unsubscribeToken and .isAddedByTeam.
 *
 * Only the columns, and none of them rewrites the table: a migration runs in
 * one transaction, holding ADD COLUMN's exclusive lock on StatusPageSubscriber
 * until it commits, and under the connection's statement timeout. So filling
 * the columns for existing subscribers is the
 * BackfillStatusPageSubscriberUnsubscribeColumns data migration's job, in
 * batches (StatusPageSubscriberUnsubscribePostgres runs it against a real
 * Postgres).
 *
 * Pure SQL-contract assertions against a fake QueryRunner.
 */

type MakeQueryRunnerResult = {
  runner: QueryRunner;
  statements: Array<string>;
};

const makeQueryRunner: () => MakeQueryRunnerResult =
  (): MakeQueryRunnerResult => {
    const statements: Array<string> = [];

    const query: (...args: Array<unknown>) => Promise<undefined> = (
      ...args: Array<unknown>
    ): Promise<undefined> => {
      statements.push(String(args[0]));
      return Promise.resolve(undefined);
    };

    return {
      runner: { query } as unknown as QueryRunner,
      statements,
    };
  };

describe("AddStatusPageSubscriberUnsubscribeToken1795600000000", () => {
  test("adds the two columns, nullable, and nothing else", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddStatusPageSubscriberUnsubscribeToken1795600000000().up(runner);

    expect(statements).toEqual([
      `ALTER TABLE "StatusPageSubscriber" ADD "unsubscribedAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "StatusPageSubscriber" ADD "unsubscribeToken" character varying(100)`,
    ]);
  });

  test("never updates rows inside the migration's transaction", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddStatusPageSubscriberUnsubscribeToken1795600000000().up(runner);

    for (const statement of statements) {
      expect(statement.startsWith("ALTER TABLE")).toBe(true);
      // A nullable column with no default is added without a table rewrite.
      expect(statement).not.toContain("DEFAULT");
      expect(statement).not.toContain("NOT NULL");
    }
  });

  test("the column is wide enough for a 64-character token", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddStatusPageSubscriberUnsubscribeToken1795600000000().up(runner);

    const width: RegExpMatchArray | null = statements[1]!.match(
      /character varying\((\d+)\)/,
    );

    expect(Number(width![1])).toBeGreaterThanOrEqual(64);
  });

  test("down() drops exactly what up() added", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddStatusPageSubscriberUnsubscribeToken1795600000000().down(
      runner,
    );

    expect(statements).toEqual([
      `ALTER TABLE "StatusPageSubscriber" DROP COLUMN "unsubscribeToken"`,
      `ALTER TABLE "StatusPageSubscriber" DROP COLUMN "unsubscribedAt"`,
    ]);
  });

  test("is registered, after the migrations it builds on, and named for its class", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );

    const index: number = names.indexOf(
      "AddStatusPageSubscriberUnsubscribeToken1795600000000",
    );

    expect(index).toBeGreaterThan(-1);
    expect(index).toBeGreaterThan(
      names.indexOf("AddIncidentTemplateStatusPageScopeFlag1795500000000"),
    );
    expect(
      new AddStatusPageSubscriberUnsubscribeToken1795600000000().name,
    ).toBe("AddStatusPageSubscriberUnsubscribeToken1795600000000");
  });
});

describe("AddStatusPageSubscriberIsAddedByTeam1795700000000", () => {
  test("adds the column NOT NULL with a constant default, which Postgres does without a rewrite", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddStatusPageSubscriberIsAddedByTeam1795700000000().up(runner);

    expect(statements).toEqual([
      `ALTER TABLE "StatusPageSubscriber" ADD "isAddedByTeam" boolean NOT NULL DEFAULT false`,
    ]);
  });

  test("down() drops exactly what up() added", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddStatusPageSubscriberIsAddedByTeam1795700000000().down(runner);

    expect(statements).toEqual([
      `ALTER TABLE "StatusPageSubscriber" DROP COLUMN "isAddedByTeam"`,
    ]);
  });

  test("is registered right after the token migration, and named for its class", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );

    expect(
      names.indexOf("AddStatusPageSubscriberIsAddedByTeam1795700000000"),
    ).toBe(
      names.indexOf("AddStatusPageSubscriberUnsubscribeToken1795600000000") + 1,
    );
    expect(new AddStatusPageSubscriberIsAddedByTeam1795700000000().name).toBe(
      "AddStatusPageSubscriberIsAddedByTeam1795700000000",
    );
  });
});
