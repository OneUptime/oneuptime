import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The bucket inspector ("Investigate this moment") and a double-click on a
 * chart that has no zoom to reset (issue #4105, found driving Kubernetes
 * Insights in a real browser).
 *
 * With no reset on offer, a chart acts on a click at once, so the first
 * click of a double-click opens the inspector at the pointer. Clamped into
 * the viewport, the inspector covers the pointer, and the rest of the
 * double-click landed on it: its second press selected the word under the
 * pointer ("Pod" of "Pod CPU Utilization"), and its click pressed whatever
 * button was there - "Investigate this moment" opened the drawer. The
 * inspector now ignores the rest of the click sequence that opened it, and
 * its chrome is not selectable at all. Its values still are.
 *
 * On a ZOOMED chart the same thing happens to a slow double-click (issue
 * #4116). A chart that offers a reset holds a click back for
 * DOUBLE_CLICK_DISAMBIGUATION_MS, waiting for a second one; a double-click
 * slower than that - still well inside the platforms' own double-click
 * time - let its first click through as a bucket click, which opened the
 * inspector under the pointer, and its second press landed on the
 * inspector, which swallowed it: the zoom stayed. That press is still the
 * way back out of the zoom. It closes the inspector and resets the zoom,
 * once - with the reset the charts themselves end up with, the host's or
 * else the page's - and it is still no word selection and no button press.
 * Nothing else on the inspector resets: not a double-click of its own, nor
 * a triple-click's third press, nor its buttons, nor a press of another
 * button than the main one that the browser counts 2 - a right-button one
 * opens a context menu, as on the charts (commit b6ec899df4; before it, a
 * right-button press counted 2 closed the inspector and reset the zoom).
 *
 * Real MetricCharts on real recharts (ResponsiveContainer given a size):
 * the plot click resolves a bucket exactly as it does in the page.
 */

jest.mock("recharts", () => {
  const actual: Record<string, any> = jest.requireActual("recharts") as Record<
    string,
    any
  >;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return React.cloneElement(children, {
        width: 600,
        height: 300,
      } as Record<string, unknown>);
    },
  };
});

const fetchExemplarsMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [] });
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchExemplars: (...args: Array<any>) => {
          fetchExemplarsMock(...args);
          // Never settles: no exemplar dots, no late setState.
          return new Promise(() => {
            // Intentionally never settles.
          });
        },
        setQueryTopNOverride: () => {
          return undefined;
        },
        getQueryConfigTopNKey: (
          _queryConfig: unknown,
          index: number,
          scope?: string,
        ) => {
          return `${scope || ""}:${index}`;
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
        serializeAttributeFiltersForKey: (attributes: unknown) => {
          return JSON.stringify(attributes || {});
        },
      },
      DEFAULT_TOP_N_SERIES: 10,
      SHOW_ALL_SERIES_TOP_N: 10_000,
      sanitizeAttributeFilters: (attributes: unknown) => {
        return attributes;
      },
    };
  },
);

// What the drawer shows is not the point here, only whether it opened.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/InvestigationDrawer",
  () => {
    return {
      __esModule: true,
      default: (props: { title: string }) => {
        return <div data-testid="investigation-drawer-stub">{props.title}</div>;
      },
    };
  },
);

import MetricCharts from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { DOUBLE_CLICK_DISAMBIGUATION_MS } from "../../../UI/Components/Charts/ChartLibrary/Utils/DoubleClick";
import {
  TimeRangeZoomProvider,
  TimeRangeZoomScope,
} from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "77777777-1111-4111-8111-777777777777",
);

const WINDOW_START: Date = new Date("2026-08-20T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-08-20T10:30:00.000Z");
const MINUTE_MS: number = 60 * 1000;

