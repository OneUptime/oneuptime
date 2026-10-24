import AutoRemediationTriggerEntity from "../AutoRemediation/AutoRemediationTriggerEntity";
import { RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN } from "../Rules/RuleCriteria";

/*
 * What an AI rule of the telemetry products can match on: the service the
 * problem is in - picked, by its labels, or by its name - the conditions a
 * service's own label and owner rules use (ServiceLabelRule), so a
 * condition written once reads the same everywhere.
 */
export const TELEMETRY_AI_RULE_CRITERIA_FIELDS: ReadonlyArray<string> = [
  "services",
  "serviceLabels",
  "serviceNamePattern",
];

/*
 * What an AI rule can match on: what the project's other incident and alert
 * rules do (Runbook Rules, Postmortem Rules), so a condition written once
 * reads the same everywhere. One table serves every kind of AI rule, told
 * apart by triggerEntityType, and each uses only its own share: an
 * incident has an IncidentSeverity, an alert an AlertSeverity, and slow
 * code in a profile the service it runs in.
 */
export const AI_RULE_CRITERIA_FIELDS_BY_TRIGGER: Readonly<
  Record<AutoRemediationTriggerEntity, ReadonlyArray<string>>
> = {
  [AutoRemediationTriggerEntity.Incident]: [
    "monitors",
    "incidentSeverities",
    "labels",
    "monitorLabels",
    "titlePattern",
    "descriptionPattern",
  ],
  [AutoRemediationTriggerEntity.Alert]: [
    "monitors",
    "alertSeverities",
    "labels",
    "monitorLabels",
    "titlePattern",
    "descriptionPattern",
  ],
  [AutoRemediationTriggerEntity.Profile]: TELEMETRY_AI_RULE_CRITERIA_FIELDS,
};

const TRIGGER_ENTITY_TYPES: ReadonlyArray<AutoRemediationTriggerEntity> =
  Object.values(AutoRemediationTriggerEntity);

// Every criterion some AI rule can use.
export const AI_RULE_CRITERIA_FIELDS: ReadonlyArray<string> = Array.from(
  new Set(
    TRIGGER_ENTITY_TYPES.flatMap(
      (
        triggerEntityType: AutoRemediationTriggerEntity,
      ): ReadonlyArray<string> => {
        return AI_RULE_CRITERIA_FIELDS_BY_TRIGGER[triggerEntityType];
      },
    ),
  ),
);

const RULES_NAME_BY_TRIGGER: Readonly<
  Record<AutoRemediationTriggerEntity, string>
> = {
  [AutoRemediationTriggerEntity.Incident]: "incident AI rules",
  [AutoRemediationTriggerEntity.Alert]: "alert AI rules",
  [AutoRemediationTriggerEntity.Profile]: "profile AI rules",
};

// What a refusal calls each criterion: its column's title in the API docs.
const TRIGGER_SPECIFIC_FIELD_TITLES: Readonly<Record<string, string>> = {
  monitors: "Monitors",
  incidentSeverities: "Incident Severities",
  alertSeverities: "Alert Severities",
  labels: "Labels",
  monitorLabels: "Monitor Labels",
  titlePattern: "Title Pattern",
  descriptionPattern: "Description Pattern",
  services: "Services",
  serviceLabels: "Service Labels",
  serviceNamePattern: "Service Name Pattern",
};

// The criteria that are a pattern on a text, rather than a list of records.
const PATTERN_FIELDS: ReadonlyArray<string> = [
  "titlePattern",
  "descriptionPattern",
  "serviceNamePattern",
];

/*
 * Whether a write gives a criterion a value: a list of records with
 * something in it, or a pattern with text in it. A pattern that can never
 * match (RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN, which the dashboard
 * writes in a rule's own pattern column beside its conditions) says
 * nothing, nor does a list criterion given anything but a list.
 */
export function hasAiRuleCriterionValue(
  field: string,
  value: unknown,
): boolean {
  if (PATTERN_FIELDS.includes(field)) {
    return (
      typeof value === "string" &&
      value.trim().length > 0 &&
      value.trim() !== RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN
    );
  }

  return Array.isArray(value) && value.length > 0;
}

export function isAiRuleTriggerEntity(
  value: unknown,
): value is AutoRemediationTriggerEntity {
  return (
    typeof value === "string" &&
    (TRIGGER_ENTITY_TYPES as ReadonlyArray<string>).includes(value)
  );
}

function getCriteriaFilterFields(criteria: unknown): Array<string> {
  if (typeof criteria !== "object" || criteria === null) {
    return [];
  }

  const filters: unknown = (criteria as { filters?: unknown }).filters;

  if (!Array.isArray(filters)) {
    return [];
  }

  return filters
    .map((filter: unknown): unknown => {
      return typeof filter === "object" && filter !== null
        ? (filter as { field?: unknown }).field
        : undefined;
    })
    .filter((field: unknown): field is string => {
      return typeof field === "string";
    });
}

/*
 * Why an AI rule cannot be saved like this, or null when it can. A
 * condition on another kind of signal's criterion (an incident rule asking
 * for alert severities, a profile rule asking for monitors) could never be
 * true, so it is refused rather than saved as a rule that silently never
 * matches - which, since rules narrow what is investigated and fixed, would
 * quietly stop both - whether it comes as a condition or in the
 * criterion's column itself. Malformed criteria are left to the shared
 * criteria validation, which words its own refusal.
 */
export function getAiRuleCriteriaProblem(data: {
  triggerEntityType: unknown;
  criteria?: unknown;
  values?: Readonly<Record<string, unknown>> | undefined;
}): string | null {
  if (!isAiRuleTriggerEntity(data.triggerEntityType)) {
    return `Trigger Entity Type must be one of ${TRIGGER_ENTITY_TYPES.join(", ")}.`;
  }

  const triggerEntityType: AutoRemediationTriggerEntity =
    data.triggerEntityType;
  const usedFields: Array<string> = getCriteriaFilterFields(data.criteria);

  for (const field of AI_RULE_CRITERIA_FIELDS) {
    if (hasAiRuleCriterionValue(field, data.values?.[field])) {
      usedFields.push(field);
    }
  }

  for (const field of usedFields) {
    if (
      !AI_RULE_CRITERIA_FIELDS.includes(field) ||
      AI_RULE_CRITERIA_FIELDS_BY_TRIGGER[triggerEntityType].includes(field)
    ) {
      continue;
    }

    const owners: Array<string> = TRIGGER_ENTITY_TYPES.filter(
      (owner: AutoRemediationTriggerEntity): boolean => {
        return AI_RULE_CRITERIA_FIELDS_BY_TRIGGER[owner].includes(field);
      },
    ).map((owner: AutoRemediationTriggerEntity): string => {
      return RULES_NAME_BY_TRIGGER[owner];
    });

    return `${TRIGGER_SPECIFIC_FIELD_TITLES[field] || field} can only be used by ${owners.join(" or ")}.`;
  }

  return null;
}
