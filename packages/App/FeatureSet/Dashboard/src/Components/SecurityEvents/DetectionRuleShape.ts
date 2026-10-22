import {
  DetectionRuleDefinition,
  DetectionRuleType,
  SigmaCorrelationStep,
  SigmaCorrelationType,
  detectionRuleTypeOf,
  getDetectionRuleTypeDefinition,
} from "Common/Types/SecurityEvent/SigmaCorrelation";
import SigmaRuleSetParser, {
  minimumCountFor,
} from "Common/Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What kind of detection a rule's YAML is, read for a person: one Sigma
 * rule, or a correlation - a count, a sequence, events together, or a value
 * seen for the first time - with what it groups by, the time it looks
 * across and the rules it reads. The Detection Rules list shows the kind,
 * the form says in a sentence what a correlation looks for (and leaves out
 * the single rule's counting fields, which its YAML holds), and the Rule
 * Library marks its correlations.
 *
 * React-free, so it is pinned in plain tests. Its text is English keys,
 * looked up where they are drawn.
 */

export interface DetectionRuleShape {
  type: DetectionRuleType;
  // "Single event", "Sequence", ... (translationKey'd English).
  typeTitle: string;
  isCorrelation: boolean;
  // The fields it groups by: a correlation's group-by.
  groupBy: Array<string>;
  // The time it looks across: a correlation's timespan (a first-seen rule's history).
  timespanInSeconds: number | null;
  // The rules it reads, by their titles, in order.
  stepTitles: Array<string>;
  // value_count / new_value: the field(s) counted, or that must be new.
  valueFields: Array<string>;
  // event_count / value_count: the count the condition is first met at.
  minimumCount: number | null;
  // temporal: how many of its rules must match (all, without a condition).
  stepsNeeded: number | null;
}

/*
 * The kinds as the list and the library name them, keys the extractor
 * reads (the titles themselves live in Common, which it does not).
 */
export const DETECTION_RULE_TYPE_TITLES: Record<DetectionRuleType, string> = {
  [DetectionRuleType.SingleEvent]: translationKey("Single event"),
  [DetectionRuleType.EventCount]: translationKey("Event count"),
  [DetectionRuleType.ValueCount]: translationKey("Distinct values"),
  [DetectionRuleType.Temporal]: translationKey("Events together"),
  [DetectionRuleType.TemporalOrdered]: translationKey("Sequence"),
  [DetectionRuleType.NewValue]: translationKey("First seen"),
};

function stepTitle(step: SigmaCorrelationStep): string {
  return step.title || step.reference;
}

/*
 * The shape of a rule's YAML, or null when it does not parse - a rule
 * being typed. References to the project's other rules are named as the
 * YAML names them.
 */
export function readDetectionRuleShape(
  yaml: unknown,
): DetectionRuleShape | null {
  if (typeof yaml !== "string" || !yaml.trim()) {
    return null;
  }

  let definition: DetectionRuleDefinition;

  try {
    definition = SigmaRuleSetParser.parse(yaml);
  } catch {
    return null;
  }

  const type: DetectionRuleType = detectionRuleTypeOf(definition);
  const typeTitle: string = DETECTION_RULE_TYPE_TITLES[type];

  if (definition.kind === "single") {
    return {
      type,
      typeTitle,
      isCorrelation: false,
      groupBy: [],
      timespanInSeconds: null,
      stepTitles: [definition.rule.title],
      valueFields: [],
      minimumCount: null,
      stepsNeeded: null,
    };
  }

  const { correlation, steps } = definition;
  const counts: boolean =
    correlation.type === SigmaCorrelationType.EventCount ||
    correlation.type === SigmaCorrelationType.ValueCount;
  const needed: number | undefined = correlation.condition.comparisons.find(
    (comparison: { operator: string; value: number }): boolean => {
      return comparison.operator === "gte";
    },
  )?.value;

  return {
    type,
    typeTitle,
    isCorrelation: true,
    groupBy: correlation.groupBy,
    timespanInSeconds: correlation.timespanInSeconds,
    stepTitles: steps.map(stepTitle),
    valueFields: correlation.condition.fields,
    minimumCount: counts
      ? minimumCountFor(correlation.condition.comparisons)
      : null,
    stepsNeeded:
      correlation.type === SigmaCorrelationType.Temporal
        ? Math.min(steps.length, needed || steps.length)
        : null,
  };
}

/*
 * Each kind in one line, as the Common catalog words it
 * (DETECTION_RULE_TYPE_DEFINITIONS) - pinned to it by a test - as keys the
 * extractor reads.
 */
export const DETECTION_RULE_TYPE_DESCRIPTIONS: Record<
  DetectionRuleType,
  string
> = {
  [DetectionRuleType.SingleEvent]: translationKey(
    "Fires on the events one Sigma rule matches.",
  ),
  [DetectionRuleType.EventCount]: translationKey(
    "Fires when one user, host or address reaches a number of events within a time span.",
  ),
  [DetectionRuleType.ValueCount]: translationKey(
    "Fires when one user, host or address shows a number of different values within a time span.",
  ),
  [DetectionRuleType.Temporal]: translationKey(
    "Fires when every rule matches for the same user, host or address within a time span, in any order.",
  ),
  [DetectionRuleType.TemporalOrdered]: translationKey(
    "Fires when the rules match in order for the same user, host or address within a time span.",
  ),
  [DetectionRuleType.NewValue]: translationKey(
    "Fires the first time a user, host or account shows a value it has not shown before.",
  ),
};

// The Common catalog's own words for a kind, which the keys above repeat.
export function getDetectionRuleTypeCatalogDescription(
  type: DetectionRuleType,
): string {
  return getDetectionRuleTypeDefinition(type).description;
}
