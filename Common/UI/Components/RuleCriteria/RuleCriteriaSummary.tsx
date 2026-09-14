import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import RuleCriteria, {
  RuleCriteriaFilter,
} from "../../../Types/Rules/RuleCriteria";
import { isValidRuleCriteria } from "../../../Utils/Rules/RuleCriteriaMatcher";
import React, { ReactElement } from "react";
import Field from "../Forms/Types/Field";
import {
  convertLegacyValuesToRuleCriteria,
  getRuleCriteriaFieldName,
  RULE_CRITERIA_OPERATOR_LABELS,
} from "./RuleCriteriaBuilder";

export interface RuleCriteriaSummaryData<TEntity> {
  fields: Array<Field<TEntity>>;
  item: TEntity;
}

function titleFromFieldName(fieldName: string): string {
  return fieldName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (character: string): string => {
      return character.toUpperCase();
    });
}

function getFieldTitle<TEntity>(
  fields: Array<Field<TEntity>>,
  fieldName: string,
): string {
  const field: Field<TEntity> | undefined = fields.find(
    (candidate: Field<TEntity>): boolean => {
      return getRuleCriteriaFieldName(candidate) === fieldName;
    },
  );

  return field?.title || titleFromFieldName(fieldName);
}

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
      ? "Invalid match criteria"
      : "Matches all resources";
  }

  if (criteria.filters.length === 0) {
    return "Matches all resources";
  }

  const connector: string =
    criteria.filterCondition === FilterCondition.All ? "all" : "any";
  const filters: Array<string> = criteria.filters.map(
    (filter: RuleCriteriaFilter): string => {
      return `${getFieldTitle(data.fields, filter.field)} ${RULE_CRITERIA_OPERATOR_LABELS[
        filter.operator
      ].toLocaleLowerCase()} ${formatValue(filter)}`;
    },
  );

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
