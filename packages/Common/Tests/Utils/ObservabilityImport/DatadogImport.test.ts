import { describe, expect, test } from "@jest/globals";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { DashboardVariableType } from "../../../Types/Dashboard/DashboardVariable";
import DataSourceQueryConfig from "../../../Types/DataSource/DataSourceQueryConfig";
import { PROJECT_METRICS_DATA_SOURCE_ID } from "../../../Types/DataSource/ProjectMetricsDataSource";
import {
  ConvertedQuery,
  DashboardImportItem,
  DashboardImportPlan,
  ImportItemStatus,
  ImportNote,
  ImportNoteKind,
  ImportQueryLanguage,
  ImportSourceKind,
} from "../../../Types/ObservabilityImport/ObservabilityImport";
import GridLayoutUtil from "../../../Utils/Dashboard/GridLayout";
import {
  DATADOG_AS_COUNT_ON_GAUGE,
  DATADOG_AS_RATE,
  DATADOG_CONVERTED_BY_AI,
  DATADOG_DIFF,
  DATADOG_FILL_LEFT_OUT,
  DATADOG_FUNCTION_NOT_CONVERTED,
  DATADOG_GROUPS_DO_NOT_MATCH,
  DATADOG_PERCENTILE_NOT_CONVERTED,
  DATADOG_QUERY_UNREADABLE,
  DATADOG_RATE_FUNCTION,
  DATADOG_READ_AS_COUNT,
  DATADOG_READ_AS_GAUGE,
  DATADOG_SCOPE_NOT_CONVERTED,
  DATADOG_TOP_PER_STEP,
  DATADOG_UNKNOWN_QUERY_NAME,
  DATADOG_VARIABLE_WITHOUT_PREFIX,
  DatadogConversionOptions,
  DatadogMetricKind,
  DatadogQueryContext,
  convertDatadogQuery,
  mergeDatadogNotes,
  readDatadogMetricNames,
} from "../../../Utils/ObservabilityImport/Datadog/DatadogPromQL";
import {
  DatadogExpression,
  DatadogExpressionKind,
  DatadogQueryError,
  DatadogScopeKind,
  parseDatadogExpression,
  parseDatadogMonitorQuery,
} from "../../../Utils/ObservabilityImport/Datadog/DatadogQueryParser";
import {
  VARIABLE_WITHOUT_PREFIX,
  WIDGET_CONDITIONAL_FORMATS,
  WIDGET_READS_OTHER_DATA,
  WIDGET_TYPE_NOT_SUPPORTED,
} from "../../../Utils/ObservabilityImport/Datadog/DatadogDashboard";
import {
  DASHBOARD_SOURCE_KINDS,
  readImportSource,
} from "../../../Utils/ObservabilityImport/ImportSource";
import {
  listDatadogMetricNames,
  planDashboardImport,
} from "../../../Utils/ObservabilityImport/ObservabilityImport";
import { parsePromQL } from "../../../Utils/PromQL/PromQLParser";
import { readFixture } from "./ImportFixtures";

/*
 * A Datadog query, dashboard and its variables, as OneUptime reads what the
 * Datadog Agent sent it (issue #7697): parsed strictly, converted only where
 * the PromQL reads the same, and said where it does not.
 */

const DASHBOARD: DatadogConversionOptions = {
  context: DatadogQueryContext.Dashboard,
  variablePrefixes: new Map<string, string>([
    ["host", "host"],
    ["env", "env"],
    ["scope", ""],
  ]),
  knownMetricKinds: new Map<string, DatadogMetricKind>([
    ["system.cpu.user", DatadogMetricKind.Gauge],
    ["system.cpu.idle", DatadogMetricKind.Gauge],
    ["nginx.requests", DatadogMetricKind.Count],
  ]),
};

const MONITOR: DatadogConversionOptions = {
  ...DASHBOARD,
  context: DatadogQueryContext.Monitor,
  monitorTimeAggregation: "avg",
};

