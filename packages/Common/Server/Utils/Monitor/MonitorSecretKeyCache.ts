import GlobalCache from "../../Infrastructure/GlobalCache";
import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";
import { createHash } from "crypto";

/*
 * Which monitor a secret key belongs to - a server monitor's agent key, an
 * incoming request monitor's URL key - kept in Redis for a minute.
 *
 * Every report an agent sends (every 30 seconds) and every request a sender
 * makes used to look its monitor up by key in Postgres before
 * MonitorResource read the same monitor again. The key is now looked up once
 * a minute at most; the read MonitorResource makes anyway checks it is
 * still the monitor's key (MonitorResourceOptions.secretKey), so a key that
 * was rotated or a monitor that was deleted stops working at once - the
 * caller forgets the entry and the job ends as it did before (the monitor is
 * not found). A monitor archived, disabled, or paused by a manually created
 * incident or a maintenance event inside the minute ends the same way
 * MonitorResource ends any result for one (its ExceptionMessages refusal,
 * which the ingest jobs complete without retrying -
 * isNonActionableIngestError); a project blocked or made a sample project is
 * skipped by MonitorResource as before. What the lookup alone checked - a project's subscription still
 * active - holds for at most this minute.
 *
 * Keys are hashed in the Redis key names, as IncomingRequestReceivedAtStore
 * does: a secret key never appears in Redis. Nothing here throws: a Redis
 * that cannot be reached is a miss, and the caller looks the key up.
 */

export enum MonitorSecretKeyKind {
  ServerMonitor = "server-monitor",
  IncomingRequest = "incoming-request",
}

// The monitor a key belongs to, and the monitor's project.
export interface MonitorOfSecretKey {
  monitorId: ObjectID;
  projectId: ObjectID;
}

export default class MonitorSecretKeyCache {
  public static readonly NAMESPACE: string = "monitor-secret-key";

  public static readonly EXPIRES_IN_SECONDS: number = 60;

  // The monitor the key belongs to, as last looked up; null when unknown.
  public static async getMonitor(data: {
    kind: MonitorSecretKeyKind;
    secretKey: string;
  }): Promise<MonitorOfSecretKey | null> {
    const key: string | null = this.getKey(data);

    if (!key) {
      return null;
    }

    try {
      const value: string | null = await GlobalCache.getString(
        this.NAMESPACE,
        key,
      );

      const [monitorId, projectId]: Array<string> = (value || "").split(":");

      return monitorId &&
        projectId &&
        ObjectID.isValidUUID(monitorId) &&
        ObjectID.isValidUUID(projectId)
        ? {
            monitorId: new ObjectID(monitorId),
            projectId: new ObjectID(projectId),
          }
        : null;
    } catch (err) {
      logger.debug("Could not read a monitor's secret key from the cache.");
      logger.debug(err);
      return null;
    }
  }

  public static async setMonitor(data: {
    kind: MonitorSecretKeyKind;
    secretKey: string;
    monitor: MonitorOfSecretKey;
  }): Promise<void> {
    const key: string | null = this.getKey(data);

    if (!key) {
      return;
    }

    try {
      await GlobalCache.setString(
        this.NAMESPACE,
        key,
        `${data.monitor.monitorId.toString()}:${data.monitor.projectId.toString()}`,
        { expiresInSeconds: this.EXPIRES_IN_SECONDS },
      );
    } catch (err) {
      logger.debug("Could not keep a monitor's secret key in the cache.");
      logger.debug(err);
    }
  }

  // A key that no longer names its monitor: looked up again next time.
  public static async forget(data: {
    kind: MonitorSecretKeyKind;
    secretKey: string;
  }): Promise<void> {
    const key: string | null = this.getKey(data);

    if (!key) {
      return;
    }

    try {
      await GlobalCache.deleteKey(this.NAMESPACE, key);
    } catch (err) {
      logger.debug("Could not forget a monitor's secret key in the cache.");
      logger.debug(err);
    }
  }

  /*
   * Lower-cased first: Postgres matches the uuid column case-insensitively,
   * so a key written in upper case reaches the same monitor and must reach
   * the same entry.
   */
  public static getKey(data: {
    kind: MonitorSecretKeyKind;
    secretKey: string;
  }): string | null {
    const normalized: string = (data.secretKey || "").trim().toLowerCase();

    if (!normalized) {
      return null;
    }

    return `${data.kind}-${createHash("sha256").update(normalized).digest("hex")}`;
  }
}
