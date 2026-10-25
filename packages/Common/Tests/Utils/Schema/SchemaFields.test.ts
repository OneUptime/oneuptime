import { describe, expect, test } from "@jest/globals";
import Zod, { ZodSchema } from "../../../Utils/Schema/Zod";
import {
  getSchemaFieldNames,
  getSchemaFields,
  SchemaField,
} from "../../../Utils/Schema/SchemaFields";
import { ModelSchema } from "../../../Utils/Schema/ModelSchema";
import { AnalyticsModelSchema } from "../../../Utils/Schema/AnalyticsModelSchema";
import DatabaseModels from "../../../Models/DatabaseModels/Index";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import Dictionary from "../../../Types/Dictionary";

/*
 * SchemaFields reads the fields of a schema ModelSchema or AnalyticsModelSchema
 * made, through zod's and zod-to-openapi's public API: its name, whether it
 * may be left out, its documentation and its OpenAPI metadata. The MCP tools
 * build every tool's input schema from it (App's SchemaConverter and
 * SelectFieldGenerator), so an agent sees what these say.
 *
 * Before Common moved to zod 4 the MCP tools read zod 3's internals instead
 * (_def.shape(), _def.typeName, _def.openapi.metadata), which zod 4 does not
 * have. The tool list was compared field by field before and after the move
 * and is identical; the tests below hold the rules that made it so, on
 * schemas made here and on every model's.
 */

function fieldsOf(shape: Record<string, unknown>): Array<SchemaField> {
  return getSchemaFields(
    Zod.object(shape as Parameters<typeof Zod.object>[0]) as ZodSchema,
  );
}

function fieldOf(field: unknown): SchemaField {
  return fieldsOf({ field: field })[0]!;
}

describe("the fields of a schema", () => {
  test("every field of the shape, in the order it was written", () => {
    const schema: ZodSchema = Zod.object({
      b: Zod.string(),
      a: Zod.number().optional(),
      c: Zod.boolean(),
    }) as ZodSchema;

    expect(getSchemaFieldNames(schema)).toEqual(["b", "a", "c"]);
    expect(
      getSchemaFields(schema).map((field: SchemaField): string => {
        return field.name;
      }),
    ).toEqual(["b", "a", "c"]);
  });

  test("an empty schema has none", () => {
    expect(getSchemaFields(Zod.object({}) as ZodSchema)).toEqual([]);
    expect(getSchemaFieldNames(Zod.object({}) as ZodSchema)).toEqual([]);
  });
});

describe("whether a field may be left out", () => {
  test(".optional() at the top: yes", () => {
    expect(fieldOf(Zod.string().optional()).isOptional).toBe(true);
  });

  test("still yes after .openapi() and .describe(), which ModelSchema adds on top", () => {
    expect(
      fieldOf(
        Zod.string()
          .optional()
          .describe("A column.")
          .openapi({ description: "A column." }),
      ).isOptional,
    ).toBe(true);
  });

  test("a required field: no", () => {
    expect(fieldOf(Zod.string()).isOptional).toBe(false);
  });

  test("a default alone, or nullable: no - only .optional() makes it so, as for zod 3's ZodOptional", () => {
    expect(fieldOf(Zod.string().default("x")).isOptional).toBe(false);
    expect(fieldOf(Zod.string().nullable()).isOptional).toBe(false);
  });
});

describe("a field's OpenAPI metadata", () => {
  test("a required field's own", () => {
    expect(
      fieldOf(Zod.string().openapi({ type: "string", example: "x" })).openApi,
    ).toEqual({ type: "string", example: "x" });
  });

  test("an optional field's: what the schema inside .optional() says", () => {
    const field: SchemaField = fieldOf(
      Zod.string()
        .openapi({ type: "string", format: "uuid", example: "id" })
        .optional()
        .openapi({ description: "Outer words" }),
    );

    expect(field.openApi).toMatchObject({
      type: "string",
      format: "uuid",
      example: "id",
    });
    expect(field.openApi).not.toHaveProperty("description", "Outer words");
  });

  test("an optional field whose inside says nothing: its own", () => {
    // BaseSchema.generateSortSchema puts the metadata on the optional.
    expect(
      fieldOf(
        Zod.enum(["ASC", "DESC"])
          .optional()
          .openapi({
            type: "string",
            enum: ["ASC", "DESC"],
          }),
      ).openApi,
    ).toEqual({ type: "string", enum: ["ASC", "DESC"] });
  });

  test("a field nothing was said about: none", () => {
    expect(fieldOf(Zod.any()).openApi).toBeUndefined();
    expect(fieldOf(Zod.any().optional()).openApi).toBeUndefined();
  });
});

describe("a field's documentation", () => {
  test("what .describe() and .openapi() said about the field itself wins over its type's", () => {
    expect(
      fieldOf(
        Zod.string()
          .openapi({
            type: "string",
            description:
              "A unique identifier for an object, represented as a UUID.",
          })
          .optional()
          .describe("The project this belongs to.")
          .openapi({ description: "The project this belongs to." }),
      ).description,
    ).toBe("The project this belongs to.");
  });

  test(".describe() alone", () => {
    expect(fieldOf(Zod.string().describe("Only described.")).description).toBe(
      "Only described.",
    );
  });

  test(".describe() and then .openapi(): zod-to-openapi makes a new schema, and the words are kept", () => {
    expect(
      fieldOf(
        Zod.string().describe("Described first.").openapi({ example: "x" }),
      ).description,
    ).toBe("Described first.");
  });

  test("with no words of its own: its type's", () => {
    expect(
      fieldOf(
        Zod.string()
          .openapi({ type: "string", description: "The type's words." })
          .optional(),
      ).description,
    ).toBe("The type's words.");
  });

  test("with none anywhere: none", () => {
    expect(fieldOf(Zod.string()).description).toBeUndefined();
    expect(fieldOf(Zod.string().optional()).description).toBeUndefined();
  });
});

