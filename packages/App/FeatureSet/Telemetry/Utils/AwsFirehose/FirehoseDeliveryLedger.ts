import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";

/*
 * THE FIREHOSE DELIVERIES A CONNECTION'S STREAMS HAVE HAD TAKEN.
 *
 * Firehose sends a batch again, with the same request id, whenever it did
 * not read a 200 - the answer was lost on the way back, the connection
 * dropped after the batch was queued. A batch this ledger says was taken
 * is answered 200 at once and not queued again, so a retry never writes
 * its datapoints and log lines twice.
 *
 * A request id is kept for three hours, longer than any Firehose stream
 * goes on sending one batch (two hours at most), per connection: one
 * stream's ids are never another's. A batch is written to the ledger only
 * once every part of it was queued, so one that failed half way is queued
 * again whole when Firehose sends it again.
 *
 * Without Redis nothing is remembered, and nothing stops a delivery: the
 * telemetry queue lives in Redis too, so a delivery is then answered 503
 * and sent again anyway.
 */

export const FIREHOSE_LEDGER_TTL_SECONDS: number = 3 * 60 * 60;
const LEDGER_KEY_PREFIX: string = "cloudstream:delivery:";

export default class FirehoseDeliveryLedger {
  private static keyOf(connectionId: ObjectID, requestId: string): string {
    return `${LEDGER_KEY_PREFIX}${connectionId.toString()}:${requestId}`;
  }

  private static getClient(): ClientType | null {
    const client: ClientType | null = Redis.getClient();
    return client && Redis.isConnected() ? client : null;
  }

  public static async wasTaken(data: {
    connectionId: ObjectID;
    requestId: string;
  }): Promise<boolean> {
    const client: ClientType | null = FirehoseDeliveryLedger.getClient();

    if (!client || !data.requestId) {
      return false;
    }

    try {
      return (
        (await client.get(
          FirehoseDeliveryLedger.keyOf(data.connectionId, data.requestId),
        )) !== null
      );
    } catch (error) {
      logger.warn(
        `Cloud stream ${data.connectionId.toString()}: whether a delivery was taken before could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  public static async markTaken(data: {
    connectionId: ObjectID;
    requestId: string;
  }): Promise<void> {
    const client: ClientType | null = FirehoseDeliveryLedger.getClient();

    if (!client || !data.requestId) {
      return;
    }

    try {
      await client.set(
        FirehoseDeliveryLedger.keyOf(data.connectionId, data.requestId),
        "1",
        "EX",
        FIREHOSE_LEDGER_TTL_SECONDS,
      );
    } catch (error) {
      logger.warn(
        `Cloud stream ${data.connectionId.toString()}: a delivery taken could not be noted: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
