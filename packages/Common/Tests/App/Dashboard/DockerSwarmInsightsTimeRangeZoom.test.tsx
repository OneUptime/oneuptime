/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";

/*
 * Issue #4105 on the Docker Swarm cluster's Insights page. Its four cards
 * (Compute, Memory, Top Tasks, Processes - six charts between them) share
 * the page's one time range, so they share one zoom:
 *
 *   - a drag on any chart narrows EVERY card to the window dragged out;
 *   - a double-click on any chart - in the same card or another one - or
 *     Reset zoom beside any card's picker puts back the range from before
 *     the first zoom, however many zooms deep the page is;
 *   - picking a range in any card's picker ends the zoom for all of them.
 *
 * The page is rendered for real down to the charts: the real
 * EmbeddedMetricCards, MetricView, MetricCharts and ChartGroup, over a
 * fake metrics API. Only the leaf chart wrappers are stood in for (see
 * ChartZoomStandIn), and the incident/alert markers hook is recorded
 * rather than fetched.
 */

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return (
    jest.requireActual(
      "./ChartZoomStandIn",
    ) as typeof import("./ChartZoomStandIn")
  ).chartModuleStandIn(
    "line",
    jest.requireActual("../../../UI/Components/Charts/Line/LineChart"),
  );
});
jest.mock("../../../UI/Components/Charts/Area/AreaChart", () => {
  return (
    jest.requireActual(
      "./ChartZoomStandIn",
    ) as typeof import("./ChartZoomStandIn")
  ).chartModuleStandIn(
    "area",
    jest.requireActual("../../../UI/Components/Charts/Area/AreaChart"),
  );
});
jest.mock("../../../UI/Components/Charts/Bar/BarChart", () => {
  return (
    jest.requireActual(
      "./ChartZoomStandIn",
    ) as typeof import("./ChartZoomStandIn")
  ).chartModuleStandIn(
    "bar",
    jest.requireActual("../../../UI/Components/Charts/Bar/BarChart"),
  );
});

interface MockEventWindowOptions {
  window: { startValue: Date; endValue: Date };
  queryConfigs?:
    | Array<{ metricAliasData?: { metricVariable?: string } }>
    | undefined;
}

// The window each card last asked its incident/alert markers for.
const mockMarkerWindows: Map<string, string> = new Map();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: (options: MockEventWindowOptions) => {
        const card: string =
          options.queryConfigs?.[0]?.metricAliasData?.metricVariable || "";
        mockMarkerWindows.set(
          card,
          `${options.window.startValue.toISOString()}/${options.window.endValue.toISOString()}`,
        );
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

import DockerSwarmClusterInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/View/Insights";
import MetricUtil from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Route from "../../../Types/API/Route";
import OneUptimeDate from "../../../Types/Date";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  CHART_STAND_IN_TEST_ID,
  canDrag,
  doubleClickChart,
  dragAcrossChart,
  resetChartStandIns,
  windowOfChart,
  windowText,
  zoomOfChart,
} from "./ChartZoomStandIn";

const NOW: Date = new Date("2026-09-24T12:00:00.000Z");
const HOUR_START: Date = new Date("2026-09-24T11:00:00.000Z");
const ZOOM_START: Date = new Date("2026-09-24T11:20:00.000Z");
const ZOOM_END: Date = new Date("2026-09-24T11:30:00.000Z");

// Each card by the variable of its first query, and the charts in it.
const CARDS: Record<string, Array<string>> = {
  cluster_cpu_utilization: [
    "Cluster CPU Utilization",
    "Cluster Memory Utilization",
  ],
  cluster_memory_usage: ["Task Memory Usage"],
  top_tasks_cpu: ["Top Tasks by CPU", "Top Tasks by Memory"],
  task_pids: ["Task Process Count"],
};

const CHART_TITLES: Array<string> = Object.values(CARDS).flat();

