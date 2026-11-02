import fs from "fs";
import os from "os";
import path from "path";
import { ResourceGenerator } from "../Core/ResourceGenerator";
import { OpenAPISpec } from "../Core/Types";

/*
 * WHAT AN UPDATE'S PLAN KNOWS.
 *
 * The read-only attributes OneUptime sets when a record is made and never
 * again (Common/Utils/DeveloperDocs/SetAtCreate.ts) plan as their state
 * value: a team's update showed "slug", "is_team_editable",
 * "is_team_deleteable", "is_permissions_editable" and
 * "should_have_at_least_one_member" as "(known after apply)" though none can
 * change. What does change as a record lives - when it was updated, whether
 * it is archived - still plans "(known after apply)".
 */

const dateTime: any = {
  type: "object",
  "x-oneuptime-type": "DateTime",
  description: "A date time object.",
};

function model(
  table: string,
  tag: string,
  apiPath: string,
  writable: Record<string, any>,
  readOnly: Record<string, any>,
): { paths: Record<string, any>; schemas: Record<string, any> } {
  const ref: (name: string) => any = (name: string): any => {
    return { $ref: `#/components/schemas/${name}` };
  };
  const body: (name: string) => any = (name: string): any => {
    return {
      content: {
        "application/json": {
          schema: { type: "object", properties: { data: ref(name) } },
        },
      },
    };
  };
  const answer: any = {
    "200": {
      description: "ok",
      content: {
        "application/json": {
          schema: { type: "object", properties: { data: ref(table) } },
        },
      },
    },
  };
  const id: any = {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string" },
  };
  return {
    schemas: {
      [`${table}CreateSchema`]: {
        type: "object",
        required: ["name"],
        properties: writable,
      },
      [`${table}UpdateSchema`]: { type: "object", properties: writable },
      [table]: {
        type: "object",
        properties: {
          _id: { type: "string" },
          ...writable,
          ...readOnly,
        },
      },
    },
    paths: {
      [apiPath]: {
        post: {
          operationId: `create${table}`,
          tags: [tag],
          requestBody: body(`${table}CreateSchema`),
          responses: answer,
        },
      },
      [`${apiPath}/{id}/get-item`]: {
        post: {
          operationId: `get${table}`,
          tags: [tag],
          parameters: [id],
          responses: answer,
        },
      },
      [`${apiPath}/{id}`]: {
        put: {
          operationId: `update${table}`,
          tags: [tag],
          parameters: [id],
          requestBody: body(`${table}UpdateSchema`),
          responses: answer,
        },
        delete: {
          operationId: `delete${table}`,
          tags: [tag],
          parameters: [id],
          responses: answer,
        },
      },
    },
  };
}

function buildSpec(): OpenAPISpec {
  const team: { paths: Record<string, any>; schemas: Record<string, any> } =
    model(
      "Team",
      "Team",
      "/team",
      { name: { type: "string", description: "Name." } },
      {
        slug: { type: "string", description: "Its slug." },
        isTeamEditable: { type: "boolean", description: "Editable?" },
        isTeamDeleteable: { type: "boolean", description: "Deleteable?" },
        createdAt: dateTime,
        updatedAt: dateTime,
        archivedAt: dateTime,
      },
    );
  const incident: { paths: Record<string, any>; schemas: Record<string, any> } =
    model(
      "Incident",
      "Incident",
      "/incident",
      { name: { type: "string", description: "Title." } },
      {
        incidentNumber: { type: "number", description: "Its number." },
        incidentNumberWithPrefix: {
          type: "string",
          description: "Its number, with the prefix.",
        },
        isOwnerNotifiedOfResourceCreation: {
          type: "boolean",
          description: "Told?",
        },
      },
    );

  return {
    openapi: "3.0.0",
    info: { title: "OneUptime", version: "1.0.0" },
    servers: [{ url: "https://oneuptime.com/api" }],
    tags: [
      { name: "Team", description: "Teams." },
      { name: "Incident", description: "Incidents." },
    ],
    paths: { ...team.paths, ...incident.paths },
    components: { schemas: { ...team.schemas, ...incident.schemas } },
  };
}

let outputDir: string;
let teamGo: string;
let incidentGo: string;

function block(source: string, attribute: string): string {
  const start: number = source.indexOf(`"${attribute}": schema.`);
  if (start === -1) {
    throw new Error(`no attribute ${attribute}`);
  }
  return source.substring(start, source.indexOf("\n            },\n", start));
}

beforeAll(async () => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-set-at-create-"));
  await new ResourceGenerator(
    {
      outputDir,
      providerName: "oneuptime",
      providerVersion: "14.0.0",
      goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
    },
    buildSpec(),
  ).generateResources();
  teamGo = fs.readFileSync(
    path.join(outputDir, "internal/provider/resource_team.go"),
    "utf-8",
  );
  incidentGo = fs.readFileSync(
    path.join(outputDir, "internal/provider/resource_incident.go"),
    "utf-8",
  );
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("an update's plan", () => {
  test("keeps what OneUptime set when the record was made", () => {
    expect(block(teamGo, "slug")).toContain(
      "stringplanmodifier.UseStateForUnknown()",
    );
    expect(block(teamGo, "created_at")).toContain(
      "stringplanmodifier.UseStateForUnknown()",
    );
    for (const flag of ["is_team_editable", "is_team_deleteable"]) {
      expect(block(teamGo, flag)).toContain(
        "boolplanmodifier.UseStateForUnknown()",
      );
    }
    expect(block(incidentGo, "incident_number")).toContain(
      "numberplanmodifier.UseStateForUnknown()",
    );
    expect(block(incidentGo, "incident_number_with_prefix")).toContain(
      "stringplanmodifier.UseStateForUnknown()",
    );
  });

  test("imports the plan modifier packages those need", () => {
    expect(teamGo).toContain(
      '"github.com/hashicorp/terraform-plugin-framework/resource/schema/boolplanmodifier"',
    );
    expect(incidentGo).toContain(
      '"github.com/hashicorp/terraform-plugin-framework/resource/schema/numberplanmodifier"',
    );
  });

  test("still says (known after apply) for what changes as the record lives", () => {
    for (const attribute of ["updated_at", "archived_at"]) {
      expect(block(teamGo, attribute)).not.toContain("UseStateForUnknown()");
    }
    expect(
      block(incidentGo, "is_owner_notified_of_resource_creation"),
    ).not.toContain("UseStateForUnknown()");
  });

  test("a table's own set-at-create columns are its own", () => {
    // is_team_editable is a team's; another table's column of that name
    // would not be kept.
    expect(
      ResourceGenerator.isSetAtCreateAttribute(
        "is_team_editable",
        { type: "bool", apiFieldName: "isTeamEditable" },
        { name: "incident", tableName: "Incident" } as any,
      ),
    ).toBe(false);
    expect(
      ResourceGenerator.isSetAtCreateAttribute(
        "is_team_editable",
        { type: "bool", apiFieldName: "isTeamEditable" },
        { name: "team", tableName: "Team" } as any,
      ),
    ).toBe(true);
  });
});
