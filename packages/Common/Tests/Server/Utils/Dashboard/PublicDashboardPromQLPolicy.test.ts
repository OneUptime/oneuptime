import { describe, expect, test } from "@jest/globals";
import PublicDashboardPromQLPolicy, {
  PUBLIC_DASHBOARD_PROMQL_QUERY_NOT_FOUND_MESSAGE,
  PUBLIC_DASHBOARD_PROMQL_TOO_LONG_MESSAGE,
  PUBLIC_DASHBOARD_PROMQL_WIDGET_NOT_FOUND_MESSAGE,
  PUBLIC_DASHBOARD_PROMQL_WINDOW_MESSAGE,
  PublicDashboardPromQLPlan,
  getVariableValueKeptSavedMessage,
  getVariableValueNotOfferedMessage,
} from "../../../../Server/Utils/Dashboard/PublicDashboardPromQLPolicy";
import PublicDashboardViewConfig, {
  DrawnDataSourceWidget,
} from "../../../../Server/Utils/Dashboard/PublicDashboardViewConfig";
import { ProjectMetricsQueryAnswer } from "../../../../Server/Utils/PromQL/PromQLDataSourceQuery";
import AggregatedModel from "../../../../Types/BaseDatabase/AggregatedModel";
import DashboardComponentType from "../../../../Types/Dashboard/DashboardComponentType";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../../Types/Dashboard/DashboardViewConfig";
import { DataSourceResultKind } from "../../../../Types/DataSource/DataSourceQueryConfig";
import { DataSourceTableColumnType } from "../../../../Types/DataSource/DataSourceTableResult";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";

/*
 * What a public dashboard's PromQL widget may run for a visitor nobody
 * signed in (issue #10226), tried as an attacker would: a query of their
 * own, a widget of another dashboard, a variable outside what it offers, a
 * value that tries to leave its string, and an answer that would say more
 * than the widget draws.
 */

const CHART_ID: string = "ab000000-0000-4000-8000-0000000000c1";
const VALUE_ID: string = "ab000000-0000-4000-8000-0000000000c2";
const TABLE_ID: string = "ab000000-0000-4000-8000-0000000000c3";
const OTHER_DASHBOARD_WIDGET_ID: string =
  "ab000000-0000-4000-8000-0000000000f9";

const STORED_QUERY: string =
  'sum by (pod) (rate(http_requests_total{job="{{job}}", env=~"{{env}}"}[{{range}}]))';

const WINDOW: JSONObject = {
  startDate: "2026-11-20T08:00:00.000Z",
  endDate: "2026-11-20T09:00:00.000Z",
};

const variable: (data: Partial<DashboardVariable>) => DashboardVariable = (
  data: Partial<DashboardVariable>,
): DashboardVariable => {
  return {
    id: `id-${data.name}`,
    name: "x",
    type: DashboardVariableType.TextInput,
    ...data,
  } as DashboardVariable;
};

// The dashboard's toolbar: a list, a text box, a telemetry attribute.
const VARIABLES: Array<DashboardVariable> = [
  variable({
    name: "range",
    type: DashboardVariableType.CustomList,
    customListValues: "1m, 5m,15m",
    selectedValue: "5m",
  }),
  variable({
    name: "job",
    type: DashboardVariableType.TextInput,
    defaultValue: "api",
  }),
  variable({
    name: "env",
    type: DashboardVariableType.TelemetryAttribute,
    attributeKey: "deployment.environment",
    isMultiSelect: true,
    selectedValues: ["prod"],
  }),
];

const config: (components: Array<JSONObject>) => DashboardViewConfig = (
  components: Array<JSONObject>,
): DashboardViewConfig => {
  return {
    _type: "DashboardViewConfig",
    heightInDashboardUnits: 24,
    components: components.map((component: JSONObject, index: number) => {
      return {
        _type: "DashboardComponent",
        topInDashboardUnits: index,
        leftInDashboardUnits: 0,
        widthInDashboardUnits: 6,
        heightInDashboardUnits: 4,
        ...component,
      };
    }),
  } as unknown as DashboardViewConfig;
};