const pageProps: PageComponentProps = {
  pageRoute: new Route("/insights"),
  currentProject: null,
  hasPaymentMethod: false,
};

interface ResultsRequest {
  variables: Array<string>;
  window: string;
}

let resultsRequests: Array<ResultsRequest>;

function serveMetrics(): void {
  jest.spyOn(ModelAPI, "getItem").mockImplementation((): Promise<never> => {
    const cluster: DockerSwarmCluster = new DockerSwarmCluster();
    cluster.name = "prod";
    return Promise.resolve(cluster as never);
  });
  jest
    .spyOn(MetricUtil, "loadAllMetricsTypes")
    .mockImplementation((): Promise<never> => {
      return Promise.resolve({
        metricTypes: [],
        telemetryServices: [],
      } as never);
    });
  jest
    .spyOn(MetricUtil, "fetchExemplars")
    .mockImplementation((): Promise<never> => {
      return Promise.resolve([] as never);
    });
  jest
    .spyOn(MetricUtil, "fetchResults")
    .mockImplementation((...args: Array<unknown>): Promise<never> => {
      const data: MetricViewData = (
        args[0] as { metricViewData: MetricViewData }
      ).metricViewData;
      const start: Date = data.startAndEndDate!.startValue;
      const end: Date = data.startAndEndDate!.endValue;

      resultsRequests.push({
        variables: data.queryConfigs.map(
          (config: MetricViewData["queryConfigs"][number]): string => {
            return config.metricAliasData?.metricVariable || "";
          },
        ),
        window: windowText(start, end),
      });

      // Two points inside the window asked for, one series per query.
      return Promise.resolve(
        data.queryConfigs.map(() => {
          return {
            data: [
              { timestamp: new Date(start.getTime() + 60_000), value: 10 },
              { timestamp: new Date(start.getTime() + 120_000), value: 20 },
            ],
          };
        }) as never,
      );
    });
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 30; i++) {
      await Promise.resolve();
    }
  });
}

async function renderPage(): Promise<void> {
  render(<DockerSwarmClusterInsights {...pageProps} />);
  await flush();
  await flush();
}

// A chart, by the title ChartGroup gives it.
function chart(title: string): HTMLElement {
  const heading: HTMLElement = screen.getByRole("heading", { name: title });
  const panel: HTMLElement = heading.closest("div.px-5") as HTMLElement;

  return within(panel).getByTestId(CHART_STAND_IN_TEST_ID);
}

// The card a chart sits in: the one with the card-level Refresh button.
function cardOf(title: string): HTMLElement {
  let element: HTMLElement | null = chart(title);

  while (
    element &&
    !within(element).queryByRole("button", { name: "Refresh" })
  ) {
    element = element.parentElement;
  }

  if (!element) {
    throw new Error(`No card around the ${title} chart.`);
  }

  return element;
}

// The hint ChartGroup prints beside a chart's title.
function hintOf(title: string): string {
  const heading: HTMLElement = screen.getByRole("heading", { name: title });

  return (heading.parentElement?.textContent || "").replace(title, "").trim();
}

function customLabel(start: Date, end: Date): string {
  return `${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
    start,
    false,
    true,
  )} - ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
    end,
    false,
    true,
  )}`;
}

// Every card's latest fetch window since the given request count.
function windowsAskedSince(count: number): Record<string, string> {
  const windows: Record<string, string> = {};

  for (const request of resultsRequests.slice(count)) {
    windows[request.variables[0]!] = request.window;
  }

  return windows;
}

function everyCard(window: string): Record<string, string> {
  const windows: Record<string, string> = {};

  for (const card of Object.keys(CARDS)) {
    windows[card] = window;
  }

  return windows;
}

