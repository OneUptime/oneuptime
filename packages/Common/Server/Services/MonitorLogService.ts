import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import MonitorLog from "../../Models/AnalyticsModels/MonitorLog";
import OneUptimeDate from "../../Types/Date";
import MonitorLogUtil from "../Utils/Monitor/MonitorLogUtil";

export class Service extends AnalyticsDatabaseService<MonitorLog> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: MonitorLog, database: clickhouseDatabase });
  }

  /*
   * As MonitorLogUtil stamps a check's log: the installation's monitor log
   * retention, from the moment the row is written.
   */
  protected override async getRetentionDateOnCreate(
    monitorLog: MonitorLog,
  ): Promise<Date | null> {
    if (!monitorLog.createdAt) {
      return null;
    }

    return OneUptimeDate.addRemoveDays(
      monitorLog.createdAt,
      await MonitorLogUtil.getRetentionDays(),
    );
  }
}

export default new Service();
