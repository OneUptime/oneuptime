import fs from "fs";
import os from "os";
import path from "path";
import { DataSourceGenerator } from "../Core/DataSourceGenerator";
import { buildFixtureSpec } from "./Fixtures";

let outputDir: string;
let monitorGo: string;
let dataSourcesGo: string;

beforeAll(async () => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-datasource-"));
  const generator: DataSourceGenerator = new DataSourceGenerator(
    {
      outputDir,
      providerName: "oneuptime",
      providerVersion: "11.0.0",
      goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
    },
    buildFixtureSpec(),
  );
  await generator.generateDataSources();
  monitorGo = fs.readFileSync(
    path.join(outputDir, "internal/provider/data_source_monitor.go"),
    "utf-8",
  );
  dataSourcesGo = fs.readFileSync(
    path.join(outputDir, "internal/provider/data_sources.go"),
    "utf-8",
  );
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("naming", () => {
  test("data source type matches the resource type (no _data suffix)", () => {
    expect(monitorGo).toContain(
      'resp.TypeName = req.ProviderTypeName + "_monitor"',
    );
    expect(monitorGo).not.toContain("_monitor_data");
  });

  test("read-only models are registered as data sources", () => {
    expect(dataSourcesGo).toContain("NewEmailLogDataSource");
  });
});

describe("lookup semantics", () => {
  test("id, or at least one other argument - never both, never neither", () => {
    expect(monitorGo).toContain("if hasId && len(filters) > 0 {");
    expect(monitorGo).toContain("if !hasId && len(filters) == 0 {");
    expect(monitorGo).toContain("Invalid Lookup");
  });

  test("id lookups hit get-item with the full select", () => {
    expect(monitorGo).toContain("/get-item");
    expect(monitorGo).toContain("PostWithSelect(ctx,");
    expect(monitorGo).toContain('"monitorType": true');
  });

  test("name lookups error on zero and on multiple matches", () => {
    expect(monitorGo).toContain("len(items) == 0");
    expect(monitorGo).toContain("len(items) > 1");
    expect(monitorGo).toContain("Ambiguous Match");
    // The old generator silently took the first item of unbounded lists.
    expect(monitorGo).toContain('"limit": 2');
  });
});

describe("monitor steps on data sources", () => {
  test("monitor_steps is exposed as its raw JSON string (read-only)", () => {
    expect(monitorGo).toContain("MonitorSteps types.String");
  });
});

describe("response mapping", () => {
  test("mapping keys use the API's camelCase field names", () => {
    /*
     * The old generator indexed responses by the snake_case Terraform name,
     * so every multi-word field came back null.
     */
    expect(monitorGo).toContain('item["monitorType"]');
    expect(monitorGo).not.toContain('item["monitor_type"]');
  });

  test("id maps from the API's _id", () => {
    expect(monitorGo).toContain('item["_id"]');
  });
});

describe("lookup by arguments", () => {
  /*
   * Any plain attribute set in configuration is a filter on the list, so a
   * data source works for models without a name, and a lookup can be as
   * specific as it needs to be.
   */
  test("every plain attribute is a filter, keyed by its API field", () => {
    expect(monitorGo).toContain(
      'filters["monitorType"] = data.MonitorType.ValueString()',
    );
    expect(monitorGo).toContain(
      'filters["priority"] = lookupNumber(data.Priority)',
    );
    expect(monitorGo).toContain(
      'filters["isPaused"] = data.IsPaused.ValueBool()',
    );
    expect(monitorGo).toContain('filters["name"] = data.Name.ValueString()');
  });

  test("only what is set in configuration filters", () => {
    expect(monitorGo).toContain(
      "if !data.MonitorType.IsNull() && !data.MonitorType.IsUnknown() {",
    );
  });

  test("JSON, lists, timestamps and the project are never filters", () => {
    for (const field of [
      "serverMeta",
      "labels",
      "disableMonitoringDatetime",
      "projectId",
      "monitorSteps",
    ]) {
      expect(monitorGo).not.toContain(`filters["${field}"]`);
    }
  });

  test("the lookup sends the filters as the list query", () => {
    expect(monitorGo).toContain('"query":  filters,');
  });

  test("errors say what was looked up, in Terraform's own terms", () => {
    expect(monitorGo).toContain(
      'filterNames = append(filterNames, "monitor_type = "+fmt.Sprintf("%q", data.MonitorType.ValueString()))',
    );
    expect(monitorGo).toContain("describeLookup(filterNames)");
  });

  test("the lookup helpers ship with the provider", () => {
    for (const file of ["lookup.go", "lookup_test.go"]) {
      expect(
        fs.existsSync(path.join(outputDir, "internal/provider", file)),
      ).toBe(true);
    }
  });
});

describe("a model with a list endpoint but no get endpoint", () => {
  let emailLogGo: string;

  beforeAll(() => {
    emailLogGo = fs.readFileSync(
      path.join(outputDir, "internal/provider/data_source_email_log.go"),
      "utf-8",
    );
  });

  test("is looked up by id through the list", () => {
    expect(emailLogGo).toContain('filters["_id"] = data.Id.ValueString()');
    expect(emailLogGo).toContain("if item == nil {");
    expect(emailLogGo).not.toContain("/get-item");
  });

  test("can be looked up by its fields", () => {
    expect(emailLogGo).toContain(
      'filters["toEmail"] = data.ToEmail.ValueString()',
    );
  });
});

describe("a renamed data source", () => {
  let fleetGo: string;

  beforeAll(() => {
    fleetGo = fs.readFileSync(
      path.join(outputDir, "internal/provider/data_source_iot_fleet.go"),
      "utf-8",
    );
  });

  test("keeps its old name as a deprecated alias", () => {
    expect(fleetGo).toContain(
      'resp.TypeName = req.ProviderTypeName + "_iot_fleet"',
    );
    expect(fleetGo).toContain(
      'resp.TypeName = req.ProviderTypeName + "_io_t_fleet"',
    );
    expect(fleetGo).toContain("resp.Schema.DeprecationMessage =");
    expect(dataSourcesGo).toContain("NewIotFleetLegacyDataSource,");
    expect(dataSourcesGo).toContain(
      '{Name: "iot_fleet", LegacyName: "io_t_fleet", New: NewIotFleetDataSource, NewLegacy: NewIotFleetLegacyDataSource},',
    );
  });

  test("an unrenamed one has no alias", () => {
    expect(monitorGo).not.toContain("isLegacyAlias");
    expect(dataSourcesGo).not.toContain("NewMonitorLegacyDataSource");
  });
});

describe("the data source's description", () => {
  test("says how to look one up, naming its arguments", () => {
    expect(monitorGo).toContain(
      "Look up an existing monitor by `id`, or by any of its other arguments (`name`,",
    );
  });
});
