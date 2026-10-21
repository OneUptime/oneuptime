import { AddMcpOAuthTables1796900000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1796900000000-AddMcpOAuthTables";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind OAuth sign-in for the MCP server: three new tables
 * (McpOAuthClient, McpOAuthGrant, McpOAuthToken), nothing existing altered.
 *
 * What the feature depends on the database for, and so what is pinned here:
 *
 *   - `tokenHash` is UNIQUE. A secret is looked up by its digest; two rows
 *     with one digest would make "which grant is this token for" ambiguous.
 *   - a token goes when its grant goes (ON DELETE CASCADE). Revoking a client
 *     is deleting its grant, and that cascade is the whole of what takes the
 *     client's codes, access tokens and refresh tokens with it.
 *   - a grant goes when its project or its user does.
 *   - the columns the sweeps and the hot lookups filter on are indexed.
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

const runUp: () => Promise<Array<string>> = async (): Promise<
  Array<string>
> => {
  const { runner, statements } = makeQueryRunner();

  await new AddMcpOAuthTables1796900000000().up(runner);

  return statements;
};

const runDown: () => Promise<Array<string>> = async (): Promise<
  Array<string>
> => {
  const { runner, statements } = makeQueryRunner();

  await new AddMcpOAuthTables1796900000000().down(runner);

  return statements;
};

const TABLES: Array<string> = [
  "McpOAuthClient",
  "McpOAuthGrant",
  "McpOAuthToken",
];

const CREATE_TABLE_PATTERN: RegExp = /^CREATE TABLE "([A-Za-z]+)" \(/;
const CREATE_INDEX_PATTERN: RegExp =
  /^CREATE INDEX "(IDX_[0-9a-f]+)" ON "([A-Za-z]+)" \("([A-Za-z]+)"\)/;
const DROP_INDEX_PATTERN: RegExp = /^DROP INDEX "public"\."(IDX_[0-9a-f]+)"$/;
const ADD_FOREIGN_KEY_PATTERN: RegExp =
  /^ALTER TABLE "([A-Za-z]+)" ADD CONSTRAINT "(FK_[0-9a-f]+)" FOREIGN KEY \("([A-Za-z]+)"\) REFERENCES "([A-Za-z]+)"\("_id"\) ON DELETE ([A-Z ]+) ON UPDATE NO ACTION$/;
const DROP_FOREIGN_KEY_PATTERN: RegExp =
  /^ALTER TABLE "([A-Za-z]+)" DROP CONSTRAINT "(FK_[0-9a-f]+)"$/;
const DROP_TABLE_PATTERN: RegExp = /^DROP TABLE "([A-Za-z]+)"$/;
const ROW_WRITING_STATEMENT_PATTERN: RegExp =
  /^\s*(UPDATE|INSERT|DELETE|TRUNCATE)\b/i;
const DROP_PATTERN: RegExp = /\bDROP\b/i;
const MIGRATION_TIMESTAMP_PATTERN: RegExp = /(\d{13})$/;
const TOKEN_HASH_UNIQUE_PATTERN: RegExp =
  /CONSTRAINT "UQ_[0-9a-f]+" UNIQUE \("tokenHash"\)/;
const PLAINTEXT_SECRET_COLUMN_PATTERN: RegExp =
  /"(token|secret|code|accessToken|refreshToken)" /i;
const TOKEN_HASH_WIDTH_PATTERN: RegExp =
  /"tokenHash" character varying\((\d+)\)/;
const CLIENT_ID_WIDTH_PATTERN: RegExp = /"clientId" character varying\((\d+)\)/;
const CONSUMED_AT_DEFAULT_PATTERN: RegExp = /"consumedAt"[^,]*DEFAULT/;
const CONSUMED_AT_NOT_NULL_PATTERN: RegExp = /"consumedAt"[^,]*NOT NULL/;
const PLAINTEXT_CLIENT_SECRET_COLUMN_PATTERN: RegExp = /"clientSecret" /;

interface ForeignKey {
  table: string;
  name: string;
  column: string;
  referencedTable: string;
  onDelete: string;
}

const findCreateTable: (statements: Array<string>, table: string) => string = (
  statements: Array<string>,
  table: string,
): string => {
  const matches: Array<string> = statements.filter(
    (statement: string): boolean => {
      return statement.startsWith(`CREATE TABLE "${table}" (`);
    },
  );

  expect(matches).toHaveLength(1);

  return matches[0]!;
};

const indexedColumns: (
  statements: Array<string>,
  table: string,
) => Array<string> = (
  statements: Array<string>,
  table: string,
): Array<string> => {
  const columns: Array<string> = [];

  for (const statement of statements) {
    const match: RegExpMatchArray | null =
      statement.match(CREATE_INDEX_PATTERN);

    if (match && match[2] === table) {
      columns.push(match[3]!);
    }
  }

  return columns.sort();
};

const foreignKeys: (statements: Array<string>) => Array<ForeignKey> = (
  statements: Array<string>,
): Array<ForeignKey> => {
  const keys: Array<ForeignKey> = [];

  for (const statement of statements) {
    const match: RegExpMatchArray | null = statement.match(
      ADD_FOREIGN_KEY_PATTERN,
    );

    if (match) {
      keys.push({
        table: match[1]!,
        name: match[2]!,
        column: match[3]!,
        referencedTable: match[4]!,
        onDelete: match[5]!,
      });
    }
  }

  return keys;
};

describe("AddMcpOAuthTables1796900000000", () => {
  describe("up()", () => {
    test("creates exactly the three tables, and alters nothing that already exists", async () => {
      const statements: Array<string> = await runUp();

      const created: Array<string> = statements
        .map((statement: string): string | undefined => {
          return statement.match(CREATE_TABLE_PATTERN)?.[1];
        })
        .filter((table: string | undefined): table is string => {
          return Boolean(table);
        });

      expect(created).toEqual(TABLES);

      /*
       * Every statement is a CREATE TABLE, a CREATE INDEX on one of the new
       * tables, or a foreign key ADDED TO one of the new tables. Nothing
       * touches a table that was there before, so the migration takes no lock
       * on Project or User beyond the brief one a new foreign key needs.
       */
      for (const statement of statements) {
        const createTable: RegExpMatchArray | null =
          statement.match(CREATE_TABLE_PATTERN);
        const createIndex: RegExpMatchArray | null =
          statement.match(CREATE_INDEX_PATTERN);
        const addForeignKey: RegExpMatchArray | null = statement.match(
          ADD_FOREIGN_KEY_PATTERN,
        );

        const table: string | undefined =
          createTable?.[1] || createIndex?.[2] || addForeignKey?.[1];

        expect(TABLES).toContain(table);
      }
    });

    test("never writes or rewrites rows", async () => {
      for (const statement of await runUp()) {
        // (A foreign key's "ON UPDATE NO ACTION" is not an UPDATE statement.)
        expect(statement).not.toMatch(ROW_WRITING_STATEMENT_PATTERN);
        expect(statement).not.toMatch(DROP_PATTERN);
      }
    });

    test("stores a token only as a digest, and makes that digest unique", async () => {
      const table: string = findCreateTable(await runUp(), "McpOAuthToken");

      expect(table).toContain(`"tokenHash" character varying(100) NOT NULL`);
      expect(table).toMatch(TOKEN_HASH_UNIQUE_PATTERN);

      // The digest is the only column a secret could be in: there is no other.
      expect(table).not.toMatch(PLAINTEXT_SECRET_COLUMN_PATTERN);
    });

    test("the digest column is wide enough for a SHA-256 hex digest", async () => {
      const table: string = findCreateTable(await runUp(), "McpOAuthToken");
      const width: RegExpMatchArray | null = table.match(
        TOKEN_HASH_WIDTH_PATTERN,
      );

      expect(Number(width![1])).toBeGreaterThanOrEqual(64);
    });

    test("a token cannot exist without a grant, a type and an expiry", async () => {
      const table: string = findCreateTable(await runUp(), "McpOAuthToken");

      expect(table).toContain(`"mcpOAuthGrantId" uuid NOT NULL`);
      expect(table).toContain(`"tokenType" character varying(100) NOT NULL`);
      expect(table).toContain(`"expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL`);
    });

    test("an unconsumed token is NULL in consumedAt, which is what single use compares against", async () => {
      const table: string = findCreateTable(await runUp(), "McpOAuthToken");

      // Nullable, and with no default: a new row is "not consumed yet".
      expect(table).toContain(`"consumedAt" TIMESTAMP WITH TIME ZONE,`);
      expect(table).not.toMatch(CONSUMED_AT_DEFAULT_PATTERN);
      expect(table).not.toMatch(CONSUMED_AT_NOT_NULL_PATTERN);
    });

    test("the PKCE challenge and the redirect URI ride on the code's row, both optional", async () => {
      const table: string = findCreateTable(await runUp(), "McpOAuthToken");

      expect(table).toContain(`"codeChallenge" character varying(100),`);
      // text, not a bounded varchar: a redirect URI may be up to 1024 characters.
      expect(table).toContain(`"redirectUri" text,`);
    });

    test("deleting a grant deletes every code and token issued under it", async () => {
      const keys: Array<ForeignKey> = foreignKeys(await runUp());

      const tokenToGrant: Array<ForeignKey> = keys.filter(
        (key: ForeignKey): boolean => {
          return key.table === "McpOAuthToken";
        },
      );

      expect(tokenToGrant).toEqual([
        {
          table: "McpOAuthToken",
          name: "FK_a848b7f49a863d67799a117b82f",
          column: "mcpOAuthGrantId",
          referencedTable: "McpOAuthGrant",
          onDelete: "CASCADE",
        },
      ]);
    });

    test("a grant goes with its project and with its user", async () => {
      const keys: Array<ForeignKey> = foreignKeys(await runUp()).filter(
        (key: ForeignKey): boolean => {
          return key.table === "McpOAuthGrant";
        },
      );

      expect(
        keys.map((key: ForeignKey): Omit<ForeignKey, "name"> => {
          return {
            table: key.table,
            column: key.column,
            referencedTable: key.referencedTable,
            onDelete: key.onDelete,
          };
        }),
      ).toEqual([
        {
          table: "McpOAuthGrant",
          column: "projectId",
          referencedTable: "Project",
          onDelete: "CASCADE",
        },
        {
          table: "McpOAuthGrant",
          column: "userId",
          referencedTable: "User",
          onDelete: "CASCADE",
        },
      ]);
    });

    test("adds no other foreign key: a registered client is not tied to a project or a user", async () => {
      const keys: Array<ForeignKey> = foreignKeys(await runUp());

      expect(keys).toHaveLength(3);
      expect(
        keys.some((key: ForeignKey): boolean => {
          return key.table === "McpOAuthClient";
        }),
      ).toBe(false);
    });

    test("a grant records who, where, which client and what for, all required", async () => {
      const table: string = findCreateTable(await runUp(), "McpOAuthGrant");

      expect(table).toContain(`"projectId" uuid NOT NULL`);
      expect(table).toContain(`"userId" uuid NOT NULL`);
      expect(table).toContain(`"name" character varying(100) NOT NULL`);
      expect(table).toContain(`"clientId" character varying(500) NOT NULL`);
      expect(table).toContain(`"scope" character varying(100) NOT NULL`);
      expect(table).toContain(`"resource" character varying(500) NOT NULL`);
      expect(table).toContain(`"expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL`);
    });

    test("a grant starts pending: activatedAt, lastUsedAt and the SSO evidence are all nullable", async () => {
      const table: string = findCreateTable(await runUp(), "McpOAuthGrant");

      expect(table).toContain(`"activatedAt" TIMESTAMP WITH TIME ZONE,`);
      expect(table).toContain(`"lastUsedAt" TIMESTAMP WITH TIME ZONE,`);
      expect(table).toContain(`"ssoProviderType" character varying(100),`);
      expect(table).toContain(`"ssoProviderId" uuid,`);
      expect(table).toContain(`"ssoExpiresAt" TIMESTAMP WITH TIME ZONE,`);
    });

    test("a client id column is wide enough for a metadata document URL", async () => {
      const table: string = findCreateTable(await runUp(), "McpOAuthGrant");
      const width: RegExpMatchArray | null = table.match(
        CLIENT_ID_WIDTH_PATTERN,
      );

      // ClientIdMetadataDocument.MAX_CLIENT_ID_URL_LENGTH.
      expect(Number(width![1])).toBeGreaterThanOrEqual(500);
    });

    test("a registered client keeps its secret only as a digest, and only if it has one", async () => {
      const table: string = findCreateTable(await runUp(), "McpOAuthClient");

      expect(table).toContain(`"clientSecretHash" character varying(100),`);
      expect(table).not.toMatch(PLAINTEXT_CLIENT_SECRET_COLUMN_PATTERN);
      expect(table).toContain(`"clientName" character varying(100) NOT NULL`);
      expect(table).toContain(`"redirectUris" jsonb NOT NULL`);
      expect(table).toContain(
        `"tokenEndpointAuthMethod" character varying(100) NOT NULL`,
      );
      expect(table).toContain(`"clientUri" character varying(500),`);
      // Swept by it, so every registration has to carry it.
      expect(table).toContain(`"lastUsedAt" TIMESTAMP WITH TIME ZONE NOT NULL`);
    });

    test("indexes what the sweeps and the lookups filter on", async () => {
      const statements: Array<string> = await runUp();

      // The 90-day sweep of unused registrations.
      expect(indexedColumns(statements, "McpOAuthClient")).toEqual([
        "lastUsedAt",
      ]);

      /*
       * Tenant reads (projectId), "my clients" (userId), replacing a client's
       * earlier grants (clientId), and the sweep of expired grants.
       */
      expect(indexedColumns(statements, "McpOAuthGrant")).toEqual([
        "clientId",
        "expiresAt",
        "projectId",
        "userId",
      ]);

      /*
       * The cascade's reverse lookup (mcpOAuthGrantId) and the sweep of
       * expired tokens. tokenHash needs no index of its own: the unique
       * constraint is one.
       */
      expect(indexedColumns(statements, "McpOAuthToken")).toEqual([
        "expiresAt",
        "mcpOAuthGrantId",
      ]);
    });

    test("every table exists before anything references it", async () => {
      const statements: Array<string> = await runUp();

      const createdAt: (table: string) => number = (table: string): number => {
        return statements.findIndex((statement: string): boolean => {
          return statement.startsWith(`CREATE TABLE "${table}" (`);
        });
      };

      statements.forEach((statement: string, index: number): void => {
        const createIndex: RegExpMatchArray | null =
          statement.match(CREATE_INDEX_PATTERN);

        if (createIndex) {
          expect(createdAt(createIndex[2]!)).toBeGreaterThan(-1);
          expect(createdAt(createIndex[2]!)).toBeLessThan(index);
        }

        const addForeignKey: RegExpMatchArray | null = statement.match(
          ADD_FOREIGN_KEY_PATTERN,
        );

        if (addForeignKey) {
          expect(createdAt(addForeignKey[1]!)).toBeLessThan(index);

          // Project and User predate this migration; the grant does not.
          if (TABLES.includes(addForeignKey[4]!)) {
            expect(createdAt(addForeignKey[4]!)).toBeGreaterThan(-1);
            expect(createdAt(addForeignKey[4]!)).toBeLessThan(index);
          }
        }
      });
    });
  });

  describe("down()", () => {
    test("drops every foreign key, index and table that up() created, and nothing else", async () => {
      const up: Array<string> = await runUp();
      const down: Array<string> = await runDown();

      const createdForeignKeys: Array<string> = foreignKeys(up)
        .map((key: ForeignKey): string => {
          return `${key.table}.${key.name}`;
        })
        .sort();

      const droppedForeignKeys: Array<string> = down
        .map((statement: string): string | undefined => {
          const match: RegExpMatchArray | null = statement.match(
            DROP_FOREIGN_KEY_PATTERN,
          );

          return match ? `${match[1]}.${match[2]}` : undefined;
        })
        .filter((key: string | undefined): key is string => {
          return Boolean(key);
        })
        .sort();

      expect(droppedForeignKeys).toEqual(createdForeignKeys);

      const createdIndexes: Array<string> = up
        .map((statement: string): string | undefined => {
          return statement.match(CREATE_INDEX_PATTERN)?.[1];
        })
        .filter((index: string | undefined): index is string => {
          return Boolean(index);
        })
        .sort();

      const droppedIndexes: Array<string> = down
        .map((statement: string): string | undefined => {
          return statement.match(DROP_INDEX_PATTERN)?.[1];
        })
        .filter((index: string | undefined): index is string => {
          return Boolean(index);
        })
        .sort();

      expect(droppedIndexes).toEqual(createdIndexes);
      expect(createdIndexes).toHaveLength(7);

      const droppedTables: Array<string> = down
        .map((statement: string): string | undefined => {
          return statement.match(DROP_TABLE_PATTERN)?.[1];
        })
        .filter((table: string | undefined): table is string => {
          return Boolean(table);
        });

      expect([...droppedTables].sort()).toEqual([...TABLES].sort());

      // Every statement is one of those three kinds.
      expect(down).toHaveLength(
        droppedForeignKeys.length +
          droppedIndexes.length +
          droppedTables.length,
      );
    });

    test("undoes up() in reverse: constraints first, then each table after the tables that depend on it", async () => {
      const down: Array<string> = await runDown();

      const lastForeignKeyDrop: number = down.reduce(
        (last: number, statement: string, index: number): number => {
          return DROP_FOREIGN_KEY_PATTERN.test(statement) ? index : last;
        },
        -1,
      );

      const firstTableDrop: number = down.findIndex(
        (statement: string): boolean => {
          return DROP_TABLE_PATTERN.test(statement);
        },
      );

      // No table is dropped while a foreign key still points at or from it.
      expect(lastForeignKeyDrop).toBeGreaterThan(-1);
      expect(lastForeignKeyDrop).toBeLessThan(firstTableDrop);

      const droppedTables: Array<string> = down
        .map((statement: string): string | undefined => {
          return statement.match(DROP_TABLE_PATTERN)?.[1];
        })
        .filter((table: string | undefined): table is string => {
          return Boolean(table);
        });

      // The token table (which references the grant) goes before the grant.
      expect(droppedTables).toEqual([...TABLES].reverse());
    });

    test("is the exact mirror of up(), statement for statement", async () => {
      expect(await runDown()).toEqual([
        `ALTER TABLE "McpOAuthToken" DROP CONSTRAINT "FK_a848b7f49a863d67799a117b82f"`,
        `ALTER TABLE "McpOAuthGrant" DROP CONSTRAINT "FK_365e6fce03846cfc6d37bda9d4f"`,
        `ALTER TABLE "McpOAuthGrant" DROP CONSTRAINT "FK_67758231559e66bd2ff39175d9e"`,
        `DROP INDEX "public"."IDX_af198aa32ac12d8dc1a2bbf586"`,
        `DROP INDEX "public"."IDX_a848b7f49a863d67799a117b82"`,
        `DROP TABLE "McpOAuthToken"`,
        `DROP INDEX "public"."IDX_707535aed42e89fc694d8098ce"`,
        `DROP INDEX "public"."IDX_3fd8b786511034c33fdaed67dd"`,
        `DROP INDEX "public"."IDX_365e6fce03846cfc6d37bda9d4"`,
        `DROP INDEX "public"."IDX_67758231559e66bd2ff39175d9"`,
        `DROP TABLE "McpOAuthGrant"`,
        `DROP INDEX "public"."IDX_6aacc7ba7ea7c286faf92e9040"`,
        `DROP TABLE "McpOAuthClient"`,
      ]);
    });

    test("an index is dropped before the table it is on", async () => {
      const up: Array<string> = await runUp();
      const down: Array<string> = await runDown();

      for (const statement of up) {
        const createIndex: RegExpMatchArray | null =
          statement.match(CREATE_INDEX_PATTERN);

        if (!createIndex) {
          continue;
        }

        const dropIndexAt: number = down.indexOf(
          `DROP INDEX "public"."${createIndex[1]}"`,
        );
        const dropTableAt: number = down.indexOf(
          `DROP TABLE "${createIndex[2]}"`,
        );

        expect(dropIndexAt).toBeGreaterThan(-1);
        expect(dropIndexAt).toBeLessThan(dropTableAt);
      }
    });
  });

  describe("registration", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );

    test("is registered exactly once, and named for its class", () => {
      expect(
        names.filter((name: string): boolean => {
          return name === "AddMcpOAuthTables1796900000000";
        }),
      ).toHaveLength(1);

      expect(new AddMcpOAuthTables1796900000000().name).toBe(
        "AddMcpOAuthTables1796900000000",
      );
    });

    test("is registered in timestamp order: after every earlier migration, before every later one", () => {
      const index: number = names.indexOf("AddMcpOAuthTables1796900000000");

      /*
       * TypeORM runs migrations in the order of this array. It is NOT pinned
       * as the last entry, nor as the one right after its current neighbour:
       * the next migration anyone adds goes after it (or, from a branch cut
       * earlier, just before it), and neither must fail this test.
       */
      expect(index).toBeGreaterThan(
        names.indexOf("FoldAiSwitchesIntoEnableAi1796800000000"),
      );

      const timestampOf: (name: string) => number = (name: string): number => {
        const match: RegExpMatchArray | null = name.match(
          MIGRATION_TIMESTAMP_PATTERN,
        );

        return match ? Number(match[1]) : 0;
      };

      for (const earlier of names.slice(0, index)) {
        expect(timestampOf(earlier)).toBeLessThan(1796900000000);
      }

      for (const later of names.slice(index + 1)) {
        expect(timestampOf(later)).toBeGreaterThan(1796900000000);
      }
    });
  });
});
