import Dictionary from "../../Types/Dictionary";
import JSONFunctions from "../../Types/JSONFunctions";
import OneUptimeDate from "../../Types/Date";
import MetricFormulaConfigData from "../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData, {
  MetricChartType,
} from "../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../Types/Metrics/MetricsAggregationType";
import TimeRange from "../../Types/Time/TimeRange";

/*
 * Single source of truth for the metric explorer's URL schema — the
 * JSON-encoded `metricQueries` / `metricFormulas` params plus the
 * `startTime` / `endTime` window. Shared between the browser bundle
 * (MetricExplorer's URL round-trip) and the server (incident root-cause
 * deep links built by MonitorCriteriaEvaluator), so it must never import
 * anything that touches window/DOM/UI.
 */

export enum MetricExplorerUrlParam {
  MetricQueries = "metricQueries",
  MetricFormulas = "metricFormulas",
  StartTime = "startTime",
  EndTime = "endTime",
  /*
   * Relative-time token (a TimeRange enum value, e.g. "Past 1 Day").
   * Omitted for the default Past 1 Hour and for Custom/pinned absolute
   * windows — startTime/endTime always carry the absolute window for
   * back-compat, so older links keep working.
   */
  Range = "range",
}

export interface SerializedMetricQueryAlias {
  title?: string | undefined;
  description?: string | undefined;
  legend?: string | undefined;
  legendUnit?: string | undefined;
}

/*
 * Plain-data shape of one query inside the `metricQueries` param. Every
 * field except metricName is optional so links serialized by older
 * versions (which carried only metricName/attributes/aggregationType/
 * alias) keep parsing. Runtime-injected function fields on
 * MetricQueryConfigData (getSeries, yAxisValueFormatter, transformValue)
 * are intentionally absent — they must never serialize.
 */
export interface SerializedMetricQuery {
  metricName: string;
  attributes?: Dictionary<string | number | boolean> | undefined;
  aggregationType?: MetricsAggregationType | undefined;
  alias?: SerializedMetricQueryAlias | undefined;
  groupByAttributeKeys?: Array<string> | undefined;
  chartType?: MetricChartType | undefined;
  color?: string | undefined;
  colorsByGroup?: Dictionary<string> | undefined;
  warningThreshold?: number | undefined;
  criticalThreshold?: number | undefined;
  transformAsRate?: boolean | undefined;
  overlayWithPreviousQuery?: boolean | undefined;
  topN?: number | undefined;
}

export interface SerializedMetricFormula {
  formula: string;
  variable?: string | undefined;
  alias?: SerializedMetricQueryAlias | undefined;
}

export default class MetricExplorerUrl {
  /*
   * Builds the full URL param dictionary for a metric-view state. Keys
   * are only present when they carry a value (empty/meaningless queries
   * and formulas are skipped; the time params are only emitted when both
   * ends of the window exist), so callers can set present keys and
   * delete absent ones. Keyed by MetricExplorerUrlParam values so a
   * future param (e.g. a relative-range token) only needs a new enum
   * member and builder branch.
   */
  public static buildQueryParamsFromMetricViewData(
    data: MetricViewData,
  ): Dictionary<string> {
    const params: Dictionary<string> = {};

    const queries: Array<SerializedMetricQuery> = data.queryConfigs
      .map((queryConfig: MetricQueryConfigData): SerializedMetricQuery => {
        return MetricExplorerUrl.buildSerializedMetricQuery(queryConfig);
      })
      .filter(MetricExplorerUrl.isMeaningfulMetricQuery);

    const formulas: Array<SerializedMetricFormula> = data.formulaConfigs
      .map(
        (formulaConfig: MetricFormulaConfigData): SerializedMetricFormula => {
          return MetricExplorerUrl.buildSerializedMetricFormula(formulaConfig);
        },
      )
      .filter(MetricExplorerUrl.isMeaningfulMetricFormula);

    if (queries.length > 0) {
      params[MetricExplorerUrlParam.MetricQueries] = JSON.stringify(queries);
    }

    if (formulas.length > 0) {
      params[MetricExplorerUrlParam.MetricFormulas] = JSON.stringify(formulas);
    }

    const startTimeValue: Date | undefined = data.startAndEndDate?.startValue;
    const endTimeValue: Date | undefined = data.startAndEndDate?.endValue;

    if (startTimeValue && endTimeValue) {
      params[MetricExplorerUrlParam.StartTime] =
        OneUptimeDate.toString(startTimeValue);
      params[MetricExplorerUrlParam.EndTime] =
        OneUptimeDate.toString(endTimeValue);
    }

    /*
     * Relative token. Past 1 Hour is the explorer's default and stays
     * implicit (mirrors the metrics list page's `range` convention);
     * Custom windows are represented by the absolute params alone.
     */
    const rangeToken: string | undefined = MetricExplorerUrl.getValidRangeToken(
      data.rangeToken,
    );

    if (rangeToken && rangeToken !== TimeRange.PAST_ONE_HOUR) {
      params[MetricExplorerUrlParam.Range] = rangeToken;
    }

    return params;
  }

