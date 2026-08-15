import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Log from "Common/Models/AnalyticsModels/Log";
import Query from "Common/Types/BaseDatabase/Query";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import { MonitorStepLogMonitorUtil } from "Common/Types/Monitor/MonitorStepLogMonitor";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";

/*
 * A telemetry monitor stamps the window it evaluated over onto the query it
 * stores on the incident/alert row, and the preview cards on those pages are
 * meant to render that exact window. The logs viewer did not: it copied the
 * stored query and then unconditionally re-stamped `time` with a rolling
 * "past 1 hour", from six separate places (the state initializer, the
 * props-sync effect, the facet rebuild, clear-all-filters, and the histogram
 * and facet fetches, which read the picker state rather than the query). So an
 * incident from last Tuesday rendered the last hour of unrelated logs under
 * "Logs for this incident", with the picker reading "Past 1 Hour".
 *
 * The fix seeds the viewer's time-range state from the query's window, which
 * every one of those six surfaces derives from. The decision itself is pure
 * and unit-tested in Common/Tests/Utils/Telemetry/TelemetryQueryTimeRange.test.ts;
 * this file covers the two things that test cannot reach:
 *
 *   1. the behaviour the seeding must produce, exercised against a real
 *      monitor evaluation (no renderer needed), and
 *   2. the component wiring, pinned by reading the sources — the App suite
 *      runs in plain Node with no renderer, the same constraint that
 *      IncidentMetricSeriesScope.test.ts works around the same way. Sources are
 *      comment-stripped and whitespace-squashed first so a prettier re-wrap
 *      cannot turn a real regression check into a red herring.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readSource(...relativeParts: Array<string>): string {
  return squash(
    stripComments(
      fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
    ),
  );
}

const LOGS_VIEWER: string = readSource("Components", "Logs", "LogsViewer.tsx");
const LOG_MONITOR_PREVIEW: string = readSource(
  "Components",
  "Monitor",
  "LogMonitor",
  "LogMonitorPreview.tsx",
);
const INCIDENT_VIEW: string = readSource(
  "Pages",
  "Incidents",
  "View",
  "Index.tsx",
);
const ALERT_VIEW: string = readSource("Pages", "Alerts", "View", "Index.tsx");
const METRIC_VIEW: string = readSource(
  "Components",
  "Metrics",
  "MetricView.tsx",
);
const METRIC_CHARTS: string = readSource(
  "Components",
  "Metrics",
  "MetricCharts.tsx",
);
const TRACE_TABLE: string = readSource(
  "Components",
  "Traces",
  "TraceTable.tsx",
);
const EXCEPTION_TABLE: string = readSource(
  "Components",
  "Exceptions",
  "ExceptionInstanceTable.tsx",
);

describe("a stored log monitor window resolves to a pinned picker range", () => {
  /*
   * End-to-end over the real production path — build the query the way the
   * worker does, persist it the way the worker does, restore it the way the
   * incident page does — then assert the value the viewer seeds its picker
   * with. This is the behaviour the four clobber sites used to destroy.
   */
  function restoreStoredLogQuery(lastXSecondsOfLogs: number): Query<Log> {
    const evaluated: Query<Log> = MonitorStepLogMonitorUtil.toQuery({
      ...MonitorStepLogMonitorUtil.getDefault(),
      body: "OutOfMemory",
      lastXSecondsOfLogs: lastXSecondsOfLogs,
    });

    return JSONFunctions.deserialize(
      JSONFunctions.anyObjectToJSONObject(evaluated),
    ) as unknown as Query<Log>;
  }

  test("pins to the monitor's window rather than the past hour", () => {
    const stored: Query<Log> = restoreStoredLogQuery(60);

    const pinned: RangeStartAndEndDateTime | null =
      TelemetryQueryTimeRange.getPinnedRangeForQuery(stored, TelemetryType.Log);

    expect(pinned).not.toBeNull();
    expect(pinned!.range).toBe(TimeRange.CUSTOM);
    expect(pinned!.range).not.toBe(TimeRange.PAST_ONE_HOUR);

    const resolved: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(pinned!);

    // A 60s monitor window must stay 60s, not widen to the 1h default.
    expect(resolved.endValue.getTime() - resolved.startValue.getTime()).toBe(
      60 * 1000,
    );
  });

  test("the pinned window does not slide as the clock moves", () => {
    /*
     * The property that makes the whole thing work. Every downstream request
     * (log list, histogram, facets) re-resolves the picker state. A relative
     * range would re-anchor to "now" on each call and walk away from the
     * incident; CUSTOM must resolve to the monitor's own instants every time.
     *
     * Asserted against the window stored on the query, NOT by comparing two
     * resolutions to each other: getStartAndEndDate returns the very same
     * InBetween reference for a CUSTOM range, so a self-comparison is
     * `x.getTime() === x.getTime()` and stays green even if the range silently
     * became relative.
     */
    const stored: Query<Log> = restoreStoredLogQuery(300);

    const evaluated: InBetween<Date> | null =
      TelemetryQueryTimeRange.getQueryWindow(stored, TelemetryType.Log);

    const pinned: RangeStartAndEndDateTime | null =
      TelemetryQueryTimeRange.getPinnedRangeForQuery(stored, TelemetryType.Log);

    const resolved: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(pinned!);

    expect(resolved.startValue.getTime()).toBe(evaluated!.startValue.getTime());
    expect(resolved.endValue.getTime()).toBe(evaluated!.endValue.getTime());

    /*
     * And it is not the rolling default wearing the monitor's clothes: a
     * relative range would resolve to a 1h span anchored on now, so pin the
     * width too. 300s vs 3600s makes this deterministic rather than a
     * millisecond race.
     */
    expect(resolved.endValue.getTime() - resolved.startValue.getTime()).toBe(
      300 * 1000,
    );

    const rollingHour: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate({
        range: TimeRange.PAST_ONE_HOUR,
      });

    expect(
      rollingHour.endValue.getTime() - rollingHour.startValue.getTime(),
    ).not.toBe(resolved.endValue.getTime() - resolved.startValue.getTime());
  });

  test("the pinned bounds are Dates, which the facets request requires", () => {
    // fetchFacets calls .toISOString() on these directly; a string would throw.
    const stored: Query<Log> = restoreStoredLogQuery(60);

    const resolved: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(
        TelemetryQueryTimeRange.getPinnedRangeForQuery(
          stored,
          TelemetryType.Log,
        )!,
      );

    expect(resolved.startValue).toBeInstanceOf(Date);
    expect(() => {
      return resolved.startValue.toISOString();
    }).not.toThrow();
  });

  test("a query with no window pins nothing, so other hosts keep their default", () => {
    /*
     * Backwards compatibility, and the reason the resource log pages
     * (Host / Docker / Kubernetes / ...) are untouched by this change: they
     * pass a logQuery with no `time`, so there is nothing to pin.
     */
    const noWindow: Query<Log> = restoreStoredLogQuery(0);

    expect((noWindow as JSONObject)["time"]).toBeUndefined();
    expect(
      TelemetryQueryTimeRange.getPinnedRangeForQuery(
        noWindow,
        TelemetryType.Log,
      ),
    ).toBeNull();
  });
});

