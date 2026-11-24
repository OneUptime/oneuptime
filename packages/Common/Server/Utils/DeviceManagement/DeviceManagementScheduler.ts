import DeviceManagementConnection from "../../../Models/DatabaseModels/DeviceManagementConnection";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { DeviceManagementConnectionReadOutcome } from "../../../Types/DeviceManagement/DeviceManagementConnectionReading";
import { readDeviceManagementConfig } from "../../../Types/DeviceManagement/DeviceManagementConnectionSettings";
import ObjectID from "../../../Types/ObjectID";
import Queue, { QueueName } from "../../Infrastructure/Queue";
import DeviceManagementConnectionService from "../../Services/DeviceManagementConnectionService";
import QueryHelper from "../../Types/Database/QueryHelper";
import LlmConnectionPullRunner from "../LlmObservability/LlmConnectionPullRunner";
import logger from "../Logger";
import DeviceManagementConnectionReadMetrics, {
  DeviceManagementConnectionReadRecord,
} from "./DeviceManagementConnectionReadMetrics";

/*
 * WHEN EACH DEVICE MANAGEMENT CONNECTION IS READ.
 *
 * Esper has no webhooks, so its fleet is polled. A Workers cron asks every
 * minute for the enabled connections whose next read is due (nextPullAt in
 * the past, or never set - a new connection, or one whose settings just
 * changed), claims each by moving its nextPullAt one interval on, and
 * queues one job per connection. The job id carries the connection and the
 * minute, and the queue keeps at most one job per connection waiting or
 * running (deduplication), so two ticks, two worker processes or a "Read
 * now" never read one tenant twice at once - which would spend its API
 * budget twice.
 *
 * The job's payload is the connection's id and nothing else: the key is
 * read by the job itself, never put on the queue.
 *
 * Each connection a tick claims that was already on its schedule writes
 * its own reading too (#10006): the minutes since its last read that
 * worked, as the read runner writes at the end of every read. A read the
 * workers lose before it ends - the process restarting, the job timing out
 * - writes nothing itself, so without this a connection whose reads all
 * stopped finishing would read as healthy as its last read did. A
 * connection claimed fresh (just saved, edited or turned on: nextPullAt
 * unset) writes none: its first read is about to say how it is, and it was
 * not overdue while it was off.
 */

export const DEVICE_MANAGEMENT_READ_JOB: string =
  "DeviceManagementConnection:Read";
export const DEVICE_MANAGEMENT_READ_JOB_TIMEOUT_MS: number = 9 * 60 * 1000;
// Connections claimed in one tick; the rest wait for the next minute.
const MAX_CONNECTIONS_PER_TICK: number = 100;

export interface DeviceManagementSchedulerDependencies {
  // Test seam for whether the project may read telemetry.
  isTelemetryAllowed?: ((projectId: ObjectID) => Promise<boolean>) | undefined;
  // Test seam for the connections' own readings.
  recordConnectionReadings?:
    | ((
        records: ReadonlyArray<DeviceManagementConnectionReadRecord>,
      ) => Promise<number>)
    | undefined;
}

/*
 * The reading a claim writes for a connection that was due, or undefined
 * for one claimed fresh (nextPullAt unset: just saved, edited or turned
 * on), whose first read is about to say how it is. Its error is the one
 * its last read failed with, if that read failed. Pure.
 */
export function getDueConnectionReadRecord(data: {
  connection: DeviceManagementConnection;
  intervalInMinutes: number;
  now: Date;
}): DeviceManagementConnectionReadRecord | undefined {
  const connection: DeviceManagementConnection = data.connection;

  if (!connection.id || !connection.projectId || !connection.nextPullAt) {
    return undefined;
  }

  return {
    projectId: connection.projectId,
    connectionId: connection.id,
    reading: {
      connectionName: connection.name,
      provider: connection.provider,
      readIntervalInMinutes: data.intervalInMinutes,
      outcome: DeviceManagementConnectionReadOutcome.Due,
      lastSuccessfulReadAt: connection.lastSuccessfulPullAt,
      createdAt: connection.createdAt,
      lastError: connection.lastError,
      asOf: data.now,
    },
  };
}

