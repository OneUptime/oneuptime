import { z as ZodTypes } from "zod";
import z, { ZodSchema } from "./Zod";
import SortNulls from "../../Types/BaseDatabase/SortNulls";
import SortOrder from "../../Types/BaseDatabase/SortOrder";

export type BaseSchemaType = ZodSchema;

// Type for schema examples
export type SchemaExample = Record<string, unknown>;

// Type for shape objects using Zod's type inference
export type ShapeRecord = Record<string, ZodTypes.ZodTypeAny>;

// Type for operator examples in OpenAPI format
export type OperatorExample = {
  properties: Record<
    string,
    {
      type: string;
      enum?: string[];
      items?: { type: string };
    }
  >;
  required: string[];
  example: Record<string, unknown>;
};

/*
 * Columns a query, sort or select may name though no permission reads them:
 * the API lets these through before it looks at a column's readers
 * (ColumnPermission.getExcludedColumnNames, and ModelPermission's for
 * telemetry). It refuses any other column nobody may read.
 */
export const ALWAYS_READABLE_COLUMNS: Array<string> = [
  "_id",
  "createdAt",
  "deletedAt",
  "updatedAt",
  "version",
];

/*
 * ASC or DESC, as a sort field takes it. Published once, as SortOrder, which
 * every sort field refers to: spelled out on each of the 6,700 sort fields it
 * was 0.5 MB of the spec, and a client generated from it had a type for each.
 */
const SORT_ORDER_SCHEMA: ZodTypes.ZodTypeAny = z
  .enum([SortOrder.Ascending, SortOrder.Descending])
  .openapi("SortOrder", {
    description: "The order of a sort: ASC (ascending) or DESC (descending).",
    example: SortOrder.Descending,
  });

/*
 * How a field of a database record orders a list (#8141, #8840): ASC or
 * DESC, or { direction, nulls } to say where the records with no value go.
 * Published once, as SortFieldOrder, which every such field refers to, so
 * the spec does not spell it out thousands of times.
 *
 * What the API reads as written (SortValidator.isFieldOrder) takes more -
 * "asc", 1, -1, a lower-case "last", a nulls with no direction - and this
 * is the part of it a client is offered: what each SDK and the Terraform
 * provider type a sort as. A telemetry list orders by ASC or DESC only
 * (StatementGenerator.toSortStatement), so AnalyticsModelSchema keeps
 * SortOrder.
 */
export const SORT_FIELD_ORDER_SCHEMA: ZodTypes.ZodTypeAny = z
  .union([
    SORT_ORDER_SCHEMA,
    z
      .object({
        direction: SORT_ORDER_SCHEMA,
        nulls: z.enum([SortNulls.First, SortNulls.Last]).optional().openapi({
          description:
            "Where the records with no value in this field go: FIRST or LAST. Left out, PostgreSQL puts them last in an ascending sort and first in a descending one.",
        }),
      })
      .openapi({ additionalProperties: false }),
  ])
  .openapi("SortFieldOrder", {
    description:
      'How a field orders a list: ASC or DESC, or { "direction": "DESC", "nulls": "LAST" } to say where the records with no value in it go.',
    example: { direction: SortOrder.Descending, nulls: SortNulls.Last },
  });

/*
 * What a sort may name of a model: a column, ordered by `type`, or a
 * relation, which sorts by the fields of the related record its `schema`
 * names.
 */
export interface SortColumn {
  key: string;
  type: any;
  schema?: ZodTypes.ZodTypeAny | undefined;
}

/**
 * Base class for schema generation with common functionality
 * Both ModelSchema and AnalyticsModelSchema extend this class
 *
 * No object schema here names a `type` in .openapi(): zod-to-openapi takes a
 * `type` there for the whole schema and leaves out the properties it would
 * have generated, so the spec listed no field of any sort, select or group
 * by. A field's own `type` is kept, where it is a plain value's.
 */
