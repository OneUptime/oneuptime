import { AddStatusPageSubscriberUnsubscribeToken1795600000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1795600000000-AddStatusPageSubscriberUnsubscribeToken";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind unsubscribing without signing in: it adds
 * StatusPageSubscriber.unsubscribedAt and .unsubscribeToken, and gives every
 * existing subscriber a token, so the first notification after the upgrade
 * already carries a working link.
 *
 * Pure SQL-contract assertions against a fake QueryRunner.
 * StatusPageSubscriberUnsubscribePostgres runs the backfill against a real
 * Postgres and checks the tokens it writes.
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
  test("adds the two columns, nullable, then backfills the tokens", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddStatusPageSubscriberUnsubscribeToken1795600000000().up(runner);

    expect(statements).toEqual([
      `ALTER TABLE "StatusPageSubscriber" ADD "unsubscribedAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "StatusPageSubscriber" ADD "unsubscribeToken" character varying(100)`,
      `UPDATE "StatusPageSubscriber" SET "unsubscribeToken" = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') WHERE "unsubscribeToken" IS NULL`,
    ]);
  });

  test("the backfill draws a fresh random value per row and never overwrites one", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddStatusPageSubscriberUnsubscribeToken1795600000000().up(runner);

    const backfill: string = statements[2]!;

    // Two volatile UUIDs per row: 64 hex characters, like a minted token.
    expect(backfill.match(/gen_random_uuid\(\)/g)).toHaveLength(2);
    expect(backfill).toContain(`WHERE "unsubscribeToken" IS NULL`);
    // Every row, soft-deleted ones included: a restored subscriber needs a token too.
    expect(backfill).not.toContain("deletedAt");
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
