import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService, {
  DbJSONResponse,
  Results,
} from "./AnalyticsDatabaseService";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { KubernetesCostStoredSlice } from "../../Types/Kubernetes/KubernetesCostCorrection";
import { writeOwnValue } from "../../Utils/LookupTable";
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

const SLICE_READ_SETTINGS: string = getQuerySettings({
  maxExecutionTimeInSeconds: 60,
  timeoutOverflowMode: "throw",
});

const textOf: (value: unknown) => string = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

const numberOf: (value: unknown) => number = (value: unknown): number => {
  const parsed: number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const labelsOf: (value: unknown) => Record<string, string> = (
  value: unknown,
): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const labels: Record<string, string> = {};

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    writeOwnValue(labels, key, typeof raw === "string" ? raw : String(raw));
  }

  return labels;
};

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
   * What one window of a cluster holds, per workload, pod and container: the
   * sums of the costs a correction changes, over the window's first reading
   * and any corrections since (#9969). One read of one partition, by the
   * sort key's prefix.
   */
  public buildWindowSlicesStatement(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    windowStart: Date;
    windowEnd: Date;
  }): Statement {
    const statement: Statement = SQL`SELECT namespace, controllerKind, controllerName, podName, containerName, any(nodeName) AS sliceNode, any(providerId) AS sliceProvider, any(labels) AS sliceLabels, anyIf(costEngine, NOT isCostAdjustment) AS pricedBy, anyIf(costEngineService, NOT isCostAdjustment) AS pricedByService, sum(cpuCost) AS sumCpuCost, sum(gpuCost) AS sumGpuCost, sum(ramCost) AS sumRamCost, sum(pvCost) AS sumPvCost, sum(networkCost) AS sumNetworkCost, sum(loadBalancerCost) AS sumLoadBalancerCost, sum(sharedCost) AS sumSharedCost, sum(externalCost) AS sumExternalCost, sum(totalCost) AS sumTotalCost, sum(efficiencyWeight) AS sumEfficiencyWeight, sum(weightedEfficiency) AS sumWeightedEfficiency FROM ${AnalyticsTableName.KubernetesCostAllocation} WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND kubernetesClusterId = ${{
      type: TableColumnType.ObjectID,
      value: data.kubernetesClusterId,
    }} AND windowStart = ${{
      type: TableColumnType.Date,
      value: data.windowStart,
    }} AND windowEnd = ${{
      type: TableColumnType.Date,
      value: data.windowEnd,
    }} GROUP BY namespace, controllerKind, controllerName, podName, containerName`;

    statement.append(SLICE_READ_SETTINGS);

    return statement;
  }

  // The statement's rows, read back as slices.
  public static readWindowSlices(
    rows: Array<JSONObject>,
  ): Array<KubernetesCostStoredSlice> {
    return rows.map((row: JSONObject): KubernetesCostStoredSlice => {
      return {
        namespace: textOf(row["namespace"]),
        controllerKind: textOf(row["controllerKind"]),
        controllerName: textOf(row["controllerName"]),
        podName: textOf(row["podName"]),
        containerName: textOf(row["containerName"]),
        nodeName: textOf(row["sliceNode"]),
        providerId: textOf(row["sliceProvider"]),
        labels: labelsOf(row["sliceLabels"]),
        costEngine: textOf(row["pricedBy"]),
        costEngineService: textOf(row["pricedByService"]),
        cpuCost: numberOf(row["sumCpuCost"]),
        gpuCost: numberOf(row["sumGpuCost"]),
        ramCost: numberOf(row["sumRamCost"]),
        pvCost: numberOf(row["sumPvCost"]),
        networkCost: numberOf(row["sumNetworkCost"]),
        loadBalancerCost: numberOf(row["sumLoadBalancerCost"]),
        sharedCost: numberOf(row["sumSharedCost"]),
        externalCost: numberOf(row["sumExternalCost"]),
        totalCost: numberOf(row["sumTotalCost"]),
        efficiencyWeight: numberOf(row["sumEfficiencyWeight"]),
        weightedEfficiency: numberOf(row["sumWeightedEfficiency"]),
      };
    });
  }

  public async findWindowSlices(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<Array<KubernetesCostStoredSlice>> {
    const result: Results = await this.executeQuery(
      this.buildWindowSlicesStatement(data),
    );
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return KubernetesCostAllocationService.readWindowSlices(
      (response.data || []) as Array<JSONObject>,
    );
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