export abstract class BaseSchema {
  /**
   * Generate a sort schema for a model: each column of a sortable type
   * takes `fieldOrderSchema` (ASC or DESC, unless given more), and a
   * relation the schema its column carries.
   */
  protected static generateSortSchema<T>(data: {
    model: T;
    tableName?: string;
    getSortableTypes: () => Array<any>;
    getColumnsForSorting: (model: T) => Array<SortColumn>;
    fieldOrderSchema?: ZodTypes.ZodTypeAny;
    description?: string;
    disableOpenApiSchema?: boolean;
  }): BaseSchemaType {
    const shape: ShapeRecord = {};
    const columns: Array<SortColumn> = data.getColumnsForSorting(data.model);
    const fieldOrderSchema: ZodTypes.ZodTypeAny =
      data.fieldOrderSchema || SORT_ORDER_SCHEMA;

    for (const column of columns) {
      const key: string = column.key;

      // A relation: what it says of its related record is all it takes.
      if (column.schema) {
        shape[key] = column.schema.optional();
        continue;
      }

      const isSortable: boolean = data.getSortableTypes().includes(column.type);

      if (!isSortable) {
        continue;
      }

      shape[key] = fieldOrderSchema.optional();
    }

    return this.applyOpenApi(
      z.object(shape),
      {
        description:
          data.description ||
          `Sort schema for ${data.tableName || "model"}. Only sortable fields are included.`,
        example: shape["createdAt"] ? { createdAt: SortOrder.Descending } : {},
        additionalProperties: false,
      },
      data.disableOpenApiSchema || false,
    );
  }

  /**
   * Generate a select schema for a model
   */
  protected static generateSelectSchema<T>(data: {
    model: T;
    tableName?: string;
    getColumns: (model: T) => Array<{ key: string; type?: any }>;
    getSelectSchemaExample: (model: T) => SchemaExample;
    allowNested?: boolean;
    getNestedSchema?: (key: string, model: T) => ZodTypes.ZodTypeAny | null;
  }): BaseSchemaType {
    const shape: ShapeRecord = {};
    const columns: Array<{ key: string; type?: any }> = data.getColumns(
      data.model,
    );

    for (const column of columns) {
      const key: string = column.key;

      // Handle nested schemas if allowed and available
      if (data.allowNested && data.getNestedSchema) {
        const nestedSchema: ZodTypes.ZodTypeAny | null = data.getNestedSchema(
          key,
          data.model,
        );
        /*
         * The nested schema says what it selects. Metadata given here would
         * wrap a schema the spec publishes on its own (a $ref) in an allOf.
         */
        if (nestedSchema) {
          shape[key] = nestedSchema.optional();
          continue;
        }
      }

      // What it selects, the select schema's own description says.
      shape[key] = z.boolean().optional();
    }

    return z.object(shape).openapi({
      description: `Select schema for ${data.tableName || "model"}. Set fields to true to include them in the response.`,
      example: data.getSelectSchemaExample(data.model),
      additionalProperties: false,
    });
  }

  /**
   * Generate a group by schema for a model
   */
  protected static generateGroupBySchema<T>(data: {
    model: T;
    tableName?: string;
    getColumns: (model: T) => Array<{ key: string; type: any }>;
    getGroupableTypes: () => Array<any>;
    getGroupBySchemaExample: (model: T) => SchemaExample;
  }): BaseSchemaType {
    const shape: ShapeRecord = {};
    const columns: Array<{ key: string; type: any }> = data.getColumns(
      data.model,
    );

    for (const column of columns) {
      const key: string = column.key;
      const isGroupable: boolean = data
        .getGroupableTypes()
        .includes(column.type);

      if (!isGroupable) {
        continue;
      }

      shape[key] = z
        .literal(true)
        .optional()
        .openapi({
          type: "boolean",
          description: `Group by ${key} field. Only one field can be selected for grouping.`,
          example: true,
        });
    }

    return z.object(shape).openapi({
      description: `Group by schema for ${data.tableName || "model"}. Only one field can be set to true for grouping.`,
      example: data.getGroupBySchemaExample(data.model),
      additionalProperties: false,
    });
  }