function buildViewData(): MetricViewData {
  return {
    queryConfigs: [
      {
        metricAliasData: {
          metricVariable: "a",
          title: "Pod CPU Utilization",
          description: "",
          legend: "",
          legendUnit: "",
        },
        metricQueryData: {
          filterData: {
            metricName: "k8s.pod.cpu.utilization",
            attributes: {},
            aggegationType: MetricsAggregationType.Avg,
          },
          groupByAttributeKeys: ["k8s.pod.name"],
        },
      } as unknown as MetricQueryConfigData,
    ],
    formulaConfigs: [],
    startAndEndDate: new InBetween<Date>(WINDOW_START, WINDOW_END),
  } as MetricViewData;
}

// Two pods, one point a minute across the whole window.
function buildResults(): Array<AggregatedResult> {
  const data: Array<Record<string, unknown>> = [];
  for (const pod of ["api-7d9f", "worker-5c2b"]) {
    for (let minute: number = 0; minute < 30; minute++) {
      data.push({
        timestamp: new Date(WINDOW_START.getTime() + minute * MINUTE_MS),
        value: pod === "api-7d9f" ? 40 + minute : 10 + minute,
        attributes: { "k8s.pod.name": pod },
      });
    }
  }
  return [{ data, truncated: false } as unknown as AggregatedResult];
}

// What the charts' host hands them, and the page around them.
interface ChartsHost {
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  // The zoom the enclosing page offers (see TimeRangeZoomScope), if any.
  pageZoom?: TimeRangeZoom | undefined;
}

function renderChartsIn(host: ChartsHost): HTMLElement {
  const charts: React.ReactElement = (
    <MetricCharts
      metricViewData={buildViewData()}
      metricResults={buildResults()}
      metricTypes={[]}
      onTimeRangeSelect={host.onTimeRangeSelect}
      onTimeRangeReset={host.onTimeRangeReset}
    />
  );
  const { container } = render(
    host.pageZoom ? (
      <TimeRangeZoomProvider zoom={host.pageZoom}>
        {charts}
      </TimeRangeZoomProvider>
    ) : (
      charts
    ),
  );
  return container;
}

function renderCharts(): HTMLElement {
  return renderChartsIn({
    /*
     * As MetricView hands them over while nothing is zoomed: a drag
     * zooms, and there is no reset, so a click is acted on at once.
     */
    onTimeRangeSelect: () => {
      return undefined;
    },
  });
}

// A page's zoom, as TimeRangeZoomScope offers it to the charts below.
function pageZoomOf(isZoomed: boolean, resetZoom: () => void): TimeRangeZoom {
  return {
    isZoomed: isZoomed,
    rangeBeforeZoom: isZoomed ? { range: TimeRange.PAST_ONE_HOUR } : null,
    zoomToTimeRange: () => {
      return undefined;
    },
    resetZoom: resetZoom,
  };
}

// The element recharts listens on; the plot's events all reach it.
function plotWrapper(container: HTMLElement): Element {
  const wrapper: Element | null = container.querySelector(".recharts-wrapper");
  if (!wrapper) {
    throw new Error("the chart did not render its plot");
  }
  return wrapper;
}

/*
 * The pointer x of each bucket recharts labelled: where it drew the tick,
 * in the whole pixels a mouse event reports in jsdom. getBoundingClientRect
 * is all zeroes in jsdom, so recharts reads the bucket under the pointer
 * straight off clientX.
 */
function tickXs(container: HTMLElement): Array<number> {
  const xs: Array<number> = Array.from(
    container.querySelectorAll(
      ".recharts-xAxis-tick-labels text.recharts-cartesian-axis-tick-value",
    ),
  ).map((tick: Element): number => {
    return Math.round(Number(tick.getAttribute("x")));
  });
  if (xs.length < 4) {
    throw new Error("the chart did not render its plot");
  }
  return xs;
}

interface PlotSpot {
  clientX: number;
  clientY: number;
}

// Where the clicks below land: over the plot's second labelled bucket.
function plotSpot(container: HTMLElement): PlotSpot {
  return { clientX: tickXs(container)[1]!, clientY: 60 };
}

