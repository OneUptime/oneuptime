import { AddPerUserPasswordSalt1786018109307 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1786018109307-AddPerUserPasswordSalt";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration that adds the per-user salt columns.
 *
 * Three things have to hold together or per-user salts silently do not exist
 * in a deployed instance:
 *
 *   1. up() adds exactly the two columns, nullable — existing rows must keep
 *      their (unsalted) passwords working, so a NOT NULL column or a default
 *      would be wrong;
 *   2. down() removes exactly what up() added;
 *   3. the migration is registered in SchemaMigrations/Index.ts. An
 *      unregistered migration never runs on boot, so the column would be
 *      missing while the code writes to it — every login and every signup
 *      would 500.
 *
 * Pure SQL-contract assertions against a fake QueryRunner. No Postgres.
 */

type MakeQueryRunnerResult = {
  runner: QueryRunner;
  statements: Array<string>;
};

type MakeQueryRunnerFunction = () => MakeQueryRunnerResult;

const makeQueryRunner: MakeQueryRunnerFunction = (): MakeQueryRunnerResult => {
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

describe("AddPerUserPasswordSalt1786018109307 — SQL contract", () => {
  test("up() adds exactly the two salt columns and nothing else", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddPerUserPasswordSalt1786018109307().up(runner);

    expect(statements).toEqual([
      `ALTER TABLE "User" ADD "passwordSalt" character varying(100)`,
      `ALTER TABLE "StatusPagePrivateUser" ADD "passwordSalt" character varying(100)`,
    ]);
  });

  test("the columns are nullable, so every existing password keeps working", async () => {
    /*
     * Rows written before salts existed have no salt, and are verified
     * against the legacy unsalted scheme until the next successful login
     * re-hashes them. A NOT NULL column would have needed a backfill value,
     * and any backfilled salt would be wrong for the hash already stored.
     */
    const { runner, statements } = makeQueryRunner();

    await new AddPerUserPasswordSalt1786018109307().up(runner);

    for (const statement of statements) {
      expect(statement).not.toMatch(/NOT NULL/i);
      expect(statement).not.toMatch(/DEFAULT/i);
    }
  });

  test("the column is wide enough for the salts the code generates", async () => {
    /*
     * HashedString.generateSalt() produces 64 hex characters. A narrower
     * column would truncate on write and the password would never verify
     * again.
     */
    const { runner, statements } = makeQueryRunner();

    await new AddPerUserPasswordSalt1786018109307().up(runner);

    for (const statement of statements) {
      const width: RegExpMatchArray | null = statement.match(
        /character varying\((\d+)\)/,
      );

      expect(width).not.toBeNull();
      expect(Number(width![1])).toBeGreaterThanOrEqual(64);
    }
  });

  test("down() drops exactly what up() added", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddPerUserPasswordSalt1786018109307().down(runner);

    expect(statements).toEqual([
      `ALTER TABLE "StatusPagePrivateUser" DROP COLUMN "passwordSalt"`,
      `ALTER TABLE "User" DROP COLUMN "passwordSalt"`,
    ]);
  });

  test("up() and down() touch the same tables", async () => {
    const up: MakeQueryRunnerResult = makeQueryRunner();
    const down: MakeQueryRunnerResult = makeQueryRunner();

    await new AddPerUserPasswordSalt1786018109307().up(up.runner);
    await new AddPerUserPasswordSalt1786018109307().down(down.runner);

    type TablesFunction = (statements: Array<string>) => Array<string>;

    const tables: TablesFunction = (
      statements: Array<string>,
    ): Array<string> => {
      return statements
        .map((statement: string) => {
          return statement.match(/ALTER TABLE "([^"]+)"/)?.[1] as string;
        })
        .sort();
    };

    expect(tables(up.statements)).toEqual(tables(down.statements));
  });
});

describe("AddPerUserPasswordSalt1786018109307 — registration", () => {
  test("is registered in SchemaMigrations/Index.ts", () => {
    /*
     * The step that is easiest to forget and that fails the loudest in
     * production: an unregistered migration is dead code, so the column never
     * appears and the write path fails on the column that is not there.
     */
    expect(SchemaMigrations).toContain(AddPerUserPasswordSalt1786018109307);
  });

  test("its class name carries the timestamp its filename does", () => {
    // TypeORM orders migrations by the timestamp suffix on the class name.
    expect(AddPerUserPasswordSalt1786018109307.name).toBe(
      "AddPerUserPasswordSalt1786018109307",
    );
  });

  test("runs after every migration registered before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { name: string }) => {
        return migration.name;
      },
    );

    const index: number = names.indexOf("AddPerUserPasswordSalt1786018109307");

    expect(index).toBeGreaterThan(-1);

    type TimestampFunction = (name: string) => number;

    const timestampOf: TimestampFunction = (name: string): number => {
      return Number(name.match(/(\d+)$/)?.[1] || 0);
    };

    for (const earlier of names.slice(0, index)) {
      expect(timestampOf(earlier)).toBeLessThan(1786018109307);
    }
  });

  test("appears exactly once", () => {
    const occurrences: number = SchemaMigrations.filter(
      (migration: { name: string }) => {
        return migration.name === "AddPerUserPasswordSalt1786018109307";
      },
    ).length;

    expect(occurrences).toBe(1);
  });
});
