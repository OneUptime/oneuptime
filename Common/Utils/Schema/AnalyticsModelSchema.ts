import z, { ZodSchema } from "./Zod";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import logger from "../../Server/Utils/Logger";
import { z as ZodTypes } from "zod";

export type AnalyticsModelSchemaType = ZodSchema;

// Type for schema examples
type SchemaExample = Record<string, unknown>;

// Type for shape record
type ShapeRecord = Record<string, ZodTypes.ZodTypeAny>;

export class AnalyticsModelSchema {
  public static getModelSchema(data: {
    modelType: new () => AnalyticsBaseModel;
  }): AnalyticsModelSchemaType {
    const modelType: new () => AnalyticsBaseModel = data.modelType;
    const model: AnalyticsBaseModel = new modelType();

    const columns: Array<AnalyticsTableColumn> = model.getTableColumns();

    const shape: ShapeRecord = {};

    for (const column of columns) {
      const key: string = column.key;
      let zodType: ZodTypes.ZodTypeAny;

      if (column.type === TableColumnType.ObjectID) {
        zodType = z.string().openapi({
          type: "string",
          example: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        });
      } else if (column.type === TableColumnType.Date) {
        zodType = z.date().openapi({
          type: "string",
          format: "date-time",
          example: "2023-01-15T12:30:00.000Z",
        });
      } else if (column.type === TableColumnType.Text) {
        zodType = z.string().openapi({
          type: "string",
          example: "Example text value",
        });
      } else if (column.type === TableColumnType.Number) {
        zodType = z.number().openapi({ type: "number", example: 42 });
      } else if (column.type === TableColumnType.LongNumber) {
        zodType = z.number().openapi({
          type: "number",
          example: 1000000,
        });
      } else if (column.type === TableColumnType.Boolean) {
        zodType = z.boolean().openapi({ type: "boolean", example: true });
      } else if (column.type === TableColumnType.JSON) {
        zodType = z.any().openapi({
          type: "object",
          example: { key: "value", nested: { data: 123 } },
        });
      } else if (column.type === TableColumnType.JSONArray) {
        zodType = z.array(z.any()).openapi({
          type: "array",
          items: {
            type: "object",
          },
          example: [{ key: "value" }, { key2: "value2" }],
        });
      } else if (column.type === TableColumnType.Decimal) {
        zodType = z.number().openapi({
          type: "number",
          example: 123.45,
        });
      } else if (column.type === TableColumnType.ArrayNumber) {
        zodType = z.array(z.number()).openapi({
          type: "array",
          items: {
            type: "number",
          },
          example: [1, 2, 3, 4, 5],
        });
      } else if (column.type === TableColumnType.ArrayText) {
        zodType = z.array(z.string()).openapi({
          type: "array",
          items: {
            type: "string",
          },
          example: ["item1", "item2", "item3"],
        });
      } else if (column.type === TableColumnType.NestedModel && column.nestedModel) {
        // Handle nested models recursively
        const nestedShape: ShapeRecord = {};
        for (const nestedColumn of column.nestedModel.tableColumns) {
          const nestedZodType = this.getZodTypeForColumn(nestedColumn);
          if (nestedColumn.required) {
            nestedShape[nestedColumn.key] = nestedZodType;
          } else {
            nestedShape[nestedColumn.key] = nestedZodType.optional();
          }
        }
        zodType = z.object(nestedShape).openapi({
          type: "object",
          example: this.generateNestedModelExample(column.nestedModel.tableColumns),
        });
      } else {
        // Default fallback
        zodType = z.any().openapi({
          type: "string",
          example: "example_value",
        });
      }

      if (column.required) {
        // leave as is
      } else {
        zodType = zodType.optional();
      }

      // Add title and description to the schema
      if (column.title) {
        zodType = zodType.describe(column.title);
      }

      shape[key] = zodType;
    }

    const schema: AnalyticsModelSchemaType = z.object(shape);

    logger.debug(
      `Analytics model schema for ${model.tableName} created with shape keys: ${Object.keys(shape).join(", ")}`,
    );

    return schema;
  }

