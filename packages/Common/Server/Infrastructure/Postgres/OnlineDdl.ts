import { PostgresMigrationLockTimeoutMs } from "../../EnvironmentConfig";
import logger from "../../Utils/Logger";
import Sleep from "../../../Types/Sleep";
import { QueryRunner } from "typeorm";

/*
 * Index builds and foreign keys on tables that already hold data, without
 * blocking the app's writes to them.
 *
 * WHY
 *
 * What `npm run generate-postgres-migration` writes blocks writers for as long
 * as the statement scans the table:
 *
 *   CREATE INDEX "IDX_..." ON "Monitor" (...)
 *     holds SHARE on "Monitor" for the whole build;
 *   ALTER TABLE "Monitor" ADD CONSTRAINT "FK_..." FOREIGN KEY (...) REFERENCES "User"(...)
 *     holds SHARE ROW EXCLUSIVE on "Monitor" AND "User" while it checks every
 *     row of "Monitor".
 *
 * and a migration keeps every lock it took until it commits. On an empty
 * table that is nothing; on "Monitor", which every probe result, heartbeat and
 * cron tick writes, it is an outage for as long as the scan takes.
 * SchemaMigrationRunner bounds how long a migration WAITS for a lock; this is
 * for how long it HOLDS one.
 *
 * HOW
 *
 *   createIndex   CREATE INDEX CONCURRENTLY IF NOT EXISTS: SHARE UPDATE
 *                 EXCLUSIVE, which no read or write conflicts with.
 *   addForeignKey ADD CONSTRAINT ... NOT VALID (a brief SHARE ROW EXCLUSIVE,
 *                 no scan, new rows checked from then on), then VALIDATE
 *                 CONSTRAINT in a transaction of its own: SHARE UPDATE
 *                 EXCLUSIVE on the table, ROW SHARE on the one it references.
 *
 * Both take the statement exactly as the generator wrote it, so the names and
 * definitions - which the schema drift check compares - are the generated
 * ones. Neither can share a transaction with the statement before it (the
 * build cannot run in one at all, and a VALIDATE inside the ADD's transaction
 * would scan under the ADD's lock), so they need a migration with
 * `transaction = false`, and refuse to run inside a transaction.
 *
 * Their long step gets its own bounds (ONLINE_DDL_LIMITS): a statement_timeout
 * long enough for a large table, a lock wait long enough to outlast ordinary
 * transactions - waiting here holds up no read or write - and a client-side
 * timeout past both, since node-postgres gives up after
 * DATABASE_QUERY_TIMEOUT_MS (35 s) on its own clock otherwise. The
 * connection's own settings come back afterwards (`SET ... = DEFAULT`; under
 * SchemaMigrationRunner its lock_timeout is a startup parameter, so DEFAULT is
 * the migration bound again).
 *
 * Both are safe to run again from the start - a migration without a
 * transaction is not rolled back when it fails, and SchemaMigrationRunner
 * retries one that runs out of lock wait:
 *
 *   - an index already valid, or a constraint already validated, is left as
 *     it is;
 *   - an INVALID index a stopped build left behind is dropped and built
 *     again; one still being built is waited for;
 *   - a constraint added NOT VALID earlier is validated.
 *
 * A build or validation that fails fails the migration (the index or the
 * constraint is part of the schema the entities declare). A leftover INVALID
 * index is dropped first, and so is a foreign key whose existing rows violate
 * it, so the table is as it was before the migration.
 *
 * USE
 *
 * Move the statements on tables that already exist out of the generated
 * migration into one of their own:
 *
 *   export class AddMonitorFooIndexes1799000000000 implements MigrationInterface {
 *     public name: string = "AddMonitorFooIndexes1799000000000";
 *
 *     // CREATE INDEX CONCURRENTLY cannot run inside a transaction.
 *     public transaction: boolean = false;
 *
 *     public async up(queryRunner: QueryRunner): Promise<void> {
 *       await OnlineDdl.createIndex(
 *         queryRunner,
 *         `CREATE INDEX "IDX_..." ON "Monitor" ("projectId", "fooId") `,
 *       );
 *       await OnlineDdl.addForeignKey(
 *         queryRunner,
 *         `ALTER TABLE "Monitor" ADD CONSTRAINT "FK_..." FOREIGN KEY ("fooId") REFERENCES "Foo"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
 *       );
 *     }
 *
 *     public async down(queryRunner: QueryRunner): Promise<void> {
 *       await queryRunner.query(`ALTER TABLE "Monitor" DROP CONSTRAINT "FK_..."`);
 *       await OnlineDdl.dropIndex(queryRunner, `DROP INDEX "public"."IDX_..."`);
 *     }
 *   }
 *
 * The rest of the generated migration (the new column, say) stays an ordinary
 * one, registered before it. SchemaMigrationsOnlineDdl.test.ts fails a new
 * migration that builds an index or validates a foreign key on an existing
 * table any other way.
 */

