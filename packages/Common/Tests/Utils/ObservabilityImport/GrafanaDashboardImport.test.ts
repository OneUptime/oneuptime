import { describe, expect, test } from "@jest/globals";
import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { DataSourceValueReduce } from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceValueComponent";
import { DashboardVariableType } from "../../../Types/Dashboard/DashboardVariable";
import { AutoRefreshInterval } from "../../../Types/Dashboard/DashboardViewConfig";
import DataSourceQueryConfig from "../../../Types/DataSource/DataSourceQueryConfig";
import { PROJECT_METRICS_DATA_SOURCE_ID } from "../../../Types/DataSource/ProjectMetricsDataSource";
import {
  DashboardImportItem,
  DashboardImportPlan,
  DashboardImportVariable,
  ImportItemStatus,
  ImportNote,
  ImportNoteKind,
  ImportQueryLanguage,
} from "../../../Types/ObservabilityImport/ObservabilityImport";
import TimeRange from "../../../Types/Time/TimeRange";
import GridLayoutUtil from "../../../Utils/Dashboard/GridLayout";
import {
  DASHBOARD_OLD_ROWS,
  DASHBOARD_TIME_RANGE_NEAREST,
  PANEL_DATA_SOURCE_NOT_READ,
  PANEL_EXPRESSION_NOT_READ,
  PANEL_HTML,
  PANEL_LIBRARY_NOT_IN_FILE,
  PANEL_NEGATIVE_Y,
  PANEL_QUERY_LEFT_OUT,
  PANEL_READS_GRAFANA,
  PANEL_REPEATED,
  PANEL_ROW_FOLDED,
  PANEL_STACKED_PERCENT,
  PANEL_TRANSFORMATIONS,
  PANEL_TYPE_NOT_SUPPORTED,
  VARIABLE_AUTO_INTERVAL,
  VARIABLE_CONSTANT,
  VARIABLE_DATA_SOURCE,
  VARIABLE_LISTS_EVERY_VALUE,
  VARIABLE_LISTS_METRIC_VALUES,
  VARIABLE_TYPE_NOT_SUPPORTED,
  convertGrafanaDashboard,
  readGrafanaRelativeTime,
} from "../../../Utils/ObservabilityImport/Grafana/GrafanaDashboard";
import {
  LOGQL_GROUPING_LEFT_OUT,
  LOGQL_LINE_FILTER_LEFT_OUT,
  LOGQL_PIPELINE_LEFT_OUT,
} from "../../../Utils/ObservabilityImport/Grafana/GrafanaLoki";
import {
  DASHBOARD_SOURCE_KINDS,
  readImportSource,
} from "../../../Utils/ObservabilityImport/ImportSource";
import { planDashboardImport } from "../../../Utils/ObservabilityImport/ObservabilityImport";
import {
  QUERY_CONVERTED_BY_AI,
  QUERY_DOES_NOT_PARSE,
  QUERY_NAMES_UNKNOWN_VARIABLE,
  QUERY_USES_TIME_MACRO,
  findPromQLImportProblem,
} from "../../../Utils/ObservabilityImport/PromQLImportQuery";
import { ImportObject } from "../../../Utils/ObservabilityImport/ImportValues";
import { readFixture } from "./ImportFixtures";

/*
 * A Grafana dashboard, as a OneUptime dashboard (issue #7697), read from real
 * exports: Grafana's "Node Exporter Full" - the dashboard the issue's "done
 * when" names - its old version of graph and singlestat panels, the
 * Kubernetes views with All and multi-value variables, and a dashboard
 * written for these tests over Prometheus and Loki at once.
 */

