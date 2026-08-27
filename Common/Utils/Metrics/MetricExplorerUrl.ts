import Dictionary from "../../Types/Dictionary";
import Includes from "../../Types/BaseDatabase/Includes";
import JSONFunctions from "../../Types/JSONFunctions";
import QueryOperator from "../../Types/BaseDatabase/QueryOperator";
import SerializableObjectDictionary from "../../Types/SerializableObjectDictionary";
import { JSONObject } from "../../Types/JSON";
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
   * Emitted for every relative range — including the default Past 1 Hour,
   * so reloaded/shared links keep rolling instead of pinning — and
   * omitted only for Custom/pinned absolute windows. startTime/endTime
   * always carry the absolute window for back-compat, so older links
   * (which never had a range param) keep working as pinned windows.
   */
  Range = "range",
  /*
   * One-shot service scope: a JSON array of Service ObjectID strings,
   * emitted by cross-signal pivots (logs/traces -> metrics). The explorer
   * resolves the ids to service names on load, folds them into every
   * query's `resource.service.name` attribute filter (the metric store's
   * service dimension), and then DELETES the param on its next write-back
   * — the scope lives on as ordinary, user-editable attribute filters.
   */
  Services = "services",
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
  /*
   * The query's variable letter (metricAliasData.metricVariable), so
   * formulas referencing it keep resolving after a round-trip even when
   * the live view's variables are not positional (e.g. a lone query
   * named "b" after "a" was deleted). Absent on links serialized by
   * older versions — reconstruction then falls back to positional
   * lettering (a, b, ...).
   */
  variable?: string | undefined;
  attributes?: Dictionary<SerializedMetricAttributeValue> | undefined;
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

/*
 * Plain-data shape of one formula inside the `metricFormulas` param.
 * Display customization (chart type, color, thresholds) round-trips just
 * like it does for queries — dropping it on share/save would silently
 * lose user work. All of it is optional so older links keep parsing.
 */
export interface SerializedMetricFormula {
  formula: string;
  variable?: string | undefined;
  alias?: SerializedMetricQueryAlias | undefined;
  chartType?: MetricChartType | undefined;
  color?: string | undefined;
  warningThreshold?: number | undefined;
  criticalThreshold?: number | undefined;
}

/*
 * One attribute filter value inside the serialized `metricQueries` param.
 * Scalars are equality filters; every other operator (Includes, Search,
 * Wildcard, NotEqual, GreaterThan, ...) travels as its own
 * {_type, value} JSON and is rebuilt into a real instance on the way back —
 * that round trip is how a multi-service scope, or a `matches api-*` filter,
 * survives Copy Link and saved views.
 *
 * This used to keep ONLY scalars and Includes, so every other operator was
 * silently dropped from a copied link: the chart the recipient opened had
 * fewer filters than the one that was shared, with nothing to say so.
 */
export type SerializedMetricAttributeValue =
  | string
  | number
  | boolean
  | Includes
  | QueryOperator<string>;

const MAX_SERVICES_PARAM_ENTRIES: number = 20;

export default class MetricExplorerUrl {
  /**
   * Parses the `services` param: a JSON array of non-empty strings,
   * deduped, capped. Garbage yields [] — same defensive posture as the
   * other param parsers.
   */
  public static parseServicesParam(raw: string): Array<string> {
    let parsedValue: unknown = null;

    try {
      parsedValue = JSONFunctions.parse(raw);
    } catch {
      return [];
    }

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    const serviceIds: Array<string> = [];

    for (const entry of parsedValue) {
      if (
        typeof entry === "string" &&
        entry.trim() !== "" &&
        !serviceIds.includes(entry)
      ) {
        serviceIds.push(entry);
      }
      if (serviceIds.length >= MAX_SERVICES_PARAM_ENTRIES) {
        break;
      }
    }

    return serviceIds;
  }

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
     * Relative token. Emitted for every relative range — including the
     * default Past 1 Hour, because parsing treats absolute-only params
     * as a pinned Custom window, so leaving the default implicit would
     * silently turn the rolling hour into a frozen window on reload or
     * Copy Link. Custom windows are represented by the absolute params
     * alone (getValidRangeToken filters Custom and garbage).
     */
    const rangeToken: string | undefined = MetricExplorerUrl.getValidRangeToken(
      data.rangeToken,
    );

