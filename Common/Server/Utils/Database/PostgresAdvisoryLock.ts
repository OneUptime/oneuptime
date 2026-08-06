import PostgresDatabase, {
  DatabaseQueryRunner,
  DatabaseSource,
} from "../../Infrastructure/PostgresDatabase";
import DatabaseNotConnectedException from "../../../Types/Exception/DatabaseNotConnectedException";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * A cross-process mutex, backed by a Postgres advisory lock.
 *
 * Reach for this when a decision has to read the database and then write a row
 * based on what it read, and two callers arriving at the same instant must not
 * both act on the same "before" state. A read followed by a write is not atomic
 * on its own: both callers can complete the read before either commits the
 * write, and both then act as if they were first.
 *
 * The lock is TRANSACTION-scoped (`pg_advisory_xact_lock`) and is held by an
 * otherwise-empty transaction on a dedicated, pinned QueryRunner. Two properties
 * follow from that, and both are load-bearing:
 *
 *   - It survives PgBouncer in transaction pool mode. A SESSION-scoped
 *     `pg_advisory_lock` would not: the matching unlock can be routed to a
 *     different pooled backend, leaking the lock forever. An explicit
 *     transaction pins the client to one backend for its whole duration, and an
 *     xact-scoped lock is released by the commit itself, so it can never leak.
 *     This is the same reasoning as the startup-migration runner
 *     (App/FeatureSet/Workers/Utils/StartupMigration.ts).
 *
 *   - It cannot outlive the process that took it. If the holder dies, its
 *     connection drops, the transaction aborts, and Postgres releases the lock.
 *
 * The work itself runs on the ordinary pooled connections; only this small
 * lock-holder transaction stays pinned. Keep the work short — the holder counts
 * as idle-in-transaction while it runs, and `idle_in_transaction_session_timeout`
 * (60s by default, see PostgresIdleInTransactionTimeoutMs) will eventually kill it.
 *
 * Waiting for the lock is bounded: `lock_timeout` (3s by default, see
 * PostgresLockTimeoutMs) covers waits for any lock, advisory locks included, so
 * a pathologically contended lock surfaces as `lock_not_available` rather than
 * an unbounded hang. Note DataSourceOptions omits `lock_timeout` on connections
 * that run schema migrations on boot — there the bound is `statement_timeout`
 * instead. Either way the failure mode is the right one for these callers:
 * refusing to serve a request is safe, serving it unserialized is exactly the
 * bug the lock exists to prevent.
 */
export default class PostgresAdvisoryLock {
  /**
   * Runs `work` while holding the advisory lock named by `label`, and returns
   * whatever `work` returns. Callers using the same label are serialized
   * instance-wide, across every replica connected to the same database.
   *
   * `label` is passed as a bound parameter and hashed by Postgres, so it is
   * free-form text and never interpolated into SQL. Use a readable,
   * namespaced string (`"oneuptime:<what-is-being-serialized>"`) so the lock is
   * self-documenting and unlikely to collide with another advisory lock.
   */
  @CaptureSpan()
  public static async runExclusively<TResult>(data: {
    label: string;
    work: () => Promise<TResult>;
  }): Promise<TResult> {
    const dataSource: DatabaseSource | null = PostgresDatabase.getDataSource();

    if (!dataSource) {
      throw new DatabaseNotConnectedException();
    }

    const queryRunner: DatabaseQueryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      await queryRunner.startTransaction();
      await queryRunner.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        data.label,
      ]);

      return await data.work();
    } finally {
      /*
       * Ending the transaction is what releases the lock. The lock-holder
       * transaction only ever ran a SELECT, so committing and rolling back are
       * equivalent here; commit, and fall back to a rollback if that fails, so
       * the connection goes back to the pool clean either way.
       *
       * Everything in here is best-effort and must not mask the outcome of
       * `work` — an error thrown while cleaning up would replace either the
       * caller's result or the caller's exception with a connection-management
       * detail.
       */
      try {
        if (queryRunner.isTransactionActive) {
          await queryRunner.commitTransaction();
        }
      } catch (err) {
        logger.error(
          `Failed to end the advisory-lock transaction for "${data.label}"`,
        );
        logger.error(err);

        try {
          await queryRunner.rollbackTransaction();
        } catch (rollbackErr) {
          logger.error(rollbackErr);
        }
      }

      try {
        await queryRunner.release();
      } catch (err) {
        logger.error(
          `Failed to release the advisory-lock connection for "${data.label}"`,
        );
        logger.error(err);
      }
    }
  }
}
