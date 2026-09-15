import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import User from "../../../Models/DatabaseModels/User";
import Select from "../../../Types/BaseDatabase/Select";
import { DropdownOption, DropdownOptionGroup } from "../Dropdown/Dropdown";
import type { ModelField } from "../Forms/ModelForm";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import FormValues from "../Forms/Types/FormValues";
import LabelsElement from "../Label/Labels";
import Field from "../ModelDetail/Field";
import { getRuleCriteriaFieldName } from "../RuleCriteria/RuleCriteriaBuilder";
import {
  getLegacyRuleCriteriaFields,
  RULE_CRITERIA_FIELD_NAME,
} from "../RuleCriteria/RuleCriteriaModelForm";
import RuleCriteriaSummary from "../RuleCriteria/RuleCriteriaSummary";
import FieldType from "../Types/FieldType";
import React, { ReactElement } from "react";

/*
 * The fields a rule's view page shows, derived from the form that edits it.
 *
 * Every rule page already describes its rule once, as create/edit form fields.
 * Writing a second, parallel list of display fields for each of ~60 rule kinds
 * would be a second description free to drift from the first - a toggle added
 * to the form and forgotten on the view page reads as a save that did nothing.
 * Deriving one from the other keeps them the same list.
 *
 * Match criteria are shown the way the rule table shows them: one summary in
 * place of the individual legacy fields.
 */

export interface RuleDetailFields<TBaseModel extends BaseModel> {
  fields: Array<Field<TBaseModel>>;
  // Everything the fields render, including what the criteria summary reads.
  selectMoreFields: Select<TBaseModel>;
}

function noneElement(): ReactElement {
  return <span className="text-sm text-gray-500">None</span>;
}

function flattenOptions(
  options: Array<DropdownOption | DropdownOptionGroup>,
): Array<DropdownOption> {
  const result: Array<DropdownOption> = [];

  for (const option of options) {
    const group: DropdownOptionGroup = option as DropdownOptionGroup;

    if (Array.isArray(group.options)) {
      result.push(...group.options);
    } else {
      result.push(option as DropdownOption);
    }
  }

  return result;
}

// The column a related row is best named by, if it has one.
function getDisplayColumn(model: BaseModel): string | null {
  for (const column of ["name", "title"]) {
    if (model.hasColumn(column)) {
      return column;
    }
  }

  return null;
}

function readValue(item: BaseModel, fieldName: string): unknown {
  return (item as unknown as Record<string, unknown>)[fieldName];
}

function displayNameOf(related: BaseModel, displayColumn: string): string {
  const value: unknown =
    readValue(related, displayColumn) ||
    (related instanceof User ? readValue(related, "email") : undefined);

  return value ? String(value) : "";
}

/*
 * A relation field (single or multi-select): what to select from the related
 * rows, and how to render them. Null when the relation has nothing readable to
 * show.
 */
function getRelationField<TBaseModel extends BaseModel>(data: {
  model: TBaseModel;
  fieldName: string;
  formField: ModelField<TBaseModel>;
}): { field: Field<TBaseModel>; select: Record<string, unknown> } | null {
  const relatedModelType: { new (): BaseModel } | undefined =
    data.model.getTableColumnMetadata(data.fieldName)?.modelType;

  if (!relatedModelType) {
    return null;
  }

  const relatedModel: BaseModel = new relatedModelType();

  if (relatedModel instanceof Label) {
    return {
      select: { [data.fieldName]: { name: true, color: true } },
      field: {
        title: data.formField.title || "",
        fieldType: FieldType.Element,
        getElement: (item: TBaseModel): ReactElement => {
          const labels: Array<Label> =
            (readValue(item, data.fieldName) as Array<Label> | undefined) || [];

          return labels.length > 0 ? (
            <LabelsElement labels={labels} />
          ) : (
            noneElement()
          );
        },
      },
    };
  }

  const displayColumn: string | null = getDisplayColumn(relatedModel);

  if (!displayColumn) {
    return null;
  }

  const relatedSelect: Record<string, boolean> = { [displayColumn]: true };

  if (relatedModel instanceof User) {
    relatedSelect["email"] = true;
  }

  return {
    select: { [data.fieldName]: relatedSelect },
    field: {
      title: data.formField.title || "",
      fieldType: FieldType.Element,
      getElement: (item: TBaseModel): ReactElement => {
        const value: unknown = readValue(item, data.fieldName);
        const relatedRows: Array<BaseModel> = (
          Array.isArray(value) ? value : value ? [value] : []
        ) as Array<BaseModel>;

        const names: Array<string> = relatedRows
          .map((related: BaseModel): string => {
            return displayNameOf(related, displayColumn);
          })
          .filter((name: string): boolean => {
            return name.length > 0;
          });

        return names.length > 0 ? (
          <span className="text-sm text-gray-900">{names.join(", ")}</span>
        ) : (
          noneElement()
        );
      },
    },
  };
}

