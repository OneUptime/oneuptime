import { describe, expect, test } from "@jest/globals";
import { getOpenApiMetadata } from "@asteasolutions/zod-to-openapi";
import { ZodType } from "zod";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MonitorSecret from "../../../Models/DatabaseModels/MonitorSecret";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import Dictionary from "../../../Types/Dictionary";
import {
  ModelSchema,
  ModelSchemaType,
} from "../../../Utils/Schema/ModelSchema";

/*
 * COLUMNS THAT CHANGE ONLY TOGETHER WITH A NEW VALUE OF ANOTHER
 * (TableColumnMetadata.changesOnlyWith, #9814).
 *
 * A monitor secret's secretType changes only together with a new
 * secretValue, which the server reads for the new type (#9760). The column
 * says so, the OpenAPI spec says so (x-oneuptime-changes-only-with), and
 * the Terraform and OpenTofu provider refuses, at plan time, a plan that
 * changes secret_type and keeps secret_value - where it used to send the
 * type alone and fail half-way through the apply.
 *
 * This holds every declaration to one that can be kept: the column it
 * names is another column of the same model, and an update may write both
 * (a column no update writes could never come with it). And the spec says
 * it where a client reads it: in the create, update and read schemas and
 * the model's, on that column alone.
 */

type ModelType = new () => DatabaseBaseModel;

// Every declaration, so a new one is a decision someone made.
const DECLARED: Readonly<Record<string, string>> = {
  "MonitorSecret.secretType": "secretValue",
};

function isWritableByAnUpdate(
  model: DatabaseBaseModel,
  column: TableColumnMetadata | undefined,
  name: string,
): boolean {
  if (!column || column.computed) {
    return false;
  }

  const access: ColumnAccessControl | undefined =
    model.getColumnAccessControlForAllColumns()[name];

  return Boolean(access?.update && access.update.length > 0);
}

function getSchemaProperty(
  schema: ModelSchemaType,
  column: string,
): Record<string, unknown> | undefined {
  const shape: Record<string, ZodType> = (
    schema as unknown as { shape: Record<string, ZodType> }
  ).shape;
  const property: ZodType | undefined = shape[column];

  if (!property) {
    return undefined;
  }

  return getOpenApiMetadata(property) as Record<string, unknown> | undefined;
}

describe("columns that change only together with another", () => {
  test("every declaration is listed here, and names a sibling an update writes too", () => {
    const declared: Dictionary<string> = {};
    const broken: Array<string> = [];

    for (const modelType of AllModelTypes as Array<ModelType>) {
      const model: DatabaseBaseModel = new modelType();
      const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

      for (const [name, column] of Object.entries(columns)) {
        if (column.changesOnlyWith === undefined) {
          continue;
        }

        const key: string = `${model.tableName}.${name}`;
        const companion: string = column.changesOnlyWith;
        declared[key] = companion;

        if (companion === name) {
          broken.push(`${key} names itself`);
        } else if (!columns[companion]) {
          broken.push(`${key} names ${companion}, which the model has not`);
        } else if (
          !isWritableByAnUpdate(model, column, name) ||
          !isWritableByAnUpdate(model, columns[companion], companion)
        ) {
          broken.push(
            `${key} names ${companion}, and an update cannot write both`,
          );
        }
      }
    }

    expect(broken).toEqual([]);
    expect(declared).toEqual(DECLARED);
  });

  test("a monitor secret's type changes only together with a new value", () => {
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(
      new MonitorSecret(),
    );

    expect(columns["secretType"]?.changesOnlyWith).toBe("secretValue");
    // The value is the one that is read for the new type: it never names the type.
    expect(columns["secretValue"]?.changesOnlyWith).toBeUndefined();
    // Its description, which the API reference and the provider show, says so.
    expect(columns["secretType"]?.description).toContain(
      "Changes only together with a new Secret Value",
    );
  });

  test("the spec says it on the column, in every schema a client reads it from", () => {
    const schemas: Array<[string, ModelSchemaType]> = [
      [
        "create",
        ModelSchema.getCreateModelSchema({ modelType: MonitorSecret }),
      ],
      [
        "update",
        ModelSchema.getUpdateModelSchema({ modelType: MonitorSecret }),
      ],
      ["read", ModelSchema.getReadModelSchema({ modelType: MonitorSecret })],
      ["model", ModelSchema.getModelSchema({ modelType: MonitorSecret })],
    ];

    for (const [kind, schema] of schemas) {
      expect([
        kind,
        getSchemaProperty(schema, "secretType")?.[
          "x-oneuptime-changes-only-with"
        ],
      ]).toEqual([kind, "secretValue"]);

      // On that column alone.
      const shape: Record<string, ZodType> = (
        schema as unknown as { shape: Record<string, ZodType> }
      ).shape;

      for (const column of Object.keys(shape)) {
        if (column === "secretType") {
          continue;
        }

        expect([
          kind,
          column,
          getSchemaProperty(schema, column)?.["x-oneuptime-changes-only-with"],
        ]).toEqual([kind, column, undefined]);
      }
    }
  });

  test("an update schema says it only where the model declares it", () => {
    const stray: Array<string> = [];

    for (const modelType of AllModelTypes as Array<ModelType>) {
      const model: DatabaseBaseModel = new modelType();
      const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
      const schema: ModelSchemaType = ModelSchema.getUpdateModelSchema({
        modelType,
      });
      const shape: Record<string, ZodType> = (
        schema as unknown as { shape: Record<string, ZodType> }
      ).shape;

      for (const column of Object.keys(shape)) {
        const said: unknown = getSchemaProperty(schema, column)?.[
          "x-oneuptime-changes-only-with"
        ];

        if (said !== columns[column]?.changesOnlyWith) {
          stray.push(
            `${model.tableName}.${column}: the spec says ${String(said)}, the model ${String(columns[column]?.changesOnlyWith)}`,
          );
        }
      }
    }

    expect(stray).toEqual([]);
  });
});
