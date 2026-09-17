import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import KubernetesCostAllocation from "../../Models/AnalyticsModels/KubernetesCostAllocation";

export class KubernetesCostAllocationService extends AnalyticsDatabaseService<KubernetesCostAllocation> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({
      modelType: KubernetesCostAllocation,
      database: clickhouseDatabase,
    });
  }
}

export default new KubernetesCostAllocationService();