    if (rangeToken) {
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

    const attributes: Dictionary<SerializedMetricAttributeValue> =
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
      ...(queryConfig.metricAliasData?.metricVariable
        ? { variable: queryConfig.metricAliasData.metricVariable }
        : {}),
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

    const chartType: MetricChartType | undefined =
      MetricExplorerUrl.getChartTypeFromValue(formulaConfig.chartType);

    const color: string | undefined =
      typeof formulaConfig.color === "string" &&
      formulaConfig.color.trim() !== ""
        ? formulaConfig.color
        : undefined;

    const warningThreshold: number | undefined =
      MetricExplorerUrl.getFiniteNumberFromValue(
        formulaConfig.warningThreshold,
      );

    const criticalThreshold: number | undefined =
      MetricExplorerUrl.getFiniteNumberFromValue(
        formulaConfig.criticalThreshold,
      );

    return {
      formula: formulaConfig.metricFormulaData?.metricFormula || "",
      ...(formulaConfig.metricAliasData?.metricVariable
        ? { variable: formulaConfig.metricAliasData.metricVariable }
        : {}),
      ...(alias ? { alias } : {}),
      ...(chartType ? { chartType } : {}),
      ...(color ? { color } : {}),
      ...(warningThreshold !== undefined ? { warningThreshold } : {}),
      ...(criticalThreshold !== undefined ? { criticalThreshold } : {}),
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

      const variable: string | undefined =
        typeof entryRecord["variable"] === "string"
          ? (entryRecord["variable"] as string)
          : undefined;

      const attributes: Dictionary<SerializedMetricAttributeValue> =
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
        ...(variable ? { variable } : {}),
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

      const chartType: MetricChartType | undefined =
        MetricExplorerUrl.getChartTypeFromValue(entryRecord["chartType"]);

      const color: string | undefined =
        typeof entryRecord["color"] === "string" &&
        (entryRecord["color"] as string).trim() !== ""
          ? (entryRecord["color"] as string)
          : undefined;

      const warningThreshold: number | undefined =
        MetricExplorerUrl.getFiniteNumberFromValue(
          entryRecord["warningThreshold"],
        );

      const criticalThreshold: number | undefined =
        MetricExplorerUrl.getFiniteNumberFromValue(
          entryRecord["criticalThreshold"],
        );

      formulas.push({
        formula,
        ...(variable ? { variable } : {}),
        ...(alias ? { alias } : {}),
        ...(chartType ? { chartType } : {}),
        ...(color ? { color } : {}),
        ...(warningThreshold !== undefined ? { warningThreshold } : {}),
        ...(criticalThreshold !== undefined ? { criticalThreshold } : {}),
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
  ): Dictionary<SerializedMetricAttributeValue> {
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

    const attributes: Dictionary<SerializedMetricAttributeValue> = {};

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
        continue;
      }

      /*
       * Operator filters. Live view state holds INSTANCES; a parsed URL holds
       * the plain {_type, value} JSON shape. Both normalize to a fresh
       * instance, so the filter means the same thing on both sides of a Copy
       * Link — and the downstream consumers (the query layer, the operator
       * detector, the monitor evaluator's deep-link builder) all speak
       * operator instances already.
       *
       * An empty membership list is the one shape that is dropped: it means
       * "All", and carrying it would only add a no-op predicate.
       */
      /*
       * Membership keeps its own branch because it also CLEANS: blank and
       * non-scalar entries are dropped, and a list left empty by that means
       * "All" and carries no predicate at all.
       */
      const membershipValues: Array<string> | null =
        MetricExplorerUrl.getIncludesShapeValues(attributeValue);

      if (membershipValues !== null) {
        if (membershipValues.length > 0) {
          attributes[key] = new Includes(membershipValues);
        }

        continue;
      }

      if (attributeValue instanceof QueryOperator) {
        attributes[key] = attributeValue as QueryOperator<string>;
        continue;
      }

      const rebuilt: QueryOperator<string> | null =
        MetricExplorerUrl.rebuildOperator(attributeValue);

      if (rebuilt) {
        attributes[key] = rebuilt;
      }
    }

    return attributes;
  }

  /*
   * Rebuild a `{_type, value}` JSON blob into its operator instance, using the
   * same registry `JSONFunctions.deserialize` uses. An unknown `_type` yields
   * null rather than a half-hydrated object — a plain object reaching the
   * query layer is a silently wrong filter, not an error.
   */
  private static rebuildOperator(value: unknown): QueryOperator<string> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const type: unknown = (value as Record<string, unknown>)["_type"];

    if (typeof type !== "string" || !SerializableObjectDictionary[type]) {
      return null;
    }

    try {
      const hydrated: unknown = SerializableObjectDictionary[type].fromJSON(
        value as JSONObject,
      );

      return hydrated instanceof QueryOperator
        ? (hydrated as QueryOperator<string>)
        : null;
    } catch {
      // Malformed payload in a hand-edited URL. Drop the filter, not the page.
      return null;
    }
  }

  private static getIncludesShapeValues(value: unknown): Array<string> | null {
    let rawValues: unknown = null;

    if (value instanceof Includes) {
      rawValues = value.values;
    } else if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>)["_type"] === "Includes"
    ) {
      rawValues = (value as Record<string, unknown>)["value"];
    } else {
      return null;
    }

    if (!Array.isArray(rawValues)) {
      return [];
    }

    const values: Array<string> = [];

    for (const entry of rawValues) {
      if (
        (typeof entry === "string" && entry.trim() !== "") ||
        typeof entry === "number" ||
        typeof entry === "boolean"
      ) {
        values.push(String(entry));
      }
    }

    return values;
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
