/*
 * The custom fields a project gives a kind of record, read through the API as
 * the person editing the workflow. Where they may read none - or their plan
 * includes none, as custom fields take the Growth plan - the read is refused,
 * and the builder simply lists none: the JSON editor is still there, and values
 * stored under a name still show (ColumnEditor/ColumnFieldRow).
 */

import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { getModelTypeByName } from "../../../../Models/DatabaseModels/Index";
import Select from "../../../../Types/BaseDatabase/Select";
import Sort from "../../../../Types/BaseDatabase/Sort";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import {
  CustomFieldRecordKind,
  getCustomFieldRecordKind,
} from "../../../../Types/CustomField/CustomFieldRecordKinds";
import { parseCustomFieldDropdownOptions } from "../../../../Types/CustomField/CustomFieldDropdownOption";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import ModelAPI, { ListResult } from "../../../Utils/ModelAPI/ModelAPI";
import { WorkflowCustomField } from "./CustomFieldColumns";

export type LoadCustomFieldsFunction = (
  recordTableName: string,
) => Promise<Array<WorkflowCustomField>>;

export type HasCustomFieldsFunction = (recordTableName: string) => boolean;

// Whether records of this table have custom fields at all.
export const hasCustomFields: HasCustomFieldsFunction = (
  recordTableName: string,
): boolean => {
  return Boolean(getCustomFieldRecordKind(recordTableName));
};

/**
 * The fields of a table's records, in the order the project keeps them. Rejects
 * when the person may not read them.
 */
export const loadCustomFields: LoadCustomFieldsFunction = async (
  recordTableName: string,
): Promise<Array<WorkflowCustomField>> => {
  const kind: CustomFieldRecordKind | undefined =
    getCustomFieldRecordKind(recordTableName);

  const modelType: { new (): BaseModel } | null = kind
    ? getModelTypeByName(kind.definitionTableName)
    : null;

  if (!modelType) {
    return [];
  }

  const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
    modelType: modelType,
    query: {},
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    select: {
      name: true,
      description: true,
      customFieldType: true,
      dropdownOptions: true,
    } as Select<BaseModel>,
    sort: { sortOrder: SortOrder.Ascending } as Sort<BaseModel>,
  });

  const fields: Array<WorkflowCustomField> = [];

  for (const record of result.data) {
    const row: Record<string, unknown> = record as unknown as Record<
      string,
      unknown
    >;
    const name: unknown = row["name"];

    // A field with no name has nothing to be stored under.
    if (typeof name !== "string" || name.trim() === "") {
      continue;
    }

    fields.push({
      name: name,
      description:
        typeof row["description"] === "string"
          ? (row["description"] as string)
          : undefined,
      customFieldType: row["customFieldType"] as CustomFieldType | undefined,
      options: parseCustomFieldDropdownOptions(row["dropdownOptions"]),
    });
  }

  return fields;
};
