import z, { ZodSchema } from "./Zod";
import TableColumnType from "../../Types/Database/TableColumnType";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../Types/Database/TableColumn";
import Dictionary from "../../Types/Dictionary";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { z as ZodTypes } from "zod";
import BadDataException from "../../Types/Exception/BadDataException";
import Permission, { PermissionHelper } from "../../Types/Permission";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import {
  ALWAYS_READABLE_COLUMNS,
  BaseSchema,
  SchemaExample,
  ShapeRecord,
} from "./BaseSchema";
import {
  getColorSchema,
  getDateSchema,
  getDomainSchema,
  getEmailSchema,
  getIPSchema,
  getNameSchema,
  getObjectIDSchema,
  getPhoneSchema,
  getPortSchema,
  getVersionSchema,
} from "./TypeSchemas";
import { getMonitorStepsSchema } from "./MonitorSchemas";
import MonitorType from "../../Types/Monitor/MonitorType";
import WorkflowStatus from "../../Types/Workflow/WorkflowStatus";
import CustomFieldType from "../../Types/CustomField/CustomFieldType";
import { getApiSingularName } from "../ModelApiName";

export type ModelSchemaType = ZodSchema;

/*
 * The text columns an encrypted secret is stored in. An encrypted JSON
 * column holds a map of them, not one string, so it is left as it is.
 */
const ENCRYPTED_SECRET_COLUMN_TYPES: Array<TableColumnType> = [
  TableColumnType.ShortText,
  TableColumnType.LongText,
  TableColumnType.VeryLongText,
];

/*
 * The model a relation column points at, as the generated spec names it:
 * `tag` is what that model's endpoints are tagged with (the singular name
 * the API keeps, getApiSingularName).
 */
export interface ModelRelationReference {
  tag: string;
  tableName: string;
}

// A column a query, sort or select may name.
interface ReadableColumn {
  key: string;
  column: TableColumnMetadata;
}

/*
 * WHAT A QUERY CAN DO WITH A COLUMN OF EACH TYPE, as the API runs it:
 * JSONFunctions.deserialize reads the operator, QueryPermission checks the
 * column and QueryUtil.serializeQuery compiles it.
 * Tests/Utils/Schema/ModelSchemaQuery runs every filter the spec documents,
 * on every column of every documented model, through all three. The OpenAPI
 * spec, the MCP server's oneuptime_describe_resource and the developer docs
 * read these lists.
 */
const PRESENCE_OPERATORS: Array<string> = ["IsNull", "NotNull"];

const COMMON_OPERATORS: Array<string> = [
  "EqualTo",
  "NotEqual",
  ...PRESENCE_OPERATORS,
  "EqualToOrNull",
];

const ID_OPERATORS: Array<string> = [...COMMON_OPERATORS, "Includes"];

const TEXT_OPERATORS: Array<string> = [
  ...COMMON_OPERATORS,
  "Search",
  "Includes",
];

const RANGE_OPERATORS: Array<string> = [
  ...COMMON_OPERATORS,
  "GreaterThan",
  "LessThan",
  "GreaterThanOrEqual",
  "LessThanOrEqual",
  "InBetween",
];