export interface OnlineDdlLimits {
  /* statement_timeout of an index build or a constraint validation. */
  statementTimeoutInMs: number;
  /*
   * lock_timeout of the same. An online build also waits out every
   * transaction older than it (a backup holding a snapshot, say); this bounds
   * those waits too.
   */
  lockTimeoutInMs: number;
  /*
   * How much longer than statementTimeoutInMs the client waits for an
   * answer, so that Postgres, not the client, ends an overlong statement:
   * only then is it really stopped, and its error reported.
   */
  clientTimeoutMarginInMs: number;
  /* How often a build already in progress is looked at again. */
  buildPollIntervalInMs: number;
}

export const ONLINE_DDL_LIMITS: OnlineDdlLimits = {
  statementTimeoutInMs: 30 * 60 * 1000,
  lockTimeoutInMs: 5 * 60 * 1000,
  clientTimeoutMarginInMs: 60 * 1000,
  buildPollIntervalInMs: 5 * 1000,
};

/* Postgres error codes this module acts on. */
const FOREIGN_KEY_VIOLATION: string = "23503";

/* A quoted identifier, as the generator writes them: "Monitor", "a""b". */
const QUOTED: string = `"(?:[^"]|"")+"`;
/* A table, optionally schema-qualified: "Monitor", "public"."Monitor". */
const QUOTED_TABLE: string = `(?:${QUOTED}\\.)?${QUOTED}`;

const CREATE_INDEX: RegExp = new RegExp(
  `^\\s*CREATE\\s+(UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QUOTED})\\s+ON\\s+(?:ONLY\\s+)?(${QUOTED_TABLE})\\s*([\\s\\S]*?)\\s*;?\\s*$`,
  "i",
);

const DROP_INDEX: RegExp = new RegExp(
  `^\\s*DROP\\s+INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+EXISTS\\s+)?(${QUOTED_TABLE})\\s*;?\\s*$`,
  "i",
);

const ADD_FOREIGN_KEY: RegExp = new RegExp(
  `^\\s*ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(${QUOTED_TABLE})\\s+ADD\\s+CONSTRAINT\\s+(${QUOTED})\\s+(FOREIGN\\s+KEY\\b[\\s\\S]*?)(?:\\s+NOT\\s+VALID)?\\s*;?\\s*$`,
  "i",
);

export interface OnlineIndex {
  /* As written: "IDX_...". */
  quotedName: string;
  /* As written: "Monitor" or "public"."Monitor". */
  quotedTable: string;
  /* Without quotes, as pg_class names it. */
  name: string;
  /* The online statement that builds it. */
  build: string;
}

export interface OnlineForeignKey {
  quotedTable: string;
  quotedName: string;
  name: string;
  /* The constraint added without checking existing rows. */
  addNotValid: string;
  /* The check of the existing rows. */
  validate: string;
}

type IndexState = "missing" | "valid" | "invalid" | "building";

interface IndexRow {
  isValid: boolean;
  isBuilding: boolean;
  regclass: string;
}

/*
 * node-postgres takes a per-statement client timeout (query_timeout) in a
 * query config; TypeORM's QueryRunner.query cannot pass one.
 */
interface PostgresClient {
  query(config: { text: string; query_timeout: number }): Promise<unknown>;
}

