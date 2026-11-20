import AllModelTypes from "../../Models/DatabaseModels/Index";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  getColumnTitleKey,
  TableColumnMetadata,
} from "../../Types/Database/TableColumn";
import { getApiSingularName, getSingularNameSpellings } from "../ModelApiName";

/*
 * WHAT A FIELD AN AUDIT ENTRY RECORDED IS CALLED (#10290).
 *
 * An entry records each change by its column's key - `monitorStepsJson`,
 * `intervalInMinutes` - and the audit log drew that key, split into words in
 * English ("Monitor Steps Json"), in every language. The model the entry is
 * about names the column for people: its title, the word its forms and its
 * API reference use ("Monitor Steps", "Interval"). This finds that title,
 * as the key a front end looks it up by (getColumnTitleKey), from the type
 * the entry is stored under or the name it is shown by
 * (getSingularNameSpellings). Null for a field its model does not have - a
 * column since removed, a session entry's facts - which the log then draws
 * as it always did.
 */

let modelsByResourceType: Map<string, BaseModel> | null = null;

// Every model, by every name its entries are stored or shown under.
const getModelsByResourceType: () => Map<string, BaseModel> = (): Map<
  string,
  BaseModel
> => {
  if (modelsByResourceType) {
    return modelsByResourceType;
  }

  const models: Map<string, BaseModel> = new Map<string, BaseModel>();

  for (const modelType of AllModelTypes as Array<{ new (): BaseModel }>) {
    const model: BaseModel = new modelType();
    const resourceType: string = getApiSingularName(model);

    if (!resourceType) {
      continue;
    }

    for (const name of getSingularNameSpellings(resourceType)) {
      if (!models.has(name)) {
        models.set(name, model);
      }
    }
  }

  modelsByResourceType = models;

  return models;
};

export const getAuditLogFieldTitle: (
  resourceType: string | null | undefined,
  field: string | null | undefined,
) => string | null = (
  resourceType: string | null | undefined,
  field: string | null | undefined,
): string | null => {
  if (!resourceType || !field) {
    return null;
  }

  const model: BaseModel | undefined =
    getModelsByResourceType().get(resourceType);

  if (!model || !model.isTableColumn(field)) {
    return null;
  }

  const metadata: TableColumnMetadata | undefined =
    model.getTableColumnMetadata(field);

  return getColumnTitleKey(metadata) || null;
};
