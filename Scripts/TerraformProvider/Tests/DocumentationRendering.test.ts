import fs from "fs";
import os from "os";
import path from "path";
import {
  DocumentationGenerator,
  ProviderSchemaDump,
} from "../Core/DocumentationGenerator";
import { buildFixtureSpec } from "./Fixtures";

/*
 * The reference pages are rendered from the schema of the built provider
 * (provider_schema_dump_test.go), in tfplugindocs' layout. The dump here is a
 * hand-written slice of what that test writes.
 */

const schemaDump: ProviderSchemaDump = {
  resources: {
    oneuptime_monitor: {
      description: "A Monitor continuously checks a service.",
      attributes: {
        id: { type: "String", computed: true, description: "Unique id." },
        name: { type: "String", required: true, description: "Monitor name." },
        project_id: {
          type: "String",
          computed: true,
          description: "The project.",
        },
        is_paused: {
          type: "Boolean",
          optional: true,
          computed: true,
          description: "Paused?",
          default: "value defaults to `false`",
        },
        secret_token: {
          type: "String",
          optional: true,
          sensitive: true,
          description: "A secret.",
        },
        legacy_field: {
          type: "String",
          optional: true,
          deprecation: "Use name instead.",
        },
        monitor_steps: {
          type: "Attributes List",
          optional: true,
          computed: true,
          description: "What to check.",
          nested: {
            monitor_destination: {
              type: "String",
              optional: true,
              description: "Where to send the check.",
            },
            criteria: {
              type: "Attributes List",
              required: true,
              description: "When to change status.",
              nested: {
                filter_condition: {
                  type: "String",
                  required: true,
                  allowed_values: ["All", "Any"],
                },
                filters: {
                  type: "Attributes List",
                  required: true,
                  nested: {
                    check_on: {
                      type: "String",
                      required: true,
                      allowed_values: ["Is Online", "Response Status Code"],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  data_sources: {
    oneuptime_monitor_status: {
      attributes: {
        id: { type: "String", optional: true, computed: true },
        name: { type: "String", optional: true, computed: true },
        color: { type: "String", computed: true },
      },
    },
  },
};

let outputDir: string;
let withDumpDir: string;

function read(dir: string, file: string): string {
  return fs.readFileSync(path.join(dir, file), "utf-8");
}

beforeAll(async () => {
  const config: (dir: string) => any = (dir: string): any => {
    return {
      outputDir: dir,
      providerName: "oneuptime",
      providerVersion: "11.2.0",
      goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
    };
  };

  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-docs-plain-"));
  await new DocumentationGenerator(
    config(outputDir),
    buildFixtureSpec(),
  ).generateDocumentation();

  withDumpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-docs-dump-"));
  await new DocumentationGenerator(
    config(withDumpDir),
    buildFixtureSpec(),
    schemaDump,
  ).generateDocumentation();
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.rmSync(withDumpDir, { recursive: true, force: true });
});

describe("rendered from the built provider's schema", () => {
  let monitorDoc: string;

  beforeAll(() => {
    monitorDoc = read(withDumpDir, "docs/resources/monitor.md");
  });

  test("attributes land in Required, Optional and Read-Only as the provider declares them", () => {
    const required: string = monitorDoc.substring(
      monitorDoc.indexOf("### Required"),
      monitorDoc.indexOf("### Optional"),
    );
    const optional: string = monitorDoc.substring(
      monitorDoc.indexOf("### Optional"),
      monitorDoc.indexOf("### Read-Only"),
    );
    const readOnly: string = monitorDoc.substring(
      monitorDoc.indexOf("### Read-Only"),
      monitorDoc.indexOf("### Nested Schema"),
    );

    expect(required).toContain("- `name` (String) Monitor name.");
    expect(optional).toContain("- `monitor_steps` (Attributes List)");
    expect(readOnly).toContain("- `id` (String) Unique id.");
    // Computed-only, whatever the spec says about writing it.
    expect(readOnly).toContain("- `project_id` (String) The project.");
    expect(optional).not.toContain("project_id");
  });

  test("defaults, secrets and deprecations are spelled out", () => {
    expect(monitorDoc).toContain(
      "- `is_paused` (Boolean) Paused? Defaults to `false`.",
    );
    expect(monitorDoc).toContain(
      "- `secret_token` (String, Sensitive) A secret.",
    );
    expect(monitorDoc).toContain(
      "- `legacy_field` (String, Deprecated) **Deprecated:** Use name instead.",
    );
  });

  test("every nested attribute gets its own section, linked from its line", () => {
    expect(monitorDoc).toContain(
      "- `monitor_steps` (Attributes List) What to check. (see [below for nested schema](#nestedatt--monitor_steps))",
    );
    expect(monitorDoc).toContain('<a id="nestedatt--monitor_steps"></a>');
    expect(monitorDoc).toContain("### Nested Schema for `monitor_steps`");
    expect(monitorDoc).toContain(
      "- `criteria` (Attributes List) When to change status. (see [below for nested schema](#nestedatt--monitor_steps--criteria))",
    );
    expect(monitorDoc).toContain(
      '<a id="nestedatt--monitor_steps--criteria"></a>',
    );
    expect(monitorDoc).toContain(
      "### Nested Schema for `monitor_steps.criteria`",
    );
    expect(monitorDoc).toContain(
      "### Nested Schema for `monitor_steps.criteria.filters`",
    );
  });

  test("nested sections come parent first", () => {
    const steps: number = monitorDoc.indexOf(
      "### Nested Schema for `monitor_steps`",
    );
    const criteria: number = monitorDoc.indexOf(
      "### Nested Schema for `monitor_steps.criteria`",
    );
    const filters: number = monitorDoc.indexOf(
      "### Nested Schema for `monitor_steps.criteria.filters`",
    );
    expect(steps).toBeGreaterThan(-1);
    expect(criteria).toBeGreaterThan(steps);
    expect(filters).toBeGreaterThan(criteria);
  });

  test("nested sections are split Required / Optional too", () => {
    const steps: string = monitorDoc.substring(
      monitorDoc.indexOf("### Nested Schema for `monitor_steps`"),
      monitorDoc.indexOf("### Nested Schema for `monitor_steps.criteria`"),
    );
    expect(steps).toContain("Required:\n\n- `criteria`");
    expect(steps).toContain("Optional:\n\n- `monitor_destination`");
  });

  test("allowed values of nested enums are listed", () => {
    expect(monitorDoc).toContain(
      "- `filter_condition` (String) Allowed values: `All`, `Any`.",
    );
    expect(monitorDoc).toContain(
      "- `check_on` (String) Allowed values: `Is Online`, `Response Status Code`.",
    );
  });

  test("data source pages use the dump as well", () => {
    const statusDoc: string = read(
      withDumpDir,
      "docs/data-sources/monitor_status.md",
    );
    expect(statusDoc).toContain("### Optional\n\n- `id` (String)");
    expect(statusDoc).toContain("### Read-Only\n\n- `color` (String)");
  });
});

describe("pages without a dump", () => {
  test("still put computed-only attributes under Read-Only", () => {
    const monitorDoc: string = read(outputDir, "docs/resources/monitor.md");
    const readOnly: string = monitorDoc.substring(
      monitorDoc.indexOf("### Read-Only"),
    );
    expect(readOnly).toContain("`project_id`");
    expect(
      monitorDoc.substring(
        monitorDoc.indexOf("### Optional"),
        monitorDoc.indexOf("### Read-Only"),
      ),
    ).not.toContain("`project_id`");
  });
});

describe("examples", () => {
  test("refer to the resource an id points at, instead of a made-up UUID", () => {
    const fleetDoc: string = read(outputDir, "docs/resources/iot_fleet.md");
    expect(fleetDoc).toMatch(
      /monitor_status_id = oneuptime_monitor_status\.example\.id/,
    );
    expect(fleetDoc).not.toContain("123e4567-e89b-12d3-a456-426614174000");
  });

  test("give names a readable value", () => {
    const fleetDoc: string = read(outputDir, "docs/resources/iot_fleet.md");
    expect(fleetDoc).toMatch(/name\s+= "Example iot fleet"/);
  });

  test("write a wrapped scalar (a color) as its plain value", () => {
    const statusDoc: string = read(
      outputDir,
      "docs/resources/monitor_status.md",
    );
    expect(statusDoc).not.toContain("jsonencode");
  });

  test("the monitor page shows a whole working website monitor", () => {
    const monitorDoc: string = read(outputDir, "docs/resources/monitor.md");
    expect(monitorDoc).toContain('data "oneuptime_monitor_status" "offline"');
    expect(monitorDoc).toContain(
      "monitor_status_id     = data.oneuptime_monitor_status.offline.id",
    );
    expect(monitorDoc).toContain("auto_resolve_incident = true");
    expect(monitorDoc).not.toMatch(/\bid\s*=\s*"[0-9a-f-]{36}"/);
  });

  test("pin the provider to its major version", () => {
    expect(read(outputDir, "examples/provider.tf")).toContain(
      'version = "~> 11.0"',
    );
    expect(read(outputDir, "docs/index.md")).toContain('version = "~> 11.0"');
    expect(read(outputDir, "README.md")).toContain('version = "~> 11.0"');
  });
});

describe("renamed resources", () => {
  test("their page says what they were called and how to move", () => {
    const fleetDoc: string = read(outputDir, "docs/resources/iot_fleet.md");
    expect(fleetDoc).toContain(
      "this resource was called `oneuptime_io_t_fleet` before",
    );
    expect(fleetDoc).toContain("from = oneuptime_io_t_fleet.example");
    expect(fleetDoc).toContain("to   = oneuptime_iot_fleet.example");
  });

  test("the old name gets no page of its own", () => {
    expect(
      fs.existsSync(path.join(outputDir, "docs/resources/io_t_fleet.md")),
    ).toBe(false);
  });

  test("the provider index lists every rename", () => {
    const indexDoc: string = read(outputDir, "docs/index.md");
    expect(indexDoc).toContain("## Renamed resources");
    expect(indexDoc).toContain(
      "| `oneuptime_io_t_fleet` | [`oneuptime_iot_fleet`](./resources/iot_fleet) |",
    );
  });

  test("renamed data sources say so too", () => {
    const fleetDataDoc: string = read(
      outputDir,
      "docs/data-sources/iot_fleet.md",
    );
    expect(fleetDataDoc).toContain(
      "this data source was called `oneuptime_io_t_fleet` before",
    );
  });
});

describe("import", () => {
  test("is documented as an import block and on the command line", () => {
    const monitorDoc: string = read(outputDir, "docs/resources/monitor.md");
    expect(monitorDoc).toContain(
      'import {\n  to = oneuptime_monitor.example\n  id = "<id>"\n}',
    );
    expect(monitorDoc).toContain(
      "terraform import oneuptime_monitor.example <id>",
    );
  });
});

describe("data source pages", () => {
  test("explain the lookup and show it by name", () => {
    const statusDoc: string = read(
      outputDir,
      "docs/data-sources/monitor_status.md",
    );
    expect(statusDoc).toContain(
      "Look one up by `id`, or by any of its other arguments",
    );
    expect(statusDoc).toContain(
      'data "oneuptime_monitor_status" "example" {\n  name = "Example monitor status"\n}',
    );
    expect(statusDoc).toContain('data "oneuptime_monitor_status" "by_id" {');
  });

  test("a model without a name is looked up by another argument", () => {
    const emailLogDoc: string = read(
      outputDir,
      "docs/data-sources/email_log.md",
    );
    expect(emailLogDoc).toMatch(
      /data "oneuptime_email_log" "example" \{\n {2}(status|to_email) = "example-/,
    );
  });

  test("the provider index shows a lookup", () => {
    const indexDoc: string = read(outputDir, "docs/index.md");
    expect(indexDoc).toContain('data "oneuptime_monitor_status" "offline" {');
    expect(indexDoc).toContain("exactly one item may match them all");
  });
});

describe("ids inside resources", () => {
  test("the provider index says never to write them", () => {
    expect(read(outputDir, "docs/index.md")).toContain(
      "## IDs inside resources",
    );
  });
});
