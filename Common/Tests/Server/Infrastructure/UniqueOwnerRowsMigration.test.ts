import { UniqueOwnerRows1787725772959 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1787725772959-UniqueOwnerRows";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { QueryRunner } from "typeorm";
import { describe, expect, it } from "@jest/globals";

/*
 * Issue #3394: the migration that makes owner rows unique in Postgres.
 *
 * Two defects in the generated migration were caught only by running it
 * against a real filled database. Both are cheap to pin here, and both put
 * users in a bad place if they come back:
 *
 *   1. The generator emits schema DDL and nothing else. On any database that
 *      already accumulated duplicates -- exactly the population this change
 *      exists to fix -- `CREATE UNIQUE INDEX` aborts with "could not create
 *      unique index" and the deployment cannot migrate at all. Every unique
 *      index therefore needs its collapsing DELETE to run first.
 *
 *   2. TypeORM wrote down()'s restored indexes with their columns REVERSED:
 *      ("projectId", "teamId", "incidentId") where the original was
 *      ("incidentId", "teamId", "projectId"). A btree only serves a leading
 *      column prefix, so that is not a rollback -- it silently drops the
 *      lookups the original index served, with no error to notice.
 *
 * Pure SQL capture against a mock QueryRunner. No Postgres connection.
 */

interface CapturedSql {
  up: Array<string>;
  down: Array<string>;
}

async function captureSql(): Promise<CapturedSql> {
  const migration: UniqueOwnerRows1787725772959 =
    new UniqueOwnerRows1787725772959();

  const up: Array<string> = [];
  const down: Array<string> = [];

  await migration.up({
    query: (sql: string) => {
      up.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  await migration.down({
    query: (sql: string) => {
      down.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return { up, down };
}

/** `CREATE [UNIQUE] INDEX "name" ON "Table" (cols)` -> [name, table, cols]. */
const INDEX_STATEMENT: RegExp =
  /CREATE (?:UNIQUE )?INDEX "([^"]+)" ON "([^"]+)" \(([^)]*)\)/;

describe("UniqueOwnerRows migration", () => {
  it("is registered, so it actually runs on startup", () => {
    expect(SchemaMigrations).toContain(UniqueOwnerRows1787725772959);
  });

  it("collapses duplicates before building each unique index", async () => {
    const { up }: CapturedSql = await captureSql();

    const offenders: Array<string> = [];

    up.forEach((sql: string, index: number) => {
      if (!sql.includes("CREATE UNIQUE INDEX")) {
        return;
      }

      const match: RegExpMatchArray | null = sql.match(INDEX_STATEMENT);

      if (!match) {
        offenders.push(`unparseable statement: ${sql}`);
        return;
      }

      const table: string = match[2]!;

      /*
       * The DELETE has to come EARLIER in up() than the index build, or the
       * index is built while the duplicates are still there and the whole
       * migration aborts.
       */
      const dedupedEarlier: boolean = up
        .slice(0, index)
        .some((earlier: string) => {
          return (
            earlier.startsWith(`DELETE FROM "${table}"`) &&
            earlier.includes(`USING "${table}"`)
          );
        });

      if (!dedupedEarlier) {
        offenders.push(`${table}: unique index built with no preceding DELETE`);
      }
    });

    expect(offenders).toEqual([]);
  });

  it("covers every owner table it indexes", async () => {
    const { up }: CapturedSql = await captureSql();

    const indexedTables: Set<string> = new Set<string>();

    for (const sql of up) {
      if (!sql.includes("CREATE UNIQUE INDEX")) {
        continue;
      }
      const match: RegExpMatchArray | null = sql.match(INDEX_STATEMENT);
      if (match) {
        indexedTables.add(match[2]!);
      }
    }

    // 33 resources x (team, user).
    expect(indexedTables.size).toBe(66);
  });

  it("restores each index in down() with the SAME column order as up()", async () => {
    const { up, down }: CapturedSql = await captureSql();

    const upColumns: Map<string, string> = new Map<string, string>();

    for (const sql of up) {
      const match: RegExpMatchArray | null = sql.match(INDEX_STATEMENT);
      if (match && sql.includes("CREATE UNIQUE INDEX")) {
        upColumns.set(match[1]!, match[3]!.trim());
      }
    }

    const offenders: Array<string> = [];

    for (const sql of down) {
      const match: RegExpMatchArray | null = sql.match(INDEX_STATEMENT);

      if (!match || !sql.includes("CREATE INDEX")) {
        continue;
      }

      const name: string = match[1]!;
      const restored: string = match[3]!.trim();
      const original: string | undefined = upColumns.get(name);

      if (original && restored !== original) {
        offenders.push(
          `${match[2]}: down() restores (${restored}) but the index is (${original})`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });

  it("drops in down() every unique index it created in up()", async () => {
    const { up, down }: CapturedSql = await captureSql();

    const created: Array<string> = up
      .filter((sql: string) => {
        return sql.includes("CREATE UNIQUE INDEX");
      })
      .map((sql: string) => {
        return sql.match(INDEX_STATEMENT)![1]!;
      });

    const dropped: Set<string> = new Set<string>(
      down
        .filter((sql: string) => {
          return sql.includes("DROP INDEX");
        })
        .map((sql: string) => {
          return sql.match(/DROP INDEX "public"\."([^"]+)"/)?.[1] ?? "";
        }),
    );

    const notDropped: Array<string> = created.filter((name: string) => {
      return !dropped.has(name);
    });

    expect(notDropped).toEqual([]);
  });
});
