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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * AN EXEMPLAR'S CLICK, AND A CHART THAT OFFERS NONE (issue #6859).
 *
 * A metric chart draws its exemplars - a purple "E" on the line where a
 * trace was sampled - and a click on one opens a menu: View trace, View
 * logs. Both leave the page. A dashboard widget's live preview, in its
 * settings dialog, sits over a board being edited, with nothing to ask
 * before leaving it, so the preview's chart passes enableExemplarActions
 * false: the exemplars are drawn as on the board, and a click on one opens
 * nothing - and no pointer over it says it would.
 *
 * The real MetricCharts, chart group and recharts draw it; only
 * ResponsiveContainer is given a size (jsdom lays nothing out) and the
 * exemplars' read is stood in for.
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

const getListMock: MockFunction = getJestMockFunction();
const fetchExemplarsMock: MockFunction = getJestMockFunction();

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
        fetchExemplars: (...args: Array<any>) => {
          return fetchExemplarsMock(...args);
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

import MetricCharts from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricQueryConfigData, {
  MetricChartType,
} from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import ExemplarPoint from "../../../UI/Components/Charts/Types/ExemplarPoint";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "77777777-1111-4111-8111-000000006859",
);

const WINDOW_START: Date = new Date("2026-08-20T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-08-20T11:00:00.000Z");

const TIMESTAMPS: Array<string> = [
  "2026-08-20T10:10:00.000Z",
  "2026-08-20T10:20:00.000Z",
  "2026-08-20T10:30:00.000Z",
];

const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID: string = "00f067aa0ba902b7";

// Sampled where the line is, at its second point.
const EXEMPLAR: ExemplarPoint = {
  x: new Date(TIMESTAMPS[1]!),
  y: 42,
  traceId: TRACE_ID,
  spanId: SPAN_ID,
};

// The purple of an exemplar's dot (the chart library's ReferenceDot).
const EXEMPLAR_FILL: string = "#7c3aed";

function buildViewData(chartType: MetricChartType): MetricViewData {
  return {
    queryConfigs: [
      {
        chartType: chartType,
        metricAliasData: { metricVariable: "a" },
        metricQueryData: {
          filterData: {
            metricName: "http.server.duration",
            attributes: {},
            aggegationType: MetricsAggregationType.Avg,
          },
        },
      } as unknown as MetricQueryConfigData,
    ],
    formulaConfigs: [],
    startAndEndDate: new InBetween<Date>(WINDOW_START, WINDOW_END),
  } as MetricViewData;
}

function buildResults(): Array<AggregatedResult> {
  return [
    {
      data: TIMESTAMPS.map((timestamp: string, index: number) => {
        return {
          timestamp: new Date(timestamp),
          value: [30, 42, 35][index],
        };
      }),
      truncated: false,
    } as unknown as AggregatedResult,
  ];
}

function drawChart(
  chartType: MetricChartType,
  enableExemplarActions?: boolean,
): void {
  render(
    <MetricCharts
      metricViewData={buildViewData(chartType)}
      metricResults={buildResults()}
      metricTypes={[]}
      enableExemplarActions={enableExemplarActions}
    />,
  );
}

// Each exemplar's dot, once the exemplars are read and drawn.
async function exemplarDots(): Promise<Array<SVGElement>> {
  let dots: Array<SVGElement> = [];

  await waitFor(() => {
    dots = Array.from(
      document.querySelectorAll<SVGElement>(
        `.recharts-reference-dot circle[fill="${EXEMPLAR_FILL}"]`,
      ),
    );
    expect(dots.length).toBeGreaterThan(0);
  });

  return dots;
}

function clickDot(dot: SVGElement): void {
  fireEvent.mouseDown(dot, { clientX: 120, clientY: 80 });
  fireEvent.mouseUp(dot, { clientX: 120, clientY: 80 });
  fireEvent.click(dot, { clientX: 120, clientY: 80 });
}

let navigateSpy: SpyInstance<typeof Navigation.navigate>;

beforeEach(() => {
  getListMock.mockReset();
  fetchExemplarsMock.mockReset();
  fetchExemplarsMock.mockResolvedValue([EXEMPLAR]);
  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  jest.restoreAllMocks();
  cleanup();
});

// The two kinds of chart that draw exemplars.
describe.each([
  ["an area chart", MetricChartType.AREA],
  ["a line chart", MetricChartType.LINE],
])("%s's exemplars", (_name: string, chartType: MetricChartType) => {
  test("left out, an exemplar's click opens its menu, and View trace opens the trace", async () => {
    drawChart(chartType);

    const dots: Array<SVGElement> = await exemplarDots();

    expect(dots).toHaveLength(1);
    expect(dots[0]!.style.cursor).toBe("pointer");

    clickDot(dots[0]!);

    const menu: HTMLElement = await screen.findByRole("menu", {
      name: "Exemplar actions",
    });

    expect(menu).toHaveTextContent("View trace");
    expect(menu).toHaveTextContent("View logs");

    fireEvent.click(screen.getByText("View trace"));

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(String(navigateSpy.mock.calls[0]?.[0])).toContain(TRACE_ID);
  });

  test("true is the same as left out", async () => {
    drawChart(chartType, true);

    const dots: Array<SVGElement> = await exemplarDots();

    expect(dots[0]!.style.cursor).toBe("pointer");

    clickDot(dots[0]!);

    expect(
      await screen.findByRole("menu", { name: "Exemplar actions" }),
    ).toBeInTheDocument();
  });

  test("false: the exemplars are drawn as they are, and a click opens nothing", async () => {
    drawChart(chartType, false);

    const dots: Array<SVGElement> = await exemplarDots();

    // Still read, still drawn: one dot, the size it is on the board.
    expect(fetchExemplarsMock).toHaveBeenCalled();
    expect(dots).toHaveLength(1);
    expect(dots[0]!.getAttribute("r")).toBe("5");
    // Nothing says a click would do something.
    expect(dots[0]!.style.cursor).toBe("default");

    clickDot(dots[0]!);

    // A click's menu would open at once; give it a turn to be sure.
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 50);
    });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByText("View trace")).toBeNull();
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