const convert: (
  query: string,
  options?: DatadogConversionOptions,
) => ConvertedQuery = (
  query: string,
  options?: DatadogConversionOptions,
): ConvertedQuery => {
  return convertDatadogQuery({ query, options: options || DASHBOARD });
};

const texts: (notes: ReadonlyArray<ImportNote>) => Array<string> = (
  notes: ReadonlyArray<ImportNote>,
): Array<string> => {
  return notes.map((note: ImportNote): string => {
    return note.text;
  });
};

describe("reading Datadog's query language", () => {
  test("a query's aggregator, metric, tags, groups and methods", () => {
    const expression: DatadogExpression = parseDatadogExpression(
      "sum:a.b{host:x,env:y} by {host}.as_count().rollup(sum, 60)",
    );

    expect(expression).toEqual({
      kind: DatadogExpressionKind.Query,
      aggregator: "sum",
      metric: "a.b",
      scope: {
        kind: DatadogScopeKind.And,
        terms: [
          { kind: DatadogScopeKind.Tag, key: "host", value: "x" },
          { kind: DatadogScopeKind.Tag, key: "env", value: "y" },
        ],
      },
      groupBy: ["host"],
      methods: [
        { name: "as_count", args: [] },
        { name: "rollup", args: ["sum", "60"] },
      ],
    });
  });

  test("a formula of queries, numbers and functions, with keyword arguments", () => {
    const formula: DatadogExpression = parseDatadogExpression(
      "100 * (query1 / query2)",
    );

    expect(formula.kind).toBe(DatadogExpressionKind.Binary);

    const anomalies: DatadogExpression = parseDatadogExpression(
      "anomalies(avg:system.cpu.user{*}, 'agile', 2, direction='above')",
    );

    expect(anomalies.kind).toBe(DatadogExpressionKind.Call);
  });

  test("what is no query is an error saying where, never a guess", () => {
    for (const text of ["", "avg:", "avg:a.b{host:x", "sum:a{*} by", "((a"]) {
      expect(() => {
        parseDatadogExpression(text);
      }).toThrow(DatadogQueryError);
    }

    expect(() => {
      parseDatadogExpression(`avg:a{*} + ${"avg:a{*} + ".repeat(3000)}1`);
    }).toThrow("too long");
  });

  test("a monitor's query: its time aggregation, window, comparison and threshold", () => {
    expect(
      parseDatadogMonitorQuery(
        "avg(last_5m):avg:system.cpu.user{env:prod} by {host} > 90",
      ),
    ).toEqual({
      timeAggregation: "avg",
      window: "last_5m",
      expression: "avg:system.cpu.user{env:prod} by {host}",
      comparison: ">",
      threshold: 90,
    });

    expect(
      parseDatadogMonitorQuery("sum(last_1h):sum:x{*}.as_count() >= 1e3")
        .threshold,
    ).toBe(1000);

    expect(() => {
      parseDatadogMonitorQuery("avg:system.cpu.user{*} > 90");
    }).toThrow(DatadogQueryError);
    expect(() => {
      parseDatadogMonitorQuery("avg(last_5m):avg:system.cpu.user{*}");
    }).toThrow(DatadogQueryError);
  });

  test("the metrics a query reads, for the preview to look up", () => {
    expect(
      readDatadogMetricNames(
        "100 * sum:nginx.errors{*} / sum:nginx.requests{*}",
      ).sort(),
    ).toEqual(["nginx.errors", "nginx.requests"]);
    expect(readDatadogMetricNames("not a query")).toEqual([]);
  });
});

