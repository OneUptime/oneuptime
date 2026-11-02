import z, { ZodSchema } from "./Zod";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { z as ZodTypes } from "zod";
import {
  ALWAYS_READABLE_COLUMNS,
  BaseSchema,
  SchemaExample,
  ShapeRecord,
} from "./BaseSchema";
import { getIPSchema, getObjectIDSchema, getPortSchema } from "./TypeSchemas";

export type AnalyticsModelSchemaType = ZodSchema;

/*
 * WHAT A TELEMETRY QUERY CAN DO WITH A COLUMN OF EACH TYPE, as
 * StatementGenerator compiles it: Tests/Utils/Schema/AnalyticsModelSchema runs
 * every operator listed here through it, on every column of every telemetry
 * table. The OpenAPI spec and the MCP server's oneuptime_describe_resource
 * both read these lists.
 */
const PRESENCE_OPERATORS: Array<string> = ["IsNull", "NotNull"];

const EQUALITY_OPERATORS: Array<string> = [
  "EqualTo",
  "NotEqual",
  ...PRESENCE_OPERATORS,
];

// IN (...) on a column of one value, hasAny on an Array(String).
const ID_OPERATORS: Array<string> = [...EQUALITY_OPERATORS, "Includes"];

const RANGE_OPERATORS: Array<string> = [
  ...EQUALITY_OPERATORS,
  "GreaterThan",
  "GreaterThanOrEqual",
  "LessThan",
  "LessThanOrEqual",
  "InBetween",
];

const OPERATORS_BY_COLUMN_TYPE: Record<TableColumnType, Array<string>> = {
  [TableColumnType.Text]: [...ID_OPERATORS, "EqualToOrNull", "Search"],
  [TableColumnType.ObjectID]: ID_OPERATORS,
  [TableColumnType.IP]: ID_OPERATORS,
  [TableColumnType.ArrayText]: [...ID_OPERATORS, "Search"],
  [TableColumnType.Boolean]: EQUALITY_OPERATORS,
  /*
   * A telemetry table's time column (time, startTime, windowStart,
   * validFrom) is a DateTime64. An ISO-8601 time binds as either type.
   */
  [TableColumnType.Date]: RANGE_OPERATORS,
  [TableColumnType.DateTime64]: RANGE_OPERATORS,
  [TableColumnType.Number]: RANGE_OPERATORS,
  [TableColumnType.LongNumber]: RANGE_OPERATORS,
  [TableColumnType.BigNumber]: RANGE_OPERATORS,
  [TableColumnType.Decimal]: RANGE_OPERATORS,
  [TableColumnType.UInt8]: RANGE_OPERATORS,
  [TableColumnType.UInt64]: RANGE_OPERATORS,
  [TableColumnType.Port]: RANGE_OPERATORS,
  // On each key: {"attributes": {"<key>": <value or operator>}}.
  [TableColumnType.MapStringString]: [...EQUALITY_OPERATORS, "Search"],
  [TableColumnType.ArrayNumber]: PRESENCE_OPERATORS,
  [TableColumnType.ArrayBigNumber]: PRESENCE_OPERATORS,
  [TableColumnType.ArrayDecimal]: PRESENCE_OPERATORS,
  [TableColumnType.JSON]: PRESENCE_OPERATORS,
  [TableColumnType.JSONArray]: PRESENCE_OPERATORS,
  // A pre-aggregate's state, which nothing compares with.
  [TableColumnType.AggregateFunction]: [],
};

const TIME_COLUMN_TYPES: Array<TableColumnType> = [
  TableColumnType.Date,
  TableColumnType.DateTime64,
];

/*
 * 64 bits and wider: a JSON number past 2^53 loses digits, so a value can
 * also be sent as a string of digits.
 */
const WIDE_INTEGER_COLUMN_TYPES: Array<TableColumnType> = [
  TableColumnType.LongNumber,
  TableColumnType.BigNumber,
  TableColumnType.UInt64,
];

const EXAMPLE_TIME: string = "2026-01-01T00:00:00.000Z";

// EXAMPLE_TIME in nanoseconds, as a 64-bit column takes it.
const EXAMPLE_UNIX_NANO: string = "1767225600000000000";

const EXAMPLE_ID: string = "123e4567-e89b-12d3-a456-426614174000";

const DIGITS: RegExp = /^[0-9]+$/;

/*
 * The columns the API writes itself: a record's ID and creation time
 * (AnalyticsDatabaseService.sanitizeCreate). An update leaves them out of
 * what it changes (BaseAnalyticsAPI.updateItem).
 */
