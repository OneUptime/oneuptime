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
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Metrics page's PromQL tab (issue #6796): write a query, run it, see a
 * graph or a table, and learn how to point Grafana at the same API.
 *
 * The API client and the chart layer are stubbed: what this component owns
 * is what it asks the API for (which endpoint, which window), and what it
 * hands the chart and draws in the table.
 */

const queryRangeMock: MockFunction = getJestMockFunction();
const queryInstantMock: MockFunction = getJestMockFunction();
const getMetricNamesMock: MockFunction = getJestMockFunction();
const metricChartsRenderMock: MockFunction = getJestMockFunction();

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/PromQLQuery", () => {
  return {
    __esModule: true,
    default: {
      queryRange: (...args: Array<any>) => {
        return queryRangeMock(...args);
      },
      queryInstant: (...args: Array<any>) => {
        return queryInstantMock(...args);
      },
      getMetricNames: (...args: Array<any>) => {
        return getMetricNamesMock(...args);
      },
      getPrometheusServerUrl: () => {
        return "https://oneuptime.example.com/api/prometheus";
      },
      getStepInSeconds: () => {
        return 15;
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: any): React.ReactElement => {
        metricChartsRenderMock(props);
        return React.createElement(
          "div",
          { "data-testid": "metric-charts" },
          `points:${props.metricResults[0]?.data.length ?? 0}`,
        );
      },
    };
  },
);

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: (props: any): React.ReactElement => {
        return React.createElement(
          "button",
          {
            type: "button",
            "data-testid": "time-range-picker",
            onClick: () => {
              props.onChange({ range: "Past 1 Day" });
            },
          },
          String(props.value.range),
        );
      },
    };
  },
);

jest.mock("../../../UI/Components/Dropdown/Dropdown", () => {
  return {
    __esModule: true,
    default: (props: any): React.ReactElement => {
      return React.createElement(
        "select",
        {
          "data-testid": "metric-picker",
          "aria-label": props.ariaLabel,
          onChange: (event: any) => {
            props.onChange(event.target.value);
          },
        },
        [
          React.createElement("option", { key: "", value: "" }, "-"),
          ...props.options.map((option: any) => {
            return React.createElement(
              "option",
              { key: option.value, value: option.value },
              option.label,
            );
          }),
        ],
      );
    },
  };
});

import PromQLQueryView, {
  PROMQL_ERROR_TEST_ID,
  PROMQL_EXAMPLES,
  PROMQL_QUERY_EDITOR_TEST_ID,
  PROMQL_RESULT_TEST_ID,
  PROMQL_RUN_BUTTON_TEST_ID,
  PROMQL_SERVER_URL_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/PromQL/PromQLQueryView";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import { PrometheusResult } from "../../../Utils/PromQL/PrometheusResponse";

const MATRIX: PrometheusResult = {
  resultType: "matrix",
  series: [
    {
      labels: { job: "api" },
      points: [
        { timestampMs: 1700000000000, value: 1.5 },
        { timestampMs: 1700000015000, value: NaN },
        { timestampMs: 1700000030000, value: 2.5 },
      ],
    },
    {
      labels: { __name__: "up", job: "web" },
      points: [{ timestampMs: 1700000000000, value: 1 }],
    },
  ],
};

// Renders the tab, and lets the project's metric names arrive.
const renderView: (initialQuery?: string) => Promise<void> = async (
  initialQuery?: string,
): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter>
        <PromQLQueryView initialQuery={initialQuery ?? ""} />
      </MemoryRouter>,
    );
  });
};

const editor: () => HTMLTextAreaElement = (): HTMLTextAreaElement => {
  return screen.getByTestId(PROMQL_QUERY_EDITOR_TEST_ID) as HTMLTextAreaElement;
};

const typeQuery: (query: string) => void = (query: string): void => {
  fireEvent.change(editor(), { target: { value: query } });
};

const clickRun: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(PROMQL_RUN_BUTTON_TEST_ID));
  });
};

