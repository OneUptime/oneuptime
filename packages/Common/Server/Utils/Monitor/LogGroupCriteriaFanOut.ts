import { CriteriaFilter } from "../../../Types/Monitor/CriteriaFilter";
import LogMonitorGroupResult from "../../../Types/Monitor/LogMonitor/LogMonitorGroupResult";
import LogMonitorResponse from "../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import DataToProcess from "./DataToProcess";
import { FanOutEntity } from "./PerEntityCriteriaFanOut";

/**
 * Per-group alerting for Logs monitors.
 *
 * A Logs monitor with Group By set is evaluated on one log count per
 * combination of its group-by attributes' values - one per IPsec tunnel,
 * say - instead of on a single count. Each group is then judged on its
 * own count through PerEntityCriteriaFanOut.collectMatches, the path a
 * server's disks and a switch's interfaces already take, so every
 * breaching group opens its own alert or incident and resolves it on its
 * own when its logs stop.
 *
 * A disk is addressed by rewriting the criteria's filters; a log group
 * is a slice of the data. So each group's entity leaves the filters as
 * they are and carries the monitor's response narrowed to that group.
 */
export default class LogGroupCriteriaFanOut {
  /*
   * Whether this response came from a grouped monitor. An empty
   * breakdown still counts: a grouped monitor whose window matched no
   * log has no group to alert on, which is different from an ungrouped
   * monitor's single count of zero.
   */
  public static isGroupedResponse(
    dataToProcess: DataToProcess | undefined,
  ): boolean {
    return Array.isArray(
      (dataToProcess as LogMonitorResponse | undefined)?.groupBreakdown,
    );
  }

  /*
   * The response one group is judged on: its own count as `logCount`,
   * with the breakdown removed so the criteria compares that single
   * number, and the group named so messages say which one it is.
   */
  public static narrowToGroup(input: {
    response: LogMonitorResponse;
    group: LogMonitorGroupResult;
  }): LogMonitorResponse {
    return {
      ...input.response,
      logCount: input.group.logCount,
      groupBreakdown: undefined,
      totalGroupCount: undefined,
      evaluatedGroup: input.group,
    };
  }

  public static getGroupEntities(input: {
    dataToProcess: DataToProcess;
  }): Array<FanOutEntity> {
    const response: LogMonitorResponse =
      input.dataToProcess as LogMonitorResponse;

    return (response.groupBreakdown || []).map(
      (group: LogMonitorGroupResult): FanOutEntity => {
        return {
          // Hashed into the same fingerprint the worker stamped on the group.
          labels: group.labels,
          narrowFilter: (filter: CriteriaFilter): CriteriaFilter => {
            return filter;
          },
          dataToProcess: LogGroupCriteriaFanOut.narrowToGroup({
            response: response,
            group: group,
          }) as DataToProcess,
        };
      },
    );
  }
}
