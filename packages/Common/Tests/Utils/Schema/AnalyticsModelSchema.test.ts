import { AnalyticsModelSchema } from "../../../Utils/Schema/AnalyticsModelSchema";
import { ALWAYS_READABLE_COLUMNS } from "../../../Utils/Schema/BaseSchema";
import { z } from "zod";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Log from "../../../Models/AnalyticsModels/Log";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { ClickhouseAppInstance } from "../../../Server/Infrastructure/ClickhouseDatabase";
import AnalyticsModelPermission from "../../../Server/Types/AnalyticsDatabase/ModelPermission";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import "../../Server/TestingUtils/Init";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";

/*
 * Unit tests for AnalyticsModelSchema — the Zod schema generator that backs the
 * OpenAPI spec and request validation for every ClickHouse-backed analytics
 * model (Log, Span, Metric, RUM, …).
 *
 * The generator is pure: it instantiates a model, reads its column metadata and
 * per-column access control, and derives a Zod schema. No database access is
 * involved, so these tests exercise the real production code paths directly.
 *
 * Assertions are derived dynamically from each model's own column metadata
 * rather than hard-coding column names, so they stay correct as models evolve
 * while still pinning down the type/permission semantics that the schema must
 * preserve.
 */

type ModelCtor = new () => AnalyticsBaseModel;

/*
 * Column types the generator treats as sortable (see getSortableTypes()):
 * every telemetry table's time column, a DateTime64, among them.
 */
const SORTABLE_TYPES: Array<TableColumnType> = [
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

// Column types the generator treats as groupable (see getGroupByModelSchema()).
const GROUPABLE_TYPES: Array<TableColumnType> = [
  TableColumnType.Text,
  TableColumnType.ObjectID,
  TableColumnType.Boolean,
  TableColumnType.Date,
  TableColumnType.Number,
  TableColumnType.IP,
  TableColumnType.Port,
];

const CREATE_EXCLUDED_FIELDS: Array<string> = ["_id", "createdAt", "updatedAt"];

const isZodObject: (schema: unknown) => boolean = (
  schema: unknown,
): boolean => {
  return schema instanceof z.ZodObject;
};

const shapeKeys: (schema: any) => Array<string> = (
  schema: any,
): Array<string> => {
  return Object.keys(schema.shape);
};

const findColumnOfType: (
  columns: Array<AnalyticsTableColumn>,
  type: TableColumnType,
  keysAllowed: Array<string>,
) => AnalyticsTableColumn | undefined = (
  columns: Array<AnalyticsTableColumn>,
  type: TableColumnType,
  keysAllowed: Array<string>,
): AnalyticsTableColumn | undefined => {
  return columns.find((column: AnalyticsTableColumn) => {
    return column.type === type && keysAllowed.includes(column.key);
  });
};

// The tables the REST API serves, and so the OpenAPI spec documents.
const API_MODELS: Array<ModelCtor> = (
  AnalyticsModels as Array<ModelCtor>
).filter((modelType: ModelCtor): boolean => {
  return Boolean(new modelType().crudApiPath);
});

const A_UUID: string = "5f0e8e3a-1f24-4a2f-9e4c-2b1d3c4e5f60";
const A_TIME: string = "2026-07-01T00:00:00.000Z";
const A_LATER_TIME: string = "2026-07-02T00:00:00.000Z";

// Past 2^53, where a JSON number loses digits.
const A_WIDE_INTEGER: string = "1751328000000000001";

const TIME_TYPES: Array<TableColumnType> = [
  TableColumnType.Date,
  TableColumnType.DateTime64,
];

const WIDE_INTEGER_TYPES: Array<TableColumnType> = [
  TableColumnType.LongNumber,
  TableColumnType.BigNumber,
  TableColumnType.UInt64,
];

const NUMBER_TYPES: Array<TableColumnType> = [
  TableColumnType.Number,
  TableColumnType.Decimal,
  TableColumnType.UInt8,
  TableColumnType.Port,
];

// The operators that compare a column with a value of its own type.
const COMPARING_OPERATORS: Array<string> = [
  "EqualTo",
  "NotEqual",
  "EqualToOrNull",
  "GreaterThan",
  "GreaterThanOrEqual",
  "LessThan",
  "LessThanOrEqual",
  "InBetween",
];

/*
 * The ClickHouse type a compared value binds as, by the column's type: the
 * column's own, so a time is compared as a time and a UInt64 keeps its digits.
 */
const BOUND_AS: Partial<Record<TableColumnType, string>> = {
  [TableColumnType.DateTime64]: "DateTime64(9)",
  [TableColumnType.Date]: "DateTime",
  [TableColumnType.UInt64]: "UInt64",
  [TableColumnType.BigNumber]: "Int64",
  [TableColumnType.LongNumber]: "Int128",
  [TableColumnType.Number]: "Int32",
  [TableColumnType.Decimal]: "Double",
  [TableColumnType.Boolean]: "Bool",
  [TableColumnType.Text]: "String",
  [TableColumnType.ObjectID]: "String",
};

// A project owner: who may filter on the most.
const PROJECT_ID: ObjectID = ObjectID.generate();

const OWNER: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  userType: UserType.User,
  tenantId: PROJECT_ID,
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectOwner,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    },
  },
};

// A value a column of this type holds, as a request writes it.
const valueFor: (type: TableColumnType) => JSONValue = (
  type: TableColumnType,
): JSONValue => {
  if (TIME_TYPES.includes(type)) {
    return A_TIME;
  }

  if (WIDE_INTEGER_TYPES.includes(type)) {
    return A_WIDE_INTEGER;
  }

  if (NUMBER_TYPES.includes(type)) {
    return 5;
  }

  if (type === TableColumnType.Boolean) {
    return true;
  }

  if (type === TableColumnType.ObjectID) {
    return A_UUID;
  }

  return "sample";
};

// An operator as the query schema documents it.
const filterFor: (operator: string, type: TableColumnType) => JSONValue = (
  operator: string,
  type: TableColumnType,
): JSONValue => {
  const value: JSONValue = valueFor(type);

  switch (operator) {
    case "EqualTo":
      return type === TableColumnType.ArrayText
        ? { _type: operator, value: value }
        : value;
    case "IsNull":
    case "NotNull":
      return { _type: operator };
    case "InBetween":
      return {
        _type: operator,
        startValue: value,
        endValue: TIME_TYPES.includes(type) ? A_LATER_TIME : value,
      };
    case "Includes":
      return { _type: operator, value: [value, value] };
    default:
      return { _type: operator, value: value };
  }
};

