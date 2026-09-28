import { DropdownOption } from "../Dropdown/Dropdown";
import Field from "../Forms/Types/Field";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import FormValues from "../Forms/Types/FormValues";
import { translateValidationMessage } from "../Forms/Validation";
import Color from "../../../Types/Color";
import { CustomFieldDefinition } from "../../../Types/CustomField/CustomFieldDefinition";
import {
  CustomFieldDropdownOption,
  parseCustomFieldDropdownOptions,
} from "../../../Types/CustomField/CustomFieldDropdownOption";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { customFieldValueToText } from "../../../Types/CustomField/CustomFieldValueFormat";
import { JSONObject } from "../../../Types/JSON";

/*
 * The inputs for a record's custom field values, built from the project's
 * field definitions. One builder for every place that edits the values:
 *
 *   - the Custom Fields card on a record (CustomFieldsDetail), where every
 *     field stays optional;
 *   - the Details step of declaring an incident, the one place that honours
 *     a field's "Required on create";
 *   - the incident template pages, which pre-fill the values.
 *
 * A definition's `customFieldType` is handed to the form as its field type by
 * value (see CustomFieldType), and values are keyed by the field's name,
 * which is what the record's `customFields` bag is keyed by.
 */

/*
 * A definition, with the incident-only settings that decide where and how it
 * is asked for. The other resources' definitions simply leave them out.
 */
export interface CustomFieldFormDefinition extends CustomFieldDefinition {
  sortOrder?: number | null | undefined;
  showOnCreate?: boolean | undefined;
  isRequiredOnCreate?: boolean | undefined;
  /*
   * A field whose value is copied from a related resource (an incident field
   * mapped from a monitor field). Only read by forms that decide whether to
   * ask for it at all: see CustomFieldModelFormFields.
   */
  mapFromResourceType?: string | undefined;
  mapFromCustomFieldName?: string | undefined;
}

export type ToCustomFieldFormDefinitionFunction = (
  item: unknown,
) => CustomFieldFormDefinition | null;

/**
 * Read a definition row (a model instance or its JSON) into the shape the
 * builder takes. Null for a row with no name, which no value can be stored
 * under.
 */
export const toCustomFieldFormDefinition: ToCustomFieldFormDefinitionFunction =
  (item: unknown): CustomFieldFormDefinition | null => {
    if (!item || typeof item !== "object") {
      return null;
    }

    const row: Record<string, unknown> = item as Record<string, unknown>;
    const name: unknown = row["name"];

    if (typeof name !== "string" || name.length === 0) {
      return null;
    }

    const sortOrder: unknown = row["sortOrder"];

    return {
      name: name,
      description:
        typeof row["description"] === "string"
          ? (row["description"] as string)
          : undefined,
      customFieldType:
        typeof row["customFieldType"] === "string"
          ? (row["customFieldType"] as CustomFieldType)
          : undefined,
      dropdownOptions:
        typeof row["dropdownOptions"] === "string"
          ? (row["dropdownOptions"] as string)
          : undefined,
      sortOrder:
        typeof sortOrder === "number" && Number.isFinite(sortOrder)
          ? sortOrder
          : null,
      showOnCreate: row["showOnCreate"] === true,
      isRequiredOnCreate: row["isRequiredOnCreate"] === true,
      mapFromResourceType:
        typeof row["mapFromResourceType"] === "string" &&
        row["mapFromResourceType"]
          ? (row["mapFromResourceType"] as string)
          : undefined,
      mapFromCustomFieldName:
        typeof row["mapFromCustomFieldName"] === "string" &&
        row["mapFromCustomFieldName"]
          ? (row["mapFromCustomFieldName"] as string)
          : undefined,
    };
  };

/*
 * The order fields are shown in lives with the types, so the server orders
 * the fields in subscriber messages the same way; it is re-exported here for
 * the forms and the Custom Fields card.
 */
export { sortCustomFieldDefinitions } from "../../../Types/CustomField/CustomFieldOrder";
export type { SortCustomFieldDefinitionsFunction } from "../../../Types/CustomField/CustomFieldOrder";

export type GetCustomFieldDropdownOptionsFunction = (
  serializedOptions: unknown,
) => Array<DropdownOption>;

/** A dropdown field's options, with their colors, as the form lists them. */
export const getCustomFieldDropdownOptions: GetCustomFieldDropdownOptionsFunction =
  (serializedOptions: unknown): Array<DropdownOption> => {
    return parseCustomFieldDropdownOptions(serializedOptions).map(
      (option: CustomFieldDropdownOption): DropdownOption => {
        const dropdownOption: DropdownOption = {
          label: option.value,
          value: option.value,
        };

        if (option.color) {
          dropdownOption.color = Color.fromString(option.color);
        }

        return dropdownOption;
      },
    );
  };

/*
 * The types whose value is text. A value of theirs can still be a number or
 * a yes/no: the value check accepts those for them, and a field switched
 * from Number or Yes/No to one of them keeps the values it had.
 */
const TEXT_CUSTOM_FIELD_TYPES: ReadonlyArray<CustomFieldType> = [
  CustomFieldType.Text,
  CustomFieldType.LongText,
  CustomFieldType.Markdown,
];

export type GetCustomFieldDisplayValueFunction = (data: {
  customFieldType?: CustomFieldType | null | undefined;
  value: unknown;
}) => unknown;

