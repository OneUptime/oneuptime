import { CheckOn, FilterType } from "../../Types/Monitor/CriteriaFilter";
import { SearchValueOperator } from "../../Types/Telemetry/TelemetrySearchQuery";
import {
  ParsedSloMetricSearch,
  SloMetricAttributeTerm,
  parseSloMetricSearch,
} from "../Slo/SloMetricSli";

/*
 * WHERE A SAVED METRIC QUERY IS, AND WHAT READS ITS VALUES.
 *
 * A Metrics monitor's steps, a dashboard's widgets and an SLO each keep the
 * queries they read in a shape of their own. Each query of a metric a
 * caller wants (`classify`, by the metric's stored name) is read into a
 * MetricQueryRead: where its name is written, its filter, what it is split
 * by and aggregated with, its legend's unit, each threshold compared with
 * it and each formula over it, and - on a dashboard - the widget it is on.
 *
 * Two callers read the same queries:
 *
 *   - the moves off a deprecated cloud metric (RetiredCloudMetricMoves,
 *     RetiredCloudMetricChartMoves), which write a replacement where the
 *     read says each value is (#9739, #9980), and the reads that keep a
 *     deprecated metric read for what still reads it (#10011);
 *   - what a cloud resource's added metric is read by, said before it is
 *     removed (CloudAddedMetricReaders, #9807).
 *
 * Pure: it reads the stored JSON it is handed, as the database holds it
 * ({_type: "MonitorSteps", value: {monitorStepsInstanceArray: [...]}} for
 * a monitor, the view config's components for a dashboard, the SLO's
 * metricQueryConfig), and writes nothing.
 */

export type UnknownRecord = Record<string, unknown>;

export function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

export function asArray(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}

// A query's filterData, the object its metric and aggregation live on.
export function getFilterData(query: unknown): UnknownRecord | undefined {
  return asRecord(
    asRecord(asRecord(query)?.["metricQueryData"])?.["filterData"],
  );
}

export function getMetricVariable(config: unknown): string | undefined {
  const variable: unknown = asRecord(asRecord(config)?.["metricAliasData"])?.[
    "metricVariable"
  ];

  return typeof variable === "string" && variable ? variable : undefined;
}

// Where a value is kept: an object, and its key on it.
export interface MetricQuerySlot {
  holder: UnknownRecord;
  key: string;
}

// A value compared with a read's values, in the metric's own unit.
export interface MetricQueryThreshold extends MetricQuerySlot {
  /*
   * Whether its value is a threshold of the metric's (a monitor's filter of
   * a comparing type; every threshold of a chart).
   */
  isThreshold: boolean;
  // A unit it was entered in, where it can be (a monitor filter's thresholdUnit).
  unit?: MetricQuerySlot | undefined;
}

// A formula over a read's variable.
export interface MetricQueryFormula extends MetricQuerySlot {
  // The formula's own variable, when it has one.
  alias: string | undefined;
}

// The dashboard widget a query is on.
export interface MetricQueryWidget {
  componentId: string;
  // As stored: "chart", "value", "gauge", "table".
  componentType: string;
  // Its title, as its person wrote it; "" when it has none.
  title: string;
}

export interface MetricQueryRead<M> {
  // What `classify` said the metric is.
  metric: M;
  metricVariable: string | undefined;
  metricName: string;
  // Where its name is written.
  name: MetricQuerySlot;
  // Its filter, as stored.
  attributes: unknown;
  // The keys it is split by, as stored: its group-by.
  splitBy: Array<unknown>;
  // Its aggregation, as stored.
  aggregation: unknown;
  // The unit its legend or column says.
  legendUnit?: MetricQuerySlot | undefined;
  thresholds: Array<MetricQueryThreshold>;
  formulas: Array<MetricQueryFormula>;
  /*
   * Words of its filter that name what it is split or filtered by, where
   * they are not keys of `attributes` (an SLO's filter, written as text).
   */
  filterWords?: Array<string> | undefined;
  // A dashboard's: the widget it is on.
  widget?: MetricQueryWidget | undefined;
}

/*
 * What a metric's stored name is to a caller, or null for a metric it does
 * not read: a deprecated cloud metric, an added metric's stored name.
 */
export type MetricNameClassifier<M> = (metricName: unknown) => M | null;

// The filters whose value is a threshold in the metric's own unit.
const THRESHOLD_FILTER_TYPES: ReadonlySet<string> = new Set<string>([
  FilterType.GreaterThan,
  FilterType.LessThan,
  FilterType.GreaterThanOrEqualTo,
  FilterType.LessThanOrEqualTo,
  FilterType.EqualTo,
  FilterType.NotEqualTo,
  FilterType.ForecastAbove,
  FilterType.ForecastBelow,
]);