const API_WRITTEN_COLUMNS: Array<string> = ["_id", "createdAt", "updatedAt"];

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
        zodType = getIPSchema();
      } else if (column.type === TableColumnType.Port) {
        zodType = getPortSchema();
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

  /*
   * A column's value as a create or update sends it: what
   * CommonModel.setColumnValue reads, and StatementGenerator writes into
   * the INSERT. Plain JSON - the request body is not deserialized, so a
   * {_type, value} wrapper is not read.
   */
  private static getWriteValueSchema(
    column: AnalyticsTableColumn,
    disableOpenApiSchema: boolean = false,
  ): ZodTypes.ZodTypeAny {
    switch (column.type) {
      case TableColumnType.ObjectID:
        return getObjectIDSchema();
      // ISO-8601, which setColumnValue reads as a date.
      case TableColumnType.Date:
      case TableColumnType.DateTime64:
        return this.applyOpenApi(
          z.string(),
          this.addDefaultToOpenApi(
            { type: "string", format: "date-time", example: EXAMPLE_TIME },
            column,
          ),
          disableOpenApiSchema,
        );
      /*
       * A JSON number past 2^53 loses digits: a UInt64 (a time in
       * nanoseconds, a byte count) is also taken as a string of digits,
       * which the INSERT casts whole.
       */
      case TableColumnType.UInt64:
        return this.applyOpenApi(
          z.union([z.number(), z.string().regex(DIGITS)]),
          this.addDefaultToOpenApi({ example: EXAMPLE_UNIX_NANO }, column),
          disableOpenApiSchema,
        );
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
      // Also read from a string, as a number: past 2^53 digits are lost.
      case TableColumnType.LongNumber:
      case TableColumnType.BigNumber:
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
      // Any JSON value: an object, or an array, as a span's links are.
      case TableColumnType.JSON:
        return this.applyOpenApi(
          z.any(),
          this.addDefaultToOpenApi({ example: { key: "value" } }, column),
          disableOpenApiSchema,
        );
      // Strings by key, as a log's or a span's attributes.
      case TableColumnType.MapStringString:
        return this.applyOpenApi(
          z.object({}).catchall(z.string()),
          this.addDefaultToOpenApi(
            { example: { "http.method": "GET" } },
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
      case TableColumnType.ArrayDecimal:
      case TableColumnType.ArrayBigNumber:
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
        return getIPSchema();
      case TableColumnType.Port:
        return getPortSchema();
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

  /*
   * The fields a create may send: the columns somebody may create. One with
   * a default is optional - the API writes the default
   * (AnalyticsDatabaseService.checkRequiredFields) - and so is the project,
   * which the API takes from the request. Its example sends the fields it
   * requires.
   *
   * Its .openapi() names no `type`: zod-to-openapi takes a `type` there for
   * the whole schema and leaves out the properties it would have generated,
   * so the spec listed no field of a telemetry create or update.
   */
  public static getCreateModelSchema(data: {
    modelType: new () => AnalyticsBaseModel;
    disableOpenApiSchema?: boolean;
  }): AnalyticsModelSchemaType {
    const model: AnalyticsBaseModel = new data.modelType();
    const disableOpenApiSchema: boolean = data.disableOpenApiSchema || false;
    // The API writes the request's project there - the API key's.
    const tenantColumn: string | undefined = model.getTenantColumn()?.key;
    const shape: ShapeRecord = {};
    const example: SchemaExample = {};

    for (const column of this.getWritableColumns(model, "create")) {
      const value: ZodTypes.ZodTypeAny = this.getWriteValueSchema(
        column,
        disableOpenApiSchema,
      );
      const isRequired: boolean =
        column.required &&
        !column.isDefaultValueColumn &&
        column.key !== tenantColumn;

      shape[column.key] = this.applyOpenApi(
        isRequired ? value : value.optional(),
        { description: column.description || column.title },
        disableOpenApiSchema,
      );

      if (isRequired) {
        example[column.key] = this.getExampleValueForColumn(column.type);
      }
    }

    return this.applyOpenApi(
      z.object(shape),
      {
        description: `Create schema for ${model.tableName || "analytics model"}`,
        example: example,
        additionalProperties: false,
      },
      disableOpenApiSchema,
    );
  }

  /*
   * The fields an update may change: the columns somebody may update - on
   * a telemetry table today, none - each optional, as an update changes
   * what it sends.
   */
  public static getUpdateModelSchema(data: {
    modelType: new () => AnalyticsBaseModel;
    disableOpenApiSchema?: boolean;
  }): AnalyticsModelSchemaType {
    const model: AnalyticsBaseModel = new data.modelType();
    const disableOpenApiSchema: boolean = data.disableOpenApiSchema || false;
    const tableName: string = model.tableName || "analytics model";
    const shape: ShapeRecord = {};
    const example: SchemaExample = {};

    for (const column of this.getWritableColumns(model, "update")) {
      shape[column.key] = this.applyOpenApi(
        this.getWriteValueSchema(column, disableOpenApiSchema).optional(),
        { description: column.description || column.title },
        disableOpenApiSchema,
      );

      if (Object.keys(example).length === 0) {
        example[column.key] = this.getExampleValueForColumn(column.type);
      }
    }

    return this.applyOpenApi(
      z.object(shape),
      {
        description:
          Object.keys(shape).length > 0
            ? `Update schema for ${tableName}. An update changes the fields it sends.`
            : `Update schema for ${tableName}. No field can be updated: the API refuses an update of any field.`,
        example: example,
        additionalProperties: false,
      },
      disableOpenApiSchema,
    );
  }

  /*
   * The columns a create or update may name: those somebody may write (the
   * API refuses the others: ModelPermission.checkCreatePermissions and
   * checkUpdatePermissions), less those it writes itself.
   */
  private static getWritableColumns(
    model: AnalyticsBaseModel,
    operation: "create" | "update",
  ): Array<AnalyticsTableColumn> {
    return model
      .getTableColumns()
      .filter((column: AnalyticsTableColumn): boolean => {
        const accessControl: ColumnAccessControl | null =
          model.getColumnAccessControlFor(column.key);

        return (
          !API_WRITTEN_COLUMNS.includes(column.key) &&
          (accessControl?.[operation] || []).length > 0
        );
      });
  }

  /*
   * The columns a query may name, each with what it can be compared with.
   *
   * Neither this object's .openapi() nor a column's names a `type`:
   * zod-to-openapi takes a `type` there for the whole schema and leaves out
   * the properties and operators it would have generated, so the spec listed
   * no field of a telemetry query at all.
   */
  public static getQueryModelSchema(data: {
    modelType: new () => AnalyticsBaseModel;
    disableOpenApiSchema?: boolean;
  }): AnalyticsModelSchemaType {
    const model: AnalyticsBaseModel = new data.modelType();
    const disableOpenApiSchema: boolean = data.disableOpenApiSchema || false;
    const shape: ShapeRecord = {};

    for (const column of this.getQueryableColumns(model)) {
      const operators: Array<string> = this.getValidOperatorsForColumnType(
        column.type,
      );

      shape[column.key] = this.applyOpenApi(
        this.getColumnQuerySchema(column.type, operators).optional(),
        {
          description: this.getColumnQueryDescription(column, operators),
          example: this.getColumnQueryExample(column.type),
        },
        disableOpenApiSchema,
      );
    }

    // A telemetry table is sorted by its time, which every query should bound.
    const sortColumn: AnalyticsTableColumn | null = model.getTableColumn(
      model.defaultSortColumn,
    );
    const timeColumn: AnalyticsTableColumn | null =
      sortColumn &&
      shape[sortColumn.key] &&
      TIME_COLUMN_TYPES.includes(sortColumn.type)
        ? sortColumn
        : null;

    return this.applyOpenApi(
      z.object(shape),
      {
        description: `Query schema for ${model.tableName || "analytics_model"}. A field takes a plain value, which it matches exactly, or an operator its type allows.${
          timeColumn
            ? ` Telemetry tables are large: bound every query by ${timeColumn.key}.`
            : ""
        }`,
        example: timeColumn
          ? {
              [timeColumn.key]: this.getColumnQueryExample(timeColumn.type),
            }
          : {},
        additionalProperties: false,
      },
      disableOpenApiSchema,
    );
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
        return this.getReadableColumns(model).map(
          (column: AnalyticsTableColumn) => {
            return { key: column.key, type: column.type };
          },
        );
      },
      getSelectSchemaExample: () => {
        return this.getSelectSchemaExample(modelType);
      },
    });
  }

  // No `type` in .openapi() here either, so the spec lists the fields.
  public static getSortModelSchema(data: {
    modelType: new () => AnalyticsBaseModel;
    disableOpenApiSchema?: boolean;
  }): AnalyticsModelSchemaType {
    const model: AnalyticsBaseModel = new data.modelType();
    const disableOpenApiSchema: boolean = data.disableOpenApiSchema || false;
    const sortableTypes: Array<TableColumnType> = this.getSortableTypes();
    const shape: ShapeRecord = {};

    for (const column of model.getTableColumns()) {
      if (!sortableTypes.includes(column.type)) {
        continue;
      }

      shape[column.key] = this.applyOpenApi(
        z.enum([SortOrder.Ascending, SortOrder.Descending]).optional(),
        {
          description: `Sort order for ${column.key} field`,
          example: SortOrder.Descending,
        },
        disableOpenApiSchema,
      );
    }

    return this.applyOpenApi(
      z.object(shape),
      {
        description: `Sort schema for ${model.tableName || "analytics_model"}. Only sortable fields are included.`,
        example: shape[model.defaultSortColumn]
          ? { [model.defaultSortColumn]: SortOrder.Descending }
          : {},
        additionalProperties: false,
      },
      disableOpenApiSchema,
    );
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
        return this.getReadableColumns(model).map(
          (column: AnalyticsTableColumn) => {
            return { key: column.key, type: column.type };
          },
        );
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

  /*
   * The column types a telemetry query can be sorted on. StatementGenerator
   * orders by any column; arrays, JSON, maps and aggregate states have no
   * order worth asking for.
   */
  public static getSortableTypes(): Array<TableColumnType> {
    return [
      TableColumnType.Text,
      TableColumnType.Number,
      TableColumnType.LongNumber,
      TableColumnType.BigNumber,
      TableColumnType.UInt8,
      TableColumnType.UInt64,
      TableColumnType.Date,
      TableColumnType.DateTime64,
      TableColumnType.Boolean,
      TableColumnType.ObjectID,
      TableColumnType.Decimal,
      TableColumnType.IP,
      TableColumnType.Port,
    ];
  }

  /*
   * The operators a query can use on a column of this type - on a
   * Map(String, String) column, on each of its keys. None: the column cannot
   * be filtered.
   */
  public static getValidOperatorsForColumnType(
    columnType: TableColumnType,
  ): Array<string> {
    return OPERATORS_BY_COLUMN_TYPE[columnType] || [];
  }

  // Those of the columns a query may name that it can compare with something.
  private static getQueryableColumns(
    model: AnalyticsBaseModel,
  ): Array<AnalyticsTableColumn> {
    return this.getReadableColumns(model).filter(
      (column: AnalyticsTableColumn): boolean => {
        return this.getValidOperatorsForColumnType(column.type).length > 0;
      },
    );
  }

  /*
   * The columns a query, select or group by may name: those somebody may
   * read, and those the API lets through all the same. It refuses any other
   * column nobody may read, such as a table's retentionDate.
   */
  private static getReadableColumns(
    model: AnalyticsBaseModel,
  ): Array<AnalyticsTableColumn> {
    return model
      .getTableColumns()
      .filter((column: AnalyticsTableColumn): boolean => {
        const accessControl: ColumnAccessControl | null =
          model.getColumnAccessControlFor(column.key);

        return (
          ALWAYS_READABLE_COLUMNS.includes(column.key) ||
          (accessControl?.read || []).length > 0
        );
      });
  }

  /*
   * A plain value, or an object of one of the operators - on a map, under
   * each key.
   */
  private static getColumnQuerySchema(
    columnType: TableColumnType,
    operators: Array<string>,
  ): ZodTypes.ZodTypeAny {
    const operatorSchemas: Array<ZodTypes.ZodTypeAny> = operators.map(
      (operator: string): ZodTypes.ZodTypeAny => {
        return this.getOperatorSchema(operator, columnType);
      },
    );

    const valueOrOperator: ZodTypes.ZodTypeAny =
      operatorSchemas.length === 1
        ? operatorSchemas[0]!
        : z.union(
            operatorSchemas as [
              ZodTypes.ZodTypeAny,
              ZodTypes.ZodTypeAny,
              ...ZodTypes.ZodTypeAny[],
            ],
          );

    /*
     * A map is filtered by key. A `_type` among the keys would be read as an
     * operator on the whole map, which StatementGenerator compiles none of.
     */
    if (columnType === TableColumnType.MapStringString) {
      return z
        .object({})
        .catchall(valueOrOperator)
        .refine((keys: Record<string, unknown>): boolean => {
          return !("_type" in keys);
        }, 'A map is filtered by key: {"<key>": <value or operator>}.');
    }

    return valueOrOperator;
  }

  private static getColumnQueryDescription(
    column: AnalyticsTableColumn,
    operators: Array<string>,
  ): string {
    let description: string = `Query operators for ${column.key} field of type ${column.type}. Supported operators: ${operators.join(", ")}.`;

    if (column.type === TableColumnType.MapStringString) {
      description += ` Filtered by key, each key with these operators: {"${column.key}": {"<key>": <value or operator>}}.`;
    } else if (column.type === TableColumnType.ArrayText) {
      description += ` EqualTo, NotEqual and Search match one element; Includes matches any of several.`;
    } else if (TIME_COLUMN_TYPES.includes(column.type)) {
      description += ` Times are ISO-8601, such as ${EXAMPLE_TIME}.`;
    } else if (WIDE_INTEGER_COLUMN_TYPES.includes(column.type)) {
      description += ` A value past 2^53 is sent as a string of digits.`;
    }

    return description;
  }

  private static getColumnQueryExample(columnType: TableColumnType): unknown {
    if (TIME_COLUMN_TYPES.includes(columnType)) {
      return { _type: "GreaterThan", value: EXAMPLE_TIME };
    }

    if (WIDE_INTEGER_COLUMN_TYPES.includes(columnType)) {
      return { _type: "GreaterThan", value: "1767225600000000000" };
    }

    switch (columnType) {
      case TableColumnType.Number:
      case TableColumnType.Decimal:
      case TableColumnType.UInt8:
      case TableColumnType.Port:
        return { _type: "GreaterThan", value: 42 };
      case TableColumnType.ObjectID:
        return "123e4567-e89b-12d3-a456-426614174000";
      case TableColumnType.IP:
        return "192.168.1.1";
      case TableColumnType.Boolean:
        return true;
      case TableColumnType.ArrayText:
        return { _type: "EqualTo", value: "item1" };
      case TableColumnType.MapStringString:
        return { key: "value" };
      case TableColumnType.Text:
        return "example text";
      default:
        return { _type: "NotNull" };
    }
  }

  // A value of a column of this type, as a create or update sends it.
  private static getExampleValueForColumn(
    columnType: TableColumnType,
  ): unknown {
    switch (columnType) {
      case TableColumnType.ObjectID:
        return EXAMPLE_ID;
      case TableColumnType.Text:
        return "example text";
      case TableColumnType.Number:
      case TableColumnType.LongNumber:
      case TableColumnType.BigNumber:
        return 42;
      case TableColumnType.UInt64:
        return EXAMPLE_UNIX_NANO;
      case TableColumnType.Decimal:
        return 123.45;
      case TableColumnType.Date:
      case TableColumnType.DateTime64:
        return EXAMPLE_TIME;
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

  // An operator as JSONFunctions.deserialize reads it on the API.
  private static getOperatorSchema(
    operatorType: string,
    columnType: TableColumnType,
  ): ZodTypes.ZodTypeAny {
    const value: ZodTypes.ZodTypeAny = this.getQueryValueSchema(columnType);

    switch (operatorType) {
      /*
       * A plain value matches exactly. An Array(String) column's plain value
       * is the whole array, so one element is asked for with EqualTo itself.
       */
      case "EqualTo":
        return columnType === TableColumnType.ArrayText
          ? z.object({ _type: z.literal(operatorType), value: value })
          : value;

      case "IsNull":
      case "NotNull":
        return z.object({ _type: z.literal(operatorType) });

      case "InBetween":
        return z.object({
          _type: z.literal(operatorType),
          startValue: value,
          endValue: value,
        });

      case "Includes":
        return z.object({
          _type: z.literal(operatorType),
          value: z.array(value),
        });

      case "Search":
        return z.object({ _type: z.literal(operatorType), value: z.string() });

      default:
        return z.object({ _type: z.literal(operatorType), value: value });
    }
  }

  /*
   * What a query compares a column of this type with, as JSON carries it: on
   * an Array(String), one element; on a map, a key's value.
   */
  private static getQueryValueSchema(
    columnType: TableColumnType,
  ): ZodTypes.ZodTypeAny {
    if (TIME_COLUMN_TYPES.includes(columnType)) {
      return z.string().openapi({ format: "date-time" });
    }

    if (WIDE_INTEGER_COLUMN_TYPES.includes(columnType)) {
      return z.union([z.number(), z.string()]);
    }

    switch (columnType) {
      case TableColumnType.Number:
      case TableColumnType.Decimal:
      case TableColumnType.UInt8:
      case TableColumnType.Port:
        return z.number();

      case TableColumnType.Boolean:
        return z.boolean();

      default:
        return z.string();
    }
  }
}
