import AggregationType, {
  getPercentileLevel,
  isPercentileAggregation,
} from "../BaseDatabase/AggregationType";
import ObjectID from "../ObjectID";
import LogSeverity from "./LogSeverity";

/*
 * A Log Recording Rule turns logs into a metric. Every minute the worker
 * counts the logs that match the rule's filter - or aggregates one numeric
 * attribute they carry (sum, average, min, max, a percentile) - optionally
 * split by up to LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES attributes, and
 * writes one point per minute per series into the metric store under the
 * rule's Output Metric Name. Charts, dashboards and Metrics monitors then
 * read it like any other metric.
 *
 * The motivating case: a firewall's syslog SLA summaries, parsed by a log
 * pipeline into attributes (gw_name, latency, jitter, packet_loss ...),
 * become `avg(latency) by gw_name` - a latency series per gateway that a
 * Metrics monitor with Group By can alert on.
 *
 * Persisted as JSONB on LogRecordingRule.definition, so new fields can be
 * added without migrating Postgres. Definitions arrive as JSON (the API, the
 * dashboard, Terraform), so everything here reads `unknown` defensively and
 * never throws.
 */

/*
 * One attribute equality filter: the log must carry `key` with exactly
 * `value` (the shape trace recording rules use for the same job). Keys are
 * matched case-insensitively, like the log explorer's attribute filters.
 */
export interface LogRecordingRuleAttributeFilter {
  key: string;
  value: string;
}

/*
 * Which logs a rule reads. The field names and meanings are the Logs
 * monitor's (MonitorStepLogMonitor) - minus its time window, which a rule
 * does not have: it always reads the minutes that have elapsed since it last
 * ran. Every filter is optional and they AND together; an empty filter reads
 * every log of the project.
 */
export interface LogRecordingRuleFilter {
  // Telemetry service ids (strings). Empty: logs of every service.
  telemetryServiceIds?: Array<string> | undefined;
  // Empty: logs of every severity.
  severityTexts?: Array<LogSeverity> | undefined;
  // The body contains this text (case-insensitive). Empty: any body.
  body?: string | undefined;
  // Attribute equality filters, ANDed.
  attributeFilters?: Array<LogRecordingRuleAttributeFilter> | undefined;
}

export default interface LogRecordingRuleDefinition {
  filter: LogRecordingRuleFilter;
  /*
   * Count counts the matching logs. Every other aggregation reads the
   * numeric `valueAttribute` of each matching log; a log whose value is
   * missing or not a number is skipped - never counted as 0.
   */
  aggregationType: AggregationType;
  // The attribute aggregated by everything but Count (e.g. "latency").
  valueAttribute?: string | undefined;
  /*
   * Attribute keys to split the metric by - one series per distinct
   * combination of their values, each written with those attributes so a
   * chart or a Metrics monitor can group by them in turn.
   */
  groupByAttributes?: Array<string> | undefined;
  // The output metric's unit (e.g. "ms", "%", "bytes"). Optional.
  unit?: string | undefined;
}

export interface LogRecordingRuleAggregationOption {
  value: AggregationType;
  label: string;
  description: string;
}

// The aggregations a rule may use, in the order the editor offers them.
export const LOG_RECORDING_RULE_AGGREGATION_TYPES: ReadonlyArray<AggregationType> =
  [
    AggregationType.Count,
    AggregationType.Avg,
    AggregationType.Sum,
    AggregationType.Min,
    AggregationType.Max,
    AggregationType.P50,
    AggregationType.P75,
    AggregationType.P90,
    AggregationType.P95,
    AggregationType.P99,
  ];

/*
 * Group-by keys per rule. Each one multiplies the series a rule can write,
 * so it is kept small; five covers profile x gateway x site and more.
 */
export const LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES: number = 5;

// Attribute equality filters per rule.
export const LOG_RECORDING_RULE_MAX_ATTRIBUTE_FILTERS: number = 10;

// Telemetry services one rule may be limited to.
export const LOG_RECORDING_RULE_MAX_TELEMETRY_SERVICES: number = 100;

