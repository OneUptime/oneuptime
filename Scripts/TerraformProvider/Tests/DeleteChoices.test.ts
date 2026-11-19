import fs from "fs";
import os from "os";
import path from "path";
import { DocumentationGenerator } from "../Core/DocumentationGenerator";
import { OpenAPIParser } from "../Core/OpenAPIParser";
import { ResourceGenerator } from "../Core/ResourceGenerator";
import {
  OpenAPISpec,
  TerraformAttribute,
  TerraformResource,
} from "../Core/Types";
import { CUSTOM_ROLE_DELETE_CHOICES } from "Common/Utils/DeveloperDocs/DeleteChoices";

/*
 * WHAT A DELETE SAYS BESIDES THE RECORD (#9832). OneUptime deletes a custom
 * role that workflows run as only when the delete says what they run as
 * instead, in the DELETE's miscDataProps (Common/Utils/DeveloperDocs
 * /DeleteChoices.ts). The provider deleted every resource with no body, so
 * `terraform destroy` of such a role always failed. Now:
 *
 *   - the parser gives oneuptime_custom_role an optional attribute for each
 *     choice, named for the delete - workflows_run_as_on_delete and
 *     workflows_run_as_custom_role_id_on_delete - only ever in `schema`;
 *   - the resource validates them at plan time (Default or CustomRole; a
 *     custom role's ID, given only and always with CustomRole), never sends
 *     them in a create or an update, never selects them, and sends what
 *     state holds in the DELETE's body;
 *   - a refusal for a choice none was given says how to give it in
 *     Terraform;
 *   - its page says how, with whole examples, and that the value is
 *     applied before the destroy;
 *   - nothing else changes for any other resource: its delete has no body.
 */

const ref: (name: string) => any = (name: string): any => {
  return { $ref: `#/components/schemas/${name}` };
};

const body: (name: string) => any = (name: string): any => {
  return {
    content: {
      "application/json": {
        schema: { type: "object", properties: { data: ref(name) } },
      },
    },
  };
};

const answer: (name: string) => any = (name: string): any => {
  return {
    "200": {
      description: "ok",
      content: {
        "application/json": {
          schema: { type: "object", properties: { data: ref(name) } },
        },
      },
    },
  };
};

const idParameter: any = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
};

// The CRUD paths of one model, its delete with no body unless given one.
function crud(data: {
  path: string;
  table: string;
  tag: string;
  withDelete?: boolean;
}): Record<string, any> {
  return {
    [data.path]: {
      post: {
        operationId: `create${data.table}`,
        tags: [data.tag],
        requestBody: body(`${data.table}CreateSchema`),
        responses: answer(`${data.table}ReadSchema`),
      },
    },
    [`${data.path}/{id}/get-item`]: {
      post: {
        operationId: `get${data.table}`,
        tags: [data.tag],
        parameters: [idParameter],
        responses: answer(`${data.table}ReadSchema`),
      },
    },
    [`${data.path}/{id}`]: {
      put: {
        operationId: `update${data.table}`,
        tags: [data.tag],
        parameters: [idParameter],
        requestBody: body(`${data.table}UpdateSchema`),
        responses: answer(`${data.table}ReadSchema`),
      },
      ...(data.withDelete === false
        ? {}
        : {
            delete: {
              operationId: `delete${data.table}`,
              tags: [data.tag],
              parameters: [idParameter],
              responses: { "200": { description: "Deleted successfully" } },
            },
          }),
    },
  };
}

function schemas(table: string): Record<string, any> {
  const writable: Record<string, any> = {
    name: { type: "string", description: "What it is called." },
    description: { type: "string", description: "What it is for." },
  };

  return {
    [`${table}CreateSchema`]: {
      type: "object",
      required: ["name"],
      properties: writable,
    },
    [`${table}UpdateSchema`]: { type: "object", properties: writable },
    [`${table}ReadSchema`]: {
      type: "object",
      properties: {
        _id: { type: "string" },
        ...writable,
        slug: { type: "string", readOnly: true, description: "Its slug." },
      },
    },
  };
}

