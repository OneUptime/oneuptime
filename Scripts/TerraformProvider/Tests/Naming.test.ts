import { StringUtils } from "../Core/StringUtils";
import { OpenAPIParser } from "../Core/OpenAPIParser";
import { TerraformDataSource, TerraformResource } from "../Core/Types";
import { buildFixtureSpec } from "./Fixtures";

/*
 * Type names are what people type in every block. Splitting on every change
 * of case cut mixed-case words apart (oneuptime_io_t_fleet,
 * oneuptime_v_center); they are kept whole now, and the old names stay
 * registered as deprecated aliases. Attribute names keep the spelling they
 * always had: renaming one would break every configuration that sets it.
 */

describe("toSnakeCase keeps mixed-case words whole", () => {
  test.each([
    ["IoT Fleet", "iot_fleet"],
    ["IoT Device Credential", "iot_device_credential"],
    ["IoTFleet", "iot_fleet"],
    ["vCenter", "vcenter"],
    ["vCenter Label Rule", "vcenter_label_rule"],
    ["WhatsApp Log", "whatsapp_log"],
    ["GitHub App", "github_app"],
    ["VMware Host", "vmware_host"],
    ["MCP OAuth Grant", "mcp_oauth_grant"],
    ["macOS Agent", "macos_agent"],
  ])("%s -> %s", (input: string, expected: string) => {
    expect(StringUtils.toSnakeCase(input)).toBe(expected);
  });

  test.each([
    ["Monitor", "monitor"],
    ["Monitor Status", "monitor_status"],
    ["API Key", "api_key"],
    ["SMS Log", "sms_log"],
    ["On-Call Duty Policy", "on_call_duty_policy"],
    ["Status Page SSO", "status_page_sso"],
    ["EmailLog", "email_log"],
  ])(
    "leaves ordinary names as they were: %s -> %s",
    (input: string, expected: string) => {
      expect(StringUtils.toSnakeCase(input)).toBe(expected);
      expect(StringUtils.toLegacySnakeCase(input)).toBe(expected);
    },
  );

  test("does not reach into a longer word", () => {
    // "Patriot" contains "iot" but is no IoT.
    expect(StringUtils.toSnakeCase("Patriot Fleet")).toBe("patriot_fleet");
  });
});

describe("toLegacySnakeCase is the spelling the provider always used", () => {
  test.each([
    ["IoT Fleet", "io_t_fleet"],
    ["vCenter", "v_center"],
    ["WhatsApp Log", "whats_app_log"],
    ["customJavaScript", "custom_java_script"],
    ["mcpOAuthGrantId", "mcp_o_auth_grant_id"],
    ["monitorType", "monitor_type"],
  ])("%s -> %s", (input: string, expected: string) => {
    expect(StringUtils.toLegacySnakeCase(input)).toBe(expected);
  });
});

describe("renamed types keep their old names", () => {
  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(buildFixtureSpec());
  const resources: Array<TerraformResource> = parser.getResources();
  const dataSources: Array<TerraformDataSource> = parser.getDataSources();

  test("a resource whose name changed records the old one", () => {
    const fleet: TerraformResource | undefined = resources.find(
      (resource: TerraformResource) => {
        return resource.name === "iot_fleet";
      },
    );

    expect(fleet).toBeDefined();
    expect(fleet!.legacyName).toBe("io_t_fleet");
    expect(fleet!.goTypeName).toBe("IotFleet");
  });

  test("so does its data source", () => {
    expect(
      dataSources.find((dataSource: TerraformDataSource) => {
        return dataSource.name === "iot_fleet";
      })?.legacyName,
    ).toBe("io_t_fleet");
  });

  test("a name that did not change has no alias", () => {
    for (const resource of resources) {
      if (resource.name !== "iot_fleet") {
        expect({
          name: resource.name,
          legacyName: resource.legacyName,
        }).toEqual({ name: resource.name, legacyName: undefined });
      }
    }
  });

  test("attribute names keep their old spelling", () => {
    const monitor: TerraformResource = resources.find(
      (resource: TerraformResource) => {
        return resource.name === "monitor";
      },
    )!;

    expect(monitor.schema["custom_java_script"]).toBeDefined();
    expect(monitor.schema["custom_javascript"]).toBeUndefined();
  });
});
