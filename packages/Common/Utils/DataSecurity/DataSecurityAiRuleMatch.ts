import { AI_RULE_CRITERIA_FIELDS_BY_TRIGGER } from "../../Types/AI/AiRuleCriteria";
import AutoRemediationTriggerEntity from "../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import ObjectID from "../../Types/ObjectID";
import RuleCriteriaMatcher from "../Rules/RuleCriteriaMatcher";
import RulePatternMatchUtil from "../Rules/RulePatternMatchUtil";

/*
 * WHICH DATA SECURITY ISSUES A DATA SECURITY AI RULE MATCHES (#10364).
 *
 * An AI rule whose trigger is a Data Security issue matches an issue by
 * what a person sorting issues sorts them by: the check that failed, its
 * group, the issue's severity; the store's sensitivity, kind, provider,
 * environment and labels; the categories of the data types that make it as
 * severe as it is; and, for a store that is a service's telemetry, the
 * service - picked, by its labels, or by its name, the conditions every
 * telemetry AI rule uses.
 *
 * Each condition is a column of the rule (AutoRemediationRule), skipped
 * when empty, and every one that is set must hold: an issue matches a list
 * when its value is one of the list's, and a list of labels or categories
 * when it has any of them. Or the versioned conditions the Dashboard
 * writes, read through the one criteria matcher every rule uses
 * (RuleCriteriaMatcher), over the same columns. Values are compared
 * without regard to case. A store that is not a service's telemetry
 * matches no condition on a service.
 *
 * Pure, so the engine and the Dashboard read a rule the same way.
 */

// The columns a Data Security AI rule matches on, in the order the form asks.
export const DATA_SECURITY_AI_RULE_CRITERIA_FIELDS: ReadonlyArray<string> =
  AI_RULE_CRITERIA_FIELDS_BY_TRIGGER[
    AutoRemediationTriggerEntity.DataSecurityIssue
  ];

// The issue as a rule reads it.
export interface DataSecurityAiRuleIssue {
  checkId: string;
  checkGroup: string;
  severity: string;
  // The store's.
  sensitivity: string;
  kind: string;
  provider: string;
  environment: string;
  labelIds: Array<string>;
  // The categories of the issue's data types.
  dataCategories: Array<string>;
  // For a store that is a service's telemetry: the service.
  serviceId: string;
  serviceName: string;
  serviceLabelIds: Array<string>;
}

// The rule as the matcher reads it: its condition columns and conditions.
export interface DataSecurityAiRuleConditions {
  criteria?: unknown;
  dataSecurityChecks?: unknown;
  dataSecurityCheckGroups?: unknown;
  dataSecuritySeverities?: unknown;
  dataStoreSensitivities?: unknown;
  dataStoreKinds?: unknown;
  dataStoreProviders?: unknown;
  dataStoreEnvironments?: unknown;
  dataStoreLabels?: unknown;
  dataCategories?: unknown;
  services?: unknown;
  serviceLabels?: unknown;
  serviceNamePattern?: unknown;
}

// A value as a rule's list holds it: a text, an id, or a record with one.
function readValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }

  if (value instanceof ObjectID) {
    return value.toString().trim().toLowerCase();
  }

  if (value && typeof value === "object") {
    const row: { _id?: unknown; id?: unknown } = value as {
      _id?: unknown;
      id?: unknown;
    };

    return readValue(row._id ?? row.id);
  }

  return "";
}

export function readDataSecurityAiRuleValues(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item: unknown): string => {
      return readValue(item);
    })
    .filter((item: string): boolean => {
      return item.length > 0;
    });
}

function lower(values: ReadonlyArray<string>): Array<string> {
  return values
    .map((value: string): string => {
      return (value || "").trim().toLowerCase();
    })
    .filter((value: string): boolean => {
      return value.length > 0;
    });
}

// One value against a list: an empty list holds for every value.
function holdsOne(list: unknown, value: string): boolean {
  const values: Array<string> = readDataSecurityAiRuleValues(list);

  return (
    values.length === 0 || values.includes((value || "").trim().toLowerCase())
  );
}

// Several values against a list: an empty list holds; else any one of them.
function holdsAny(list: unknown, have: ReadonlyArray<string>): boolean {
  const values: Array<string> = readDataSecurityAiRuleValues(list);

  if (values.length === 0) {
    return true;
  }

  const held: Array<string> = lower(have);

  return values.some((value: string): boolean => {
    return held.includes(value);
  });
}

/*
 * The columns, each skipped when empty and all of them together. A pattern
 * that is not a valid one matches nothing, as a telemetry AI rule's does.
 */
export function doesDataSecurityAiRuleColumnsMatch(
  rule: DataSecurityAiRuleConditions,
  issue: DataSecurityAiRuleIssue,
): boolean {
  if (
    !holdsOne(rule.dataSecurityChecks, issue.checkId) ||
    !holdsOne(rule.dataSecurityCheckGroups, issue.checkGroup) ||
    !holdsOne(rule.dataSecuritySeverities, issue.severity) ||
    !holdsOne(rule.dataStoreSensitivities, issue.sensitivity) ||
    !holdsOne(rule.dataStoreKinds, issue.kind) ||
    !holdsOne(rule.dataStoreProviders, issue.provider) ||
    !holdsOne(rule.dataStoreEnvironments, issue.environment) ||
    !holdsAny(rule.dataStoreLabels, issue.labelIds) ||
    !holdsAny(rule.dataCategories, issue.dataCategories)
  ) {
    return false;
  }

  const serviceIds: Array<string> = readDataSecurityAiRuleValues(rule.services);

  if (
    serviceIds.length > 0 &&
    (!issue.serviceId ||
      !serviceIds.includes(issue.serviceId.trim().toLowerCase()))
  ) {
    return false;
  }

  const serviceLabelIds: Array<string> = readDataSecurityAiRuleValues(
    rule.serviceLabels,
  );

  if (
    serviceLabelIds.length > 0 &&
    !serviceLabelIds.some((labelId: string): boolean => {
      return lower(issue.serviceLabelIds).includes(labelId);
    })
  ) {
    return false;
  }

  if (
    typeof rule.serviceNamePattern === "string" &&
    rule.serviceNamePattern.trim().length > 0
  ) {
    if (!issue.serviceName) {
      return false;
    }

    try {
      return RulePatternMatchUtil.testRegex(
        rule.serviceNamePattern,
        issue.serviceName,
      );
    } catch {
      return false;
    }
  }

  return true;
}

/*
 * Whether a Data Security AI rule matches an issue: its versioned
 * conditions when it has them, else its columns. A rule with no condition
 * matches every issue.
 */
export function doesDataSecurityAiRuleMatch<
  RuleType extends DataSecurityAiRuleConditions,
>(rule: RuleType, issue: DataSecurityAiRuleIssue): boolean {
  return RuleCriteriaMatcher.matchesWithLegacySync({
    rule: rule,
    legacyFields: DATA_SECURITY_AI_RULE_CRITERIA_FIELDS as ReadonlyArray<
      Extract<keyof RuleType, string>
    >,
    emptyResult: true,
    matchesLegacyRule: (legacyRule: RuleType): boolean => {
      return doesDataSecurityAiRuleColumnsMatch(legacyRule, issue);
    },
  });
}
