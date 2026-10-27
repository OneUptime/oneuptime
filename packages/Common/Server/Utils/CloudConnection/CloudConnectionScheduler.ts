import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  CloudConnectionDefinition,
  getCloudConnectionDefinition,
  getCloudConnectionReadIntervalInMinutes,
  READ_INTERVAL_FIELD_KEY,
} from "../../../Types/CloudConnection/CloudConnectionCatalog";
import ObjectID from "../../../Types/ObjectID";
import Queue, { QueueName } from "../../Infrastructure/Queue";
import CloudConnectionService from "../../Services/CloudConnectionService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";

/*
 * WHEN EACH CLOUD CONNECTION IS READ.
 *
 * A Workers cron asks every minute for the enabled connections whose next
 * read is due (nextPullAt in the past, or never set - a new connection, or
 * one whose settings just changed), claims each by moving its nextPullAt
 * one interval on, and queues one job per connection. The job id carries
 * the connection and the minute, and the queue keeps at most one job per
 * connection waiting or running (deduplication), so two ticks, two worker
 * processes or a "Read now" never read one connection twice at once.
 *
 * The job's payload is the connection's id and nothing else: settings and
 * credentials are read by the job itself, never put on the queue.
 */

export const CLOUD_CONNECTION_PULL_JOB: string = "CloudConnection:Read";
/*
 * Within AWS's default interval, so a read is over before the next is due.
 * Its metrics take six minutes at most (CLOUD_READ_MAX_DURATION_MS); its
 * slower lanes - the inventory, the changes, the health events, the billing
 * - get what is left of this, and wait for the next read when too little is
 * (CloudConnectionLanes).
 */
export const CLOUD_CONNECTION_PULL_JOB_TIMEOUT_MS: number = 9 * 60 * 1000;
// Connections claimed in one tick; the rest wait for the next minute.
const MAX_CONNECTIONS_PER_TICK: number = 100;

export default class CloudConnectionScheduler {
  public static jobIdOf(connectionId: ObjectID, now: Date): string {
    return `cloud-connection-read-${connectionId.toString()}-${Math.floor(
      now.getTime() / 60000,
    )}`;
  }

  // Queue a read of one connection now. Its payload is the id only.
  public static async enqueue(
    connectionId: ObjectID,
    now: Date,
  ): Promise<void> {
    await Queue.addJob(
      QueueName.Worker,
      CloudConnectionScheduler.jobIdOf(connectionId, now),
      CLOUD_CONNECTION_PULL_JOB,
      { connectionId: connectionId.toString() },
      {
        attempts: 1,
        deduplication: {
          id: `cloud-connection-read-${connectionId.toString()}`,
        },
      },
    );
  }

  // The minutes between two reads of a connection.
  public static intervalOf(connection: CloudConnection): number {
    const definition: CloudConnectionDefinition | undefined =
      getCloudConnectionDefinition(connection.provider);

    if (!definition) {
      return 15;
    }

    return getCloudConnectionReadIntervalInMinutes(
      definition,
      connection.config?.[READ_INTERVAL_FIELD_KEY],
    );
  }

  public static async enqueueDueConnections(
    now: Date = new Date(),
  ): Promise<number> {
    const due: Array<CloudConnection> = await CloudConnectionService.findBy({
      query: {
        isEnabled: true,
        nextPullAt: QueryHelper.lessThanEqualToOrNull(now),
      },
      select: { _id: true, provider: true, config: true },
      sort: { nextPullAt: SortOrder.Ascending },
      skip: 0,
      limit: MAX_CONNECTIONS_PER_TICK,
      props: { isRoot: true },
    });

    let queued: number = 0;

    for (const connection of due) {
      if (!connection.id) {
        continue;
      }

      const interval: number = CloudConnectionScheduler.intervalOf(connection);

      try {
        /*
         * Claimed before it is queued: a tick that runs while this one is
         * still queuing does not queue it again. The job sets the real next
         * read when it finishes.
         */
        await CloudConnectionService.updateOneById({
          id: connection.id,
          data: { nextPullAt: new Date(now.getTime() + interval * 60 * 1000) },
          props: { isRoot: true, ignoreHooks: true },
        });

        await CloudConnectionScheduler.enqueue(connection.id, now);
        queued++;
      } catch (error) {
        logger.error(
          `Cloud connection ${connection.id.toString()} could not be queued for a read: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return queued;
  }
}
