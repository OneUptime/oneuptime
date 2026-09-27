import Detail from "../Detail/Detail";
import { ModelField } from "../Forms/ModelForm";
import Field from "../Forms/Types/Field";
import FormValues from "../Forms/Types/FormValues";
import FieldType from "../Types/FieldType";
import {
  buildCustomFieldFormFields,
  CUSTOM_FIELD_NO_VALUE_PLACEHOLDER,
  CustomFieldFormDefinition,
  getCustomFieldDropdownOptions,
} from "./CustomFieldFormFields";

export { CUSTOM_FIELD_NO_VALUE_PLACEHOLDER } from "./CustomFieldFormFields";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  CustomFieldMappingSourceInfo,
  getCustomFieldMappingSource,
  hasCustomFieldMappingSource,
} from "../../../Types/CustomField/CustomFieldMappingCatalog";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { isCustomFieldValueEmpty } from "../../../Types/CustomField/CustomFieldValueMapping";
import { JSONObject } from "../../../Types/JSON";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Custom field inputs inside a record's OWN create form, next to its columns:
 * the Details step of declaring an incident, and the Custom Fields step of a
 * new incident template. (The Custom Fields card of a record that exists
 * edits the values on their own, through CustomFieldsDetail.)
 *
 * A ModelForm only knows its model's columns, and the values live in one of
 * them, `customFields`, a JSON bag keyed by each field's name. So each input
 * here:
 *
 *   - is held under its own form key, "customFields:<name>", never under the
 *     field's bare name: a field called "title" must not become the title
 *     input's value;
 *   - is permission-checked against the model's `customFields` column
 *     (overrideField), so nobody is shown inputs they may not fill in;
 *   - is packed back into `customFields` by the page's onBeforeCreate, from
 *     the values the form submitted (packCustomFieldFormValues). Never from
 *     the request's misc data, which keeps only truthy values - a Number of 0
 *     and a switch left off would be dropped there.
 */

export const CUSTOM_FIELD_FORM_KEY_PREFIX: string = "customFields:";

export type GetCustomFieldFormKeyFunction = (fieldName: string) => string;

// Where the form holds one field's value.
export const getCustomFieldFormKey: GetCustomFieldFormKeyFunction = (
  fieldName: string,
): string => {
  return `${CUSTOM_FIELD_FORM_KEY_PREFIX}${fieldName}`;
};

export type IsCustomFieldInheritedFunction = (data: {
  // The definition table, e.g. "IncidentCustomField".
  definitionTableName: string;
  definition: CustomFieldFormDefinition;
  // The record as the form stands: its relations decide.
  values: JSONObject;
}) => boolean;

/**
 * Whether a field's value will be copied from a related resource rather than
 * typed: it is mapped (an incident field from a monitor field) and the record
 * is attached to something to copy from (the incident has a monitor). The
 * server re-applies the mapping on create, so asking for such a value would
 * only have it replaced. The same rule the Custom Fields card uses.
 */
export const isCustomFieldInherited: IsCustomFieldInheritedFunction = (data: {
  definitionTableName: string;
  definition: CustomFieldFormDefinition;
  values: JSONObject;
}): boolean => {
  if (
    !data.definition.mapFromResourceType ||
    !data.definition.mapFromCustomFieldName
  ) {
    return false;
  }

  const source: CustomFieldMappingSourceInfo | undefined =
    getCustomFieldMappingSource({
      definitionTableName: data.definitionTableName,
      resource: data.definition.mapFromResourceType,
    });

  if (!source) {
    return false;
  }

  return hasCustomFieldMappingSource({
    source: source,
    record: data.values as Record<string, unknown>,
  });
};

export interface CustomFieldValueSummaryProps {
  definition: CustomFieldFormDefinition;
  value: unknown;
}

/*
 * One field's value on a form's review step, drawn the way the Custom Fields
 * card draws it: Yes or No, the option's label, the date in the viewer's time.
 */
export const CustomFieldValueSummary: FunctionComponent<
  CustomFieldValueSummaryProps
