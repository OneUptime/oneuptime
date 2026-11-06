import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "../Database/TableColumn";
import TableColumnType from "../Database/TableColumnType";

/*
 * Every model with custom fields keeps their values in one JSON column of
 * this name, keyed by each field's name. The workflow Update steps merge what
 * they write into it rather than replacing it (see CustomFieldsArgument in
 * Server/Types/Workflow/Components/BaseModel), and their help says so.
 */
export const CUSTOM_FIELDS_COLUMN: string = "customFields";

/*
 * https://github.com/OneUptime/oneuptime/issues/5942 - to the person building a
 * workflow each custom field is a field of the record, so the builder lists it
 * as one. It is named "customFields.<its name>": in a row of the record editor
 * and the query builder, which write it under this column, and in Fields to
 * watch, which stores it as it is. A reference to it reads the same path.
 */
export const CUSTOM_FIELD_COLUMN_PREFIX: string = `${CUSTOM_FIELDS_COLUMN}.`;

export type GetCustomFieldColumnIdFunction = (name: string) => string;

export const getCustomFieldColumnId: GetCustomFieldColumnIdFunction = (
  name: string,
): string => {
  return `${CUSTOM_FIELD_COLUMN_PREFIX}${name}`;
};

export type GetCustomFieldNameFunction = (columnId: string) => string | null;

// The custom field a column ID names, or null for any other column.
export const getCustomFieldName: GetCustomFieldNameFunction = (
  columnId: string,
): string | null => {
  return columnId.startsWith(CUSTOM_FIELD_COLUMN_PREFIX) &&
    columnId.length > CUSTOM_FIELD_COLUMN_PREFIX.length
    ? columnId.slice(CUSTOM_FIELD_COLUMN_PREFIX.length)
    : null;
};

/*
 * Where an On Update event says which custom fields it changed, beside
 * updatedFields: the names, which watching one of them reads.
 */
export const UPDATED_CUSTOM_FIELDS_KEY: string = "updatedCustomFields";

export type HasCustomFieldsColumnFunction = (model: BaseModel) => boolean;

export const hasCustomFieldsColumn: HasCustomFieldsColumnFunction = (
  model: BaseModel,
): boolean => {
  const metadata: TableColumnMetadata | undefined =
    model.getTableColumnMetadata(CUSTOM_FIELDS_COLUMN);

  return metadata?.type === TableColumnType.JSON;
};