// A query on one column: on a map, on one of its keys.
const queryFor: (
  column: AnalyticsTableColumn,
  operator: string,
) => JSONObject = (
  column: AnalyticsTableColumn,
  operator: string,
): JSONObject => {
  const filter: JSONValue = filterFor(operator, column.type);

  return {
    [column.key]:
      column.type === TableColumnType.MapStringString
        ? { "http.method": filter }
        : filter,
  };
};

const generatorFor: (
  modelType: ModelCtor,
) => StatementGenerator<AnalyticsBaseModel> = (
  modelType: ModelCtor,
): StatementGenerator<AnalyticsBaseModel> => {
  return new StatementGenerator<AnalyticsBaseModel>({
    modelType: modelType,
    database: ClickhouseAppInstance,
  });
};

// The WHERE clause the API runs for a query, as it arrives in a request body.
const whereStatementFor: (
  modelType: ModelCtor,
  query: JSONObject,
) => Statement = (modelType: ModelCtor, query: JSONObject): Statement => {
  const statement: Statement = generatorFor(modelType).toWhereStatement(
    JSONFunctions.deserialize(query) as never,
  );

  // Reading these binds the parameters, which is where a bad value throws.
  expect(statement.query).not.toBe("");
  expect(statement.query_params).toBeDefined();

  return statement;
};

// What the API checks of a query's fields before it runs it.
const checkQueryPermission: (
  modelType: ModelCtor,
  query: JSONObject,
) => void = (modelType: ModelCtor, query: JSONObject): void => {
  (
    AnalyticsModelPermission as unknown as {
      checkQueryPermission: (
        modelType: ModelCtor,
        query: JSONObject,
        props: DatabaseCommonInteractionProps,
      ) => void;
    }
  ).checkQueryPermission(modelType, JSONFunctions.deserialize(query), OWNER);
};

/*
 * A table's query, sort, select, group by, create and update, as the
 * OpenAPI spec writes them.
 */
const renderedSchemas: (modelType: ModelCtor) => {
  query: JSONObject;
  sort: JSONObject;
  select: JSONObject;
  groupBy: JSONObject;
  create: JSONObject;
  update: JSONObject;
} = (
  modelType: ModelCtor,
): {
  query: JSONObject;
  sort: JSONObject;
  select: JSONObject;
  groupBy: JSONObject;
  create: JSONObject;
  update: JSONObject;
} => {
  const registry: OpenAPIRegistry = new OpenAPIRegistry();

  registry.register(
    "Query",
    AnalyticsModelSchema.getQueryModelSchema({ modelType }),
  );
  registry.register(
    "Sort",
    AnalyticsModelSchema.getSortModelSchema({ modelType }),
  );
  registry.register(
    "Select",
    AnalyticsModelSchema.getSelectModelSchema({ modelType }),
  );
  registry.register(
    "GroupBy",
    AnalyticsModelSchema.getGroupByModelSchema({ modelType }),
  );
  registry.register(
    "Create",
    AnalyticsModelSchema.getCreateModelSchema({ modelType }),
  );
  registry.register(
    "Update",
    AnalyticsModelSchema.getUpdateModelSchema({ modelType }),
  );

  const schemas: JSONObject = (new OpenApiGeneratorV3(
    registry.definitions,
  ).generateComponents().components?.schemas || {}) as JSONObject;

  return {
    query: schemas["Query"] as JSONObject,
    sort: schemas["Sort"] as JSONObject,
    select: schemas["Select"] as JSONObject,
    groupBy: schemas["GroupBy"] as JSONObject,
    create: schemas["Create"] as JSONObject,
    update: schemas["Update"] as JSONObject,
  };
};

/*
 * The tables a create can reach, and those an update can: the spec
 * documents both.
 */
const CREATABLE_MODELS: Array<ModelCtor> = API_MODELS.filter(
  (modelType: ModelCtor): boolean => {
    return new modelType().getCreatePermissions().length > 0;
  },
);

const UPDATABLE_MODELS: Array<ModelCtor> = API_MODELS.filter(
  (modelType: ModelCtor): boolean => {
    return new modelType().getUpdatePermissions().length > 0;
  },
);

/*
 * The values a rendered create or update field takes, one of each form it
 * allows: a time, an ID, a string of digits, a number...
 */
const writeValuesFor: (field: JSONObject) => Array<JSONValue> = (
  field: JSONObject,
): Array<JSONValue> => {
  const forms: Array<JSONObject> = (field["anyOf"] as
    | Array<JSONObject>
    | undefined) || [field];

  return forms.map((form: JSONObject): JSONValue => {
    if (form["format"] === "date-time") {
      return A_TIME;
    }

    if (form["format"] === "uuid") {
      return A_UUID;
    }

    if (form["pattern"]) {
      return A_WIDE_INTEGER;
    }

    switch (form["type"]) {
      case "number":
        return 5;
      case "boolean":
        return true;
      case "string":
        return "sample";
      default:
        throw new Error(`No value for a field of ${JSON.stringify(form)}`);
    }
  });
};

// What a create's INSERT holds for each of the table's columns, in order.
const insertedValuesOf: (
  modelType: ModelCtor,
  item: AnalyticsBaseModel,
) => Array<unknown> = (
  modelType: ModelCtor,
  item: AnalyticsBaseModel,
): Array<unknown> => {
  return (
    generatorFor(modelType) as unknown as {
      getRecord: (item: AnalyticsBaseModel) => Array<unknown>;
    }
  ).getRecord(item);
};

// What the API checks of an update's fields before it writes them.
const checkUpdatedColumns: (
  modelType: ModelCtor,
  item: AnalyticsBaseModel,
) => void = (modelType: ModelCtor, item: AnalyticsBaseModel): void => {
  (
    AnalyticsModelPermission as unknown as {
      checkDataColumnPermissions: (
        modelType: ModelCtor,
        data: AnalyticsBaseModel,
        props: DatabaseCommonInteractionProps,
        requestType: DatabaseRequestType,
      ) => void;
    }
  ).checkDataColumnPermissions(
    modelType,
    item,
    OWNER,
    DatabaseRequestType.Update,
  );
};

/*
 * Whether a select, a group by or a query may name a column: somebody may
 * read it, or the API lets it through all the same.
 */
