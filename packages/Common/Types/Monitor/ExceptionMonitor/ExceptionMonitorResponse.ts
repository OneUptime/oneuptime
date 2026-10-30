import Query from "../../BaseDatabase/Query";
import ObjectID from "../../ObjectID";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import MonitorEvaluationSummary from "../MonitorEvaluationSummary";

export default interface ExceptionMonitorResponse {
  projectId: ObjectID;
  exceptionCount: number;
  exceptionQuery: Query<ExceptionInstance>;
  monitorId: ObjectID;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
  /*
   * Read only when a criteria of the monitor asks for them
   * (ExceptionMonitorEvaluation.getNeeds), so a plain count costs nothing
   * more:
   *
   * - newExceptionCount: matching exception groups first seen in the window;
   * - regressedExceptionCount: matching groups that came back after they
   *   were resolved, in the window, and are still open;
   * - exceptionCountBaseline: the usual count per window - the matching
   *   occurrences of the day before the window, per window of its length;
   * - exceptionCountIncreasePercent: how far exceptionCount is above that
   *   (ExceptionMonitorEvaluation.getIncreasePercent).
   */
  newExceptionCount?: number | undefined;
  regressedExceptionCount?: number | undefined;
  exceptionCountBaseline?: number | undefined;
  exceptionCountIncreasePercent?: number | undefined;
}
