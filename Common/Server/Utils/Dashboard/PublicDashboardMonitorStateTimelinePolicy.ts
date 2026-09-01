import InBetween from "../../../Types/BaseDatabase/InBetween";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import Select from "../../Types/Database/Select";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";

/*
 * The server-owned policy for the public Monitor List "State Timeline" read.
 *
 * Nothing a public caller sends selects data. Which monitors are in scope
 * comes from the STORED widget (through PublicDashboardResourceListPolicy),
 * the project comes from the dashboard, and the columns come from the fixed
 * select below. The only caller-supplied input that survives is the time
 * window, and this module is what bounds and validates it.
 */

/*
 * Hard ceiling on the window a public viewer may request, independent of the
 * range picker's own options. A timeline row is written on every status
 * CHANGE, so an unbounded window on a flapping monitor is an unbounded read
 * — and unlike the authenticated app there is no session to attribute it to.
 * 3 months matches the longest range the dashboard time picker offers
 * (TimeRange.PAST_THREE_MONTHS).
 */
export const MAX_PUBLIC_STATE_TIMELINE_WINDOW_IN_DAYS: number = 92;

const MS_PER_DAY: number = 24 * 60 * 60 * 1000;

/*
 * Enough rows to draw a busy window, far below LIMIT_PER_PROJECT. A widget
 * showing 25 monitors would need each of them to change status 200 times in
 * the window to reach this.
 */
export const MAX_PUBLIC_STATE_TIMELINE_ROWS: number = 5000;

/*
 * Exactly the columns the timeline draws.
 *
 * This read runs as root after only a dashboard read-access check, so this
 * projection is the ONLY thing keeping the rest of the row out of an
 * anonymous response — `rootCause` and `statusChangeLog` in particular can
 * carry probe output and internal error detail, and must never appear here.
 */
export const PUBLIC_STATE_TIMELINE_SELECT: Select<MonitorStatusTimeline> = {
  monitorId: true,
  startsAt: true,
  endsAt: true,
  monitorStatus: {
    _id: true,
    name: true,
    color: true,
    isOperationalState: true,
    priority: true,
  },
};

export default class PublicDashboardMonitorStateTimelinePolicy {
  /**
   * The validated, bounded window for a public state-timeline read.
   *
   * A window longer than the ceiling is CLAMPED (its start is moved forward)
   * rather than rejected: the widget then draws a shorter range, which is a
   * better answer for a wall display than an error card.
   */
  public static resolveWindow(requestedWindow: unknown): InBetween<Date> {
    const deserialized: JSONValue = JSONFunctions.deserializeValue(
      requestedWindow as JSONValue,
    );

    if (!(deserialized instanceof InBetween)) {
      throw new BadDataException(
        "Public dashboard state timeline requires a startAndEndDate range.",
      );
    }

    const startDate: Date = PublicDashboardMonitorStateTimelinePolicy.validDate(
      deserialized.startValue,
    );
    const endDate: Date = PublicDashboardMonitorStateTimelinePolicy.validDate(
      deserialized.endValue,
    );

    if (startDate.getTime() >= endDate.getTime()) {
      throw new BadDataException(
        "Public dashboard state timeline range is invalid.",
      );
    }

    const maxWindowInMs: number =
      MAX_PUBLIC_STATE_TIMELINE_WINDOW_IN_DAYS * MS_PER_DAY;

    if (endDate.getTime() - startDate.getTime() > maxWindowInMs) {
      return new InBetween<Date>(
        new Date(endDate.getTime() - maxWindowInMs),
        endDate,
      );
    }

    return new InBetween<Date>(startDate, endDate);
  }

  private static validDate(value: unknown): Date {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return new Date(value.getTime());
    }

    if (typeof value === "string" && value.length <= 128) {
      const date: Date = new Date(value);
      if (Number.isFinite(date.getTime())) {
        return date;
      }
    }

    throw new BadDataException(
      "Public dashboard state timeline range contains an invalid date.",
    );
  }

  /**
   * Pulls the requested window off a public request body. Kept next to
   * resolveWindow so the body key ("startAndEndDate") is stated once and the
   * client and server cannot drift on it.
   */
  public static resolveWindowFromBody(
    body: JSONObject | undefined,
  ): InBetween<Date> {
    if (!body || body["startAndEndDate"] === undefined) {
      throw new BadDataException(
        "Public dashboard state timeline requires a startAndEndDate range.",
      );
    }

    return PublicDashboardMonitorStateTimelinePolicy.resolveWindow(
      body["startAndEndDate"],
    );
  }
}
