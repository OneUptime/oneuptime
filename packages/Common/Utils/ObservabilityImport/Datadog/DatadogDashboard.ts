import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { DataSourceValueReduce } from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceValueComponent";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import {
  ConvertedQuery,
  DashboardImportItem,
  DashboardImportPlan,
  DashboardImportVariable,
  IMPORT_MAX_ITEMS,
  ImportAiCandidate,
  ImportItemStatus,
  ImportNote,
  ImportNoteKind,
  ImportQueryOverrides,
  ImportSourceKind,
  ImportStatusUtil,
  NO_QUERY_OVERRIDES,
} from "../../../Types/ObservabilityImport/ObservabilityImport";
import ObjectID from "../../../Types/ObjectID";
import { translationKey } from "../../../Types/Translator";
import { layOutImportedComponents, PlacedComponent } from "../ImportLayout";
import {
  ImportObject,
  arrayField,
  asObject,
  field,
  numberField,
  objectField,
  textField,
} from "../ImportValues";
import {
  ImportedQuery,
  buildChartWidget,
  buildTableWidget,
  buildTextWidget,
  buildValueWidget,
} from "../ImportWidgets";
import {
  DatadogConversionOptions,
  DatadogMetricKind,
  DatadogQueryContext,
  collectDatadogMetricNames,
  convertDatadogQuery,
  mergeDatadogNotes,
  readDatadogMetricNames,
} from "./DatadogPromQL";
import {
  DatadogExpression,
  parseDatadogExpression,
} from "./DatadogQueryParser";
import { DASHBOARD_PANELS_LEFT_OUT } from "../Grafana/GrafanaDashboard";

/*
 * A DATADOG DASHBOARD, AS A ONEUPTIME DASHBOARD (issue #7697).
 *
 * Read from Datadog's Export dashboard JSON (or GET /api/v1/dashboard/<id>).
 * Each widget's metric queries and formulas become PromQL over what the
 * Datadog Agent sent OneUptime (DatadogPromQL):
 *
 *   timeseries             Chart, every formula on the one chart
 *   query_value            Value
 *   toplist, query_table   Table
 *   note, free_text        Text
 *   image                  Text, as an image
 *   group                  a heading, its widgets after it
 *
 * A template variable with a prefix becomes the dashboard's variable on
 * that tag. What reads logs, traces, RUM or events, and widgets OneUptime
 * has no like of, are listed with why.
 */

// An address a browser can open: an image's, a link's.
const WEB_ADDRESS: RegExp = /^https?:\/\//i;

export const WIDGET_TYPE_NOT_SUPPORTED: string = translationKey(
  "OneUptime has no widget like Datadog's {{type}} widget.",
);

export const WIDGET_READS_OTHER_DATA: string = translationKey(
  "It reads Datadog's {{source}}, not metrics. OneUptime converts metric queries.",
);

export const WIDGET_NO_QUERIES: string = translationKey("It has no queries.");

export const WIDGET_SHOWS_FIRST_QUERY: string = translationKey(
  "This widget shows one query, the first: Datadog showed {{count}}.",
);

export const WIDGET_QUERY_LEFT_OUT: string = translationKey(
  "Its query {{name}} is left out.",
);

export const WIDGET_TOPLIST_AS_TABLE: string = translationKey(
  "Datadog ranks the series in a list; OneUptime lists their values in a table.",
);

export const WIDGET_CONDITIONAL_FORMATS: string = translationKey(
  "Datadog's conditional formats are not kept as thresholds.",
);

export const VARIABLE_WITHOUT_PREFIX: string = translationKey(
  "This variable takes a whole tag, which OneUptime's variables do not: the queries leave it out.",
);

export const VARIABLE_AVAILABLE_VALUES: string = translationKey(
  "Datadog offers only some values; OneUptime lists every value of {{tag}} in the project's metrics.",
);

