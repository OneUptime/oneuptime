import { OpenAPIParser } from "../Core/OpenAPIParser";
import {
  TerraformResource,
  TerraformDataSource,
  TerraformAttribute,
} from "../Core/Types";
import { buildFixtureSpec } from "./Fixtures";

function getParser(): OpenAPIParser {
  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(buildFixtureSpec());
  return parser;
}

function getMonitor(): TerraformResource {
  const resource: TerraformResource | undefined = getParser()
    .getResources()
    .find((r: TerraformResource) => {
      return r.name === "monitor";
    });
  if (!resource) {
    throw new Error("monitor resource not generated");
  }
  return resource;
}

describe("operation classification", () => {
  test("classifies by operationId prefix", () => {
    const monitor: TerraformResource = getMonitor();
    expect(monitor.operations.create?.operationId).toBe("createMonitor");
    expect(monitor.operations.read?.operationId).toBe("getMonitor");
    expect(monitor.operations.update?.operationId).toBe("updateMonitor");
    expect(monitor.operations.delete?.operationId).toBe("deleteMonitor");
    expect(monitor.operations.list?.operationId).toBe("listMonitor");
  });

  test("count endpoints are never treated as create operations", () => {
    const monitor: TerraformResource = getMonitor();
    /*
     * The old substring heuristics classified POST /count as create; the real
     * create must win regardless of path registration order.
     */
    expect(monitor.operations.create?.path).toBe("/monitor");
  });

  test("models without a create operation do not become resources", () => {
    const names: string[] = getParser()
      .getResources()
      .map((r: TerraformResource) => {
        return r.name;
      });
    expect(names).not.toContain("email_log");
  });

  test("read-only models still become data sources", () => {
    const names: string[] = getParser()
      .getDataSources()
      .map((d: TerraformDataSource) => {
        return d.name;
      });
    expect(names).toContain("email_log");
  });

  test("data sources share the resource type name (no _data suffix)", () => {
    const names: string[] = getParser()
      .getDataSources()
      .map((d: TerraformDataSource) => {
        return d.name;
      });
    expect(names).toContain("monitor");
    expect(names).not.toContain("monitor_data");
  });

  test("create-only models (File) are resources without read/update", () => {
    const file: TerraformResource | undefined = getParser()
      .getResources()
      .find((r: TerraformResource) => {
        return r.name === "file";
      });
    expect(file).toBeDefined();
    expect(file?.operations.create).toBeDefined();
    expect(file?.operations.read).toBeUndefined();
    expect(file?.operations.update).toBeUndefined();
    expect(file?.operations.delete).toBeDefined();
  });
});

describe("resource schema derivation", () => {
  const schema: Record<string, TerraformAttribute> = getMonitor().schema;

  test("required comes from the create schema's required list", () => {
    expect(schema["name"]?.required).toBe(true);
    expect(schema["monitor_type"]?.required).toBe(true);
    expect(schema["description"]?.required).toBeFalsy();
  });

  test("response-only fields are computed", () => {
    expect(schema["server_token"]?.computed).toBe(true);
    expect(schema["server_token"]?.optional).toBeFalsy();
    expect(schema["created_at"]?.computed).toBe(true);
  });

  test("optional writable fields that are readable are optional+computed", () => {
    expect(schema["description"]?.optional).toBe(true);
    expect(schema["description"]?.computed).toBe(true);
  });

  test("write-only fields stay writable and never computed", () => {
    expect(schema["secret_token"]?.optional).toBe(true);
    expect(schema["secret_token"]?.computed).toBeFalsy();
  });

  test("fields absent from the update schema are forceNew", () => {
    expect(schema["immutable_region"]?.forceNew).toBe(true);
    expect(schema["name"]?.forceNew).toBeFalsy();
  });

  test("enum values are captured", () => {
    expect(schema["monitor_type"]?.enumValues).toEqual([
      "Manual",
      "Website",
      "Ping",
    ]);
  });

  test("password format marks the attribute sensitive", () => {
    expect(schema["secret_token"]?.sensitive).toBe(true);
  });

  test("DateTime wrappers become RFC3339 string attributes, not JSON blobs", () => {
    const attr: TerraformAttribute | undefined =
      schema["disable_monitoring_datetime"];
    expect(attr?.type).toBe("string");
    expect(attr?.isDateTime).toBe(true);
    expect(attr?.isComplexObject).toBeFalsy();
  });

  test("entity arrays vs scalar arrays are distinguished", () => {
    expect(schema["labels"]?.type).toBe("set");
    expect(schema["labels"]?.elementKind).toBe("entity");
    expect(schema["tags"]?.type).toBe("set");
    expect(schema["tags"]?.elementKind).toBe("scalar");
  });

  test("complex objects are JSON-string attributes", () => {
    expect(schema["server_meta"]?.type).toBe("string");
    expect(schema["server_meta"]?.isComplexObject).toBe(true);
  });

  test("MonitorSteps wrappers become the typed nested attribute", () => {
    expect(schema["monitor_steps"]?.type).toBe("monitor_steps");
    expect(schema["monitor_steps"]?.isMonitorSteps).toBe(true);
    expect(schema["monitor_steps"]?.isComplexObject).toBeFalsy();
  });

  test("the Permissions clause is stripped from descriptions", () => {
    expect(schema["name"]?.description).toBe("Name of the monitor.");
    expect(schema["name"]?.description).not.toContain("Permissions");
  });

  test("id is always computed", () => {
    expect(schema["id"]?.computed).toBe(true);
  });
});

describe("resource descriptions", () => {
  test("the spec tag description becomes the resource description", () => {
    expect(getMonitor().description).toContain(
      "checks the health and availability",
    );
  });
});

describe("data source schema derivation", () => {
  const dataSource: TerraformDataSource | undefined = getParser()
    .getDataSources()
    .find((d: TerraformDataSource) => {
      return d.name === "monitor";
    });

  test("id and name are the optional lookup keys", () => {
    expect(dataSource?.schema["id"]?.optional).toBe(true);
    expect(dataSource?.schema["id"]?.computed).toBe(true);
    expect(dataSource?.schema["name"]?.optional).toBe(true);
  });

  test("all other fields are computed outputs", () => {
    expect(dataSource?.schema["monitor_type"]?.computed).toBe(true);
    expect(dataSource?.schema["monitor_type"]?.optional).toBeFalsy();
  });

  test("output fields preserve the API field name for response mapping", () => {
    expect(dataSource?.schema["monitor_type"]?.apiFieldName).toBe(
      "monitorType",
    );
  });
});

describe("warnings", () => {
  test("skipped resources are surfaced, not silent", () => {
    const parser: OpenAPIParser = new OpenAPIParser();
    const spec: any = buildFixtureSpec();
    // Break the Monitor create schema so it has zero writable fields.
    spec.components.schemas.MonitorCreateSchema = {
      type: "object",
      description: "Create schema for Monitor model. Create",
      properties: {},
    };
    parser.setSpec(spec);
    const resources: TerraformResource[] = parser.getResources();
    expect(
      resources.find((r: TerraformResource) => {
        return r.name === "monitor";
      }),
    ).toBeUndefined();
    expect(
      parser.warnings.some((w: string) => {
        return w.includes("monitor");
      }),
    ).toBe(true);
  });
});
