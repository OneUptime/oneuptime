import { WidenHashedStringColumnsForScrypt1786023262402 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1786023262402-WidenHashedStringColumnsForScrypt";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import ColumnLength from "../../../Types/Database/ColumnLength";
import { QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration that widens every HashedString column so a scrypt hash, which
 * carries its own cost parameters, fits.
 *
 * THE REASON THIS FILE EXISTS.
 *
 * `typeorm migration:generate` does not express a varchar length change as
 * ALTER COLUMN TYPE. It emits DROP COLUMN followed by ADD COLUMN — which for
 * these six columns means deleting every password, every status page and
 * dashboard master password, and every active session in the instance. The
 * generated file was replaced by hand for exactly that reason.
 *
 * Anyone who regenerates this migration (or writes the next widening the same
 * way) gets the destructive version back, and it looks perfectly ordinary in
 * review. The first test below is the guard: no statement in this migration
 * may drop a column.
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

const WIDENED: ReadonlyArray<[string, string]> = [
  ["User", "password"],
  ["StatusPagePrivateUser", "password"],
  ["StatusPage", "masterPassword"],
  ["Dashboard", "masterPassword"],
  ["UserSession", "refreshToken"],
  ["StatusPagePrivateUserSession", "refreshToken"],
];

describe("WidenHashedStringColumnsForScrypt — must not destroy data", () => {
  test("up() never drops a column", async () => {
    /*
     * The whole point. A DROP COLUMN here silently deletes every credential
     * in the database, and the migration would still 'succeed'.
     */
    const { runner, statements } = makeQueryRunner();

    await new WidenHashedStringColumnsForScrypt1786023262402().up(runner);

    for (const statement of statements) {
      expect(statement).not.toMatch(/DROP COLUMN/i);
    }
  });

  test("down() never drops a column either", async () => {
    const { runner, statements } = makeQueryRunner();

    await new WidenHashedStringColumnsForScrypt1786023262402().down(runner);

    for (const statement of statements) {
      expect(statement).not.toMatch(/DROP COLUMN/i);
    }
  });

  test("up() is nothing but ALTER COLUMN TYPE statements", async () => {
    const { runner, statements } = makeQueryRunner();

    await new WidenHashedStringColumnsForScrypt1786023262402().up(runner);

    for (const statement of statements) {
      expect(statement).toMatch(
        /^ALTER TABLE "[A-Za-z]+" ALTER COLUMN "[A-Za-z]+" TYPE character varying\(\d+\)$/,
      );
    }
  });

  test("it does not touch constraints or indexes", async () => {
    /*
     * The generated version dropped and recreated the refresh-token unique
     * constraints and indexes purely to work around its own DROP COLUMN.
     * Widening a varchar needs no table rewrite, so the indexes survive
     * untouched and none of that churn is necessary.
     */
    const { runner, statements } = makeQueryRunner();

    await new WidenHashedStringColumnsForScrypt1786023262402().up(runner);

    for (const statement of statements) {
      expect(statement).not.toMatch(/CONSTRAINT/i);
      expect(statement).not.toMatch(/INDEX/i);
    }
  });
});

describe("WidenHashedStringColumnsForScrypt — SQL contract", () => {
  test("up() widens exactly the six HashedString columns", async () => {
    const { runner, statements } = makeQueryRunner();

    await new WidenHashedStringColumnsForScrypt1786023262402().up(runner);

    expect(statements).toHaveLength(WIDENED.length);

    for (const [table, column] of WIDENED) {
      expect(statements).toContain(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE character varying(255)`,
      );
    }
  });

  test("it widens to whatever ColumnLength.HashedString says", async () => {
    /*
     * The entity metadata and the migration have to agree, or the drift check
     * fails and the next generated migration tries to 'fix' it.
     */
    const { runner, statements } = makeQueryRunner();

    await new WidenHashedStringColumnsForScrypt1786023262402().up(runner);

    for (const statement of statements) {
      expect(statement).toContain(
        `character varying(${ColumnLength.HashedString})`,
      );
    }
  });

  test("down() returns the same six columns to 64", async () => {
    const { runner, statements } = makeQueryRunner();

    await new WidenHashedStringColumnsForScrypt1786023262402().down(runner);

    expect(statements).toHaveLength(WIDENED.length);

    for (const [table, column] of WIDENED) {
      expect(statements).toContain(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE character varying(64)`,
      );
    }
  });

  test("down() reverses up()'s order", async () => {
    const up: MakeQueryRunnerResult = makeQueryRunner();
    const down: MakeQueryRunnerResult = makeQueryRunner();

    await new WidenHashedStringColumnsForScrypt1786023262402().up(up.runner);
    await new WidenHashedStringColumnsForScrypt1786023262402().down(
      down.runner,
    );

    type ColumnsFunction = (statements: Array<string>) => Array<string>;

    const columns: ColumnsFunction = (
      statements: Array<string>,
    ): Array<string> => {
      return statements.map((statement: string) => {
        return statement
          .match(/ALTER TABLE "([^"]+)" ALTER COLUMN "([^"]+)"/)!
          .slice(1, 3)
          .join(".");
      });
    };

    expect(columns(down.statements)).toEqual(columns(up.statements).reverse());
  });

  test("the widened column holds a scrypt hash with room to spare", () => {
    // `scrypt$N=16384,r=8,p=1$` + 64 hex characters.
    const worstCaseToday: number = "scrypt$N=1048576,r=32,p=16$".length + 64;

    expect(ColumnLength.HashedString).toBeGreaterThan(worstCaseToday);
  });
});

describe("WidenHashedStringColumnsForScrypt — registration", () => {
  test("is registered in SchemaMigrations/Index.ts", () => {
    expect(SchemaMigrations).toContain(
      WidenHashedStringColumnsForScrypt1786023262402,
    );
  });

  test("appears exactly once", () => {
    const occurrences: number = SchemaMigrations.filter(
      (migration: { name: string }) => {
        return (
          migration.name === "WidenHashedStringColumnsForScrypt1786023262402"
        );
      },
    ).length;

    expect(occurrences).toBe(1);
  });

  test("runs after the migration that added the salt columns", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { name: string }) => {
        return migration.name;
      },
    );

    expect(
      names.indexOf("WidenHashedStringColumnsForScrypt1786023262402"),
    ).toBeGreaterThan(names.indexOf("AddPerUserPasswordSalt1786018109307"));
  });
});
