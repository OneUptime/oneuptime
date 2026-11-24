import { CriteriaFilter } from "../../../Types/Monitor/CriteriaFilter";
import TraceMonitorGroupResult from "../../../Types/Monitor/TraceMonitor/TraceMonitorGroupResult";
import TraceMonitorResponse from "../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import DataToProcess from "./DataToProcess";
import { FanOutEntity } from "./PerEntityCriteriaFanOut";

/**
 * Per-group alerting for Traces monitors (#9711), as LogGroupCriteriaFanOut
 * is for Logs monitors.
 *
 * A Traces monitor with Group By set is evaluated on one span count per
 * combination of its group-by attributes' values - one per install of a
 * mobile app, say - instead of on a single count, quiet groups counted as
 * 0 (TraceGroupAbsence). Each group is then judged on its own count through
 * PerEntityCriteriaFanOut.collectMatches, so every breaching group opens
 * its own alert or incident, and resolves it on its own when it reports
 * again.
 */
export default class TraceGroupCriteriaFanOut {
  /*
   * Whether this response came from a grouped monitor. An empty breakdown
   * still counts: a grouped monitor whose window matched no span has no
   * group to alert on, which is different from an ungrouped monitor's
   * single count of zero.
   */
  public static isGroupedResponse(
    dataToProcess: DataToProcess | undefined,
  ): boolean {
    return Array.isArray(
      (dataToProcess as TraceMonitorResponse | undefined)?.groupBreakdown,
    );
  }

  /*
   * Whether nothing the grouped monitor matches sent a span in the window,
   * while it expected some to: the whole app went quiet, not one group.
   */
  public static isQuietWindow(
    dataToProcess: DataToProcess | undefined,
  ): boolean {
    return (
      (dataToProcess as TraceMonitorResponse | undefined)?.isQuietWindow ===
      true
    );
  }

  /*
   * The response one group is judged on: its own count as `spanCount`,
   * with the breakdown removed so the criteria compares that single
   * number, and the group named so messages say which one it is.
   */
  public static narrowToGroup(input: {
    response: TraceMonitorResponse;
    group: TraceMonitorGroupResult;
  }): TraceMonitorResponse {
    return {
      ...input.response,
      spanCount: input.group.spanCount,
      groupBreakdown: undefined,
      totalGroupCount: undefined,
      evaluatedGroup: input.group,
    };
  }

  public static getGroupEntities(input: {
    dataToProcess: DataToProcess;
  }): Array<FanOutEntity> {
    const response: TraceMonitorResponse =
      input.dataToProcess as TraceMonitorResponse;

    return (response.groupBreakdown || []).map(
      (group: TraceMonitorGroupResult): FanOutEntity => {
        return {
          // Hashed into the same fingerprint the worker stamped on the group.
          labels: group.labels,
          // Which device it is, for the alert's words only (#9925).
          ...(group.context ? { context: group.context } : {}),
          narrowFilter: (filter: CriteriaFilter): CriteriaFilter => {
            return filter;
          },
          dataToProcess: TraceGroupCriteriaFanOut.narrowToGroup({
            response: response,
            group: group,
          }) as DataToProcess,
        };
      },
    );
  }
}
