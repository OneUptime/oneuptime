import { JSONObject, JSONValue } from "../../Types/JSON";
import { SearchValueOperator } from "../../Types/Telemetry/TelemetrySearchQuery";
import StoredDashboardViewConfig from "../Dashboard/StoredDashboardViewConfig";
import {
  ParsedSloMetricSearch,
  SloMetricAttributeTerm,
  parseSloMetricSearch,
} from "../Slo/SloMetricSli";
import {
  CosmosLatencyEvidence,
  RetiredCloudMetric,
  RetiredCloudMetricFormula,
  RetiredCloudMetricOutcome,
  RetiredCloudMetricQuery,
  RetiredCloudMetricRead,
  RetiredCloudMetricThreshold,
  UnknownRecord,
  asArray,
  asRecord,
  getFilterData,
  getRetiredCloudMetric,
  getRetiredCloudMetricFormulas,
  moveRetiredCloudMetricReads,
  readRetiredCloudMetricQueryConfig,
  toRetiredCloudMetricQuery,
} from "./RetiredCloudMetricMoves";

/*
 * DASHBOARD CHARTS AND SLOS MOVED OFF THE METRICS THEIR CLOUDS DEPRECATE
 * (#9980), as monitors were (#9739, RetiredCloudMetricMoves).
 *
 * A dashboard's widgets and an SLO hold a query of Cosmos DB's
 * ServerSideLatency or Pub/Sub's send_message_operation_count in shapes of
 * their own. Each is read into a RetiredCloudMetricRead and moved by the
 * monitors' one rule, so it moves exactly as a monitor would:
 *
 *   - a Chart's queries (metricQueryConfig, metricQueryConfigs), the
 *     threshold lines drawn on each and its formulas; a Value's and a
 *     Gauge's query, its warning and critical thresholds and a gauge's
 *     range; a Table's metric columns, their thresholds and unit, its
 *     formula columns, the widget's filter and group-by, and its older
 *     queries. Pub/Sub's thresholds, a gauge's range among them, are 60
 *     times what they were and its formulas read it divided by 60; a chart
 *     draws the messages published a minute, its "/s" unit dropped.
 *   - an SLO's metric (metricQueryConfig): its name, and a histogram's
 *     good value 60 times what it was. Its filters are text: one that names
 *     a response code keeps it where it is. A Cosmos DB account's latency
 *     is chosen by what the account its filter names reported.
 *
 * Pure: the caller writes and tells (MoveOffRetiredCloudMetrics).
 */

// The dashboard component types that read metrics, as stored.
const CHART: string = "chart";
const VALUE: string = "value";
const GAUGE: string = "gauge";
const TABLE: string = "table";
const TABLE_METRIC_COLUMN: string = "metric";
const TABLE_FORMULA_COLUMN: string = "formula";

function isWidget(entry: unknown): entry is UnknownRecord {
  return StoredDashboardViewConfig.isWidgetEntry(entry);
}

/*
 * A stored dashboard's widget entries, in order, as every board reads them
 * (StoredDashboardViewConfig, #4571): the config as stored, as JSON text or
 * in the envelope the API reference documented; its widget list as a list,
 * as JSON text or as an object keyed "0", "1", ...; each widget as stored,
 * as JSON text or in its own envelope, with arguments written as JSON text
 * read as the object they say. Junk entries stay as they are. A query is
 * found wherever a board draws it.
 */
function readEntries(config: JSONObject): Array<unknown> {
  return StoredDashboardViewConfig.getComponentEntries(config).map(
    (entry: unknown): unknown => {
      return StoredDashboardViewConfig.isWidgetEntry(entry)
        ? StoredDashboardViewConfig.withArgumentsRead(entry)
        : entry;
    },
  );
}

// A stored dashboard's widgets, read without changing what was handed in.
function getComponents(dashboardViewConfigJSON: unknown): Array<UnknownRecord> {
  return readEntries(
    StoredDashboardViewConfig.unwrap(dashboardViewConfigJSON),
  ).filter(isWidget);
}

/*
 * A stored dashboard's widgets, before a move: written on the config handed
 * in as they are read - its widget list a list of them, each with its
 * arguments an object - so a move is written on what the caller writes,
 * whichever of those shapes a widget was stored in.
 */
function getComponentsToMove(
  dashboardViewConfigJSON: unknown,
): Array<UnknownRecord> {
  const config: JSONObject = StoredDashboardViewConfig.unwrap(
    dashboardViewConfigJSON,
  );
  const entries: Array<unknown> = readEntries(config);
  const widgets: Array<UnknownRecord> = entries.filter(isWidget);

  if (widgets.length === 0) {
    return [];
  }

  config["components"] = entries as Array<JSONValue>;

  if (Array.isArray(dashboardViewConfigJSON)) {
    // A bare widget list: it holds the widgets themselves.
    dashboardViewConfigJSON.splice(
      0,
      dashboardViewConfigJSON.length,
      ...entries,
    );
  } else {
    const handedIn: UnknownRecord | undefined = asRecord(
      dashboardViewConfigJSON,
    );

    // Opened out of an envelope: it now holds the config the widgets are on.
    if (handedIn && handedIn !== config) {
      handedIn["value"] = config;
    }
  }

  return widgets;
}

