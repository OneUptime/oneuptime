import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "./Log";
import Metric from "./Metric";
import MonitorMetricsByMinute from "./MonitorMetricsByMinute";
import Span from "./Span";
import TelemetryAttribute from "./TelemetryAttribute";
import ExceptionInstance from "./ExceptionInstance";

const AnalyticsModels: Array<{ new (): AnalyticsBaseModel }> = [
  Log,
  Span,
  Metric,
  MonitorMetricsByMinute,
  TelemetryAttribute,
  ExceptionInstance,
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
