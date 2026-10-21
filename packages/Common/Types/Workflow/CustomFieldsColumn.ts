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

export type HasCustomFieldsColumnFunction = (model: BaseModel) => boolean;

export const hasCustomFieldsColumn: HasCustomFieldsColumnFunction = (
  model: BaseModel,
): boolean => {
  const metadata: TableColumnMetadata | undefined =
    model.getTableColumnMetadata(CUSTOM_FIELDS_COLUMN);

  return metadata?.type === TableColumnType.JSON;
};