/*
 * Series written per minute. A group by on a high-cardinality attribute (a
 * request id, a client IP) would otherwise write a series per value; past
 * this many the busiest series - by matching log count - are kept and the
 * rest dropped for that minute (the worker logs that it happened).
 */
export const LOG_RECORDING_RULE_MAX_SERIES_PER_MINUTE: number = 1000;

/*
 * Attribute keys a rule names - filter, value and group-by keys. The same
 * shape the log explorer's facets, analytics group-by and filters accept
 * (LogAggregationService), so a key usable there is usable here. Keys are
 * bound as query parameters regardless; the pattern catches typos and keeps
 * the two surfaces agreeing.
 */
export const LOG_RECORDING_RULE_ATTRIBUTE_KEY_PATTERN: RegExp =
  /^[a-zA-Z0-9._:/-]+$/;

export const LOG_RECORDING_RULE_ATTRIBUTE_KEY_MAX_LENGTH: number = 256;

export const LOG_RECORDING_RULE_ATTRIBUTE_VALUE_MAX_LENGTH: number = 1000;

export const LOG_RECORDING_RULE_BODY_MAX_LENGTH: number = 500;

export const LOG_RECORDING_RULE_UNIT_MAX_LENGTH: number = 50;

/*
 * Every point a rule writes carries its rule's id under this attribute (the
 * metric and trace recording rules write oneuptime.derived.rule_id and
 * oneuptime.derived.trace_rule_id), so derived series can be told apart
 * from raw data. Group-by keys may not use the oneuptime.derived. namespace.
 */
export const LOG_RECORDING_RULE_ID_ATTRIBUTE: string =
  "oneuptime.derived.log_rule_id";

export const LOG_RECORDING_RULE_RESERVED_ATTRIBUTE_PREFIX: string =
  "oneuptime.derived.";

const LOG_SEVERITIES: ReadonlyArray<string> = Object.values(LogSeverity);

export class LogRecordingRuleDefinitionUtil {
  public static getAggregationOptions(): Array<LogRecordingRuleAggregationOption> {
    return [
      {
        value: AggregationType.Count,
        label: "Count of logs",
        description: "How many logs matched the filter in the minute.",
      },
      {
        value: AggregationType.Avg,
        label: "Average",
        description: "The average of the attribute's values in the minute.",
      },
      {
        value: AggregationType.Sum,
        label: "Sum",
        description: "The attribute's values added up over the minute.",
      },
      {
        value: AggregationType.Min,
        label: "Minimum",
        description: "The smallest of the attribute's values in the minute.",
      },
      {
        value: AggregationType.Max,
        label: "Maximum",
        description: "The largest of the attribute's values in the minute.",
      },
      {
        value: AggregationType.P50,
        label: "p50 (median)",
        description: "The median of the attribute's values in the minute.",
      },
      {
        value: AggregationType.P75,
        label: "p75",
        description: "The 75th percentile of the attribute's values.",
      },
      {
        value: AggregationType.P90,
        label: "p90",
        description: "The 90th percentile of the attribute's values.",
      },
      {
        value: AggregationType.P95,
        label: "p95",
        description: "The 95th percentile of the attribute's values.",
      },
      {
        value: AggregationType.P99,
        label: "p99",
        description: "The 99th percentile of the attribute's values.",
      },
    ];
  }

  public static isSupportedAggregation(value: unknown): boolean {
    return (
      typeof value === "string" &&
      LOG_RECORDING_RULE_AGGREGATION_TYPES.includes(value as AggregationType)
    );
  }

  /*
   * Whether the aggregation reads a numeric attribute (everything but Count).
   */
  public static needsValueAttribute(aggregationType: AggregationType): boolean {
    return aggregationType !== AggregationType.Count;
  }

  public static getPercentileLevel(
    aggregationType: AggregationType,
  ): number | null {
    return isPercentileAggregation(aggregationType)
      ? getPercentileLevel(aggregationType)
      : null;
  }

  // What a new rule starts from: count every log, one series.
  public static getEmptyDefinition(): LogRecordingRuleDefinition {
    return {
      filter: {
        telemetryServiceIds: [],
        severityTexts: [],
        body: "",
        attributeFilters: [],
      },
      aggregationType: AggregationType.Count,
      valueAttribute: "",
      groupByAttributes: [],
      unit: "",
    };
  }

