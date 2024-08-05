import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import Span from "Common/AppModels/AnalyticsModels/Span";

export class SpanService extends AnalyticsDatabaseService<Span> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: Span, database: clickhouseDatabase });
  }
}

export default new SpanService();
