import z, { ZodSchema } from "./Zod";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import { z as ZodTypes } from "zod";
import { BaseSchema, SchemaExample, ShapeRecord } from "./BaseSchema";
import IP from "../../Types/IP/IP";
import Port from "../../Types/Port";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";

export type AnalyticsModelSchemaType = ZodSchema;

export class AnalyticsModelSchema extends BaseSchema {
  // Helper function to add default value to openapi schema if it exists
  private static addDefaultToOpenApi(
    openApiConfig: any,
    column: AnalyticsTableColumn,
  ): any {
    if (column.defaultValue !== undefined && column.defaultValue !== null) {
      return { ...openApiConfig, default: column.defaultValue };
    }
    return openApiConfig;
  }

  public static getModelSchema(data: {
    modelType: new () => AnalyticsBaseModel;
  }): AnalyticsModelSchemaType {
    const modelType: new () => AnalyticsBaseModel = data.modelType;
    const model: AnalyticsBaseModel = new modelType();

    const columns: Array<AnalyticsTableColumn> = model.getTableColumns();

    // Filter out columns with no read permissions
    const filteredColumns: Array<AnalyticsTableColumn> = columns.filter(
      (column: AnalyticsTableColumn) => {
        const accessControl: any = model.getColumnAccessControlFor(column.key);
        if (!accessControl) {
          return false;
        }
        const readPermissions: Array<string> = accessControl.read;
        return readPermissions && readPermissions.length > 0;
      },
    );

    const shape: ShapeRecord = {};

    for (const column of filteredColumns) {
      const key: string = column.key;
      let zodType: ZodTypes.ZodTypeAny;

      if (column.type === TableColumnType.ObjectID) {
        zodType = z.string().openapi(
          this.addDefaultToOpenApi(
            {
              type: "string",
              example: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
            },
            column,
          ),
        );
      } else if (column.type === TableColumnType.Date) {
        zodType = z.date().openapi(
          this.addDefaultToOpenApi(
            {
              type: "string",
              format: "date-time",
              example: "2023-01-15T12:30:00.000Z",
            },
            column,
          ),
        );
      } else if (column.type === TableColumnType.Text) {
        zodType = z.string().openapi(
          this.addDefaultToOpenApi(
            {
              type: "string",
              example: "Example text value",
            },
            column,
          ),
        );
      } else if (column.type === TableColumnType.Number) {
        zodType = z
          .number()
          .openapi(
            this.addDefaultToOpenApi({ type: "number", example: 42 }, column),
          );
      } else if (column.type === TableColumnType.LongNumber) {
        zodType = z.number().openapi(
          this.addDefaultToOpenApi(
            {
              type: "number",
              example: 1000000,
            },
            column,
          ),
        );
      } else if (column.type === TableColumnType.Boolean) {
        zodType = z
          .boolean()
          .openapi(
            this.addDefaultToOpenApi(
              { type: "boolean", example: true },
              column,
            ),
          );
      } else if (column.type === TableColumnType.JSON) {
        zodType = z.any().openapi(
          this.addDefaultToOpenApi(
            {
              type: "object",
              example: { key: "value", nested: { data: 123 } },
            },
            column,
          ),
        );
      } else if (column.type === TableColumnType.JSONArray) {
        zodType = z.array(z.any()).openapi(
          this.addDefaultToOpenApi(
            {
              type: "array",
              items: {
                type: "object",
              },
              example: [{ key: "value" }, { key2: "value2" }],
            },
            column,
          ),
        );
      } else if (column.type === TableColumnType.Decimal) {
        zodType = z.number().openapi(
          this.addDefaultToOpenApi(
            {
              type: "number",
              example: 123.45,
            },
            column,
          ),
        );
      } else if (column.type === TableColumnType.ArrayNumber) {
        zodType = z.array(z.number()).openapi(
          this.addDefaultToOpenApi(
            {
              type: "array",
              items: {
                type: "number",
              },
              example: [1, 2, 3, 4, 5],
            },
            column,
          ),
        );
      } else if (column.type === TableColumnType.ArrayText) {
        zodType = z.array(z.string()).openapi(
          this.addDefaultToOpenApi(
            {
              type: "array",
              items: {
                type: "string",
              },
              example: ["item1", "item2", "item3"],
            },
            column,
          ),
        );
      } else if (column.type === TableColumnType.IP) {
        zodType = IP.getSchema();
      } else if (column.type === TableColumnType.Port) {
        zodType = Port.getSchema();
      } else {
        // Default fallback
        zodType = z.any().openapi(
          this.addDefaultToOpenApi(
            {
              type: "string",
              example: "example_value",
            },
            column,
          ),
        );
      }

      // Apply default value if it exists
      zodType = this.applyDefaultValue(zodType, column);

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

    return schema;
  }

  private static getZodTypeForColumn(
    column: AnalyticsTableColumn,
    disableOpenApiSchema: boolean = false,
  ): ZodTypes.ZodTypeAny {
    switch (column.type) {
      case TableColumnType.ObjectID:
        return ObjectID.getSchema();
      case TableColumnType.Date:
        return OneUptimeDate.getSchema();
      case TableColumnType.Text:
        return this.applyOpenApi(
          z.string(),
          this.addDefaultToOpenApi(
            {
              type: "string",
              example: "Example text",
            },
            column,
          ),
          disableOpenApiSchema,
        );
      case TableColumnType.Number:
        return this.applyOpenApi(
          z.number(),
          this.addDefaultToOpenApi({ type: "number", example: 42 }, column),
          disableOpenApiSchema,
        );
      case TableColumnType.LongNumber:
        return this.applyOpenApi(
          z.number(),
          this.addDefaultToOpenApi(
            {
              type: "number",
              example: 1000000,
            },
            column,
          ),
          disableOpenApiSchema,
        );
      case TableColumnType.Boolean:
        return this.applyOpenApi(
          z.boolean(),
          this.addDefaultToOpenApi({ type: "boolean", example: true }, column),
          disableOpenApiSchema,
        );
      case TableColumnType.JSON:
        return this.applyOpenApi(
          z.any(),
          this.addDefaultToOpenApi(
            {
              type: "object",
              example: { key: "value" },
            },
            column,
          ),
          disableOpenApiSchema,
        );
      case TableColumnType.JSONArray:
        return this.applyOpenApi(
          z.array(z.any()),
          this.addDefaultToOpenApi(
            {
              type: "array",
              items: { type: "object" },
              example: [{ key: "value" }],
            },
            column,
          ),
          disableOpenApiSchema,
        );
      case TableColumnType.Decimal:
        return this.applyOpenApi(
          z.number(),
          this.addDefaultToOpenApi(
            {
              type: "number",
              example: 123.45,
            },
            column,
          ),
          disableOpenApiSchema,
        );
      case TableColumnType.ArrayNumber:
        return this.applyOpenApi(
          z.array(z.number()),
          this.addDefaultToOpenApi(
            {
              type: "array",
              items: { type: "number" },
              example: [1, 2, 3],
            },
            column,
          ),
          disableOpenApiSchema,
        );
      case TableColumnType.ArrayText:
        return this.applyOpenApi(
          z.array(z.string()),
          this.addDefaultToOpenApi(
            {
              type: "array",
              items: { type: "string" },
              example: ["item1", "item2"],
            },
            column,
          ),
          disableOpenApiSchema,
        );
      case TableColumnType.IP:
        return IP.getSchema();
      case TableColumnType.Port:
        return Port.getSchema();
      default:
        return this.applyOpenApi(
          z.any(),
          this.addDefaultToOpenApi(
            {
              type: "string",
              example: "unknown",
            },
            column,
          ),
          disableOpenApiSchema,
        );
    }
  }

  private static applyDefaultValue(
    zodType: ZodTypes.ZodTypeAny,
    column: AnalyticsTableColumn,
  ): ZodTypes.ZodTypeAny {
    // Apply default value if it exists in the column metadata
    if (column.defaultValue !== undefined && column.defaultValue !== null) {
      zodType = zodType.default(column.defaultValue);
    }
    return zodType;
  }

  public static getCreateModelSchema(data: {
    modelType: new () => AnalyticsBaseModel;
    disableOpenApiSchema?: boolean;
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

      // Filter out columns with no create permissions
      const accessControl: any = model.getColumnAccessControlFor(column.key);
      if (!accessControl) {
        continue;
      }
      const createPermissions: Array<string> = accessControl.create;
      if (!createPermissions || createPermissions.length === 0) {
        continue;
      }

      let zodType: ZodTypes.ZodTypeAny = this.getZodTypeForColumn(
        column,
        data.disableOpenApiSchema || false,
      );

      // Apply default value if it exists
      zodType = this.applyDefaultValue(zodType, column);

      if (column.required) {
        shape[key] = zodType;
      } else {
        shape[key] = zodType.optional();
      }
    }

    return this.applyOpenApi(
      z.object(shape),
      {
        type: "object",
        description: `Create schema for ${model.tableName || "analytics model"}`,
        example: this.getCreateSchemaExample(modelType),
        additionalProperties: false,
      },
      data.disableOpenApiSchema || false,
    );
  }

  public static getQueryModelSchema(data: {
    modelType: new () => AnalyticsBaseModel;
    disableOpenApiSchema?: boolean;
  }): AnalyticsModelSchemaType {
    const modelType: new () => AnalyticsBaseModel = data.modelType;
    const model: AnalyticsBaseModel = new modelType();

    return this.generateQuerySchema({
      model,
      tableName: model.tableName || "analytics_model",
      getColumns: (model: AnalyticsBaseModel) => {
        const columns: Array<AnalyticsTableColumn> = model.getTableColumns();
        return columns.map((column: AnalyticsTableColumn) => {
          return { key: column.key, type: column.type };
        });
      },
      getValidOperatorsForColumnType: (columnType: TableColumnType) => {
        return this.getValidOperatorsForColumnType(columnType);
      },
      getOperatorSchema: (
        operatorType: string,
        columnType: TableColumnType,
      ) => {
        return this.getOperatorSchema(operatorType, columnType);
      },
      getQuerySchemaExample: () => {
        return this.getQuerySchemaExample(modelType);
      },
      getExampleValueForColumn: (columnType: TableColumnType) => {
        return this.getExampleValueForColumn(columnType);
      },
      disableOpenApiSchema: data.disableOpenApiSchema || false,
    });
  }

  public static getSelectModelSchema(data: {
    modelType: new () => AnalyticsBaseModel;
  }): AnalyticsModelSchemaType {
    const modelType: new () => AnalyticsBaseModel = data.modelType;
    const model: AnalyticsBaseModel = new modelType();

    return this.generateSelectSchema({
      model,
      tableName: model.tableName || "analytics_model",
      getColumns: (model: AnalyticsBaseModel) => {
        const columns: Array<AnalyticsTableColumn> = model.getTableColumns();
        return columns.map((column: AnalyticsTableColumn) => {
          return { key: column.key, type: column.type };
        });
      },
      getSelectSchemaExample: () => {
        return this.getSelectSchemaExample(modelType);
      },
    });
  }

  public static getSortModelSchema(data: {
    modelType: new () => AnalyticsBaseModel;
    disableOpenApiSchema?: boolean;
  }): AnalyticsModelSchemaType {
    const modelType: new () => AnalyticsBaseModel = data.modelType;
    const model: AnalyticsBaseModel = new modelType();

    return this.generateSortSchema({
      model,
      tableName: model.tableName || "analytics_model",
      getSortableTypes: () => {
        return this.getSortableTypes();
      },
      getColumnsForSorting: (model: AnalyticsBaseModel) => {
        const columns: Array<AnalyticsTableColumn> = model.getTableColumns();
        return columns.map((column: AnalyticsTableColumn) => {
          return { key: column.key, type: column.type };
        });
      },
      disableOpenApiSchema: data.disableOpenApiSchema || false,
    });
  }

  public static getGroupByModelSchema(data: {
    modelType: new () => AnalyticsBaseModel;
  }): AnalyticsModelSchemaType {
    const modelType: new () => AnalyticsBaseModel = data.modelType;
    const model: AnalyticsBaseModel = new modelType();

    return this.generateGroupBySchema({
      model,
      tableName: model.tableName || "analytics_model",
      getColumns: (model: AnalyticsBaseModel) => {
        const columns: Array<AnalyticsTableColumn> = model.getTableColumns();
        return columns.map((column: AnalyticsTableColumn) => {
          return { key: column.key, type: column.type };
        });
      },
      getGroupableTypes: () => {
        return [
          TableColumnType.Text,
          TableColumnType.ObjectID,
          TableColumnType.Boolean,
          TableColumnType.Date,
          TableColumnType.Number,
          TableColumnType.IP,
          TableColumnType.Port,
        ];
      },
      getGroupBySchemaExample: () => {
        return this.getGroupBySchemaExample(modelType);
      },
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
      TableColumnType.IP,
      TableColumnType.Port,
    ];
  }

  private static getValidOperatorsForColumnType(
    columnType: TableColumnType,
  ): Array<string> {
    switch (columnType) {
      case TableColumnType.Text:
        return ["EqualTo", "NotEqual", "Search", "IsNull", "NotNull"];
      case TableColumnType.Number:
      case TableColumnType.LongNumber:
      case TableColumnType.Decimal:
        return [
          "EqualTo",
          "NotEqual",
          "GreaterThan",
          "LessThan",
          "GreaterThanOrEqual",
          "LessThanOrEqual",
          "IsNull",
          "NotNull",
        ];
      case TableColumnType.Date:
        return [
          "EqualTo",
          "NotEqual",
          "GreaterThan",
          "LessThan",
          "GreaterThanOrEqual",
          "LessThanOrEqual",
          "IsNull",
          "NotNull",
        ];
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
      case TableColumnType.IP:
        return ["EqualTo", "NotEqual", "IsNull", "NotNull"];
      case TableColumnType.Port:
        return [
          "EqualTo",
          "NotEqual",
          "GreaterThan",
          "LessThan",
          "GreaterThanOrEqual",
          "LessThanOrEqual",
          "IsNull",
          "NotNull",
        ];
      default:
        return ["EqualTo", "NotEqual", "IsNull", "NotNull"];
    }
  }

  private static getExampleValueForColumn(
    columnType: TableColumnType,
  ): unknown {
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
      case TableColumnType.IP:
        return "192.168.1.1";
      case TableColumnType.Port:
        return 8080;
      default:
        return "example_value";
    }
  }

  private static getCreateSchemaExample(
    modelType: new () => AnalyticsBaseModel,
  ): SchemaExample {
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
      if (
        ["_id", "createdAt", "updatedAt"].includes(column.key) ||
        column.isDefaultValueColumn
      ) {
        continue;
      }

      // Skip columns with no create permissions
      const accessControl: any = model.getColumnAccessControlFor(column.key);
      if (!accessControl) {
        continue;
      }
      const createPermissions: Array<string> = accessControl.create;
      if (!createPermissions || createPermissions.length === 0) {
        continue;
      }

      example[column.key] = this.getExampleValueForColumn(column.type);
      exampleCount++;
    }

    return example;
  }