> = (props: CustomFieldValueSummaryProps): ReactElement => {
  const type: CustomFieldType | undefined = props.definition.customFieldType;
  const isDropdown: boolean =
    type === CustomFieldType.Dropdown ||
    type === CustomFieldType.MultiSelectDropdown;

  return (
    <Detail<JSONObject>
      item={{
        value: isCustomFieldValueEmpty(props.value)
          ? null
          : (props.value as JSONObject["value"]),
      }}
      fields={[
        {
          key: "value",
          // CustomFieldType names a FieldType by value (see CustomFieldType).
          fieldType: (type as unknown as FieldType) || FieldType.Text,
          placeholder: CUSTOM_FIELD_NO_VALUE_PLACEHOLDER,
          dropdownOptions: isDropdown
            ? getCustomFieldDropdownOptions(props.definition.dropdownOptions)
            : undefined,
        },
      ]}
    />
  );
};

export type BuildCustomFieldModelFormFieldsFunction = <
  TBaseModel extends BaseModel,
>(data: {
  definitions: Array<CustomFieldFormDefinition>;
  // Honour "Required on create" (the Details step of declaring an incident).
  enforceRequiredOnCreate?: boolean | undefined;
  stepId?: string | undefined;
  /*
   * Whether to ask for a field given the form as it stands. A field not asked
   * for is neither validated nor packed: the record keeps whatever it would
   * otherwise start with.
   */
  isShown?:
    | ((definition: CustomFieldFormDefinition, values: JSONObject) => boolean)
    | undefined;
}) => Array<ModelField<TBaseModel>>;

/**
 * One ModelForm input per definition, in the order given, built by the same
 * builder as every other custom field form (buildCustomFieldFormFields).
 */
export const buildCustomFieldModelFormFields: BuildCustomFieldModelFormFieldsFunction =
  <TBaseModel extends BaseModel>(data: {
    definitions: Array<CustomFieldFormDefinition>;
    enforceRequiredOnCreate?: boolean | undefined;
    stepId?: string | undefined;
    isShown?:
      | ((definition: CustomFieldFormDefinition, values: JSONObject) => boolean)
      | undefined;
  }): Array<ModelField<TBaseModel>> => {
    const fields: Array<Field<JSONObject>> = buildCustomFieldFormFields({
      definitions: data.definitions,
      enforceRequiredOnCreate: data.enforceRequiredOnCreate,
      stepId: data.stepId,
      getFormKey: getCustomFieldFormKey,
    });

    return fields.map(
      (
        builtField: Field<JSONObject>,
        index: number,
      ): ModelField<TBaseModel> => {
        const definition: CustomFieldFormDefinition = data.definitions[index]!;
        const formKey: string = getCustomFieldFormKey(definition.name);

        /*
         * The builder names the field after its name (`field`). Here the
         * value is not a column, so that goes: the permission check and the
         * dedupe read `overrideField` and the form key instead.
         */
        const rest: Field<JSONObject> = { ...builtField };
        delete rest.field;

        const modelField: ModelField<TBaseModel> = {
          ...(rest as unknown as ModelField<TBaseModel>),
          overrideField: {
            customFields: true,
          },
          overrideFieldKey: formKey,
          getSummaryElement: (values: FormValues<TBaseModel>): ReactElement => {
            return (
              <CustomFieldValueSummary
                definition={definition}
                value={(values as JSONObject)[formKey]}
              />
            );
          },
        };

        if (data.isShown) {
          const isShown: (
            definition: CustomFieldFormDefinition,
            values: JSONObject,
          ) => boolean = data.isShown;

          modelField.showIf = (values: FormValues<TBaseModel>): boolean => {
            return isShown(definition, (values || {}) as JSONObject);
          };
        }

        return modelField;
      },
    );
  };

export type GetCustomFieldFormInitialValuesFunction = (data: {
  definitions: Array<CustomFieldFormDefinition>;
  // The values the record starts with, keyed by field name.
  customFields: unknown;
}) => JSONObject;

/**
 * The form's starting values for these fields, taken from a bag keyed by
 * field name (an incident template's values), under their form keys.
 */
