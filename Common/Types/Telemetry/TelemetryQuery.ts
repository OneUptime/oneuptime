import Log from "../../Models/AnalyticsModels/Log";
import Metric from "../../Models/AnalyticsModels/Metric";
import Span from "../../Models/AnalyticsModels/Span";
import Query from "../BaseDatabase/Query";
import TelemetryType from "./TelemetryType";

export interface TelemetryQuery {
    telemetryType: TelemetryType;
    telemetryQuery: Query<Log> | Query<Span> | Query<Metric>;
  }