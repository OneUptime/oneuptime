import Field, { FormFieldCollapsibleSection } from "../Types/Field";
import FormFieldSchemaType from "../Types/FormFieldSchemaType";
import FormValues from "../Types/FormValues";
import { getPeoplePickerValueKeys } from "../../PeoplePicker/PeoplePickerTypes";

/*
 * "Advanced" in a form: the options most people never need, folded under one
 * header so the form shows only what matters. The maintainer, on the Create
 * Custom Field form: "options like 'Show on create' and stuff ... should be
 * hidden in the advanced section of the page. There should be an advanced
 * section, which should be collapsed by default. You can expand it and click
 * on those options."
 *
 * How to use it. Build the section once and hand the same one to every field
 * that goes in it, written one after another at the end of the list (or of
 * the step they are on):
 *
 *   const advanced = getAdvancedFormSection<MyModel>();
 *   formFields: [
 *     name, description,
 *     { ...rarelyUsedToggle, collapsibleSection: advanced },
 *     { ...anotherOption, collapsibleSection: advanced },
 *   ]
 *
 * What the user gets (BasicForm, CollapsibleFormSection):
 *   - the section starts folded, on Create and on Edit alike;
 *   - while folded it says "Configured" on its header when any field in it
 *     holds a value other than empty or its default, so an Edit form never
 *     hides that something is set;
 *   - it opens by itself when a field in it fails validation;
 *   - folded fields keep their values, are skipped by Tab, and are still
 *     submitted.
 *
 * Works inside a stepped form too: give the fields the step's stepId as
 * well. Tests/Helpers/FormStepsScan counts a section as one row when it
 * judges whether a form or a step is too long, so options moved under
 * Advanced stop counting against the LongFormStepsGuard and
 * OverloadedFormStepsGuard limits.
 */

export const ADVANCED_FORM_SECTION_ID: string = "advanced";

export const ADVANCED_FORM_SECTION_TITLE: string = "Advanced";

export interface AdvancedFormSectionOptions<TEntity> {
  /*
   * Only needed when one step has two Advanced sections that must not be
   * merged; fields with the same id that are next to each other are one
   * section.
   */
  id?: string | undefined;
  // One short line, shown under the title while the section is open.
  description?: string | undefined;
  /*
   * When "set" means something else than "any field in the section holds a
   * value other than empty or its default".
   */
  isConfigured?: ((values: FormValues<TEntity>) => boolean) | undefined;
  /*
   * What a default folded in here will do, in plain words under the title
   * while the section is folded (FormFieldCollapsibleSection.getSummary) -
   * for a default people should know about without opening Advanced, such
   * as "The key expires a year from today." Whole English sentences in
   * translationKey(). Return nothing to fall back to the "Configured" badge.
   */
  getSummary?:
    | ((values: FormValues<TEntity>) => Array<string> | undefined)
    | undefined;
}

export type GetAdvancedFormSectionFunction = <TEntity>(
  options?: AdvancedFormSectionOptions<TEntity>,
) => FormFieldCollapsibleSection<TEntity>;

export const getAdvancedFormSection: GetAdvancedFormSectionFunction = <TEntity>(
  options?: AdvancedFormSectionOptions<TEntity>,
): FormFieldCollapsibleSection<TEntity> => {
  const section: FormFieldCollapsibleSection<TEntity> = {
    id: options?.id || ADVANCED_FORM_SECTION_ID,
    title: ADVANCED_FORM_SECTION_TITLE,
    // Folded on Edit too: "Configured" on the header says something is set.
    openWhenConfigured: false,
  };

  if (options?.description) {
    section.description = options.description;
  }

  if (options?.isConfigured) {
    section.isConfigured = options.isConfigured;
  }

  if (options?.getSummary) {
    section.getSummary = options.getSummary;
  }

  return section;
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

type NormalizeValueFunction = (value: unknown) => unknown;

/*
 * A dropdown can hold the option it was picked as ({ label, value }) rather
 * than its value; the value is what is compared.
 */
const normalizeValue: NormalizeValueFunction = (value: unknown): unknown => {
  if (
    isPlainObject(value) &&
    Object.prototype.hasOwnProperty.call(value, "value") &&
    Object.prototype.hasOwnProperty.call(value, "label")
  ) {
    return value["value"];
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  return value;
};

type IsEmptyValueFunction = (value: unknown) => boolean;

const isEmptyValue: IsEmptyValueFunction = (value: unknown): boolean => {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim().length === 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === "number") {
    return Number.isNaN(value);
  }

  if (isPlainObject(value)) {
    return Object.keys(value).length === 0;
  }

  return false;
};

export type IsFormFieldValueSetFunction = <TEntity>(
  field: Field<TEntity>,
  values: FormValues<TEntity>,
) => boolean;

/**
 * Whether a field holds something of the user's: a value other than empty
 * or the field's default. A switch is set when it is not in its default
 * position (off, unless its default is on); a people picker when anyone is
 * picked. What a folded section's "Configured" is worked out from.
 */
export const isFormFieldValueSet: IsFormFieldValueSetFunction = <TEntity>(
  field: Field<TEntity>,
  values: FormValues<TEntity>,
): boolean => {
  const formValues: Record<string, unknown> = (values || {}) as Record<
    string,
    unknown
  >;

  // A people picker keeps its picks in form values of its own.
  if (
    field.fieldType === FormFieldSchemaType.PeoplePicker &&
    field.peoplePicker
  ) {
    return getPeoplePickerValueKeys(field.peoplePicker).some(
      (valueKey: string): boolean => {
        return !isEmptyValue(formValues[valueKey]);
      },
    );
  }

  const fieldName: string | undefined =
    field.overrideFieldKey || Object.keys(field.field || {})[0];

  if (!fieldName) {
    return false;
  }

  const value: unknown = normalizeValue(formValues[fieldName]);

  let defaultValue: unknown = field.defaultValue;

  if (defaultValue === undefined && field.getDefaultValue) {
    defaultValue = field.getDefaultValue(values);
  }

  defaultValue = normalizeValue(defaultValue);

  // Never touched: whatever it is, it is what the form starts with.
  if (value === undefined || value === null) {
    return false;
  }

  const isSwitch: boolean =
    field.fieldType === FormFieldSchemaType.Toggle ||
    field.fieldType === FormFieldSchemaType.Checkbox;

  if (isSwitch || typeof value === "boolean") {
    // Off unless said otherwise: BasicForm submits an untouched switch as off.
    return Boolean(value) !== (defaultValue === true);
  }

  if (isEmptyValue(value)) {
    return false;
  }

  if (defaultValue !== undefined && defaultValue !== null) {
    return value !== defaultValue;
  }

  return true;
};

export type IsFormSectionConfiguredFunction = <TEntity>(data: {
  section: FormFieldCollapsibleSection<TEntity>;
  // The section's fields the form shows right now.
  fields: Array<Field<TEntity>>;
  values: FormValues<TEntity>;
}) => boolean;

/**
 * Whether a folded section should say "Configured": what its own
 * isConfigured says, or - without one - whether any of its fields is set.
 */
export const isFormSectionConfigured: IsFormSectionConfiguredFunction = <
  TEntity,
>(data: {
  section: FormFieldCollapsibleSection<TEntity>;
  fields: Array<Field<TEntity>>;
  values: FormValues<TEntity>;
}): boolean => {
  if (data.section.isConfigured) {
    return data.section.isConfigured(data.values);
  }

  return data.fields.some((field: Field<TEntity>): boolean => {
    return isFormFieldValueSet(field, data.values);
  });
};
