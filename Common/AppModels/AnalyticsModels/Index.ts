import Log from "./Log";
import Metric from "./Metric";
import MonitorMetricsByMinute from "./MonitorMetricsByMinute";
import Span from "./Span";
import AnalyticsBaseModel from "../../AnalyticsModels/BaseModel";
import TelemetryAttribute from "./TelemetryAttribute";

const AnalyticsModels: Array<typeof AnalyticsBaseModel> = [
  Log,
  Span,
  Metric,
  MonitorMetricsByMinute,
  TelemetryAttribute,
];

export default AnalyticsModels;
