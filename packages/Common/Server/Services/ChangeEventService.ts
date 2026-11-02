import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ChangeEvent from "../../Models/AnalyticsModels/ChangeEvent";
import OneUptimeDate from "../../Types/Date";
import { DEFAULT_CHANGE_EVENT_RETENTION_IN_DAYS } from "../Utils/Telemetry/ChangeEventRow";
import TelemetryRowRetention from "../Utils/Telemetry/TelemetryRowRetention";

export class ChangeEventService extends AnalyticsDatabaseService<ChangeEvent> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: ChangeEvent, database: clickhouseDatabase });
  }

  /*
   * As ChangeEventsIngestService keeps a marker: one of a resource follows
   * its metrics retention, which the charts it annotates are kept by, and a
   * project-wide one - naming no resource - is kept a year.
   */
  protected override async getRetentionDateOnCreate(
    changeEvent: ChangeEvent,
  ): Promise<Date | null> {
    if (!changeEvent.primaryEntityId) {
      return changeEvent.createdAt
        ? OneUptimeDate.addRemoveDays(
            changeEvent.createdAt,
            DEFAULT_CHANGE_EVENT_RETENTION_IN_DAYS,
          )
        : null;
    }

    return await TelemetryRowRetention.getRetentionDate({
      row: changeEvent,
      pillar: "metrics",
    });
  }
}

export default new ChangeEventService();
