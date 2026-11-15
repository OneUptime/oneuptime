import GlobalCache from "../../Infrastructure/GlobalCache";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";

/*
 * The newest check result each probe has sent for each monitor, by when the
 * probe checked (monitoredAt, the probe's own clock), kept in Redis.
 *
 * A probe's results for a monitor wait for the monitor's lock one after
 * another (MonitorResource). When they pile up - a backlog in the telemetry
 * queue, a slow database - a result that waited behind a newer one from the
 * same probe is no longer news: judged after it, it would put the monitor
 * back where the probe saw it a minute earlier; and one that gave up waiting
 * was failed and run again by the queue, adding to the pile. So a result is
 * recorded as seen when its job starts (record), and once it has the lock -
 * or could not get it - it asks whether a newer one from the same probe was
 * seen meanwhile (isSuperseded): if so it is dropped, and only the newest is
 * judged. A result with no newer one behind it is never dropped, and one
 * that could not get the lock is still failed and retried as before.
 *
 * Results that name no probe, or no time they were checked, are not ordered.
 * Nothing here throws: a Redis that cannot be reached orders nothing, and
 * every result is judged as before.
 */
export default class MonitorProbeResultOrder {
  public static readonly NAMESPACE: string = "monitor-probe-result-newest";

  // Longer than any backlog worth ordering; refreshed by every result.
  public static readonly EXPIRES_IN_SECONDS: number = 60 * 60;

  // Records this result as seen. Never throws.
  public static async record(input: {
    monitorId: ObjectID;
    probeId: ObjectID | undefined;
    checkedAt: Date | string | undefined;
  }): Promise<void> {
    const key: string | null = this.getKey(input);
    const checkedAtInMs: number | null = this.toEpochMs(input.checkedAt);

    if (!key || checkedAtInMs === null) {
      return;
    }

    try {
      await GlobalCache.setNumberIfGreater(this.NAMESPACE, key, checkedAtInMs, {
        expiresInSeconds: this.EXPIRES_IN_SECONDS,
      });
    } catch (err) {
      logger.debug("Could not record a probe result's order.");
      logger.debug(err);
    }
  }

  /*
   * Whether a result the same probe checked later has been seen for the
   * same monitor. False when it cannot be told. Never throws.
   */
  public static async isSuperseded(input: {
    monitorId: ObjectID;
    probeId: ObjectID | undefined;
    checkedAt: Date | string | undefined;
  }): Promise<boolean> {
    const key: string | null = this.getKey(input);
    const checkedAtInMs: number | null = this.toEpochMs(input.checkedAt);

    if (!key || checkedAtInMs === null) {
      return false;
    }

    try {
      const newest: string | null = await GlobalCache.getString(
        this.NAMESPACE,
        key,
      );
      const newestInMs: number = Number(newest);

      return Boolean(newest) && Number.isFinite(newestInMs)
        ? newestInMs > checkedAtInMs
        : false;
    } catch (err) {
      logger.debug("Could not read a probe result's order.");
      logger.debug(err);
      return false;
    }
  }

  private static getKey(input: {
    monitorId: ObjectID;
    probeId: ObjectID | undefined;
  }): string | null {
    if (!input.monitorId || !input.probeId) {
      return null;
    }

    return `${input.monitorId.toString().toLowerCase()}-${input.probeId
      .toString()
      .toLowerCase()}`;
  }

  private static toEpochMs(value: Date | string | undefined): number | null {
    if (!value) {
      return null;
    }

    try {
      const time: number = OneUptimeDate.fromString(value).getTime();
      return Number.isFinite(time) ? Math.floor(time) : null;
    } catch {
      return null;
    }
  }
}