function buildSpec(data?: { customRoleDelete?: boolean }): OpenAPISpec {
  return {
    openapi: "3.0.0",
    info: { title: "OneUptime", version: "1.0.0" },
    servers: [{ url: "https://oneuptime.com/api" }],
    tags: [
      {
        name: "Custom Role",
        description: "A set of permissions you name once.",
        "x-oneuptime-table": "CustomRole",
      },
      {
        name: "Label",
        description: "A label.",
        "x-oneuptime-table": "Label",
      },
    ],
    paths: {
      ...crud({
        path: "/custom-role",
        table: "CustomRole",
        tag: "Custom Role",
        withDelete: data?.customRoleDelete !== false,
      }),
      ...crud({ path: "/label", table: "Label", tag: "Label" }),
    },
    components: {
      schemas: { ...schemas("CustomRole"), ...schemas("Label") },
    },
  };
}

const RUN_AS: string = "workflows_run_as_on_delete";
const RUN_AS_ROLE: string = "workflows_run_as_custom_role_id_on_delete";

let customRole: TerraformResource;
let label: TerraformResource;
let outputDir: string;
let customRoleGo: string;
let labelGo: string;
let customRoleDoc: string;

function resourceNamed(
  resources: Array<TerraformResource>,
  name: string,
): TerraformResource {
  const found: TerraformResource | undefined = resources.find(
    (candidate: TerraformResource): boolean => {
      return candidate.name === name;
    },
  );

  if (!found) {
    throw new Error(`no resource ${name}`);
  }

  return found;
}

// One attribute's schema in the generated Go.
function block(source: string, attribute: string): string {
  const start: number = source.indexOf(`"${attribute}": schema.`);

  if (start === -1) {
    throw new Error(`no attribute ${attribute}`);
  }

  return source.substring(start, source.indexOf("\n            },\n", start));
}

// One method of a generated resource, from its signature to the next one.
function method(source: string, typeName: string, name: string): string {
  const start: number = source.indexOf(`func (r *${typeName}) ${name}(`);

  if (start === -1) {
    throw new Error(`no ${name} method`);
  }

  const next: number = source.indexOf("\nfunc ", start + 1);

  return source.substring(start, next === -1 ? undefined : next);
}

// The page's Deleting it section: from its anchor to the next "## ".
function deletingSection(page: string): string {
  const start: number = page.indexOf(
    '<a id="deleting-it"></a>\n## Deleting it',
  );

  if (start === -1) {
    throw new Error("no Deleting it section");
  }

  const next: number = page.indexOf("\n## ", start + 30);

  return page.substring(start, next === -1 ? undefined : next);
}

