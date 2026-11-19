import { beforeAll, describe, expect, test } from "@jest/globals";
import CustomRole from "../../../Models/DatabaseModels/CustomRole";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import { JSONObject } from "../../../Types/JSON";
import {
  WORKFLOWS_RUN_AS_INSTEAD_KEY,
  WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY,
} from "../../../Types/Workflow/WorkflowRunAs";
import { CUSTOM_ROLE_DELETE_CHOICES } from "../../../Utils/DeveloperDocs/DeleteChoices";
import {
  getTerraformDeleteChoiceAttributes,
  TerraformDeleteChoiceAttribute,
} from "../../../Utils/DeveloperDocs/TerraformSchema";
import { OpenAPIParser } from "../../../../../Scripts/TerraformProvider/Core/OpenAPIParser";
import {
  TerraformAttribute,
  TerraformResource,
} from "../../../../../Scripts/TerraformProvider/Core/Types";

/*
 * DELETING A CUSTOM ROLE THAT WORKFLOWS RUN AS, OUTSIDE THE DASHBOARD
 * (#9832). OneUptime deletes such a role only when the delete says what the
 * workflows run as instead, in the DELETE's miscDataProps. The API
 * reference documents it on the DELETE, and the Terraform provider - which
 * deleted every resource with no body, so `terraform destroy` of such a
 * role always failed - gives the resource an attribute for each choice,
 * sent with the delete and nothing else. Both are generated from the
 * models' metadata and DeleteChoices.ts; these read the real spec and the
 * real provider parser.
 */

let spec: JSONObject;
let providerResources: Array<TerraformResource>;

function operation(path: string, method: string): JSONObject {
  const paths: JSONObject = spec["paths"] as JSONObject;
  const found: JSONObject | undefined = (paths[path] as JSONObject)?.[
    method
  ] as JSONObject | undefined;

  expect(found).toBeDefined();

  return found!;
}

function deleteBodyOf(path: string): JSONObject | undefined {
  return operation(path, "delete")["requestBody"] as JSONObject | undefined;
}

