import fs from "fs";
import os from "os";
import path from "path";
import { OpenAPIParser } from "../Core/OpenAPIParser";
import { ProviderGenerator } from "../Core/ProviderGenerator";
import { ResourceGenerator } from "../Core/ResourceGenerator";
import { GoCodeGenerator } from "../Core/GoCodeGenerator";
import {
  EXCLUSIVE_LISTS_ATTRIBUTE_DESCRIPTION,
  URL_ATTRIBUTE_DESCRIPTION,
} from "../Core/ProviderWords";
import {
  HeldEntryAttribute,
  OpenAPISpec,
  TerraformResource,
} from "../Core/Types";
import { providerGoFilePath } from "../Core/ProviderShards";

/*
 * LISTS ONEUPTIME ADDS TO AS WELL, HELD BY THE ENTRIES A CONFIGURATION
 * DECLARES (#10134), UPDATED ENTRY BY ENTRY (#10135), AND A CREATE THAT
 * SAYS WHAT IT LEFT OUT (#10136).
 *
 * A list of related records people and OneUptime both change (the spec's
 * x-oneuptime-server-owned "shared" on a list of IDs: the labels a label
 * rule adds) is held to the entries a configuration declares
 * (StaticFiles/entries.go): its state after a read keeps the declared
 * entries the record still has, a create or an update says which lists
 * the configuration declares, an import adopts the record's entries, and
 * an update sends what it adds and takes off in addToList and
 * removeFromList rather than the whole list - but under the provider's
 * exclusive_lists, which holds it as earlier versions did. A shared value
 * (a switch, a note) and a list only people write are not held so.
 *
 * And every create warns when its answer names fields OneUptime left out
 * because only it writes them. The behaviour itself is tested in Go
 * (entries_test.go, entries_plan_test.go).
 */

const COLUMNS: Record<string, any> = {
  name: { type: "string", description: "Any friendly name." },
  labels: {
    type: "array",
    items: { type: "object", properties: { _id: { type: "string" } } },
    description: "Labels to group and filter by.",
    "x-oneuptime-relation": { tag: "Label", tableName: "Label" },
  },
  onCallDutyPolicies: {
    type: "array",
    items: { type: "object", properties: { _id: { type: "string" } } },
    description: "On-call policies paged for it.",
    "x-oneuptime-relation": {
      tag: "On-Call Policy",
      tableName: "OnCallDutyPolicy",
    },
  },
  // A list only people write.
  monitors: {
    type: "array",
    items: { type: "object", properties: { _id: { type: "string" } } },
    description: "Monitors affected.",
    "x-oneuptime-relation": { tag: "Monitor", tableName: "Monitor" },
  },
  // A shared value, not a list.
  isPrivate: {
    type: "boolean",
    default: false,
    description: "Whether only its owners see it.",
  },
};

const SERVER_OWNED: Record<string, string> = {
  labels: "shared",
  onCallDutyPolicies: "shared",
  isPrivate: "shared",
};