/*
 * A stored query config's read (MetricQueryConfigData, as a monitor step,
 * a chart and a value widget store one), when it reads a metric `classify`
 * knows; `thresholds` and `formulas` are what compares with it where it is.
 */
export function readMetricQueryConfig<M>(data: {
  query: unknown;
  thresholds: Array<MetricQueryThreshold>;
  formulas: Array<MetricQueryFormula>;
  classify: MetricNameClassifier<M>;
}): MetricQueryRead<M> | null {
  const query: UnknownRecord | undefined = asRecord(data.query);
  const filterData: UnknownRecord | undefined = getFilterData(query);
  const metric: M | null = data.classify(filterData?.["metricName"]);

  if (!query || !filterData || metric === null) {
    return null;
  }

  const aliasData: UnknownRecord | undefined = asRecord(
    query["metricAliasData"],
  );

  return {
    metric,
    metricVariable: getMetricVariable(query),
    metricName: String(filterData["metricName"]),
    name: { holder: filterData, key: "metricName" },
    attributes: filterData["attributes"],
    splitBy: asArray(
      asRecord(query["metricQueryData"])?.["groupByAttributeKeys"],
    ),
    aggregation: filterData["aggegationType"],
    ...(aliasData
      ? { legendUnit: { holder: aliasData, key: "legendUnit" } }
      : {}),
    thresholds: data.thresholds,
    formulas: data.formulas,
  };
}

// A formula config's formula (MetricFormulaConfigData, as a step and a chart store one).
export function getMetricQueryFormulas(
  formulaConfigs: Array<UnknownRecord>,
): Array<MetricQueryFormula> {
  const formulas: Array<MetricQueryFormula> = [];

  for (const formula of formulaConfigs) {
    const formulaData: UnknownRecord | undefined = asRecord(
      formula["metricFormulaData"],
    );

    if (formulaData) {
      formulas.push({
        holder: formulaData,
        key: "metricFormula",
        alias: getMetricVariable(formula),
      });
    }
  }

  return formulas;
}

// ---- A Metrics monitor's steps ----------------------------------------------

// Each Metrics step of stored monitor steps: its metricMonitor and its criteria instances.
function getStoredMetricSteps(monitorStepsJSON: unknown): Array<{
  metricMonitor: UnknownRecord;
  criteriaInstances: Array<UnknownRecord>;
}> {
  const steps: Array<{
    metricMonitor: UnknownRecord;
    criteriaInstances: Array<UnknownRecord>;
  }> = [];

  for (const step of asArray(
    asRecord(asRecord(monitorStepsJSON)?.["value"])?.[
      "monitorStepsInstanceArray"
    ],
  )) {
    const value: UnknownRecord | undefined = asRecord(
      asRecord(step)?.["value"],
    );
    const metricMonitor: UnknownRecord | undefined = asRecord(
      value?.["metricMonitor"],
    );

    if (!metricMonitor) {
      continue;
    }

    steps.push({
      metricMonitor,
      criteriaInstances: asArray(
        asRecord(asRecord(value?.["monitorCriteria"])?.["value"])?.[
          "monitorCriteriaInstanceArray"
        ],
      )
        .map((instance: unknown): UnknownRecord | undefined => {
          return asRecord(asRecord(instance)?.["value"]);
        })
        .filter((instance: UnknownRecord | undefined): boolean => {
          return Boolean(instance);
        }) as Array<UnknownRecord>,
    });
  }

  return steps;
}

function getQueryConfigs(metricMonitor: UnknownRecord): Array<UnknownRecord> {
  return asArray(
    asRecord(metricMonitor["metricViewConfig"])?.["queryConfigs"],
  ).filter((query: unknown): boolean => {
    return Boolean(getFilterData(query));
  }) as Array<UnknownRecord>;
}

function getFormulaConfigs(metricMonitor: UnknownRecord): Array<UnknownRecord> {
  return asArray(
    asRecord(metricMonitor["metricViewConfig"])?.["formulaConfigs"],
  ).filter((formula: unknown): boolean => {
    return Boolean(asRecord(formula));
  }) as Array<UnknownRecord>;
}

/*
 * The criteria filters that compare a query's values, of every criteria
 * instance of its step: the ones that name its variable, and - for the
 * step's first query - the ones that name none, which read it.
 */
