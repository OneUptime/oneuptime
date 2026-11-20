import { beforeAll, describe, expect, test } from "@jest/globals";
import ApiKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import CustomRolePermission from "../../../Models/DatabaseModels/CustomRolePermission";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Models from "../../../Models/DatabaseModels/Index";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { getTableColumns } from "../../../Types/Database/TableColumn";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import { OpenAPIParser } from "../../../../../Scripts/TerraformProvider/Core/OpenAPIParser";
import {
  TerraformAttribute,
  TerraformDataSource,
  TerraformResource,
} from "../../../../../Scripts/TerraformProvider/Core/Types";

/*
 * A PERMISSION IS ITS KEY, IN THE API SPEC AND THE TERRAFORM PROVIDER
 * (#10300).
 *
 * A team's, an API key's and a custom role's permission is a permission's
 * key: IncidentMember, ReadProjectIncident. The spec documented it as an
 * object, with the example {"read": true, "write": false, "delete": false},
 * so the provider made it a JSON attribute and the reference asked for
 * jsonencode("IncidentMember"), which then failed every apply. These read
 * the real spec and the real provider parser.
 */

let spec: JSONObject;
let resources: Array<TerraformResource>;
let dataSources: Array<TerraformDataSource>;

function schemas(): JSONObject {
  return (spec["components"] as JSONObject)["schemas"] as JSONObject;
}

function schema(schemaName: string): JSONObject {
  const found: JSONObject | undefined = schemas()[schemaName] as
    | JSONObject
    | undefined;

  expect({ schemaName, found: Boolean(found) }).toEqual({
    schemaName,
    found: true,
  });

  return found as JSONObject;
}

function property(schemaName: string, column: string): JSONObject {
  return ((schema(schemaName)["properties"] || {}) as JSONObject)[
    column
  ] as JSONObject;
}

beforeAll(() => {
  spec = OpenAPIUtil.generateOpenAPISpec();

  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(spec as never);
  resources = parser.getResources();
  dataSources = parser.getDataSources();
}, 600000);

interface PermissionTable {
  modelType: DatabaseBaseModelType;
  resource: string;
  /*
   * The column's own example, which the spec and the Terraform reference
   * give: a role commonly given, never Project Owner.
   */
  example: Permission;
}

const TABLES: Array<PermissionTable> = [
  {
    modelType: TeamPermission,
    resource: "team_permission",
    example: Permission.IncidentMember,
  },
  {
    modelType: ApiKeyPermission,
    resource: "api_key_permission",
    example: Permission.IncidentMember,
  },
  {
    modelType: CustomRolePermission,
    resource: "custom_role_permission",
    example: Permission.IncidentMember,
  },
];

const tableCases: Array<[string, PermissionTable]> = TABLES.map(
  (table: PermissionTable): [string, PermissionTable] => {
    return [table.modelType.name, table];
  },
);

// Where a model's column is written in the spec: the model, its create, read and update.
function schemaNamesOf(modelType: DatabaseBaseModelType): Array<string> {
  const tableName: string = new modelType().tableName as string;

  return [
    tableName,
    `${tableName}CreateSchema`,
    `${tableName}ReadSchema`,
    `${tableName}UpdateSchema`,
  ];
}

