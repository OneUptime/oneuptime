import GoogleSecOpsConnection from "../../../../Models/DatabaseModels/GoogleSecOpsConnection";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import GoogleSecOpsAlertNormalizer from "../../../../Utils/SecurityEvent/GoogleSecOpsAlertNormalizer";
import GoogleSecOpsConnectionService from "../../../Services/GoogleSecOpsConnectionService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../Services/SecurityEventService";
import { resolveTelemetryRetentionInDays } from "../../../../Types/Telemetry/TelemetryRetentionConfig";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import ConnectorErrorMessage from "../ConnectorErrorMessage";
import { buildSecurityEventDbRow } from "../SecurityEventRow";
import ThreatIntelEnricher from "../ThreatIntel/ThreatIntelEnricher";
import GoogleSecOpsClient, { FetchAlertsResult } from "./GoogleSecOpsClient";

const SECOPS_SERVICE_NAME: string = "Google SecOps";

/*
 * First poll (no cursor) and the cap for how far back a stale cursor may
 * reach. A connection disabled for a week must not replay a week of
 * alerts in one tick.
 */
const DEFAULT_LOOKBACK_IN_MINUTES: number = 15;
const MAX_LOOKBACK_IN_MINUTES: number = 24 * 60;

/*
 * Overlap between windows so boundary alerts are never missed; the
 * eventUid content hash keeps redelivered alerts deduplicatable.
 *
 * Still open (out of scope here): the overlap does produce genuine
 * duplicate rows, because SecurityEvent is a plain MergeTree with
 * eventUid outside the sort key, so nothing collapses them at write time.
 */
const WINDOW_OVERLAP_IN_MINUTES: number = 1;