describe("a Datadog query as PromQL", () => {
  test.each([
    [
      "avg:system.cpu.user{*}",
      "avg (avg_over_time(system_cpu_user[$__interval]))",
    ],
    [
      "avg:system.cpu.user{host:web-*,!env:dev} by {host}",
      'avg by (host) (avg_over_time(system_cpu_user{host=~"web-.*",env!="dev"}[$__interval]))',
    ],
    [
      "avg:system.cpu.user{host:$host.value}",
      'avg (avg_over_time(system_cpu_user{host="{{host}}"}[$__interval]))',
    ],
    [
      "sum:nginx.requests{*}",
      "sum (sum_over_time(nginx_requests[$__interval]))",
    ],
    [
      "sum:nginx.requests{*}.as_count()",
      "sum (sum_over_time(nginx_requests[$__interval]))",
    ],
    [
      "sum:nginx.requests{*}.as_rate()",
      "sum (sum_over_time(nginx_requests[$__interval]) / ($__interval_ms / 1000))",
    ],
    [
      "avg:system.cpu.user{*}.as_rate()",
      "avg (avg_over_time(system_cpu_user[$__interval]))",
    ],
    [
      "avg:system.cpu.user{*}.rollup(max, 300)",
      "avg (max_over_time(system_cpu_user[300s]))",
    ],
    [
      "timeshift(avg:system.cpu.user{*}, -3600)",
      "avg (avg_over_time(system_cpu_user[$__interval] offset 3600s))",
    ],
    [
      "week_before(avg:system.cpu.user{*})",
      "avg (avg_over_time(system_cpu_user[$__interval] offset 7d))",
    ],
    [
      "abs(avg:system.cpu.user{*}) * 100",
      "(abs(avg (avg_over_time(system_cpu_user[$__interval])))) * (100)",
    ],
  ])("%s reads exactly the same", (query: string, promQL: string) => {
    const converted: ConvertedQuery = convert(query);

    expect(converted.status).toBe(ImportItemStatus.Exact);
    expect(converted.promQL).toBe(promQL);
    expect(converted.notes).toEqual([]);
  });

  test("a monitor reads each minute with the function it reduces its window with", () => {
    expect(convert("avg:system.cpu.user{*}", MONITOR).promQL).toBe(
      "avg (avg_over_time(system_cpu_user[1m]))",
    );
    expect(
      convert("max:system.cpu.user{*}", {
        ...MONITOR,
        monitorTimeAggregation: "max",
      }).promQL,
    ).toBe("max (max_over_time(system_cpu_user[1m]))");
    expect(convert("sum:nginx.requests{*}.as_rate()", MONITOR).promQL).toBe(
      "sum (sum_over_time(nginx_requests[1m]) / 60)",
    );
  });

  test("a metric the project has no data for yet is read as a gauge, and said, one note for all of them", () => {
    const converted: ConvertedQuery = convert(
      "avg:system.load.1{*} + avg:system.load.5{*}",
    );

    expect(converted.status).toBe(ImportItemStatus.Approximate);
    expect(converted.notes).toEqual([
      {
        kind: ImportNoteKind.Approximation,
        text: DATADOG_READ_AS_GAUGE,
        values: { metrics: "system.load.1, system.load.5" },
      },
    ]);
  });

  test(".as_count() on a metric with no data yet reads it as a count, and says so", () => {
    const converted: ConvertedQuery = convert(
      "sum:nginx.net.conn_dropped_per_s{*}.as_count()",
    );

    expect(converted.status).toBe(ImportItemStatus.Approximate);
    expect(converted.promQL).toBe(
      "sum (sum_over_time(nginx_net_conn_dropped_per_s[$__interval]))",
    );
    expect(texts(converted.notes)).toEqual([DATADOG_READ_AS_COUNT]);
  });

  test(".as_count() on what the project has as a gauge leaves it a gauge, as Datadog does, and says what a DogStatsD count reads", () => {
    const converted: ConvertedQuery = convert(
      "sum:system.cpu.user{*}.as_count()",
    );

    expect(converted.status).toBe(ImportItemStatus.Approximate);
    expect(converted.promQL).toBe(
      "sum (avg_over_time(system_cpu_user[$__interval]))",
    );
    expect(texts(converted.notes)).toEqual([DATADOG_AS_COUNT_ON_GAUGE]);
  });

  test(".as_rate() on a metric with no data yet is read per second, and said", () => {
    expect(texts(convert("sum:x.y{*}.as_rate()").notes)).toEqual([
      DATADOG_AS_RATE,
    ]);
  });

  test("per_minute() reads a count per second, multiplied out", () => {
    const converted: ConvertedQuery = convert(
      "per_minute(sum:nginx.requests{*})",
    );

    expect(converted.promQL).toBe(
      "60 * (sum (sum_over_time(nginx_requests[$__interval]) / ($__interval_ms / 1000)))",
    );
    expect(texts(converted.notes)).toEqual([DATADOG_RATE_FUNCTION]);
  });

  test("approximations are said: .fill(), top() at each point, diff()", () => {
    expect(texts(convert("avg:system.cpu.user{*}.fill(zero)").notes)).toEqual([
      DATADOG_FILL_LEFT_OUT,
    ]);

    const top: ConvertedQuery = convert(
      "top(avg:system.cpu.user{*} by {host}, 10, 'mean', 'desc')",
    );

    expect(top.promQL).toBe(
      "topk(10, avg by (host) (avg_over_time(system_cpu_user[$__interval])))",
    );
    expect(texts(top.notes)).toEqual([DATADOG_TOP_PER_STEP]);

    const diff: ConvertedQuery = convert("diff(avg:system.cpu.user{*})");

    expect(diff.promQL).toBe(
      "(avg (avg_over_time(system_cpu_user[$__interval]))) - (avg (avg_over_time(system_cpu_user[$__interval] offset $__interval)))",
    );
    expect(texts(diff.notes)).toEqual([DATADOG_DIFF]);
  });

  test("tags: IN and OR on one tag are a regex; a variable without a prefix reads everything, as Datadog does on *", () => {
    expect(convert("avg:system.cpu.user{env IN (prod, staging)}").promQL).toBe(
      'avg (avg_over_time(system_cpu_user{env=~"prod|staging"}[$__interval]))',
    );
    expect(convert("avg:system.cpu.user{env:prod OR env:staging}").promQL).toBe(
      'avg (avg_over_time(system_cpu_user{env=~"prod|staging"}[$__interval]))',
    );

    const scoped: ConvertedQuery = convert("avg:system.cpu.user{$scope}");

    expect(scoped.status).toBe(ImportItemStatus.Exact);
    expect(scoped.promQL).toBe(
      "avg (avg_over_time(system_cpu_user[$__interval]))",
    );
    expect(texts(scoped.notes)).toEqual([DATADOG_VARIABLE_WITHOUT_PREFIX]);
  });

  test("series grouped alike match one to one; one ungrouped side is shared; others are not matched up", () => {
    expect(
      convert(
        "avg:system.cpu.user{*} by {host} / avg:system.cpu.idle{*} by {host}",
      ).promQL,
    ).toBe(
      "(avg by (host) (avg_over_time(system_cpu_user[$__interval]))) / (avg by (host) (avg_over_time(system_cpu_idle[$__interval])))",
    );
    expect(
      convert("avg:system.cpu.user{*} by {host} / avg:system.cpu.idle{*}")
        .promQL,
    ).toBe(
      "(avg by (host) (avg_over_time(system_cpu_user[$__interval]))) / scalar(avg (avg_over_time(system_cpu_idle[$__interval])))",
    );

    const unmatched: ConvertedQuery = convert(
      "avg:system.cpu.user{*} by {host} / avg:system.cpu.idle{*} by {env}",
    );

    expect(unmatched.status).toBe(ImportItemStatus.NotConverted);
    expect(texts(unmatched.notes)).toEqual([DATADOG_GROUPS_DO_NOT_MATCH]);
  });

  test("what PromQL cannot say is not converted, and offered to OneUptime AI", () => {
    for (const [query, reason] of [
      ["avg:system.cpu.user{env:prod OR host:a}", DATADOG_SCOPE_NOT_CONVERTED],
      ["cumsum(avg:system.cpu.user{*})", DATADOG_FUNCTION_NOT_CONVERTED],
      ["not a query", DATADOG_QUERY_UNREADABLE],
    ] as Array<[string, string]>) {
      const converted: ConvertedQuery = convert(query);

      expect(converted.status).toBe(ImportItemStatus.NotConverted);
      expect(texts(converted.notes)).toEqual([reason]);
      expect(converted.aiCandidate).toEqual({
        language: ImportQueryLanguage.Datadog,
        query,
        variableNames: ["host", "env", "scope"],
        isForMonitor: false,
      });
    }
  });

  test("Datadog's models and a distribution's percentiles are not converted, and not offered to AI: it could only guess", () => {
    for (const [query, reason] of [
      [
        "anomalies(avg:system.cpu.user{*}, 'basic', 2)",
        DATADOG_FUNCTION_NOT_CONVERTED,
      ],
      [
        "forecast(avg:system.cpu.user{*}, 'linear', 1)",
        DATADOG_FUNCTION_NOT_CONVERTED,
      ],
      [
        "outliers(avg:system.cpu.user{*} by {host}, 'DBSCAN', 2)",
        DATADOG_FUNCTION_NOT_CONVERTED,
      ],
      ["p99:trace.http.request.duration{*}", DATADOG_PERCENTILE_NOT_CONVERTED],
    ] as Array<[string, string]>) {
      const converted: ConvertedQuery = convert(query);

      expect(converted.status).toBe(ImportItemStatus.NotConverted);
      expect(texts(converted.notes)).toEqual([reason]);
      expect(converted.aiCandidate).toBeUndefined();
    }
  });

  test("OneUptime AI's answer is checked as any query is, and said", () => {
    const answered: ConvertedQuery = convertDatadogQuery({
      query: "cumsum(avg:system.cpu.user{*})",
      options: DASHBOARD,
      aiQuery: "sum_over_time(avg(system_cpu_user)[1h:1m])",
    });

    expect(answered.status).toBe(ImportItemStatus.Approximate);
    expect(texts(answered.notes)).toEqual([DATADOG_CONVERTED_BY_AI]);

    const refused: ConvertedQuery = convertDatadogQuery({
      query: "cumsum(avg:system.cpu.user{*})",
      options: DASHBOARD,
      aiQuery: "sum(rate(x[5m]",
    });

    expect(refused.status).toBe(ImportItemStatus.NotConverted);
    expect(refused.aiCandidate).toBeDefined();
  });

  test("every query converted here parses as OneUptime runs it", () => {
    for (const query of [
      "avg:system.cpu.user{host:web-*,!env:dev} by {host}",
      "per_minute(sum:nginx.requests{*})",
      "diff(avg:system.cpu.user{*})",
      "sum:nginx.requests{*}.as_rate()",
    ]) {
      const promQL: string = convert(query)
        .promQL.replace(/\$__interval_ms/g, "60000")
        .replace(/\$__interval/g, "60s");

      expect(() => {
        parsePromQL(promQL);
      }).not.toThrow();
    }
  });

  test("a formula naming no query of the widget is not converted", () => {
    const converted: ConvertedQuery = convertDatadogQuery({
      query: "query1 / query3",
      options: {
        ...DASHBOARD,
        namedQueries: new Map<string, DatadogExpression>([
          ["query1", parseDatadogExpression("avg:system.cpu.user{*}")],
        ]),
      },
    });

    expect(converted.status).toBe(ImportItemStatus.NotConverted);
    expect(texts(converted.notes)).toEqual([DATADOG_UNKNOWN_QUERY_NAME]);
  });

  test("notes naming metrics are said once, every metric together", () => {
    expect(
      mergeDatadogNotes([
        {
          kind: ImportNoteKind.Approximation,
          text: DATADOG_READ_AS_GAUGE,
          values: { metrics: "a" },
        },
        { kind: ImportNoteKind.Approximation, text: DATADOG_FILL_LEFT_OUT },
        {
          kind: ImportNoteKind.Approximation,
          text: DATADOG_READ_AS_GAUGE,
          values: { metrics: "b, a" },
        },
        { kind: ImportNoteKind.Approximation, text: DATADOG_FILL_LEFT_OUT },
      ]),
    ).toEqual([
      {
        kind: ImportNoteKind.Approximation,
        text: DATADOG_READ_AS_GAUGE,
        values: { metrics: "a, b" },
      },
      { kind: ImportNoteKind.Approximation, text: DATADOG_FILL_LEFT_OUT },
    ]);
  });
});

