import GlobalCache from "../../Infrastructure/GlobalCache";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { createHash } from "crypto";

/*
 * When OneUptime last RECEIVED a request on an Incoming Request monitor's URL,
 * kept in Redis per secret key, as epoch milliseconds.
 *
 * Why this exists: the ingest endpoint answers 2xx and queues the request,
 * and a Telemetry worker evaluates it later. The time a heartbeat is
 * persisted is therefore the time a worker got to it, not the time it
 * arrived - and the heartbeat cron, which judges "received in the last N
 * minutes" every 30 seconds, used to read only that persisted time. Any
 * Telemetry backlog longer than the window then looked exactly like a sender
 * that had stopped, and every heartbeat monitor on the platform flipped
 * Offline together while its sender was still getting 2xx responses. Same-
 * monitor coalescing made it worse: a request that arrives while the
 * monitor's previous job is still WAITING in the queue is dropped, so under a
 * backlog a monitor's persisted heartbeat advanced only once per trip through
 * the queue.
 *
 * The receipt time is recorded at the edge, when the request arrives, so
 * liveness no longer depends on how far behind the queue is or on which
 * coalesced payload survives:
 *
 *   - the ingest endpoint advances the marker on every request (advanceIfTracked),
 *   - the ingest worker and the heartbeat cron create or advance it and read
 *     back the latest receipt (track), which is what they persist and judge.
 *
 * The endpoint is unauthenticated - anyone can POST to any secret key - so it
 * may only ADVANCE a marker that a trusted caller already created. The worker
 * creates one only after it has resolved the key to a monitor, and the cron
 * only for monitors it is checking, so a flood of made-up keys never creates
 * a single Redis key.
 *
 * Every call is best effort. A Redis failure falls back to the time the
 * caller already had - exactly the behaviour before this store existed - and
 * never fails the request, the ingest job or the cron tick.
 */
export default class IncomingRequestReceivedAtStore {
  public static readonly NAMESPACE: string = "incoming-request-received-at";

  /*
   * The cron re-arms the expiry of every monitor it checks every 30 seconds
   * and each request re-arms it again, so the TTL only has to outlive gaps in
   * both - a worker outage, a long queue backlog. A day is far beyond either,
   * and still lets markers of deleted or paused monitors age out.
   */
  public static readonly EXPIRES_IN_SECONDS: number =
    OneUptimeDate.getSecondsInDays(1);

  /*
   * Ingest edge: record that a request on this secret key arrived at
   * receivedAt, if the key is one a trusted caller has registered. Never
   * creates a key and never throws.
   */
  @CaptureSpan()
  public static async advanceIfTracked(data: {
    secretKey: string | ObjectID;
    receivedAt: Date;
  }): Promise<void> {
    const key: string | null = this.getKey(data.secretKey);
    const receivedAtInMs: number | null = this.toEpochMs(data.receivedAt);

    if (!key || receivedAtInMs === null) {
      return;
    }

    try {
      await GlobalCache.setNumberIfGreater(
        this.NAMESPACE,
        key,
        receivedAtInMs,
        {
          expiresInSeconds: this.EXPIRES_IN_SECONDS,
          onlyIfExists: true,
        },
      );
    } catch (err) {
      logger.error(
        "Could not record the arrival of an incoming request. The heartbeat falls back to the time it is processed.",
      );
      logger.error(err);
    }
  }

  /*
   * Ingest worker and heartbeat cron: create or advance the marker with
   * receivedAt and return the latest receipt OneUptime knows of for this
   * secret key - never earlier than receivedAt. Falls back to receivedAt when
   * there is no secret key or Redis is unavailable.
   */
  @CaptureSpan()
  public static async track(data: {
    secretKey: string | ObjectID | null | undefined;
    receivedAt: Date;
  }): Promise<Date> {
    const receivedAtInMs: number | null = this.toEpochMs(data.receivedAt);

    if (receivedAtInMs === null) {
      return data.receivedAt;
    }

    const receivedAt: Date = new Date(receivedAtInMs);
    const key: string | null = this.getKey(data.secretKey);

    if (!key) {
      return receivedAt;
    }

    try {
      const latestInMs: number | null = await GlobalCache.setNumberIfGreater(
        this.NAMESPACE,
        key,
        receivedAtInMs,
        {
          expiresInSeconds: this.EXPIRES_IN_SECONDS,
        },
      );

      if (latestInMs === null || latestInMs <= receivedAtInMs) {
        return receivedAt;
      }

      return new Date(latestInMs);
    } catch (err) {
      logger.error(
        "Could not read when this incoming request monitor last received a request. Falling back to the stored time.",
      );
      logger.error(err);
      return receivedAt;
    }
  }

  /*
   * The receipt to judge a check at checkedAt by. Markers are written with
   * the clock of whichever pod received the request, so one running slightly
   * ahead can put a receipt after the check that reads it - and the
   * criteria measure that gap without its sign, as if it were a heartbeat
   * that old. Nothing can have been received after the check that observed
   * it, so clamp. Anything that is not a Date (a stored value track() could
   * not parse) is passed through untouched, as it was before this existed.
   */
  public static getReceivedAtAsOf(receivedAt: Date, checkedAt: Date): Date {
    if (
      receivedAt instanceof Date &&
      receivedAt.getTime() > checkedAt.getTime()
    ) {
      return checkedAt;
    }

    return receivedAt;
  }

  /*
   * The secret key travels in the URL, so hash it rather than spell it out in
   * Redis key names. Lower-cased first: Postgres matches the uuid column
   * case-insensitively, so a sender that writes the key in upper case reaches
   * the same monitor and must reach the same marker.
   */
  public static getKey(
    secretKey: string | ObjectID | null | undefined,
  ): string | null {
    const normalized: string = (secretKey?.toString() || "")
      .trim()
      .toLowerCase();

    if (!normalized) {
      return null;
    }

    return createHash("sha256").update(normalized).digest("hex");
  }

  private static toEpochMs(date: Date | string): number | null {
    try {
      const time: number = OneUptimeDate.fromString(date).getTime();
      return Number.isFinite(time) ? Math.floor(time) : null;
    } catch {
      return null;
    }
  }
}
