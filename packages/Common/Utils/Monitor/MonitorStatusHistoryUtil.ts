import Color from "../../Types/Color";
import { JSONObject } from "../../Types/JSON";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorCheckScheduleUtil from "./MonitorCheckScheduleUtil";

/*
 * Reading the newest few MonitorStatusTimeline rows for the overview: how
 * long the current status has held, whether the stored current status has
 * drifted from the timeline, and the "Recent status changes" list.
 *
 * The server refuses a timeline row whose status equals its neighbour's
 * (MonitorStatusTimelineService), so the newest open row with the current
 * status marks exactly when that status began.
 */

export interface MonitorStatusChangeRow {
  id: string;
  statusName: string;
  statusColor: string | undefined;
  startsAt: Date;
  endsAt: Date | undefined;
  isOngoing: boolean;
}

// #rgb, #rgba, #rrggbb and #rrggbbaa.
const HEX_COLOR: RegExp = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// rgb(), rgba(), hsl() and hsla() with plain numeric arguments.
const FUNCTIONAL_COLOR: RegExp = /^(?:rgb|rgba|hsl|hsla)\(\s*[\d.%,\s/]+\)$/i;

// A CSS named colour such as "red" or "rebeccapurple".
const NAMED_COLOR: RegExp = /^[a-z]{3,20}$/i;

const getStatusId: (row: MonitorStatusTimeline | undefined) => string = (
  row: MonitorStatusTimeline | undefined,
): string => {
  return row?.monitorStatusId?.toString() || "";
};

export default class MonitorStatusHistoryUtil {
  /*
   * When the current status began, or undefined when the rows cannot vouch
   * for it: no rows, a closed newest row, or a newest row with another
   * status (drift). A headline must not say "Operational for 3 days" off a
   * row that describes something else.
   */
  public static getStatusSince(data: {
    currentStatusId: string | undefined;
    latestRow: MonitorStatusTimeline | undefined;
    now: Date;
  }): Date | undefined {
    const row: MonitorStatusTimeline | undefined = data.latestRow;

    if (!row || !data.currentStatusId) {
      return undefined;
    }

    if (MonitorCheckScheduleUtil.parseDate(row.endsAt)) {
      return undefined;
    }

    if (getStatusId(row) !== data.currentStatusId) {
      return undefined;
    }

    const startsAt: Date | undefined = MonitorCheckScheduleUtil.parseDate(
      row.startsAt,
    );

    if (!startsAt) {
      return undefined;
    }

    // Clock skew must not produce a status that began in the future.
    return startsAt.getTime() > data.now.getTime() ? data.now : startsAt;
  }

  /*
   * True when the newest timeline row disagrees with Monitor's stored
   * current status. The overview then waits for refresh-status and reloads
   * once, instead of showing two different statuses on one page.
   */
  public static hasStatusDrift(data: {
    currentStatusId: string | undefined;
    latestRow: MonitorStatusTimeline | undefined;
  }): boolean {
    if (!data.latestRow) {
      return false;
    }

    return getStatusId(data.latestRow) !== (data.currentStatusId || "");
  }

  /*
   * Rows must already be sorted newest first. A row with no end is capped
   * at the start of the row after it: only the newest open row is really
   * ongoing, and an older open row is an orphan the reconciler has not
   * closed yet, which must not read as still running.
   */
  public static getStatusChangeRows(
    rows: Array<MonitorStatusTimeline>,
  ): Array<MonitorStatusChangeRow> {
    const changeRows: Array<MonitorStatusChangeRow> = [];
    const list: Array<MonitorStatusTimeline> = rows || [];

    for (let i: number = 0; i < list.length; i++) {
      const row: MonitorStatusTimeline | undefined = list[i];

      if (!row) {
        continue;
      }

      const startsAt: Date | undefined = MonitorCheckScheduleUtil.parseDate(
        row.startsAt,
      );

      if (!startsAt) {
        continue;
      }

      const rowEndsAt: Date | undefined = MonitorCheckScheduleUtil.parseDate(
        row.endsAt,
      );
      const successorStartsAt: Date | undefined =
        i > 0
          ? MonitorCheckScheduleUtil.parseDate(list[i - 1]?.startsAt)
          : undefined;

      changeRows.push({
        id: row._id?.toString() || `row-${i}`,
        statusName: row.monitorStatus?.name || "Unknown status",
        statusColor: MonitorStatusHistoryUtil.normalizeColor(
          row.monitorStatus?.color,
        ),
        startsAt: startsAt,
        endsAt: rowEndsAt ?? successorStartsAt,
        isOngoing: i === 0 && !rowEndsAt,
      });
    }

    return changeRows;
  }

  /*
   * Changes when the current status changes, when a new newest row appears,
   * or when the newest row closes - the three things that should reload the
   * uptime strip and the feed.
   */
  public static getStatusFingerprint(data: {
    currentStatusId: string | undefined;
    latestRow: MonitorStatusTimeline | undefined;
  }): string {
    const endsAt: Date | undefined = MonitorCheckScheduleUtil.parseDate(
      data.latestRow?.endsAt,
    );

    return `${data.currentStatusId || ""}|${data.latestRow?._id?.toString() || ""}|${endsAt ? endsAt.toISOString() : ""}`;
  }

  /*
   * A status colour as a CSS value for an inline style, or undefined when
   * there is none or it is not a colour. Accepts the Color class, a plain
   * string, or a typed { _type: "Color", value } envelope.
   */
  public static normalizeColor(
    color: Color | string | undefined | null,
  ): string | undefined {
    if (color === null || color === undefined) {
      return undefined;
    }

    let text: string = "";

    if (typeof color === "string") {
      text = color;
    } else if (color instanceof Color) {
      text = color.toString();
    } else if (typeof color === "object") {
      const envelopeValue: unknown = (color as unknown as JSONObject)["value"];
      text =
        typeof envelopeValue === "string"
          ? envelopeValue
          : String((color as { color?: unknown }).color ?? "");
    }

    text = (text || "").trim();

    if (
      !text ||
      !(
        HEX_COLOR.test(text) ||
        FUNCTIONAL_COLOR.test(text) ||
        NAMED_COLOR.test(text)
      )
    ) {
      return undefined;
    }

    return text;
  }
}