  /**
   * Generate a create schema for a model
   */
  protected static generateCreateSchema<T>(data: {
    model: T;
    tableName?: string;
    getColumns: (model: T) => Array<{
      key: string;
      type?: any;
      required?: boolean;
      isDefaultValueColumn?: boolean;
    }>;
    getZodTypeForColumn: (column: any) => ZodTypes.ZodTypeAny;
    getCreateSchemaExample: (model: T) => SchemaExample;
    excludedFields?: Array<string>;
  }): BaseSchemaType {
    const shape: ShapeRecord = {};
    const columns: Array<{
      key: string;
      type?: any;
      required?: boolean;
      isDefaultValueColumn?: boolean;
    }> = data.getColumns(data.model);
    const excludedFields: Array<string> = data.excludedFields || [
      "_id",
      "createdAt",
      "updatedAt",
    ];

    for (const column of columns) {
      const key: string = column.key;

      if (excludedFields.includes(key)) {
        continue;
      }

      // Skip default value columns in create schema
      if (column.isDefaultValueColumn) {
        continue;
      }

      const zodType: ZodTypes.ZodTypeAny = data.getZodTypeForColumn(column);

      if (column.required) {
        shape[key] = zodType;
      } else {
        shape[key] = zodType.optional();
      }
    }

    return z.object(shape).openapi({
      description: `Create schema for ${data.tableName || "model"}`,
      example: data.getCreateSchemaExample(data.model),
      additionalProperties: false,
    });
  }

  /**
   * Helper method to generate common example values for different data types
   */
  protected static getCommonExampleValue(
    dataType: string,
    isSecondValue: boolean = false,
  ): unknown {
    switch (dataType.toLowerCase()) {
      case "objectid":
      case "id":
        return "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";
      case "text":
      case "string":
        return isSecondValue ? "example_text_2" : "example_text_1";
      case "email":
        return isSecondValue ? "user2@example.com" : "user@example.com";
      case "number":
      case "integer":
        return isSecondValue ? 100 : 42;
      case "date":
      case "datetime":
        return isSecondValue
          ? "2023-12-31T23:59:59.000Z"
          : "2023-01-15T12:30:00.000Z";
      case "boolean":
        return !isSecondValue;
      case "json":
      case "object":
        return isSecondValue ? { key2: "value2" } : { key: "value" };
      case "array":
        return isSecondValue ? ["item3", "item4"] : ["item1", "item2"];
      default:
        return isSecondValue ? "example_value_2" : "example_value_1";
    }
  }

  /**
   * Helper method to generate select schema examples
   */
  protected static generateSelectSchemaExample<T>(data: {
    model: T;
    getColumns: (model: T) => Array<{ key: string; type?: any }>;
    commonFields?: Array<string>;
    maxFields?: number;
    priorityFieldTypes?: Array<any>;
  }): SchemaExample {
    const columns: Array<{ key: string; type?: any }> = data.getColumns(
      data.model,
    );
    const example: SchemaExample = {};
    const commonFields: Array<string> = data.commonFields || [
      "_id",
      "createdAt",
      "updatedAt",
    ];
    const maxFields: number = data.maxFields || 5;

    // Add common fields that exist
    for (const field of commonFields) {
      const hasField: boolean = columns.some(
        (col: { key: string; type?: any }) => {
          return col.key === field;
        },
      );
      if (hasField) {
        example[field] = true;
      }
    }

    // Add priority fields if specified
    let fieldCount: number = 0;
    if (data.priorityFieldTypes) {
      for (const column of columns) {
        if (fieldCount >= maxFields) {
          break;
        }

        if (
          !commonFields.includes(column.key) &&
          column.type &&
          data.priorityFieldTypes.includes(column.type)
        ) {
          example[column.key] = true;
          fieldCount++;
        }
      }
    }

    return example;
  }

  /**
   * Helper method to generate group by schema examples
   */
  protected static generateGroupBySchemaExample<T>(data: {
    model: T;
    getColumns: (model: T) => Array<{ key: string; type: any }>;
    getGroupableTypes: () => Array<any>;
    excludeFields?: Array<string>;
  }): SchemaExample {
    const columns: Array<{ key: string; type: any }> = data.getColumns(
      data.model,
    );
    const excludeFields: Array<string> = data.excludeFields || [
      "_id",
      "createdAt",
      "updatedAt",
    ];

    // Find first suitable field for grouping
    for (const column of columns) {
      const isGroupable: boolean = data
        .getGroupableTypes()
        .includes(column.type);

      if (isGroupable && !excludeFields.includes(column.key)) {
        return { [column.key]: true };
      }
    }

    // Fallback
    return { createdAt: true };
  }

  /**
   * Helper method to conditionally apply OpenAPI schema
   */
  protected static applyOpenApi<T extends ZodTypes.ZodTypeAny>(
    baseType: T,
    openApiConfig: any,
    disableOpenApiSchema: boolean = false,
  ): T {
    if (disableOpenApiSchema) {
      return baseType;
    }
    return baseType.openapi(openApiConfig) as T;
  }
}