beforeAll(async () => {
  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(buildSpec());
  const resources: Array<TerraformResource> = parser.getResources();
  customRole = resourceNamed(resources, "custom_role");
  label = resourceNamed(resources, "label");

  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-delete-choices-"));
  const config: any = {
    outputDir,
    providerName: "oneuptime",
    providerVersion: "17.0.0",
    goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
  };
  await new ResourceGenerator(config, buildSpec()).generateResources();
  await new DocumentationGenerator(config, buildSpec()).generateDocumentation();

  customRoleGo = fs.readFileSync(
    path.join(outputDir, "internal/provider/resource_custom_role.go"),
    "utf-8",
  );
  labelGo = fs.readFileSync(
    path.join(outputDir, "internal/provider/resource_label.go"),
    "utf-8",
  );
  customRoleDoc = fs.readFileSync(
    path.join(outputDir, "docs/resources/custom_role.md"),
    "utf-8",
  );
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("the parser", () => {
  test("gives a custom role an attribute for each choice its delete takes", () => {
    expect(customRole.deleteChoices).toEqual({
      noun: "custom role",
      whenNeeded: CUSTOM_ROLE_DELETE_CHOICES.whenNeeded,
      attributes: [RUN_AS, RUN_AS_ROLE],
    });
    expect(OpenAPIParser.getDeleteChoiceAttribute("workflowsRunAs")).toBe(
      RUN_AS,
    );
    expect(
      OpenAPIParser.getDeleteChoiceAttribute("workflowsRunAsCustomRoleId"),
    ).toBe(RUN_AS_ROLE);
  });

  test("each is optional alone: no default, never computed, never required", () => {
    for (const name of [RUN_AS, RUN_AS_ROLE]) {
      const attribute: TerraformAttribute = customRole.schema[name]!;

      expect({
        name,
        type: attribute.type,
        optional: attribute.optional,
        computed: attribute.computed,
        required: attribute.required,
        default: attribute.default,
      }).toEqual({
        name,
        type: "string",
        optional: true,
        computed: false,
        required: false,
        default: undefined,
      });
    }
  });

  test("none is in a create, an update or a read: only the delete sends it", () => {
    for (const name of [RUN_AS, RUN_AS_ROLE]) {
      for (const schema of [
        customRole.operationSchemas?.create,
        customRole.operationSchemas?.update,
        customRole.operationSchemas?.read,
      ]) {
        expect(Object.keys(schema || {})).not.toContain(name);
      }
    }
  });

  test("workflows_run_as_on_delete takes Default or CustomRole, and names the other attribute", () => {
    const attribute: TerraformAttribute = customRole.schema[RUN_AS]!;

    expect(attribute.enumValues).toEqual(["Default", "CustomRole"]);
    expect(attribute.deleteChoice).toEqual({ key: "workflowsRunAs" });
    expect(attribute.description).toBe(
      `What the workflows that run as this custom role run as once it is deleted: "Default", the default permissions, or "CustomRole", another custom role you could give a team, named in \`${RUN_AS_ROLE}\`. Never Project Owner: deleting a role never raises what a workflow can do. ${OpenAPIParser.getDeleteChoiceSentNote("custom role")}`,
    );
  });

  test("workflows_run_as_custom_role_id_on_delete is a custom role's ID, given only and always with CustomRole", () => {
    const attribute: TerraformAttribute = customRole.schema[RUN_AS_ROLE]!;

    expect(attribute.enumValues).toBeUndefined();
    expect(attribute.relation).toEqual({ name: "custom_role", isList: false });
    expect(attribute.deleteChoice).toEqual({
      key: "workflowsRunAsCustomRoleId",
      requiredWith: { attribute: RUN_AS, value: "CustomRole" },
    });
    expect(attribute.description).toBe(
      `The ID of the other custom role the workflows run as, when \`${RUN_AS}\` is "CustomRole": one you could give a team, and not the role being deleted. The ID of a \`oneuptime_custom_role\`. ${OpenAPIParser.getDeleteChoiceSentNote("custom role")}`,
    );
  });

  test("a resource whose delete takes nothing gets nothing", () => {
    expect(label.deleteChoices).toBeUndefined();
    for (const [name, attribute] of Object.entries(label.schema)) {
      expect({ name, choice: attribute.deleteChoice }).toEqual({
        name,
        choice: undefined,
      });
    }
  });

  test("a custom role the API cannot delete gets nothing either", () => {
    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(buildSpec({ customRoleDelete: false }));
    const undeletable: TerraformResource = resourceNamed(
      parser.getResources(),
      "custom_role",
    );

    expect(undeletable.deleteChoices).toBeUndefined();
    expect(undeletable.schema[RUN_AS]).toBeUndefined();
  });

  test("an attribute of the record with a choice's name stops generation", () => {
    const spec: OpenAPISpec = buildSpec();
    const readSchema: any = (spec.components!.schemas as any)[
      "CustomRoleReadSchema"
    ];
    readSchema.properties.workflowsRunAsOnDelete = {
      type: "string",
      description: "A column that happens to have the name.",
    };

    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(spec);

    expect(() => {
      return parser.getResources();
    }).toThrow(/workflows_run_as_on_delete/);
  });
});

describe("the generated resource", () => {
  test("holds each choice as a string of its own", () => {
    expect(customRoleGo).toContain(
      'WorkflowsRunAsOnDelete types.String `tfsdk:"workflows_run_as_on_delete"`',
    );
    expect(customRoleGo).toContain(
      'WorkflowsRunAsCustomRoleIdOnDelete types.String `tfsdk:"workflows_run_as_custom_role_id_on_delete"`',
    );
  });

  test("refuses at plan time what OneUptime would refuse at the delete", () => {
    const runAs: string = block(customRoleGo, RUN_AS);

    expect(runAs).toContain("Optional: true");
    expect(runAs).not.toContain("Computed: true");
    expect(runAs).not.toContain("Default:");
    expect(runAs).toContain('stringvalidator.OneOf("Default", "CustomRole")');

    const role: string = block(customRoleGo, RUN_AS_ROLE);

    expect(role).toContain("Optional: true");
    expect(role).not.toContain("Computed: true");
    // A custom role's ID, and only with workflows_run_as_on_delete = "CustomRole".
    expect(role).toContain(
      `Validators: append(recordIDValidators("oneuptime_custom_role"), deleteChoiceRequiredWith("${RUN_AS}", "CustomRole"))`,
    );
  });

  test("no create or update sends a choice, and no read selects one", () => {
    for (const name of ["Create", "Read", "Update"]) {
      const code: string = method(customRoleGo, "CustomRoleResource", name);

      expect({ name, sends: code.includes('"workflowsRunAs') }).toEqual({
        name,
        sends: false,
      });
    }
  });

  test("the delete sends what state holds, in the DELETE's body", () => {
    const code: string = method(customRoleGo, "CustomRoleResource", "Delete");

    expect(code).toContain("deleteChoices := []deleteChoice{");
    expect(code).toContain(
      `{key: "workflowsRunAs", attribute: "${RUN_AS}", value: data.WorkflowsRunAsOnDelete},`,
    );
    expect(code).toContain(
      `{key: "workflowsRunAsCustomRoleId", attribute: "${RUN_AS_ROLE}", value: data.WorkflowsRunAsCustomRoleIdOnDelete},`,
    );
    expect(code).toContain(
      'r.client.DeleteWithBody(ctx, "/custom-role/" + data.Id.ValueString() + "", deleteChoicesBody(deleteChoices))',
    );
    expect(code).not.toContain("r.client.Delete(ctx");
  });

  test("a refusal for a choice none was given says how to give it in Terraform", () => {
    const code: string = method(customRoleGo, "CustomRoleResource", "Delete");
    const hint: string = new ResourceGenerator(
      {
        outputDir,
        providerName: "oneuptime",
        providerVersion: "17.0.0",
        goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
      },
      buildSpec(),
    ).getDeleteChoicesHint(customRole);

    expect(hint).toBe(
      `To say it in Terraform, set ${RUN_AS} on this oneuptime_custom_role - with ${RUN_AS_ROLE} when ${RUN_AS} is "CustomRole" - and run terraform apply, then destroy it again: Terraform deletes a resource with what its state holds.`,
    );
    expect(code).toContain(
      `fmt.Sprintf("Unable to delete custom_role: %s%s", err, deleteChoicesHint(err, deleteChoices, "To say it in Terraform, set ${RUN_AS} on this oneuptime_custom_role - with ${RUN_AS_ROLE} when ${RUN_AS} is \\"CustomRole\\" - and run terraform apply, then destroy it again: Terraform deletes a resource with what its state holds."))`,
    );
    // A failed delete keeps the resource in state.
    expect(code).toContain("return\n    }");
  });

  test("any other resource is deleted as before, with no body", () => {
    const code: string = method(labelGo, "LabelResource", "Delete");

    expect(code).toContain(
      'r.client.Delete(ctx, "/label/" + data.Id.ValueString() + "")',
    );
    expect(code).not.toContain("deleteChoice");
    expect(code).toContain('fmt.Sprintf("Unable to delete label: %s", err)');
  });

  test("the helpers and their tests ship beside the resources", () => {
    for (const file of [
      "deletechoices.go",
      "deletechoices_test.go",
      // Through a real Terraform against a real OneUptime, with TF_ACC.
      "acceptance_custom_role_test.go",
    ]) {
      expect(
        fs.existsSync(path.join(outputDir, "internal/provider", file)),
      ).toBe(true);
    }
  });
});

describe("the resource's page", () => {
  test("says when its delete needs a choice, and which attribute says it", () => {
    const section: string = deletingSection(customRoleDoc);

    expect(section).toContain(
      `${CUSTOM_ROLE_DELETE_CHOICES.whenNeeded} In Terraform, \`${RUN_AS}\` says it:`,
    );
  });

  test("shows each way whole: Default, and another custom role", () => {
    const section: string = deletingSection(customRoleDoc);

    expect(section).toContain(`resource "oneuptime_custom_role" "example" {
  name = "Example custom role"

  ${RUN_AS} = "Default"
}`);
    expect(section).toContain(`resource "oneuptime_custom_role" "example" {
  name = "Example custom role"

  ${RUN_AS}                = "CustomRole"
  ${RUN_AS_ROLE} = oneuptime_custom_role.other.id
}`);
  });

  test("says to apply before the destroy, and that nothing is sent until then", () => {
    const section: string = deletingSection(customRoleDoc);

    expect(section).toContain(
      "- Set it, and run `terraform apply`, before you destroy the custom role or remove its block. Terraform deletes a resource with what its state holds, so a value set in the same apply that deletes or replaces the custom role is not sent yet.",
    );
    expect(section).toContain(
      "- Nothing is sent until the delete: setting or changing it never changes the custom role or anything that depends on it.",
    );
    expect(section).toContain(
      "- Left unset, the delete says nothing more, as before. When OneUptime needs it, the destroy is refused, the custom role stays in state, and the error says what to set.",
    );
  });

  test("says an import leaves it unset, and what the next plan does about it", () => {
    expect(deletingSection(customRoleDoc)).toContain(
      "- OneUptime keeps none of it, so an import leaves it unset: the first plan after an import sets it in state, and changes nothing in OneUptime.",
    );
  });

  test("says what a destroy of both roles does, since one names the other", () => {
    expect(deletingSection(customRoleDoc)).toContain(
      `- When this custom role and the one in \`${RUN_AS_ROLE}\` are destroyed together, Terraform deletes this one first, since it refers to the other, and what depended on it moves to the other custom role. Give that custom role its own \`${RUN_AS}\` too, or its delete is refused.`,
    );
  });

  test("each choice's line links to the section", () => {
    for (const name of [RUN_AS, RUN_AS_ROLE]) {
      const line: string | undefined = customRoleDoc
        .split("\n")
        .find((candidate: string): boolean => {
          return candidate.startsWith(`- \`${name}\``);
        });

      expect(line).toBeDefined();
      expect(line).toContain("See [Deleting it](#deleting-it).");
    }
  });

  test("the section comes before the schema, and the main example is unchanged", () => {
    expect(customRoleDoc.indexOf("## Deleting it")).toBeGreaterThan(
      customRoleDoc.indexOf("## Example Usage"),
    );
    expect(customRoleDoc.indexOf("## Deleting it")).toBeLessThan(
      customRoleDoc.indexOf("## Schema"),
    );

    const example: string = customRoleDoc.substring(
      customRoleDoc.indexOf("## Example Usage"),
      customRoleDoc.indexOf("## Deleting it"),
    );

    expect(example).not.toContain(RUN_AS);
  });

  test("a page whose delete takes nothing has no such section", () => {
    const labelDoc: string = fs.readFileSync(
      path.join(outputDir, "docs/resources/label.md"),
      "utf-8",
    );

    expect(labelDoc).not.toContain("Deleting it");
  });
});
