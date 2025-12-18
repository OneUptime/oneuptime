/**
 * Select Field Generator
 * Generates select field objects for API queries
 */

import DatabaseModels from "Common/Models/DatabaseModels/Index";
import AnalyticsModels from "Common/Models/AnalyticsModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import { ModelSchema } from "Common/Utils/Schema/ModelSchema";
import { AnalyticsModelSchema } from "Common/Utils/Schema/AnalyticsModelSchema";
import { getTableColumns } from "Common/Types/Database/TableColumn";
import Permission from "Common/Types/Permission";
import ModelType from "../Types/ModelType";
import MCPLogger from "../Utils/MCPLogger";
import { JSONObject } from "Common/Types/JSON";

// Type for model constructor
type ModelConstructor<T> = new () => T;

// Type for model class with table name
interface ModelWithTableName {
  tableName: string;
  getColumnAccessControlForAllColumns?: () => Record<
    string,
    ColumnAccessControl
  >;
}

// Type for column access control
interface ColumnAccessControl {
  read?: Permission[];
  create?: Permission[];
  update?: Permission[];
}

// Type for table columns
type TableColumns = Record<string, unknown>;

// Type for Zod schema shape
interface ZodSchemaWithShape {
  _def?: {
    shape?: Record<string, unknown> | (() => Record<string, unknown>);
  };
}

/**
 * Generate a select object that includes all fields from the select schema
 */
export function generateAllFieldsSelect(
  tableName: string,
  modelType: ModelType,
): JSONObject {
  MCPLogger.info(
    `Generating select for tableName: ${tableName}, modelType: ${modelType}`,
  );

  try {
    const ModelClass:
      | ModelConstructor<BaseModel>
      | ModelConstructor<AnalyticsBaseModel>
      | null = findModelClass(tableName, modelType);

    if (!ModelClass) {
      MCPLogger.warn(
        `Model class not found for ${tableName}, using empty select`,
      );
      return {};
    }

    MCPLogger.info(
      `Found ModelClass: ${(ModelClass as { name: string }).name} for tableName: ${tableName}`,
    );

    // Try to get raw table columns first (most reliable approach)
    const selectFromColumns: JSONObject | null = generateSelectFromTableColumns(
      ModelClass as ModelConstructor<BaseModel>,
      tableName,
    );

    if (selectFromColumns && Object.keys(selectFromColumns).length > 0) {
      return selectFromColumns;
    }

    // Fallback to schema approach if table columns fail
    return generateSelectFromSchema(ModelClass, tableName, modelType);
  } catch (error) {
    MCPLogger.error(`Error generating select for ${tableName}: ${error}`);
    return getDefaultSelect();
  }
}

/**
 * Find the model class by table name
 */
function findModelClass(
  tableName: string,
  modelType: ModelType,
): ModelConstructor<BaseModel> | ModelConstructor<AnalyticsBaseModel> | null {
  if (modelType === ModelType.Database) {
    MCPLogger.info(`Searching DatabaseModels for tableName: ${tableName}`);
    return (
      (DatabaseModels.find((Model: ModelConstructor<BaseModel>): boolean => {
        try {
          const instance: ModelWithTableName =
            new Model() as unknown as ModelWithTableName;
          const instanceTableName: string = instance.tableName;
          MCPLogger.info(
            `Checking model ${Model.name} with tableName: ${instanceTableName}`,
          );
          return instanceTableName === tableName;
        } catch (error) {
          MCPLogger.warn(`Error instantiating model ${Model.name}: ${error}`);
          return false;
        }
      }) as ModelConstructor<BaseModel> | undefined) || null
    );
  }

  if (modelType === ModelType.Analytics) {
    MCPLogger.info(`Searching AnalyticsModels for tableName: ${tableName}`);
    return (
      (AnalyticsModels.find(
        (Model: ModelConstructor<AnalyticsBaseModel>): boolean => {
          try {
            const instance: ModelWithTableName =
              new Model() as unknown as ModelWithTableName;
            return instance.tableName === tableName;
          } catch (error) {
            MCPLogger.warn(
              `Error instantiating analytics model ${Model.name}: ${error}`,
            );
            return false;
          }
        },
      ) as ModelConstructor<AnalyticsBaseModel> | undefined) || null
    );
  }

  return null;
}

/**
 * Generate select object from table columns
 */