// A lone click on the plot, as the browser delivers it.
function clickPlotOnce(container: HTMLElement): PlotSpot {
  const wrapper: Element = plotWrapper(container);
  const at: PlotSpot = plotSpot(container);

  fireEvent.mouseMove(wrapper, at);
  fireEvent.mouseDown(wrapper, { ...at, button: 0, detail: 1 });
  fireEvent.mouseUp(wrapper, { ...at, button: 0, detail: 1 });
  fireEvent.click(wrapper, { ...at, button: 0, detail: 1 });

  return at;
}

/*
 * The first click of a double-click on the plot: it opens the inspector,
 * as a lone click does.
 */
function clickPlot(container: HTMLElement): HTMLElement {
  clickPlotOnce(container);

  return screen.getByRole("dialog", { name: /^Values at/ });
}

/*
 * The first click of a SLOW double-click on a zoomed chart. The chart holds
 * it back, waiting for a second one, and acts on it as a bucket click once
 * DOUBLE_CLICK_DISAMBIGUATION_MS pass: the inspector opens at the pointer,
 * before the second press comes down there.
 */
function clickPlotSlowly(container: HTMLElement): HTMLElement {
  clickPlotOnce(container);
  act(() => {
    jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS);
  });

  return screen.getByRole("dialog", { name: /^Values at/ });
}

/*
 * The release of a press whose inspector went away under it: it lands on
 * the plot the inspector covered. The browser follows it with no click
 * and no dblclick, as the node the press landed on is gone.
 */
function releaseOnPlot(container: HTMLElement, clickCount: number): void {
  fireEvent.mouseUp(plotWrapper(container), {
    ...plotSpot(container),
    button: 0,
    detail: clickCount,
  });
}

// Long enough for anything a chart holds back or arms to have run.
function letTimePass(): void {
  act(() => {
    jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS * 4);
  });
}

function queryInspector(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: /^Values at/ });
}

function drawerOpened(): boolean {
  return screen.queryByTestId("investigation-drawer-stub") !== null;
}

interface InspectorParts {
  title: HTMLElement;
  window: HTMLElement;
  rowNumber: HTMLElement;
  seriesName: HTMLElement;
  value: HTMLElement;
  close: HTMLElement;
  investigate: HTMLElement;
}

function partsOf(inspector: HTMLElement): InspectorParts {
  const paragraphs: Array<HTMLElement> = Array.from(
    inspector.querySelectorAll("p"),
  );
  const rowNumber: HTMLElement | undefined = Array.from(
    inspector.querySelectorAll("span"),
  ).find((span: HTMLElement): boolean => {
    return span.textContent === "1.";
  });
  const seriesName: HTMLElement | undefined = rowNumber?.parentElement as
    | HTMLElement
    | undefined;
  const value: HTMLElement | undefined = seriesName?.nextElementSibling as
    | HTMLElement
    | undefined;
  const buttons: Array<HTMLElement> = Array.from(
    inspector.querySelectorAll("button"),
  );

  if (
    paragraphs.length < 2 ||
    !rowNumber ||
    !seriesName ||
    !value ||
    buttons.length !== 2
  ) {
    throw new Error("the inspector is not laid out as expected");
  }

  return {
    title: paragraphs[0]!,
    window: paragraphs[1]!,
    rowNumber: rowNumber,
    seriesName: seriesName,
    value: value,
    close: buttons[0]!,
    investigate: buttons[1]!,
  };
}

// Every part of the inspector the rest of a double-click can land on.
const INSPECTOR_PART_NAMES: Array<[string, keyof InspectorParts]> = [
  ["the title", "title"],
  ["the bucket's window", "window"],
  ["a row number", "rowNumber"],
  ["a series name", "seriesName"],
  ["a value", "value"],
  ["the Close button", "close"],
  ["the Investigate button", "investigate"],
];

// A press; false when something prevented its default (no selection).
function press(target: HTMLElement, clickCount: number): boolean {
  return fireEvent.mouseDown(target, { button: 0, detail: clickCount });
}

// A whole press-release-click at one spot, counted as `clickCount`.
function pressAndClick(target: HTMLElement, clickCount: number): void {
  press(target, clickCount);
  fireEvent.mouseUp(target, { button: 0, detail: clickCount });
  fireEvent.click(target, { button: 0, detail: clickCount });
}

