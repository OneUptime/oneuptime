import DatabaseModels from "Common/Models/DatabaseModels/Index";
import AnalyticsModels from "Common/Models/AnalyticsModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import { getTableColumns } from "Common/Types/Database/TableColumn";
import { ALWAYS_SELECTABLE_COLUMNS } from "Common/Types/HeldPermissions";
import Permission from "Common/Types/Permission";
import { JSONObject } from "Common/Types/JSON";

interface ColumnAccessControl {
  read?: Permission[];
}

function shouldIncludeField(
  columnName: string,
  accessControlForColumns: Record<string, ColumnAccessControl>,
): boolean {
  const accessControl: ColumnAccessControl | undefined =
    accessControlForColumns[columnName];

  return (
    !accessControl ||
    (accessControl.read !== undefined &&
      accessControl.read.length > 0 &&
      !(
        accessControl.read.length === 1 &&
        accessControl.read[0] === Permission.CurrentUser
      ))
  );
}

export function generateAllFieldsSelect(
  tableName: string,
  modelType: "database" | "analytics",
): JSONObject {
  try {
    if (modelType === "database") {
      const ModelClass: (new () => BaseModel) | undefined = DatabaseModels.find(
        (Model: new () => BaseModel): boolean => {
          try {
            const instance: BaseModel = new Model();
            return instance.tableName === tableName;
          } catch {
            return false;
          }
        },
      );

      if (!ModelClass) {
        return getDefaultSelect();
      }

      const modelInstance: BaseModel = new ModelClass();
      const tableColumns: Record<string, unknown> =
        getTableColumns(modelInstance);
      const columnNames: string[] = Object.keys(tableColumns);

      if (columnNames.length === 0) {
        return getDefaultSelect();
      }

      const accessControlForColumns: Record<string, ColumnAccessControl> =
        (
          modelInstance as unknown as {
            getColumnAccessControlForAllColumns?: () => Record<
              string,
              ColumnAccessControl
            >;
          }
        ).getColumnAccessControlForAllColumns?.() || {};

      const selectObject: JSONObject = {};
      for (const columnName of columnNames) {
        if (shouldIncludeField(columnName, accessControlForColumns)) {
          selectObject[columnName] = true;
        }
      }

      if (Object.keys(selectObject).length === 0) {
        return getDefaultSelect();
      }

      return selectObject;
    }

    if (modelType === "analytics") {
      const ModelClass: (new () => AnalyticsBaseModel) | undefined =
        AnalyticsModels.find((Model: new () => AnalyticsBaseModel): boolean => {
          try {
            const instance: AnalyticsBaseModel = new Model();
            return instance.tableName === tableName;
          } catch {
            return false;
          }
        });

      if (!ModelClass) {
        return getDefaultSelect();
      }

      return getAnalyticsSelect(new ModelClass());
    }

    return getDefaultSelect();
  } catch {
    return getDefaultSelect();
  }
}

/*
 * The columns of a telemetry table that a list may ask for: those whose
 * read rule names someone (as for database models, a rule of only
 * CurrentUser names nobody a key can be), and, where a column declares no
 * read rule, only the ones every select may name (ALWAYS_SELECTABLE_COLUMNS:
 * the server reads a column with no rule as closed). Never the database
 * default: telemetry tables have no updatedAt, and the analytics API refuses
 * a select that names a column its table does not have, so every telemetry
 * list failed with "Unknown column: updatedAt".
 */
function getAnalyticsSelect(model: AnalyticsBaseModel): JSONObject {
  const selectObject: JSONObject = {};

  for (const column of model.getTableColumns()) {
    const read: Array<Permission> | undefined = column.accessControl?.read;
    const readable: boolean = read
      ? read.length > 0 &&
        !(read.length === 1 && read[0] === Permission.CurrentUser)
      : ALWAYS_SELECTABLE_COLUMNS.includes(column.key);

    if (readable) {
      selectObject[column.key] = true;
    }
  }

  if (Object.keys(selectObject).length === 0) {
    return { _id: true };
  }

  return selectObject;
}

function getDefaultSelect(): JSONObject {
  return {
    _id: true,
    createdAt: true,
    updatedAt: true,
  };
}
