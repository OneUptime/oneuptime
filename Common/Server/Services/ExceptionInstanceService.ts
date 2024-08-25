import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";

export class ExceptionInstanceService extends AnalyticsDatabaseService<ExceptionInstance> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: ExceptionInstance, database: clickhouseDatabase });
  }
}

export default new ExceptionInstanceService();