// Datadog's widgets of something other than metrics, and what they read.
const OTHER_DATA_WIDGETS: ReadonlyMap<string, string> = new Map<string, string>(
  [
    ["log_stream", "logs"],
    ["list_stream", "logs"],
    ["event_stream", "events"],
    ["event_timeline", "events"],
    ["check_status", "service checks"],
    ["manage_status", "monitors"],
    ["alert_graph", "monitors"],
    ["alert_value", "monitors"],
    ["slo", "SLOs"],
    ["slo_list", "SLOs"],
    ["trace_service", "traces"],
    ["servicemap", "traces"],
  ],
);

// What Datadog's widget reads when it is not metrics.
const OTHER_DATA: ReadonlyMap<string, string> = new Map<string, string>([
  ["log_query", "logs"],
  ["apm_query", "traces"],
  ["process_query", "processes"],
  ["rum_query", "RUM"],
  ["event_query", "events"],
  ["security_query", "security signals"],
  ["network_query", "network"],
  ["profile_metrics_query", "profiles"],
  ["audit_query", "audit logs"],
]);

const REDUCERS: ReadonlyMap<string, DataSourceValueReduce> = new Map<
  string,
  DataSourceValueReduce
>([
  ["avg", DataSourceValueReduce.Avg],
  ["last", DataSourceValueReduce.Last],
  ["sum", DataSourceValueReduce.Sum],
  ["max", DataSourceValueReduce.Max],
  ["min", DataSourceValueReduce.Min],
]);

// Datadog's canonical unit names, in a widget's unit.
const UNITS: ReadonlyMap<string, string> = new Map<string, string>([
  ["percent", "%"],
  ["byte", "bytes"],
  ["millisecond", "ms"],
  ["second", "s"],
  ["microsecond", "us"],
  ["nanosecond", "ns"],
]);

interface WidgetQuery {
  name: string;
  query: string;
  aggregator: string;
}

interface WidgetSeries {
  // The text converted: a formula over the queries, or a query.
  text: string;
  legend?: string | undefined;
  key: string;
  // Its request's queries by name: each request names its own query1.
  namedQueries: Map<string, DatadogExpression>;
}

interface ReadRequests {
  series: Array<WidgetSeries>;
  aggregator: string;
  otherData: Array<string>;
  unit: string;
}

// A widget's requests: its series, the queries they read, what else it reads.
const readRequests: (definition: ImportObject) => ReadRequests = (
  definition: ImportObject,
): ReadRequests => {
  const value: unknown = field(definition, "requests");
  const requests: Array<ImportObject> = (Array.isArray(value) ? value : [value])
    .map(asObject)
    .filter((request: ImportObject | undefined): boolean => {
      return Boolean(request);
    }) as Array<ImportObject>;

  const series: Array<WidgetSeries> = [];
  const otherData: Array<string> = [];
  let aggregator: string = textField(definition, "aggregator");
  let unit: string = "";

  requests.forEach((request: ImportObject, requestIndex: number) => {
    // Each request names its own queries: query1 is this request's.
    const namedQueries: Map<string, DatadogExpression> = new Map<
      string,
      DatadogExpression
    >();

    for (const [key, name] of OTHER_DATA.entries()) {
      if (field(request, key) !== undefined) {
        otherData.push(name);
      }
    }

    aggregator = aggregator || textField(request, "aggregator");

    const oldQuery: string = textField(request, "q");

    if (oldQuery) {
      series.push({
        text: oldQuery,
        key: `request-${requestIndex}`,
        legend: textField(request, "alias") || undefined,
        namedQueries,
      });
      return;
    }

    const queries: Array<WidgetQuery> = [];

    for (const item of arrayField(request, "queries")) {
      const query: ImportObject | undefined = asObject(item);
      const dataSource: string = textField(query, "data_source") || "metrics";

      if (dataSource !== "metrics") {
        otherData.push(dataSource);
        continue;
      }

      queries.push({
        name: textField(query, "name"),
        query: textField(query, "query"),
        aggregator: textField(query, "aggregator"),
      });
    }

    for (const query of queries) {
      aggregator = aggregator || query.aggregator;

      try {
        if (query.name) {
          namedQueries.set(query.name, parseDatadogExpression(query.query));
        }
      } catch {
        // Said when a formula reads it: its series is not converted.
      }
    }

    const formulas: Array<ImportObject> = arrayField(request, "formulas")
      .map(asObject)
      .filter((formula: ImportObject | undefined): boolean => {
        return Boolean(formula) && textField(formula, "formula") !== "";
      }) as Array<ImportObject>;

    if (formulas.length > 0) {
      formulas.forEach((formula: ImportObject, formulaIndex: number) => {
        // number_format: {"unit": {"type": "canonical_unit", "unit_name": "percent"}}
        const unitName: string = textField(
          objectField(objectField(formula, "number_format"), "unit"),
          "unit_name",
        );

        unit = unit || UNITS.get(unitName) || "";

        series.push({
          text: textField(formula, "formula"),
          key: `request-${requestIndex}-formula-${formulaIndex}`,
          legend: textField(formula, "alias") || undefined,
          namedQueries,
        });
      });
      return;
    }

    for (const query of queries) {
      series.push({
        text: query.query,
        key: `request-${requestIndex}-${query.name || queries.indexOf(query)}`,
        namedQueries,
      });
    }
  });

  return { series, aggregator, otherData, unit };
};

