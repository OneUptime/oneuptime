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
import React, { ReactElement } from "react";

/*
 * Issue #4105 on the Docker and Podman pages whose charts live in one
 * metric card that owns its own time range:
 *
 *   - the host's Metrics page (seven charts in one card);
 *   - a container's Metrics tab (CPU and Memory).
 *
 * The card is the page's only time-dependent content, so the card's zoom
 * IS the page's: a drag on any of its charts narrows all of them, and a
 * double-click on any of them - or Reset zoom beside the card's picker -
 * puts the range from before the first zoom back. On the container page
 * the Logs tab keeps its own range, as it always has; nothing here leaks a
 * zoom into it.
 *
 * Rendered for real down to the charts (EmbeddedMetricCard, MetricView,
 * MetricCharts and ChartGroup) over a fake metrics API; only the leaf
 * chart wrappers are stood in for (see ContainerChartZoomStandIn).
 */

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return (
    jest.requireActual(
      "./ContainerChartZoomStandIn",
    ) as typeof import("./ContainerChartZoomStandIn")
  ).chartModuleStandIn(
    "line",
    jest.requireActual("../../../UI/Components/Charts/Line/LineChart"),
  );
});
jest.mock("../../../UI/Components/Charts/Area/AreaChart", () => {
  return (
    jest.requireActual(
      "./ContainerChartZoomStandIn",
    ) as typeof import("./ContainerChartZoomStandIn")
  ).chartModuleStandIn(
    "area",
    jest.requireActual("../../../UI/Components/Charts/Area/AreaChart"),
  );
});
jest.mock("../../../UI/Components/Charts/Bar/BarChart", () => {
  return (
    jest.requireActual(
      "./ContainerChartZoomStandIn",
    ) as typeof import("./ContainerChartZoomStandIn")
  ).chartModuleStandIn(
    "bar",
    jest.requireActual("../../../UI/Components/Charts/Bar/BarChart"),
  );
});

// The window the card last asked its incident/alert markers for.
let mockMarkerWindow: string = "";

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: (options: { window: { startValue: Date; endValue: Date } }) => {
        mockMarkerWindow = `${options.window.startValue.toISOString()}/${options.window.endValue.toISOString()}`;
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

interface MockLogsViewerSeen {
  timeRangeOverride: unknown;
  // What a chart in the logs viewer (its histogram) would zoom.
  zoomOffered: unknown;
}

let mockLogsViewerSeen: MockLogsViewerSeen | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    const zoomContext: typeof import("../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext") =
      jest.requireActual(
        "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext",
      );

    return {
      __esModule: true,
      default: (props: { timeRangeOverride?: unknown }): ReactElement => {
        mockLogsViewerSeen = {
          timeRangeOverride: props.timeRangeOverride,
          zoomOffered: zoomContext.useChartTimeRangeZoom(),
        };
        return React.createElement("div", { "data-testid": "logs-viewer" });
      },
    };
  },
);

import DockerHostMetrics from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/Metrics";
import PodmanHostMetrics from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/Metrics";
import DockerHostContainerDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/ContainerDetail";
import PodmanHostContainerDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/ContainerDetail";
import MetricUtil from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import Route from "../../../Types/API/Route";
import OneUptimeDate from "../../../Types/Date";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
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
} from "./ContainerChartZoomStandIn";

const NOW: Date = new Date("2026-09-24T12:00:00.000Z");
const HOUR_START: Date = new Date("2026-09-24T11:00:00.000Z");
const ZOOM_START: Date = new Date("2026-09-24T11:20:00.000Z");
const ZOOM_END: Date = new Date("2026-09-24T11:30:00.000Z");
const HOST_ID: string = "5a1b2c3d-4e5f-4061-8273-94a5b6c7d8e9";