function getComponentType(component: UnknownRecord): string {
  const type: unknown = component["componentType"];

  return typeof type === "string" ? type.trim().toLowerCase() : "";
}

// The thresholds `keys` name on `holder`, each a threshold of the metric's.
function thresholdsOn(
  holder: UnknownRecord | undefined,
  keys: Array<string>,
): Array<RetiredCloudMetricThreshold> {
  if (!holder) {
    return [];
  }

  return keys.map((key: string): RetiredCloudMetricThreshold => {
    return { holder, key, isThreshold: true };
  });
}

// A query's own threshold lines, as a chart draws them.
function queryThresholds(query: unknown): Array<RetiredCloudMetricThreshold> {
  return thresholdsOn(asRecord(query), [
    "warningThreshold",
    "criticalThreshold",
  ]);
}

// The query configs of a widget's `keys`, in order: each a query of its own.
function queriesOf(args: UnknownRecord, keys: Array<string>): Array<unknown> {
  const queries: Array<unknown> = [];

  for (const key of keys) {
    const value: unknown = args[key];

    for (const query of Array.isArray(value) ? value : [value]) {
      if (getFilterData(query)) {
        queries.push(query);
      }
    }
  }

  return queries;
}

function readQueries(data: {
  args: UnknownRecord;
  keys: Array<string>;
  thresholds: (query: unknown) => Array<RetiredCloudMetricThreshold>;
  formulas: Array<RetiredCloudMetricFormula>;
}): Array<RetiredCloudMetricRead> {
  const reads: Array<RetiredCloudMetricRead> = [];

  for (const query of queriesOf(data.args, data.keys)) {
    const read: RetiredCloudMetricRead | null =
      readRetiredCloudMetricQueryConfig({
        query,
        thresholds: data.thresholds(query),
        formulas: data.formulas,
      });

    if (read) {
      reads.push(read);
    }
  }

  return reads;
}

// A chart's older queries, as a table may still hold them: read as a chart's are.
function readChartQueries(args: UnknownRecord): Array<RetiredCloudMetricRead> {
  return readQueries({
    args,
    keys: ["metricQueryConfig", "metricQueryConfigs"],
    thresholds: queryThresholds,
    formulas: getRetiredCloudMetricFormulas(
      asArray(args["metricFormulaConfigs"])
        .map((formula: unknown): UnknownRecord | undefined => {
          return asRecord(formula);
        })
        .filter((formula: UnknownRecord | undefined): boolean => {
          return Boolean(formula);
        }) as Array<UnknownRecord>,
    ),
  });
}

function readTableColumns(args: UnknownRecord): Array<RetiredCloudMetricRead> {
  const columns: Array<UnknownRecord> = asArray(args["columns"])
    .map((column: unknown): UnknownRecord | undefined => {
      return asRecord(column);
    })
    .filter((column: UnknownRecord | undefined): boolean => {
      return Boolean(column);
    }) as Array<UnknownRecord>;
  const kindOf: (column: UnknownRecord) => string = (
    column: UnknownRecord,
  ): string => {
    return String(column["kind"] || "")
      .trim()
      .toLowerCase();
  };
  const formulas: Array<RetiredCloudMetricFormula> = columns
    .filter((column: UnknownRecord): boolean => {
      return kindOf(column) === TABLE_FORMULA_COLUMN;
    })
    .map((column: UnknownRecord): RetiredCloudMetricFormula => {
      return {
        holder: column,
        key: "formula",
        alias:
          typeof column["variable"] === "string" && column["variable"]
            ? column["variable"]
            : undefined,
      };
    });
  // The widget's group-by, either shape: every column is split by it.
  const splitBy: Array<unknown> = [
    ...asArray(args["groupByAttributes"]).map((group: unknown): unknown => {
      return asRecord(group)?.["key"];
    }),
    ...asArray(args["groupByAttributeKeys"]),
  ];
  const reads: Array<RetiredCloudMetricRead> = [];

  for (const column of columns) {
    const metric: RetiredCloudMetric | null = getRetiredCloudMetric(
      column["metricName"],
    );

    if (kindOf(column) !== TABLE_METRIC_COLUMN || !metric) {
      continue;
    }

    reads.push({
      metric,
      metricVariable:
        typeof column["variable"] === "string" && column["variable"]
          ? column["variable"]
          : undefined,
      metricName: String(column["metricName"]),
      name: { holder: column, key: "metricName" },
      attributes: args["attributeFilters"],
      splitBy,
      aggregation: column["aggregation"],
      legendUnit: { holder: column, key: "unit" },
      thresholds: thresholdsOn(asRecord(column["thresholds"]), [
        "warning",
        "critical",
      ]),
      formulas,
    });
  }

  return reads;
}

