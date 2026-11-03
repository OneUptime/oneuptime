import Queue, { QueueName } from "../../Infrastructure/Queue";
import logger from "../Logger";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE QUEUE JOBS DATA OBSERVABILITY'S WORK IS SPLIT INTO.
 *
 * The Workers run them (Jobs/DataObservability/*). The schedule only claims
 * the stores that are due and queues one job per store, deduplicated by the
 * store, so a large installation spreads its collections over every worker
 * and a slow database never holds the schedule. Collect Now on a store
 * queues the same job.
 */

export const DATA_OBSERVABILITY_COLLECT_STORE_JOB: string =
  "DataObservability:CollectStore";

export async function queueTableHealthCollection(data: {
  projectId: ObjectID;
  dataStoreId: ObjectID;
}): Promise<void> {
  const key: string = `data-observability-collect-${data.dataStoreId.toString()}`;

  try {
    await Queue.addJob(
      QueueName.Worker,
      `${key}-${ObjectID.generate().toString()}`,
      DATA_OBSERVABILITY_COLLECT_STORE_JOB,
      {
        projectId: data.projectId.toString(),
        dataStoreId: data.dataStoreId.toString(),
      },
      {
        deduplication: {
          id: key,
          keepLastIfActive: true,
        },
        removeWhenDone: true,
      },
    );
  } catch (error) {
    logger.error(
      `DataObservability: could not queue the collection of store ${data.dataStoreId.toString()}:`,
    );
    logger.error(error);
  }
}
