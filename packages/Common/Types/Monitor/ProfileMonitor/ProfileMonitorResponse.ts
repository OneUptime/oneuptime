import Query from "../../BaseDatabase/Query";
import ObjectID from "../../ObjectID";
import Profile from "../../../Models/AnalyticsModels/Profile";
import MonitorEvaluationSummary from "../MonitorEvaluationSummary";

/*
 * How much of the window's time ran through the monitor's function
 * (MonitorStepProfileMonitor.functionName), for the "Function Share"
 * criteria.
 */
export interface ProfileFunctionShareReading {
  // The text the frames were matched on.
  functionName: string;
  // 0-100: the matching stacks' share of every stack in the window.
  sharePercent: number;
  // How many samples the window held (0: nothing was profiled in it).
  windowSampleCount: number;
}

export default interface ProfileMonitorResponse {
  projectId: ObjectID;
  profileCount: number;
  profileQuery: Query<Profile>;
  monitorId: ObjectID;
  /*
   * Set when the monitor names a function; absent for a monitor that only
   * counts profiles, and on responses recorded before the field existed.
   */
  functionShare?: ProfileFunctionShareReading | undefined;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
}
