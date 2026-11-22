import { AddSecurityBlocklistFeeds1809187430000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187430000-AddSecurityBlocklistFeeds";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import SecurityBlocklistFeed from "../../../../Models/DatabaseModels/SecurityBlocklistFeed";
import SecurityBlocklistFeedFetch from "../../../../Models/DatabaseModels/SecurityBlocklistFeedFetch";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";

/*
 * The migration behind blocklist feeds (#10345): SecurityBlocklistFeed, a
 * secret URL a firewall reads the project's blocklist from, and
 * SecurityBlocklistFeedFetch, every fetch of one, kept 30 days.
 *
 * The SQL is generated, and the schema-drift check (npm run
 * check-postgres-schema-drift, and CI's Postgres Schema Drift job) proves it
 * matches the models. This pins what a regeneration could silently reverse,
 * which no functional test would notice:
 *
 *  1. A FEED KEEPS ITS SECRETS ONLY AS HASHES: the two secret columns are
 *     hashed strings nobody reads, and no other column holds a secret.
 *  2. A NEW FEED IS FOR ANY FIREWALL AND SERVES BOTH FAMILIES until someone
 *     says otherwise; a fetch is unchanged and made with the current secret
 *     unless it says otherwise.
 *  3. A FEED'S FETCHES ARE READ LATEST FIRST, AND PURGED BY AGE, through
 *     the indexes the models declare.
 *  4. A FEED GOES WITH ITS PROJECT, AND ITS FETCHES WITH THE FEED.
 *  5. Both tables are new, so their indexes and keys are made on empty
 *     tables, with no online DDL, and no table that holds data is touched.
 *  6. down() undoes up() in reverse, and the migration runs after every
 *     migration before it.
 */

const CLASS_NAME: string = "AddSecurityBlocklistFeeds1809187430000";
const TIMESTAMP: number = 1809187430000;

const FEED_TABLE: string = "SecurityBlocklistFeed";
const FETCH_TABLE: string = "SecurityBlocklistFeedFetch";

// A migration class's stamp, at the end of its name.
const STAMP: RegExp = /(\d{13})$/;

// The table an ALTER TABLE statement changes.
const ALTERED_TABLE: RegExp = /^ALTER TABLE "([^"]+)"/;

// A column of a CREATE TABLE: its name, then what follows it.
const COLUMN: RegExp = /^"([^"]+)" (.+)$/;

// Where one column of a CREATE TABLE ends and the next begins.
const NEXT_COLUMN: RegExp = /, (?=")/;

type MigrationClass = new () => MigrationInterface;

async function recordQueries(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement.trim());
    },
  } as unknown as QueryRunner;

  await new AddSecurityBlocklistFeeds1809187430000()[direction](queryRunner);

  return statements;
}

function createTableOf(statements: Array<string>, table: string): string {
  const found: string | undefined = statements.find((text: string) => {
    return text.startsWith(`CREATE TABLE "${table}" (`);
  });

  if (!found) {
    throw new Error(`up() does not create ${table}.`);
  }

  return found;
}

// The columns a CREATE TABLE makes, by name, with what follows each name.
function columnsOf(createTable: string): Map<string, string> {
  const body: string = createTable.slice(
    createTable.indexOf("(") + 1,
    createTable.indexOf(", CONSTRAINT"),
  );

  const columns: Map<string, string> = new Map();

  for (const part of body.split(NEXT_COLUMN)) {
    const match: RegExpMatchArray | null = part.match(COLUMN);

    if (match) {
      columns.set(match[1] as string, match[2] as string);
    }
  }

  return columns;
}

// The model's columns, with those every model has from the classes it extends (_id, createdAt...).
function declaredColumns(model: unknown): Array<string> {
  const classes: Array<unknown> = [];

  for (
    let current: unknown = model;
    typeof current === "function" && current !== Function.prototype;
    current = Object.getPrototypeOf(current)
  ) {
    classes.push(current);
  }

  return getMetadataArgsStorage()
    .columns.filter((column: ColumnMetadataArgs): boolean => {
      return classes.includes(column.target);
    })
    .map((column: ColumnMetadataArgs): string => {
      return column.propertyName;
    });
}

// The model's own indexes (@Index on the class).
function declaredIndexes(model: unknown): Array<{
  columns: Array<string>;
  unique: boolean;
}> {
  return getMetadataArgsStorage()
    .indices.filter((index: IndexMetadataArgs): boolean => {
      return index.target === model && Array.isArray(index.columns);
    })
    .map((index: IndexMetadataArgs) => {
      return {
        columns: index.columns as Array<string>,
        unique: Boolean(index.unique),
      };
    });
}

function indexStatement(
  statements: Array<string>,
  table: string,
  columns: Array<string>,
): string | undefined {
  const onColumns: string = `ON "${table}" (${columns
    .map((column: string): string => {
      return `"${column}"`;
    })
    .join(", ")})`;

  return statements.find((text: string): boolean => {
    return (
      (text.startsWith("CREATE INDEX") ||
        text.startsWith("CREATE UNIQUE INDEX")) &&
      text.includes(onColumns)
    );
  });
}