describe("The PromQL tab", () => {
  beforeEach(() => {
    getMetricNamesMock.mockResolvedValue([
      "http_requests_total",
      "system_memory_usage",
    ] as never);
    queryRangeMock.mockResolvedValue(MATRIX as never);
    queryInstantMock.mockResolvedValue({
      resultType: "vector",
      series: [
        {
          labels: { job: "api" },
          points: [{ timestampMs: 1700000030000, value: 2.5 }],
        },
      ],
    } as never);
  });

  afterEach(() => {
    cleanup();
    queryRangeMock.mockReset();
    queryInstantMock.mockReset();
    getMetricNamesMock.mockReset();
    metricChartsRenderMock.mockReset();
  });

  test("says what to do before anything has run", async () => {
    await renderView();

    // The card's title, and the editor's name for screen readers.
    expect(screen.getAllByText("PromQL Query").length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Write a query and press Run Query to see its result here.",
      ),
    ).toBeInTheDocument();
    expect(queryRangeMock).not.toHaveBeenCalled();
  });

  test("shows the address to give Grafana, with how to sign in", async () => {
    await renderView();

    expect(screen.getByTestId(PROMQL_SERVER_URL_TEST_ID)).toHaveTextContent(
      "https://oneuptime.example.com/api/prometheus",
    );
    expect(screen.getByText("Query From Grafana")).toBeInTheDocument();
    expect(screen.getByText("Create API Key")).toBeInTheDocument();
  });

  test("an empty query is not sent, and says what to write", async () => {
    await renderView();
    await clickRun();

    expect(queryRangeMock).not.toHaveBeenCalled();
    expect(screen.getByTestId(PROMQL_ERROR_TEST_ID)).toHaveTextContent(
      "Write a PromQL query first",
    );
  });

  test("Run Query asks for the query over the time range and charts each series", async () => {
    await renderView();
    typeQuery("  sum by (job) (rate(http_requests_total[5m]))  ");
    await clickRun();

    await waitFor(() => {
      expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
    });

    expect(queryRangeMock).toHaveBeenCalledTimes(1);
    const args: { query: string; startDate: Date; endDate: Date } = (
      queryRangeMock.mock.calls[0] as Array<any>
    )[0];
    expect(args.query).toBe("sum by (job) (rate(http_requests_total[5m]))");
    // The tab opens on the past hour.
    expect(args.endDate.getTime() - args.startDate.getTime()).toBe(3600000);

    const props: any =
      metricChartsRenderMock.mock.calls[
        metricChartsRenderMock.mock.calls.length - 1
      ]![0];
    const points: Array<AggregatedModel> = props.metricResults[0].data;

    // NaN cannot be drawn: three points, not four.
    expect(points).toHaveLength(3);
    expect(
      points.map((point: AggregatedModel): string => {
        return props.metricViewData.queryConfigs[0].getSeries(point).title;
      }),
    ).toEqual(['{job="api"}', '{job="api"}', 'up{job="web"}']);
    expect(props.enableSeriesActions).toBe(false);
  });

  test("Ctrl+Enter runs the query from the editor", async () => {
    await renderView("up");

    await act(async () => {
      fireEvent.keyDown(editor(), { key: "Enter", ctrlKey: true });
    });

    expect(queryRangeMock).toHaveBeenCalledTimes(1);
  });

  test("a query the server refuses says why, in a sentence", async () => {
    queryRangeMock.mockRejectedValue(
      new HTTPErrorResponse(
        400,
        {
          status: "error",
          errorType: "bad_data",
          error:
            "Argument 1 of rate() must be a range vector, but it is an instant vector.",
        },
        {},
      ) as never,
    );

    await renderView("rate(http_requests_total)");
    await clickRun();

    await waitFor(() => {
      expect(screen.getByTestId(PROMQL_ERROR_TEST_ID)).toHaveTextContent(
        "The query did not run.",
      );
    });
    expect(screen.getByTestId(PROMQL_ERROR_TEST_ID)).toHaveTextContent(
      "must be a range vector",
    );
  });

  test("Table runs the query once, at the end of the time range, and lists each series", async () => {
    await renderView("http_requests_total");
    await clickRun();

    await act(async () => {
      fireEvent.click(screen.getByText("Table"));
    });

    await waitFor(() => {
      expect(screen.getByText('{job="api"}')).toBeInTheDocument();
    });

    const args: { query: string; time: Date } = (
      queryInstantMock.mock.calls[0] as Array<any>
    )[0];
    const rangeArgs: { endDate: Date } = (
      queryRangeMock.mock.calls[0] as Array<any>
    )[0];
    expect(args.query).toBe("http_requests_total");
    expect(
      Math.abs(args.time.getTime() - rangeArgs.endDate.getTime()),
    ).toBeLessThan(5000);
    expect(screen.getByTestId(PROMQL_RESULT_TEST_ID)).toHaveTextContent("2.5");
  });

  test("a range vector in the table says how many samples each series holds", async () => {
    queryInstantMock.mockResolvedValue({
      resultType: "matrix",
      series: [
        {
          labels: { job: "api" },
          points: [
            { timestampMs: 1, value: 1 },
            { timestampMs: 2, value: 3 },
          ],
        },
      ],
    } as never);

    await renderView("http_requests_total[5m]");

    await act(async () => {
      fireEvent.click(screen.getByText("Table"));
    });
    await clickRun();

    await waitFor(() => {
      expect(screen.getByText("2 samples")).toBeInTheDocument();
    });
  });

  test("a query that matches nothing says so, and offers nothing to create", async () => {
    queryRangeMock.mockResolvedValue({
      resultType: "matrix",
      series: [],
    } as never);

    await renderView("nothing_here");
    await clickRun();

    await waitFor(() => {
      expect(
        screen.getByText("No series matched this query in the time range."),
      ).toBeInTheDocument();
    });
  });

  test("a new time range runs the query on screen again", async () => {
    await renderView("up");
    await clickRun();

    await act(async () => {
      fireEvent.click(screen.getByTestId("time-range-picker"));
    });

    expect(queryRangeMock).toHaveBeenCalledTimes(2);
  });

  test("an example fills the editor", async () => {
    await renderView();

    fireEvent.click(screen.getByText(PROMQL_EXAMPLES[0]!.title));

    expect(editor().value).toBe(PROMQL_EXAMPLES[0]!.query);
  });

  test("a metric name picked from the project's metrics is added to the query", async () => {
    await renderView("sum by (job) (rate(");

    await waitFor(() => {
      expect(screen.getByTestId("metric-picker")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("metric-picker"), {
      target: { value: "http_requests_total" },
    });

    expect(editor().value).toBe("sum by (job) (rate( http_requests_total");
  });

  test("the metric picker stays away when the project's names cannot be read", async () => {
    getMetricNamesMock.mockRejectedValue(new Error("offline") as never);
    await renderView();

    await waitFor(() => {
      expect(getMetricNamesMock).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("metric-picker")).not.toBeInTheDocument();
  });
});
