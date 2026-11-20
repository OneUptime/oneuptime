import ObjectID from "Common/Types/ObjectID";
import {
  LOGS_EXPLORER_LOG_PARAM,
  LOGS_EXPLORER_LOG_TIME_PARAM,
} from "Common/Utils/Telemetry/CrossSignalScope";

/*
 * The log line a Logs page's address opens (#9620), and the window it is
 * looked for in: what useOpenedLogLine reads before it fetches the line.
 * React-free, so App's tests can read it: App has no react
 * (Tests/FeatureSetImportsStayReactFree.test.ts). useOpenedLogLine
 * re-exports all of it.
 */

export interface OpenedLogLineAddress {
  logId: string;
  // When it was written, when the address says.
  logTime: Date | null;
}

// How far either side of when the line was written it is looked for.
export const OPENED_LOG_LINE_TIME_SLACK_IN_MS: number = 1000;

/*
 * Without a time: a line's id is made as it arrives (time-ordered), so it
 * is looked for in the day before its id says it arrived, and a few
 * minutes after.
 */
export const OPENED_LOG_LINE_ARRIVAL_LOOK_BACK_IN_MS: number =
  24 * 60 * 60 * 1000;
export const OPENED_LOG_LINE_ARRIVAL_LOOK_AHEAD_IN_MS: number = 5 * 60 * 1000;

// The line an address opens: none for an address that names no line, or one that is not an id.
export function readOpenedLogLineAddress(
  search: string,
): OpenedLogLineAddress | null {
  const params: URLSearchParams = new URLSearchParams(search);
  const logId: string = (params.get(LOGS_EXPLORER_LOG_PARAM) || "").trim();

  if (!logId || !ObjectID.isValidUUID(logId)) {
    return null;
  }

  const timeText: string = (
    params.get(LOGS_EXPLORER_LOG_TIME_PARAM) || ""
  ).trim();
  const time: Date | null = timeText ? new Date(timeText) : null;

  return {
    logId,
    logTime: time && !Number.isNaN(time.getTime()) ? time : null,
  };
}

// A UUID's 32 hex digits, its dashes taken out.
const UUID_HEX_DIGITS: RegExp = /^[0-9a-f]{32}$/;
const UUID_DASHES: RegExp = /-/g;

/*
 * When a time-ordered id (UUID version 7) was made: its first 48 bits, in
 * milliseconds. Null for any other id.
 */
export function getTimeOfTimeOrderedId(id: string): Date | null {
  const hex: string = id.replace(UUID_DASHES, "").toLowerCase();

  if (!UUID_HEX_DIGITS.test(hex) || hex.charAt(12) !== "7") {
    return null;
  }

  const time: Date = new Date(parseInt(hex.substring(0, 12), 16));

  return Number.isNaN(time.getTime()) ? null : time;
}

// The window the line is looked for in.
export function getOpenedLogLineWindow(data: {
  address: OpenedLogLineAddress;
  now: Date;
}): { start: Date; end: Date } {
  if (data.address.logTime) {
    const time: number = data.address.logTime.getTime();

    return {
      start: new Date(time - OPENED_LOG_LINE_TIME_SLACK_IN_MS),
      end: new Date(time + OPENED_LOG_LINE_TIME_SLACK_IN_MS),
    };
  }

  const arrived: Date | null = getTimeOfTimeOrderedId(data.address.logId);
  const anchor: number = (arrived || data.now).getTime();

  return {
    start: new Date(anchor - OPENED_LOG_LINE_ARRIVAL_LOOK_BACK_IN_MS),
    end: new Date(anchor + OPENED_LOG_LINE_ARRIVAL_LOOK_AHEAD_IN_MS),
  };
}