function miscDataPropsOf(requestBody: JSONObject): JSONObject {
  return (
    (
      (
        (requestBody["content"] as JSONObject)["application/json"] as JSONObject
      )["schema"] as JSONObject
    )["properties"] as JSONObject
  )["miscDataProps"] as JSONObject;
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

describe("the API reference", () => {
  test("documents what a custom role's delete says besides the role", () => {
    const deleteRole: JSONObject = operation("/custom-role/{id}", "delete");
    const body: JSONObject | undefined = deleteBodyOf("/custom-role/{id}");

    expect(body).toBeDefined();
    // A delete that needs none of it sends none.
    expect(body!["required"]).toBe(false);
    expect(String(deleteRole["description"])).toContain(
      CUSTOM_ROLE_DELETE_CHOICES.whenNeeded,
    );

    const misc: JSONObject = miscDataPropsOf(body!);
    const properties: JSONObject = misc["properties"] as JSONObject;

    expect(Object.keys(properties)).toEqual([
      WORKFLOWS_RUN_AS_INSTEAD_KEY,
      WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY,
    ]);
  });

  test("workflowsRunAs is Default or CustomRole, never Project Owner", () => {
    const runAs: JSONObject = (
      miscDataPropsOf(deleteBodyOf("/custom-role/{id}")!)[
        "properties"
      ] as JSONObject
    )[WORKFLOWS_RUN_AS_INSTEAD_KEY] as JSONObject;

    expect(runAs["type"]).toBe("string");
    expect(runAs["enum"]).toEqual(["Default", "CustomRole"]);
    expect(String(runAs["description"])).toContain(
      "miscDataProps.workflowsRunAsCustomRoleId",
    );
    expect(String(runAs["description"])).toContain("Never Project Owner");
  });

  test("workflowsRunAsCustomRoleId is the ID of another custom role, with CustomRole", () => {
    const role: JSONObject = (
      miscDataPropsOf(deleteBodyOf("/custom-role/{id}")!)[
        "properties"
      ] as JSONObject
    )[WORKFLOWS_RUN_AS_INSTEAD_ROLE_KEY] as JSONObject;

    expect(role["type"]).toBe("string");
    expect(role["format"]).toBe("uuid");
    expect(role["enum"]).toBeUndefined();
    expect(role["x-oneuptime-relation"]).toEqual({
      tag: "Custom Role",
      tableName: "CustomRole",
    });
    expect(role["x-oneuptime-required-with"]).toEqual({
      key: WORKFLOWS_RUN_AS_INSTEAD_KEY,
      value: "CustomRole",
    });
  });

  test("no other delete documents a body: it names the record and nothing else", () => {
    const paths: JSONObject = spec["paths"] as JSONObject;
    const withBody: Array<string> = Object.entries(paths)
      .filter(([, item]: [string, unknown]): boolean => {
        const deleteOperation: JSONObject | undefined = (item as JSONObject)[
          "delete"
        ] as JSONObject | undefined;

        return Boolean(deleteOperation?.["requestBody"]);
      })
      .map(([path]: [string, unknown]): string => {
        return path;
      });

    expect(withBody).toEqual(["/custom-role/{id}"]);
  });
});

describe("Terraform", () => {
  test("oneuptime_custom_role says what its workflows run as when it is deleted", () => {
    const customRole: TerraformResource = resource("custom_role");

    expect(customRole.deleteChoices).toEqual({
      noun: "custom role",
      whenNeeded: CUSTOM_ROLE_DELETE_CHOICES.whenNeeded,
      attributes: [
        "workflows_run_as_on_delete",
        "workflows_run_as_custom_role_id_on_delete",
      ],
    });
  });

  test("each choice is optional, never computed, and sent by no create, update or read", () => {
    const customRole: TerraformResource = resource("custom_role");

    for (const name of customRole.deleteChoices!.attributes) {
      const attribute: TerraformAttribute = customRole.schema[name]!;

      expect({ name, optional: attribute.optional }).toEqual({
        name,
        optional: true,
      });
      expect(Boolean(attribute.required)).toBe(false);
      expect(Boolean(attribute.computed)).toBe(false);
      expect(attribute.default).toBeUndefined();

      for (const schema of [
        customRole.operationSchemas?.create,
        customRole.operationSchemas?.update,
        customRole.operationSchemas?.read,
      ]) {
        expect(Object.keys(schema || {})).not.toContain(name);
      }

      expect(attribute.description).toContain(
        "Sent only when Terraform deletes the custom role, and changes nothing before: set it, and apply, before you destroy the custom role.",
      );
    }
  });

  test("workflows_run_as_on_delete takes Default or CustomRole", () => {
    const attribute: TerraformAttribute =
      resource("custom_role").schema["workflows_run_as_on_delete"]!;

    expect(attribute.type).toBe("string");
    expect(attribute.enumValues).toEqual(["Default", "CustomRole"]);
    expect(attribute.deleteChoice).toEqual({ key: "workflowsRunAs" });
    expect(attribute.description).toContain(
      "named in `workflows_run_as_custom_role_id_on_delete`",
    );
  });

  test("workflows_run_as_custom_role_id_on_delete is a custom role's ID, with CustomRole", () => {
    const attribute: TerraformAttribute =
      resource("custom_role").schema[
        "workflows_run_as_custom_role_id_on_delete"
      ]!;

    expect(attribute.type).toBe("string");
    expect(attribute.enumValues).toBeUndefined();
    expect(attribute.relation).toEqual({ name: "custom_role", isList: false });
    expect(attribute.deleteChoice).toEqual({
      key: "workflowsRunAsCustomRoleId",
      requiredWith: {
        attribute: "workflows_run_as_on_delete",
        value: "CustomRole",
      },
    });
    expect(attribute.description).toContain(
      "The ID of a `oneuptime_custom_role`.",
    );
  });

  test("no other resource's delete takes a choice", () => {
    expect(
      providerResources
        .filter((candidate: TerraformResource): boolean => {
          return Boolean(candidate.deleteChoices);
        })
        .map((candidate: TerraformResource): string => {
          return candidate.name;
        }),
    ).toEqual(["custom_role"]);

    for (const candidate of providerResources) {
      for (const [name, attribute] of Object.entries(candidate.schema)) {
        if (attribute.deleteChoice) {
          expect({ resource: candidate.name, name }).toEqual({
            resource: "custom_role",
            name,
          });
        }
      }
    }
  });

  test("the dashboard's Terraform pages know the same attributes", () => {
    expect(
      getTerraformDeleteChoiceAttributes(CustomRole).map(
        (choice: TerraformDeleteChoiceAttribute): string => {
          return choice.attributeName;
        },
      ),
    ).toEqual(resource("custom_role").deleteChoices!.attributes);
  });
});
