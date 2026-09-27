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
    };
  };

export type SortCustomFieldDefinitionsFunction = <
  T extends { sortOrder?: number | null | undefined },
>(
  definitions: Array<T>,
) => Array<T>;

/**
 * Fields with an order first, lowest first; fields without one after them.
 * Stable, so fields with the same order (or none) keep the order they came
 * in. Returns a new list.
 */
export const sortCustomFieldDefinitions: SortCustomFieldDefinitionsFunction = <
  T extends { sortOrder?: number | null | undefined },
>(
  definitions: Array<T>,
): Array<T> => {
  const orderOf: (definition: T) => number = (definition: T): number => {
    return typeof definition.sortOrder === "number" &&
      Number.isFinite(definition.sortOrder)
      ? definition.sortOrder
      : Number.POSITIVE_INFINITY;
  };

  return definitions
    .map((definition: T, index: number) => {
      return { definition, index };
    })
    .sort(
      (
        a: { definition: T; index: number },
        b: { definition: T; index: number },
      ) => {
        const difference: number =
          orderOf(a.definition) - orderOf(b.definition);

        if (difference !== 0 && !Number.isNaN(difference)) {
          return difference;
        }

        return a.index - b.index;
      },
    )
    .map((entry: { definition: T; index: number }) => {
      return entry.definition;
    });
};

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
  }): Array<Field<JSONObject>> => {
    return data.definitions.map(
      (definition: CustomFieldFormDefinition): Field<JSONObject> => {
        const isRequired: boolean = Boolean(
          data.enforceRequiredOnCreate && definition.isRequiredOnCreate,
        );

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
            return (values as JSONObject)[name] === true
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
