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
      } if (column.type === TableColumnType.Color) {
        zodType = Color.getSchema();
      }  else if (column.type === TableColumnType.Date) {
        zodType = z.date().openapi({
          type: "string",
          format: "date-time",
          example: "2023-01-15T12:30:00.000Z",
        });
      } else if (
        column.type === TableColumnType.Version ||
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
        const schemaArray: ModelSchemaType = ModelSchema.getModelSchema({
          modelType: entityArrayType,
        });
        zodType = z
          .array(
            z.lazy(() => {
              return schemaArray;
            })
          )
          .openapi({
            type: "array",
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
        2
      )}`
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

      // There are these query operators.
    }

    return z.object(shape);
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
        column.type
      );

      if (!isSortable) {
        continue;
      }

      shape[key] = z
        .enum([SortOrder.Ascending, SortOrder.Descending])
        .optional();
    }

    return z.object(shape);
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
        });
        continue;
      }

      shape[key] = z.boolean().optional();
    }

    return z.object(shape);
  }
}