const isReadable: (column: AnalyticsTableColumn) => boolean = (
  column: AnalyticsTableColumn,
): boolean => {
  return (
    ALWAYS_READABLE_COLUMNS.includes(column.key) ||
    (column.accessControl?.read || []).length > 0
  );
};

// What the API checks of a select's fields before it runs it.
const checkSelectPermission: (
  modelType: ModelCtor,
  select: JSONObject,
) => void = (modelType: ModelCtor, select: JSONObject): void => {
  (
    AnalyticsModelPermission as unknown as {
      checkSelectPermission: (
        modelType: ModelCtor,
        select: JSONObject,
        props: DatabaseCommonInteractionProps,
      ) => void;
    }
  ).checkSelectPermission(modelType, select, OWNER);
};

/*
 * The operators a field of a rendered query schema takes: each branch's
 * `_type`, and EqualTo for a plain value. A map's are under each key.
 */
const renderedOperators: (field: JSONObject) => Array<string> = (
  field: JSONObject,
): Array<string> => {
  const valueOrOperator: JSONObject =
    (field["additionalProperties"] as JSONObject | undefined) || field;
  const branches: Array<JSONObject> = (valueOrOperator["anyOf"] as
    | Array<JSONObject>
    | undefined) || [valueOrOperator];

  return [
    ...new Set(
      branches.map((branch: JSONObject): string => {
        const type: JSONObject | undefined = (
          branch["properties"] as JSONObject | undefined
        )?.["_type"] as JSONObject | undefined;

        return type
          ? ((type["enum"] as Array<string>)[0] as string)
          : "EqualTo";
      }),
    ),
  ].sort();
};

