import fs from "fs";
import os from "os";
import path from "path";
import {
  DocumentationGenerator,
  ProviderSchemaDump,
  SchemaDumpAttribute,
} from "../Core/DocumentationGenerator";
import { buildFixtureSpec } from "./Fixtures";

/*
 * The provider's release notes (GenerateReleaseNotes.js) say what a release
 * changed by reading its pages and the pages of the release before it: every
 * attribute of every resource and data source, whether it is required,
 * optional or read-only, its type, whether it is sensitive or deprecated, the
 * values it takes and its default. This suite renders pages with this
 * generator and reads them with the notes, so a change to how the pages are
 * written that the notes cannot read fails here, rather than leaving every
 * release with notes that say nothing changed.
 *
 * Tests/Ops/TerraformProviderReleaseNotes.test.js tests the notes on their
 * own.
 */

interface ReadAttribute {
  name: string;
  kind: "required" | "optional" | "read-only";
  type: string;
  sensitive: boolean;
  deprecated: boolean;
  allowedValues: Array<string> | null;
  defaultValue: string | null;
}

interface ReadPage {
  kind: "resource" | "data source";
  name: string;
  subcategory: string | null;
  description: string | null;
  attributes: Map<string, ReadAttribute>;
}

interface AttributeChange {
  kind: string;
  name: string;
  breaking: boolean;
  [detail: string]: unknown;
}

interface ReleaseNotes {
  parsePage: (file: string, markdown: string) => ReadPage;
  compareAttributes: (
    previous: Map<string, ReadAttribute>,
    current: Map<string, ReadAttribute>,
  ) => Array<AttributeChange>;
}

// Plain Node.js, which the publish script runs with nothing installed.
const releaseNotes: ReleaseNotes = jest.requireActual(
  "../GenerateReleaseNotes",
);

function monitorAttributes(): Record<string, SchemaDumpAttribute> {
  return {
    id: { type: "String", computed: true, description: "Unique id." },
    name: { type: "String", required: true, description: "Monitor name." },
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
        criteria: {
          type: "Attributes List",
          required: true,
          nested: {
            filter_condition: {
              type: "String",
              required: true,
              allowed_values: ["All", "Any"],
            },
          },
        },
      },
    },
  };
}

function dumpOf(
  attributes: Record<string, SchemaDumpAttribute>,
): ProviderSchemaDump {
  return {
    resources: {
      oneuptime_monitor: {
        description: "A Monitor continuously checks a service.",
        attributes,
      },
    },
    data_sources: {
      oneuptime_monitor_status: {
        attributes: {
          id: { type: "String", optional: true, computed: true },
          color: { type: "String", computed: true },
        },
      },
    },
  };
}

const directories: Array<string> = [];

// The pages the generator writes for a schema, by path.
async function pagesOf(dump: ProviderSchemaDump): Promise<string> {
  const directory: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "tfgen-notes-docs-"),
  );
  directories.push(directory);
  await new DocumentationGenerator(
    {
      outputDir: directory,
      providerName: "oneuptime",
      providerVersion: "17.1.0",
      goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
    },
    buildFixtureSpec(),
    dump,
  ).generateDocumentation();
  return directory;
}

function readPage(directory: string, file: string): ReadPage {
  return releaseNotes.parsePage(
    file,
    fs.readFileSync(path.join(directory, file), "utf-8"),
  );
}

afterAll(() => {
  for (const directory of directories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("the release notes read the pages this generator writes", () => {
  let page: ReadPage;

  beforeAll(async () => {
    page = readPage(
      await pagesOf(dumpOf(monitorAttributes())),
      "docs/resources/monitor.md",
    );
  });

  test("what a page documents, and what that does", () => {
    expect(page.kind).toBe("resource");
    expect(page.name).toBe("oneuptime_monitor");
    expect(page.description).toBeTruthy();
  });

  test("every attribute, in the group the provider declares it in", () => {
    expect(
      [...page.attributes.values()].map((attribute: ReadAttribute) => {
        return [attribute.name, attribute.kind];
      }),
    ).toEqual(
      expect.arrayContaining([
        ["name", "required"],
        ["is_paused", "optional"],
        ["secret_token", "optional"],
        ["legacy_field", "optional"],
        ["monitor_steps", "optional"],
        ["id", "read-only"],
        ["monitor_steps.criteria", "required"],
        ["monitor_steps.criteria.filter_condition", "required"],
      ]),
    );
  });

  test("its type, sensitivity, deprecation, values and default", () => {
    expect(page.attributes.get("is_paused")).toMatchObject({
      type: "Boolean",
      defaultValue: "false",
    });
    expect(page.attributes.get("secret_token")).toMatchObject({
      type: "String",
      sensitive: true,
    });
    expect(page.attributes.get("legacy_field")).toMatchObject({
      deprecated: true,
    });
    expect(page.attributes.get("monitor_steps")).toMatchObject({
      type: "Attributes List",
    });
    expect(
      page.attributes.get("monitor_steps.criteria.filter_condition"),
    ).toMatchObject({ allowedValues: ["All", "Any"] });
  });

  test("a data source's page as well", async () => {
    const dataSource: ReadPage = readPage(
      await pagesOf(dumpOf(monitorAttributes())),
      "docs/data-sources/monitor_status.md",
    );
    expect(dataSource.kind).toBe("data source");
    expect(dataSource.name).toBe("oneuptime_monitor_status");
    expect(dataSource.attributes.get("color")).toMatchObject({
      kind: "read-only",
    });
  });

  test("and so what changed between two releases' pages", async () => {
    const changed: Record<string, SchemaDumpAttribute> = monitorAttributes();
    changed["timeout"] = { type: "Number", optional: true };
    delete changed["legacy_field"];
    changed["is_paused"] = {
      ...changed["is_paused"]!,
      default: "value defaults to `true`",
    };
    changed["secret_token"] = {
      ...changed["secret_token"]!,
      optional: false,
      required: true,
    };
    const criteria: SchemaDumpAttribute =
      changed["monitor_steps"]!.nested!["criteria"]!;
    criteria.nested!["filter_condition"]!.allowed_values = [
      "All",
      "Any",
      "None",
    ];

    const changes: Array<AttributeChange> = releaseNotes.compareAttributes(
      page.attributes,
      readPage(await pagesOf(dumpOf(changed)), "docs/resources/monitor.md")
        .attributes,
    );

    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "added",
          name: "timeout",
          breaking: false,
        }),
        expect.objectContaining({
          kind: "removed",
          name: "legacy_field",
          breaking: true,
        }),
        expect.objectContaining({
          kind: "now-required",
          name: "secret_token",
          breaking: true,
        }),
        expect.objectContaining({
          kind: "default",
          name: "is_paused",
          from: "false",
          to: "true",
        }),
        expect.objectContaining({
          kind: "values-added",
          name: "monitor_steps.criteria.filter_condition",
          values: ["None"],
        }),
      ]),
    );
    expect(changes).toHaveLength(5);
  });
});