const newVariable: (data: {
  name: string;
  prefix: string;
}) => DashboardVariable = (data: {
  name: string;
  prefix: string;
}): DashboardVariable => {
  return {
    id: ObjectID.generate().toString(),
    name: data.name,
    type: DashboardVariableType.TelemetryAttribute,
    attributeKey: data.prefix,
  };
};

const convertVariables: (document: ImportObject) => {
  variables: Array<DashboardImportVariable>;
  prefixes: Map<string, string>;
} = (
  document: ImportObject,
): {
  variables: Array<DashboardImportVariable>;
  prefixes: Map<string, string>;
} => {
  const variables: Array<DashboardImportVariable> = [];
  const prefixes: Map<string, string> = new Map<string, string>();

  arrayField(document, "template_variables").forEach(
    (item: unknown, index: number) => {
      const source: ImportObject | undefined = asObject(item);
      const name: string = textField(source, "name");

      if (!source || !name || prefixes.has(name)) {
        return;
      }

      const prefix: string = textField(source, "prefix");
      const base: Pick<
        DashboardImportVariable,
        "key" | "sourceName" | "sourceType"
      > = {
        key: `variable-${index}`,
        sourceName: name,
        sourceType: "template variable",
      };

      if (!prefix) {
        variables.push({
          ...base,
          status: ImportItemStatus.NotConverted,
          notes: [
            { kind: ImportNoteKind.Reason, text: VARIABLE_WITHOUT_PREFIX },
          ],
        });
        return;
      }

      prefixes.set(name, prefix);

      const variable: DashboardVariable = newVariable({ name, prefix });
      const notes: Array<ImportNote> = [];
      const defaults: Array<string> = arrayField(source, "defaults")
        .filter((value: unknown): boolean => {
          return typeof value === "string" && value !== "*" && value !== "";
        })
        .map((value: unknown): string => {
          return value as string;
        });
      const single: string = textField(source, "default");

      if (defaults.length > 1) {
        variable.isMultiSelect = true;
        variable.selectedValues = defaults;
      } else if (defaults.length === 1) {
        variable.defaultValue = defaults[0];
      } else if (single && single !== "*") {
        variable.defaultValue = single;
      }

      if (arrayField(source, "available_values").length > 0) {
        notes.push({
          kind: ImportNoteKind.Approximation,
          text: VARIABLE_AVAILABLE_VALUES,
          values: { tag: prefix },
        });
      }

      variables.push({
        ...base,
        status: ImportStatusUtil.fromNotes(notes),
        notes,
        variable,
      });
    },
  );

  return { variables, prefixes };
};

