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
  test("exactly one of id or name must be set", () => {
    expect(monitorGo).toContain("hasId == hasName");
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