function getComparingFilters(data: {
  criteriaInstances: Array<UnknownRecord>;
  metricVariable: string | undefined;
  isFirstQuery: boolean;
}): Array<UnknownRecord> {
  const filters: Array<UnknownRecord> = [];

  for (const instance of data.criteriaInstances) {
    for (const rawFilter of asArray(instance["filters"])) {
      const filter: UnknownRecord | undefined = asRecord(rawFilter);

      if (!filter || filter["checkOn"] !== CheckOn.MetricValue) {
        continue;
      }

      const alias: unknown = asRecord(filter["metricMonitorOptions"])?.[
        "metricAlias"
      ];
      const namesIt: boolean =
        typeof alias === "string" && alias
          ? alias === data.metricVariable
          : data.isFirstQuery;

      if (namesIt) {
        filters.push(filter);
      }
    }
  }

  return filters;
}

// Each read of a metric `classify` knows, of stored monitor steps, with what compares with it.
export function readMonitorStepsMetricQueries<M>(
  monitorStepsJSON: unknown,
  classify: MetricNameClassifier<M>,
): Array<MetricQueryRead<M>> {
  const reads: Array<MetricQueryRead<M>> = [];

  for (const step of getStoredMetricSteps(monitorStepsJSON)) {
    const formulas: Array<MetricQueryFormula> = getMetricQueryFormulas(
      getFormulaConfigs(step.metricMonitor),
    );

    getQueryConfigs(step.metricMonitor).forEach(
      (query: UnknownRecord, index: number): void => {
        const read: MetricQueryRead<M> | null = readMetricQueryConfig({
          query,
          thresholds: getComparingFilters({
            criteriaInstances: step.criteriaInstances,
            metricVariable: getMetricVariable(query),
            isFirstQuery: index === 0,
          }).map((filter: UnknownRecord): MetricQueryThreshold => {
            const options: UnknownRecord | undefined = asRecord(
              filter["metricMonitorOptions"],
            );

            return {
              holder: filter,
              key: "value",
              isThreshold: THRESHOLD_FILTER_TYPES.has(
                String(filter["filterType"]),
              ),
              ...(options
                ? { unit: { holder: options, key: "thresholdUnit" } }
                : {}),
            };
          }),
          formulas,
          classify,
        });

        if (read) {
          reads.push(read);
        }
      },
    );
  }

  return reads;
}

// ---- A dashboard's widgets ----------------------------------------------------

// The dashboard component types that read metrics, as stored.
const CHART: string = "chart";
const VALUE: string = "value";
const GAUGE: string = "gauge";
const TABLE: string = "table";
const TABLE_METRIC_COLUMN: string = "metric";
const TABLE_FORMULA_COLUMN: string = "formula";

function getComponents(dashboardViewConfigJSON: unknown): Array<UnknownRecord> {
  return asArray(asRecord(dashboardViewConfigJSON)?.["components"])
    .map((component: unknown): UnknownRecord | undefined => {
      return asRecord(component);
    })
    .filter((component: UnknownRecord | undefined): boolean => {
      return Boolean(component);
    }) as Array<UnknownRecord>;
}

function getComponentType(component: UnknownRecord): string {
  const type: unknown = component["componentType"];

  return typeof type === "string" ? type.trim().toLowerCase() : "";
}

// The thresholds `keys` name on `holder`, each a threshold of the metric's.
function thresholdsOn(
  holder: UnknownRecord | undefined,
  keys: Array<string>,
): Array<MetricQueryThreshold> {
  if (!holder) {
    return [];
  }

  return keys.map((key: string): MetricQueryThreshold => {
    return { holder, key, isThreshold: true };
  });
}

