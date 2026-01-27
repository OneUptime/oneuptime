import z, { ZodSchema } from "./Zod";
import TableColumnType from "../../Types/Database/TableColumnType";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../Types/Database/TableColumn";
import Dictionary from "../../Types/Dictionary";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Color from "../../Types/Color";
import { z as ZodTypes } from "zod";
import BadDataException from "../../Types/Exception/BadDataException";
import Permission, { PermissionHelper } from "../../Types/Permission";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import { BaseSchema, SchemaExample, ShapeRecord } from "./BaseSchema";
import ObjectID from "../../Types/ObjectID";
import Email from "../../Types/Email";
import Phone from "../../Types/Phone";
import Domain from "../../Types/Domain";
import Version from "../../Types/Version";
import Name from "../../Types/Name";
import IP from "../../Types/IP/IP";
import Port from "../../Types/Port";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import OneUptimeDate from "../../Types/Date";

export type ModelSchemaType = ZodSchema;

// Type for schema method functions
type SchemaMethodFunction = (data: {
  modelType: new () => DatabaseBaseModel;
}) => ModelSchemaType;

export class ModelSchema extends BaseSchema {
  /**
   * Format permissions array into a human-readable string for OpenAPI documentation
   */
  private static formatPermissionsForSchema(
    permissions: Array<Permission> | undefined,
  ): string {
    if (!permissions || permissions.length === 0) {
      return "No access - you don't have permission for this operation";
    }

    return PermissionHelper.getPermissionTitles(permissions).join(", ");
  }

  /**
   * Get permissions description for a column to add to OpenAPI schema
   */
  private static getColumnPermissionsDescription(
    model: DatabaseBaseModel,
    key: string,
  ): string {
    const accessControl: ColumnAccessControl | undefined =
      model.getColumnAccessControlForAllColumns()[key];

    if (!accessControl) {
      return "";
    }

    const createPermissions: string = this.formatPermissionsForSchema(
      accessControl.create,
    );
    const readPermissions: string = this.formatPermissionsForSchema(
      accessControl.read,
    );
    const updatePermissions: string = this.formatPermissionsForSchema(
      accessControl.update,
    );

    return `Permissions - Create: [${createPermissions}], Read: [${readPermissions}], Update: [${updatePermissions}]`;
  }

