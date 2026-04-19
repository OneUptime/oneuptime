import AggregationType from "../BaseDatabase/AggregationType";

/*
 * A single source metric inside a Recording Rule. Each source is given an
 * alphabetic alias (A, B, C, ...) that can be referenced from the rule's
 * expression string. Aliases are case-sensitive and match /^[A-Z]$/ in v1.
 */
export interface RecordingRuleSource {
  alias: string;
  metricName: string;
  aggregationType: AggregationType;
  // Optional pre-filter so you can say e.g. "A = sum(http.requests WHERE http.status_code_class = '5xx')".
  filterAttributeKey?: string;
  filterAttributeValue?: string;
}

/*
 * Full stored definition of a Recording Rule. Persisted as a JSONB column on
 * MetricRecordingRule so we don't have to migrate the Postgres schema every
 * time we add a new field.
 */
export default interface RecordingRuleDefinition {
  sources: Array<RecordingRuleSource>;
  /*
   * Arithmetic expression in our simple DSL: operators + - * /, parentheses,
   * numeric literals, and alias references. Example: "A / B * 100".
   */
  expression: string;
  /*
   * Optional attribute key to group source queries by and preserve on output
   * rows. One derived data point per group per evaluation bucket.
   */
  groupByAttribute?: string;
}

/*
 * Maximum number of source metrics per rule for v1. Kept small to bound the
 * per-cron workload.
 */
export const RECORDING_RULE_MAX_SOURCES: number = 4;

// Maximum expression length for v1. Prevents pathological parser input.
export const RECORDING_RULE_MAX_EXPRESSION_LENGTH: number = 500;

/*
 * Alphabet used to generate source aliases. v1 caps at RECORDING_RULE_MAX_SOURCES
 * so we never exceed the first few letters in practice.
 */
const ALIAS_ALPHABET: string = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const ALIAS_REGEX: RegExp = /^[A-Z]$/;

const EXPRESSION_REGEX: RegExp = /^[A-Z0-9+\-*/().\s]+$/;

export class RecordingRuleDefinitionUtil {
  public static getAggregationOptions(): Array<{
    value: AggregationType;
    label: string;
  }> {
    return [
      { value: AggregationType.Sum, label: "Sum" },
      { value: AggregationType.Avg, label: "Average" },
      { value: AggregationType.Count, label: "Count" },
      { value: AggregationType.Min, label: "Minimum" },
      { value: AggregationType.Max, label: "Maximum" },
    ];
  }

  public static getNextAlias(
    sources: Array<RecordingRuleSource> | undefined,
  ): string {
    const used: Set<string> = new Set<string>(
      (sources || []).map((s: RecordingRuleSource) => {
        return s.alias;
      }),
    );
    for (const letter of ALIAS_ALPHABET) {
      if (!used.has(letter)) {
        return letter;
      }
    }
    return "A";
  }

  public static getEmptyDefinition(): RecordingRuleDefinition {
    return {
      sources: [
        {
          alias: "A",
          metricName: "",
          aggregationType: AggregationType.Sum,
        },
      ],
      expression: "A",
      groupByAttribute: "",
    };
  }

  public static getValidationError(
    definition: RecordingRuleDefinition | undefined,
  ): string | null {
    if (!definition) {
      return "Definition is required.";
    }

    const sources: Array<RecordingRuleSource> = definition.sources || [];

    if (sources.length === 0) {
      return "Add at least one source metric.";
    }

    if (sources.length > RECORDING_RULE_MAX_SOURCES) {
      return `A rule can reference at most ${RECORDING_RULE_MAX_SOURCES} source metrics.`;
    }

    const aliases: Set<string> = new Set<string>();
    for (let i: number = 0; i < sources.length; i++) {
      const source: RecordingRuleSource = sources[i]!;
      const prefix: string = `Source ${source.alias || `#${i + 1}`}: `;

      if (!source.alias || !ALIAS_REGEX.test(source.alias)) {
        return `${prefix}Alias must be a single uppercase letter A-Z.`;
      }

      if (aliases.has(source.alias)) {
        return `${prefix}Duplicate alias. Each source must have a unique letter.`;
      }
      aliases.add(source.alias);

      if (!source.metricName?.trim()) {
        return `${prefix}Metric name is required.`;
      }

      if (!source.aggregationType) {
        return `${prefix}Aggregation type is required.`;
      }

      const hasFilterKey: boolean = Boolean(source.filterAttributeKey?.trim());
      const hasFilterValue: boolean = Boolean(
        source.filterAttributeValue?.trim(),
      );

      if (hasFilterKey !== hasFilterValue) {
        return `${prefix}Attribute filter needs both a key and a value (or leave both empty).`;
      }
    }

    const expression: string = (definition.expression || "").trim();

    if (!expression) {
      return "Expression is required.";
    }

    if (expression.length > RECORDING_RULE_MAX_EXPRESSION_LENGTH) {
      return `Expression must be ${RECORDING_RULE_MAX_EXPRESSION_LENGTH} characters or fewer.`;
    }

    // Expression may only use aliases defined in sources.
    const referencedAliases: Set<string> = new Set<string>(
      expression.match(/[A-Z]/g) || [],
    );
    for (const alias of referencedAliases) {
      if (!aliases.has(alias)) {
        return `Expression references alias '${alias}' which is not defined in sources.`;
      }
    }

    // Must reference at least one alias — otherwise the expression is a constant.
    if (referencedAliases.size === 0) {
      return "Expression must reference at least one source alias (e.g. A, B).";
    }

    // Reject any character outside the allowed DSL grammar.
    if (!EXPRESSION_REGEX.test(expression)) {
      return "Expression may only contain aliases (A-Z), numbers, operators (+ - * /), parentheses, and spaces.";
    }

    return null;
  }
}
