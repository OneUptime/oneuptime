import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_STREAM_KEYED_CONNECTIONS_MISS_REFRESH_MS,
  CLOUD_STREAM_KEYED_CONNECTIONS_REFRESH_MS,
  CLOUD_STREAM_MAX_KEYED_CONNECTIONS,
} from "../../../Types/CloudConnection/CloudStream";
import ObjectID from "../../../Types/ObjectID";
import CloudConnectionService from "../../Services/CloudConnectionService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";

/*
 * THE CONNECTIONS THAT HOLD A STREAM KEY, KNOWN WITHOUT A READ EACH.
 *
 * A delivery names its connection in its key, so refusing a key that names
 * a connection OneUptime does not stream - never made, removed, stopped, or
 * invented by whoever sent it - used to cost a Postgres read: one for every
 * new id, since only what was read is cached. Each process now keeps the
 * ids of the connections that hold a stream key instead: one read of them
 * all, again at most every CLOUD_STREAM_KEYED_CONNECTIONS_REFRESH_MS, and -
 * when a delivery names an id it does not hold - at most every
 * CLOUD_STREAM_KEYED_CONNECTIONS_MISS_REFRESH_MS, so a key made in another
 * process is known within seconds. A delivery whose connection is not among
 * them is refused as any wrong key is, without a read and without a note on
 * a connection, however many ids it invents and from however many
 * addresses: what a refused delivery costs never grows with the deliveries
 * refused. A key made or stopped in this process is known here at once.
 *
 * Not a limit per source address: Amazon Data Firehose delivers every AWS
 * account's streams in a Region from one small block of addresses, so a
 * limit on an address would refuse one customer's deliveries for another
 * customer's stale stack, or for whoever sends from their own Firehose
 * stream.
 *
 * Fails open: while the ids cannot be read, or there are more than
 * CLOUD_STREAM_MAX_KEYED_CONNECTIONS of them, a delivery's connection is
 * read as before. Cloud-neutral: a key's connection is a connection, of
 * whichever cloud streams.
 */

export default class CloudStreamKeyedConnections {
  // The connections' ids, lower case; null until a read succeeded.
  private static ids: Set<string> | null = null;
  // False when there were more than the most kept: a miss then says nothing.
  private static isComplete: boolean = false;
  // When the ids were last read, or a read last failed.
  private static readAt: number = 0;
  private static reading: Promise<void> | null = null;

  /*
   * Test seam: the ids of the connections that hold a stream key, at most
   * `limit` of them.
   */
  public static readIds: (limit: number) => Promise<Array<string>> = async (
    limit: number,
  ): Promise<Array<string>> => {
    const connections: Array<CloudConnection> =
      await CloudConnectionService.findAllBy({
        query: {
          provider: CloudProvider.AWS,
          streamKeyCreatedAt: QueryHelper.notNull(),
        },
        select: { _id: true },
        sort: { _id: SortOrder.Ascending },
        limit,
        skip: 0,
        props: { isRoot: true },
      });

    return connections
      .map((connection: CloudConnection): string => {
        return connection.id?.toString().toLowerCase() || "";
      })
      .filter((id: string): boolean => {
        return id.length > 0;
      });
  };

  public static reset(): void {
    CloudStreamKeyedConnections.ids = null;
    CloudStreamKeyedConnections.isComplete = false;
    CloudStreamKeyedConnections.readAt = 0;
    CloudStreamKeyedConnections.reading = null;
  }

  // A key was made here: its connection is known at once.
  public static keyMade(connectionId: ObjectID | string): void {
    CloudStreamKeyedConnections.ids?.add(connectionId.toString().toLowerCase());
  }

  // Every key of a connection was stopped here: refused without a read at once.
  public static keysStopped(connectionId: ObjectID | string): void {
    CloudStreamKeyedConnections.ids?.delete(
      connectionId.toString().toLowerCase(),
    );
  }

  /*
   * Whether a delivery's connection may hold a stream key: false only when
   * it is known not to - then nothing needs reading to refuse it. Never
   * throws.
   */
  public static async mayHoldKey(
    connectionId: ObjectID | string,
    now: Date,
  ): Promise<boolean> {
    const id: string = connectionId.toString().toLowerCase();

    try {
      if (
        now.getTime() - CloudStreamKeyedConnections.readAt >=
        CLOUD_STREAM_KEYED_CONNECTIONS_REFRESH_MS
      ) {
        await CloudStreamKeyedConnections.refresh(now);
      }

      // A read another delivery started is waited for, not gone around.
      if (CloudStreamKeyedConnections.reading) {
        await CloudStreamKeyedConnections.reading;
      }

      if (CloudStreamKeyedConnections.holds(id) !== false) {
        return true;
      }

      // Not held: made in another process since the last read, perhaps.
      if (
        now.getTime() - CloudStreamKeyedConnections.readAt >=
        CLOUD_STREAM_KEYED_CONNECTIONS_MISS_REFRESH_MS
      ) {
        await CloudStreamKeyedConnections.refresh(now);
      }

      return CloudStreamKeyedConnections.holds(id) !== false;
    } catch {
      return true;
    }
  }

  // True or false when the ids say, undefined when they cannot.
  private static holds(id: string): boolean | undefined {
    if (
      !CloudStreamKeyedConnections.ids ||
      !CloudStreamKeyedConnections.isComplete
    ) {
      return undefined;
    }

    return CloudStreamKeyedConnections.ids.has(id);
  }

  // One read at a time, however many deliveries ask at once.
  private static async refresh(now: Date): Promise<void> {
    if (!CloudStreamKeyedConnections.reading) {
      CloudStreamKeyedConnections.reading = CloudStreamKeyedConnections.read(
        now,
      ).finally((): void => {
        CloudStreamKeyedConnections.reading = null;
      });
    }

    await CloudStreamKeyedConnections.reading;
  }

  private static async read(now: Date): Promise<void> {
    // Read or not, not asked again until its time: a failing read is not hammered.
    CloudStreamKeyedConnections.readAt = now.getTime();

    try {
      const ids: Array<string> = await CloudStreamKeyedConnections.readIds(
        CLOUD_STREAM_MAX_KEYED_CONNECTIONS + 1,
      );

      CloudStreamKeyedConnections.isComplete =
        ids.length <= CLOUD_STREAM_MAX_KEYED_CONNECTIONS;
      CloudStreamKeyedConnections.ids = new Set<string>(
        ids.slice(0, CLOUD_STREAM_MAX_KEYED_CONNECTIONS),
      );
    } catch (error) {
      logger.warn(
        `Cloud streams: the connections that hold a stream key could not be read, so each delivery's connection is read instead. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
