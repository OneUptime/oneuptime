import { describe, expect, test } from "@jest/globals";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import Dictionary from "../../../Types/Dictionary";
import {
  isSetAtCreate,
  SET_AT_CREATE_BY_TABLE,
  SET_AT_CREATE_IN_EVERY_TABLE,
} from "../../../Utils/DeveloperDocs/SetAtCreate";
import { ModelSchema } from "../../../Utils/Schema/ModelSchema";

/*
 * The columns OneUptime sets when a record is made and never again
 * (SetAtCreate.ts) plan as their value in state on an update, where every
 * other read-only column plans "(known after apply)". A column listed that
 * did change after create would fail an apply with "Provider produced
 * inconsistent result after apply", so each one is held to its model: it
 * exists, and no update the API takes can write it.
 */

type ModelType = new () => DatabaseBaseModel;

interface Model {
  modelType: ModelType;
  model: DatabaseBaseModel;
}

function modelsByTable(): Map<string, Model> {
  const models: Map<string, Model> = new Map();
  for (const modelType of AllModelTypes as Array<ModelType>) {
    const model: DatabaseBaseModel = new modelType();
    if (model.tableName) {
      models.set(model.tableName, { modelType, model });
    }
  }
  return models;
}

// The columns an update the API takes may hold.
function updatableColumns(modelType: ModelType): Set<string> {
  const shape: Record<string, unknown> = (
    ModelSchema.getUpdateModelSchema({
      modelType,
      disableOpenApiSchema: true,
    }) as unknown as { shape: Record<string, unknown> }
  ).shape;
  return new Set(Object.keys(shape));
}

describe("columns set at create", () => {
  test("every column a table lists exists, and no update can write it", () => {
    const models: Map<string, Model> = modelsByTable();
    const problems: Array<string> = [];

    for (const [table, columns] of Object.entries(SET_AT_CREATE_BY_TABLE)) {
      const found: Model | undefined = models.get(table);
      if (!found) {
        problems.push(`${table}: no such model`);
        continue;
      }
      const tableColumns: Dictionary<TableColumnMetadata> = getTableColumns(
        found.model,
      );
      const updatable: Set<string> = updatableColumns(found.modelType);
      for (const column of columns) {
        if (!tableColumns[column]) {
          problems.push(`${table}.${column}: no such column`);
        } else if (updatable.has(column)) {
          problems.push(`${table}.${column}: an update may write it`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  test("the columns every table has are never written by an update", () => {
    const problems: Array<string> = [];

    for (const { modelType, model } of modelsByTable().values()) {
      const tableColumns: Dictionary<TableColumnMetadata> =
        getTableColumns(model);
      const updatable: Set<string> = updatableColumns(modelType);
      for (const column of SET_AT_CREATE_IN_EVERY_TABLE) {
        if (!tableColumns[column] || !updatable.has(column)) {
          continue;
        }
        /*
         * A slug a model lets callers write is theirs to change, and the
         * provider plans it from the configuration, as Optional: only a
         * read-only one is set at create.
         */
        if (column === "slug") {
          continue;
        }
        problems.push(`${model.tableName}.${column}: an update may write it`);
      }
    }

    expect(problems).toEqual([]);
  });

  test("a read-only slug is made from its record at create", () => {
    const problems: Array<string> = [];

    for (const { modelType, model } of modelsByTable().values()) {
      if (
        !getTableColumns(model)["slug"] ||
        updatableColumns(modelType).has("slug")
      ) {
        continue;
      }
      // DatabaseService.generateSlug fills it in, on create only.
      if (model.getSaveSlugToColumn() !== "slug" || !model.getSlugifyColumn()) {
        problems.push(`${model.tableName}: a read-only slug nobody makes`);
      }
    }

    expect(problems).toEqual([]);
  });

  test("isSetAtCreate", () => {
    expect(isSetAtCreate("Monitor", "createdAt")).toBe(true);
    expect(isSetAtCreate("Monitor", "slug")).toBe(true);
    expect(isSetAtCreate("Team", "isTeamEditable")).toBe(true);
    expect(isSetAtCreate("Incident", "incidentNumberWithPrefix")).toBe(true);

    // What changes as a record lives stays "(known after apply)".
    expect(isSetAtCreate("Monitor", "updatedAt")).toBe(false);
    expect(isSetAtCreate("TeamMember", "hasAcceptedInvitation")).toBe(false);
    expect(isSetAtCreate("MonitorOwnerUser", "isOwnerNotified")).toBe(false);
    expect(isSetAtCreate("Monitor", "archivedAt")).toBe(false);
    // A table's own columns are its own.
    expect(isSetAtCreate("Monitor", "isTeamEditable")).toBe(false);
  });
});
