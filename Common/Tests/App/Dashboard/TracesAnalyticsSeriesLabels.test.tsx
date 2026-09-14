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
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The traces analytics view split by "Service" used to key its timeseries
 * series by the DISPLAY label. A Service named "checkout" (the server swaps a
 * Service id for its name) and a RUM application named "checkout" therefore
 * became one series: the second overwrote the first's values bucket by
 * bucket, and the legend rendered two children with the same React key.
 *
 * This mounts the real TracesAnalyticsView against a mocked analytics
 * endpoint and a real entity-name lookup over a mocked ModelAPI. recharts is
 * replaced by probes that print the data and the series they are handed —
 * jsdom has no layout, so the real charts would render nothing to assert on.
 */

const apiPostMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factories run.
 */
jest.mock("recharts", () => {
  const ReactInFactory: typeof React = jest.requireActual(
    "react",
  ) as typeof React;

  const chart: (testId: string) => (props: any) => React.ReactElement = (
    testId: string,
  ) => {
    return (props: any): React.ReactElement => {
      return ReactInFactory.createElement(
        "div",
        { "data-testid": testId, "data-rows": JSON.stringify(props.data) },
        props.children,
      );
    };
  };

  const series: (props: any) => React.ReactElement = (
    props: any,
  ): React.ReactElement => {
    return ReactInFactory.createElement("span", {
      "data-testid": "chart-series",
      "data-key": props.dataKey,
    });
  };

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: (props: any) => {
      return ReactInFactory.createElement("div", {}, props.children);
    },
    BarChart: chart("bar-chart"),
    LineChart: chart("line-chart"),
    AreaChart: chart("area-chart"),
    Bar: series,
    Line: series,
    Area: series,
    CartesianGrid: nothing,
    XAxis: nothing,
    YAxis: nothing,
    Tooltip: nothing,
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return apiPostMock(...args);
      },
      getFriendlyMessage: () => {
        return "error";
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
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<any>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

import TracesAnalyticsView from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesAnalyticsView";
import Host from "../../../Models/DatabaseModels/Host";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import ObjectID from "../../../Types/ObjectID";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const RUM_ID: string = "84858d6c-3333-4333-8333-333333333333";
const HOST_ID: string = "44444444-4444-4444-8444-444444444444";
const SECOND_HOST_ID: string = "66666666-6666-4666-8666-666666666666";

type ModelListArgs = { modelType: unknown; query?: any };
type AnalyticsRequest = { data: { chartType: string } };

// A RUM application and two hosts; the RUM app shares a Service's name.
const installModelApi: () => void = (): void => {
  getListMock.mockImplementation(async (args: ModelListArgs) => {
    if (args.modelType === RumApplication) {
      const app: RumApplication = new RumApplication();
      app.id = new ObjectID(RUM_ID);
      app.name = "checkout";
      return { data: [app], count: 1 };
    }
    if (args.modelType === Host) {
      return {
        data: [HOST_ID, SECOND_HOST_ID].map((id: string): Host => {
          const host: Host = new Host();
          host.id = new ObjectID(id);
          host.name = "ip-10-0-0-12";
          return host;
        }),
        count: 2,
      };
    }
    return { data: [], count: 0 };
  });
};

const installAnalyticsApi: () => void = (): void => {
  apiPostMock.mockImplementation(async (request: AnalyticsRequest) => {
    if (request.data.chartType === "timeseries") {
      return {
        data: {
          data: [
            // The server already swapped the Service id for its name.
            {
              time: "t1",
              value: 5,
              groupValues: { primaryEntityId: "checkout" },
            },
            { time: "t1", value: 7, groupValues: { primaryEntityId: RUM_ID } },
            {
              time: "t2",
              value: 1,
              groupValues: { primaryEntityId: "checkout" },
            },
            { time: "t2", value: 2, groupValues: { primaryEntityId: RUM_ID } },
          ],
        },
      };
    }

    if (request.data.chartType === "toplist") {
      return {
        data: {
          data: [
            { value: "checkout", metricValue: 9, count: 9 },
            { value: RUM_ID, metricValue: 4, count: 4 },
            { value: HOST_ID, metricValue: 3, count: 3 },
            { value: SECOND_HOST_ID, metricValue: 2, count: 2 },
          ],
        },
      };
    }

    const tableRow: (primaryEntityId: string, count: number) => any = (
      primaryEntityId: string,
      count: number,
    ): any => {
      return {
        groupValues: { primaryEntityId },
        count,
        errorCount: 0,
        avgDurationMs: 1,
        p50DurationMs: 1,
        p90DurationMs: 1,
        p95DurationMs: 1,
        p99DurationMs: 1,
        minDurationMs: 1,
        maxDurationMs: 1,
      };
    };

    return {
      data: {
        data: [tableRow("checkout", 9), tableRow(RUM_ID, 4)],
      },
    };
  });
};

type SelectChartFunction = (chartType: string) => void;

const selectChart: SelectChartFunction = (chartType: string): void => {
  // Controls in order: Chart, Measure, Split by, …
  const selects: Array<HTMLElement> = screen.getAllByRole("combobox");
  fireEvent.change(selects[0]!, { target: { value: chartType } });
};

const splitByService: () => void = (): void => {
  const selects: Array<HTMLElement> = screen.getAllByRole("combobox");
  fireEvent.change(selects[2]!, { target: { value: "primaryEntityId" } });
};

describe("TracesAnalyticsView keeps same-named entities apart", () => {
  let consoleErrorSpy: { mockRestore: () => void; mock: { calls: any[] } };

  beforeEach(() => {
    TelemetryEntityNameResolver.clearCache();
    getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
    installModelApi();
    installAnalyticsApi();
    consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {}) as unknown as {
      mockRestore: () => void;
      mock: { calls: any[] };
    };
  });

  afterEach(() => {
    cleanup();
    consoleErrorSpy.mockRestore();
    jest.clearAllMocks();
  });

  const duplicateKeyWarnings: () => Array<string> = (): Array<string> => {
    return consoleErrorSpy.mock.calls
      .map((call: Array<unknown>): string => {
        return call.map(String).join(" ");
      })
      .filter((message: string): boolean => {
        return message.includes("same key");
      });
  };

  test("REGRESSION: a Service and a RUM application both named 'checkout' stay two series", async () => {
    render(
      <TracesAnalyticsView
        baseFilters={{}}
        attributeKeys={[]}
        serviceNameMap={{}}
      />,
    );

    splitByService();

    await waitFor(() => {
      expect(screen.getByText("checkout (Service)")).toBeInTheDocument();
      expect(
        screen.getByText("checkout (RUM Application)"),
      ).toBeInTheDocument();
    });

    const seriesKeys: Array<string | null> = screen
      .getAllByTestId("chart-series")
      .map((element: HTMLElement): string | null => {
        return element.getAttribute("data-key");
      });
    expect(seriesKeys).toEqual([
      "checkout (Service)",
      "checkout (RUM Application)",
    ]);

    // Each series keeps its own values in every bucket.
    const rows: Array<Record<string, unknown>> = JSON.parse(
      screen.getByTestId("bar-chart").getAttribute("data-rows") || "[]",
    );
    expect(rows).toEqual([
      { time: "t1", "checkout (Service)": 5, "checkout (RUM Application)": 7 },
      { time: "t2", "checkout (Service)": 1, "checkout (RUM Application)": 2 },
    ]);

    expect(duplicateKeyWarnings()).toEqual([]);
  });

  test("the top list tells same-named entities apart, down to a short id", async () => {
    render(
      <TracesAnalyticsView
        baseFilters={{}}
        attributeKeys={[]}
        serviceNameMap={{}}
      />,
    );

    selectChart("toplist");
    splitByService();

    await waitFor(() => {
      expect(screen.getByText("checkout (Service)")).toBeInTheDocument();
      expect(
        screen.getByText("checkout (RUM Application)"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("ip-10-0-0-12 (Host · 44444444)"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("ip-10-0-0-12 (Host · 66666666)"),
      ).toBeInTheDocument();
    });

    // Filtering is untouched: the request split by the id column.
    const lastRequest: any =
      apiPostMock.mock.calls[apiPostMock.mock.calls.length - 1]![0];
    expect(lastRequest.data.groupBy).toEqual(["primaryEntityId"]);
  });

  test("table cells of the same column are disambiguated too", async () => {
    render(
      <TracesAnalyticsView
        baseFilters={{}}
        attributeKeys={[]}
        serviceNameMap={{}}
      />,
    );

    selectChart("table");
    splitByService();

    await waitFor(() => {
      expect(screen.getByText("checkout (Service)")).toBeInTheDocument();
      expect(
        screen.getByText("checkout (RUM Application)"),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText(RUM_ID)).not.toBeInTheDocument();
  });
});