describe("AnalyticsModelSchema", () => {
  describe("getModelSchema (read schema)", () => {
    test("returns a non-empty ZodObject for a real model", () => {
      const schema: any = AnalyticsModelSchema.getModelSchema({
        modelType: Log,
      });

      expect(isZodObject(schema)).toBe(true);
      expect(shapeKeys(schema).length).toBeGreaterThan(0);
    });

    test("only includes columns that grant read access", () => {
      const model: Log = new Log();
      const schema: any = AnalyticsModelSchema.getModelSchema({
        modelType: Log,
      });
      const keys: Array<string> = shapeKeys(schema);

      // Every column that ended up in the schema must have read permissions.
      for (const key of keys) {
        const accessControl: any = model.getColumnAccessControlFor(key);
        expect(accessControl).toBeTruthy();
        expect(Array.isArray(accessControl.read)).toBe(true);
        expect(accessControl.read.length).toBeGreaterThan(0);
      }
    });

    test("validates the runtime type of a Text column", () => {
      const model: Log = new Log();
      const schema: any = AnalyticsModelSchema.getModelSchema({
        modelType: Log,
      });
      const textColumn: AnalyticsTableColumn | undefined = findColumnOfType(
        model.getTableColumns(),
        TableColumnType.Text,
        shapeKeys(schema),
      );

      // Guard: Log always exposes readable Text columns; assert we found one.
      expect(textColumn).toBeDefined();

      /*
       * Use partial() so unrelated required columns don't dominate the result;
       * this isolates the single field's type constraint.
       */
      const partial: any = schema.partial();

      expect(
        partial.safeParse({ [textColumn!.key]: "a string value" }).success,
      ).toBe(true);
      expect(partial.safeParse({ [textColumn!.key]: 12345 }).success).toBe(
        false,
      );
    });

    test("validates the runtime type of a Number column", () => {
      const model: Log = new Log();
      const schema: any = AnalyticsModelSchema.getModelSchema({
        modelType: Log,
      });
      const numberColumn: AnalyticsTableColumn | undefined = findColumnOfType(
        model.getTableColumns(),
        TableColumnType.Number,
        shapeKeys(schema),
      );

      expect(numberColumn).toBeDefined();

      const partial: any = schema.partial();

      expect(partial.safeParse({ [numberColumn!.key]: 42 }).success).toBe(true);
      expect(
        partial.safeParse({ [numberColumn!.key]: "not a number" }).success,
      ).toBe(false);
    });

    test("strips unknown keys instead of rejecting them", () => {
      const schema: any = AnalyticsModelSchema.getModelSchema({
        modelType: Log,
      });
      const parsed: any = schema
        .partial()
        .parse({ someKeyThatDoesNotExist: "value" });

      expect(parsed.someKeyThatDoesNotExist).toBeUndefined();
    });

    test("builds a schema for every registered analytics model", () => {
      for (const modelType of AnalyticsModels as Array<ModelCtor>) {
        const schema: any = AnalyticsModelSchema.getModelSchema({ modelType });
        expect(isZodObject(schema)).toBe(true);
      }
    });
  });

  describe("getCreateModelSchema", () => {
    test("excludes system-managed fields from the create shape", () => {
      const schema: any = AnalyticsModelSchema.getCreateModelSchema({
        modelType: Log,
      });
      const keys: Array<string> = shapeKeys(schema);

      for (const excluded of CREATE_EXCLUDED_FIELDS) {
        expect(keys).not.toContain(excluded);
      }
    });

    test("excludes default-value columns from the create shape", () => {
      const model: Log = new Log();
      const schema: any = AnalyticsModelSchema.getCreateModelSchema({
        modelType: Log,
      });
      const keys: Array<string> = shapeKeys(schema);

      for (const column of model.getTableColumns()) {
        if (column.isDefaultValueColumn) {
          expect(keys).not.toContain(column.key);
        }
      }
    });

    test("only includes columns that grant create access", () => {
      const model: Log = new Log();
      const schema: any = AnalyticsModelSchema.getCreateModelSchema({
        modelType: Log,
      });

      for (const key of shapeKeys(schema)) {
        const accessControl: any = model.getColumnAccessControlFor(key);
        expect(accessControl).toBeTruthy();
        expect(accessControl.create.length).toBeGreaterThan(0);
      }
    });

    test("rejects a payload missing a required create column", () => {
      const model: Log = new Log();
      const schema: any = AnalyticsModelSchema.getCreateModelSchema({
        modelType: Log,
      });
      const keys: Array<string> = shapeKeys(schema);

      const requiredColumns: Array<AnalyticsTableColumn> = model
        .getTableColumns()
        .filter((column: AnalyticsTableColumn) => {
          return column.required === true && keys.includes(column.key);
        });

      /*
       * Log has required, create-permitted columns (e.g. time); an empty
       * payload must therefore fail validation.
       */
      expect(requiredColumns.length).toBeGreaterThan(0);
      expect(schema.safeParse({}).success).toBe(false);
    });

    test("builds a create schema for every registered analytics model", () => {
      for (const modelType of AnalyticsModels as Array<ModelCtor>) {
        const schema: any = AnalyticsModelSchema.getCreateModelSchema({
          modelType,
        });
        expect(isZodObject(schema)).toBe(true);
      }
    });

    test("honours disableOpenApiSchema without changing validation", () => {
      const withOpenApi: any = AnalyticsModelSchema.getCreateModelSchema({
        modelType: Log,
      });
      const withoutOpenApi: any = AnalyticsModelSchema.getCreateModelSchema({
        modelType: Log,
        disableOpenApiSchema: true,
      });

      expect(isZodObject(withoutOpenApi)).toBe(true);
      expect(shapeKeys(withoutOpenApi).sort()).toEqual(
        shapeKeys(withOpenApi).sort(),
      );
    });
  });

  describe("getUpdateModelSchema", () => {
    test("builds an update schema for every registered analytics model", () => {
      for (const modelType of AnalyticsModels as Array<ModelCtor>) {
        const schema: any = AnalyticsModelSchema.getUpdateModelSchema({
          modelType,
        });
        expect(isZodObject(schema)).toBe(true);
      }
    });
  });

  describe("getSelectModelSchema", () => {
    test("marks every field as an optional boolean flag", () => {
      const schema: any = AnalyticsModelSchema.getSelectModelSchema({
        modelType: Log,
      });
      const keys: Array<string> = shapeKeys(schema);
      const someKey: string = keys[0]!;

      expect(keys.length).toBeGreaterThan(0);
      expect(schema.safeParse({}).success).toBe(true);
      expect(schema.safeParse({ [someKey]: true }).success).toBe(true);
      expect(schema.safeParse({ [someKey]: false }).success).toBe(true);
      expect(schema.safeParse({ [someKey]: "yes" }).success).toBe(false);
    });

    test("builds a select schema for every registered analytics model", () => {
      for (const modelType of AnalyticsModels as Array<ModelCtor>) {
        const schema: any = AnalyticsModelSchema.getSelectModelSchema({
          modelType,
        });
        expect(isZodObject(schema)).toBe(true);
      }
    });
  });

  describe("getSortModelSchema", () => {
    test("includes only sortable column types", () => {
      const model: Log = new Log();
      const schema: any = AnalyticsModelSchema.getSortModelSchema({
        modelType: Log,
      });
      const keys: Array<string> = shapeKeys(schema);

      for (const column of model.getTableColumns()) {
        if (SORTABLE_TYPES.includes(column.type)) {
          // Sortable columns must be present.
          expect(keys).toContain(column.key);
        } else {
          // Non-sortable columns (JSON, arrays, maps, …) must be omitted.
          expect(keys).not.toContain(column.key);
        }
      }
    });

    test("accepts only ASC/DESC sort orders", () => {
      const model: Log = new Log();
      const schema: any = AnalyticsModelSchema.getSortModelSchema({
        modelType: Log,
      });
      const sortableColumn: AnalyticsTableColumn | undefined = model
        .getTableColumns()
        .find((column: AnalyticsTableColumn) => {
          return SORTABLE_TYPES.includes(column.type);
        });

      expect(sortableColumn).toBeDefined();

      const key: string = sortableColumn!.key;

      expect(schema.safeParse({}).success).toBe(true);
      expect(schema.safeParse({ [key]: SortOrder.Ascending }).success).toBe(
        true,
      );
      expect(schema.safeParse({ [key]: SortOrder.Descending }).success).toBe(
        true,
      );
      expect(schema.safeParse({ [key]: "SIDEWAYS" }).success).toBe(false);
    });

    test("builds a sort schema for every registered analytics model", () => {
      for (const modelType of AnalyticsModels as Array<ModelCtor>) {
        const schema: any = AnalyticsModelSchema.getSortModelSchema({
          modelType,
        });
        expect(isZodObject(schema)).toBe(true);
      }
    });
  });

  describe("getGroupByModelSchema", () => {
    test("includes the readable columns of a groupable type", () => {
      const model: Log = new Log();
      const schema: any = AnalyticsModelSchema.getGroupByModelSchema({
        modelType: Log,
      });
      const keys: Array<string> = shapeKeys(schema);

      for (const column of model.getTableColumns()) {
        if (GROUPABLE_TYPES.includes(column.type) && isReadable(column)) {
          expect(keys).toContain(column.key);
        } else {
          expect(keys).not.toContain(column.key);
        }
      }

      // Nobody may read a log's retention date, which is a Date.
      expect(keys).not.toContain("retentionDate");
    });

    test("accepts only the literal true for a groupable field", () => {
      const model: Log = new Log();
      const schema: any = AnalyticsModelSchema.getGroupByModelSchema({
        modelType: Log,
      });
      const groupableColumn: AnalyticsTableColumn | undefined = model
        .getTableColumns()
        .find((column: AnalyticsTableColumn) => {
          return GROUPABLE_TYPES.includes(column.type);
        });

      expect(groupableColumn).toBeDefined();

      const key: string = groupableColumn!.key;

      expect(schema.safeParse({}).success).toBe(true);
      expect(schema.safeParse({ [key]: true }).success).toBe(true);
      // Only `true` is meaningful for grouping; `false` must be rejected.
      expect(schema.safeParse({ [key]: false }).success).toBe(false);
    });

    test("builds a group-by schema for every registered analytics model", () => {
      for (const modelType of AnalyticsModels as Array<ModelCtor>) {
        const schema: any = AnalyticsModelSchema.getGroupByModelSchema({
          modelType,
        });
        expect(isZodObject(schema)).toBe(true);
      }
    });
  });

  describe("getQueryModelSchema", () => {
    test("accepts an empty query and is a ZodObject", () => {
      const schema: any = AnalyticsModelSchema.getQueryModelSchema({
        modelType: Log,
      });

      expect(isZodObject(schema)).toBe(true);
      expect(schema.safeParse({}).success).toBe(true);
    });

    test("validates operator forms for a Text column", () => {
      const model: Log = new Log();
      const schema: any = AnalyticsModelSchema.getQueryModelSchema({
        modelType: Log,
      });
      const textColumn: AnalyticsTableColumn | undefined = findColumnOfType(
        model.getTableColumns(),
        TableColumnType.Text,
        shapeKeys(schema),
      );

      expect(textColumn).toBeDefined();

      const key: string = textColumn!.key;

      // EqualTo on a Text column is expressed as a bare string value.
      expect(schema.safeParse({ [key]: "some value" }).success).toBe(true);
      // Envelope operators that are valid for Text columns.
      expect(
        schema.safeParse({ [key]: { _type: "Search", value: "x" } }).success,
      ).toBe(true);
      expect(schema.safeParse({ [key]: { _type: "IsNull" } }).success).toBe(
        true,
      );
      /*
       * GreaterThan is not a valid operator for Text columns, so no union
       * branch accepts it.
       */
      expect(
        schema.safeParse({ [key]: { _type: "GreaterThan", value: "x" } })
          .success,
      ).toBe(false);
      // A numeric value has no matching branch for a Text column either.
      expect(schema.safeParse({ [key]: 12345 }).success).toBe(false);
    });

    test("validates numeric range operators for a Number column", () => {
      const model: Log = new Log();
      const schema: any = AnalyticsModelSchema.getQueryModelSchema({
        modelType: Log,
      });
      const numberColumn: AnalyticsTableColumn | undefined = findColumnOfType(
        model.getTableColumns(),
        TableColumnType.Number,
        shapeKeys(schema),
      );

      expect(numberColumn).toBeDefined();

      const key: string = numberColumn!.key;

      // EqualTo on a Number column is a bare numeric value.
      expect(schema.safeParse({ [key]: 5 }).success).toBe(true);
      // GreaterThan is valid for numeric columns and uses an envelope.
      expect(
        schema.safeParse({ [key]: { _type: "GreaterThan", value: 5 } }).success,
      ).toBe(true);
      // A string value does not satisfy any numeric branch.
      expect(
        schema.safeParse({ [key]: { _type: "GreaterThan", value: "nope" } })
          .success,
      ).toBe(false);
    });

    test("builds a query schema for every registered analytics model", () => {
      for (const modelType of AnalyticsModels as Array<ModelCtor>) {
        const schema: any = AnalyticsModelSchema.getQueryModelSchema({
          modelType,
        });
        expect(isZodObject(schema)).toBe(true);
      }
    });
  });
});

