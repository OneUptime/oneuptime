import fs from "fs";
import os from "os";
import path from "path";
import { OpenAPIParser } from "../Core/OpenAPIParser";
import { ResourceGenerator } from "../Core/ResourceGenerator";
import { DocumentationGenerator } from "../Core/DocumentationGenerator";
import {
  OpenAPISpec,
  TerraformAttribute,
  TerraformResource,
} from "../Core/Types";
import { providerGoFilePath } from "../Core/ProviderShards";

/*
 * AN ATTRIBUTE THAT CHANGES ONLY TOGETHER WITH A NEW VALUE OF ANOTHER (#9814).
 *
 * A monitor secret's secretType changes only in the same write as a new
 * secretValue: OneUptime reads the value for the new type, and refuses a
 * type sent alone (#9760). The spec says so (x-oneuptime-changes-only-with).
 * The provider's Update sends only what changed between state and plan, so
 * a plan that changed secret_type and kept secret_value used to send the
 * type alone and fail half-way through the apply. Now:
 *
 *   - the parser names the companion by its Terraform name, and the
 *     attribute's documentation says a plan that changes it alone fails;
 *   - the resource's ModifyPlan refuses that plan, before anything is
 *     written (RequireChangedTogether, StaticFiles/changestogether.go);
 *   - the type still changes in place - no RequiresReplace - and the Update
 *     sends both when both change;
 *   - a declaration that cannot be kept (a companion the resource has not,
 *     or one no update writes) is dropped, with a warning.
 *
 * The refusal itself, and type-only, value-only and type-and-value changes
 * through the real protocol server, are tested in Go
 * (StaticFiles/changestogether_test.go, changestogether_plan_test.go).
 */

interface SpecOptions {
  // What secretType says it changes together with.
  changesOnlyWith?: string | undefined;
  // Whether an update may write secretValue.
  valueInUpdate?: boolean | undefined;
  // Whether an update may write secretType.
  typeInUpdate?: boolean | undefined;
}

function buildSpec(options: SpecOptions = {}): OpenAPISpec {
  const changesOnlyWith: string | undefined =
    "changesOnlyWith" in options ? options.changesOnlyWith : "secretValue";

  const secretType: any = {
    type: "string",
    enum: ["Text", "TOTP"],
    default: "Text",
    description:
      "What the secret holds. Changes only together with a new Secret Value, which is read for the new type.",
    ...(changesOnlyWith
      ? { "x-oneuptime-changes-only-with": changesOnlyWith }
      : {}),
  };
  const secretValue: any = {
    type: "string",
    format: "password",
    "x-oneuptime-secret": true,
    description: "Secret value that you want to store in this object.",
  };
  const name: any = { type: "string", description: "Any friendly name." };

  const create: Record<string, any> = {
    name,
    secretType,
    secretValue,
  };
  const update: Record<string, any> = {
    name,
    ...(options.typeInUpdate === false ? {} : { secretType }),
    ...(options.valueInUpdate === false ? {} : { secretValue }),
  };
  // Nobody may read the value: no read holds it.
  const read: Record<string, any> = {
    _id: { type: "string" },
    name,
    secretType,
  };

  const ref: (schema: string) => any = (schema: string): any => {
    return { $ref: `#/components/schemas/${schema}` };
  };
  const body: (schema: string) => any = (schema: string): any => {
    return {
      content: {
        "application/json": {
          schema: { type: "object", properties: { data: ref(schema) } },
        },
      },
    };
  };
  const answer: (schema: string) => any = (schema: string): any => {
    return {
      "200": {
        description: "ok",
        content: {
          "application/json": {
            schema: { type: "object", properties: { data: ref(schema) } },
          },
        },
      },
    };
  };
  const id: any = {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string" },
  };

  const paths: Record<string, any> = {
    "/monitor-secret": {
      post: {
        operationId: "createMonitorSecret",
        tags: ["Monitor Secret"],
        requestBody: body("MonitorSecretCreateSchema"),
        responses: answer("MonitorSecret"),
      },
    },
    "/monitor-secret/{id}/get-item": {
      post: {
        operationId: "getMonitorSecret",
        tags: ["Monitor Secret"],
        parameters: [id],
        responses: answer("MonitorSecret"),
      },
    },
    "/monitor-secret/{id}": {
      put: {
        operationId: "updateMonitorSecret",
        tags: ["Monitor Secret"],
        parameters: [id],
        requestBody: body("MonitorSecretUpdateSchema"),
        responses: answer("MonitorSecret"),
      },
      delete: {
        operationId: "deleteMonitorSecret",
        tags: ["Monitor Secret"],
        parameters: [id],
        responses: answer("MonitorSecret"),
      },
    },
  };

  return {
    openapi: "3.0.0",
    info: { title: "OneUptime", version: "1.0.0" },
    servers: [{ url: "https://oneuptime.com/api" }],
    tags: [
      {
        name: "Monitor Secret",
        description: "A secret variable that can be used in monitors.",
      },
    ],
    paths: paths,
    components: {
      schemas: {
        MonitorSecretCreateSchema: {
          type: "object",
          required: ["name"],
          properties: create,
        },
        MonitorSecretUpdateSchema: { type: "object", properties: update },
        MonitorSecret: { type: "object", properties: read },
      },
    },
  };
}

