import Redis, { ClientType } from "../../Infrastructure/Redis";
import Queue, { QueueName } from "../../Infrastructure/Queue";
import logger from "../Logger";

/*
 * AUTOSCALING THAT DOES NOT FEED A CLICKHOUSE THAT IS PUSHING BACK
 * (2026-11-27).
 *
 * KEDA scales the workers on the queues' backlog (/metrics/queue-size):
 * desired replicas = backlog / queueSizeThreshold. On 2026-11-27 ClickHouse
 * refused metric inserts (TOO_MANY_PARTS) for hours. The Telemetry queue's
 * backlog grew because its jobs could not be stored, not because there were
 * too few workers to store them, yet the backlog was all KEDA saw: it scaled
 * the workers from 10 to 139, every new worker added inserts to the
 * ClickHouse that was refusing them, and the crowded node pool kept an App
 * pod waiting for a node.
 *
 * So a writer whose insert ClickHouse refuses for being overloaded - or
 * cannot reach at all - marks it in Valkey, for every pod to read
 * (TelemetryFanInWriter records every insert failure it retries). While a
 * writer did in the last BACKPRESSURE_WINDOW_MS, the backlog the autoscaler
 * reads leaves out the bulk telemetry waiting in the Telemetry queue, its
 * prioritized set: more workers cannot store it faster. Everything else
 * still counts - the monitoring work waiting in the same queue, the Worker,
 * Workflow, Runbook and AI investigation queues - so the fleet still scales
 * for them, and the bulk telemetry counts again once ClickHouse has taken
 * inserts for two minutes.
 */

export const TELEMETRY_INSERT_BACKPRESSURE_KEY: string =
  "oneuptime:telemetry:clickhouse-insert-backpressure";

// How long one refused insert keeps the bulk backlog out of the scaling signal.
export const BACKPRESSURE_WINDOW_MS: number = 2 * 60 * 1000;

/*
 * A writer marks it at most this often, however many of its inserts fail:
 * a write per failed insert would add load to a Valkey already carrying the
 * flood that caused it.
 */
export const RECORD_INTERVAL_MS: number = 10_000;

export default class TelemetryInsertBackpressure {
  private static lastRecordedAtMs: number | null = null;

  /*
   * An insert ClickHouse refused for overload, or could not be reached for.
   * Fire and forget: never throws, never waits, and a Valkey it cannot reach
   * marks nothing.
   */
  public static record(nowMs?: number | undefined): void {
    const now: number = nowMs ?? Date.now();

    if (
      this.lastRecordedAtMs !== null &&
      now - this.lastRecordedAtMs < RECORD_INTERVAL_MS
    ) {
      return;
    }

    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return;
    }

    this.lastRecordedAtMs = now;

    client
      .set(
        TELEMETRY_INSERT_BACKPRESSURE_KEY,
        String(now),
        "PX",
        BACKPRESSURE_WINDOW_MS,
      )
      .catch((err: unknown) => {
        logger.debug(
          `TelemetryInsertBackpressure: could not mark ClickHouse as pushing back: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }

  // Whether any writer had an insert refused in the last two minutes.
  public static async isActive(): Promise<boolean> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return false;
    }

    try {
      return (await client.exists(TELEMETRY_INSERT_BACKPRESSURE_KEY)) > 0;
    } catch {
      return false;
    }
  }

  /*
   * The Telemetry queue's backlog as the autoscaler is to read it: without
   * its bulk telemetry while ClickHouse is pushing back, as the top of the
   * file says.
   */
  public static async getTelemetryBacklogForScaling(): Promise<number> {
    const isPushingBack: boolean = await this.isActive();

    return Queue.getQueueBacklogSize(QueueName.Telemetry, {
      withoutPrioritized: isPushingBack,
    });
  }

  // For tests.
  public static reset(): void {
    this.lastRecordedAtMs = null;
  }
}
