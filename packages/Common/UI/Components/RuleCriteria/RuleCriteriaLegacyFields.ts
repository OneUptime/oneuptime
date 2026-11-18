import RuleBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/RuleBaseModel";
import RelationOnlyRuleBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/RelationOnlyRuleBaseModel";
import type BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TableColumnType from "../../../Types/Database/TableColumnType";
import RuleCriteria, {
  RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
} from "../../../Types/Rules/RuleCriteria";
import type Field from "../Forms/Types/Field";
import type Fields from "../Forms/Types/Fields";

/*
 * WHETHER A FORM IS A RULE'S, AND WHAT EVERY FORM DOES ABOUT IT.
 *
 * A rule (RuleBaseModel) lists the fields it matches on as ordinary form
 * fields on its "match-criteria" step, and its form draws them as one
 * condition builder instead (RuleCriteriaModelForm). Every form asks
 * whether it is a rule's - ModelForm, as it selects, sends and lays out its
 * fields - and only a rule's form needs the builder: its fields, the checks
 * of a pattern a condition is written with and their sentences, some 80 KB
 * before gzip. So the question and the two things every form does with the
 * answer are here, apart: the sign-in pages and a status page, whose forms
 * are never a rule's, do not download the builder, and a rule's form loads
 * it before it lays out its fields (LazyRuleCriteriaModelForm).
 */

export const MATCH_CRITERIA_STEP_ID: string = "match-criteria";
export const RULE_CRITERIA_FIELD_NAME: string = "criteria";

// The column a form field stores into: its key, or its first field's name.
export function getRuleCriteriaFieldName<TEntity>(
  field: Field<TEntity>,
): string | null {
  if (field.overrideFieldKey) {
    return field.overrideFieldKey;
  }

  const names: Array<string> = Object.keys(field.field || {});
  return names[0] || null;
}

export function getLegacyRuleCriteriaFields<TEntity>(
  fields: Array<Field<TEntity>>,
): Array<Field<TEntity>> {
  return fields.filter((field: Field<TEntity>): boolean => {
    return (
      field.stepId === MATCH_CRITERIA_STEP_ID &&
      getRuleCriteriaFieldName(field) !== RULE_CRITERIA_FIELD_NAME
    );
  });
}

// Whether a form is a rule's, which draws its match fields as one builder.
export function shouldUseRuleCriteriaBuilder<TEntity>(
  model: BaseModel,
  fields: Array<Field<TEntity>>,
): model is RuleBaseModel {
  return (
    model instanceof RuleBaseModel &&
    getLegacyRuleCriteriaFields(fields).length > 0
  );
}

export function addRuleCriteriaToSelect<TEntity>(data: {
  model: BaseModel;
  fields: Array<Field<TEntity>>;
  select: Record<string, unknown>;
}): Record<string, unknown> {
  if (!shouldUseRuleCriteriaBuilder(data.model, data.fields)) {
    return data.select;
  }

  return {
    ...data.select,
    [RULE_CRITERIA_FIELD_NAME]: true,
  };
}

/**
 * Keep requests fail-closed when a new dashboard is briefly routed to an old
 * API pod during a rolling deployment. The old API drops the unknown criteria
 * column, but it still understands these legacy fields.
 */
export function applyRuleCriteriaLegacySafetyShadow<
  TEntity extends BaseModel,
>(data: {
  model: BaseModel;
  fields: Fields<TEntity>;
  values: Record<string, unknown>;
}): void {
  if (!shouldUseRuleCriteriaBuilder(data.model, data.fields)) {
    return;
  }

  const criteria: unknown = data.values[RULE_CRITERIA_FIELD_NAME];

  if (
    typeof criteria !== "object" ||
    criteria === null ||
    Array.isArray(criteria)
  ) {
    return;
  }

  const relationOnlyRule: boolean =
    data.model instanceof RelationOnlyRuleBaseModel;
  let safetyPatternField: string | undefined;

  for (const field of getLegacyRuleCriteriaFields(data.fields)) {
    const fieldName: string | null = getRuleCriteriaFieldName(field);

    if (!fieldName) {
      continue;
    }

    /*
     * A condition no column holds - who owns the record (#9353) - lives in
     * the criteria alone: there is nothing of it to send.
     */
    if (!data.model.hasColumn(fieldName)) {
      delete data.values[fieldName];
      continue;
    }

    const fieldType: TableColumnType | undefined =
      data.model.getTableColumnMetadata(fieldName)?.type;
    data.values[fieldName] =
      fieldType === TableColumnType.EntityArray ? [] : null;

    if (
      !relationOnlyRule &&
      !safetyPatternField &&
      fieldType !== TableColumnType.EntityArray &&
      fieldName.match(/(pattern|regex)/i) !== null
    ) {
      safetyPatternField = fieldName;
    }
  }

  if (relationOnlyRule) {
    const logicalEnabled: boolean =
      typeof data.values["isEnabled"] === "boolean"
        ? (data.values["isEnabled"] as boolean)
        : true;

    data.values[RULE_CRITERIA_FIELD_NAME] = {
      ...(criteria as RuleCriteria),
      isEnabled: logicalEnabled,
    };
    data.values["isEnabled"] = false;
    return;
  }

  if (!safetyPatternField) {
    throw new Error(
      `A legacy safety pattern is required for ${data.model.tableName}.`,
    );
  }

  data.values[safetyPatternField] = RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN;
}
