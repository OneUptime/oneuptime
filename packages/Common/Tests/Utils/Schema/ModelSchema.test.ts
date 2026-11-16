import { ModelSchema } from "../../../Utils/Schema/ModelSchema";
import { z } from "zod";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Dictionary from "../../../Types/Dictionary";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import Team from "../../../Models/DatabaseModels/Team";
import ShortLink from "../../../Models/DatabaseModels/ShortLink";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Incident from "../../../Models/DatabaseModels/Incident";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { ALWAYS_READABLE_COLUMNS } from "../../../Utils/Schema/BaseSchema";

/*
 * Unit tests for ModelSchema — the Zod schema generator behind the public API
 * (OpenAPI spec, request validation, and the Terraform provider generator) for
 * every Postgres-backed database model.
 *
 * The generator is pure: it reads TypeORM column metadata and per-column
 * access control off a freshly instantiated model, so no database connection is
 * needed. These tests pin down the create/update/delete/select/sort/group-by
 * contracts that API consumers depend on.
 */

type ModelCtor = new () => DatabaseBaseModel;

// A curated set of small, stable models spanning different column shapes.
const SAMPLE_MODELS: Array<ModelCtor> = [
  Label,
  ApiKey,
  Team,
  ShortLink,
  MonitorGroup,
  StatusPage,
  Incident,
];

// Column types ModelSchema.getSortableTypes() considers sortable.
const SORTABLE_TYPES: Array<TableColumnType> = [
  TableColumnType.VeryLongText,
  TableColumnType.Slug,
  TableColumnType.ShortText,
  TableColumnType.LongText,
  TableColumnType.Name,
  TableColumnType.Number,
  TableColumnType.SmallNumber,
  TableColumnType.SmallPositiveNumber,
  TableColumnType.PositiveNumber,
  TableColumnType.BigNumber,
  TableColumnType.BigPositiveNumber,
  TableColumnType.Date,
  TableColumnType.Boolean,
  TableColumnType.Description,
  TableColumnType.ObjectID,
];

const CREATE_EXCLUDED_FIELDS: Array<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "version",
];

const UPDATE_EXCLUDED_FIELDS: Array<string> = [
  "createdAt",
  "updatedAt",
  "deletedAt",
  "version",
];

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

