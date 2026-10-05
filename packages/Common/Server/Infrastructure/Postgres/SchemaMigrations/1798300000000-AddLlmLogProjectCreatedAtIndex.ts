import logger from "../../../Utils/Logger";
import { MigrationInterface, QueryRunner } from "typeorm";

export const LLM_LOG_PROJECT_CREATED_AT_INDEX: string =
  "IDX_LLM_LOG_PROJECT_CREATED_AT";

/* Equality on the project first, then the range on the time. */
export const LLM_LOG_PROJECT_CREATED_AT_INDEX_COLUMNS: Array<string> = [
  "projectId",
  "createdAt",
];

/*
 * The online build, exactly as this migration runs it and as an operator can
 * run it by hand (outside a transaction) when the migration leaves it.
 */
export const LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD: string = `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${LLM_LOG_PROJECT_CREATED_AT_INDEX}" ON "LlmLog" (${LLM_LOG_PROJECT_CREATED_AT_INDEX_COLUMNS.map(
  (column: string): string => {
    return `"${column}"`;
  },
).join(", ")})`;

/* Removes an INVALID copy a stopped online build left behind. */
export const LLM_LOG_PROJECT_CREATED_AT_INDEX_DROP: string = `DROP INDEX CONCURRENTLY IF EXISTS "${LLM_LOG_PROJECT_CREATED_AT_INDEX}"`;

export interface LlmLogIndexBuildLimits {
  /*
   * The longest the online build may run: the server-side statement_timeout
   * of the build statement.
   */
  buildTimeoutInMs: number;
  /*
   * The longest the build may wait for any one lock - its own lock on
   * LlmLog, and each older transaction an online build waits out
   * (lock_timeout bounds those waits too).
   */
  lockWaitTimeoutInMs: number;
  /* The longest dropping an INVALID leftover may wait for a lock. */
  leftoverDropLockWaitTimeoutInMs: number;
  /*
   * How much longer than buildTimeoutInMs the client waits for the build's
   * answer, so that Postgres, not the client, ends an overlong build: only
   * then is the statement really stopped and its error reported.
   */
  clientTimeoutMarginInMs: number;
}

export const LLM_LOG_INDEX_BUILD_LIMITS: LlmLogIndexBuildLimits = {
  buildTimeoutInMs: 15 * 60 * 1000,
  lockWaitTimeoutInMs: 2 * 60 * 1000,
  leftoverDropLockWaitTimeoutInMs: 5 * 1000,
  clientTimeoutMarginInMs: 60 * 1000,
};

/* What the catalog says about an index of this name in the current schema. */
type IndexState = "missing" | "valid" | "invalid" | "building";

/*
 * node-postgres takes a per-statement client timeout (query_timeout) in a
 * query config; TypeORM's QueryRunner.query cannot pass one.
 */
interface PostgresClient {
  query(config: { text: string; query_timeout: number }): Promise<unknown>;
}

