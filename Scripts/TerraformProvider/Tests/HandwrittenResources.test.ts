import fs from "fs";
import os from "os";
import path from "path";
import {
  DocumentationGenerator,
  ProviderSchemaDump,
} from "../Core/DocumentationGenerator";
import {
  HANDWRITTEN_RESOURCES,
  HandwrittenResource,
  ON_CALL_SCHEDULE_LAYERS,
} from "../Core/HandwrittenResources";
import { ResourceGenerator } from "../Core/ResourceGenerator";
import { buildFixtureSpec } from "./Fixtures";

/*
 * The resources written by hand (Core/HandwrittenResources.ts):
 * oneuptime_on_call_schedule_layers, which saves a schedule's layers in one
 * call (OneUptime/oneuptime#9038). Each is copied into the provider with its
 * tests, registered beside the generated resources, and given a reference
 * page; its Go source is held here to the name and constructor the
 * generator registers, and to the schema its page falls back to.
 */

const STATIC_FILES: string = path.join(__dirname, "..", "StaticFiles");
const CONFIG: {
  outputDir: string;
  providerName: string;
  providerVersion: string;
  goModuleName: string;
} = {
  outputDir: "",
  providerName: "oneuptime",
  providerVersion: "11.0.0",
  goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
};

let outputDir: string;
let resourcesGo: string;