function foreignKeyOf(
  statements: Array<string>,
  table: string,
  column: string,
): string {
  const found: string | undefined = statements.find((text: string) => {
    return (
      text.startsWith(`ALTER TABLE "${table}" ADD CONSTRAINT`) &&
      text.includes(`FOREIGN KEY ("${column}")`)
    );
  });

  if (!found) {
    throw new Error(`up() adds no key on ${table}.${column}.`);
  }

  return found;
}

describe("AddSecurityBlocklistFeeds migration - identity and registration", () => {
  test("its class, name and stamp agree", () => {
    expect(new AddSecurityBlocklistFeeds1809187430000().name).toBe(CLASS_NAME);
    expect(AddSecurityBlocklistFeeds1809187430000.name).toBe(CLASS_NAME);
  });

  test("is registered once, after every migration before it", () => {
    const names: Array<string> = (
      SchemaMigrations as unknown as Array<MigrationClass>
    ).map((migration: MigrationClass): string => {
      return migration.name;
    });

    const index: number = names.indexOf(CLASS_NAME);

    expect(index).toBeGreaterThan(-1);
    expect(names.lastIndexOf(CLASS_NAME)).toBe(index);

    for (const earlier of names.slice(0, index)) {
      const stamp: number = Number(STAMP.exec(earlier)?.[1] || 0);
      expect(stamp).toBeLessThan(TIMESTAMP);
    }
  });
});

describe("AddSecurityBlocklistFeeds migration - what it makes", () => {
  test("each table has every column its model declares, and none it does not", async () => {
    const up: Array<string> = await recordQueries("up");

    for (const [table, model] of [
      [FEED_TABLE, SecurityBlocklistFeed],
      [FETCH_TABLE, SecurityBlocklistFeedFetch],
    ] as Array<[string, unknown]>) {
      expect([
        table,
        [...columnsOf(createTableOf(up, table)).keys()].sort(),
      ]).toEqual([table, declaredColumns(model).sort()]);
    }
  });

  test("a feed keeps its secret, and the one a rotation replaced, only as hashes", async () => {
    const up: Array<string> = await recordQueries("up");
    const columns: Map<string, string> = columnsOf(
      createTableOf(up, FEED_TABLE),
    );

    /*
     * Hashed by its service as ApiKey's key is (written already hashed),
     * and read by nobody through the API.
     */
    const model: SecurityBlocklistFeed = new SecurityBlocklistFeed();
    for (const column of ["secret", "previousSecret"]) {
      expect([column, model.getTableColumnMetadata(column).type]).toEqual([
        column,
        TableColumnType.HashedString,
      ]);
      expect([column, model.getColumnAccessControlFor(column)?.read]).toEqual([
        column,
        [],
      ]);
    }
    expect(model.getTableColumnMetadata("secret").shownOnce).toBe(true);
    // Room for a hash, and empty once the secrets are revoked.
    expect(columns.get("secret")).toBe("character varying(255)");
    expect(columns.get("previousSecret")).toBe("character varying(255)");

    // The others that name a secret say of it what is safe to show.
    expect(
      [...columns.keys()].filter((column: string): boolean => {
        return column.toLowerCase().includes("secret");
      }),
    ).toEqual([
      "secret",
      "secretHint",
      "secretMadeAt",
      "previousSecret",
      "previousSecretExpiresAt",
    ]);
    expect(columns.get("secretHint")).toBe("character varying(100)");
  });

  test("a new feed is for any firewall and serves both families; its allowlist and what it served are open-ended", async () => {
    const up: Array<string> = await recordQueries("up");
    const columns: Map<string, string> = columnsOf(
      createTableOf(up, FEED_TABLE),
    );

    expect(columns.get("name")).toBe("character varying(100) NOT NULL");
    expect(columns.get("firewall")).toBe(
      "character varying(100) NOT NULL DEFAULT 'Other'",
    );
    expect(columns.get("family")).toBe(
      "character varying(100) NOT NULL DEFAULT 'Both'",
    );
    // Up to 50 addresses and ranges, one a line: no length to cut one off at.
    expect(columns.get("allowedSourceAddresses")).toBe("text");
    // What the firewall last fetched: as many entries as the blocklist holds.
    expect(columns.get("servedValues")).toBe("jsonb");
    expect(columns.get("servedConfirmedAt")).toBe("TIMESTAMP WITH TIME ZONE");
    expect(columns.get("lastFetchedAt")).toBe("TIMESTAMP WITH TIME ZONE");
    expect(columns.get("stoppedReadingToldAt")).toBe(
      "TIMESTAMP WITH TIME ZONE",
    );
  });

  test("a fetch belongs to its feed, and is unchanged and made with the current secret unless it says otherwise", async () => {
    const up: Array<string> = await recordQueries("up");
    const columns: Map<string, string> = columnsOf(
      createTableOf(up, FETCH_TABLE),
    );

    expect(columns.get("securityBlocklistFeedId")).toBe("uuid NOT NULL");
    expect(columns.get("fetchedAt")).toBe("TIMESTAMP WITH TIME ZONE NOT NULL");
    expect(columns.get("isChanged")).toBe("boolean NOT NULL DEFAULT false");
    expect(columns.get("usedPreviousSecret")).toBe(
      "boolean NOT NULL DEFAULT false",
    );
    expect(columns.get("userAgent")).toBe("character varying(500)");
  });

  test("a feed's fetches are read latest first and purged by age, through the indexes the models declare", async () => {
    const up: Array<string> = await recordQueries("up");

    expect(
      indexStatement(up, FETCH_TABLE, ["securityBlocklistFeedId", "fetchedAt"]),
    ).toBeDefined();
    expect(indexStatement(up, FETCH_TABLE, ["fetchedAt"])).toBeDefined();

    for (const [table, model] of [
      [FEED_TABLE, SecurityBlocklistFeed],
      [FETCH_TABLE, SecurityBlocklistFeedFetch],
    ] as Array<[string, unknown]>) {
      for (const index of declaredIndexes(model)) {
        const made: string | undefined = indexStatement(
          up,
          table,
          index.columns,
        );

        expect([table, index.columns, Boolean(made)]).toEqual([
          table,
          index.columns,
          true,
        ]);
        expect(made!.startsWith("CREATE UNIQUE INDEX")).toBe(index.unique);
      }
    }
  });

  test("a feed goes with its project, and its fetches with the feed", async () => {
    const up: Array<string> = await recordQueries("up");

    expect(foreignKeyOf(up, FEED_TABLE, "projectId")).toContain(
      `REFERENCES "Project"("_id") ON DELETE CASCADE`,
    );
    expect(foreignKeyOf(up, FETCH_TABLE, "projectId")).toContain(
      `REFERENCES "Project"("_id") ON DELETE CASCADE`,
    );
    expect(foreignKeyOf(up, FETCH_TABLE, "securityBlocklistFeedId")).toContain(
      `REFERENCES "SecurityBlocklistFeed"("_id") ON DELETE CASCADE`,
    );
  });

  test("touches no table that holds data: indexes and keys on its two new tables only, made with them", async () => {
    const up: Array<string> = await recordQueries("up");

    for (const text of up) {
      if (
        text.startsWith("CREATE INDEX") ||
        text.startsWith("CREATE UNIQUE INDEX")
      ) {
        expect(text).toMatch(
          /ON "(SecurityBlocklistFeed|SecurityBlocklistFeedFetch)" /,
        );
        // Built with the empty table, in the migration's transaction.
        expect(text).not.toContain("CONCURRENTLY");
      }

      if (text.startsWith("ALTER TABLE")) {
        expect(text).toMatch(
          /^ALTER TABLE "(SecurityBlocklistFeed|SecurityBlocklistFeedFetch)" ADD CONSTRAINT/,
        );
      }

      expect(text).not.toMatch(/^(DROP|UPDATE|DELETE|INSERT)\b/);
    }
  });
});

