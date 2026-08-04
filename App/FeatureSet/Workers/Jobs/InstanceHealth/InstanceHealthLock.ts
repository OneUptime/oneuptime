import PostgresDatabase, {
  DatabaseQueryRunner,
  DatabaseSource,
} from "Common/Server/Infrastructure/PostgresDatabase";
import logger from "Common/Server/Utils/Logger";
import { getErrorMessage } from "./InstanceHealthNotification";

function advisoryLockWasAcquired(rows: unknown): boolean {
  if (!Array.isArray(rows) || rows.length === 0) {
    return false;
  }

  const acquired: unknown = (rows[0] as { acquired?: unknown }).acquired;
  return acquired === true || acquired === "t" || acquired === 1;
}

/*
 * Instance-health evaluation is a read-modify-write over one durable log stream
 * per event type, so two app replicas ticking at the same time could both see
 * "no active notification" and both email every master admin. A transaction
 * -scoped advisory lock makes the whole evaluation single-writer across the
 * cluster; a replica that cannot take the lock simply skips this tick, because
 * the holder is already doing the same work.
 */
export async function runWithInstanceHealthAdvisoryLock(data: {
  jobName: string;
  lockLabel: string;
  run: () => Promise<void>;
}): Promise<void> {
  const dataSource: DatabaseSource | null = PostgresDatabase.getDataSource();

  if (!dataSource) {
    logger.error(
      `${data.jobName}: Skipping evaluation because Postgres is not connected.`,
    );
    return;
  }

  const queryRunner: DatabaseQueryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  try {
    await queryRunner.startTransaction();

    const rows: unknown = await queryRunner.query(
      "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired",
      [data.lockLabel],
    );

    if (!advisoryLockWasAcquired(rows)) {
      await queryRunner.commitTransaction();
      return;
    }

    await data.run();
    await queryRunner.commitTransaction();
  } catch (error) {
    if (queryRunner.isTransactionActive) {
      try {
        await queryRunner.rollbackTransaction();
      } catch (rollbackError) {
        logger.error(
          `${data.jobName}: Failed to roll back the advisory-lock transaction: ${getErrorMessage(rollbackError)}`,
        );
      }
    }

    throw error;
  } finally {
    await queryRunner.release();
  }
}
