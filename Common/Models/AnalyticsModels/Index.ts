import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "./Log";
import Metric from "./Metric";
import Span from "./Span";
import TelemetryAttribute from "./TelemetryAttribute";
import ExceptionInstance from "./ExceptionInstance";
import MonitorLog from "./MonitorLog";

const AnalyticsModels: Array<{ new (): AnalyticsBaseModel }> = [
  Log,
  Span,
  Metric,
  TelemetryAttribute,
  ExceptionInstance,
  MonitorLog,
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