  /*
   * Returns the value as a relative TimeRange token when it is a known
   * enum member other than Custom (Custom windows are carried by the
   * absolute startTime/endTime params instead); undefined otherwise.
   */
  public static getValidRangeToken(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const knownRanges: Array<string> = Object.values(
      TimeRange,
    ) as Array<string>;

    if (!knownRanges.includes(value) || value === TimeRange.CUSTOM) {
      return undefined;
    }

    return value;
  }

  public static buildSerializedMetricQuery(
    queryConfig: MetricQueryConfigData,
  ): SerializedMetricQuery {
    const filterDataRecord: Record<string, unknown> = queryConfig
      .metricQueryData.filterData as Record<string, unknown>;

    const metricNameValue: unknown = filterDataRecord["metricName"];

    const metricName: string =
      typeof metricNameValue === "string" ? metricNameValue : "";

    const attributes: Dictionary<string | number | boolean> =
      MetricExplorerUrl.sanitizeAttributes(filterDataRecord["attributes"]);

    const aggregationType: MetricsAggregationType | undefined =
      MetricExplorerUrl.getAggregationTypeFromValue(
        filterDataRecord["aggegationType"],
      );

    const alias: SerializedMetricQueryAlias | undefined =
      MetricExplorerUrl.buildAliasFromMetricAliasData(
        queryConfig.metricAliasData,
      );

    const groupByAttributeKeys: Array<string> =
      MetricExplorerUrl.sanitizeGroupByAttributeKeys(
        queryConfig.metricQueryData.groupByAttributeKeys,
      );

    const chartType: MetricChartType | undefined =
      MetricExplorerUrl.getChartTypeFromValue(queryConfig.chartType);

    const color: string | undefined =
      typeof queryConfig.color === "string" && queryConfig.color.trim() !== ""
        ? queryConfig.color
        : undefined;

    const colorsByGroup: Dictionary<string> =
      MetricExplorerUrl.sanitizeColorsByGroup(queryConfig.colorsByGroup);

    const warningThreshold: number | undefined =
      MetricExplorerUrl.getFiniteNumberFromValue(queryConfig.warningThreshold);

    const criticalThreshold: number | undefined =
      MetricExplorerUrl.getFiniteNumberFromValue(queryConfig.criticalThreshold);

    const topN: number | undefined =
      MetricExplorerUrl.getPositiveIntegerFromValue(
        queryConfig.metricQueryData.topN,
      );

    return {
      metricName,
      attributes,
      ...(aggregationType ? { aggregationType } : {}),
      ...(alias ? { alias } : {}),
      ...(groupByAttributeKeys.length > 0 ? { groupByAttributeKeys } : {}),
      ...(chartType ? { chartType } : {}),
      ...(color ? { color } : {}),
      ...(Object.keys(colorsByGroup).length > 0 ? { colorsByGroup } : {}),
      ...(warningThreshold !== undefined ? { warningThreshold } : {}),
      ...(criticalThreshold !== undefined ? { criticalThreshold } : {}),
      ...(queryConfig.transformAsRate === true
        ? { transformAsRate: true }
        : {}),
      ...(queryConfig.overlayWithPreviousQuery === true
        ? { overlayWithPreviousQuery: true }
        : {}),
      ...(topN !== undefined ? { topN } : {}),
    };
  }

