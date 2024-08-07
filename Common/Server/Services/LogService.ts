import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import Log from "Common/Models/AnalyticsModels/Log";

export class LogService extends AnalyticsDatabaseService<Log> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: Log, database: clickhouseDatabase });
  }
}

export default new LogService();