export default class DeviceManagementScheduler {
  public static jobIdOf(connectionId: ObjectID, now: Date): string {
    return `device-management-read-${connectionId.toString()}-${Math.floor(
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
      DeviceManagementScheduler.jobIdOf(connectionId, now),
      DEVICE_MANAGEMENT_READ_JOB,
      { connectionId: connectionId.toString() },
      {
        attempts: 1,
        deduplication: {
          id: `device-management-read-${connectionId.toString()}`,
        },
      },
    );
  }

  // The minutes between two reads of a connection.
  public static intervalOf(connection: DeviceManagementConnection): number {
    return readDeviceManagementConfig(connection.config).readIntervalInMinutes;
  }

  public static async enqueueDueConnections(
    now: Date = new Date(),
    dependencies: DeviceManagementSchedulerDependencies = {},
  ): Promise<number> {
    const due: Array<DeviceManagementConnection> =
      await DeviceManagementConnectionService.findBy({
        query: {
          isEnabled: true,
          nextPullAt: QueryHelper.lessThanEqualToOrNull(now),
        },
        select: {
          _id: true,
          config: true,
          projectId: true,
          name: true,
          provider: true,
          createdAt: true,
          nextPullAt: true,
          lastSuccessfulPullAt: true,
          lastError: true,
        },
        sort: { nextPullAt: SortOrder.Ascending },
        skip: 0,
        limit: MAX_CONNECTIONS_PER_TICK,
        props: { isRoot: true },
      });

    let queued: number = 0;
    const readings: Array<DeviceManagementConnectionReadRecord> = [];

    for (const connection of due) {
      if (!connection.id) {
        continue;
      }

      const interval: number = DeviceManagementScheduler.intervalOf(connection);

      try {
        /*
         * Claimed before it is queued: a tick that runs while this one is
         * still queuing does not queue it again. The job sets the real next
         * read when it finishes.
         */
        await DeviceManagementConnectionService.updateOneById({
          id: connection.id,
          data: { nextPullAt: new Date(now.getTime() + interval * 60 * 1000) },
          props: { isRoot: true, ignoreHooks: true },
        });

        await DeviceManagementScheduler.enqueue(connection.id, now);
        queued++;
      } catch (error) {
        logger.error(
          `Device management connection ${connection.id.toString()} could not be queued for a read: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      // Due, whether or not it could be queued: how long since one worked.
      const reading: DeviceManagementConnectionReadRecord | undefined =
        getDueConnectionReadRecord({
          connection,
          intervalInMinutes: interval,
          now,
        });

      if (reading) {
        readings.push(reading);
      }
    }

    await DeviceManagementScheduler.recordDueReadings(readings, dependencies);

    return queued;
  }

  /*
   * Writes the readings of the connections a tick found due, of the
   * projects that may read telemetry - as the read runner reads only
   * theirs. Guarded: the reads are queued already, and the next tick that
   * finds one due writes its reading again.
   */
  private static async recordDueReadings(
    readings: Array<DeviceManagementConnectionReadRecord>,
    dependencies: DeviceManagementSchedulerDependencies,
  ): Promise<void> {
    if (readings.length === 0) {
      return;
    }

    const isAllowed: (projectId: ObjectID) => Promise<boolean> =
      dependencies.isTelemetryAllowed ||
      ((projectId: ObjectID): Promise<boolean> => {
        return LlmConnectionPullRunner.isTelemetryAllowed(projectId);
      });

    try {
      const allowed: Map<string, boolean> = new Map<string, boolean>();

      for (const reading of readings) {
        const projectId: string = reading.projectId.toString();

        if (!allowed.has(projectId)) {
          allowed.set(projectId, await isAllowed(reading.projectId));
        }
      }

      const records: Array<DeviceManagementConnectionReadRecord> =
        readings.filter(
          (reading: DeviceManagementConnectionReadRecord): boolean => {
            return allowed.get(reading.projectId.toString()) === true;
          },
        );

      await (
        dependencies.recordConnectionReadings ||
        ((
          due: ReadonlyArray<DeviceManagementConnectionReadRecord>,
        ): Promise<number> => {
          return DeviceManagementConnectionReadMetrics.record(due);
        })
      )(records);
    } catch (error) {
      logger.error(
        `Device management connections due for a read: how long since each last read could not be recorded for their alerts: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
