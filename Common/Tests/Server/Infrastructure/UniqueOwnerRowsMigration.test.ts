import { UniqueOwnerRows1787729350313 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1787729350313-UniqueOwnerRows";
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
  const migration: UniqueOwnerRows1787729350313 =
    new UniqueOwnerRows1787729350313();

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
    expect(SchemaMigrations).toContain(UniqueOwnerRows1787729350313);
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
      const repairedEarlier: boolean = up
        .slice(0, index)
        .some((earlier: string) => {
          return (
            earlier.includes(`FROM "${table}"`) &&
            earlier.includes(`UPDATE "${table}"`) &&
            earlier.includes(`SET "deletedAt" = CURRENT_TIMESTAMP`)
          );
        });

      if (!repairedEarlier) {
        offenders.push(
          `${table}: unique index built with no preceding soft-delete repair`,
        );
      }
    });

    expect(offenders).toEqual([]);
  });

  it("builds every unique index as PARTIAL on deletedAt IS NULL", async () => {
    /*
     * House convention (see migration 1786200000000): an unqualified unique
     * index lets a soft-deleted row hold the tuple hostage -- remove an
     * owner whose ghost row exists and it can never be re-added. Partial on
     * live rows matches how every app query reads, and lets the repair be
     * non-destructive.
     */
    const { up }: CapturedSql = await captureSql();

    const offenders: Array<string> = up.filter((sql: string) => {
      return (
        sql.includes("CREATE UNIQUE INDEX") &&
        !sql.includes(`WHERE "deletedAt" IS NULL`)
      );
    });

    expect(offenders).toEqual([]);
  });

  it("repairs only live rows and never hard-deletes", async () => {
    const { up }: CapturedSql = await captureSql();

    const repairs: Array<string> = up.filter((sql: string) => {
      return sql.includes(`SET "deletedAt" = CURRENT_TIMESTAMP`);
    });

    // One repair per owner table.
    expect(repairs.length).toBe(66);

    for (const sql of repairs) {
      // Ranked over live rows only: pre-existing ghosts stay untouched.
      expect(sql).toContain(`WHERE "deletedAt" IS NULL`);
    }

    const hardDeletes: Array<string> = up.filter((sql: string) => {
      return sql.includes("DELETE FROM");
    });

    expect(hardDeletes).toEqual([]);
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

  it("restores each plain index in down() with the entity's column order", async () => {
    /*
     * TypeORM generated down()'s restore statements with their columns
     * REVERSED. The restored plain composite and the partial unique both
     * derive from the same entity tuple (resourceId, ownerId, projectId),
     * so match by TABLE -- matching by index name would be vacuous here,
     * since the partial unique hashes to a different name than the plain
     * composite it replaced.
     */
    const { up, down }: CapturedSql = await captureSql();

    const upColumnsByTable: Map<string, string> = new Map<string, string>();

    for (const sql of up) {
      const match: RegExpMatchArray | null = sql.match(INDEX_STATEMENT);
      if (match && sql.includes("CREATE UNIQUE INDEX")) {
        upColumnsByTable.set(match[2]!, match[3]!.trim());
      }
    }

    const offenders: Array<string> = [];
    let restoredCount: number = 0;

    for (const sql of down) {
      const match: RegExpMatchArray | null = sql.match(INDEX_STATEMENT);

      if (!match || sql.includes("CREATE UNIQUE INDEX")) {
        continue;
      }

      restoredCount += 1;

      const table: string = match[2]!;
      const restored: string = match[3]!.trim();
      const entityOrder: string | undefined = upColumnsByTable.get(table);

      if (entityOrder && restored !== entityOrder) {
        offenders.push(
          `${table}: down() restores (${restored}) but the entity tuple is (${entityOrder})`,
        );
      }
    }

    // The 30 tables that had a plain composite before this migration.
    expect(restoredCount).toBe(30);
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
