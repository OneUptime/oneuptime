import fs from "fs";
import os from "os";
import path from "path";
import { ResourceGenerator } from "../Core/ResourceGenerator";
import { OpenAPIParser } from "../Core/OpenAPIParser";
import { OpenAPISpec, TerraformAttribute } from "../Core/Types";
import { buildFixtureSpec } from "./Fixtures";

/*
 * IMPORTS THAT SETTLE, as the generator writes them (the Go behind them is
 * StaticFiles/importsettle.go, with its tests).
 *
 * Imported into a configuration written by hand, a record used to plan an
 * update of things nobody changed: a timestamp without milliseconds, a
 * number with more digits than OneUptime keeps, a JSON value without the
 * keys OneUptime fills in, a monitor's steps without their defaults. Every
 * resource's attributes of those kinds get the plan modifier that keeps the
 * state's value when the configuration's means the same, the import names
 * the attributes that may hold keys a configuration never writes, an update
 * takes off the ones it writes, and every resource's ModifyPlan ends by
 * keeping the whole state when nothing a configuration sets changes.
 */

const dateTime: any = {
  type: "object",
  "x-oneuptime-type": "DateTime",
  description: "A date time object.",
  example: { _type: "DateTime", value: "2023-10-01T12:00:00Z" },
};

/*
 * A schedule layer, as the spec writes one: every kind of attribute an
 * import reads in a form of its own, written at create and update, and the
 * ones only OneUptime sets in what it answers.
 */
function buildLayerSpec(): OpenAPISpec {
  const spec: OpenAPISpec = buildFixtureSpec();
  const writable: Record<string, any> = {
    name: { type: "string", description: "Name of the layer." },
    startsAt: dateTime,
    order: { type: "number", description: "Order of the layer." },
    restrictionTimes: {
      type: "object",
      description: "Restrict this layer to these times.",
    },
    color: {
      type: "object",
      description: "Color of the layer.",
      example: { _type: "Color", value: "#ff0000" },
    },
    projectId: { type: "string", description: "Project id" },
  };
  const schemas: Record<string, any> = spec.components!.schemas as Record<
    string,
    any
  >;
  schemas["OnCallDutyPolicyScheduleLayerCreateSchema"] = {
    type: "object",
    required: ["name", "startsAt"],
    properties: writable,
  };
  schemas["OnCallDutyPolicyScheduleLayerUpdateSchema"] = {
    type: "object",
    properties: writable,
  };
  schemas["OnCallDutyPolicyScheduleLayer"] = {
    type: "object",
    properties: {
      _id: { type: "string", format: "uuid" },
      ...writable,
      createdAt: dateTime,
      updatedAt: dateTime,
      slug: { type: "string", description: "Its slug." },
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
          schema: {
            type: "object",
            properties: { data: reference(name) },
          },
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
            properties: { data: reference("OnCallDutyPolicyScheduleLayer") },
          },
        },
      },
    },
  };
  const tag: string = "On-Call Schedule Layer";
  const idParameter: any = {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  };

  spec.tags = [
    ...(spec.tags || []),
    { name: tag, description: "On-call layers." },
  ];
  spec.paths = {
    ...spec.paths,
    "/on-call-duty-schedule-layer": {
      post: {
        operationId: "createOnCallDutyPolicyScheduleLayer",
        tags: [tag],
        requestBody: body("OnCallDutyPolicyScheduleLayerCreateSchema"),
        responses: answer,
      } as any,
    },
    "/on-call-duty-schedule-layer/{id}/get-item": {
      post: {
        operationId: "getOnCallDutyPolicyScheduleLayer",
        tags: [tag],
        parameters: [idParameter],
        responses: answer,
      } as any,
    },
    "/on-call-duty-schedule-layer/{id}": {
      put: {
        operationId: "updateOnCallDutyPolicyScheduleLayer",
        tags: [tag],
        parameters: [idParameter],
        requestBody: body("OnCallDutyPolicyScheduleLayerUpdateSchema"),
        responses: answer,
      } as any,
      delete: {
        operationId: "deleteOnCallDutyPolicyScheduleLayer",
        tags: [tag],
        parameters: [idParameter],
        responses: answer,
      } as any,
    },
  };
  return spec;
}

let outputDir: string;
let layerGo: string;
let monitorGo: string;
let monitorStatusGo: string;
let fileGo: string;
let resourceCount: number;

