import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on a PUBLIC dashboard. The anonymous page (DashboardViewPage)
 * owns its board's range through the same zoom hook as the authenticated
 * one and mounts the same canvas, so a drag on any time-series widget
 * retimes every widget on it - the metric chart, the value widget's
 * sparkline and the SLO chart, which reads its history through the public
 * endpoint - and a double-click on another, or the header's "Reset Zoom",
 * puts them all back.
 *
 * The page's own API client and the widgets' data layers are faked; the
 * chart libraries are stood in for by components that resolve their zoom
 * the way the real wrappers do.
 */

jest.setTimeout(120000);

const HOUR_MS: number = 60 * 60 * 1000;
const MINUTE_MS: number = 60 * 1000;

const publicPostMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const fetchResultsMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factory runs. Dereferencing them lazily, at call time, is what makes
 * this work.
 */
jest.mock("../../../../App/FeatureSet/PublicDashboard/src/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return publicPostMock(...args);
      },
      getFriendlyErrorMessage: (err: Error) => {
        return err.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
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
        loadAllMetricsTypes: () => {
          return Promise.resolve({ metricTypes: [] });
        },
        fetchResults: (...args: Array<any>) => {
          return fetchResultsMock(...args);
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

interface ZoomContextModule {
  useChartTimeRangeZoom: () => ChartTimeRangeZoomContextValue | null;
  resolveChartTimeRangeZoom: (
    input: ResolveChartTimeRangeZoomInput,
  ) => ChartTimeRangeZoomHandlers;
}

interface ZoomableStubProps {
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  disableTimeRangeZoom?: boolean | undefined;
}

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;
  const zoomContext: ZoomContextModule = jest.requireActual(
    "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext",
  ) as ZoomContextModule;
  return {
    __esModule: true,
    default: (props: ZoomableStubProps): React.ReactElement => {
      return react.createElement(ZoomableStub, {
        ...props,
        testId: "slo-line-chart",
        zoomContext: zoomContext,
      });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;
    const zoomContext: ZoomContextModule = jest.requireActual(
      "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext",
    ) as ZoomContextModule;
    return {
      __esModule: true,
      default: (props: ZoomableStubProps): React.ReactElement => {
        return react.createElement(ZoomableStub, {
          ...props,
          testId: "metric-charts",
          zoomContext: zoomContext,
        });
      },
    };
  },
);

import DashboardViewPage from "../../../../App/FeatureSet/PublicDashboard/src/Pages/DashboardView/DashboardViewPage";
import { SPARKLINE_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/ValueWidgetView";
import { setPublicDashboardContext } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import {
  SloWidgetDisplayType,
  SloWidgetMetric,
} from "../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  ChartTimeRangeZoomContextValue,
  ChartTimeRangeZoomHandlers,
  ResolveChartTimeRangeZoomInput,
} from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";

interface ZoomableStubRenderProps extends ZoomableStubProps {
  testId: string;
  zoomContext: ZoomContextModule;
}

let nextDragWindow: [Date, Date] = [new Date(0), new Date(1)];

function ZoomableStub(props: ZoomableStubRenderProps): React.ReactElement {
  const pageZoom: ChartTimeRangeZoomContextValue | null =
    props.zoomContext.useChartTimeRangeZoom();
  const zoom: ChartTimeRangeZoomHandlers =
    props.zoomContext.resolveChartTimeRangeZoom({
      onTimeRangeSelect: props.onTimeRangeSelect,
      onTimeRangeReset: props.onTimeRangeReset,
      isTimeAxis: true,
      disableTimeRangeZoom: props.disableTimeRangeZoom,
      pageZoom: pageZoom,
    });

  return (
    <div
      data-testid={props.testId}
      data-can-zoom={String(Boolean(zoom.onTimeRangeSelect))}
      data-can-reset={String(Boolean(zoom.onTimeRangeReset))}
    >
      <button
        type="button"
        data-testid={`${props.testId}-drag`}
        onClick={() => {
          zoom.onTimeRangeSelect?.(nextDragWindow[0], nextDragWindow[1]);
        }}
      />
      <button
        type="button"
        data-testid={`${props.testId}-double-click`}
        onClick={() => {
          zoom.onTimeRangeReset?.();
        }}
      />
    </div>
  );
}

const DASHBOARD_ID: ObjectID = new ObjectID(
  "c1c1c1c1-1111-4111-8111-c1c1c1c1c1c1",
);

function component(
  componentType: DashboardComponentType,
  rect: { top: number; left: number; width: number; height: number },
  args: JSONObject,
): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: ObjectID.generate(),
    componentType: componentType,
    topInDashboardUnits: rect.top,
    leftInDashboardUnits: rect.left,
    widthInDashboardUnits: rect.width,
    heightInDashboardUnits: rect.height,
    minWidthInDashboardUnits: 1,
    minHeightInDashboardUnits: 1,
    arguments: args,
  };
}

