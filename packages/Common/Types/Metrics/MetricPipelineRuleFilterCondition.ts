import LogScrubPatternType from "../Log/LogScrubPatternType";

export enum MetricPipelineRuleFilterCheckOn {
  MetricName = "Metric Name",
  Attribute = "Attribute",
}

export enum MetricPipelineRuleFilterConditionType {
  EqualTo = "Equal To",
  NotEqualTo = "Not Equal To",
  Contains = "Contains",
  NotContains = "Not Contains",
  StartsWith = "Starts With",
  EndsWith = "Ends With",
  MatchesRegex = "Matches Regex",
  DoesNotMatchRegex = "Does Not Match Regex",
  /*
   * The value holds what a log or trace scrub rule's built-in Pattern Type
   * finds - an IP address, an email address, a card number, a phone number,
   * a Social Security number - matched by the very pattern those rules run
   * (Utils/Telemetry/ScrubBuiltInPatterns): the filter Scrub It gives a
   * metric rule for those types (#10934, #11112). Its value is the pattern
   * type (METRIC_FILTER_PATTERN_TYPES).
   */
  MatchesPatternType = "Matches Pattern Type",
  IsPresent = "Is Present",
  IsNotPresent = "Is Not Present",
  IsEmpty = "Is Empty",
  IsNotEmpty = "Is Not Empty",
}

/*
 * The pattern types a Matches Pattern Type filter can name: the built-in
 * patterns of log and trace scrub rules that find a value's own shape. Not
 * Sensitive Attribute Keys or Named Attributes, which read keys, nor Custom
 * Regex, which Matches Regex is.
 */
export const METRIC_FILTER_PATTERN_TYPES: ReadonlyArray<string> = [
  LogScrubPatternType.Email,
  LogScrubPatternType.CreditCard,
  LogScrubPatternType.SSN,
  LogScrubPatternType.PhoneNumber,
  LogScrubPatternType.IPAddress,
];

export function isMetricFilterPatternType(value: unknown): boolean {
  return (
    typeof value === "string" && METRIC_FILTER_PATTERN_TYPES.includes(value)
  );
}

export default interface MetricPipelineRuleFilterCondition {
  checkOn: MetricPipelineRuleFilterCheckOn;
  // Required when checkOn is Attribute. The attribute key to evaluate on.
  attributeKey?: string | undefined;
  conditionType: MetricPipelineRuleFilterConditionType | undefined;
  // Required for conditions that compare against a value.
  value?: string | undefined;
}

export class MetricPipelineRuleFilterConditionUtil {
  public static getCheckOnOptions(): Array<MetricPipelineRuleFilterCheckOn> {
    return [
      MetricPipelineRuleFilterCheckOn.MetricName,
      MetricPipelineRuleFilterCheckOn.Attribute,
    ];
  }

  public static getConditionTypesByCheckOn(
    checkOn: MetricPipelineRuleFilterCheckOn,
  ): Array<MetricPipelineRuleFilterConditionType> {
    switch (checkOn) {
      case MetricPipelineRuleFilterCheckOn.MetricName:
        return [
          MetricPipelineRuleFilterConditionType.EqualTo,
          MetricPipelineRuleFilterConditionType.NotEqualTo,
          MetricPipelineRuleFilterConditionType.Contains,
          MetricPipelineRuleFilterConditionType.NotContains,
          MetricPipelineRuleFilterConditionType.StartsWith,
          MetricPipelineRuleFilterConditionType.EndsWith,
          MetricPipelineRuleFilterConditionType.MatchesRegex,
          MetricPipelineRuleFilterConditionType.DoesNotMatchRegex,
          MetricPipelineRuleFilterConditionType.MatchesPatternType,
        ];
      case MetricPipelineRuleFilterCheckOn.Attribute:
        return [
          MetricPipelineRuleFilterConditionType.IsPresent,
          MetricPipelineRuleFilterConditionType.IsNotPresent,
          MetricPipelineRuleFilterConditionType.IsEmpty,
          MetricPipelineRuleFilterConditionType.IsNotEmpty,
          MetricPipelineRuleFilterConditionType.EqualTo,
          MetricPipelineRuleFilterConditionType.NotEqualTo,
          MetricPipelineRuleFilterConditionType.Contains,
          MetricPipelineRuleFilterConditionType.NotContains,
          MetricPipelineRuleFilterConditionType.StartsWith,
          MetricPipelineRuleFilterConditionType.EndsWith,
          MetricPipelineRuleFilterConditionType.MatchesRegex,
          MetricPipelineRuleFilterConditionType.DoesNotMatchRegex,
          MetricPipelineRuleFilterConditionType.MatchesPatternType,
        ];
      default:
        return [];
    }
  }

  public static hasAttributeKeyField(
    checkOn: MetricPipelineRuleFilterCheckOn,
  ): boolean {
    return checkOn === MetricPipelineRuleFilterCheckOn.Attribute;
  }

  public static hasValueField(
    conditionType: MetricPipelineRuleFilterConditionType | undefined,
  ): boolean {
    if (!conditionType) {
      return false;
    }
    switch (conditionType) {
      case MetricPipelineRuleFilterConditionType.IsPresent:
      case MetricPipelineRuleFilterConditionType.IsNotPresent:
      case MetricPipelineRuleFilterConditionType.IsEmpty:
      case MetricPipelineRuleFilterConditionType.IsNotEmpty:
        return false;
      default:
        return true;
    }
  }

  public static getValidationError(
    filters: Array<MetricPipelineRuleFilterCondition> | undefined,
  ): string | null {
    if (!filters || filters.length === 0) {
      return null;
    }

    for (let i: number = 0; i < filters.length; i++) {
      const filter: MetricPipelineRuleFilterCondition = filters[i]!;
      const prefix: string = `Filter #${i + 1}: `;

      if (!filter.checkOn) {
        return `${prefix}Filter type is required.`;
      }

      if (!filter.conditionType) {
        return `${prefix}Condition is required.`;
      }

      if (
        MetricPipelineRuleFilterConditionUtil.hasAttributeKeyField(
          filter.checkOn,
        ) &&
        !filter.attributeKey?.trim()
      ) {
        return `${prefix}Attribute key is required.`;
      }

      if (
        MetricPipelineRuleFilterConditionUtil.hasValueField(
          filter.conditionType,
        ) &&
        !filter.value?.toString().trim()
      ) {
        return `${prefix}Value is required.`;
      }

      if (
        filter.conditionType ===
          MetricPipelineRuleFilterConditionType.MatchesPatternType &&
        !isMetricFilterPatternType(filter.value)
      ) {
        return `${prefix}Pick a pattern type.`;
      }
    }

    return null;
  }
}