describe("the logs viewer seeds its time range from the query's window", () => {
  test("derives a pinned range from props.logQuery", () => {
    expect(LOGS_VIEWER).toContain(
      "TelemetryQueryTimeRange.getPinnedRangeForQuery( props.logQuery, TelemetryType.Log, )",
    );
  });

  test("both the query state and the picker state start from the same seed", () => {
    /*
     * The two used to be seeded independently — filterOptions from the URL or
     * PAST_ONE_HOUR, the picker from PAST_ONE_HOUR — which is how the list and
     * the histogram could end up describing different windows.
     */
    expect(LOGS_VIEWER).toContain(
      "RangeStartAndEndDateTimeUtil.getStartAndEndDate(initialTimeRange)",
    );
    expect(LOGS_VIEWER).toContain(
      "useState<RangeStartAndEndDateTime>(initialTimeRange)",
    );
  });

  test("the pinned range wins over the rolling default in the seed", () => {
    expect(LOGS_VIEWER).toContain(
      "pinnedTimeRange || props.timeRangeOverride || initialUrlState?.timeRange || { range: TimeRange.PAST_ONE_HOUR }",
    );
  });

  test("no seed site stamps the rolling default unconditionally any more", () => {
    /*
     * The original defect, in one assertion: the initializer resolved
     * `initialUrlState?.timeRange || { range: TimeRange.PAST_ONE_HOUR }` inline
     * and stamped it over whatever the caller passed.
     */
    expect(LOGS_VIEWER).not.toContain(
      "const initialRange: RangeStartAndEndDateTime = initialUrlState?.timeRange || { range: TimeRange.PAST_ONE_HOUR };",
    );
  });

  test("the props-sync effect follows a new pinned window instead of overwriting it", () => {
    expect(LOGS_VIEWER).toContain(
      "const nextTimeRange: RangeStartAndEndDateTime = pinnedTimeRange || timeRange;",
    );
    expect(LOGS_VIEWER).toContain(
      "RangeStartAndEndDateTimeUtil.getStartAndEndDate(nextTimeRange)",
    );
  });

  test("the effect compares windows by value, so an equal-but-new query cannot loop", () => {
    expect(LOGS_VIEWER).toContain(
      "!TelemetryQueryTimeRange.isSameRange(pinnedTimeRange, timeRange)",
    );
  });

  test("interacting with facets or clearing filters re-derives from the picker state", () => {
    /*
     * The other two of the four sites that used to stamp the rolling default.
     * Neither needed changing — both rebuild the window from `timeRange`, which
     * now holds the pin — but that is exactly why they need pinning down: if
     * either ever resolved its own window again, clicking a facet chip or
     * "Clear all filters" inside an incident would silently jump the preview
     * back to the past hour.
     */
    const fromPickerState: string =
      "const dateRange: InBetween<Date> = RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);";

    // rebuildFilterOptionsFromFacets — behind facet include/exclude and search chips.
    expect(LOGS_VIEWER).toContain(
      `const updatedFilter: Query<Log> = buildBaseQuery(props); ${fromPickerState}`,
    );

    // handleClearAllFilters.
    expect(LOGS_VIEWER).toContain(
      `setAppliedFacetFilters(new Map()); const base: Query<Log> = buildBaseQuery(props); ${fromPickerState}`,
    );
  });

  test("the histogram and facet fetches still read the picker state", () => {
    /*
     * Not incidental — it is why seeding one value fixes all three surfaces.
     * If either fetch ever grew its own window resolution, the counts under an
     * incident would silently drift back to describing the past hour.
     */
    expect(LOGS_VIEWER).toContain(
      "buildLogsHistogramRequest({ timeRange: timeRange,",
    );
    expect(LOGS_VIEWER).toContain(
      "const dateRange: InBetween<Date> = RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange); const requestData: JSONObject = { startTime: dateRange.startValue.toISOString(), endTime: dateRange.endValue.toISOString(),",
    );
  });

  test("a pinned window suppresses the auto-applied default saved view", () => {
    /*
     * A saved view carries its own time range and would move an embedded
     * preview off the moment it is about.
     */
    expect(LOGS_VIEWER).toContain(
      "if (pinnedTimeRange || props.timeRangeOverride) { return; }",
    );
  });
});

