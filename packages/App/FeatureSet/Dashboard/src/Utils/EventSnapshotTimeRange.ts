import InBetween from "Common/Types/BaseDatabase/InBetween";
import { JSONObject } from "Common/Types/JSON";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import TimeRange from "Common/Types/Time/TimeRange";
import { TimeRangeZoom } from "Common/UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";
import MetricInvestigationTime from "../Components/Metrics/Investigation/MetricInvestigationTime";

/*
 * THE TIME RANGE OF A LOGS, TRACES OR EXCEPTIONS SNAPSHOT (issue #6251).
 *
 * An incident or alert a log, trace or exception monitor opened keeps the
 * query the monitor ran and the window it ran it over. Its card lists what
 * that query finds - the primary explorer - with the other signals on tabs
 * beside it, and every tab shows one time range: the window the monitor
 * evaluated, until the reader picks another around the event (the same
 * ranges an event's metrics offer; see EventTimePresets) or drags out a
 * slice of the explorer's chart.
 *
 * Pure: the card and its tests read it the same way.
 */

// What the snapshot's other tabs say they show (TelemetryCompanionSignalTabs).
export type SnapshotCompanionWindow = "snapshot" | "zoomed" | "selected";

/*
 * What the snapshot's other tabs say they show: the snapshot window while
 * the reader changed nothing, "the zoomed part of the snapshot window"
 * while a zoom dragged out of it is on, and "the selected time range" for
 * anything else the reader picked - or zoomed into.
 */
export function getSnapshotCompanionWindow(time: {
  isTimeChanged: boolean;
  isZoomed: boolean;
  isZoomedFromDefault: boolean;
}): SnapshotCompanionWindow {
  if (!time.isTimeChanged) {
    return "snapshot";
  }

  if (time.isZoomed && time.isZoomedFromDefault) {
    return "zoomed";
  }

  return "selected";
}

/*
 * The query the primary explorer lists, on the window the card shows: the
 * stored query itself while that is the snapshot window - so an untouched
 * card hands the explorer exactly what it always did - and otherwise the
 * stored query with the window shown in its own window field (a log's or
 * an exception's `time`, a span's `startTime`), which the explorer follows
 * as a new pin. A query with no window field of its own is left as stored.
 */
export function getSnapshotExplorerQuery(input: {
  telemetryType: TelemetryType | null | undefined;
  storedQuery: TelemetryQuery["telemetryQuery"];
  snapshotWindow: InBetween<Date> | null | undefined;
  window: InBetween<Date>;
}): TelemetryQuery["telemetryQuery"] {
  if (!input.storedQuery) {
    return input.storedQuery;
  }

  const windowField: string | null = TelemetryQueryTimeRange.getWindowFieldName(
    input.telemetryType,
  );

  if (!windowField) {
    return input.storedQuery;
  }

  if (
    MetricInvestigationTime.isSameWindow(input.window, input.snapshotWindow)
  ) {
    return input.storedQuery;
  }

  return {
    ...(input.storedQuery as JSONObject),
    [windowField]: input.window,
  } as TelemetryQuery["telemetryQuery"];
}

/*
 * The card's zoom, as the primary explorer is offered it. An explorer
 * follows a zoom only while that zoom is over its very window, as a custom
 * range (useViewerTimeRangeZoom): the card's zoom says the range it is
 * over is the reader's pick, which for "Past 1 Hour" is a relative range.
 * Over the window shown, as a custom range, a drag on the explorer's chart
 * zooms the whole card whatever was picked, and the way back is the card's.
 */
export function getExplorerZoom(
  zoom: TimeRangeZoom,
  window: InBetween<Date>,
): TimeRangeZoom {
  return {
    ...zoom,
    timeRange: { range: TimeRange.CUSTOM, startAndEndDate: window },
  };
}
