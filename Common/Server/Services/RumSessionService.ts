import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import RumSession from "../../Models/AnalyticsModels/RumSession";

export class RumSessionService extends AnalyticsDatabaseService<RumSession> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: RumSession, database: clickhouseDatabase });
  }
}

export default new RumSessionService();