beforeAll(async () => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-handwritten-"));
  await new ResourceGenerator(
    { ...CONFIG, outputDir },
    buildFixtureSpec(),
  ).generateResources();
  resourcesGo = fs.readFileSync(
    path.join(outputDir, "internal/provider/resources.go"),
    "utf-8",
  );
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

function goSource(handwritten: HandwrittenResource): string {
  return fs.readFileSync(
    path.join(STATIC_FILES, handwritten.staticFiles[0]!),
    "utf-8",
  );
}

describe("the resources written by hand", () => {
  test("are the schedule's layers", () => {
    expect(
      HANDWRITTEN_RESOURCES.map((handwritten: HandwrittenResource) => {
        return handwritten.name;
      }),
    ).toEqual(["on_call_schedule_layers"]);
  });

  test.each(
    HANDWRITTEN_RESOURCES.map((handwritten: HandwrittenResource) => {
      return [handwritten.name, handwritten];
    }),
  )(
    "%s is copied in with its tests, and registered",
    (_name: unknown, handwritten: unknown) => {
      const resource: HandwrittenResource = handwritten as HandwrittenResource;

      for (const fileName of resource.staticFiles) {
        expect(
          fs.readFileSync(
            path.join(outputDir, "internal/provider", fileName),
            "utf-8",
          ),
        ).toBe(fs.readFileSync(path.join(STATIC_FILES, fileName), "utf-8"));
      }
      expect(
        resource.staticFiles.some((fileName: string) => {
          return fileName.endsWith("_test.go");
        }),
      ).toBe(true);

      // Registered once, by the constructor its Go file defines.
      expect(
        resourcesGo.split(`        ${resource.goConstructor},`),
      ).toHaveLength(2);
      expect(goSource(resource)).toContain(
        `func ${resource.goConstructor}() resource.Resource {`,
      );
      // And named as the generator names it.
      expect(goSource(resource)).toContain(
        `resp.TypeName = req.ProviderTypeName + "_${resource.name}"`,
      );
    },
  );

  test("the acceptance test of a new turn order in one apply ships too", () => {
    const acceptance: string = fs.readFileSync(
      path.join(
        outputDir,
        "internal/provider/acceptance_schedule_layers_test.go",
      ),
      "utf-8",
    );

    expect(acceptance).toContain("func TestAccOnCallScheduleLayers_turnOrder(");
    expect(acceptance).toContain(
      'resource "oneuptime_on_call_schedule_layers" "test"',
    );
    expect(acceptance).toContain(
      "ConfigPlanChecks: testAccUpdatesInPlace(address)",
    );
    expect(acceptance).toContain("ImportStateVerify: true");
  });

  test("a resource of the same name from the spec stops generation", async () => {
    const spec: ReturnType<typeof buildFixtureSpec> = buildFixtureSpec();
    const generator: ResourceGenerator = new ResourceGenerator(
      {
        ...CONFIG,
        outputDir: fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-twice-")),
      },
      spec,
    );
    const original: typeof ON_CALL_SCHEDULE_LAYERS.name =
      ON_CALL_SCHEDULE_LAYERS.name;

    // The fixture spec's monitor, as if it were the hand-written one's name.
    (ON_CALL_SCHEDULE_LAYERS as { name: string }).name = "monitor";
    try {
      await expect(generator.generateResources()).rejects.toThrow(
        "The spec gives a resource named monitor, which is written by hand",
      );
    } finally {
      (ON_CALL_SCHEDULE_LAYERS as { name: string }).name = original;
    }
  });
});

describe("oneuptime_on_call_schedule_layers", () => {
  const go: string = goSource(ON_CALL_SCHEDULE_LAYERS);

  test("saves and reads through the routes the server registers", () => {
    expect(go).toContain('scheduleLayersPath(scheduleID)+"/save-layers"');
    expect(go).toContain('scheduleLayersPath(scheduleID)+"/layers"');
    expect(go).toContain(
      'return "/on-call-duty-policy-schedule/" + scheduleID',
    );
    // A save refused because the layers changed is read again and made again.
    expect(go).toContain("resp.StatusCode == http.StatusConflict");
  });

  test("describes on its page, without a built provider, the schema the Go file has", () => {
    const attributes: Record<
      string,
      {
        description?: string | undefined;
        nested?:
          | Record<string, { description?: string | undefined }>
          | undefined;
      }
    > = ON_CALL_SCHEDULE_LAYERS.schema.attributes;

    for (const [name, attribute] of Object.entries(attributes)) {
      expect(go).toContain(`"${name}": schema.`);
      expect(go).toContain(
        JSON.stringify(attribute.description).replace(
          "`oneuptime_on_call_policy_schedule`",
          '`" + scheduleLayersScheduleType + "`',
        ),
      );
      for (const [nestedName, nested] of Object.entries(
        attribute.nested || {},
      )) {
        expect(go).toContain(`"${nestedName}": schema.`);
        expect(go).toContain(
          JSON.stringify(nested.description).replace(
            "`oneuptime_on_call_schedule_layer`",
            '`" + scheduleLayersLayerType + "`',
          ),
        );
      }
    }
  });

  test("has a reference page: what it saves, an example, its schema and its import", () => {
    const docs: string = new DocumentationGenerator(
      { ...CONFIG, outputDir },
      buildFixtureSpec(),
    ).generateHandwrittenResourceDoc(ON_CALL_SCHEDULE_LAYERS);

    expect(docs).toContain(
      'page_title: "oneuptime_on_call_schedule_layers Resource - oneuptime"',
    );
    expect(docs).toContain('subcategory: "On-Call & Escalation"');
    expect(docs).toContain(
      'resource "oneuptime_on_call_schedule_layers" "sre"',
    );
    expect(docs).toContain(
      "layer_id = oneuptime_on_call_schedule_layer.primary.id",
    );
    expect(docs).toContain("## How a change is saved");
    expect(docs).toContain("writes all of it or none of it");
    expect(docs).toContain("## Layers it does not list");
    expect(docs).toContain("## Destroying it");
    expect(docs).toContain(
      "- `on_call_duty_policy_schedule_id` (String) ID of the `oneuptime_on_call_policy_schedule` whose layers these are.",
    );
    expect(docs).toContain(
      '<a id="nestedatt--layers"></a>\n### Nested Schema for `layers`',
    );
    expect(docs).toContain(
      "terraform import oneuptime_on_call_schedule_layers.example <on_call_duty_policy_schedule_id>",
    );
  });

  test("takes its page's schema from the built provider when there is one", () => {
    const dump: ProviderSchemaDump = {
      resources: {
        oneuptime_on_call_schedule_layers: {
          description: "From the built provider.",
          attributes: {
            on_call_duty_policy_schedule_id: {
              type: "String",
              description: "As the built provider describes it.",
              required: true,
            },
          },
        },
      },
      data_sources: {},
    };

    const docs: string = new DocumentationGenerator(
      { ...CONFIG, outputDir },
      buildFixtureSpec(),
      dump,
    ).generateHandwrittenResourceDoc(ON_CALL_SCHEDULE_LAYERS);

    expect(docs).toContain(
      "- `on_call_duty_policy_schedule_id` (String) As the built provider describes it.",
    );
  });

  test("is written to the reference pages with the generated ones", async () => {
    const docsDir: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "tfgen-handwritten-docs-"),
    );
    try {
      await new DocumentationGenerator(
        { ...CONFIG, outputDir: docsDir },
        buildFixtureSpec(),
      ).generateDocumentation();

      expect(
        fs.existsSync(
          path.join(docsDir, "docs/resources/on_call_schedule_layers.md"),
        ),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(docsDir, "docs/resources/monitor.md")),
      ).toBe(true);
    } finally {
      fs.rmSync(docsDir, { recursive: true, force: true });
    }
  });
});
