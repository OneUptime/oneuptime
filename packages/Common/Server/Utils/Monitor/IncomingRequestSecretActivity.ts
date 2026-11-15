import GlobalCache from "../../Infrastructure/GlobalCache";
import MonitorService from "../../Services/MonitorService";
import logger from "../Logger";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OneUptimeDate from "../../../Types/Date";
import { IncomingRequestSecretProblem } from "../../../Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import ObjectID from "../../../Types/ObjectID";
import PartialEntity from "../../../Types/Database/PartialEntity";

/*
 * Whether an Incoming Request monitor's senders send one of the project's
 * incoming request secrets (issue #8498), kept on the monitor:
 *
 *   - incomingRequestWithSecretAt: when a request with one last came;
 *   - incomingRequestWithoutSecretAt and incomingRequestWithoutSecretReason:
 *     when one without a valid secret last came, and whether it sent none or
 *     a wrong one.
 *
 * Recorded only while the project has a secret (a request is checked against
 * the project's secrets whether or not it requires one yet), by the endpoint
 * for a request it refuses - which never reaches the worker - and by the
 * worker for every request it processes. So before the requirement is turned
 * on, Monitors > Settings > Incoming Request Secrets lists the monitors whose
 * senders would be refused; after, the monitor's heartbeat URL says its
 * requests are.
 *
 * At most once per monitor every five minutes for each of the two, across
 * every pod: a sender calling every second costs one hook-free UPDATE in five
 * minutes, and so does a stranger hammering a monitor's URL without the
 * secret. The times are therefore "about", to the nearest five minutes. No
 * index names these columns, so the update stays a HOT one. Nothing a refused
 * sender sent is kept beyond whether it had a secret: refusals are
 * unauthenticated.
 *
 * Never throws: it is bookkeeping, and must not fail a request or a job.
 */
export default class IncomingRequestSecretActivity {
  public static readonly NAMESPACE: string = "incoming-request-secret-activity";

  public static readonly EVERY_SECONDS: number = 5 * 60;

  public static async record(data: {
    monitorId: ObjectID | string | undefined | null;
    sentValidSecret: boolean;
    problem?: IncomingRequestSecretProblem | undefined;
  }): Promise<void> {
    const monitorId: string = data.monitorId?.toString() || "";

    if (!ObjectID.isValidUUID(monitorId)) {
      return;
    }

    try {
      const isFirstInWindow: boolean = await GlobalCache.setStringIfNotExists(
        this.NAMESPACE,
        `${data.sentValidSecret ? "with" : "without"}-${monitorId}`,
        "1",
        { expiresInSeconds: this.EVERY_SECONDS },
      );

      if (!isFirstInWindow) {
        return;
      }

      const now: Date = OneUptimeDate.getCurrentDate();

      const columns: PartialEntity<Monitor> = data.sentValidSecret
        ? { incomingRequestWithSecretAt: now }
        : {
            incomingRequestWithoutSecretAt: now,
            incomingRequestWithoutSecretReason:
              data.problem || IncomingRequestSecretProblem.NoSecret,
          };

      /*
       * A stamp, not a change: no hooks, and updatedAt left as whoever last
       * edited the monitor left it.
       */
      await MonitorService.updateColumnsByIdWithoutHooks({
        id: new ObjectID(monitorId),
        data: columns,
        skipUpdateDateColumn: true,
      });
    } catch (err) {
      logger.debug(
        "Could not record whether an incoming request sent its project's secret.",
      );
      logger.debug(err);
    }
  }
}