const plan: (
  name: string,
  kinds?: Map<string, DatadogMetricKind>,
) => DashboardImportPlan = (
  name: string,
  kinds?: Map<string, DatadogMetricKind>,
): DashboardImportPlan => {
  return planDashboardImport(
    readImportSource({
      text: readFixture(name),
      accepts: DASHBOARD_SOURCE_KINDS,
    }),
    { knownMetricKinds: kinds },
  );
};

const itemNamed: (
  from: DashboardImportPlan,
  title: string,
) => DashboardImportItem = (
  from: DashboardImportPlan,
  title: string,
): DashboardImportItem => {
  const item: DashboardImportItem | undefined = from.items.find(
    (candidate: DashboardImportItem): boolean => {
      return candidate.title === title;
    },
  );

  if (!item) {
    throw new Error(`no item titled ${title}`);
  }

  return item;
};

const queriesOf: (item: DashboardImportItem) => Array<DataSourceQueryConfig> = (
  item: DashboardImportItem,
): Array<DataSourceQueryConfig> => {
  const args: Record<string, unknown> = (item.component?.arguments ||
    {}) as Record<string, unknown>;
  const one: DataSourceQueryConfig | undefined = args["query"] as
    | DataSourceQueryConfig
    | undefined;

  return [
    ...((args["queries"] as Array<DataSourceQueryConfig> | undefined) || []),
    ...(one ? [one] : []),
  ];
};

