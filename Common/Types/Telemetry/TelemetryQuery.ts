import Log from "../../Models/AnalyticsModels/Log";
import Span from "../../Models/AnalyticsModels/Span";
import Query from "../BaseDatabase/Query";
import MetricViewData from "../Metrics/MetricViewData";
import TelemetryType from "./TelemetryType";

export interface TelemetryQuery {
  telemetryType: TelemetryType;
  telemetryQuery: Query<Log> | Query<Span> | null;
  metricViewData: MetricViewData | null;
}
