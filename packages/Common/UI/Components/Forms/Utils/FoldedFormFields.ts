import OneUptimeDate from "../../../../Types/Date";
import {
  FOLDED_SECTION_OFF,
  FOLDED_SECTION_ON,
  FoldedSectionItem,
} from "../../FoldedSection/FoldedSectionItem";
import {
  readPeoplePickerFormValue,
  PeoplePickerValue,
} from "../../PeoplePicker/PeoplePickerTypes";
import Field from "../Types/Field";
import FormFieldSchemaType from "../Types/FormFieldSchemaType";
import FormValues from "../Types/FormValues";
import { isFormFieldValueSet, normalizeFormValue } from "./AdvancedFormSection";

/*
 * What a folded form section lists on its header (FoldedSection): one item
 * per field it holds, by the field's title, and - for a field that is set -
 * what it is set to, in a few words. "Declared At · Initial State ·
 * Labels: 2 · Private Incident: On".
 *
 * A value is shown only where it is short and safe to show:
 *   - a switch says On or Off;
 *   - a pick from a list says the option's label;
 *   - a list of picks (labels, owners, files) says how many, and so does a
 *     set of key-value pairs (a monitor's attribute filters);
 *   - a number, a date or a short line of text says itself, cut to a few
 *     words;
 *   - a custom editor that keeps what it edits elsewhere says what it is
 *     set to itself, already translated (Field.getFoldedValue: "Reopen
 *     recently resolved episodes: 30 minutes");
 *   - a secret, a paragraph, code, a colour or any other custom editor says
 *     nothing beyond being set - the chip has the field's name only.
 */

export const FOLDED_FIELD_VALUE_MAX_LENGTH: number = 32;

// A secret is never shown, whatever its field type says.
const SECRET_FIELD: RegExp =
  /(secret|password|passphrase|token|private ?key|api ?key|credential)/i;

const TEXT_TYPES: ReadonlyArray<FormFieldSchemaType> = [
  FormFieldSchemaType.Text,
  FormFieldSchemaType.Name,
  FormFieldSchemaType.Email,
  FormFieldSchemaType.URL,
  FormFieldSchemaType.Hostname,
  FormFieldSchemaType.Domain,
  FormFieldSchemaType.Route,
  FormFieldSchemaType.Phone,
  FormFieldSchemaType.Time,
];

const NUMBER_TYPES: ReadonlyArray<FormFieldSchemaType> = [
  FormFieldSchemaType.Number,
  FormFieldSchemaType.PositiveNumber,
  FormFieldSchemaType.Port,
];

const PICK_TYPES: ReadonlyArray<FormFieldSchemaType> = [
  FormFieldSchemaType.Dropdown,
  FormFieldSchemaType.RadioButton,
  FormFieldSchemaType.CardSelect,
  FormFieldSchemaType.OptionChooserButton,
];

export interface FoldedFieldValue {
  value: string;
  // An English word to look up ("On"), or an option's English label.
  translateValue: boolean;
}

type GetFieldNameFunction = <TEntity>(field: Field<TEntity>) => string;

const getFieldName: GetFieldNameFunction = <TEntity>(
  field: Field<TEntity>,
): string => {
  return (
    field.overrideFieldKey ||
    Object.keys(field.field || {})[0] ||
    field.name ||
    field.title ||
    ""
  );
};

type ShortenFunction = (text: string) => string;

// One line, cut on a word where it can be, with an ellipsis.
const shorten: ShortenFunction = (text: string): string => {
  const oneLine: string = text.replace(/\s+/g, " ").trim();

  if (oneLine.length <= FOLDED_FIELD_VALUE_MAX_LENGTH) {
    return oneLine;
  }

  const cut: string = oneLine.slice(0, FOLDED_FIELD_VALUE_MAX_LENGTH - 1);
  const lastSpace: number = cut.lastIndexOf(" ");

  return `${(lastSpace > FOLDED_FIELD_VALUE_MAX_LENGTH / 2
    ? cut.slice(0, lastSpace)
    : cut
  ).trimEnd()}…`;
};

