import RunbookRuleTriggerEntity from "./RunbookRuleTriggerEntity";

/*
 * What a runbook rule can match on.
 *
 * One RunbookRule table serves three pages - incident, alert and scheduled
 * maintenance runbook rules - told apart by triggerEntityType. They match on
 * the same things the other rules of their product do (an incident runbook
 * rule on what an incident privacy rule matches), so the table carries the
 * union of the three, and each rule uses only its own trigger's share:
 *
 * - an incident has a severity of its own kind (IncidentSeverity), an alert
 *   another (AlertSeverity), and a scheduled maintenance event none;
 * - everything else - monitors, the record's own labels, its monitors'
 *   labels, names and descriptions, and its title and description - applies
 *   to all three.
 *
 * The dashboard offers exactly these fields on each page, the engine
 * evaluates exactly these per trigger, and the service refuses a rule that
 * uses another trigger's field. The order is the order the criteria are
 * offered in, the same as the other incident, alert and scheduled
 * maintenance rules.
 */
export const RUNBOOK_RULE_CRITERIA_FIELDS_BY_TRIGGER: Readonly<
  Record<RunbookRuleTriggerEntity, ReadonlyArray<string>>
> = {
  [RunbookRuleTriggerEntity.Incident]: [
    "monitors",
    "incidentSeverities",
    "labels",
    "monitorLabels",
    "titlePattern",
    "descriptionPattern",
    "monitorNamePattern",
    "monitorDescriptionPattern",
  ],
  [RunbookRuleTriggerEntity.Alert]: [
    "monitors",
    "alertSeverities",
    "labels",
    "monitorLabels",
    "titlePattern",
    "descriptionPattern",
    "monitorNamePattern",
    "monitorDescriptionPattern",
  ],
  [RunbookRuleTriggerEntity.ScheduledMaintenance]: [
    "monitors",
    "labels",
    "monitorLabels",
    "titlePattern",
    "descriptionPattern",
    "monitorNamePattern",
    "monitorDescriptionPattern",
  ],
};

const TRIGGER_ENTITY_TYPES: ReadonlyArray<RunbookRuleTriggerEntity> =
  Object.values(RunbookRuleTriggerEntity);

// Every criterion some runbook rule can use, in the order first offered.
export const RUNBOOK_RULE_CRITERIA_FIELDS: ReadonlyArray<string> = Array.from(
  new Set(
    TRIGGER_ENTITY_TYPES.flatMap(
      (triggerEntityType: RunbookRuleTriggerEntity): ReadonlyArray<string> => {
        return RUNBOOK_RULE_CRITERIA_FIELDS_BY_TRIGGER[triggerEntityType];
      },
    ),
  ),
);

// How a refusal names the rules a criterion belongs to.
const RULES_NAME_BY_TRIGGER: Readonly<
  Record<RunbookRuleTriggerEntity, string>
> = {
  [RunbookRuleTriggerEntity.Incident]: "incident runbook rules",
  [RunbookRuleTriggerEntity.Alert]: "alert runbook rules",
  [RunbookRuleTriggerEntity.ScheduledMaintenance]:
    "scheduled maintenance runbook rules",
};

// How a refusal names the criteria that belong to some triggers only.
const TRIGGER_SPECIFIC_FIELD_TITLES: Readonly<Record<string, string>> = {
  incidentSeverities: "Incident Severities",
  alertSeverities: "Alert Severities",
};

export function isRunbookRuleTriggerEntity(
  value: unknown,
): value is RunbookRuleTriggerEntity {
  return (
    typeof value === "string" &&
    (TRIGGER_ENTITY_TYPES as ReadonlyArray<string>).includes(value)
  );
}

export function getRunbookRuleCriteriaFields(
  triggerEntityType: RunbookRuleTriggerEntity,
): ReadonlyArray<string> {
  return RUNBOOK_RULE_CRITERIA_FIELDS_BY_TRIGGER[triggerEntityType];
}

export function isRunbookRuleCriteriaFieldForTrigger(data: {
  field: string;
  triggerEntityType: RunbookRuleTriggerEntity;
}): boolean {
  return getRunbookRuleCriteriaFields(data.triggerEntityType).includes(
    data.field,
  );
}

/*
 * Why a rule of this trigger cannot use this criterion, or null when it can.
 * Only criteria some other trigger owns are refused here; a name no runbook
 * rule knows is left to the shared criteria validation, which refuses it in
 * its own words.
 */
function getRefusal(data: {
  field: string;
  triggerEntityType: RunbookRuleTriggerEntity;
}): string | null {
  if (
    !RUNBOOK_RULE_CRITERIA_FIELDS.includes(data.field) ||
    isRunbookRuleCriteriaFieldForTrigger(data)
  ) {
    return null;
  }

  const owners: Array<string> = TRIGGER_ENTITY_TYPES.filter(
    (triggerEntityType: RunbookRuleTriggerEntity): boolean => {
      return isRunbookRuleCriteriaFieldForTrigger({
        field: data.field,
        triggerEntityType: triggerEntityType,
      });
    },
  ).map((triggerEntityType: RunbookRuleTriggerEntity): string => {
    return RULES_NAME_BY_TRIGGER[triggerEntityType];
  });

  return `${TRIGGER_SPECIFIC_FIELD_TITLES[data.field] || data.field} can only be used by ${owners.join(" or ")}.`;
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

function hasValues(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

/*
 * Why a runbook rule cannot be saved like this, or null when it can. A
 * condition on another trigger's severity (an incident rule asking for alert
 * severities) could never be true, so it is refused rather than saved as a
 * rule that silently never runs - whether it comes as a condition or in the
 * severity column itself. Malformed criteria are left to the shared criteria
 * validation, which words its own refusal.
 */
export function getRunbookRuleCriteriaProblem(data: {
  triggerEntityType: unknown;
  criteria?: unknown;
  values?: Readonly<Record<string, unknown>> | undefined;
}): string | null {
  if (!isRunbookRuleTriggerEntity(data.triggerEntityType)) {
    return `Trigger Entity Type must be one of ${TRIGGER_ENTITY_TYPES.join(", ")}.`;
  }

  const triggerEntityType: RunbookRuleTriggerEntity = data.triggerEntityType;
  const usedFields: Array<string> = getCriteriaFilterFields(data.criteria);

  for (const field of RUNBOOK_RULE_CRITERIA_FIELDS) {
    if (hasValues(data.values?.[field])) {
      usedFields.push(field);
    }
  }

  for (const field of usedFields) {
    const refusal: string | null = getRefusal({ field, triggerEntityType });

    if (refusal) {
      return refusal;
    }
  }

  return null;
}

export default RUNBOOK_RULE_CRITERIA_FIELDS_BY_TRIGGER;
