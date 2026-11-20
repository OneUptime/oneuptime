import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { DataSourceValueReduce } from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceValueComponent";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import { AutoRefreshInterval } from "../../../Types/Dashboard/DashboardViewConfig";
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
import TimeRange from "../../../Types/Time/TimeRange";
import { translationKey } from "../../../Types/Translator";
import {
  fromGrafanaHeight,
  fromGrafanaWidth,
  layOutImportedComponents,
  PlacedComponent,
} from "../ImportLayout";
import {
  ImportObject,
  arrayField,
  asObject,
  booleanField,
  field,
  numberField,
  objectField,
  textField,
} from "../ImportValues";
import {
  ImportedQuery,
  buildChartWidget,
  buildGaugeWidget,
  buildHtmlWidget,
  buildLogChartWidget,
  buildLogStreamWidget,
  buildTableWidget,
  buildTextWidget,
  buildValueWidget,
} from "../ImportWidgets";
import {
  GrafanaQueryVariables,
  convertGrafanaPromQL,
} from "../PromQLImportQuery";
import {
  ConvertedLokiQuery,
  convertLokiCountQuery,
  convertLokiLogQuery,
  looksLikeLogQL,
} from "./GrafanaLoki";
import {
  ConvertedThresholds,
  ConvertedUnit,
  convertGrafanaLegacyThresholds,
  convertGrafanaThresholds,
  convertGrafanaUnit,
  getGrafanaFieldNumber,
  getGrafanaPanelUnit,
  scaleQuery,
} from "./GrafanaUnits";

/*
 * A GRAFANA DASHBOARD, AS A ONEUPTIME DASHBOARD (issue #7697).
 *
 * Read from the JSON Grafana shows under Settings > JSON Model, saves with
 * Export > Save to file (with or without "Export for sharing externally")
 * or answers on /api/dashboards/uid/<uid>. Each panel becomes a widget that
 * runs its queries over the project's own metrics with PromQL - the data
 * Prometheus remote write, the Datadog Agent and OpenTelemetry send keep
 * the names Grafana's queries use:
 *
 *   timeseries, graph      Chart, every query on the one chart
 *   stat, singlestat       Value
 *   gauge                  Gauge
 *   bargauge               Chart (several queries) or Table (one)
 *   table                  Table
 *   piechart, barchart     Chart, as a pie or bars
 *   text                   Text (Markdown) or HTML
 *   logs (Loki)            Log Stream
 *   row                    a heading, its panels after it
 *
 * Its template variables become the dashboard's variables, its time range
 * and refresh the dashboard's defaults. What a panel shows differently is
 * said in its notes; a panel OneUptime has no widget for, or whose queries
 * read a data source other than Prometheus or Loki, is listed with why.
 */

export const PANEL_TYPE_NOT_SUPPORTED: string = translationKey(
  "OneUptime has no widget like Grafana's {{type}} panel.",
);

export const PANEL_READS_GRAFANA: string = translationKey(
  "Grafana's {{type}} panel shows Grafana's own records, not data.",
);

export const PANEL_LIBRARY_NOT_IN_FILE: string = translationKey(
  "This is a library panel, whose queries are not in this file. Export the dashboard again with Export for sharing externally on.",
);

export const PANEL_NO_QUERIES: string = translationKey("It has no queries.");

export const PANEL_DATA_SOURCE_NOT_READ: string = translationKey(
  "It reads a {{type}} data source. OneUptime reads a panel's Prometheus and Loki queries.",
);

export const PANEL_EXPRESSION_NOT_READ: string = translationKey(
  "It is a Grafana expression ({{type}}), which OneUptime does not run.",
);

export const PANEL_QUERY_LEFT_OUT: string = translationKey(
  "Query {{refId}} is left out.",
);

export const PANEL_SHOWS_FIRST_QUERY: string = translationKey(
  "This widget shows one query, the first: Grafana showed {{count}}.",
);

export const PANEL_REPEATED: string = translationKey(
  "Grafana repeats this panel for each value of ${{variable}}; OneUptime shows it once, for the values picked.",
);

export const PANEL_TRANSFORMATIONS: string = translationKey(
  "Grafana's transformations of the results ({{names}}) are not applied.",
);

export const PANEL_OVERRIDE_NOT_KEPT: string = translationKey(
  "Grafana's per-series override of {{property}} is not kept.",
);

export const PANEL_STYLE_OVERRIDES: string = translationKey(
  "Grafana's per-series colours and styles are not kept.",
);

export const PANEL_NEGATIVE_Y: string = translationKey(
  "Grafana draws some of its series below the axis; OneUptime draws them above it, with the same values.",
);

export const PANEL_VALUE_MAPPINGS: string = translationKey(
  "Grafana's value mappings, which show some values as text, are not kept.",
);

export const PANEL_REDUCE_NOT_KEPT: string = translationKey(
  "Grafana reduces the values to their {{calculation}}; OneUptime shows the last.",
);

export const PANEL_STACKED_PERCENT: string = translationKey(
  "Grafana stacks the series as shares of 100%; OneUptime stacks their values.",
);

export const PANEL_BAR_GAUGE_AS_CHART: string = translationKey(
  "Grafana draws a bar of each series' current value; OneUptime charts them over time.",
);

export const PANEL_BAR_GAUGE_AS_TABLE: string = translationKey(
  "Grafana draws a bar of each series' current value; OneUptime lists the values in a table.",
);

export const PANEL_PIE_FROM_CHART: string = translationKey(
  "Grafana's {{type}} panel is drawn as OneUptime's {{chart}} chart.",
);

export const PANEL_ROW_FOLDED: string = translationKey(
  "Grafana folds this row; OneUptime shows its panels open, under its heading.",
);

export const PANEL_LOGS_NOT_LOKI: string = translationKey(
  "A logs panel becomes a Log Stream from its Loki query; this one has none.",
);

export const PANEL_HTML: string = translationKey(
  "Drawn in an HTML widget, with scripts off.",
);

export const VARIABLE_DATA_SOURCE: string = translationKey(
  "Not needed: the widgets read this project's own metrics.",
);

export const VARIABLE_CONSTANT: string = translationKey(
  "Written into the queries as {{value}}.",
);

export const VARIABLE_LISTS_EVERY_VALUE: string = translationKey(
  "Lists every value of {{label}} in the project's metrics; Grafana listed those of {{selector}}.",
);

export const VARIABLE_LISTS_METRIC_VALUES: string = translationKey(
  "Lists the values of {{label}} that the project's metrics have; Grafana read Loki's.",
);

export const VARIABLE_REGEX_NOT_KEPT: string = translationKey(
  "Grafana's regex {{regex}}, which picks some of its values, is not applied.",
);

export const VARIABLE_ALL_VALUE: string = translationKey(
  "Grafana's All reads {{allValue}}; OneUptime's All matches every value.",
);

export const VARIABLE_QUERY_NOT_READ: string = translationKey(
  "OneUptime cannot list values for {{query}}: pick one by typing it.",
);

export const VARIABLE_TYPE_NOT_SUPPORTED: string = translationKey(
  "OneUptime has no variable like Grafana's {{type}} variable.",
);

