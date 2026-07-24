import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "./Log";
import Metric from "./Metric";
import MetricItemAggMV1m from "./MetricItemAggMV1m";
import MetricItemAggMV1mByHostV2 from "./MetricItemAggMV1mByHostV2";
import MetricItemAggMV1mByService from "./MetricItemAggMV1mByService";
import MetricItemAggMV1mByK8sCluster from "./MetricItemAggMV1mByK8sCluster";
import MetricItemAggMV1mByContainer from "./MetricItemAggMV1mByContainer";
import MetricBaselineHourly from "./MetricBaselineHourly";
import Span from "./Span";
import ExceptionInstance from "./ExceptionInstance";
import MonitorLog from "./MonitorLog";
import NetworkFlow from "./NetworkFlow";
import KubernetesCostAllocation from "./KubernetesCostAllocation";
import Profile from "./Profile";
import ProfileSample from "./ProfileSample";
import AuditLog from "./AuditLog";

const AnalyticsModels: Array<{ new (): AnalyticsBaseModel }> = [
  Log,
  Span,
  Metric,
  /*
   * Materialized-view target tables. AggregatingMergeTree engine; rows
   * are populated by attached MVs on `Metric` insert. Read-only.
   */
  MetricItemAggMV1m,
  /*
   * The hostIdentifier-keyed V1 host rollup was dropped by the
   * RekeyMetricHostRollupToEntityKey migration; only V2 is registered so
   * boot-time schema sync doesn't resurrect the dropped V1 table.
   */
  MetricItemAggMV1mByHostV2,
  /*
   * Entity-keyed siblings of the host rollup (serviceEntityKey /
   * k8sClusterEntityKey / containerEntityKey), serving the other
   * entity-scoped chart paths in MetricService.
   */
  MetricItemAggMV1mByService,
  MetricItemAggMV1mByK8sCluster,
  MetricItemAggMV1mByContainer,
  MetricBaselineHourly,
  ExceptionInstance,
  MonitorLog,
  NetworkFlow,
  KubernetesCostAllocation,
  Profile,
  ProfileSample,
  AuditLog,
];

const modelTypeMap: { [key: string]: { new (): AnalyticsBaseModel } } = {};

type GetModelTypeByName = (
  tableName: string,
) => (new () => AnalyticsBaseModel) | null;

export const getModelTypeByName: GetModelTypeByName = (
  tableName: string,
): (new () => AnalyticsBaseModel) | null => {
  if (modelTypeMap[tableName]) {
    return modelTypeMap[tableName] || null;
  }

  const modelType: { new (): AnalyticsBaseModel } | undefined =
    AnalyticsModels.find((modelType: { new (): AnalyticsBaseModel }) => {
      return new modelType().tableName === tableName;
    });

  if (!modelType) {
    return null;
  }

  modelTypeMap[tableName] = modelType;

  return modelType;
};

export default AnalyticsModels;