interface FlatWidget {
  definition: ImportObject;
  order: number;
  x: number;
  width: number;
  height: number;
  isHeading: boolean;
}

// The dashboard's widgets in order, a group's after its heading.
const flattenWidgets: (document: ImportObject) => Array<FlatWidget> = (
  document: ImportObject,
): Array<FlatWidget> => {
  const flat: Array<FlatWidget> = [];
  const isFree: boolean = textField(document, "layout_type") === "free";

  const visit: (widgets: Array<unknown>) => void = (
    widgets: Array<unknown>,
  ): void => {
    const ordered: Array<{ widget: ImportObject; y: number; x: number }> =
      widgets
        .map(asObject)
        .filter((widget: ImportObject | undefined): boolean => {
          return Boolean(widget && objectField(widget, "definition"));
        })
        .map((widget: ImportObject | undefined, index: number) => {
          const layout: ImportObject | undefined = objectField(
            widget,
            "layout",
          );
          return {
            widget: widget as ImportObject,
            y: numberField(layout, "y") ?? index * 1000,
            x: numberField(layout, "x") ?? 0,
          };
        })
        .sort(
          (
            a: { widget: ImportObject; y: number; x: number },
            b: { widget: ImportObject; y: number; x: number },
          ): number => {
            return a.y - b.y || a.x - b.x;
          },
        );

    for (const item of ordered) {
      const definition: ImportObject = objectField(
        item.widget,
        "definition",
      ) as ImportObject;
      const layout: ImportObject | undefined = objectField(
        item.widget,
        "layout",
      );
      const type: string = textField(definition, "type");

      if (type === "group") {
        flat.push({
          definition,
          order: flat.length,
          x: 0,
          width: 12,
          height: 1,
          isHeading: true,
        });
        visit(arrayField(definition, "widgets"));
        continue;
      }

      flat.push({
        definition,
        order: flat.length,
        x: isFree ? 0 : numberField(layout, "x") ?? 0,
        width: isFree ? 6 : numberField(layout, "width") ?? 6,
        height: isFree
          ? 3
          : Math.max(1, Math.round((numberField(layout, "height") ?? 2) * 1.5)),
        isHeading: false,
      });
    }
  };

  visit(arrayField(document, "widgets"));

  return flat;
};

const chartTypeOf: (definition: ImportObject) => DashboardChartType = (
  definition: ImportObject,
): DashboardChartType => {
  const first: ImportObject | undefined = asObject(
    arrayField(definition, "requests")[0],
  );
  const display: string = textField(first, "display_type");

  if (display === "bars") {
    return DashboardChartType.Bar;
  }

  // Datadog stacks an area of several series.
  if (display === "area") {
    return DashboardChartType.StackedArea;
  }

  return DashboardChartType.Line;
};

// A query value's conditional formats as a widget's thresholds.
const readConditionalFormats: (definition: ImportObject) => {
  warning?: number | undefined;
  critical?: number | undefined;
  note?: ImportNote | undefined;
} = (
  definition: ImportObject,
): {
  warning?: number | undefined;
  critical?: number | undefined;
  note?: ImportNote | undefined;
} => {
  const first: ImportObject | undefined = asObject(
    arrayField(definition, "requests")[0],
  );
  const formats: Array<ImportObject> = arrayField(first, "conditional_formats")
    .map(asObject)
    .filter((format: ImportObject | undefined): boolean => {
      return Boolean(format);
    }) as Array<ImportObject>;

  if (formats.length === 0) {
    return {};
  }

  let warning: number | undefined = undefined;
  let critical: number | undefined = undefined;
  let kept: boolean = true;

  for (const format of formats) {
    const comparator: string = textField(format, "comparator");
    const value: number | undefined = numberField(format, "value");
    const palette: string = textField(format, "palette");

    if (value === undefined || (comparator !== ">" && comparator !== ">=")) {
      if (palette.includes("red") || palette.includes("yellow")) {
        kept = false;
      }
      continue;
    }

    if (palette.includes("red")) {
      critical = critical === undefined ? value : Math.min(critical, value);
    } else if (palette.includes("yellow") || palette.includes("orange")) {
      warning = warning === undefined ? value : Math.min(warning, value);
    }
  }

  return {
    warning,
    critical,
    ...(kept
      ? {}
      : {
          note: {
            kind: ImportNoteKind.Approximation,
            text: WIDGET_CONDITIONAL_FORMATS,
          },
        }),
  };
};