export const VARIABLE_HIDDEN: string = translationKey(
  "Grafana hides this variable; OneUptime shows it on the dashboard.",
);

export const VARIABLE_AUTO_INTERVAL: string = translationKey(
  "Grafana's auto option is left out: pick an interval.",
);

export const DASHBOARD_TIME_RANGE_NEAREST: string = translationKey(
  "Grafana opens on {{from}} to {{to}}; OneUptime opens on {{range}}, the nearest range it has.",
);

export const DASHBOARD_REFRESH_NOT_KEPT: string = translationKey(
  "Grafana refreshes every {{refresh}}, which OneUptime's auto-refresh does not offer: it is off.",
);

export const DASHBOARD_PANELS_LEFT_OUT: string = translationKey(
  "Only the first {{count}} panels are imported.",
);

export const DASHBOARD_OLD_ROWS: string = translationKey(
  "This dashboard is in Grafana's old row layout: its panels are laid out row by row.",
);

// Grafana's panels that show Grafana's own records rather than data.
const GRAFANA_OWN_PANELS: ReadonlySet<string> = new Set<string>([
  "alertlist",
  "annolist",
  "dashlist",
  "news",
  "welcome",
  "gettingstarted",
  "pluginlist",
  "live",
]);

// Grafana's data sources whose queries OneUptime reads.
const PROMETHEUS: string = "prometheus";
const LOKI: string = "loki";
const MIXED: string = "mixed";
const EXPRESSION: string = "__expr__";
const GRAFANA_BUILT_IN: string = "grafana";

// Grafana's reduce calculations, as a Value widget reduces.
const REDUCERS: ReadonlyMap<string, DataSourceValueReduce> = new Map<
  string,
  DataSourceValueReduce
>([
  ["lastNotNull", DataSourceValueReduce.Last],
  ["last", DataSourceValueReduce.Last],
  ["current", DataSourceValueReduce.Last],
  ["first", DataSourceValueReduce.First],
  ["firstNotNull", DataSourceValueReduce.First],
  ["mean", DataSourceValueReduce.Avg],
  ["avg", DataSourceValueReduce.Avg],
  ["max", DataSourceValueReduce.Max],
  ["min", DataSourceValueReduce.Min],
  ["sum", DataSourceValueReduce.Sum],
  ["total", DataSourceValueReduce.Sum],
]);

// Relative time ranges the dashboard can open on, by their length.
const TIME_RANGES: ReadonlyArray<{ seconds: number; range: TimeRange }> = [
  { seconds: 5 * 60, range: TimeRange.PAST_FIVE_MINS },
  { seconds: 15 * 60, range: TimeRange.PAST_FIFTEEN_MINS },
  { seconds: 30 * 60, range: TimeRange.PAST_THIRTY_MINS },
  { seconds: 3600, range: TimeRange.PAST_ONE_HOUR },
  { seconds: 2 * 3600, range: TimeRange.PAST_TWO_HOURS },
  { seconds: 3 * 3600, range: TimeRange.PAST_THREE_HOURS },
  { seconds: 86400, range: TimeRange.PAST_ONE_DAY },
  { seconds: 2 * 86400, range: TimeRange.PAST_TWO_DAYS },
  { seconds: 7 * 86400, range: TimeRange.PAST_ONE_WEEK },
  { seconds: 14 * 86400, range: TimeRange.PAST_TWO_WEEKS },
  { seconds: 30 * 86400, range: TimeRange.PAST_ONE_MONTH },
  { seconds: 90 * 86400, range: TimeRange.PAST_THREE_MONTHS },
];

const REFRESH_INTERVALS: ReadonlyMap<string, AutoRefreshInterval> = new Map<
  string,
  AutoRefreshInterval
>([
  ["5s", AutoRefreshInterval.FIVE_SECONDS],
  ["10s", AutoRefreshInterval.TEN_SECONDS],
  ["30s", AutoRefreshInterval.THIRTY_SECONDS],
  ["1m", AutoRefreshInterval.ONE_MINUTE],
  ["5m", AutoRefreshInterval.FIVE_MINUTES],
  ["15m", AutoRefreshInterval.FIFTEEN_MINUTES],
]);

const UNIT_SECONDS: ReadonlyMap<string, number> = new Map<string, number>([
  ["s", 1],
  ["m", 60],
  ["h", 3600],
  ["d", 86400],
  ["w", 7 * 86400],
  ["M", 30 * 86400],
  ["y", 365 * 86400],
]);

// "now-6h" in seconds; undefined for anything else.
export const readGrafanaRelativeTime: (value: string) => number | undefined = (
  value: string,
): number | undefined => {
  const match: RegExpMatchArray | null = (value || "")
    .trim()
    .match(/^now-(\d+)([smhdwMy])$/);

  if (!match) {
    return undefined;
  }

  return Number(match[1]) * (UNIT_SECONDS.get(match[2] || "") || 0);
};

interface DashboardContext {
  // ${DS_PROMETHEUS} -> prometheus, from __inputs.
  inputs: Map<string, string>;
  // A data source variable's name -> its plugin.
  dataSourceVariables: Map<string, string>;
  // The data source a panel with none reads.
  defaultType: string | undefined;
  // Library panels the export holds, by uid.
  elements: Map<string, ImportObject>;
  queryVariables: GrafanaQueryVariables;
  // A variable's name -> the attribute it filters on (for log widgets).
  variableKeys: Map<string, string>;
  // Queries OneUptime AI converted, which the person chose to use.
  queryOverrides: ImportQueryOverrides;
}

const variableNameOf: (reference: string) => string | undefined = (
  reference: string,
): string | undefined => {
  const match: RegExpMatchArray | null = reference
    .trim()
    .match(/^\$\{?([A-Za-z0-9_]+)(?::[A-Za-z0-9_]+)?\}?$/);
  return match ? match[1] : undefined;
};

// What kind of data source a reference names, or undefined for the default.
const resolveDataSource: (
  reference: unknown,
  context: Pick<DashboardContext, "inputs" | "dataSourceVariables">,
) => string | undefined = (
  reference: unknown,
  context: Pick<DashboardContext, "inputs" | "dataSourceVariables">,
): string | undefined => {
  const byName: (name: string) => string | undefined = (
    name: string,
  ): string | undefined => {
    const variable: string | undefined = variableNameOf(name);

    if (!variable) {
      return undefined;
    }

    return (
      context.dataSourceVariables.get(variable) || context.inputs.get(variable)
    );
  };

  if (typeof reference === "string") {
    const text: string = reference.trim();

    if (text === "-- Mixed --") {
      return MIXED;
    }

    if (text === "-- Grafana --" || text === GRAFANA_BUILT_IN) {
      return GRAFANA_BUILT_IN;
    }

    if (text === "-- Dashboard --") {
      return "dashboard";
    }

    if (text === EXPRESSION) {
      return EXPRESSION;
    }

    return text.startsWith("$") ? byName(text) : undefined;
  }

  const object: ImportObject | undefined = asObject(reference);

  if (!object) {
    return undefined;
  }

  const uid: string = textField(object, "uid");
  const type: string = textField(object, "type");

  if (uid === "-- Mixed --") {
    return MIXED;
  }

  if (uid === EXPRESSION || type === EXPRESSION) {
    return EXPRESSION;
  }

  if (type === "datasource") {
    if (uid === "-- Dashboard --") {
      return "dashboard";
    }

    return GRAFANA_BUILT_IN;
  }

  if (type && !type.startsWith("$")) {
    return type;
  }

  if (uid.startsWith("$")) {
    return byName(uid);
  }

  return type.startsWith("$") ? byName(type) : undefined;
};

