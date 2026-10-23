import NetworkControllerConnection from "../../../Models/DatabaseModels/NetworkControllerConnection";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { readNetworkControllerConfig } from "../../../Types/NetworkController/NetworkControllerConnectionSettings";
import ObjectID from "../../../Types/ObjectID";
import Queue, { QueueName } from "../../Infrastructure/Queue";
import NetworkControllerConnectionService from "../../Services/NetworkControllerConnectionService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";

/*
 * WHEN EACH NETWORK CONTROLLER CONNECTION IS READ.
 *
 * A Workers cron asks every minute for the enabled connections whose next
 * read is due (nextPullAt in the past, or never set - a new connection, or
 * one whose settings just changed), claims each by moving its nextPullAt
 * one interval on, and queues one job per connection. The job id carries
 * the connection and the minute, and the queue keeps at most one job per
 * connection waiting or running (deduplication), so two ticks, two worker
 * processes or a "Read now" never read one organization twice at once -
 * which would spend its API budget twice.
 *
 * The job's payload is the connection's id and nothing else: the key is
 * read by the job itself, never put on the queue.
 */

export const NETWORK_CONTROLLER_READ_JOB: string = "NetworkControllerConnection:Read";
export const NETWORK_CONTROLLER_READ_JOB_TIMEOUT_MS: number = 9 * 60 * 1000;
// Connections claimed in one tick; the rest wait for the next minute.
const MAX_CONNECTIONS_PER_TICK: number = 100;

export default class NetworkControllerScheduler {
  public static jobIdOf(connectionId: ObjectID, now: Date): string {
    return `network-controller-read-${connectionId.toString()}-${Math.floor(
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
      NetworkControllerScheduler.jobIdOf(connectionId, now),
      NETWORK_CONTROLLER_READ_JOB,
      { connectionId: connectionId.toString() },
      {
        attempts: 1,
        deduplication: {
          id: `network-controller-read-${connectionId.toString()}`,
        },
      },
    );
  }

  // The minutes between two reads of a connection.
  public static intervalOf(connection: NetworkControllerConnection): number {
    return readNetworkControllerConfig(connection.config).readIntervalInMinutes;
  }

  public static async enqueueDueConnections(
    now: Date = new Date(),
  ): Promise<number> {
    const due: Array<NetworkControllerConnection> =
      await NetworkControllerConnectionService.findBy({
        query: {
          isEnabled: true,
          nextPullAt: QueryHelper.lessThanEqualToOrNull(now),
        },
        select: { _id: true, config: true },
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

      const interval: number =
        NetworkControllerScheduler.intervalOf(connection);

      try {
        /*
         * Claimed before it is queued: a tick that runs while this one is
         * still queuing does not queue it again. The job sets the real next
         * read when it finishes.
         */
        await NetworkControllerConnectionService.updateOneById({
          id: connection.id,
          data: { nextPullAt: new Date(now.getTime() + interval * 60 * 1000) },
          props: { isRoot: true, ignoreHooks: true },
        });

        await NetworkControllerScheduler.enqueue(connection.id, now);
        queued++;
      } catch (error) {
        logger.error(
          `Network controller connection ${connection.id.toString()} could not be queued for a read: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return queued;
  }
}
