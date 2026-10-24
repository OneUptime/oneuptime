import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import NetworkTrafficUsage from "../../Models/AnalyticsModels/NetworkTrafficUsage";

export class NetworkTrafficUsageService extends AnalyticsDatabaseService<NetworkTrafficUsage> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: NetworkTrafficUsage, database: clickhouseDatabase });
  }
}

export default new NetworkTrafficUsageService();