const STORED: DashboardViewConfig = config([
  {
    componentId: CHART_ID,
    componentType: DashboardComponentType.DataSourceChart,
    arguments: {
      chartTitle: "Requests",
      queries: [
        {
          id: "q1",
          dataSourceId: "oneuptime-metrics",
          query: STORED_QUERY,
          legend: "{{pod}}",
        },
        { id: "q2", dataSourceId: "oneuptime-metrics", query: "sum(up)" },
      ],
    },
  },
  {
    componentId: VALUE_ID,
    componentType: DashboardComponentType.DataSourceValue,
    arguments: {
      title: "Up",
      query: { dataSourceId: "oneuptime-metrics", query: "up" },
    },
  },
  {
    componentId: TABLE_ID,
    componentType: DashboardComponentType.DataSourceTable,
    arguments: {
      tableTitle: "Pods",
      maxRows: 2,
      sort: "pod:asc",
      query: { dataSourceId: "oneuptime-metrics", query: "up" },
    },
  },
]);

const WIDGETS: Array<DrawnDataSourceWidget> =
  PublicDashboardViewConfig.getDrawnDataSourceWidgets(STORED);

type PlanFunction = (body: JSONObject) => PublicDashboardPromQLPlan;

const plan: PlanFunction = (body: JSONObject): PublicDashboardPromQLPlan => {
  return PublicDashboardPromQLPolicy.plan({
    widgets: WIDGETS,
    variables: VARIABLES,
    body: { ...WINDOW, ...body },
  });
};

// The visitor's pick of one variable, as the page sends picks.
const pick: (
  name: string,
  selection: { selectedValue?: unknown; selectedValues?: unknown },
) => JSONObject = (
  name: string,
  selection: { selectedValue?: unknown; selectedValues?: unknown },
): JSONObject => {
  return { id: `id-${name}`, ...selection } as JSONObject;
};

