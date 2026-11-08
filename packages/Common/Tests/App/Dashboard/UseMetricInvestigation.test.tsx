import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, renderHook, RenderHookResult } from "@testing-library/react";
import useMetricInvestigation, {
  MetricInvestigationState,
  UseMetricInvestigationOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Investigation/UseMetricInvestigation";
import {
  MetricInvestigationTimeKind,
  MetricInvestigationTimePreset,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigationTime";
import MetricInvestigationQueryUtil, {
  MetricInvestigationQueries,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigationQueries";
import {
  EVENT_AROUND_START_SELECTION,
  EventTimePresetId,
  getEventTimePresets,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/EventTimePresets";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * The state of a metric investigation (issue #5954): what it shows before
 * anybody touches it, what each pick, zoom, edit, refresh and reset does to
 * it, and what it keeps in the page's URL.
 */

const MINUTE_MS: number = 60 * 1000;
const STARTED_AT: Date = new Date("2026-11-05T05:44:00.000Z");
const EVALUATED: InBetween<Date> = new InBetween<Date>(
  new Date("2026-11-05T05:39:00.000Z"),
  new Date("2026-11-05T05:44:00.000Z"),
);
const NOW: Date = new Date("2026-11-05T09:00:00.000Z");
const PAGE: string = "/dashboard/project-1/incidents/incident-1";

function query(metricName: string, variable: string): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: variable,
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: metricName,
        attributes: { "resource.k8s.pod.name": "api-0" } as never,
        aggegationType: MetricsAggregationType.Avg,
      },
    },
  };
}

const INCIDENT_QUERIES: MetricInvestigationQueries = {
  queryConfigs: [query("pod_memory_limit_saturation", "a")],
  formulaConfigs: [],
};

const CHANGED_QUERIES: MetricInvestigationQueries = {
  queryConfigs: [
    query("pod_memory_limit_saturation", "a"),
    query("pod_cpu_saturation", "b"),
  ],
  formulaConfigs: [],
};

function incidentPresets(now: Date): Array<MetricInvestigationTimePreset> {
  return getEventTimePresets(
    { startedAt: STARTED_AT, evaluationWindow: EVALUATED },
    now,
  );
}

function options(
  overrides?: Partial<UseMetricInvestigationOptions>,
): UseMetricInvestigationOptions {
  return {
    defaultQueries: INCIDENT_QUERIES,
    getPresets: incidentPresets,
    defaultSelection: EVENT_AROUND_START_SELECTION,
    urlParamPrefix: "metrics",
    ...overrides,
  };
}

type Rendered = RenderHookResult<
  MetricInvestigationState,
  UseMetricInvestigationOptions
>;

function renderInvestigation(
  overrides?: Partial<UseMetricInvestigationOptions>,
): Rendered {
  return renderHook(
    (props: UseMetricInvestigationOptions): MetricInvestigationState => {
      return useMetricInvestigation(props);
    },
    { initialProps: options(overrides) },
  );
}

function shown(rendered: Rendered): [string, string] {
  return [
    rendered.result.current.window.startValue.toISOString(),
    rendered.result.current.window.endValue.toISOString(),
  ];
}

function urlParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

function openPage(search: string = ""): void {
  window.history.replaceState({}, "", `${PAGE}${search}`);
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  openPage("?tab=overview");
});

afterEach(() => {
  jest.useRealTimers();
});

describe("before anybody touches it", () => {
  test("it shows the page's metrics around the start, and says nothing changed", () => {
    const rendered: Rendered = renderInvestigation();
    const investigation: MetricInvestigationState = rendered.result.current;

    expect(investigation.selection).toEqual(EVENT_AROUND_START_SELECTION);
    expect(shown(rendered)).toEqual([
      "2026-11-05T05:14:00.000Z",
      "2026-11-05T06:14:00.000Z",
    ]);
    expect(investigation.queries).toBe(INCIDENT_QUERIES);
    expect(investigation.metricViewData.queryConfigs).toBe(
      INCIDENT_QUERIES.queryConfigs,
    );
    expect(investigation.metricViewData.startAndEndDate).toBe(
      investigation.window,
    );
    // A pinned window: nothing for the explorer to roll on.
    expect(investigation.metricViewData.rangeToken).toBeUndefined();
    expect(investigation.isTimeChanged).toBe(false);
    expect(investigation.isQueriesChanged).toBe(false);
    expect(investigation.isZoomed).toBe(false);
    expect(investigation.refreshNonce).toBe(0);
    expect(
      investigation.presets.map((preset: MetricInvestigationTimePreset) => {
        return preset.id;
      }),
    ).toEqual([
      EventTimePresetId.AroundStart,
      EventTimePresetId.HourBefore,
      EventTimePresetId.DayBefore,
      EventTimePresetId.StartToEnd,
      EventTimePresetId.Evaluated,
    ]);
  });

  test("it leaves the URL as it was, and its link is the page's own", () => {
    const rendered: Rendered = renderInvestigation();

    expect(window.location.search).toBe("?tab=overview");
    expect(rendered.result.current.shareUrl).toBe(window.location.href);
  });

  test("with no presets it shows the past hour", () => {
    const rendered: Rendered = renderInvestigation({ getPresets: undefined });

    expect(rendered.result.current.selection).toEqual({
      kind: MetricInvestigationTimeKind.Relative,
      range: TimeRange.PAST_ONE_HOUR,
    });
    expect(shown(rendered)).toEqual([
      "2026-11-05T08:00:00.000Z",
      "2026-11-05T09:00:00.000Z",
    ]);
    expect(rendered.result.current.metricViewData.rangeToken).toBe(
      TimeRange.PAST_ONE_HOUR,
    );
  });
});

