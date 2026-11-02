import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import OneUptimeDate from "../../../Types/Date";
import LogSeverity from "../../../Types/Log/LogSeverity";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import {
  resolveTelemetryRetentionInDays,
  TelemetryPillar,
} from "../../../Types/Telemetry/TelemetryRetentionConfig";
import OTelIngestService, {
  TelemetryRetention,
} from "../../Services/OpenTelemetryIngestService";

/*
 * The retentionDate of a telemetry row created through its table's service
 * - the REST API's create, which may not write the column - stamped as
 * ingest stamps it: the moment the row is written (its createdAt, which
 * RetentionTtl's TTL reads beside it) plus the retention the resource it
 * belongs to keeps its kind of telemetry for (resolveTelemetryRetentionInDays).
 *
 * From the moment it is written, not from the row's own time, as on ingest:
 * a row sent with a time from last month is kept for its retention, not
 * stamped already expired.
 */
export default class TelemetryRowRetention {
  public static async getRetentionDate(data: {
    row: AnalyticsBaseModel;
    pillar: TelemetryPillar;
    // A log's severity, a span's status: what a retention by type is kept by.
    bucketKey?: LogSeverity | SpanStatus | null | undefined;
  }): Promise<Date | null> {
    const projectId: ObjectID | null = data.row.getTenantColumnValue();
    const primaryEntityId: ObjectID | undefined =
      data.row.getColumnValue<ObjectID>("primaryEntityId");
    const writtenAt: Date | undefined = data.row.createdAt;

    // The create is refused for the column it left out.
    if (!projectId || !primaryEntityId || !writtenAt) {
      return null;
    }

    const retention: TelemetryRetention =
      await OTelIngestService.getRetentionForCreatedRow({
        projectId: projectId,
        primaryEntityId: primaryEntityId,
        primaryEntityType:
          data.row.getColumnValue<ServiceType>("primaryEntityType"),
      });

    return OneUptimeDate.addRemoveDays(
      writtenAt,
      resolveTelemetryRetentionInDays({
        pillar: data.pillar,
        bucketKey: data.bucketKey ?? null,
        serviceConfig: retention.serviceRetentionConfig,
        serviceRetentionInDays: retention.serviceRetentionInDays,
        projectConfig: retention.projectRetentionConfig,
        projectRetentionInDays: retention.projectRetentionInDays,
      }),
    );
  }
}
