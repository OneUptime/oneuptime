import fs from "fs";
import os from "os";
import path from "path";
import { DocumentationGenerator } from "../Core/DocumentationGenerator";
import { buildFixtureSpec } from "./Fixtures";

let outputDir: string;
let monitorDoc: string;
let providerExample: string;
let fileDoc: string;

beforeAll(async () => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-docs-"));
  const generator: DocumentationGenerator = new DocumentationGenerator(
    {
      outputDir,
      providerName: "oneuptime",
      providerVersion: "11.0.0",
      goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
    },
    buildFixtureSpec(),
  );
  await generator.generateDocumentation();
  monitorDoc = fs.readFileSync(
    path.join(outputDir, "docs/resources/monitor.md"),
    "utf-8",
  );
  fileDoc = fs.readFileSync(
    path.join(outputDir, "docs/resources/file.md"),
    "utf-8",
  );
  providerExample = fs.readFileSync(
    path.join(outputDir, "examples/provider.tf"),
    "utf-8",
  );
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("shipped examples", () => {
  test("provider example uses real attributes (no fictional host)", () => {
    expect(providerExample).toContain("oneuptime_url");
    expect(providerExample).not.toMatch(/^\s*host\s*=/m);
  });

  test("enum attributes use an allowed value, not a placeholder", () => {
    expect(monitorDoc).toContain('monitor_type = "Manual"');
    expect(monitorDoc).not.toContain('"example-monitor_type"');
  });
});

describe("schema reference", () => {
  test("sections are split Required / Optional / Read-Only", () => {
    expect(monitorDoc).toContain("### Required");
    expect(monitorDoc).toContain("### Optional");
    expect(monitorDoc).toContain("### Read-Only");
  });

  test("enum values are documented", () => {
    expect(monitorDoc).toContain("Allowed values");
    expect(monitorDoc).toContain("`Manual`");
  });

  test("no fake tfplugindocs attribution", () => {
    expect(monitorDoc).not.toContain("terraform-plugin-docs");
  });
});

describe("import docs", () => {
  test("importable resources document the import command", () => {
    expect(monitorDoc).toContain(
      "terraform import oneuptime_monitor.example <id>",
    );
  });

  test("read-less resources say import is unsupported", () => {
    expect(fileDoc).toContain("does not support import");
    expect(fileDoc).not.toContain("terraform import oneuptime_file.example");
  });
});