function resetButtons(): Array<HTMLElement> {
  return screen.queryAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

async function dragAcross(
  title: string,
  start: Date,
  end: Date,
): Promise<void> {
  dragAcrossChart(chart(title), start, end);
  await flush();
}

async function doubleClick(title: string): Promise<void> {
  doubleClickChart(chart(title));
  await flush();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  resultsRequests = [];
  mockMarkerWindows.clear();
  resetChartStandIns();

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID("5a1b2c3d-4e5f-4061-8273-94a5b6c7d8e9"));
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID("7d3f1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b"));
  serveMetrics();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("Docker Swarm Insights drag-to-zoom", () => {
  test("all six charts can start a zoom, and none holds its clicks for a reset yet", async () => {
    await renderPage();

    expect(screen.getAllByTestId(CHART_STAND_IN_TEST_ID)).toHaveLength(6);

    for (const title of CHART_TITLES) {
      expect(canDrag(chart(title))).toBe(true);
      expect(zoomOfChart(chart(title)).onTimeRangeReset).toBeUndefined();
      expect(windowOfChart(chart(title))).toBe(windowText(HOUR_START, NOW));
      expect(hintOf(title)).toBe("Drag to zoom");
    }

    expect(windowsAskedSince(0)).toEqual(
      everyCard(windowText(HOUR_START, NOW)),
    );
    expect(screen.getAllByText("Past 1 Hour")).toHaveLength(4);
    expect(resetButtons()).toHaveLength(0);
  });

  test("a drag on a chart in one card narrows every card on the page", async () => {
    await renderPage();
    const asked: number = resultsRequests.length;

    await dragAcross("Cluster CPU Utilization", ZOOM_START, ZOOM_END);

    // Every card fetched again, for the window dragged out on the first.
    expect(windowsAskedSince(asked)).toEqual(
      everyCard(windowText(ZOOM_START, ZOOM_END)),
    );

    for (const title of CHART_TITLES) {
      expect(windowOfChart(chart(title))).toBe(
        windowText(ZOOM_START, ZOOM_END),
      );
    }

    // Each card's incident and alert markers follow the zoom too.
    for (const card of Object.keys(CARDS)) {
      expect(mockMarkerWindows.get(card)).toBe(
        windowText(ZOOM_START, ZOOM_END),
      );
    }

    // Every card's picker shows the zoomed window, with the way back beside it.
    expect(screen.getAllByText(customLabel(ZOOM_START, ZOOM_END))).toHaveLength(
      4,
    );
    expect(screen.queryAllByText("Past 1 Hour")).toHaveLength(0);
    expect(resetButtons()).toHaveLength(4);
    for (const card of Object.keys(CARDS)) {
      expect(
        within(cardOf(CARDS[card]![0]!)).getByTestId(
          RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
        ),
      ).toBeVisible();
    }
  });

  test("once zoomed, every chart offers the double-click and its hint says so", async () => {
    await renderPage();

    await dragAcross("Task Memory Usage", ZOOM_START, ZOOM_END);

    for (const title of CHART_TITLES) {
      expect(zoomOfChart(chart(title)).onTimeRangeReset).toBeInstanceOf(
        Function,
      );
      expect(hintOf(title)).toBe("Drag to zoom · double-click to reset");
    }
  });

  test("a double-click on a chart in ANOTHER card puts the original range back everywhere", async () => {
    await renderPage();

    await dragAcross("Cluster CPU Utilization", ZOOM_START, ZOOM_END);
    const asked: number = resultsRequests.length;

    await doubleClick("Task Process Count");

    expect(windowsAskedSince(asked)).toEqual(
      everyCard(windowText(HOUR_START, NOW)),
    );
    for (const title of CHART_TITLES) {
      expect(windowOfChart(chart(title))).toBe(windowText(HOUR_START, NOW));
      expect(zoomOfChart(chart(title)).onTimeRangeReset).toBeUndefined();
    }
    expect(screen.getAllByText("Past 1 Hour")).toHaveLength(4);
    expect(resetButtons()).toHaveLength(0);
  });

  test("the reset is relative again: it resolves the past hour against the clock as it is now", async () => {
    await renderPage();

    await dragAcross("Top Tasks by CPU", ZOOM_START, ZOOM_END);

    // Time passes while the reader looks at the zoomed window.
    jest.setSystemTime(new Date(NOW.getTime() + 5 * 60_000));
    const asked: number = resultsRequests.length;

    await doubleClick("Top Tasks by Memory");

    expect(windowsAskedSince(asked)).toEqual(
      everyCard(
        windowText(
          new Date(HOUR_START.getTime() + 5 * 60_000),
          new Date(NOW.getTime() + 5 * 60_000),
        ),
      ),
    );
  });

  test("after zooming in twice, ONE double-click returns to the original range", async () => {
    await renderPage();

    await dragAcross(
      "Task Memory Usage",
      new Date("2026-09-24T11:10:00.000Z"),
      new Date("2026-09-24T11:50:00.000Z"),
    );
    await dragAcross("Top Tasks by CPU", ZOOM_START, ZOOM_END);

    expect(screen.getAllByText(customLabel(ZOOM_START, ZOOM_END))).toHaveLength(
      4,
    );

    await doubleClick("Cluster Memory Utilization");

    expect(screen.getAllByText("Past 1 Hour")).toHaveLength(4);
    expect(resetButtons()).toHaveLength(0);
  });

  test("Reset zoom in any card's header resets the whole page", async () => {
    await renderPage();

    await dragAcross("Cluster CPU Utilization", ZOOM_START, ZOOM_END);
    const asked: number = resultsRequests.length;

    fireEvent.click(
      within(cardOf("Top Tasks by CPU")).getByTestId(
        RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
      ),
    );
    await flush();

    expect(windowsAskedSince(asked)).toEqual(
      everyCard(windowText(HOUR_START, NOW)),
    );
    expect(screen.getAllByText("Past 1 Hour")).toHaveLength(4);
    expect(resetButtons()).toHaveLength(0);
  });

  test("picking a range in any card's picker ends the zoom for every card", async () => {
    await renderPage();

    await dragAcross("Cluster CPU Utilization", ZOOM_START, ZOOM_END);

    fireEvent.click(
      within(cardOf("Task Process Count")).getByText(
        customLabel(ZOOM_START, ZOOM_END),
      ),
    );
    const asked: number = resultsRequests.length;
    fireEvent.click(screen.getByRole("radio", { name: "Past 1 Day" }));
    await flush();

    expect(windowsAskedSince(asked)).toEqual(
      everyCard(windowText(new Date("2026-09-23T12:00:00.000Z"), NOW)),
    );
    expect(screen.getAllByText("Past 1 Day")).toHaveLength(4);
    expect(resetButtons()).toHaveLength(0);
    for (const title of CHART_TITLES) {
      expect(zoomOfChart(chart(title)).onTimeRangeReset).toBeUndefined();
    }
  });

  test("Refresh in a zoomed card re-reads the zoomed window and keeps the zoom", async () => {
    await renderPage();

    await dragAcross("Cluster CPU Utilization", ZOOM_START, ZOOM_END);
    const asked: number = resultsRequests.length;

    fireEvent.click(
      within(cardOf("Task Memory Usage")).getByRole("button", {
        name: "Refresh",
      }),
    );
    await flush();

    expect(windowsAskedSince(asked)).toEqual({
      cluster_memory_usage: windowText(ZOOM_START, ZOOM_END),
    });
    expect(resetButtons()).toHaveLength(4);

    // The zoom survived the refresh: a double-click still goes back.
    await doubleClick("Cluster CPU Utilization");
    expect(screen.getAllByText("Past 1 Hour")).toHaveLength(4);
  });

  test("a stray double-click before any zoom does not retime anything", async () => {
    await renderPage();
    const asked: number = resultsRequests.length;

    await doubleClick("Cluster CPU Utilization");

    expect(resultsRequests).toHaveLength(asked);
    expect(screen.getAllByText("Past 1 Hour")).toHaveLength(4);
  });
});