const firstTextOf: (value: unknown) => string = (value: unknown): string => {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return firstTextOf(value[0]);
  }

  return "";
};

// A variable's current value(s), leaving out Grafana's $__all.
const currentValues: (variable: ImportObject) => Array<string> = (
  variable: ImportObject,
): Array<string> => {
  const current: ImportObject | undefined = objectField(variable, "current");
  const value: unknown = field(current, "value");
  const values: Array<string> = (Array.isArray(value) ? value : [value])
    .filter((item: unknown): boolean => {
      return typeof item === "string";
    })
    .map((item: unknown): string => {
      return (item as string).trim();
    })
    .filter((item: string): boolean => {
      return item !== "" && item !== "$__all";
    });

  return values;
};

// A custom or interval variable's options: "a, b, c" or "text : value".
const splitOptions: (query: string) => Array<string> = (
  query: string,
): Array<string> => {
  return query
    .split(/,(?![^{]*\})/)
    .map((option: string): string => {
      const pair: Array<string> = option.split(" : ");
      return (pair.length === 2 ? pair[1] || "" : option).trim();
    })
    .filter((option: string): boolean => {
      return option.length > 0;
    });
};

const LABEL_VALUES: RegExp =
  /^\s*label_values\(\s*(?:([\s\S]+?)\s*,\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*$/;

const newVariable: (data: {
  name: string;
  label: string;
  type: DashboardVariableType;
}) => DashboardVariable = (data: {
  name: string;
  label: string;
  type: DashboardVariableType;
}): DashboardVariable => {
  return {
    id: ObjectID.generate().toString(),
    name: data.name,
    ...(data.label && data.label !== data.name ? { label: data.label } : {}),
    type: data.type,
  };
};

// A variable's starting values: its current ones from the file.
const applyStartingValues: (
  variable: DashboardVariable,
  values: Array<string>,
) => void = (variable: DashboardVariable, values: Array<string>): void => {
  if (values.length === 0) {
    return;
  }

  if (variable.isMultiSelect) {
    variable.selectedValues = values;
  } else {
    variable.defaultValue = values[0];
  }
};

/*
 * The dashboard's variables, and how its queries name them: those the
 * dashboard keeps as {{name}}, constants written in.
 */
const convertVariables: (data: {
  document: ImportObject;
  context: Pick<DashboardContext, "inputs" | "dataSourceVariables">;
}) => {
  variables: Array<DashboardImportVariable>;
  queryVariables: GrafanaQueryVariables;
  variableKeys: Map<string, string>;
} = (data: {
  document: ImportObject;
  context: Pick<DashboardContext, "inputs" | "dataSourceVariables">;
}) => {
  const list: Array<unknown> = arrayField(
    objectField(data.document, "templating"),
    "list",
  );
  const variables: Array<DashboardImportVariable> = [];
  const dashboardVariables: Set<string> = new Set<string>();
  const sampleValues: Map<string, string> = new Map<string, string>();
  const constants: Map<string, string> = new Map<string, string>();
  const variableKeys: Map<string, string> = new Map<string, string>();
  const usedNames: Set<string> = new Set<string>();

  list.forEach((item: unknown, index: number) => {
    const source: ImportObject | undefined = asObject(item);
    const name: string = textField(source, "name");

    if (!source || !name || usedNames.has(name)) {
      return;
    }

    usedNames.add(name);

    const type: string = textField(source, "type");
    const label: string = textField(source, "label") || name;
    const notes: Array<ImportNote> = [];
    const key: string = `variable-${index}`;
    const isMulti: boolean =
      booleanField(source, "multi") === true ||
      booleanField(source, "includeAll") === true;
    const current: Array<string> = currentValues(source);
    const hidden: boolean = numberField(source, "hide") === 2;

    const base: Omit<DashboardImportVariable, "status" | "notes"> = {
      key,
      sourceName: name,
      sourceType: type,
    };

    if (type === "datasource") {
      constants.set(name, "");
      variables.push({
        ...base,
        status: ImportItemStatus.Exact,
        notes: [{ kind: ImportNoteKind.Info, text: VARIABLE_DATA_SOURCE }],
      });
      return;
    }

    if (type === "constant") {
      const value: string = firstTextOf(field(source, "query"));
      constants.set(name, value);
      variables.push({
        ...base,
        status: ImportItemStatus.Exact,
        notes: [
          {
            kind: ImportNoteKind.Info,
            text: VARIABLE_CONSTANT,
            values: { value },
          },
        ],
      });
      return;
    }

    if (hidden) {
      notes.push({ kind: ImportNoteKind.Info, text: VARIABLE_HIDDEN });
    }

    if (type === "query") {
      const queryField: unknown = field(source, "query");
      const query: string =
        typeof queryField === "string"
          ? queryField.trim()
          : textField(asObject(queryField), "query");
      const dataSource: string | undefined = resolveDataSource(
        field(source, "datasource"),
        data.context,
      );
      const labelValues: RegExpMatchArray | null = query.match(LABEL_VALUES);

      if (labelValues) {
        const attributeKey: string = labelValues[2] || "";
        const selector: string = (labelValues[1] || "").trim();
        const variable: DashboardVariable = newVariable({
          name,
          label,
          type: DashboardVariableType.TelemetryAttribute,
        });

        variable.attributeKey = attributeKey;

        if (isMulti) {
          variable.isMultiSelect = true;
        }

        applyStartingValues(variable, current);

        if (dataSource === LOKI) {
          notes.push({
            kind: ImportNoteKind.Approximation,
            text: VARIABLE_LISTS_METRIC_VALUES,
            values: { label: attributeKey },
          });
        } else if (selector) {
          notes.push({
            kind: ImportNoteKind.Approximation,
            text: VARIABLE_LISTS_EVERY_VALUE,
            values: { label: attributeKey, selector },
          });
        }

        const regex: string = textField(source, "regex");

        if (regex) {
          notes.push({
            kind: ImportNoteKind.Approximation,
            text: VARIABLE_REGEX_NOT_KEPT,
            values: { regex },
          });
        }

        const allValue: string = textField(source, "allValue");

        if (
          booleanField(source, "includeAll") === true &&
          allValue &&
          allValue !== ".*" &&
          allValue !== ".+"
        ) {
          notes.push({
            kind: ImportNoteKind.Approximation,
            text: VARIABLE_ALL_VALUE,
            values: { allValue },
          });
        }

        dashboardVariables.add(name);
        variableKeys.set(name, attributeKey);

        // The metric the selector names, for the values the preview looks up.
        const metric: string = (selector.match(/^[A-Za-z_:][A-Za-z0-9_:]*/) || [
          "",
        ])[0];

        variables.push({
          ...base,
          status: ImportStatusUtil.fromNotes(notes),
          notes,
          variable,
          startsOnFirstValue:
            current.length === 0 &&
            booleanField(source, "includeAll") !== true &&
            booleanField(source, "multi") !== true,
          ...(metric ? { valuesOfMetric: metric } : {}),
        });
        return;
      }

      // A query OneUptime cannot list values for: typed in instead.
      const variable: DashboardVariable = newVariable({
        name,
        label,
        type: DashboardVariableType.TextInput,
      });

      if (current[0]) {
        variable.defaultValue = current[0];
        sampleValues.set(name, current[0]);
      }

      dashboardVariables.add(name);
      notes.push({
        kind: ImportNoteKind.Approximation,
        text: VARIABLE_QUERY_NOT_READ,
        values: { query: query || name },
      });
      variables.push({
        ...base,
        status: ImportItemStatus.Approximate,
        notes,
        variable,
      });
      return;
    }

    if (type === "custom" || type === "interval") {
      const options: Array<string> = splitOptions(
        firstTextOf(field(source, "query")),
      );
      const variable: DashboardVariable = newVariable({
        name,
        label,
        type: DashboardVariableType.CustomList,
      });

      variable.customListValues = options.join(",");

      if (isMulti && type === "custom") {
        variable.isMultiSelect = true;
      }

      const starting: Array<string> = current.filter((value: string) => {
        return value !== "auto" && !value.startsWith("$__auto");
      });

      applyStartingValues(
        variable,
        starting.length > 0
          ? starting
          : type === "interval" && options[0]
            ? [options[0]]
            : [],
      );

      if (type === "interval" && booleanField(source, "auto") === true) {
        notes.push({
          kind: ImportNoteKind.Approximation,
          text: VARIABLE_AUTO_INTERVAL,
        });
      }

      const sample: string | undefined = starting[0] || options[0];

      if (sample) {
        sampleValues.set(name, sample);
      }

      dashboardVariables.add(name);
      variables.push({
        ...base,
        status: ImportStatusUtil.fromNotes(notes),
        notes,
        variable,
      });
      return;
    }

    if (type === "textbox") {
      const variable: DashboardVariable = newVariable({
        name,
        label,
        type: DashboardVariableType.TextInput,
      });
      const value: string = current[0] || firstTextOf(field(source, "query"));

      if (value) {
        variable.defaultValue = value;
        sampleValues.set(name, value);
      }

      dashboardVariables.add(name);
      variables.push({
        ...base,
        status: ImportStatusUtil.fromNotes(notes),
        notes,
        variable,
      });
      return;
    }

    variables.push({
      ...base,
      status: ImportItemStatus.NotConverted,
      notes: [
        {
          kind: ImportNoteKind.Reason,
          text: VARIABLE_TYPE_NOT_SUPPORTED,
          values: { type: type || name },
        },
      ],
    });
  });

  return {
    variables,
    queryVariables: { dashboardVariables, sampleValues, constants },
    variableKeys,
  };
};

interface PanelPlacementSource {
  x: number;
  y: number;
  w: number;
  h: number;
}

const readGridPos: (panel: ImportObject) => PanelPlacementSource = (
  panel: ImportObject,
): PanelPlacementSource => {
  const gridPos: ImportObject | undefined = objectField(panel, "gridPos");

  return {
    x: numberField(gridPos, "x") ?? 0,
    y: numberField(gridPos, "y") ?? 0,
    w: numberField(gridPos, "w") ?? 12,
    h: numberField(gridPos, "h") ?? 8,
  };
};

interface FlatPanel {
  panel: ImportObject;
  grid: PanelPlacementSource;
  // The row heading it is under, folded in Grafana.
  inFoldedRow: boolean;
}

const byPosition: (a: FlatPanel, b: FlatPanel) => number = (
  a: FlatPanel,
  b: FlatPanel,
): number => {
  return a.grid.y - b.grid.y || a.grid.x - b.grid.x;
};

/*
 * The dashboard's panels in the order Grafana draws them: top to bottom,
 * a folded row's panels after its heading, and an old dashboard's rows
 * (schema 15 and before) laid out row by row.
 */
const flattenPanels: (
  document: ImportObject,
  notes: Array<ImportNote>,
) => Array<FlatPanel> = (
  document: ImportObject,
  notes: Array<ImportNote>,
): Array<FlatPanel> => {
  const flat: Array<FlatPanel> = [];

  if (!Array.isArray(field(document, "panels"))) {
    // The old rows layout: rows of panels with a span out of 12.
    let y: number = 0;

    notes.push({ kind: ImportNoteKind.Info, text: DASHBOARD_OLD_ROWS });

    for (const rowValue of arrayField(document, "rows")) {
      const row: ImportObject | undefined = asObject(rowValue);

      if (!row) {
        continue;
      }

      const heightText: string = textField(row, "height");
      const heightInPx: number = Number(heightText.replace("px", "")) || 250;
      const h: number = Math.max(1, Math.round(heightInPx / 30));
      const title: string = textField(row, "title");

      if (title && booleanField(row, "showTitle") === true) {
        flat.push({
          panel: { type: "row", title, collapsed: false },
          grid: { x: 0, y, w: 24, h: 1 },
          inFoldedRow: false,
        });
        y += 1;
      }

      let x: number = 0;

      for (const panelValue of arrayField(row, "panels")) {
        const panel: ImportObject | undefined = asObject(panelValue);

        if (!panel) {
          continue;
        }

        const w: number = Math.max(1, (numberField(panel, "span") || 12) * 2);

        if (x + w > 24) {
          x = 0;
          y += h;
        }

        flat.push({ panel, grid: { x, y, w, h }, inFoldedRow: false });
        x += w;
      }

      y += h;
    }

    return flat;
  }

  const topLevel: Array<FlatPanel> = arrayField(document, "panels")
    .map(asObject)
    .filter((panel: ImportObject | undefined): boolean => {
      return Boolean(panel);
    })
    .map((panel: ImportObject | undefined): FlatPanel => {
      return {
        panel: panel as ImportObject,
        grid: readGridPos(panel as ImportObject),
        inFoldedRow: false,
      };
    })
    .sort(byPosition);

  for (const item of topLevel) {
    flat.push(item);

    if (textField(item.panel, "type") === "row") {
      const nested: Array<FlatPanel> = arrayField(item.panel, "panels")
        .map(asObject)
        .filter((panel: ImportObject | undefined): boolean => {
          return Boolean(panel);
        })
        .map((panel: ImportObject | undefined): FlatPanel => {
          return {
            panel: panel as ImportObject,
            grid: readGridPos(panel as ImportObject),
            inFoldedRow: true,
          };
        })
        .sort(byPosition);

      flat.push(...nested);
    }
  }

  return flat;
};

interface PanelTarget {
  refId: string;
  type: string | undefined;
  target: ImportObject;
}

// A panel's visible queries, each with the data source it reads.
const readTargets: (data: {
  panel: ImportObject;
  context: DashboardContext;
}) => Array<PanelTarget> = (data: {
  panel: ImportObject;
  context: DashboardContext;
}): Array<PanelTarget> => {
  const panelType: string | undefined =
    resolveDataSource(field(data.panel, "datasource"), data.context) ??
    data.context.defaultType;

  return arrayField(data.panel, "targets")
    .map(asObject)
    .filter((target: ImportObject | undefined): boolean => {
      return Boolean(target) && booleanField(target, "hide") !== true;
    })
    .map((target: ImportObject | undefined, index: number): PanelTarget => {
      const object: ImportObject = target as ImportObject;
      let type: string | undefined =
        resolveDataSource(field(object, "datasource"), data.context) ??
        (panelType === MIXED ? data.context.defaultType : panelType);

      const expr: string = textField(object, "expr");

      // A query of the default data source, read by what it holds.
      if (!type || type === MIXED) {
        type = expr
          ? looksLikeLogQL(expr)
            ? LOKI
            : PROMETHEUS
          : textField(object, "rawSql")
            ? "sql"
            : undefined;
      }

      return {
        refId: textField(object, "refId") || String.fromCharCode(65 + index),
        type,
        target: object,
      };
    });
};

const legendOf: (target: ImportObject) => string | undefined = (
  target: ImportObject,
): string | undefined => {
  const legend: string = textField(target, "legendFormat");
  return legend && legend !== "__auto" ? legend : undefined;
};

interface ConvertedTargets {
  queries: Array<{ query: ImportedQuery; converted: ConvertedQuery }>;
  notes: Array<ImportNote>;
  // Why no query converted, when none did.
  reasons: Array<ImportNote>;
  aiCandidate?: ImportAiCandidate | undefined;
}

// A panel's Prometheus queries, converted; the others said why not.
const convertPrometheusTargets: (data: {
  panel: ImportObject;
  itemKey: string;
  targets: Array<PanelTarget>;
  context: DashboardContext;
  multiplyBy: number;
}) => ConvertedTargets = (data: {
  panel: ImportObject;
  itemKey: string;
  targets: Array<PanelTarget>;
  context: DashboardContext;
  multiplyBy: number;
}): ConvertedTargets => {
  const queries: Array<{ query: ImportedQuery; converted: ConvertedQuery }> =
    [];
  const notes: Array<ImportNote> = [];
  const reasons: Array<ImportNote> = [];
  const leftOut: Array<string> = [];
  let aiCandidate: ImportAiCandidate | undefined = undefined;

  for (const target of data.targets) {
    let converted: ConvertedQuery | undefined = undefined;
    const targetKey: string = `${data.itemKey}:${target.refId}`;
    const override: string | undefined =
      data.context.queryOverrides.get(targetKey);

    if (override !== undefined) {
      // The query OneUptime AI wrote, which the person chose to use.
      converted = convertGrafanaPromQL({
        expr: override,
        variables: data.context.queryVariables,
        isFromAi: true,
      });
    } else if (target.type === PROMETHEUS) {
      converted = convertGrafanaPromQL({
        expr: textField(target.target, "expr"),
        variables: data.context.queryVariables,
        minInterval:
          textField(target.target, "interval") ||
          textField(data.panel, "interval"),
      });
    } else {
      const reason: ImportNote =
        target.type === EXPRESSION
          ? {
              kind: ImportNoteKind.Reason,
              text: PANEL_EXPRESSION_NOT_READ,
              values: {
                type: textField(target.target, "type") || "math",
              },
            }
          : {
              kind: ImportNoteKind.Reason,
              text: PANEL_DATA_SOURCE_NOT_READ,
              values: { type: target.type || "unknown" },
            };

      converted = {
        status: ImportItemStatus.NotConverted,
        promQL: "",
        notes: [reason],
      };
    }

    if (converted.status === ImportItemStatus.NotConverted) {
      reasons.push(...converted.notes);
      leftOut.push(target.refId);

      if (!aiCandidate && converted.aiCandidate) {
        aiCandidate = { ...converted.aiCandidate, targetKey };
      }

      continue;
    }

    notes.push(...converted.notes);
    queries.push({
      query: {
        promQL: scaleQuery(converted.promQL, data.multiplyBy),
        legend: legendOf(target.target),
      },
      converted,
    });
  }

  // Some converted, some not: the rest are left out, and why.
  if (queries.length > 0 && leftOut.length > 0) {
    for (const refId of leftOut) {
      notes.push({
        kind: ImportNoteKind.Approximation,
        text: PANEL_QUERY_LEFT_OUT,
        values: { refId },
      });
    }

    notes.push(
      ...reasons.map((reason: ImportNote): ImportNote => {
        return { ...reason, kind: ImportNoteKind.Info };
      }),
    );
  }

  return { queries, notes, reasons, aiCandidate };
};

// The calculation a stat or gauge reduces its values with.
const readReducer: (panel: ImportObject) => {
  reduce: DataSourceValueReduce;
  note?: ImportNote | undefined;
} = (
  panel: ImportObject,
): { reduce: DataSourceValueReduce; note?: ImportNote | undefined } => {
  const calcs: Array<unknown> = arrayField(
    objectField(objectField(panel, "options"), "reduceOptions"),
    "calcs",
  );
  const calculation: string =
    firstTextOf(calcs) || textField(panel, "valueName") || "lastNotNull";
  const reduce: DataSourceValueReduce | undefined = REDUCERS.get(calculation);

  if (reduce) {
    return { reduce };
  }

  return {
    reduce: DataSourceValueReduce.Last,
    note: {
      kind: ImportNoteKind.Approximation,
      text: PANEL_REDUCE_NOT_KEPT,
      values: { calculation },
    },
  };
};

// The notes every panel gets: repeats, transformations, overrides, mappings.
const panelNotes: (panel: ImportObject) => Array<ImportNote> = (
  panel: ImportObject,
): Array<ImportNote> => {
  const notes: Array<ImportNote> = [];
  const repeat: string = textField(panel, "repeat");

  if (repeat) {
    notes.push({
      kind: ImportNoteKind.Approximation,
      text: PANEL_REPEATED,
      values: { variable: repeat },
    });
  }

  const transformations: Array<string> = arrayField(panel, "transformations")
    .map((transformation: unknown): string => {
      return textField(asObject(transformation), "id");
    })
    .filter((id: string): boolean => {
      return id.length > 0;
    });

  if (transformations.length > 0) {
    notes.push({
      kind: ImportNoteKind.Approximation,
      text: PANEL_TRANSFORMATIONS,
      values: { names: transformations.join(", ") },
    });
  }

  /*
   * Per-series overrides change how a series is drawn - its colour, its
   * line, an axis below zero - never what it reads: said, as what the
   * chart does not keep. A unit of its own is said by name.
   */
  const overrides: Array<unknown> = arrayField(
    objectField(panel, "fieldConfig"),
    "overrides",
  );
  let hasStyle: boolean = arrayField(panel, "seriesOverrides").length > 0;
  let hasNegativeY: boolean = false;
  let hasUnit: boolean = false;

  for (const override of overrides) {
    for (const property of arrayField(asObject(override), "properties")) {
      const id: string = textField(asObject(property), "id");

      if (id === "custom.transform") {
        hasNegativeY = true;
      } else if (id === "unit") {
        hasUnit = true;
      } else if (id) {
        hasStyle = true;
      }
    }
  }

  if (hasNegativeY) {
    notes.push({ kind: ImportNoteKind.Info, text: PANEL_NEGATIVE_Y });
  }

  if (hasUnit) {
    notes.push({
      kind: ImportNoteKind.Approximation,
      text: PANEL_OVERRIDE_NOT_KEPT,
      values: { property: "unit" },
    });
  }

  if (hasStyle) {
    notes.push({ kind: ImportNoteKind.Info, text: PANEL_STYLE_OVERRIDES });
  }

  // Value mappings, but for the usual "no value reads N/A".
  const mappings: Array<unknown> = arrayField(
    objectField(objectField(panel, "fieldConfig"), "defaults"),
    "mappings",
  ).filter((mapping: unknown): boolean => {
    const object: ImportObject | undefined = asObject(mapping);
    const options: ImportObject | undefined = objectField(object, "options");
    return !(
      textField(object, "type") === "special" &&
      ["null", "nan", "null+nan"].includes(textField(options, "match"))
    );
  });

  if (mappings.length > 0) {
    notes.push({
      kind: ImportNoteKind.Approximation,
      text: PANEL_VALUE_MAPPINGS,
    });
  }

  return notes;
};

// How a time series panel draws: lines, areas, bars, stacked.
const readChartType: (panel: ImportObject) => {
  chartType: DashboardChartType;
  note?: ImportNote | undefined;
} = (
  panel: ImportObject,
): { chartType: DashboardChartType; note?: ImportNote | undefined } => {
  if (textField(panel, "type") === "graph") {
    if (booleanField(panel, "bars") === true) {
      return { chartType: DashboardChartType.Bar };
    }

    return {
      chartType:
        booleanField(panel, "stack") === true
          ? DashboardChartType.StackedArea
          : DashboardChartType.Line,
    };
  }

  const custom: ImportObject | undefined = objectField(
    objectField(objectField(panel, "fieldConfig"), "defaults"),
    "custom",
  );
  const stacking: string = textField(objectField(custom, "stacking"), "mode");

  if (textField(custom, "drawStyle") === "bars") {
    return { chartType: DashboardChartType.Bar };
  }

  if (stacking === "normal" || stacking === "percent") {
    return {
      chartType: DashboardChartType.StackedArea,
      ...(stacking === "percent"
        ? {
            note: {
              kind: ImportNoteKind.Approximation,
              text: PANEL_STACKED_PERCENT,
            },
          }
        : {}),
    };
  }

  return {
    chartType:
      (numberField(custom, "fillOpacity") || 0) > 0
        ? DashboardChartType.Area
        : DashboardChartType.Line,
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

/*
 * One panel, converted: the widget it becomes and what is said about it.
 * Undefined for a panel that is a copy Grafana made of a repeated one.
 */
const convertPanel: (data: {
  flat: FlatPanel;
  key: string;
  context: DashboardContext;
}) => DashboardImportItem | undefined = (data: {
  flat: FlatPanel;
  key: string;
  context: DashboardContext;
}): DashboardImportItem | undefined => {
  let panel: ImportObject = data.flat.panel;

  // A copy Grafana saved of a repeated panel: the panel itself is converted.
  if (field(panel, "repeatPanelId") !== undefined) {
    return undefined;
  }

  // A library panel: its model, when the export holds it.
  const libraryPanel: ImportObject | undefined = objectField(
    panel,
    "libraryPanel",
  );

  if (libraryPanel && !Array.isArray(field(panel, "targets"))) {
    const model: ImportObject | undefined = objectField(
      data.context.elements.get(textField(libraryPanel, "uid")),
      "model",
    );

    if (!model) {
      return notConverted({
        key: data.key,
        title: textField(libraryPanel, "name") || textField(panel, "title"),
        sourceType: "library panel",
        reasons: [
          { kind: ImportNoteKind.Reason, text: PANEL_LIBRARY_NOT_IN_FILE },
        ],
      });
    }

    panel = model;
  }

  const type: string = textField(panel, "type");
  const title: string =
    textField(panel, "title") ||
    textField(
      objectField(objectField(panel, "fieldConfig"), "defaults"),
      "displayName",
    );
  const description: string = textField(panel, "description");
  const base: Pick<DashboardImportItem, "key" | "title" | "sourceType"> = {
    key: data.key,
    title,
    sourceType: type,
  };

  if (type === "row") {
    const notes: Array<ImportNote> =
      booleanField(panel, "collapsed") === true
        ? [{ kind: ImportNoteKind.Info, text: PANEL_ROW_FOLDED }]
        : [];

    return {
      ...base,
      status: ImportItemStatus.Exact,
      notes,
      queries: [],
      component: buildTextWidget({
        text: title ? `## ${title}` : "",
        isMarkdown: true,
      }),
    };
  }

  if (type === "text") {
    const options: ImportObject | undefined = objectField(panel, "options");
    const mode: string =
      textField(options, "mode") || textField(panel, "mode") || "markdown";
    const content: string =
      typeof field(options, "content") === "string"
        ? (field(options, "content") as string)
        : typeof field(panel, "content") === "string"
          ? (field(panel, "content") as string)
          : "";
    const text: string =
      title && mode !== "html" ? `### ${title}\n\n${content}` : content;

    if (mode === "html") {
      return {
        ...base,
        status: ImportItemStatus.Exact,
        notes: [{ kind: ImportNoteKind.Info, text: PANEL_HTML }],
        queries: [],
        component: buildHtmlWidget(content),
      };
    }

    return {
      ...base,
      status: ImportItemStatus.Exact,
      notes: [],
      queries: [],
      component: buildTextWidget({
        text: mode === "code" ? `\`\`\`\n${content}\n\`\`\`` : text,
        isMarkdown: true,
      }),
    };
  }

  if (GRAFANA_OWN_PANELS.has(type)) {
    return notConverted({
      ...base,
      reasons: [
        {
          kind: ImportNoteKind.Reason,
          text: PANEL_READS_GRAFANA,
          values: { type },
        },
      ],
    });
  }

  const targets: Array<PanelTarget> = readTargets({
    panel,
    context: data.context,
  });

  if (type === "logs") {
    const loki: PanelTarget | undefined = targets.find(
      (target: PanelTarget): boolean => {
        return target.type === LOKI;
      },
    );

    if (!loki) {
      return notConverted({
        ...base,
        reasons: [{ kind: ImportNoteKind.Reason, text: PANEL_LOGS_NOT_LOKI }],
      });
    }

    const converted: ConvertedLokiQuery = convertLokiLogQuery({
      expr: textField(loki.target, "expr"),
      variableKeys: data.context.variableKeys,
    });

    if (!converted.filters) {
      return notConverted({ ...base, reasons: converted.notes });
    }

    const notes: Array<ImportNote> = [...panelNotes(panel), ...converted.notes];

    if (targets.length > 1) {
      notes.push({
        kind: ImportNoteKind.Approximation,
        text: PANEL_SHOWS_FIRST_QUERY,
        values: { count: String(targets.length) },
      });
    }

    return {
      ...base,
      status: ImportStatusUtil.fromNotes(notes),
      notes,
      queries: [],
      component: buildLogStreamWidget({ title, filters: converted.filters }),
    };
  }

  const isChart: boolean = type === "timeseries" || type === "graph";
  const isWidgetWithQueries: boolean =
    isChart ||
    [
      "stat",
      "singlestat",
      "gauge",
      "bargauge",
      "table",
      "table-old",
      "piechart",
      "barchart",
    ].includes(type);

  if (!isWidgetWithQueries) {
    return notConverted({
      ...base,
      reasons: [
        {
          kind: ImportNoteKind.Reason,
          text: PANEL_TYPE_NOT_SUPPORTED,
          values: { type: type || "unknown" },
        },
      ],
    });
  }

  if (targets.length === 0) {
    return notConverted({
      ...base,
      reasons: [{ kind: ImportNoteKind.Reason, text: PANEL_NO_QUERIES }],
    });
  }

  // A time series of Loki counts: a Log Chart.
  if (
    isChart &&
    targets.every((target: PanelTarget): boolean => {
      return target.type === LOKI;
    })
  ) {
    const converted: ConvertedLokiQuery = convertLokiCountQuery({
      expr: textField(targets[0]!.target, "expr"),
      variableKeys: data.context.variableKeys,
    });

    if (!converted.filters) {
      return notConverted({ ...base, reasons: converted.notes });
    }

    const notes: Array<ImportNote> = [...panelNotes(panel), ...converted.notes];

    if (targets.length > 1) {
      notes.push({
        kind: ImportNoteKind.Approximation,
        text: PANEL_SHOWS_FIRST_QUERY,
        values: { count: String(targets.length) },
      });
    }

    return {
      ...base,
      status: ImportStatusUtil.fromNotes(notes),
      notes,
      queries: [],
      component: buildLogChartWidget({ title, filters: converted.filters }),
    };
  }

  const unit: ConvertedUnit = convertGrafanaUnit(getGrafanaPanelUnit(panel));
  const converted: ConvertedTargets = convertPrometheusTargets({
    panel,
    itemKey: data.key,
    targets,
    context: data.context,
    multiplyBy: unit.multiplyBy,
  });

  if (converted.queries.length === 0) {
    return notConverted({
      ...base,
      reasons: converted.reasons,
      aiCandidate: converted.aiCandidate,
    });
  }

  const notes: Array<ImportNote> = [...panelNotes(panel), ...converted.notes];

  if (unit.note) {
    notes.push(unit.note);
  }

  const queries: Array<ImportedQuery> = converted.queries.map(
    (query: {
      query: ImportedQuery;
      converted: ConvertedQuery;
    }): ImportedQuery => {
      return query.query;
    },
  );
  const convertedQueries: Array<ConvertedQuery> = converted.queries.map(
    (query: {
      query: ImportedQuery;
      converted: ConvertedQuery;
    }): ConvertedQuery => {
      return { ...query.converted, promQL: query.query.promQL };
    },
  );

  const firstOnly: () => ImportedQuery = (): ImportedQuery => {
    if (queries.length > 1) {
      notes.push({
        kind: ImportNoteKind.Approximation,
        text: PANEL_SHOWS_FIRST_QUERY,
        values: { count: String(queries.length) },
      });
    }

    return queries[0]!;
  };

  let component: DashboardBaseComponent;

  if (isChart || type === "barchart" || type === "piechart") {
    const chart: {
      chartType: DashboardChartType;
      note?: ImportNote | undefined;
    } =
      type === "piechart"
        ? { chartType: DashboardChartType.Pie }
        : type === "barchart"
          ? { chartType: DashboardChartType.Bar }
          : readChartType(panel);

    if (chart.note) {
      notes.push(chart.note);
    }

    if (type === "piechart" || type === "barchart") {
      notes.push({
        kind: ImportNoteKind.Approximation,
        text: PANEL_PIE_FROM_CHART,
        values: { type, chart: chart.chartType },
      });
    }

    component = buildChartWidget({
      title,
      description,
      queries,
      chartType: chart.chartType,
      unit: unit.unit,
    });
  } else if (type === "bargauge") {
    if (queries.length > 1) {
      notes.push({
        kind: ImportNoteKind.Approximation,
        text: PANEL_BAR_GAUGE_AS_CHART,
      });
      component = buildChartWidget({
        title,
        description,
        queries,
        chartType: DashboardChartType.Line,
        unit: unit.unit,
      });
    } else {
      notes.push({
        kind: ImportNoteKind.Approximation,
        text: PANEL_BAR_GAUGE_AS_TABLE,
      });
      component = buildTableWidget({ title, description, query: queries[0]! });
    }
  } else if (type === "table" || type === "table-old") {
    component = buildTableWidget({ title, description, query: firstOnly() });
  } else {
    const reducer: {
      reduce: DataSourceValueReduce;
      note?: ImportNote | undefined;
    } = readReducer(panel);
    const thresholds: ConvertedThresholds =
      type === "singlestat"
        ? convertGrafanaLegacyThresholds({ panel, multiplyBy: unit.multiplyBy })
        : convertGrafanaThresholds({ panel, multiplyBy: unit.multiplyBy });

    if (reducer.note) {
      notes.push(reducer.note);
    }

    if (thresholds.note) {
      notes.push(thresholds.note);
    }

    const valueData: Parameters<typeof buildValueWidget>[0] = {
      title,
      query: firstOnly(),
      reduce: reducer.reduce,
      unit: unit.unit,
      warningThreshold: thresholds.warning,
      criticalThreshold: thresholds.critical,
    };

    // An old singlestat drawn as a gauge says so, with its range.
    const legacyGauge: ImportObject | undefined =
      type === "singlestat" ? objectField(panel, "gauge") : undefined;

    if (legacyGauge && booleanField(legacyGauge, "show") === true) {
      const scale: (value: number | undefined) => number | undefined = (
        value: number | undefined,
      ): number | undefined => {
        return value === undefined ? undefined : value * unit.multiplyBy;
      };

      component = buildGaugeWidget({
        ...valueData,
        minValue: scale(numberField(legacyGauge, "minValue")),
        maxValue: scale(numberField(legacyGauge, "maxValue")),
      });
    } else if (type === "gauge") {
      const isPercent: boolean = unit.unit === "%";
      component = buildGaugeWidget({
        ...valueData,
        minValue:
          getGrafanaFieldNumber({
            panel,
            name: "min",
            multiplyBy: unit.multiplyBy,
          }) ?? (isPercent ? 0 : undefined),
        maxValue:
          getGrafanaFieldNumber({
            panel,
            name: "max",
            multiplyBy: unit.multiplyBy,
          }) ?? (isPercent ? 100 : undefined),
      });
    } else {
      component = buildValueWidget(valueData);
    }
  }

  return {
    ...base,
    status: ImportStatusUtil.fromNotes(notes),
    notes,
    queries: convertedQueries,
    component,
  };
};

// The dashboard's default time range, the nearest one it can open on.
const readTimeRange: (
  document: ImportObject,
  notes: Array<ImportNote>,
) => TimeRange | undefined = (
  document: ImportObject,
  notes: Array<ImportNote>,
): TimeRange | undefined => {
  const time: ImportObject | undefined = objectField(document, "time");
  const from: string = textField(time, "from");
  const to: string = textField(time, "to") || "now";
  const seconds: number | undefined = readGrafanaRelativeTime(from);

  if (seconds === undefined || to !== "now") {
    return undefined;
  }

  const exact: { seconds: number; range: TimeRange } | undefined =
    TIME_RANGES.find(
      (entry: { seconds: number; range: TimeRange }): boolean => {
        return entry.seconds === seconds;
      },
    );

  if (exact) {
    return exact.range;
  }

  const nearest: { seconds: number; range: TimeRange } =
    TIME_RANGES.find(
      (entry: { seconds: number; range: TimeRange }): boolean => {
        return entry.seconds >= seconds;
      },
    ) || TIME_RANGES[TIME_RANGES.length - 1]!;

  notes.push({
    kind: ImportNoteKind.Approximation,
    text: DASHBOARD_TIME_RANGE_NEAREST,
    values: { from, to, range: nearest.range },
  });

  return nearest.range;
};

const readRefresh: (
  document: ImportObject,
  notes: Array<ImportNote>,
) => AutoRefreshInterval | undefined = (
  document: ImportObject,
  notes: Array<ImportNote>,
): AutoRefreshInterval | undefined => {
  const refresh: string = textField(document, "refresh");

  if (!refresh) {
    return undefined;
  }

  const interval: AutoRefreshInterval | undefined =
    REFRESH_INTERVALS.get(refresh);

  if (interval) {
    return interval;
  }

  notes.push({
    kind: ImportNoteKind.Approximation,
    text: DASHBOARD_REFRESH_NOT_KEPT,
    values: { refresh },
  });

  return AutoRefreshInterval.OFF;
};

// The data source a panel with none reads: the one the file names.
const readDefaultDataSource: (data: {
  document: ImportObject;
  inputs: Map<string, string>;
  dataSourceVariables: Map<string, string>;
}) => string | undefined = (data: {
  document: ImportObject;
  inputs: Map<string, string>;
  dataSourceVariables: Map<string, string>;
}): string | undefined => {
  const required: Array<string> = arrayField(data.document, "__requires")
    .map(asObject)
    .filter((item: ImportObject | undefined): boolean => {
      return textField(item, "type") === "datasource";
    })
    .map((item: ImportObject | undefined): string => {
      return textField(item, "id");
    })
    .filter((id: string): boolean => {
      return id.length > 0 && id !== GRAFANA_BUILT_IN && id !== EXPRESSION;
    });

  const distinct: Array<string> = Array.from(new Set(required));

  if (distinct.length === 1) {
    return distinct[0];
  }

  const variablePlugins: Array<string> = Array.from(
    new Set(data.dataSourceVariables.values()),
  );

  if (variablePlugins.length === 1) {
    return variablePlugins[0];
  }

  const inputPlugins: Array<string> = Array.from(new Set(data.inputs.values()));

  return inputPlugins.length === 1 ? inputPlugins[0] : undefined;
};

export const convertGrafanaDashboard: (
  document: ImportObject,
  options?: { queryOverrides?: ImportQueryOverrides | undefined },
) => DashboardImportPlan = (
  document: ImportObject,
  options?: { queryOverrides?: ImportQueryOverrides | undefined },
): DashboardImportPlan => {
  const notes: Array<ImportNote> = [];
  const inputs: Map<string, string> = new Map<string, string>();

  for (const input of arrayField(document, "__inputs")) {
    const object: ImportObject | undefined = asObject(input);
    const name: string = textField(object, "name");
    const plugin: string = textField(object, "pluginId");

    if (name && plugin && textField(object, "type") === "datasource") {
      inputs.set(name, plugin);
    }
  }

  const dataSourceVariables: Map<string, string> = new Map<string, string>();

  for (const item of arrayField(objectField(document, "templating"), "list")) {
    const variable: ImportObject | undefined = asObject(item);

    if (textField(variable, "type") === "datasource") {
      dataSourceVariables.set(
        textField(variable, "name"),
        firstTextOf(field(variable, "query")) || PROMETHEUS,
      );
    }
  }

  const elements: Map<string, ImportObject> = new Map<string, ImportObject>();
  const elementSource: ImportObject | undefined = objectField(
    document,
    "__elements",
  );

  for (const uid of Object.keys(elementSource || {})) {
    const element: ImportObject | undefined = objectField(elementSource, uid);

    if (element) {
      elements.set(uid, element);
    }
  }

  const converted: ReturnType<typeof convertVariables> = convertVariables({
    document,
    context: { inputs, dataSourceVariables },
  });

  const context: DashboardContext = {
    inputs,
    dataSourceVariables,
    defaultType: readDefaultDataSource({
      document,
      inputs,
      dataSourceVariables,
    }),
    elements,
    queryVariables: converted.queryVariables,
    variableKeys: converted.variableKeys,
    queryOverrides: options?.queryOverrides || NO_QUERY_OVERRIDES,
  };

  const flat: Array<FlatPanel> = flattenPanels(document, notes);

  if (flat.length > IMPORT_MAX_ITEMS) {
    notes.push({
      kind: ImportNoteKind.Approximation,
      text: DASHBOARD_PANELS_LEFT_OUT,
      values: { count: String(IMPORT_MAX_ITEMS) },
    });
  }

  const items: Array<DashboardImportItem> = [];
  const placed: Array<PlacedComponent> = [];

  flat.slice(0, IMPORT_MAX_ITEMS).forEach((panel: FlatPanel, index: number) => {
    const item: DashboardImportItem | undefined = convertPanel({
      flat: panel,
      key: `panel-${index}`,
      context,
    });

    if (!item) {
      return;
    }

    items.push(item);

    if (item.component) {
      const isHeading: boolean = textField(panel.panel, "type") === "row";

      placed.push({
        component: item.component,
        placement: {
          sourceRow: panel.grid.y,
          sourceColumn: panel.grid.x,
          width: isHeading ? 12 : fromGrafanaWidth(panel.grid.w),
          height: isHeading ? 1 : fromGrafanaHeight(panel.grid.h),
          startsLine: isHeading,
        },
      });
    }
  });

  // Laid out, each item keeps the placed component it made.
  const layout: ReturnType<typeof layOutImportedComponents> =
    layOutImportedComponents(placed);
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

  const timeRange: TimeRange | undefined = readTimeRange(document, notes);
  const refreshInterval: AutoRefreshInterval | undefined = readRefresh(
    document,
    notes,
  );

  return {
    source: ImportSourceKind.GrafanaDashboard,
    title: textField(document, "title"),
    description: textField(document, "description"),
    items,
    variables: converted.variables,
    notes,
    viewConfigDefaults: {
      ...(timeRange ? { timeRange } : {}),
      ...(refreshInterval ? { refreshInterval } : {}),
    },
  };
};