beforeEach(() => {
  fetchExemplarsMock.mockReset();
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  jest.restoreAllMocks();
  cleanup();
});

describe("the bucket inspector a click on an unzoomed chart opens", () => {
  test("a lone click on the plot opens it, with the chart's title, the bucket's window and each series' value", () => {
    const container: HTMLElement = renderCharts();

    const inspector: HTMLElement = clickPlot(container);
    const parts: InspectorParts = partsOf(inspector);

    expect(parts.title).toHaveTextContent("Pod CPU Utilization");
    expect(parts.window.textContent).toMatch(/\S/);
    expect(parts.seriesName.textContent).toContain("api-7d9f");
    expect(parts.investigate).toHaveTextContent("Investigate this moment");
    expect(drawerOpened()).toBe(false);
  });

  test.each(INSPECTOR_PART_NAMES)(
    "the second press of the double-click that opened it selects no word of %s",
    (_label: string, part: string) => {
      const container: HTMLElement = renderCharts();
      const parts: InspectorParts = partsOf(clickPlot(container));

      const target: HTMLElement = parts[part as keyof InspectorParts];

      // Its default is a word selection: prevented.
      expect(press(target, 2)).toBe(false);
    },
  );

  test("the rest of that double-click presses no button: Investigate this moment opens no drawer", () => {
    const container: HTMLElement = renderCharts();
    const parts: InspectorParts = partsOf(clickPlot(container));

    pressAndClick(parts.investigate, 2);
    fireEvent.doubleClick(parts.investigate, { button: 0, detail: 2 });

    expect(drawerOpened()).toBe(false);
    // The inspector the first click opened is still there to use.
    expect(queryInspector()).toBe(parts.investigate.closest('[role="dialog"]'));
  });

  test("...and Close does not close the inspector the first click opened", () => {
    const container: HTMLElement = renderCharts();
    const parts: InspectorParts = partsOf(clickPlot(container));

    pressAndClick(parts.close, 2);

    expect(queryInspector()).not.toBeNull();
  });

  test("a triple-click's third press and click are ignored the same way", () => {
    const container: HTMLElement = renderCharts();
    const parts: InspectorParts = partsOf(clickPlot(container));

    pressAndClick(parts.investigate, 2);
    expect(press(parts.investigate, 3)).toBe(false);
    fireEvent.mouseUp(parts.investigate, { button: 0, detail: 3 });
    fireEvent.click(parts.investigate, { button: 0, detail: 3 });

    expect(drawerOpened()).toBe(false);
    expect(queryInspector()).not.toBeNull();
  });

  test("once pressed afresh it is an ordinary card: a double-click may select a value's word", () => {
    const container: HTMLElement = renderCharts();
    const parts: InspectorParts = partsOf(clickPlot(container));

    expect(press(parts.seriesName, 1)).toBe(true);
    expect(press(parts.seriesName, 2)).toBe(true);
  });

  test("once pressed afresh, a click presses its button: Investigate this moment opens the drawer", () => {
    const container: HTMLElement = renderCharts();
    const parts: InspectorParts = partsOf(clickPlot(container));

    pressAndClick(parts.investigate, 1);

    expect(drawerOpened()).toBe(true);
    expect(screen.getByTestId("investigation-drawer-stub")).toHaveTextContent(
      "Pod CPU Utilization",
    );
    expect(queryInspector()).toBeNull();
  });

  test("once pressed afresh, Close closes it", () => {
    const container: HTMLElement = renderCharts();
    const parts: InspectorParts = partsOf(clickPlot(container));

    pressAndClick(parts.close, 1);

    expect(queryInspector()).toBeNull();
  });

  test("a button pressed from the keyboard (a click counted 0) works with no press at all", () => {
    const container: HTMLElement = renderCharts();
    const parts: InspectorParts = partsOf(clickPlot(container));

    fireEvent.click(parts.investigate, { detail: 0 });

    expect(drawerOpened()).toBe(true);
  });

  test("each opening starts over: a press on the last inspector lets no later double-click through", () => {
    const container: HTMLElement = renderCharts();
    const first: InspectorParts = partsOf(clickPlot(container));

    // Used, then closed.
    expect(press(first.seriesName, 1)).toBe(true);
    pressAndClick(first.close, 1);
    expect(queryInspector()).toBeNull();

    // A later double-click opens a new one, whose rest is ignored again.
    const second: InspectorParts = partsOf(clickPlot(container));
    expect(press(second.title, 2)).toBe(false);
    pressAndClick(second.investigate, 2);
    expect(drawerOpened()).toBe(false);
  });

  test("its chrome is not selectable; the window, the series names and the values are", () => {
    const container: HTMLElement = renderCharts();
    const inspector: HTMLElement = clickPlot(container);
    const parts: InspectorParts = partsOf(inspector);

    expect(inspector).toHaveClass("select-none");
    for (const chrome of [
      parts.title,
      parts.close,
      parts.investigate,
    ] as Array<HTMLElement>) {
      expect(chrome).not.toHaveClass("select-text");
    }
    // The row number sits inside the selectable name, so it opts out.
    expect(parts.rowNumber).toHaveClass("select-none");

    for (const value of [
      parts.window,
      parts.seriesName,
      parts.value,
    ] as Array<HTMLElement>) {
      expect(value).toHaveClass("select-text");
    }
  });
});

