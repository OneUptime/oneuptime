import fs from "fs";
import os from "os";
import path from "path";
import { OpenAPIParser } from "../Core/OpenAPIParser";
import { ProviderGenerator } from "../Core/ProviderGenerator";
import { ResourceGenerator } from "../Core/ResourceGenerator";
import {
  OpenAPISpec,
  SharedAttribute,
  TerraformAttribute,
  TerraformResource,
  TERRAFORM_SERVER_OWNED_KINDS,
} from "../Core/Types";
import { providerGoFilePath } from "../Core/ProviderShards";

/*
 * WHAT PEOPLE AND ONEUPTIME BOTH CHANGE (#10052).
 *
 * The spec marks a column people set and OneUptime changes too
 * x-oneuptime-server-owned "shared": the labels a label rule adds to a
 * monitor, whether it is private, which a privacy rule decides. The
 * generator keeps each an ordinary optional attribute that a create and an
 * update send, says so in its description, and names it to the resource's
 * ModifyPlan (PlanShared, StaticFiles/shared.go): left out of a
 * configuration, the plan keeps OneUptime's value even where the attribute
 * has a default, and under Crossplane a manifest's value is sent when it
 * changes, and a list keeps the entries OneUptime added. The provider made
 * for a Crossplane reconcile carries what its manifest last applied
 * (NewUnderCrossplane). The plans themselves are tested in Go
 * (shared_test.go, shared_plan_test.go).
 */

const COLUMNS: Record<string, any> = {
  name: { type: "string", description: "Any friendly name." },
  labels: {
    type: "array",
    items: { type: "object", properties: { _id: { type: "string" } } },
    description: "Labels to group and filter by.",
    "x-oneuptime-relation": { tag: "Label", tableName: "Label" },
  },
  isPrivate: {
    type: "boolean",
    default: false,
    description: "Whether only its owners see it.",
  },
  postmortemNote: { type: "string", description: "The postmortem." },
  // Read only: what an agent counted.
  nodeCount: { type: "number", description: "Cached count of nodes." },
};

const SHARED: Record<string, string> = {
  labels: "shared",
  isPrivate: "shared",
  postmortemNote: "shared",
  nodeCount: "always",
};

function buildSpec(serverOwned: Record<string, string> = SHARED): OpenAPISpec {
  const column: (name: string) => any = (name: string): any => {
    return {
      ...COLUMNS[name],
      ...(serverOwned[name]
        ? { "x-oneuptime-server-owned": serverOwned[name] }
        : {}),
    };
  };
  const pick: (names: Array<string>) => Record<string, any> = (
    names: Array<string>,
  ): Record<string, any> => {
    const picked: Record<string, any> = {};
    for (const name of names) {
      picked[name] = column(name);
    }
    return picked;
  };
  const writable: Array<string> = [
    "name",
    "labels",
    "isPrivate",
    "postmortemNote",
  ];
  const ref: (schema: string) => any = (schema: string): any => {
    return { $ref: `#/components/schemas/${schema}` };
  };
  const body: (schema: string) => any = (schema: string): any => {
    return {
      content: {
        "application/json": {
          schema: { type: "object", properties: { data: ref(schema) } },
        },
      },
    };
  };
  const answer: (schema: string) => any = (schema: string): any => {
    return {
      "200": {
        description: "ok",
        content: {
          "application/json": {
            schema: { type: "object", properties: { data: ref(schema) } },
          },
        },
      },
    };
  };
  const id: any = {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string" },
  };

  return {
    openapi: "3.0.0",
    info: { title: "OneUptime", version: "1.0.0" },
    servers: [{ url: "https://oneuptime.com/api" }],
    tags: [{ name: "Incident", description: "An incident." }],
    paths: {
      "/incident": {
        post: {
          operationId: "createIncident",
          tags: ["Incident"],
          requestBody: body("IncidentCreateSchema"),
          responses: answer("Incident"),
        },
      },
      "/incident/{id}/get-item": {
        post: {
          operationId: "getIncident",
          tags: ["Incident"],
          parameters: [id],
          responses: answer("Incident"),
        },
      },
      "/incident/{id}": {
        put: {
          operationId: "updateIncident",
          tags: ["Incident"],
          parameters: [id],
          requestBody: body("IncidentUpdateSchema"),
          responses: answer("Incident"),
        },
        delete: {
          operationId: "deleteIncident",
          tags: ["Incident"],
          parameters: [id],
          responses: answer("Incident"),
        },
      },
    } as any,
    components: {
      schemas: {
        IncidentCreateSchema: {
          type: "object",
          required: ["name"],
          properties: pick(writable),
        },
        IncidentUpdateSchema: { type: "object", properties: pick(writable) },
        Incident: {
          type: "object",
          properties: {
            _id: { type: "string" },
            ...pick(Object.keys(COLUMNS)),
          },
        },
      },
    },
  };
}

function parse(serverOwned?: Record<string, string>): TerraformResource {
  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(buildSpec(serverOwned));
  return parser.getResources()[0]!;
}

function attribute(
  resource: TerraformResource,
  name: string,
): TerraformAttribute {
  const found: TerraformAttribute | undefined = resource.schema[name];
  if (!found) {
    throw new Error(`no attribute ${name}`);
  }
  return found;
}

const config: {
  outputDir: string;
  providerName: string;
  providerVersion: string;
  goModuleName: string;
} = {
  outputDir: "",
  providerName: "oneuptime",
  providerVersion: "17.1.0",
  goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
};

