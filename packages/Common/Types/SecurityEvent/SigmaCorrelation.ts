import Dictionary from "../Dictionary";
import SigmaRule, { SigmaLevel } from "./SigmaRule";

/*
 * Sigma correlation rules: detections over several events rather than one.
 *
 * A detection rule's YAML is either one Sigma rule (the boolean core,
 * SigmaRule.ts) or a correlation - a Sigma correlation document, written in
 * the same file as the rules it reads, as the Sigma correlation
 * specification does it (YAML documents separated by `---`):
 *
 *   title: Failed sign-ins, then a success
 *   correlation:
 *     type: temporal_ordered
 *     rules: [failed_sign_ins, successful_sign_in]
 *     group-by: [principalUser]
 *     timespan: 10m
 *   ---
 *   title: Failed sign-ins
 *   name: failed_sign_ins
 *   correlation:
 *     type: event_count
 *     rules: [failed_sign_in]
 *     group-by: [principalUser]
 *     timespan: 10m
 *     condition: { gte: 5 }
 *   ---
 *   ... the base rules, each with a `name`
 *
 * https://github.com/SigmaHQ/sigma-specification (Sigma Correlation Rules)
 *
 * The four standard types are supported - event_count, value_count,
 * temporal and temporal_ordered - plus new_value, OneUptime's own: "the
 * first time this user (host, account...) shows this value", the building
 * block of behaviour baselines (a sign-in from an address, a country or a
 * device the account never used). value_sum, value_avg and
 * value_percentile are refused when the rule is saved, never ignored.
 */

export enum SigmaCorrelationType {
  EventCount = "event_count",
  ValueCount = "value_count",
  Temporal = "temporal",
  TemporalOrdered = "temporal_ordered",
  // OneUptime's: not in the Sigma specification.
  NewValue = "new_value",
}

export const SIGMA_CORRELATION_TYPES: ReadonlyArray<SigmaCorrelationType> = [
  SigmaCorrelationType.EventCount,
  SigmaCorrelationType.ValueCount,
  SigmaCorrelationType.Temporal,
  SigmaCorrelationType.TemporalOrdered,
  SigmaCorrelationType.NewValue,
];

// Types of the Sigma specification OneUptime refuses, by name, when a rule is saved.
export const SIGMA_UNSUPPORTED_CORRELATION_TYPES: ReadonlyArray<string> = [
  "value_sum",
  "value_avg",
  "value_percentile",
  "value_median",
];

export type SigmaComparisonOperator =
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "eq"
  | "neq";

export const SIGMA_COMPARISON_OPERATORS: ReadonlyArray<SigmaComparisonOperator> =
  ["gt", "gte", "lt", "lte", "eq", "neq"];

export interface SigmaComparison {
  operator: SigmaComparisonOperator;
  value: number;
}

export interface SigmaCorrelationCondition {
  // ANDed together: `gt: 100` and `lte: 200` is "101 to 200".
  comparisons: Array<SigmaComparison>;
  /*
   * value_count: the field(s) whose different values are counted.
   * new_value: the field(s) whose value must be new for the group.
   */
  fields: Array<string>;
}

export interface SigmaCorrelation {
  title: string;
  id: string;
  // How other documents of the file refer to it.
  name: string;
  description: string;
  level: SigmaLevel;
  tags: Array<string>;
  mitreTactics: Array<string>;
  mitreTechniques: Array<string>;
  type: SigmaCorrelationType;
  // The rules it reads, by `name` or `id`, as written.
  rules: Array<string>;
  groupBy: Array<string>;
  // As written ("10m"), and in seconds.
  timespan: string;
  timespanInSeconds: number;
  condition: SigmaCorrelationCondition;
  /*
   * Field name aliases: alias -> (rule reference -> the field that rule's
   * events carry the value in). A group-by entry may name an alias, so
   * "the same address" can be the source address in one rule's events and
   * the destination in another's.
   */
  aliases: Dictionary<Dictionary<string>>;
}

/*
 * A rule a correlation reads, resolved: a Sigma rule of the same file, one
 * of the project's other detection rules (by its Sigma `id` or `name`), or -
 * as a step of a temporal correlation - an event_count correlation of the
 * same file over such rules ("ten failed sign-ins" as one step).
 */
export interface SigmaCorrelationStep {
  // The reference as the correlation wrote it, and the key aliases use.
  reference: string;
  // What a person reads: the rule's title.
  title: string;
  // A Sigma rule: the step matches its events.
  rule?: SigmaRule | undefined;
  /*
   * An event_count correlation: the step happens when its count is reached
   * within its own timespan, at the moment the last of those events
   * arrived.
   */
  count?:
    | {
        correlation: SigmaCorrelation;
        rules: Array<SigmaRule>;
      }
    | undefined;
  // Where the rule came from.
  origin: "file" | "project";
}

// A detection rule's YAML, parsed.
export type DetectionRuleDefinition =
  | {
      kind: "single";
      rule: SigmaRule;
      // The rule's Sigma `name`, which a correlation can read it by.
      name: string;
    }
  | {
      kind: "correlation";
      correlation: SigmaCorrelation;
      steps: Array<SigmaCorrelationStep>;
      /*
       * References the file does not hold, left for the project's detection
       * rules to resolve (by Sigma id or name). Empty once resolved.
       */
      unresolvedReferences: Array<string>;
    };

