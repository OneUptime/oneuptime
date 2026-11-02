import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import OTelIngestService, {
  TelemetryRetention,
} from "./OpenTelemetryIngestService";
import KubernetesCostAllocation from "../../Models/AnalyticsModels/KubernetesCostAllocation";
import OneUptimeDate from "../../Types/Date";
import ServiceType from "../../Types/Telemetry/ServiceType";

export class KubernetesCostAllocationService extends AnalyticsDatabaseService<KubernetesCostAllocation> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({
      modelType: KubernetesCostAllocation,
      database: clickhouseDatabase,
    });
  }

  /*
   * As KubernetesCostIngestService stamps an allocation: its cluster's
   * retention, else the project's, from the start of the window it covers -
   * the day of the partition it lands in - rather than from when it is
   * written.
   */
  protected override async getRetentionDateOnCreate(
    allocation: KubernetesCostAllocation,
  ): Promise<Date | null> {
    if (
      !allocation.projectId ||
      !allocation.kubernetesClusterId ||
      !allocation.windowStart
    ) {
      return null;
    }

    const retention: TelemetryRetention =
      await OTelIngestService.getRetentionForCreatedRow({
        projectId: allocation.projectId,
        primaryEntityId: allocation.kubernetesClusterId,
        primaryEntityType: ServiceType.KubernetesCluster,
      });

    return OneUptimeDate.addRemoveDays(
      allocation.windowStart,
      retention.dataRententionInDays,
    );
  }
}

export default new KubernetesCostAllocationService();