  public static buildSerializedMetricFormula(
    formulaConfig: MetricFormulaConfigData,
  ): SerializedMetricFormula {
    const alias: SerializedMetricQueryAlias | undefined =
      MetricExplorerUrl.buildAliasFromMetricAliasData(
        formulaConfig.metricAliasData,
      );

    return {
      formula: formulaConfig.metricFormulaData?.metricFormula || "",
      ...(formulaConfig.metricAliasData?.metricVariable
        ? { variable: formulaConfig.metricAliasData.metricVariable }
        : {}),
      ...(alias ? { alias } : {}),
    };
  }

  /*
   * Parses the JSON-encoded `metricQueries` param. Defensive by design:
   * malformed JSON or a non-array yields [], garbage entries are skipped,
   * wrong-typed fields are dropped, unknown fields are ignored — the
   * result is always safe plain data. Older links carrying only a subset
   * of fields parse fine because everything except metricName defaults.
   */
  public static parseMetricQueriesParam(
    raw: string,
  ): Array<SerializedMetricQuery> {
    let parsedValue: unknown = null;

    try {
      parsedValue = JSONFunctions.parse(raw);
    } catch {
      return [];
    }

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    const sanitizedQueries: Array<SerializedMetricQuery> = [];

    for (const entry of parsedValue) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }

      const entryRecord: Record<string, unknown> = entry as Record<
        string,
        unknown
      >;

      const metricName: string =
        typeof entryRecord["metricName"] === "string"
          ? (entryRecord["metricName"] as string)
          : "";

      const attributes: Dictionary<string | number | boolean> =
        MetricExplorerUrl.sanitizeAttributes(entryRecord["attributes"]);

      const aggregationType: MetricsAggregationType | undefined =
        MetricExplorerUrl.getAggregationTypeFromValue(
          entryRecord["aggregationType"],
        );

      const alias: SerializedMetricQueryAlias | undefined =
        MetricExplorerUrl.sanitizeAlias(entryRecord["alias"], entryRecord);

      const groupByAttributeKeys: Array<string> =
        MetricExplorerUrl.sanitizeGroupByAttributeKeys(
          entryRecord["groupByAttributeKeys"],
        );

      const chartType: MetricChartType | undefined =
        MetricExplorerUrl.getChartTypeFromValue(entryRecord["chartType"]);

      const color: string | undefined =
        typeof entryRecord["color"] === "string" &&
        (entryRecord["color"] as string).trim() !== ""
          ? (entryRecord["color"] as string)
          : undefined;

      const colorsByGroup: Dictionary<string> =
        MetricExplorerUrl.sanitizeColorsByGroup(entryRecord["colorsByGroup"]);

      const warningThreshold: number | undefined =
        MetricExplorerUrl.getFiniteNumberFromValue(
          entryRecord["warningThreshold"],
        );

      const criticalThreshold: number | undefined =
        MetricExplorerUrl.getFiniteNumberFromValue(
          entryRecord["criticalThreshold"],
        );

      const topN: number | undefined =
        MetricExplorerUrl.getPositiveIntegerFromValue(entryRecord["topN"]);