export const getCustomFieldFormInitialValues: GetCustomFieldFormInitialValuesFunction =
  (data: {
    definitions: Array<CustomFieldFormDefinition>;
    customFields: unknown;
  }): JSONObject => {
    const initialValues: JSONObject = {};

    if (!isPlainObject(data.customFields)) {
      return initialValues;
    }

    const bag: JSONObject = data.customFields;

    for (const definition of data.definitions) {
      if (!Object.prototype.hasOwnProperty.call(bag, definition.name)) {
        continue;
      }

      const value: unknown = bag[definition.name];

      if (isCustomFieldValueEmpty(value)) {
        continue;
      }

      initialValues[getCustomFieldFormKey(definition.name)] =
        value as JSONObject["value"];
    }

    return initialValues;
  };

type IsPlainObjectFunction = (value: unknown) => value is JSONObject;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is JSONObject => {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
};

type NormalizeFormValueFunction = (value: unknown) => unknown;

/*
 * A dropdown can still hold the option object it was picked as ({label,
 * value}) rather than its value; the value is what is stored.
 */
const normalizeFormValue: NormalizeFormValueFunction = (
  value: unknown,
): unknown => {
  const unwrap: (entry: unknown) => unknown = (entry: unknown): unknown => {
    if (
      isPlainObject(entry) &&
      Object.prototype.hasOwnProperty.call(entry, "value") &&
      Object.prototype.hasOwnProperty.call(entry, "label")
    ) {
      return entry["value"];
    }

    return entry;
  };

  if (Array.isArray(value)) {
    return value.map(unwrap);
  }

  return unwrap(value);
};

export type PackCustomFieldFormValuesFunction = (data: {
  // The fields the form asked for.
  definitions: Array<CustomFieldFormDefinition>;
  // Every value the form submitted (ModelForm's onBeforeCreate hands it over).
  formValues: JSONObject | null | undefined;
  /*
   * The values the record starts with, keyed by field name - an incident
   * template's. They are kept for every field the form did not ask about.
   */
  startingCustomFields?: unknown;
  // As buildCustomFieldModelFormFields: a field not shown is not the form's.
  isShown?:
    | ((definition: CustomFieldFormDefinition, values: JSONObject) => boolean)
    | undefined;
}) => JSONObject | undefined;

/**
 * The record's `customFields` bag: the starting values, with each field the
 * form asked for set to what it holds. 0 and false are answers and are kept;
 * a field emptied on the form is removed, so clearing a value a template
 * filled in sticks. Undefined when there is nothing to store.
 */
export const packCustomFieldFormValues: PackCustomFieldFormValuesFunction =
  (data: {
    definitions: Array<CustomFieldFormDefinition>;
    formValues: JSONObject | null | undefined;
    startingCustomFields?: unknown;
    isShown?:
      | ((definition: CustomFieldFormDefinition, values: JSONObject) => boolean)
      | undefined;
  }): JSONObject | undefined => {
    const formValues: JSONObject = data.formValues || {};

    const result: JSONObject = isPlainObject(data.startingCustomFields)
      ? { ...data.startingCustomFields }
      : {};

    for (const definition of data.definitions) {
      if (data.isShown && !data.isShown(definition, formValues)) {
        continue;
      }

      const formKey: string = getCustomFieldFormKey(definition.name);

      // The form never held a value for it, so it has nothing to say.
      if (!Object.prototype.hasOwnProperty.call(formValues, formKey)) {
        continue;
      }

      const value: unknown = normalizeFormValue(formValues[formKey]);

      if (isCustomFieldValueEmpty(value)) {
        delete result[definition.name];
        continue;
      }

      result[definition.name] = value as JSONObject["value"];
    }

    return Object.keys(result).length > 0 ? result : undefined;
  };

export type RemoveCustomFieldFormKeysFunction = (
  miscDataProps: JSONObject,
) => void;

/**
 * Takes the inputs' values out of a request's misc data, where ModelForm puts
 * every form-only value: they travel in `customFields`, and nowhere else.
 */
export const removeCustomFieldFormKeys: RemoveCustomFieldFormKeysFunction = (
  miscDataProps: JSONObject,
): void => {
  for (const key of Object.keys(miscDataProps)) {
    if (key.startsWith(CUSTOM_FIELD_FORM_KEY_PREFIX)) {
      delete miscDataProps[key];
    }
  }
};
