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

  test("plain fields are lookup arguments as well as outputs", () => {
    expect(dataSource?.schema["monitor_type"]?.computed).toBe(true);
    expect(dataSource?.schema["monitor_type"]?.optional).toBe(true);
    expect(dataSource?.schema["monitor_type"]?.isLookupFilter).toBe(true);
    expect(dataSource?.schema["priority"]?.isLookupFilter).toBe(true);
    expect(dataSource?.schema["is_paused"]?.isLookupFilter).toBe(true);
  });

  test("JSON, timestamps, lists and the project are outputs only", () => {
    for (const name of [
      "server_meta",
      "disable_monitoring_datetime",
      "labels",
      "project_id",
      "monitor_steps",
    ]) {
      expect({
        name,
        optional: Boolean(dataSource?.schema[name]?.optional),
        computed: dataSource?.schema[name]?.computed,
      }).toEqual({ name, optional: false, computed: true });
    }
  });

  test("name is only a lookup argument on models that have one", () => {
    const fleet: TerraformDataSource | undefined = getParser()
      .getDataSources()
      .find((d: TerraformDataSource) => {
        return d.name === "email_log";
      });
    expect(fleet?.schema["name"]).toBeUndefined();
    expect(fleet?.schema["to_email"]?.isLookupFilter).toBe(true);
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

describe("relations", () => {
  /*
   * The spec says which model an id column points at (x-oneuptime-relation).
   * An id is only useful to someone who knows what it is the id of.
   */
  test("a relation id names the resource it points at", () => {
    const attr: TerraformAttribute | undefined =
      getMonitor().schema["current_monitor_status_id"];

    expect(attr?.relation).toEqual({ name: "monitor_status", isList: false });
    expect(attr?.description).toBe(
      "Whats the current status of this monitor? The ID of a `oneuptime_monitor_status`.",
    );
  });

  test("a relation list names its records, and says when there is no resource for them", () => {
    const attr: TerraformAttribute | undefined = getMonitor().schema["labels"];

    // Label has only a list endpoint in the fixture: a data source, no resource.
    expect(attr?.relation).toEqual({ name: "label", isList: true });
    expect(attr?.description).toBe(
      "Attached labels. IDs of `oneuptime_label` records.",
    );
  });

  test("a relation to a model Terraform has nothing for is left alone", () => {
    // A deep copy: the fixture's schemas are shared module-level objects.
    const spec: any = JSON.parse(JSON.stringify(buildFixtureSpec()));
    spec.components.schemas.MonitorCreateSchema.properties.currentMonitorStatusId[
      "x-oneuptime-relation"
    ] = { tag: "Something Internal", tableName: "SomethingInternal" };
    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(spec);
    const monitor: TerraformResource = parser
      .getResources()
      .find((r: TerraformResource) => {
        return r.name === "monitor";
      })!;

    expect(
      monitor.schema["current_monitor_status_id"]?.relation,
    ).toBeUndefined();
    expect(
      monitor.schema["current_monitor_status_id"]?.description,
    ).not.toContain("oneuptime_");
  });

  test("data sources know their relations too", () => {
    const dataSource: TerraformDataSource | undefined = getParser()
      .getDataSources()
      .find((d: TerraformDataSource) => {
        return d.name === "monitor";
      });

    expect(dataSource?.schema["current_monitor_status_id"]?.relation).toEqual({
      name: "monitor_status",
      isList: false,
    });
  });
});

describe("descriptions", () => {
  const DOUBLED_STOP: RegExp = new RegExp("(\\.\\.|\\?\\.|!\\.)$");
  const ENDS_A_SENTENCE: RegExp = new RegExp("[.!?:`]$");

  test("end in exactly one full stop", () => {
    for (const [name, attr] of Object.entries(getMonitor().schema)) {
      const description: string = attr.description || "";
      if (!description) {
        continue;
      }
      expect({ name, doubled: DOUBLED_STOP.test(description) }).toEqual({
        name,
        doubled: false,
      });
      expect({ name, ends: ENDS_A_SENTENCE.test(description) }).toEqual({
        name,
        ends: true,
      });
    }
  });
});

describe("bookkeeping fields", () => {
  /*
   * Every model carries the soft-delete pair and an optimistic-locking
   * counter. Shown, they say nothing and add a "(known after apply)" line to
   * every plan.
   */
  test("are not part of a resource", () => {
    const schema: Record<string, TerraformAttribute> = getMonitor().schema;
    expect(schema["deleted_at"]).toBeUndefined();
    expect(schema["deleted_by_user_id"]).toBeUndefined();
    expect(schema["version"]).toBeUndefined();
  });

  test("are not part of a data source", () => {
    const dataSource: TerraformDataSource | undefined = getParser()
      .getDataSources()
      .find((d: TerraformDataSource) => {
        return d.name === "monitor";
      });
    expect(dataSource?.schema["deleted_at"]).toBeUndefined();
    expect(dataSource?.schema["version"]).toBeUndefined();
  });

  test("a version that is a real field is kept", () => {
    expect(
      OpenAPIParser.isBookkeepingField("version", {
        type: "string",
      } as TerraformAttribute),
    ).toBe(false);
    expect(
      OpenAPIParser.isBookkeepingField("version", {
        type: "number",
      } as TerraformAttribute),
    ).toBe(true);
  });

  test("other read-only fields stay", () => {
    expect(getMonitor().schema["created_at"]?.computed).toBe(true);
    expect(getMonitor().schema["created_by_user_id"]?.computed).toBe(true);
  });
});

describe("list-only models", () => {
  test("their data sources carry the model's fields, read from the list response", () => {
    const emailLog: TerraformDataSource | undefined = getParser()
      .getDataSources()
      .find((d: TerraformDataSource) => {
        return d.name === "email_log";
      });

    expect(Object.keys(emailLog?.schema || {}).sort()).toEqual([
      "id",
      "status",
      "to_email",
    ]);
    expect(emailLog?.schema["status"]?.isLookupFilter).toBe(true);
  });
});

describe("JSON attributes", () => {
  test("say to write them with jsonencode()", () => {
    expect(getMonitor().schema["server_meta"]?.description).toBe(
      "Arbitrary nested metadata. A JSON value: write it with `jsonencode()`.",
    );
  });

  test("a wrapped scalar is a plain value, not JSON", () => {
    const status: TerraformResource = getParser()
      .getResources()
      .find((r: TerraformResource) => {
        return r.name === "monitor_status";
      })!;
    expect(status.schema["color"]?.description).toBe("Color of the status.");
  });
});
