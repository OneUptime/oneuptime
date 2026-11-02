import Query from "../../BaseDatabase/Query";
import ObjectID from "../../ObjectID";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import MonitorEvaluationSummary from "../MonitorEvaluationSummary";

/*
 * What the matching exceptions of earlier weeks say is normal for a window
 * of `windowSeconds` at this hour of the week (ExceptionLearnedBaseline): one
 * count per window, zeros included, with a spread no narrower than a count
 * is by chance. Plain numbers, so the response stays what a status timeline
 * can keep.
 */
export interface ExceptionLearnedBaseline {
  // The baseline window it was read for, in days.
  windowDays: number;
  windowSeconds: number;
  // The earlier weeks it holds: none until there is history to read.
  weeksOfHistory: number;
  // Its windows, and their statistics.
  sampleCount: number;
  mean: number;
  stddev: number;
  median: number;
  madSigma: number;
  minObserved: number;
  maxObserved: number;
}

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
   *   (ExceptionMonitorEvaluation.getIncreasePercent);
   * - exceptionLearnedBaselines: what is normal for this hour of the week,
   *   one per baseline window the criteria ask for. A window missing here
   *   reads as still learning: nothing to compare with, so nothing alerts.
   */
  newExceptionCount?: number | undefined;
  regressedExceptionCount?: number | undefined;
  exceptionCountBaseline?: number | undefined;
  exceptionCountIncreasePercent?: number | undefined;
  exceptionLearnedBaselines?: Array<ExceptionLearnedBaseline> | undefined;
}