function parse(options: SpecOptions = {}): {
  resource: TerraformResource;
  warnings: Array<string>;
} {
  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(buildSpec(options));

  return {
    resource: parser.getResources()[0]!,
    warnings: parser.warnings,
  };
}

const NOTE: string = OpenAPIParser.describeChangesOnlyWith(
  "secret_type",
  "secret_value",
);

let outputDir: string;
let resourceGo: string;
let plainResourceGo: string;
let docs: string;

async function generate(options: SpecOptions, dir: string): Promise<string> {
  const config: any = {
    outputDir: dir,
    providerName: "oneuptime",
    providerVersion: "17.1.0",
    goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
  };
  await new ResourceGenerator(config, buildSpec(options)).generateResources();

  return fs.readFileSync(
    path.join(dir, providerGoFilePath("resource_monitor_secret.go")),
    "utf-8",
  );
}

// One method of the generated resource, from its comment to the next one.
function method(source: string, name: string): string {
  const start: number = source.indexOf(
    `func (r *MonitorSecretResource) ${name}(`,
  );

  if (start === -1) {
    throw new Error(`no ${name} method`);
  }

  const commentStart: number = source.lastIndexOf("\n\n", start);
  const next: number = source.indexOf("\nfunc ", start + 1);

  return source.substring(commentStart, next === -1 ? undefined : next);
}

function block(source: string, attribute: string): string {
  const start: number = source.indexOf(`"${attribute}": schema.`);

  if (start === -1) {
    throw new Error(`no attribute ${attribute}`);
  }

  return source.substring(start, source.indexOf("\n            },\n", start));
}

