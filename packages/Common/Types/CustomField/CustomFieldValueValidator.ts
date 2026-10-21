import { CustomFieldDefinition } from "./CustomFieldDefinition";
import {
  CustomFieldDropdownOption,
  parseCustomFieldDropdownOptions,
} from "./CustomFieldDropdownOption";
import CustomFieldType from "./CustomFieldType";
import { isCustomFieldValueEmpty } from "./CustomFieldValueMapping";

/*
 * Checks the custom field values a write puts on a record against the
 * project's field definitions: a Number field holds a number, a Dropdown one
 * of its options, and so on. Until this existed nothing on the server looked
 * at the values at all, so the API could store "banana" in a Number field and
 * every screen, filter and email downstream had to cope.
 *
 * It is deliberately narrow, because it sits in front of writes that have
 * worked for years:
 *
 *   - ONLY KEYS THIS WRITE CHANGES are checked. The Custom Fields card sends
 *     the record's whole bag back on every save, so a value stored before
 *     this check - or one that has since stopped being valid, like a
 *     dropdown option an admin removed - must keep passing, or fixing one
 *     field would be refused because of another. A multi-select keeps the
 *     entries it already had for the same reason; only the new ones are
 *     checked.
 *   - KEYS WITH NO DEFINITION pass. The bag is keyed by display name, and an
 *     API client may hold values for a field that was deleted or renamed.
 *   - EMPTY VALUES pass. Clearing a field is always allowed, and nothing here
 *     says a field is required: incidents created by monitors, the API,
 *     Slack, Microsoft Teams or AI cannot fill in a form (see "Required on
 *     create", which the dashboard enforces).
 *   - FIELDS WITH NO TYPE pass: there is nothing to check them against.
 *
 * Callers decide which writes are checked at all. IncidentService skips root
 * writes, and runs this before mapped values (copied from monitors) are
 * folded into the write, so neither is ever refused here.
 *
 * Pure, with no database or React imports, so it can be tested directly and
 * the dashboard could run the same rules.
 */

export interface CustomFieldValueValidationError {
  fieldName: string;
  message: string;
}

/*
 * Values and lists (of options, or of entries that are not options) are
 * quoted back in the message, bounded so that a pasted essay, a field with
 * two hundred options or a list of a million entries still reads as one
 * line.
 */
const MAX_QUOTED_VALUE_LENGTH: number = 80;
const MAX_LISTED_OPTIONS: number = 10;

type QuoteFunction = (value: unknown) => string;

const quote: QuoteFunction = (value: unknown): string => {
  let text: string;

  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }

  if (text === undefined) {
    text = String(value);
  }

  if (text.length > MAX_QUOTED_VALUE_LENGTH) {
    text = `${text.slice(0, MAX_QUOTED_VALUE_LENGTH)}...`;
  }

  return `"${text}"`;
};

type ListOptionsFunction = (options: Array<string>) => string;

const listOptions: ListOptionsFunction = (options: Array<string>): string => {
  const listed: string = options
    .slice(0, MAX_LISTED_OPTIONS)
    .map((option: string) => {
      return quote(option);
    })
    .join(", ");

  const more: number = options.length - MAX_LISTED_OPTIONS;

  return more > 0 ? `${listed} and ${more} more` : listed;
};

/*
 * The same notion of "the same answer" that value mapping uses, so an
 * unchanged multi-select in another order is still unchanged.
 */
type CanonicalizeFunction = (value: unknown) => string;

const canonicalize: CanonicalizeFunction = (value: unknown): string => {
  if (Array.isArray(value)) {
    return JSON.stringify(
      [...value]
        .map((entry: unknown) => {
          return String(entry);
        })
        .sort(),
    );
  }

  if (value instanceof Date) {
    // toISOString throws on an invalid date; that one is checked, not compared.
    return isNaN(value.getTime())
      ? "invalid-date"
      : JSON.stringify(value.toISOString());
  }

  return JSON.stringify(value ?? null);
};

type IsPlainObjectFunction = (
  value: unknown,
) => value is Record<string, unknown>;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is Record<string, unknown> => {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
};

type IsScalarFunction = (value: unknown) => boolean;

