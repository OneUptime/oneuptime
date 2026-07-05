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
import {
  getTableColumns,
  TableColumnMetadata,
} from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import Permission from "Common/Types/Permission";
import ModelType from "../Types/ModelType";
import MCPLogger from "../Utils/MCPLogger";
import { JSONObject } from "Common/Types/JSON";

/*
 * Column types that tend to hold multi-KB payloads (monitor step definitions,
 * raw JSON blobs, rendered HTML). Excluded from the default select so list
 * and read responses stay token-efficient for AI agents; callers can still
 * request them explicitly via the tool's `select` parameter.
 */
const HEAVY_COLUMN_TYPES: TableColumnType[] = [
  TableColumnType.JSON,
  TableColumnType.VeryLongText,
  TableColumnType.HTML,
];

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

// Type for Zod schema shape
interface ZodSchemaWithShape {
  _def?: {
    shape?: Record<string, unknown> | (() => Record<string, unknown>);
  };
}

/**
 * Generate a select object with all readable fields, excluding heavy
 * (multi-KB) column types by default for token efficiency.
 */
export function generateAllFieldsSelect(
  tableName: string,
  modelType: ModelType,
): JSONObject {
  MCPLogger.debug(
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

export interface SelectableFieldsInfo {
  // All field names an agent may request via the `select` parameter
  allFields: string[];
  // Fields excluded from the default select because they are heavy
  heavyFields: string[];
}

/**
 * Describe which fields a database model exposes for selection. Used by the
 * tool generator to document the `select` parameter.
 */
export function getSelectableFieldsForModel(
  model: BaseModel,
): SelectableFieldsInfo {
  const allFields: string[] = [];
  const heavyFields: string[] = [];

  try {
    const tableColumns: Record<string, TableColumnMetadata> =
      getTableColumns(model);
    const accessControl: Record<string, ColumnAccessControl> = (
      model as unknown as ModelWithTableName
    ).getColumnAccessControlForAllColumns
      ? (model as unknown as ModelWithTableName)
          .getColumnAccessControlForAllColumns!()
      : {};

    for (const [columnName, metadata] of Object.entries(tableColumns)) {
      if (!shouldIncludeField(columnName, accessControl)) {
        continue;
      }
      allFields.push(columnName);
      if (metadata?.type && HEAVY_COLUMN_TYPES.includes(metadata.type)) {
        heavyFields.push(columnName);
      }
    }
  } catch (error) {
    MCPLogger.warn(`Failed to list selectable fields: ${error}`);
  }

  return { allFields, heavyFields };
}

/**
 * Find the model class by table name
 */
function findModelClass(
  tableName: string,
  modelType: ModelType,
): ModelConstructor<BaseModel> | ModelConstructor<AnalyticsBaseModel> | null {
  if (modelType === ModelType.Database) {
    return (
      (DatabaseModels.find((Model: ModelConstructor<BaseModel>): boolean => {
        try {
          const instance: ModelWithTableName =
            new Model() as unknown as ModelWithTableName;
          return instance.tableName === tableName;
        } catch (error) {
          MCPLogger.warn(`Error instantiating model ${Model.name}: ${error}`);
          return false;
        }
      }) as ModelConstructor<BaseModel> | undefined) || null
    );
  }

  if (modelType === ModelType.Analytics) {
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
    const tableColumns: Record<string, TableColumnMetadata> = getTableColumns(
      modelInstance as BaseModel,
    );
    const columnNames: string[] = Object.keys(tableColumns);

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
      const columnType: TableColumnType | undefined =
        tableColumns[columnName]?.type;
      const isHeavyColumn: boolean = Boolean(
        columnType && HEAVY_COLUMN_TYPES.includes(columnType),
      );

      if (shouldIncludeField(columnName, accessControlForColumns)) {
        if (isHeavyColumn) {
          // Excluded by default; agents can request via the select parameter
          filteredCount++;
          continue;
        }
        selectObject[columnName] = true;
      } else {
        filteredCount++;
      }
    }

    MCPLogger.debug(
      `Generated select from table columns for ${tableName} with ${Object.keys(selectObject).length} fields (excluded ${filteredCount} restricted/heavy fields)`,
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
    MCPLogger.debug(
      `Generating select schema for database model: ${(ModelClass as { name: string }).name}`,
    );
    selectSchema = ModelSchema.getSelectModelSchema({
      modelType: ModelClass as ModelConstructor<BaseModel>,
    }) as ZodSchemaWithShape;
  } else {
    MCPLogger.debug(
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

  MCPLogger.debug(
    `Schema shape keys: ${shape ? Object.keys(shape).length : 0}`,
  );

  if (shape) {
    const fieldNames: string[] = Object.keys(shape);
    MCPLogger.debug(
      `Available fields: ${fieldNames.slice(0, 10).join(", ")}${fieldNames.length > 10 ? "..." : ""}`,
    );

    for (const fieldName of fieldNames) {
      selectObject[fieldName] = true;
    }
  }

  MCPLogger.debug(
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
