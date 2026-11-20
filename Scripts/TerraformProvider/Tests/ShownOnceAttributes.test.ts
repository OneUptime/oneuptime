import fs from "fs";
import os from "os";
import path from "path";
import { OpenAPIParser } from "../Core/OpenAPIParser";
import { ResourceGenerator } from "../Core/ResourceGenerator";
import { DataSourceGenerator } from "../Core/DataSourceGenerator";
import {
  OpenAPISpec,
  TerraformAttribute,
  TerraformDataSource,
  TerraformResource,
} from "../Core/Types";
import { providerGoFilePath } from "../Core/ProviderShards";

/*
 * A SECRET ANSWERED ONCE IS KEPT IN STATE FROM THE CREATE'S ANSWER (#8902).
 *
 * A project's API key is stored as its hash: the create's answer holds the
 * key (the spec's <Table>CreatedSchema, x-oneuptime-shown-once), and no
 * read does - not get-item, not the list. Read back as every other
 * attribute is, api_key was null after the first refresh, and every
 * configuration that passed it on lost it. Now the provider:
 *
 *   - sets it from the create's answer, before anything is saved to state;
 *   - never selects it, nor maps it from a read: the create's read-back, a
 *     refresh and an update's read-back all keep it as state holds it;
 *   - keeps it through an update, and plans it as its state value;
 *   - keeps it Sensitive and read only, and says where it comes from;
 *   - leaves it out of the data source, which only reads.
 */

const dateTime: any = {
  type: "object",
  "x-oneuptime-type": "DateTime",
  description: "A date time object.",
};

const shownOnceKey: any = {
  type: "string",
  format: "uuid",
  readOnly: true,
  "x-oneuptime-secret": true,
  "x-oneuptime-shown-once": true,
  description:
    "The secret key, sent in the ApiKey header of each request. Shown once: in the answer to the create that makes it.",
};

