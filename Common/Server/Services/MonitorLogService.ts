import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import MonitorLog from "../../Models/AnalyticsModels/MonitorLog";

export class Service extends AnalyticsDatabaseService<MonitorLog> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: MonitorLog, database: clickhouseDatabase });
  }
}

export default new Service();
