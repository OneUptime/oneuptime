import fs from "fs";
import os from "os";
import path from "path";
import { ResourceGenerator } from "../Core/ResourceGenerator";
import { buildFixtureSpec } from "./Fixtures";

/*
 * These tests generate real Go source from the fixture spec and assert the
 * emitted text encodes the behaviors that fixed the historical bug classes.
 * The generated tree also gets compiled and `go test`ed by CI after full
 * generation; these tests pin the per-defect codegen decisions.
 */

let outputDir: string;
let monitorGo: string;
let fileGo: string;

beforeAll(async () => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-resource-"));
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
  monitorGo = fs.readFileSync(
    path.join(outputDir, "internal/provider/resource_monitor.go"),
    "utf-8",
  );
  fileGo = fs.readFileSync(
    path.join(outputDir, "internal/provider/resource_file.go"),
    "utf-8",
  );
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("create request body", () => {
  test("every field is guarded against null/unknown", () => {
    /*
     * The unguarded body sent ""/false/null for unset optionals, overriding
     * server defaults — the root cause of create-time data corruption.
     */
    const createBody: string = monitorGo.substring(
      monitorGo.indexOf("func (r *MonitorResource) Create"),
      monitorGo.indexOf("func (r *MonitorResource) Read"),
    );
    expect(createBody).toContain(
      "if !data.Name.IsNull() && !data.Name.IsUnknown()",
    );
    expect(createBody).toContain(
      "if !data.Description.IsNull() && !data.Description.IsUnknown()",
    );
    // No unconditional scalar assignment may remain in the create body.
    expect(createBody).not.toMatch(
      /"description": data\.Description\.ValueString\(\),/,
    );
  });

  test("server-inferred project id is never sent", () => {
    const createBody: string = monitorGo.substring(
      monitorGo.indexOf("func (r *MonitorResource) Create"),
      monitorGo.indexOf("func (r *MonitorResource) Read"),
    );
    expect(createBody).not.toContain('requestDataMap["projectId"]');
  });

  test("create re-reads through get-item so state is authoritative", () => {
    const createBody: string = monitorGo.substring(
      monitorGo.indexOf("func (r *MonitorResource) Create"),
      monitorGo.indexOf("func (r *MonitorResource) Read"),
    );
    expect(createBody).toContain("/get-item");
    expect(createBody).toContain("PostWithSelect");
  });

  test("create without a read endpoint maps the create response instead", () => {
    const createBody: string = fileGo.substring(
      fileGo.indexOf("func (r *FileResource) Create"),
      fileGo.indexOf("func (r *FileResource) Read"),
    );
    expect(createBody).not.toContain("PostWithSelect");
  });
});

describe("delete", () => {
  test("failed deletes keep state instead of orphaning infrastructure", () => {
    const deleteBody: string = monitorGo.substring(
      monitorGo.indexOf("func (r *MonitorResource) Delete"),
      monitorGo.indexOf("func (r *MonitorResource) ImportState"),
    );
    expect(deleteBody).toContain("httpResp.StatusCode >= 400");
    expect(deleteBody).toContain("http.StatusNotFound");
  });
});

describe("schema attributes", () => {
  test("immutable fields get RequiresReplace", () => {
    expect(monitorGo).toContain("stringplanmodifier.RequiresReplace()");
  });

  test("enum fields get a OneOf validator", () => {
    expect(monitorGo).toContain(
      'stringvalidator.OneOf("Manual", "Website", "Ping")',
    );
  });

  test("password-format fields are sensitive", () => {
    const schemaBody: string = monitorGo.substring(
      monitorGo.indexOf("func (r *MonitorResource) Schema"),
      monitorGo.indexOf("func (r *MonitorResource) Configure"),
    );
    const secretAttr: string = schemaBody.substring(
      schemaBody.indexOf('"secret_token"'),
      schemaBody.indexOf('"secret_token"') + 500,
    );
    expect(secretAttr).toContain("Sensitive: true");
  });

  test("date fields use the RFC3339 semantic type", () => {
    expect(monitorGo).toContain("DisableMonitoringDatetime RFC3339Value");
    const schemaBody: string = monitorGo.substring(
      monitorGo.indexOf("func (r *MonitorResource) Schema"),
      monitorGo.indexOf("func (r *MonitorResource) Configure"),
    );
    const dateAttr: string = schemaBody.substring(
      schemaBody.indexOf('"disable_monitoring_datetime"'),
      schemaBody.indexOf('"disable_monitoring_datetime"') + 500,
    );
    expect(dateAttr).toContain("CustomType: RFC3339Type{}");
  });

  test("complex JSON fields keep the subset-equality type", () => {
    expect(monitorGo).toContain("ServerMeta JSONSubsetValue");
  });

  test("resource descriptions come from the spec's tag description", () => {
    expect(monitorGo).toContain("checks the health and availability");
    expect(monitorGo).not.toContain('MarkdownDescription: "monitor resource"');
  });
});

describe("arrays", () => {
  test("entity arrays are wrapped as {_id}, scalar arrays are not", () => {
    const createBody: string = monitorGo.substring(
      monitorGo.indexOf("func (r *MonitorResource) Create"),
      monitorGo.indexOf("func (r *MonitorResource) Read"),
    );
    expect(createBody).toContain(
      'requestDataMap["labels"] = r.convertTerraformSetToInterface(data.Labels)',
    );
    expect(createBody).toContain(
      'requestDataMap["tags"] = r.convertTerraformSetToScalarSlice(data.Tags, false)',
    );
  });

  test("scalar converter helpers are emitted only when needed", () => {
    expect(monitorGo).toContain("convertTerraformSetToScalarSlice");
    expect(fileGo).not.toContain("convertTerraformSetToScalarSlice");
  });
});

describe("select and response mapping", () => {
  test("write-only fields are excluded from select", () => {
    // Selecting non-readable columns made the server reject the entire Read.
    expect(monitorGo).not.toContain('"secretToken": true');
    expect(monitorGo).toContain('"monitorType": true');
    expect(monitorGo).toContain('"_id": true');
  });

  test("write-only fields are never mapped from responses", () => {
    const readBody: string = monitorGo.substring(
      monitorGo.indexOf("func (r *MonitorResource) Read"),
      monitorGo.indexOf("func (r *MonitorResource) Update"),
    );
    expect(readBody).not.toContain('dataMap["secretToken"]');
  });
});

describe("update", () => {
  test("update never writes unverified plan values into state", () => {
    const updateBody: string = monitorGo.substring(
      monitorGo.indexOf("func (r *MonitorResource) Update"),
      monitorGo.indexOf("func (r *MonitorResource) Delete"),
    );
    /*
     * The empty-body short-circuit used to `return` with the plan written to
     * state; now the read-back always runs.
     */
    expect(updateBody).toContain("PostWithSelect");
    expect(updateBody).toContain("readResponse");
  });
});

describe("import", () => {
  test("resources with a read endpoint use passthrough import", () => {
    expect(monitorGo).toContain("resource.ImportStatePassthroughID");
  });

  test("read-less resources error on import instead of faking state", () => {
    expect(fileGo).not.toContain("ImportStatePassthroughID");
    expect(fileGo).toContain("Import Not Supported");
  });
});

describe("typed monitor steps", () => {
  test("the model field is a typed list, not a JSON string", () => {
    expect(monitorGo).toContain("MonitorSteps types.List");
    expect(monitorGo).not.toContain("MonitorSteps JSONSubsetValue");
  });

  test("the schema uses the hand-written nested attribute", () => {
    expect(monitorGo).toContain(
      '"monitor_steps": MonitorStepsSchemaAttribute(',
    );
  });

  test("create converts through MonitorStepsToAPI with a null guard", () => {
    const createBody: string = monitorGo.substring(
      monitorGo.indexOf("func (r *MonitorResource) Create"),
      monitorGo.indexOf("func (r *MonitorResource) Read"),
    );
    expect(createBody).toContain(
      "if !data.MonitorSteps.IsNull() && !data.MonitorSteps.IsUnknown()",
    );
    expect(createBody).toContain("MonitorStepsToAPI(ctx, data.MonitorSteps)");
  });

  test("responses convert through MonitorStepsFromAPI", () => {
    const readBody: string = monitorGo.substring(
      monitorGo.indexOf("func (r *MonitorResource) Read"),
      monitorGo.indexOf("func (r *MonitorResource) Update"),
    );
    expect(readBody).toContain(
      'MonitorStepsFromAPI(ctx, dataMap["monitorSteps"])',
    );
  });

  test("updates convert through MonitorStepsToAPI on change", () => {
    const updateBody: string = monitorGo.substring(
      monitorGo.indexOf("func (r *MonitorResource) Update"),
      monitorGo.indexOf("func (r *MonitorResource) Delete"),
    );
    expect(updateBody).toContain("MonitorStepsToAPI(ctx, data.MonitorSteps)");
  });
});

describe("envelope validation", () => {
  test("writable complex-JSON fields get the plan-time validator", () => {
    const schemaBody: string = monitorGo.substring(
      monitorGo.indexOf("func (r *MonitorResource) Schema"),
      monitorGo.indexOf("func (r *MonitorResource) Configure"),
    );
    const serverMetaAttr: string = schemaBody.substring(
      schemaBody.indexOf('"server_meta"'),
      schemaBody.indexOf('"server_meta"') + 600,
    );
    expect(serverMetaAttr).toContain("JSONEnvelopeValidator()");
  });

  test("the shared ObjectType registry is emitted once at package level", () => {
    const objectTypesGo: string = fs.readFileSync(
      path.join(outputDir, "internal/provider/objecttypes.go"),
      "utf-8",
    );
    expect(objectTypesGo).toContain("var validOneUptimeObjectTypes");
    expect(objectTypesGo).toContain('"DateTime": true');
    // Resources delegate to the registry instead of duplicating the map.
    expect(monitorGo).toContain("return validOneUptimeObjectTypes[typeStr]");
  });
});

describe("client context", () => {
  test("all client calls propagate ctx", () => {
    expect(monitorGo).not.toMatch(
      /r\.client\.(Post|Put|Patch|Delete|PostWithSelect)\("(?!ctx)/,
    );
    expect(monitorGo).toContain('r.client.Post(ctx, "/monitor"');
    expect(monitorGo).toContain("r.client.Delete(ctx,");
  });
});
