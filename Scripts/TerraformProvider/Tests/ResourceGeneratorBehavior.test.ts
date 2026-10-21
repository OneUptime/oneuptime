import fs from "fs";
import os from "os";
import path from "path";
import { ResourceGenerator, SchemaFlags } from "../Core/ResourceGenerator";
import { OpenAPIParser } from "../Core/OpenAPIParser";
import { TerraformAttribute, TerraformResource } from "../Core/Types";
import { buildFixtureSpec } from "./Fixtures";

/*
 * The generated Go for three behaviours a Terraform user sees directly:
 *   - renamed resources keep their old name as a deprecated alias, and a
 *     moved block can bring state across;
 *   - an apply never fails with "Provider produced inconsistent result after
 *     apply" because the server updated an attribute nobody configured;
 *   - read-only attributes the server sets once are not "(known after
 *     apply)" in every update's plan.
 */

let outputDir: string;
let monitorGo: string;
let fleetGo: string;
let monitorStatusGo: string;
let resourcesGo: string;

function section(source: string, start: string, end: string): string {
  const from: number = source.indexOf(start);
  const to: number = source.indexOf(end, from + start.length);
  if (from === -1 || to === -1) {
    throw new Error(`section ${start} .. ${end} not found`);
  }
  return source.substring(from, to);
}