export default class OnlineDdl {
  /*
   * Builds the index a generated `CREATE [UNIQUE] INDEX` statement describes,
   * with CREATE INDEX CONCURRENTLY. Needs `transaction = false`.
   */
  public static async createIndex(
    queryRunner: QueryRunner,
    createIndexStatement: string,
    limits: OnlineDdlLimits = ONLINE_DDL_LIMITS,
  ): Promise<void> {
    const index: OnlineIndex = this.parseCreateIndex(createIndexStatement);

    this.assertNoTransaction(queryRunner, index.build);

    let state: IndexState = await this.getIndexState(queryRunner, index);

    if (state === "building") {
      state = await this.waitWhileBuilding(queryRunner, index, limits);
    }

    if (state === "valid") {
      return;
    }

    if (state === "invalid") {
      await this.dropInvalidIndex(queryRunner, index, limits);
    }

    logger.info(
      `Building ${index.quotedName} on ${index.quotedTable} online (CREATE INDEX CONCURRENTLY); reads and writes of the table carry on meanwhile.`,
    );

    try {
      await this.runWithLimits(queryRunner, index.build, limits);
    } catch (error) {
      const after: IndexState = await this.getIndexState(queryRunner, index);

      if (after === "valid") {
        // The client stopped waiting, but the build finished.
        return;
      }

      if (after === "invalid") {
        await this.dropInvalidIndex(queryRunner, index, limits).catch(
          (dropError: unknown) => {
            logger.warn(
              `Could not drop the INVALID ${index.quotedName} a stopped build left: ${this.getErrorMessage(
                dropError,
              )}. The next run drops it before building again.`,
            );
          },
        );
      }

      throw error;
    }

    if ((await this.getIndexState(queryRunner, index)) !== "valid") {
      throw new Error(
        `${index.build} completed, but ${index.quotedTable} has no valid index ${index.quotedName}: an index of that name on another table makes IF NOT EXISTS skip the build.`,
      );
    }
  }

  /*
   * Drops the index a generated `DROP INDEX` statement names: CONCURRENTLY
   * outside a transaction. TypeORM reverts a migration inside a transaction
   * whatever its `transaction` says, and there a plain DROP INDEX - ACCESS
   * EXCLUSIVE on the table, for an instant - waits at most the migration lock
   * wait, so it never parks the table's readers behind itself for long.
   */
  public static async dropIndex(
    queryRunner: QueryRunner,
    dropIndexStatement: string,
    limits: OnlineDdlLimits = ONLINE_DDL_LIMITS,
  ): Promise<void> {
    const match: RegExpMatchArray | null = dropIndexStatement.match(DROP_INDEX);

    if (!match || !match[1]) {
      throw new Error(
        `OnlineDdl.dropIndex expects a DROP INDEX statement as the generator writes it, got: ${dropIndexStatement}`,
      );
    }

    const quotedName: string = match[1];

    if (!queryRunner.isTransactionActive) {
      await this.runWithLimits(
        queryRunner,
        `DROP INDEX CONCURRENTLY IF EXISTS ${quotedName}`,
        limits,
      );
      return;
    }

    if (PostgresMigrationLockTimeoutMs > 0) {
      await queryRunner.query(
        `SET LOCAL lock_timeout = ${PostgresMigrationLockTimeoutMs}`,
      );
    }

    await queryRunner.query(`DROP INDEX IF EXISTS ${quotedName}`);
  }

  /*
   * Adds the foreign key a generated `ALTER TABLE ... ADD CONSTRAINT ...
   * FOREIGN KEY` statement describes, NOT VALID, then validates it in a
   * transaction of its own. Needs `transaction = false`.
   */
  public static async addForeignKey(
    queryRunner: QueryRunner,
    addForeignKeyStatement: string,
    limits: OnlineDdlLimits = ONLINE_DDL_LIMITS,
  ): Promise<void> {
    const foreignKey: OnlineForeignKey = this.parseAddForeignKey(
      addForeignKeyStatement,
    );

    this.assertNoTransaction(queryRunner, foreignKey.validate);

    const isValidated: boolean | null = await this.getForeignKeyState(
      queryRunner,
      foreignKey,
    );

    if (isValidated === true) {
      return;
    }

    if (isValidated === null) {
      /*
       * Its own transaction (autocommit): SHARE ROW EXCLUSIVE on both tables
       * for an instant, the wait for it bounded by the connection's
       * lock_timeout.
       */
      await queryRunner.query(foreignKey.addNotValid);
    }

    logger.info(
      `Validating ${foreignKey.quotedName} on ${foreignKey.quotedTable} online (VALIDATE CONSTRAINT); reads and writes of both tables carry on meanwhile.`,
    );

    try {
      await this.runWithLimits(queryRunner, foreignKey.validate, limits);
    } catch (error) {
      if (this.getErrorCode(error) !== FOREIGN_KEY_VIOLATION) {
        /*
         * A lock wait or a timeout: the constraint stays NOT VALID - it
         * already checks every new row - and the next run validates it.
         */
        throw error;
      }

      await queryRunner
        .query(
          `ALTER TABLE ${foreignKey.quotedTable} DROP CONSTRAINT IF EXISTS ${foreignKey.quotedName}`,
        )
        .catch((dropError: unknown) => {
          logger.warn(
            `Could not drop ${foreignKey.quotedName} after its validation failed: ${this.getErrorMessage(
              dropError,
            )}. It stays NOT VALID: new rows are checked, existing ones are not.`,
          );
        });

      throw new Error(
        `Rows of ${foreignKey.quotedTable} violate ${foreignKey.quotedName}, so it was not added: ${this.getErrorMessage(
          error,
        )}`,
      );
    }
  }

