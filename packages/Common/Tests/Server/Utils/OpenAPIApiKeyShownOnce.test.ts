import { beforeAll, describe, expect, it } from "@jest/globals";
import { OpenAPIParser } from "../../../../../Scripts/TerraformProvider/Core/OpenAPIParser";
import {
  OpenAPISpec,
  TerraformAttribute,
  TerraformDataSource,
  TerraformResource,
} from "../../../../../Scripts/TerraformProvider/Core/Types";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import { JSONObject } from "../../../Types/JSON";

/*
 * A PROJECT'S API KEY IN THE PUBLISHED OPENAPI SPECIFICATION (#8902), which
 * API clients, the API reference and the Terraform and OpenTofu provider
 * are generated from.
 *
 * The key is stored as its hash and answered once, by the create that makes
 * it. So the spec says exactly that:
 *
 *   - the create answers ApiKeyCreatedSchema, the only schema that holds
 *     apiKey - a uuid, read only, a secret, marked x-oneuptime-shown-once;
 *   - no read holds it: not the record a get-item answers, nor a list's,
 *     nor what an update answers; and nothing may select, filter, sort or
 *     group by it;
 *   - nobody writes it: it is in neither the create's nor the update's
 *     request;
 *   - its hint (apiKeyHint) is read like any read-only field.
 *
 * And the real provider parser, reading the real spec, keeps api_key from
 * the create's answer and leaves it out of the data source.
 *
 * One other column is answered once, the same way: a blocklist feed's
 * secret (#10596), which OneUptime makes, answers to the create that makes
 * the feed and to a rotation of it, and keeps only as its hash. No other
 * model answers a column once.
 *
 * The whole spec is generated once for the suite: it walks every model.
 */