export default class GoogleSecOpsPoller {
  @CaptureSpan()
  public static async pollAllDueConnections(): Promise<void> {
    const connections: Array<GoogleSecOpsConnection> =
      await GoogleSecOpsConnectionService.findBy({
        query: {
          isEnabled: true,
        },
        select: {
          _id: true,
          projectId: true,
          name: true,
          region: true,
          instanceResourceName: true,
          serviceAccountJson: true,
          pollIntervalInMinutes: true,
          lastPolledAt: true,
          cursor: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

    const now: Date = OneUptimeDate.getCurrentDate();

    for (const connection of connections) {
      const intervalInMinutes: number = Math.max(
        1,
        connection.pollIntervalInMinutes || 5,
      );

      if (connection.lastPolledAt) {
        const dueAt: Date = OneUptimeDate.addRemoveMinutes(
          connection.lastPolledAt,
          intervalInMinutes,
        );

        if (OneUptimeDate.isAfter(dueAt, now)) {
          continue;
        }
      }

      try {
        const ingested: number = await this.pollConnection(connection);

        /*
         * The count used to be returned and dropped on the floor, which
         * left "polling healthy but quiet" and "polling silently broken"
         * looking identical from outside the process. At info rather than
         * debug for that reason — a number nobody sees at the default log
         * level answers the question no better than not having it.
         */
        logger.info(
          `GoogleSecOpsPoller: connection ${connection.id?.toString()} ingested ${ingested} security events.`,
        );
      } catch (error) {
        logger.error(
          `GoogleSecOpsPoller: error polling connection ${connection.id?.toString()}:`,
        );
        logger.error(error);

        /*
         * Stamping the failure is best-effort and must never take the
         * loop down with it: a throw here would skip every connection
         * still due in this tick and leave this one's lastPolledAt and
         * lastError null, so the poller would look like it had simply
         * never run.
         */
        if (connection.id) {
          const connectionId: ObjectID = connection.id;

          await ConnectorErrorMessage.recordFailure({
            label: `GoogleSecOpsPoller: connection ${connectionId.toString()}`,
            write: async (): Promise<void> => {
              await GoogleSecOpsConnectionService.updateOneById({
                id: connectionId,
                data: {
                  lastPolledAt: OneUptimeDate.getCurrentDate(),
                  lastError: ConnectorErrorMessage.toMessage(error),
                },
                props: {
                  isRoot: true,
                },
              });
            },
          });
        }
      }
    }
  }

  @CaptureSpan()
  public static async pollConnection(
    connection: GoogleSecOpsConnection,
    clientOverride?: GoogleSecOpsClient | undefined,
  ): Promise<number> {
    if (
      !connection.id ||
      !connection.projectId ||
      !connection.region ||
      !connection.instanceResourceName ||
      !connection.serviceAccountJson
    ) {
      throw new Error(
        "Google SecOps connection is missing id, projectId, region, instance, or credentials.",
      );
    }

    const connectionId: string = connection.id.toString();

    const client: GoogleSecOpsClient =
      clientOverride ||
      new GoogleSecOpsClient({
        region: connection.region,
        instanceResourceName: connection.instanceResourceName,
        serviceAccountJson: connection.serviceAccountJson,
      });

    const endTime: Date = OneUptimeDate.getCurrentDate();

    const earliestAllowed: Date = OneUptimeDate.addRemoveMinutes(
      endTime,
      -MAX_LOOKBACK_IN_MINUTES,
    );

    const defaultStartTime: Date = OneUptimeDate.addRemoveMinutes(
      endTime,
      -DEFAULT_LOOKBACK_IN_MINUTES,
    );

    let startTime: Date = defaultStartTime;

    if (connection.cursor) {
      const cursorTime: Date = new Date(connection.cursor);

      if (Number.isNaN(cursorTime.getTime())) {
        /*
         * An unreadable cursor used to share a branch with a stale one and
         * open the full 24 hour window — the widest possible blast radius
         * for the least trustworthy input. It means "no usable cursor",
         * which is what a first poll means too.
         */
        logger.warn(
          `GoogleSecOpsPoller: connection ${connectionId} has an unreadable cursor ${JSON.stringify(
            connection.cursor,
          )}; polling the default ${DEFAULT_LOOKBACK_IN_MINUTES} minute window instead.`,
        );
      } else {
        startTime = OneUptimeDate.addRemoveMinutes(
          cursorTime,
          -WINDOW_OVERLAP_IN_MINUTES,
        );
      }
    }

    if (OneUptimeDate.isBefore(startTime, earliestAllowed)) {
      /*
       * The alerts between the cursor and the cap are skipped and will
       * never be fetched again, so the gap has to be stated. Silently
       * truncating it is how a connector comes back from an outage
       * looking healthy while a day of detections is simply missing.
       */
      logger.warn(
        `GoogleSecOpsPoller: connection ${connectionId} would poll from ${startTime.toISOString()}, ${OneUptimeDate.getMinutesBetweenTwoDates(
          startTime,
          endTime,
        )} minutes back and past the ${MAX_LOOKBACK_IN_MINUTES} minute cap; alerts before ${earliestAllowed.toISOString()} are skipped and will not be fetched again.`,
      );

      startTime = earliestAllowed;
    }

    if (!OneUptimeDate.isBefore(startTime, endTime)) {
      /*
       * A cursor in the future — clock skew on the writer, or a restored
       * backup — used to send Chronicle an inverted timeRange, which is
       * neither an error the operator sees nor a window that returns
       * anything.
       */
      logger.warn(
        `GoogleSecOpsPoller: connection ${connectionId} cursor resolves to ${startTime.toISOString()}, at or after the current time; polling the default ${DEFAULT_LOOKBACK_IN_MINUTES} minute window instead.`,
      );

      startTime = defaultStartTime;
    }

    const fetched: FetchAlertsResult = await client.fetchDetectionAlerts({
      startTime,
      endTime,
    });

    if (fetched.truncatedByCount) {
      logger.warn(
        `GoogleSecOpsPoller: connection ${connectionId} window ${startTime.toISOString()} to ${endTime.toISOString()} matched more alerts than Chronicle will return, and this endpoint has no pagination — alerts in this window were dropped. Lower pollIntervalInMinutes.`,
      );
    }

    if (fetched.truncatedByBytes) {
      logger.warn(
        `GoogleSecOpsPoller: connection ${connectionId} window ${startTime.toISOString()} to ${endTime.toISOString()} was truncated by Chronicle's memory limit — alerts in this window were dropped. Lower pollIntervalInMinutes.`,
      );
    }

    const alerts: Array<JSONObject> = fetched.alerts;

    const normalizedAlerts: Array<NormalizedSecurityEvent> = [];

    /*
     * Objects the alert gate refused, and objects that blew up on the way
     * through it. They are kept apart because they mean opposite things
     * for the cursor: a refusal is deterministic and re-fetching it would
     * refuse it again forever, a failure may well succeed next time.
     */
    let rejectedCount: number = 0;
    let failedCount: number = 0;

    if (alerts.length > 0) {
      const serviceMetadata: TelemetryServiceMetadata =
        await OTelIngestService.telemetryServiceFromName({
          serviceName: SECOPS_SERVICE_NAME,
          projectId: connection.projectId,
        });

      const retentionDays: number = resolveTelemetryRetentionInDays({
        pillar: "securityEvents",
        serviceConfig: serviceMetadata.serviceRetentionConfig,
        serviceRetentionInDays: serviceMetadata.serviceRetentionInDays,
        projectConfig: serviceMetadata.projectRetentionConfig,
        projectRetentionInDays: serviceMetadata.projectRetentionInDays,
      });

      for (const alert of alerts) {
        try {
          /*
           * The normalizer is a total function whose class, category,
           * vendor and product are constants, so anything handed to it
           * comes back out as a plausible Detection Finding row. The gate
           * is what keeps a stray envelope chunk from being stored as a
           * severity-Unknown detection nobody can tell from a real one.
           */
          if (!GoogleSecOpsAlertNormalizer.isGoogleSecOpsAlert(alert)) {
            rejectedCount++;
            continue;
          }

          normalizedAlerts.push(GoogleSecOpsAlertNormalizer.normalize(alert));
        } catch (normalizeError) {
          failedCount++;
          logger.error("GoogleSecOpsPoller: error normalizing alert");
          logger.error(normalizeError);
        }
      }

      if (rejectedCount > 0) {
        logger.warn(
          `GoogleSecOpsPoller: connection ${connectionId} discarded ${rejectedCount} of ${alerts.length} fetched objects that do not look like Google SecOps alerts.`,
        );
      }

      /*
       * Threat-intel enrichment before row building, same seam as the
       * HTTP ingest path — polled alerts get the same threat.* stamps.
       */
      await ThreatIntelEnricher.enrichNormalizedEvents({
        projectId: connection.projectId,
        events: normalizedAlerts,
      });

      const rows: Array<JSONObject> = normalizedAlerts.map(
        (normalized: NormalizedSecurityEvent): JSONObject => {
          return buildSecurityEventDbRow({
            normalized,
            projectId: connection.projectId!,
            serviceMetadata,
            retentionDays,
          });
        },
      );

      if (rows.length > 0) {
        await SecurityEventService.insertJsonRows(rows);
      }
    }

    const ingested: number = normalizedAlerts.length;

    /*
     * Nothing storable came out of a window that did contain alerts, and
     * the reason was a failure rather than a refusal — so the alerts still
     * exist at Chronicle and the window has to be re-fetched. Advancing
     * here is what turned a normalizer fault into permanent, silent data
     * loss: the insert-failure path leaves the cursor alone by throwing,
     * and this path did not.
     */
    const advanceCursor: boolean = ingested > 0 || failedCount === 0;

    if (!advanceCursor) {
      logger.warn(
        `GoogleSecOpsPoller: connection ${connectionId} normalized none of its ${alerts.length} fetched alerts; holding the cursor so the window is polled again rather than skipped.`,
      );
    }

    const cursorUpdate: { cursor?: string } = advanceCursor
      ? {
          /*
           * Still open (out of scope here): this stores the end of the
           * window rather than the newest detection timestamp actually
           * ingested, which is what the column documents itself as.
           */
          cursor: endTime.toISOString(),
        }
      : {};

    await GoogleSecOpsConnectionService.updateOneById({
      id: connection.id,
      data: {
        lastPolledAt: endTime,
        ...cursorUpdate,
        lastError: null as unknown as string,
      },
      props: {
        isRoot: true,
      },
    });

    logger.debug(
      `GoogleSecOpsPoller: connection ${connectionId} fetched ${alerts.length} alerts and ingested ${ingested} security events for ${startTime.toISOString()} to ${endTime.toISOString()}.`,
    );

    return ingested;
  }
}