      sanitizedQueries.push({
        metricName,
        attributes,
        ...(aggregationType ? { aggregationType } : {}),
        ...(alias ? { alias } : {}),
        ...(groupByAttributeKeys.length > 0 ? { groupByAttributeKeys } : {}),
        ...(chartType ? { chartType } : {}),
        ...(color ? { color } : {}),
        ...(Object.keys(colorsByGroup).length > 0 ? { colorsByGroup } : {}),
        ...(warningThreshold !== undefined ? { warningThreshold } : {}),
        ...(criticalThreshold !== undefined ? { criticalThreshold } : {}),
        ...(entryRecord["transformAsRate"] === true
          ? { transformAsRate: true }
          : {}),
        ...(entryRecord["overlayWithPreviousQuery"] === true
          ? { overlayWithPreviousQuery: true }
          : {}),
        ...(topN !== undefined ? { topN } : {}),
      });
    }

    return sanitizedQueries;
  }

  public static parseMetricFormulasParam(
    raw: string,
  ): Array<SerializedMetricFormula> {
    let parsedValue: unknown = null;

    try {
      parsedValue = JSONFunctions.parse(raw);
    } catch {
      return [];
    }

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    const formulas: Array<SerializedMetricFormula> = [];

    for (const entry of parsedValue) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }

      const entryRecord: Record<string, unknown> = entry as Record<
        string,
        unknown
      >;

      const formula: string =
        typeof entryRecord["formula"] === "string"
          ? (entryRecord["formula"] as string)
          : "";

      if (!formula) {
        continue;
      }

      const variable: string | undefined =
        typeof entryRecord["variable"] === "string"
          ? (entryRecord["variable"] as string)
          : undefined;

      const alias: SerializedMetricQueryAlias | undefined =
        MetricExplorerUrl.sanitizeAlias(entryRecord["alias"], entryRecord);

      formulas.push({
        formula,
        ...(variable ? { variable } : {}),
        ...(alias ? { alias } : {}),
      });
    }

    return formulas;
  }

  /*
   * A query earns a spot in the URL if it selects any data (name,
   * attribute filters, non-default aggregation, group-by) OR carries any
   * display-only customization (alias text, chart type, colors,
   * thresholds, rate/overlay transforms) — dropping those on share would
   * silently lose user work.
   */
  public static isMeaningfulMetricQuery(query: SerializedMetricQuery): boolean {
    if (query.metricName) {
      return true;
    }

    if (query.attributes && Object.keys(query.attributes).length > 0) {
      return true;
    }

    if (
      query.aggregationType &&
      query.aggregationType !== MetricsAggregationType.Avg
    ) {
      return true;
    }

    if (query.alias && Object.keys(query.alias).length > 0) {
      return true;
    }

    if (query.groupByAttributeKeys && query.groupByAttributeKeys.length > 0) {
      return true;
    }

    if (query.chartType) {
      return true;
    }

    if (query.color) {
      return true;
    }

    if (query.colorsByGroup && Object.keys(query.colorsByGroup).length > 0) {
      return true;
    }

    if (
      query.warningThreshold !== undefined ||
      query.criticalThreshold !== undefined
    ) {
      return true;
    }

    if (query.transformAsRate === true) {
      return true;
    }

    if (query.overlayWithPreviousQuery === true) {
      return true;
    }

    if (query.topN !== undefined) {
      return true;
    }

    return false;
  }

  public static isMeaningfulMetricFormula(
    formula: SerializedMetricFormula,
  ): boolean {
    return Boolean(formula.formula && formula.formula.trim());
  }

  public static sanitizeAttributes(
    value: unknown,
  ): Dictionary<string | number | boolean> {
    if (value === null || value === undefined) {
      return {};
    }

    let candidate: unknown = value;

    if (typeof value === "string") {
      try {
        candidate = JSONFunctions.parse(value);
      } catch {
        return {};
      }
    }

    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      return {};
    }

    const attributes: Dictionary<string | number | boolean> = {};

    for (const key in candidate as Record<string, unknown>) {
      const attributeValue: unknown = (candidate as Record<string, unknown>)[
        key
      ];

      if (
        typeof attributeValue === "string" ||
        typeof attributeValue === "number" ||
        typeof attributeValue === "boolean"
      ) {
        attributes[key] = attributeValue;
      }
    }

    return attributes;
  }

  private static buildAliasFromMetricAliasData(
    data: MetricQueryConfigData["metricAliasData"],
  ): SerializedMetricQueryAlias | undefined {
    if (!data) {
      return undefined;
    }

    const alias: SerializedMetricQueryAlias = {};

    if (typeof data.title === "string" && data.title.trim() !== "") {
      alias.title = data.title;
    }

    if (
      typeof data.description === "string" &&
      data.description.trim() !== ""
    ) {
      alias.description = data.description;
    }

    if (typeof data.legend === "string" && data.legend.trim() !== "") {
      alias.legend = data.legend;
    }

    if (typeof data.legendUnit === "string" && data.legendUnit.trim() !== "") {
      alias.legendUnit = data.legendUnit;
    }

    return Object.keys(alias).length > 0 ? alias : undefined;
  }

  private static sanitizeAlias(
    value: unknown,
    fallback?: Record<string, unknown>,
  ): SerializedMetricQueryAlias | undefined {
    const alias: SerializedMetricQueryAlias = {};

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const aliasRecord: Record<string, unknown> = value as Record<
        string,
        unknown
      >;

      if (typeof aliasRecord["title"] === "string") {
        alias.title = aliasRecord["title"] as string;
      }

      if (typeof aliasRecord["description"] === "string") {
        alias.description = aliasRecord["description"] as string;
      }

      if (typeof aliasRecord["legend"] === "string") {
        alias.legend = aliasRecord["legend"] as string;
      }

      if (typeof aliasRecord["legendUnit"] === "string") {
        alias.legendUnit = aliasRecord["legendUnit"] as string;
      }
    }

    // Backward compatibility: allow flat keys on the main query record.
    if (fallback) {
      if (alias.title === undefined && typeof fallback["title"] === "string") {
        alias.title = fallback["title"] as string;
      }

      if (
        alias.description === undefined &&
        typeof fallback["description"] === "string"
      ) {
        alias.description = fallback["description"] as string;
      }

      if (
        alias.legend === undefined &&
        typeof fallback["legend"] === "string"
      ) {
        alias.legend = fallback["legend"] as string;
      }

      if (
        alias.legendUnit === undefined &&
        typeof fallback["legendUnit"] === "string"
      ) {
        alias.legendUnit = fallback["legendUnit"] as string;
      }
    }

    return Object.keys(alias).length > 0 ? alias : undefined;
  }

  private static getAggregationTypeFromValue(
    value: unknown,
  ): MetricsAggregationType | undefined {
    if (typeof value === "string") {
      const aggregationTypeValues: Array<string> = Object.values(
        MetricsAggregationType,
      ) as Array<string>;

      if (aggregationTypeValues.includes(value)) {
        return value as MetricsAggregationType;
      }
    }

    return undefined;
  }

  private static getChartTypeFromValue(
    value: unknown,
  ): MetricChartType | undefined {
    if (typeof value === "string") {
      const chartTypeValues: Array<string> = Object.values(
        MetricChartType,
      ) as Array<string>;

      if (chartTypeValues.includes(value)) {
        return value as MetricChartType;
      }
    }

    return undefined;
  }

  private static getFiniteNumberFromValue(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    return undefined;
  }

  private static getPositiveIntegerFromValue(
    value: unknown,
  ): number | undefined {
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      return value;
    }

    return undefined;
  }

  private static sanitizeGroupByAttributeKeys(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    const keys: Array<string> = [];

    for (const entry of value) {
      if (typeof entry === "string" && entry.trim() !== "") {
        keys.push(entry);
      }
    }

    return keys;
  }

  private static sanitizeColorsByGroup(value: unknown): Dictionary<string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    const colorsByGroup: Dictionary<string> = {};

    for (const key in value as Record<string, unknown>) {
      const colorValue: unknown = (value as Record<string, unknown>)[key];

      if (typeof colorValue === "string" && colorValue.trim() !== "") {
        colorsByGroup[key] = colorValue;
      }
    }

    return colorsByGroup;
  }
}