describe("the monitor step's logs preview keeps its rolling window", () => {
  test("drops the evaluation window before handing the query to the viewer", () => {
    /*
     * Deliberate: pinning is right for an incident, but this preview exists to
     * help someone tune filters, and a 60-second window frozen at the instant
     * the form opened empties out a minute later. Dropping it keeps exactly
     * the behaviour this preview has always had.
     */
    expect(LOG_MONITOR_PREVIEW).toContain(
      'delete (query as Record<string, unknown>)["time"];',
    );
  });
});

describe("the incident and alert pages rebuild the window's Date bounds", () => {
  test.each([
    ["incident", INCIDENT_VIEW],
    ["alert", ALERT_VIEW],
  ])(
    "%s page hydrates the deserialized telemetryQuery",
    (_name: string, source: string) => {
      expect(source).toContain(
        "telemetryQuery = TelemetryQueryTimeRange.hydrate(telemetryQuery);",
      );
    },
  );

  test.each([
    ["incident", INCIDENT_VIEW],
    ["alert", ALERT_VIEW],
  ])(
    "%s page resolves the snapshot window for display",
    (_name: string, source: string) => {
      expect(source).toContain(
        "setTelemetrySnapshotWindow( TelemetryQueryTimeRange.getSnapshotWindow(telemetryQuery), )",
      );
    },
  );

  test.each([
    ["incident", INCIDENT_VIEW],
    ["alert", ALERT_VIEW],
  ])(
    "%s page shows the window on all four preview cards, not just metrics",
    (_name: string, source: string) => {
      /*
       * The log card's absence of any window indicator is what made the bug
       * invisible: with nothing on screen claiming a window, rolling
       * past-1-hour rows read as the incident's own rows.
       */
      const occurrences: number = source.split(
        "rightElement={snapshotWindowAlert}",
      ).length;

      // Logs, traces, metrics, exceptions.
      expect(occurrences - 1).toBe(4);
    },
  );

  test.each([
    ["incident", INCIDENT_VIEW],
    ["alert", ALERT_VIEW],
  ])(
    "%s page passes undefined, not an empty element, when no window was stored",
    (_name: string, source: string) => {
      /*
       * Card lays out its right-hand column based on the PRESENCE of
       * rightElement. An element that renders an empty fragment is still
       * truthy, so handing one over for an incident with no stored window
       * leaves an empty block and shifts the title.
       */
      expect(source).toContain(
        "const snapshotWindowAlert: ReactElement | undefined = telemetrySnapshotWindow ?",
      );
      expect(source).toContain(": undefined;");
    },
  );

  test.each([
    ["incident", INCIDENT_VIEW],
    ["alert", ALERT_VIEW],
  ])(
    "%s page stops the trace and exception tables restoring a filter over the pin",
    (_name: string, source: string) => {
      expect(source.split("disableUrlState={true}").length - 1).toBe(2);
    },
  );
});

