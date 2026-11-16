import GlobalCache from "../../Infrastructure/GlobalCache";
import MonitorService from "../../Services/MonitorService";
import logger from "../Logger";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ObjectID from "../../../Types/ObjectID";

/*
 * The labels of an Incoming Request monitor, for deciding whether an
 * incoming request secret limited to monitors with labels covers it (issue
 * #8501). Read only for a project that has such a secret
 * (IncomingRequestSecretPolicy.hasLabelScopedSecret), and kept in Redis for a
 * minute, as the monitor its URL's key names is (MonitorSecretKeyCache): a
 * sender calling every second costs one read a minute. A label added to or
 * taken from a monitor is therefore seen within the minute.
 *
 * A Redis that cannot be reached is a miss. A Postgres that cannot be read
 * throws: the caller decides nothing rather than refusing a request whose
 * secret it could not judge (the edge leaves it to the worker, the worker's
 * job is tried again).
 */
export default class IncomingRequestMonitorLabels {
  public static readonly NAMESPACE: string = "incoming-request-monitor-labels";

  public static readonly EXPIRES_IN_SECONDS: number = 60;

  public static async getLabelIds(
    monitorId: ObjectID | string,
  ): Promise<Array<string>> {
    const key: string = monitorId.toString().toLowerCase();

    try {
      const kept: string | null = await GlobalCache.getString(
        this.NAMESPACE,
        key,
      );

      const labelIds: Array<string> | null = this.fromKept(kept);

      if (labelIds) {
        return labelIds;
      }
    } catch (err) {
      logger.debug(
        "Could not read an Incoming Request monitor's labels from the cache. Reading them from the database.",
      );
      logger.debug(err);
    }

    const monitor: Monitor | null = await MonitorService.findOneById({
      id: new ObjectID(key),
      select: {
        labels: {
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    const labelIds: Array<string> = [];

    for (const label of monitor?.labels || []) {
      if (label.id) {
        labelIds.push(label.id.toString().toLowerCase());
      }
    }

    try {
      await GlobalCache.setString(
        this.NAMESPACE,
        key,
        JSON.stringify(labelIds),
        { expiresInSeconds: this.EXPIRES_IN_SECONDS },
      );
    } catch (err) {
      logger.debug(
        "Could not keep an Incoming Request monitor's labels in the cache.",
      );
      logger.debug(err);
    }

    return labelIds;
  }

  private static fromKept(kept: string | null): Array<string> | null {
    if (kept === null || kept === undefined) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(kept);

      if (
        Array.isArray(parsed) &&
        parsed.every((item: unknown): boolean => {
          return typeof item === "string";
        })
      ) {
        return parsed as Array<string>;
      }
    } catch {
      // Not what was kept: read it again.
    }

    return null;
  }
}