type FindOptionLabelFunction = <TEntity>(
  field: Field<TEntity>,
  value: unknown,
) => string | undefined;

// The label of the option a pick field holds, from whichever list it offers.
const findOptionLabel: FindOptionLabelFunction = <TEntity>(
  field: Field<TEntity>,
  value: unknown,
): string | undefined => {
  const wanted: string = String(value);

  for (const option of field.dropdownOptions || []) {
    if ("options" in option && Array.isArray(option.options)) {
      for (const inner of option.options) {
        if (String(inner.value) === wanted) {
          return inner.label;
        }
      }
    } else if ("value" in option && String(option.value) === wanted) {
      return option.label;
    }
  }

  for (const option of field.cardSelectOptions || []) {
    if ("options" in option && Array.isArray(option.options)) {
      for (const inner of option.options) {
        if (inner.value === wanted) {
          return inner.title;
        }
      }
    } else if ("value" in option && option.value === wanted) {
      return option.title;
    }
  }

  for (const option of field.radioButtonOptions || []) {
    if (option.value === wanted) {
      return option.title;
    }
  }

  return undefined;
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

export type GetFoldedFieldValueFunction = <TEntity>(
  field: Field<TEntity>,
  values: FormValues<TEntity>,
) => FoldedFieldValue | undefined;

/**
 * What a set field holds, in a few words, for its chip on a folded
 * header - or nothing, where the value is not one to show (see above).
 */
export const getFoldedFieldValue: GetFoldedFieldValueFunction = <TEntity>(
  field: Field<TEntity>,
  values: FormValues<TEntity>,
): FoldedFieldValue | undefined => {
  // Said by the field itself, from the values it edits, in the reader's words.
  if (field.getFoldedValue) {
    const said: string | null = field.getFoldedValue(values);

    return said && said.trim()
      ? { value: shorten(said), translateValue: false }
      : undefined;
  }

  const formValues: Record<string, unknown> = (values || {}) as Record<
    string,
    unknown
  >;

  if (
    field.fieldType === FormFieldSchemaType.PeoplePicker &&
    field.peoplePicker
  ) {
    const picks: PeoplePickerValue = readPeoplePickerFormValue(
      field.peoplePicker,
      formValues,
    );
    const count: number = Object.values(picks).reduce(
      (total: number, ids: Array<string> | undefined): number => {
        return total + (ids?.length || 0);
      },
      0,
    );

    return count > 0
      ? { value: String(count), translateValue: false }
      : undefined;
  }

  const fieldName: string = getFieldName(field);
  const rawValue: unknown = formValues[fieldName];

  if (SECRET_FIELD.test(fieldName) || SECRET_FIELD.test(field.title || "")) {
    return undefined;
  }

  if (
    field.fieldType === FormFieldSchemaType.Password ||
    field.fieldType === FormFieldSchemaType.EncryptedText
  ) {
    return undefined;
  }

  if (
    field.fieldType === FormFieldSchemaType.Toggle ||
    field.fieldType === FormFieldSchemaType.Checkbox ||
    typeof rawValue === "boolean"
  ) {
    return {
      value: rawValue ? FOLDED_SECTION_ON : FOLDED_SECTION_OFF,
      translateValue: true,
    };
  }

  if (Array.isArray(rawValue)) {
    return rawValue.length > 0
      ? { value: String(rawValue.length), translateValue: false }
      : undefined;
  }

  /*
   * Key-value pairs ("Filter by Attributes: 2") say how many, never what -
   * a value typed there can be anything.
   */
  if (field.fieldType === FormFieldSchemaType.Dictionary) {
    const pairCount: number = isPlainObject(rawValue)
      ? Object.keys(rawValue).length
      : 0;

    return pairCount > 0
      ? { value: String(pairCount), translateValue: false }
      : undefined;
  }

  if (field.fieldType && PICK_TYPES.includes(field.fieldType)) {
    if (
      isPlainObject(rawValue) &&
      typeof rawValue["label"] === "string" &&
      rawValue["label"].trim()
    ) {
      return { value: shorten(rawValue["label"]), translateValue: true };
    }

    const label: string | undefined = findOptionLabel(
      field,
      normalizeFormValue(rawValue),
    );

    return label ? { value: shorten(label), translateValue: true } : undefined;
  }

  if (
    field.fieldType === FormFieldSchemaType.Date ||
    field.fieldType === FormFieldSchemaType.DateTime
  ) {
    if (
      !(rawValue instanceof Date) &&
      (typeof rawValue !== "string" || !rawValue.trim())
    ) {
      return undefined;
    }

    try {
      const date: Date = OneUptimeDate.fromString(rawValue as string | Date);

      if (Number.isNaN(date.getTime())) {
        return undefined;
      }

      return {
        value:
          field.fieldType === FormFieldSchemaType.Date
            ? OneUptimeDate.getDateAsLocalFormattedString(date, true)
            : OneUptimeDate.getDateAsLocalShortDateTimeString(date),
        translateValue: false,
      };
    } catch {
      return undefined;
    }
  }

  if (field.fieldType && NUMBER_TYPES.includes(field.fieldType)) {
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      return { value: String(rawValue), translateValue: false };
    }

    if (typeof rawValue === "string" && rawValue.trim()) {
      return { value: shorten(rawValue), translateValue: false };
    }

    return undefined;
  }

  if (field.fieldType && TEXT_TYPES.includes(field.fieldType)) {
    if (typeof rawValue === "string" && rawValue.trim()) {
      return { value: shorten(rawValue), translateValue: false };
    }

    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      return { value: String(rawValue), translateValue: false };
    }
  }

  // A paragraph, code, a colour, a file, a custom editor: set, no value.
  return undefined;
};

