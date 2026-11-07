import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";

/*
 * THE DELIVERIES A CONNECTION'S STREAMS HAVE HAD TAKEN.
 *
 * Firehose sends a batch again, with the same request id, whenever it did
 * not read a 200 - the answer was lost on the way back, the connection
 * dropped after the batch was queued - and Pub/Sub pushes a message again,
 * with the same message id, whenever it did not read a 2xx. A delivery
 * this ledger says was taken is answered at once and not queued again, so
 * a retry never writes its datapoints and log lines twice.
 *
 * Each stream keeps ids for a while longer than its sender goes on sending
 * one delivery again, per connection: one stream's ids are never another's.
 * Firehose sends one batch for up to two hours, so its ids are kept three
 * (FIREHOSE_LEDGER_TTL_SECONDS); Pub/Sub pushes a message again within its
 * ack deadline and backoff, minutes, and sends one message a request, so
 * its ids are kept a quarter of an hour (PUBSUB_LEDGER_TTL_SECONDS) - one
 * small key each. A delivery is written to the ledger only once every part
 * of it was queued, so one that failed half way is queued again whole when
 * it is sent again.
 *
 * Without Redis nothing is remembered, and nothing stops a delivery: the
 * telemetry queue lives in Redis too, so a delivery is then answered so
 * that it is sent again anyway.
 */

export const FIREHOSE_LEDGER_TTL_SECONDS: number = 3 * 60 * 60;
export const PUBSUB_LEDGER_TTL_SECONDS: number = 15 * 60;

export class DeliveryLedger {
  private prefix: string;
  private ttlSeconds: number;

  public constructor(data: { prefix: string; ttlSeconds: number }) {
    this.prefix = data.prefix;
    this.ttlSeconds = data.ttlSeconds;
  }

  private keyOf(connectionId: ObjectID, deliveryId: string): string {
    return `${this.prefix}${connectionId.toString()}:${deliveryId}`;
  }

  private getClient(): ClientType | null {
    const client: ClientType | null = Redis.getClient();
    return client && Redis.isConnected() ? client : null;
  }

  public async wasTaken(data: {
    connectionId: ObjectID;
    requestId: string;
  }): Promise<boolean> {
    const client: ClientType | null = this.getClient();

    if (!client || !data.requestId) {
      return false;
    }

    try {
      return (
        (await client.get(this.keyOf(data.connectionId, data.requestId))) !==
        null
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

  public async markTaken(data: {
    connectionId: ObjectID;
    requestId: string;
  }): Promise<void> {
    const client: ClientType | null = this.getClient();

    if (!client || !data.requestId) {
      return;
    }

    try {
      await client.set(
        this.keyOf(data.connectionId, data.requestId),
        "1",
        "EX",
        this.ttlSeconds,
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

const FIREHOSE_LEDGER: DeliveryLedger = new DeliveryLedger({
  prefix: "cloudstream:delivery:",
  ttlSeconds: FIREHOSE_LEDGER_TTL_SECONDS,
});

export const PUBSUB_LEDGER: DeliveryLedger = new DeliveryLedger({
  prefix: "cloudstream:pubsub:",
  ttlSeconds: PUBSUB_LEDGER_TTL_SECONDS,
});

export default class FirehoseDeliveryLedger {
  public static async wasTaken(data: {
    connectionId: ObjectID;
    requestId: string;
  }): Promise<boolean> {
    return await FIREHOSE_LEDGER.wasTaken(data);
  }

  public static async markTaken(data: {
    connectionId: ObjectID;
    requestId: string;
  }): Promise<void> {
    await FIREHOSE_LEDGER.markTaken(data);
  }
}