function generatedFiles(): Array<string> {
  return fs
    .readdirSync(path.join(outputDir, "internal/provider"))
    .filter((name: string) => {
      return name.startsWith("resource_") && name.endsWith(".go");
    });
}

function attributeBlock(source: string, attribute: string): string {
  const start: number = source.indexOf(`"${attribute}": schema.`);
  if (start === -1) {
    throw new Error(`no attribute ${attribute}`);
  }
  // The attribute's block ends at the first line that closes it.
  const end: number = source.indexOf("\n            },\n", start);
  return source.substring(start, end);
}

function method(source: string, signature: string): string {
  const start: number = source.indexOf(signature);
  if (start === -1) {
    throw new Error(`no ${signature}`);
  }
  return source.substring(start, source.indexOf("\n}\n", start));
}

beforeAll(async () => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-import-settle-"));
  const spec: OpenAPISpec = buildLayerSpec();
  const generator: ResourceGenerator = new ResourceGenerator(
    {
      outputDir,
      providerName: "oneuptime",
      providerVersion: "14.0.0",
      goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
    },
    spec,
  );
  await generator.generateResources();

  const read: (file: string) => string = (file: string): string => {
    return fs.readFileSync(
      path.join(outputDir, "internal/provider", file),
      "utf-8",
    );
  };
  layerGo = read("resource_on_call_schedule_layer.go");
  monitorGo = read("resource_monitor.go");
  monitorStatusGo = read("resource_monitor_status.go");
  fileGo = read("resource_file.go");
  resourceCount = generatedFiles().length;
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("the plan modifiers that keep what an import read", () => {
  test("a timestamp keeps the state's when it is the same instant", () => {
    expect(attributeBlock(layerGo, "starts_at")).toContain(
      "RFC3339KeepSameInstant()",
    );
    expect(attributeBlock(monitorGo, "disable_monitoring_datetime")).toContain(
      "RFC3339KeepSameInstant()",
    );
  });

  test("a number keeps the state's when it is the same number to OneUptime", () => {
    expect(attributeBlock(layerGo, "order")).toContain(
      "NumberKeepSameAPINumber()",
    );
  });

  test("a JSON value keeps the imported one while the configuration's is a subset of it", () => {
    expect(attributeBlock(layerGo, "restriction_times")).toContain(
      "JSONSubsetKeepImported()",
    );
    expect(attributeBlock(monitorGo, "server_meta")).toContain(
      "JSONSubsetKeepImported()",
    );
  });

  test("runs first, so a replacement sees the value it kept", () => {
    const block: string = attributeBlock(layerGo, "restriction_times");
    expect(block.indexOf("JSONSubsetKeepImported()")).toBeLessThan(
      block.indexOf("UseStateForUnknown()"),
    );

    /*
     * A create-only value: the same thing written another way replaces
     * nothing either.
     */
    const region: string = attributeBlock(monitorGo, "immutable_region");
    expect(region).toContain("RequiresReplace()");
  });

  test("a wrapped scalar, what OneUptime sets, and the project are left as they were", () => {
    // A color is kept as its plain value, which is no JSON to compare.
    expect(attributeBlock(layerGo, "color")).not.toContain(
      "JSONSubsetKeepImported()",
    );
    // A Color is read as the same plain value it is written as.
    expect(attributeBlock(monitorStatusGo, "color")).not.toContain(
      "JSONSubsetKeepImported()",
    );
    for (const attribute of [
      "created_at",
      "updated_at",
      "slug",
      "project_id",
    ]) {
      const block: string = attributeBlock(layerGo, attribute);
      expect(block).not.toContain("RFC3339KeepSameInstant()");
      expect(block).not.toContain("JSONSubsetKeepImported()");
      expect(block).not.toContain("NumberKeepSameAPINumber()");
    }
    // Monitor's priority is OneUptime's own number.
    expect(attributeBlock(monitorGo, "priority")).not.toContain(
      "NumberKeepSameAPINumber()",
    );
  });

  test("getImportSettleModifier names one modifier for each kind, and none for the rest", () => {
    const cases: Array<[Partial<TerraformAttribute>, string | null]> = [
      [{ type: "string", isDateTime: true }, "RFC3339KeepSameInstant()"],
      [{ type: "number" }, "NumberKeepSameAPINumber()"],
      [{ type: "string", isPhone: true }, "PhoneKeepSameNumber()"],
      [{ type: "string", isComplexObject: true }, "JSONSubsetKeepImported()"],
      [{ type: "string", isComplexObject: true, isWrappedScalar: true }, null],
      [{ type: "string" }, null],
      [{ type: "bool" }, null],
      [{ type: "set" }, null],
    ];
    for (const [attribute, modifier] of cases) {
      expect(
        ResourceGenerator.getImportSettleModifier(
          attribute as TerraformAttribute,
        ),
      ).toBe(modifier);
    }
  });
});

describe("what an import, a create and an update leave in the private state", () => {
  test("an import names the attributes that may hold keys a configuration never writes", () => {
    const importState: string = method(
      layerGo,
      "func (r *OnCallScheduleLayerResource) ImportState",
    );
    expect(importState).toContain(
      'markImportedFromServer(ctx, resp.Private, []string{"restriction_times"})',
    );

    // A monitor's steps are one of them.
    expect(
      method(monitorGo, "func (r *MonitorResource) ImportState"),
    ).toContain(
      'markImportedFromServer(ctx, resp.Private, []string{"monitor_steps", "server_meta"})',
    );
  });

  test("a resource with none names nothing", () => {
    expect(monitorStatusGo).not.toContain("markImportedFromServer");
    expect(monitorStatusGo).not.toContain("keepImportedFromServer");
    expect(monitorStatusGo).not.toContain("forgetImportedFromServer");
  });

  test("an update takes off each one it writes from the configuration", () => {
    const update: string = method(
      layerGo,
      "func (r *OnCallScheduleLayerResource) Update",
    );
    expect(update).toContain(
      '"restriction_times": !data.RestrictionTimes.Equal(state.RestrictionTimes),',
    );
    // Worked out from the plan before anything is sent...
    expect(
      update.indexOf("writtenFromConfig := map[string]bool{"),
    ).toBeLessThan(update.indexOf("r.client.Put("));
    // ...and left in the private state with the state.
    expect(update).toContain(
      "keepImportedFromServer(ctx, resp.Private, writtenFromConfig)",
    );
    expect(
      update.indexOf(
        "keepImportedFromServer(ctx, resp.Private, writtenFromConfig)",
      ),
    ).toBeLessThan(update.lastIndexOf("resp.State.Set(ctx, &data)"));
  });

  test("a create forgets what an earlier import named", () => {
    expect(
      method(layerGo, "func (r *OnCallScheduleLayerResource) Create"),
    ).toContain("forgetImportedFromServer(ctx, resp.Private)");
  });

  test("a resource that cannot be imported names nothing", () => {
    expect(fileGo).not.toContain("markImportedFromServer");
    expect(fileGo).toContain('"Import Not Supported"');
  });
});

describe("every resource's ModifyPlan", () => {
  test("keeps the state when nothing a configuration sets changes", () => {
    for (const file of generatedFiles()) {
      const source: string = fs.readFileSync(
        path.join(outputDir, "internal/provider", file),
        "utf-8",
      );
      expect(source).toContain("var _ resource.ResourceWithModifyPlan =");
      const modifyPlan: string = method(
        source,
        ") ModifyPlan(ctx context.Context",
      );
      expect(modifyPlan).toContain("if req.Plan.Raw.IsNull() {");
      expect(modifyPlan.trimEnd()).toMatch(
        new RegExp("keepStateWhenNothingChanges\\(ctx, req, resp\\)$"),
      );
    }
    expect(resourceCount).toBeGreaterThanOrEqual(4);
  });
});

describe("the static files", () => {
  test("ship the helpers and their tests with every provider", async () => {
    for (const file of [
      "importsettle.go",
      "importsettle_test.go",
      "import_plan_test.go",
    ]) {
      expect(
        fs.existsSync(path.join(outputDir, "internal/provider", file)),
      ).toBe(true);
    }
  });

  test("the parser marks a wrapped scalar as one", () => {
    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(buildLayerSpec());
    const layer: TerraformAttribute | undefined = parser
      .getResources()
      .find((resource: { name: string }) => {
        return resource.name === "on_call_schedule_layer";
      })?.schema["color"];
    expect(layer?.isComplexObject).toBe(true);
    expect(layer?.isWrappedScalar).toBe(true);
  });
});
