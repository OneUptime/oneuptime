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
import ModelPermission, {
  CheckReadPermissionType,
} from "../Types/AnalyticsDatabase/ModelPermission";
import Query from "../Types/AnalyticsDatabase/Query";
import InBetween from "../../Types/BaseDatabase/InBetween";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  KubernetesCostEfficiencyRow,
  getKubernetesCostEfficiencyWeight,
  getKubernetesCostWeightedEfficiency,
} from "../../Types/Kubernetes/KubernetesCostEfficiency";

// What one namespace (and the labels a cost view reads) cost in one month.
export interface KubernetesNamespaceShare {
  // The month, at its first day ("2026-11-01").
  month: string;
  namespace: string;
  labels: Record<string, string>;
  amount: number;
}

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
   * What each namespace of a cluster cost, month by month, with the labels
   * a cost view's rules read of it - only the keys they ask about: a pod's
   * own labels (its template's hash) would make every pod a row of its
   * own. Read as the caller may read the cluster's costs, and summed as
   * every read of the table is, corrections and all. A cost view splits a
   * shared group holding the cluster's nodes by these
   * (Utils/CloudCost/CloudCostAllocation).
   */
  public async readNamespaceShares(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    // The first day read, and the day after the last.
    start: Date;
    endBefore: Date;
    labelKeys: Array<string>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<KubernetesNamespaceShare>> {
    const permission: CheckReadPermissionType<KubernetesCostAllocation> =
      await ModelPermission.checkReadPermission(
        this.modelType,
        await this.bindReadQueryOf(
          {
            projectId: data.projectId,
            kubernetesClusterId: data.kubernetesClusterId,
            windowStart: new InBetween<Date>(
              data.start,
              new Date(data.endBefore.getTime() - 1),
            ),
          } as Query<KubernetesCostAllocation>,
          data.props,
        ),
        null,
        data.props,
      );

    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string = this.database.getDatasourceOptions().database!;
    const statement: Statement = SQL`SELECT toString(toStartOfMonth(toDate(windowStart, 'UTC'))) AS shareMonth, namespace AS shareNamespace, mapKeys(sliceLabels) AS shareKeys, mapValues(sliceLabels) AS shareValues, sum(totalCost) AS shareAmount FROM (SELECT windowStart, namespace, totalCost, mapFilter((k, v) -> has(${{
      type: TableColumnType.ArrayText,
      value: data.labelKeys.length ? data.labelKeys : [""],
      sendAsHex: true,
    }}, k), labels) AS sliceLabels FROM `;

    statement
      .append(`${databaseName}.${this.model.tableName}`)
      .append(SQL` WHERE TRUE `)
      .append(
        this.statementGenerator.toWhereStatement(permission.query, {
          tableAlias: this.model.tableName,
        }),
      )
      .append(this.getRetentionReadFilter())
      .append(
        SQL`) GROUP BY shareMonth, shareNamespace, shareKeys, shareValues ORDER BY shareMonth, shareNamespace LIMIT 100000`,
      )
      .append(SLICE_READ_SETTINGS);

    const result: Results = await this.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return ((response.data || []) as Array<JSONObject>).map(
      (row: JSONObject): KubernetesNamespaceShare => {
        const keys: Array<unknown> = Array.isArray(row["shareKeys"])
          ? (row["shareKeys"] as Array<unknown>)
          : [];
        const values: Array<unknown> = Array.isArray(row["shareValues"])
          ? (row["shareValues"] as Array<unknown>)
          : [];
        const labels: Record<string, string> = {};

        keys.forEach((key: unknown, index: number): void => {
          writeOwnValue(labels, String(key), String(values[index] ?? ""));
        });

        return {
          month: textOf(row["shareMonth"]),
          namespace: textOf(row["shareNamespace"]),
          labels,
          amount: numberOf(row["shareAmount"]),
        };
      },
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