// The values a dropdown option can be written as: its text, or a bare number.
const isOptionScalar: IsScalarFunction = (value: unknown): boolean => {
  return (
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
};

const isNumberValue: IsScalarFunction = (value: unknown): boolean => {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  /*
   * The dashboard's number input submits what was typed, as a string -
   * "0", "42", "3.5" - which is how most stored Number values look.
   */
  if (typeof value === "string") {
    const trimmed: string = value.trim();

    return trimmed.length > 0 && Number.isFinite(Number(trimmed));
  }

  return false;
};

const isBooleanValue: IsScalarFunction = (value: unknown): boolean => {
  /*
   * The strings are accepted because the table and filters already read them
   * as Yes and No, and hand-written API requests send them.
   */
  return typeof value === "boolean" || value === "true" || value === "false";
};

const isDateValue: IsScalarFunction = (value: unknown): boolean => {
  if (value instanceof Date) {
    return !isNaN(value.getTime());
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }

  return !isNaN(new Date(value.trim()).getTime());
};

// Text of any kind: what was typed, or a number or yes/no sent over the API.
const isTextValue: IsScalarFunction = (value: unknown): boolean => {
  return (
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  );
};

type ValidateOneFunction = (data: {
  definition: CustomFieldDefinition;
  value: unknown;
  storedValue: unknown;
}) => string | null;

const validateDropdownValue: ValidateOneFunction = (data: {
  definition: CustomFieldDefinition;
  value: unknown;
  storedValue: unknown;
}): string | null => {
  const name: string = data.definition.name;

  if (!isOptionScalar(data.value)) {
    return `${quote(name)} holds one of its options, but was sent ${quote(
      data.value,
    )}.`;
  }

  const options: Array<string> = parseCustomFieldDropdownOptions(
    data.definition.dropdownOptions,
  ).map((option: CustomFieldDropdownOption) => {
    return option.value;
  });

  /*
   * A dropdown nobody has given options to cannot be checked against them;
   * refusing every value would make the field unusable over the API until an
   * admin finishes defining it.
   */
  if (options.length === 0 || options.includes(String(data.value))) {
    return null;
  }

  return `${quote(data.value)} is not one of the options for ${quote(
    name,
  )}. Choose one of: ${listOptions(options)}.`;
};

const validateMultiSelectValue: ValidateOneFunction = (data: {
  definition: CustomFieldDefinition;
  value: unknown;
  storedValue: unknown;
}): string | null => {
  const name: string = data.definition.name;

  /*
   * A single value is accepted as a selection of one: a field that was
   * switched from single to multi select still holds bare strings, and the
   * table renders one that way.
   */
  const entries: Array<unknown> = Array.isArray(data.value)
    ? data.value
    : [data.value];

  const invalidShape: unknown = entries.find((entry: unknown) => {
    return !isOptionScalar(entry);
  });

  if (invalidShape !== undefined) {
    return `${quote(name)} holds a list of its options, but was sent ${quote(
      data.value,
    )}.`;
  }

  const options: Array<string> = parseCustomFieldDropdownOptions(
    data.definition.dropdownOptions,
  ).map((option: CustomFieldDropdownOption) => {
    return option.value;
  });

  if (options.length === 0) {
    return null;
  }

  // Entries the record already holds stay valid, removed options included.
  const alreadyHeld: Set<string> = new Set<string>(
    (Array.isArray(data.storedValue)
      ? data.storedValue
      : data.storedValue === undefined || data.storedValue === null
        ? []
        : [data.storedValue]
    ).map((entry: unknown) => {
      return String(entry);
    }),
  );

  const notOptions: Array<string> = entries
    .map((entry: unknown) => {
      return String(entry);
    })
    .filter((entry: string) => {
      return !alreadyHeld.has(entry) && !options.includes(entry);
    });

  if (notOptions.length === 0) {
    return null;
  }

  /*
   * The entries are listed as the options are, the first few and a count
   * of the rest: a write can send any number of them, and the message is
   * logged and sent back whole.
   */
  return `${listOptions(notOptions)} ${
    notOptions.length === 1 ? "is not one of" : "are not among"
  } the options for ${quote(name)}. Choose from: ${listOptions(options)}.`;
};

const validateValue: ValidateOneFunction = (data: {
  definition: CustomFieldDefinition;
  value: unknown;
  storedValue: unknown;
}): string | null => {
  const name: string = data.definition.name;

  switch (data.definition.customFieldType) {
    case CustomFieldType.Text:
    case CustomFieldType.LongText:
    case CustomFieldType.Markdown:
      return isTextValue(data.value)
        ? null
        : `${quote(name)} holds text, but was sent ${quote(data.value)}.`;

    case CustomFieldType.Number:
      return isNumberValue(data.value)
        ? null
        : `${quote(name)} holds a number, but was sent ${quote(data.value)}.`;

    case CustomFieldType.Boolean:
      return isBooleanValue(data.value)
        ? null
        : `${quote(name)} holds true or false, but was sent ${quote(
            data.value,
          )}.`;

    case CustomFieldType.Date:
      return isDateValue(data.value)
        ? null
        : `${quote(name)} holds a date, but was sent ${quote(data.value)}.`;

    case CustomFieldType.DateTime:
      return isDateValue(data.value)
        ? null
        : `${quote(name)} holds a date and time, but was sent ${quote(
            data.value,
          )}.`;

    case CustomFieldType.Dropdown:
      return validateDropdownValue(data);

    case CustomFieldType.MultiSelectDropdown:
      return validateMultiSelectValue(data);

    default:
      // No type, or one this version does not know: nothing to check.
      return null;
  }
};

export type ValidateCustomFieldValuesFunction = (data: {
  // The project's field definitions for this kind of record.
  definitions: Array<CustomFieldDefinition>;
  // The bag this write stores. Anything but an object is left alone.
  customFields: unknown;
  // The bag the record holds now. Empty (or missing) on create.
  storedCustomFields?: unknown;
}) => Array<CustomFieldValueValidationError>;

/**
 * Every value this write changes that does not fit its field, in the order
 * the write lists them. Empty when the write is fine.
 */
export const validateCustomFieldValues: ValidateCustomFieldValuesFunction =
  (data: {
    definitions: Array<CustomFieldDefinition>;
    customFields: unknown;
    storedCustomFields?: unknown;
  }): Array<CustomFieldValueValidationError> => {
    if (!isPlainObject(data.customFields)) {
      return [];
    }

    const stored: Record<string, unknown> = isPlainObject(
      data.storedCustomFields,
    )
      ? data.storedCustomFields
      : {};

    const definitionsByName: Map<string, CustomFieldDefinition> = new Map<
      string,
      CustomFieldDefinition
    >();

    for (const definition of data.definitions || []) {
      if (definition && typeof definition.name === "string") {
        definitionsByName.set(definition.name, definition);
      }
    }

    const errors: Array<CustomFieldValueValidationError> = [];

    for (const [fieldName, value] of Object.entries(data.customFields)) {
      const definition: CustomFieldDefinition | undefined =
        definitionsByName.get(fieldName);

      if (!definition) {
        continue;
      }

      if (isCustomFieldValueEmpty(value)) {
        continue;
      }

      const storedValue: unknown = Object.prototype.hasOwnProperty.call(
        stored,
        fieldName,
      )
        ? stored[fieldName]
        : undefined;

      if (canonicalize(value) === canonicalize(storedValue)) {
        continue;
      }

      const message: string | null = validateValue({
        definition: definition,
        value: value,
        storedValue: storedValue,
      });

      if (message) {
        errors.push({ fieldName: fieldName, message: message });
      }
    }

    return errors;
  };

export type FormatCustomFieldValueValidationErrorsFunction = (
  errors: Array<CustomFieldValueValidationError>,
) => string;

/** One message for an API error response. */
export const formatCustomFieldValueValidationErrors: FormatCustomFieldValueValidationErrorsFunction =
  (errors: Array<CustomFieldValueValidationError>): string => {
    return errors
      .map((error: CustomFieldValueValidationError) => {
        return error.message;
      })
      .join(" ");
  };

export type KeepValidCustomFieldValuesFunction = (data: {
  definitions: Array<CustomFieldDefinition>;
  customFields: unknown;
}) => Record<string, unknown>;

/**
 * The values of a bag that a create would accept, each judged on its own as
 * if it were new: an option since removed from a dropdown, or a word in a
 * Number field, is left out.
 *
 * For a bag copied onto a new record from elsewhere - an incident template's
 * values, when an incident is declared from it. Those were written long
 * before the incident and may no longer fit their fields; sent as they are,
 * one stale value would refuse the whole declaration over a field the person
 * declaring may not even be shown. Keys with no definition, and empty values,
 * are kept, as validateCustomFieldValues passes them.
 */
export const keepValidCustomFieldValues: KeepValidCustomFieldValuesFunction =
  (data: {
    definitions: Array<CustomFieldDefinition>;
    customFields: unknown;
  }): Record<string, unknown> => {
    if (!isPlainObject(data.customFields)) {
      return {};
    }

    const invalidFieldNames: Set<string> = new Set<string>(
      validateCustomFieldValues({
        definitions: data.definitions,
        customFields: data.customFields,
        storedCustomFields: {},
      }).map((error: CustomFieldValueValidationError) => {
        return error.fieldName;
      }),
    );

    const result: Record<string, unknown> = {};

    for (const [fieldName, value] of Object.entries(data.customFields)) {
      if (!invalidFieldNames.has(fieldName)) {
        result[fieldName] = value;
      }
    }

    return result;
  };
