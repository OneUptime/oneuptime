import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import TelemetryAttribute from "Model/AnalyticsModels/TelemetryAttribute";

export class TelemetryAttributeService extends AnalyticsDatabaseService<TelemetryAttribute> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: TelemetryAttribute, database: clickhouseDatabase });
  }
}

export default new TelemetryAttributeService();