describe("AddSecurityBlocklistFeeds migration - down()", () => {
  test("drops every key and index up() made, then the fetches' table before the feeds'", async () => {
    const up: Array<string> = await recordQueries("up");
    const down: Array<string> = await recordQueries("down");

    const constraintName: RegExp = /ADD CONSTRAINT "([^"]+)"/;
    const indexName: RegExp = /INDEX "([^"]+)"/;

    for (const text of up) {
      const key: string | undefined = constraintName.exec(text)?.[1];

      if (key) {
        const table: string = ALTERED_TABLE.exec(text)![1]!;
        expect(down).toContain(
          `ALTER TABLE "${table}" DROP CONSTRAINT "${key}"`,
        );
      }

      const index: string | undefined = text.startsWith("CREATE")
        ? indexName.exec(text)?.[1]
        : undefined;

      if (index) {
        expect(down).toContain(`DROP INDEX "public"."${index}"`);
      }
    }

    const lastKey: number = Math.max(
      ...down
        .map((text: string, at: number): number => {
          return text.includes("DROP CONSTRAINT") ? at : -1;
        })
        .filter((at: number): boolean => {
          return at >= 0;
        }),
    );
    const fetchesDropped: number = down.indexOf(`DROP TABLE "${FETCH_TABLE}"`);
    const feedsDropped: number = down.indexOf(`DROP TABLE "${FEED_TABLE}"`);

    expect(fetchesDropped).toBeGreaterThan(lastKey);
    expect(feedsDropped).toBeGreaterThan(fetchesDropped);
    expect(down[down.length - 1]).toBe(`DROP TABLE "${FEED_TABLE}"`);
  });

  test("runs as many statements as up(), one undoing each", async () => {
    const up: Array<string> = await recordQueries("up");
    const down: Array<string> = await recordQueries("down");

    expect(down).toHaveLength(up.length);
  });
});
