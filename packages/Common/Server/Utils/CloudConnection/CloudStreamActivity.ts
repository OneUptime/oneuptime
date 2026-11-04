import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import {
  CLOUD_STREAM_MAX_LOG_GROUPS_PER_SOURCE,
  CLOUD_STREAM_MAX_NAMESPACES_PER_SOURCE,
  CLOUD_STREAM_MAX_SOURCES,
  CloudStreamLogSource,
  CloudStreamMetricSource,
  CloudStreamRefusalReason,
  CloudStreamSummary,
  mergeCloudStreamSummary,
  readCloudStreamSummary,
} from "../../../Types/CloudConnection/CloudStream";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OldestKeyMap from "../../../Utils/OldestKeyMap";
import CloudConnectionService from "../../Services/CloudConnectionService";
import logger from "../Logger";

/*
 * WHAT A CONNECTION'S STREAMS DELIVERED, KEPT ON THE CONNECTION.
 *
 * Every delivery the ingest endpoint takes - or refuses, for a key that
 * names a connection - is noted here, in this process: the accounts and
 * Regions it came from, their metric namespaces and log groups, the
 * refusal and why. At most once a minute per connection the notes are
 * merged into the stored summary (CloudConnection.streamSummary,
 * mergeCloudStreamSummary) - the first delivery at once, so the person
 * setting a stream up sees it arrive - in one hook-free write that leaves
 * updatedAt alone.
 *
 * Each process writes what it saw. Two processes writing at once can each
 * miss what the other added, but every process keeps its notes until they
 * are a week old and merges them again on its next write, and merging the
 * same notes twice changes nothing: what is stored catches up within a
 * minute or two. Notes are kept for at most MAX_TRACKED_CONNECTIONS
 * connections, the oldest dropped first.
 *
 * Never throws: a failed write is logged, and the next delivery tries again.
 */

export const CLOUD_STREAM_SUMMARY_WRITE_INTERVAL_MS: number = 60 * 1000;
const MAX_TRACKED_CONNECTIONS: number = 2000;

interface TrackedConnection {
  seen: CloudStreamSummary;
  // When this process last wrote the connection's summary; 0 never.
  writtenAt: number;
  isWriting: boolean;
}

export interface CloudStreamSighting {
  accountId: string;
  region: string;
  namespaces?: Array<string> | undefined;
  logGroups?: Array<string> | undefined;
}

export default class CloudStreamActivity {
  private static tracked: OldestKeyMap<string, TrackedConnection> =
    new OldestKeyMap<string, TrackedConnection>();

  // Test seam: the write that stores a merged summary.
  public static writeSummary: (data: {
    connectionId: ObjectID;
    summary: CloudStreamSummary;
  }) => Promise<void> = async (data: {
    connectionId: ObjectID;
    summary: CloudStreamSummary;
  }): Promise<void> => {
    await CloudConnectionService.updateColumnsByIdWithoutHooks({
      id: data.connectionId,
      // JSON columns make the typed partial too deep for TypeScript.
      data: {
        streamSummary: data.summary as unknown as JSONObject,
      } as never,
      skipUpdateDateColumn: true,
    });
  };

  // Test seam: the read of what is stored.
  public static readSummary: (
    connectionId: ObjectID,
  ) => Promise<CloudStreamSummary> = async (
    connectionId: ObjectID,
  ): Promise<CloudStreamSummary> => {
    const connection: CloudConnection | null =
      await CloudConnectionService.findOneById({
        id: connectionId,
        select: { _id: true, streamSummary: true },
        props: { isRoot: true },
      });

    return readCloudStreamSummary(connection?.streamSummary);
  };

  public static reset(): void {
    CloudStreamActivity.tracked.clear();
  }

  private static track(connectionId: ObjectID): TrackedConnection {
    const key: string = connectionId.toString();
    let tracked: TrackedConnection | undefined =
      CloudStreamActivity.tracked.get(key);

    if (!tracked) {
      while (CloudStreamActivity.tracked.size >= MAX_TRACKED_CONNECTIONS) {
        const oldest: string | undefined =
          CloudStreamActivity.tracked.oldestKey();

        if (oldest === undefined) {
          break;
        }

        CloudStreamActivity.tracked.delete(oldest);
      }

      tracked = {
        seen: { metricSources: [], logSources: [] },
        writtenAt: 0,
        isWriting: false,
      };
      CloudStreamActivity.tracked.set(key, tracked);
    }

    return tracked;
  }