const notConverted: (data: {
  key: string;
  title: string;
  sourceType: string;
  reasons: Array<ImportNote>;
  aiCandidate?: ImportAiCandidate | undefined;
}) => DashboardImportItem = (data: {
  key: string;
  title: string;
  sourceType: string;
  reasons: Array<ImportNote>;
  aiCandidate?: ImportAiCandidate | undefined;
}): DashboardImportItem => {
  return {
    key: data.key,
    title: data.title,
    sourceType: data.sourceType,
    status: ImportItemStatus.NotConverted,
    notes: data.reasons,
    queries: [],
    ...(data.aiCandidate ? { aiCandidate: data.aiCandidate } : {}),
  };
};

const convertWidget: (data: {
  flat: FlatWidget;
  key: string;
  prefixes: Map<string, string>;
  queryOverrides: ImportQueryOverrides;
  knownMetricKinds?: ReadonlyMap<string, DatadogMetricKind> | undefined;
}) => DashboardImportItem = (data: {
  flat: FlatWidget;
  key: string;
  prefixes: Map<string, string>;
  queryOverrides: ImportQueryOverrides;
  knownMetricKinds?: ReadonlyMap<string, DatadogMetricKind> | undefined;
}): DashboardImportItem => {
  const definition: ImportObject = data.flat.definition;
  const type: string = textField(definition, "type");
  const title: string = textField(definition, "title");
  const base: Pick<DashboardImportItem, "key" | "title" | "sourceType"> = {
    key: data.key,
    title,
    sourceType: type,
  };

  if (type === "group") {
    return {
      ...base,
      status: ImportItemStatus.Exact,
      notes: [],
      queries: [],
      component: buildTextWidget({
        text: title ? `## ${title}` : "",
        isMarkdown: true,
      }),
    };
  }

  if (type === "note" || type === "free_text") {
    const content: string =
      textField(definition, "content") || textField(definition, "text");

    return {
      ...base,
      title: title || content.split("\n")[0] || "",
      status: ImportItemStatus.Exact,
      notes: [],
      queries: [],
      component: buildTextWidget({ text: content, isMarkdown: true }),
    };
  }

  if (type === "image") {
    const url: string = textField(definition, "url");

    if (!WEB_ADDRESS.test(url)) {
      return notConverted({
        ...base,
        reasons: [
          {
            kind: ImportNoteKind.Reason,
            text: WIDGET_TYPE_NOT_SUPPORTED,
            values: { type },
          },
        ],
      });
    }

    return {
      ...base,
      status: ImportItemStatus.Exact,
      notes: [],
      queries: [],
      component: buildTextWidget({ text: `![](${url})`, isMarkdown: true }),
    };
  }

  const isWidgetWithQueries: boolean = [
    "timeseries",
    "query_value",
    "toplist",
    "query_table",
  ].includes(type);

  if (!isWidgetWithQueries) {
    // A widget of logs, events or monitors reads no metric to convert.
    const source: string | undefined = OTHER_DATA_WIDGETS.get(type);

    return notConverted({
      ...base,
      reasons: [
        source
          ? {
              kind: ImportNoteKind.Reason,
              text: WIDGET_READS_OTHER_DATA,
              values: { source },
            }
          : {
              kind: ImportNoteKind.Reason,
              text: WIDGET_TYPE_NOT_SUPPORTED,
              values: { type: type || "unknown" },
            },
      ],
    });
  }

  const requests: ReadRequests = readRequests(definition);

  if (requests.series.length === 0) {
    if (requests.otherData.length > 0) {
      return notConverted({
        ...base,
        reasons: [
          {
            kind: ImportNoteKind.Reason,
            text: WIDGET_READS_OTHER_DATA,
            values: {
              source: Array.from(new Set(requests.otherData)).join(", "),
            },
          },
        ],
      });
    }

    return notConverted({
      ...base,
      reasons: [{ kind: ImportNoteKind.Reason, text: WIDGET_NO_QUERIES }],
    });
  }

  const notes: Array<ImportNote> = [];
  const queries: Array<ImportedQuery> = [];
  const converted: Array<ConvertedQuery> = [];
  const reasons: Array<ImportNote> = [];
  let aiCandidate: ImportAiCandidate | undefined = undefined;
  const leftOut: Array<string> = [];

  for (const series of requests.series) {
    const targetKey: string = `${data.key}:${series.key}`;
    const options: DatadogConversionOptions = {
      context: DatadogQueryContext.Dashboard,
      variablePrefixes: data.prefixes,
      namedQueries: series.namedQueries,
      knownMetricKinds: data.knownMetricKinds,
    };
    const result: ConvertedQuery = convertDatadogQuery({
      query: series.text,
      options,
      aiQuery: data.queryOverrides.get(targetKey),
    });

    if (result.status === ImportItemStatus.NotConverted) {
      reasons.push(...result.notes);
      leftOut.push(series.legend || series.text);

      if (!aiCandidate && result.aiCandidate) {
        aiCandidate = { ...result.aiCandidate, targetKey };
      }

      continue;
    }

    notes.push(...result.notes);
    converted.push(result);
    queries.push({ promQL: result.promQL, legend: series.legend });
  }

  if (queries.length === 0) {
    return notConverted({ ...base, reasons, aiCandidate });
  }

  if (leftOut.length > 0) {
    for (const name of leftOut) {
      notes.push({
        kind: ImportNoteKind.Approximation,
        text: WIDGET_QUERY_LEFT_OUT,
        values: { name },
      });
    }

    notes.push(
      ...reasons.map((reason: ImportNote): ImportNote => {
        return { ...reason, kind: ImportNoteKind.Info };
      }),
    );
  }

  // One note of each kind, however many queries said it.
  const distinct: Array<ImportNote> = mergeDatadogNotes(notes);

  const firstOnly: () => ImportedQuery = (): ImportedQuery => {
    if (queries.length > 1) {
      distinct.push({
        kind: ImportNoteKind.Approximation,
        text: WIDGET_SHOWS_FIRST_QUERY,
        values: { count: String(queries.length) },
      });
    }

    return queries[0]!;
  };

  let component: DashboardBaseComponent;

  if (type === "timeseries") {
    component = buildChartWidget({
      title,
      queries,
      chartType: chartTypeOf(definition),
      unit: requests.unit,
    });
  } else if (type === "query_value") {
    const reduce: DataSourceValueReduce =
      REDUCERS.get(requests.aggregator) || DataSourceValueReduce.Avg;
    const thresholds: ReturnType<typeof readConditionalFormats> =
      readConditionalFormats(definition);

    if (thresholds.note) {
      distinct.push(thresholds.note);
    }

    component = buildValueWidget({
      title,
      query: firstOnly(),
      reduce,
      unit: textField(definition, "custom_unit") || requests.unit,
      warningThreshold: thresholds.warning,
      criticalThreshold: thresholds.critical,
    });
  } else {
    if (type === "toplist") {
      distinct.push({
        kind: ImportNoteKind.Approximation,
        text: WIDGET_TOPLIST_AS_TABLE,
      });
    }

    component = buildTableWidget({ title, query: firstOnly() });
  }

  return {
    ...base,
    status: ImportStatusUtil.fromNotes(distinct),
    notes: distinct,
    queries: converted,
    component,
  };
};

