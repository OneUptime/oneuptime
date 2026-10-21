import { CriteriaFilter } from "../../../Types/Monitor/CriteriaFilter";
import LogMonitorGroupResult from "../../../Types/Monitor/LogMonitor/LogMonitorGroupResult";
import LogMonitorResponse from "../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import DataToProcess from "./DataToProcess";
import { FanOutEntity } from "./PerEntityCriteriaFanOut";

// What an alert or incident resolved by a log says about why it closed.
export const LOG_GROUP_RESOLVED_ROOT_CAUSE: string =
  "A log that resolves this group arrived.";
export const LOG_GROUP_ALERT_RESOLVED_MESSAGE: string =
  "Alert auto-resolved because a log that resolves its group arrived.";
export const LOG_GROUP_INCIDENT_RESOLVED_MESSAGE: string =
  "Incident auto-resolved because a log that resolves its group arrived.";

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
 * A monitor can instead name the log that resolves a group ("interface.up"
 * for a monitor counting "interface.down"). Then a group's alert is closed
 * by that log and by nothing else: the worker leaves resolved groups out
 * of the breakdown and lists them beside it, and the helpers below tell
 * the evaluation so.
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
   * Whether this monitor's groups are resolved by a log
   * (MonitorStepLogMonitor.resolvedByAttributes). Then a group that has
   * gone quiet has not recovered - nothing was said about it - so its
   * alert is left open until the log that resolves it arrives.
   */
  public static isResolvedByLog(
    dataToProcess: DataToProcess | undefined,
  ): boolean {
    return Array.isArray(
      (dataToProcess as LogMonitorResponse | undefined)?.resolvedGroups,
    );
  }

  /*
   * The fingerprints of the groups a resolving log has arrived for: the
   * identities their alerts and incidents were opened under.
   */
  public static getResolvedFingerprints(
    dataToProcess: DataToProcess | undefined,
  ): Array<string> {
    const resolvedGroups: unknown = (
      dataToProcess as LogMonitorResponse | undefined
    )?.resolvedGroups;

    if (!Array.isArray(resolvedGroups)) {
      return [];
    }

    const fingerprints: Array<string> = [];

    for (const group of resolvedGroups as Array<LogMonitorGroupResult>) {
      if (
        group &&
        typeof group.fingerprint === "string" &&
        group.fingerprint &&
        !fingerprints.includes(group.fingerprint)
      ) {
        fingerprints.push(group.fingerprint);
      }
    }

    return fingerprints;
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
      resolvedGroups: undefined,
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