function buildBoard(): DashboardViewConfig {
  return {
    _type: ObjectType.DashboardViewConfig,
    heightInDashboardUnits: 8,
    components: [
      component(
        DashboardComponentType.Chart,
        { top: 0, left: 0, width: 6, height: 3 },
        {
          chartTitle: "CPU",
          chartType: DashboardChartType.Line,
          metricQueryConfig: {
            metricAliasData: { metricVariable: "a" },
            metricQueryData: {
              filterData: {
                metricName: "cpu.usage",
                aggegationType: MetricsAggregationType.Avg,
              },
            },
          },
        },
      ),
      component(
        DashboardComponentType.Value,
        { top: 0, left: 6, width: 3, height: 4 },
        {
          title: "Requests",
          metricQueryConfig: {
            metricAliasData: { metricVariable: "a" },
            metricQueryData: {
              filterData: {
                metricName: "http.requests",
                aggegationType: MetricsAggregationType.Sum,
              },
            },
          },
        },
      ),
      component(
        DashboardComponentType.Slo,
        { top: 3, left: 0, width: 6, height: 3 },
        {
          serviceLevelObjectiveId: "c2c2c2c2-1111-4111-8111-c2c2c2c2c2c2",
          sloMetric: SloWidgetMetric.Sli,
          displayType: SloWidgetDisplayType.Chart,
        },
      ),
    ],
  };
}

type Window = [number, number];

function minuteFloor(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}

function pointsAcross(
  start: Date,
  end: Date,
): Array<{ timestamp: string; value: number }> {
  const points: Array<{ timestamp: string; value: number }> = [];
  for (
    let ms: number = minuteFloor(start.getTime()) + MINUTE_MS;
    ms < end.getTime();
    ms += 5 * MINUTE_MS
  ) {
    points.push({
      timestamp: new Date(ms).toISOString(),
      value: points.length + 1,
    });
  }
  return points;
}

interface PublicPostArgs {
  url: { toString: () => string };
  data: JSONObject;
}

function metricWindows(metricName: string): Array<Window> {
  return fetchResultsMock.mock.calls
    .map((call: Array<unknown>): MetricViewData => {
      return (call[0] as { metricViewData: MetricViewData }).metricViewData;
    })
    .filter((data: MetricViewData): boolean => {
      return (
        data.queryConfigs[0]?.metricQueryData.filterData.metricName ===
        metricName
      );
    })
    .map((data: MetricViewData): Window => {
      return [
        data.startAndEndDate!.startValue.getTime(),
        data.startAndEndDate!.endValue.getTime(),
      ];
    });
}

// The window the SLO chart asked the PUBLIC history endpoint for.
function sloWindows(): Array<Window> {
  return publicPostMock.mock.calls
    .map((call: Array<unknown>): PublicPostArgs => {
      return call[0] as PublicPostArgs;
    })
    .filter((args: PublicPostArgs): boolean => {
      return args.url.toString().includes("/slo-history-aggregate/");
    })
    .map((args: PublicPostArgs): Window => {
      const aggregateBy: JSONObject = JSONFunctions.deserialize(
        args.data["aggregateBy"] as JSONObject,
      ) as JSONObject;
      return [
        new Date(aggregateBy["startTimestamp"] as string).getTime(),
        new Date(aggregateBy["endTimestamp"] as string).getTime(),
      ];
    });
}

