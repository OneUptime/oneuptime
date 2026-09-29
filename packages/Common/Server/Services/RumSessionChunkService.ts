import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import RumSessionChunk from "../../Models/AnalyticsModels/RumSessionChunk";

export class RumSessionChunkService extends AnalyticsDatabaseService<RumSessionChunk> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: RumSessionChunk, database: clickhouseDatabase });
  }
}

export default new RumSessionChunkService();
