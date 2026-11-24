import { describe, expect, test } from "@jest/globals";
import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardLogChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardLogChartComponent";
import DashboardLogStreamComponent from "../../../Types/Dashboard/DashboardComponents/DashboardLogStreamComponent";
import LogSeverity from "../../../Types/Log/LogSeverity";
import { queryStringToFilter } from "../../../Types/Log/LogQueryToFilter";
import {
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepLogMonitor from "../../../Types/Monitor/MonitorStepLogMonitor";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import TelemetryAlertRuleUtil, {
  TelemetryAlertRule,
  TelemetryAlertRuleReadResult,
} from "../../../Types/Monitor/TelemetryAlertRule";
import ObjectID from "../../../Types/ObjectID";
import {
  AlertImportItem,
  AlertImportPlan,
  DashboardImportItem,
  DashboardImportPlan,
  ImportItemStatus,
  ImportNote,
  ImportNoteKind,
  ImportedAlertRuleKind,
  ImportedAlertSeverity,
} from "../../../Types/ObservabilityImport/ObservabilityImport";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import {
  AlertImportAction,
  AlertImportSeeds,
  buildImportedMonitorSteps,
  getImportedMonitorType,
} from "../../../Utils/ObservabilityImport/AlertImportMonitorBuilder";
import { readDatadogLogField } from "../../../Utils/ObservabilityImport/Datadog/DatadogAttributes";
import {
  LOG_ONE_SEVERITY,
  LOG_STATUSES_SHARED,
  LOG_TERM_LEFT_OUT,
  LOG_TERM_NOT_EXACT,
  LOG_TEXT_LEFT_OUT,
  DatadogLogFilters,
  DatadogLogSearchTarget,
  DatadogLogTerm,
  convertDatadogLogSearch,
  parseDatadogLogSearch,
} from "../../../Utils/ObservabilityImport/Datadog/DatadogLogSearch";
import {
  LOG_COLUMNS_LEFT_OUT,
  LOG_COMPUTES_OTHER,
  LOG_FORMULA_NOT_CONVERTED,
  LOG_GROUPS_LEFT_OUT,
  LOG_INDEXES_LEFT_OUT,
  LOG_OLDEST_FIRST,
  LOG_WIDGET_NOT_SUPPORTED,
  parseDatadogLogMonitorQuery,
} from "../../../Utils/ObservabilityImport/Datadog/DatadogLogs";
import {
  MONITOR_QUERY_NOT_READ,
  MONITOR_WARNING_LEFT_OUT,
} from "../../../Utils/ObservabilityImport/Datadog/DatadogMonitors";
import { DATADOG_VARIABLE_WITHOUT_PREFIX } from "../../../Utils/ObservabilityImport/Datadog/DatadogPromQL";
import { WIDGET_SHOWS_FIRST_QUERY } from "../../../Utils/ObservabilityImport/Datadog/DatadogDashboard";
import { LOGQL_VARIABLES_EVERYWHERE } from "../../../Utils/ObservabilityImport/Grafana/GrafanaLoki";
import {
  ALERT_SOURCE_KINDS,
  DASHBOARD_SOURCE_KINDS,
  readImportSource,
} from "../../../Utils/ObservabilityImport/ImportSource";
import {
  planAlertImport,
  planDashboardImport,
} from "../../../Utils/ObservabilityImport/ObservabilityImport";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { readFixture } from "./ImportFixtures";

/*
 * Datadog's log widgets and log monitors (issue #10324), held to Datadog's
 * own: the NGINX, Redis and Vault dashboards' log streams and log charts,
 * and the Cisco ACI, FoundationDB, Squid, iboss, Zscaler and SNMP log
 * monitors, as integrations-core ships them. A Datadog search becomes the
 * filters each log widget or Logs monitor reads, as OneUptime keeps what
 * the Datadog Agent sends (DatadogAttributes), and what it cannot say is
 * left out and said.
 */

const texts: (notes: ReadonlyArray<ImportNote>) => Array<string> = (
  notes: ReadonlyArray<ImportNote>,
): Array<string> => {
  return notes.map((note: ImportNote): string => {
    return note.text;
  });
};

const search: (
  query: string,
  target?: DatadogLogSearchTarget,
  variablePrefixes?: ReadonlyMap<string, string>,
) => { filters: DatadogLogFilters; notes: Array<ImportNote> } = (
  query: string,
  target: DatadogLogSearchTarget = DatadogLogSearchTarget.Stream,
  variablePrefixes?: ReadonlyMap<string, string>,
): { filters: DatadogLogFilters; notes: Array<ImportNote> } => {
  const notes: Array<ImportNote> = [];
  const filters: DatadogLogFilters = convertDatadogLogSearch({
    query,
    target,
    notes,
    variablePrefixes,
  });

  return { filters, notes };
};

const dashboardOf: (
  document: string | Record<string, unknown>,
) => DashboardImportPlan = (
  document: string | Record<string, unknown>,
): DashboardImportPlan => {
  return planDashboardImport(
    readImportSource({
      text:
        typeof document === "string"
          ? readFixture(document)
          : JSON.stringify(document),
      accepts: DASHBOARD_SOURCE_KINDS,
    }),
  );
};

const monitorOf: (
  monitor: string | Record<string, unknown>,
) => AlertImportItem = (
  monitor: string | Record<string, unknown>,
): AlertImportItem => {
  const plan: AlertImportPlan = planAlertImport(
    readImportSource({
      text:
        typeof monitor === "string"
          ? readFixture(monitor)
          : JSON.stringify(monitor),
      accepts: ALERT_SOURCE_KINDS,
    }),
  );

  expect(plan.items).toHaveLength(1);

  return plan.items[0] as AlertImportItem;
};

const itemNamed: (
  plan: DashboardImportPlan,
  title: string,
) => DashboardImportItem = (
  plan: DashboardImportPlan,
  title: string,
): DashboardImportItem => {
  const item: DashboardImportItem | undefined = plan.items.find(
    (candidate: DashboardImportItem): boolean => {
      return candidate.title === title;
    },
  );

  if (!item) {
    throw new Error(`no item titled ${title}`);
  }

  return item;
};

const streamArguments: (
  item: DashboardImportItem,
) => DashboardLogStreamComponent["arguments"] = (
  item: DashboardImportItem,
): DashboardLogStreamComponent["arguments"] => {
  expect(item.component?.componentType).toBe(DashboardComponentType.LogStream);
  return (item.component as DashboardLogStreamComponent).arguments;
};

const chartArguments: (
  item: DashboardImportItem,
) => DashboardLogChartComponent["arguments"] = (
  item: DashboardImportItem,
): DashboardLogChartComponent["arguments"] => {
  expect(item.component?.componentType).toBe(DashboardComponentType.LogChart);
  return (item.component as DashboardLogChartComponent).arguments;
};

describe("where OneUptime keeps what a Datadog log search names", () => {
  test.each([
    ["status", { field: "Severity" }],
    ["level", { field: "Severity" }],
    ["message", { field: "Message" }],
    ["trace_id", { field: "Trace" }],
    ["host", { field: "Attribute", attributeKey: "resource.host.name" }],
    ["hostname", { field: "Attribute", attributeKey: "resource.host.name" }],
    ["service", { field: "Attribute", attributeKey: "resource.service.name" }],
    ["source", { field: "Attribute", attributeKey: "datadog.source" }],
    ["ddsource", { field: "Attribute", attributeKey: "datadog.source" }],
    ["env", { field: "Attribute", attributeKey: "env" }],
    [
      "http.status_code",
      { field: "Attribute", attributeKey: "http.status_code" },
    ],
  ])("%s", (key: string, expected: Record<string, unknown>) => {
    expect(readDatadogLogField(key)).toEqual(expected);
  });
});

describe("a Datadog log search, read", () => {
  test("terms are joined by AND; OR across terms and groups are one term no filter reads", () => {
    const terms: Array<DatadogLogTerm> = parseDatadogLogSearch(
      'service:web AND -status:debug "connection refused" (a OR b) env:prod OR env:dev @http.status_code:[400 TO 499]',
    );

    expect(
      terms.map((term: DatadogLogTerm): string => {
        return `${term.kind}:${term.raw}`;
      }),
    ).toEqual([
      "Field:service:web",
      "Field:-status:debug",
      'Text:"connection refused"',
      "Unsupported:(a OR b)",
      "Unsupported:env:prod OR env:dev",
      "Field:@http.status_code:[400 TO 499]",
    ]);
  });

  test("values: one, quoted, a list, a comparison, a range; NOT negates the next term", () => {
    const terms: Array<DatadogLogTerm> = parseDatadogLogSearch(
      '@a:x* @b:"two words" @c:(1 OR 2) @d:>=10 @e:{1 TO 5] NOT @f:z',
    );

    expect(terms).toEqual([
      {
        kind: "Field",
        key: "@a",
        value: { kind: "Exact", value: "x*", quoted: false },
        negated: false,
        raw: "@a:x*",
      },
      {
        kind: "Field",
        key: "@b",
        value: { kind: "Exact", value: "two words", quoted: true },
        negated: false,
        raw: '@b:"two words"',
      },
      {
        kind: "Field",
        key: "@c",
        value: {
          kind: "Any",
          values: [
            { value: "1", quoted: false },
            { value: "2", quoted: false },
          ],
        },
        negated: false,
        raw: "@c:(1 OR 2)",
      },
      {
        kind: "Field",
        key: "@d",
        value: { kind: "Compare", operator: ">=", value: "10" },
        negated: false,
        raw: "@d:>=10",
      },
      {
        kind: "Field",
        key: "@e",
        value: {
          kind: "Range",
          from: "1",
          to: "5",
          fromInclusive: false,
          toInclusive: true,
        },
        negated: false,
        raw: "@e:{1 TO 5]",
      },
      {
        kind: "Field",
        key: "@f",
        value: { kind: "Exact", value: "z", quoted: false },
        negated: true,
        raw: "NOT @f:z",
      },
    ]);
  });

  test("a template variable, alone or as a key's value; * alone matches every log", () => {
    expect(parseDatadogLogSearch("* $host env:$env.value")).toEqual([
      {
        kind: "Variable",
        name: "host",
        key: undefined,
        negated: false,
        raw: "$host",
      },
      {
        kind: "Variable",
        name: "env",
        key: "env",
        negated: false,
        raw: "env:$env.value",
      },
    ]);
  });

  test("a search on every attribute, a function and a calculated field read as no filter", () => {
    expect(
      parseDatadogLogSearch(
        "*:timeout CIDR(@network.client.ip,10.0.0.0/8) #latency:>5",
      ).map((term: DatadogLogTerm): string => {
        return term.kind;
      }),
    ).toEqual(["Unsupported", "Unsupported", "Unsupported"]);
  });
});

describe("a Datadog log search, as a Log Stream's filters", () => {
  test("reserved attributes, tags and facets, in the log search's own words", () => {
    const { filters, notes } = search(
      "service:checkout host:web-* source:nginx env:prod @http.method:GET -@http.status_code:(404 OR 500) @duration:>1000 @size:[10 TO 20]",
    );

    expect(filters.attributeQuery).toBe(
      "@resource.service.name:checkout @resource.host.name:web-* @datadog.source:nginx @env:prod @http.method:GET -@http.status_code:(404 OR 500) @duration:>1000 @size:>=10 @size:<=20",
    );
    expect(notes).toEqual([]);

    // The log search reads it back as the attributes it names.
    const parsed: Record<string, unknown> =
      queryStringToFilter(filters.attributeQuery).attributes || {};

    expect(Object.keys(parsed).sort()).toEqual([
      "datadog.source",
      "duration",
      "env",
      "http.method",
      "http.status_code",
      "resource.host.name",
      "resource.service.name",
      "size",
    ]);
    expect(parsed["env"]).toBe("prod");
  });

  test("a status is a severity; a quoted text is what the body contains", () => {
    const { filters, notes } = search('status:warn "disk full"');

    expect(filters.severities).toEqual([LogSeverity.Warning]);
    expect(filters.bodyContains).toBe("disk full");
    expect(filters.attributeQuery).toBe("");
    expect(notes).toEqual([]);
  });

  test("Datadog's statuses OneUptime keeps at one severity are said, unless the search names them all", () => {
    expect(texts(search("status:error").notes)).toEqual([LOG_STATUSES_SHARED]);
    expect(texts(search("status:info").notes)).toEqual([LOG_STATUSES_SHARED]);
    expect(search("status:(alert OR critical OR error)").notes).toEqual([]);
    expect(
      search("status:(alert OR critical OR error)").filters.severities,
    ).toEqual([LogSeverity.Error]);
    // Datadog reads a log sent at trace as debug.
    expect(search("status:debug").filters.severities).toEqual([
      LogSeverity.Trace,
      LogSeverity.Debug,
    ]);
    expect(search("status:debug").notes).toEqual([]);
    // Every severity but the one excluded.
    expect(search("-status:warning").filters.severities).toEqual(
      Object.values(LogSeverity).filter((severity: LogSeverity): boolean => {
        return severity !== LogSeverity.Warning;
      }),
    );
  });

  test("a word's wildcards at its ends say contains; a second text, a negated text and a trace are left out, each said", () => {
    expect(search("*timeout*").filters.bodyContains).toBe("timeout");

    const { filters, notes } = search(
      "timeout refused -healthcheck trace_id:abc",
    );

    expect(filters.bodyContains).toBe("timeout");
    expect(notes).toEqual([
      {
        kind: ImportNoteKind.Approximation,
        text: LOG_TEXT_LEFT_OUT,
        values: { text: "refused" },
      },
      {
        kind: ImportNoteKind.Approximation,
        text: LOG_TERM_LEFT_OUT,
        values: { term: "-healthcheck" },
      },
      {
        kind: ImportNoteKind.Approximation,
        text: LOG_TERM_LEFT_OUT,
        values: { term: "trace_id:abc" },
      },
    ]);
  });

  test("a keyless tag is found among the others it was sent with, never inside another's name", () => {
    expect(search("tags:canary").filters.attributeQuery).toBe(
      "@datadog.tags:(canary OR canary,* OR *,canary OR *,canary,*)",
    );
  });

  test("a value the log search would read as syntax is written as itself", () => {
    expect(search('@path:"/api/*"').filters.attributeQuery).toBe(
      "@path:/api/\\*",
    );
    expect(search('@note:"a b"').filters.attributeQuery).toBe('@note:"a b"');
  });

  test("a variable on a tag narrows the widget itself; one without a prefix reads every log, said", () => {
    const { filters, notes } = search(
      "source:redis $scope $host",
      DatadogLogSearchTarget.Stream,
      new Map<string, string>([
        ["scope", ""],
        ["host", "host"],
      ]),
    );

    expect(filters.attributeQuery).toBe("@datadog.source:redis");
    expect(notes).toEqual([
      {
        kind: ImportNoteKind.Info,
        text: DATADOG_VARIABLE_WITHOUT_PREFIX,
        values: { name: "scope" },
      },
    ]);
  });
});

describe("a Datadog log search, as exact values: a Log Chart's and a Logs monitor's", () => {
  test("exact values are kept; patterns, negations, lists and comparisons are left out, each said", () => {
    const { filters, notes } = search(
      "service:checkout status:(error OR warn) @http.method:GET host:web-* -env:dev @code:(1 OR 2) @duration:>5",
      DatadogLogSearchTarget.Exact,
    );

    expect(filters.attributes).toEqual({
      "resource.service.name": "checkout",
      "http.method": "GET",
    });
    expect(filters.severities).toEqual([
      LogSeverity.Warning,
      LogSeverity.Error,
    ]);
    expect(notes).toEqual([
      {
        kind: ImportNoteKind.Approximation,
        text: LOG_TERM_NOT_EXACT,
        values: { term: "host:web-*" },
      },
      {
        kind: ImportNoteKind.Approximation,
        text: LOG_TERM_NOT_EXACT,
        values: { term: "-env:dev" },
      },
      {
        kind: ImportNoteKind.Approximation,
        text: LOG_TERM_NOT_EXACT,
        values: { term: "@code:(1 OR 2)" },
      },
      {
        kind: ImportNoteKind.Approximation,
        text: LOG_TERM_NOT_EXACT,
        values: { term: "@duration:>5" },
      },
      { kind: ImportNoteKind.Approximation, text: LOG_STATUSES_SHARED },
    ]);
    expect(filters.searchText).toBe(
      "severity:(Warning OR Error) @resource.service.name:checkout @http.method:GET",
    );
  });

  test("any search, however written, reads without an error, and what it keeps reads back in the log search", () => {
    const random: SeededRandom = seededRandom(10324);
    const pieces: Array<string> = [
      "service:web",
      "-host:db-*",
      "status:error",
      "status:(warn OR info)",
      "@http.status_code:[500 TO 599]",
      '"time out"',
      "timeout",
      "AND",
      "OR",
      "NOT",
      "(",
      ")",
      "$host",
      "env:$env.value",
      "@a.b:>=3",
      "*:x",
      "tags:canary",
      '@q:"x*y"',
      "\\:",
      "*",
      '"',
      "[",
      "{",
      "@k:(a OR b",
    ];

    for (let draw: number = 0; draw < 2000; draw++) {
      const words: Array<string> = [];
      const count: number = 1 + random(8);

      for (let index: number = 0; index < count; index++) {
        words.push(pieces[random(pieces.length)] as string);
      }

      const query: string = words.join(random(2) === 0 ? " " : "");

      for (const target of [
        DatadogLogSearchTarget.Stream,
        DatadogLogSearchTarget.Exact,
      ]) {
        const { filters } = search(
          query,
          target,
          new Map<string, string>([["host", "host"]]),
        );

        expect(() => {
          queryStringToFilter(filters.attributeQuery);
        }).not.toThrow();

        for (const value of Object.values(filters.attributes)) {
          expect(typeof value).toBe("string");
        }
      }
    }
  });
});

describe("Datadog's own dashboards: their log widgets", () => {
  test("NGINX's error log stream is a Log Stream over its source and status codes, its columns and order said", () => {
    const item: DashboardImportItem = itemNamed(
      dashboardOf("datadog-dashboard-nginx-overview.json"),
      "NGINX Error logs",
    );

    expect(item.status).toBe(ImportItemStatus.Approximate);
    expect(streamArguments(item)).toEqual({
      maxRows: 50,
      title: "NGINX Error logs",
      attributeFilterQuery:
        "@datadog.source:nginx @http.status_code:(404 OR 500)",
    });
    expect(item.notes).toEqual([
      {
        kind: ImportNoteKind.Approximation,
        text: LOG_COLUMNS_LEFT_OUT,
        values: { columns: "host, @http.status_code, @http.url_details.path" },
      },
      { kind: ImportNoteKind.Approximation, text: LOG_OLDEST_FIRST },
      { kind: ImportNoteKind.Info, text: LOGQL_VARIABLES_EVERYWHERE },
    ]);
  });

  test("Redis's list streams of logs are Log Streams: its error logs at the Error severity", () => {
    const redis: DashboardImportPlan = dashboardOf(
      "datadog-dashboard-redis-overview.json",
    );
    const errors: DashboardImportItem = itemNamed(redis, "Error Logs");
    const all: DashboardImportItem = itemNamed(redis, "All Logs");

    expect(streamArguments(errors)).toEqual({
      maxRows: 50,
      title: "Error Logs",
      severityFilter: LogSeverity.Error,
      attributeFilterQuery: "@datadog.source:redis",
    });
    expect(texts(errors.notes)).toEqual([
      DATADOG_VARIABLE_WITHOUT_PREFIX,
      LOG_STATUSES_SHARED,
      LOGQL_VARIABLES_EVERYWHERE,
    ]);
    expect(all.status).toBe(ImportItemStatus.Exact);
    expect(streamArguments(all).severityFilter).toBeUndefined();
  });

  test("Vault's log volume is a Log Chart, its split said; its streams Log Streams; its lists of logs not converted, each with why", () => {
    const vault: DashboardImportPlan = dashboardOf(
      "datadog-dashboard-vault-overview-legacy.json",
    );
    const volume: DashboardImportItem = itemNamed(
      vault,
      "Log volume by environment",
    );

    expect(volume.status).toBe(ImportItemStatus.Approximate);
    expect(chartArguments(volume)).toEqual({
      chartType: DashboardChartType.Bar,
      title: "Log volume by environment",
      attributeFilters: { "datadog.source": "vault" },
    });
    expect(volume.notes).toContainEqual({
      kind: ImportNoteKind.Approximation,
      text: LOG_GROUPS_LEFT_OUT,
      values: { facets: "env" },
    });

    const byToken: DashboardImportItem = itemNamed(
      vault,
      "All logs by client token",
    );

    expect(streamArguments(byToken).attributeFilterQuery).toBe(
      "@resource.service.name:vault",
    );
    expect(byToken.notes).toContainEqual({
      kind: ImportNoteKind.Info,
      text: LOG_INDEXES_LEFT_OUT,
      values: { indexes: "vault" },
    });

    for (const title of ["Vault Log Volume", "Requests by mount type"]) {
      const item: DashboardImportItem = itemNamed(vault, title);

      expect(item.status).toBe(ImportItemStatus.NotConverted);
      expect(texts(item.notes)).toEqual([LOG_WIDGET_NOT_SUPPORTED]);
    }

    // Its variables on log facets narrow by the facet's path.
    expect(
      vault.variables.find(
        (variable: DashboardImportPlan["variables"][number]): boolean => {
          return variable.sourceName === "auth.client_token";
        },
      )?.variable?.attributeKey,
    ).toBe("auth.client_token");
  });

  test("a log chart's formula over two counts, a count of unique values and a list of patterns are not converted, each with why", () => {
    const plan: DashboardImportPlan = dashboardOf({
      title: "Checkout logs",
      layout_type: "ordered",
      widgets: [
        {
          definition: {
            type: "timeseries",
            title: "Error rate",
            requests: [
              {
                queries: [
                  {
                    data_source: "logs",
                    name: "errors",
                    search: { query: "service:checkout status:error" },
                    compute: { aggregation: "count" },
                  },
                  {
                    data_source: "logs",
                    name: "all",
                    search: { query: "service:checkout" },
                    compute: { aggregation: "count" },
                  },
                ],
                formulas: [{ formula: "errors / all * 100" }],
                display_type: "line",
              },
            ],
          },
        },
        {
          definition: {
            type: "timeseries",
            title: "Users seen",
            requests: [
              {
                queries: [
                  {
                    data_source: "logs",
                    name: "users",
                    search: { query: "service:checkout" },
                    compute: { aggregation: "cardinality", metric: "@usr.id" },
                  },
                ],
                formulas: [{ formula: "users" }],
              },
            ],
          },
        },
        {
          definition: {
            type: "list_stream",
            title: "Patterns",
            requests: [
              {
                response_format: "event_list",
                query: {
                  data_source: "logs_pattern_stream",
                  query_string: "service:checkout",
                },
                columns: [],
              },
            ],
          },
        },
        {
          definition: {
            type: "timeseries",
            title: "Errors and warnings",
            requests: [
              {
                queries: [
                  {
                    data_source: "logs",
                    name: "q1",
                    search: { query: "service:checkout status:error" },
                    compute: { aggregation: "count" },
                  },
                  {
                    data_source: "logs",
                    name: "q2",
                    search: { query: "service:checkout status:warn" },
                    compute: { aggregation: "count" },
                  },
                ],
                formulas: [{ formula: "q1" }, { formula: "q2" }],
                display_type: "line",
              },
            ],
          },
        },
      ],
    });

    expect(itemNamed(plan, "Error rate").notes).toEqual([
      { kind: ImportNoteKind.Reason, text: LOG_FORMULA_NOT_CONVERTED },
    ]);
    expect(itemNamed(plan, "Users seen").notes).toEqual([
      {
        kind: ImportNoteKind.Reason,
        text: LOG_COMPUTES_OTHER,
        values: { aggregation: "cardinality(@usr.id)" },
      },
    ]);
    expect(itemNamed(plan, "Patterns").notes).toEqual([
      {
        kind: ImportNoteKind.Reason,
        text: LOG_WIDGET_NOT_SUPPORTED,
        values: { type: "list_stream (logs_pattern_stream)" },
      },
    ]);

    const stream: DashboardImportItem = itemNamed(
      dashboardOf({
        title: "Checkout logs",
        layout_type: "ordered",
        widgets: [
          {
            definition: {
              type: "log_stream",
              title: "Errors and warnings",
              query: "service:checkout status:(error OR warn)",
            },
          },
        ],
      }),
      "Errors and warnings",
    );

    // A Log Stream filters on one severity: two are left out, said.
    expect(streamArguments(stream).severityFilter).toBeUndefined();
    expect(texts(stream.notes)).toEqual([
      LOG_STATUSES_SHARED,
      LOG_ONE_SEVERITY,
    ]);

    const both: DashboardImportItem = itemNamed(plan, "Errors and warnings");

    expect(chartArguments(both)).toEqual({
      chartType: DashboardChartType.Line,
      title: "Errors and warnings",
      severityFilters: [LogSeverity.Error],
      attributeFilters: { "resource.service.name": "checkout" },
    });
    expect(both.notes).toContainEqual({
      kind: ImportNoteKind.Approximation,
      text: WIDGET_SHOWS_FIRST_QUERY,
      values: { count: "2" },
    });
  });
});

describe("a Datadog log monitor's query, read", () => {
  test("its search, index, rollup, facets, window, comparison and threshold", () => {
    expect(
      parseDatadogLogMonitorQuery(
        'logs("source:cisco-aci @cisco_aci.severity:critical").index("*").rollup("count").by("@cisco_aci.code,@cisco_aci.dn").last("5m") > 0',
      ),
    ).toEqual({
      search: "source:cisco-aci @cisco_aci.severity:critical",
      indexes: ["*"],
      rollup: "count",
      measure: "",
      groupBy: ["@cisco_aci.code", "@cisco_aci.dn"],
      window: "5m",
      comparison: ">",
      threshold: 0,
    });
    expect(
      parseDatadogLogMonitorQuery(
        'logs("@msg:\\"quoted\\" x").rollup("avg", "@duration").last("1h") <= 2.5',
      ),
    ).toEqual({
      search: '@msg:"quoted" x',
      indexes: [],
      rollup: "avg",
      measure: "@duration",
      groupBy: [],
      window: "1h",
      comparison: "<=",
      threshold: 2.5,
    });
  });

  test("what is not a log monitor's query is refused, with what it should start with", () => {
    for (const text of [
      'formula("query1 / query2").last("1d") > 10',
      'logs("x").last("5m")',
      'logs("x").bogus("y").last("5m") > 1',
      'logs("x',
    ]) {
      expect(() => {
        parseDatadogLogMonitorQuery(text);
      }).toThrow();
    }
  });
});

describe("Datadog's own log monitors", () => {
  test("Cisco ACI's critical faults: a Logs monitor over their source and severity, one alert per fault, exactly", () => {
    const item: AlertImportItem = monitorOf(
      "datadog-monitor-cisco-aci-critical-fault.json",
    );

    expect(item.status).toBe(ImportItemStatus.Exact);
    expect(item.rule?.kind).toBe(ImportedAlertRuleKind.LogCount);
    expect(item.rule?.logQuery).toEqual({
      attributes: {
        "datadog.source": "cisco-aci",
        "cisco_aci.severity": "critical",
      },
      bodyContains: "",
      severityTexts: [],
      groupByAttributes: [
        "cisco_aci.code",
        "cisco_aci.dn",
        "cisco_aci.severity",
      ],
      searchText: "@datadog.source:cisco-aci @cisco_aci.severity:critical",
    });
    expect(item.rule?.filterType).toBe(FilterType.GreaterThan);
    expect(item.rule?.threshold).toBe(0);
    expect(item.rule?.windowInSeconds).toBe(300);
    // The groups' values in its text, by the attributes it groups by.
    expect(item.rule?.title).toBe(
      "[Cisco ACI] critical fault received, {{cisco_aci.severity}} severity, code {{cisco_aci.code}}, dn {{cisco_aci.dn}}",
    );
  });

  test("FoundationDB's and Squid's comparisons on a facet are left out, said; the host groups by the resource's", () => {
    const fdb: AlertImportItem = monitorOf(
      "datadog-monitor-foundationdb-errors-logged.json",
    );

    expect(fdb.status).toBe(ImportItemStatus.Approximate);
    expect(fdb.rule?.logQuery?.attributes).toEqual({
      "resource.service.name": "foundationdb",
    });
    expect(fdb.rule?.logQuery?.groupByAttributes).toEqual([
      "resource.host.name",
    ]);
    expect(fdb.rule?.windowInSeconds).toBe(600);
    expect(fdb.notes).toEqual([
      {
        kind: ImportNoteKind.Approximation,
        text: LOG_TERM_NOT_EXACT,
        values: { term: "@Severity:>=40" },
      },
      {
        kind: ImportNoteKind.Approximation,
        text: MONITOR_WARNING_LEFT_OUT,
        values: { warning: "1" },
      },
    ]);

    const squid: AlertImportItem = monitorOf(
      "datadog-monitor-squid-high-latency.json",
    );

    expect(squid.rule?.filterType).toBe(FilterType.GreaterThanOrEqualTo);
    expect(squid.rule?.threshold).toBe(5);
    // Priority 4: a warning.
    expect(squid.rule?.severity).toBe(ImportedAlertSeverity.Warning);
    expect(texts(squid.notes)).toContain(LOG_TERM_NOT_EXACT);
  });

  test("Zscaler's connector group: a facet's value alone in its text is the group's", () => {
    const item: AlertImportItem = monitorOf(
      "datadog-monitor-zscaler-connector-cpu.json",
    );

    expect(item.rule?.logQuery?.groupByAttributes).toEqual(["Connector"]);
    expect(item.rule?.description).toContain("`{{Connector}}`");
  });

  test("iboss's average of a measure and SNMP's formula of two searches are not converted, each with why", () => {
    const iboss: AlertImportItem = monitorOf(
      "datadog-monitor-iboss-peer-time.json",
    );

    expect(iboss.status).toBe(ImportItemStatus.NotConverted);
    expect(iboss.notes).toEqual([
      {
        kind: ImportNoteKind.Reason,
        text: LOG_COMPUTES_OTHER,
        values: { aggregation: "avg(@iboss.serverPeerTime)" },
      },
    ]);

    const snmp: AlertImportItem = monitorOf(
      "datadog-monitor-snmp-link-down.json",
    );

    expect(snmp.status).toBe(ImportItemStatus.NotConverted);
    expect(texts(snmp.notes)).toEqual([MONITOR_QUERY_NOT_READ]);
  });

  test("a log monitor becomes a Logs monitor's step, which the form reads back as the rule", () => {
    const item: AlertImportItem = monitorOf(
      "datadog-monitor-cisco-aci-critical-fault.json",
    );
    const seeds: AlertImportSeeds = {
      operationalStatusId: ObjectID.generate(),
      degradedStatusId: ObjectID.generate(),
      offlineStatusId: ObjectID.generate(),
      rankedIncidentSeverityIds: [ObjectID.generate()],
      rankedAlertSeverityIds: [ObjectID.generate()],
    };
    const rule: NonNullable<AlertImportItem["rule"]> = item.rule!;

    expect(getImportedMonitorType(rule)).toBe(MonitorType.Logs);

    const steps: MonitorSteps = buildImportedMonitorSteps({
      rule,
      monitorName: "Cisco ACI critical fault",
      seeds,
      action: AlertImportAction.Alert,
    });

    expect(MonitorSteps.getValidationError(steps, MonitorType.Logs)).toBeNull();

    const logMonitor: MonitorStepLogMonitor | undefined =
      steps.data?.monitorStepsInstanceArray[0]?.data?.logMonitor;

    expect(logMonitor?.attributes).toEqual({
      "datadog.source": "cisco-aci",
      "cisco_aci.severity": "critical",
    });
    expect(logMonitor?.lastXSecondsOfLogs).toBe(300);
    expect(logMonitor?.groupByAttributes).toEqual([
      "cisco_aci.code",
      "cisco_aci.dn",
      "cisco_aci.severity",
    ]);
    expect(logMonitor?.severityTexts).toEqual([]);

    const read: TelemetryAlertRuleReadResult = TelemetryAlertRuleUtil.read({
      monitorType: MonitorType.Logs,
      monitorStep: steps.data?.monitorStepsInstanceArray[0] as MonitorStep,
      defaultMonitorStatusId: seeds.operationalStatusId,
    });

    expect(read.problem).toBeNull();

    const written: TelemetryAlertRule | null = read.rule;

    expect(written?.filterType).toBe(FilterType.GreaterThan);
    expect(written?.threshold).toBe(0);
    expect(written?.windowInSeconds).toBe(300);
    expect(written?.alert?.title).toBe(rule.title);
  });

  test("a log monitor's severities and text are the Logs monitor's", () => {
    const steps: MonitorSteps = buildImportedMonitorSteps({
      rule: {
        kind: ImportedAlertRuleKind.LogCount,
        promQL: "",
        logQuery: {
          attributes: { "resource.service.name": "checkout" },
          bodyContains: "timeout",
          severityTexts: [LogSeverity.Error, LogSeverity.Fatal],
          groupByAttributes: [],
          searchText: "",
        },
        filterType: FilterType.GreaterThan,
        threshold: 10,
        rollingTime: RollingTime.Past15Minutes,
        windowInSeconds: 900,
        aggregation: EvaluateOverTimeType.Sum,
        onNoData: NoDataPolicy.Ignore,
        severity: ImportedAlertSeverity.Critical,
        title: "Checkout times out",
        description: "",
        monitorDescription: "",
      },
      monitorName: "Checkout times out",
      seeds: {
        operationalStatusId: ObjectID.generate(),
        offlineStatusId: ObjectID.generate(),
        rankedIncidentSeverityIds: [],
        rankedAlertSeverityIds: [],
      },
      action: AlertImportAction.Incident,
    });
    const logMonitor: MonitorStepLogMonitor | undefined =
      steps.data?.monitorStepsInstanceArray[0]?.data?.logMonitor;

    expect(logMonitor?.body).toBe("timeout");
    expect(logMonitor?.severityTexts).toEqual([
      LogSeverity.Error,
      LogSeverity.Fatal,
    ]);
    expect(logMonitor?.lastXSecondsOfLogs).toBe(900);
  });
});
