import TraceAggregationType from "./TraceAggregationType";

/*
 * A single source for a Trace Recording Rule — queries the Span table with
 * the given aggregation, filtered by optional span-name regex and attribute
 * match. Each source is aliased (A, B, C, ...) and referenced from the rule's
 * expression string.
 */
export interface TraceRecordingRuleSource {
  alias: string;
  aggregationType: TraceAggregationType;
  // Optional filters — ANDed together.
  spanNameRegex?: string;
  spanKind?: string;
  onlyErrors?: boolean;
  filterAttributeKey?: string;
  filterAttributeValue?: string;
}

/*
 * Full stored definition of a Trace Recording Rule. Persisted as JSONB so new
 * fields can be added without migrating Postgres.
 */
export default interface TraceRecordingRuleDefinition {
  sources: Array<TraceRecordingRuleSource>;
  /*
   * Arithmetic expression using aliases. Operators: + - * /, parentheses,
   * numeric literals. Example: "A / B * 100" for error rate.
   */
  expression: string;
  /*
   * Optional attribute key (e.g. "service.name") to group by — one derived
   * data point per group per evaluation bucket.
   */
  groupByAttribute?: string;
}

// Maximum number of sources per rule — bounds per-cron workload.
export const TRACE_RECORDING_RULE_MAX_SOURCES: number = 4;

// Maximum expression length — prevents pathological parser input.
export const TRACE_RECORDING_RULE_MAX_EXPRESSION_LENGTH: number = 500;

// Alphabet used to generate source aliases. v1 caps at TRACE_RECORDING_RULE_MAX_SOURCES
// so we never exceed the first few letters in practice.
const ALIAS_ALPHABET: string = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export class TraceRecordingRuleDefinitionUtil {
  public static getAggregationOptions(): Array<{
    value: TraceAggregationType;
    label: string;
    description: string;
  }> {
    return [
      {
        value: TraceAggregationType.Count,
        label: "Count",
        description: "Number of matching spans.",
      },
      {
        value: TraceAggregationType.ErrorCount,
        label: "Error Count",
        description: "Spans with status = error.",
      },
      {
        value: TraceAggregationType.AvgDurationSeconds,
        label: "Avg Duration (s)",
        description: "Average span duration in seconds.",
      },
      {
        value: TraceAggregationType.P50DurationSeconds,
        label: "p50 Duration (s)",
        description: "Median span duration.",
      },
      {
        value: TraceAggregationType.P95DurationSeconds,
        label: "p95 Duration (s)",
        description: "95th percentile span duration.",
      },
      {
        value: TraceAggregationType.P99DurationSeconds,
        label: "p99 Duration (s)",
        description: "99th percentile span duration.",
      },
      {
        value: TraceAggregationType.MaxDurationSeconds,
        label: "Max Duration (s)",
        description: "Longest span in the bucket.",
      },
      {
        value: TraceAggregationType.MinDurationSeconds,
        label: "Min Duration (s)",
        description: "Shortest span in the bucket.",
      },
    ];
  }

  public static getSpanKindOptions(): Array<{ value: string; label: string }> {
    return [
      { value: "", label: "Any" },
      { value: "SPAN_KIND_SERVER", label: "Server" },
      { value: "SPAN_KIND_CLIENT", label: "Client" },
      { value: "SPAN_KIND_PRODUCER", label: "Producer" },
      { value: "SPAN_KIND_CONSUMER", label: "Consumer" },
      { value: "SPAN_KIND_INTERNAL", label: "Internal" },
    ];
  }

  public static getNextAlias(
    sources: Array<TraceRecordingRuleSource> | undefined,
  ): string {
    const used: Set<string> = new Set<string>(
      (sources || []).map((s: TraceRecordingRuleSource) => {
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

  public static getEmptyDefinition(): TraceRecordingRuleDefinition {
    return {
      sources: [
        {
          alias: "A",
          aggregationType: TraceAggregationType.Count,
        },
      ],
      expression: "A",
      groupByAttribute: "",
    };
  }

  public static getValidationError(
    definition: TraceRecordingRuleDefinition | undefined,
  ): string | null {
    if (!definition) {
      return "Definition is required.";
    }

    const sources: Array<TraceRecordingRuleSource> = definition.sources || [];

    if (sources.length === 0) {
      return "Add at least one source.";
    }

    if (sources.length > TRACE_RECORDING_RULE_MAX_SOURCES) {
      return `A rule can reference at most ${TRACE_RECORDING_RULE_MAX_SOURCES} sources.`;
    }

    const aliases: Set<string> = new Set<string>();
    for (let i: number = 0; i < sources.length; i++) {
      const source: TraceRecordingRuleSource = sources[i]!;
      const prefix: string = `Source ${source.alias || `#${i + 1}`}: `;

      if (!source.alias || !/^[A-Z]$/.test(source.alias)) {
        return `${prefix}Alias must be a single uppercase letter A-Z.`;
      }

      if (aliases.has(source.alias)) {
        return `${prefix}Duplicate alias. Each source must have a unique letter.`;
      }
      aliases.add(source.alias);

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

    if (expression.length > TRACE_RECORDING_RULE_MAX_EXPRESSION_LENGTH) {
      return `Expression must be ${TRACE_RECORDING_RULE_MAX_EXPRESSION_LENGTH} characters or fewer.`;
    }

    const referencedAliases: Set<string> = new Set<string>(
      expression.match(/[A-Z]/g) || [],
    );
    for (const alias of referencedAliases) {
      if (!aliases.has(alias)) {
        return `Expression references alias '${alias}' which is not defined in sources.`;
      }
    }

    if (referencedAliases.size === 0) {
      return "Expression must reference at least one source alias (e.g. A, B).";
    }

    if (!/^[A-Z0-9+\-*/().\s]+$/.test(expression)) {
      return "Expression may only contain aliases (A-Z), numbers, operators (+ - * /), parentheses, and spaces.";
    }

    return null;
  }
}