function buildSpec(): OpenAPISpec {
  const writable: Record<string, any> = {
    name: { type: "string", description: "Any friendly name." },
    expiresAt: dateTime,
  };
  const readOnly: Record<string, any> = {
    apiKeyHint: {
      type: "string",
      readOnly: true,
      description: "The key's last four characters.",
    },
    slug: { type: "string", readOnly: true, description: "Its slug." },
  };
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
  const answer: (name: string) => any = (name: string): any => {
    return {
      "200": {
        description: "ok",
        content: {
          "application/json": {
            schema: { type: "object", properties: { data: ref(name) } },
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

  const paths: Record<string, any> = {
    "/api-key": {
      post: {
        operationId: "createApiKey",
        tags: ["API Key"],
        requestBody: body("ApiKeyCreateSchema"),
        // The create's answer, the only one that holds the key.
        responses: answer("ApiKeyCreatedSchema"),
      },
    },
    "/api-key/get-list": {
      post: {
        operationId: "listApiKey",
        tags: ["API Key"],
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { type: "array", items: ref("ApiKey") },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api-key/{id}/get-item": {
      post: {
        operationId: "getApiKey",
        tags: ["API Key"],
        parameters: [id],
        responses: answer("ApiKey"),
      },
    },
    "/api-key/{id}": {
      put: {
        operationId: "updateApiKey",
        tags: ["API Key"],
        parameters: [id],
        requestBody: body("ApiKeyUpdateSchema"),
        responses: answer("ApiKey"),
      },
      delete: {
        operationId: "deleteApiKey",
        tags: ["API Key"],
        parameters: [id],
        responses: answer("ApiKey"),
      },
    },
  };

  return {
    openapi: "3.0.0",
    info: { title: "OneUptime", version: "1.0.0" },
    servers: [{ url: "https://oneuptime.com/api" }],
    tags: [{ name: "API Key", description: "A project's API keys." }],
    paths: paths,
    components: {
      schemas: {
        ApiKeyCreateSchema: {
          type: "object",
          required: ["name"],
          properties: writable,
        },
        ApiKeyUpdateSchema: { type: "object", properties: writable },
        ApiKey: {
          type: "object",
          properties: { _id: { type: "string" }, ...writable, ...readOnly },
        },
        ApiKeyCreatedSchema: {
          type: "object",
          properties: {
            _id: { type: "string" },
            ...writable,
            ...readOnly,
            apiKey: shownOnceKey,
          },
        },
      },
    },
  };
}

let resource: TerraformResource;
let dataSource: TerraformDataSource;
let outputDir: string;
let resourceGo: string;
let dataSourceGo: string;

function block(source: string, attribute: string): string {
  const start: number = source.indexOf(`"${attribute}": schema.`);
  if (start === -1) {
    throw new Error(`no attribute ${attribute}`);
  }
  return source.substring(start, source.indexOf("\n            },\n", start));
}

// One method of the generated resource, from its signature to the next one.
function method(name: string): string {
  const start: number = resourceGo.indexOf(`func (r *ApiKeyResource) ${name}(`);

  if (start === -1) {
    throw new Error(`no ${name} method`);
  }

  const next: number = resourceGo.indexOf("\nfunc ", start + 1);

  return resourceGo.substring(start, next === -1 ? undefined : next);
}

beforeAll(async () => {
  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(buildSpec());
  resource = parser.getResources()[0]!;
  dataSource = parser.getDataSources()[0]!;

  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-shown-once-"));
  const config: any = {
    outputDir,
    providerName: "oneuptime",
    providerVersion: "14.0.0",
    goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
  };
  await new ResourceGenerator(config, buildSpec()).generateResources();
  await new DataSourceGenerator(config, buildSpec()).generateDataSources();
  resourceGo = fs.readFileSync(
    path.join(outputDir, providerGoFilePath("resource_api_key.go")),
    "utf-8",
  );
  dataSourceGo = fs.readFileSync(
    path.join(outputDir, providerGoFilePath("data_source_api_key.go")),
    "utf-8",
  );
});

afterAll(() => {
  fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("the parser", () => {
  test("reads the key as answered once, a read-only secret", () => {
    const apiKey: TerraformAttribute | undefined = resource.schema["api_key"];

    expect(apiKey?.shownOnce).toBe(true);
    expect(apiKey?.sensitive).toBe(true);
    expect(apiKey?.computed).toBe(true);
    expect(apiKey?.required).toBe(false);
    expect(apiKey?.optional).toBe(false);
  });

  test("says where its value comes from, and that an imported key has none", () => {
    expect(resource.schema["api_key"]?.description).toContain(
      OpenAPIParser.SHOWN_ONCE_DESCRIPTION,
    );
    expect(OpenAPIParser.SHOWN_ONCE_DESCRIPTION).toContain("imported");
  });

  test("marks nothing else answered once", () => {
    for (const [name, attribute] of Object.entries(resource.schema)) {
      if (name !== "api_key") {
        expect([name, attribute.shownOnce]).toEqual([name, undefined]);
      }
    }
  });
});

describe("the generated resource", () => {
  test("the key is Sensitive, read only, and planned as its state value", () => {
    const apiKey: string = block(resourceGo, "api_key");

    expect(apiKey).toContain("Sensitive: true");
    expect(apiKey).toContain("Computed: true");
    expect(apiKey).not.toContain("Optional: true");
    expect(apiKey).toContain("stringplanmodifier.UseStateForUnknown()");
  });

  test("Create sets the key from the create's answer, before anything is saved to state", () => {
    const create: string = method("Create");
    const id: number = create.indexOf("data.Id = types.StringValue(createdId)");
    const shownOnce: number = create.indexOf('shownOnceMap["apiKey"]');
    const firstSave: number = create.indexOf("resp.State.Set(ctx, &data)");

    expect(id).toBeGreaterThan(-1);
    expect(shownOnce).toBeGreaterThan(id);
    expect(firstSave).toBeGreaterThan(shownOnce);
    // From the create's own answer, not the read-back.
    expect(create).toContain("shownOnceMap = wrapper");
    expect(create).toContain('apiKeyResponse["data"]');
  });

  test("no read is asked for the key, or maps it: not the create's read-back, a refresh, nor an update's", () => {
    for (const name of ["Create", "Read", "Update"]) {
      const body: string = method(name);

      expect([name, body.includes('dataMap["apiKey"]')]).toEqual([name, false]);
      expect([name, body.includes('"apiKey": true')]).toEqual([name, false]);
    }
  });

  test("an update keeps the key as state holds it - null for an imported key", () => {
    const update: string = method("Update");

    expect(update).toContain("data.ApiKey = state.ApiKey");
    expect(update.indexOf("data.ApiKey = state.ApiKey")).toBeLessThan(
      update.indexOf("selectParam"),
    );
  });

  test("what every read answers is still read back: how the key ends, its slug", () => {
    for (const name of ["Read", "Update"]) {
      const body: string = method(name);

      expect([name, body.includes('dataMap["apiKeyHint"]')]).toEqual([
        name,
        true,
      ]);
      expect([name, body.includes('"apiKeyHint": true')]).toEqual([name, true]);
    }
  });
});

describe("the data source", () => {
  test("has no key: it only reads, and no read holds one", () => {
    expect(dataSource.schema["api_key"]).toBeUndefined();
    expect(dataSourceGo).not.toContain('"api_key": schema.');
    expect(dataSource.schema["api_key_hint"]).toBeDefined();
  });
});
