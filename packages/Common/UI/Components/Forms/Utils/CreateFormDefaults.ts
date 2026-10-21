import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Color from "../../../../Types/Color";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { parseColor } from "../../../../Utils/ColorContrast";
import { pickDistinctColor } from "../../../../Utils/DistinctColor";
import {
  CardSelectOption,
  CardSelectOptionGroup,
} from "../../CardSelect/CardSelect";
import { DropdownOption, DropdownOptionGroup } from "../../Dropdown/Dropdown";
import Field from "../Types/Field";
import FormFieldSchemaType from "../Types/FormFieldSchemaType";

/*
 * What a Create form starts from: the model's own column defaults.
 *
 * What a create form shows before anyone touches it is what the server would
 * store if the field were left out. It did not. A rule created through the
 * API starts enabled - its isEnabled column defaults to true - while the
 * same rule created from its dashboard form was saved disabled: the form drew
 * its Enabled switch off, because nothing told it otherwise, and BasicForm
 * sends a switch nobody touched as off. "Notify Owners" on every owner rule,
 * a monitor probe's Enabled, a mail server's Use SSL / TLS and every other
 * switch whose column defaults to on went the same way - quietly, with a red
 * "Disabled" in the table as the only sign. A checkbox did the opposite: it
 * was drawn unticked while the server, sent nothing, stored its default of
 * on.
 *
 * So ModelForm hands every field of a Create form its column's default as
 * the field's defaultValue (getCreateFormColumnDefault, below) when the field
 * does not say otherwise. BasicForm then fills the field in with it, draws it
 * from the first paint, sends it untouched - and a folded section that holds
 * it does not show a value nobody changed as set, because the default is
 * what isFormFieldValueSet compares with.
 *
 * What still wins, in order: a value the form starts with (a table's
 * createInitialValues, a form's initialValues), then a field's own
 * defaultValue or getDefaultValue - a deliberate `defaultValue: false` keeps a
 * switch off whatever its column says. Edit forms start from nothing but
 * the record, as it is: they get the column's default only as the field's
 * columnDefaultValue, which a folded section compares with and no field
 * starts from.
 *
 * Only plain values the field can show are taken: a boolean for a switch, a
 * choice its options hold for a dropdown, radio group or card picker, a number
 * for a number box, a colour for a colour picker. A JSON default, a text
 * default, or a field that writes no real column (an overrideField, a value
 * sent as misc data, a form-only helper) is left as it was.
 *
 * A colour is the one thing a Create form starts with that the server would
 * not store on its own. A label, a state, a severity, a monitor status, an
 * incident role and a bar colour rule cannot be saved without one, and none
 * of their colour columns has a default - so their forms opened on an empty
 * picker and refused to save until a colour was chosen: a decision with no
 * wrong answer, asked first. Now such a field starts with a colour already
 * picked (getCreateFormColorDefault, below): one from OneUptime's palette
 * that the records listed beside the form - the rows of the table it was
 * opened from - do not use yet (Utils/DistinctColor). It stays a field: any
 * colour can be picked instead. Edit forms are not touched.
 */

export type CreateFormColumnDefault = boolean | number | string;

const SWITCH_FIELD_TYPES: ReadonlySet<FormFieldSchemaType> =
  new Set<FormFieldSchemaType>([
    FormFieldSchemaType.Toggle,
    FormFieldSchemaType.Checkbox,
  ]);

const CHOICE_FIELD_TYPES: ReadonlySet<FormFieldSchemaType> =
  new Set<FormFieldSchemaType>([
    FormFieldSchemaType.Dropdown,
    FormFieldSchemaType.RadioButton,
    FormFieldSchemaType.CardSelect,
  ]);

const NUMBER_FIELD_TYPES: ReadonlySet<FormFieldSchemaType> =
  new Set<FormFieldSchemaType>([
    FormFieldSchemaType.Number,
    FormFieldSchemaType.PositiveNumber,
    FormFieldSchemaType.Port,
  ]);

/*
 * A field as ModelForm takes it: ModelField adds overrideField, a column the
 * field is checked against without writing it.
 */
export type CreateFormField<TEntity> = Field<TEntity> & {
  overrideField?: { [field: string]: true } | undefined;
};

type ChoiceValuesFunction = <TEntity>(
  field: Field<TEntity>,
) => Array<unknown> | null;

/*
 * The values a choice field offers when its options are written into the
 * field, or null when they are not known up front (fetched later, or listed
 * from another model).
 */
const getChoiceValues: ChoiceValuesFunction = <TEntity>(
  field: Field<TEntity>,
): Array<unknown> | null => {
  if (field.fieldType === FormFieldSchemaType.RadioButton) {
    return field.radioButtonOptions && field.radioButtonOptions.length > 0
      ? field.radioButtonOptions.map((option: { value: string }): string => {
          return option.value;
        })
      : null;
  }

  const options:
    | Array<DropdownOption | DropdownOptionGroup>
    | Array<CardSelectOption | CardSelectOptionGroup>
    | undefined =
    field.fieldType === FormFieldSchemaType.CardSelect
      ? field.cardSelectOptions
      : field.dropdownOptions;

  if (!options || options.length === 0) {
    return null;
  }

  return (options as Array<unknown>).flatMap(
    (option: unknown): Array<unknown> => {
      const group: { options?: unknown } = option as { options?: unknown };

      if (Array.isArray(group.options)) {
        return (group.options as Array<{ value: unknown }>).map(
          (inner: { value: unknown }): unknown => {
            return inner.value;
          },
        );
      }

      return [(option as { value: unknown }).value];
    },
  );
};

interface WrittenColumn {
  name: string;
  metadata: TableColumnMetadata;
}

