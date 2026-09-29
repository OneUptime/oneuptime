import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ChangeEvent from "../../Models/AnalyticsModels/ChangeEvent";

export class ChangeEventService extends AnalyticsDatabaseService<ChangeEvent> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: ChangeEvent, database: clickhouseDatabase });
  }
}

export default new ChangeEventService();
