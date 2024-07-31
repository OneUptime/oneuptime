import DataMigrationBase from "./DataMigrationBase";
import LogService from "CommonServer/Services/LogService";
import MetricService from "CommonServer/Services/MetricService";
import MonitorMetricsByMinuteService from "CommonServer/Services/MonitorMetricsByMinuteService";
import SpanService from "CommonServer/Services/SpanService";
import logger from "CommonServer/Utils/Logger";

export default class DeleteOldTelemetryTable extends DataMigrationBase {
  public constructor() {
    super("DeleteOldTelemetryTable");
  }

  public override async migrate(): Promise<void> {
    try {
      // delete old telemetry tables that are no longer needed
      // we have renamed these tables to new names
      await MetricService.executeQuery("DROP TABLE IF EXISTS Metric");
      await SpanService.executeQuery("DROP TABLE IF EXISTS Span");
      await LogService.executeQuery("DROP TABLE IF EXISTS Log");
      await MonitorMetricsByMinuteService.executeQuery(
        "DROP TABLE IF EXISTS MonitorMetricsByMinute",
      );
    } catch (err) {
      logger.error(err);
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