interface WidgetWindows {
  name: string;
  windows: () => Array<Window>;
}

const EVERY_WIDGET: Array<WidgetWindows> = [
  {
    name: "metric chart",
    windows: (): Array<Window> => {
      return metricWindows("cpu.usage");
    },
  },
  {
    name: "metric value",
    windows: (): Array<Window> => {
      return metricWindows("http.requests");
    },
  },
  { name: "SLO chart", windows: sloWindows },
];

function lastWindowOf(widget: WidgetWindows): Window | undefined {
  const windows: Array<Window> = widget.windows();
  return windows[windows.length - 1];
}

async function expectEveryWidgetOn(expected: Window): Promise<void> {
  await waitFor(() => {
    for (const widget of EVERY_WIDGET) {
      expect([widget.name, lastWindowOf(widget)]).toEqual([
        widget.name,
        expected,
      ]);
    }
  });
}

async function expectEveryWidgetOnThePastHour(
  notBeforeEndMs: number,
): Promise<void> {
  await waitFor(() => {
    for (const widget of EVERY_WIDGET) {
      const last: Window | undefined = lastWindowOf(widget);
      expect([widget.name, last ? last[1] - last[0] : null]).toEqual([
        widget.name,
        HOUR_MS,
      ]);
      expect(last![1]).toBeGreaterThanOrEqual(notBeforeEndMs);
    }
  });
}

async function renderPublicBoard(): Promise<void> {
  render(<DashboardViewPage dashboardId={DASHBOARD_ID} />);

  await waitFor(() => {
    expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
    expect(screen.getByTestId("slo-line-chart")).toBeInTheDocument();
    expect(screen.getByTestId(SPARKLINE_TEST_ID)).toBeInTheDocument();
  });
}

function resetZoomButton(): HTMLElement | null {
  return screen.queryByText("Reset Zoom");
}

let clientWidthDescriptor: PropertyDescriptor | undefined;

beforeAll(() => {
  // jsdom lays nothing out; give the board a desktop width to size tiles by.
  clientWidthDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: (): number => {
      return 1200;
    },
  });
});

afterAll(() => {
  if (clientWidthDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      clientWidthDescriptor,
    );
  }
});

beforeEach(() => {
  nextDragWindow = [new Date(0), new Date(1)];

  publicPostMock.mockImplementation((...args: Array<unknown>) => {
    const request: PublicPostArgs = args[0] as PublicPostArgs;
    const route: string = request.url.toString();

    if (route.includes("/view-config/")) {
      return Promise.resolve({
        isFailure: (): boolean => {
          return false;
        },
        data: {
          dashboardViewConfig: JSONFunctions.serialize(
            buildBoard() as unknown as JSONObject,
          ),
          name: "Status board",
        },
      });
    }

    // The SLO chart's history, for whatever window it asked about.
    const aggregateBy: JSONObject = JSONFunctions.deserialize(
      request.data["aggregateBy"] as JSONObject,
    ) as JSONObject;
    return Promise.resolve({
      data: {
        data: pointsAcross(
          new Date(aggregateBy["startTimestamp"] as string),
          new Date(aggregateBy["endTimestamp"] as string),
        ),
      },
    });
  });

  getListMock.mockImplementation(() => {
    const slo: ServiceLevelObjective = new ServiceLevelObjective();
    slo.name = "Checkout availability";
    slo.targetPercentage = 99.9;
    slo.sloStatus = SloStatus.Healthy;
    return Promise.resolve({ data: [slo], count: 1, skip: 0, limit: 1 });
  });

  fetchResultsMock.mockImplementation((...args: Array<unknown>) => {
    const data: MetricViewData = (args[0] as { metricViewData: MetricViewData })
      .metricViewData;
    return Promise.resolve([
      {
        data: pointsAcross(
          data.startAndEndDate!.startValue,
          data.startAndEndDate!.endValue,
        ).map((point: { timestamp: string; value: number }) => {
          return { timestamp: new Date(point.timestamp), value: point.value };
        }),
      },
    ]);
  });
});