function generateSelectFromTableColumns(
  ModelClass: ModelConstructor<BaseModel>,
  tableName: string,
): JSONObject | null {
  try {
    const modelInstance: ModelWithTableName =
      new ModelClass() as unknown as ModelWithTableName;
    const tableColumns: TableColumns = getTableColumns(
      modelInstance as BaseModel,
    );
    const columnNames: string[] = Object.keys(tableColumns);

    MCPLogger.info(
      `Raw table columns (${columnNames.length}): ${columnNames.slice(0, 10).join(", ")}`,
    );

    if (columnNames.length === 0) {
      return null;
    }

    // Get access control information to filter out restricted fields
    const accessControlForColumns: Record<string, ColumnAccessControl> =
      modelInstance.getColumnAccessControlForAllColumns
        ? modelInstance.getColumnAccessControlForAllColumns()
        : {};

    const selectObject: JSONObject = {};
    let filteredCount: number = 0;

    for (const columnName of columnNames) {
      if (shouldIncludeField(columnName, accessControlForColumns)) {
        selectObject[columnName] = true;
      } else {
        filteredCount++;
        MCPLogger.info(`Filtered out restricted field: ${columnName}`);
      }
    }

    MCPLogger.info(
      `Generated select from table columns for ${tableName} with ${Object.keys(selectObject).length} fields (filtered out ${filteredCount} restricted fields)`,
    );

    // Ensure we have at least some basic fields
    if (Object.keys(selectObject).length === 0) {
      MCPLogger.warn(`All fields were filtered out, adding safe basic fields`);
      return getDefaultSelect();
    }

    return selectObject;
  } catch (tableColumnError) {
    MCPLogger.warn(
      `Failed to get table columns for ${tableName}: ${tableColumnError}`,
    );
    return null;
  }
}

/**
 * Check if a field should be included based on access control
 */
function shouldIncludeField(
  columnName: string,
  accessControlForColumns: Record<string, ColumnAccessControl>,
): boolean {
  const accessControl: ColumnAccessControl | undefined =
    accessControlForColumns[columnName];

  /*
   * Include the field if:
   * 1. No access control defined (open access)
   * 2. Has read permissions that are not empty
   * 3. Read permissions don't only contain Permission.CurrentUser
   */
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

/**
 * Generate select object from model schema (fallback)
 */
function generateSelectFromSchema(
  ModelClass:
    | ModelConstructor<BaseModel>
    | ModelConstructor<AnalyticsBaseModel>,
  tableName: string,
  modelType: ModelType,
): JSONObject {
  let selectSchema: ZodSchemaWithShape;

  if (modelType === ModelType.Database) {
    MCPLogger.info(
      `Generating select schema for database model: ${(ModelClass as { name: string }).name}`,
    );
    selectSchema = ModelSchema.getSelectModelSchema({
      modelType: ModelClass as ModelConstructor<BaseModel>,
    }) as ZodSchemaWithShape;
  } else {
    MCPLogger.info(
      `Generating schema for analytics model: ${(ModelClass as { name: string }).name}`,
    );
    selectSchema = AnalyticsModelSchema.getModelSchema({
      modelType: ModelClass as ModelConstructor<AnalyticsBaseModel>,
    }) as ZodSchemaWithShape;
  }

  // Extract field names from the schema
  const selectObject: JSONObject = {};
  const rawShape:
    | Record<string, unknown>
    | (() => Record<string, unknown>)
    | undefined = selectSchema._def?.shape;

  // Handle both function and object shapes
  const shape: Record<string, unknown> | undefined =
    typeof rawShape === "function" ? rawShape() : rawShape;

  MCPLogger.info(`Schema shape keys: ${shape ? Object.keys(shape).length : 0}`);

  if (shape) {
    const fieldNames: string[] = Object.keys(shape);
    MCPLogger.info(
      `Available fields: ${fieldNames.slice(0, 10).join(", ")}${fieldNames.length > 10 ? "..." : ""}`,
    );

    for (const fieldName of fieldNames) {
      selectObject[fieldName] = true;
    }
  }

  MCPLogger.info(
    `Generated select for ${tableName} with ${Object.keys(selectObject).length} fields`,
  );

  // Force include some basic fields if select is empty
  if (Object.keys(selectObject).length === 0) {
    MCPLogger.warn(`No fields found, adding basic fields for ${tableName}`);
    return getDefaultSelect();
  }

  return selectObject;
}

/**
 * Get default select fields
 */
function getDefaultSelect(): JSONObject {
  return {
    _id: true,
    createdAt: true,
    updatedAt: true,
  };
}
