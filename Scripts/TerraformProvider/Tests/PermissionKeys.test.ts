import fs from "fs";
import os from "os";
import path from "path";
import { DataSourceGenerator } from "../Core/DataSourceGenerator";
import { DocumentationGenerator } from "../Core/DocumentationGenerator";
import { OpenAPIParser } from "../Core/OpenAPIParser";
import { ResourceGenerator } from "../Core/ResourceGenerator";
import {
  OpenAPISpec,
  TerraformAttribute,
  TerraformDataSource,
  TerraformResource,
} from "../Core/Types";
import { providerGoFilePath } from "../Core/ProviderShards";

/*
 * A PERMISSION'S KEY (OneUptime#10300).
 *
 * A team's, an API key's and a custom role's permission is a permission's
 * key, such as IncidentMember. The spec documented it as an object, so the
 * provider made it a JSON attribute and its reference said to write it with
 * jsonencode(), which then failed every apply. Now the spec marks it
 * (x-oneuptime-type Permission) as the string it is, and the provider:
 *
 *   - takes the plain key, and still takes jsonencode()'s form of it as the
 *     same permission, from a configuration and from state
 *     (StaticFiles/permissionkey.go): a type that compares two values by the
 *     key they name, a plan modifier that keeps the state's form for the same
 *     key, a validator that refuses what names no key;
 *   - sends the key either form names;
 *   - keeps the attribute optional, as it always was, though a create must
 *     give one;
 *   - looks a row up by it in the data source, which reads the plain key;
 *   - writes it, as its key, in the reference's example.
 */

const ROLE_PERMISSION_DESCRIPTION: string =
  "A built-in role, such as IncidentMember, or a single permission, such as ReadProjectIncident.";

// A custom role's permission, as the spec writes one, and a JSON column beside it.
function buildPermissionSpec(): OpenAPISpec {
  const permission: any = {
    type: "string",
    example: "IncidentMember",
    "x-oneuptime-type": "Permission",
    description: `${ROLE_PERMISSION_DESCRIPTION} Permissions - Create: [Project Owner], Read: [Project Owner], Update: [Project Owner]`,
  };
  const writable: Record<string, any> = {
    customRoleId: {
      type: "string",
      format: "uuid",
      description: "ID of the custom role this permission is part of.",
    },
    permission: permission,
    settings: {
      type: "object",
      description: "Settings of the permission.",
      example: { key: "value" },
    },
  };
  const schemas: Record<string, any> = {
    CustomRolePermissionCreateSchema: {
      type: "object",
      required: ["customRoleId", "permission"],
      properties: writable,
    },
    CustomRolePermissionUpdateSchema: {
      type: "object",
      properties: { permission: permission, settings: writable["settings"] },
    },
    CustomRolePermission: {
      type: "object",
      properties: {
        _id: { type: "string", format: "uuid" },
        ...writable,
      },
    },
  };

  const reference: (name: string) => any = (name: string): any => {
    return { $ref: `#/components/schemas/${name}` };
  };
  const body: (name: string) => any = (name: string): any => {
    return {
      required: true,
      content: {
        "application/json": {
          schema: { type: "object", properties: { data: reference(name) } },
        },
      },
    };
  };
  const answer: any = {
    "200": {
      description: "Successful response",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: { data: reference("CustomRolePermission") },
          },
        },
      },
    },
  };
  const list: any = {
    "200": {
      description: "Successful response",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              data: {
                type: "array",
                items: reference("CustomRolePermission"),
              },
            },
          },
        },
      },
    },
  };
  const tag: string = "Custom Role Permission";
  const idParameter: any = {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  };

  return {
    openapi: "3.0.0",
    info: { title: "OneUptime", version: "1.0.0" },
    servers: [{ url: "https://oneuptime.com/api" }],
    tags: [{ name: tag, description: "The permissions in a custom role." }],
    paths: {
      "/custom-role-permission": {
        post: {
          operationId: "createCustomRolePermission",
          tags: [tag],
          requestBody: body("CustomRolePermissionCreateSchema"),
          responses: answer,
        } as any,
      },
      "/custom-role-permission/get-list": {
        post: {
          operationId: "listCustomRolePermission",
          tags: [tag],
          responses: list,
        } as any,
      },
      "/custom-role-permission/{id}/get-item": {
        post: {
          operationId: "getCustomRolePermission",
          tags: [tag],
          parameters: [idParameter],
          responses: answer,
        } as any,
      },
      "/custom-role-permission/{id}": {
        put: {
          operationId: "updateCustomRolePermission",
          tags: [tag],
          parameters: [idParameter],
          requestBody: body("CustomRolePermissionUpdateSchema"),
          responses: answer,
        } as any,
        delete: {
          operationId: "deleteCustomRolePermission",
          tags: [tag],
          parameters: [idParameter],
          responses: answer,
        } as any,
      },
    },
    components: { schemas: schemas },
  };
}

