import Query from "../../BaseDatabase/Query";
import ObjectID from "../../ObjectID";
import Span from "../../../Models/AnalyticsModels/Span";
import MonitorEvaluationSummary from "../MonitorEvaluationSummary";
import TraceMonitorGroupResult from "./TraceMonitorGroupResult";

export default interface TraceMonitorResponse {
  projectId: ObjectID;
  /*
   * Every span the monitor's filters matched in the window - across every
   * group when the monitor is grouped.
   */
  spanCount: number;
  spanQuery: Query<Span>;
  monitorId: ObjectID;
  /*
   * Where the window judged ended: now, or where a late ingest queue held
   * the check back to. What an anomaly condition reads the earlier weeks
   * from.
   */
  evaluatedUntil?: Date | undefined;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
  /*
   * Set only when the monitor step groups by attributes
   * (MonitorStepTraceMonitor.groupByAttributes, #9711). Its presence -
   * even as an empty array - is what tells the criteria that the monitor
   * is grouped: each group is judged on its own count and raises its own
   * alert or incident. Ungrouped monitors never carry these fields, so they
   * evaluate exactly as they always have.
   */
  groupByAttributes?: Array<string> | undefined;
  /*
   * The groups evaluated: the quiet ones first (TraceGroupAbsence), then
   * the busiest.
   */
  groupBreakdown?: Array<TraceMonitorGroupResult> | undefined;
  /*
   * How many distinct groups there were, the quiet ones too. More than
   * groupBreakdown holds when the per-evaluation group cap cut the rest.
   */
  totalGroupCount?: number | undefined;
  /*
   * Set only on the per-group copy the criteria evaluator builds to judge
   * one group (TraceGroupCriteriaFanOut): `spanCount` is then that group's
   * count, and messages name the group.
   */
  evaluatedGroup?: TraceMonitorGroupResult | undefined;
  /*
   * True when the monitor counts quiet groups and nothing it matches sent
   * a span in the window: the whole app went quiet, not one device of it.
   * No group is judged then - one alert per device of a fleet that lost
   * its network at once would be a flood - and the monitor keeps its
   * status and its open alerts until spans arrive (MonitorResource's
   * silent window). An app that stops reporting as a whole is what an
   * ungrouped monitor, such as App Stopped Reporting, alerts on.
   */
  isQuietWindow?: boolean | undefined;
}
