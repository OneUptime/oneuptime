import fs from "fs";
import os from "os";
import path from "path";
import { ResourceGenerator, SchemaFlags } from "../Core/ResourceGenerator";
import { DataSourceGenerator } from "../Core/DataSourceGenerator";
import { OpenAPIParser } from "../Core/OpenAPIParser";
import {
  OpenAPISpec,
  TerraformDataSource,
  TerraformResource,
} from "../Core/Types";
import { StringUtils } from "../Core/StringUtils";
import { buildFixtureSpec } from "./Fixtures";
import { buildPeopleFixtureSpec } from "./PeopleFixtures";

/*
 * THE ID OF ANOTHER RECORD IS A UUID, AT PLAN TIME.
 *
 * `team_id = "sre"` planned cleanly and failed the apply with the API's
 * "Invalid ID format". Every attribute that holds the ID of another record
 * (its relation) now has the validators of StaticFiles/ids.go: one ID, a
 * set or a list of them. What only OneUptime writes, the project, and a
 * data source's own `id` have none.
 */

const STATIC_FILES: string = path.join(__dirname, "..", "StaticFiles");

interface Generated {
  resources: Array<TerraformResource>;
  dataSources: Array<TerraformDataSource>;
  read: (file: string) => string;
}

const outputDirs: Array<string> = [];

async function generate(spec: OpenAPISpec): Promise<Generated> {
  const outputDir: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "tfgen-record-ids-"),
  );
  outputDirs.push(outputDir);
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
  await new ResourceGenerator(config, spec).generateResources();
  await new DataSourceGenerator(config, spec).generateDataSources();

  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(spec);

  return {
    resources: parser.getResources(),
    dataSources: parser.getDataSources(),
    read: (file: string): string => {
      return fs.readFileSync(
        path.join(outputDir, "internal/provider", file),
        "utf-8",
      );
    },
  };
}

/*
 * The schema block of one attribute in a generated file. An attribute built
 * by a helper of its own (monitor_steps, monitorsteps.go) has none here:
 * the empty string.
 */
function attributeBlock(source: string, name: string): string {
  const start: number = source.indexOf(`"${name}": schema.`);
  if (start === -1) {
    return "";
  }
  return source.substring(start, source.indexOf("\n            },", start));
}

let fixtures: Array<Generated>;

beforeAll(async () => {
  fixtures = [
    await generate(buildFixtureSpec()),
    await generate(buildPeopleFixtureSpec()),
  ];
});

afterAll(() => {
  for (const outputDir of outputDirs) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

describe("a resource's attributes that hold IDs of other records", () => {
  test("each takes its relation's ID, and nothing else is held to one", () => {
    const checked: Array<string> = [];

    for (const fixture of fixtures) {
      for (const resource of fixture.resources) {
        const source: string = fixture.read(`resource_${resource.name}.go`);

        for (const [name, attr] of Object.entries(resource.schema)) {
          // A person's ID is held to a user ID by people.go's validators.
          if (attr.person || attr.personEmailOf) {
            continue;
          }
          const flags: SchemaFlags = ResourceGenerator.getSchemaFlags(
            name,
            attr,
            resource,
          );
          const terraformName: string =
            StringUtils.toTerraformAttributeName(name);
          const block: string = attributeBlock(source, terraformName);
          const settable: boolean = flags.required || flags.optional;
          const expected: string | null =
            attr.relation && settable && name !== "project_id"
              ? `Validators: ${ResourceGenerator.RECORD_ID_VALIDATORS[attr.type]}("oneuptime_${attr.relation.name}")`
              : null;

          if (expected) {
            expect([resource.name, name, block]).toEqual([
              resource.name,
              name,
              expect.stringContaining(expected),
            ]);
            checked.push(`${resource.name}.${name} (${attr.type})`);
          } else {
            expect([resource.name, name, block]).toEqual([
              resource.name,
              name,
              expect.not.stringContaining("recordID"),
            ]);
          }
        }
      }
    }

    // One ID, and a set of them, are both among what was checked.
    expect(checked).toEqual(
      expect.arrayContaining([
        "monitor.current_monitor_status_id (string)",
        "team_member.team_id (string)",
      ]),
    );
  });

  test("a person's ID is held to a user ID, pointing at the address beside it", () => {
    const peopleGo: string = fs.readFileSync(
      path.join(STATIC_FILES, "people.go"),
      "utf-8",
    );

    expect(peopleGo).toContain(
      "userID := recordIDValidator{resourceType: personResourceType, emailAttribute: emailAttribute}",
    );
    expect(peopleGo).toContain(
      "setvalidator.ValueStringsAre(recordIDValidator{resourceType: personResourceType, emailAttribute: emailsAttribute})",
    );
  });

  test("the validators ship with the provider, with their tests", () => {
    const resourceGenerator: string = fs.readFileSync(
      path.join(__dirname, "..", "Core", "ResourceGenerator.ts"),
      "utf-8",
    );
    for (const file of ["ids.go", "ids_test.go"]) {
      expect(fs.existsSync(path.join(STATIC_FILES, file))).toBe(true);
      expect(resourceGenerator).toContain(
        `await this.copyStaticFile("${file}", "internal/provider");`,
      );
    }
    const idsGo: string = fs.readFileSync(
      path.join(STATIC_FILES, "ids.go"),
      "utf-8",
    );
    for (const helper of Object.values(
      ResourceGenerator.RECORD_ID_VALIDATORS,
    )) {
      expect(idsGo).toContain(`func ${helper}(resourceType string)`);
    }
  });
});

describe("a data source's lookups by the ID of another record", () => {
  test("each is held to an ID, and the data source's own id is not", () => {
    const checked: Array<string> = [];

    for (const fixture of fixtures) {
      for (const dataSource of fixture.dataSources) {
        if (dataSource.staticFile) {
          continue;
        }
        const source: string = fixture.read(
          `data_source_${dataSource.name}.go`,
        );

        for (const [name, attr] of Object.entries(dataSource.schema)) {
          if (attr.person || attr.personEmailOf) {
            continue;
          }
          const block: string = attributeBlock(
            source,
            StringUtils.toTerraformAttributeName(name),
          );
          const isIDLookup: boolean = Boolean(
            attr.isLookupFilter && attr.relation && attr.type === "string",
          );

          if (isIDLookup) {
            expect(block).toContain(
              `Validators: recordIDValidators("oneuptime_${attr.relation!.name}")`,
            );
            checked.push(`${dataSource.name}.${name}`);
          } else {
            expect([dataSource.name, name, block]).toEqual([
              dataSource.name,
              name,
              expect.not.stringContaining("recordID"),
            ]);
          }
        }
      }
    }

    expect(checked).toContain("team_member.team_id");
  });
});

// The validator's own words, as a reader meets them.
describe("ids.go", () => {
  const idsGo: string = fs.readFileSync(
    path.join(STATIC_FILES, "ids.go"),
    "utf-8",
  );

  test("matches the API's UUID, which Common/Types/ObjectID.ts checks", () => {
    const objectId: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "packages/Common/Types/ObjectID.ts",
      ),
      "utf-8",
    );

    expect(objectId).toContain(
      "/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i",
    );
    expect(idsGo).toContain(
      "regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)",
    );
  });

  test("says what to write instead of a name", () => {
    expect(idsGo).toContain(
      "Refer to the resource instead (%s.<name>.id), or read the ID with the %s data source.",
    );
    expect(idsGo).toContain(
      "Name the person by their email address, in %s, instead.",
    );
  });
});