// The charts, and the reset they offer while zoomed.
interface ZoomedCharts {
  container: HTMLElement;
  reset: MockFunction;
}

interface ZoomedHost {
  name: string;
  render: () => ZoomedCharts;
}

/*
 * The two ways charts end up offering a reset, resolved as the charts
 * resolve theirs (resolveChartTimeRangeZoom).
 */
const ZOOMED_HOSTS: Array<ZoomedHost> = [
  {
    name: "the host's reset (as MetricView hands one over while zoomed)",
    render: (): ZoomedCharts => {
      const reset: MockFunction = getJestMockFunction();
      const container: HTMLElement = renderChartsIn({
        onTimeRangeSelect: getJestMockFunction(),
        onTimeRangeReset: reset,
      });
      return { container: container, reset: reset };
    },
  },
  {
    name: "the page's reset (a zoomed page around charts handed no zoom of their own)",
    render: (): ZoomedCharts => {
      const reset: MockFunction = getJestMockFunction();
      const container: HTMLElement = renderChartsIn({
        pageZoom: pageZoomOf(true, reset),
      });
      return { container: container, reset: reset };
    },
  },
];

// The range the page below shows before any zoom: the charts' window.
const PAGE_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(WINDOW_START, WINDOW_END),
};

interface ZoomablePageProps {
  onTimeRangeChange: (timeRange: RangeStartAndEndDateTime) => void;
}

/*
 * A page with page-wide drag-to-zoom (TimeRangeZoomScope) around charts
 * handed no zoom of their own: a drag on a chart retimes the page.
 */
function ZoomablePage(props: ZoomablePageProps): React.ReactElement {
  const [timeRange, setTimeRange] =
    React.useState<RangeStartAndEndDateTime>(PAGE_RANGE);

  return (
    <TimeRangeZoomScope
      timeRange={timeRange}
      onTimeRangeChange={(next: RangeStartAndEndDateTime) => {
        props.onTimeRangeChange(next);
        setTimeRange(next);
      }}
    >
      <MetricCharts
        metricViewData={buildViewData()}
        metricResults={buildResults()}
        metricTypes={[]}
      />
    </TimeRangeZoomScope>
  );
}

