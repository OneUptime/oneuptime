import { BaseSchema } from "../../../Utils/Schema/BaseSchema";
import Zod from "../../../Utils/Schema/Zod";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";

/*
 * Direct unit tests for BaseSchema — the abstract base behind ModelSchema and
 * AnalyticsModelSchema.
 *
 * The two concrete subclasses only ever call a handful of the base methods
 * (generateSortSchema / generateSelectSchema / generateGroupBySchema /
 * generateQuerySchema and applyOpenApi), so the example generators and the
 * create-schema builder — getCommonExampleValue, generateSelectSchemaExample,
 * generateGroupBySchemaExample, generateCreateSchema, logSchemaGeneration — are
 * not exercised anywhere else in the codebase. These tests pin down that pure
 * logic branch-by-branch without a database connection.
 *
 * BaseSchema's generators are protected static, so a thin subclass re-exports
 * them as public statics for the test. Nothing else about the base changes.
 */

type Column = {
  key: string;
  type?: any;
  required?: boolean;
  isDefaultValueColumn?: boolean;
};

/*
 * A tiny model stand-in. The generators only ever read columns through the
 * caller-supplied accessor callbacks, so the model itself can be an empty
 * object.
 */
const MODEL: Record<string, unknown> = {};

/*
 * Re-export every protected static as a public wrapper so the test can call
 * them directly. A subclass is allowed to reach the base's protected members.
 */
class TestSchema extends BaseSchema {
  public static commonExampleValue(
    dataType: string,
    second?: boolean,
  ): unknown {
    return this.getCommonExampleValue(dataType, second);
  }

  public static sortSchema(data: {
    getSortableTypes: () => Array<any>;
    getColumnsForSorting: () => Array<Column>;
    tableName?: string;
    disableOpenApiSchema?: boolean;
  }): any {
    return (this.generateSortSchema as (d: any) => any)({
      model: MODEL,
      tableName: data.tableName,
      getSortableTypes: data.getSortableTypes,
      getColumnsForSorting: data.getColumnsForSorting,
      disableOpenApiSchema: data.disableOpenApiSchema,
    });
  }

  public static selectSchema(data: {
    getColumns: () => Array<Column>;
    getSelectSchemaExample?: () => Record<string, unknown>;
    allowNested?: boolean;
    getNestedSchema?: (key: string) => any;
  }): any {
    return (this.generateSelectSchema as (d: any) => any)({
      model: MODEL,
      getColumns: data.getColumns,
      getSelectSchemaExample:
        data.getSelectSchemaExample ||
        (() => {
          return {};
        }),
      allowNested: data.allowNested,
      getNestedSchema: data.getNestedSchema
        ? (key: string) => {
            return data.getNestedSchema!(key);
          }
        : undefined,
    });
  }

  public static groupBySchema(data: {
    getColumns: () => Array<Column>;
    getGroupableTypes: () => Array<any>;
  }): any {
    return (this.generateGroupBySchema as (d: any) => any)({
      model: MODEL,
      getColumns: data.getColumns,
      getGroupableTypes: data.getGroupableTypes,
      getGroupBySchemaExample: () => {
        return {};
      },
    });
  }

  public static querySchema(data: {
    getColumns: () => Array<Column>;
    getValidOperatorsForColumnType: (type: any) => Array<string>;
    getOperatorSchema?: (op: string, type: any) => any;
    getExampleValueForColumn?: (type: any) => unknown;
    disableOpenApiSchema?: boolean;
  }): any {
    return (this.generateQuerySchema as (d: any) => any)({
      model: MODEL,
      getColumns: data.getColumns,
      getValidOperatorsForColumnType: data.getValidOperatorsForColumnType,
      getOperatorSchema: data.getOperatorSchema,
      getQuerySchemaExample: () => {
        return {};
      },
      getExampleValueForColumn:
        data.getExampleValueForColumn ||
        (() => {
          return "example";
        }),
      disableOpenApiSchema: data.disableOpenApiSchema,
    });
  }

