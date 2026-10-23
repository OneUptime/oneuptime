import { beforeAll, describe, expect, test } from "@jest/globals";
import ApiKeyCustomRole from "../../../Models/DatabaseModels/ApiKeyCustomRole";
import ApiKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import { OpenAPIParser } from "../../../../../Scripts/TerraformProvider/Core/OpenAPIParser";
import {
  TerraformAttribute,
  TerraformResource,
} from "../../../../../Scripts/TerraformProvider/Core/Types";

/*
 * CUSTOM ROLES ON API KEYS, OUTSIDE THE DASHBOARD.
 *
 * A team that keeps its keys in Terraform, a script on the API or an agent
 * over MCP gives a key a custom role the way the Dashboard does: one
 * ApiKeyCustomRole naming the key and the role, created or deleted - never
 * changed in place. The copies of the role's permissions the key then holds
 * (ApiKeyPermission.customRoleId and its two neighbours) are OneUptime's
 * own: read everywhere, written by nobody. The API reference and the
 * Terraform provider are generated from the models' metadata; these read the
 * real spec and the real provider parser.
 */

let spec: JSONObject;
let providerResources: Array<TerraformResource>;

function schema(schemaName: string): JSONObject {
  const schemas: JSONObject = (spec["components"] as JSONObject)[
    "schemas"
  ] as JSONObject;
  const found: JSONObject | undefined = schemas[schemaName] as
    | JSONObject
    | undefined;

  expect(found).toBeDefined();

  return found as JSONObject;
}

function propertyNames(schemaName: string): Array<string> {
  return Object.keys(
    (schema(schemaName)["properties"] || {}) as JSONObject,
  ).sort();
}

function requiredOf(schemaName: string): Array<string> {
  return [...((schema(schemaName)["required"] || []) as Array<string>)].sort();
}

function methodsOf(path: string): Array<string> {
  const paths: JSONObject = spec["paths"] as JSONObject;

  return Object.keys((paths[path] || {}) as JSONObject).sort();
}

function resource(name: string): TerraformResource {
  const found: TerraformResource | undefined = providerResources.find(
    (candidate: TerraformResource): boolean => {
      return candidate.name === name;
    },
  );

  expect(found).toBeDefined();

  return found!;
}

beforeAll(() => {
  spec = OpenAPIUtil.generateOpenAPISpec();

  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(spec as never);
  providerResources = parser.getResources();
});

// The columns OneUptime keeps on a key's copy of a role's permission.
const COPY_COLUMNS: Array<string> = [
  "customRoleId",
  "apiKeyCustomRoleId",
  "customRolePermissionId",
];