/*
 * Every metric the dashboard's widgets read, by its Datadog name: what the
 * preview looks up to know a gauge from a count.
 */
export const listDatadogDashboardMetricNames: (
  document: ImportObject,
) => Array<string> = (document: ImportObject): Array<string> => {
  const names: Set<string> = new Set<string>();

  for (const widget of flattenWidgets(document)) {
    for (const series of readRequests(widget.definition).series) {
      for (const name of readDatadogMetricNames(series.text)) {
        names.add(name);
      }

      for (const query of series.namedQueries.values()) {
        collectDatadogMetricNames(query, names);
      }
    }
  }

  return Array.from(names).sort();
};

export interface DatadogDashboardOptions {
  queryOverrides?: ImportQueryOverrides | undefined;
  /*
   * What the project's metrics say each Datadog metric is, by its Datadog
   * name, when the preview could read it: a gauge or a count is then read
   * as one, rather than assumed a gauge.
   */
  knownMetricKinds?: ReadonlyMap<string, DatadogMetricKind> | undefined;
}

export const convertDatadogDashboard: (
  document: ImportObject,
  options?: DatadogDashboardOptions,
) => DashboardImportPlan = (
  document: ImportObject,
  options?: DatadogDashboardOptions,
): DashboardImportPlan => {
  const notes: Array<ImportNote> = [];
  const converted: ReturnType<typeof convertVariables> =
    convertVariables(document);
  const flat: Array<FlatWidget> = flattenWidgets(document);
  const items: Array<DashboardImportItem> = [];
  const placed: Array<PlacedComponent> = [];

  flat
    .slice(0, IMPORT_MAX_ITEMS)
    .forEach((widget: FlatWidget, index: number) => {
      const item: DashboardImportItem = convertWidget({
        flat: widget,
        key: `widget-${index}`,
        prefixes: converted.prefixes,
        queryOverrides: options?.queryOverrides || NO_QUERY_OVERRIDES,
        knownMetricKinds: options?.knownMetricKinds,
      });

      items.push(item);

      if (item.component) {
        placed.push({
          component: item.component,
          placement: {
            sourceRow: widget.order,
            sourceColumn: widget.x,
            width: widget.width,
            height: widget.height,
            startsLine: widget.isHeading,
          },
        });
      }
    });

  /*
   * Datadog lays a row's widgets side by side, each on its own `y`: the
   * order is kept, and each line is filled as far as 12 columns go.
   */
  const layout: ReturnType<typeof layOutImportedComponents> =
    layOutImportedComponents(
      placed.map((item: PlacedComponent): PlacedComponent => {
        return {
          ...item,
          placement: {
            ...item.placement,
            sourceRow: 0,
            sourceColumn: item.placement.sourceRow,
          },
        };
      }),
    );
  const byId: Map<string, DashboardBaseComponent> = new Map<
    string,
    DashboardBaseComponent
  >();

  for (const component of layout.components) {
    byId.set(component.componentId.toString(), component);
  }

  for (const item of items) {
    if (item.component) {
      item.component =
        byId.get(item.component.componentId.toString()) || item.component;
    }
  }

  if (flat.length > IMPORT_MAX_ITEMS) {
    notes.push({
      kind: ImportNoteKind.Approximation,
      text: DASHBOARD_PANELS_LEFT_OUT,
      values: { count: String(IMPORT_MAX_ITEMS) },
    });
  }

  return {
    source: ImportSourceKind.DatadogDashboard,
    title: textField(document, "title"),
    description: textField(document, "description"),
    items,
    variables: converted.variables,
    notes,
    viewConfigDefaults: {},
  };
};
