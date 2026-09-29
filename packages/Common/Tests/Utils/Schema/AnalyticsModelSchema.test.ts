import { AnalyticsModelSchema } from "../../../Utils/Schema/AnalyticsModelSchema";
import Zod from "../../../Utils/Schema/Zod";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Log from "../../../Models/AnalyticsModels/Log";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";

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

// Column types the generator treats as sortable (see getSortableTypes()).
const SORTABLE_TYPES: Array<TableColumnType> = [
  TableColumnType.Text,
  TableColumnType.Number,
  TableColumnType.LongNumber,
  TableColumnType.Date,
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
  return schema instanceof Zod.ZodObject;
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
       * Log has required, create-permitted columns (e.g. projectId); an empty
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
    test("includes only groupable column types", () => {
      const model: Log = new Log();
      const schema: any = AnalyticsModelSchema.getGroupByModelSchema({
        modelType: Log,
      });
      const keys: Array<string> = shapeKeys(schema);

      for (const column of model.getTableColumns()) {
        if (GROUPABLE_TYPES.includes(column.type)) {
          expect(keys).toContain(column.key);
        } else {
          expect(keys).not.toContain(column.key);
        }
      }
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
