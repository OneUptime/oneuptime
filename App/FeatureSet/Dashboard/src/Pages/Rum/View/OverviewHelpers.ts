import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import { RecordingHealthDiagnosis } from "Common/Types/Rum/SessionReplayHealth";
import {
  describeHealthError,
  SessionReplayHealthError,
} from "../../../Components/SessionReplay/SessionReplayHealthError";

/*
 * The pure decisions behind the RUM application overview page.
 *
 * Overview.tsx is React and pulls Common/UI/Config (which reads `window` on
 * load) through its chrome, so the page module cannot be imported by a node
 * test. These three are the parts a test should exercise for real rather
 * than read off the source, so they live here; Overview.tsx imports and
 * re-exports them.
 */

/*
 * The range a tile counted, in the tile's own words - "past 1 hour", not
 * "selected range" - so a viewer who clicks through to a list showing a
 * different default window is never told two counts for one thing without
 * being shown why (correlation-11).
 */
export function describeTimeRangeForTile(
  timeRange: RangeStartAndEndDateTime,
): string {
  if (timeRange.range === TimeRange.CUSTOM) {
    return "custom range";
  }

  return String(timeRange.range).toLowerCase();
}

/*
 * The URL grammar every telemetry explorer reads (range=<TimeRange>, plus
 * start/end for Custom), stamped onto a list route so the list can open on
 * the window the tile counted. Values are encoded because Route appends
 * them verbatim and rejects raw spaces and colons.
 */
export function buildRangedListRoute(
  listRoute: Route,
  timeRange: RangeStartAndEndDateTime,
): Route {
  const route: Route = new Route(listRoute.toString());
  const params: Record<string, string> = {
    range: encodeURIComponent(String(timeRange.range)),
  };

  if (timeRange.range === TimeRange.CUSTOM && timeRange.startAndEndDate) {
    params["start"] = encodeURIComponent(
      OneUptimeDate.toString(timeRange.startAndEndDate.startValue),
    );
    params["end"] = encodeURIComponent(
      OneUptimeDate.toString(timeRange.startAndEndDate.endValue),
    );
  }

  try {
    return route.addQueryParams(params);
  } catch {
    return listRoute;
  }
}

/*
 * The "Recording health" detail row's value, or undefined to leave the row
 * out entirely.
 *
 * A viewer without the Read Session Replay permission (or on a plan that
 * does not include replay) is shown nothing rather than a permission error
 * in a list of SDK facts - they cannot act on it here, and the settings
 * page is where that conversation belongs. Every other failure IS named,
 * because a silent row would read as "healthy".
 */
export function describeRecordingHealthRow(health: {
  isLoading: boolean;
  error: SessionReplayHealthError | null;
  diagnosis: RecordingHealthDiagnosis;
}): string | undefined {
  if (health.isLoading) {
    return "Checking…";
  }

  if (health.error) {
    if (health.error.kind === "permission" || health.error.kind === "plan") {
      return undefined;
    }

    return describeHealthError(health.error).title;
  }

  return health.diagnosis.title;
}
