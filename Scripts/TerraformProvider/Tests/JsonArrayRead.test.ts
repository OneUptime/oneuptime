/*
 * A JSON value the API answers as an array - a runbook's steps, for one - has
 * to be read back as the array, written as JSON. The read paths took a JSON
 * value only as an object or as a string, so an array became null, and every
 * apply that set one failed with "Provider produced inconsistent result after
 * apply" (OneUptime/terraform-provider-oneuptime#18).
 *
 * StaticFiles/jsonarray_roundtrip_test.go proves the behaviour through the
 * real protocol server. These hold the generator to emitting it: wherever a
 * read takes a value as an object, it takes it as an array too, in resources
 * (JSON attributes and plain strings alike) and in data sources.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { DataSourceGenerator } from "../Core/DataSourceGenerator";
import { ProviderGenerator } from "../Core/ProviderGenerator";
import { ResourceGenerator } from "../Core/ResourceGenerator";
import { buildFixtureSpec } from "./Fixtures";

const GENERATED_DIR: string = "internal/provider";

let outputDir: string;
let monitorResourceGo: string;
let monitorDataSourceGo: string;

beforeAll(async () => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-json-array-"));
  const config: {
    outputDir: string;
    providerName: string;
    providerVersion: string;
    goModuleName: string;
  } = {
    outputDir,
    providerName: "oneuptime",
    providerVersion: "14.0.0",
    goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
  };
  const spec: ReturnType<typeof buildFixtureSpec> = buildFixtureSpec();

  await new ProviderGenerator(config, spec).generateProvider();
  await new ResourceGenerator(config, spec).generateResources();
  await new DataSourceGenerator(config, spec).generateDataSources();

  monitorResourceGo = fs.readFileSync(
    path.join(outputDir, GENERATED_DIR, "resource_monitor.go"),
    "utf-8",
  );
  monitorDataSourceGo = fs.readFileSync(
    path.join(outputDir, GENERATED_DIR, "data_source_monitor.go"),
    "utf-8",
  );
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

// How many times `source` reads the API's value of `field` as `goType`.
function readsAs(source: string, field: string, goType: string): number {
  return source.split(`["${field}"].(${goType}); ok {`).length - 1;
}

describe("a resource's reads", () => {
  test.each([
    ["a JSON attribute", "serverMeta"],
    ["a plain string attribute", "name"],
  ])(
    "take %s as an array wherever they take it as an object",
    (_kind: string, field: string) => {
      const asObject: number = readsAs(
        monitorResourceGo,
        field,
        "map[string]interface{}",
      );

      // Create, read and update each read the value back.
      expect(asObject).toBeGreaterThanOrEqual(3);
      expect(readsAs(monitorResourceGo, field, "[]interface{}")).toBe(asObject);
    },
  );

  test("write the array as JSON, keeping the JSON attribute's type", () => {
    const branch: string = monitorResourceGo.slice(
      monitorResourceGo.indexOf('["serverMeta"].([]interface{}); ok {'),
    );

    expect(branch).toContain(
      "json.Marshal(r.normalizeURLWrappers(arr)); err == nil {",
    );
    expect(branch.slice(0, branch.indexOf("} else if"))).toContain(
      "NewJSONSubsetValue(string(jsonBytes))",
    );
  });
});

describe("a data source's reads", () => {
  test("take a JSON attribute as an array wherever they take it as an object", () => {
    const asObject: number = readsAs(
      monitorDataSourceGo,
      "serverMeta",
      "map[string]interface{}",
    );

    expect(asObject).toBeGreaterThanOrEqual(1);
    expect(readsAs(monitorDataSourceGo, "serverMeta", "[]interface{}")).toBe(
      asObject,
    );
  });
});

describe("the round-trip test", () => {
  test("is copied into the generated provider", () => {
    const copied: string = path.join(
      outputDir,
      GENERATED_DIR,
      "jsonarray_roundtrip_test.go",
    );

    expect(fs.readFileSync(copied, "utf-8")).toContain(
      "func TestRunbookSteps_CreateRefreshAndUpdateKeepTheArray(",
    );
  });
});
