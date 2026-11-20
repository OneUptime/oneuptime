import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A public dashboard's Data Source widgets of this project's metrics
 * (issue #10226), drawn for a visitor nobody signed in: each asks the
 * dashboard's public PromQL route for its stored query by this widget and
 * the query's place - never with the query's text, which the page is not
 * served, and never through the signed-in /data-source/query route - and
 * draws the answer exactly as inside OneUptime.
 */

const metricChartsRenderMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: {
        metricResults: Array<unknown>;
        metricViewData: { queryConfigs: Array<unknown> };
      }): React.ReactElement => {
        metricChartsRenderMock(props);
        return React.createElement(
          "div",
          { "data-testid": "metric-charts" },
          `results:${props.metricResults.length} configs:${props.metricViewData.queryConfigs.length}`,
        );
      },
    };
  },
);

// The signed-in route: a public widget must never reach it.
const signedInPostMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return signedInPostMock(...args);
      },
      getFriendlyErrorMessage: (err: Error): string => {
        return err.message;
      },
      getFriendlyMessage: (err: Error): string => {
        return err.message;
      },
    },
  };
});

import DashboardDataSourceChartComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceChartComponent";
import DashboardDataSourceTableComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceTableComponent";
import DashboardDataSourceValueComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceValueComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardDataSourceChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceChartComponent";
import DashboardDataSourceTableComponent from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceTableComponent";
import DashboardDataSourceValueComponent from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceValueComponent";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { PUBLIC_DASHBOARD_PROMQL_QUERY_PATH } from "../../../Types/Dashboard/PublicDashboardPromQL";
import { DataSourceResultKind } from "../../../Types/DataSource/DataSourceQueryConfig";
import { DataSourceTableColumnType } from "../../../Types/DataSource/DataSourceTableResult";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

const DASHBOARD_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const COMPONENT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const START_DATE: Date = new Date("2026-11-20T08:00:00.000Z");
const END_DATE: Date = new Date("2026-11-20T09:00:00.000Z");

const DASHBOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(START_DATE, END_DATE),
};

const VARIABLES: Array<DashboardVariable> = [
  {
    id: "var-env",
    name: "env",
    label: "Environment",
    type: DashboardVariableType.TelemetryAttribute,
    attributeKey: "deployment.environment",
    selectedValue: "prod",
  },
];

const publicPostMock: MockFunction = getJestMockFunction();

const enterPublicBoard: () => void = (): void => {
  setPublicDashboardContext({
    dashboardId: DASHBOARD_ID,
    apiUrl: {
      toString: (): string => {
        return "http://localhost/public-dashboard-api";
      },
    },
    postJSON: (route: string, data: JSONObject): unknown => {
      return publicPostMock(route, data);
    },
    apiClient: {},
  } as unknown as PublicDashboardContext);
};

const baseProps: () => DashboardBaseComponentProps =
  (): DashboardBaseComponentProps => {
    return {
      componentId: COMPONENT_ID,
      isEditMode: false,
      isSelected: false,
      key: "public-promql-widget",
      onComponentUpdate: (): void => {},
      totalCurrentDashboardWidthInPx: 1200,
      dashboardCanvasTopInPx: 0,
      dashboardCanvasLeftInPx: 0,
      dashboardCanvasWidthInPx: 1200,
      dashboardCanvasHeightInPx: 800,
      dashboardComponentHeightInPx: 320,
      dashboardComponentWidthInPx: 480,
      dashboardViewConfig: {
        _type: ObjectType.DashboardViewConfig,
        components: [],
        heightInDashboardUnits: 60,
      } as DashboardViewConfig,
      dashboardStartAndEndDate: DASHBOARD_RANGE,
      metricTypes: [],
      refreshTick: 0,
      variables: VARIABLES,
    };
  };

const answer: (body: JSONObject) => HTTPResponse<JSONObject> = (
  body: JSONObject,
): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, body, {});
};

