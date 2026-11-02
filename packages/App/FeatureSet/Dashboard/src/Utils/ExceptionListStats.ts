import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { JSONObject } from "Common/Types/JSON";
import {
  ExceptionListStats,
  ExceptionListStatsItem,
  MAX_EXCEPTION_LIST_STATS_IDS,
  readExceptionListStats,
} from "Common/Types/Telemetry/ExceptionListStats";

/*
 * The exceptions list's request for its rows' affected users and trend
 * charts (POST /telemetry-exception/list-stats), and its answer by
 * exception. Pure, so the request a page sends is pinned by a test.
 */

export const EXCEPTION_LIST_STATS_ROUTE: string =
  "/telemetry-exception/list-stats";

// Each row's numbers, keyed by the exception's id in lower case.
export type ExceptionListStatsById = Map<string, ExceptionListStatsItem>;

function idOf(exception: TelemetryException): string {
  return (exception._id || exception.id)?.toString() || "";
}

/*
 * The body for a page of rows and the range they were read for: their ids,
 * once each and at most as many as one request takes, and the range. Null
 * when the page has no row to ask about.
 */
export function buildExceptionListStatsRequest(data: {
  exceptions: ReadonlyArray<TelemetryException>;
  window: InBetween<Date>;
}): JSONObject | null {
  const ids: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const exception of data.exceptions) {
    const id: string = idOf(exception);

    if (!id || seen.has(id.toLowerCase())) {
      continue;
    }

    seen.add(id.toLowerCase());
    ids.push(id);

    if (ids.length >= MAX_EXCEPTION_LIST_STATS_IDS) {
      break;
    }
  }

  if (ids.length === 0) {
    return null;
  }

  return {
    telemetryExceptionIds: ids,
    startTime: data.window.startValue.toISOString(),
    endTime: data.window.endValue.toISOString(),
  };
}

// The answer by exception id, or null when it is not one.
export function readExceptionListStatsById(
  value: unknown,
): ExceptionListStatsById | null {
  const stats: ExceptionListStats | null = readExceptionListStats(value);

  if (!stats) {
    return null;
  }

  const byId: ExceptionListStatsById = new Map();

  for (const item of stats.items) {
    byId.set(item.telemetryExceptionId.toLowerCase(), item);
  }

  return byId;
}

// One row's numbers, if the answer has them.
export function getExceptionRowStats(
  stats: ExceptionListStatsById | null,
  exception: TelemetryException,
): ExceptionListStatsItem | undefined {
  const id: string = idOf(exception);

  return stats && id ? stats.get(id.toLowerCase()) : undefined;
}
