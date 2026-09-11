import RuleBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/RuleBaseModel";
import RelationOnlyRuleBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/RelationOnlyRuleBaseModel";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TableColumnType from "../../../Types/Database/TableColumnType";
import RuleCriteria, {
  RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
} from "../../../Types/Rules/RuleCriteria";
import { getRuleCriteriaValidationError } from "../../../Utils/Rules/RuleCriteriaMatcher";
import SelectFormFields from "../../Types/SelectEntityField";
import React, { ReactElement } from "react";
import Field, { CustomElementProps } from "../Forms/Types/Field";
import Fields from "../Forms/Types/Fields";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import FormValues from "../Forms/Types/FormValues";
import RuleCriteriaBuilder, {
  getRuleCriteriaFieldName,
} from "./RuleCriteriaBuilder";

export const MATCH_CRITERIA_STEP_ID: string = "match-criteria";
export const RULE_CRITERIA_FIELD_NAME: string = "criteria";

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

export function replaceLegacyRuleCriteriaFields<TEntity extends BaseModel>(
  model: BaseModel,
  fields: Fields<TEntity>,
): Fields<TEntity> {
  if (!shouldUseRuleCriteriaBuilder(model, fields)) {
    return fields;
  }

  const legacyFields: Array<Field<TEntity>> =
    getLegacyRuleCriteriaFields(fields);
  const fieldsToReplace: Set<Field<TEntity>> = new Set<Field<TEntity>>([
    ...legacyFields,
    ...fields.filter((field: Field<TEntity>): boolean => {
      return getRuleCriteriaFieldName(field) === RULE_CRITERIA_FIELD_NAME;
    }),
  ]);
  const firstFieldIndex: number = fields.findIndex(
    (field: Field<TEntity>): boolean => {
      return fieldsToReplace.has(field);
    },
  );

  const criteriaField: Field<TEntity> = {
    field: {
      [RULE_CRITERIA_FIELD_NAME]: true,
    } as SelectFormFields<TEntity>,
    title: "Conditions",
    description:
      "Add one or more conditions and choose whether every condition or any condition must match.",
    stepId: MATCH_CRITERIA_STEP_ID,
    fieldType: FormFieldSchemaType.CustomComponent,
    required: false,
    spanFullRow: true,
    dataTestId: "rule-criteria-field",
    customValidation: (values: FormValues<TEntity>): string | null => {
      const criteria: unknown = (values as { criteria?: unknown }).criteria;

      if (criteria === undefined || criteria === null) {
        return null;
      }

      return getRuleCriteriaValidationError(criteria);
    },
    getCustomElement: (
      values: FormValues<TEntity>,
      customElementProps: CustomElementProps,
    ): ReactElement => {
      return (
        <RuleCriteriaBuilder
          fields={legacyFields}
          legacyValues={values as unknown as Record<string, unknown>}
          value={(values as { criteria?: RuleCriteria }).criteria}
          error={customElementProps.error}
          onChange={(criteria: RuleCriteria): void => {
            customElementProps.onChange?.(criteria);
          }}
        />
      );
    },
  };

  const result: Fields<TEntity> = [];

  for (let index: number = 0; index < fields.length; index++) {
    if (index === firstFieldIndex) {
      result.push(criteriaField);
    }

    const field: Field<TEntity> = fields[index]!;

    if (!fieldsToReplace.has(field)) {
      result.push(field);
    }
  }

  return result;
}