  private static getQuerySchemaExample(
    modelType: new () => AnalyticsBaseModel,
  ): SchemaExample {
    const model: AnalyticsBaseModel = new modelType();
    const columns: Array<AnalyticsTableColumn> = model.getTableColumns();
    const example: SchemaExample = {};

    let exampleCount: number = 0;
    const maxExamples: number = 2;

    for (const column of columns) {
      if (exampleCount >= maxExamples) {
        break;
      }

      // Check read permissions for query operations
      const accessControl: any = model.getColumnAccessControlFor(column.key);
      if (
        !accessControl ||
        !accessControl.read ||
        accessControl.read.length === 0
      ) {
        continue;
      }

      const validOperators: Array<string> = this.getValidOperatorsForColumnType(
        column.type,
      );
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

  private static getSelectSchemaExample(
    modelType: new () => AnalyticsBaseModel,
  ): SchemaExample {
    const model: AnalyticsBaseModel = new modelType();
    const columns: Array<AnalyticsTableColumn> = model.getTableColumns();

    // Add common fields (only if they have read permissions)
    const example: SchemaExample = {};

    // Check if _id has read permissions
    const idAccessControl: any = model.getColumnAccessControlFor("_id");
    if (
      idAccessControl &&
      idAccessControl.read &&
      idAccessControl.read.length > 0
    ) {
      example["_id"] = true;
    }

    // Check if createdAt has read permissions
    const createdAtAccessControl: any =
      model.getColumnAccessControlFor("createdAt");
    if (
      createdAtAccessControl &&
      createdAtAccessControl.read &&
      createdAtAccessControl.read.length > 0
    ) {
      example["createdAt"] = true;
    }

    // Add first few non-system fields with read permissions
    let fieldCount: number = 0;
    const maxFields: number = 3;

    for (const column of columns) {
      if (fieldCount >= maxFields) {
        break;
      }

      if (!["_id", "createdAt", "updatedAt"].includes(column.key)) {
        // Check read permissions
        const accessControl: any = model.getColumnAccessControlFor(column.key);
        if (
          accessControl &&
          accessControl.read &&
          accessControl.read.length > 0
        ) {
          example[column.key] = true;
          fieldCount++;
        }
      }
    }

    return example;
  }

  private static getGroupBySchemaExample(
    modelType: new () => AnalyticsBaseModel,
  ): SchemaExample {
    const model: AnalyticsBaseModel = new modelType();
    const columns: Array<AnalyticsTableColumn> = model.getTableColumns();

    // Find first suitable field for grouping with read permissions
    for (const column of columns) {
      const isGroupable: boolean = [
        TableColumnType.Text,
        TableColumnType.ObjectID,
        TableColumnType.Boolean,
        TableColumnType.Date,
        TableColumnType.Number,
        TableColumnType.IP,
        TableColumnType.Port,
      ].includes(column.type);

      if (
        isGroupable &&
        !["_id", "createdAt", "updatedAt"].includes(column.key)
      ) {
        // Check read permissions
        const accessControl: any = model.getColumnAccessControlFor(column.key);
        if (
          accessControl &&
          accessControl.read &&
          accessControl.read.length > 0
        ) {
          return { [column.key]: true };
        }
      }
    }

    // Fallback to createdAt if it has read permissions
    const createdAtAccessControl: any =
      model.getColumnAccessControlFor("createdAt");
    if (
      createdAtAccessControl &&
      createdAtAccessControl.read &&
      createdAtAccessControl.read.length > 0
    ) {
      return { ["createdAt"]: true };
    }

    // Final fallback - return empty object if no columns have read permissions
    return {};
  }

  private static getOperatorSchema(
    operatorType: string,
    columnType: TableColumnType,
  ): ZodTypes.ZodTypeAny {
    const baseValue: ZodTypes.ZodTypeAny =
      this.getBaseValueSchemaForColumnType(columnType);

    switch (operatorType) {
      case "EqualTo":
        return baseValue;
      case "NotEqual":
        return z.object({
          _type: z.literal(operatorType),
          value: baseValue,
        });

      case "GreaterThan":
      case "LessThan":
      case "GreaterThanOrEqual":
      case "LessThanOrEqual":
        return z.object({
          _type: z.literal(operatorType),
          value: baseValue,
        });

      case "Search":
        return z.object({
          _type: z.literal("Search"),
          value: z.string(),
        });

      case "IsNull":
      case "NotNull":
        return z.object({
          _type: z.literal(operatorType),
        });

      default:
        return z.object({
          _type: z.literal(operatorType),
          value: baseValue.optional(),
        });
    }
  }

  private static getBaseValueSchemaForColumnType(
    columnType: TableColumnType,
  ): ZodTypes.ZodTypeAny {
    switch (columnType) {
      case TableColumnType.ObjectID:
      case TableColumnType.Text:
        return z.string();

      case TableColumnType.Number:
      case TableColumnType.LongNumber:
      case TableColumnType.Decimal:
        return z.number();

      case TableColumnType.Date:
        return z.date();

      case TableColumnType.Boolean:
        return z.boolean();

      case TableColumnType.JSON:
      case TableColumnType.JSONArray:
      case TableColumnType.ArrayText:
      case TableColumnType.ArrayNumber:
        return z.any();

      case TableColumnType.IP:
        return IP.getSchema();

      case TableColumnType.Port:
        return Port.getSchema();

      default:
        return z.string();
    }
  }
}