let outputDir: string;
let resourceGo: string;
let plainResourceGo: string;
let providerGo: string;
let clientGo: string;

beforeAll(async () => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-shared-"));
  const plainDir: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "tfgen-shared-plain-"),
  );

  await new ResourceGenerator(
    { ...config, outputDir },
    buildSpec(),
  ).generateResources();
  await new ProviderGenerator(
    { ...config, outputDir },
    buildSpec(),
  ).generateProvider();
  await new ResourceGenerator(
    { ...config, outputDir: plainDir },
    buildSpec({ nodeCount: "always" }),
  ).generateResources();

  const read: (dir: string, file: string) => string = (
    dir: string,
    file: string,
  ): string => {
    return fs.readFileSync(path.join(dir, providerGoFilePath(file)), "utf-8");
  };
  resourceGo = read(outputDir, "resource_incident.go");
  plainResourceGo = read(plainDir, "resource_incident.go");
  providerGo = read(outputDir, "provider.go");
  clientGo = read(outputDir, "client.go");
  fs.rmSync(plainDir, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("the spec's shared kind", () => {
  test("is a kind the parser knows", () => {
    expect(TERRAFORM_SERVER_OWNED_KINDS).toContain("shared");
    expect(OpenAPIParser.readServerOwned("shared")).toBe("shared");
    expect(OpenAPIParser.readServerOwned("people")).toBeUndefined();
  });

  test("keeps the attribute a person's to set: optional, sent by a create and an update, never replaced", () => {
    const resource: TerraformResource = parse();

    for (const name of ["labels", "is_private", "postmortem_note"]) {
      const shared: TerraformAttribute = attribute(resource, name);
      expect([name, shared.serverOwned, shared.optional]).toEqual([
        name,
        "shared",
        true,
      ]);
      expect([name, Boolean(shared.forceNew)]).toEqual([name, false]);
      expect([
        name,
        Object.prototype.hasOwnProperty.call(
          resource.operationSchemas!.create!,
          name,
        ),
        Object.prototype.hasOwnProperty.call(
          resource.operationSchemas!.update!,
          name,
        ),
      ]).toEqual([name, true, true]);
    }
  });

  test("says in the attribute's description that OneUptime changes it too, and of a list that its other entries stay", () => {
    const resource: TerraformResource = parse();

    // A list of related records: the configuration's entries are its own (#10134).
    expect(attribute(resource, "labels").description).toBe(
      `Labels to group and filter by. ${OpenAPIParser.SHARED_LIST_DESCRIPTION}`,
    );
    expect(attribute(resource, "is_private").description).toContain(
      OpenAPIParser.SHARED_DESCRIPTION,
    );
    expect(attribute(resource, "postmortem_note").description).toBe(
      `The postmortem. ${OpenAPIParser.SHARED_DESCRIPTION}`,
    );
    // Not of a person's own attribute.
    expect(attribute(resource, "name").description).not.toContain(
      OpenAPIParser.SHARED_DESCRIPTION,
    );
  });
});

describe("the resource's ModifyPlan", () => {
  test("names each shared attribute to PlanShared, a list as one held entry by entry", () => {
    const shared: Array<SharedAttribute> =
      ResourceGenerator.getSharedAttributes(parse());

    expect(shared).toEqual([
      { name: "is_private", entries: false },
      { name: "labels", entries: true },
      { name: "postmortem_note", entries: false },
    ]);
    expect(resourceGo).toContain(
      "PlanShared(ctx, req, resp, r.client, []SharedAttribute{",
    );
    expect(resourceGo).toContain('{Name: "labels", Entries: true},');
    expect(resourceGo).toContain('{Name: "is_private", Entries: false},');
  });

  test("plans them after what a manifest leaves out under Crossplane, before the state is kept when nothing changes", () => {
    const keepLeftOut: number = resourceGo.indexOf(
      "KeepLeftOutUnderCrossplane(ctx, req, resp)",
    );
    const planShared: number = resourceGo.indexOf("PlanShared(ctx, req, resp");
    const keepState: number = resourceGo.indexOf(
      "KeepStateWhenNothingChanges(ctx, req, resp)",
    );

    expect(keepLeftOut).toBeGreaterThan(-1);
    expect(planShared).toBeGreaterThan(keepLeftOut);
    expect(keepState).toBeGreaterThan(planShared);
  });

  test("of a resource with none is as before", () => {
    expect(plainResourceGo).not.toContain("PlanShared(");
    expect(ResourceGenerator.generatePlanSharedCall(parse({}))).toBe("");
  });
});

describe("the provider a Crossplane reconcile makes", () => {
  test("carries what the manifest last applied to the client its resources plan with", () => {
    expect(providerGo).toContain("lastApplied *LastApplied");
    expect(providerGo).toContain(
      "func NewUnderCrossplane(version string, lastApplied LastApplied) func() provider.Provider {",
    );
    expect(providerGo).toContain("client.lastApplied = p.lastApplied");
    expect(clientGo).toContain("lastApplied *LastApplied");
  });

  test("and shared.go, with its tests, is in the provider", () => {
    for (const file of ["shared.go", "shared_test.go", "shared_plan_test.go"]) {
      expect([
        file,
        fs.existsSync(path.join(outputDir, providerGoFilePath(file))),
      ]).toEqual([file, true]);
    }
  });
});
