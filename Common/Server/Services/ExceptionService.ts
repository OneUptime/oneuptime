import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import Exception from "Common/Models/AnalyticsModels/Exception";

export class ExceptionService extends AnalyticsDatabaseService<Exception> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: Exception, database: clickhouseDatabase });
  }
}

export default new ExceptionService();