const plan: (name: string) => DashboardImportPlan = (
  name: string,
): DashboardImportPlan => {
  return planDashboardImport(
    readImportSource({
      text: readFixture(name),
      accepts: DASHBOARD_SOURCE_KINDS,
    }),
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

const variableNamed: (
  from: DashboardImportPlan,
  name: string,
) => DashboardImportVariable = (
  from: DashboardImportPlan,
  name: string,
): DashboardImportVariable => {
  const item: DashboardImportVariable | undefined = from.variables.find(
    (candidate: DashboardImportVariable): boolean => {
      return candidate.sourceName === name;
    },
  );

  if (!item) {
    throw new Error(`no variable named ${name}`);
  }

  return item;
};

const noteTexts: (notes: ReadonlyArray<ImportNote>) => Array<string> = (
  notes: ReadonlyArray<ImportNote>,
): Array<string> => {
  return notes.map((note: ImportNote): string => {
    return note.text;
  });
};

// The PromQL a widget runs, one string per query.
const queriesOf: (
  component: DashboardBaseComponent | undefined,
) => Array<string> = (
  component: DashboardBaseComponent | undefined,
): Array<string> => {
  const args: Record<string, unknown> = (component?.arguments || {}) as Record<
    string,
    unknown
  >;
  const many: Array<DataSourceQueryConfig> =
    (args["queries"] as Array<DataSourceQueryConfig> | undefined) || [];
  const one: DataSourceQueryConfig | undefined = args["query"] as
    | DataSourceQueryConfig
    | undefined;

  return [...many, ...(one ? [one] : [])].map(
    (query: DataSourceQueryConfig): string => {
      return query.query;
    },
  );
};

const queryConfigsOf: (
  component: DashboardBaseComponent | undefined,
) => Array<DataSourceQueryConfig> = (
  component: DashboardBaseComponent | undefined,
): Array<DataSourceQueryConfig> => {
  const args: Record<string, unknown> = (component?.arguments || {}) as Record<
    string,
    unknown
  >;
  const one: DataSourceQueryConfig | undefined = args["query"] as
    | DataSourceQueryConfig
    | undefined;

  return [
    ...((args["queries"] as Array<DataSourceQueryConfig> | undefined) || []),
    ...(one ? [one] : []),
  ];
};

const components: (
  from: DashboardImportPlan,
) => Array<DashboardBaseComponent> = (
  from: DashboardImportPlan,
): Array<DashboardBaseComponent> => {
  return from.items
    .filter((item: DashboardImportItem): boolean => {
      return item.status !== ImportItemStatus.NotConverted;
    })
    .map((item: DashboardImportItem): DashboardBaseComponent => {
      return item.component as DashboardBaseComponent;
    });
};

describe("Grafana's Node Exporter Full", () => {
  const nef: DashboardImportPlan = plan("grafana-node-exporter-full.json.gz");

  test("every panel converts, nearly all of them exactly", () => {
    const counts: Record<ImportItemStatus, number> = {
      [ImportItemStatus.Exact]: 0,
      [ImportItemStatus.Approximate]: 0,
      [ImportItemStatus.NotConverted]: 0,
    };

    for (const item of nef.items) {
      counts[item.status]++;
    }

    expect(nef.title).toBe("Node Exporter Full");
    expect(nef.items).toHaveLength(137);
    expect(counts[ImportItemStatus.NotConverted]).toBe(0);
    expect(counts[ImportItemStatus.Exact]).toBeGreaterThanOrEqual(125);
  });

  test("every approximate panel says what differs", () => {
    for (const item of nef.items) {
      if (item.status === ImportItemStatus.Approximate) {
        expect(
          item.notes.some((note: ImportNote): boolean => {
            return note.kind === ImportNoteKind.Approximation;
          }),
        ).toBe(true);
      }
    }

    // CPU Basic stacks percentages, which OneUptime's stacked area does not.
    expect(noteTexts(itemNamed(nef, "CPU Basic").notes)).toContain(
      PANEL_STACKED_PERCENT,
    );
  });

  test("a series drawn below the axis is said, and the panel stays exact", () => {
    const traffic: DashboardImportItem = itemNamed(
      nef,
      "Network Traffic Basic",
    );

    expect(traffic.status).toBe(ImportItemStatus.Exact);
    expect(noteTexts(traffic.notes)).toContain(PANEL_NEGATIVE_Y);
  });

  test("its queries read the project's own metrics, with Grafana's macros and the dashboard's variables", () => {
    const queries: Array<DataSourceQueryConfig> = nef.items.flatMap(
      (item: DashboardImportItem): Array<DataSourceQueryConfig> => {
        return queryConfigsOf(item.component);
      },
    );

    expect(queries.length).toBeGreaterThan(250);

    for (const query of queries) {
      expect(query.dataSourceId).toBe(PROJECT_METRICS_DATA_SOURCE_ID);
      // No Grafana variable is left as Grafana writes it.
      expect(query.query).not.toMatch(/\$(node|job)\b/);
      // And each parses as it will run.
      expect(findPromQLImportProblem({ promQL: query.query })).toBeNull();
    }

    // CPU Basic charts a 0-1 fraction in percent, so it is multiplied too.
    expect(queriesOf(itemNamed(nef, "CPU Basic").component)[0]).toBe(
      '100 * (avg(rate(node_cpu_seconds_total{instance="{{node}}",job="{{job}}", mode="system"}[$__rate_interval])))',
    );
  });

  test("a gauge in percent keeps 0 to 100, and a stat its displayed name", () => {
    const busy: DashboardImportItem = itemNamed(nef, "CPU Busy");
    const args: Record<string, unknown> = busy.component?.arguments as Record<
      string,
      unknown
    >;

    expect(busy.component?.componentType).toBe(
      DashboardComponentType.DataSourceGauge,
    );
    expect(args["unit"]).toBe("%");
    expect(args["minValue"]).toBe(0);
    expect(args["maxValue"]).toBe(100);

    expect(itemNamed(nef, "CPU Cores").component?.componentType).toBe(
      DashboardComponentType.DataSourceValue,
    );
  });

  test("a 0-1 fraction shown in percent is multiplied, so the widget reads what Grafana showed", () => {
    expect(queriesOf(itemNamed(nef, "Pressure").component)[0]).toBe(
      '100 * (rate(node_pressure_cpu_waiting_seconds_total{instance="{{node}}",job="{{job}}"}[$__rate_interval]))',
    );
  });

  test("its variables list the node's job, name and instance, and start on the first", () => {
    expect(variableNamed(nef, "ds_prometheus").notes[0]?.text).toBe(
      VARIABLE_DATA_SOURCE,
    );

    const node: DashboardImportVariable = variableNamed(nef, "node");

    expect(node.variable?.type).toBe(DashboardVariableType.TelemetryAttribute);
    expect(node.variable?.attributeKey).toBe("instance");
    expect(node.variable?.isMultiSelect).toBeUndefined();
    expect(node.startsOnFirstValue).toBe(true);
    expect(node.valuesOfMetric).toBe("node_uname_info");
    expect(noteTexts(node.notes)).toContain(VARIABLE_LISTS_EVERY_VALUE);
  });

  test("it opens on the past day, refreshing every minute", () => {
    expect(nef.viewConfigDefaults.timeRange).toBe(TimeRange.PAST_ONE_DAY);
    expect(nef.viewConfigDefaults.refreshInterval).toBe(
      AutoRefreshInterval.ONE_MINUTE,
    );
  });

  test("its widgets are laid out in Grafana's order, on 12 columns, overlapping nothing", () => {
    const placed: Array<DashboardBaseComponent> = components(nef);

    expect(
      GridLayoutUtil.hasNoOverlaps(
        GridLayoutUtil.fromDashboardComponents(placed),
      ),
    ).toBe(true);

    for (const component of placed) {
      expect(
        component.leftInDashboardUnits + component.widthInDashboardUnits,
      ).toBeLessThanOrEqual(12);
      expect(component.widthInDashboardUnits).toBeGreaterThanOrEqual(
        component.minWidthInDashboardUnits,
      );
      expect(component.heightInDashboardUnits).toBeGreaterThanOrEqual(
        component.minHeightInDashboardUnits,
      );
    }

    // A row's heading comes before its panels, on a line of its own.
    const headingIndex: number = nef.items.findIndex(
      (item: DashboardImportItem): boolean => {
        return (
          item.sourceType === "row" &&
          item.title === "CPU / Memory / Net / Disk"
        );
      },
    );
    const heading: DashboardBaseComponent | undefined =
      nef.items[headingIndex]?.component;
    const next: DashboardBaseComponent | undefined =
      nef.items[headingIndex + 1]?.component;

    expect(heading?.widthInDashboardUnits).toBe(12);
    expect(next?.topInDashboardUnits).toBeGreaterThan(
      heading?.topInDashboardUnits ?? 0,
    );
  });
});

describe("its old version: graph and singlestat panels, in rows", () => {
  const old: DashboardImportPlan = plan(
    "grafana-node-exporter-full-old.json.gz",
  );

  test("every panel converts, and the old layout is said", () => {
    expect(noteTexts(old.notes)).toContain(DASHBOARD_OLD_ROWS);
    expect(old.items).toHaveLength(172);
    expect(
      old.items.filter((item: DashboardImportItem): boolean => {
        return item.status === ImportItemStatus.NotConverted;
      }),
    ).toHaveLength(0);
    expect(
      old.items.every((item: DashboardImportItem): boolean => {
        return Boolean(item.component);
      }),
    ).toBe(true);
  });

  test("a singlestat drawn as a gauge is a gauge, with its thresholds", () => {
    const gauges: Array<DashboardImportItem> = old.items.filter(
      (item: DashboardImportItem): boolean => {
        return (
          item.sourceType === "singlestat" &&
          item.component?.componentType ===
            DashboardComponentType.DataSourceGauge
        );
      },
    );

    expect(gauges.length).toBeGreaterThan(0);

    const withThresholds: Array<DashboardImportItem> = gauges.filter(
      (item: DashboardImportItem): boolean => {
        const args: Record<string, unknown> = item.component
          ?.arguments as Record<string, unknown>;
        return args["criticalThreshold"] !== undefined;
      },
    );

    expect(withThresholds.length).toBeGreaterThan(0);
  });

  test("its widgets overlap nothing", () => {
    expect(
      GridLayoutUtil.hasNoOverlaps(
        GridLayoutUtil.fromDashboardComponents(components(old)),
      ),
    ).toBe(true);
  });
});

describe("the Kubernetes views: All, multi-value and data source variables", () => {
  const namespaces: DashboardImportPlan = plan(
    "grafana-k8s-views-namespaces.json.gz",
  );

  test("a variable with All and several values picks several, and starts on All", () => {
    const namespace: DashboardImportVariable = variableNamed(
      namespaces,
      "namespace",
    );

    expect(namespace.variable?.isMultiSelect).toBe(true);
    expect(namespace.variable?.selectedValues).toBeUndefined();
    expect(namespace.startsOnFirstValue).toBe(false);
  });

  test("a custom variable lists its options", () => {
    const resolution: DashboardImportVariable = variableNamed(
      namespaces,
      "resolution",
    );

    expect(resolution.variable?.type).toBe(DashboardVariableType.CustomList);
    expect(resolution.variable?.customListValues).toBe("1s,15s,30s,1m,3m,5m");
    expect(resolution.variable?.defaultValue).toBe("30s");
  });

  test("no panel is dropped", () => {
    expect(
      namespaces.items.filter((item: DashboardImportItem): boolean => {
        return item.status === ImportItemStatus.NotConverted;
      }),
    ).toHaveLength(0);
  });

  test("a regex matcher's multi-value variable keeps its =~", () => {
    const queries: Array<string> = namespaces.items.flatMap(
      (item: DashboardImportItem): Array<string> => {
        return queriesOf(item.component);
      },
    );

    expect(
      queries.some((query: string): boolean => {
        return query.includes('namespace=~"{{namespace}}"');
      }),
    ).toBe(true);
  });

  test("the pods view converts too", () => {
    const pods: DashboardImportPlan = plan("grafana-k8s-views-pods.json.gz");

    expect(pods.items.length).toBeGreaterThan(25);
    expect(
      pods.items.filter((item: DashboardImportItem): boolean => {
        return item.status === ImportItemStatus.NotConverted;
      }),
    ).toHaveLength(0);
  });
});

describe("a dashboard over Prometheus and Loki at once", () => {
  const mixed: DashboardImportPlan = plan("grafana-mixed-loki-prometheus.json");

  test("a 0-1 fraction is charted in percent, as an area", () => {
    const errors: DashboardImportItem = itemNamed(mixed, "Error ratio");
    const args: Record<string, unknown> = errors.component?.arguments as Record<
      string,
      unknown
    >;

    expect(errors.status).toBe(ImportItemStatus.Exact);
    expect(args["unit"]).toBe("%");
    expect(args["chartType"]).toBe(DashboardChartType.Area);
    expect(args["chartDescription"]).toBe("Share of requests that failed.");
    expect(queriesOf(errors.component)[0]).toMatch(
      /^100 \* \(sum\(rate\(http_requests_total\{job="\{\{job\}\}",instance=~"\{\{instance\}\}",code=~"5\.\."\}\[\$__rate_interval\]\)\)/,
    );
    expect(queryConfigsOf(errors.component)[0]?.legend).toBe("errors");
  });

  test("a stat sums, with Grafana's warning and critical colours as thresholds", () => {
    const stat: DashboardImportItem = itemNamed(mixed, "Requests (last hour)");
    const args: Record<string, unknown> = stat.component?.arguments as Record<
      string,
      unknown
    >;

    expect(stat.component?.componentType).toBe(
      DashboardComponentType.DataSourceValue,
    );
    expect(args["reduce"]).toBe(DataSourceValueReduce.Sum);
    expect(args["warningThreshold"]).toBe(1000);
    expect(args["criticalThreshold"]).toBe(5000);
  });

  test("a gauge keeps its range, and a custom variable in a function's argument", () => {
    const gauge: DashboardImportItem = itemNamed(mixed, "p99 latency");
    const args: Record<string, unknown> = gauge.component?.arguments as Record<
      string,
      unknown
    >;

    expect(args["minValue"]).toBe(0);
    expect(args["maxValue"]).toBe(2);
    expect(args["unit"]).toBe("s");
    expect(queriesOf(gauge.component)[0]).toContain(
      "histogram_quantile({{quantile}},",
    );
  });

  test("a library panel the export holds is converted from its model; one it lacks says how to export it", () => {
    const library: DashboardImportItem = itemNamed(
      mixed,
      "Requests per second",
    );

    expect(library.status).toBe(ImportItemStatus.Exact);
    expect(
      (library.component?.arguments as Record<string, unknown>)["unit"],
    ).toBe("req/s");
    expect(queryConfigsOf(library.component)[0]?.legend).toBe("{{handler}}");

    const gone: DashboardImportItem = itemNamed(mixed, "Old library panel");

    expect(gone.status).toBe(ImportItemStatus.NotConverted);
    expect(noteTexts(gone.notes)).toEqual([PANEL_LIBRARY_NOT_IN_FILE]);
  });

  test("a folded row's heading says it is shown open", () => {
    const row: DashboardImportItem = itemNamed(mixed, "Logs");

    expect(row.component?.componentType).toBe(DashboardComponentType.Text);
    expect(noteTexts(row.notes)).toEqual([PANEL_ROW_FOLDED]);
  });

  test("a logs panel is a Log Stream of its labels and its first line filter, and says what is left out", () => {
    const logs: DashboardImportItem = itemNamed(mixed, "Checkout errors");
    const args: Record<string, unknown> = logs.component?.arguments as Record<
      string,
      unknown
    >;

    expect(logs.component?.componentType).toBe(
      DashboardComponentType.LogStream,
    );
    expect(logs.status).toBe(ImportItemStatus.Approximate);
    // app="$app" is the dashboard's app variable, which filters on app itself.
    expect(args["attributeFilterQuery"]).toBe(
      "@env:prod @namespace:(shop OR checkout)",
    );
    expect(args["bodyContains"]).toBe("error");
    expect(noteTexts(logs.notes)).toEqual(
      expect.arrayContaining([
        LOGQL_LINE_FILTER_LEFT_OUT,
        LOGQL_PIPELINE_LEFT_OUT,
      ]),
    );
  });

  test("a count of Loki's logs over time is a Log Chart", () => {
    const volume: DashboardImportItem = itemNamed(mixed, "Log volume");
    const args: Record<string, unknown> = volume.component?.arguments as Record<
      string,
      unknown
    >;

    expect(volume.component?.componentType).toBe(
      DashboardComponentType.LogChart,
    );
    expect(args["attributeFilters"]).toEqual({ env: "prod" });
    expect(args["bodyContains"]).toBe("error");
    expect(noteTexts(volume.notes)).toContain(LOGQL_GROUPING_LEFT_OUT);
  });

  test("a mixed panel keeps its Prometheus query and says which it left out, and why", () => {
    const mixedPanel: DashboardImportItem = itemNamed(mixed, "Mixed sources");

    expect(mixedPanel.status).toBe(ImportItemStatus.Approximate);
    expect(queriesOf(mixedPanel.component)).toEqual(['up{job="{{job}}"}']);
    expect(
      mixedPanel.notes.filter((note: ImportNote): boolean => {
        return note.text === PANEL_QUERY_LEFT_OUT;
      }),
    ).toHaveLength(2);
    expect(noteTexts(mixedPanel.notes)).toEqual(
      expect.arrayContaining([
        PANEL_DATA_SOURCE_NOT_READ,
        PANEL_EXPRESSION_NOT_READ,
      ]),
    );
  });

  test("a panel OneUptime has no widget like, or that shows Grafana's records, is listed with why", () => {
    expect(noteTexts(itemNamed(mixed, "Latency heatmap").notes)).toEqual([
      PANEL_TYPE_NOT_SUPPORTED,
    ]);
    expect(noteTexts(itemNamed(mixed, "Firing alerts").notes)).toEqual([
      PANEL_READS_GRAFANA,
    ]);
  });

  test("text in Markdown is a Text widget; HTML an HTML widget with scripts off", () => {
    const runbook: DashboardImportItem = itemNamed(mixed, "Runbook");

    expect(
      (runbook.component?.arguments as Record<string, unknown>)["text"],
    ).toBe("### Runbook\n\nPage **#checkout-oncall** before restarting pods.");

    const html: DashboardImportItem | undefined = mixed.items.find(
      (item: DashboardImportItem): boolean => {
        return item.component?.componentType === DashboardComponentType.Html;
      },
    );

    expect(
      (html?.component?.arguments as Record<string, unknown>)["allowScripts"],
    ).toBe(false);
    expect(noteTexts(html?.notes || [])).toEqual([PANEL_HTML]);
  });

  test("a repeated, transformed panel says so, leaves out the query that reads $__from, and keeps an interval variable", () => {
    const cpu: DashboardImportItem = itemNamed(mixed, "CPU per instance");

    expect(noteTexts(cpu.notes)).toEqual(
      expect.arrayContaining([
        PANEL_REPEATED,
        PANEL_TRANSFORMATIONS,
        QUERY_USES_TIME_MACRO,
      ]),
    );
    // The hidden query C is not imported, and __auto is no legend.
    expect(queriesOf(cpu.component)).toEqual([
      'rate(process_cpu_seconds_total{job="{{job}}",instance=~"{{instance}}"}[{{window}}])',
    ]);
    expect(queryConfigsOf(cpu.component)[0]?.legend).toBeUndefined();
  });

  test("a query naming a variable the dashboard lacks is not converted, and not offered to AI", () => {
    const unknown: DashboardImportItem = itemNamed(mixed, "Unknown variable");

    expect(unknown.status).toBe(ImportItemStatus.NotConverted);
    expect(noteTexts(unknown.notes)).toEqual([QUERY_NAMES_UNKNOWN_VARIABLE]);
    expect(unknown.aiCandidate).toBeUndefined();
  });

  test("a query OneUptime's PromQL does not read is offered to OneUptime AI, and the answer used converts it", () => {
    const native: DashboardImportItem = itemNamed(mixed, "Native histogram");

    expect(native.status).toBe(ImportItemStatus.NotConverted);
    expect(noteTexts(native.notes)).toEqual([QUERY_DOES_NOT_PARSE]);
    expect(native.aiCandidate?.language).toBe(ImportQueryLanguage.PromQL);
    expect(native.aiCandidate?.query).toBe(
      "histogram_avg(rate(http_request_duration_seconds[5m]))",
    );
    expect(native.aiCandidate?.variableNames).toEqual(
      expect.arrayContaining(["job", "instance", "app"]),
    );

    const document: ImportObject = readImportSource({
      text: readFixture("grafana-mixed-loki-prometheus.json"),
      accepts: DASHBOARD_SOURCE_KINDS,
    }).documents[0] as ImportObject;

    const answered: DashboardImportPlan = convertGrafanaDashboard(document, {
      queryOverrides: new Map<string, string>([
        [
          native.aiCandidate?.targetKey || "",
          "sum(rate(http_request_duration_seconds_sum[5m])) / sum(rate(http_request_duration_seconds_count[5m]))",
        ],
      ]),
    });
    const converted: DashboardImportItem = itemNamed(
      answered,
      "Native histogram",
    );

    expect(converted.status).toBe(ImportItemStatus.Approximate);
    expect(noteTexts(converted.notes)).toContain(QUERY_CONVERTED_BY_AI);
    expect(converted.component?.componentType).toBe(
      DashboardComponentType.DataSourceChart,
    );

    // An answer that does not parse leaves it not converted.
    const refused: DashboardImportPlan = convertGrafanaDashboard(document, {
      queryOverrides: new Map<string, string>([
        [native.aiCandidate?.targetKey || "", "sum(rate(x[5m]"],
      ]),
    });

    expect(itemNamed(refused, "Native histogram").status).toBe(
      ImportItemStatus.NotConverted,
    );
  });

  test("a pie chart is drawn as OneUptime's pie, approximately", () => {
    const pie: DashboardImportItem = itemNamed(mixed, "Requests by code");

    expect(pie.status).toBe(ImportItemStatus.Approximate);
    expect(
      (pie.component?.arguments as Record<string, unknown>)["chartType"],
    ).toBe(DashboardChartType.Pie);
    expect(queriesOf(pie.component)[0]).toContain("[$__range]");
  });

  test("its variables: a picked value kept, All left open, Loki's said, a constant written in", () => {
    const job: DashboardImportVariable = variableNamed(mixed, "job");

    expect(job.variable?.defaultValue).toBe("checkout");
    expect(job.startsOnFirstValue).toBe(false);

    const instance: DashboardImportVariable = variableNamed(mixed, "instance");

    expect(instance.variable?.isMultiSelect).toBe(true);
    expect(instance.variable?.selectedValues).toBeUndefined();

    expect(noteTexts(variableNamed(mixed, "app").notes)).toContain(
      VARIABLE_LISTS_METRIC_VALUES,
    );

    const window: DashboardImportVariable = variableNamed(mixed, "window");

    expect(window.variable?.customListValues).toBe("1m,5m,10m");
    expect(window.variable?.defaultValue).toBe("1m");
    expect(noteTexts(window.notes)).toContain(VARIABLE_AUTO_INTERVAL);

    const cluster: DashboardImportVariable = variableNamed(mixed, "cluster");

    expect(cluster.variable).toBeUndefined();
    expect(noteTexts(cluster.notes)).toEqual([VARIABLE_CONSTANT]);

    expect(variableNamed(mixed, "filters").status).toBe(
      ImportItemStatus.NotConverted,
    );
    expect(noteTexts(variableNamed(mixed, "filters").notes)).toEqual([
      VARIABLE_TYPE_NOT_SUPPORTED,
    ]);

    expect(variableNamed(mixed, "search").variable?.type).toBe(
      DashboardVariableType.TextInput,
    );
    expect(variableNamed(mixed, "search").variable?.defaultValue).toBe("error");
  });

  test("a range OneUptime has no default of opens on the nearest, and says so", () => {
    expect(mixed.viewConfigDefaults.timeRange).toBe(TimeRange.PAST_ONE_DAY);
    expect(noteTexts(mixed.notes)).toContain(DASHBOARD_TIME_RANGE_NEAREST);
    expect(mixed.viewConfigDefaults.refreshInterval).toBe(
      AutoRefreshInterval.THIRTY_SECONDS,
    );
  });
});

describe("Grafana's relative times", () => {
  test.each([
    ["now-5m", 300],
    ["now-24h", 86400],
    ["now-7d", 604800],
    ["now-1M", 2592000],
    ["now-1y", 31536000],
  ])("%s is %d seconds", (text: string, seconds: number) => {
    expect(readGrafanaRelativeTime(text)).toBe(seconds);
  });

  test("an absolute time, or anything else, is none", () => {
    expect(readGrafanaRelativeTime("2026-01-01T00:00:00Z")).toBeUndefined();
    expect(readGrafanaRelativeTime("now")).toBeUndefined();
  });
});