  private static getZodTypeForColumn(column: AnalyticsTableColumn): ZodTypes.ZodTypeAny {
    switch (column.type) {
      case TableColumnType.ObjectID:
        return z.string().openapi({
          type: "string",
          example: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        });
      case TableColumnType.Date:
        return z.date().openapi({
          type: "string",
          format: "date-time",
          example: "2023-01-15T12:30:00.000Z",
        });
      case TableColumnType.Text:
        return z.string().openapi({
          type: "string",
          example: "Example text",
        });
      case TableColumnType.Number:
        return z.number().openapi({ type: "number", example: 42 });
      case TableColumnType.LongNumber:
        return z.number().openapi({
          type: "number",
          example: 1000000,
        });
      case TableColumnType.Boolean:
        return z.boolean().openapi({ type: "boolean", example: true });
      case TableColumnType.JSON:
        return z.any().openapi({
          type: "object",
          example: { key: "value" },
        });
      case TableColumnType.JSONArray:
        return z.array(z.any()).openapi({
          type: "array",
          items: { type: "object" },
          example: [{ key: "value" }],
        });
      case TableColumnType.Decimal:
        return z.number().openapi({
          type: "number",
          example: 123.45,
        });
      case TableColumnType.ArrayNumber:
        return z.array(z.number()).openapi({
          type: "array",
          items: { type: "number" },
          example: [1, 2, 3],
        });
      case TableColumnType.ArrayText:
        return z.array(z.string()).openapi({
          type: "array",
          items: { type: "string" },
          example: ["item1", "item2"],
        });
      default:
        return z.any().openapi({
          type: "string",
          example: "example_value",
        });
    }
  }

  private static generateNestedModelExample(columns: Array<AnalyticsTableColumn>): Record<string, unknown> {
    const example: Record<string, unknown> = {};
    for (const column of columns) {
      switch (column.type) {
        case TableColumnType.ObjectID:
          example[column.key] = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";
          break;
        case TableColumnType.Date:
          example[column.key] = "2023-01-15T12:30:00.000Z";
          break;
        case TableColumnType.Text:
          example[column.key] = "Example text";
          break;
        case TableColumnType.Number:
          example[column.key] = 42;
          break;
        case TableColumnType.Boolean:
          example[column.key] = true;
          break;
        case TableColumnType.JSON:
          example[column.key] = { key: "value" };
          break;
        case TableColumnType.ArrayText:
          example[column.key] = ["item1", "item2"];
          break;
        case TableColumnType.ArrayNumber:
          example[column.key] = [1, 2, 3];
          break;
        default:
          example[column.key] = "example_value";
      }
    }
    return example;
  }

  public static getCreateModelSchema(data: {
    modelType: new () => AnalyticsBaseModel;
  }): AnalyticsModelSchemaType {
    const modelType: new () => AnalyticsBaseModel = data.modelType;
    const model: AnalyticsBaseModel = new modelType();

    const columns: Array<AnalyticsTableColumn> = model.getTableColumns();
    const shape: ShapeRecord = {};

    // Exclude system fields from create schema
    const excludedFields: Array<string> = ["_id", "createdAt", "updatedAt"];

    for (const column of columns) {
      const key: string = column.key;
      
      if (excludedFields.includes(key)) {
        continue;
      }

      // Skip default value columns in create schema
      if (column.isDefaultValueColumn) {
        continue;
      }

      const zodType = this.getZodTypeForColumn(column);
      
      if (column.required) {
        shape[key] = zodType;
      } else {
        shape[key] = zodType.optional();
      }
    }

    return z.object(shape).openapi({
      type: "object",
      description: `Create schema for ${model.tableName || "analytics model"}`,
      example: this.getCreateSchemaExample(modelType),
      additionalProperties: false,
    });
  }

  public static getQueryModelSchema(data: {
    modelType: new () => AnalyticsBaseModel;
  }): AnalyticsModelSchemaType {
    const modelType: new () => AnalyticsBaseModel = data.modelType;
    const model: AnalyticsBaseModel = new modelType();

    const columns: Array<AnalyticsTableColumn> = model.getTableColumns();
    const shape: ShapeRecord = {};

    for (const column of columns) {
      const key: string = column.key;

      // Get valid operators for this column type
      const validOperators: Array<string> = this.getValidOperatorsForColumnType(column.type);

      if (validOperators.length === 0) {
        continue;
      }

      // Create a simple query operator schema for Analytics models
      const operatorSchema = z.object({
        _type: z.enum(["EqualTo", "NotEqual", "GreaterThan", "LessThan", "GreaterThanOrEqual", "LessThanOrEqual", "Search", "IsNull", "NotNull"] as [string, ...string[]]),
        value: z.any().optional(),
      }).optional();

      shape[key] = operatorSchema.openapi({
        type: "object",
        description: `Query operators for ${key} field`,
        example: { _type: "EqualTo", value: this.getExampleValueForColumn(column.type) },
      });
    }

    return z.object(shape).openapi({
      type: "object",
      description: `Query schema for ${model.tableName || "analytics model"}`,
      example: this.getQuerySchemaExample(modelType),
      additionalProperties: false,
    });
  }