  // A delivery taken: what it carried, from where.
  public static noteDelivery(data: {
    connectionId: ObjectID;
    now: Date;
    sightings: Array<CloudStreamSighting>;
  }): void {
    try {
      const tracked: TrackedConnection = CloudStreamActivity.track(
        data.connectionId,
      );
      const at: string = data.now.toISOString();
      const metricSources: Array<CloudStreamMetricSource> = [];
      const logSources: Array<CloudStreamLogSource> = [];

      for (const sighting of data.sightings) {
        if (!sighting.accountId) {
          continue;
        }

        if (sighting.namespaces && sighting.namespaces.length > 0) {
          metricSources.push({
            accountId: sighting.accountId,
            region: sighting.region,
            namespaces: sighting.namespaces.slice(
              0,
              CLOUD_STREAM_MAX_NAMESPACES_PER_SOURCE,
            ),
            lastAt: at,
          });
        }

        if (sighting.logGroups && sighting.logGroups.length > 0) {
          logSources.push({
            accountId: sighting.accountId,
            region: sighting.region,
            logGroups: sighting.logGroups.slice(
              0,
              CLOUD_STREAM_MAX_LOG_GROUPS_PER_SOURCE,
            ),
            lastAt: at,
          });
        }
      }

      tracked.seen = mergeCloudStreamSummary({
        stored: tracked.seen,
        seen: {
          lastDeliveryAt: at,
          metricSources: metricSources.slice(0, CLOUD_STREAM_MAX_SOURCES),
          logSources: logSources.slice(0, CLOUD_STREAM_MAX_SOURCES),
        },
        now: data.now,
      });

      CloudStreamActivity.writeWhenDue(data.connectionId, tracked, data.now);
    } catch (error) {
      CloudStreamActivity.logFailure(data.connectionId, error);
    }
  }

  // A delivery refused, for a key that names this connection.
  public static noteRefusal(data: {
    connectionId: ObjectID;
    reason: CloudStreamRefusalReason;
    now: Date;
  }): void {
    try {
      const tracked: TrackedConnection = CloudStreamActivity.track(
        data.connectionId,
      );

      tracked.seen = mergeCloudStreamSummary({
        stored: tracked.seen,
        seen: {
          metricSources: [],
          logSources: [],
          lastRefusal: { at: data.now.toISOString(), reason: data.reason },
        },
        now: data.now,
      });

      CloudStreamActivity.writeWhenDue(data.connectionId, tracked, data.now);
    } catch (error) {
      CloudStreamActivity.logFailure(data.connectionId, error);
    }
  }

  // Writes now when the last write was a minute ago or more; else waits for the next delivery.
  private static writeWhenDue(
    connectionId: ObjectID,
    tracked: TrackedConnection,
    now: Date,
  ): void {
    if (
      tracked.isWriting ||
      now.getTime() - tracked.writtenAt < CLOUD_STREAM_SUMMARY_WRITE_INTERVAL_MS
    ) {
      return;
    }

    tracked.isWriting = true;
    tracked.writtenAt = now.getTime();

    void CloudStreamActivity.write(connectionId, tracked, now)
      .catch((error: unknown): void => {
        CloudStreamActivity.logFailure(connectionId, error);
      })
      .finally((): void => {
        tracked.isWriting = false;
      });
  }

  // The stored summary with this process's notes merged in. Exposed for tests.
  public static async write(
    connectionId: ObjectID,
    tracked: { seen: CloudStreamSummary },
    now: Date,
  ): Promise<CloudStreamSummary> {
    const stored: CloudStreamSummary =
      await CloudStreamActivity.readSummary(connectionId);
    const merged: CloudStreamSummary = mergeCloudStreamSummary({
      stored,
      seen: tracked.seen,
      now,
    });

    await CloudStreamActivity.writeSummary({ connectionId, summary: merged });

    return merged;
  }

  // Waits for every write in flight: tests, and a process that is stopping.
  public static async flushAll(now: Date): Promise<void> {
    const entries: Array<[string, TrackedConnection]> = Array.from(
      CloudStreamActivity.tracked.entries(),
    );

    for (const [key, tracked] of entries) {
      try {
        await CloudStreamActivity.write(new ObjectID(key), tracked, now);
        tracked.writtenAt = now.getTime();
      } catch (error) {
        CloudStreamActivity.logFailure(new ObjectID(key), error);
      }
    }
  }

  private static logFailure(connectionId: ObjectID, error: unknown): void {
    logger.warn(
      `Cloud stream ${connectionId.toString()}: what it delivered could not be recorded: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
