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
 * WHAT ONEUPTIME KEEPS ONCE A RECORD EXISTS (#9985).
 *
 * The spec marks a column OneUptime keeps (x-oneuptime-server-owned, from
 * the model's TableColumnMetadata.serverOwned):
 *
 *   - "always": only OneUptime writes it - a telemetry monitor's last and
 *     next evaluation. It is read only, whatever request schemas the spec
 *     puts it in: Terraform never sends it, and its moving is never a
 *     change, let alone a replacement (a configuration that gave a
 *     telemetry monitor's timestamps had it replaced each time they moved).
 *   - "after-create": a create may give its first value - the status a new
 *     monitor starts in - and OneUptime moves it on from there. It is
 *     optional, a create sends it and no update does, nothing replaces the
 *     record for it, and once the record exists its plan keeps the state's
 *     value whatever the configuration says (StaticFiles/serverowned.go):
 *     Terraform used to set a monitor's status back every time a check
 *     moved it.
 *
 * Every resource's ModifyPlan also starts with KeepLeftOutUnderCrossplane
 * (StaticFiles/crossplane.go): under Crossplane a field a manifest leaves
 * out of a record that exists keeps the record's value. The plans
 * themselves are tested in Go (serverowned_test.go, serverowned_plan_test.go,
 * crossplane_test.go).
 */

interface SpecOptions {
  // How the spec marks each column, by its API name; none when left out.
  serverOwned?: Record<string, string>;
  // The columns the create and update schemas leave out.
  notInCreate?: Array<string>;
  notInUpdate?: Array<string>;
}

const COLUMNS: Record<string, any> = {
  name: { type: "string", description: "Any friendly name." },
  monitorType: {
    type: "string",
    enum: ["Manual", "Metrics"],
    description: "What is the type of this monitor?",
  },
  description: { type: "string", description: "What it checks." },
  currentMonitorStatusId: {
    type: "string",
    format: "uuid",
    description: "Whats the current status ID of this monitor?",
  },
  telemetryMonitorLastMonitorAt: {
    type: "object",
    "x-oneuptime-type": "DateTime",
    description:
      "This field is for Telemetry Monitor only. When was the last time we monitored?",
  },
  // Create-only, and OneUptime's after: a state timeline row's end.
  endsAt: {
    type: "object",
    "x-oneuptime-type": "DateTime",
    description: "When did this status change end?",
  },
  // Update-only, and OneUptime's: what an agent counted.
  nodeCount: { type: "number", description: "Cached count of nodes." },
};

const DEFAULT_SERVER_OWNED: Record<string, string> = {
  currentMonitorStatusId: "after-create",
  telemetryMonitorLastMonitorAt: "always",
  endsAt: "after-create",
  nodeCount: "always",
};

function buildSpec(options: SpecOptions = {}): OpenAPISpec {
  const serverOwned: Record<string, string> =
    options.serverOwned || DEFAULT_SERVER_OWNED;
  const column: (name: string) => any = (name: string): any => {
    return {
      ...COLUMNS[name],
      ...(serverOwned[name]
        ? { "x-oneuptime-server-owned": serverOwned[name] }
        : {}),
    };
  };
  const pick: (names: Array<string>) => Record<string, any> = (
    names: Array<string>,
  ): Record<string, any> => {
    const picked: Record<string, any> = {};
    for (const name of names) {
      picked[name] = column(name);
    }
    return picked;
  };

  const notInCreate: Array<string> = options.notInCreate || ["nodeCount"];
  const notInUpdate: Array<string> = options.notInUpdate || [
    "monitorType",
    "telemetryMonitorLastMonitorAt",
    "endsAt",
  ];
  const create: Record<string, any> = pick(
    Object.keys(COLUMNS).filter((name: string): boolean => {
      return !notInCreate.includes(name);
    }),
  );
  const update: Record<string, any> = pick(
    Object.keys(COLUMNS).filter((name: string): boolean => {
      return !notInUpdate.includes(name);
    }),
  );
  const read: Record<string, any> = {
    _id: { type: "string" },
    ...pick(Object.keys(COLUMNS)),
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

  return {
    openapi: "3.0.0",
    info: { title: "OneUptime", version: "1.0.0" },
    servers: [{ url: "https://oneuptime.com/api" }],
    tags: [{ name: "Monitor", description: "A monitor." }],
    paths: {
      "/monitor": {
        post: {
          operationId: "createMonitor",
          tags: ["Monitor"],
          requestBody: body("MonitorCreateSchema"),
          responses: answer("Monitor"),
        },
      },
      "/monitor/{id}/get-item": {
        post: {
          operationId: "getMonitor",
          tags: ["Monitor"],
          parameters: [id],
          responses: answer("Monitor"),
        },
      },
      "/monitor/{id}": {
        put: {
          operationId: "updateMonitor",
          tags: ["Monitor"],
          parameters: [id],
          requestBody: body("MonitorUpdateSchema"),
          responses: answer("Monitor"),
        },
        delete: {
          operationId: "deleteMonitor",
          tags: ["Monitor"],
          parameters: [id],
          responses: answer("Monitor"),
        },
      },
    } as any,
    components: {
      schemas: {
        MonitorCreateSchema: {
          type: "object",
          required: ["name", "monitorType"],
          properties: create,
        },
        MonitorUpdateSchema: { type: "object", properties: update },
        Monitor: { type: "object", properties: read },
      },
    },
  };
}

function parse(options: SpecOptions = {}): TerraformResource {
  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(buildSpec(options));
  return parser.getResources()[0]!;
}

function attribute(
  resource: TerraformResource,
  name: string,
): TerraformAttribute {
  const found: TerraformAttribute | undefined = resource.schema[name];
  if (!found) {
    throw new Error(`no attribute ${name}`);
  }
  return found;
}

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
    path.join(dir, providerGoFilePath("resource_monitor.go")),
    "utf-8",
  );
}

// One method of the generated resource, from its comment to the next one.
function method(source: string, name: string): string {
  const start: number = source.indexOf(`func (r *MonitorResource) ${name}(`);
  if (start === -1) {
    throw new Error(`no ${name} method`);
  }
  const commentStart: number = source.lastIndexOf("\n\n", start);
  const next: number = source.indexOf("\nfunc ", start + 1);
  return source.substring(commentStart, next === -1 ? undefined : next);
}

// One attribute of the generated schema.
function block(source: string, name: string): string {
  const start: number = source.indexOf(`"${name}": schema.`);
  if (start === -1) {
    throw new Error(`no attribute ${name}`);
  }
  return source.substring(start, source.indexOf("\n            },\n", start));
}

beforeAll(async () => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-server-owned-"));
  resourceGo = await generate({}, path.join(outputDir, "declared"));
  plainResourceGo = await generate(
    { serverOwned: {} },
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
    path.join(docsDir, "docs/resources/monitor.md"),
    "utf-8",
  );
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("the parser", () => {
  test("reads how OneUptime keeps each attribute, and nothing it does not know", () => {
    expect(OpenAPIParser.readServerOwned("always")).toBe("always");
    expect(OpenAPIParser.readServerOwned("after-create")).toBe("after-create");
    for (const unknown of ["sometimes", "", true, 1, null, undefined]) {
      expect(OpenAPIParser.readServerOwned(unknown)).toBeUndefined();
    }

    const resource: TerraformResource = parse({
      serverOwned: { ...DEFAULT_SERVER_OWNED, description: "sometimes" },
    });
    expect(attribute(resource, "description").serverOwned).toBeUndefined();
    expect(attribute(resource, "description").optional).toBe(true);
  });

  test("an attribute only OneUptime writes is read only, whatever requests the spec lists it in", () => {
    const resource: TerraformResource = parse();

    for (const name of ["telemetry_monitor_last_monitor_at", "node_count"]) {
      const owned: TerraformAttribute = attribute(resource, name);
      expect([
        name,
        owned.serverOwned,
        owned.computed,
        owned.optional,
        owned.required,
      ]).toEqual([name, "always", true, false, false]);
      expect([name, Boolean(owned.forceNew)]).toEqual([name, false]);
      expect(resource.operationSchemas?.create?.[name]).toBeUndefined();
      expect(resource.operationSchemas?.update?.[name]).toBeUndefined();
    }
  });

  test("an attribute a create starts is optional, created with, never updated and never replaced for", () => {
    const resource: TerraformResource = parse();

    for (const name of ["current_monitor_status_id", "ends_at"]) {
      const started: TerraformAttribute = attribute(resource, name);
      expect([
        name,
        started.serverOwned,
        started.optional,
        started.computed,
        started.required,
        started.forceNew,
      ]).toEqual([name, "after-create", true, true, false, false]);
      expect(resource.operationSchemas?.create?.[name]).toBeDefined();
      expect(resource.operationSchemas?.update?.[name]).toBeUndefined();
      expect(started.description).toContain(
        OpenAPIParser.AFTER_CREATE_DESCRIPTION,
      );
    }
  });

  test("one no create may give is OneUptime's from the start: read only, with nothing to say of a configuration", () => {
    const resource: TerraformResource = parse({
      serverOwned: { ...DEFAULT_SERVER_OWNED, nodeCount: "after-create" },
    });
    const counted: TerraformAttribute = attribute(resource, "node_count");

    expect([counted.computed, counted.optional, counted.required]).toEqual([
      true,
      false,
      false,
    ]);
    expect(resource.operationSchemas?.update?.["node_count"]).toBeUndefined();
    expect(counted.description).not.toContain(
      OpenAPIParser.AFTER_CREATE_DESCRIPTION,
    );
  });

  test("without the marks, the same columns are what they were: writable, and replaced for when only a create writes them", () => {
    const resource: TerraformResource = parse({ serverOwned: {} });

    expect(attribute(resource, "current_monitor_status_id").optional).toBe(
      true,
    );
    expect(
      resource.operationSchemas?.update?.["current_monitor_status_id"],
    ).toBeDefined();
    expect(
      attribute(resource, "telemetry_monitor_last_monitor_at").forceNew,
    ).toBe(true);
    expect(attribute(resource, "ends_at").forceNew).toBe(true);
    expect(attribute(resource, "node_count").optional).toBe(true);
    for (const owned of Object.values(resource.schema)) {
      expect(owned.serverOwned).toBeUndefined();
      expect(owned.description || "").not.toContain(
        OpenAPIParser.AFTER_CREATE_DESCRIPTION,
      );
    }
  });
});

describe("the generated resource", () => {
  test("keeps the state's value of what a create starts, and replaces nothing for it", () => {
    for (const name of ["current_monitor_status_id", "ends_at"]) {
      const generated: string = block(resourceGo, name);
      expect(generated).toContain("Optional: true");
      expect(generated).toContain("Computed: true");
      expect(generated).toContain("StringKeepAfterCreate()");
      expect(generated).not.toContain("RequiresReplace()");
    }
    // The same column without the mark is replaced for, as before.
    expect(block(plainResourceGo, "ends_at")).toContain(
      "stringplanmodifier.RequiresReplace()",
    );
    expect(plainResourceGo).not.toContain("KeepAfterCreate()");
  });

  test("declares what only OneUptime writes read only", () => {
    for (const name of ["telemetry_monitor_last_monitor_at", "node_count"]) {
      const generated: string = block(resourceGo, name);
      expect(generated).toContain("Computed: true");
      expect(generated).not.toContain("Optional: true");
      expect(generated).not.toContain("Required: true");
      expect(generated).not.toContain("RequiresReplace()");
    }
  });

  test("a create sends the starting value, and nothing only OneUptime writes", () => {
    const create: string = method(resourceGo, "Create");
    expect(create).toContain('requestDataMap["currentMonitorStatusId"]');
    expect(create).toContain('requestDataMap["endsAt"]');
    expect(create).not.toContain(
      'requestDataMap["telemetryMonitorLastMonitorAt"]',
    );
    expect(create).not.toContain('requestDataMap["nodeCount"]');
  });

  test("an update sends none of them", () => {
    const update: string = method(resourceGo, "Update");
    for (const field of [
      "currentMonitorStatusId",
      "endsAt",
      "telemetryMonitorLastMonitorAt",
      "nodeCount",
    ]) {
      expect([field, update.includes(`requestDataMap["${field}"]`)]).toEqual([
        field,
        false,
      ]);
    }
    expect(update).toContain('requestDataMap["description"]');
    // Without the marks, an update sent the status.
    expect(method(plainResourceGo, "Update")).toContain(
      'requestDataMap["currentMonitorStatusId"]',
    );
  });

  test("after a write, what a create starts keeps its planned value whatever the configuration says", () => {
    const keep: string = method(resourceGo, "keepPlannedValues");
    expect(keep).toContain(
      "    if !plan.CurrentMonitorStatusId.IsUnknown() {\n        data.CurrentMonitorStatusId = plan.CurrentMonitorStatusId\n    }",
    );
    expect(keep).toContain("    if !plan.EndsAt.IsUnknown() {");
    // The rest keep it only while the configuration leaves them out, as ever.
    expect(keep).toContain(
      "    if config.Description.IsNull() && !plan.Description.IsUnknown() {",
    );
    expect(method(plainResourceGo, "keepPlannedValues")).toContain(
      "    if config.CurrentMonitorStatusId.IsNull() && !plan.CurrentMonitorStatusId.IsUnknown() {",
    );
  });

  test("a plan starts by keeping, under Crossplane, what a manifest leaves out", () => {
    for (const source of [resourceGo, plainResourceGo]) {
      const modifyPlan: string = method(source, "ModifyPlan");
      const kept: number = modifyPlan.indexOf(
        "KeepLeftOutUnderCrossplane(ctx, req, resp)",
      );
      expect(kept).toBeGreaterThan(modifyPlan.indexOf("req.Plan.Raw.IsNull()"));
      expect(kept).toBeLessThan(
        modifyPlan.indexOf("KeepStateWhenNothingChanges(ctx, req, resp)"),
      );
    }
  });

  test("the reference says the starting value is the configuration's only until the create", () => {
    expect(docs).toContain(OpenAPIParser.AFTER_CREATE_DESCRIPTION);
  });
});

describe("the plan modifiers", () => {
  test("are one per type, and none for an attribute nobody writes", () => {
    const started: TerraformAttribute = {
      type: "string",
      optional: true,
      computed: true,
      serverOwned: "after-create",
    };
    expect(ResourceGenerator.getKeepAfterCreateModifier("x", started)).toBe(
      "StringKeepAfterCreate()",
    );
    for (const [type, modifier] of [
      ["bool", "BoolKeepAfterCreate()"],
      ["number", "NumberKeepAfterCreate()"],
      ["list", "ListKeepAfterCreate()"],
      ["set", "SetKeepAfterCreate()"],
    ] as Array<[string, string]>) {
      expect(
        ResourceGenerator.getKeepAfterCreateModifier("x", { ...started, type }),
      ).toBe(modifier);
    }
    expect(
      ResourceGenerator.getKeepAfterCreateModifier("x", {
        ...started,
        type: "map",
      }),
    ).toBeNull();
    expect(
      ResourceGenerator.getKeepAfterCreateModifier("id", started),
    ).toBeNull();
    expect(
      ResourceGenerator.getKeepAfterCreateModifier("x", {
        ...started,
        optional: false,
      }),
    ).toBeNull();
    expect(
      ResourceGenerator.getKeepAfterCreateModifier("x", {
        ...started,
        serverOwned: "always",
      }),
    ).toBeNull();
  });
});