  public static createSchema(data: {
    getColumns: () => Array<Column>;
    excludedFields?: Array<string>;
  }): any {
    return (this.generateCreateSchema as (d: any) => any)({
      model: MODEL,
      getColumns: data.getColumns,
      getZodTypeForColumn: () => {
        return Zod.string();
      },
      getCreateSchemaExample: () => {
        return {};
      },
      excludedFields: data.excludedFields,
    });
  }

  public static selectExample(data: {
    getColumns: () => Array<Column>;
    commonFields?: Array<string>;
    maxFields?: number;
    priorityFieldTypes?: Array<any>;
  }): Record<string, unknown> {
    return (this.generateSelectSchemaExample as (d: any) => any)({
      model: MODEL,
      getColumns: data.getColumns,
      commonFields: data.commonFields,
      maxFields: data.maxFields,
      priorityFieldTypes: data.priorityFieldTypes,
    });
  }

  public static groupByExample(data: {
    getColumns: () => Array<Column>;
    getGroupableTypes: () => Array<any>;
    excludeFields?: Array<string>;
  }): Record<string, unknown> {
    return (this.generateGroupBySchemaExample as (d: any) => any)({
      model: MODEL,
      getColumns: data.getColumns,
      getGroupableTypes: data.getGroupableTypes,
      excludeFields: data.excludeFields,
    });
  }

  public static openApi(base: any, config: any, disable?: boolean): any {
    return this.applyOpenApi(base, config, disable);
  }

  public static logGeneration(
    schemaType: string,
    tableName: string,
    shape: any,
  ): void {
    return this.logSchemaGeneration(schemaType, tableName, shape);
  }
}