describe("picking a time range", () => {
  test("a preset moves the window and goes in the URL", () => {
    const rendered: Rendered = renderInvestigation();

    act(() => {
      rendered.result.current.selectPreset(EventTimePresetId.HourBefore);
    });

    expect(shown(rendered)).toEqual([
      "2026-11-05T04:44:00.000Z",
      "2026-11-05T05:44:00.000Z",
    ]);
    expect(rendered.result.current.isTimeChanged).toBe(true);
    expect(urlParam("metricsTime")).toBe("hour-before");
    expect(urlParam("tab")).toBe("overview");
    expect(rendered.result.current.shareUrl).toContain(
      "metricsTime=hour-before",
    );
  });

  test("picking the default again is no change, and tidies the URL", () => {
    const rendered: Rendered = renderInvestigation();

    act(() => {
      rendered.result.current.selectPreset(EventTimePresetId.DayBefore);
    });
    act(() => {
      rendered.result.current.selectPreset(EventTimePresetId.AroundStart);
    });

    expect(rendered.result.current.isTimeChanged).toBe(false);
    expect(urlParam("metricsTime")).toBeNull();
    expect(window.location.search).toBe("?tab=overview");
  });

  test("a preset the page does not offer changes nothing", () => {
    const rendered: Rendered = renderInvestigation();
    const before: MetricInvestigationState = rendered.result.current;

    act(() => {
      rendered.result.current.selectPreset("next-week");
    });

    expect(rendered.result.current.selection).toEqual(before.selection);
    expect(rendered.result.current.window).toBe(before.window);
  });

  test("a range relative to now ends at now, and Refresh moves it on", () => {
    const rendered: Rendered = renderInvestigation();

    act(() => {
      rendered.result.current.selectPickerValue({
        range: TimeRange.PAST_FIFTEEN_MINS,
      });
    });

    expect(shown(rendered)).toEqual([
      "2026-11-05T08:45:00.000Z",
      "2026-11-05T09:00:00.000Z",
    ]);
    expect(rendered.result.current.pickerValue.range).toBe(
      TimeRange.PAST_FIFTEEN_MINS,
    );
    expect(rendered.result.current.metricViewData.rangeToken).toBe(
      TimeRange.PAST_FIFTEEN_MINS,
    );
    expect(urlParam("metricsTime")).toBe("Past 15 Mins");

    jest.setSystemTime(new Date(NOW.getTime() + 5 * MINUTE_MS));

    act(() => {
      rendered.result.current.refresh();
    });

    expect(shown(rendered)).toEqual([
      "2026-11-05T08:50:00.000Z",
      "2026-11-05T09:05:00.000Z",
    ]);
    expect(rendered.result.current.refreshNonce).toBe(1);
  });

  test("Refresh keeps a window that does not end at now, and still bumps the charts", () => {
    const rendered: Rendered = renderInvestigation();
    const before: InBetween<Date> = rendered.result.current.window;

    jest.setSystemTime(new Date(NOW.getTime() + 60 * MINUTE_MS));

    act(() => {
      rendered.result.current.refresh();
    });

    expect(rendered.result.current.window).toBe(before);
    expect(rendered.result.current.refreshNonce).toBe(1);
  });

  test("an open incident's start to now follows now on Refresh", () => {
    const rendered: Rendered = renderInvestigation();

    act(() => {
      rendered.result.current.selectPreset(EventTimePresetId.StartToEnd);
    });

    expect(shown(rendered)[1]).toBe(NOW.toISOString());

    jest.setSystemTime(new Date(NOW.getTime() + 10 * MINUTE_MS));

    act(() => {
      rendered.result.current.refresh();
    });

    expect(shown(rendered)[1]).toBe("2026-11-05T09:10:00.000Z");
  });

  test("a custom range from the picker is kept with both its instants", () => {
    const rendered: Rendered = renderInvestigation();

    act(() => {
      rendered.result.current.selectPickerValue({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2026-11-04T00:00:00.000Z"),
          new Date("2026-11-04T06:00:00.000Z"),
        ),
      });
    });

    expect(shown(rendered)).toEqual([
      "2026-11-04T00:00:00.000Z",
      "2026-11-04T06:00:00.000Z",
    ]);
    expect(rendered.result.current.selection.kind).toBe(
      MetricInvestigationTimeKind.Custom,
    );
    expect(urlParam("metricsTime")).toBe("custom");
    expect(urlParam("metricsStart")).toBe("2026-11-04T00:00:00.000Z");
    expect(urlParam("metricsEnd")).toBe("2026-11-04T06:00:00.000Z");
  });

  test("a custom pick with no window changes nothing", () => {
    const rendered: Rendered = renderInvestigation();
    const before: MetricInvestigationState = rendered.result.current;

    act(() => {
      rendered.result.current.selectPickerValue({ range: TimeRange.CUSTOM });
    });

    expect(rendered.result.current.selection).toEqual(before.selection);
  });
});

