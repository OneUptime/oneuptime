import Log from "../../../Models/AnalyticsModels/Log";
import Query from "../../BaseDatabase/Query";
import MonitorEvaluationSummary from "../MonitorEvaluationSummary";
import ObjectID from "../../ObjectID";
import LogMonitorGroupResult from "./LogMonitorGroupResult";

export default interface LogMonitorResponse {
  projectId: ObjectID;
  /*
   * Every log the monitor's filters matched in the window - across every
   * group when the monitor is grouped.
   */
  logCount: number;
  logQuery: Query<Log>;
  monitorId: ObjectID;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
  /*
   * Set only when the monitor step groups by attributes
   * (MonitorStepLogMonitor.groupByAttributes). Its presence - even as an
   * empty array, when no log matched - is what tells the criteria that the
   * monitor is grouped: each group is judged on its own count and raises
   * its own alert or incident. Ungrouped monitors never carry these
   * fields, so they evaluate exactly as they always have.
   */
  groupByAttributes?: Array<string> | undefined;
  // The groups evaluated, the busiest first.
  groupBreakdown?: Array<LogMonitorGroupResult> | undefined;
  /*
   * How many distinct groups matched in the window. More than
   * groupBreakdown holds when the per-evaluation group cap cut the rest.
   */
  totalGroupCount?: number | undefined;
  /*
   * Set only on the per-group copy the criteria evaluator builds to judge
   * one group (see LogGroupCriteriaFanOut): `logCount` is then that
   * group's count, and messages name the group.
   */
  evaluatedGroup?: LogMonitorGroupResult | undefined;
}