  public static parseCreateIndex(createIndexStatement: string): OnlineIndex {
    const match: RegExpMatchArray | null =
      createIndexStatement.match(CREATE_INDEX);

    if (!match || !match[2] || !match[3]) {
      throw new Error(
        `OnlineDdl.createIndex expects a CREATE INDEX statement as the generator writes it, got: ${createIndexStatement}`,
      );
    }

    const unique: string = match[1] ? "UNIQUE " : "";
    const quotedName: string = match[2];
    const quotedTable: string = match[3];
    const rest: string = (match[4] || "").trim();

    return {
      quotedName: quotedName,
      quotedTable: quotedTable,
      name: this.unquote(quotedName),
      build: `CREATE ${unique}INDEX CONCURRENTLY IF NOT EXISTS ${quotedName} ON ${quotedTable} ${rest}`,
    };
  }

  public static parseAddForeignKey(
    addForeignKeyStatement: string,
  ): OnlineForeignKey {
    const match: RegExpMatchArray | null =
      addForeignKeyStatement.match(ADD_FOREIGN_KEY);

    if (!match || !match[1] || !match[2] || !match[3]) {
      throw new Error(
        `OnlineDdl.addForeignKey expects an ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY statement as the generator writes it, got: ${addForeignKeyStatement}`,
      );
    }

    const quotedTable: string = match[1];
    const quotedName: string = match[2];
    const definition: string = match[3].trim();

    return {
      quotedTable: quotedTable,
      quotedName: quotedName,
      name: this.unquote(quotedName),
      addNotValid: `ALTER TABLE ${quotedTable} ADD CONSTRAINT ${quotedName} ${definition} NOT VALID`,
      validate: `ALTER TABLE ${quotedTable} VALIDATE CONSTRAINT ${quotedName}`,
    };
  }

  private static assertNoTransaction(
    queryRunner: QueryRunner,
    statement: string,
  ): void {
    if (queryRunner.isTransactionActive) {
      throw new Error(
        `OnlineDdl cannot run inside a transaction (${statement}): an online index build cannot run in one at all, and a validation in the same transaction as the statement before it scans the table under that statement's lock. Give the migration \`public transaction: boolean = false;\`.`,
      );
    }
  }

  /*
   * The index of this name on the table the statement names - resolved
   * through the search path exactly as the statement resolves it. It is
   * being built when a build of it shows progress, or when an index build in
   * this database hides its progress from this role (index_relid NULL
   * without pg_read_all_stats): that may be it.
   */
  private static async getIndexState(
    queryRunner: QueryRunner,
    index: OnlineIndex,
  ): Promise<IndexState> {
    const row: IndexRow | undefined = (
      await this.getIndexRows(queryRunner, index)
    )[0];

    if (!row) {
      return "missing";
    }

    if (row.isValid === true) {
      return "valid";
    }

    return row.isBuilding === true ? "building" : "invalid";
  }