const OPERATORS_BY_COLUMN_TYPE: Record<TableColumnType, Array<string>> = {
  [TableColumnType.ObjectID]: ID_OPERATORS,
  [TableColumnType.Email]: ID_OPERATORS,
  [TableColumnType.Phone]: ID_OPERATORS,
  [TableColumnType.HashedString]: ID_OPERATORS,
  [TableColumnType.Slug]: ID_OPERATORS,
  [TableColumnType.ShortText]: TEXT_OPERATORS,
  [TableColumnType.LongText]: TEXT_OPERATORS,
  [TableColumnType.VeryLongText]: TEXT_OPERATORS,
  [TableColumnType.Name]: TEXT_OPERATORS,
  [TableColumnType.Description]: TEXT_OPERATORS,
  [TableColumnType.Domain]: TEXT_OPERATORS,
  [TableColumnType.Markdown]: TEXT_OPERATORS,
  [TableColumnType.Number]: RANGE_OPERATORS,
  [TableColumnType.PositiveNumber]: RANGE_OPERATORS,
  [TableColumnType.SmallNumber]: RANGE_OPERATORS,
  [TableColumnType.SmallPositiveNumber]: RANGE_OPERATORS,
  [TableColumnType.BigNumber]: RANGE_OPERATORS,
  [TableColumnType.BigPositiveNumber]: RANGE_OPERATORS,
  [TableColumnType.Date]: RANGE_OPERATORS,
  [TableColumnType.Boolean]: COMMON_OPERATORS,
  /*
   * On each key: {"customFields": {"<key>": <value or operator>}}, as
   * JSONColumnQuery compiles it. NotEqual on the column itself is read as a
   * key named "_value".
   */
  [TableColumnType.JSON]: [
    ...TEXT_OPERATORS,
    "GreaterThan",
    "LessThan",
    "GreaterThanOrEqual",
    "LessThanOrEqual",
    "InBetween",
  ],
  // A relation list. The API refuses NotEqual on one (UUIDColumnFilter).
  [TableColumnType.EntityArray]: ["EqualTo", ...PRESENCE_OPERATORS, "Includes"],
  // A relation, filtered through its own fields, is no field of a query.
  [TableColumnType.Entity]: [
    "EqualTo",
    "NotEqual",
    ...PRESENCE_OPERATORS,
    "Includes",
  ],
  /*
   * A JSON document or a file's bytes: only whether there is one can be
   * asked. Postgres reads text compared with a monitor's steps as JSON, and
   * refuses it.
   */
  [TableColumnType.MonitorSteps]: PRESENCE_OPERATORS,
  [TableColumnType.File]: PRESENCE_OPERATORS,
  [TableColumnType.Buffer]: PRESENCE_OPERATORS,
  [TableColumnType.Array]: ["EqualTo", "NotEqual", ...PRESENCE_OPERATORS],
  [TableColumnType.Color]: COMMON_OPERATORS,
  [TableColumnType.Version]: COMMON_OPERATORS,
  [TableColumnType.Password]: COMMON_OPERATORS,
  [TableColumnType.OTP]: COMMON_OPERATORS,
  [TableColumnType.ShortURL]: COMMON_OPERATORS,
  [TableColumnType.LongURL]: COMMON_OPERATORS,
  [TableColumnType.HTML]: COMMON_OPERATORS,
  [TableColumnType.JavaScript]: COMMON_OPERATORS,
  [TableColumnType.CSS]: COMMON_OPERATORS,
  [TableColumnType.Permission]: COMMON_OPERATORS,
  [TableColumnType.CustomFieldType]: COMMON_OPERATORS,
  [TableColumnType.MonitorType]: COMMON_OPERATORS,
  [TableColumnType.WorkflowStatus]: COMMON_OPERATORS,
  [TableColumnType.IP]: COMMON_OPERATORS,
  [TableColumnType.Port]: COMMON_OPERATORS,
};

// Each type's filter, built once (ModelSchema.getQueryFilterSchema).
const QUERY_FILTER_SCHEMAS: Map<TableColumnType, ZodTypes.ZodTypeAny> =
  new Map();

// Each model's relation select, built once (getRelationSelectSchema).
const RELATION_SELECT_SCHEMAS: Map<string, ModelSchemaType> = new Map();

const EXAMPLE_ID: string = "123e4567-e89b-12d3-a456-426614174000";

/*
 * What a text field's example is when its column gives none of its own
 * (TableColumn.example, or the first of its allowedValues): placeholders,
 * which a reader replaces.
 */
const SHORT_TEXT_EXAMPLE: string = "Example short text";
const LONG_TEXT_EXAMPLE: string =
  "This is an example of longer text content that might be stored in this field.";
const VERY_LONG_TEXT_EXAMPLE: string =
  "This is an example of very long text content that might be stored in this field. It can contain a lot of information, such as detailed descriptions, comments, or any other lengthy text data that needs to be stored in the database.";

// What a column's description may already end its sentence with.
const SENTENCE_END_PUNCTUATION: ReadonlyArray<string> = [".", "!", "?"];