  public static getSelectModelSchema(data: {
    modelType: new () => AnalyticsBaseModel;
  }): AnalyticsModelSchemaType {
    const modelType: new () => AnalyticsBaseModel = data.modelType;
    const model: AnalyticsBaseModel = new modelType();

    const columns: Array<AnalyticsTableColumn> = model.getTableColumns();
    const shape: ShapeRecord = {};

    for (const column of columns) {
      const key: string = column.key;
      
      shape[key] = z.literal(true).optional().openapi({
        type: "boolean",
        description: `Select ${key} field`,
        example: true,
      });
    }

    return z.object(shape).openapi({
      type: "object",
      description: `Select schema for ${model.tableName || "analytics model"}`,
      example: this.getSelectSchemaExample(modelType),
      additionalProperties: false,
    });
  }

  public static getSortModelSchema(data: {
    modelType: new () => AnalyticsBaseModel;
  }): AnalyticsModelSchemaType {
    const modelType: new () => AnalyticsBaseModel = data.modelType;
    const model: AnalyticsBaseModel = new modelType();

    const columns: Array<AnalyticsTableColumn> = model.getTableColumns();
    const shape: ShapeRecord = {};

    for (const column of columns) {
      const key: string = column.key;

      // Only allow sorting on certain types
      const isSortable: boolean = this.getSortableTypes().includes(column.type);

      if (!isSortable) {
        continue;
      }

      shape[key] = z.enum([SortOrder.Ascending, SortOrder.Descending]).optional().openapi({
        type: "string",
        enum: [SortOrder.Ascending, SortOrder.Descending],
        description: `Sort order for ${key} field`,
        example: SortOrder.Ascending,
      });
    }

    return z.object(shape).openapi({
      type: "object",
      description: `Sort schema for ${model.tableName || "analytics model"}`,
      example: { createdAt: SortOrder.Descending },
      additionalProperties: false,
    });
  }

  public static getGroupByModelSchema(data: {
    modelType: new () => AnalyticsBaseModel;
  }): AnalyticsModelSchemaType {
    const modelType: new () => AnalyticsBaseModel = data.modelType;
    const model: AnalyticsBaseModel = new modelType();

    const columns: Array<AnalyticsTableColumn> = model.getTableColumns();
    const shape: ShapeRecord = {};

    for (const column of columns) {
      const key: string = column.key;

      // Only allow grouping by certain field types
      const isGroupable: boolean = [
        TableColumnType.Text,
        TableColumnType.ObjectID,
        TableColumnType.Boolean,
        TableColumnType.Date,
        TableColumnType.Number,
      ].includes(column.type);

      if (!isGroupable) {
        continue;
      }

      shape[key] = z.literal(true).optional().openapi({
        type: "boolean",
        description: `Group by ${key} field. Only one field can be selected for grouping.`,
        example: true,
      });
    }

    return z.object(shape).openapi({
      type: "object",
      description: `Group by schema for ${model.tableName || "analytics model"}. Only one field can be set to true for grouping.`,
      example: this.getGroupBySchemaExample(modelType),
      additionalProperties: false,
    });
  }

  private static getSortableTypes(): Array<TableColumnType> {
    return [
      TableColumnType.Text,
      TableColumnType.Number,
      TableColumnType.LongNumber,
      TableColumnType.Date,
      TableColumnType.Boolean,
      TableColumnType.ObjectID,
      TableColumnType.Decimal,
    ];
  }

  private static getValidOperatorsForColumnType(columnType: TableColumnType): Array<string> {
    switch (columnType) {
      case TableColumnType.Text:
        return ["EqualTo", "NotEqual", "Search", "IsNull", "NotNull"];
      case TableColumnType.Number:
      case TableColumnType.LongNumber:
      case TableColumnType.Decimal:
        return ["EqualTo", "NotEqual", "GreaterThan", "LessThan", "GreaterThanOrEqual", "LessThanOrEqual", "IsNull", "NotNull"];
      case TableColumnType.Date:
        return ["EqualTo", "NotEqual", "GreaterThan", "LessThan", "GreaterThanOrEqual", "LessThanOrEqual", "IsNull", "NotNull"];
      case TableColumnType.Boolean:
        return ["EqualTo", "NotEqual", "IsNull", "NotNull"];
      case TableColumnType.ObjectID:
        return ["EqualTo", "NotEqual", "IsNull", "NotNull"];
      case TableColumnType.JSON:
      case TableColumnType.JSONArray:
        return ["IsNull", "NotNull"];
      case TableColumnType.ArrayText:
      case TableColumnType.ArrayNumber:
        return ["IsNull", "NotNull"];
      default:
        return ["EqualTo", "NotEqual", "IsNull", "NotNull"];
    }
  }