describe("a drag across a chart", () => {
  test("zooms in, and a reset goes back to the pick from before", () => {
    const rendered: Rendered = renderInvestigation();

    act(() => {
      rendered.result.current.zoom.zoomToTimeRange(
        new Date("2026-11-05T05:30:00.000Z"),
        new Date("2026-11-05T05:50:00.000Z"),
      );
    });

    expect(rendered.result.current.isZoomed).toBe(true);
    expect(rendered.result.current.zoom.isZoomed).toBe(true);
    expect(shown(rendered)).toEqual([
      "2026-11-05T05:30:00.000Z",
      "2026-11-05T05:50:00.000Z",
    ]);
    // The preset is a custom window to the picker's Reset zoom words.
    expect(rendered.result.current.zoom.rangeBeforeZoom?.range).toBe(
      TimeRange.CUSTOM,
    );
    expect(urlParam("metricsTime")).toBe("custom");

    act(() => {
      rendered.result.current.zoom.resetZoom();
    });

    expect(rendered.result.current.isZoomed).toBe(false);
    expect(rendered.result.current.selection).toEqual(
      EVENT_AROUND_START_SELECTION,
    );
    expect(shown(rendered)).toEqual([
      "2026-11-05T05:14:00.000Z",
      "2026-11-05T06:14:00.000Z",
    ]);
    expect(urlParam("metricsTime")).toBeNull();
  });

  test("a second zoom inside the first still resets to the pick before both", () => {
    const rendered: Rendered = renderInvestigation();

    act(() => {
      rendered.result.current.selectPreset(EventTimePresetId.DayBefore);
    });
    act(() => {
      rendered.result.current.zoom.zoomToTimeRange(
        new Date("2026-11-05T01:00:00.000Z"),
        new Date("2026-11-05T03:00:00.000Z"),
      );
    });
    act(() => {
      rendered.result.current.zoom.zoomToTimeRange(
        new Date("2026-11-05T02:00:00.000Z"),
        new Date("2026-11-05T02:30:00.000Z"),
      );
    });

    expect(shown(rendered)).toEqual([
      "2026-11-05T02:00:00.000Z",
      "2026-11-05T02:30:00.000Z",
    ]);

    act(() => {
      rendered.result.current.zoom.resetZoom();
    });

    expect(rendered.result.current.selection).toEqual({
      kind: MetricInvestigationTimeKind.Preset,
      presetId: EventTimePresetId.DayBefore,
    });
  });

  test("the Reset zoom words name a relative range zoomed from", () => {
    const rendered: Rendered = renderInvestigation();

    act(() => {
      rendered.result.current.selectPickerValue({
        range: TimeRange.PAST_ONE_HOUR,
      });
    });
    act(() => {
      rendered.result.current.zoom.zoomToTimeRange(
        new Date("2026-11-05T08:10:00.000Z"),
        new Date("2026-11-05T08:20:00.000Z"),
      );
    });

    expect(rendered.result.current.zoom.rangeBeforeZoom?.range).toBe(
      TimeRange.PAST_ONE_HOUR,
    );
  });

  test("never past the end of the window on screen", () => {
    const rendered: Rendered = renderInvestigation();

    act(() => {
      rendered.result.current.zoom.zoomToTimeRange(
        new Date("2026-11-05T06:00:00.000Z"),
        new Date("2026-11-05T07:00:00.000Z"),
      );
    });

    expect(shown(rendered)[1]).toBe("2026-11-05T06:14:00.000Z");
  });

  test("a drag that is not a window, or a reset with nothing to undo, changes nothing", () => {
    const rendered: Rendered = renderInvestigation();
    const before: InBetween<Date> = rendered.result.current.window;

    act(() => {
      rendered.result.current.zoom.zoomToTimeRange(
        new Date("2026-11-05T05:30:00.000Z"),
        new Date("2026-11-05T05:30:00.000Z"),
      );
    });
    act(() => {
      rendered.result.current.zoom.resetZoom();
    });

    expect(rendered.result.current.window).toBe(before);
    expect(rendered.result.current.isZoomed).toBe(false);
  });

  test("picking another range ends the zoom: there is nothing to reset to", () => {
    const rendered: Rendered = renderInvestigation();

    act(() => {
      rendered.result.current.zoom.zoomToTimeRange(
        new Date("2026-11-05T05:30:00.000Z"),
        new Date("2026-11-05T05:50:00.000Z"),
      );
    });
    act(() => {
      rendered.result.current.selectPreset(EventTimePresetId.HourBefore);
    });

    expect(rendered.result.current.isZoomed).toBe(false);

    act(() => {
      rendered.result.current.zoom.resetZoom();
    });

    expect(rendered.result.current.selection).toEqual({
      kind: MetricInvestigationTimeKind.Preset,
      presetId: EventTimePresetId.HourBefore,
    });
  });

  test("the zoom's handlers keep their identity across renders", () => {
    const rendered: Rendered = renderInvestigation();
    const zoomToTimeRange: (start: Date, end: Date) => void =
      rendered.result.current.zoom.zoomToTimeRange;
    const resetZoom: () => void = rendered.result.current.zoom.resetZoom;

    act(() => {
      rendered.result.current.selectPreset(EventTimePresetId.DayBefore);
    });

    expect(rendered.result.current.zoom.zoomToTimeRange).toBe(zoomToTimeRange);
    expect(rendered.result.current.zoom.resetZoom).toBe(resetZoom);
  });
});

