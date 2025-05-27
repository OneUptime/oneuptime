import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import TableColumnType from "../../Types/Database/TableColumnType";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../Types/Database/TableColumn";
import Dictionary from "../../Types/Dictionary";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SortOrder from "../../Types/BaseDatabase/SortOrder";

extendZodWithOpenApi(z);

export default z;

export type ModelSchemaType = z.ZodObject<
  Record<string, any>,
  "strip",
  z.ZodTypeAny,
  {
    [x: string]: any;
  },
  {
    [x: string]: any;
  }
>;

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
        zodType = z.string();
      } else if (column.type === TableColumnType.Date) {
        zodType = z.date();
      } else if (
        column.type === TableColumnType.Version ||
        column.type === TableColumnType.Number ||
        column.type === TableColumnType.PositiveNumber
      ) {
        zodType = z.number();
      } else if (column.type === TableColumnType.Email) {
        zodType = z.string().email();
      } else if (
        column.type === TableColumnType.HashedString ||
        column.type === TableColumnType.Slug ||
        column.type === TableColumnType.ShortText ||
        column.type === TableColumnType.LongText ||
        column.type === TableColumnType.Phone
      ) {
        zodType = z.string();
      } else if (column.type === TableColumnType.Boolean) {
        zodType = z.boolean();
      } else if (column.type === TableColumnType.JSON) {
        zodType = z.any();
      } else if (column.type === TableColumnType.EntityArray) {
        const entityArrayType: (new () => DatabaseBaseModel) | undefined =
          column.modelType;
        if (!entityArrayType) {
          throw new Error(`Entity type is not defined for column ${key}`);
        }
        const schemaArray: ModelSchemaType = ModelSchema.getModelSchema({
          modelType: entityArrayType,
        });
        zodType = z.array(
          z.lazy(() => {
            return schemaArray;
          }),
        );
      } else if (column.type === TableColumnType.Entity) {
        const entityType: (new () => DatabaseBaseModel) | undefined =
          column.modelType;

        if (!entityType) {
          throw new Error(`Entity type is not defined for column ${key}`);
        }

        const schema: ModelSchemaType = ModelSchema.getModelSchema({
          modelType: entityType,
        });
        zodType = z.lazy(() => {
          return schema;
        });
      } else {
        zodType = z.any();
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

      const openApiKeyValue: Dictionary<any> = {};

      // add title and description to OpenAPI schema
      if (column.title) {
        openApiKeyValue["title"] = column.title;
      }

      if (column.description) {
        openApiKeyValue["description"] = column.description;
      }

      zodType = zodType.openapi(openApiKeyValue);

      shape[key] = zodType;
    }

    const openApiKeyValue: Dictionary<any> = {
      name: model.tableName,
      title: model.singularName,
      pluralTitle: model.pluralName,
      description: model.tableDescription || "",
      type: "object",
    };

    const schema: ModelSchemaType = z
      .object(shape)
      .openapi(model.tableName!, openApiKeyValue);
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

      if (column.type === TableColumnType.EntityArray) {
        continue; // skip entity arrays
      }

      shape[key] = z.any().optional();
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
      

      const isSortable: boolean =  
        ModelSchema.getSortableTypes().includes(column.type);

      if (!isSortable) {
        continue;
      }

      shape[key] = z.enum([SortOrder.Ascending, SortOrder.Descending]).optional();

    }

    return z.object(shape);
  }
}
