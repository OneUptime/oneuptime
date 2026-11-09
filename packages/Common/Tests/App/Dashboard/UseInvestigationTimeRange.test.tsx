import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, renderHook, RenderHookResult } from "@testing-library/react";
import useInvestigationTimeRange, {
  InvestigationTimeRangeState,
  UseInvestigationTimeRangeOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Investigation/UseInvestigationTimeRange";
import {
  MetricInvestigationTimeKind,
  MetricInvestigationTimePreset,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigationTime";
import {
  EVENT_EVALUATED_SELECTION,
  EventTimePresetId,
  getEventTimePresets,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/EventTimePresets";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * The time range of an investigation, on its own (issue #6251): what a
 * card with no metrics of its own holds - an incident's logs, traces or
 * exceptions card - and what a metric investigation composes with its
 * metrics. What it shows untouched, what each pick, zoom, refresh and reset
 * does, and what it keeps in the page's URL.
 *
 * Its defaults here are a log monitor's incident's: what the monitor saw
 * (the five minutes before the incident started), with the ranges around
 * the incident offered beside it. The zoom it holds is the one the
 * incident page used to hold above the card (useTelemetrySnapshotZoom):
 * a drag zooms the whole card, only the first zoom is remembered, a stray
 * reset does nothing, and the handlers keep their identity.
 */

const STARTED_AT: Date = new Date("2026-11-05T05:44:00.000Z");
const EVALUATED: InBetween<Date> = new InBetween<Date>(
  new Date("2026-11-05T05:39:00.000Z"),
  new Date("2026-11-05T05:44:00.000Z"),
);
const NOW: Date = new Date("2026-11-05T09:00:00.000Z");
const PAGE: string = "/dashboard/project-1/incidents/incident-1";
const PREFIX: string = "telemetry";

const SLICE: [Date, Date] = [
  new Date("2026-11-05T05:40:00.000Z"),
  new Date("2026-11-05T05:42:00.000Z"),
];
const NESTED: [Date, Date] = [
  new Date("2026-11-05T05:40:30.000Z"),
  new Date("2026-11-05T05:41:00.000Z"),
];

interface Props extends UseInvestigationTimeRangeOptions {
  startedAt?: Date | undefined;
  evaluationWindow?: InBetween<Date> | null | undefined;
}

function presetsFor(
  props: Props,
): (now: Date) => Array<MetricInvestigationTimePreset> {
  return (now: Date): Array<MetricInvestigationTimePreset> => {
    return getEventTimePresets(
      {
        startedAt: props.startedAt,
        evaluationWindow: props.evaluationWindow,
      },
      now,
    );
  };
}

function props(overrides?: Partial<Props>): Props {
  return {
    startedAt: STARTED_AT,
    evaluationWindow: EVALUATED,
    defaultSelection: EVENT_EVALUATED_SELECTION,
    urlParamPrefix: PREFIX,
    ...overrides,
  };
}

type Rendered = RenderHookResult<InvestigationTimeRangeState, Props>;

function renderTimeRange(overrides?: Partial<Props>): Rendered {
  return renderHook(
    (current: Props): InvestigationTimeRangeState => {
      return useInvestigationTimeRange({
        getPresets:
          "getPresets" in current ? current.getPresets : presetsFor(current),
        defaultSelection: current.defaultSelection,
        urlParamPrefix: current.urlParamPrefix,
      });
    },
    { initialProps: props(overrides) },
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

function zoomTo(rendered: Rendered, window: [Date, Date]): void {
  act(() => {
    rendered.result.current.zoom.zoomToTimeRange(window[0], window[1]);
  });
}

const EVALUATED_TEXT: [string, string] = [
  "2026-11-05T05:39:00.000Z",
  "2026-11-05T05:44:00.000Z",
];
const SLICE_TEXT: [string, string] = [
  "2026-11-05T05:40:00.000Z",
  "2026-11-05T05:42:00.000Z",
];
const HOUR_BEFORE_TEXT: [string, string] = [
  "2026-11-05T04:44:00.000Z",
  "2026-11-05T05:44:00.000Z",
];

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  openPage("?tab=overview");
});

afterEach(() => {
  jest.useRealTimers();
});

describe("before anybody touches it", () => {
  test("it shows what the monitor saw, offers the ranges around the incident, and says nothing changed", () => {
    const rendered: Rendered = renderTimeRange();
    const time: InvestigationTimeRangeState = rendered.result.current;

    expect(time.selection).toEqual(EVENT_EVALUATED_SELECTION);
    expect(shown(rendered)).toEqual(EVALUATED_TEXT);
    expect(time.pickerValue).toEqual({
      range: TimeRange.CUSTOM,
      startAndEndDate: time.window,
    });
    expect(
      time.presets.map((preset: MetricInvestigationTimePreset) => {
        return preset.id;
      }),
    ).toEqual([
      EventTimePresetId.AroundStart,
      EventTimePresetId.HourBefore,
      EventTimePresetId.DayBefore,
      EventTimePresetId.StartToEnd,
      EventTimePresetId.Evaluated,
    ]);
    expect(time.isTimeChanged).toBe(false);
    expect(time.isZoomed).toBe(false);
    expect(time.isZoomedFromDefault).toBe(false);
    expect(time.refreshNonce).toBe(0);
    expect(time.zoom.isZoomed).toBe(false);
    expect(time.zoom.rangeBeforeZoom).toBeNull();
    expect(time.zoom.timeRange).toBe(time.pickerValue);
  });

  test("it writes nothing to the URL, and its link is the page's own", () => {
    const rendered: Rendered = renderTimeRange();

    expect(window.location.search).toBe("?tab=overview");
    expect(rendered.result.current.urlParams).toEqual({
      telemetryTime: null,
      telemetryStart: null,
      telemetryEnd: null,
    });
    expect(rendered.result.current.shareUrl).toBe(window.location.href);
  });

  test("a stray reset of the zoom does nothing", () => {
    const rendered: Rendered = renderTimeRange();
    const before: InvestigationTimeRangeState = rendered.result.current;

    act(() => {
      rendered.result.current.zoom.resetZoom();
    });

    expect(rendered.result.current.selection).toBe(before.selection);
    expect(rendered.result.current.window).toBe(before.window);
    expect(window.location.search).toBe("?tab=overview");
  });

  test("with no presets it shows the past hour, relative to now", () => {
    const rendered: Rendered = renderTimeRange({ getPresets: undefined });

    expect(rendered.result.current.selection).toEqual({
      kind: MetricInvestigationTimeKind.Relative,
      range: TimeRange.PAST_ONE_HOUR,
    });
    expect(shown(rendered)).toEqual([
      "2026-11-05T08:00:00.000Z",
      "2026-11-05T09:00:00.000Z",
    ]);
    expect(rendered.result.current.presets).toEqual([]);
  });

  test("with no window the monitor saw, it starts on the first range around the incident", () => {
    const rendered: Rendered = renderTimeRange({ evaluationWindow: null });

    expect(rendered.result.current.selection).toEqual({
      kind: MetricInvestigationTimeKind.Preset,
      presetId: EventTimePresetId.AroundStart,
    });
    expect(shown(rendered)).toEqual([
      "2026-11-05T05:14:00.000Z",
      "2026-11-05T06:14:00.000Z",
    ]);
  });
});

describe("picking a time range", () => {
  test("a range around the incident moves the window, and is kept in the URL and the link", () => {
    const rendered: Rendered = renderTimeRange();

    act(() => {
      rendered.result.current.selectPreset(EventTimePresetId.HourBefore);
    });

    expect(shown(rendered)).toEqual(HOUR_BEFORE_TEXT);
    expect(rendered.result.current.isTimeChanged).toBe(true);
    expect(rendered.result.current.isZoomed).toBe(false);
    expect(urlParam("telemetryTime")).toBe("hour-before");
    expect(urlParam("tab")).toBe("overview");
    expect(rendered.result.current.shareUrl).toContain(
      "telemetryTime=hour-before",
    );
  });

  test("picking what the monitor saw again is no change, and tidies the URL", () => {
    const rendered: Rendered = renderTimeRange();

    act(() => {
      rendered.result.current.selectPreset(EventTimePresetId.DayBefore);
    });
    act(() => {
      rendered.result.current.selectPreset(EventTimePresetId.Evaluated);
    });

    expect(shown(rendered)).toEqual(EVALUATED_TEXT);
    expect(rendered.result.current.isTimeChanged).toBe(false);
    expect(window.location.search).toBe("?tab=overview");
  });

  test("a range the page does not offer changes nothing", () => {
    const rendered: Rendered = renderTimeRange();
    const before: InvestigationTimeRangeState = rendered.result.current;

    act(() => {
      rendered.result.current.selectPreset("next-week");
    });

    expect(rendered.result.current.selection).toBe(before.selection);
    expect(rendered.result.current.isTimeChanged).toBe(false);
    expect(window.location.search).toBe("?tab=overview");
  });

  test("a range relative to now ends at now, and Refresh moves it on", () => {
    const rendered: Rendered = renderTimeRange();

    act(() => {
      rendered.result.current.selectPickerValue({
        range: TimeRange.PAST_ONE_DAY,
      });
    });

    expect(shown(rendered)).toEqual([
      "2026-11-04T09:00:00.000Z",
      "2026-11-05T09:00:00.000Z",
    ]);
    expect(urlParam("telemetryTime")).toBe(TimeRange.PAST_ONE_DAY);
    expect(rendered.result.current.pickerValue.range).toBe(
      TimeRange.PAST_ONE_DAY,
    );

    jest.setSystemTime(new Date("2026-11-05T09:10:00.000Z"));
    act(() => {
      rendered.result.current.refresh();
    });

    expect(shown(rendered)).toEqual([
      "2026-11-04T09:10:00.000Z",
      "2026-11-05T09:10:00.000Z",
    ]);
    expect(rendered.result.current.refreshNonce).toBe(1);
  });

  test("Refresh keeps what the monitor saw where it is, and still bumps what reads it", () => {
    const rendered: Rendered = renderTimeRange();
    const window: InBetween<Date> = rendered.result.current.window;

    jest.setSystemTime(new Date("2026-11-05T09:10:00.000Z"));
    act(() => {
      rendered.result.current.refresh();
    });

    expect(rendered.result.current.window).toBe(window);
    expect(rendered.result.current.refreshNonce).toBe(1);
    expect(rendered.result.current.isTimeChanged).toBe(false);
  });

  test("a custom range is kept with both its instants", () => {
    const rendered: Rendered = renderTimeRange();

    act(() => {
      rendered.result.current.selectPickerValue({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2026-11-05T05:00:00.000Z"),
          new Date("2026-11-05T05:30:00.000Z"),
        ),
      });
    });

    expect(shown(rendered)).toEqual([
      "2026-11-05T05:00:00.000Z",
      "2026-11-05T05:30:00.000Z",
    ]);
    expect(urlParam("telemetryTime")).toBe("custom");
    expect(urlParam("telemetryStart")).toBe("2026-11-05T05:00:00.000Z");
    expect(urlParam("telemetryEnd")).toBe("2026-11-05T05:30:00.000Z");
  });

  test("a custom range with no window changes nothing", () => {
    const rendered: Rendered = renderTimeRange();

    act(() => {
      rendered.result.current.selectPickerValue({ range: TimeRange.CUSTOM });
    });

    expect(rendered.result.current.isTimeChanged).toBe(false);
    expect(shown(rendered)).toEqual(EVALUATED_TEXT);
  });

  test("Reset goes back to what the monitor saw, and tidies the URL", () => {
    const rendered: Rendered = renderTimeRange();

    act(() => {
      rendered.result.current.selectPreset(EventTimePresetId.StartToEnd);
    });
    expect(urlParam("telemetryTime")).toBe("start-to-end");

    act(() => {
      rendered.result.current.reset();
    });

    expect(shown(rendered)).toEqual(EVALUATED_TEXT);
    expect(rendered.result.current.isTimeChanged).toBe(false);
    expect(window.location.search).toBe("?tab=overview");
  });
});

describe("a drag across the chart", () => {
  test("zooms in from what the monitor saw: a change, kept in the URL, that Reset zoom undoes", () => {
    const rendered: Rendered = renderTimeRange();

    zoomTo(rendered, SLICE);

    const time: InvestigationTimeRangeState = rendered.result.current;
    expect(shown(rendered)).toEqual(SLICE_TEXT);
    expect(time.isZoomed).toBe(true);
    expect(time.isZoomedFromDefault).toBe(true);
    expect(time.isTimeChanged).toBe(true);
    expect(time.zoom.isZoomed).toBe(true);
    // What Reset zoom goes back to: what the monitor saw.
    expect(time.zoom.rangeBeforeZoom).toEqual({
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(
        EVALUATED.startValue,
        EVALUATED.endValue,
      ),
    });
    expect(urlParam("telemetryTime")).toBe("custom");
    expect(urlParam("telemetryStart")).toBe("2026-11-05T05:40:00.000Z");

    act(() => {
      rendered.result.current.zoom.resetZoom();
    });

    expect(shown(rendered)).toEqual(EVALUATED_TEXT);
    expect(rendered.result.current.isZoomed).toBe(false);
    expect(rendered.result.current.isTimeChanged).toBe(false);
    expect(window.location.search).toBe("?tab=overview");
  });

  test("zooms into a range the reader picked, and Reset zoom goes back to that range", () => {
    const rendered: Rendered = renderTimeRange();

    act(() => {
      rendered.result.current.selectPreset(EventTimePresetId.HourBefore);
    });
    zoomTo(rendered, [
      new Date("2026-11-05T05:00:00.000Z"),
      new Date("2026-11-05T05:10:00.000Z"),
    ]);

    expect(rendered.result.current.isZoomed).toBe(true);
    expect(rendered.result.current.isZoomedFromDefault).toBe(false);

    act(() => {
      rendered.result.current.zoom.resetZoom();
    });

    expect(shown(rendered)).toEqual(HOUR_BEFORE_TEXT);
    expect(rendered.result.current.isTimeChanged).toBe(true);
    expect(urlParam("telemetryTime")).toBe("hour-before");
  });

  test("only the first zoom is remembered: two zooms, one reset, back on what the monitor saw", () => {
    const rendered: Rendered = renderTimeRange();

    zoomTo(rendered, SLICE);
    zoomTo(rendered, NESTED);

    expect(shown(rendered)).toEqual([
      "2026-11-05T05:40:30.000Z",
      "2026-11-05T05:41:00.000Z",
    ]);
    expect(rendered.result.current.isZoomedFromDefault).toBe(true);

    act(() => {
      rendered.result.current.zoom.resetZoom();
    });

    expect(shown(rendered)).toEqual(EVALUATED_TEXT);
  });

  test("two drags before the card renders again: the second zooms within the first, one reset undoes both", () => {
    const rendered: Rendered = renderTimeRange();

    act(() => {
      rendered.result.current.zoom.zoomToTimeRange(SLICE[0], SLICE[1]);
      rendered.result.current.zoom.zoomToTimeRange(NESTED[0], NESTED[1]);
    });

    expect(shown(rendered)).toEqual([
      "2026-11-05T05:40:30.000Z",
      "2026-11-05T05:41:00.000Z",
    ]);

    act(() => {
      rendered.result.current.zoom.resetZoom();
    });

    expect(shown(rendered)).toEqual(EVALUATED_TEXT);
  });

  test("a drag running past the end of the window stops at it", () => {
    const rendered: Rendered = renderTimeRange();

    zoomTo(rendered, [
      new Date("2026-11-05T05:42:00.000Z"),
      new Date("2026-11-05T06:30:00.000Z"),
    ]);

    expect(shown(rendered)).toEqual([
      "2026-11-05T05:42:00.000Z",
      "2026-11-05T05:44:00.000Z",
    ]);
  });

  test("a drag right to left zooms to the same slice", () => {
    const rendered: Rendered = renderTimeRange();

    zoomTo(rendered, [SLICE[1], SLICE[0]]);

    expect(shown(rendered)).toEqual(SLICE_TEXT);
  });

  test("a drag that never left its starting point is no zoom", () => {
    const rendered: Rendered = renderTimeRange();

    zoomTo(rendered, [SLICE[0], SLICE[0]]);

    expect(rendered.result.current.isZoomed).toBe(false);
    expect(shown(rendered)).toEqual(EVALUATED_TEXT);
    expect(window.location.search).toBe("?tab=overview");
  });

  test("picking another range ends the zoom: there is nothing to reset to", () => {
    const rendered: Rendered = renderTimeRange();

    zoomTo(rendered, SLICE);
    act(() => {
      rendered.result.current.selectPreset(EventTimePresetId.DayBefore);
    });

    expect(rendered.result.current.isZoomed).toBe(false);
    expect(rendered.result.current.zoom.rangeBeforeZoom).toBeNull();

    const window: InBetween<Date> = rendered.result.current.window;
    act(() => {
      rendered.result.current.zoom.resetZoom();
    });
    expect(rendered.result.current.window).toBe(window);
  });

  test("Reset after a zoom goes back to what the monitor saw too", () => {
    const rendered: Rendered = renderTimeRange();

    zoomTo(rendered, SLICE);
    act(() => {
      rendered.result.current.reset();
    });

    expect(shown(rendered)).toEqual(EVALUATED_TEXT);
    expect(rendered.result.current.isZoomed).toBe(false);
    expect(window.location.search).toBe("?tab=overview");
  });

  test("the handlers keep their identity across renders and picks (what reads them is memoized on them)", () => {
    const rendered: Rendered = renderTimeRange();
    const first: InvestigationTimeRangeState = rendered.result.current;

    zoomTo(rendered, SLICE);
    act(() => {
      rendered.result.current.selectPreset(EventTimePresetId.HourBefore);
    });
    rendered.rerender(props());

    const last: InvestigationTimeRangeState = rendered.result.current;
    expect(last.zoom.zoomToTimeRange).toBe(first.zoom.zoomToTimeRange);
    expect(last.zoom.resetZoom).toBe(first.zoom.resetZoom);
    expect(last.selectPreset).toBe(first.selectPreset);
    expect(last.selectPickerValue).toBe(first.selectPickerValue);
    expect(last.refresh).toBe(first.refresh);
    expect(last.reset).toBe(first.reset);
  });
});

describe("a page opened on a link", () => {
  test("opens on the range around the incident the link holds", () => {
    openPage("?tab=overview&telemetryTime=hour-before");

    const rendered: Rendered = renderTimeRange();

    expect(shown(rendered)).toEqual(HOUR_BEFORE_TEXT);
    expect(rendered.result.current.isTimeChanged).toBe(true);
    // Kept as it was: nothing to tidy.
    expect(urlParam("telemetryTime")).toBe("hour-before");
  });

  test("opens on a custom window, a zoom included, with nothing to reset the zoom to", () => {
    openPage(
      "?telemetryTime=custom&telemetryStart=2026-11-05T05:40:00.000Z&telemetryEnd=2026-11-05T05:42:00.000Z",
    );

    const rendered: Rendered = renderTimeRange();

    expect(shown(rendered)).toEqual(SLICE_TEXT);
    expect(rendered.result.current.isTimeChanged).toBe(true);
    // A range of its own now: Reset brings back what the monitor saw.
    expect(rendered.result.current.isZoomed).toBe(false);
  });

  test("a link to what the monitor saw is no change, and is tidied away", () => {
    openPage("?tab=overview&telemetryTime=evaluated");

    const rendered: Rendered = renderTimeRange();

    expect(rendered.result.current.isTimeChanged).toBe(false);
    expect(window.location.search).toBe("?tab=overview");
  });

  test.each([
    ["a range this page does not offer", "?telemetryTime=next-week"],
    [
      "a custom window with an end missing",
      "?telemetryTime=custom&telemetryStart=2026-11-05T05:40:00.000Z",
    ],
    [
      "a custom window that ends before it starts",
      "?telemetryTime=custom&telemetryStart=2026-11-05T05:42:00.000Z&telemetryEnd=2026-11-05T05:40:00.000Z",
    ],
  ])(
    "%s opens on what the monitor saw, and is tidied away",
    (_name: string, search: string) => {
      openPage(`${search}&tab=logs`);

      const rendered: Rendered = renderTimeRange();

      expect(shown(rendered)).toEqual(EVALUATED_TEXT);
      expect(window.location.search).toBe("?tab=logs");
    },
  );

  test("another card's range is not this card's", () => {
    openPage("?metricsTime=hour-before");

    const rendered: Rendered = renderTimeRange();

    expect(shown(rendered)).toEqual(EVALUATED_TEXT);
    expect(urlParam("metricsTime")).toBe("hour-before");
  });

  test("without a URL prefix the URL is neither read nor written, and there is no link", () => {
    openPage("?telemetryTime=hour-before");

    const rendered: Rendered = renderTimeRange({ urlParamPrefix: undefined });

    expect(shown(rendered)).toEqual(EVALUATED_TEXT);

    act(() => {
      rendered.result.current.selectPreset(EventTimePresetId.DayBefore);
    });

    expect(urlParam("telemetryTime")).toBe("hour-before");
    expect(rendered.result.current.urlParams).toBeNull();
    expect(rendered.result.current.shareUrl).toBeNull();
  });
});

describe("the page's defaults", () => {
  test("an equal copy of them changes nothing: the window keeps its identity", () => {
    const rendered: Rendered = renderTimeRange();
    const window: InBetween<Date> = rendered.result.current.window;
    const selection: unknown = rendered.result.current.selection;

    rendered.rerender(
      props({
        startedAt: new Date(STARTED_AT.getTime()),
        evaluationWindow: new InBetween<Date>(
          new Date(EVALUATED.startValue.getTime()),
          new Date(EVALUATED.endValue.getTime()),
        ),
      }),
    );

    expect(rendered.result.current.window).toBe(window);
    expect(rendered.result.current.selection).toBe(selection);
  });

  test("an untouched card follows a new window the monitor saw", () => {
    const rendered: Rendered = renderTimeRange();

    rendered.rerender(
      props({
        evaluationWindow: new InBetween<Date>(
          new Date("2026-11-05T05:34:00.000Z"),
          new Date("2026-11-05T05:44:00.000Z"),
        ),
      }),
    );

    expect(shown(rendered)).toEqual([
      "2026-11-05T05:34:00.000Z",
      "2026-11-05T05:44:00.000Z",
    ]);
    expect(rendered.result.current.isTimeChanged).toBe(false);
  });

  test("a range the reader picked around the incident follows the incident's start", () => {
    const rendered: Rendered = renderTimeRange();

    act(() => {
      rendered.result.current.selectPreset(EventTimePresetId.HourBefore);
    });
    rendered.rerender(
      props({ startedAt: new Date("2026-11-05T06:00:00.000Z") }),
    );

    expect(shown(rendered)).toEqual([
      "2026-11-05T05:00:00.000Z",
      "2026-11-05T06:00:00.000Z",
    ]);
  });

  test("a zoom is the reader's: a new window the monitor saw leaves it where it is", () => {
    const rendered: Rendered = renderTimeRange();

    zoomTo(rendered, SLICE);
    rendered.rerender(
      props({
        evaluationWindow: new InBetween<Date>(
          new Date("2026-11-05T05:34:00.000Z"),
          new Date("2026-11-05T05:44:00.000Z"),
        ),
      }),
    );

    expect(shown(rendered)).toEqual(SLICE_TEXT);
    expect(rendered.result.current.isZoomed).toBe(true);

    // And its way back goes to what the monitor saw now.
    act(() => {
      rendered.result.current.zoom.resetZoom();
    });
    expect(shown(rendered)).toEqual([
      "2026-11-05T05:34:00.000Z",
      "2026-11-05T05:44:00.000Z",
    ]);
  });

  test("a range the page stops offering falls back to the default", () => {
    const rendered: Rendered = renderTimeRange();

    act(() => {
      rendered.result.current.selectPreset(EventTimePresetId.Evaluated);
      rendered.result.current.selectPreset(EventTimePresetId.HourBefore);
    });
    expect(shown(rendered)).toEqual(HOUR_BEFORE_TEXT);

    // No start any more: the evaluated window's end stands in for it.
    rendered.rerender(props({ startedAt: undefined, evaluationWindow: null }));

    expect(rendered.result.current.presets).toEqual([]);
    expect(rendered.result.current.selection).toEqual({
      kind: MetricInvestigationTimeKind.Relative,
      range: TimeRange.PAST_ONE_HOUR,
    });
  });
});