/*
 * Looks a reference up among the project's other detection rules: the
 * Sigma rule whose `id` or `name` it is. Correlations are not offered this
 * way - a correlation reads them from its own file.
 */
export type SigmaRuleReferenceResolver = (
  reference: string,
) => SigmaRule | undefined;

/*
 * Bounds, checked when a rule is saved - one home for the parser, the
 * engine and the docs facts.
 */
// Rules one correlation reads.
export const SIGMA_CORRELATION_MAX_RULES: number = 10;
// Steps of a temporal or temporal_ordered correlation.
export const SIGMA_CORRELATION_MIN_TEMPORAL_RULES: number = 2;
export const SIGMA_CORRELATION_MAX_TEMPORAL_RULES: number = 5;
export const SIGMA_CORRELATION_MAX_GROUP_BY_FIELDS: number = 3;
// event_count, value_count, temporal and temporal_ordered: up to a day.
export const SIGMA_CORRELATION_MAX_TIMESPAN_IN_SECONDS: number = 24 * 60 * 60;
export const SIGMA_CORRELATION_MIN_TIMESPAN_IN_SECONDS: number = 1;
// new_value: how far back "seen before" reaches, a day to thirty.
export const SIGMA_NEW_VALUE_MIN_TIMESPAN_IN_SECONDS: number = 24 * 60 * 60;
export const SIGMA_NEW_VALUE_MAX_TIMESPAN_IN_SECONDS: number =
  30 * 24 * 60 * 60;

/*
 * What kind of detection a rule is, stored on the rule when it is saved
 * (DetectionRule.detectionType) so the list can show it and filter on it.
 */
export enum DetectionRuleType {
  SingleEvent = "single-event",
  EventCount = "event-count",
  ValueCount = "value-count",
  Temporal = "temporal",
  TemporalOrdered = "temporal-ordered",
  NewValue = "new-value",
}

export const DETECTION_RULE_TYPES: ReadonlyArray<DetectionRuleType> = [
  DetectionRuleType.SingleEvent,
  DetectionRuleType.EventCount,
  DetectionRuleType.ValueCount,
  DetectionRuleType.Temporal,
  DetectionRuleType.TemporalOrdered,
  DetectionRuleType.NewValue,
];

export interface DetectionRuleTypeDefinition {
  type: DetectionRuleType;
  // The Sigma correlation type it is, or null for a single Sigma rule.
  correlationType: SigmaCorrelationType | null;
  title: string;
  description: string;
}

export const DETECTION_RULE_TYPE_DEFINITIONS: ReadonlyArray<DetectionRuleTypeDefinition> =
  [
    {
      type: DetectionRuleType.SingleEvent,
      correlationType: null,
      title: "Single event",
      description: "Fires on the events one Sigma rule matches.",
    },
    {
      type: DetectionRuleType.EventCount,
      correlationType: SigmaCorrelationType.EventCount,
      title: "Event count",
      description:
        "Fires when one user, host or address reaches a number of events within a time span.",
    },
    {
      type: DetectionRuleType.ValueCount,
      correlationType: SigmaCorrelationType.ValueCount,
      title: "Distinct values",
      description:
        "Fires when one user, host or address shows a number of different values within a time span.",
    },
    {
      type: DetectionRuleType.Temporal,
      correlationType: SigmaCorrelationType.Temporal,
      title: "Events together",
      description:
        "Fires when every rule matches for the same user, host or address within a time span, in any order.",
    },
    {
      type: DetectionRuleType.TemporalOrdered,
      correlationType: SigmaCorrelationType.TemporalOrdered,
      title: "Sequence",
      description:
        "Fires when the rules match in order for the same user, host or address within a time span.",
    },
    {
      type: DetectionRuleType.NewValue,
      correlationType: SigmaCorrelationType.NewValue,
      title: "First seen",
      description:
        "Fires the first time a user, host or account shows a value it has not shown before.",
    },
  ];

export function getDetectionRuleTypeDefinition(
  type: string | undefined | null,
): DetectionRuleTypeDefinition {
  return (
    DETECTION_RULE_TYPE_DEFINITIONS.find(
      (definition: DetectionRuleTypeDefinition): boolean => {
        return definition.type === type;
      },
    ) || DETECTION_RULE_TYPE_DEFINITIONS[0]!
  );
}

export function detectionRuleTypeForCorrelation(
  correlationType: SigmaCorrelationType | null,
): DetectionRuleType {
  const definition: DetectionRuleTypeDefinition | undefined =
    DETECTION_RULE_TYPE_DEFINITIONS.find(
      (candidate: DetectionRuleTypeDefinition): boolean => {
        return candidate.correlationType === correlationType;
      },
    );

  return definition ? definition.type : DetectionRuleType.SingleEvent;
}

export function detectionRuleTypeOf(
  definition: DetectionRuleDefinition,
): DetectionRuleType {
  return definition.kind === "single"
    ? DetectionRuleType.SingleEvent
    : detectionRuleTypeForCorrelation(definition.correlation.type);
}

export function isDetectionRuleType(
  value: unknown,
): value is DetectionRuleType {
  return (
    typeof value === "string" &&
    (DETECTION_RULE_TYPES as ReadonlyArray<string>).includes(value)
  );
}