/*
 * Adds ("projectId", "createdAt") on LlmLog: today's AI Logs of one project.
 *
 * WHY
 *
 * With a daily token or spend limit set (Project Settings -> AI Features ->
 * More settings), every AI call and every check before AI work starts runs
 * LlmLogService.getProjectUsageSince: a SUM over the project's LlmLog rows
 * since midnight UTC,
 *
 *   WHERE "projectId" = $1 AND "createdAt" >= $2 AND "deletedAt" IS NULL
 *
 * and the incident and alert daily token limits run the same shape
 * (getTotalTokensUsedSince, plus a feature filter) on every autonomous AI
 * call. LlmLog had an index on "projectId" alone, so each of those sums read
 * the project's whole AI Log history - or, for a project that owns most of
 * the table, Postgres scanned all of LlmLog. OneUptime Cloud keeps three days
 * of AI Logs; a self-hosted install keeps them all, and paid for that history
 * on every AI call. On a clone with a million rows (one project 60% of them)
 * the project limit's sum read all 71,400 pages of the table (83 ms), and the
 * incident lane's the same pages plus a subquery per row (690 ms); through
 * this index each reads about ten pages, in a fraction of a millisecond.
 *
 * The AI Logs page gains too: it lists a project's rows newest first, which
 * this index serves in order instead of sorting the whole history.
 *
 * Nothing else is indexed: today's rows are recent, so the visibility map
 * rarely covers them and an INCLUDE of the summed columns would not save the
 * heap visits; and no LlmLog row is soft-deleted (only the retention sweep
 * deletes, outright), so a partial index on "deletedAt" IS NULL would cover
 * every row anyway.
 *
 * WHY THIS IS HAND-WRITTEN
 *
 * Generated as `CREATE INDEX "IDX_LLM_LOG_PROJECT_CREATED_AT" ON "LlmLog"
 * ("projectId", "createdAt")`, then made an online build. A plain CREATE
 * INDEX holds a SHARE lock on LlmLog for the whole build, and every AI call
 * writes an LlmLog row: those writes would queue behind the build and fail
 * once their own lock_timeout ran out. CREATE INDEX CONCURRENTLY never blocks
 * them, but it cannot run inside a transaction, so this migration sets
 * `transaction = false` and TypeORM (migrationsTransactionMode "each") runs
 * it on its own, outside one. The entity declares the index by name with
 * `synchronize: false` (Types/Database/UnsynchronizedIndex): a build that
 * could not finish leaves the table without it, so no generated migration
 * may assume it exists, or drop it.
 *
 * BOUNDS, AND THE RUNBOOK
 *
 * The build runs with its own statement_timeout (LLM_LOG_INDEX_BUILD_LIMITS:
 * 15 minutes, far past what a large AI Log table needs; a million rows took
 * about a second) and with lock_timeout bounding every wait - its lock on
 * LlmLog, and each older transaction an online build must wait out (a backup
 * that holds a snapshot for an hour, say) - to two minutes. node-postgres
 * gives up on any statement after DATABASE_QUERY_TIMEOUT_MS (35 s by default)
 * on its own clock, which no SET can raise and which would leave the server
 * building after the deploy had moved on, so the build statement carries its
 * own, longer client timeout. Both settings go back to the connection's own
 * afterwards: the connection returns to the pool.
 *
 * A build that stops - past a bound, or for any other reason - never fails the
 * deploy over an index: the AI limits read the same numbers without it, only
 * more slowly. The INVALID copy it leaves behind is dropped (online, with a
 * short lock wait), the migration logs what happened and how to build the
 * index by hand, and completes:
 *
 *   CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_LLM_LOG_PROJECT_CREATED_AT"
 *     ON "LlmLog" ("projectId", "createdAt");
 *
 * Built before the upgrade, this migration finds it and does nothing. An
 * INVALID copy from an earlier stopped build is dropped and rebuilt, since IF
 * NOT EXISTS would accept it forever; one that is still being built
 * (pg_stat_progress_create_index) is left to finish.
 */