  private static async getIndexRows(
    queryRunner: QueryRunner,
    index: OnlineIndex,
  ): Promise<Array<IndexRow>> {
    return await queryRunner.query(
      `SELECT x.indisvalid AS "isValid",
              x.indexrelid::regclass::text AS "regclass",
              EXISTS (SELECT 1 FROM pg_stat_progress_create_index p
                      WHERE p.datname = current_database()
                        AND (p.index_relid = x.indexrelid OR p.index_relid IS NULL)
              ) AS "isBuilding"
         FROM pg_index x
         JOIN pg_class c ON c.oid = x.indexrelid
        WHERE x.indrelid = to_regclass($1) AND c.relname = $2`,
      [index.quotedTable, index.name],
    );
  }

  /*
   * Another session is building this index (a migrate pod that was stopped
   * mid-build leaves its build running on the server, for one). Dropping it
   * would wait behind that build anyway, so wait for the build to end, then
   * look again.
   */
  private static async waitWhileBuilding(
    queryRunner: QueryRunner,
    index: OnlineIndex,
    limits: OnlineDdlLimits,
  ): Promise<IndexState> {
    const startedAt: number = Date.now();

    logger.warn(
      `${index.quotedName} on ${index.quotedTable} is being built by another session (or another role is building an index this role cannot see); waiting for that build to end.`,
    );

    for (;;) {
      await Sleep.sleep(limits.buildPollIntervalInMs);

      const state: IndexState = await this.getIndexState(queryRunner, index);

      if (state !== "building") {
        return state;
      }

      if (Date.now() - startedAt > limits.statementTimeoutInMs) {
        throw new Error(
          `${index.quotedName} on ${index.quotedTable} was still being built by another session after ${Math.round(
            limits.statementTimeoutInMs / 1000,
          )} s. Once that build ends, run the migration again.`,
        );
      }
    }
  }

  private static async dropInvalidIndex(
    queryRunner: QueryRunner,
    index: OnlineIndex,
    limits: OnlineDdlLimits,
  ): Promise<void> {
    const row: IndexRow | undefined = (
      await this.getIndexRows(queryRunner, index)
    )[0];

    if (!row || row.isValid === true) {
      return;
    }

    logger.warn(
      `Dropping the INVALID ${index.quotedName} a stopped online build left on ${index.quotedTable}, to build it again.`,
    );

    await this.runWithLimits(
      queryRunner,
      `DROP INDEX CONCURRENTLY IF EXISTS ${row.regclass}`,
      limits,
    );
  }

  /* true: validated; false: added NOT VALID; null: not there. */
  private static async getForeignKeyState(
    queryRunner: QueryRunner,
    foreignKey: OnlineForeignKey,
  ): Promise<boolean | null> {
    const rows: Array<{ isValidated: boolean }> = await queryRunner.query(
      `SELECT con.convalidated AS "isValidated"
         FROM pg_constraint con
        WHERE con.conrelid = to_regclass($1) AND con.conname = $2
          AND con.contype = 'f'`,
      [foreignKey.quotedTable, foreignKey.name],
    );

    const row: { isValidated: boolean } | undefined = rows[0];

    return row ? row.isValidated === true : null;
  }

  /*
   * Runs one long, non-blocking statement within `limits`, then gives the
   * connection its own settings back - it returns to the pool.
   */
  private static async runWithLimits(
    queryRunner: QueryRunner,
    statement: string,
    limits: OnlineDdlLimits,
  ): Promise<void> {
    await queryRunner.query(
      `SET statement_timeout = ${limits.statementTimeoutInMs}`,
    );

    try {
      await queryRunner.query(`SET lock_timeout = ${limits.lockTimeoutInMs}`);

      const client: PostgresClient =
        (await queryRunner.connect()) as PostgresClient;

      await client.query({
        text: statement,
        query_timeout:
          limits.statementTimeoutInMs + limits.clientTimeoutMarginInMs,
      });
    } finally {
      await queryRunner.query(`SET statement_timeout = DEFAULT`);
      await queryRunner.query(`SET lock_timeout = DEFAULT`);
    }
  }

  private static unquote(quoted: string): string {
    return quoted.slice(1, -1).replace(/""/g, '"');
  }

  private static getErrorCode(error: unknown): string | undefined {
    const code: unknown =
      (error as { code?: unknown } | null)?.code ??
      (error as { driverError?: { code?: unknown } } | null)?.driverError?.code;

    return typeof code === "string" ? code : undefined;
  }

  private static getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
