import Models from "../../../Models/DatabaseModels/Index";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import { JSONObject } from "../../../Types/JSON";
import {
  BASE_COLUMN_SCHEMA_NAMES,
  ModelSchema,
} from "../../../Utils/Schema/ModelSchema";
import { getTerraformTypeName } from "../../../Utils/DeveloperDocs/TerraformSchema";
import { OpenAPIParser } from "../../../../../Scripts/TerraformProvider/Core/OpenAPIParser";
import {
  TerraformAttribute,
  TerraformDataSource,
  TerraformResource,
} from "../../../../../Scripts/TerraformProvider/Core/Types";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * THE COLUMNS EVERY RECORD HAS, DESCRIBED ONCE (OpenAPISpecBudget).
 *
 * A record's ID, when it was created, updated and deleted, and its version
 * are the base model's own columns (DatabaseBaseModel), the same on every
 * resource. Written out on each resource's model, read and delete schemas
 * they were the same five fields 5,321 times, 0.6 MB of a spec held to a
 * budget. So the spec describes each once, as a schema of its own
 * (RecordId ... RecordVersion), and a resource refers to it, as it refers
 * to what created the record and who last modified it (RecordActorSchemas).
 * What a client reads of them is what it read before: the same type, words
 * and read only, behind a reference.
 */

const COLUMNS: Array<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "version",
];

let spec: JSONObject;
let schemas: Record<string, JSONObject>;

beforeAll(() => {
  spec = OpenAPIUtil.generateOpenAPISpec();
  schemas = (spec["components"] as JSONObject)["schemas"] as Record<
    string,
    JSONObject
  >;
}, 180000);

function propertiesOf(name: string): Record<string, JSONObject> {
  return ((schemas[name]?.["properties"] as Record<string, JSONObject>) ||
    {}) as Record<string, JSONObject>;
}

function refTo(name: string): JSONObject {
  return { $ref: `#/components/schemas/${name}` };
}

// The base model's own columns, as every model that does not declare its own has them.
function baseColumns(): Record<string, TableColumnMetadata> {
  return getTableColumns(new DatabaseBaseModel()) as Record<
    string,
    TableColumnMetadata
  >;
}

// The models the spec documents.
function documented(): Array<DatabaseBaseModel> {
  return (Models as Array<DatabaseBaseModelType>)
    .map((modelType: DatabaseBaseModelType): DatabaseBaseModel => {
      return new modelType();
    })
    .filter((model: DatabaseBaseModel): boolean => {
      return (
        Boolean(model.tableName) &&
        Boolean(model.enableDocumentation) &&
        Boolean(model.crudApiPath)
      );
    });
}

describe("the shared schemas", () => {
  test("one for each of the five, by the names the spec publishes", () => {
    expect(Object.keys(BASE_COLUMN_SCHEMA_NAMES).sort()).toEqual(
      [...COLUMNS].sort(),
    );

    for (const name of Object.values(BASE_COLUMN_SCHEMA_NAMES)) {
      expect([name, Boolean(schemas[name])]).toEqual([name, true]);
    }
  });

  test("each says what the base model's column says, once, read only", () => {
    const columns: Record<string, TableColumnMetadata> = baseColumns();

    for (const [column, name] of Object.entries(BASE_COLUMN_SCHEMA_NAMES)) {
      const schema: JSONObject = schemas[name]!;
      const words: string = columns[column]!.description!;

      expect([name, schema["readOnly"]]).toEqual([name, true]);
      expect([name, schema["description"]]).toEqual([name, words]);
      // Its words alone: only OneUptime writes it, so nobody's permissions.
      expect(String(schema["description"])).not.toContain("Permissions - ");

      // Written once in the whole spec.
      expect([
        name,
        JSON.stringify(spec).split(JSON.stringify(words)).length - 1,
      ]).toEqual([name, 1]);
    }
  });

  test("an id is a uuid, when is a date and a version is a number", () => {
    expect(schemas["RecordId"]).toEqual(
      expect.objectContaining({ type: "string", format: "uuid" }),
    );

    for (const name of [
      "RecordCreatedAt",
      "RecordUpdatedAt",
      "RecordDeletedAt",
    ]) {
      expect([name, schemas[name]!["x-oneuptime-type"]]).toEqual([
        name,
        "DateTime",
      ]);
    }

    expect(schemas["RecordVersion"]).toEqual(
      expect.objectContaining({ type: "number" }),
    );
  });
});