const refusal: (run: () => unknown) => string = (
  run: () => unknown,
): string => {
  try {
    run();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("Expected a refusal.");
};

describe("which query runs", () => {
  test("the one stored in the widget the page names, at its place, its variables at their saved values", () => {
    const result: PublicDashboardPromQLPlan = plan({ componentId: CHART_ID });

    expect(result.queryIndex).toBe(0);
    expect(result.resultKind).toBe(DataSourceResultKind.TimeSeries);
    expect(result.queryText).toBe(
      'sum by (pod) (rate(http_requests_total{job="api", env=~"prod"}[5m]))',
    );
    expect(result.startDate.toISOString()).toBe(WINDOW["startDate"]);
    expect(result.endDate.toISOString()).toBe(WINDOW["endDate"]);

    expect(plan({ componentId: CHART_ID, queryIndex: 1 }).queryText).toBe(
      "sum(up)",
    );
    expect(plan({ componentId: TABLE_ID }).resultKind).toBe(
      DataSourceResultKind.Table,
    );
  });

  test("a query, a PromQL text, a data source or a label filter in the request is never read", () => {
    const result: PublicDashboardPromQLPlan = plan({
      componentId: VALUE_ID,
      query: 'secret_metric{token=~".+"}',
      promQL: "secret_metric",
      queryText: "secret_metric",
      dataSourceId: "ab000000-0000-4000-8000-0000000000d1",
      resultKind: DataSourceResultKind.Table,
      stepInSeconds: 1,
      attributes: { token: "x" },
      filter: { token: "x" },
    });

    expect(result.queryText).toBe("up");
    expect(result.resultKind).toBe(DataSourceResultKind.TimeSeries);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  test("a widget of another dashboard, or no widget, is refused", () => {
    for (const componentId of [
      OTHER_DASHBOARD_WIDGET_ID,
      undefined,
      null,
      "",
      7,
      [CHART_ID],
      { componentId: CHART_ID },
      `${CHART_ID} `,
      CHART_ID.toUpperCase(),
      "x".repeat(300),
    ]) {
      expect([
        componentId,
        refusal(() => {
          return plan({ componentId: componentId as JSONObject[string] });
        }),
      ]).toEqual([
        componentId,
        PUBLIC_DASHBOARD_PROMQL_WIDGET_NOT_FOUND_MESSAGE,
      ]);
    }
  });

  test("a query the widget does not have is refused", () => {
    for (const queryIndex of [2, -1, 0.5, "0", "1", Number.NaN, {}, [0]]) {
      expect([
        queryIndex,
        refusal(() => {
          return plan({
            componentId: CHART_ID,
            queryIndex: queryIndex as JSONObject[string],
          });
        }),
      ]).toEqual([queryIndex, PUBLIC_DASHBOARD_PROMQL_QUERY_NOT_FOUND_MESSAGE]);
    }

    expect(
      refusal(() => {
        return plan({ componentId: VALUE_ID, queryIndex: 1 });
      }),
    ).toBe(PUBLIC_DASHBOARD_PROMQL_QUERY_NOT_FOUND_MESSAGE);
  });

  test("a window that is not two dates in order is refused", () => {
    for (const window of [
      { startDate: WINDOW["endDate"], endDate: WINDOW["startDate"] },
      { startDate: WINDOW["startDate"], endDate: WINDOW["startDate"] },
      { startDate: "yesterday", endDate: WINDOW["endDate"] },
      { startDate: 0, endDate: Date.now() },
      { startDate: undefined, endDate: WINDOW["endDate"] },
      { startDate: `${WINDOW["startDate"]}${" ".repeat(80)}`, endDate: "x" },
    ]) {
      expect(
        refusal(() => {
          return PublicDashboardPromQLPolicy.plan({
            widgets: WIDGETS,
            variables: VARIABLES,
            body: { componentId: CHART_ID, ...window } as JSONObject,
          });
        }),
      ).toBe(PUBLIC_DASHBOARD_PROMQL_WINDOW_MESSAGE);
    }
  });

  test("a stored query longer than the authenticated route runs is refused", () => {
    const long: DashboardViewConfig = config([
      {
        componentId: VALUE_ID,
        componentType: DashboardComponentType.DataSourceValue,
        arguments: {
          query: {
            dataSourceId: "oneuptime-metrics",
            query: `up${" ".repeat(100_001)}`,
          },
        },
      },
    ]);

    expect(
      refusal(() => {
        return PublicDashboardPromQLPolicy.plan({
          widgets: PublicDashboardViewConfig.getDrawnDataSourceWidgets(long),
          variables: [],
          body: { componentId: VALUE_ID, ...WINDOW },
        });
      }),
    ).toBe(PUBLIC_DASHBOARD_PROMQL_TOO_LONG_MESSAGE);
  });
});

describe("a visitor's pick of a variable is held to what its definition allows", () => {
  test("a list takes one of its values, filled in as written", () => {
    expect(
      plan({
        componentId: CHART_ID,
        variables: [pick("range", { selectedValue: "15m" })],
      }).queryText,
    ).toContain("[15m]");
  });

  test("a list refuses a value it does not offer, wherever the query reads it", () => {
    for (const value of ["1h", "5m]) or vector(1) or sum(x[5m", "5M", " 5m"]) {
      expect([
        value,
        refusal(() => {
          return plan({
            componentId: CHART_ID,
            variables: [pick("range", { selectedValue: value })],
          });
        }),
      ]).toEqual([value, getVariableValueNotOfferedMessage("range")]);
    }
  });

  test("a value is never one that holds a line break or another variable's token", () => {
    for (const value of ["a\nb", "a\rb", "a\u0000b", "{{range}}", "a}}b"]) {
      expect([
        value,
        refusal(() => {
          return plan({
            componentId: CHART_ID,
            variables: [pick("job", { selectedValue: value })],
          });
        }),
      ]).toEqual([value, getVariableValueNotOfferedMessage("job")]);
    }
  });

  test("a text box read only in a matcher takes any value, kept inside the string", () => {
    const result: PublicDashboardPromQLPlan = plan({
      componentId: CHART_ID,
      variables: [pick("job", { selectedValue: 'x"} or vector(1) or up{a="' })],
    });

    expect(result.queryText).toBe(
      'sum by (pod) (rate(http_requests_total{job="x\\"} or vector(1) or up{a=\\"", env=~"prod"}[5m]))',
    );
  });

  test("a multi-select telemetry attribute read in a matcher takes any values, and none for All", () => {
    expect(
      plan({
        componentId: CHART_ID,
        variables: [pick("env", { selectedValues: ["prod", "staging.eu"] })],
      }).queryText,
    ).toContain('env=~"(prod|staging\\\\.eu)"');

    expect(
      plan({
        componentId: CHART_ID,
        variables: [pick("env", { selectedValues: [] })],
      }).queryText,
    ).toContain('env=~".*"');
  });

  test("a text box or telemetry attribute read outside a matcher keeps its saved value", () => {
    const outsideQuery: DashboardViewConfig = config([
      {
        componentId: VALUE_ID,
        componentType: DashboardComponentType.DataSourceValue,
        arguments: {
          query: {
            dataSourceId: "oneuptime-metrics",
            query:
              'topk({{count}}, rate({{metric}}[5m])) + 0 * label_replace(up, "a", "{{job}}", "b", "(.*)")',
          },
        },
      },
    ]);
    const variables: Array<DashboardVariable> = [
      variable({ name: "count", defaultValue: "5" }),
      variable({
        name: "metric",
        type: DashboardVariableType.TelemetryAttribute,
        attributeKey: "metric",
        selectedValue: "http_requests_total",
      }),
      variable({ name: "job", defaultValue: "api" }),
    ];

    const run: (picks: Array<JSONObject>) => PublicDashboardPromQLPlan = (
      picks: Array<JSONObject>,
    ): PublicDashboardPromQLPlan => {
      return PublicDashboardPromQLPolicy.plan({
        widgets:
          PublicDashboardViewConfig.getDrawnDataSourceWidgets(outsideQuery),
        variables,
        body: { componentId: VALUE_ID, ...WINDOW, variables: picks },
      });
    };

    // As saved, it runs.
    expect(run([]).queryText).toBe(
      'topk(5, rate(http_requests_total[5m])) + 0 * label_replace(up, "a", "api", "b", "(.*)")',
    );
    expect(run([pick("count", { selectedValue: "5" })]).queryText).toContain(
      "topk(5,",
    );

    for (const [name, value] of [
      ["count", "5, up) or vector(1"],
      ["count", "6"],
      ["metric", "secret_metric_total"],
      ["job", 'x") or vector(1) or label_replace(up, "a", "'],
    ]) {
      expect([
        name,
        value,
        refusal(() => {
          return run([pick(name!, { selectedValue: value })]);
        }),
      ]).toEqual([name, value, getVariableValueKeptSavedMessage(name!)]);
    }
  });

  test("a project label variable takes one of its labels", () => {
    const labels: DashboardVariable = variable({
      name: "team",
      type: DashboardVariableType.ProjectLabel,
      labelOptions: [{ label: "Payments", value: "label-1" }],
    });
    const withLabels: DashboardViewConfig = config([
      {
        componentId: VALUE_ID,
        componentType: DashboardComponentType.DataSourceValue,
        arguments: {
          query: {
            dataSourceId: "oneuptime-metrics",
            query: 'up{team="{{team}}"}',
          },
        },
      },
    ]);

    const run: (value: string) => PublicDashboardPromQLPlan = (
      value: string,
    ): PublicDashboardPromQLPlan => {
      return PublicDashboardPromQLPolicy.plan({
        widgets:
          PublicDashboardViewConfig.getDrawnDataSourceWidgets(withLabels),
        variables: [labels],
        body: {
          componentId: VALUE_ID,
          ...WINDOW,
          variables: [pick("team", { selectedValue: value })],
        },
      });
    };

    expect(run("label-1").queryText).toBe('up{team="label-1"}');
    expect(
      refusal(() => {
        return run("label-2");
      }),
    ).toBe(getVariableValueNotOfferedMessage("team"));
  });

  test("a pick under an id the toolbar does not draw is not read, and the variable keeps its saved value", () => {
    expect(
      plan({
        componentId: CHART_ID,
        variables: [
          { id: "not-a-variable", selectedValue: "1h" },
          { id: "id-unknown", selectedValue: "secret" },
        ],
      }).queryText,
    ).toBe(
      'sum by (pod) (rate(http_requests_total{job="api", env=~"prod"}[5m]))',
    );
  });

  test("picks are bounded as every public route bounds them", () => {
    expect(
      refusal(() => {
        return plan({
          componentId: CHART_ID,
          variables: Array.from({ length: 51 }).map(
            (_item: unknown, index: number): JSONObject => {
              return { id: `v-${index}`, selectedValue: "a" };
            },
          ),
        });
      }),
    ).toBe("Too many public dashboard variable selections.");

    expect(
      refusal(() => {
        return plan({
          componentId: CHART_ID,
          variables: [pick("job", { selectedValue: "a".repeat(1025) })],
        });
      }),
    ).toBe("Public dashboard variable selection has an invalid value.");

    expect(
      refusal(() => {
        return plan({ componentId: CHART_ID, variables: { id: "x" } });
      }),
    ).toBe("Public dashboard variable selections must be an array.");
  });
});

describe("the answer holds only what the widget draws", () => {
  const points: Array<AggregatedModel> = [
    {
      timestamp: new Date("2026-11-20T08:30:00.000Z"),
      value: 5,
      attributes: { pod: "api-1", node: "secret-node-a", token: "secret" },
    } as unknown as AggregatedModel,
    {
      timestamp: new Date("2026-11-20T08:30:00.000Z"),
      value: 2,
      attributes: { pod: "api-2", node: "secret-node-b", token: "secret" },
    } as unknown as AggregatedModel,
  ];

  const timeSeries: ProjectMetricsQueryAnswer = {
    resultKind: DataSourceResultKind.TimeSeries,
    result: { data: points, truncated: false },
  };

  test("a chart named by a legend template is sent only the labels the template names", () => {
    const shaped: ProjectMetricsQueryAnswer =
      PublicDashboardPromQLPolicy.shapeAnswer({
        plan: plan({ componentId: CHART_ID }),
        answer: timeSeries,
        requestedSort: undefined,
      });

    expect(shaped.result).toEqual({
      data: [
        {
          timestamp: points[0]!.timestamp,
          value: 5,
          attributes: { pod: "api-1" },
        },
        {
          timestamp: points[1]!.timestamp,
          value: 2,
          attributes: { pod: "api-2" },
        },
      ],
      truncated: false,
    });
    expect(JSON.stringify(shaped)).not.toContain("secret");
  });

  test("a chart named by its labels is sent every label it names its series by", () => {
    const shaped: ProjectMetricsQueryAnswer =
      PublicDashboardPromQLPolicy.shapeAnswer({
        plan: plan({ componentId: CHART_ID, queryIndex: 1 }),
        answer: timeSeries,
        requestedSort: undefined,
      });

    expect(shaped.result).toEqual(timeSeries.result);
  });

  test("a value or a gauge, which draws one number, is sent no labels at all", () => {
    const shaped: ProjectMetricsQueryAnswer =
      PublicDashboardPromQLPolicy.shapeAnswer({
        plan: plan({ componentId: VALUE_ID }),
        answer: timeSeries,
        requestedSort: undefined,
      });

    expect(shaped.result).toEqual({
      data: [
        { timestamp: points[0]!.timestamp, value: 5 },
        { timestamp: points[1]!.timestamp, value: 2 },
      ],
      truncated: false,
    });
  });

  test("a table is sent its rows in the order it draws them, as many as its Max Rows draws", () => {
    const table: ProjectMetricsQueryAnswer = {
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
          { pod: "c", value: 1 },
          { pod: "a", value: 3 },
          { pod: "b", value: 2 },
        ],
        truncated: false,
      },
    };

    const shapedBy: (requestedSort: unknown) => unknown = (
      requestedSort: unknown,
    ): unknown => {
      return PublicDashboardPromQLPolicy.shapeAnswer({
        plan: plan({ componentId: TABLE_ID }),
        answer: table,
        requestedSort,
      }).result;
    };

    // The visitor's sort, by one of the answer's columns.
    expect(shapedBy("value:desc")).toEqual({
      ...table.result,
      rows: [
        { pod: "a", value: 3 },
        { pod: "b", value: 2 },
      ],
    });

    // A column the answer does not have: the widget's own sort.
    for (const requestedSort of ["secret:desc", "pod", 7, undefined]) {
      expect([requestedSort, shapedBy(requestedSort)]).toEqual([
        requestedSort,
        {
          ...table.result,
          rows: [
            { pod: "a", value: 3 },
            { pod: "b", value: 2 },
          ],
        },
      ]);
    }
  });
});
