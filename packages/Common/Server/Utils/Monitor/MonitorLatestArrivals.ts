import Monitor from "../../../Models/DatabaseModels/Monitor";
import { JSONObject } from "../../../Types/JSON";
import MonitorCheckScheduleUtil from "../../../Utils/Monitor/MonitorCheckScheduleUtil";
import MonitorHeartbeatState from "./MonitorHeartbeatState";

/*
 * THE LATEST HEARTBEAT A READER OF A MONITOR SEES (issue #8123).
 *
 * Since #8119 a heartbeat writes the Monitor row only every so often: a
 * server agent's report at most every SERVER_REPORT_WRITE_EVERY_SECONDS, an
 * unchanged incoming request at most every half of the monitor's shortest
 * window (MonitorHeartbeatState). The latest arrivals are kept in Redis on
 * every report and request, and the monitor's status is judged from those;
 * the row, which the monitor page reads, could say a report or a request
 * up to two minutes older than the latest.
 *
 * So a monitor read through the API - its page, a list, an API key's read
 * (MonitorAPI.onBeforeSendRecords) - has the latest arrival kept put over
 * the row's, where it is newer. Never OneUptime's own reads, which judge the
 * row as they always have, and never in MonitorService's read: a service
 * that changes what it found loses realtime's shortcut for readers of
 * every monitor (MonitorLatestIncomingRequestReads).
 *
 *   - serverMonitorRequestReceivedAt, a server monitor's last report;
 *   - incomingMonitorRequest.incomingRequestReceivedAt, an incoming request
 *     monitor's last request.
 *
 * Only what the read selected is touched, and only the time: what the
 * report or the request said is the row's, as written. It costs one Redis
 * round trip per kind for the whole read, and no Postgres statement. Redis
 * that cannot be reached leaves the row's values as they are.
 */
export default class MonitorLatestArrivals {
  public static async putOverRows(monitors: Array<Monitor>): Promise<void> {
    const reportedMonitors: Array<Monitor> = monitors.filter(
      (monitor: Monitor): boolean => {
        // Read with the column, NULL included.
        return Boolean(monitor.id) && monitor.serverMonitorRequestReceivedAt !== undefined;
      },
    );

    const requestedMonitors: Array<Monitor> = monitors.filter(
      (monitor: Monitor): boolean => {
        return (
          Boolean(monitor.id) &&
          MonitorLatestArrivals.isObject(monitor.incomingMonitorRequest)
        );
      },
    );

    if (reportedMonitors.length === 0 && requestedMonitors.length === 0) {
      return;
    }

    const [reports, requests]: [Map<string, Date>, Map<string, Date>] =
      await Promise.all([
        reportedMonitors.length > 0
          ? MonitorHeartbeatState.getLatestArrivals({
              kind: "server-report",
              monitorIds: reportedMonitors.map((monitor: Monitor): string => {
                return monitor.id!.toString();
              }),
            })
          : Promise.resolve(new Map<string, Date>()),
        requestedMonitors.length > 0
          ? MonitorHeartbeatState.getLatestArrivals({
              kind: "incoming-request",
              monitorIds: requestedMonitors.map((monitor: Monitor): string => {
                return monitor.id!.toString();
              }),
            })
          : Promise.resolve(new Map<string, Date>()),
      ]);

    for (const monitor of reportedMonitors) {
      const kept: Date | undefined = reports.get(
        monitor.id!.toString().toLowerCase(),
      );

      if (
        kept &&
        MonitorLatestArrivals.isNewer(kept, monitor.serverMonitorRequestReceivedAt)
      ) {
        monitor.serverMonitorRequestReceivedAt = kept;
      }
    }

    for (const monitor of requestedMonitors) {
      const kept: Date | undefined = requests.get(
        monitor.id!.toString().toLowerCase(),
      );
      const request: JSONObject =
        monitor.incomingMonitorRequest as unknown as JSONObject;

      if (
        kept &&
        MonitorLatestArrivals.isNewer(kept, request["incomingRequestReceivedAt"])
      ) {
        request["incomingRequestReceivedAt"] = MonitorLatestArrivals.asWritten(
          kept,
          request["incomingRequestReceivedAt"],
        );
      }
    }
  }

  // Whether the time kept is later than the row's, or the row has none.
  private static isNewer(kept: Date, onTheRow: unknown): boolean {
    const written: Date | undefined =
      MonitorCheckScheduleUtil.parseDate(onTheRow);

    return !written || kept.getTime() > written.getTime();
  }

  /*
   * The time in the shape the row held it in, so whatever reads the column
   * reads it as before: a Date, an ISO string, or a typed envelope.
   */
  private static asWritten(kept: Date, onTheRow: unknown): JSONObject[string] {
    if (onTheRow instanceof Date) {
      return kept;
    }

    if (
      MonitorLatestArrivals.isObject(onTheRow) &&
      typeof (onTheRow as JSONObject)["_type"] === "string"
    ) {
      return {
        ...(onTheRow as JSONObject),
        value: kept.toISOString(),
      };
    }

    return kept.toISOString();
  }

  private static isObject(value: unknown): boolean {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
}