// Each read of a deprecated metric of one dashboard widget.
function readComponent(
  component: UnknownRecord,
): Array<RetiredCloudMetricRead> {
  const args: UnknownRecord | undefined = asRecord(component["arguments"]);

  if (!args) {
    return [];
  }

  switch (getComponentType(component)) {
    case CHART:
      return readChartQueries(args);
    case VALUE:
      return readQueries({
        args,
        keys: ["metricQueryConfig"],
        thresholds: (query: unknown): Array<RetiredCloudMetricThreshold> => {
          return [
            ...queryThresholds(query),
            ...thresholdsOn(args, ["warningThreshold", "criticalThreshold"]),
          ];
        },
        formulas: [],
      });
    case GAUGE:
      return readQueries({
        args,
        keys: ["metricQueryConfig"],
        thresholds: (query: unknown): Array<RetiredCloudMetricThreshold> => {
          return [
            ...queryThresholds(query),
            ...thresholdsOn(args, [
              "warningThreshold",
              "criticalThreshold",
              "minValue",
              "maxValue",
            ]),
          ];
        },
        formulas: [],
      });
    case TABLE:
      return [...readTableColumns(args), ...readChartQueries(args)];
  }

  return [];
}

// Every query of a stored dashboard that reads a metric its cloud deprecates, in order.
export function findRetiredCloudMetricQueriesOfDashboard(
  dashboardViewConfigJSON: unknown,
): Array<RetiredCloudMetricQuery> {
  return getComponents(dashboardViewConfigJSON)
    .flatMap(readComponent)
    .map(toRetiredCloudMetricQuery);
}

/*
 * Every query of a stored dashboard that reads a metric its cloud
 * deprecates, moved as a monitor's would be: written on the view config
 * handed in. Says what moved, and what stays and why.
 */
export function moveRetiredCloudMetricQueriesOfDashboard(data: {
  dashboardViewConfigJSON: unknown;
  evidenceOf: (query: RetiredCloudMetricQuery) => CosmosLatencyEvidence | null;
}): RetiredCloudMetricOutcome {
  return moveRetiredCloudMetricReads({
    reads: getComponentsToMove(data.dashboardViewConfigJSON).flatMap(
      readComponent,
    ),
    evidenceOf: data.evidenceOf,
  });
}

/*
 * An SLO filter's attributes, when it is only `@key:value` terms: else an
 * attribute filter that is not text, so nothing is guessed of the account
 * it reads.
 */
function readSloFilterAttributes(filter: unknown): unknown {
  if (typeof filter !== "string" || !filter.trim()) {
    return {};
  }

  const parsed: ParsedSloMetricSearch = parseSloMetricSearch(filter);
  const attributes: Record<string, string> = {};

  for (const term of parsed.terms) {
    if (term.predicate.operator !== SearchValueOperator.Equals) {
      return { filter: { text: filter } };
    }

    attributes[term.key] = term.predicate.value;
  }

  return parsed.problem ||
    parsed.terms.some((term: SloMetricAttributeTerm): boolean => {
      return !term.key;
    })
    ? { filter: { text: filter } }
    : attributes;
}

function getSloRead(metricQueryConfig: unknown): RetiredCloudMetricRead | null {
  const config: UnknownRecord | undefined = asRecord(metricQueryConfig);
  const metric: RetiredCloudMetric | null = getRetiredCloudMetric(
    config?.["metricName"],
  );

  if (!config || !metric) {
    return null;
  }

  return {
    metric,
    metricVariable: undefined,
    metricName: String(config["metricName"]),
    name: { holder: config, key: "metricName" },
    attributes: readSloFilterAttributes(config["filter"]),
    splitBy: [],
    aggregation: undefined,
    thresholds: thresholdsOn(config, ["goodAtOrUnder"]),
    formulas: [],
    filterWords: [config["filter"], config["goodFilter"]].filter(
      (words: unknown): words is string => {
        return typeof words === "string" && words.trim().length > 0;
      },
    ),
  };
}

// An SLO's metric, when it reads one its cloud deprecates.
export function findRetiredCloudMetricQueryOfSlo(
  metricQueryConfig: unknown,
): RetiredCloudMetricQuery | null {
  const read: RetiredCloudMetricRead | null = getSloRead(metricQueryConfig);

  return read ? toRetiredCloudMetricQuery(read) : null;
}

/*
 * An SLO's metric, moved as a monitor's query would be, when it reads one
 * its cloud deprecates: written on the config handed in.
 */
export function moveRetiredCloudMetricQueryOfSlo(data: {
  metricQueryConfig: unknown;
  evidenceOf: (query: RetiredCloudMetricQuery) => CosmosLatencyEvidence | null;
}): RetiredCloudMetricOutcome {
  const read: RetiredCloudMetricRead | null = getSloRead(
    data.metricQueryConfig,
  );

  return moveRetiredCloudMetricReads({
    reads: read ? [read] : [],
    evidenceOf: data.evidenceOf,
  });
}