describe("changing the metrics", () => {
  test("is a change, kept in the URL; changing them back is none", () => {
    const rendered: Rendered = renderInvestigation();

    act(() => {
      rendered.result.current.setQueries(CHANGED_QUERIES);
    });

    expect(rendered.result.current.isQueriesChanged).toBe(true);
    expect(rendered.result.current.queries).toEqual(CHANGED_QUERIES);
    expect(rendered.result.current.metricViewData.queryConfigs).toHaveLength(2);
    expect(urlParam("metricsQueries")).toContain("pod_cpu_saturation");

    act(() => {
      rendered.result.current.setQueries({
        queryConfigs: [query("pod_memory_limit_saturation", "a")],
        formulaConfigs: [],
      });
    });

    expect(rendered.result.current.isQueriesChanged).toBe(false);
    expect(rendered.result.current.queries).toBe(INCIDENT_QUERIES);
    expect(urlParam("metricsQueries")).toBeNull();
  });

  test("Reset goes back to the page's metrics and time range, and tidies the URL", () => {
    const rendered: Rendered = renderInvestigation();

    act(() => {
      rendered.result.current.setQueries(CHANGED_QUERIES);
      rendered.result.current.selectPreset(EventTimePresetId.DayBefore);
    });
    act(() => {
      rendered.result.current.zoom.zoomToTimeRange(
        new Date("2026-11-05T01:00:00.000Z"),
        new Date("2026-11-05T03:00:00.000Z"),
      );
    });
    act(() => {
      rendered.result.current.reset();
    });

    expect(rendered.result.current.isQueriesChanged).toBe(false);
    expect(rendered.result.current.isTimeChanged).toBe(false);
    expect(rendered.result.current.isZoomed).toBe(false);
    expect(rendered.result.current.queries).toBe(INCIDENT_QUERIES);
    expect(window.location.search).toBe("?tab=overview");
  });
});

