import Monitor from "Common/Models/DatabaseModels/Monitor";
import Semaphore, {
  SemaphoreMutex,
  SemaphoreLockTimeoutError,
} from "Common/Server/Infrastructure/Semaphore";
import MonitorService from "Common/Server/Services/MonitorService";
import Query from "Common/Server/Types/Database/Query";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";

export const MONITOR_SWEEP_BATCH_SIZE: number = 100;
export const MONITOR_SWEEP_CONCURRENCY: number = 10;

/*
 * Keep at most one page of monitor JSON and ten evaluations in memory. An
 * immutable ID cursor avoids OFFSET skipping rows when processing changes the
 * query's matching set. The renewing mutex also covers work that outlives the
 * queue timeout: a later tick must not start another copy of the same sweep.
 */
export default async function runMonitorSweep(data: {
  jobName: string;
  queries: Array<Query<Monitor>>;
  select: Select<Monitor>;
  processMonitor: (monitor: Monitor) => Promise<void>;
}): Promise<void> {
  let mutex: SemaphoreMutex;

  try {
    mutex = await Semaphore.lock({
      namespace: "monitor-heartbeat-sweep",
      key: data.jobName,
      lockTimeout: 60_000,
      acquireAttemptsLimit: 1,
    });
  } catch (error) {
    if (error instanceof SemaphoreLockTimeoutError) {
      logger.debug(
        `${data.jobName}: skipping tick because another sweep is running`,
      );
    } else {
      logger.error(`${data.jobName}: could not acquire the sweep lock`);
      logger.error(error);
    }
    return;
  }

  try {
    for (const query of data.queries) {
      let cursor: ObjectID | undefined;

      while (mutex.isAcquired) {
        const monitors: Array<Monitor> = await MonitorService.findBy({
          query: {
            ...query,
            ...(cursor ? { _id: QueryHelper.greaterThan(cursor) } : {}),
          },
          select: { ...data.select, _id: true },
          sort: { _id: SortOrder.Ascending },
          skip: 0,
          limit: MONITOR_SWEEP_BATCH_SIZE,
          props: { isRoot: true },
        });

        if (monitors.length === 0) {
          break;
        }

        const lastId: ObjectID | null = monitors[monitors.length - 1]!.id;
        if (!lastId || (cursor && lastId.toString() <= cursor.toString())) {
          throw new Error(
            `${data.jobName}: monitor page did not advance its ID cursor`,
          );
        }
        cursor = lastId;
        let nextIndex: number = 0;

        await Promise.all(
          Array.from(
            { length: Math.min(MONITOR_SWEEP_CONCURRENCY, monitors.length) },
            async (): Promise<void> => {
              while (nextIndex < monitors.length && mutex.isAcquired) {
                const monitor: Monitor = monitors[nextIndex++]!;
                try {
                  await data.processMonitor(monitor);
                } catch (error) {
                  logger.error(
                    `${data.jobName}: error processing monitor ${monitor.id}`,
                  );
                  logger.error(error);
                }
              }
            },
          ),
        );

        if (monitors.length < MONITOR_SWEEP_BATCH_SIZE) {
          break;
        }
      }
    }
  } finally {
    try {
      await Semaphore.release(mutex);
    } catch (error) {
      logger.error(`${data.jobName}: failed to release sweep lock`);
      logger.error(error);
    }
  }
}
