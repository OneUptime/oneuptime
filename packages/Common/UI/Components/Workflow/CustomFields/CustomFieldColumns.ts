/*
 * A RECORD'S CUSTOM FIELDS, AS FIELDS OF THE RECORD.
 *
 * https://github.com/OneUptime/oneuptime/issues/5942 - "I have a custom field
 * in the incident model, but I do not see that custom field when I configure a
 * workflow." A model has one column for all of its custom fields, so the
 * builder's lists showed one row, Custom Fields, which could only be set with
 * Edit as JSON, by someone who knew each field's exact name.
 *
 * What a project's custom fields are called and what they take are rows of a
 * definition table, so they are read from there (UseCustomFields) and turned
 * into columns here. From then on the record editor, the query builder, the
 * field lists and the value picker treat each one as any other field: its own
 * row, its own control, its own place in a search. What a step writes and reads
 * stays the customFields column it always was
 * (ColumnEditor/ColumnRowSerialization).
 *
 * Free of React and of the API client, so every rule is tested on its own.
 */

import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import {
  CUSTOM_FIELDS_COLUMN,
  getCustomFieldColumnId,
} from "../../../../Types/Workflow/CustomFieldsColumn";
import { translationKey } from "../../../Utils/TranslateTemplate";
import { ModelSchemaColumn, ModelSchemaCustomField } from "../ModelSchema";

export const CustomFieldRowCopy: {
  readonly chip: string;
  readonly noSuchField: string;
  readonly noneYet: string;
} = {
  chip: translationKey("Custom field"),
  noSuchField: translationKey(
    "This project has no custom field with this name.",
  ),
  noneYet: translationKey(
    "This project has no custom fields for these records yet.",
  ),
};

export interface WorkflowCustomField extends ModelSchemaCustomField {
  description?: string | undefined;
}

/*
 * The column type a kind of custom field reads as, for whatever goes by a
 * column's type: what a search finds, how a field list words it. What it is
 * filled in with goes by the kind itself (ColumnControl.CUSTOM_FIELD_CONTROLS).
 */
const COLUMN_TYPES: Record<CustomFieldType, TableColumnType> = {
  [CustomFieldType.Text]: TableColumnType.ShortText,
  [CustomFieldType.LongText]: TableColumnType.LongText,
  [CustomFieldType.Markdown]: TableColumnType.Markdown,
  [CustomFieldType.Number]: TableColumnType.Number,
  [CustomFieldType.Boolean]: TableColumnType.Boolean,
  [CustomFieldType.Date]: TableColumnType.Date,
  [CustomFieldType.DateTime]: TableColumnType.Date,
  [CustomFieldType.Dropdown]: TableColumnType.ShortText,
  [CustomFieldType.MultiSelectDropdown]: TableColumnType.Array,
  [CustomFieldType.File]: TableColumnType.File,
  [CustomFieldType.MultipleFiles]: TableColumnType.File,
};

type ToCustomFieldColumnFunction = (
  field: WorkflowCustomField,
  // The record's customFields column, which says who may write it.
  customFieldsColumn: ModelSchemaColumn,
) => ModelSchemaColumn;

/**
 * One custom field as a column. It may be written, on a create and on an
 * update, as far as the column all of them live in may.
 */
export const toCustomFieldColumn: ToCustomFieldColumnFunction = (
  field: WorkflowCustomField,
  customFieldsColumn: ModelSchemaColumn,
): ModelSchemaColumn => {
  return {
    id: getCustomFieldColumnId(field.name),
    title: field.name,
    description: field.description,
    type: field.customFieldType
      ? COLUMN_TYPES[field.customFieldType]
      : TableColumnType.ShortText,
    isRelation: false,
    required: false,
    hasDefault: false,
    isTenantColumn: false,
    isSystemColumn: false,
    canCreate: customFieldsColumn.canCreate,
    canUpdate: customFieldsColumn.canUpdate,
    customField: {
      name: field.name,
      customFieldType: field.customFieldType,
      options: field.options,
    },
  } as ModelSchemaColumn;
};

type WithCustomFieldColumnsFunction = (
  columns: Array<ModelSchemaColumn>,
  fields: Array<WorkflowCustomField>,
) => Array<ModelSchemaColumn>;

/**
 * A model's columns with its custom fields among them. A model with no
 * customFields column - or a read that may not see it - has none to add.
 */
export const withCustomFieldColumns: WithCustomFieldColumnsFunction = (
  columns: Array<ModelSchemaColumn>,
  fields: Array<WorkflowCustomField>,
): Array<ModelSchemaColumn> => {
  const customFieldsColumn: ModelSchemaColumn | undefined = columns.find(
    (column: ModelSchemaColumn): boolean => {
      return column.id === CUSTOM_FIELDS_COLUMN;
    },
  );

  if (!customFieldsColumn || fields.length === 0) {
    return columns;
  }

  return [
    ...columns,
    ...fields.map((field: WorkflowCustomField): ModelSchemaColumn => {
      return toCustomFieldColumn(field, customFieldsColumn);
    }),
  ];
};
