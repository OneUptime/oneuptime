import AIInvestigationRuleTriggerEntity from "./AIInvestigationRuleTriggerEntity";

/*
 * What an investigation rule can match on: what the project's other incident
 * and alert rules do (Auto Remediation Rules, Runbook Rules), so a condition
 * written once reads the same everywhere. One table serves incident and
 * alert rules, told apart by triggerEntityType, and each uses only its own
 * share: an incident has an IncidentSeverity, an alert an AlertSeverity.
 */
export const AI_INVESTIGATION_RULE_CRITERIA_FIELDS_BY_TRIGGER: Readonly<
  Record<AIInvestigationRuleTriggerEntity, ReadonlyArray<string>>
> = {
  [AIInvestigationRuleTriggerEntity.Incident]: [
    "monitors",
    "incidentSeverities",
    "labels",
    "monitorLabels",
    "titlePattern",
    "descriptionPattern",
  ],
  [AIInvestigationRuleTriggerEntity.Alert]: [
    "monitors",
    "alertSeverities",
    "labels",
    "monitorLabels",
    "titlePattern",
    "descriptionPattern",
  ],
};

const TRIGGER_ENTITY_TYPES: ReadonlyArray<AIInvestigationRuleTriggerEntity> =
  Object.values(AIInvestigationRuleTriggerEntity);

// Every criterion some investigation rule can use.
export const AI_INVESTIGATION_RULE_CRITERIA_FIELDS: ReadonlyArray<string> =
  Array.from(
    new Set(
      TRIGGER_ENTITY_TYPES.flatMap(
        (
          triggerEntityType: AIInvestigationRuleTriggerEntity,
        ): ReadonlyArray<string> => {
          return AI_INVESTIGATION_RULE_CRITERIA_FIELDS_BY_TRIGGER[
            triggerEntityType
          ];
        },
      ),
    ),
  );

const RULES_NAME_BY_TRIGGER: Readonly<
  Record<AIInvestigationRuleTriggerEntity, string>
> = {
  [AIInvestigationRuleTriggerEntity.Incident]: "incident investigation rules",
  [AIInvestigationRuleTriggerEntity.Alert]: "alert investigation rules",
};

const TRIGGER_SPECIFIC_FIELD_TITLES: Readonly<Record<string, string>> = {
  incidentSeverities: "Incident Severities",
  alertSeverities: "Alert Severities",
};

export function isAIInvestigationRuleTriggerEntity(
  value: unknown,
): value is AIInvestigationRuleTriggerEntity {
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
 * Why an investigation rule cannot be saved like this, or null when it can.
 * A condition on the other kind of signal's severity (an incident rule
 * asking for alert severities) could never be true, so it is refused rather
 * than saved as a rule that silently never matches - whether it comes as a
 * condition or in the severity column itself. Malformed criteria are left to
 * the shared criteria validation, which words its own refusal.
 */
export function getAIInvestigationRuleCriteriaProblem(data: {
  triggerEntityType: unknown;
  criteria?: unknown;
  values?: Readonly<Record<string, unknown>> | undefined;
}): string | null {
  if (!isAIInvestigationRuleTriggerEntity(data.triggerEntityType)) {
    return `Trigger Entity Type must be one of ${TRIGGER_ENTITY_TYPES.join(", ")}.`;
  }

  const triggerEntityType: AIInvestigationRuleTriggerEntity =
    data.triggerEntityType;
  const usedFields: Array<string> = getCriteriaFilterFields(data.criteria);

  for (const field of AI_INVESTIGATION_RULE_CRITERIA_FIELDS) {
    const value: unknown = data.values?.[field];

    if (Array.isArray(value) && value.length > 0) {
      usedFields.push(field);
    }
  }

  for (const field of usedFields) {
    if (
      !AI_INVESTIGATION_RULE_CRITERIA_FIELDS.includes(field) ||
      AI_INVESTIGATION_RULE_CRITERIA_FIELDS_BY_TRIGGER[
        triggerEntityType
      ].includes(field)
    ) {
      continue;
    }

    const owners: Array<string> = TRIGGER_ENTITY_TYPES.filter(
      (owner: AIInvestigationRuleTriggerEntity): boolean => {
        return AI_INVESTIGATION_RULE_CRITERIA_FIELDS_BY_TRIGGER[owner].includes(
          field,
        );
      },
    ).map((owner: AIInvestigationRuleTriggerEntity): string => {
      return RULES_NAME_BY_TRIGGER[owner];
    });

    return `${TRIGGER_SPECIFIC_FIELD_TITLES[field] || field} can only be used by ${owners.join(" or ")}.`;
  }

  return null;
}