const timeSeriesAnswer: HTTPResponse<JSONObject> = answer({
  resultKind: DataSourceResultKind.TimeSeries,
  result: {
    data: [
      {
        timestamp: "2026-11-20T08:30:00.000Z",
        value: 7,
        attributes: { pod: "api-1" },
      },
    ],
    truncated: false,
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  publicPostMock.mockResolvedValue(timeSeriesAnswer);
  enterPublicBoard();
});

afterEach(() => {
  cleanup();
  setPublicDashboardContext(null);
});

const callsTo: () => Array<{ route: string; data: JSONObject }> = (): Array<{
  route: string;
  data: JSONObject;
}> => {
  return publicPostMock.mock.calls.map(
    (call: Array<unknown>): { route: string; data: JSONObject } => {
      return { route: call[0] as string, data: call[1] as JSONObject };
    },
  );
};

describe("a public dashboard's PromQL chart", () => {
  const renderChart: (
    args: DashboardDataSourceChartComponent["arguments"],
  ) => void = (args: DashboardDataSourceChartComponent["arguments"]): void => {
    render(
      <DashboardDataSourceChartComponentElement
        {...baseProps()}
        component={{
          _type: ObjectType.DashboardComponent,
          componentId: COMPONENT_ID,
          componentType: DashboardComponentType.DataSourceChart,
          topInDashboardUnits: 0,
          leftInDashboardUnits: 0,
          widthInDashboardUnits: 8,
          heightInDashboardUnits: 6,
          minWidthInDashboardUnits: 4,
          minHeightInDashboardUnits: 3,
          arguments: args,
        }}
      />,
    );
  };

  test("asks the public route for each served query by this widget and its place, with the window and the variables' picks only", async () => {
    renderChart({
      chartTitle: "Requests",
      // As the server serves them: the source, the id, the legend; no text.
      queries: [
        { id: "q1", dataSourceId: "oneuptime-metrics", legend: "{{pod}}" },
        { id: "q2", dataSourceId: "oneuptime-metrics" },
      ] as unknown as DashboardDataSourceChartComponent["arguments"]["queries"],
    });

    expect(await screen.findByTestId("metric-charts")).toHaveTextContent(
      "results:2 configs:2",
    );

    expect(callsTo()).toEqual(
      [0, 1].map((queryIndex: number) => {
        return {
          route: `${PUBLIC_DASHBOARD_PROMQL_QUERY_PATH}/${DASHBOARD_ID.toString()}`,
          data: {
            componentId: COMPONENT_ID.toString(),
            queryIndex,
            startDate: START_DATE.toISOString(),
            endDate: END_DATE.toISOString(),
            variables: [
              { id: "var-env", selectedValue: "prod", selectedValues: [] },
            ],
          },
        };
      }),
    );

    // Never the signed-in route, and never a query of its own.
    expect(signedInPostMock).not.toHaveBeenCalled();
    expect(JSON.stringify(callsTo())).not.toContain('query":');

    // Drawn as inside OneUptime: its legend names its series.
    const drawn: { metricResults: Array<{ data: Array<JSONObject> }> } =
      metricChartsRenderMock.mock.calls[
        metricChartsRenderMock.mock.calls.length - 1
      ]![0] as { metricResults: Array<{ data: Array<JSONObject> }> };

    expect(drawn.metricResults[0]!.data[0]!["value"]).toBe(7);
    expect(drawn.metricResults[0]!.data[0]!["timestamp"]).toEqual(
      new Date("2026-11-20T08:30:00.000Z"),
    );
  });

  test("says why when the route refuses, in the widget's error line", async () => {
    publicPostMock.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        {
          message:
            "This dashboard's Environment variable does not offer this value.",
        },
        {},
      ),
    );

    renderChart({
      queries: [
        { dataSourceId: "oneuptime-metrics" },
      ] as unknown as DashboardDataSourceChartComponent["arguments"]["queries"],
    });

    expect(
      await screen.findByText(
        "This dashboard's Environment variable does not offer this value.",
        { exact: false },
      ),
    ).toBeInTheDocument();
  });

  test("a widget of an outside system, which the server never serves, still asks nothing", () => {
    renderChart({
      queries: [
        {
          dataSourceId: "ab000000-0000-4000-8000-0000000000d1",
          query: "outside_metric",
        },
      ],
    });

    expect(
      screen.getByText(/not available on public dashboards/i),
    ).toBeInTheDocument();
    expect(publicPostMock).not.toHaveBeenCalled();
    expect(signedInPostMock).not.toHaveBeenCalled();
  });
});

describe("a public dashboard's PromQL value", () => {
  test("asks for its one query, and draws the number", async () => {
    const args: DashboardDataSourceValueComponent["arguments"] = {
      title: "Requests now",
      query: {
        dataSourceId: "oneuptime-metrics",
      } as unknown as DashboardDataSourceValueComponent["arguments"]["query"],
    };

    render(
      <DashboardDataSourceValueComponentElement
        {...baseProps()}
        component={{
          _type: ObjectType.DashboardComponent,
          componentId: COMPONENT_ID,
          componentType: DashboardComponentType.DataSourceValue,
          topInDashboardUnits: 0,
          leftInDashboardUnits: 0,
          widthInDashboardUnits: 6,
          heightInDashboardUnits: 4,
          minWidthInDashboardUnits: 3,
          minHeightInDashboardUnits: 2,
          arguments: args,
        }}
      />,
    );

    expect(await screen.findByText("Requests now")).toBeInTheDocument();
    await waitFor(() => {
      expect(publicPostMock).toHaveBeenCalledTimes(1);
    });
    expect(callsTo()[0]!.data["queryIndex"]).toBe(0);
    expect(await screen.findByText("7")).toBeInTheDocument();
    expect(signedInPostMock).not.toHaveBeenCalled();
  });
});

describe("a public dashboard's PromQL table", () => {
  test("asks for its rows, and draws the ones it is sent", async () => {
    publicPostMock.mockResolvedValue(
      answer({
        resultKind: DataSourceResultKind.Table,
        result: {
          columns: [
            { key: "pod", title: "pod", type: DataSourceTableColumnType.Text },
            {
              key: "value",
              title: "value",
              type: DataSourceTableColumnType.Number,
            },
          ],
          rows: [
            { pod: "api-1", value: 3 },
            { pod: "api-2", value: 2 },
          ],
          truncated: false,
        },
      }),
    );

    const args: DashboardDataSourceTableComponent["arguments"] = {
      tableTitle: "Pods",
      maxRows: 2,
      query: {
        dataSourceId: "oneuptime-metrics",
      } as unknown as DashboardDataSourceTableComponent["arguments"]["query"],
    };

    render(
      <DashboardDataSourceTableComponentElement
        {...baseProps()}
        component={{
          _type: ObjectType.DashboardComponent,
          componentId: COMPONENT_ID,
          componentType: DashboardComponentType.DataSourceTable,
          topInDashboardUnits: 0,
          leftInDashboardUnits: 0,
          widthInDashboardUnits: 8,
          heightInDashboardUnits: 6,
          minWidthInDashboardUnits: 4,
          minHeightInDashboardUnits: 3,
          arguments: args,
        }}
      />,
    );

    expect(await screen.findByText("api-1")).toBeInTheDocument();
    expect(screen.getByText("api-2")).toBeInTheDocument();
    expect(callsTo()[0]!.data["componentId"]).toBe(COMPONENT_ID.toString());
    expect(JSON.stringify(callsTo())).not.toContain('query":');
    expect(signedInPostMock).not.toHaveBeenCalled();
  });
});