  private static getExampleValueForColumn(columnType: TableColumnType): unknown {
    switch (columnType) {
      case TableColumnType.ObjectID:
        return "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";
      case TableColumnType.Text:
        return "example text";
      case TableColumnType.Number:
      case TableColumnType.LongNumber:
        return 42;
      case TableColumnType.Decimal:
        return 123.45;
      case TableColumnType.Date:
        return "2023-01-15T12:30:00.000Z";
      case TableColumnType.Boolean:
        return true;
      case TableColumnType.JSON:
        return { key: "value" };
      case TableColumnType.JSONArray:
        return [{ key: "value" }];
      case TableColumnType.ArrayText:
        return ["item1", "item2"];
      case TableColumnType.ArrayNumber:
        return [1, 2, 3];
      default:
        return "example_value";
    }
  }

  private static getCreateSchemaExample(modelType: new () => AnalyticsBaseModel): SchemaExample {
    const model: AnalyticsBaseModel = new modelType();
    const columns: Array<AnalyticsTableColumn> = model.getTableColumns();
    const example: SchemaExample = {};

    let exampleCount: number = 0;
    const maxExamples: number = 3;

    for (const column of columns) {
      if (exampleCount >= maxExamples) {
        break;
      }

      // Skip system fields and default value columns
      if (["_id", "createdAt", "updatedAt"].includes(column.key) || column.isDefaultValueColumn) {
        continue;
      }

      example[column.key] = this.getExampleValueForColumn(column.type);
      exampleCount++;
    }

    return example;
  }

  private static getQuerySchemaExample(modelType: new () => AnalyticsBaseModel): SchemaExample {
    const model: AnalyticsBaseModel = new modelType();
    const columns: Array<AnalyticsTableColumn> = model.getTableColumns();
    const example: SchemaExample = {};

    let exampleCount: number = 0;
    const maxExamples: number = 2;

    for (const column of columns) {
      if (exampleCount >= maxExamples) {
        break;
      }

      const validOperators = this.getValidOperatorsForColumnType(column.type);
      if (validOperators.length === 0) {
        continue;
      }

      if (column.type === TableColumnType.Text) {
        example[column.key] = {
          _type: "EqualTo",
          value: "example text",
        };
        exampleCount++;
      } else if (column.type === TableColumnType.Date) {
        example[column.key] = {
          _type: "GreaterThan",
          value: "2023-01-01T00:00:00.000Z",
        };
        exampleCount++;
      }
    }

    return example;
  }

  private static getSelectSchemaExample(modelType: new () => AnalyticsBaseModel): SchemaExample {
    const model: AnalyticsBaseModel = new modelType();
    const columns: Array<AnalyticsTableColumn> = model.getTableColumns();

    // Add common fields
    const example: SchemaExample = {
      _id: true,
      createdAt: true,
    };

    // Add first few non-system fields
    let fieldCount: number = 0;
    const maxFields: number = 3;
    
    for (const column of columns) {
      if (fieldCount >= maxFields) {
        break;
      }

      if (!["_id", "createdAt", "updatedAt"].includes(column.key)) {
        example[column.key] = true;
        fieldCount++;
      }
    }

    return example;
  }

  private static getGroupBySchemaExample(modelType: new () => AnalyticsBaseModel): SchemaExample {
    const model: AnalyticsBaseModel = new modelType();
    const columns: Array<AnalyticsTableColumn> = model.getTableColumns();

    // Find first suitable field for grouping
    for (const column of columns) {
      const isGroupable: boolean = [
        TableColumnType.Text,
        TableColumnType.ObjectID,
        TableColumnType.Boolean,
        TableColumnType.Date,
        TableColumnType.Number,
      ].includes(column.type);

      if (isGroupable && !["_id", "createdAt", "updatedAt"].includes(column.key)) {
        return { [column.key]: true };
      }
    }

    // Fallback
    return { createdAt: true };
  }
}