beforeAll(async () => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-behavior-"));
  const generator: ResourceGenerator = new ResourceGenerator(
    {
      outputDir,
      providerName: "oneuptime",
      providerVersion: "11.0.0",
      goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
    },
    buildFixtureSpec(),
  );
  await generator.generateResources();

  const read: (file: string) => string = (file: string): string => {
    return fs.readFileSync(
      path.join(outputDir, "internal/provider", file),
      "utf-8",
    );
  };

  monitorGo = read("resource_monitor.go");
  fleetGo = read("resource_iot_fleet.go");
  monitorStatusGo = read("resource_monitor_status.go");
  resourcesGo = read("resources.go");
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("a renamed resource", () => {
  test("is generated under its new name", () => {
    expect(fleetGo).toContain(
      'resp.TypeName = req.ProviderTypeName + "_iot_fleet"',
    );
    expect(fleetGo).toContain("type IotFleetResource struct {");
  });

  test("is also registered under its old name, as a deprecated alias", () => {
    expect(fleetGo).toContain(
      "func NewIotFleetLegacyResource() resource.Resource {",
    );
    expect(fleetGo).toContain("return &IotFleetResource{isLegacyAlias: true}");
    expect(fleetGo).toContain(
      'resp.TypeName = req.ProviderTypeName + "_io_t_fleet"',
    );
    expect(fleetGo).toContain("resp.Schema.DeprecationMessage =");
    expect(fleetGo).toContain(
      "oneuptime_io_t_fleet has been renamed to oneuptime_iot_fleet",
    );
    expect(resourcesGo).toContain("NewIotFleetLegacyResource,");
  });

  test("takes state from the old name with a moved block", () => {
    expect(fleetGo).toContain(
      "var _ resource.ResourceWithMoveState = &IotFleetResource{}",
    );
    expect(fleetGo).toContain(
      'legacyNameStateMover("oneuptime_io_t_fleet", r.schemaDefinition())',
    );
    // The alias itself offers no moves.
    expect(
      section(fleetGo, "func (r *IotFleetResource) MoveState", "\n}\n"),
    ).toContain("if r.isLegacyAlias {\n        return nil\n    }");
  });

  test("is listed for the alias tests", () => {
    expect(resourcesGo).toContain(
      '{Name: "iot_fleet", LegacyName: "io_t_fleet", New: NewIotFleetResource, NewLegacy: NewIotFleetLegacyResource},',
    );
  });

  test("an unrenamed resource has none of it", () => {
    for (const source of [monitorGo, monitorStatusGo]) {
      expect(source).not.toContain("isLegacyAlias");
      expect(source).not.toContain("MoveState");
      expect(source).not.toContain("LegacyResource");
    }
    expect(resourcesGo).not.toContain("NewMonitorLegacyResource");
  });

  test("both names share one schema definition", () => {
    expect(fleetGo).toContain("resp.Schema = r.schemaDefinition()");
    expect(fleetGo).toContain(
      "func (r *IotFleetResource) schemaDefinition() schema.Schema {",
    );
  });

  test("the alias helpers ship with the provider", () => {
    for (const file of ["legacynames.go", "legacynames_test.go"]) {
      expect(
        fs.existsSync(path.join(outputDir, "internal/provider", file)),
      ).toBe(true);
    }
  });
});

describe("an apply that the server races", () => {
  const keep: () => string = (): string => {
    return section(
      monitorGo,
      "func (r *MonitorResource) keepPlannedValues(",
      "\n}\n",
    );
  };

  test("keeps the planned value of each optional attribute the configuration leaves out", () => {
    for (const field of ["Description", "Labels", "CurrentMonitorStatusId"]) {
      expect(keep()).toContain(
        `if config.${field}.IsNull() && !plan.${field}.IsUnknown() {\n        data.${field} = plan.${field}\n    }`,
      );
    }
  });

  test("never second-guesses required, read-only or id attributes", () => {
    expect(keep()).not.toContain("config.Name.");
    expect(keep()).not.toContain("config.CreatedAt.");
    expect(keep()).not.toContain("config.ServerToken.");
    expect(keep()).not.toContain("config.Id.");
  });

  test("runs after the read-back of both create and update", () => {
    const create: string = section(
      monitorGo,
      "func (r *MonitorResource) Create(",
      "func (r *MonitorResource) Read(",
    );
    const update: string = section(
      monitorGo,
      "func (r *MonitorResource) Update(",
      "func (r *MonitorResource) Delete(",
    );

    for (const body of [create, update]) {
      expect(body).toContain(
        "resp.Diagnostics.Append(req.Config.Get(ctx, &config)...)",
      );
      expect(body).toContain("plan := data");
      expect(body).toContain("r.keepPlannedValues(&data, &plan, &config)");
      // After the response is mapped, or it would be overwritten again.
      expect(body.indexOf("r.keepPlannedValues(")).toBeGreaterThan(
        body.lastIndexOf('dataMap["_id"]'),
      );
    }
  });

  test("a resource with nothing to keep declares nothing it would not use", () => {
    // IoT fleet: name and monitor status are both required.
    expect(fleetGo).not.toContain("keepPlannedValues");
    expect(fleetGo).not.toContain("req.Config.Get(ctx, &config)");
  });
});

describe("plans that list only what changes", () => {
  const attribute: (name: string) => string = (name: string): string => {
    return section(monitorGo, `"${name}": schema.`, "\n            },\n");
  };

  test("read-only attributes set once at create keep their state value", () => {
    for (const name of ["created_at", "created_by_user_id", "project_id"]) {
      expect({
        name,
        has: attribute(name).includes("UseStateForUnknown()"),
      }).toEqual({ name, has: true });
    }
  });

  test("ones the server keeps changing stay unknown until applied", () => {
    expect(attribute("server_token")).not.toContain("UseStateForUnknown()");
  });
});

describe("getSchemaFlags", () => {
  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(buildFixtureSpec());
  const monitor: TerraformResource = parser
    .getResources()
    .find((resource: TerraformResource) => {
      return resource.name === "monitor";
    })!;

  const flags: (name: string) => SchemaFlags = (name: string): SchemaFlags => {
    return ResourceGenerator.getSchemaFlags(
      name,
      monitor.schema[name] as TerraformAttribute,
      monitor,
    );
  };

  test.each([
    ["name", { required: true, optional: false, computed: false }],
    ["project_id", { required: false, optional: false, computed: true }],
    ["created_at", { required: false, optional: false, computed: true }],
    [
      "current_monitor_status_id",
      { required: false, optional: true, computed: true },
    ],
    ["labels", { required: false, optional: true, computed: true }],
  ])("%s", (name: string, expected: SchemaFlags) => {
    expect(flags(name)).toEqual(expected);
  });

  test("agree with the schema the generator writes", () => {
    for (const name of Object.keys(monitor.schema)) {
      if (name === "monitor_steps") {
        continue;
      }
      const written: string = section(
        monitorGo,
        `"${name}": schema.`,
        "\n            },\n",
      );
      const expected: SchemaFlags = flags(name);
      expect({
        name,
        required: written.includes("Required: true"),
        optional: written.includes("Optional: true"),
        computed: written.includes("Computed: true"),
      }).toEqual({ name, ...expected });
    }
  });
});
