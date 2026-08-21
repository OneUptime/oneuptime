import GoogleSecOpsConnection from "../../../../Models/DatabaseModels/GoogleSecOpsConnection";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
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
import { buildSecurityEventDbRow } from "../SecurityEventRow";
import GoogleSecOpsClient from "./GoogleSecOpsClient";

const SECOPS_SERVICE_NAME: string = "Google SecOps";

/*
 * First poll (no cursor) and the cap for how far back a stale cursor may
 * reach. A connection disabled for a week must not replay a week of
 * alerts in one tick.
 */
const DEFAULT_LOOKBACK_IN_MINUTES: number = 15;
const MAX_LOOKBACK_IN_MINUTES: number = 24 * 60;

// Overlap between windows so boundary alerts are never missed; the
// eventUid content hash keeps redelivered alerts deduplicatable.
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
        await this.pollConnection(connection);
      } catch (error) {
        logger.error(
          `GoogleSecOpsPoller: error polling connection ${connection.id?.toString()}:`,
        );
        logger.error(error);

        if (connection.id) {
          await GoogleSecOpsConnectionService.updateOneById({
            id: connection.id,
            data: {
              lastPolledAt: OneUptimeDate.getCurrentDate(),
              lastError:
                error instanceof Error ? error.message : String(error),
            },
            props: {
              isRoot: true,
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

    let startTime: Date = connection.cursor
      ? OneUptimeDate.addRemoveMinutes(
          new Date(connection.cursor),
          -WINDOW_OVERLAP_IN_MINUTES,
        )
      : OneUptimeDate.addRemoveMinutes(endTime, -DEFAULT_LOOKBACK_IN_MINUTES);

    if (
      Number.isNaN(startTime.getTime()) ||
      OneUptimeDate.isBefore(startTime, earliestAllowed)
    ) {
      startTime = earliestAllowed;
    }

    const alerts: Array<JSONObject> = await client.fetchDetectionAlerts({
      startTime,
      endTime,
    });

    let ingested: number = 0;

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

      const rows: Array<JSONObject> = [];

      for (const alert of alerts) {
        try {
          const normalized: NormalizedSecurityEvent =
            GoogleSecOpsAlertNormalizer.normalize(alert);

          rows.push(
            buildSecurityEventDbRow({
              normalized,
              projectId: connection.projectId,
              serviceMetadata,
              retentionDays,
            }),
          );
        } catch (normalizeError) {
          logger.error("GoogleSecOpsPoller: error normalizing alert");
          logger.error(normalizeError);
        }
      }

      if (rows.length > 0) {
        await SecurityEventService.insertJsonRows(rows);
        ingested = rows.length;
      }
    }

    await GoogleSecOpsConnectionService.updateOneById({
      id: connection.id,
      data: {
        lastPolledAt: endTime,
        cursor: endTime.toISOString(),
        lastError: null as unknown as string,
      },
      props: {
        isRoot: true,
      },
    });

    return ingested;
  }
}