  public static getModelSchema(data: {
    modelType: new () => DatabaseBaseModel;
  }): ModelSchemaType {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();

    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

    const shape: ShapeRecord = {};

    // Get column access control for permission filtering
    const columnAccessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    for (const key in columns) {
      const column: TableColumnMetadata | undefined = columns[key];
      if (!column) {
        continue;
      }

      // Skip Entity columns but keep EntityArray columns
      if (column.type === TableColumnType.Entity) {
        continue;
      }

      // Filter out columns with no permissions (root-only access)
      const accessControl: ColumnAccessControl | undefined =
        columnAccessControl[key];
      if (accessControl) {
        // Check if column has any permissions defined for read operation (general schema assumes read access)
        const hasReadPermissions: boolean =
          accessControl.read && accessControl.read.length > 0;

        // If no read permissions are defined, exclude the column from general schema
        if (!hasReadPermissions) {
          continue;
        }
      }
      let zodType: ZodTypes.ZodTypeAny;

      if (column.type === TableColumnType.ObjectID) {
        zodType = ObjectID.getSchema();
      } else if (column.type === TableColumnType.Color) {
        zodType = Color.getSchema();
      } else if (column.type === TableColumnType.MonitorSteps) {
        zodType = MonitorSteps.getSchema();
      } else if (column.type === TableColumnType.Date) {
        zodType = OneUptimeDate.getSchema();
      } else if (column.type === TableColumnType.VeryLongText) {
        zodType = z.string().openapi({
          type: "string",
          example:
            "This is an example of very long text content that might be stored in this field. It can contain a lot of information, such as detailed descriptions, comments, or any other lengthy text data that needs to be stored in the database.",
        });
      } else if (
        column.type === TableColumnType.Number ||
        column.type === TableColumnType.PositiveNumber
      ) {
        const openapiConfig: any = { type: "number", example: 42 };
        if (column.defaultValue !== undefined) {
          openapiConfig.default = column.defaultValue;
        }
        zodType = z.number().openapi(openapiConfig);
      } else if (column.type === TableColumnType.Email) {
        zodType = Email.getSchema();
      } else if (column.type === TableColumnType.HashedString) {
        zodType = z
          .string()
          .openapi({ type: "string", example: "hashed_string_value" });
      } else if (column.type === TableColumnType.Slug) {
        zodType = z
          .string()
          .openapi({ type: "string", example: "example-slug-value" });
      } else if (column.type === TableColumnType.ShortText) {
        const openapiConfig: any = {
          type: "string",
          example: "Example short text",
        };
        if (column.defaultValue !== undefined) {
          openapiConfig.default = column.defaultValue;
        }
        zodType = z.string().openapi(openapiConfig);
      } else if (column.type === TableColumnType.LongText) {
        const openapiConfig: any = {
          type: "string",
          example:
            "This is an example of longer text content that might be stored in this field.",
        };
        if (column.defaultValue !== undefined) {
          openapiConfig.default = column.defaultValue;
        }
        zodType = z.string().openapi(openapiConfig);
      } else if (column.type === TableColumnType.Phone) {
        zodType = Phone.getSchema();
      } else if (column.type === TableColumnType.Version) {
        zodType = Version.getSchema();
      } else if (column.type === TableColumnType.Password) {
        zodType = z.string().openapi({
          type: "string",
          format: "password",
          example: "••••••••",
        });
      } else if (column.type === TableColumnType.Name) {
        zodType = Name.getSchema();
      } else if (column.type === TableColumnType.Description) {
        zodType = z.string().openapi({
          type: "string",
          example: "This is a description of the item",
        });
      } else if (column.type === TableColumnType.File) {
        zodType = z.any().openapi({
          type: "string",
          format: "binary",
        });
      } else if (column.type === TableColumnType.Buffer) {
        zodType = z.any().openapi({
          type: "string",
          format: "binary",
        });
      } else if (column.type === TableColumnType.ShortURL) {
        zodType = z.string().url().openapi({
          type: "string",
          example: "https://short.url/abc123",
        });
      } else if (column.type === TableColumnType.Markdown) {
        zodType = z.string().openapi({
          type: "string",
          example: "# Heading\n\nThis is **markdown** content",
        });
      } else if (column.type === TableColumnType.Domain) {
        zodType = Domain.getSchema();
      } else if (column.type === TableColumnType.Port) {
        zodType = Port.getSchema();
      } else if (column.type === TableColumnType.IP) {
        zodType = IP.getSchema();
      } else if (column.type === TableColumnType.LongURL) {
        zodType = z.string().url().openapi({
          type: "string",
          example: "https://www.example.com/path/to/resource?param=value",
        });
      } else if (column.type === TableColumnType.OTP) {
        zodType = z.string().openapi({
          type: "string",
          example: "123456",
        });
      } else if (column.type === TableColumnType.HTML) {
        zodType = z.string().openapi({
          type: "string",
          example: "<div><h1>Title</h1><p>Content</p></div>",
        });
      } else if (column.type === TableColumnType.JavaScript) {
        zodType = z.string().openapi({
          type: "string",
          example: "function example() { return true; }",
        });
      } else if (column.type === TableColumnType.CSS) {
        zodType = z.string().openapi({
          type: "string",
          example: "body { color: #333; margin: 0; }",
        });
      } else if (column.type === TableColumnType.Array) {
        zodType = z.array(z.any()).openapi({
          type: "array",
          items: {
            type: "string",
          },
          "x-ordered": column.ordered === true,
          example: ["item1", "item2", "item3"],
        });
      } else if (column.type === TableColumnType.SmallPositiveNumber) {
        const openapiConfig: any = {
          type: "integer",
          example: 5,
        };
        if (column.defaultValue !== undefined) {
          openapiConfig.default = column.defaultValue;
        }
        zodType = z.number().int().nonnegative().openapi(openapiConfig);
      } else if (column.type === TableColumnType.BigPositiveNumber) {
        const openapiConfig: any = {
          type: "number",
          example: 1000000,
        };
        if (column.defaultValue !== undefined) {
          openapiConfig.default = column.defaultValue;
        }
        zodType = z.number().nonnegative().openapi(openapiConfig);
      } else if (column.type === TableColumnType.SmallNumber) {
        const openapiConfig: any = {
          type: "integer",
          example: 10,
        };
        if (column.defaultValue !== undefined) {
          openapiConfig.default = column.defaultValue;
        }
        zodType = z.number().int().openapi(openapiConfig);
      } else if (column.type === TableColumnType.BigNumber) {
        const openapiConfig: any = {
          type: "number",
          example: 1000000,
        };
        if (column.defaultValue !== undefined) {
          openapiConfig.default = column.defaultValue;
        }
        zodType = z.number().openapi(openapiConfig);
      } else if (column.type === TableColumnType.Permission) {
        zodType = z.any().openapi({
          type: "object",
          example: { read: true, write: false, delete: false },
        });
      } else if (column.type === TableColumnType.CustomFieldType) {
        zodType = z.any().openapi({
          type: "object",
          example: { type: "text", required: true },
        });
      } else if (column.type === TableColumnType.MonitorType) {
        zodType = z.string().openapi({
          type: "string",
          example: "Manual",
        });
      } else if (column.type === TableColumnType.WorkflowStatus) {
        zodType = z.string().openapi({
          type: "string",
          example: "In Progress",
        });
      } else if (column.type === TableColumnType.Boolean) {
        const openapiConfig: any = { type: "boolean", example: true };
        if (column.defaultValue !== undefined) {
          openapiConfig.default = column.defaultValue;
        }
        zodType = z.boolean().openapi(openapiConfig);
      } else if (column.type === TableColumnType.JSON) {
        zodType = z.any().openapi({
          type: "object",
          example: { key: "value", nested: { data: 123 } },
        });
      } else if (column.type === TableColumnType.EntityArray) {
        const entityArrayType: (new () => DatabaseBaseModel) | undefined =
          column.modelType;
        if (!entityArrayType) {
          continue;
        }
        zodType = z
          .array(
            z.lazy(() => {
              return ModelSchema.getModelSchema({
                modelType: entityArrayType as new () => DatabaseBaseModel,
              });
            }),
          )
          .openapi({
            type: "array",
            items: {
              type: "object",
              properties: {
                _id: {
                  type: "string",
                  format: "uuid",
                  description: "Unique identifier for the entity",
                },
              },
            },
            "x-ordered": column.ordered === true,
            example: [
              {
                _id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
              },
            ],
          });
      } else if (column.type === TableColumnType.Entity) {
        const entityType: (new () => DatabaseBaseModel) | undefined =
          column.modelType;

        if (!entityType) {
          continue;
        }

        const schema: ModelSchemaType = ModelSchema.getModelSchema({
          modelType: entityType,
        });
        zodType = z
          .lazy(() => {
            return schema;
          })
          .openapi({
            type: "object",
            properties: {
              _id: {
                type: "string",
                format: "uuid",
                description: "Unique identifier for the entity",
                example: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
              },
            },
            example: {
              _id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            },
          });
      } else {
        // Fallback for unknown column types - use a generic object type
        zodType = z.any().openapi({
          type: "object",
          description: "Unknown type field",
          example: null,
        });
      }

      if (column.required) {
        // leave as is
      } else {
        zodType = zodType.optional();
      }

      // add title and description to the schema
      let finalDescription: string = "";

      // Add column description first if it exists
      if (column.description) {
        finalDescription = column.description;
      } else if (column.title) {
        finalDescription = column.title;
      }

      // Add permissions description, prefixed to the column description
      const permissionsDescription: string =
        this.getColumnPermissionsDescription(model, key);
      if (permissionsDescription) {
        if (finalDescription) {
          finalDescription = `${finalDescription}. ${permissionsDescription}`;
        } else {
          finalDescription = permissionsDescription;
        }
      }

      // Set the final combined description
      if (finalDescription) {
        zodType = zodType.describe(finalDescription);
      }

      // Mark computed fields as readOnly in OpenAPI spec
      if (column.computed) {
        zodType = zodType.openapi({ readOnly: true });
      }

      shape[key] = zodType;
    }

    const schema: ModelSchemaType = z.object(shape);

    return schema;
  }