function getDetailField<TBaseModel extends BaseModel>(data: {
  model: TBaseModel;
  fieldName: string;
  formField: ModelField<TBaseModel>;
}): { field: Field<TBaseModel>; select: Record<string, unknown> } | null {
  const { formField, fieldName } = data;
  const plainSelect: Record<string, unknown> = { [fieldName]: true };

  const base: Field<TBaseModel> = {
    field: plainSelect as Select<TBaseModel>,
    title: formField.title || "",
    ...(formField.showIf
      ? {
          showIf: (item: TBaseModel): boolean => {
            return formField.showIf!(item as unknown as FormValues<TBaseModel>);
          },
        }
      : {}),
  };

  switch (formField.fieldType) {
    case FormFieldSchemaType.Toggle:
      return {
        select: plainSelect,
        field: { ...base, fieldType: FieldType.Boolean },
      };
    case FormFieldSchemaType.Text:
    case FormFieldSchemaType.Email:
    case FormFieldSchemaType.URL:
      return {
        select: plainSelect,
        field: { ...base, fieldType: FieldType.Text },
      };
    case FormFieldSchemaType.LongText:
      return {
        select: plainSelect,
        field: { ...base, fieldType: FieldType.LongText },
      };
    case FormFieldSchemaType.Number:
    case FormFieldSchemaType.PositiveNumber:
      return {
        select: plainSelect,
        field: { ...base, fieldType: FieldType.Number },
      };
    case FormFieldSchemaType.Dropdown:
    case FormFieldSchemaType.MultiSelectDropdown: {
      if (formField.dropdownOptions && !formField.dropdownModal) {
        const options: Array<DropdownOption> = flattenOptions(
          formField.dropdownOptions,
        );

        return {
          select: plainSelect,
          field: {
            ...base,
            fieldType: FieldType.Element,
            getElement: (item: TBaseModel): ReactElement => {
              const value: unknown = readValue(item, fieldName);
              const values: Array<unknown> = Array.isArray(value)
                ? value
                : value === undefined || value === null
                  ? []
                  : [value];

              const labels: Array<string> = values.map(
                (entry: unknown): string => {
                  const option: DropdownOption | undefined = options.find(
                    (candidate: DropdownOption): boolean => {
                      return candidate.value === entry;
                    },
                  );
                  return option?.label || String(entry);
                },
              );

              return labels.length > 0 ? (
                <span className="text-sm text-gray-900">
                  {labels.join(", ")}
                </span>
              ) : (
                noneElement()
              );
            },
          },
        };
      }

      const relation: {
        field: Field<TBaseModel>;
        select: Record<string, unknown>;
      } | null = getRelationField(data);

      if (!relation) {
        return null;
      }

      return {
        select: relation.select,
        field: {
          ...base,
          ...relation.field,
          field: relation.select as Select<TBaseModel>,
        },
      };
    }
    default:
      // Nothing generic to show for custom editors; the edit form still has them.
      return null;
  }
}

export function getRuleDetailFields<TBaseModel extends BaseModel>(data: {
  model: TBaseModel;
  formFields: Array<ModelField<TBaseModel>>;
}): RuleDetailFields<TBaseModel> {
  const legacyCriteriaFields: Array<ModelField<TBaseModel>> =
    getLegacyRuleCriteriaFields(data.formFields);
  const legacyCriteriaFieldNames: Set<string> = new Set<string>();

  for (const legacyField of legacyCriteriaFields) {
    const fieldName: string | null = getRuleCriteriaFieldName(legacyField);

    if (fieldName) {
      legacyCriteriaFieldNames.add(fieldName);
    }
  }

  const fields: Array<Field<TBaseModel>> = [];
  const select: Record<string, unknown> = {};
  let criteriaSummaryAdded: boolean = false;

  for (const formField of data.formFields) {
    const fieldName: string | undefined = Object.keys(formField.field || {})[0];

    if (!fieldName) {
      continue;
    }

    if (
      fieldName === RULE_CRITERIA_FIELD_NAME ||
      legacyCriteriaFieldNames.has(fieldName)
    ) {
      if (criteriaSummaryAdded || legacyCriteriaFields.length === 0) {
        continue;
      }

      criteriaSummaryAdded = true;
      select[RULE_CRITERIA_FIELD_NAME] = true;

      /*
       * The summary falls back to the legacy values for a rule saved before
       * configurable criteria, so it needs them selected too - the same
       * select the rule table's criteria column uses.
       */
      for (const legacyField of legacyCriteriaFields) {
        Object.assign(select, legacyField.field || {});
      }

      fields.push({
        field: { [RULE_CRITERIA_FIELD_NAME]: true } as Select<TBaseModel>,
        title: "Match Criteria",
        fieldType: FieldType.Element,
        getElement: (item: TBaseModel): ReactElement => {
          return (
            <RuleCriteriaSummary fields={legacyCriteriaFields} item={item} />
          );
        },
      });

      continue;
    }

    const detail: {
      field: Field<TBaseModel>;
      select: Record<string, unknown>;
    } | null = getDetailField({
      model: data.model,
      fieldName: fieldName,
      formField: formField,
    });

    if (!detail) {
      continue;
    }

    Object.assign(select, detail.select);
    fields.push(detail.field);
  }

  return {
    fields: fields,
    selectMoreFields: select as Select<TBaseModel>,
  };
}

export default getRuleDetailFields;