describe("a label's create schema, as ModelSchema makes it", () => {
  const fields: Array<SchemaField> = getSchemaFields(
    ModelSchema.getCreateModelSchema({ modelType: Label }),
  );
  const byName: Dictionary<SchemaField> = {};

  for (const field of fields) {
    byName[field.name] = field;
  }

  test("required and optional as the create API takes them", () => {
    expect(byName["name"]?.isOptional).toBe(false);
    expect(byName["color"]?.isOptional).toBe(false);
    // Derived from the API key.
    expect(byName["projectId"]?.isOptional).toBe(true);
    expect(byName["description"]?.isOptional).toBe(true);
  });

  test("an id column: the column's documentation, its type's metadata", () => {
    expect(byName["projectId"]?.description).toMatch(
      /^ID of your OneUptime Project in which this object belongs\./,
    );
    expect(byName["projectId"]?.openApi).toMatchObject({
      type: "string",
      format: "uuid",
    });
  });

  test("a column with a default says so", () => {
    expect(byName["isArchived"]?.openApi).toMatchObject({
      type: "boolean",
      default: false,
    });
  });
});

type DatabaseModelType = new () => DatabaseBaseModel;
type AnalyticsModelType = new () => AnalyticsBaseModel;

function documentedDatabaseModels(): Array<DatabaseModelType> {
  return (DatabaseModels as Array<DatabaseModelType>).filter(
    (Model: DatabaseModelType): boolean => {
      const model: DatabaseBaseModel = new Model();
      return Boolean(model.tableName && model.crudApiPath);
    },
  );
}

describe("every model's schemas", () => {
  const models: Array<DatabaseModelType> = documentedDatabaseModels();

  test("there are models to read", () => {
    expect(models.length).toBeGreaterThan(100);
  });

  test("every create, update, query, sort and select schema field is read, none lost", () => {
    const problems: Array<string> = [];

    for (const Model of models) {
      const schemas: Array<[string, ZodSchema]> = [
        ["create", ModelSchema.getCreateModelSchema({ modelType: Model })],
        ["update", ModelSchema.getUpdateModelSchema({ modelType: Model })],
        ["query", ModelSchema.getQueryModelSchema({ modelType: Model })],
        ["sort", ModelSchema.getSortModelSchema({ modelType: Model })],
        ["select", ModelSchema.getSelectModelSchema({ modelType: Model })],
      ];

      for (const [kind, schema] of schemas) {
        const names: Array<string> = getSchemaFields(schema).map(
          (field: SchemaField): string => {
            return field.name;
          },
        );

        if (names.join(",") !== Object.keys(schema.shape).join(",")) {
          problems.push(`${Model.name} ${kind}: ${names.join(",")}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  test("every documented column's description reaches its create and update field", () => {
    /*
     * The words an agent reads for each field. ModelSchema writes a column's
     * description (or its title) into the field, then the permissions; a read
     * that lost them would hand agents the type's words ("A unique
     * identifier for an object...") or "<name> field" instead.
     */
    const problems: Array<string> = [];

    for (const Model of models) {
      const columns: Dictionary<TableColumnMetadata> = getTableColumns(
        new Model(),
      );

      for (const [kind, schema] of [
        ["create", ModelSchema.getCreateModelSchema({ modelType: Model })],
        ["update", ModelSchema.getUpdateModelSchema({ modelType: Model })],
      ] as Array<[string, ZodSchema]>) {
        for (const field of getSchemaFields(schema)) {
          const column: TableColumnMetadata | undefined = columns[field.name];
          const words: string | undefined =
            column?.description || column?.title;

          if (!words) {
            continue;
          }

          if (!field.description?.startsWith(words)) {
            problems.push(
              `${Model.name} ${kind} ${field.name}: ${String(field.description)}`,
            );
          }
        }
      }
    }

    expect(problems).toEqual([]);
  });

  test("every create field has OpenAPI metadata with a type", () => {
    const problems: Array<string> = [];

    for (const Model of models) {
      for (const field of getSchemaFields(
        ModelSchema.getCreateModelSchema({ modelType: Model }),
      )) {
        if (typeof field.openApi?.type !== "string") {
          problems.push(`${Model.name} ${field.name}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  test("every analytics model's schemas are read, none lost", () => {
    const problems: Array<string> = [];

    for (const Model of AnalyticsModels as Array<AnalyticsModelType>) {
      const schemas: Array<[string, ZodSchema]> = [
        ["model", AnalyticsModelSchema.getModelSchema({ modelType: Model })],
        [
          "query",
          AnalyticsModelSchema.getQueryModelSchema({
            modelType: Model,
            disableOpenApiSchema: true,
          }),
        ],
        [
          "select",
          AnalyticsModelSchema.getSelectModelSchema({ modelType: Model }),
        ],
        [
          "sort",
          AnalyticsModelSchema.getSortModelSchema({
            modelType: Model,
            disableOpenApiSchema: true,
          }),
        ],
      ];

      for (const [kind, schema] of schemas) {
        if (
          getSchemaFieldNames(schema).join(",") !==
          Object.keys(schema.shape).join(",")
        ) {
          problems.push(`${Model.name} ${kind}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });
});