const EXAMPLE_TIME: string = "2026-01-01T00:00:00.000Z";

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

  /*
   * A column's description as the spec writes it: the column's own words as
   * one sentence, then its permissions clause. A full stop is added only to
   * words that end without one - most columns' descriptions end with their
   * own ("Date and Time when the object was created."), and joining them
   * with ". " wrote "created.. Permissions - ..." for more than half the
   * spec's columns, which the API reference and every client reading the
   * spec showed.
   */
  public static describeColumnWithPermissions(
    description: string,
    permissionsDescription: string,
  ): string {
    const words: string = description.trim();

    if (!permissionsDescription) {
      return words;
    }

    if (!words) {
      return permissionsDescription;
    }

    const endsWithItsOwnPunctuation: boolean = SENTENCE_END_PUNCTUATION.some(
      (mark: string) => {
        return words.endsWith(mark);
      },
    );

    return `${words}${endsWithItsOwnPunctuation ? "" : "."} ${permissionsDescription}`;
  }

  /*
   * The values a text column takes, when it takes one of a few
   * (TableColumn.allowedValues): the spec's enum for the field, each value
   * once - an enum can give two names one value (MimeType's jpg and jpeg).
   */
  public static getAllowedValues(
    column: TableColumnMetadata,
  ): Array<string> | undefined {
    if (!column.allowedValues || column.allowedValues.length === 0) {
      return undefined;
    }

    return Array.from(new Set(column.allowedValues));
  }

  /*
   * A text field's example: its column's own (TableColumn.example), else
   * the first value it takes when it takes one of a few - "aws" for a cloud
   * account's provider - else the placeholder for its type. Clients copy
   * it: the Terraform provider's examples, the API reference, MCP's tool
   * schemas, the Dashboard's Developer pages.
   */
  public static getTextExample(
    column: TableColumnMetadata,
    placeholder: string,
  ): string {
    if (typeof column.example === "string" && column.example.trim()) {
      return column.example;
    }

    return ModelSchema.getAllowedValues(column)?.[0] || placeholder;
  }

  /*
   * What the spec says about a text field's value: a string, its example,
   * and the values it takes when it takes one of a few.
   */
  private static getTextOpenApi(
    column: TableColumnMetadata,
    placeholder: string,
  ): { type: "string"; example: string; enum?: Array<string> } {
    const allowedValues: Array<string> | undefined =
      ModelSchema.getAllowedValues(column);

    return {
      type: "string",
      example: ModelSchema.getTextExample(column, placeholder),
      ...(allowedValues ? { enum: allowedValues } : {}),
    };
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

    const relations: Dictionary<ModelRelationReference> =
      this.getRelationReferences(columns);

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
        zodType = getObjectIDSchema();
      } else if (column.type === TableColumnType.Color) {
        zodType = getColorSchema();
      } else if (column.type === TableColumnType.MonitorSteps) {
        zodType = getMonitorStepsSchema();
      } else if (column.type === TableColumnType.Date) {
        zodType = getDateSchema();
      } else if (column.type === TableColumnType.VeryLongText) {
        zodType = z
          .string()
          .openapi(ModelSchema.getTextOpenApi(column, VERY_LONG_TEXT_EXAMPLE));
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
        zodType = getEmailSchema();
      } else if (column.type === TableColumnType.HashedString) {
        /*
         * format: password marks the field as a secret for spec consumers
         * (the Terraform provider generator emits Sensitive: true for it).
         */
        zodType = z.string().openapi({
          type: "string",
          format: "password",
          example: "hashed_string_value",
        });
      } else if (column.type === TableColumnType.Slug) {
        zodType = z
          .string()
          .openapi({ type: "string", example: "example-slug-value" });
      } else if (column.type === TableColumnType.ShortText) {
        const openapiConfig: any = ModelSchema.getTextOpenApi(
          column,
          SHORT_TEXT_EXAMPLE,
        );
        if (column.defaultValue !== undefined) {
          openapiConfig.default = column.defaultValue;
        }
        zodType = z.string().openapi(openapiConfig);
      } else if (column.type === TableColumnType.LongText) {
        const openapiConfig: any = ModelSchema.getTextOpenApi(
          column,
          LONG_TEXT_EXAMPLE,
        );
        if (column.defaultValue !== undefined) {
          openapiConfig.default = column.defaultValue;
        }
        zodType = z.string().openapi(openapiConfig);
      } else if (column.type === TableColumnType.Phone) {
        zodType = getPhoneSchema();
      } else if (column.type === TableColumnType.Version) {
        zodType = getVersionSchema();
      } else if (column.type === TableColumnType.Password) {
        zodType = z.string().openapi({
          type: "string",
          format: "password",
          example: "••••••••",
        });
      } else if (column.type === TableColumnType.Name) {
        zodType = getNameSchema();
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
        zodType = getDomainSchema();
      } else if (column.type === TableColumnType.Port) {
        zodType = getPortSchema();
      } else if (column.type === TableColumnType.IP) {
        zodType = getIPSchema();
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
        // What a custom field holds: "Text", "Number", "Dropdown"...
        zodType = z.string().openapi({
          type: "string",
          enum: Object.values(CustomFieldType),
          example: CustomFieldType.Text,
        });
      } else if (column.type === TableColumnType.MonitorType) {
        zodType = z.string().openapi({
          type: "string",
          enum: Object.values(MonitorType),
          example: MonitorType.Manual,
        });
      } else if (column.type === TableColumnType.WorkflowStatus) {
        zodType = z.string().openapi({
          type: "string",
          enum: Object.values(WorkflowStatus),
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

      // The column's description, then who may read and write it.
      finalDescription = ModelSchema.describeColumnWithPermissions(
        finalDescription,
        this.getColumnPermissionsDescription(model, key),
      );

      // Set the final combined description
      zodType = this.annotateColumn({
        zodType: zodType,
        description: finalDescription,
        relation: relations[key],
      });

      // Mark computed fields as readOnly in OpenAPI spec
      if (column.computed) {
        zodType = zodType.openapi({ readOnly: true });
      }

      // A secret, as getZodTypeForColumn says too.
      zodType = ModelSchema.annotateSecret(zodType, column);

      shape[key] = zodType;
    }

    const schema: ModelSchemaType = z.object(shape);

    return schema;
  }

  /*
   * A column's own documentation, set where the generated spec reads it.
   *
   * `.describe()` alone loses to a type that brings a description of its own
   * in its openapi metadata - ObjectID ("A unique identifier for an object,
   * represented as a UUID") and Date ("A date time object") among them - so
   * every id and date column of every model was documented as nothing but its
   * type. Setting it as openapi metadata as well lets the column's words win.
   *
   * A relation's id column and a relation list also name the model they point
   * at (`x-oneuptime-relation`): `tag` is the name that model's endpoints are
   * tagged with, so a client generated from the spec - the Terraform provider
   * - can say which of its resources an id belongs to.
   */
  private static annotateColumn(data: {
    zodType: ZodTypes.ZodTypeAny;
    description: string;
    relation?: ModelRelationReference | undefined;
    disableOpenApiSchema?: boolean | undefined;
  }): ZodTypes.ZodTypeAny {
    let zodType: ZodTypes.ZodTypeAny = data.zodType;

    if (data.description) {
      zodType = zodType.describe(data.description);
    }

    if (data.disableOpenApiSchema) {
      return zodType;
    }

    if (data.description) {
      zodType = zodType.openapi({ description: data.description });
    }

    if (data.relation) {
      zodType = zodType.openapi({
        "x-oneuptime-relation": data.relation,
      } as any);
    }

    return zodType;
  }

  /*
   * The model each relation of `columns` points at, keyed by the column a
   * caller writes: a many-to-one relation's id column (`labelId` for
   * `label`), and a relation list itself (`labels`).
   */
  public static getRelationReferences(
    columns: Dictionary<TableColumnMetadata>,
  ): Dictionary<ModelRelationReference> {
    const references: Dictionary<ModelRelationReference> = {};

    for (const key in columns) {
      const column: TableColumnMetadata | undefined = columns[key];

      if (!column?.modelType) {
        continue;
      }

      let columnKey: string | undefined = undefined;

      if (
        column.type === TableColumnType.Entity &&
        column.manyToOneRelationColumn
      ) {
        columnKey = column.manyToOneRelationColumn;
      } else if (column.type === TableColumnType.EntityArray) {
        columnKey = key;
      }

      if (!columnKey) {
        continue;
      }

      const target: DatabaseBaseModel = new column.modelType();
      const tableName: string | null = target.tableName;

      if (!tableName) {
        continue;
      }

      /*
       * By the name the API keeps, the one OpenAPI.ts tags the model's
       * endpoints with. A model renamed on screen (#6817: an On-Call Policy
       * Schedule is an On-Call Schedule) keeps its tag, and its screen name
       * here named a tag no endpoint has: the Terraform provider found no
       * resource for the relation, and its docs example was not a list of
       * ids.
       */
      references[columnKey] = {
        tag: getApiSingularName(target) || tableName,
        tableName: tableName,
      };
    }

    return references;
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

  /*
   * The columns a query may name, each referring to its type's filter
   * (getQueryFilterSchema).
   *
   * Neither this object's .openapi() nor a field's names a `type`:
   * zod-to-openapi takes a `type` there for the whole schema and leaves out
   * the properties and operators it would have generated, so the spec listed
   * no field of any query at all.
   *
   * Other keys are not refused: a query also filters a record by the fields
   * of a record its relation names, and one with owners by who owns it
   * (QueryPermission checks both), as the API reference describes.
   */
  public static getQueryModelSchema(data: {
    modelType: new () => DatabaseBaseModel;
    disableOpenApiSchema?: boolean;
  }): ModelSchemaType {
    const model: DatabaseBaseModel = new data.modelType();
    const columns: Array<ReadableColumn> = this.getReadableColumns(model);
    const shape: ShapeRecord = {};

    for (const { key, column } of columns) {
      shape[key] = this.getQueryFilterSchema(column.type).optional();
    }

    return this.applyOpenApi(
      z.object(shape),
      {
        description: `Query schema for ${model.tableName || "model"}. A field takes a value, which it matches exactly, or an operator its type allows. A relation is filtered by the fields of the record it names, {"<relation>": {"<field>": <value or Search>}}, and a resource with owners by who owns it, {"owners": {"_type": "OwnedBy", "userIds": [...], "teamIds": [...]}}.`,
        example: this.getQuerySchemaExample(columns),
      },
      data.disableOpenApiSchema || false,
    );
  }

  /*
   * The operators a query can use on a column of this type - on a JSON
   * column, on each of its keys.
   */
  public static getValidOperatorsForColumnType(
    columnType: TableColumnType,
  ): Array<string> {
    return OPERATORS_BY_COLUMN_TYPE[columnType] || COMMON_OPERATORS;
  }

  /*
   * What a query field of this type takes: a value, which it matches exactly,
   * or one of its operators. Built once for each type and published as a
   * schema of its own, <Type>Filter, that every query field of the type
   * refers to: spelled out on each of the 7,700 query fields, the operators
   * would have made most of the spec, and a client generated from it would
   * have had a type for each.
   */
  public static getQueryFilterSchema(
    columnType: TableColumnType,
  ): ZodTypes.ZodTypeAny {
    let filter: ZodTypes.ZodTypeAny | undefined =
      QUERY_FILTER_SCHEMAS.get(columnType);

    if (filter) {
      return filter;
    }

    const operators: Array<string> =
      this.getValidOperatorsForColumnType(columnType);
    const value: ZodTypes.ZodTypeAny = this.getQueryValueSchema(columnType);

    /*
     * A JSON column is filtered by key. IsNull and NotNull on the column
     * itself ask whether it holds anything; any other operator there would
     * be read as a key of its own.
     */
    filter =
      columnType === TableColumnType.JSON
        ? z.union([
            this.getOperatorSchema("IsNull", value),
            this.getOperatorSchema("NotNull", value),
            z
              .object({})
              .catchall(this.getValueOrOperatorSchema(columnType, operators)),
          ])
        : this.getValueOrOperatorSchema(columnType, operators);

    filter = filter.openapi(`${this.getColumnTypeKey(columnType)}Filter`, {
      description: this.getQueryFilterDescription(columnType, operators),
      example: this.getQueryFilterExample(columnType),
    });

    QUERY_FILTER_SCHEMAS.set(columnType, filter);

    return filter;
  }

  /*
   * A value, which matches exactly, or one of the operators. A relation
   * list's value is a list of ids, which matches the records related to any
   * of them.
   */
  private static getValueOrOperatorSchema(
    columnType: TableColumnType,
    operators: Array<string>,
  ): ZodTypes.ZodTypeAny {
    const value: ZodTypes.ZodTypeAny = this.getQueryValueSchema(columnType);
    const branches: Array<ZodTypes.ZodTypeAny> = [];

    for (const operator of operators) {
      if (
        operator === "EqualTo" &&
        columnType === TableColumnType.EntityArray
      ) {
        branches.push(z.array(value));
        continue;
      }

      if (operator === "EqualTo") {
        branches.push(value);
      }

      branches.push(this.getOperatorSchema(operator, value));
    }

    return branches.length === 1
      ? branches[0]!
      : z.union(
          branches as [
            ZodTypes.ZodTypeAny,
            ZodTypes.ZodTypeAny,
            ...ZodTypes.ZodTypeAny[],
          ],
        );
  }

  // An operator as JSONFunctions.deserialize reads it on the API.
  private static getOperatorSchema(
    operator: string,
    value: ZodTypes.ZodTypeAny,
  ): ZodTypes.ZodTypeAny {
    switch (operator) {
      case "IsNull":
      case "NotNull":
        return z.object({ _type: z.literal(operator) });

      case "InBetween":
        return z.object({
          _type: z.literal(operator),
          startValue: value,
          endValue: value,
        });

      case "Includes":
        return z.object({ _type: z.literal(operator), value: z.array(value) });

      case "Search":
        return z.object({ _type: z.literal(operator), value: z.string() });

      default:
        return z.object({ _type: z.literal(operator), value: value });
    }
  }

  /*
   * What a query compares a column of this type with, as JSON carries it: on
   * a relation list, one of its ids; on a JSON column, a key's value. Always
   * the plain value, never the {_type, value} a response writes for an
   * email, a name or a color: inside an operator the API binds that as
   * "[object Object]".
   */
  private static getQueryValueSchema(
    columnType: TableColumnType,
  ): ZodTypes.ZodTypeAny {
    switch (columnType) {
      case TableColumnType.ObjectID:
      case TableColumnType.Entity:
      case TableColumnType.EntityArray:
        return z.string().openapi({ format: "uuid" });

      case TableColumnType.Email:
        return z.string().openapi({ format: "email" });

      case TableColumnType.Date:
        return z.string().openapi({ format: "date-time" });

      case TableColumnType.Number:
      case TableColumnType.PositiveNumber:
      case TableColumnType.SmallNumber:
      case TableColumnType.SmallPositiveNumber:
      case TableColumnType.BigNumber:
      case TableColumnType.BigPositiveNumber:
      case TableColumnType.Port:
        return z.number();

      case TableColumnType.Boolean:
        return z.boolean();

      case TableColumnType.JSON:
        return z.union([z.string(), z.number(), z.boolean()]);

      default:
        return z.string();
    }
  }

  private static getQueryFilterDescription(
    columnType: TableColumnType,
    operators: Array<string>,
  ): string {
    if (columnType === TableColumnType.JSON) {
      return `A filter on a ${columnType} field, by key: {"<field>": {"<key>": <value or operator>}}. A key takes a value, which it matches exactly, or one of these operators: ${operators.join(", ")}. IsNull and NotNull on the field itself ask whether it holds anything.`;
    }

    if (!operators.includes("EqualTo")) {
      return `A filter on a ${columnType} field: only whether it holds anything can be asked, with ${operators.join(" or ")}.`;
    }

    let description: string = `A filter on a ${columnType} field: a value, which it matches exactly, or one of these operators: ${operators.join(", ")}.`;

    if (columnType === TableColumnType.EntityArray) {
      description +=
        " A list of ids, or Includes, matches the records related to any of them; IsNull those related to none.";
    } else if (columnType === TableColumnType.Date) {
      description += ` Times are ISO-8601, such as ${EXAMPLE_TIME}.`;
    }

    return description;
  }

  private static getQueryFilterExample(columnType: TableColumnType): unknown {
    const operators: Array<string> =
      this.getValidOperatorsForColumnType(columnType);

    if (columnType === TableColumnType.JSON) {
      return { key: "value" };
    }

    if (columnType === TableColumnType.EntityArray) {
      return [EXAMPLE_ID];
    }

    if (operators.includes("Search")) {
      return { _type: "Search", value: "example" };
    }

    if (operators.includes("GreaterThan")) {
      return {
        _type: "GreaterThan",
        value: columnType === TableColumnType.Date ? EXAMPLE_TIME : 10,
      };
    }

    switch (columnType) {
      case TableColumnType.ObjectID:
        return EXAMPLE_ID;
      case TableColumnType.Boolean:
        return true;
      case TableColumnType.Email:
        return "user@example.com";
      default:
        return { _type: "NotNull" };
    }
  }

  // A column type as an identifier: its key in TableColumnType.
  private static getColumnTypeKey(columnType: TableColumnType): string {
    return (
      Object.keys(TableColumnType).find((key: string): boolean => {
        return (
          TableColumnType[key as keyof typeof TableColumnType] === columnType
        );
      }) || "Unknown"
    );
  }

  /*
   * The columns of a model a query, sort or select may name, as the API
   * checks them (QueryPermission, SelectPermission): those somebody may
   * read, and the ids and times it lets through all the same. Not a
   * relation, which is filtered and selected through its own fields, nor a
   * column the documentation hides.
   */
  private static getReadableColumns(
    model: DatabaseBaseModel,
  ): Array<ReadableColumn> {
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
    const accessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();
    const readable: Array<ReadableColumn> = [];

    for (const key in columns) {
      const column: TableColumnMetadata | undefined = columns[key];

      if (
        !column ||
        column.type === TableColumnType.Entity ||
        column.hideColumnInDocumentation
      ) {
        continue;
      }

      if (
        ALWAYS_READABLE_COLUMNS.includes(key) ||
        (accessControl[key]?.read || []).length > 0
      ) {
        readable.push({ key, column });
      }
    }

    return readable;
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
        return this.getReadableColumns(model).map(
          ({ key, column }: ReadableColumn) => {
            return { key, type: column.type };
          },
        );
      },
      disableOpenApiSchema: data.disableOpenApiSchema || false,
    });
  }

  public static getSelectModelSchema(data: {
    modelType: new () => DatabaseBaseModel;
  }): ModelSchemaType {
    const modelType: new () => DatabaseBaseModel = data.modelType;
    const model: DatabaseBaseModel = new modelType();

    return this.generateSelectSchema({
      model,
      tableName: model.tableName || "model",
      getColumns: (model: DatabaseBaseModel) => {
        return this.getReadableColumns(model).map(
          ({ key, column }: ReadableColumn) => {
            return { key, type: column.type };
          },
        );
      },
      getSelectSchemaExample: () => {
        return this.getSelectSchemaExample(modelType);
      },
      allowNested: true,
      getNestedSchema: (key: string, model: DatabaseBaseModel) => {
        const column: TableColumnMetadata | undefined =
          getTableColumns(model)[key];

        if (
          column &&
          column.modelType &&
          column.type === TableColumnType.EntityArray
        ) {
          return this.getRelationSelectSchema(
            column.modelType as new () => DatabaseBaseModel,
          );
        }

        return null;
      },
    });
  }

  /*
   * What a select may name of the records a relation list holds, as the API
   * checks it (QueryPermission.checkRelationQueryPermission): their ids and
   * times, and the columns marked canReadOnRelationQuery. Built once for each
   * model and published as <Table>RelationSelectSchema, which every relation
   * list of its records refers to.
   */
  public static getRelationSelectSchema(
    modelType: new () => DatabaseBaseModel,
  ): ModelSchemaType {
    const model: DatabaseBaseModel = new modelType();
    const tableName: string = model.tableName || "model";

    let schema: ModelSchemaType | undefined =
      RELATION_SELECT_SCHEMAS.get(tableName);

    if (schema) {
      return schema;
    }

    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
    const shape: ShapeRecord = {};

    for (const key in columns) {
      const column: TableColumnMetadata | undefined = columns[key];

      if (
        !column ||
        column.type === TableColumnType.Entity ||
        column.type === TableColumnType.EntityArray ||
        column.hideColumnInDocumentation
      ) {
        continue;
      }

      /*
       * An id or a time is read with the model's own read permissions, which
       * a model read through other records only (a File) does not have.
       */
      const readers: Array<Permission> =
        model.getColumnAccessControlFor(key)?.read ||
        model.getReadPermissions() ||
        [];

      if (
        column.canReadOnRelationQuery ||
        (ALWAYS_READABLE_COLUMNS.includes(key) && readers.length > 0)
      ) {
        shape[key] = z.boolean().optional();
      }
    }

    schema = z.object(shape).openapi(`${tableName}RelationSelectSchema`, {
      description: `What a select may name of the ${tableName} records a relation holds: set a field to true to include it.`,
      example: shape["_id"] ? { _id: true } : {},
      additionalProperties: false,
    }) as ModelSchemaType;

    RELATION_SELECT_SCHEMAS.set(tableName, schema);

    return schema;
  }

  /*
   * Records of a database table are not grouped: DatabaseService.findBy
   * refuses any groupBy ("GroupBy is currently not supported"), so no field
   * is offered, and no path of the spec refers to this schema.
   */
  public static getGroupByModelSchema(data: {
    modelType: new () => DatabaseBaseModel;
  }): ModelSchemaType {
    const model: DatabaseBaseModel = new data.modelType();

    return z.object({}).openapi({
      description: `Group by schema for ${model.tableName || "model"}. Its records cannot be grouped: the API refuses a groupBy on them.`,
      example: {},
      additionalProperties: false,
    });
  }

  // A query on a record's age and on words in it, where the model has them.
  private static getQuerySchemaExample(
    columns: Array<ReadableColumn>,
  ): SchemaExample {
    const example: SchemaExample = {};

    const createdAt: ReadableColumn | undefined = columns.find(
      ({ key }: ReadableColumn): boolean => {
        return key === "createdAt";
      },
    );

    const searchable: ReadableColumn | undefined = columns.find(
      ({ column }: ReadableColumn): boolean => {
        return this.getValidOperatorsForColumnType(column.type).includes(
          "Search",
        );
      },
    );

    for (const field of [createdAt, searchable]) {
      if (field) {
        example[field.key] = this.getQueryFilterExample(field.column.type);
      }
    }

    if (Object.keys(example).length === 0 && columns[0]) {
      example[columns[0].key] = this.getQueryFilterExample(
        columns[0].column.type,
      );
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
    const columns: Array<ReadableColumn> = this.getReadableColumns(model);
    const example: SchemaExample = {};

    // Add common fields that most models have
    const commonFields: Array<string> = ["_id", "createdAt", "updatedAt"];
    for (const { key } of columns) {
      if (commonFields.includes(key)) {
        example[key] = true;
      }
    }

    // Add first few non-common fields as examples
    let fieldCount: number = 0;
    const maxFields: number = 5;
    for (const { key, column } of columns) {
      if (fieldCount >= maxFields) {
        break;
      }

      if (commonFields.includes(key)) {
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

    const relations: Dictionary<ModelRelationReference> =
      this.getRelationReferences(columns);

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
      } else if (column.type === TableColumnType.Slug) {
        /*
         * Slugs are generated by the server from the slugify column. Some
         * models mark the column required at the database level, but API
         * clients never supply it.
         */
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

      // The column's description, then who may read and write it.
      finalDescription = ModelSchema.describeColumnWithPermissions(
        finalDescription,
        this.getColumnPermissionsDescription(model, key),
      );

      // Set the final combined description
      zodType = this.annotateColumn({
        zodType: zodType,
        description: finalDescription,
        relation: relations[key],
        disableOpenApiSchema: data.disableOpenApiSchema || false,
      });

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
      zodType = getObjectIDSchema();
    } else if (column.type === TableColumnType.Port) {
      zodType = getPortSchema();
    } else if (column.type === TableColumnType.MonitorSteps) {
      zodType = getMonitorStepsSchema();
    } else if (column.type === TableColumnType.IP) {
      zodType = getIPSchema();
    } else if (column.type === TableColumnType.Color) {
      zodType = getColorSchema();
    } else if (column.type === TableColumnType.Date) {
      zodType = getDateSchema();
    } else if (column.type === TableColumnType.VeryLongText) {
      zodType = applyOpenApi(
        z.string(),
        ModelSchema.getTextOpenApi(column, VERY_LONG_TEXT_EXAMPLE),
      );
    } else if (
      column.type === TableColumnType.Number ||
      column.type === TableColumnType.PositiveNumber
    ) {
      zodType = applyOpenApi(z.number(), { type: "number", example: 42 });
    } else if (column.type === TableColumnType.Email) {
      zodType = getEmailSchema();
    } else if (column.type === TableColumnType.HashedString) {
      /*
       * format: password marks the field as a secret for spec consumers
       * (the Terraform provider generator emits Sensitive: true for it).
       */
      zodType = applyOpenApi(z.string(), {
        type: "string",
        format: "password",
        example: "hashed_string_value",
      });
    } else if (column.type === TableColumnType.Slug) {
      zodType = applyOpenApi(z.string(), {
        type: "string",
        example: "example-slug-value",
      });
    } else if (column.type === TableColumnType.ShortText) {
      zodType = applyOpenApi(
        z.string(),
        ModelSchema.getTextOpenApi(column, SHORT_TEXT_EXAMPLE),
      );
    } else if (column.type === TableColumnType.LongText) {
      zodType = applyOpenApi(
        z.string(),
        ModelSchema.getTextOpenApi(column, LONG_TEXT_EXAMPLE),
      );
    } else if (column.type === TableColumnType.Phone) {
      zodType = getPhoneSchema();
    } else if (column.type === TableColumnType.Version) {
      zodType = getVersionSchema();
    } else if (column.type === TableColumnType.Password) {
      zodType = applyOpenApi(z.string(), {
        type: "string",
        format: "password",
        example: "••••••••",
      });
    } else if (column.type === TableColumnType.Name) {
      zodType = getNameSchema();
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
      zodType = getDomainSchema();
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
      // What a custom field holds: "Text", "Number", "Dropdown"...
      zodType = applyOpenApi(z.string(), {
        type: "string",
        enum: Object.values(CustomFieldType),
        example: CustomFieldType.Text,
      });
    } else if (column.type === TableColumnType.MonitorType) {
      // A value the API takes ("HTTP" is none).
      zodType = applyOpenApi(z.string(), {
        type: "string",
        enum: Object.values(MonitorType),
        example: MonitorType.Manual,
      });
    } else if (column.type === TableColumnType.WorkflowStatus) {
      zodType = applyOpenApi(z.string(), {
        type: "string",
        enum: Object.values(WorkflowStatus),
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

    /*
     * A secret - an encrypted or hashed column, or one its model marks
     * secret: a password, a token, a key - so the spec says so
     * (annotateSecret): the Terraform provider marks the attribute
     * Sensitive, and plans and outputs never print it.
     */
    if (!disableOpenApiSchema) {
      zodType = ModelSchema.annotateSecret(zodType, column);
    }

    return zodType;
  }

  /*
   * Whether a column's value is a secret: a hashed or password column, an
   * encrypted text column, or one its model marks `secret` - a key, a
   * token or a webhook address stored as it is (TableColumnMetadata.secret).
   */
  public static isSecretColumn(column: TableColumnMetadata): boolean {
    return (
      Boolean(column.secret) ||
      column.type === TableColumnType.HashedString ||
      column.type === TableColumnType.Password ||
      Boolean(
        column.encrypted && ENCRYPTED_SECRET_COLUMN_TYPES.includes(column.type),
      )
    );
  }

  /*
   * A secret, as the spec says it: x-oneuptime-secret on every one, which
   * the clients published from the spec read (the Terraform provider marks
   * the attribute Sensitive), and format: password on an encrypted text
   * column, as OpenAPI writes a secret string. A secret of another type
   * keeps its own format - an API key is still a uuid.
   */
  private static annotateSecret(
    zodType: ZodTypes.ZodTypeAny,
    column: TableColumnMetadata,
  ): ZodTypes.ZodTypeAny {
    if (!ModelSchema.isSecretColumn(column)) {
      return zodType;
    }

    let annotated: ZodTypes.ZodTypeAny = zodType.openapi({
      "x-oneuptime-secret": true,
    } as any);

    if (
      column.encrypted &&
      ENCRYPTED_SECRET_COLUMN_TYPES.includes(column.type)
    ) {
      annotated = annotated.openapi({ format: "password" });
    }

    return annotated;
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
      case TableColumnType.VeryLongText:
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