describe("the API", () => {
  test("gives a key a role at /api-key-custom-role: create, list, count, read and delete", () => {
    expect(new ApiKeyCustomRole().getCrudApiPath()?.toString()).toBe(
      "/api-key-custom-role",
    );
    expect(methodsOf("/api-key-custom-role")).toEqual(["post"]);
    expect(methodsOf("/api-key-custom-role/get-list")).toEqual(["post"]);
    expect(methodsOf("/api-key-custom-role/count")).toEqual(["post"]);
    expect(methodsOf("/api-key-custom-role/{id}/get-item")).toEqual(["post"]);
    expect(methodsOf("/api-key-custom-role/{id}")).toContain("delete");
  });

  test("a create names the key and the role, and nothing else", () => {
    expect(propertyNames("ApiKeyCustomRoleCreateSchema")).toEqual(
      ["apiKeyId", "customRoleId", "projectId"].sort(),
    );
    expect(requiredOf("ApiKeyCustomRoleCreateSchema")).toEqual(
      ["apiKeyId", "customRoleId"].sort(),
    );
  });

  test("nothing of it is changed in place: a key is given a role, or it is not", () => {
    expect(propertyNames("ApiKeyCustomRoleUpdateSchema")).toEqual([]);
  });

  test("a read says which key, which role and who gave it", () => {
    const read: Array<string> = propertyNames("ApiKeyCustomRoleReadSchema");

    for (const column of ["apiKeyId", "customRoleId", "createdByUserId"]) {
      expect(read).toContain(column);
    }
  });

  test("who may give, read and take a key's roles: as for the key's own permissions", () => {
    const grant: ApiKeyCustomRole = new ApiKeyCustomRole();
    const permission: ApiKeyPermission = new ApiKeyPermission();

    expect([...grant.getCreatePermissions()].sort()).toEqual(
      [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.EditProjectApiKeyPermissions,
      ].sort(),
    );
    // Each who may give a key a role may add a permission to it directly too.
    expect([...grant.getCreatePermissions()].sort()).toEqual(
      [...permission.getCreatePermissions()]
        .filter((candidate: Permission): boolean => {
          return grant.getCreatePermissions().includes(candidate);
        })
        .sort(),
    );
    expect(grant.getReadPermissions()).toContain(Permission.ReadProjectApiKey);
    expect(grant.getDeletePermissions()).toContain(
      Permission.EditProjectApiKeyPermissions,
    );
    expect(grant.getDeletePermissions()).toContain(
      Permission.DeleteProjectApiKey,
    );
  });

  test("a key's copies of a role's permissions are read, and never written, through the API", () => {
    expect(propertyNames("ApiKeyPermissionReadSchema")).toEqual(
      expect.arrayContaining(COPY_COLUMNS),
    );

    for (const schemaName of [
      "ApiKeyPermissionCreateSchema",
      "ApiKeyPermissionUpdateSchema",
    ]) {
      for (const column of COPY_COLUMNS) {
        expect(propertyNames(schemaName)).not.toContain(column);
      }
    }

    const permission: ApiKeyPermission = new ApiKeyPermission();

    for (const column of COPY_COLUMNS) {
      const access: {
        create: Array<Permission>;
        update: Array<Permission>;
        read: Array<Permission>;
      } = permission.getColumnAccessControlFor(column)!;

      expect(access.create).toEqual([]);
      expect(access.update).toEqual([]);
      expect(access.read).toContain(Permission.ReadProjectApiKey);
    }
  });
});

describe("Terraform", () => {
  test("oneuptime_api_key_custom_role gives a key a role; another key or role is another grant", () => {
    const grant: TerraformResource = resource("api_key_custom_role");

    expect(grant.operations.create).toBeDefined();
    expect(grant.operations.read).toBeDefined();
    expect(grant.operations.delete).toBeDefined();
    // What the key holds of the role, the Owned exception included.
    expect(grant.description).toBe(
      "The custom roles an API key is given. The key holds every permission of the role except those with the Owned scope: a key owns nothing.",
    );

    for (const [name, relation] of [
      ["api_key_id", "api_key"],
      ["custom_role_id", "custom_role"],
    ] as Array<[string, string]>) {
      const attribute: TerraformAttribute | undefined = grant.schema[name];

      expect(attribute).toBeDefined();
      expect(attribute?.required).toBe(true);
      // Changing it is giving another grant: replaced, not changed in place.
      expect(attribute?.forceNew).toBe(true);
      expect(attribute?.relation?.name).toBe(relation);
    }

    // The project is the key's: optional, and read back.
    expect(grant.schema["project_id"]?.required).toBe(false);
    expect(grant.schema["project_id"]?.computed).toBe(true);
  });

  test("oneuptime_api_key_permission reads where a permission came from, and cannot set it", () => {
    const permission: TerraformResource = resource("api_key_permission");

    for (const name of [
      "custom_role_id",
      "api_key_custom_role_id",
      "custom_role_permission_id",
    ]) {
      const attribute: TerraformAttribute | undefined = permission.schema[name];

      expect(attribute).toBeDefined();
      expect(attribute?.computed).toBe(true);
      expect(attribute?.required).toBe(false);
      expect(attribute?.optional).toBe(false);
    }

    expect(permission.schema["api_key_custom_role_id"]?.relation?.name).toBe(
      "api_key_custom_role",
    );
  });
});
