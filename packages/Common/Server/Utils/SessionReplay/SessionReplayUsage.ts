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

  private static async readCounter(key: string): Promise<number | null> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return null;
    }

    try {
      const value: string | null = await client.get(key);

      if (value === null) {
        return 0;
      }

      const parsed: number = parseInt(value, 10);

      return isNaN(parsed) ? 0 : parsed;
    } catch (err) {
      logger.warn(
        `SessionReplayUsage: could not read the byte counter at ${key}`,
      );
      logger.warn(err);
      return null;
    }
  }
}