/**
 * A stored value as Detail is handed it, on the Custom Fields card and a
 * form's review step: a text field's value as the text it reads as
 * (customFieldValueToText, as its subscriber messages read it), anything
 * else as stored. Detail cannot draw a text field's number or yes/no: its
 * Markdown viewer renders nothing for a value that is not a string, and
 * React renders nothing for a boolean, so a Rich text field holding 5 or
 * true looked empty.
 */
export const getCustomFieldDisplayValue: GetCustomFieldDisplayValueFunction =
  (data: {
    customFieldType?: CustomFieldType | null | undefined;
    value: unknown;
  }): unknown => {
    if (
      data.value === null ||
      data.value === undefined ||
      typeof data.value === "string" ||
      !data.customFieldType ||
      !TEXT_CUSTOM_FIELD_TYPES.includes(data.customFieldType)
    ) {
      return data.value;
    }

    return customFieldValueToText(data.value);
  };

export type GetCustomFieldDetailContentClassNameFunction = (
  customFieldType?: CustomFieldType | null | undefined,
) => string | undefined;

/**
 * The class Detail gives a field's value: a Long text value keeps its line
 * breaks, as the type promises (CustomFieldType) and as its email shows it.
 * Detail has no Long text rendering of its own and would run the lines
 * together.
 */
export const getCustomFieldDetailContentClassName: GetCustomFieldDetailContentClassNameFunction =
  (
    customFieldType?: CustomFieldType | null | undefined,
  ): string | undefined => {
    return customFieldType === CustomFieldType.LongText
      ? "whitespace-pre-wrap"
      : undefined;
  };

/*
 * What a review step shows for a field left empty. The English text is its
 * key in the locale files, and the Custom Fields card shows the same.
 */
export const CUSTOM_FIELD_NO_VALUE_PLACEHOLDER: string = "No data entered";

/*
 * The error for a required yes/no field left unticked. The English template
 * is also its key in the locale files, like the form's other validation
 * messages.
 */
export const CUSTOM_FIELD_MUST_BE_CHECKED_MESSAGE: string =
  "{{field}} must be checked.";

type IsDropdownFunction = (customFieldType: unknown) => boolean;

const isDropdownType: IsDropdownFunction = (
  customFieldType: unknown,
): boolean => {
  return (
    customFieldType === CustomFieldType.Dropdown ||
    customFieldType === CustomFieldType.MultiSelectDropdown
  );
};

export type BuildCustomFieldFormFieldsFunction = (data: {
  definitions: Array<CustomFieldFormDefinition>;
  /*
   * Make the fields marked "Required on create" required. Only the Details
   * step of declaring an incident sets this. Everywhere else - the Custom
   * Fields card most of all - every field stays optional: fixing one field
   * on an incident a monitor opened mid-outage must not demand all the
   * others first.
   */
  enforceRequiredOnCreate?: boolean | undefined;
  // Put every field on this step of a multi-step form.
  stepId?: string | undefined;
  /*
   * Where the form holds each field's value, when that is not simply the
   * field's name: a record's own create form keys the values apart from its
   * columns (see CustomFieldModelFormFields). The field then carries it as
   * its overrideFieldKey, and its own validation reads the value from there.
   */
  getFormKey?: ((fieldName: string) => string) | undefined;
}) => Array<Field<JSONObject>>;

/**
 * One form field per definition, in the order given (sort the definitions
 * with sortCustomFieldDefinitions first).
 */
export const buildCustomFieldFormFields: BuildCustomFieldFormFieldsFunction =
  (data: {
    definitions: Array<CustomFieldFormDefinition>;
    enforceRequiredOnCreate?: boolean | undefined;
    stepId?: string | undefined;
    getFormKey?: ((fieldName: string) => string) | undefined;
  }): Array<Field<JSONObject>> => {
    return data.definitions.map(
      (definition: CustomFieldFormDefinition): Field<JSONObject> => {
        const isRequired: boolean = Boolean(
          data.enforceRequiredOnCreate && definition.isRequiredOnCreate,
        );

        const formKey: string = data.getFormKey
          ? data.getFormKey(definition.name)
          : definition.name;

        const field: Field<JSONObject> = {
          field: {
            [definition.name]: true,
          },
          title: definition.name,
          fieldType:
            definition.customFieldType as unknown as FormFieldSchemaType,
          required: isRequired,
          placeholder: "",
          dropdownOptions: isDropdownType(definition.customFieldType)
            ? getCustomFieldDropdownOptions(definition.dropdownOptions)
            : undefined,
        };

        if (formKey !== definition.name) {
          field.overrideFieldKey = formKey;
        }

        if (definition.description) {
          field.description = definition.description;
        }

        if (data.stepId) {
          field.stepId = data.stepId;
        }

        /*
         * A required yes/no field means "must be ticked" - an acknowledgement.
         * `required` alone cannot say that: the form turns an unticked box into
         * the string "false" before its required check, which then passes.
         */
        if (
          isRequired &&
          definition.customFieldType === CustomFieldType.Boolean
        ) {
          const name: string = definition.name;

          field.customValidation = (
            values: FormValues<JSONObject>,
          ): string | null => {
            return (values as JSONObject)[formKey] === true
              ? null
              : translateValidationMessage(
                  CUSTOM_FIELD_MUST_BE_CHECKED_MESSAGE,
                  { field: name },
                );
          };
        }

        return field;
      },
    );
  };