// A drag across the plot, from its second labelled bucket to its fourth.
function dragAcrossPlot(container: HTMLElement): void {
  const wrapper: Element = plotWrapper(container);
  const xs: Array<number> = tickXs(container);
  const from: PlotSpot = { clientX: xs[1]!, clientY: 60 };
  const to: PlotSpot = { clientX: xs[3]!, clientY: 60 };

  fireEvent.mouseMove(wrapper, { ...from, buttons: 0 });
  fireEvent.mouseDown(wrapper, { ...from, button: 0, buttons: 1, detail: 1 });
  fireEvent.mouseMove(wrapper, { ...to, buttons: 1 });
  fireEvent.mouseUp(wrapper, { ...to, button: 0, buttons: 0, detail: 1 });
  fireEvent.click(wrapper, { ...to, button: 0, detail: 1 });
}

describe("the rest of a slow double-click on a zoomed chart, landing on the inspector its first click opened (issue #4116)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  for (const host of ZOOMED_HOSTS) {
    describe(`with ${host.name}`, () => {
      test("the chart holds the first click back, then opens the inspector under the pointer", () => {
        const charts: ZoomedCharts = host.render();

        const pointer: PlotSpot = clickPlotOnce(charts.container);

        // Waiting to see whether a second click comes.
        act(() => {
          jest.advanceTimersByTime(DOUBLE_CLICK_DISAMBIGUATION_MS - 1);
        });
        expect(queryInspector()).toBeNull();

        act(() => {
          jest.advanceTimersByTime(1);
        });
        const inspector: HTMLElement = screen.getByRole("dialog", {
          name: /^Values at/,
        });
        // Where the second press of a slow double-click comes down.
        expect(inspector.style.left).toBe(`${pointer.clientX}px`);
        expect(inspector.style.top).toBe(`${pointer.clientY}px`);
        expect(charts.reset).not.toHaveBeenCalled();
      });

      test.each(INSPECTOR_PART_NAMES)(
        "the second press, landing on %s, closes the inspector and resets the zoom, once",
        (_label: string, part: keyof InspectorParts) => {
          const charts: ZoomedCharts = host.render();
          const parts: InspectorParts = partsOf(
            clickPlotSlowly(charts.container),
          );

          // Still no word selection on the inspector.
          expect(press(parts[part], 2)).toBe(false);

          expect(queryInspector()).toBeNull();
          expect(charts.reset).toHaveBeenCalledTimes(1);

          // Its release, on the plot the inspector covered, adds nothing.
          releaseOnPlot(charts.container, 2);
          letTimePass();

          expect(charts.reset).toHaveBeenCalledTimes(1);
          expect(queryInspector()).toBeNull();
          expect(drawerOpened()).toBe(false);
        },
      );

      test("...and presses no button: Investigate this moment opens no drawer", () => {
        const charts: ZoomedCharts = host.render();
        const parts: InspectorParts = partsOf(
          clickPlotSlowly(charts.container),
        );

        /*
         * Even were the rest of that double-click - its release, click and
         * dblclick - delivered to the button the press landed on.
         */
        pressAndClick(parts.investigate, 2);
        fireEvent.doubleClick(parts.investigate, { button: 0, detail: 2 });
        letTimePass();

        expect(drawerOpened()).toBe(false);
        expect(queryInspector()).toBeNull();
        expect(charts.reset).toHaveBeenCalledTimes(1);
      });

      test("a double-click of its own, after a press of its own, resets nothing: it may select a word", () => {
        const charts: ZoomedCharts = host.render();
        const parts: InspectorParts = partsOf(
          clickPlotSlowly(charts.container),
        );

        // A click of its own: counted afresh...
        expect(press(parts.seriesName, 1)).toBe(true);
        fireEvent.mouseUp(parts.seriesName, { button: 0, detail: 1 });
        fireEvent.click(parts.seriesName, { button: 0, detail: 1 });
        // ...and the second press of a double-click inside the inspector.
        expect(press(parts.seriesName, 2)).toBe(true);
        fireEvent.mouseUp(parts.seriesName, { button: 0, detail: 2 });
        fireEvent.click(parts.seriesName, { button: 0, detail: 2 });
        fireEvent.doubleClick(parts.seriesName, { button: 0, detail: 2 });
        letTimePass();

        expect(charts.reset).not.toHaveBeenCalled();
        expect(queryInspector()).not.toBeNull();
      });

      test("a triple-click's third press on it resets nothing: only a double-click's second press does", () => {
        const charts: ZoomedCharts = host.render();
        const parts: InspectorParts = partsOf(
          clickPlotSlowly(charts.container),
        );

        // Still the rest of a click sequence: no word selected...
        expect(press(parts.investigate, 3)).toBe(false);
        fireEvent.mouseUp(parts.investigate, { button: 0, detail: 3 });
        fireEvent.click(parts.investigate, { button: 0, detail: 3 });
        letTimePass();

        // ...no button pressed, and no reset: the inspector stays.
        expect(drawerOpened()).toBe(false);
        expect(charts.reset).not.toHaveBeenCalled();
        expect(queryInspector()).not.toBeNull();
      });

      /*
       * The browser counts presses of any button, but only the main
       * button's second press is a double-click's, as on the charts
       * (isSecondPressOfDoubleClick): a right-button one opens a context
       * menu. Before commit b6ec899df4 it closed the inspector and reset
       * the zoom.
       */
      test.each(INSPECTOR_PART_NAMES)(
        "a right-button press counted 2, landing on %s, resets nothing and closes nothing, and still selects no word",
        (_label: string, part: keyof InspectorParts) => {
          const charts: ZoomedCharts = host.render();
          const parts: InspectorParts = partsOf(
            clickPlotSlowly(charts.container),
          );

          expect(
            fireEvent.mouseDown(parts[part], { button: 2, detail: 2 }),
          ).toBe(false);

          expect(queryInspector()).not.toBeNull();
          expect(charts.reset).not.toHaveBeenCalled();

          fireEvent.mouseUp(parts[part], { button: 2, detail: 2 });
          fireEvent.contextMenu(parts[part], { button: 2 });
          letTimePass();

          expect(charts.reset).not.toHaveBeenCalled();
          expect(queryInspector()).not.toBeNull();
          expect(drawerOpened()).toBe(false);
        },
      );

      test("a middle-button press counted 2 on it resets nothing and closes nothing either", () => {
        const charts: ZoomedCharts = host.render();
        const parts: InspectorParts = partsOf(
          clickPlotSlowly(charts.container),
        );

        expect(fireEvent.mouseDown(parts.title, { button: 1, detail: 2 })).toBe(
          false,
        );
        fireEvent.mouseUp(parts.title, { button: 1, detail: 2 });
        letTimePass();

        expect(charts.reset).not.toHaveBeenCalled();
        expect(queryInspector()).not.toBeNull();
      });

      test("once pressed afresh, its buttons work and reset nothing: Investigate this moment opens the drawer", () => {
        const charts: ZoomedCharts = host.render();
        const parts: InspectorParts = partsOf(
          clickPlotSlowly(charts.container),
        );

        pressAndClick(parts.investigate, 1);
        letTimePass();

        expect(drawerOpened()).toBe(true);
        expect(queryInspector()).toBeNull();
        expect(charts.reset).not.toHaveBeenCalled();
      });

      test("...and Close closes it, resetting nothing", () => {
        const charts: ZoomedCharts = host.render();
        const parts: InspectorParts = partsOf(
          clickPlotSlowly(charts.container),
        );

        pressAndClick(parts.close, 1);
        letTimePass();

        expect(queryInspector()).toBeNull();
        expect(drawerOpened()).toBe(false);
        expect(charts.reset).not.toHaveBeenCalled();
      });
    });
  }

  test("the host's reset wins over the page's, as it does for the charts", () => {
    const hostReset: MockFunction = getJestMockFunction();
    const pageReset: MockFunction = getJestMockFunction();
    const container: HTMLElement = renderChartsIn({
      onTimeRangeSelect: getJestMockFunction(),
      onTimeRangeReset: hostReset,
      pageZoom: pageZoomOf(true, pageReset),
    });
    const parts: InspectorParts = partsOf(clickPlotSlowly(container));

    expect(press(parts.title, 2)).toBe(false);

    expect(hostReset).toHaveBeenCalledTimes(1);
    expect(pageReset).not.toHaveBeenCalled();
    expect(queryInspector()).toBeNull();
  });

  test("a page zoomed by a drag on the chart itself is put back on the range it had", () => {
    const onTimeRangeChange: MockFunction = getJestMockFunction();
    const { container } = render(
      <ZoomablePage onTimeRangeChange={onTimeRangeChange} />,
    );

    // A drag across the plot zooms the page...
    dragAcrossPlot(container);
    expect(onTimeRangeChange).toHaveBeenCalledTimes(1);
    expect(
      (onTimeRangeChange.mock.calls[0]![0] as RangeStartAndEndDateTime).range,
    ).toBe(TimeRange.CUSTOM);
    expect(
      screen.getByText("Drag to zoom · double-click to reset"),
    ).toBeInTheDocument();
    // ...and the reader looks at it for a moment.
    letTimePass();

    // The slow double-click.
    const parts: InspectorParts = partsOf(clickPlotSlowly(container));
    expect(press(parts.title, 2)).toBe(false);
    releaseOnPlot(container, 2);
    letTimePass();

    expect(queryInspector()).toBeNull();
    expect(onTimeRangeChange).toHaveBeenCalledTimes(2);
    expect(onTimeRangeChange).toHaveBeenLastCalledWith(PAGE_RANGE);
    expect(screen.getByText("Drag to zoom")).toBeInTheDocument();

    // Nothing left to reset: a click is acted on at once again.
    clickPlotOnce(container);
    expect(queryInspector()).not.toBeNull();
  });
});