// A query's own threshold lines, as a chart draws them.
function queryThresholds(query: unknown): Array<MetricQueryThreshold> {
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

function readQueries<M>(data: {
  args: UnknownRecord;
  keys: Array<string>;
  thresholds: (query: unknown) => Array<MetricQueryThreshold>;
  formulas: Array<MetricQueryFormula>;
  classify: MetricNameClassifier<M>;
}): Array<MetricQueryRead<M>> {
  const reads: Array<MetricQueryRead<M>> = [];

  for (const query of queriesOf(data.args, data.keys)) {
    const read: MetricQueryRead<M> | null = readMetricQueryConfig({
      query,
      thresholds: data.thresholds(query),
      formulas: data.formulas,
      classify: data.classify,
    });

    if (read) {
      reads.push(read);
    }
  }

  return reads;
}

// A chart's queries - and a table's older ones, which it may still hold: read as a chart's are.
function readChartQueries<M>(
  args: UnknownRecord,
  classify: MetricNameClassifier<M>,
): Array<MetricQueryRead<M>> {
  return readQueries({
    args,
    keys: ["metricQueryConfig", "metricQueryConfigs"],
    thresholds: queryThresholds,
    formulas: getMetricQueryFormulas(
      asArray(args["metricFormulaConfigs"])
        .map((formula: unknown): UnknownRecord | undefined => {
          return asRecord(formula);
        })
        .filter((formula: UnknownRecord | undefined): boolean => {
          return Boolean(formula);
        }) as Array<UnknownRecord>,
    ),
    classify,
  });
}

function readTableColumns<M>(
  args: UnknownRecord,
  classify: MetricNameClassifier<M>,
): Array<MetricQueryRead<M>> {
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
  const formulas: Array<MetricQueryFormula> = columns
    .filter((column: UnknownRecord): boolean => {
      return kindOf(column) === TABLE_FORMULA_COLUMN;
    })
    .map((column: UnknownRecord): MetricQueryFormula => {
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
  const reads: Array<MetricQueryRead<M>> = [];

  for (const column of columns) {
    const metric: M | null = classify(column["metricName"]);

    if (kindOf(column) !== TABLE_METRIC_COLUMN || metric === null) {
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

// A widget's id and title, as stored: each type keeps its title under a key of its own.
function readWidget(component: UnknownRecord, type: string): MetricQueryWidget {
  const args: UnknownRecord = asRecord(component["arguments"]) || {};
  const id: unknown = component["componentId"];
  const title: unknown = [
    args["chartTitle"],
    args["title"],
    args["gaugeTitle"],
    args["tableTitle"],
    args["widgetTitle"],
  ].find((candidate: unknown): boolean => {
    return typeof candidate === "string" && candidate.trim().length > 0;
  });

  return {
    componentId:
      typeof id === "string"
        ? id
        : typeof asRecord(id)?.["value"] === "string"
          ? String(asRecord(id)!["value"])
          : "",
    componentType: type,
    title: typeof title === "string" ? title.trim() : "",
  };
}

// Each read of a metric `classify` knows, of one dashboard widget.
function readComponent<M>(
  component: UnknownRecord,
  classify: MetricNameClassifier<M>,
): Array<MetricQueryRead<M>> {
  const args: UnknownRecord | undefined = asRecord(component["arguments"]);

  if (!args) {
    return [];
  }

  const type: string = getComponentType(component);
  let reads: Array<MetricQueryRead<M>> = [];

  switch (type) {
    case CHART:
      reads = readChartQueries(args, classify);
      break;
    case VALUE:
      reads = readQueries({
        args,
        keys: ["metricQueryConfig"],
        thresholds: (query: unknown): Array<MetricQueryThreshold> => {
          return [
            ...queryThresholds(query),
            ...thresholdsOn(args, ["warningThreshold", "criticalThreshold"]),
          ];
        },
        formulas: [],
        classify,
      });
      break;
    case GAUGE:
      reads = readQueries({
        args,
        keys: ["metricQueryConfig"],
        thresholds: (query: unknown): Array<MetricQueryThreshold> => {
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
        classify,
      });
      break;
    case TABLE:
      reads = [
        ...readTableColumns(args, classify),
        ...readChartQueries(args, classify),
      ];
      break;
  }

  if (reads.length === 0) {
    return reads;
  }

  const widget: MetricQueryWidget = readWidget(component, type);

  return reads.map((read: MetricQueryRead<M>): MetricQueryRead<M> => {
    return { ...read, widget };
  });
}

// Each read of a metric `classify` knows, of a stored dashboard's widgets, in order.
export function readDashboardMetricQueries<M>(
  dashboardViewConfigJSON: unknown,
  classify: MetricNameClassifier<M>,
): Array<MetricQueryRead<M>> {
  return getComponents(dashboardViewConfigJSON).flatMap(
    (component: UnknownRecord): Array<MetricQueryRead<M>> => {
      return readComponent(component, classify);
    },
  );
}

// ---- An SLO's metric ----------------------------------------------------------

/*
 * An SLO filter's attributes, when it is only `@key:value` terms: else an
 * attribute filter that is not text, so nothing is guessed of the resource
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

// An SLO's metric (its metricQueryConfig), when it reads one `classify` knows.
export function readSloMetricQuery<M>(
  metricQueryConfig: unknown,
  classify: MetricNameClassifier<M>,
): MetricQueryRead<M> | null {
  const config: UnknownRecord | undefined = asRecord(metricQueryConfig);
  const metric: M | null = classify(config?.["metricName"]);

  if (!config || metric === null) {
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

/*
 * A classifier of one stored name, whatever its case or the spaces around
 * it: true for the name, null for any other.
 */
export function namedMetric(storedName: string): MetricNameClassifier<true> {
  const wanted: string = storedName.trim().toLowerCase();

  return (metricName: unknown): true | null => {
    return typeof metricName === "string" &&
      metricName.trim().toLowerCase() === wanted
      ? true
      : null;
  };
}