export class AddLlmLogProjectCreatedAtIndex1798300000000
  implements MigrationInterface
{
  public name: string = "AddLlmLogProjectCreatedAtIndex1798300000000";

  /* CREATE INDEX CONCURRENTLY cannot run inside a transaction block. */
  public transaction: boolean = false;

  /* Lowered only by tests; TypeORM constructs migrations without arguments. */
  public constructor(
    private limits: LlmLogIndexBuildLimits = LLM_LOG_INDEX_BUILD_LIMITS,
  ) {}

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (queryRunner.isTransactionActive) {
      throw new Error(
        `${this.name} builds ${LLM_LOG_PROJECT_CREATED_AT_INDEX} with CREATE INDEX CONCURRENTLY, which cannot run inside a transaction. Run it the way TypeORM does for a migration with transaction = false: outside one.`,
      );
    }

    const before: IndexState = await this.getIndexState(queryRunner);

    if (before === "valid") {
      // Built by an operator ahead of the upgrade, or already migrated.
      return;
    }

    if (before === "building") {
      logger.warn(
        `${this.name}: an online build of ${LLM_LOG_PROJECT_CREATED_AT_INDEX} is in progress; leaving it to finish. If that build fails, drop the INVALID index it leaves and build it again: ${this.getRunbook(true)}`,
      );
      return;
    }

    if (before === "invalid" && !(await this.dropLeftover(queryRunner))) {
      logger.warn(
        `${this.name}: ${LLM_LOG_PROJECT_CREATED_AT_INDEX} is INVALID (left by an online build that stopped) and could not be dropped now, so it was NOT built. The AI daily limits work without it but read more of the AI Logs. Run on the OneUptime database: ${this.getRunbook(true)}`,
      );
      return;
    }

    logger.info(
      `${this.name}: building ${LLM_LOG_PROJECT_CREATED_AT_INDEX} on LlmLog online. AI calls keep working meanwhile; on a large AI Logs table this can take a few minutes.`,
    );

    const failure: unknown = await this.build(queryRunner);

    if (failure === null) {
      return;
    }

    const after: IndexState = await this.getIndexState(queryRunner);

    if (after === "valid") {
      // The client stopped waiting, but the build finished.
      return;
    }

    const leftover: boolean =
      after === "building" ||
      (after === "invalid" && !(await this.dropLeftover(queryRunner)));

    logger.warn(
      `${this.name}: the online build of ${LLM_LOG_PROJECT_CREATED_AT_INDEX} did not finish (${this.getErrorMessage(
        failure,
      )}), so the index was NOT created. The AI daily limits work without it but read more of the AI Logs on every AI call. Build it online - it does not block AI calls - by running on the OneUptime database, outside a transaction: ${this.getRunbook(
        leftover,
      )}`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!queryRunner.isTransactionActive) {
      await queryRunner.query(LLM_LOG_PROJECT_CREATED_AT_INDEX_DROP);
      return;
    }

    /*
     * TypeORM reverts a migration inside a transaction whatever its
     * `transaction` says, and DROP INDEX CONCURRENTLY cannot run there. A
     * plain DROP INDEX takes ACCESS EXCLUSIVE on LlmLog; waiting for it would
     * park every reader and writer of LlmLog behind this statement.
     */
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "${LLM_LOG_PROJECT_CREATED_AT_INDEX}"`,
    );
  }

  /*
   * Runs the online build within its bounds and returns why it stopped, or
   * null when it finished.
   */
  private async build(queryRunner: QueryRunner): Promise<unknown> {
    await queryRunner.query(
      `SET statement_timeout = ${this.limits.buildTimeoutInMs}`,
    );

    try {
      await queryRunner.query(
        `SET lock_timeout = ${this.limits.lockWaitTimeoutInMs}`,
      );

      const client: PostgresClient =
        (await queryRunner.connect()) as PostgresClient;

      await client.query({
        text: LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD,
        query_timeout:
          this.limits.buildTimeoutInMs + this.limits.clientTimeoutMarginInMs,
      });

      return null;
    } catch (error) {
      return error;
    } finally {
      // Back to the connection's own settings: it returns to the pool.
      await queryRunner.query(`SET statement_timeout = DEFAULT`);
      await queryRunner.query(`SET lock_timeout = DEFAULT`);
    }
  }

  /*
   * Drops the INVALID copy a stopped online build left, online and with a
   * short lock wait. False when it could not.
   */
  private async dropLeftover(queryRunner: QueryRunner): Promise<boolean> {
    await queryRunner.query(
      `SET lock_timeout = ${this.limits.leftoverDropLockWaitTimeoutInMs}`,
    );

    try {
      await queryRunner.query(LLM_LOG_PROJECT_CREATED_AT_INDEX_DROP);
      return true;
    } catch (error) {
      logger.warn(
        `${this.name}: could not drop the INVALID ${LLM_LOG_PROJECT_CREATED_AT_INDEX}: ${this.getErrorMessage(
          error,
        )}`,
      );
      return false;
    } finally {
      await queryRunner.query(`SET lock_timeout = DEFAULT`);
    }
  }

  /*
   * The index of this name on the LlmLog the build names - resolved through
   * the search path exactly as the build resolves it.
   */
  private async getIndexState(queryRunner: QueryRunner): Promise<IndexState> {
    const rows: Array<{ isValid: boolean; isBuilding: boolean }> =
      await queryRunner.query(
        `SELECT x.indisvalid AS "isValid",
           EXISTS (SELECT 1 FROM pg_stat_progress_create_index p
                   WHERE p.index_relid = x.indexrelid) AS "isBuilding"
         FROM pg_index x
         JOIN pg_class c ON c.oid = x.indexrelid
         WHERE x.indrelid = to_regclass('"LlmLog"') AND c.relname = $1`,
        [LLM_LOG_PROJECT_CREATED_AT_INDEX],
      );

    const index: { isValid: boolean; isBuilding: boolean } | undefined =
      rows[0];

    if (!index) {
      return "missing";
    }

    if (index.isValid === true) {
      return "valid";
    }

    return index.isBuilding === true ? "building" : "invalid";
  }

  private getRunbook(withDrop: boolean): string {
    return withDrop
      ? `${LLM_LOG_PROJECT_CREATED_AT_INDEX_DROP}; ${LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD};`
      : `${LLM_LOG_PROJECT_CREATED_AT_INDEX_BUILD};`;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