describe("the spec documents a permission as what it is: a permission's key", () => {
  test("these are every table with a permission column", () => {
    const withPermissionColumns: Array<string> = Models.filter(
      (modelType: DatabaseBaseModelType): boolean => {
        return Object.values(
          getTableColumns(new modelType() as BaseModel),
        ).some((column: { type: TableColumnType }): boolean => {
          return column.type === TableColumnType.Permission;
        });
      },
    ).map((modelType: DatabaseBaseModelType): string => {
      return modelType.name;
    });

    expect(withPermissionColumns.sort()).toEqual(
      TABLES.map((table: PermissionTable): string => {
        return table.modelType.name;
      }).sort(),
    );
  });

  test.each(tableCases)(
    "%s: a string, its example a real key, in the model, its create, read and update",
    (_name: string, table: PermissionTable) => {
      for (const schemaName of schemaNamesOf(table.modelType)) {
        const permission: JSONObject = property(schemaName, "permission");

        expect({ schemaName, permission }).toEqual({
          schemaName,
          permission: expect.objectContaining({
            type: "string",
            example: table.example,
            "x-oneuptime-type": "Permission",
          }),
        });
        // Not the object it was documented as.
        expect(permission["properties"]).toBeUndefined();
        expect(JSON.stringify(permission)).not.toContain('"read":true');
        // Every one is a key OneUptime has.
        expect(Object.values(Permission)).toContain(permission["example"]);
        // No enum: more than 1,600 keys, and more with each release.
        expect(permission["enum"]).toBeUndefined();
      }
    },
  );

  test.each(tableCases)(
    "%s: a create must send it, as the API refuses one without",
    (_name: string, table: PermissionTable) => {
      const tableName: string = new table.modelType().tableName as string;

      expect(schema(`${tableName}CreateSchema`)["required"]).toContain(
        "permission",
      );
    },
  );

  test.each(tableCases)(
    "%s: a create's example gives a key, never the word read",
    (_name: string, table: PermissionTable) => {
      const tableName: string = new table.modelType().tableName as string;
      const example: JSONObject = schema(`${tableName}CreateSchema`)[
        "example"
      ] as JSONObject;

      expect(example["permission"]).toBe(table.example);
    },
  );

  test.each(tableCases)(
    "%s: a query filters on it as on any text, by the Permission filter",
    (_name: string, table: PermissionTable) => {
      const tableName: string = new table.modelType().tableName as string;

      expect(property(`${tableName}QuerySchema`, "permission")).toEqual({
        $ref: "#/components/schemas/PermissionFilter",
      });
      expect(JSON.stringify(schema("PermissionFilter")["anyOf"])).not.toContain(
        '"type":"object","example"',
      );
    },
  );
});

function resourceNamed(name: string): TerraformResource {
  const found: TerraformResource | undefined = resources.find(
    (candidate: TerraformResource): boolean => {
      return candidate.name === name;
    },
  );

  expect({ name, found: Boolean(found) }).toEqual({ name, found: true });

  return found as TerraformResource;
}

function dataSourceNamed(name: string): TerraformDataSource {
  const found: TerraformDataSource | undefined = dataSources.find(
    (candidate: TerraformDataSource): boolean => {
      return candidate.name === name;
    },
  );

  expect({ name, found: Boolean(found) }).toEqual({ name, found: true });

  return found as TerraformDataSource;
}

describe("the Terraform provider takes it as a string", () => {
  test.each(tableCases)(
    "%s: a permission attribute, not JSON, optional as it always was",
    (_name: string, table: PermissionTable) => {
      const attribute: TerraformAttribute | undefined = resourceNamed(
        table.resource,
      ).schema["permission"];

      expect(attribute).toEqual(
        expect.objectContaining({
          type: "string",
          isPermission: true,
          required: false,
          optional: true,
          computed: true,
          example: table.example,
        }),
      );
      expect(attribute?.isComplexObject).toBeFalsy();
      // Its reference says how it is written, and that jsonencode() still works.
      expect(attribute?.description).toContain(
        OpenAPIParser.PERMISSION_DESCRIPTION,
      );
      expect(attribute?.description).not.toContain(
        "A JSON value: write it with `jsonencode()`.",
      );
    },
  );

  test.each(tableCases)(
    "%s: the data source reads the key, and looks a row up by it",
    (_name: string, table: PermissionTable) => {
      const attribute: TerraformAttribute | undefined = dataSourceNamed(
        table.resource,
      ).schema["permission"];

      expect(attribute).toEqual(
        expect.objectContaining({
          type: "string",
          isLookupFilter: true,
          optional: true,
          computed: true,
        }),
      );
      expect(attribute?.isComplexObject).toBeFalsy();
      expect(attribute?.description).not.toContain("jsondecode");
      expect(attribute?.description).not.toContain("jsonencode");
    },
  );

  test("no other attribute is a permission", () => {
    const permissionAttributes: Array<string> = resources.flatMap(
      (resource: TerraformResource): Array<string> => {
        return Object.entries(resource.schema)
          .filter(([, attribute]: [string, TerraformAttribute]): boolean => {
            return Boolean(attribute.isPermission);
          })
          .map(([name]: [string, TerraformAttribute]): string => {
            return `${resource.name}.${name}`;
          });
      },
    );

    expect(permissionAttributes.sort()).toEqual(
      TABLES.map((table: PermissionTable): string => {
        return `${table.resource}.permission`;
      }).sort(),
    );
  });
});