describe("BaseSchema.getCommonExampleValue", () => {
  test("returns a placeholder UUID for id types", () => {
    const uuid: string = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";
    expect(TestSchema.commonExampleValue("objectid")).toBe(uuid);
    expect(TestSchema.commonExampleValue("id")).toBe(uuid);
  });

  test("distinguishes first and second string examples", () => {
    expect(TestSchema.commonExampleValue("text")).toBe("example_text_1");
    expect(TestSchema.commonExampleValue("string", true)).toBe(
      "example_text_2",
    );
  });

  test("returns distinct example emails", () => {
    expect(TestSchema.commonExampleValue("email")).toBe("user@example.com");
    expect(TestSchema.commonExampleValue("email", true)).toBe(
      "user2@example.com",
    );
  });

  test("returns numbers for number/integer", () => {
    expect(TestSchema.commonExampleValue("number")).toBe(42);
    expect(TestSchema.commonExampleValue("integer", true)).toBe(100);
  });

  test("returns ISO strings for date/datetime", () => {
    expect(TestSchema.commonExampleValue("date")).toBe(
      "2023-01-15T12:30:00.000Z",
    );
    expect(TestSchema.commonExampleValue("datetime", true)).toBe(
      "2023-12-31T23:59:59.000Z",
    );
  });

  test("inverts the boolean example on the second value", () => {
    // first value is `true`, second is `false`.
    expect(TestSchema.commonExampleValue("boolean")).toBe(true);
    expect(TestSchema.commonExampleValue("boolean", true)).toBe(false);
  });

  test("returns objects for json/object", () => {
    expect(TestSchema.commonExampleValue("json")).toEqual({ key: "value" });
    expect(TestSchema.commonExampleValue("object", true)).toEqual({
      key2: "value2",
    });
  });

  test("returns arrays for array type", () => {
    expect(TestSchema.commonExampleValue("array")).toEqual(["item1", "item2"]);
    expect(TestSchema.commonExampleValue("array", true)).toEqual([
      "item3",
      "item4",
    ]);
  });

  test("is case-insensitive on the data type", () => {
    expect(TestSchema.commonExampleValue("ObjectID")).toBe(
      "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    );
    expect(TestSchema.commonExampleValue("BOOLEAN")).toBe(true);
  });

  test("falls back to a generic example for unknown types", () => {
    expect(TestSchema.commonExampleValue("geography")).toBe("example_value_1");
    expect(TestSchema.commonExampleValue("geography", true)).toBe(
      "example_value_2",
    );
  });
});

describe("BaseSchema.generateSortSchema", () => {
  const columns: Array<Column> = [
    { key: "name", type: "text" },
    { key: "createdAt", type: "date" },
    { key: "config", type: "json" }, // not sortable
  ];

  test("includes only sortable columns in the shape", () => {
    const schema: any = TestSchema.sortSchema({
      getSortableTypes: () => {
        return ["text", "date"];
      },
      getColumnsForSorting: () => {
        return columns;
      },
    });

    expect(Object.keys(schema.shape).sort()).toEqual(["createdAt", "name"]);
  });

  test("accepts valid sort orders and rejects invalid ones", () => {
    const schema: any = TestSchema.sortSchema({
      getSortableTypes: () => {
        return ["text", "date"];
      },
      getColumnsForSorting: () => {
        return columns;
      },
    });

    expect(schema.safeParse({ name: SortOrder.Ascending }).success).toBe(true);
    expect(schema.safeParse({ createdAt: SortOrder.Descending }).success).toBe(
      true,
    );
    expect(schema.safeParse({ name: "sideways" }).success).toBe(false);
  });

  test("each sort field is optional", () => {
    const schema: any = TestSchema.sortSchema({
      getSortableTypes: () => {
        return ["text"];
      },
      getColumnsForSorting: () => {
        return columns;
      },
    });

    expect(schema.safeParse({}).success).toBe(true);
  });

  test("produces an empty shape when nothing is sortable", () => {
    const schema: any = TestSchema.sortSchema({
      getSortableTypes: () => {
        return [];
      },
      getColumnsForSorting: () => {
        return columns;
      },
    });

    expect(Object.keys(schema.shape)).toHaveLength(0);
  });
});

describe("BaseSchema.generateSelectSchema", () => {
  test("makes every column an optional boolean", () => {
    const schema: any = TestSchema.selectSchema({
      getColumns: () => {
        return [{ key: "name" }, { key: "email" }];
      },
    });

    expect(Object.keys(schema.shape).sort()).toEqual(["email", "name"]);
    expect(schema.safeParse({ name: true }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ name: "yes" }).success).toBe(false);
  });

  test("uses a nested schema when nesting is allowed and available", () => {
    const nested: any = Zod.object({ id: Zod.boolean().optional() });
    const schema: any = TestSchema.selectSchema({
      getColumns: () => {
        return [{ key: "monitor" }, { key: "name" }];
      },
      allowNested: true,
      getNestedSchema: (key: string) => {
        return key === "monitor" ? nested : null;
      },
    });

    // monitor accepts a nested object; name stays a boolean.
    expect(
      schema.safeParse({ monitor: { id: true }, name: true }).success,
    ).toBe(true);
    expect(schema.safeParse({ monitor: true }).success).toBe(false);
  });

  test("ignores nested schemas when allowNested is false", () => {
    const nested: any = Zod.object({ id: Zod.boolean().optional() });
    const schema: any = TestSchema.selectSchema({
      getColumns: () => {
        return [{ key: "monitor" }];
      },
      allowNested: false,
      getNestedSchema: () => {
        return nested;
      },
    });

    // Falls back to a plain boolean, so a nested object is rejected.
    expect(schema.safeParse({ monitor: true }).success).toBe(true);
    expect(schema.safeParse({ monitor: { id: true } }).success).toBe(false);
  });
});