export interface GetFoldedFormFieldItemsOptions {
  /*
   * Whether the section counts as configured (isFormSectionConfigured): a
   * section whose own isConfigured says it is not - an escalation rule
   * named after its level - shows nothing as set, whatever its fields hold.
   * True when left out.
   */
  isSectionConfigured?: boolean | undefined;
  // Only the set fields: a section whose title already says what it holds.
  onlySet?: boolean | undefined;
}

export type GetFoldedFormFieldItemsFunction = <TEntity>(
  fields: Array<Field<TEntity>>,
  values: FormValues<TEntity>,
  options?: GetFoldedFormFieldItemsOptions,
) => Array<FoldedSectionItem>;

/**
 * The items a folded form section lists on its header, in the order the
 * fields are written: every field the form shows that has a title, once.
 */
export const getFoldedFormFieldItems: GetFoldedFormFieldItemsFunction = <
  TEntity,
>(
  fields: Array<Field<TEntity>>,
  values: FormValues<TEntity>,
  options?: GetFoldedFormFieldItemsOptions,
): Array<FoldedSectionItem> => {
  const items: Array<FoldedSectionItem> = [];
  const seenTitles: Set<string> = new Set<string>();
  const isSectionConfigured: boolean = options?.isSectionConfigured !== false;

  for (const field of fields) {
    const title: string = (field.title || "").trim();

    if (!title || seenTitles.has(title.toLowerCase())) {
      continue;
    }

    seenTitles.add(title.toLowerCase());

    const isSet: boolean =
      isSectionConfigured && isFormFieldValueSet(field, values);

    if (options?.onlySet && !isSet) {
      continue;
    }

    const item: FoldedSectionItem = {
      key: getFieldName(field) || title,
      title: title,
      isSet: isSet,
    };

    if (isSet) {
      const value: FoldedFieldValue | undefined = getFoldedFieldValue(
        field,
        values,
      );

      if (value) {
        item.value = value.value;

        if (value.translateValue) {
          item.translateValue = true;
        }
      }
    }

    items.push(item);
  }

  return items;
};
