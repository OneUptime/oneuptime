import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import NetworkFlow from "../../Models/AnalyticsModels/NetworkFlow";

export class NetworkFlowService extends AnalyticsDatabaseService<NetworkFlow> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: NetworkFlow, database: clickhouseDatabase });
  }
}

export default new NetworkFlowService();