describe("Datadog's NGINX overview dashboard", () => {
  const nginx: DashboardImportPlan = plan(
    "datadog-dashboard-nginx-overview.json",
  );

  test("each widget is converted, or listed with why", () => {
    expect(nginx.source).toBe(ImportSourceKind.DatadogDashboard);
    expect(nginx.title).toBe("NGINX - Overview");
    expect(nginx.items).toHaveLength(27);

    for (const item of nginx.items) {
      if (item.status === ImportItemStatus.NotConverted) {
        expect(item.component).toBeUndefined();
        expect(item.notes.length).toBeGreaterThan(0);
      } else {
        expect(item.component).toBeDefined();
      }
    }

    expect(itemNamed(nginx, "NGINX Error logs").notes[0]?.text).toBe(
      WIDGET_READS_OTHER_DATA,
    );
    expect(itemNamed(nginx, "Requests per second by host").notes[0]).toEqual({
      kind: ImportNoteKind.Reason,
      text: WIDGET_TYPE_NOT_SUPPORTED,
      values: { type: "hostmap" },
    });
    expect(texts(itemNamed(nginx, "Requests per second").notes)).toContain(
      WIDGET_CONDITIONAL_FORMATS,
    );
  });

  test("each request of a chart reads its own query1", () => {
    const chart: DashboardImportItem = itemNamed(
      nginx,
      "Requests: reading, writing, waiting",
    );

    expect(chart.component?.componentType).toBe(
      DashboardComponentType.DataSourceChart,
    );
    expect(
      queriesOf(chart).map((query: DataSourceQueryConfig): string => {
        return query.query;
      }),
    ).toEqual([
      'sum (avg_over_time(nginx_net_reading{host="{{Host}}"}[$__interval]))',
      'sum (avg_over_time(nginx_net_writing{host="{{Host}}"}[$__interval]))',
      'sum (avg_over_time(nginx_net_waiting{host="{{Host}}"}[$__interval]))',
    ]);

    for (const query of queriesOf(chart)) {
      expect(query.dataSourceId).toBe(PROJECT_METRICS_DATA_SOURCE_ID);
    }
  });

  test("its host variable filters on host", () => {
    expect(nginx.variables).toHaveLength(1);
    expect(nginx.variables[0]?.variable?.type).toBe(
      DashboardVariableType.TelemetryAttribute,
    );
    expect(nginx.variables[0]?.variable?.attributeKey).toBe("host");
  });

  test("with the project's data saying what each metric is, nothing is assumed", () => {
    const names: Array<string> = listDatadogMetricNames(
      readImportSource({
        text: readFixture("datadog-dashboard-nginx-overview.json"),
        accepts: DASHBOARD_SOURCE_KINDS,
      }),
    );

    expect(names).toContain("nginx.net.conn_dropped_per_s");

    const known: DashboardImportPlan = plan(
      "datadog-dashboard-nginx-overview.json",
      new Map<string, DatadogMetricKind>(
        names.map((name: string): [string, DatadogMetricKind] => {
          return [name, DatadogMetricKind.Gauge];
        }),
      ),
    );

    for (const item of known.items) {
      expect(
        item.notes.some((note: ImportNote): boolean => {
          return note.text === DATADOG_READ_AS_GAUGE;
        }),
      ).toBe(false);
    }

    // Dropped connections, an Agent check's rate per second, is a gauge.
    expect(
      queriesOf(itemNamed(known, "Dropped connections, last 15m"))[0]?.query,
    ).toBe("sum (avg_over_time(nginx_net_conn_dropped_per_s[$__interval]))");
  });

  test("its widgets overlap nothing, on 12 columns", () => {
    const components: Array<DashboardBaseComponent> = nginx.items
      .filter((item: DashboardImportItem): boolean => {
        return Boolean(item.component);
      })
      .map((item: DashboardImportItem): DashboardBaseComponent => {
        return item.component as DashboardBaseComponent;
      });

    expect(
      GridLayoutUtil.hasNoOverlaps(
        GridLayoutUtil.fromDashboardComponents(components),
      ),
    ).toBe(true);

    for (const component of components) {
      expect(
        component.leftInDashboardUnits + component.widthInDashboardUnits,
      ).toBeLessThanOrEqual(12);
    }
  });
});

describe("Datadog's Redis and Postgres dashboards", () => {
  test("a variable that takes a whole tag is listed with why, and its queries read every value", () => {
    const redis: DashboardImportPlan = plan(
      "datadog-dashboard-redis-overview.json",
    );
    const scope: DashboardImportPlan["variables"][number] | undefined =
      redis.variables.find(
        (variable: DashboardImportPlan["variables"][number]) => {
          return variable.sourceName === "scope";
        },
      );

    expect(scope?.status).toBe(ImportItemStatus.NotConverted);
    expect(texts(scope?.notes || [])).toEqual([VARIABLE_WITHOUT_PREFIX]);
    expect(
      redis.items.filter((item: DashboardImportItem): boolean => {
        return item.status === ImportItemStatus.NotConverted;
      }),
    ).toHaveLength(3);
  });

  test("every Postgres widget converts", () => {
    const postgres: DashboardImportPlan = plan(
      "datadog-dashboard-postgresql.json",
    );

    expect(postgres.items).toHaveLength(9);
    expect(
      postgres.items.every((item: DashboardImportItem): boolean => {
        return item.status !== ImportItemStatus.NotConverted;
      }),
    ).toBe(true);
  });
});
