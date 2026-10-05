import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { isFilterConditionNeeded } from "../../../Types/Filter/FilterConditionUtil";
import RuleCriteria, {
  RuleCriteriaFilter,
} from "../../../Types/Rules/RuleCriteria";
import { isRuleCriteriaConditionRequired } from "../../../Types/Rules/RuleCriteriaFieldRegistry";
import { isValidRuleCriteria } from "../../../Utils/Rules/RuleCriteriaMatcher";
import React, { ReactElement } from "react";
import Field from "../Forms/Types/Field";
import {
  convertLegacyValuesToRuleCriteria,
  findRuleCriteriaField,
  getRuleCriteriaFieldTitle,
  getRuleCriteriaOperatorLabel,
} from "./RuleCriteriaFields";

export interface RuleCriteriaSummaryData<TEntity> {
  fields: Array<Field<TEntity>>;
  item: TEntity;
}

// What a rule with no conditions does, which depends on the kind of rule.
export const RULE_CRITERIA_SUMMARY_MATCHES_EVERYTHING: string =
  "Matches everything (no conditions)";
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

function getEmptySummary<TEntity>(item: TEntity): string {
  const tableName: unknown = (item as unknown as { tableName?: unknown })
    .tableName;

  return isRuleCriteriaConditionRequired(
    typeof tableName === "string" ? tableName : null,
  )
    ? RULE_CRITERIA_SUMMARY_MATCHES_NOTHING
    : RULE_CRITERIA_SUMMARY_MATCHES_EVERYTHING;
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
      : getEmptySummary(data.item);
  }

  if (criteria.filters.length === 0) {
    return getEmptySummary(data.item);
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
  const { fields, item } = props;
  const summary: string = getRuleCriteriaSummaryText({ fields, item });

  return (
    <span className="text-sm text-gray-700" title={summary}>
      {summary}
    </span>
  );
};

export default RuleCriteriaSummary;