let outputDir: string;
let resource: TerraformResource;
let dataSource: TerraformDataSource;
let resourceGo: string;
let dataSourceGo: string;
let resourceDoc: string;
let dataSourceDoc: string;

function attributeBlock(source: string, attribute: string): string {
  const start: number = source.indexOf(`"${attribute}": schema.`);
  if (start === -1) {
    throw new Error(`no attribute ${attribute}`);
  }
  return source.substring(start, source.indexOf("\n            },\n", start));
}

function method(source: string, signature: string): string {
  const start: number = source.indexOf(signature);
  if (start === -1) {
    throw new Error(`no ${signature}`);
  }
  return source.substring(start, source.indexOf("\n}\n", start));
}

beforeAll(async () => {
  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(buildPermissionSpec());
  resource = parser.getResources()[0]!;
  dataSource = parser.getDataSources()[0]!;

  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-permission-"));
  const config: any = {
    outputDir,
    providerName: "oneuptime",
    providerVersion: "17.1.0",
    goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
  };
  await new ResourceGenerator(
    config,
    buildPermissionSpec(),
  ).generateResources();
  await new DataSourceGenerator(
    config,
    buildPermissionSpec(),
  ).generateDataSources();
  await new DocumentationGenerator(
    config,
    buildPermissionSpec(),
  ).generateDocumentation();

  const read: (file: string) => string = (file: string): string => {
    return fs.readFileSync(path.join(outputDir, file), "utf-8");
  };
  resourceGo = read(providerGoFilePath("resource_custom_role_permission.go"));
  dataSourceGo = read(
    providerGoFilePath("data_source_custom_role_permission.go"),
  );
  resourceDoc = read("docs/resources/custom_role_permission.md");
  dataSourceDoc = read("docs/data-sources/custom_role_permission.md");
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("a permission in the spec", () => {
  test("is a permission's key: a plain string, not JSON", () => {
    const attribute: TerraformAttribute | undefined =
      resource.schema["permission"];

    expect(attribute).toEqual(
      expect.objectContaining({
        type: "string",
        isPermission: true,
        example: "IncidentMember",
      }),
    );
    expect(attribute?.isComplexObject).toBeUndefined();
    expect(attribute?.enumValues).toBeUndefined();

    // A JSON column beside it is JSON, as it was.
    expect(resource.schema["settings"]?.isComplexObject).toBe(true);
    expect(resource.schema["settings"]?.isPermission).toBeUndefined();
  });

  test("is optional, as it has always been, though a create must give one", () => {
    expect(resource.schema["permission"]).toEqual(
      expect.objectContaining({
        required: false,
        optional: true,
        computed: true,
      }),
    );
    // What a create requires otherwise is required, as before.
    expect(resource.schema["custom_role_id"]?.required).toBe(true);
  });

  test("its reference says how it is written, and that jsonencode() still works", () => {
    const description: string =
      resource.schema["permission"]?.description || "";

    expect(description).toContain(ROLE_PERMISSION_DESCRIPTION);
    expect(description).toContain(OpenAPIParser.PERMISSION_DESCRIPTION);
    expect(description).not.toContain("A JSON value");
    expect(description).not.toContain("Permissions - Create");
  });

  test("is a lookup argument of the data source, which reads the plain key", () => {
    const attribute: TerraformAttribute | undefined =
      dataSource.schema["permission"];

    expect(attribute).toEqual(
      expect.objectContaining({
        type: "string",
        isLookupFilter: true,
        optional: true,
        computed: true,
      }),
    );
    expect(attribute?.isComplexObject).toBeUndefined();
    // Read, it is the key alone: nothing to say of jsonencode() or jsondecode().
    expect(attribute?.description).not.toContain("jsonencode");
    expect(attribute?.description).not.toContain("jsondecode");
  });
});

describe("the resource's permission", () => {
  test("is a PermissionKeyValue of PermissionKeyType", () => {
    expect(resourceGo).toContain(
      'Permission PermissionKeyValue `tfsdk:"permission"`',
    );

    const block: string = attributeBlock(resourceGo, "permission");
    expect(block).toContain("CustomType: PermissionKeyType{}");
    expect(block).not.toContain("JSONSubsetType");
    expect(attributeBlock(resourceGo, "settings")).toContain(
      "CustomType: JSONSubsetType{}",
    );
  });

  test("is optional and computed, never required", () => {
    const block: string = attributeBlock(resourceGo, "permission");

    expect(block).toContain("Optional: true");
    expect(block).toContain("Computed: true");
    expect(block).not.toContain("Required: true");
  });

  test("keeps the state's form for the same key, before UseStateForUnknown", () => {
    const block: string = attributeBlock(resourceGo, "permission");

    expect(block).toContain("PermissionKeepSameKey()");
    expect(block.indexOf("PermissionKeepSameKey()")).toBeLessThan(
      block.indexOf("stringplanmodifier.UseStateForUnknown()"),
    );
    expect(block).not.toContain("JSONSubsetKeepImported()");
  });

  test("refuses at plan time what names no key", () => {
    const block: string = attributeBlock(resourceGo, "permission");

    expect(block).toContain("Validators: []validator.String{");
    expect(block).toContain("PermissionKeyValidator()");
    expect(block).not.toContain("JSONEnvelopeValidator()");
    expect(block).not.toContain("stringvalidator.OneOf");
    expect(resourceGo).toContain(
      '"github.com/hashicorp/terraform-plugin-framework/schema/validator"',
    );
  });

  test("is sent as the key it names, by a create and by an update", () => {
    const send: string =
      'requestDataMap["permission"] = PermissionKeyOf(data.Permission.ValueString())';

    for (const signature of [
      "func (r *CustomRolePermissionResource) Create(",
      "func (r *CustomRolePermissionResource) Update(",
    ]) {
      const body: string = method(resourceGo, signature);

      expect([signature, body.includes(send)]).toEqual([signature, true]);
      expect(body).not.toContain("parseJSONField(data.Permission)");
      expect(body).not.toContain(
        "json.Unmarshal([]byte(data.Permission.ValueString())",
      );
    }
  });

  test("is read back as the key, into its own type", () => {
    for (const signature of [
      "func (r *CustomRolePermissionResource) Create(",
      "func (r *CustomRolePermissionResource) Read(",
      "func (r *CustomRolePermissionResource) Update(",
    ]) {
      const body: string = method(resourceGo, signature);

      expect([signature, body.includes("NewPermissionKeyValue(val)")]).toEqual([
        signature,
        true,
      ]);
      expect(body).toContain("data.Permission = NewPermissionKeyNull()");
      expect(body).not.toContain("data.Permission = NewJSONSubsetValue");
    }
  });

  test("is not held to what an import read, as a JSON value is", () => {
    const imported: Array<string> = new ResourceGenerator(
      {
        outputDir,
        providerName: "oneuptime",
        providerVersion: "17.1.0",
        goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
      } as any,
      buildPermissionSpec(),
    ).getImportedFromServerAttributes(resource);

    expect(imported).toEqual(["settings"]);
  });
});

describe("the data source's permission", () => {
  test("is a plain string it looks a row up by", () => {
    expect(dataSourceGo).toContain(
      'Permission types.String `tfsdk:"permission"`',
    );
    expect(dataSourceGo).toContain('filters["permission"]');
    expect(dataSourceGo).not.toContain("PermissionKeyValue");
  });
});

describe("the reference", () => {
  test("the example writes the permission, as its key", () => {
    const example: string = resourceDoc.substring(
      resourceDoc.indexOf("## Example Usage"),
      resourceDoc.indexOf("## Schema"),
    );

    expect(example).toContain(
      'resource "oneuptime_custom_role_permission" "example" {',
    );
    expect(example).toMatch(/\n {2}permission\s+= "IncidentMember"\n/);
    expect(example).not.toContain("jsonencode");
  });

  test("lists it as optional, saying how it is written", () => {
    const optional: string = resourceDoc.substring(
      resourceDoc.indexOf("### Optional"),
      resourceDoc.indexOf("### Read-Only"),
    );

    expect(optional).toContain("- `permission` (String)");
    expect(optional).toContain(OpenAPIParser.PERMISSION_DESCRIPTION);
    expect(resourceDoc).not.toContain(
      "A built-in role, such as IncidentMember, or a single permission, such as ReadProjectIncident. A JSON value",
    );
  });

  test("the data source's page looks a row up by it", () => {
    const optional: string = dataSourceDoc.substring(
      dataSourceDoc.indexOf("### Optional"),
      dataSourceDoc.indexOf("### Read-Only"),
    );
    const line: string | undefined = optional
      .split("\n")
      .find((candidate: string): boolean => {
        return candidate.startsWith("- `permission`");
      });

    expect(line).toBeDefined();
    expect(line).not.toContain("jsondecode");
    // The JSON column beside it is still read with jsondecode().
    expect(dataSourceDoc).toContain(
      "- `settings` (String) Settings of the permission. A JSON value: read it with `jsondecode()`.",
    );
  });
});