describe("a project's API key in the OpenAPI specification", () => {
  let spec: JSONObject;
  let paths: JSONObject;
  let schemas: JSONObject;

  function schemaOf(name: string): JSONObject {
    const schema: JSONObject | undefined = schemas[name] as
      | JSONObject
      | undefined;

    expect({ name, registered: Boolean(schema) }).toEqual({
      name,
      registered: true,
    });

    return schema as JSONObject;
  }

  function propertiesOf(name: string): JSONObject {
    return (schemaOf(name)["properties"] || {}) as JSONObject;
  }

  // The schema an operation answers with, by name.
  function answeredBy(path: string, method: string): string {
    const operation: JSONObject = (paths[path] as JSONObject)[
      method
    ] as JSONObject;
    const responses: JSONObject = operation["responses"] as JSONObject;
    const success: JSONObject = (responses["200"] ||
      responses["201"]) as JSONObject;
    const data: JSONObject = (
      ((success["content"] as JSONObject)["application/json"] as JSONObject)[
        "schema"
      ] as JSONObject
    )["properties"] as JSONObject;

    return String((data["data"] as JSONObject)["$ref"]).replace(
      "#/components/schemas/",
      "",
    );
  }

  beforeAll(() => {
    spec = OpenAPIUtil.generateOpenAPISpec();
    paths = (spec["paths"] || {}) as JSONObject;
    schemas = ((spec["components"] as JSONObject | undefined)?.["schemas"] ||
      {}) as JSONObject;
  });

  it("the create answers the key once, in a schema of its own", () => {
    expect(answeredBy("/api-key", "post")).toBe("ApiKeyCreatedSchema");

    const apiKey: JSONObject = propertiesOf("ApiKeyCreatedSchema")[
      "apiKey"
    ] as JSONObject;

    expect(apiKey).toEqual(
      expect.objectContaining({
        type: "string",
        format: "uuid",
        readOnly: true,
        "x-oneuptime-secret": true,
        "x-oneuptime-shown-once": true,
      }),
    );
    expect(String(apiKey["description"])).toContain("Shown once");

    // Its operation says so too.
    expect(
      String(
        ((paths["/api-key"] as JSONObject)["post"] as JSONObject)[
          "description"
        ],
      ),
    ).toContain("the only one that holds apiKey");
  });

  it("no read holds it, nor its hash: not a record, a list or an update's answer", () => {
    expect(answeredBy("/api-key/{id}/get-item", "post")).toBe("ApiKey");

    for (const name of ["ApiKey", "ApiKeyReadSchema"]) {
      expect([name, Object.keys(propertiesOf(name))]).not.toEqual([
        name,
        expect.arrayContaining(["apiKey"]),
      ]);
      expect([name, propertiesOf(name)["apiKeyHint"]]).toEqual([
        name,
        expect.objectContaining({ type: "string", readOnly: true }),
      ]);
    }
  });

  it("nothing selects, filters, sorts or groups by it", () => {
    for (const name of [
      "ApiKeySelectSchema",
      "ApiKeyQuerySchema",
      "ApiKeySortSchema",
      "ApiKeyGroupBySchema",
    ]) {
      if (!schemas[name]) {
        continue;
      }

      expect([name, Object.keys(propertiesOf(name))]).not.toEqual([
        name,
        expect.arrayContaining(["apiKey"]),
      ]);
    }

    expect(Object.keys(propertiesOf("ApiKeySelectSchema"))).toContain(
      "apiKeyHint",
    );
  });

  it("nobody writes it, nor its hint", () => {
    for (const name of ["ApiKeyCreateSchema", "ApiKeyUpdateSchema"]) {
      expect([name, Object.keys(propertiesOf(name))]).not.toEqual([
        name,
        expect.arrayContaining(["apiKey"]),
      ]);
      expect([name, Object.keys(propertiesOf(name))]).not.toEqual([
        name,
        expect.arrayContaining(["apiKeyHint"]),
      ]);
    }
  });

  it("a blocklist feed's secret is answered once too: by the create, and by nothing else (#10596)", () => {
    expect(answeredBy("/security-blocklist-feed", "post")).toBe(
      "SecurityBlocklistFeedCreatedSchema",
    );
    expect(
      propertiesOf("SecurityBlocklistFeedCreatedSchema")["secret"],
    ).toEqual(
      expect.objectContaining({
        readOnly: true,
        "x-oneuptime-secret": true,
        "x-oneuptime-shown-once": true,
      }),
    );

    // Not a record, a list's, nor what an update answers; nobody writes it.
    for (const name of [
      answeredBy("/security-blocklist-feed/{id}/get-item", "post"),
      "SecurityBlocklistFeedReadSchema",
      "SecurityBlocklistFeedCreateSchema",
      "SecurityBlocklistFeedUpdateSchema",
    ]) {
      expect([name, Object.keys(propertiesOf(name))]).not.toEqual([
        name,
        expect.arrayContaining(["secret"]),
      ]);
    }

    // Nothing selects, filters, sorts or groups by it.
    for (const name of [
      "SecurityBlocklistFeedSelectSchema",
      "SecurityBlocklistFeedQuerySchema",
      "SecurityBlocklistFeedSortSchema",
      "SecurityBlocklistFeedGroupBySchema",
    ]) {
      if (!schemas[name]) {
        continue;
      }

      expect([name, Object.keys(propertiesOf(name))]).not.toEqual([
        name,
        expect.arrayContaining(["secret"]),
      ]);
    }
  });

  it("no other model answers a column once: the created schemas are the API key's and the blocklist feed's", () => {
    expect(
      Object.keys(schemas).filter((name: string): boolean => {
        return name.endsWith("CreatedSchema");
      }),
    ).toEqual(["ApiKeyCreatedSchema", "SecurityBlocklistFeedCreatedSchema"]);
  });

  it("the real provider parser keeps api_key from the create's answer, and the data source has none", () => {
    const parser: OpenAPIParser = new OpenAPIParser();

    parser.setSpec(spec as unknown as OpenAPISpec);

    const resource: TerraformResource | undefined = parser
      .getResources()
      .find((candidate: TerraformResource): boolean => {
        return candidate.name === "api_key";
      });
    const apiKey: TerraformAttribute | undefined = resource?.schema["api_key"];

    expect(apiKey).toEqual(
      expect.objectContaining({
        shownOnce: true,
        sensitive: true,
        computed: true,
        required: false,
        optional: false,
      }),
    );
    expect(resource?.schema["api_key_hint"]?.computed).toBe(true);

    const dataSource: TerraformDataSource | undefined = parser
      .getDataSources()
      .find((candidate: TerraformDataSource): boolean => {
        return candidate.name === "api_key";
      });

    expect(dataSource).toBeDefined();
    expect(dataSource?.schema["api_key"]).toBeUndefined();
    expect(dataSource?.schema["api_key_hint"]).toBeDefined();
  });
});
