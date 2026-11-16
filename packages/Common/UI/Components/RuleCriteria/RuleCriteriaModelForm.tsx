import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RuleCriteria from "../../../Types/Rules/RuleCriteria";
import { isRuleCriteriaConditionRequired } from "../../../Types/Rules/RuleCriteriaFieldRegistry";
import {
  resolveRuleCriteriaSubject,
  RuleCriteriaSubject,
} from "../../../Types/Rules/RuleCriteriaSubject";
import SelectFormFields from "../../Types/SelectEntityField";
import React, { ReactElement } from "react";
import Field, { CustomElementProps } from "../Forms/Types/Field";
import Fields from "../Forms/Types/Fields";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import FormValues from "../Forms/Types/FormValues";
import { translateValidationMessage } from "../Forms/Validation";
import RuleCriteriaBuilder from "./RuleCriteriaBuilder";
import {
  getRuleEmptiedLimits,
  RuleEmptiedLimitsAlert,
} from "./RuleEmptiedLimitsNote";
import { RuleEmptiedLimit } from "../../../Types/Rules/RuleEmptiedLimit";
import {
  formatRuleCriteriaMessage,
  getAvailableRuleCriteriaFields,
  getRuleCriteriaFormProblem,
  RuleCriteriaCopy,
  RuleCriteriaMessage,
} from "./RuleCriteriaFields";
import {
  getLegacyRuleCriteriaFields,
  getRuleCriteriaFieldName,
  MATCH_CRITERIA_STEP_ID,
  RULE_CRITERIA_FIELD_NAME,
  shouldUseRuleCriteriaBuilder,
} from "./RuleCriteriaLegacyFields";

/*
 * A rule's form draws its match fields as one condition builder. Whether a
 * form is a rule's, and what every form does about it, are in
 * RuleCriteriaLegacyFields, which every form loads; this file, which builds
 * the builder's field with the checks of a pattern and their sentences, is
 * loaded by a rule's form only (LazyRuleCriteriaModelForm). Those are
 * named here too, for the rule pages that read them with it.
 */
export {
  addRuleCriteriaToSelect,
  applyRuleCriteriaLegacySafetyShadow,
  getLegacyRuleCriteriaFields,
  MATCH_CRITERIA_STEP_ID,
  RULE_CRITERIA_FIELD_NAME,
  shouldUseRuleCriteriaBuilder,
} from "./RuleCriteriaLegacyFields";

export interface RuleCriteriaFormOptions {
  /*
   * The records the rule is for, for a table of rules about several kinds
   * of record (RULE_CRITERIA_MODELS_NAMED_BY_THEIR_TABLE). Other rules are
   * named by their model.
   */
  subject?: RuleCriteriaSubject | null | undefined;
}

export function replaceLegacyRuleCriteriaFields<TEntity extends BaseModel>(
  model: BaseModel,
  fields: Fields<TEntity>,
  options: RuleCriteriaFormOptions = {},
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

  /*
   * A rule kind that matches nothing without a condition (and whose API
   * refuses one with none) says so: the field is not "(Optional)", the empty
   * builder asks for a condition, and the form asks before it sends. Until
   * the builder has filled in a value - a create form that never reached this
   * step - "required" is what stops the form; a rule saved before conditions
   * existed has none (null) and keeps working from its old columns.
   */
  const requiresCondition: boolean = isRuleCriteriaConditionRequired(
    model.tableName,
  );

  const subject: RuleCriteriaSubject | null = resolveRuleCriteriaSubject({
    modelName: model.tableName,
    subject: options.subject,
  });

  /*
   * Every other rule kind applies to all of its records until it has a
   * condition, and asks which first: "Applies to" over "All incidents" /
   * "Only incidents that match conditions". The choice draws that label
   * itself (RuleAppliesToChoice), so the field draws none - nor the
   * criteria column's own description, which is written for the API. It is
   * always answered, so it is never "(Optional)".
   */
  const ownLabel: Partial<Field<TEntity>> = requiresCondition
    ? {
        title: "Conditions",
        /*
         * Said here so the form does not fall back to the criteria column's
         * own description, which is written for the API.
         */
        description: RuleCriteriaCopy.fieldDescription,
      }
    : {
        title: RuleCriteriaCopy.appliesToTitle,
        customElementDrawsOwnLabel: true,
        hideOptionalLabel: true,
      };

  const criteriaField: Field<TEntity> = {
    field: {
      [RULE_CRITERIA_FIELD_NAME]: true,
    } as SelectFormFields<TEntity>,
    ...ownLabel,
    stepId: MATCH_CRITERIA_STEP_ID,
    fieldType: FormFieldSchemaType.CustomComponent,
    required: requiresCondition
      ? (values: FormValues<TEntity>): boolean => {
          return (values as { criteria?: unknown }).criteria !== null;
        }
      : false,
    spanFullRow: true,
    dataTestId: "rule-criteria-field",
    customValidation: (values: FormValues<TEntity>): string | null => {
      const criteria: unknown = (values as { criteria?: unknown }).criteria;

      if (criteria === undefined || criteria === null) {
        return null;
      }

      const problem: RuleCriteriaMessage | null = getRuleCriteriaFormProblem({
        criteria: criteria,
        fields: getAvailableRuleCriteriaFields(
          legacyFields,
          values as unknown as Record<string, unknown>,
        ),
        requiresCondition: requiresCondition,
      });

      return problem
        ? formatRuleCriteriaMessage(problem, translateValidationMessage)
        : null;
    },
    getCustomElement: (
      values: FormValues<TEntity>,
      customElementProps: CustomElementProps,
    ): ReactElement => {
      /*
       * A rule OneUptime switched off because every record a list of it
       * was limited to was deleted says so here, where what it applies to
       * is chosen again (#9066). The Edit form reads the note without
       * sending it (ModelTable's alsoReadColumns).
       */
      const emptiedLimits: Array<RuleEmptiedLimit> =
        getRuleEmptiedLimits(values);

      return (
        <>
          {emptiedLimits.length > 0 ? (
            <div className="mb-4">
              <RuleEmptiedLimitsAlert
                model={model}
                emptiedLimits={emptiedLimits}
              />
            </div>
          ) : (
            <></>
          )}
          <RuleCriteriaBuilder
            fields={legacyFields}
            legacyValues={values as unknown as Record<string, unknown>}
            value={(values as { criteria?: RuleCriteria }).criteria}
            error={customElementProps.error}
            requiresCondition={requiresCondition}
            subject={subject}
            onChange={(criteria: RuleCriteria): void => {
              customElementProps.onChange?.(criteria);
            }}
          />
        </>
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