beforeAll(async () => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-changes-with-"));
  resourceGo = await generate({}, path.join(outputDir, "declared"));
  plainResourceGo = await generate(
    { changesOnlyWith: undefined },
    path.join(outputDir, "plain"),
  );

  const docsDir: string = path.join(outputDir, "docs");
  await new DocumentationGenerator(
    {
      outputDir: docsDir,
      providerName: "oneuptime",
      providerVersion: "17.1.0",
      goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
    } as any,
    buildSpec(),
  ).generateDocumentation();
  docs = fs.readFileSync(
    path.join(docsDir, "docs/resources/monitor_secret.md"),
    "utf-8",
  );
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("the parser", () => {
  test("names the companion by its Terraform name", () => {
    const { resource, warnings } = parse();

    expect(resource.schema["secret_type"]?.changesOnlyWith).toBe(
      "secret_value",
    );
    expect(warnings).toEqual([]);
  });

  test("declares nothing else", () => {
    const { resource } = parse();

    for (const [name, attribute] of Object.entries(resource.schema)) {
      if (name !== "secret_type") {
        expect([name, attribute.changesOnlyWith]).toEqual([name, undefined]);
      }
    }
  });

  test("the type still changes in place, and the value stays a write-only secret", () => {
    const { resource } = parse();
    const secretType: TerraformAttribute = resource.schema["secret_type"]!;
    const secretValue: TerraformAttribute = resource.schema["secret_value"]!;

    expect(secretType.forceNew).toBe(false);
    expect(secretType.enumValues).toEqual(["Text", "TOTP"]);
    expect(secretValue.forceNew).toBe(false);
    expect(secretValue.sensitive).toBe(true);
    expect(secretValue.computed).toBe(false);
    expect(secretValue.optional).toBe(true);
  });

  test("says in the attribute's documentation that a plan changing it alone fails", () => {
    const { resource } = parse();

    expect(NOTE).toBe(
      "A plan that changes `secret_type` and keeps `secret_value` fails before anything is written: give `secret_value` its new value in the same change.",
    );
    expect(resource.schema["secret_type"]?.description).toBe(
      `What the secret holds. Changes only together with a new Secret Value, which is read for the new type. ${NOTE}`,
    );
    expect(resource.schema["secret_value"]?.description).not.toContain(NOTE);
  });

  test("a resource without the declaration says nothing of it", () => {
    const { resource, warnings } = parse({ changesOnlyWith: undefined });

    expect(resource.schema["secret_type"]?.changesOnlyWith).toBeUndefined();
    expect(resource.schema["secret_type"]?.description).not.toContain(NOTE);
    expect(warnings).toEqual([]);
  });

  test.each([
    [
      "a companion the resource has not",
      { changesOnlyWith: "secretText" },
      "monitor_secret.secret_type changes only together with secretText, but an update cannot write both, so the plan does not check them together.",
    ],
    [
      "a companion no update writes",
      { valueInUpdate: false },
      "monitor_secret.secret_type changes only together with secretValue, but an update cannot write both, so the plan does not check them together.",
    ],
    [
      "an attribute no update writes, which is replaced instead",
      { typeInUpdate: false },
      "monitor_secret.secret_type changes only together with secretValue, but an update cannot write both, so the plan does not check them together.",
    ],
  ])(
    "drops a declaration it cannot keep, with a warning: %s",
    (_label: string, options: SpecOptions, warning: string) => {
      const { resource, warnings } = parse(options);

      expect(resource.schema["secret_type"]?.changesOnlyWith).toBeUndefined();
      expect(resource.schema["secret_type"]?.description).not.toContain(NOTE);
      expect(warnings).toContain(warning);
    },
  );

  test("the companion's own schema entries keep the API's name, so the update still sends it", () => {
    const { resource } = parse();

    expect(resource.schema["secret_value"]?.apiFieldName).toBe("secretValue");
    expect(resource.schema["secret_type"]?.apiFieldName).toBe("secretType");
  });
});

describe("the generated resource", () => {
  test("ModifyPlan refuses a type changed alone, before it keeps an unchanged plan", () => {
    const modifyPlan: string = method(resourceGo, "ModifyPlan");
    const refusal: number = modifyPlan.indexOf(
      'RequireChangedTogether(ctx, req, resp, "secret_type", "secret_value")',
    );

    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(
      modifyPlan.indexOf("KeepStateWhenNothingChanges(ctx, req, resp)"),
    );
    // After a destroy has returned: there is nothing to plan then.
    expect(refusal).toBeGreaterThan(
      modifyPlan.indexOf("if req.Plan.Raw.IsNull()"),
    );
    // Once.
    expect(modifyPlan.split("RequireChangedTogether(").length).toBe(2);
    expect(modifyPlan).toContain(
      "// It refuses a plan that changes secret_type and keeps secret_value (see\n// changestogether.go).",
    );
  });

  test("a resource without the declaration refuses nothing, and its ModifyPlan is as it was", () => {
    expect(plainResourceGo).not.toContain("RequireChangedTogether");
    expect(plainResourceGo).not.toContain("changestogether.go");
    expect(method(plainResourceGo, "ModifyPlan")).toBe(
      method(resourceGo, "ModifyPlan")
        .replace(
          '\n    RequireChangedTogether(ctx, req, resp, "secret_type", "secret_value")\n',
          "",
        )
        .replace(
          "\n// It refuses a plan that changes secret_type and keeps secret_value (see\n// changestogether.go).",
          "",
        ),
    );
  });

  test("the type changes in place: no RequiresReplace, and the update sends it", () => {
    const secretType: string = block(resourceGo, "secret_type");

    expect(secretType).not.toContain("RequiresReplace");
    expect(secretType).toContain('stringvalidator.OneOf("Text", "TOTP")');
    // Its MarkdownDescription, which the registry's page shows.
    expect(secretType).toContain(NOTE);

    const update: string = method(resourceGo, "Update");

    expect(update).toContain('requestDataMap["secretType"]');
    expect(update).toContain('requestDataMap["secretValue"]');
    // Both in the one request: one PUT, built from one map.
    expect(update.split("r.client.Put(").length).toBe(2);
  });

  test("the value stays Sensitive, and is never read back", () => {
    const secretValue: string = block(resourceGo, "secret_value");

    expect(secretValue).toContain("Sensitive: true");
    expect(secretValue).not.toContain("RequiresReplace");
    expect(method(resourceGo, "Read")).not.toContain('dataMap["secretValue"]');
  });
});

describe("the documentation", () => {
  test("says a plan that changes secret_type alone fails, and what to change", () => {
    const line: string | undefined = docs
      .split("\n")
      .find((candidate: string): boolean => {
        return candidate.startsWith("- `secret_type`");
      });

    expect(line).toBeDefined();
    expect(line).toContain(NOTE);
    expect(line).toContain("Allowed values: `Text`, `TOTP`.");
  });
});