  public static getSortableTypes(): Array<TableColumnType> {
    return [
      TableColumnType.VeryLongText,
      TableColumnType.Slug,
      TableColumnType.ShortText,
      TableColumnType.LongText,
      TableColumnType.Number,
      TableColumnType.Date,
      TableColumnType.Boolean,
      TableColumnType.Description,
      TableColumnType.ObjectID,
    ];
  }

  public static getQueryModelSchema(data: {
    modelType: new () => DatabaseBaseModel;
    disableOpenApiSchema?: boolean;
  }): ModelSchemaType {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();

    return this.generateQuerySchema({
      model,
      tableName: model.tableName || "model",
      getColumns: (model: DatabaseBaseModel) => {
        const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
        return Object.keys(columns)
          .map((key: string) => {
            const column: TableColumnMetadata | undefined = columns[key];
            return column ? { key, type: column.type } : null;
          })
          .filter((col: { key: string; type: any } | null) => {
            // Skip Entity columns but keep EntityArray columns
            if (col && col.type === TableColumnType.Entity) {
              return false;
            }
            return col !== null;
          }) as Array<{ key: string; type: any }>;
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

  private static getValidOperatorsForColumnType(
    columnType: TableColumnType,
  ): Array<string> {
    const commonOperators: Array<string> = [
      "EqualTo",
      "NotEqual",
      "IsNull",
      "NotNull",
      "EqualToOrNull",
    ];

    switch (columnType) {
      case TableColumnType.ObjectID:
      case TableColumnType.Email:
      case TableColumnType.Phone:
      case TableColumnType.HashedString:
      case TableColumnType.Slug:
        return [...commonOperators, "Includes"];

      case TableColumnType.ShortText:
      case TableColumnType.LongText:
      case TableColumnType.VeryLongText:
      case TableColumnType.Name:
      case TableColumnType.Description:
      case TableColumnType.Domain:
      case TableColumnType.Markdown:
        return [...commonOperators, "Search", "Includes"];

      case TableColumnType.Number:
      case TableColumnType.PositiveNumber:
      case TableColumnType.SmallNumber:
      case TableColumnType.SmallPositiveNumber:
      case TableColumnType.BigNumber:
      case TableColumnType.BigPositiveNumber:
        return [
          ...commonOperators,
          "GreaterThan",
          "LessThan",
          "GreaterThanOrEqual",
          "LessThanOrEqual",
          "InBetween",
        ];

      case TableColumnType.Date:
        return [
          ...commonOperators,
          "GreaterThan",
          "LessThan",
          "GreaterThanOrEqual",
          "LessThanOrEqual",
          "InBetween",
        ];

      case TableColumnType.Boolean:
        return commonOperators;

      case TableColumnType.JSON:
      case TableColumnType.Array:
        return ["EqualTo", "NotEqual", "IsNull", "NotNull"];

      case TableColumnType.Entity:
      case TableColumnType.EntityArray:
        return ["EqualTo", "NotEqual", "IsNull", "NotNull", "Includes"];

      case TableColumnType.Color:
      case TableColumnType.File:
      case TableColumnType.Buffer:
        return commonOperators;

      default:
        return commonOperators;
    }
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
      case "EqualToOrNull":
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

      case "InBetween":
        return z.object({
          _type: z.literal("InBetween"),
          startValue: baseValue,
          endValue: baseValue,
        });

      case "IsNull":
      case "NotNull":
        return z.object({
          _type: z.literal(operatorType),
        });

      case "Includes":
        return z.object({
          _type: z.literal("Includes"),
          value: z.array(baseValue),
        });

      default:
        return z.object({
          _type: z.literal(operatorType),
          value: baseValue,
        });
    }
  }

  private static getBaseValueSchemaForColumnType(
    columnType: TableColumnType,
  ): ZodTypes.ZodTypeAny {
    switch (columnType) {
      case TableColumnType.ObjectID:
        return ObjectID.getSchema();

      case TableColumnType.Email:
        return Email.getSchema();

      case TableColumnType.Phone:
        return Phone.getSchema();

      case TableColumnType.Name:
        return Name.getSchema();

      case TableColumnType.Domain:
        return Domain.getSchema();

      case TableColumnType.Version:
        return Version.getSchema();

      case TableColumnType.IP:
        return IP.getSchema();
      case TableColumnType.Port:
        return Port.getSchema();

      case TableColumnType.HashedString:
      case TableColumnType.Slug:
      case TableColumnType.ShortText:
      case TableColumnType.LongText:
      case TableColumnType.VeryLongText:
      case TableColumnType.Description:
      case TableColumnType.Markdown:
      case TableColumnType.HTML:
      case TableColumnType.JavaScript:
      case TableColumnType.CSS:
      case TableColumnType.LongURL:
      case TableColumnType.ShortURL:
      case TableColumnType.OTP:
      case TableColumnType.Password:
        return z.string();

      case TableColumnType.Number:
      case TableColumnType.PositiveNumber:
      case TableColumnType.SmallNumber:
      case TableColumnType.SmallPositiveNumber:
      case TableColumnType.BigNumber:
      case TableColumnType.BigPositiveNumber:
        return z.number();

      case TableColumnType.Date:
        return z.date();

      case TableColumnType.Boolean:
        return z.boolean();

      case TableColumnType.JSON:
      case TableColumnType.Array:
      case TableColumnType.Permission:
      case TableColumnType.CustomFieldType:
        return z.any();

      case TableColumnType.Color:
        return Color.getSchema();

      case TableColumnType.Entity:
        return z.string(); // Entity IDs are typically strings

      case TableColumnType.EntityArray:
        return z.array(z.string()); // Array of entity IDs

      case TableColumnType.File:
      case TableColumnType.Buffer:
        return z.any();

      case TableColumnType.MonitorType:
      case TableColumnType.WorkflowStatus:
        return z.string();

      default:
        return z.string();
    }
  }

  public static getSortModelSchema(data: {
    modelType: new () => DatabaseBaseModel;
    disableOpenApiSchema?: boolean;
  }): ModelSchemaType {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();

    return this.generateSortSchema({
      model,
      tableName: model.tableName || "model",
      getSortableTypes: () => {
        return this.getSortableTypes();
      },
      getColumnsForSorting: (model: DatabaseBaseModel) => {
        const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
        return Object.keys(columns)
          .map((key: string) => {
            const column: TableColumnMetadata | undefined = columns[key];
            return column ? { key, type: column.type } : null;
          })
          .filter((col: { key: string; type: any } | null) => {
            return col !== null;
          }) as Array<{ key: string; type: any }>;
      },
      disableOpenApiSchema: data.disableOpenApiSchema || false,
    });
  }

  public static getSelectModelSchema(data: {
    modelType: new () => DatabaseBaseModel;
    isNested?: boolean;
  }): ModelSchemaType {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();

    return this.generateSelectSchema({
      model,
      tableName: model.tableName || "model",
      getColumns: (model: DatabaseBaseModel) => {
        const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
        return Object.keys(columns)
          .map((key: string) => {
            const column: TableColumnMetadata | undefined = columns[key];
            return column ? { key, type: column.type } : null;
          })
          .filter((col: { key: string; type: any } | null) => {
            // Skip Entity columns but keep EntityArray columns
            if (col && col.type === TableColumnType.Entity) {
              return false;
            }
            return col !== null;
          }) as Array<{ key: string; type?: any }>;
      },
      getSelectSchemaExample: () => {
        return this.getSelectSchemaExample(modelType);
      },
      allowNested: !data.isNested,
      getNestedSchema: (key: string, model: DatabaseBaseModel) => {
        const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
        const column: TableColumnMetadata | undefined = columns[key];
        if (
          column &&
          column.modelType &&
          // Only allow EntityArray columns, exclude Entity columns
          column.type === TableColumnType.EntityArray
        ) {
          return this.getSelectModelSchema({
            modelType: column.modelType as new () => DatabaseBaseModel,
            isNested: true,
          });
        }
        return null;
      },
    });
  }

  public static getGroupByModelSchema(data: {
    modelType: new () => DatabaseBaseModel;
  }): ModelSchemaType {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();

    return this.generateGroupBySchema({
      model,
      tableName: model.tableName || "model",
      getColumns: (model: DatabaseBaseModel) => {
        const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
        return Object.keys(columns)
          .map((key: string) => {
            const column: TableColumnMetadata | undefined = columns[key];
            return column ? { key, type: column.type } : null;
          })
          .filter((col: { key: string; type: any } | null) => {
            // Skip Entity columns but keep EntityArray columns
            if (col && col.type === TableColumnType.Entity) {
              return false;
            }
            return col !== null;
          }) as Array<{ key: string; type: any }>;
      },
      getGroupableTypes: () => {
        return [
          TableColumnType.ShortText,
          TableColumnType.LongText,
          TableColumnType.Name,
          TableColumnType.Email,
          TableColumnType.Slug,
          TableColumnType.ObjectID,
          TableColumnType.Boolean,
          TableColumnType.Date,
          TableColumnType.Number,
          TableColumnType.PositiveNumber,
          TableColumnType.SmallNumber,
          TableColumnType.SmallPositiveNumber,
          TableColumnType.BigNumber,
          TableColumnType.BigPositiveNumber,
        ];
      },
      getGroupBySchemaExample: () => {
        return this.getGroupBySchemaExample(modelType);
      },
    });
  }

  private static getExampleValueForColumn(
    columnType: TableColumnType,
    isSecondValue: boolean = false,
  ): unknown {
    switch (columnType) {
      case TableColumnType.ObjectID:
        return isSecondValue
          ? "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
          : "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
      case TableColumnType.Email:
        return isSecondValue ? "jane@example.com" : "john@example.com";
      case TableColumnType.Phone:
        return isSecondValue ? "+1-555-987-6543" : "+1-555-123-4567";
      case TableColumnType.Number:
      case TableColumnType.PositiveNumber:
        return isSecondValue ? 100 : 50;
      case TableColumnType.SmallNumber:
        return isSecondValue ? 20 : 10;
      case TableColumnType.SmallPositiveNumber:
        return isSecondValue ? 25 : 15;
      case TableColumnType.BigNumber:
        return isSecondValue ? 2000000 : 1000000;
      case TableColumnType.BigPositiveNumber:
        return isSecondValue ? 2500000 : 1500000;
      case TableColumnType.Date:
        return isSecondValue
          ? "2023-12-31T23:59:59.000Z"
          : "2023-01-01T00:00:00.000Z";
      case TableColumnType.Boolean:
        return !isSecondValue;
      case TableColumnType.ShortText:
      case TableColumnType.Name:
        return isSecondValue ? "Jane Doe" : "John Doe";
      case TableColumnType.Description:
        return isSecondValue
          ? "Second example description"
          : "Example description";
      case TableColumnType.Domain:
        return isSecondValue ? "example.org" : "example.com";
      default:
        return isSecondValue ? "example_value_2" : "example_value_1";
    }
  }

  private static getQuerySchemaExample(
    modelType: new () => DatabaseBaseModel,
  ): SchemaExample {
    const model: DatabaseBaseModel = new modelType();
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
    const example: SchemaExample = {};

    let exampleCount: number = 0;
    const maxExamples: number = 3;

    for (const key in columns) {
      if (exampleCount >= maxExamples) {
        break;
      }

      const column: TableColumnMetadata | undefined = columns[key];
      if (!column) {
        continue;
      }

      const validOperators: Array<string> = this.getValidOperatorsForColumnType(
        column.type,
      );
      if (validOperators.length === 0) {
        continue;
      }

      // Add example based on column type and available operators
      if (
        column.type === TableColumnType.ShortText ||
        column.type === TableColumnType.Name
      ) {
        if (validOperators.includes("EqualTo")) {
          example[key] = { _type: "EqualTo", value: "Example Text" };
          exampleCount++;
        } else if (validOperators.includes("Search")) {
          example[key] = { _type: "Search", value: "example" };
          exampleCount++;
        }
      } else if (
        column.type === TableColumnType.Email &&
        validOperators.includes("EqualTo")
      ) {
        example[key] = { _type: "EqualTo", value: "user@example.com" };
        exampleCount++;
      } else if (
        column.type === TableColumnType.Date &&
        validOperators.includes("GreaterThan")
      ) {
        example[key] = {
          _type: "GreaterThan",
          value: "2023-01-01T00:00:00.000Z",
        };
        exampleCount++;
      } else if (
        column.type === TableColumnType.Boolean &&
        validOperators.includes("EqualTo")
      ) {
        example[key] = { _type: "EqualTo", value: true };
        exampleCount++;
      } else if (
        (column.type === TableColumnType.Number ||
          column.type === TableColumnType.PositiveNumber) &&
        validOperators.includes("GreaterThan")
      ) {
        example[key] = { _type: "GreaterThan", value: 10 };
        exampleCount++;
      } else if (validOperators.includes("EqualTo")) {
        example[key] = this.getExampleValueForColumn(column.type);
        exampleCount++;
      }
    }

    // If no examples were added, add a generic one
    if (exampleCount === 0) {
      example["_id"] = {
        _type: "EqualTo",
        value: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      };
    }

    return example;
  }

  private static getSelectSchemaExample(
    modelType: new () => DatabaseBaseModel,
  ): SchemaExample {
    if (!modelType) {
      throw new BadDataException(
        "Model type is required to generate select schema example.",
      );
    }

    const model: DatabaseBaseModel = new modelType();
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
    const example: SchemaExample = {};

    // Add common fields that most models have
    const commonFields: Array<string> = ["_id", "createdAt", "updatedAt"];
    for (const field of commonFields) {
      if (columns[field]) {
        example[field] = true;
      }
    }

    // Add first few non-common fields as examples
    let fieldCount: number = 0;
    const maxFields: number = 5;
    for (const key in columns) {
      if (fieldCount >= maxFields) {
        break;
      }

      const column: TableColumnMetadata | undefined = columns[key];
      if (!column || commonFields.includes(key)) {
        continue;
      }

      // Prioritize fields that are likely to be commonly selected
      if (
        column.type === TableColumnType.ShortText ||
        column.type === TableColumnType.Name ||
        column.type === TableColumnType.Email ||
        column.type === TableColumnType.Description
      ) {
        example[key] = true;
        fieldCount++;
      }
    }

    return example;
  }

  private static getGroupBySchemaExample(
    modelType: new () => DatabaseBaseModel,
  ): SchemaExample {
    if (!modelType) {
      throw new BadDataException(
        "Model type is required to generate group by schema example.",
      );
    }

    const model: DatabaseBaseModel = new modelType();
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

    // Find the first suitable field for grouping
    for (const key in columns) {
      const column: TableColumnMetadata | undefined = columns[key];
      if (!column) {
        continue;
      }

      // Prioritize common groupable fields
      if (
        column.type === TableColumnType.ShortText ||
        column.type === TableColumnType.Name ||
        column.type === TableColumnType.Boolean ||
        column.type === TableColumnType.Date
      ) {
        return { [key]: true };
      }
    }

    // Fallback to any available field
    for (const key in columns) {
      const column: TableColumnMetadata | undefined = columns[key];
      if (!column) {
        continue;
      }

      const isGroupable: boolean = [
        TableColumnType.ShortText,
        TableColumnType.LongText,
        TableColumnType.Name,
        TableColumnType.Email,
        TableColumnType.Slug,
        TableColumnType.ObjectID,
        TableColumnType.Boolean,
        TableColumnType.Date,
        TableColumnType.Number,
        TableColumnType.PositiveNumber,
        TableColumnType.SmallNumber,
        TableColumnType.SmallPositiveNumber,
        TableColumnType.BigNumber,
        TableColumnType.BigPositiveNumber,
      ].includes(column.type);

      if (isGroupable) {
        return { [key]: true };
      }
    }

    // Final fallback
    return { status: true };
  }

  // Shared method to build model schemas with different field exclusions
  private static buildModelSchema(data: {
    modelType: new () => DatabaseBaseModel;
    excludedFields?: string[];
    includedFields?: string[];
    schemaType: "create" | "read" | "update" | "delete";
    description: string;
    example: SchemaExample;
    makeOptional?: boolean;
    disableOpenApiSchema?: boolean;
  }): ModelSchemaType {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
    const shape: ShapeRecord = {};

    // Get column access control for permission filtering
    const columnAccessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    for (const key in columns) {
      const column: TableColumnMetadata | undefined = columns[key];
      if (!column) {
        continue;
      }

      if (column.hideColumnInDocumentation) {
        continue;
      }

      // Skip Entity columns but keep EntityArray columns
      if (column.type === TableColumnType.Entity) {
        continue;
      }

      // Skip excluded fields
      if (data.excludedFields && data.excludedFields.includes(key)) {
        continue;
      }

      // Only include specified fields if includedFields is provided
      if (data.includedFields && !data.includedFields.includes(key)) {
        continue;
      }

      // Skip computed fields for create and update operations
      if (
        column.computed &&
        (data.schemaType === "create" || data.schemaType === "update")
      ) {
        continue;
      }

      // Filter out columns with no permissions (root-only access)
      const accessControl: ColumnAccessControl | undefined =
        columnAccessControl[key];
      if (accessControl) {
        let hasPermissions: boolean = false;

        // Check if column has any permissions defined for the current operation
        if (
          data.schemaType === "create" &&
          accessControl.create &&
          accessControl.create.length > 0
        ) {
          hasPermissions = true;
        } else if (
          data.schemaType === "read" &&
          accessControl.read &&
          accessControl.read.length > 0
        ) {
          hasPermissions = true;
        } else if (
          data.schemaType === "update" &&
          accessControl.update &&
          accessControl.update.length > 0
        ) {
          hasPermissions = true;
        } else if (data.schemaType === "delete") {
          // For delete operations, we don't filter by column permissions
          hasPermissions = true;
        }

        // If no permissions are defined for this operation, exclude the column
        if (!hasPermissions) {
          continue;
        }
      }

      let zodType: ZodTypes.ZodTypeAny = this.getZodTypeForColumn(
        column,
        data.schemaType,
        data.disableOpenApiSchema || false,
      );

      /*
       * Check if the column is required and make it optional if not
       * Also make columns with default values optional in create schemas
       */
      if (column.isDefaultValueColumn) {
        // should be optional
        zodType = zodType.optional();
      } else if (
        column.title?.toLowerCase() === "project id" &&
        column.type === TableColumnType.ObjectID
      ) {
        // this is optional in the API as well as it's derived from API key
        zodType = zodType.optional();
      } else if (column.required) {
        // leave as is
      } else {
        zodType = zodType.optional();
      }

      // Make fields optional if specified (for global override)
      if (data.makeOptional) {
        zodType = zodType.optional();
      }

      // Add title and description to the schema
      let finalDescription: string = "";

      // Add column description first if it exists
      if (column.description) {
        finalDescription = column.description;
      } else if (column.title) {
        finalDescription = column.title;
      }

      // Add permissions description, prefixed to the column description
      const permissionsDescription: string =
        this.getColumnPermissionsDescription(model, key);
      if (permissionsDescription) {
        if (finalDescription) {
          finalDescription = `${finalDescription}. ${permissionsDescription}`;
        } else {
          finalDescription = permissionsDescription;
        }
      }

      // Set the final combined description
      if (finalDescription) {
        zodType = zodType.describe(finalDescription);
      }

      shape[key] = zodType;
    }

    const schema: ModelSchemaType = z.object(shape).openapi({
      description: `${data.description} schema for ${model.tableName || "model"} model. ${data.description}`,
      additionalProperties: false,
      example: data.example,
    });

    return schema;
  }

  // Helper method to get Zod type for a column
  private static getZodTypeForColumn(
    column: TableColumnMetadata,
    schemaType: "create" | "read" | "update" | "delete",
    disableOpenApiSchema: boolean = false,
  ): ZodTypes.ZodTypeAny {
    let zodType: ZodTypes.ZodTypeAny;

    // Helper function to add default value to openapi schema if it exists
    const addDefaultToOpenApi: (openApiConfig: any) => any = (
      openApiConfig: any,
    ): any => {
      if (column.defaultValue !== undefined && column.defaultValue !== null) {
        return { ...openApiConfig, default: column.defaultValue };
      }
      return openApiConfig;
    };

    // Helper function to conditionally apply OpenAPI schema
    const applyOpenApi: (
      baseType: ZodTypes.ZodTypeAny,
      openApiConfig: any,
    ) => ZodTypes.ZodTypeAny = (
      baseType: ZodTypes.ZodTypeAny,
      openApiConfig: any,
    ): ZodTypes.ZodTypeAny => {
      if (disableOpenApiSchema) {
        return baseType;
      }
      return baseType.openapi(addDefaultToOpenApi(openApiConfig));
    };

    if (column.type === TableColumnType.ObjectID) {
      zodType = ObjectID.getSchema();
    } else if (column.type === TableColumnType.Port) {
      zodType = Port.getSchema();
    } else if (column.type === TableColumnType.MonitorSteps) {
      zodType = MonitorSteps.getSchema();
    } else if (column.type === TableColumnType.IP) {
      zodType = IP.getSchema();
    } else if (column.type === TableColumnType.Color) {
      zodType = Color.getSchema();
    } else if (column.type === TableColumnType.Date) {
      zodType = OneUptimeDate.getSchema();
    } else if (column.type === TableColumnType.VeryLongText) {
      zodType = applyOpenApi(z.string(), {
        type: "string",
        example:
          "This is an example of very long text content that might be stored in this field. It can contain a lot of information, such as detailed descriptions, comments, or any other lengthy text data that needs to be stored in the database.",
      });
    } else if (
      column.type === TableColumnType.Number ||
      column.type === TableColumnType.PositiveNumber
    ) {
      zodType = applyOpenApi(z.number(), { type: "number", example: 42 });
    } else if (column.type === TableColumnType.Email) {
      zodType = Email.getSchema();
    } else if (column.type === TableColumnType.HashedString) {
      zodType = applyOpenApi(z.string(), {
        type: "string",
        example: "hashed_string_value",
      });
    } else if (column.type === TableColumnType.Slug) {
      zodType = applyOpenApi(z.string(), {
        type: "string",
        example: "example-slug-value",
      });
    } else if (column.type === TableColumnType.ShortText) {
      zodType = applyOpenApi(z.string(), {
        type: "string",
        example: "Example short text",
      });
    } else if (column.type === TableColumnType.LongText) {
      zodType = applyOpenApi(z.string(), {
        type: "string",
        example:
          "This is an example of longer text content that might be stored in this field.",
      });
    } else if (column.type === TableColumnType.Phone) {
      zodType = Phone.getSchema();
    } else if (column.type === TableColumnType.Version) {
      zodType = Version.getSchema();
    } else if (column.type === TableColumnType.Password) {
      zodType = applyOpenApi(z.string(), {
        type: "string",
        format: "password",
        example: "••••••••",
      });
    } else if (column.type === TableColumnType.Name) {
      zodType = Name.getSchema();
    } else if (column.type === TableColumnType.Description) {
      zodType = applyOpenApi(z.string(), {
        type: "string",
        example: "This is a description of the item",
      });
    } else if (column.type === TableColumnType.File) {
      zodType = applyOpenApi(z.any(), {
        type: "string",
        format: "binary",
      });
    } else if (column.type === TableColumnType.Buffer) {
      zodType = applyOpenApi(z.any(), {
        type: "string",
        format: "binary",
      });
    } else if (column.type === TableColumnType.ShortURL) {
      zodType = applyOpenApi(z.string().url(), {
        type: "string",
        example: "https://short.url/abc123",
      });
    } else if (column.type === TableColumnType.Markdown) {
      zodType = applyOpenApi(z.string(), {
        type: "string",
        example: "# Heading\n\nThis is **markdown** content",
      });
    } else if (column.type === TableColumnType.Domain) {
      zodType = Domain.getSchema();
    } else if (column.type === TableColumnType.LongURL) {
      zodType = applyOpenApi(z.string().url(), {
        type: "string",
        example: "https://www.example.com/path/to/resource?param=value",
      });
    } else if (column.type === TableColumnType.OTP) {
      zodType = applyOpenApi(z.string(), {
        type: "string",
        example: "123456",
      });
    } else if (column.type === TableColumnType.HTML) {
      zodType = applyOpenApi(z.string(), {
        type: "string",
        example: "<div><h1>Title</h1><p>Content</p></div>",
      });
    } else if (column.type === TableColumnType.JavaScript) {
      zodType = applyOpenApi(z.string(), {
        type: "string",
        example: "function example() { return true; }",
      });
    } else if (column.type === TableColumnType.CSS) {
      zodType = applyOpenApi(z.string(), {
        type: "string",
        example: "body { color: #333; margin: 0; }",
      });
    } else if (column.type === TableColumnType.Array) {
      zodType = z.array(z.any()).openapi(
        addDefaultToOpenApi({
          type: "array",
          items: {
            type: "string",
          },
          example: ["item1", "item2", "item3"],
        }),
      );
    } else if (column.type === TableColumnType.SmallPositiveNumber) {
      zodType = z
        .number()
        .int()
        .nonnegative()
        .openapi(
          addDefaultToOpenApi({
            type: "integer",
            example: 5,
          }),
        );
    } else if (column.type === TableColumnType.BigPositiveNumber) {
      zodType = z
        .number()
        .nonnegative()
        .openapi(
          addDefaultToOpenApi({
            type: "number",
            example: 1000000,
          }),
        );
    } else if (column.type === TableColumnType.SmallNumber) {
      zodType = z
        .number()
        .int()
        .openapi(
          addDefaultToOpenApi({
            type: "integer",
            example: 10,
          }),
        );
    } else if (column.type === TableColumnType.BigNumber) {
      zodType = z.number().openapi(
        addDefaultToOpenApi({
          type: "number",
          example: 1000000,
        }),
      );
    } else if (column.type === TableColumnType.Permission) {
      zodType = applyOpenApi(z.any(), {
        type: "object",
        example: { read: true, write: false, delete: false },
      });
    } else if (column.type === TableColumnType.CustomFieldType) {
      zodType = applyOpenApi(z.any(), {
        type: "object",
        example: { type: "text", required: true },
      });
    } else if (column.type === TableColumnType.MonitorType) {
      zodType = applyOpenApi(z.string(), {
        type: "string",
        example: "HTTP",
      });
    } else if (column.type === TableColumnType.WorkflowStatus) {
      zodType = applyOpenApi(z.string(), {
        type: "string",
        example: "In Progress",
      });
    } else if (column.type === TableColumnType.Boolean) {
      zodType = applyOpenApi(z.boolean(), { type: "boolean", example: true });
    } else if (column.type === TableColumnType.JSON) {
      zodType = applyOpenApi(z.any(), {
        type: "object",
        example: { key: "value", nested: { data: 123 } },
      });
    } else if (column.type === TableColumnType.EntityArray) {
      const entityArrayType: (new () => DatabaseBaseModel) | undefined =
        column.modelType;
      if (!entityArrayType) {
        return applyOpenApi(z.any(), {
          type: "array",
          items: { type: "object" },
          example: [],
        });
      }

      // Use the appropriate schema method based on the operation type
      let schemaMethod: SchemaMethodFunction;
      switch (schemaType) {
        case "create":
          schemaMethod = ModelSchema.getCreateModelSchema;
          break;
        case "read":
          schemaMethod = ModelSchema.getReadModelSchema;
          break;
        case "update":
          schemaMethod = ModelSchema.getUpdateModelSchema;
          break;
        case "delete":
          schemaMethod = ModelSchema.getDeleteModelSchema;
          break;
      }

      const arrayType: ZodTypes.ZodArray<
        ZodTypes.ZodLazy<ZodTypes.ZodTypeAny>
      > = z.array(
        z.lazy(() => {
          return schemaMethod({
            modelType: entityArrayType as new () => DatabaseBaseModel,
          });
        }),
      );

      zodType = disableOpenApiSchema
        ? arrayType
        : arrayType.openapi(
            addDefaultToOpenApi({
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                },
              },
              example: [{ id: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" }],
            }),
          );
    } else if (column.type === TableColumnType.Entity) {
      const entityType: (new () => DatabaseBaseModel) | undefined =
        column.modelType;

      if (!entityType) {
        return applyOpenApi(z.any(), {
          type: "object",
          description: "Entity reference",
          example: { _id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
        });
      }

      // Use the appropriate schema method based on the operation type
      let schema: ModelSchemaType;
      switch (schemaType) {
        case "create":
          schema = ModelSchema.getCreateModelSchema({ modelType: entityType });
          break;
        case "read":
          schema = ModelSchema.getReadModelSchema({ modelType: entityType });
          break;
        case "update":
          schema = ModelSchema.getUpdateModelSchema({ modelType: entityType });
          break;
        case "delete":
          schema = ModelSchema.getDeleteModelSchema({ modelType: entityType });
          break;
      }

      const lazyType: ZodTypes.ZodLazy<ZodTypes.ZodTypeAny> = z.lazy(() => {
        return schema;
      });

      zodType = disableOpenApiSchema
        ? lazyType
        : lazyType.openapi(
            addDefaultToOpenApi({
              type: "object",
              example: { id: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
            }),
          );
    } else {
      zodType = applyOpenApi(z.any(), { type: "null", example: null });
    }

    // Apply default value if it exists in the column metadata
    if (column.defaultValue !== undefined && column.defaultValue !== null) {
      zodType = zodType.default(column.defaultValue);
    }

    // Mark computed fields as readOnly in OpenAPI spec
    if (column.computed && !disableOpenApiSchema) {
      zodType = zodType.openapi({ readOnly: true });
    }

    return zodType;
  }

  public static getCreateModelSchema(data: {
    modelType: new () => DatabaseBaseModel;
    disableOpenApiSchema?: boolean;
  }): ModelSchemaType {
    // Auto-generated fields to exclude from create schema
    const excludedFields: Array<string> = [
      "_id",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "version",
    ];

    return this.buildModelSchema({
      modelType: data.modelType,
      excludedFields,
      schemaType: "create",
      description: "Create",
      example: this.generateDynamicExample({
        modelType: data.modelType,
        schemaType: "create",
        excludedFields,
      }),
      disableOpenApiSchema: data.disableOpenApiSchema || false,
    });
  }

  public static getReadModelSchema(data: {
    modelType: new () => DatabaseBaseModel;
  }): ModelSchemaType {
    // For read operations, include all fields
    return this.buildModelSchema({
      modelType: data.modelType,
      schemaType: "read",
      description: "Read",
      example: this.generateDynamicExample({
        modelType: data.modelType,
        schemaType: "read",
      }),
    });
  }

  public static getUpdateModelSchema(data: {
    modelType: new () => DatabaseBaseModel;
    disableOpenApiSchema?: boolean;
  }): ModelSchemaType {
    // Auto-generated fields to exclude from update schema (but allow _id for identification)
    const excludedFields: Array<string> = [
      "createdAt",
      "updatedAt",
      "deletedAt",
      "version",
    ];

    return this.buildModelSchema({
      modelType: data.modelType,
      excludedFields,
      schemaType: "update",
      description: "Update",
      example: this.generateDynamicExample({
        modelType: data.modelType,
        schemaType: "update",
        excludedFields,
      }),
      makeOptional: true, // All fields are optional for updates
      disableOpenApiSchema: data.disableOpenApiSchema || false,
    });
  }

  public static getDeleteModelSchema(data: {
    modelType: new () => DatabaseBaseModel;
  }): ModelSchemaType {
    // For delete, we typically only need the ID
    const includedFields: Array<string> = ["_id"];

    return this.buildModelSchema({
      modelType: data.modelType,
      includedFields,
      schemaType: "delete",
      description: "Delete",
      example: this.generateDynamicExample({
        modelType: data.modelType,
        schemaType: "delete",
        includedFields,
      }),
    });
  }

  private static generateDynamicExample(data: {
    modelType: new () => DatabaseBaseModel;
    schemaType: "create" | "read" | "update" | "delete";
    excludedFields?: Array<string>;
    includedFields?: Array<string>;
  }): SchemaExample {
    const model: DatabaseBaseModel = new data.modelType();
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
    const columnAccessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    const example: SchemaExample = {};

    for (const key in columns) {
      const column: TableColumnMetadata | undefined = columns[key];
      if (!column) {
        continue;
      }

      if (column.hideColumnInDocumentation) {
        continue;
      }

      // Skip excluded fields
      if (data.excludedFields && data.excludedFields.includes(key)) {
        continue;
      }

      // Only include specified fields if includedFields is provided
      if (data.includedFields && !data.includedFields.includes(key)) {
        continue;
      }

      // Skip default value columns in create schema examples
      if (data.schemaType === "create" && column.isDefaultValueColumn) {
        continue;
      }

      // Filter out columns with no permissions (root-only access)
      const accessControl: ColumnAccessControl | undefined =
        columnAccessControl[key];
      if (accessControl) {
        let hasPermissions: boolean = false;

        // Check if column has any permissions defined for the current operation
        if (
          data.schemaType === "create" &&
          accessControl.create &&
          accessControl.create.length > 0
        ) {
          hasPermissions = true;
        } else if (
          data.schemaType === "read" &&
          accessControl.read &&
          accessControl.read.length > 0
        ) {
          hasPermissions = true;
        } else if (
          data.schemaType === "update" &&
          accessControl.update &&
          accessControl.update.length > 0
        ) {
          hasPermissions = true;
        } else if (data.schemaType === "delete") {
          // For delete operations, we don't filter by column permissions
          hasPermissions = true;
        }

        // If no permissions are defined for this operation, exclude the column
        if (!hasPermissions) {
          continue;
        }
      }

      // For create and update, only include required fields
      if (
        (data.schemaType === "create" || data.schemaType === "update") &&
        !column.required
      ) {
        continue;
      }

      // Generate example value based on column type
      example[key] = this.generateExampleValueForColumn(column);
    }

    return example;
  }

  private static generateExampleValueForColumn(
    column: TableColumnMetadata,
  ): any {
    switch (column.type) {
      case TableColumnType.ObjectID:
        return "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

      case TableColumnType.ShortText:
        return this.getShortTextExample();

      case TableColumnType.LongText:
        return this.getLongTextExample();

      case TableColumnType.Email:
        return "user@example.com";

      case TableColumnType.Phone:
        return "+1-555-0123";

      case TableColumnType.LongURL:
        return "https://example.com";

      case TableColumnType.ShortURL:
        return "https://example.com";

      case TableColumnType.Number:
      case TableColumnType.SmallNumber:
      case TableColumnType.BigNumber:
        return 42;

      case TableColumnType.PositiveNumber:
      case TableColumnType.SmallPositiveNumber:
      case TableColumnType.BigPositiveNumber:
        return 100;

      case TableColumnType.Boolean:
        return true;

      case TableColumnType.Date:
        return {
          _type: "DateTime",
          value: "2023-10-01T12:00:00Z",
        };

      case TableColumnType.Color:
        return "#FF0000";

      case TableColumnType.JSON:
        return { key: "value", nested: { data: 123 } };

      case TableColumnType.Entity:
        return {
          _id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        };

      case TableColumnType.EntityArray:
        return [
          { _id: "cccccccc-cccc-cccc-cccc-cccccccccccc" },
          { _id: "dddddddd-dddd-dddd-dddd-dddddddddddd" },
        ];

      case TableColumnType.File:
        return {
          _id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
          name: "example-file.pdf",
          type: "application/pdf",
        };

      case TableColumnType.Version:
        return 1;

      case TableColumnType.Port:
        return 8080;

      case TableColumnType.HashedString:
        return "hashed_value_here";

      case TableColumnType.Slug:
        return "example-slug";

      case TableColumnType.Permission:
        return "read";

      default:
        return null;
    }
  }

  private static getShortTextExample(): string {
    return "Example Text";
  }

  private static getLongTextExample(): string {
    return "This is an example of longer text content that provides detailed information.";
  }
}
