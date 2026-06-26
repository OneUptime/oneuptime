import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "./Log";
import Metric from "./Metric";
import MetricItemAggMV1m from "./MetricItemAggMV1m";
import MetricItemAggMV1mByHostV2 from "./MetricItemAggMV1mByHostV2";
import MetricBaselineHourly from "./MetricBaselineHourly";
import Span from "./Span";
import ExceptionInstance from "./ExceptionInstance";
import MonitorLog from "./MonitorLog";
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
  MetricBaselineHourly,
  ExceptionInstance,
  MonitorLog,
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
