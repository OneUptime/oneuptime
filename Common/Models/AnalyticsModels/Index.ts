import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "./Log";
import Metric from "./Metric";
import MetricItemAggMV1m from "./MetricItemAggMV1m";
import MetricItemAggMV1mByHost from "./MetricItemAggMV1mByHost";
import MetricBaselineHourly from "./MetricBaselineHourly";
import Span from "./Span";
import ExceptionInstance from "./ExceptionInstance";
import MonitorLog from "./MonitorLog";
import Profile from "./Profile";
import ProfileSample from "./ProfileSample";

const AnalyticsModels: Array<{ new (): AnalyticsBaseModel }> = [
  Log,
  Span,
  Metric,
  /*
   * Materialized-view target tables. AggregatingMergeTree engine; rows
   * are populated by attached MVs on `Metric` insert. Read-only.
   */
  MetricItemAggMV1m,
  MetricItemAggMV1mByHost,
  MetricBaselineHourly,
  ExceptionInstance,
  MonitorLog,
  Profile,
  ProfileSample,
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
