import { DropdownOption } from "../Dropdown/Dropdown";
import Field from "../Forms/Types/Field";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import FormValues from "../Forms/Types/FormValues";
import { translateValidationMessage } from "../Forms/Validation";
import FileModel from "../../../Models/DatabaseModels/File";
import Color from "../../../Types/Color";
import { CustomFieldDefinition } from "../../../Types/CustomField/CustomFieldDefinition";
import {
  CUSTOM_FIELD_FILE_TYPES,
  CUSTOM_FIELD_MAX_FILES,
  CustomFieldFile,
  isCustomFieldFileType,
  readCustomFieldFileReference,
  readCustomFieldFiles,
} from "../../../Types/CustomField/CustomFieldFile";
import MimeType from "../../../Types/File/MimeType";
import {
  CustomFieldDropdownOption,
  parseCustomFieldDropdownOptions,
} from "../../../Types/CustomField/CustomFieldDropdownOption";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { getCustomFieldValuesNotOffered } from "../../../Types/CustomField/CustomFieldOptionEdit";
import { customFieldValueToText } from "../../../Types/CustomField/CustomFieldValueFormat";
import { JSONObject } from "../../../Types/JSON";
import { translateTemplate } from "../../Utils/TranslateTemplate";

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

/*
 * A value a record holds that its dropdown field no longer offers - an
 * option taken out after the record chose it (#4564) - is shown, never
 * hidden: as itself, in gray, marked as no longer an option. The English
 * texts are their keys in the locale files.
 */
export const CUSTOM_FIELD_NO_LONGER_AN_OPTION_TEMPLATE: string =
  "{{option}} (no longer an option)";

export const CUSTOM_FIELD_NO_LONGER_AN_OPTION_TEXT: string =
  "No longer an option";

// Gray: it reads as set, and as not one of the colors the options have.
export const CUSTOM_FIELD_NO_LONGER_AN_OPTION_COLOR: string = "#6b7280";

export type GetCustomFieldDropdownOptionsFunction = (
  serializedOptions: unknown,
  // What the record holds for the field, when its own value must be shown.
  heldValue?: unknown,
) => Array<DropdownOption>;

/**
 * A dropdown field's options, with their colors, as the form lists them -
 * followed, when the record's own value is given, by each value it holds
 * that the field no longer offers, so the form and the card show it as
 * chosen (and keep it) instead of showing the field as empty.
 */
export const getCustomFieldDropdownOptions: GetCustomFieldDropdownOptionsFunction =
  (serializedOptions: unknown, heldValue?: unknown): Array<DropdownOption> => {
    const options: Array<DropdownOption> = parseCustomFieldDropdownOptions(
      serializedOptions,
    ).map((option: CustomFieldDropdownOption): DropdownOption => {
      const dropdownOption: DropdownOption = {
        label: option.value,
        value: option.value,
      };

      if (option.color) {
        dropdownOption.color = Color.fromString(option.color);
      }

      return dropdownOption;
    });

    if (heldValue === undefined) {
      return options;
    }

    for (const value of getCustomFieldValuesNotOffered({
      dropdownOptions: serializedOptions,
      value: heldValue,
    })) {
      options.push({
        label: translateTemplate(CUSTOM_FIELD_NO_LONGER_AN_OPTION_TEMPLATE, {
          option: String(value),
        }),
        value: value,
        color: Color.fromString(CUSTOM_FIELD_NO_LONGER_AN_OPTION_COLOR),
      });
    }

    return options;
  };

/*
 * What a file field's picker says it takes, in place of its list of 25
 * types. The English texts are their keys in the locale files.
 */
export const CUSTOM_FIELD_FILE_HINT: string =
  "PDF, Office and OpenDocument files, pictures, text, CSV, JSON, ZIP or PCAP, up to 10 MB.";

export const CUSTOM_FIELD_FILES_HINT: string =
  "Up to 10 files of 10 MB each: PDF, Office and OpenDocument files, pictures, text, CSV, JSON, ZIP or PCAP.";

export type ToCustomFieldFileFormValueFunction = (data: {
  customFieldType?: CustomFieldType | null | undefined;
  value: unknown;
}) => unknown;

/**
 * A file field's stored value as its file picker holds it: the files as
 * File models with their id, name and type - one, or a list - so the picker
 * lists them and hands them back as they are when nothing changed. Any other
 * field's value is as stored.
 */
export const toCustomFieldFileFormValue: ToCustomFieldFileFormValueFunction =
  (data: {
    customFieldType?: CustomFieldType | null | undefined;
    value: unknown;
  }): unknown => {
    if (!isCustomFieldFileType(data.customFieldType)) {
      return data.value;
    }

    const files: Array<FileModel> = readCustomFieldFiles(data.value).map(
      (file: CustomFieldFile): FileModel => {
        const model: FileModel = new FileModel();
        model._id = file.fileId;
        model.name = file.name;
        model.fileType = file.fileType as MimeType;
        return model;
      },
    );

    if (data.customFieldType === CustomFieldType.File) {
      return files[0] || null;
    }

    return files;
  };

export type FromCustomFieldFileFormValueFunction = (data: {
  customFieldType?: CustomFieldType | null | undefined;
  value: unknown;
}) => unknown;

/**
 * What a file field's picker holds, as a write sends it: each file as
 * { fileId, name, fileType } - the server reads the rest from the file - one
 * for a File field, a list for a Multiple files field; null when it holds
 * none. Any other field's value is as given.
 */
export const fromCustomFieldFileFormValue: FromCustomFieldFileFormValueFunction =
  (data: {
    customFieldType?: CustomFieldType | null | undefined;
    value: unknown;
  }): unknown => {
    if (!isCustomFieldFileType(data.customFieldType)) {
      return data.value;
    }

    const entries: Array<unknown> = Array.isArray(data.value)
      ? data.value
      : data.value === undefined || data.value === null || data.value === ""
        ? []
        : [data.value];

    const references: Array<JSONObject> = [];

    for (const entry of entries) {
      const fileId: string | null = readCustomFieldFileReference(entry);

      if (!fileId) {
        continue;
      }

      const named: Record<string, unknown> =
        entry && typeof entry === "object"
          ? (entry as Record<string, unknown>)
          : {};

      references.push({
        fileId: fileId,
        name: typeof named["name"] === "string" ? named["name"] : "",
        fileType: typeof named["fileType"] === "string" ? named["fileType"] : "",
      });
    }

    if (data.customFieldType === CustomFieldType.File) {
      return references[0] || null;
    }

    return references;
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
  /*
   * The values the record holds now, by field name: a dropdown also offers
   * each value it holds that the field no longer does, so editing the
   * record shows it chosen and keeps it until someone picks another.
   */
  values?: JSONObject | undefined;
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
    values?: JSONObject | undefined;
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
            ? getCustomFieldDropdownOptions(
                definition.dropdownOptions,
                data.values?.[definition.name],
              )
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
         * A file field's picker takes the kinds of file the field takes, and
         * a Multiple files field no more files than it holds; the server
         * holds every write to the same (CustomFieldFiles).
         */
        if (isCustomFieldFileType(definition.customFieldType)) {
          field.fileTypes = [...CUSTOM_FIELD_FILE_TYPES];

          if (definition.customFieldType === CustomFieldType.MultipleFiles) {
            field.maxFiles = CUSTOM_FIELD_MAX_FILES;
            field.fileHint = CUSTOM_FIELD_FILES_HINT;
          } else {
            field.fileHint = CUSTOM_FIELD_FILE_HINT;
          }
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
