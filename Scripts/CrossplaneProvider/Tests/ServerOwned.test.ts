import { OpenAPIParser } from "../../TerraformProvider/Core/OpenAPIParser";
import {
  OpenAPISpec,
  TerraformAttribute,
  TerraformResource,
} from "../../TerraformProvider/Core/Types";
import { buildFixtureSpec } from "../../TerraformProvider/Tests/Fixtures";
import {
  collectServerOwned,
  renderServerOwnedGo,
  ServerOwnedMap,
} from "../Core/ServerOwned";

/*
 * The fields OneUptime keeps once a record exists, as the Crossplane
 * generator hands them to the provider's configuration
 * (config/zz_server_owned.go, #9985): "always" ones are read only, so their
 * kinds have them in status.atProvider alone; "after-create" ones late
 * initialization never copies into spec.forProvider.
 */

function resource(
  name: string,
  schema: Record<string, TerraformAttribute>,
): TerraformResource {
  return { name, goTypeName: name, operations: {}, schema };
}

const id: TerraformAttribute = { type: "string", computed: true };

describe("the fields OneUptime keeps, from the spec", () => {
  test("are collected by resource and field, with how OneUptime keeps each", () => {
    const serverOwned: ServerOwnedMap = collectServerOwned([
      resource("monitor", {
        id,
        name: { type: "string", required: true },
        current_monitor_status_id: {
          type: "string",
          optional: true,
          computed: true,
          serverOwned: "after-create",
        },
        telemetry_monitor_last_monitor_at: {
          type: "string",
          computed: true,
          serverOwned: "always",
        },
      }),
      resource("label", { id, name: { type: "string", required: true } }),
    ]);

    expect(serverOwned).toEqual({
      oneuptime_monitor: {
        current_monitor_status_id: "after-create",
        telemetry_monitor_last_monitor_at: "always",
      },
    });
  });

  test("come from the real parser reading x-oneuptime-server-owned", () => {
    // A copy: the fixture's schemas are shared with every other test.
    const spec: OpenAPISpec = JSON.parse(
      JSON.stringify(buildFixtureSpec()),
    ) as OpenAPISpec;
    const schemas: Record<string, any> = spec.components!.schemas!;
    for (const schemaName of Object.keys(schemas)) {
      const property: any =
        schemas[schemaName]?.properties?.["currentMonitorStatusId"];
      if (property) {
        property["x-oneuptime-server-owned"] = "after-create";
      }
    }
    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(spec);

    expect(collectServerOwned(parser.getResources())).toEqual({
      oneuptime_monitor: { current_monitor_status_id: "after-create" },
    });
  });

  test("are named as the provider names them: a field called like a Terraform meta-argument takes _value", () => {
    expect(
      collectServerOwned([
        resource("kubernetes_cluster", {
          id,
          provider: {
            type: "string",
            optional: true,
            computed: true,
            serverOwned: "after-create",
          },
        }),
      ]),
    ).toEqual({
      oneuptime_kubernetes_cluster: { provider_value: "after-create" },
    });
  });

  test("nothing, when no field says so", () => {
    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(buildFixtureSpec());

    expect(collectServerOwned(parser.getResources())).toEqual({});
  });
});

describe("config/zz_server_owned.go", () => {
  test("is a Go map in a stable order, so it changes only when a model's declaration does", () => {
    const go: string = renderServerOwnedGo({
      oneuptime_monitor: {
        telemetry_monitor_last_monitor_at: "always",
        current_monitor_status_id: "after-create",
      },
      oneuptime_incident: { current_incident_state_id: "after-create" },
    });

    expect(go).toContain("package config\n");
    expect(go).toContain("DO NOT EDIT");
    expect(go).toContain(
      "var generatedServerOwned = map[string]map[string]string{",
    );
    expect(go.indexOf('"oneuptime_incident"')).toBeLessThan(
      go.indexOf('"oneuptime_monitor"'),
    );
    expect(
      go.indexOf('"current_monitor_status_id": "after-create"'),
    ).toBeLessThan(go.indexOf('"telemetry_monitor_last_monitor_at": "always"'));
    expect(go.endsWith("}\n")).toBe(true);
  });

  test("is an empty map, which compiles, when nothing is kept", () => {
    expect(renderServerOwnedGo({})).toContain(
      "var generatedServerOwned = map[string]map[string]string{\n}\n",
    );
  });
});
