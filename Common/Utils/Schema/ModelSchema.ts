import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import TableColumnType from "../../Types/Database/TableColumnType";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../Types/Database/TableColumn";
import Dictionary from "../../Types/Dictionary";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

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
      switch (column.type) {
        case TableColumnType.ObjectID:
          zodType = z.string();
          break;
        case TableColumnType.Date:
          zodType = z.date();
          break;
        case TableColumnType.Version:
        case TableColumnType.Number:
        case TableColumnType.PositiveNumber:
          zodType = z.number();
          break;
        case TableColumnType.Email:
          zodType = z.string().email();
          break;
        case TableColumnType.HashedString:
        case TableColumnType.Slug:
        case TableColumnType.ShortText:
        case TableColumnType.LongText:
        case TableColumnType.Phone:
          zodType = z.string();
          break;
        case TableColumnType.Boolean:
          zodType = z.boolean();
          break;
        case TableColumnType.JSON:
          zodType = z.any();
          break;
        case TableColumnType.EntityArray:
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
            })
          );
          break;
        case TableColumnType.Entity:
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
          break;
        default:
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

    const schema: ModelSchemaType = z.object(shape).openapi(model.tableName!, openApiKeyValue);
    return schema;
  }
}
