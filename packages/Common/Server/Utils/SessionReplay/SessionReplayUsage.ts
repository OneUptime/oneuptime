import Redis, { ClientType } from "../../Infrastructure/Redis";
import logger from "../Logger";
import ObjectID from "../../../Types/ObjectID";

/*
 * Session replay byte-budget bookkeeping shared between the two sides that
 * need it: the App-tier ingest gate CONSUMES these counters (INCRBY, in
 * App/FeatureSet/Telemetry/Utils/SessionReplayRateLimiter.ts) and the
 * Dashboard-facing TelemetryAPI READS them so a customer can see "you have
 * used 800MB of today's budget" instead of inferring exhaustion from
 * recordings that silently stop appearing.
 *
 * The key builders live here, in Common, precisely so those two callers
 * cannot drift: the ingest gate charging one key while the dashboard reads
 * another would report a healthy budget forever.
 */

const DAILY_PROJECT_BYTE_KEY_PREFIX: string = "replay:rate:bytes:";
const MONTHLY_APP_BYTE_KEY_PREFIX: string = "replay:rate:bytes-month:";

/*
 * Keys per MGET in readByteCounters. A sweep over every replay-enabled
 * application reads a key or two per application; chunking keeps any one
 * command (and its reply) small no matter how many there are.
 */
export const BYTE_COUNTER_MGET_CHUNK_SIZE: number = 500;

export default class SessionReplayUsage {
  /*
   * UTC rather than local, so the budget window is the same for every pod
   * regardless of container timezone.
   */
  public static getUtcDayBucket(): string {
    return new Date().toISOString().substring(0, 10);
  }

  /* "YYYY-MM", UTC, for the per-application monthly budget window. */
  public static getUtcMonthBucket(): string {
    return new Date().toISOString().substring(0, 7);
  }

  public static getDailyProjectByteKey(projectId: ObjectID): string {
    return `${DAILY_PROJECT_BYTE_KEY_PREFIX}${projectId.toString()}:${this.getUtcDayBucket()}`;
  }

  public static getMonthlyApplicationByteKey(data: {
    projectId: ObjectID;
    rumApplicationId: ObjectID;
  }): string {
    return `${MONTHLY_APP_BYTE_KEY_PREFIX}${data.projectId.toString()}:${data.rumApplicationId.toString()}:${this.getUtcMonthBucket()}`;
  }

  /*
   * Bytes consumed from the project's daily budget so far. Read-only.
   *
   * null means "unknown" (Redis unavailable), which callers must render as
   * unknown rather than as zero: a dashboard telling a customer their usage
   * is 0 while the gate is refusing chunks would be worse than no number.
   */
  public static async getProjectBytesUsedToday(
    projectId: ObjectID,
  ): Promise<number | null> {
    return this.readCounter(this.getDailyProjectByteKey(projectId));
  }

  /* Bytes consumed from the application's monthly budget. Read-only. */
  public static async getApplicationBytesUsedThisMonth(data: {
    projectId: ObjectID;
    rumApplicationId: ObjectID;
  }): Promise<number | null> {
    return this.readCounter(this.getMonthlyApplicationByteKey(data));
  }

  /*
   * Many counters in as few round trips as possible, for the sweep that
   * publishes every replay-enabled application's budget as metrics
   * (SessionReplayBudgetMetrics). The answer is positional: values[i] is
   * keys[i], read with the same per-key rules as the single-key readers
   * (absent or non-numeric is 0).
   *
   * All or nothing: null when Redis is unavailable or any chunk fails. A
   * caller that got half the counters could not tell which half is real,
   * and a counter it failed to read must never be published as 0 - that
   * reads as "no usage" to every monitor watching the series.
   *
   * Values are returned as stored, not clamped: a refund that straddles
   * 00:00 UTC can leave a negative daily key (see
   * SessionReplayRateLimiter.refundByteBudget), and what a negative count
   * should mean is the caller's decision.
   */
  public static async readByteCounters(
    keys: Array<string>,
  ): Promise<Array<number> | null> {
    if (keys.length === 0) {
      return [];
    }

    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return null;
    }

    const values: Array<number> = [];

    try {
      for (
        let start: number = 0;
        start < keys.length;
        start += BYTE_COUNTER_MGET_CHUNK_SIZE
      ) {
        const chunk: Array<string> = keys.slice(
          start,
          start + BYTE_COUNTER_MGET_CHUNK_SIZE,
        );

        const stored: Array<string | null> = await client.mget(chunk);

        if (!Array.isArray(stored) || stored.length !== chunk.length) {
          throw new Error(
            `MGET answered ${Array.isArray(stored) ? stored.length : "no"} values for ${chunk.length} keys`,
          );
        }

        for (const value of stored) {
          values.push(this.parseCounterValue(value));
        }
      }
    } catch (err) {
      logger.warn(
        `SessionReplayUsage: could not read ${keys.length} byte counters`,
      );
      logger.warn(err);
      return null;
    }

    return values;
  }

  private static async readCounter(key: string): Promise<number | null> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return null;
    }

    try {
      const value: string | null = await client.get(key);

      return this.parseCounterValue(value);
    } catch (err) {
      logger.warn(
        `SessionReplayUsage: could not read the byte counter at ${key}`,
      );
      logger.warn(err);
      return null;
    }
  }

  // An absent key has counted nothing yet; a non-numeric one counts as 0 too.
  private static parseCounterValue(value: string | null): number {
    if (value === null) {
      return 0;
    }

    const parsed: number = parseInt(value, 10);

    return isNaN(parsed) ? 0 : parsed;
  }
}