/*
 * WHAT THE QUERY AND SORT SCHEMAS SAY IS WHAT THE API DOES.
 *
 * They are the OpenAPI spec's account of a telemetry query, and the MCP
 * server's oneuptime_describe_resource reads their operator lists. They said
 * less than the API does - no range operator and no sort on a DateTime64, the
 * type of every telemetry table's time column, no Includes, and scalar
 * operators on a map that StatementGenerator refuses - so every operator they
 * list is held here to StatementGenerator, which compiles the query the API
 * runs, with no database: on every column of every table, written as the
 * schema documents it, its value bound as the column's own type.
 */
describe("the telemetry query schema says what StatementGenerator compiles", () => {
  test("covers the tables the API serves, so the checks below are not vacuous", () => {
    expect(API_MODELS.length).toBeGreaterThanOrEqual(14);
  });

  test("takes every operator it lists, which StatementGenerator compiles, on every column of every table", () => {
    const problems: Array<string> = [];
    let checked: number = 0;

    for (const modelType of AnalyticsModels as Array<ModelCtor>) {
      const model: AnalyticsBaseModel = new modelType();
      const schema: any = AnalyticsModelSchema.getQueryModelSchema({
        modelType,
      });

      for (const key of shapeKeys(schema)) {
        const column: AnalyticsTableColumn = model.getTableColumn(
          key,
        ) as AnalyticsTableColumn;

        for (const operator of AnalyticsModelSchema.getValidOperatorsForColumnType(
          column.type,
        )) {
          const at: string = `${model.tableName}.${key} ${operator}`;
          const query: JSONObject = queryFor(column, operator);

          if (!schema.safeParse(query).success) {
            problems.push(`${at}: the schema refuses ${JSON.stringify(query)}`);
            continue;
          }

          let statement: Statement;

          try {
            statement = whereStatementFor(modelType, query);
          } catch (error) {
            problems.push(`${at}: ${(error as Error).message}`);
            continue;
          }

          const boundAs: string | undefined = BOUND_AS[column.type];

          if (
            boundAs &&
            COMPARING_OPERATORS.includes(operator) &&
            !statement.query.includes(`:${boundAs}}`)
          ) {
            problems.push(`${at}: compiles to ${statement.query}`);
          }

          checked++;
        }
      }
    }

    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(3000);
  });

  test("gives a time, and a number of any width, the range operators", () => {
    for (const type of [
      ...TIME_TYPES,
      ...WIDE_INTEGER_TYPES,
      TableColumnType.Number,
      TableColumnType.Decimal,
      TableColumnType.UInt8,
    ]) {
      expect([
        type,
        AnalyticsModelSchema.getValidOperatorsForColumnType(type),
      ]).toEqual([
        type,
        expect.arrayContaining([
          "GreaterThan",
          "GreaterThanOrEqual",
          "LessThan",
          "LessThanOrEqual",
          "InBetween",
        ]),
      ]);
    }
  });

  test("gives IDs, text, IPs and an Array(String) Includes", () => {
    for (const type of [
      TableColumnType.ObjectID,
      TableColumnType.Text,
      TableColumnType.IP,
      TableColumnType.ArrayText,
    ]) {
      expect([
        type,
        AnalyticsModelSchema.getValidOperatorsForColumnType(type),
      ]).toEqual([type, expect.arrayContaining(["Includes"])]);
    }
  });

  test("bounds every table the API serves by its time column, an ISO-8601 time binding as a time", () => {
    for (const modelType of API_MODELS) {
      const model: AnalyticsBaseModel = new modelType();
      const timeColumn: AnalyticsTableColumn = model.getTableColumn(
        model.defaultSortColumn,
      ) as AnalyticsTableColumn;
      const boundAs: string = BOUND_AS[timeColumn.type] as string;

      expect([model.tableName, TIME_TYPES.includes(timeColumn.type)]).toEqual([
        model.tableName,
        true,
      ]);
      const query: JSONObject = {
        [timeColumn.key]: {
          _type: "InBetween",
          startValue: A_TIME,
          endValue: A_LATER_TIME,
        },
      };

      expect([
        model.tableName,
        AnalyticsModelSchema.getQueryModelSchema({ modelType }).safeParse(query)
          .success,
      ]).toEqual([model.tableName, true]);

      const statement: Statement = whereStatementFor(modelType, query);

      expect(statement.query).toBe(
        `AND {p0:Identifier} >= {p1:${boundAs}} AND {p2:Identifier} <= {p3:${boundAs}}`,
      );

      if (timeColumn.type === TableColumnType.DateTime64) {
        expect(statement.query_params["p1"]).toBe(
          "2026-07-01 00:00:00.000000000",
        );
      }
    }
  });

  test("compares a 64-bit column with a value past 2^53 sent as digits, keeping every digit", () => {
    const query: JSONObject = {
      timeUnixNano: { _type: "GreaterThan", value: A_WIDE_INTEGER },
    };

    expect(
      AnalyticsModelSchema.getQueryModelSchema({ modelType: Log }).safeParse(
        query,
      ).success,
    ).toBe(true);

    const statement: Statement = whereStatementFor(Log, query);

    expect(statement.query).toBe("AND {p0:Identifier} > {p1:UInt64}");
    expect(statement.query_params["p1"]).toBe(A_WIDE_INTEGER);
  });

  test("matches any of several IDs or texts with Includes, and any of several elements of an Array(String)", () => {
    const schema: any = AnalyticsModelSchema.getQueryModelSchema({
      modelType: Log,
    });

    for (const [query, compiled] of [
      [
        { projectId: { _type: "Includes", value: [A_UUID, A_UUID] } },
        "AND {p0:Identifier} IN {p1:Array(String)}",
      ],
      [
        { severityText: { _type: "Includes", value: ["ERROR", "WARN"] } },
        "AND {p0:Identifier} IN {p1:Array(String)}",
      ],
      [
        { entityKeys: { _type: "Includes", value: ["a", "b"] } },
        "AND hasAny({p0:Identifier}, {p1:Array(String)})",
      ],
    ] as Array<[JSONObject, string]>) {
      expect([query, schema.safeParse(query).success]).toEqual([query, true]);
      expect(whereStatementFor(Log, query).query).toBe(compiled);
    }
  });

  test("filters a map by key, and refuses an operator on the whole map, as StatementGenerator does", () => {
    const schema: any = AnalyticsModelSchema.getQueryModelSchema({
      modelType: Log,
    });

    expect(
      schema.safeParse({ attributes: { "http.method": "GET" } }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        attributes: { "http.method": { _type: "Search", value: "GE" } },
      }).success,
    ).toBe(true);
    expect(
      whereStatementFor(Log, { attributes: { "http.method": "GET" } }).query,
    ).toContain("[{p4:String}] = {p5:String}");

    // What the schema used to offer: operators on the whole map.
    for (const onTheWholeMap of [
      "GET",
      { _type: "EqualTo", value: "GET" },
      { _type: "NotEqual", value: "GET" },
      { _type: "IsNull" },
    ]) {
      expect([
        onTheWholeMap,
        schema.safeParse({ attributes: onTheWholeMap }).success,
      ]).toEqual([onTheWholeMap, false]);
    }

    expect(() => {
      whereStatementFor(Log, {
        attributes: { _type: "EqualTo", value: "GET" },
      });
    }).toThrow("Unsupported query operator EqualTo on column: attributes");
  });

  test("refuses an operator a column's type does not take", () => {
    const schema: any = AnalyticsModelSchema.getQueryModelSchema({
      modelType: Log,
    });

    for (const query of [
      { time: { _type: "Search", value: "2026" } },
      { severityText: { _type: "GreaterThan", value: "x" } },
      { projectId: { _type: "Search", value: "x" } },
      { timeUnixNano: { _type: "Includes", value: [1] } },
      { entityKeys: { _type: "EqualToOrNull", value: "a" } },
    ]) {
      expect([query, schema.safeParse(query).success]).toEqual([query, false]);
    }
  });

  test("lists the fields the API lets a query name, and no other", () => {
    const problems: Array<string> = [];

    for (const modelType of API_MODELS) {
      const model: AnalyticsBaseModel = new modelType();
      const listed: Array<string> = shapeKeys(
        AnalyticsModelSchema.getQueryModelSchema({ modelType }),
      );

      for (const column of model.getTableColumns()) {
        if (
          AnalyticsModelSchema.getValidOperatorsForColumnType(column.type)
            .length === 0
        ) {
          continue;
        }

        let isTaken: boolean = true;

        try {
          checkQueryPermission(modelType, {
            [column.key]: filterFor("NotNull", column.type),
          });
        } catch {
          isTaken = false;
        }

        if (isTaken !== listed.includes(column.key)) {
          problems.push(
            `${model.tableName}.${column.key}: the API ${isTaken ? "takes" : "refuses"} it`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });

  // The check above would pass anything if the API's check passed anything.
  test("leaves out a column nobody may read, which the API refuses: a table's retentionDate", () => {
    const listed: Array<string> = shapeKeys(
      AnalyticsModelSchema.getQueryModelSchema({ modelType: Log }),
    );

    expect(listed).not.toContain("retentionDate");
    expect(listed).toEqual(expect.arrayContaining(["_id", "createdAt"]));

    expect(() => {
      checkQueryPermission(Log, {
        retentionDate: { _type: "GreaterThan", value: A_TIME },
      });
    }).toThrow("You do not have permissions to query on - retentionDate.");
  });
});

describe("the telemetry sort schema says what StatementGenerator orders by", () => {
  test("lists every column of a sortable type, which StatementGenerator orders by", () => {
    const problems: Array<string> = [];

    for (const modelType of AnalyticsModels as Array<ModelCtor>) {
      const model: AnalyticsBaseModel = new modelType();
      const schema: any = AnalyticsModelSchema.getSortModelSchema({
        modelType,
      });

      expect([model.tableName, shapeKeys(schema)]).toEqual([
        model.tableName,
        model
          .getTableColumns()
          .filter((column: AnalyticsTableColumn): boolean => {
            return SORTABLE_TYPES.includes(column.type);
          })
          .map((column: AnalyticsTableColumn): string => {
            return column.key;
          }),
      ]);

      for (const key of shapeKeys(schema)) {
        const sort: string = generatorFor(modelType).toSortStatement({
          [key]: SortOrder.Descending,
        } as never).query;

        if (sort !== "{p0:Identifier} DESC") {
          problems.push(`${model.tableName}.${key}: ${sort}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  test("sorts every table the API serves by its time column", () => {
    for (const modelType of API_MODELS) {
      const model: AnalyticsBaseModel = new modelType();

      expect([
        model.tableName,
        shapeKeys(AnalyticsModelSchema.getSortModelSchema({ modelType })),
      ]).toEqual([
        model.tableName,
        expect.arrayContaining([model.defaultSortColumn]),
      ]);
    }
  });
});

/*
 * zod-to-openapi takes a `type` in .openapi() for the whole schema and leaves
 * out what it would have generated: the spec listed no field of a telemetry
 * query or sort, only an object that allowed none.
 */
describe("the OpenAPI spec lists a telemetry query's fields and operators", () => {
  test("lists every field of every table's query, each with the operators its type takes", () => {
    for (const modelType of API_MODELS) {
      const model: AnalyticsBaseModel = new modelType();
      const query: JSONObject = renderedSchemas(modelType).query;
      const properties: JSONObject = (query["properties"] || {}) as JSONObject;
      const listed: Array<string> = shapeKeys(
        AnalyticsModelSchema.getQueryModelSchema({ modelType }),
      );

      expect([model.tableName, Object.keys(properties)]).toEqual([
        model.tableName,
        listed,
      ]);
      expect(query["additionalProperties"]).toBe(false);

      for (const key of listed) {
        const column: AnalyticsTableColumn = model.getTableColumn(
          key,
        ) as AnalyticsTableColumn;

        expect([
          model.tableName,
          key,
          renderedOperators(properties[key] as JSONObject),
        ]).toEqual([
          model.tableName,
          key,
          [
            ...AnalyticsModelSchema.getValidOperatorsForColumnType(column.type),
          ].sort(),
        ]);
      }
    }
  });

  test("writes a time as ISO-8601, and InBetween's two ends beside its _type", () => {
    const time: JSONObject = (
      renderedSchemas(Log).query["properties"] as JSONObject
    )["time"] as JSONObject;

    const inBetween: JSONObject | undefined = (
      time["anyOf"] as Array<JSONObject>
    ).find((branch: JSONObject): boolean => {
      return (
        (
          (
            (branch["properties"] as JSONObject | undefined)?.[
              "_type"
            ] as JSONObject
          )?.["enum"] as Array<string>
        )?.[0] === "InBetween"
      );
    });

    expect(inBetween).toMatchObject({
      type: "object",
      properties: {
        startValue: { type: "string", format: "date-time" },
        endValue: { type: "string", format: "date-time" },
      },
      required: ["_type", "startValue", "endValue"],
    });
  });

  test("lists every table's sort fields, its time column among them", () => {
    for (const modelType of API_MODELS) {
      const model: AnalyticsBaseModel = new modelType();
      const sort: JSONObject = renderedSchemas(modelType).sort;
      const properties: JSONObject = (sort["properties"] || {}) as JSONObject;

      expect([model.tableName, Object.keys(properties)]).toEqual([
        model.tableName,
        shapeKeys(AnalyticsModelSchema.getSortModelSchema({ modelType })),
      ]);
      expect(properties[model.defaultSortColumn]).toMatchObject({
        type: "string",
        enum: [SortOrder.Ascending, SortOrder.Descending],
      });
    }
  });
});

describe("the OpenAPI spec lists a telemetry select's and group by's fields", () => {
  /*
   * zod-to-openapi took the `type` BaseSchema gave .openapi() for the whole
   * schema, so every telemetry select and group by was published as an
   * object that allowed no field at all.
   */
  test("lists the fields a select may name: those somebody may read", () => {
    for (const modelType of API_MODELS) {
      const model: AnalyticsBaseModel = new modelType();
      const select: JSONObject = renderedSchemas(modelType).select;

      expect([
        model.tableName,
        Object.keys((select["properties"] || {}) as JSONObject),
      ]).toEqual([
        model.tableName,
        model
          .getTableColumns()
          .filter(isReadable)
          .map((column: AnalyticsTableColumn): string => {
            return column.key;
          }),
      ]);
      expect(select["additionalProperties"]).toBe(false);
    }
  });

  test("the API takes every field the select lists, and refuses one nobody may read", () => {
    for (const modelType of API_MODELS) {
      for (const key of Object.keys(
        (renderedSchemas(modelType).select["properties"] || {}) as JSONObject,
      )) {
        checkSelectPermission(modelType, { [key]: true });
      }
    }

    expect(() => {
      checkSelectPermission(Log, { retentionDate: true });
    }).toThrow();
  });

  test("lists the readable fields of a groupable type as group-by fields", () => {
    for (const modelType of API_MODELS) {
      const model: AnalyticsBaseModel = new modelType();
      const groupBy: JSONObject = renderedSchemas(modelType).groupBy;

      expect([
        model.tableName,
        Object.keys((groupBy["properties"] || {}) as JSONObject),
      ]).toEqual([
        model.tableName,
        model
          .getTableColumns()
          .filter((column: AnalyticsTableColumn): boolean => {
            return GROUPABLE_TYPES.includes(column.type) && isReadable(column);
          })
          .map((column: AnalyticsTableColumn): string => {
            return column.key;
          }),
      ]);
      expect(groupBy["additionalProperties"]).toBe(false);
    }
  });

  /*
   * A group by's fields become the list's select (AnalyticsDatabaseService
   * .toFindStatement), so each is one a select may name.
   */
  test("groups by every field the group by lists, each one a select may name", () => {
    let grouped: number = 0;

    for (const modelType of API_MODELS) {
      for (const key of Object.keys(
        (renderedSchemas(modelType).groupBy["properties"] || {}) as JSONObject,
      )) {
        checkSelectPermission(modelType, { [key]: true });

        // GROUP BY the column, bound as an identifier.
        const statement: Statement = generatorFor(modelType).toGroupByStatement(
          { [key]: true } as never,
        );

        expect([
          statement.query,
          Object.values(statement.query_params),
        ]).toEqual(["{p0:Identifier}", [key]]);

        grouped++;
      }
    }

    expect(grouped).toBeGreaterThan(30);
  });
});

describe("the OpenAPI spec lists a telemetry create's and update's fields", () => {
  /*
   * zod-to-openapi took the `type` getCreateModelSchema gave .openapi() for
   * the whole schema, so every telemetry create was published as an object
   * that allowed no field at all - and every update with it, which was a
   * copy of the create.
   */
  test("covers the tables a create and an update reach, so the checks below are not vacuous", () => {
    expect(
      CREATABLE_MODELS.map((modelType: ModelCtor): string => {
        return new modelType().tableName;
      }),
    ).toEqual(
      expect.arrayContaining(["LogItemV3", "SpanItemV3", "MetricItemV3"]),
    );
    expect(UPDATABLE_MODELS.length).toBeGreaterThan(5);
  });

  test("lists the fields a create may send: the columns somebody may create, less those with a default", () => {
    for (const modelType of CREATABLE_MODELS) {
      const model: AnalyticsBaseModel = new modelType();
      const create: JSONObject = renderedSchemas(modelType).create;
      const listed: Array<string> = Object.keys(
        (create["properties"] || {}) as JSONObject,
      );

      expect([model.tableName, listed]).toEqual([
        model.tableName,
        model
          .getTableColumns()
          .filter((column: AnalyticsTableColumn): boolean => {
            return (
              !CREATE_EXCLUDED_FIELDS.includes(column.key) &&
              !column.isDefaultValueColumn &&
              (column.accessControl?.create || []).length > 0
            );
          })
          .map((column: AnalyticsTableColumn): string => {
            return column.key;
          }),
      ]);
      expect(listed.length).toBeGreaterThan(0);
      expect(create["additionalProperties"]).toBe(false);
    }
  });

  /*
   * What AnalyticsDatabaseService.checkRequiredFields asks of a create, but
   * the project: the API writes the request's (the API key's) there.
   */
  test("requires the columns a create must send, and not the project", () => {
    for (const modelType of CREATABLE_MODELS) {
      const model: AnalyticsBaseModel = new modelType();
      const create: JSONObject = renderedSchemas(modelType).create;
      const listed: Array<string> = Object.keys(
        create["properties"] as JSONObject,
      );
      const project: string = model.getTenantColumn()!.key;

      expect(listed).toContain(project);
      expect([model.tableName, create["required"] || []]).toEqual([
        model.tableName,
        listed.filter((key: string): boolean => {
          return (
            key !== project && Boolean(model.getTableColumn(key)?.required)
          );
        }),
      ]);
    }
  });

  test("the API takes every form of every field a create lists, and writes it into the INSERT", () => {
    let written: number = 0;

    for (const modelType of CREATABLE_MODELS) {
      const columns: Array<AnalyticsTableColumn> =
        new modelType().getTableColumns();
      const fields: JSONObject = (renderedSchemas(modelType).create[
        "properties"
      ] || {}) as JSONObject;

      for (const [key, field] of Object.entries(fields)) {
        for (const value of writeValuesFor(field as JSONObject)) {
          // fromJSON refuses a column the table does not have.
          const item: AnalyticsBaseModel = AnalyticsBaseModel.fromJSON(
            { [key]: value },
            modelType,
          ) as AnalyticsBaseModel;

          // The column check sees the field, and lets a project owner create it.
          expect([
            key,
            (item as unknown as JSONObject)[key] !== undefined,
          ]).toEqual([key, true]);
          AnalyticsModelPermission.checkCreatePermissions(
            modelType,
            item,
            OWNER,
          );

          // A time as ClickHouse parses it, and every digit of a 64-bit value.
          const inserted: string = String(
            insertedValuesOf(modelType, item)[
              columns.findIndex((column: AnalyticsTableColumn): boolean => {
                return column.key === key;
              })
            ],
          );

          expect([key, inserted]).toEqual([
            key,
            expect.stringContaining(
              value === A_TIME ? "2026-07-01 00:00:00" : String(value),
            ),
          ]);

          written++;
        }
      }
    }

    expect(written).toBeGreaterThan(100);
  });

  test("its example sends what a create requires, which the API takes", () => {
    for (const modelType of CREATABLE_MODELS) {
      const create: JSONObject = renderedSchemas(modelType).create;
      const example: JSONObject = create["example"] as JSONObject;

      expect(Object.keys(example)).toEqual(create["required"] || []);
      expect(
        AnalyticsModelSchema.getCreateModelSchema({ modelType }).safeParse(
          example,
        ).success,
      ).toBe(true);

      const item: AnalyticsBaseModel = AnalyticsBaseModel.fromJSON(
        example,
        modelType,
      ) as AnalyticsBaseModel;

      AnalyticsModelPermission.checkCreatePermissions(modelType, item, OWNER);
      expect(
        generatorFor(modelType).toCreateStatement({ item: [item] }),
      ).toContain(`INSERT INTO`);
    }
  });

  test("lists the fields an update may change: the columns somebody may update", () => {
    for (const modelType of UPDATABLE_MODELS) {
      const model: AnalyticsBaseModel = new modelType();
      const update: JSONObject = renderedSchemas(modelType).update;

      expect([
        model.tableName,
        Object.keys((update["properties"] || {}) as JSONObject),
      ]).toEqual([
        model.tableName,
        model
          .getTableColumns()
          .filter((column: AnalyticsTableColumn): boolean => {
            return (
              !CREATE_EXCLUDED_FIELDS.includes(column.key) &&
              (column.accessControl?.update || []).length > 0
            );
          })
          .map((column: AnalyticsTableColumn): string => {
            return column.key;
          }),
      ]);
      expect(update["additionalProperties"]).toBe(false);
    }
  });

  /*
   * No telemetry column names an update permission, and a column that names
   * none is closed to everyone: checkUpdatePermissions refuses each field a
   * create may send, so an update lists none.
   */
  test("the API refuses an update of each field a create may send", () => {
    let refused: number = 0;

    for (const modelType of UPDATABLE_MODELS) {
      const rendered: { create: JSONObject; update: JSONObject } =
        renderedSchemas(modelType);

      expect(
        Object.keys((rendered.update["properties"] || {}) as JSONObject),
      ).toEqual([]);

      for (const [key, field] of Object.entries(
        (rendered.create["properties"] || {}) as JSONObject,
      )) {
        const item: AnalyticsBaseModel = AnalyticsBaseModel.fromJSON(
          { [key]: writeValuesFor(field as JSONObject)[0] as JSONValue },
          modelType,
        ) as AnalyticsBaseModel;

        expect(() => {
          checkUpdatedColumns(modelType, item);
        }).toThrow(ColumnWriteRefusedException);

        refused++;
      }
    }

    expect(refused).toBeGreaterThan(50);
  });
});
