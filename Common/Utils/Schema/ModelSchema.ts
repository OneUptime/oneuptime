import z, { ZodSchema } from "./Zod";
import TableColumnType from "../../Types/Database/TableColumnType";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../Types/Database/TableColumn";
import Dictionary from "../../Types/Dictionary";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import logger from "../../Server/Utils/Logger";
import Color from "../../Types/Color";

export type ModelSchemaType = ZodSchema;

export class ModelSchema {
  public static getModelSchema(data: {
    modelType: new () => DatabaseBaseModel;
  }): ModelSchemaType {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();

    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

    const shape: Record<string, any> = {};

    for (const key in columns) {
      const column: TableColumnMetadata | undefined = columns[key];
      if (!column) {
        continue;
      }
      let zodType: any;

      if (column.type === TableColumnType.ObjectID) {
        zodType = z.string().openapi({
          type: "string",
          example: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        });
      } else if (column.type === TableColumnType.Color) {
        zodType = Color.getSchema();
      } else if (column.type === TableColumnType.Date) {
        zodType = z.date().openapi({
          type: "string",
          format: "date-time",
          example: "2023-01-15T12:30:00.000Z",
        });
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
        zodType = z.number().openapi({ type: "number", example: 42 });
      } else if (column.type === TableColumnType.Email) {
        zodType = z.string().email().openapi({
          type: "string",
          format: "email",
          example: "user@example.com",
        });
      } else if (column.type === TableColumnType.HashedString) {
        zodType = z
          .string()
          .openapi({ type: "string", example: "hashed_string_value" });
      } else if (column.type === TableColumnType.Slug) {
        zodType = z
          .string()
          .openapi({ type: "string", example: "example-slug-value" });
      } else if (column.type === TableColumnType.ShortText) {
        zodType = z
          .string()
          .openapi({ type: "string", example: "Example short text" });
      } else if (column.type === TableColumnType.LongText) {
        zodType = z.string().openapi({
          type: "string",
          example:
            "This is an example of longer text content that might be stored in this field.",
        });
      } else if (column.type === TableColumnType.Phone) {
        zodType = z
          .string()
          .openapi({ type: "string", example: "+1-555-123-4567" });
      } else if (column.type === TableColumnType.Version) {
        zodType = z.string().openapi({
          type: "string",
          example: "1.0.0",
        });
      } else if (column.type === TableColumnType.Password) {
        zodType = z.string().openapi({
          type: "string",
          format: "password",
          example: "••••••••",
        });
      } else if (column.type === TableColumnType.Name) {
        zodType = z.string().openapi({
          type: "string",
          example: "John Doe",
        });
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
        zodType = z.string().openapi({
          type: "string",
          example: "example.com",
        });
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
          example: ["item1", "item2", "item3"],
        });
      } else if (column.type === TableColumnType.SmallPositiveNumber) {
        zodType = z.number().int().nonnegative().openapi({
          type: "integer",
          example: 5,
        });
      } else if (column.type === TableColumnType.BigPositiveNumber) {
        zodType = z.number().nonnegative().openapi({
          type: "number",
          example: 1000000,
        });
      } else if (column.type === TableColumnType.SmallNumber) {
        zodType = z.number().int().openapi({
          type: "integer",
          example: 10,
        });
      } else if (column.type === TableColumnType.BigNumber) {
        zodType = z.number().openapi({
          type: "number",
          example: 1000000,
        });
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
          example: "HTTP",
        });
      } else if (column.type === TableColumnType.WorkflowStatus) {
        zodType = z.string().openapi({
          type: "string",
          example: "In Progress",
        });
      } else if (column.type === TableColumnType.Boolean) {
        zodType = z.boolean().openapi({ type: "boolean", example: true });
      } else if (column.type === TableColumnType.JSON) {
        zodType = z.any().openapi({
          type: "object",
          example: { key: "value", nested: { data: 123 } },
        });
      } else if (column.type === TableColumnType.EntityArray) {
        const entityArrayType: (new () => DatabaseBaseModel) | undefined =
          column.modelType;
        if (!entityArrayType) {
          logger.debug(`Entity type is not defined for column ${key}`);
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
                id: { type: "string" },
              },
            },
            example: [{ id: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" }],
          });
      } else if (column.type === TableColumnType.Entity) {
        const entityType: (new () => DatabaseBaseModel) | undefined =
          column.modelType;

        if (!entityType) {
          logger.debug(`Entity type is not defined for column ${key}`);
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
            example: { id: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
          });
      } else {
        zodType = z.any().openapi({ type: "null", example: null });
      }

      if (column.required) {
        // leave as is
      } else {
        zodType = zodType.optional();
      }

      // add title and description to the schema
      if (column.title) {
        zodType = zodType.describe(column.title);
      }

      shape[key] = zodType;
    }

    const schema: ModelSchemaType = z.object(shape);

    logger.debug(
      `Model schema for ${model.tableName} created with shape: ${JSON.stringify(
        shape,
        null,
        2,
      )}`,
    );

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
  }): ModelSchemaType {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();

    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

    const shape: Record<string, any> = {};

    for (const key in columns) {
      const column: TableColumnMetadata | undefined = columns[key];
      if (!column) {
        continue;
      }

      // Get valid operators for this column type
      const validOperators = this.getValidOperatorsForColumnType(column.type);
      
      if (validOperators.length === 0) {
        continue;
      }

      // Create a union type of all valid operators for this column
      const operatorSchemas = validOperators.map(operatorType => 
        this.getOperatorSchema(operatorType, column.type)
      );

      let columnSchema: any;
      if (operatorSchemas.length === 1) {
        columnSchema = operatorSchemas[0].optional();
      } else {
        columnSchema = z.union(operatorSchemas as [any, any, ...any[]]).optional();
      }

      // Add OpenAPI documentation for query operators
      const operatorExamples = this.getQueryOperatorExamples(column.type, validOperators);
      columnSchema = columnSchema.openapi({
        type: "object",
        description: `Query operators for ${key} field of type ${column.type}`,
        oneOf: operatorExamples.map(example => ({
          type: "object",
          properties: example.properties,
          required: example.required,
          example: example.example
        }))
      });

      shape[key] = columnSchema;
    }

    const schema = z.object(shape).openapi({
      type: "object",
      description: `Query schema for ${model.tableName || 'model'} model. Each field can use various operators based on its data type.`,
      example: this.getQuerySchemaExample(model.tableName || 'model')
    });

    return schema;
  }

  private static getValidOperatorsForColumnType(columnType: TableColumnType): Array<string> {
    const commonOperators = ["EqualTo", "NotEqual", "IsNull", "NotNull", "EqualToOrNull"];
    
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
        return [...commonOperators, "GreaterThan", "LessThan", "GreaterThanOrEqual", "LessThanOrEqual", "InBetween"];
        
      case TableColumnType.Date:
        return [...commonOperators, "GreaterThan", "LessThan", "GreaterThanOrEqual", "LessThanOrEqual", "InBetween"];
        
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

  private static getOperatorSchema(operatorType: string, columnType: TableColumnType): any {
    const baseValue = this.getBaseValueSchemaForColumnType(columnType);
    
    switch (operatorType) {
      case "EqualTo":
      case "NotEqual":
      case "EqualToOrNull":
        return z.object({
          _type: z.literal(operatorType),
          value: baseValue
        });
        
      case "GreaterThan":
      case "LessThan":
      case "GreaterThanOrEqual":
      case "LessThanOrEqual":
        return z.object({
          _type: z.literal(operatorType),
          value: baseValue
        });
        
      case "Search":
        return z.object({
          _type: z.literal("Search"),
          value: z.string()
        });
        
      case "InBetween":
        return z.object({
          _type: z.literal("InBetween"),
          startValue: baseValue,
          endValue: baseValue
        });
        
      case "IsNull":
      case "NotNull":
        return z.object({
          _type: z.literal(operatorType)
        });
        
      case "Includes":
        return z.object({
          _type: z.literal("Includes"),
          value: z.array(baseValue)
        });
        
      default:
        return z.object({
          _type: z.literal(operatorType),
          value: baseValue
        });
    }
  }

  private static getBaseValueSchemaForColumnType(columnType: TableColumnType): any {
    switch (columnType) {
      case TableColumnType.ObjectID:
        return z.string();
        
      case TableColumnType.Email:
        return z.string().email();
        
      case TableColumnType.Phone:
      case TableColumnType.HashedString:
      case TableColumnType.Slug:
      case TableColumnType.ShortText:
      case TableColumnType.LongText:
      case TableColumnType.VeryLongText:
      case TableColumnType.Name:
      case TableColumnType.Description:
      case TableColumnType.Domain:
      case TableColumnType.Markdown:
      case TableColumnType.HTML:
      case TableColumnType.JavaScript:
      case TableColumnType.CSS:
      case TableColumnType.LongURL:
      case TableColumnType.ShortURL:
      case TableColumnType.OTP:
      case TableColumnType.Password:
      case TableColumnType.Version:
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
  }): ModelSchemaType {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();

    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

    const shape: Record<string, any> = {};

    for (const key in columns) {
      const column: TableColumnMetadata | undefined = columns[key];
      if (!column) {
        continue;
      }

      const isSortable: boolean = ModelSchema.getSortableTypes().includes(
        column.type,
      );

      if (!isSortable) {
        continue;
      }

      shape[key] = z
        .enum([SortOrder.Ascending, SortOrder.Descending])
        .optional()
        .openapi({
          type: "string",
          enum: [SortOrder.Ascending, SortOrder.Descending],
          description: `Sort order for ${key} field`,
          example: SortOrder.Ascending
        });
    }

    return z.object(shape).openapi({
      type: "object",
      description: `Sort schema for ${model.tableName || 'model'} model. Only sortable fields are included.`,
      example: this.getSortSchemaExample(),
      additionalProperties: false
    });
  }

  public static getSelectModelSchema(data: {
    modelType: new () => DatabaseBaseModel;
    isNested?: boolean;
  }): ModelSchemaType {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();

    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

    const shape: Record<string, any> = {};

    for (const key in columns) {
      const column: TableColumnMetadata | undefined = columns[key];
      if (!column) {
        continue;
      }

      // if its entity array or entity then you can select nested properties
      if (
        !data.isNested &&
        column.modelType &&
        (column.type === TableColumnType.EntityArray ||
          column.type === TableColumnType.Entity)
      ) {
        // can only do one level of nesting
        shape[key] = this.getSelectModelSchema({
          modelType: column.modelType as new () => DatabaseBaseModel,
          isNested: true,
        }).openapi({
          type: "object",
          description: `Select fields for nested ${key} entity`,
          example: { id: true, name: true }
        });
        continue;
      }

      shape[key] = z.boolean().optional().openapi({
        type: "boolean",
        description: `Select ${key} field in the response`,
        example: true
      });
    }

    return z.object(shape).openapi({
      type: "object",
      description: `Select schema for ${model.tableName || 'model'} model. Set fields to true to include them in the response.`,
      example: this.getSelectSchemaExample(),
      additionalProperties: false
    });
  }

  private static getQueryOperatorExamples(columnType: TableColumnType, validOperators: Array<string>): Array<any> {
    const examples: Array<any> = [];
    
    for (const operator of validOperators) {
      switch (operator) {
        case "EqualTo":
          examples.push({
            properties: {
              _type: { type: "string", enum: ["EqualTo"] },
              value: { type: this.getOpenAPITypeForColumn(columnType) }
            },
            required: ["_type", "value"],
            example: { _type: "EqualTo", value: this.getExampleValueForColumn(columnType) }
          });
          break;
        case "NotEqual":
          examples.push({
            properties: {
              _type: { type: "string", enum: ["NotEqual"] },
              value: { type: this.getOpenAPITypeForColumn(columnType) }
            },
            required: ["_type", "value"],
            example: { _type: "NotEqual", value: this.getExampleValueForColumn(columnType) }
          });
          break;
        case "Search":
          examples.push({
            properties: {
              _type: { type: "string", enum: ["Search"] },
              value: { type: "string" }
            },
            required: ["_type", "value"],
            example: { _type: "Search", value: "search term" }
          });
          break;
        case "GreaterThan":
          examples.push({
            properties: {
              _type: { type: "string", enum: ["GreaterThan"] },
              value: { type: this.getOpenAPITypeForColumn(columnType) }
            },
            required: ["_type", "value"],
            example: { _type: "GreaterThan", value: this.getExampleValueForColumn(columnType) }
          });
          break;
        case "LessThan":
          examples.push({
            properties: {
              _type: { type: "string", enum: ["LessThan"] },
              value: { type: this.getOpenAPITypeForColumn(columnType) }
            },
            required: ["_type", "value"],
            example: { _type: "LessThan", value: this.getExampleValueForColumn(columnType) }
          });
          break;
        case "GreaterThanOrEqual":
          examples.push({
            properties: {
              _type: { type: "string", enum: ["GreaterThanOrEqual"] },
              value: { type: this.getOpenAPITypeForColumn(columnType) }
            },
            required: ["_type", "value"],
            example: { _type: "GreaterThanOrEqual", value: this.getExampleValueForColumn(columnType) }
          });
          break;
        case "LessThanOrEqual":
          examples.push({
            properties: {
              _type: { type: "string", enum: ["LessThanOrEqual"] },
              value: { type: this.getOpenAPITypeForColumn(columnType) }
            },
            required: ["_type", "value"],
            example: { _type: "LessThanOrEqual", value: this.getExampleValueForColumn(columnType) }
          });
          break;
        case "EqualToOrNull":
          examples.push({
            properties: {
              _type: { type: "string", enum: ["EqualToOrNull"] },
              value: { type: this.getOpenAPITypeForColumn(columnType) }
            },
            required: ["_type", "value"],
            example: { _type: "EqualToOrNull", value: this.getExampleValueForColumn(columnType) }
          });
          break;
        case "InBetween":
          examples.push({
            properties: {
              _type: { type: "string", enum: ["InBetween"] },
              startValue: { type: this.getOpenAPITypeForColumn(columnType) },
              endValue: { type: this.getOpenAPITypeForColumn(columnType) }
            },
            required: ["_type", "startValue", "endValue"],
            example: { 
              _type: "InBetween", 
              startValue: this.getExampleValueForColumn(columnType),
              endValue: this.getExampleValueForColumn(columnType, true)
            }
          });
          break;
        case "IsNull":
          examples.push({
            properties: {
              _type: { type: "string", enum: ["IsNull"] }
            },
            required: ["_type"],
            example: { _type: "IsNull" }
          });
          break;
        case "NotNull":
          examples.push({
            properties: {
              _type: { type: "string", enum: ["NotNull"] }
            },
            required: ["_type"],
            example: { _type: "NotNull" }
          });
          break;
        case "Includes":
          examples.push({
            properties: {
              _type: { type: "string", enum: ["Includes"] },
              value: { 
                type: "array",
                items: { type: this.getOpenAPITypeForColumn(columnType) }
              }
            },
            required: ["_type", "value"],
            example: { 
              _type: "Includes", 
              value: [this.getExampleValueForColumn(columnType), this.getExampleValueForColumn(columnType, true)]
            }
          });
          break;
      }
    }
    
    return examples;
  }

  private static getOpenAPITypeForColumn(columnType: TableColumnType): string {
    switch (columnType) {
      case TableColumnType.Number:
      case TableColumnType.PositiveNumber:
      case TableColumnType.SmallNumber:
      case TableColumnType.SmallPositiveNumber:
      case TableColumnType.BigNumber:
      case TableColumnType.BigPositiveNumber:
        return "number";
      case TableColumnType.Boolean:
        return "boolean";
      case TableColumnType.Date:
        return "string";
      case TableColumnType.JSON:
      case TableColumnType.Array:
        return "object";
      default:
        return "string";
    }
  }

  private static getExampleValueForColumn(columnType: TableColumnType, isSecondValue: boolean = false): any {
    switch (columnType) {
      case TableColumnType.ObjectID:
        return isSecondValue ? "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" : "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
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
        return isSecondValue ? "2023-12-31T23:59:59.000Z" : "2023-01-01T00:00:00.000Z";
      case TableColumnType.Boolean:
        return isSecondValue ? false : true;
      case TableColumnType.ShortText:
      case TableColumnType.Name:
        return isSecondValue ? "Jane Doe" : "John Doe";
      case TableColumnType.Description:
        return isSecondValue ? "Second example description" : "Example description";
      case TableColumnType.Domain:
        return isSecondValue ? "example.org" : "example.com";
      default:
        return isSecondValue ? "example_value_2" : "example_value_1";
    }
  }

  private static getQuerySchemaExample(_tableName: string): any {
    return {
      name: {
        _type: "Search",
        value: "john"
      },
      email: {
        _type: "EqualTo", 
        value: "john@example.com"
      },
      createdAt: {
        _type: "GreaterThan",
        value: "2023-01-01T00:00:00.000Z"
      }
    };
  }

  private static getSortSchemaExample(): any {
    return {
      name: "Ascending",
      createdAt: "Descending"
    };
  }

  private static getSelectSchemaExample(): any {
    return {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      updatedAt: false
    };
  }
}