describe("the tables and charts accept the pinned window", () => {
  test("trace and exception tables forward a header element and can opt out of URL state", () => {
    for (const source of [TRACE_TABLE, EXCEPTION_TABLE]) {
      expect(source).toContain("rightElement?: ReactElement | undefined;");
      expect(source).toContain("disableUrlState?: boolean | undefined;");
      expect(source).toContain("disableUrlState={props.disableUrlState}");
    }
  });

  test("the metric chart no longer gates alignment on instanceof Date", () => {
    /*
     * A restored window's bounds are ISO strings, so this guard made
     * bucket-grid alignment a no-op on every incident and alert page.
     */
    expect(METRIC_VIEW).toContain(
      "TelemetryQueryTimeRange.toDateWindow( data.startAndEndDate, )",
    );
    expect(METRIC_VIEW).not.toContain(
      "if (!(start instanceof Date) || !(end instanceof Date))",
    );
  });

  test("exemplar fetching no longer gates on instanceof Date", () => {
    // Same string-vs-Date trap; it left startMs/endMs undefined and the effect bailed.
    expect(METRIC_CHARTS).toContain(
      "const startMs: number | undefined = exemplarWindow?.startValue.getTime();",
    );
    expect(METRIC_CHARTS).not.toContain(
      "props.metricViewData.startAndEndDate?.startValue instanceof Date",
    );
  });
});
