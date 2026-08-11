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

describe("curation", () => {
  test("resource pages carry a registry subcategory", () => {
    expect(monitorDoc).toContain('subcategory: "Monitors"');
    expect(fileDoc).toContain('subcategory: "Organization"');
  });

  test("the provider index has a start-here section", () => {
    const indexDoc: string = fs.readFileSync(
      path.join(outputDir, "docs/index.md"),
      "utf-8",
    );
    expect(indexDoc).toContain("## Start Here");
    expect(indexDoc).toContain("oneuptime_monitor");
    expect(indexDoc).toContain("./resources/monitor");
  });

  test("resource pages open with the model's real description", () => {
    expect(monitorDoc).toContain("checks the health and availability");
  });

  test("typed monitor steps render as nested blocks, not jsonencode", () => {
    expect(monitorDoc).toContain("monitor_destination");
    expect(monitorDoc).toContain("Block List");
    expect(monitorDoc).not.toContain('monitor_steps = "example-');
  });
});

describe("opentofu", () => {
  test("a registry guide page is generated", () => {
    const guide: string = fs.readFileSync(
      path.join(outputDir, "docs/guides/opentofu.md"),
      "utf-8",
    );
    // The registry only renders a guide when the frontmatter names it.
    expect(guide).toContain('subcategory: "Guides"');
    expect(guide).toContain("page_title:");
    expect(guide).toContain("tofu init");
  });

  test("the guide keeps the registry hostname out of the source address", () => {
    const guide: string = fs.readFileSync(
      path.join(outputDir, "docs/guides/opentofu.md"),
      "utf-8",
    );
    /*
     * A hostname-qualified source pins config to one registry and breaks the
     * other engine — the whole point of the guide is to not do that.
     */
    expect(guide).toContain('source  = "oneuptime/oneuptime"');
    expect(guide).not.toContain(
      'source  = "registry.terraform.io/oneuptime/oneuptime"',
    );
  });

  test("the provider index links to the guide", () => {
    const indexDoc: string = fs.readFileSync(
      path.join(outputDir, "docs/index.md"),
      "utf-8",
    );
    expect(indexDoc).toContain("./guides/opentofu");
  });
});

describe("shipped modules", () => {
  /*
   * The module source address is published in the OneUptime docs, in the
   * generated README and in the OpenTofu guide. If generation stops emitting
   * modules/, every one of those links 404s on the next release.
   */
  test("the reusable module is copied into the provider tree", () => {
    const moduleDir: string = path.join(
      outputDir,
      "modules/monitoring-and-incident-response",
    );
    for (const file of [
      "main.tf",
      "variables.tf",
      "outputs.tf",
      "versions.tf",
      "README.md",
    ]) {
      expect(fs.existsSync(path.join(moduleDir, file))).toBe(true);
    }
  });

  test("the copied module declares the provider without a registry hostname", () => {
    const versions: string = fs.readFileSync(
      path.join(
        outputDir,
        "modules/monitoring-and-incident-response/versions.tf",
      ),
      "utf-8",
    );
    expect(versions).toContain('source  = "oneuptime/oneuptime"');
    /*
     * Assert on source lines only. The file's comments legitimately name both
     * registry hostnames while explaining why the address omits them.
     */
    const sourceLine: RegExp = /^\s*source\s*=/;
    const sourceLines: Array<string> = versions
      .split("\n")
      .filter((line: string) => {
        return sourceLine.test(line);
      });
    expect(sourceLines.length).toBeGreaterThan(0);
    for (const line of sourceLines) {
      expect(line).not.toMatch(/registry\.(terraform\.io|opentofu\.org)/);
    }
  });

  test("the README points at the module", () => {
    const readme: string = fs.readFileSync(
      path.join(outputDir, "README.md"),
      "utf-8",
    );
    expect(readme).toContain("modules/monitoring-and-incident-response");
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