  /*
   * The definition held in `raw` - an object, or the JSON string the
   * dashboard's JSON fields store - with every field of the wrong type
   * dropped and nothing else changed: incomplete rows are kept, so
   * getValidationError can say what is wrong with them. Null when there is
   * no definition there at all.
   */
  public static fromJSON(raw: unknown): LogRecordingRuleDefinition | null {
    let value: unknown = raw;

    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        return null;
      }
    }

    if (!LogRecordingRuleDefinitionUtil.isPlainObject(value)) {
      return null;
    }

    const json: Record<string, unknown> = value as Record<string, unknown>;
    const rawFilter: unknown = json["filter"];
    const filterJson: Record<string, unknown> =
      LogRecordingRuleDefinitionUtil.isPlainObject(rawFilter)
        ? (rawFilter as Record<string, unknown>)
        : {};

    const filter: LogRecordingRuleFilter = {};

    if (Array.isArray(filterJson["telemetryServiceIds"])) {
      filter.telemetryServiceIds = (
        filterJson["telemetryServiceIds"] as Array<unknown>
      )
        .map((id: unknown): string | null => {
          return LogRecordingRuleDefinitionUtil.readId(id);
        })
        .filter((id: string | null): id is string => {
          return id !== null;
        });
    }

    if (Array.isArray(filterJson["severityTexts"])) {
      filter.severityTexts = (filterJson["severityTexts"] as Array<unknown>)
        .filter((severity: unknown): boolean => {
          return typeof severity === "string";
        })
        .map((severity: unknown): LogSeverity => {
          return severity as LogSeverity;
        });
    }

    if (typeof filterJson["body"] === "string") {
      filter.body = filterJson["body"] as string;
    }

    if (Array.isArray(filterJson["attributeFilters"])) {
      filter.attributeFilters = (
        filterJson["attributeFilters"] as Array<unknown>
      )
        .filter((row: unknown): boolean => {
          return LogRecordingRuleDefinitionUtil.isPlainObject(row);
        })
        .map((row: unknown): LogRecordingRuleAttributeFilter => {
          const rowJson: Record<string, unknown> = row as Record<
            string,
            unknown
          >;

          return {
            key: LogRecordingRuleDefinitionUtil.readText(rowJson["key"]),
            value: LogRecordingRuleDefinitionUtil.readText(rowJson["value"]),
          };
        });
    }

    const definition: LogRecordingRuleDefinition = {
      filter: filter,
      aggregationType: json["aggregationType"] as AggregationType,
    };

    if (typeof json["valueAttribute"] === "string") {
      definition.valueAttribute = json["valueAttribute"] as string;
    }

    if (Array.isArray(json["groupByAttributes"])) {
      definition.groupByAttributes = (
        json["groupByAttributes"] as Array<unknown>
      ).map((key: unknown): string => {
        return typeof key === "string" ? key : "";
      });
    }

    if (typeof json["unit"] === "string") {
      definition.unit = json["unit"] as string;
    }

    return definition;
  }

  /*
   * The first problem with a definition, in words the dashboard shows under
   * the editor and the API returns as a 400 - or null when it is valid.
   * Reads the raw JSON, so it can be handed anything.
   */
  public static getValidationError(raw: unknown): string | null {
    if (raw === undefined || raw === null || raw === "") {
      return "Definition is required.";
    }

    const definition: LogRecordingRuleDefinition | null =
      LogRecordingRuleDefinitionUtil.fromJSON(raw);

    if (!definition) {
      return "Definition is not valid JSON.";
    }

    const json: Record<string, unknown> = (
      typeof raw === "string" ? JSON.parse(raw) : raw
    ) as Record<string, unknown>;

    if (
      json["filter"] !== undefined &&
      json["filter"] !== null &&
      !LogRecordingRuleDefinitionUtil.isPlainObject(json["filter"])
    ) {
      return "The log filter is not valid.";
    }

    const filterError: string | null =
      LogRecordingRuleDefinitionUtil.getFilterValidationError(
        (json["filter"] as Record<string, unknown> | undefined) || {},
      );

    if (filterError) {
      return filterError;
    }

    if (!definition.aggregationType) {
      return "Choose an aggregation.";
    }

    if (
      !LogRecordingRuleDefinitionUtil.isSupportedAggregation(
        definition.aggregationType,
      )
    ) {
      return `Unknown aggregation "${String(definition.aggregationType)}". Choose one of: ${LOG_RECORDING_RULE_AGGREGATION_TYPES.join(", ")}.`;
    }

    if (
      json["valueAttribute"] !== undefined &&
      json["valueAttribute"] !== null &&
      typeof json["valueAttribute"] !== "string"
    ) {
      return "The numeric attribute must be an attribute key.";
    }

    if (
      LogRecordingRuleDefinitionUtil.needsValueAttribute(
        definition.aggregationType,
      )
    ) {
      const valueAttribute: string = (definition.valueAttribute || "").trim();

      if (!valueAttribute) {
        return "Choose the numeric attribute to aggregate (e.g. latency).";
      }

      const keyError: string | null =
        LogRecordingRuleDefinitionUtil.getAttributeKeyError(
          valueAttribute,
          "The numeric attribute",
        );

      if (keyError) {
        return keyError;
      }
    }

    if (
      json["groupByAttributes"] !== undefined &&
      json["groupByAttributes"] !== null &&
      !Array.isArray(json["groupByAttributes"])
    ) {
      return "Group by must be a list of attribute keys.";
    }

    const groupByAttributes: Array<unknown> =
      (json["groupByAttributes"] as Array<unknown> | undefined) || [];

    if (groupByAttributes.length > LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES) {
      return `A rule can group by at most ${LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES} attributes.`;
    }

    const seenGroupByKeys: Set<string> = new Set<string>();

    for (let i: number = 0; i < groupByAttributes.length; i++) {
      const rawKey: unknown = groupByAttributes[i];

      if (typeof rawKey !== "string") {
        return `Group by attribute #${i + 1} must be an attribute key.`;
      }

      const key: string = rawKey.trim();

      if (!key) {
        return `Group by attribute #${i + 1} is empty. Type an attribute key or remove the row.`;
      }

      const keyError: string | null =
        LogRecordingRuleDefinitionUtil.getAttributeKeyError(
          key,
          `Group by attribute "${key}"`,
        );

      if (keyError) {
        return keyError;
      }

      if (
        key
          .toLowerCase()
          .startsWith(LOG_RECORDING_RULE_RESERVED_ATTRIBUTE_PREFIX)
      ) {
        return `Group by attribute "${key}" is in the reserved ${LOG_RECORDING_RULE_RESERVED_ATTRIBUTE_PREFIX} namespace, which OneUptime writes on derived metrics.`;
      }

      if (seenGroupByKeys.has(key)) {
        return `Group by attribute "${key}" is listed twice.`;
      }

      seenGroupByKeys.add(key);
    }

    if (
      json["unit"] !== undefined &&
      json["unit"] !== null &&
      typeof json["unit"] !== "string"
    ) {
      return "The unit must be text (e.g. ms).";
    }

    if (
      (definition.unit || "").trim().length > LOG_RECORDING_RULE_UNIT_MAX_LENGTH
    ) {
      return `The unit must be ${LOG_RECORDING_RULE_UNIT_MAX_LENGTH} characters or fewer.`;
    }

    return null;
  }

  /*
   * The definition as it is stored and evaluated: text trimmed, empty and
   * duplicate entries dropped, severities spelled the way log rows store
   * them, and the numeric attribute left out of a Count. Apply to a
   * definition getValidationError accepted.
   */
  public static normalize(
    definition: LogRecordingRuleDefinition,
  ): LogRecordingRuleDefinition {
    const filter: LogRecordingRuleFilter = definition.filter || {};

    const telemetryServiceIds: Array<string> =
      LogRecordingRuleDefinitionUtil.unique(
        (filter.telemetryServiceIds || [])
          .map((id: string): string => {
            return id.trim().toLowerCase();
          })
          .filter((id: string): boolean => {
            return id.length > 0;
          }),
      );

    const severityTexts: Array<LogSeverity> =
      LogRecordingRuleDefinitionUtil.unique(
        (filter.severityTexts || []).filter((severity: string): boolean => {
          return LOG_SEVERITIES.includes(severity);
        }),
      ) as Array<LogSeverity>;

    const seenFilterKeys: Set<string> = new Set<string>();
    const attributeFilters: Array<LogRecordingRuleAttributeFilter> = [];

    for (const row of filter.attributeFilters || []) {
      const key: string = (row.key || "").trim();
      const value: string = (row.value || "").trim();

      if (!key || !value || seenFilterKeys.has(key.toLowerCase())) {
        continue;
      }

      seenFilterKeys.add(key.toLowerCase());
      attributeFilters.push({ key, value });
    }

    const groupByAttributes: Array<string> =
      LogRecordingRuleDefinitionUtil.unique(
        (definition.groupByAttributes || [])
          .map((key: string): string => {
            return (key || "").trim();
          })
          .filter((key: string): boolean => {
            return key.length > 0;
          }),
      ).slice(0, LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES);

    const normalized: LogRecordingRuleDefinition = {
      filter: {
        telemetryServiceIds,
        severityTexts,
        body: (filter.body || "").trim(),
        attributeFilters,
      },
      aggregationType: definition.aggregationType,
      groupByAttributes,
      unit: (definition.unit || "").trim(),
    };

    if (
      LogRecordingRuleDefinitionUtil.needsValueAttribute(
        definition.aggregationType,
      )
    ) {
      normalized.valueAttribute = (definition.valueAttribute || "").trim();
    }

    return normalized;
  }

  /*
   * What a rule computes, in one line: "count", "avg(latency)",
   * "p95(latency) by gw_name, profile_name". For the rules list and the
   * editor's summary.
   */
  public static describe(definition: LogRecordingRuleDefinition): string {
    const aggregationType: AggregationType = definition.aggregationType;
    const groupBy: Array<string> = (definition.groupByAttributes || [])
      .map((key: string): string => {
        return (key || "").trim();
      })
      .filter((key: string): boolean => {
        return key.length > 0;
      });

    let computed: string = "count";

    if (
      aggregationType &&
      LogRecordingRuleDefinitionUtil.needsValueAttribute(aggregationType)
    ) {
      computed = `${aggregationType.toLowerCase()}(${
        (definition.valueAttribute || "").trim() || "?"
      })`;
    }

    return groupBy.length > 0
      ? `${computed} by ${groupBy.join(", ")}`
      : computed;
  }

  private static getFilterValidationError(
    filter: Record<string, unknown>,
  ): string | null {
    const telemetryServiceIds: unknown = filter["telemetryServiceIds"];

    if (telemetryServiceIds !== undefined && telemetryServiceIds !== null) {
      if (!Array.isArray(telemetryServiceIds)) {
        return "Telemetry services must be a list of service ids.";
      }

      if (
        telemetryServiceIds.length > LOG_RECORDING_RULE_MAX_TELEMETRY_SERVICES
      ) {
        return `A rule can be limited to at most ${LOG_RECORDING_RULE_MAX_TELEMETRY_SERVICES} telemetry services.`;
      }

      for (const id of telemetryServiceIds) {
        const readId: string | null = LogRecordingRuleDefinitionUtil.readId(id);

        if (!readId || !ObjectID.isValidUUID(readId.trim())) {
          return `"${String(readId ?? id)}" is not a telemetry service id.`;
        }
      }
    }

    const severityTexts: unknown = filter["severityTexts"];

    if (severityTexts !== undefined && severityTexts !== null) {
      if (!Array.isArray(severityTexts)) {
        return "Severities must be a list.";
      }

      for (const severity of severityTexts) {
        if (
          typeof severity !== "string" ||
          !LOG_SEVERITIES.includes(severity)
        ) {
          return `"${String(severity)}" is not a log severity. Use one of: ${LOG_SEVERITIES.join(", ")}.`;
        }
      }
    }

    const body: unknown = filter["body"];

    if (body !== undefined && body !== null) {
      if (typeof body !== "string") {
        return "The body filter must be text.";
      }

      if (body.trim().length > LOG_RECORDING_RULE_BODY_MAX_LENGTH) {
        return `The body filter must be ${LOG_RECORDING_RULE_BODY_MAX_LENGTH} characters or fewer.`;
      }
    }

    const attributeFilters: unknown = filter["attributeFilters"];

    if (attributeFilters !== undefined && attributeFilters !== null) {
      if (!Array.isArray(attributeFilters)) {
        return "Attribute filters must be a list.";
      }

      if (attributeFilters.length > LOG_RECORDING_RULE_MAX_ATTRIBUTE_FILTERS) {
        return `A rule can have at most ${LOG_RECORDING_RULE_MAX_ATTRIBUTE_FILTERS} attribute filters.`;
      }

      const seenKeys: Set<string> = new Set<string>();

      for (let i: number = 0; i < attributeFilters.length; i++) {
        const row: unknown = attributeFilters[i];

        if (!LogRecordingRuleDefinitionUtil.isPlainObject(row)) {
          return `Attribute filter #${i + 1} is not valid.`;
        }

        const rowJson: Record<string, unknown> = row as Record<string, unknown>;

        if (
          !LogRecordingRuleDefinitionUtil.isTextOrNumber(rowJson["key"]) ||
          !LogRecordingRuleDefinitionUtil.isTextOrNumber(rowJson["value"])
        ) {
          return `Attribute filter #${i + 1} needs a key and a value.`;
        }

        const key: string = LogRecordingRuleDefinitionUtil.readText(
          rowJson["key"],
        ).trim();
        const value: string = LogRecordingRuleDefinitionUtil.readText(
          rowJson["value"],
        ).trim();

        if (!key || !value) {
          return "Each attribute filter needs both a key and a value (or remove the row).";
        }

        const keyError: string | null =
          LogRecordingRuleDefinitionUtil.getAttributeKeyError(
            key,
            `Attribute filter "${key}"`,
          );

        if (keyError) {
          return keyError;
        }

        if (value.length > LOG_RECORDING_RULE_ATTRIBUTE_VALUE_MAX_LENGTH) {
          return `The value of attribute filter "${key}" must be ${LOG_RECORDING_RULE_ATTRIBUTE_VALUE_MAX_LENGTH} characters or fewer.`;
        }

        if (seenKeys.has(key.toLowerCase())) {
          return `Attribute filter "${key}" is listed twice. A log carries one value per attribute.`;
        }

        seenKeys.add(key.toLowerCase());
      }
    }

    return null;
  }

  private static getAttributeKeyError(
    key: string,
    subject: string,
  ): string | null {
    if (key.length > LOG_RECORDING_RULE_ATTRIBUTE_KEY_MAX_LENGTH) {
      return `${subject} must be ${LOG_RECORDING_RULE_ATTRIBUTE_KEY_MAX_LENGTH} characters or fewer.`;
    }

    if (!LOG_RECORDING_RULE_ATTRIBUTE_KEY_PATTERN.test(key)) {
      return `${subject} may only contain letters, digits and . _ : / - characters.`;
    }

    return null;
  }

  /*
   * A service id as JSON may hold it: the plain string the editor writes, or
   * the {_type: "ObjectID", value} shape ObjectID.toJSON emits.
   */
  private static readId(id: unknown): string | null {
    if (typeof id === "string") {
      return id;
    }

    if (
      LogRecordingRuleDefinitionUtil.isPlainObject(id) &&
      typeof (id as Record<string, unknown>)["value"] === "string"
    ) {
      return (id as Record<string, unknown>)["value"] as string;
    }

    return null;
  }

  // Attribute values arrive as text, or as numbers from a JSON client.
  private static readText(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }

    return "";
  }

  private static isTextOrNumber(value: unknown): boolean {
    return (
      typeof value === "string" ||
      (typeof value === "number" && Number.isFinite(value))
    );
  }

  private static isPlainObject(value: unknown): boolean {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  private static unique<T>(values: Array<T>): Array<T> {
    return Array.from(new Set<T>(values));
  }
}
