import Models from "../../../Models/DatabaseModels/Index";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import File from "../../../Models/DatabaseModels/File";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import {
  LAST_MODIFIED_BY_USER_COLUMN,
  RECORD_ACTOR_COLUMNS,
  RECORD_ACTOR_TYPES,
} from "../../../Types/Database/RecordActor";
import { JSONObject } from "../../../Types/JSON";
import {
  getCrossplaneConnectionSecretKeys,
  getCrossplaneReferences,
} from "../../../Utils/DeveloperDocs/CrossplaneSchema";
import {
  getTerraformAttributes,
  getTerraformTypeName,
  toTerraformSnakeCase,
} from "../../../Utils/DeveloperDocs/TerraformSchema";
import {
  ModelSchema,
  RECORD_ACTOR_SCHEMA_NAMES,
} from "../../../Utils/Schema/ModelSchema";
import { OpenAPIParser } from "../../../../../Scripts/TerraformProvider/Core/OpenAPIParser";
import {
  TerraformAttribute,
  TerraformDataSource,
  TerraformResource,
} from "../../../../../Scripts/TerraformProvider/Core/Types";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * WHO CREATED AND WHO LAST MODIFIED A RECORD, IN THE API REFERENCE (#10527).
 *
 * Every record keeps what created it and who last modified it (#10290).
 * They were kept out of the API's documentation: written on every resource
 * the way a column is, they would have taken the spec past its budget
 * (OpenAPISpecBudget). Now each resource documents them, read only, and the
 * spec describes each of the six once, as a schema of its own each resource
 * refers to. The relation over the person is the person's sort fields, by
 * reference, as createdByUser's are.
 *
 * Read by whoever may read who created the record (DatabaseBaseModel
 * .getColumnAccessControlForAllColumns): a team member's and a file's
 * creator nobody may read, so neither documents them.
 */

const SCALAR_COLUMNS: Array<string> = RECORD_ACTOR_COLUMNS.filter(
  (column: string): boolean => {
    return column !== LAST_MODIFIED_BY_USER_COLUMN;
  },
);

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

// The documented models whose readers may read who created a record.
function documentedWithReaders(): Array<DatabaseBaseModel> {
  return (Models as Array<DatabaseBaseModelType>)
    .map((modelType: DatabaseBaseModelType): DatabaseBaseModel => {
      return new modelType();
    })
    .filter((model: DatabaseBaseModel): boolean => {
      return (
        Boolean(model.tableName) &&
        Boolean(model.enableDocumentation) &&
        Boolean(model.crudApiPath) &&
        (model.getColumnAccessControlForAllColumns()["lastModifiedAt"]?.read
          ?.length || 0) > 0
      );
    });
}

describe("the shared schemas", () => {
  test("one for each of the six, by the names the spec publishes", () => {
    expect(Object.keys(RECORD_ACTOR_SCHEMA_NAMES).sort()).toEqual(
      [...SCALAR_COLUMNS].sort(),
    );

    for (const name of Object.values(RECORD_ACTOR_SCHEMA_NAMES)) {
      expect([name, Boolean(schemas[name])]).toEqual([name, true]);
    }
  });

  test("each says what its column says, once, read only", () => {
    const columns: Record<string, TableColumnMetadata> = getTableColumns(
      new Monitor(),
    ) as Record<string, TableColumnMetadata>;

    for (const [column, name] of Object.entries(RECORD_ACTOR_SCHEMA_NAMES)) {
      const schema: JSONObject = schemas[name]!;

      expect([name, schema["readOnly"]]).toEqual([name, true]);
      expect([name, schema["description"]]).toEqual([
        name,
        columns[column]!.description,
      ]);
      // Its words alone: no one resource's permissions.
      expect(String(schema["description"])).not.toContain("Permissions - ");

      // Written once in the whole spec.
      expect([
        name,
        JSON.stringify(spec).split(JSON.stringify(columns[column]!.description))
          .length - 1,
      ]).toEqual([name, 1]);
    }
  });

  test("what made a record is one of the kinds; an id is a uuid; when is a date", () => {
    for (const name of [
      "RecordCreatedByActorType",
      "RecordLastModifiedByActorType",
    ]) {
      expect(schemas[name]).toEqual(
        expect.objectContaining({
          type: "string",
          enum: [...RECORD_ACTOR_TYPES],
        }),
      );
    }

    for (const name of [
      "RecordCreatedByActorId",
      "RecordLastModifiedByActorId",
      "RecordLastModifiedByUserId",
    ]) {
      expect(schemas[name]).toEqual(
        expect.objectContaining({ type: "string", format: "uuid" }),
      );
    }

    expect(schemas["RecordLastModifiedAt"]).toEqual(
      expect.objectContaining({ "x-oneuptime-type": "DateTime" }),
    );
  });

  test("the person who last modified it is a user, as the provider names users", () => {
    expect(schemas["RecordLastModifiedByUserId"]!["x-oneuptime-relation"]).toEqual(
      { tag: "User", tableName: "User" },
    );
  });
});

describe("every resource whose readers may read who created a record", () => {
  test("refers to the six in its model schema, and in its read schema when it has one", () => {
    const models: Array<DatabaseBaseModel> = documentedWithReaders();
    const wrong: Array<string> = [];
    let readSchemas: number = 0;

    expect(models.length).toBeGreaterThan(400);

    for (const model of models) {
      const table: string = model.tableName!;

      for (const suffix of ["", "ReadSchema"]) {
        if (!schemas[`${table}${suffix}`]) {
          continue;
        }

        if (suffix) {
          readSchemas++;
        }

        const properties: Record<string, JSONObject> = propertiesOf(
          `${table}${suffix}`,
        );

        for (const column of SCALAR_COLUMNS) {
          if (
            JSON.stringify(properties[column]) !==
            JSON.stringify(refTo(RECORD_ACTOR_SCHEMA_NAMES[column]!))
          ) {
            wrong.push(`${table}${suffix}.${column}`);
          }
        }
      }
    }

    expect(wrong).toEqual([]);
    expect(readSchemas).toBeGreaterThan(400);
  });

  test("can query, select and sort by them, and sort by the person's fields", () => {
    const wrong: Array<string> = [];

    for (const model of documentedWithReaders()) {
      const table: string = model.tableName!;

      for (const column of SCALAR_COLUMNS) {
        for (const suffix of ["QuerySchema", "SelectSchema", "SortSchema"]) {
          if (!propertiesOf(`${table}${suffix}`)[column]) {
            wrong.push(`${table}${suffix}.${column}`);
          }
        }
      }

      expect([
        table,
        propertiesOf(`${table}SortSchema`)[LAST_MODIFIED_BY_USER_COLUMN],
      ]).toEqual([table, refTo("UserRelationSortSchema")]);
    }

    expect(wrong).toEqual([]);
  });

  test("never writes them: no create or update schema has one", () => {
    const wrong: Array<string> = [];

    for (const model of documentedWithReaders()) {
      for (const suffix of ["CreateSchema", "UpdateSchema"]) {
        for (const column of RECORD_ACTOR_COLUMNS) {
          if (propertiesOf(`${model.tableName}${suffix}`)[column]) {
            wrong.push(`${model.tableName}${suffix}.${column}`);
          }
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  test("but a team member's and a file's, whose creator nobody may read, document none", () => {
    for (const modelType of [TeamMember, File]) {
      const table: string = new modelType().tableName!;

      for (const suffix of ["", "ReadSchema", "SelectSchema", "QuerySchema"]) {
        for (const column of RECORD_ACTOR_COLUMNS) {
          expect([
            `${table}${suffix}`,
            column,
            Boolean(propertiesOf(`${table}${suffix}`)[column]),
          ]).toEqual([`${table}${suffix}`, column, false]);
        }
      }
    }
  });
});

describe("a read-only field's description", () => {
  test("is its own words, with no permissions sentence; a writable one keeps its permissions", () => {
    const monitor: Record<string, JSONObject> = propertiesOf("MonitorReadSchema");

    expect(monitor["createdAt"]!["readOnly"]).toBe(true);
    expect(monitor["createdAt"]!["description"]).toBe(
      "Date and Time when the object was created.",
    );
    expect(String(monitor["name"]!["description"])).toContain(
      "Permissions - Create: [",
    );
  });

  test("on no field anywhere in the spec says Create: [No access] of a field that is read only", () => {
    const wrong: Array<string> = [];

    for (const [name, schema] of Object.entries(schemas)) {
      const properties: Record<string, JSONObject> =
        (schema["properties"] as Record<string, JSONObject> | undefined) || {};

      for (const [field, property] of Object.entries(properties)) {
        if (
          property["readOnly"] === true &&
          String(property["description"] || "").includes("Permissions - ")
        ) {
          wrong.push(`${name}.${field}`);
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  test("the rule: only OneUptime writes it", () => {
    const columns: Record<string, TableColumnMetadata> = getTableColumns(
      new Monitor(),
    ) as Record<string, TableColumnMetadata>;

    expect(ModelSchema.isWrittenOnlyByOneUptime(columns["createdAt"]!)).toBe(
      true,
    );
    expect(ModelSchema.isWrittenOnlyByOneUptime(columns["name"]!)).toBe(false);
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

  test("computes each on every resource, never takes it, and never replaces a resource for it", () => {
    const wrong: Array<string> = [];
    let computed: number = 0;

    for (const model of documentedWithReaders()) {
      const typeName: string | null = getTerraformTypeName(
        model.constructor as DatabaseBaseModelType,
      );
      const resource: TerraformResource | undefined = typeName
        ? resources.get(typeName)
        : undefined;

      if (!resource) {
        continue;
      }

      for (const column of SCALAR_COLUMNS) {
        const attribute: TerraformAttribute | undefined =
          resource.schema[toTerraformSnakeCase(column)];

        if (
          !attribute ||
          !attribute.computed ||
          attribute.optional ||
          attribute.required ||
          attribute.forceNew
        ) {
          wrong.push(`${typeName}.${toTerraformSnakeCase(column)}`);
        } else {
          computed++;
        }
      }
    }

    expect(wrong).toEqual([]);
    expect(computed).toBeGreaterThan(400 * SCALAR_COLUMNS.length);
  });

  test("says what the shared schema says of each, and names the person a user", () => {
    const monitor: TerraformResource = resources.get("oneuptime_monitor")!;

    expect(monitor.schema["last_modified_at"]?.description).toBe(
      "When a person, an API key, a workflow or an MCP client last changed this object. OneUptime's own updates do not count. Empty until it is changed.",
    );
    expect(monitor.schema["last_modified_by_user_id"]?.description).toContain(
      "`oneuptime_user`",
    );
  });

  /*
   * The Crossplane provider is generated from the Terraform provider
   * (Upjet): an attribute only computed is the managed resource's
   * status.atProvider, which a manifest never sets. So none of the six is
   * a field a manifest gives, a reference to another kind, or a secret its
   * connection Secret holds.
   */
  test("the Crossplane provider made from it reads each, as a status field", () => {
    for (const model of documentedWithReaders()) {
      const modelType: DatabaseBaseModelType =
        model.constructor as DatabaseBaseModelType;

      for (const reference of getCrossplaneReferences(modelType)) {
        expect([
          model.tableName,
          RECORD_ACTOR_COLUMNS.includes(reference.descriptor.columnName),
        ]).toEqual([model.tableName, false]);
      }

      for (const key of getCrossplaneConnectionSecretKeys(modelType)) {
        expect([
          model.tableName,
          [...SCALAR_COLUMNS, ...SCALAR_COLUMNS.map(toTerraformSnakeCase)]
            .includes(key),
        ]).toEqual([model.tableName, false]);
      }

      for (const descriptor of getTerraformAttributes(modelType)) {
        expect([
          model.tableName,
          RECORD_ACTOR_COLUMNS.includes(descriptor.columnName),
        ]).toEqual([model.tableName, false]);
      }
    }
  });

  test("a data source reads them too, and has no deleted_by_user_id", () => {
    const monitor: TerraformDataSource = dataSources.get("oneuptime_monitor")!;

    for (const column of SCALAR_COLUMNS) {
      expect([
        column,
        Boolean(monitor.schema[toTerraformSnakeCase(column)]?.computed),
      ]).toEqual([column, true]);
    }

    for (const [name, resource] of resources) {
      expect([name, resource.schema["deleted_by_user_id"]]).toEqual([
        name,
        undefined,
      ]);
    }
  });
});
