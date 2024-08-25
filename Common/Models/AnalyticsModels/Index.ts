import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "./Log";
import Metric from "./Metric";
import MonitorMetricsByMinute from "./MonitorMetricsByMinute";
import Span from "./Span";
import TelemetryAttribute from "./TelemetryAttribute";
import ExceptionInstance from "./ExceptionInstance";

const AnalyticsModels: Array<typeof AnalyticsBaseModel> = [
  Log,
  Span,
  Metric,
  MonitorMetricsByMinute,
  TelemetryAttribute,
  ExceptionInstance,
];

export default AnalyticsModels;