describe("every resource", () => {
  test("refers to them in its model, read and delete schemas, and writes none of them out", () => {
    const wrong: Array<string> = [];
    const references: Record<string, number> = {};
    const base: Record<string, TableColumnMetadata> = baseColumns();

    for (const model of documented()) {
      const columns: Record<string, TableColumnMetadata> = getTableColumns(
        model,
      ) as Record<string, TableColumnMetadata>;

      for (const suffix of ["", "ReadSchema", "DeleteSchema"]) {
        const properties: Record<string, JSONObject> = propertiesOf(
          `${model.tableName}${suffix}`,
        );

        for (const [column, name] of Object.entries(BASE_COLUMN_SCHEMA_NAMES)) {
          /*
           * Not documented here, or declared by the model its own way, which
           * its schemas describe as any column (getBaseColumnSchema).
           */
          if (!properties[column] || columns[column] !== base[column]) {
            continue;
          }

          if (
            JSON.stringify(properties[column]) !== JSON.stringify(refTo(name))
          ) {
            wrong.push(`${model.tableName}${suffix}.${column}`);
          } else {
            references[name] = (references[name] || 0) + 1;
          }
        }
      }
    }

    expect(wrong).toEqual([]);
    // Model, read and delete schemas name the ID; model and read the dates.
    expect(references["RecordId"]).toBeGreaterThan(1200);
    for (const name of [
      "RecordCreatedAt",
      "RecordUpdatedAt",
      "RecordDeletedAt",
    ]) {
      expect([name, (references[name] || 0) > 800]).toEqual([name, true]);
    }
    // The version, which the read schemas leave out, in the model schemas.
    expect(references["RecordVersion"]).toBeGreaterThan(400);
  });

  test("still has each where it had it: a monitor's model, read and delete schemas", () => {
    expect(propertiesOf("Monitor")).toEqual(
      expect.objectContaining({
        _id: refTo("RecordId"),
        createdAt: refTo("RecordCreatedAt"),
        updatedAt: refTo("RecordUpdatedAt"),
        deletedAt: refTo("RecordDeletedAt"),
        version: refTo("RecordVersion"),
      }),
    );
    expect(propertiesOf("MonitorReadSchema")).toEqual(
      expect.objectContaining({
        _id: refTo("RecordId"),
        createdAt: refTo("RecordCreatedAt"),
        updatedAt: refTo("RecordUpdatedAt"),
        deletedAt: refTo("RecordDeletedAt"),
      }),
    );
    // Hidden from the documentation (hideColumnInDocumentation), as before.
    expect(propertiesOf("MonitorReadSchema")["version"]).toBeUndefined();
    expect(propertiesOf("MonitorDeleteSchema")).toEqual({
      _id: refTo("RecordId"),
    });
  });

  test("never writes them: no create or update schema has one", () => {
    const wrong: Array<string> = [];

    for (const model of documented()) {
      for (const suffix of ["CreateSchema", "UpdateSchema"]) {
        for (const column of COLUMNS) {
          if (propertiesOf(`${model.tableName}${suffix}`)[column]) {
            wrong.push(`${model.tableName}${suffix}.${column}`);
          }
        }
      }
    }

    expect(wrong).toEqual([]);
  });
});

describe("ModelSchema.getBaseColumnSchema", () => {
  test("is the shared schema for the base model's own column, every time", () => {
    const column: TableColumnMetadata = getTableColumns(new Monitor())[
      "createdAt"
    ]!;

    expect(column).toBe(baseColumns()["createdAt"]);

    const schema: unknown = ModelSchema.getBaseColumnSchema({
      key: "createdAt",
      column: column,
    });

    expect(schema).toBeTruthy();
    expect(
      ModelSchema.getBaseColumnSchema({ key: "createdAt", column: column }),
    ).toBe(schema);
  });

  test("is none for any other column, or for one a model declares its own way", () => {
    const columns: Record<string, TableColumnMetadata> = getTableColumns(
      new Monitor(),
    ) as Record<string, TableColumnMetadata>;

    expect(
      ModelSchema.getBaseColumnSchema({
        key: "name",
        column: columns["name"]!,
      }),
    ).toBeNull();

    // A column of the same name, declared by a model of its own: its own.
    expect(
      ModelSchema.getBaseColumnSchema({
        key: "createdAt",
        column: { ...columns["createdAt"]! },
      }),
    ).toBeNull();
  });
});

describe("the Terraform provider generated from the spec", () => {
  let resources: Map<string, TerraformResource>;
  let dataSources: Map<string, TerraformDataSource>;

  beforeAll(() => {
    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(spec as never);

    resources = new Map<string, TerraformResource>();

    for (const resource of parser.getResources()) {
      resources.set(`oneuptime_${resource.name}`, resource);
    }

    dataSources = new Map<string, TerraformDataSource>();

    for (const dataSource of parser.getDataSources()) {
      dataSources.set(`oneuptime_${dataSource.name}`, dataSource);
    }
  }, 180000);

  test("reads when each record was created and updated, as a computed timestamp in the base model's words", () => {
    const columns: Record<string, TableColumnMetadata> = baseColumns();
    const wrong: Array<string> = [];
    let read: number = 0;

    for (const model of documented()) {
      const typeName: string | null = getTerraformTypeName(
        model.constructor as DatabaseBaseModelType,
      );
      const resource: TerraformResource | undefined = typeName
        ? resources.get(typeName)
        : undefined;

      if (!resource) {
        continue;
      }

      for (const [column, attributeName] of [
        ["createdAt", "created_at"],
        ["updatedAt", "updated_at"],
      ] as Array<[string, string]>) {
        const attribute: TerraformAttribute | undefined =
          resource.schema[attributeName];

        if (!attribute) {
          continue;
        }

        if (
          !attribute.computed ||
          attribute.optional ||
          attribute.required ||
          attribute.forceNew ||
          !attribute.isDateTime ||
          attribute.description !== columns[column]!.description
        ) {
          wrong.push(`${typeName}.${attributeName}`);
        } else {
          read++;
        }
      }
    }

    expect(wrong).toEqual([]);
    expect(read).toBeGreaterThan(400 * 2);

    for (const attributeName of ["created_at", "updated_at"]) {
      expect([
        attributeName,
        Boolean(resources.get("oneuptime_monitor")!.schema[attributeName]),
      ]).toEqual([attributeName, true]);
    }
  });

  test("a data source reads them too", () => {
    const monitor: TerraformDataSource = dataSources.get("oneuptime_monitor")!;

    for (const attributeName of ["created_at", "updated_at"]) {
      expect([
        attributeName,
        Boolean(monitor.schema[attributeName]?.computed),
      ]).toEqual([attributeName, true]);
    }
  });
});