function buildSpec(
  serverOwned: Record<string, string> = SERVER_OWNED,
): OpenAPISpec {
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
  const writable: Array<string> = Object.keys(COLUMNS);
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

// The text of a Go method of the resource, from its signature to the next one.
function method(go: string, name: string): string {
  const start: number = go.indexOf(`) ${name}(`);
  if (start < 0) {
    throw new Error(`no method ${name}`);
  }
  const end: number = go.indexOf("\nfunc ", start + 1);
  return go.slice(start, end < 0 ? undefined : end);
}

beforeAll(async () => {
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-held-"));
  const plainDir: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "tfgen-held-plain-"),
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
    buildSpec({}),
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

describe("which lists are held by a configuration's entries", () => {
  test("each list of related records OneUptime adds to as well, by its names and type", () => {
    expect(ResourceGenerator.getHeldEntryAttributes(parse())).toEqual([
      {
        name: "labels",
        fieldName: "Labels",
        apiName: "labels",
        type: "set",
      },
      {
        name: "on_call_duty_policies",
        fieldName: "OnCallDutyPolicies",
        apiName: "onCallDutyPolicies",
        type: "set",
      },
    ] as Array<HeldEntryAttribute>);
  });

  test("not a shared value, nor a list only people write, nor any list of a resource with nothing shared", () => {
    const names: Array<string> = ResourceGenerator.getHeldEntryAttributes(
      parse(),
    ).map((attribute: HeldEntryAttribute): string => {
      return attribute.name;
    });

    expect(names).not.toContain("is_private");
    expect(names).not.toContain("monitors");
    expect(ResourceGenerator.getHeldEntryAttributes(parse({}))).toEqual([]);
  });
});

describe("the resource's Go", () => {
  test("an update sends a held list's entries one by one, and the whole list only under exclusive_lists", () => {
    const update: string = method(resourceGo, "Update");

    expect(update).toContain("listChanges := NewEntryChanges()");
    expect(update).toContain(
      'listChanges.Diff("labels", "labels", data.Labels, state.Labels)',
    );
    expect(update).toContain(
      'listChanges.Diff("on_call_duty_policies", "onCallDutyPolicies", data.OnCallDutyPolicies, state.OnCallDutyPolicies)',
    );
    expect(update).toContain("if r.client.ChangesEntriesOneByOne() {");
    expect(update).toContain(
      'requestDataMap["labels"] = r.convertTerraformSetToInterface(data.Labels)',
    );
    expect(update).toContain("listChanges.AddTo(incidentRequest)");
    // An update that only adds or takes off entries is still sent.
    expect(update).toContain(
      'if len(incidentRequest["data"].(map[string]interface{})) > 0 || listChanges.Any() {',
    );
    // A list only people write is sent whole, as before.
    expect(update).toContain(
      'requestDataMap["monitors"] = r.convertTerraformSetToInterface(data.Monitors)',
    );
    expect(update).not.toContain('listChanges.Diff("monitors"');
  });

  test("an update checks what it changed is there, then holds the state to the configuration's entries", () => {
    const update: string = method(resourceGo, "Update");
    const check: number = update.indexOf(
      'resp.Diagnostics.Append(listChanges.Check("labels", data.Labels)...)',
    );
    const held: number = update.indexOf(
      "resp.Diagnostics.Append(r.heldEntriesAfterWrite(ctx, req.Private, &data, &plan, &config, false).Write(ctx, resp.Private)...)",
    );
    const kept: number = update.indexOf(
      "r.keepPlannedValues(&data, &plan, &config)",
    );

    expect(kept).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(kept);
    expect(held).toBeGreaterThan(check);
  });

  test("a create says what it left out, and declares the lists its configuration lists", () => {
    const create: string = method(resourceGo, "Create");

    expect(create).toContain(
      'resp.Diagnostics.Append(FieldsLeftOutWarning(httpResp, "incident")...)',
    );
    expect(create).toContain(
      "resp.Diagnostics.Append(r.heldEntriesAfterWrite(ctx, nil, &data, &plan, &config, true).Write(ctx, resp.Private)...)",
    );
  });

  test("a read keeps the declared entries the record still has, from the state before it", () => {
    const read: string = method(resourceGo, "Read");
    const prior: number = read.indexOf("prior := data");
    const mapped: number = read.indexOf("dataMap");
    const held: number = read.indexOf(
      "r.heldEntriesAfterRead(ctx, req.Private, &data, &prior)",
    );

    expect(prior).toBeGreaterThan(-1);
    expect(mapped).toBeGreaterThan(prior);
    expect(held).toBeGreaterThan(mapped);
  });

  test("an import adopts the record's entries of every held list", () => {
    expect(method(resourceGo, "ImportState")).toContain(
      'DeclaredEntries{"labels": true, "on_call_duty_policies": true}.Write(ctx, resp.Private)',
    );
  });

  test("the resource's own methods hold each list, a set as a set", () => {
    const afterRead: string = method(resourceGo, "heldEntriesAfterRead");
    const afterWrite: string = method(resourceGo, "heldEntriesAfterWrite");

    expect(afterRead).toContain(
      'data.Labels = SetEntriesAfterRead(r.client, declared, "labels", prior.Labels, data.Labels)',
    );
    expect(afterWrite).toContain(
      'data.Labels, isDeclared = SetEntriesAfterWrite(r.client, isCreate, declared["labels"], config.Labels, plan.Labels, data.Labels)',
    );
    expect(afterWrite).toContain('declared["labels"] = isDeclared');
    expect(afterRead).not.toContain("Monitors");
  });

  test("a resource with no held list has none of it, but its create still says what it left out", () => {
    expect(plainResourceGo).not.toContain("listChanges");
    expect(plainResourceGo).not.toContain("heldEntriesAfter");
    expect(plainResourceGo).not.toContain("DeclaredEntries{");
    expect(plainResourceGo).not.toContain("prior := data");
    expect(method(plainResourceGo, "Create")).toContain(
      'FieldsLeftOutWarning(httpResp, "incident")',
    );
  });
});

describe("the provider's exclusive_lists", () => {
  test("is an optional switch of the provider, which the client carries", () => {
    expect(providerGo).toContain('"exclusive_lists": schema.BoolAttribute{');
    expect(providerGo).toContain(
      `MarkdownDescription: "${GoCodeGenerator.escapeString(EXCLUSIVE_LISTS_ATTRIBUTE_DESCRIPTION)}"`,
    );
    expect(providerGo).toContain(
      'ExclusiveLists types.Bool   `tfsdk:"exclusive_lists"`',
    );
    expect(providerGo).toContain(
      "client.exclusiveLists = !data.ExclusiveLists.IsNull() && !data.ExclusiveLists.IsUnknown() && data.ExclusiveLists.ValueBool()",
    );
    expect(clientGo).toContain("exclusiveLists bool");
  });

  test("says what it does, and what leaving it out does", () => {
    expect(EXCLUSIVE_LISTS_ATTRIBUTE_DESCRIPTION).toContain("`labels`");
    expect(EXCLUSIVE_LISTS_ATTRIBUTE_DESCRIPTION).toContain(
      "Left out or `false`",
    );
    expect(EXCLUSIVE_LISTS_ATTRIBUTE_DESCRIPTION).toContain("`true`");
    // The setting is named in the words the provider's others are.
    expect(URL_ATTRIBUTE_DESCRIPTION).not.toBe(
      EXCLUSIVE_LISTS_ATTRIBUTE_DESCRIPTION,
    );
  });
});

describe("entries.go", () => {
  test("is in the provider, with its tests", () => {
    for (const file of [
      "entries.go",
      "entries_test.go",
      "entries_plan_test.go",
    ]) {
      expect([
        file,
        fs.existsSync(path.join(outputDir, providerGoFilePath(file))),
      ]).toEqual([file, true]);
    }
  });
});
