import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { isFilterConditionNeeded } from "../../../Types/Filter/FilterConditionUtil";
import RuleCriteria, {
  RuleCriteriaFilter,
} from "../../../Types/Rules/RuleCriteria";
import { isRuleCriteriaConditionRequired } from "../../../Types/Rules/RuleCriteriaFieldRegistry";
import {
  resolveRuleCriteriaSubject,
  RuleCriteriaSubject,
} from "../../../Types/Rules/RuleCriteriaSubject";
import { isValidRuleCriteria } from "../../../Utils/Rules/RuleCriteriaMatcher";
import useTranslateValue from "../../Utils/Translation";
import React, { ReactElement } from "react";
import Field from "../Forms/Types/Field";
import {
  convertLegacyValuesToRuleCriteria,
  findRuleCriteriaField,
  getRuleCriteriaFieldTitle,
  getRuleCriteriaOperatorLabel,
} from "./RuleCriteriaFields";
import { getRuleCriteriaSubjectCopy } from "./RuleCriteriaSubjectCopy";

export interface RuleCriteriaSummaryData<TEntity> {
  fields: Array<Field<TEntity>>;
  item: TEntity;
  /*
   * The records the rule is for, when its table says (a table of rules
   * about several kinds of record). Otherwise the rule's model says.
   */
  subject?: RuleCriteriaSubject | null | undefined;
}

/*
 * What a rule with no conditions does, which depends on the kind of rule: a
 * rule that needs a condition matches nothing; any other applies to all of
 * its records, and says so as its form's choice does - "All incidents"
 * (RuleCriteriaSubjectCopy), or "Everything" for a rule nothing names.
 */
export const RULE_CRITERIA_SUMMARY_MATCHES_NOTHING: string =
  "Matches nothing (no conditions)";
export const RULE_CRITERIA_SUMMARY_INVALID: string = "Invalid match criteria";

function formatValue(filter: RuleCriteriaFilter): string {
  if (Array.isArray(filter.value)) {
    return `${filter.value.length} selected ${
      filter.value.length === 1 ? "value" : "values"
    }`;
  }

  if (typeof filter.value === "boolean") {
    return filter.value ? "true" : "false";
  }

  return `“${String(filter.value)}”`;
}

function getCriteria<TEntity>(
  data: RuleCriteriaSummaryData<TEntity>,
): RuleCriteria | null {
  const item: Record<string, unknown> = data.item as unknown as Record<
    string,
    unknown
  >;
  const configuredCriteria: unknown = item["criteria"];

  if (configuredCriteria !== undefined && configuredCriteria !== null) {
    return isValidRuleCriteria(configuredCriteria) ? configuredCriteria : null;
  }

  return convertLegacyValuesToRuleCriteria({
    fields: data.fields,
    values: item,
  });
}

function getTableName<TEntity>(item: TEntity): string | null {
  const tableName: unknown = (item as unknown as { tableName?: unknown })
    .tableName;

  return typeof tableName === "string" ? tableName : null;
}

function getEmptySummary<TEntity>(
  data: RuleCriteriaSummaryData<TEntity>,
): string {
  const tableName: string | null = getTableName(data.item);

  if (isRuleCriteriaConditionRequired(tableName)) {
    return RULE_CRITERIA_SUMMARY_MATCHES_NOTHING;
  }

  return getRuleCriteriaSubjectCopy(
    resolveRuleCriteriaSubject({
      modelName: tableName,
      subject: data.subject,
    }),
  ).all;
}

/*
 * Whether the summary is a rule's "no conditions" sentence - a phrase of
 * the locale files, looked up where it is shown - rather than its
 * conditions, which are the page's own names and values.
 */
function isEmptySummary<TEntity>(
  data: RuleCriteriaSummaryData<TEntity>,
): boolean {
  const configuredCriteria: unknown = (
    data.item as unknown as Record<string, unknown>
  )["criteria"];
  const criteria: RuleCriteria | null = getCriteria(data);

  if (!criteria) {
    return configuredCriteria === undefined || configuredCriteria === null;
  }

  return criteria.filters.length === 0;
}

export function getRuleCriteriaSummaryText<TEntity>(
  data: RuleCriteriaSummaryData<TEntity>,
): string {
  const item: Record<string, unknown> = data.item as unknown as Record<
    string,
    unknown
  >;
  const configuredCriteria: unknown = item["criteria"];
  const criteria: RuleCriteria | null = getCriteria(data);

  if (!criteria) {
    return configuredCriteria !== undefined && configuredCriteria !== null
      ? RULE_CRITERIA_SUMMARY_INVALID
      : getEmptySummary(data);
  }

  if (criteria.filters.length === 0) {
    return getEmptySummary(data);
  }

  const filters: Array<string> = criteria.filters.map(
    (filter: RuleCriteriaFilter): string => {
      const field: Field<TEntity> | undefined = findRuleCriteriaField(
        data.fields,
        filter.field,
      );

      return `${getRuleCriteriaFieldTitle(field, filter.field)} ${getRuleCriteriaOperatorLabel(
        field,
        filter.operator,
      ).toLocaleLowerCase()} ${formatValue(filter)}`;
    },
  );

  /*
   * "Match all" / "Match any" only once there are two conditions to
   * combine (isFilterConditionNeeded), as the conditions builder asks it:
   * one condition is simply the condition.
   */
  if (!isFilterConditionNeeded(criteria.filters)) {
    return filters.join("; ");
  }

  const connector: string =
    criteria.filterCondition === FilterCondition.All ? "all" : "any";

  return `Match ${connector}: ${filters.join("; ")}`;
}

const RuleCriteriaSummary: <TEntity extends BaseModel>(
  props: RuleCriteriaSummaryData<TEntity>,
) => ReactElement = <TEntity extends BaseModel>(
  props: RuleCriteriaSummaryData<TEntity>,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const english: string = getRuleCriteriaSummaryText(props);
  // "All incidents" is the form's own answer, so it reads as the form does.
  const summary: string = isEmptySummary(props)
    ? translateString(english) ?? english
    : english;

  return (
    <span
      className="text-sm text-gray-700"
      title={summary}
      data-testid="rule-criteria-summary"
    >
      {summary}
    </span>
  );
};

export default RuleCriteriaSummary;