describe("a page opened on a link", () => {
  test("opens on the time range and metrics the link holds", () => {
    const changed: string =
      MetricInvestigationQueryUtil.toUrlValue(CHANGED_QUERIES)!.queries;
    openPage(
      `?metricsTime=hour-before&metricsQueries=${encodeURIComponent(changed)}`,
    );

    const rendered: Rendered = renderInvestigation();

    expect(rendered.result.current.selection).toEqual({
      kind: MetricInvestigationTimeKind.Preset,
      presetId: EventTimePresetId.HourBefore,
    });
    expect(rendered.result.current.isTimeChanged).toBe(true);
    expect(rendered.result.current.isQueriesChanged).toBe(true);
    expect(
      MetricInvestigationQueryUtil.isSame(
        rendered.result.current.queries,
        CHANGED_QUERIES,
      ),
    ).toBe(true);
    expect(urlParam("metricsTime")).toBe("hour-before");
  });

  test("a link to a custom window opens on it", () => {
    openPage(
      "?metricsTime=custom&metricsStart=2026-11-05T05:00:00.000Z&metricsEnd=2026-11-05T05:20:00.000Z",
    );

    const rendered: Rendered = renderInvestigation();

    expect(shown(rendered)).toEqual([
      "2026-11-05T05:00:00.000Z",
      "2026-11-05T05:20:00.000Z",
    ]);
  });

  test("what the page cannot show is tidied out of the URL; the rest stays", () => {
    openPage("?tab=logs&metricsTime=next-week&metricsQueries=%7Boops");

    const rendered: Rendered = renderInvestigation();

    expect(rendered.result.current.isTimeChanged).toBe(false);
    expect(rendered.result.current.isQueriesChanged).toBe(false);
    expect(window.location.search).toBe("?tab=logs");
  });

  test("a link to the defaults is no change", () => {
    openPage("?metricsTime=around-start");

    const rendered: Rendered = renderInvestigation();

    expect(rendered.result.current.isTimeChanged).toBe(false);
    expect(urlParam("metricsTime")).toBeNull();
  });

  test("without a URL prefix the URL is neither read nor written", () => {
    openPage("?metricsTime=hour-before");

    const rendered: Rendered = renderInvestigation({
      urlParamPrefix: undefined,
    });

    expect(rendered.result.current.isTimeChanged).toBe(false);
    expect(rendered.result.current.shareUrl).toBeNull();

    act(() => {
      rendered.result.current.selectPreset(EventTimePresetId.DayBefore);
    });

    expect(window.location.search).toBe("?metricsTime=hour-before");
  });
});

describe("the page's defaults", () => {
  test("an equal copy of them changes nothing: the window and data keep their identity", () => {
    const rendered: Rendered = renderInvestigation();
    const before: MetricInvestigationState = rendered.result.current;

    rendered.rerender(
      options({
        defaultQueries: {
          queryConfigs: [query("pod_memory_limit_saturation", "a")],
          formulaConfigs: [],
        },
        getPresets: (now: Date): Array<MetricInvestigationTimePreset> => {
          return incidentPresets(now);
        },
      }),
    );

    expect(rendered.result.current.window).toBe(before.window);
    expect(rendered.result.current.queries).toBe(before.queries);
    expect(rendered.result.current.metricViewData).toBe(before.metricViewData);
    expect(rendered.result.current.pickerValue).toBe(before.pickerValue);
  });

  test("are followed until the reader changes something", () => {
    const rendered: Rendered = renderInvestigation();

    rendered.rerender(
      options({
        defaultQueries: CHANGED_QUERIES,
        getPresets: (now: Date): Array<MetricInvestigationTimePreset> => {
          return getEventTimePresets(
            { startedAt: new Date("2026-11-05T07:00:00.000Z") },
            now,
          );
        },
      }),
    );

    expect(shown(rendered)).toEqual([
      "2026-11-05T06:30:00.000Z",
      "2026-11-05T07:30:00.000Z",
    ]);
    expect(rendered.result.current.queries).toBe(CHANGED_QUERIES);
    expect(rendered.result.current.isQueriesChanged).toBe(false);
  });

  test("a preset the page stops offering falls back to the default", () => {
    const rendered: Rendered = renderInvestigation();

    act(() => {
      rendered.result.current.selectPreset(EventTimePresetId.Evaluated);
    });

    rendered.rerender(
      options({
        getPresets: (now: Date): Array<MetricInvestigationTimePreset> => {
          return getEventTimePresets({ startedAt: STARTED_AT }, now);
        },
      }),
    );

    expect(rendered.result.current.selection).toEqual(
      EVENT_AROUND_START_SELECTION,
    );
    expect(rendered.result.current.isTimeChanged).toBe(false);
  });
});