afterEach(() => {
  cleanup();
  setPublicDashboardContext(null);
  jest.clearAllMocks();
});

describe("a public dashboard zooms the whole board too", () => {
  test("every widget starts on the hour and every chart offers the board's zoom", async () => {
    const renderedAt: number = Date.now();
    await renderPublicBoard();

    await expectEveryWidgetOnThePastHour(renderedAt);
    expect(screen.getByTestId("metric-charts")).toHaveAttribute(
      "data-can-zoom",
      "true",
    );
    expect(screen.getByTestId("slo-line-chart")).toHaveAttribute(
      "data-can-zoom",
      "true",
    );
    expect(resetZoomButton()).toBeNull();
    expect(screen.getByText(TimeRange.PAST_ONE_HOUR)).toBeInTheDocument();
  });

  test("a drag on the metric chart retimes every widget, SLO history included", async () => {
    await renderPublicBoard();
    const hourStart: number = lastWindowOf(EVERY_WIDGET[0]!)![0];
    const dragged: Window = [
      hourStart + 10 * MINUTE_MS,
      hourStart + 40 * MINUTE_MS,
    ];
    nextDragWindow = [new Date(dragged[0]), new Date(dragged[1])];

    fireEvent.click(screen.getByTestId("metric-charts-drag"));

    await expectEveryWidgetOn(dragged);
    expect(resetZoomButton()).toBeInTheDocument();
    expect(screen.queryByText(TimeRange.PAST_ONE_HOUR)).toBeNull();
  });

  test("a double-click on the SLO chart undoes a zoom made on the sparkline", async () => {
    const renderedAt: number = Date.now();
    await renderPublicBoard();

    const sparkline: SVGSVGElement = screen.getByTestId(
      SPARKLINE_TEST_ID,
    ) as unknown as SVGSVGElement;
    const width: number = Number(sparkline.getAttribute("width"));
    sparkline.getBoundingClientRect = (): DOMRect => {
      return { left: 0, width: width, top: 0, height: 20 } as DOMRect;
    };
    fireEvent.mouseDown(sparkline, { clientX: 4, button: 0 });
    fireEvent.mouseMove(sparkline, { clientX: width / 2, buttons: 1 });
    fireEvent.mouseUp(sparkline, { clientX: width / 2 });

    await waitFor(() => {
      expect(resetZoomButton()).toBeInTheDocument();
    });
    await waitFor(() => {
      const last: Window = lastWindowOf(EVERY_WIDGET[2]!)!;
      expect(last[1] - last[0]).toBeLessThan(HOUR_MS);
    });

    fireEvent.click(screen.getByTestId("slo-line-chart-double-click"));

    await expectEveryWidgetOnThePastHour(renderedAt);
    expect(resetZoomButton()).toBeNull();
  });

  test("the header's Reset Zoom puts every widget back on the hour", async () => {
    const renderedAt: number = Date.now();
    await renderPublicBoard();
    const hourStart: number = lastWindowOf(EVERY_WIDGET[0]!)![0];
    const dragged: Window = [
      hourStart + 15 * MINUTE_MS,
      hourStart + 20 * MINUTE_MS,
    ];
    nextDragWindow = [new Date(dragged[0]), new Date(dragged[1])];
    fireEvent.click(screen.getByTestId("slo-line-chart-drag"));
    await expectEveryWidgetOn(dragged);

    fireEvent.click(resetZoomButton()!);

    await expectEveryWidgetOnThePastHour(renderedAt);
    expect(resetZoomButton()).toBeNull();
  });
});
