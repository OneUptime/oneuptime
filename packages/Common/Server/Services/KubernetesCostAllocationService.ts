import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import OTelIngestService, {
  TelemetryRetention,
} from "./OpenTelemetryIngestService";
import KubernetesCostAllocation from "../../Models/AnalyticsModels/KubernetesCostAllocation";
import OneUptimeDate from "../../Types/Date";
import ServiceType from "../../Types/Telemetry/ServiceType";
import CreateBy from "../Types/AnalyticsDatabase/CreateBy";
import { OnCreate } from "../Types/AnalyticsDatabase/Hooks";
import {
  KubernetesCostEfficiencyRow,
  getKubernetesCostEfficiencyWeight,
  getKubernetesCostWeightedEfficiency,
} from "../../Types/Kubernetes/KubernetesCostEfficiency";

export class KubernetesCostAllocationService extends AnalyticsDatabaseService<KubernetesCostAllocation> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({
      modelType: KubernetesCostAllocation,
      database: clickhouseDatabase,
    });
  }

  /*
   * A row's efficiency weight and weighted efficiency are worked out from
   * its own namespace, costs and efficiency, as ingest works them out
   * (Types/Kubernetes/KubernetesCostEfficiency), whatever a caller sent: a
   * row created through the API weighs in every efficiency exactly as an
   * ingested one does.
   */
  protected override async onBeforeCreate(
    createBy: CreateBy<KubernetesCostAllocation>,
  ): Promise<OnCreate<KubernetesCostAllocation>> {
    KubernetesCostAllocationService.setEfficiencyColumns(createBy.data);

    return { createBy: createBy, carryForward: null };
  }

  public static setEfficiencyColumns(
    allocation: KubernetesCostAllocation,
  ): void {
    const row: KubernetesCostEfficiencyRow = {
      namespace: allocation.namespace,
      cpuCost: allocation.cpuCost,
      ramCost: allocation.ramCost,
      totalEfficiency: allocation.totalEfficiency,
    };

    allocation.efficiencyWeight = getKubernetesCostEfficiencyWeight(row);
    allocation.weightedEfficiency = getKubernetesCostWeightedEfficiency(row);
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

    return OneUptimeDate.addRemoveDurationInDays(
      allocation.windowStart,
      retention.dataRententionInDays,
    );
  }
}

export default new KubernetesCostAllocationService();
