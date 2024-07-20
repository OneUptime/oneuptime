import Log from "./Log";
import Metric from "./Metric";
import MonitorMetricsByMinute from "./MonitorMetricsByMinute";
import Span from "./Span";
import AnalyticsBaseModel from "Common/AnalyticsModels/BaseModel";

const AnalyticsModels: Array<typeof AnalyticsBaseModel> = [
  Log,
  Span,
  Metric,
  MonitorMetricsByMinute,
];

export default AnalyticsModels;