const HOST_METRICS_CHARTS: Array<string> = [
  "Hottest Container CPU Utilization",
  "Average Container CPU Utilization",
  "Hottest Container Memory Usage",
  "Total Container Memory Usage",
  "Network Receive (cumulative)",
  "Network Transmit (cumulative)",
  "Peak Container Process Count",
];

const CONTAINER_CHARTS: Array<string> = ["CPU Utilization", "Memory Usage"];

const pageProps: PageComponentProps = {
  pageRoute: new Route("/metrics"),
  currentProject: null,
  hasPaymentMethod: false,
};

interface ResultsRequest {
  variables: Array<string>;
  window: string;
}

let resultsRequests: Array<ResultsRequest>;

function fillHost<T extends DockerHost | PodmanHost>(host: T): T {
  host._id = HOST_ID;
  host.name = "web-01";
  host.hostIdentifier = "web-01";
  return host;
}

function serveMetrics(buildHost: () => DockerHost | PodmanHost): void {
  jest.spyOn(ModelAPI, "getItem").mockImplementation((): Promise<never> => {
    return Promise.resolve(buildHost() as never);
  });
  // The container page's database lookup: nothing runs a database here.
  jest.spyOn(ModelAPI, "getList").mockImplementation((): Promise<never> => {
    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 } as never);
  });
  // The container page's id/image lookup from recent metrics.
  jest
    .spyOn(AnalyticsModelAPI, "getList")
    .mockImplementation((): Promise<never> => {
      return Promise.resolve({
        data: [
          {
            attributes: {
              "resource.container.id": "3f2a9c1b7d4e8f60",
              "resource.container.image.name": "nginx:1.27",
            },
          },
        ],
        count: 1,
        skip: 0,
        limit: 1,
      } as never);
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

function chart(title: string): HTMLElement {
  const heading: HTMLElement = screen.getByRole("heading", { name: title });
  const panel: HTMLElement = heading.closest("div.px-5") as HTMLElement;

  return within(panel).getByTestId(CHART_STAND_IN_TEST_ID);
}

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

function windowsAskedSince(count: number): Array<string> {
  return resultsRequests.slice(count).map((request: ResultsRequest): string => {
    return request.window;
  });
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
  mockMarkerWindow = "";
  mockLogsViewerSeen = null;
  resetChartStandIns();

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(HOST_ID));
  jest.spyOn(Navigation, "getLastParamAsString").mockReturnValue("shop-web-1");
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID("7d3f1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b"));
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

interface RuntimeCase {
  Metrics: React.FunctionComponent<PageComponentProps>;
  ContainerDetail: React.FunctionComponent<PageComponentProps>;
  buildHost: () => DockerHost | PodmanHost;
}

const RUNTIME_CASES: Array<[string, RuntimeCase]> = [
  [
    "Docker",
    {
      Metrics: DockerHostMetrics,
      ContainerDetail: DockerHostContainerDetail,
      buildHost: (): DockerHost => {
        return fillHost(new DockerHost());
      },
    },
  ],
  [
    "Podman",
    {
      Metrics: PodmanHostMetrics,
      ContainerDetail: PodmanHostContainerDetail,
      buildHost: (): PodmanHost => {
        return fillHost(new PodmanHost());
      },
    },
  ],
];

describe.each(RUNTIME_CASES)(
  "%s host Metrics page drag-to-zoom",
  (_name: string, runtimeCase: RuntimeCase) => {
    async function renderPage(): Promise<void> {
      serveMetrics(runtimeCase.buildHost);
      render(<runtimeCase.Metrics {...pageProps} />);
      await flush();
      await flush();
    }

    test("all seven charts can start a zoom; none holds its clicks for a reset yet", async () => {
      await renderPage();

      expect(screen.getAllByTestId(CHART_STAND_IN_TEST_ID)).toHaveLength(7);
      for (const title of HOST_METRICS_CHARTS) {
        expect(canDrag(chart(title))).toBe(true);
        expect(zoomOfChart(chart(title)).onTimeRangeReset).toBeUndefined();
        expect(windowOfChart(chart(title))).toBe(windowText(HOUR_START, NOW));
        expect(hintOf(title)).toBe("Drag to zoom");
      }
      expect(screen.getByText("Past 1 Hour")).toBeInTheDocument();
      expect(resetButtons()).toHaveLength(0);
    });

    test("a drag on one chart narrows all seven, their markers and the picker", async () => {
      await renderPage();
      const asked: number = resultsRequests.length;

      await dragAcross("Network Receive (cumulative)", ZOOM_START, ZOOM_END);

      // One fetch for the whole card, for the window dragged out.
      expect(windowsAskedSince(asked)).toEqual([
        windowText(ZOOM_START, ZOOM_END),
      ]);
      expect(
        resultsRequests[resultsRequests.length - 1]!.variables,
      ).toHaveLength(7);
      for (const title of HOST_METRICS_CHARTS) {
        expect(windowOfChart(chart(title))).toBe(
          windowText(ZOOM_START, ZOOM_END),
        );
        expect(zoomOfChart(chart(title)).onTimeRangeReset).toBeInstanceOf(
          Function,
        );
        expect(hintOf(title)).toBe("Drag to zoom · double-click to reset");
      }
      expect(mockMarkerWindow).toBe(windowText(ZOOM_START, ZOOM_END));
      expect(
        screen.getByText(customLabel(ZOOM_START, ZOOM_END)),
      ).toBeInTheDocument();
      expect(resetButtons()).toHaveLength(1);
    });

    test("a double-click on a different chart puts the past hour back", async () => {
      await renderPage();

      await dragAcross(
        "Hottest Container CPU Utilization",
        ZOOM_START,
        ZOOM_END,
      );
      const asked: number = resultsRequests.length;

      await doubleClick("Peak Container Process Count");

      expect(windowsAskedSince(asked)).toEqual([windowText(HOUR_START, NOW)]);
      for (const title of HOST_METRICS_CHARTS) {
        expect(windowOfChart(chart(title))).toBe(windowText(HOUR_START, NOW));
        expect(zoomOfChart(chart(title)).onTimeRangeReset).toBeUndefined();
      }
      expect(mockMarkerWindow).toBe(windowText(HOUR_START, NOW));
      expect(screen.getByText("Past 1 Hour")).toBeInTheDocument();
      expect(resetButtons()).toHaveLength(0);
    });

    test("after zooming in twice, one double-click returns all the way", async () => {
      await renderPage();

      await dragAcross(
        "Average Container CPU Utilization",
        new Date("2026-09-24T11:10:00.000Z"),
        new Date("2026-09-24T11:50:00.000Z"),
      );
      await dragAcross("Total Container Memory Usage", ZOOM_START, ZOOM_END);
      expect(
        screen.getByText(customLabel(ZOOM_START, ZOOM_END)),
      ).toBeInTheDocument();

      await doubleClick("Hottest Container Memory Usage");

      expect(screen.getByText("Past 1 Hour")).toBeInTheDocument();
      expect(resetButtons()).toHaveLength(0);
    });

    test("Reset zoom beside the card's picker does what a double-click does", async () => {
      await renderPage();

      await dragAcross("Network Transmit (cumulative)", ZOOM_START, ZOOM_END);
      const asked: number = resultsRequests.length;

      fireEvent.click(resetButtons()[0]!);
      await flush();

      expect(windowsAskedSince(asked)).toEqual([windowText(HOUR_START, NOW)]);
      expect(screen.getByText("Past 1 Hour")).toBeInTheDocument();
      expect(resetButtons()).toHaveLength(0);
    });

    test("picking a range in the card's picker ends the zoom", async () => {
      await renderPage();

      await dragAcross("Network Transmit (cumulative)", ZOOM_START, ZOOM_END);

      fireEvent.click(screen.getByText(customLabel(ZOOM_START, ZOOM_END)));
      const asked: number = resultsRequests.length;
      fireEvent.click(screen.getByRole("radio", { name: "Past 1 Day" }));
      await flush();

      expect(windowsAskedSince(asked)).toEqual([
        windowText(new Date("2026-09-23T12:00:00.000Z"), NOW),
      ]);
      expect(resetButtons()).toHaveLength(0);
      for (const title of HOST_METRICS_CHARTS) {
        expect(zoomOfChart(chart(title)).onTimeRangeReset).toBeUndefined();
      }
    });
  },
);

describe.each(RUNTIME_CASES)(
  "%s container page drag-to-zoom",
  (_name: string, runtimeCase: RuntimeCase) => {
    async function renderMetricsTab(): Promise<void> {
      serveMetrics(runtimeCase.buildHost);
      render(<runtimeCase.ContainerDetail {...pageProps} />);
      await flush();
      fireEvent.click(screen.getByTestId("tab-Metrics"));
      await flush();
      await flush();
    }

    test("a drag on CPU narrows Memory too, and a double-click on Memory brings both back", async () => {
      await renderMetricsTab();

      expect(screen.getAllByTestId(CHART_STAND_IN_TEST_ID)).toHaveLength(2);
      for (const title of CONTAINER_CHARTS) {
        expect(canDrag(chart(title))).toBe(true);
        expect(zoomOfChart(chart(title)).onTimeRangeReset).toBeUndefined();
      }
      let asked: number = resultsRequests.length;

      await dragAcross("CPU Utilization", ZOOM_START, ZOOM_END);

      expect(windowsAskedSince(asked)).toEqual([
        windowText(ZOOM_START, ZOOM_END),
      ]);
      for (const title of CONTAINER_CHARTS) {
        expect(windowOfChart(chart(title))).toBe(
          windowText(ZOOM_START, ZOOM_END),
        );
      }
      expect(mockMarkerWindow).toBe(windowText(ZOOM_START, ZOOM_END));
      expect(
        screen.getByText(customLabel(ZOOM_START, ZOOM_END)),
      ).toBeInTheDocument();
      expect(resetButtons()).toHaveLength(1);

      asked = resultsRequests.length;
      await doubleClick("Memory Usage");

      expect(windowsAskedSince(asked)).toEqual([windowText(HOUR_START, NOW)]);
      for (const title of CONTAINER_CHARTS) {
        expect(windowOfChart(chart(title))).toBe(windowText(HOUR_START, NOW));
        expect(zoomOfChart(chart(title)).onTimeRangeReset).toBeUndefined();
      }
      expect(screen.getByText("Past 1 Hour")).toBeInTheDocument();
      expect(resetButtons()).toHaveLength(0);
    });

    test("the card's Reset zoom brings both charts back", async () => {
      await renderMetricsTab();

      await dragAcross("Memory Usage", ZOOM_START, ZOOM_END);
      fireEvent.click(resetButtons()[0]!);
      await flush();

      for (const title of CONTAINER_CHARTS) {
        expect(windowOfChart(chart(title))).toBe(windowText(HOUR_START, NOW));
      }
      expect(resetButtons()).toHaveLength(0);
    });

    test("the Logs tab keeps its own range: no zoom reaches its viewer", async () => {
      await renderMetricsTab();

      await dragAcross("CPU Utilization", ZOOM_START, ZOOM_END);

      fireEvent.click(screen.getByTestId("tab-Logs"));
      await flush();

      expect(screen.getByTestId("logs-viewer")).toBeInTheDocument();
      expect(mockLogsViewerSeen).not.toBeNull();
      // No page-level zoom wraps the tabs, and no range is forced on it.
      expect(mockLogsViewerSeen!.zoomOffered).toBeNull();
      expect(mockLogsViewerSeen!.timeRangeOverride).toBeUndefined();
    });
  },
);