type GetWrittenColumnFunction = <TEntity>(
  model: BaseModel,
  field: CreateFormField<TEntity>,
) => WrittenColumn | undefined;

/*
 * The column a field writes, when the field leaves what it starts as to the
 * form: no defaultValue or getDefaultValue of its own, and a real column -
 * not an overrideField, a value sent as misc data under a key of its own, or
 * a form-only helper. Both defaults below start only such a field.
 */
const getWrittenColumn: GetWrittenColumnFunction = <TEntity>(
  model: BaseModel,
  field: CreateFormField<TEntity>,
): WrittenColumn | undefined => {
  // The field says for itself what it starts as.
  if (field.defaultValue !== undefined || field.getDefaultValue) {
    return undefined;
  }

  // Not a column this field writes.
  if (
    !field.field ||
    field.overrideField ||
    field.overrideFieldKey ||
    field.formOnly
  ) {
    return undefined;
  }

  const name: string | undefined = Object.keys(field.field)[0];

  if (!name || !field.fieldType) {
    return undefined;
  }

  const metadata: TableColumnMetadata | undefined =
    model.getTableColumnMetadata(name);

  return metadata ? { name, metadata } : undefined;
};

type GetColorColumnDefaultFunction = (
  metadata: TableColumnMetadata,
) => string | undefined;

// A colour column's own default, as the picker writes a colour, if it is one.
const getColorColumnDefault: GetColorColumnDefaultFunction = (
  metadata: TableColumnMetadata,
): string | undefined => {
  const columnDefault: unknown = metadata.defaultValue;

  const color: string | null =
    columnDefault instanceof Color || typeof columnDefault === "string"
      ? columnDefault.toString().trim().toLowerCase()
      : null;

  return color && parseColor(color) ? color : undefined;
};

/**
 * The column default a field of a Create form starts with, or undefined when
 * the field keeps starting as it always did (see the note above).
 */
export function getCreateFormColumnDefault<TEntity>(
  model: BaseModel,
  field: CreateFormField<TEntity>,
): CreateFormColumnDefault | undefined {
  const column: WrittenColumn | undefined = getWrittenColumn(model, field);

  if (!column || !field.fieldType) {
    return undefined;
  }

  const columnDefault: unknown = column.metadata.defaultValue;

  if (SWITCH_FIELD_TYPES.has(field.fieldType)) {
    return typeof columnDefault === "boolean" ? columnDefault : undefined;
  }

  if (NUMBER_FIELD_TYPES.has(field.fieldType)) {
    return typeof columnDefault === "number" && Number.isFinite(columnDefault)
      ? columnDefault
      : undefined;
  }

  if (CHOICE_FIELD_TYPES.has(field.fieldType)) {
    if (
      !(typeof columnDefault === "string" && columnDefault.length > 0) &&
      !(typeof columnDefault === "number" && Number.isFinite(columnDefault))
    ) {
      return undefined;
    }

    // A default the field cannot show would be sent without being seen.
    const choices: Array<unknown> | null = getChoiceValues(field);

    if (choices && !choices.includes(columnDefault)) {
      return undefined;
    }

    return columnDefault;
  }

  // Only a default the picker can show: a colour.
  if (field.fieldType === FormFieldSchemaType.Color) {
    return getColorColumnDefault(column.metadata);
  }

  return undefined;
}

export type ColorInUse = Color | string | null | undefined;

/**
 * The colours `items` hold in the column a colour field writes, for
 * getCreateFormColorDefault to stay clear of. Items that do not hold the
 * column (a table that did not select it) give nothing.
 */
export function getColorsInUse<TEntity>(
  field: CreateFormField<TEntity>,
  items: ReadonlyArray<unknown> | undefined,
): Array<ColorInUse> {
  const columnName: string | undefined = field.field
    ? Object.keys(field.field)[0]
    : undefined;

  if (!columnName || !items) {
    return [];
  }

  return items.map((item: unknown): ColorInUse => {
    if (!item || typeof item !== "object") {
      return undefined;
    }

    const value: unknown = (item as Record<string, unknown>)[columnName];

    return value instanceof Color || typeof value === "string"
      ? value
      : undefined;
  });
}

/**
 * The colour a colour field of a Create form starts with, as text
 * ("#6366f1"), or undefined when the field starts as it always did.
 *
 * Picked for a field that writes a colour column the record cannot be saved
 * without (the column is required, or the field always is) and that says
 * nothing about what it starts as - no defaultValue or getDefaultValue of its
 * own, and no column default, which getCreateFormColumnDefault gives it
 * instead. The colour is the first of the palette that none of `colorsInUse`
 * looks like (Utils/DistinctColor): the colours of the records beside it.
 */
export function getCreateFormColorDefault<TEntity>(
  model: BaseModel,
  field: CreateFormField<TEntity>,
  colorsInUse?: ReadonlyArray<ColorInUse>,
): string | undefined {
  if (field.fieldType !== FormFieldSchemaType.Color) {
    return undefined;
  }

  const column: WrittenColumn | undefined = getWrittenColumn(model, field);

  if (!column || column.metadata.type !== TableColumnType.Color) {
    return undefined;
  }

  // A column with a default of its own starts from it.
  if (getColorColumnDefault(column.metadata) !== undefined) {
    return undefined;
  }

  /*
   * A colour the record can go without is left empty: empty means no
   * colour, or one the server picks itself (a service's). So is one the
   * form asks for only sometimes (a required function): the colour would
   * be sent when it is not asked for.
   */
  if (!column.metadata.required && field.required !== true) {
    return undefined;
  }

  return pickDistinctColor(colorsInUse).toString();
}
