import { AddUserProjectSsoConsent1795100000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1795100000000-AddUserProjectSsoConsent";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import UserProjectSsoConsent from "../../../../Models/DatabaseModels/UserProjectSsoConsent";
import { describe, expect, test } from "@jest/globals";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * The schema half of "a project's SSO may sign an account in only once the
 * account's mailbox has agreed to it".
 *
 * The migration was generated against the model, so its names are TypeORM's
 * by construction. What this pins is that it stays the migration for it: the
 * table has every column the model persists, one live consent per (user,
 * project) is enforced by the database -- the service absorbs a racing second
 * insert by relying on exactly this -- a consent goes with its user or its
 * project, the unique index keeps the name the model declares (a hand edit
 * that renamed it would pass review and then fail the Schema Drift job), and
 * down() undoes up().
 *
 * Fake QueryRunner only.
 */

const TABLE: string = "UserProjectSsoConsent";
const MIGRATION_NAME: string = "AddUserProjectSsoConsent1795100000000";
const MIGRATION_TIMESTAMP: number = 1795100000000;
const UNIQUE_INDEX_NAME: string = "IDX_UserProjectSsoConsent_userId_projectId";

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

type RecordQueriesFunction = (
  direction: "up" | "down",
) => Promise<Array<string>>;

const recordQueries: RecordQueriesFunction = async (
  direction: "up" | "down",
): Promise<Array<string>> => {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  await new AddUserProjectSsoConsent1795100000000()[direction](queryRunner);

  return statements;
};

// Columns a model persists, inherited ones (_id, version, ...) included.
function persistedColumns(modelType: unknown): Array<string> {
  const names: Array<string> = [];
  let current: unknown = modelType;

  while (typeof current === "function" && current !== Function.prototype) {
    for (const column of getMetadataArgsStorage().columns) {
      if (column.target === current) {
        const args: ColumnMetadataArgs = column;
        names.push(args.options.name || args.propertyName);
      }
    }

    current = Object.getPrototypeOf(current);
  }

  return names;
}

function captured(statements: Array<string>, pattern: RegExp): Array<string> {
  return statements
    .map((statement: string): string | null => {
      const match: RegExpMatchArray | null = statement.match(pattern);
      return match ? match[1]! : null;
    })
    .filter((value: string | null): value is string => {
      return value !== null;
    });
}

function registeredNames(): Array<string> {
  return (SchemaMigrations as unknown as Array<{ name: string }>).map(
    (registered: { name: string }): string => {
      return registered.name;
    },
  );
}

describe("AddUserProjectSsoConsent1795100000000", () => {
  test("is registered under the name its class carries", () => {
    expect(new AddUserProjectSsoConsent1795100000000().name).toBe(
      MIGRATION_NAME,
    );
    expect(SchemaMigrations).toContain(AddUserProjectSsoConsent1795100000000);
  });

  test("nothing registered before it is newer than it", () => {
    const names: Array<string> = registeredNames();
    const ownIndex: number = names.indexOf(MIGRATION_NAME);

    expect(ownIndex).toBeGreaterThan(0);

    const notBehind: Array<string> = names
      .slice(0, ownIndex)
      .filter((className: string): boolean => {
        const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
        return match !== null && Number(match[1]) >= MIGRATION_TIMESTAMP;
      });

    expect(notBehind).toEqual([]);
  });

  test("nothing registered after it is older than it", () => {
    const names: Array<string> = registeredNames();
    const ownIndex: number = names.indexOf(MIGRATION_NAME);

    const olderAfter: Array<string> = names
      .slice(ownIndex + 1)
      .filter((className: string): boolean => {
        const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
        return match === null || Number(match[1]) <= MIGRATION_TIMESTAMP;
      });

    expect(olderAfter).toEqual([]);
  });

  test("touches only its own table", async () => {
    for (const statement of await recordQueries("up")) {
      const table: RegExpMatchArray | null = statement.match(
        /^(?:CREATE TABLE|ALTER TABLE|CREATE (?:UNIQUE )?INDEX "[^"]+" ON) "([^"]+)"/,
      );

      expect({ statement, table: table?.[1] }).toEqual({
        statement,
        table: TABLE,
      });
    }
  });

  test("creates the table with every column the model persists", async () => {
    const statements: Array<string> = await recordQueries("up");
    const creates: Array<string> = statements.filter(
      (statement: string): boolean => {
        return statement.startsWith(`CREATE TABLE "${TABLE}" (`);
      },
    );

    expect(creates).toHaveLength(1);

    const columns: Array<string> = persistedColumns(UserProjectSsoConsent);

    expect(columns).toEqual(
      expect.arrayContaining(["_id", "userId", "projectId", "deletedAt"]),
    );

    for (const column of columns) {
      expect({ column, created: creates[0]!.includes(`"${column}"`) }).toEqual({
        column,
        created: true,
      });
    }

    expect(creates[0]).toContain('"userId" uuid NOT NULL');
    expect(creates[0]).toContain('"projectId" uuid NOT NULL');
    expect(creates[0]).toContain(
      `CONSTRAINT "${namingStrategy.primaryKeyName(TABLE, ["_id"])}" PRIMARY KEY ("_id")`,
    );
  });

  test("allows one live consent per user and project, under the model's index name", async () => {
    expect(await recordQueries("up")).toContain(
      `CREATE UNIQUE INDEX "${UNIQUE_INDEX_NAME}" ON "${TABLE}" ("userId", "projectId") WHERE "deletedAt" IS NULL`,
    );
  });

  test.each(["userId", "projectId"])(
    "indexes %s on its own",
    async (column: string) => {
      const name: string = namingStrategy.indexName(TABLE, [column]);

      expect(await recordQueries("up")).toContain(
        `CREATE INDEX "${name}" ON "${TABLE}" ("${column}") `,
      );
    },
  );

  test.each([
    ["userId", "User"],
    ["projectId", "Project"],
  ])(
    "%s references %s and goes with it when it is deleted",
    async (column: string, referenced: string) => {
      const name: string = namingStrategy.foreignKeyName(TABLE, [column]);

      expect(await recordQueries("up")).toContain(
        `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}") REFERENCES "${referenced}"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      );
    },
  );

  test("down() removes every constraint up() added, in reverse", async () => {
    const added: Array<string> = captured(
      await recordQueries("up"),
      /ADD CONSTRAINT "([^"]+)"/,
    );
    const dropped: Array<string> = captured(
      await recordQueries("down"),
      /DROP CONSTRAINT "([^"]+)"/,
    );

    expect(added).toHaveLength(2);
    expect(dropped).toEqual([...added].reverse());
  });

  test("down() drops every index up() created, then the table, last", async () => {
    const created: Array<string> = captured(
      await recordQueries("up"),
      /^CREATE (?:UNIQUE )?INDEX "([^"]+)"/,
    );
    const down: Array<string> = await recordQueries("down");
    const dropped: Array<string> = captured(
      down,
      /^DROP INDEX "public"\."([^"]+)"$/,
    );

    expect(created).toHaveLength(3);
    expect([...dropped].sort()).toEqual([...created].sort());
    expect(down[down.length - 1]).toBe(`DROP TABLE "${TABLE}"`);
  });
});