describe("BaseSchema.generateGroupBySchema", () => {
  const columns: Array<Column> = [
    { key: "projectId", type: "objectid" },
    { key: "note", type: "text" }, // not groupable
  ];

  test("includes only groupable columns and requires the literal true", () => {
    const schema: any = TestSchema.groupBySchema({
      getColumns: () => {
        return columns;
      },
      getGroupableTypes: () => {
        return ["objectid"];
      },
    });

    expect(Object.keys(schema.shape)).toEqual(["projectId"]);
    expect(schema.safeParse({ projectId: true }).success).toBe(true);
    // literal(true) rejects false.
    expect(schema.safeParse({ projectId: false }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(true);
  });
});

describe("BaseSchema.generateQuerySchema", () => {
  const columns: Array<Column> = [
    { key: "name", type: "text" },
    { key: "secret", type: "password" }, // no operators => skipped
  ];

  const validOperators: (type: any) => Array<string> = (type: any) => {
    return type === "password" ? [] : ["EqualTo", "NotEqual"];
  };

  test("skips columns that expose no operators", () => {
    const schema: any = TestSchema.querySchema({
      getColumns: () => {
        return columns;
      },
      getValidOperatorsForColumnType: validOperators,
    });

    expect(Object.keys(schema.shape)).toEqual(["name"]);
  });

  test("builds a simple _type/value operator object when no operator schema is supplied", () => {
    const schema: any = TestSchema.querySchema({
      getColumns: () => {
        return [{ key: "name", type: "text" }];
      },
      getValidOperatorsForColumnType: () => {
        return ["EqualTo", "NotEqual"];
      },
    });

    expect(
      schema.safeParse({ name: { _type: "EqualTo", value: "x" } }).success,
    ).toBe(true);
    // _type must be one of the valid operators.
    expect(
      schema.safeParse({ name: { _type: "Bogus", value: "x" } }).success,
    ).toBe(false);
    expect(schema.safeParse({}).success).toBe(true);
  });

  test("uses a single optional operator schema when only one operator is valid", () => {
    const schema: any = TestSchema.querySchema({
      getColumns: () => {
        return [{ key: "count", type: "number" }];
      },
      getValidOperatorsForColumnType: () => {
        return ["EqualTo"];
      },
      getOperatorSchema: () => {
        return Zod.object({ EqualTo: Zod.number() });
      },
    });

    expect(schema.safeParse({ count: { EqualTo: 5 } }).success).toBe(true);
    expect(schema.safeParse({ count: { EqualTo: "no" } }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(true);
  });

  test("unions multiple operator schemas when several operators are valid", () => {
    const schema: any = TestSchema.querySchema({
      getColumns: () => {
        return [{ key: "count", type: "number" }];
      },
      getValidOperatorsForColumnType: () => {
        return ["EqualTo", "GreaterThan"];
      },
      getOperatorSchema: (op: string) => {
        return op === "EqualTo"
          ? Zod.object({ EqualTo: Zod.number() })
          : Zod.object({ GreaterThan: Zod.number() });
      },
    });

    expect(schema.safeParse({ count: { EqualTo: 1 } }).success).toBe(true);
    expect(schema.safeParse({ count: { GreaterThan: 2 } }).success).toBe(true);
    expect(schema.safeParse({ count: { LessThan: 3 } }).success).toBe(false);
  });
});

describe("BaseSchema.generateCreateSchema", () => {
  test("excludes the default excluded fields and default-value columns", () => {
    const schema: any = TestSchema.createSchema({
      getColumns: () => {
        return [
          { key: "_id" },
          { key: "createdAt" },
          { key: "updatedAt" },
          { key: "createdBy", isDefaultValueColumn: true },
          { key: "name", required: true },
          { key: "description" },
        ];
      },
    });

    expect(Object.keys(schema.shape).sort()).toEqual(["description", "name"]);
  });

  test("required columns are required and optional columns are optional", () => {
    const schema: any = TestSchema.createSchema({
      getColumns: () => {
        return [{ key: "name", required: true }, { key: "description" }];
      },
    });

    expect(schema.safeParse({ name: "a" }).success).toBe(true);
    expect(schema.safeParse({ name: "a", description: "b" }).success).toBe(
      true,
    );
    // name is required.
    expect(schema.safeParse({ description: "b" }).success).toBe(false);
  });

  test("honors a custom excludedFields list", () => {
    const schema: any = TestSchema.createSchema({
      getColumns: () => {
        return [
          { key: "_id" }, // no longer excluded with a custom list
          { key: "internalOnly" },
          { key: "name" },
        ];
      },
      excludedFields: ["internalOnly"],
    });

    expect(Object.keys(schema.shape).sort()).toEqual(["_id", "name"]);
  });
});

describe("BaseSchema.generateSelectSchemaExample", () => {
  test("adds common fields that exist on the model", () => {
    const example: Record<string, unknown> = TestSchema.selectExample({
      getColumns: () => {
        return [{ key: "_id" }, { key: "createdAt" }, { key: "name" }];
      },
    });

    /*
     * Default common fields present on the model become true; updatedAt is
     * absent so it is omitted.
     */
    expect(example).toEqual({ _id: true, createdAt: true });
  });

  test("adds priority-typed fields up to maxFields, excluding common fields", () => {
    const example: Record<string, unknown> = TestSchema.selectExample({
      getColumns: () => {
        return [
          { key: "_id", type: "objectid" },
          { key: "name", type: "text" },
          { key: "email", type: "text" },
          { key: "slug", type: "text" },
        ];
      },
      commonFields: ["_id"],
      priorityFieldTypes: ["text"],
      maxFields: 2,
    });

    // _id via common fields, then two text fields (name, email) up to the cap.
    expect(example).toEqual({ _id: true, name: true, email: true });
  });

  test("omits priority fields entirely when none are requested", () => {
    const example: Record<string, unknown> = TestSchema.selectExample({
      getColumns: () => {
        return [{ key: "name", type: "text" }];
      },
      commonFields: [],
    });

    expect(example).toEqual({});
  });
});

describe("BaseSchema.generateGroupBySchemaExample", () => {
  test("returns the first groupable field that is not excluded", () => {
    const example: Record<string, unknown> = TestSchema.groupByExample({
      getColumns: () => {
        return [
          { key: "createdAt", type: "date" }, // excluded by default
          { key: "projectId", type: "objectid" },
          { key: "labelId", type: "objectid" },
        ];
      },
      getGroupableTypes: () => {
        return ["objectid", "date"];
      },
    });

    expect(example).toEqual({ projectId: true });
  });

  test("falls back to createdAt when nothing is groupable", () => {
    const example: Record<string, unknown> = TestSchema.groupByExample({
      getColumns: () => {
        return [{ key: "name", type: "text" }];
      },
      getGroupableTypes: () => {
        return ["objectid"];
      },
    });

    expect(example).toEqual({ createdAt: true });
  });

  test("honors a custom excludeFields list", () => {
    const example: Record<string, unknown> = TestSchema.groupByExample({
      getColumns: () => {
        return [
          { key: "projectId", type: "objectid" },
          { key: "labelId", type: "objectid" },
        ];
      },
      getGroupableTypes: () => {
        return ["objectid"];
      },
      excludeFields: ["projectId"],
    });

    expect(example).toEqual({ labelId: true });
  });
});

describe("BaseSchema.applyOpenApi", () => {
  test("returns the base type unchanged when the schema is disabled", () => {
    const base: any = Zod.string();
    const result: any = TestSchema.openApi(base, { type: "string" }, true);
    expect(result).toBe(base);
  });

  test("attaches the OpenAPI metadata when enabled", () => {
    const base: any = Zod.string();
    const result: any = TestSchema.openApi(
      base,
      { type: "string", description: "a field" },
      false,
    );

    // openapi() returns a new schema instance carrying the metadata.
    expect(result).not.toBe(base);
    expect(result.safeParse("hello").success).toBe(true);
  });

  test("defaults to applying the metadata when the flag is omitted", () => {
    const base: any = Zod.string();
    const result: any = TestSchema.openApi(base, { type: "string" });
    expect(result).not.toBe(base);
  });
});

describe("BaseSchema.logSchemaGeneration", () => {
  test("does not throw while logging shape keys", () => {
    expect(() => {
      TestSchema.logGeneration("Select", "Monitor", {
        name: Zod.boolean(),
        email: Zod.boolean(),
      });
    }).not.toThrow();
  });
});
