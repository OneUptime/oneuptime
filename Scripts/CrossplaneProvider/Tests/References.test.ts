import { OpenAPIParser } from "../../TerraformProvider/Core/OpenAPIParser";
import {
  TerraformAttribute,
  TerraformResource,
} from "../../TerraformProvider/Core/Types";
import { buildFixtureSpec } from "../../TerraformProvider/Tests/Fixtures";
import {
  collectReferences,
  ReferenceMap,
  renderReferencesGo,
} from "../Core/References";

function resource(
  name: string,
  schema: Record<string, TerraformAttribute>,
): TerraformResource {
  return {
    name,
    goTypeName: name,
    operations: {},
    schema,
  };
}

const id: TerraformAttribute = { type: "string", computed: true };

describe("references from the spec's relations", () => {
  test("a field with the ID of a resource refers to that resource", () => {
    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(buildFixtureSpec());
    const references: ReferenceMap = collectReferences(parser.getResources());

    expect(references["oneuptime_monitor"]).toEqual(
      expect.objectContaining({
        current_monitor_status_id: "oneuptime_monitor_status",
      }),
    );
  });

  test("a relation to a record with a data source only takes the ID alone", () => {
    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(buildFixtureSpec());
    const references: ReferenceMap = collectReferences(parser.getResources());

    // Label is list-only in the fixture: no managed resource to refer to.
    expect(references["oneuptime_monitor"]?.["labels"]).toBeUndefined();
  });

  test("lists of IDs refer too, and only fields a manifest can set do", () => {
    const references: ReferenceMap = collectReferences([
      resource("label", { id }),
      resource("team", { id }),
      resource("monitor", {
        id,
        labels: {
          type: "set",
          optional: true,
          relation: { name: "label", isList: true },
        },
        owner_team_id: {
          type: "string",
          required: true,
          relation: { name: "team", isList: false },
        },
        // OneUptime writes this one: nothing to refer to.
        created_by_team_id: {
          type: "string",
          computed: true,
          relation: { name: "team", isList: false },
        },
        // Optional and computed: the server fills it in when it is left out.
        default_team_id: {
          type: "string",
          optional: true,
          computed: true,
          relation: { name: "team", isList: false },
        },
        created_by_user_id: {
          type: "string",
          optional: true,
          relation: { name: "user", isList: false, dataSourceOnly: true },
        },
        // A name the spec has and Terraform has no resource for.
        scan_id: {
          type: "string",
          optional: true,
          relation: { name: "scan", isList: false },
        },
        name: { type: "string", required: true },
      }),
    ]);

    expect(references).toEqual({
      oneuptime_monitor: {
        labels: "oneuptime_label",
        owner_team_id: "oneuptime_team",
        default_team_id: "oneuptime_team",
      },
    });
  });

  test("a resource with no relations has no entry", () => {
    expect(
      collectReferences([
        resource("label", { id, name: { type: "string", required: true } }),
      ]),
    ).toEqual({});
  });
});

describe("config/zz_references.go", () => {
  const references: ReferenceMap = {
    oneuptime_status_page: {
      owner_teams: "oneuptime_team",
      labels: "oneuptime_label",
    },
    oneuptime_monitor: { labels: "oneuptime_label" },
  };

  test("is the generatedReferences map config/provider.go reads", () => {
    const go: string = renderReferencesGo(references);

    expect(go).toMatch(/^\/\/ Code generated .* DO NOT EDIT\.\n/);
    expect(go).toContain("package config\n");
    expect(go).toContain(
      "var generatedReferences = map[string]map[string]string{",
    );
    expect(go).toContain('\t\t"owner_teams": "oneuptime_team",');
  });

  test("lists resources and fields in order, so it changes only with a relation", () => {
    const go: string = renderReferencesGo(references);

    expect(go.indexOf('"oneuptime_monitor"')).toBeLessThan(
      go.indexOf('"oneuptime_status_page"'),
    );
    expect(go.indexOf('"labels"', go.indexOf('"oneuptime_status_page"'))).toBeLessThan(
      go.indexOf('"owner_teams"'),
    );
    expect(renderReferencesGo(references)).toBe(go);
  });

  test("escapes what it writes as Go strings", () => {
    expect(
      renderReferencesGo({ 'oneuptime_"x"': { a: "oneuptime_b" } }),
    ).toContain('"oneuptime_\\"x\\""');
  });

  test("an empty map is still a valid file", () => {
    expect(renderReferencesGo({})).toContain(
      "var generatedReferences = map[string]map[string]string{\n}\n",
    );
  });
});