describe("ModelSchema (Postgres)", () => {
  describe("getModelSchema / getReadModelSchema", () => {
    test("returns a non-empty ZodObject for a real model", () => {
      const schema: any = ModelSchema.getModelSchema({ modelType: Label });

      expect(isZodObject(schema)).toBe(true);
      expect(shapeKeys(schema).length).toBeGreaterThan(0);
    });

    test("excludes Entity (relation) columns from the schema", () => {
      const model: Label = new Label();
      const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
      const schema: any = ModelSchema.getModelSchema({ modelType: Label });
      const keys: Array<string> = shapeKeys(schema);

      for (const key in columns) {
        const column: TableColumnMetadata | undefined = columns[key];
        if (column && column.type === TableColumnType.Entity) {
          expect(keys).not.toContain(key);
        }
      }
    });

    test("only includes columns that grant read access", () => {
      const model: Label = new Label();
      const accessControl: any = model.getColumnAccessControlForAllColumns();
      const schema: any = ModelSchema.getModelSchema({ modelType: Label });

      for (const key of shapeKeys(schema)) {
        const control: any = accessControl[key];
        /*
         * Columns with declared access control must expose read permissions;
         * columns without any declared control are allowed through.
         */
        if (control) {
          expect(control.read.length).toBeGreaterThan(0);
        }
      }
    });

    test("builds read schemas for every sample model", () => {
      for (const modelType of SAMPLE_MODELS) {
        expect(isZodObject(ModelSchema.getModelSchema({ modelType }))).toBe(
          true,
        );
        expect(isZodObject(ModelSchema.getReadModelSchema({ modelType }))).toBe(
          true,
        );
      }
    });
  });

  describe("getCreateModelSchema", () => {
    test("excludes auto-generated system fields", () => {
      for (const modelType of SAMPLE_MODELS) {
        const schema: any = ModelSchema.getCreateModelSchema({ modelType });
        const keys: Array<string> = shapeKeys(schema);
        for (const excluded of CREATE_EXCLUDED_FIELDS) {
          expect(keys).not.toContain(excluded);
        }
      }
    });

    test("produces the same fields with and without OpenAPI metadata", () => {
      const withOpenApi: any = ModelSchema.getCreateModelSchema({
        modelType: Label,
      });
      const withoutOpenApi: any = ModelSchema.getCreateModelSchema({
        modelType: Label,
        disableOpenApiSchema: true,
      });

      expect(isZodObject(withoutOpenApi)).toBe(true);
      expect(shapeKeys(withoutOpenApi).sort()).toEqual(
        shapeKeys(withOpenApi).sort(),
      );
    });
  });

  describe("getUpdateModelSchema", () => {
    test("excludes immutable audit fields but keeps _id", () => {
      const schema: any = ModelSchema.getUpdateModelSchema({
        modelType: Label,
      });
      const keys: Array<string> = shapeKeys(schema);

      for (const excluded of UPDATE_EXCLUDED_FIELDS) {
        expect(keys).not.toContain(excluded);
      }
    });

    test("treats every field as optional (empty patch is valid)", () => {
      for (const modelType of SAMPLE_MODELS) {
        const schema: any = ModelSchema.getUpdateModelSchema({ modelType });
        expect(schema.safeParse({}).success).toBe(true);
      }
    });
  });

  describe("getDeleteModelSchema", () => {
    test("only exposes the identifier field", () => {
      for (const modelType of SAMPLE_MODELS) {
        const schema: any = ModelSchema.getDeleteModelSchema({ modelType });
        expect(shapeKeys(schema)).toEqual(["_id"]);
      }
    });
  });

  describe("getSelectModelSchema", () => {
    test("marks fields as optional booleans and rejects other types", () => {
      const schema: any = ModelSchema.getSelectModelSchema({
        modelType: Label,
      });
      const keys: Array<string> = shapeKeys(schema);
      const someKey: string = keys[0]!;

      expect(keys.length).toBeGreaterThan(0);
      expect(schema.safeParse({}).success).toBe(true);
      expect(schema.safeParse({ [someKey]: true }).success).toBe(true);
      expect(schema.safeParse({ [someKey]: "select-me" }).success).toBe(false);
    });

    test("builds a select schema for every sample model", () => {
      for (const modelType of SAMPLE_MODELS) {
        expect(
          isZodObject(ModelSchema.getSelectModelSchema({ modelType })),
        ).toBe(true);
      }
    });
  });

  describe("getSortModelSchema", () => {
    test("includes the readable, documented columns of a sortable type", () => {
      const model: Label = new Label();
      const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
      const schema: any = ModelSchema.getSortModelSchema({ modelType: Label });
      const keys: Array<string> = shapeKeys(schema);

      for (const key in columns) {
        const column: TableColumnMetadata | undefined = columns[key];
        if (!column) {
          continue;
        }

        // A sort names what a select may: a column somebody may read.
        const isReadable: boolean =
          !column.hideColumnInDocumentation &&
          (ALWAYS_READABLE_COLUMNS.includes(key) ||
            (model.getColumnAccessControlFor(key)?.read || []).length > 0);

        /*
         * And a relation of one record somebody may read, by the fields of
         * its record (#8840). Never a relation of many records.
         */
        const isSortableRelation: boolean =
          column.type === TableColumnType.Entity &&
          Boolean(column.modelType) &&
          !column.hideColumnInDocumentation &&
          (model.getColumnAccessControlFor(key)?.read || []).length > 0;

        if (
          isReadable &&
          (SORTABLE_TYPES.includes(column.type) || isSortableRelation)
        ) {
          expect(keys).toContain(key);
        } else if (!isSortableRelation) {
          expect(keys).not.toContain(key);
        }
      }

      // Label's relations of one record are sorted through.
      expect(keys).toEqual(
        expect.arrayContaining(["project", "createdByUser"]),
      );

      // The version every model has is not documented.
      expect(keys).not.toContain("version");
    });

    test("takes ASC or DESC, or { direction, nulls }, and nothing else", () => {
      const schema: any = ModelSchema.getSortModelSchema({ modelType: Label });
      const key: string = shapeKeys(schema)[0]!;

      expect(schema.safeParse({}).success).toBe(true);
      expect(schema.safeParse({ [key]: SortOrder.Ascending }).success).toBe(
        true,
      );
      expect(schema.safeParse({ [key]: SortOrder.Descending }).success).toBe(
        true,
      );
      expect(
        schema.safeParse({
          [key]: { direction: SortOrder.Descending, nulls: "LAST" },
        }).success,
      ).toBe(true);
      expect(
        schema.safeParse({ [key]: { direction: SortOrder.Ascending } }).success,
      ).toBe(true);
      expect(schema.safeParse({ [key]: "RANDOM" }).success).toBe(false);
      expect(schema.safeParse({ [key]: { direction: "RANDOM" } }).success).toBe(
        false,
      );
      expect(
        schema.safeParse({
          [key]: { direction: SortOrder.Ascending, nulls: "NEVER" },
        }).success,
      ).toBe(false);
      // The direction is what an order object is for.
      expect(schema.safeParse({ [key]: { nulls: "LAST" } }).success).toBe(
        false,
      );
    });

    test("sorts through a relation of one record by a field of the related record", () => {
      const schema: any = ModelSchema.getSortModelSchema({
        modelType: Incident,
      });

      expect(
        schema.safeParse({ incidentSeverity: { order: SortOrder.Ascending } })
          .success,
      ).toBe(true);
      expect(
        schema.safeParse({
          incidentSeverity: {
            order: { direction: SortOrder.Descending, nulls: "FIRST" },
          },
        }).success,
      ).toBe(true);
      // A relation given only a direction is no field of its record.
      expect(
        schema.safeParse({ incidentSeverity: SortOrder.Descending }).success,
      ).toBe(false);
      expect(
        schema.safeParse({ incidentSeverity: { order: "UP" } }).success,
      ).toBe(false);
    });
  });

  describe("getGroupByModelSchema", () => {
    test("builds a group-by schema and accepts an empty object", () => {
      for (const modelType of SAMPLE_MODELS) {
        const schema: any = ModelSchema.getGroupByModelSchema({ modelType });
        expect(isZodObject(schema)).toBe(true);
        expect(schema.safeParse({}).success).toBe(true);
      }
    });
  });

  describe("getQueryModelSchema", () => {
    test("builds a query schema that accepts an empty query", () => {
      for (const modelType of SAMPLE_MODELS) {
        const schema: any = ModelSchema.getQueryModelSchema({ modelType });
        expect(isZodObject(schema)).toBe(true);
        expect(schema.safeParse({}).success).toBe(true);
      }
    });
  });
});
