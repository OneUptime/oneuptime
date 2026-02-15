import DatabaseModels from "Common/Models/DatabaseModels/Index";
import AnalyticsModels from "Common/Models/AnalyticsModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import { getTableColumns } from "Common/Types/Database/TableColumn";
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
      const ModelClass:
        | (new () => BaseModel)
        | undefined = DatabaseModels.find(
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
      const ModelClass:
        | (new () => AnalyticsBaseModel)
        | undefined = AnalyticsModels.find(
        (Model: new () => AnalyticsBaseModel): boolean => {
          try {
            const instance: AnalyticsBaseModel = new Model();
            return instance.tableName === tableName;
          } catch {
            return false;
          }
        },
      );

      if (!ModelClass) {
        return getDefaultSelect();
      }

      // For analytics models, just return a basic select
      return getDefaultSelect();
    }

    return getDefaultSelect();
  } catch {
    return getDefaultSelect();
  }
}

function getDefaultSelect(): JSONObject {
  return {
    _id: true,
    createdAt: true,
    updatedAt: true,
  };
}
