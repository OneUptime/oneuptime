import InBetween from "../../../Types/BaseDatabase/InBetween";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import Select from "../../Types/Database/Select";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorStateTimelineUtil, {
  MAX_STATE_TIMELINE_WINDOW_IN_DAYS,
} from "../../../Utils/Monitor/MonitorStateTimelineUtil";

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
 * Re-exported so this module reads as the complete public-route policy, but
 * OWNED by the shared timeline util: the browser applies the same ceiling
 * before it draws, so an over-long range narrows identically on both sides of
 * the wire instead of the axis labelling a span the server never queried.
 */
export const MAX_PUBLIC_STATE_TIMELINE_WINDOW_IN_DAYS: number =
  MAX_STATE_TIMELINE_WINDOW_IN_DAYS;

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
   * Refuse a widget that does not draw a state timeline.
   *
   * Only the timeline view mode publishes status HISTORY. A Monitor List left
   * in list or honeycomb mode publishes each monitor's name, type and CURRENT
   * status and nothing more — the resource-list policy's select says exactly
   * that — so serving 92 days of every status change for one would hand out
   * history its author never put on the page. Adding a widget to a public
   * dashboard is the owner's only opt-in to exposing data, and the view mode
   * is part of what they opted into.
   */
  public static assertWidgetDrawsTimeline(widget: JSONObject): void {
    const widgetArguments: unknown = widget["arguments"];

    const viewMode: unknown =
      widgetArguments &&
      typeof widgetArguments === "object" &&
      !Array.isArray(widgetArguments)
        ? (widgetArguments as Record<string, unknown>)["viewMode"]
        : undefined;

    if (viewMode !== "timeline") {
      throw new BadDataException(
        "This dashboard widget does not show a monitor state timeline.",
      );
    }
  }

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

    const clamped: { startDate: Date; endDate: Date } =
      MonitorStateTimelineUtil.clampWindow({
        startDate: startDate,
        endDate: endDate,
      });

    return new InBetween<Date>(clamped.startDate, clamped.endDate);
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