// The charts with no reset on offer, and every handler the press must leave be.
interface UnzoomedCharts {
  container: HTMLElement;
  handlers: Array<MockFunction>;
}

interface UnzoomedHost {
  name: string;
  render: () => UnzoomedCharts;
}

const UNZOOMED_HOSTS: Array<UnzoomedHost> = [
  {
    name: "a host with nothing to reset yet",
    render: (): UnzoomedCharts => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      const container: HTMLElement = renderChartsIn({
        onTimeRangeSelect: onTimeRangeSelect,
      });
      return { container: container, handlers: [onTimeRangeSelect] };
    },
  },
  {
    name: "a page that is not zoomed",
    render: (): UnzoomedCharts => {
      const resetZoom: MockFunction = getJestMockFunction();
      const container: HTMLElement = renderChartsIn({
        pageZoom: pageZoomOf(false, resetZoom),
      });
      return { container: container, handlers: [resetZoom] };
    },
  },
  {
    /*
     * A host that zooms its own way resets its own way: the charts do not
     * borrow the page's reset, and neither does the inspector.
     */
    name: "a host with nothing to reset, on a zoomed page",
    render: (): UnzoomedCharts => {
      const onTimeRangeSelect: MockFunction = getJestMockFunction();
      const resetZoom: MockFunction = getJestMockFunction();
      const container: HTMLElement = renderChartsIn({
        onTimeRangeSelect: onTimeRangeSelect,
        pageZoom: pageZoomOf(true, resetZoom),
      });
      return {
        container: container,
        handlers: [onTimeRangeSelect, resetZoom],
      };
    },
  },
];

describe("the rest of a double-click on a chart with no zoom to reset", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  for (const host of UNZOOMED_HOSTS) {
    test(`with ${host.name}, is still only swallowed: the inspector stays, nothing is reset`, () => {
      const charts: UnzoomedCharts = host.render();

      // Nothing to wait for: the first click opens the inspector at once.
      const parts: InspectorParts = partsOf(clickPlot(charts.container));

      expect(press(parts.title, 2)).toBe(false);
      fireEvent.mouseUp(parts.title, { button: 0, detail: 2 });
      fireEvent.click(parts.title, { button: 0, detail: 2 });
      letTimePass();

      expect(queryInspector()).not.toBeNull();
      for (const handler of charts.handlers) {
        expect(handler).not.toHaveBeenCalled();
      }
    });
  }
});
