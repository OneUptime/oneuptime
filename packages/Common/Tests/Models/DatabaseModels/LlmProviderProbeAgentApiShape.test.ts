import AIAgent from "../../../Models/DatabaseModels/AIAgent";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Probe from "../../../Models/DatabaseModels/Probe";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import { JSONObject } from "../../../Types/JSON";
import { ModelSchema } from "../../../Utils/Schema/ModelSchema";
import { OpenAPIParser } from "../../../../../Scripts/TerraformProvider/Core/OpenAPIParser";
import { TerraformResource } from "../../../../../Scripts/TerraformProvider/Core/Types";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * WHAT THE API REFERENCE AND THE TERRAFORM PROVIDER SAY ABOUT AN LLM
 * PROVIDER'S SECRETS, AND ABOUT WHO READS PROBES AND AI AGENTS.
 *
 * Both are generated from the models (ModelSchema -> OpenAPI document ->
 * Scripts/TerraformProvider), so they follow the read lists on their own.
 * These pin what that gives:
 *
 *   - an LLM provider's API key and Additional Parameters are documented as
 *     read by project owners and admins, and stay writable by the members who
 *     may change the provider;
 *   - whether parameters are saved (hasAdditionalParams) is read-only in the
 *     API reference and computed in Terraform: no request sets it;
 *   - no column of an LLM provider, a probe or an AI agent is documented as
 *     readable by Public.
 */

type ModelType = { new (): DatabaseBaseModel };

let schemas: Record<string, JSONObject>;

beforeAll(() => {
  const spec: JSONObject = OpenAPIUtil.generateOpenAPISpec();
  schemas = (spec["components"] as JSONObject)["schemas"] as Record<
    string,
    JSONObject
  >;
});

function properties(schemaName: string): Record<string, JSONObject> {
  return (
    (((schemas[schemaName] || {}) as JSONObject)["properties"] as
      | Record<string, JSONObject>
      | undefined) || {}
  );
}

function shapeKeys(schema: unknown): Array<string> {
  return Object.keys((schema as { shape: Record<string, unknown> }).shape);
}

const SECRET_READ_LIST: string = "Read: [Project Owner, Project Admin]";

/*
 * A read list naming Public, as the API reference documents it. Hoisted:
 * eslint's wrap-regex objects to a regex literal used as the object of a
 * member expression.
 */
const READ_BY_PUBLIC: RegExp = /Read: \[[^\]]*\bPublic\b/;

describe("an LLM provider in the API reference", () => {
  test.each(["apiKey", "additionalParams"])(
    "%s is documented as read by project owners and admins",
    (column: string) => {
      const description: string = String(
        properties("LlmProviderReadSchema")[column]?.["description"] || "",
      );

      expect(description).toContain(SECRET_READ_LIST);
    },
  );

  test.each(["apiKey", "additionalParams"])(
    "%s may still be set on create and update",
    (column: string) => {
      expect(
        shapeKeys(ModelSchema.getCreateModelSchema({ modelType: LlmProvider })),
      ).toContain(column);
      expect(
        shapeKeys(ModelSchema.getUpdateModelSchema({ modelType: LlmProvider })),
      ).toContain(column);
    },
  );

  test("whether parameters are saved is read-only, and no write schema has it", () => {
    expect(properties("LlmProviderReadSchema")["hasAdditionalParams"]).toEqual(
      expect.objectContaining({ readOnly: true }),
    );
    expect(
      String(
        properties("LlmProviderReadSchema")["hasAdditionalParams"]?.[
          "description"
        ] || "",
      ),
    ).toContain("Read: [Project Owner, Project Admin, Project Member, Viewer");

    expect(
      shapeKeys(ModelSchema.getCreateModelSchema({ modelType: LlmProvider })),
    ).not.toContain("hasAdditionalParams");
    expect(
      shapeKeys(ModelSchema.getUpdateModelSchema({ modelType: LlmProvider })),
    ).not.toContain("hasAdditionalParams");
    expect(
      properties("LlmProviderCreateSchema")["hasAdditionalParams"],
    ).toBeUndefined();
    expect(
      properties("LlmProviderUpdateSchema")["hasAdditionalParams"],
    ).toBeUndefined();
  });

  test("the Base URL is documented as readable by everyone who reads the provider, so it says to keep credentials out", () => {
    const description: string = String(
      properties("LlmProviderReadSchema")["baseUrl"]?.["description"] || "",
    );

    expect(description).toContain("never put a key, a token or a password");
    expect(description).toContain("Viewer");
  });
});

describe("an LLM provider in the Terraform provider", () => {
  let resource: TerraformResource | undefined;

  beforeAll(() => {
    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(OpenAPIUtil.generateOpenAPISpec() as JSONObject as never);

    resource = parser.getResources().find((candidate: TerraformResource) => {
      return candidate.name === "llm_provider";
    });
  });

  test("the resource exists", () => {
    expect(resource).toBeDefined();
  });

  test("has_additional_params is computed, never taken", () => {
    const attribute: JSONObject = resource?.schema[
      "has_additional_params"
    ] as unknown as JSONObject;

    expect(attribute).toEqual(expect.objectContaining({ computed: true }));
    expect(attribute?.["optional"]).toBeFalsy();
    expect(attribute?.["required"]).toBeFalsy();
  });

  test("additional_params and api_key may still be set", () => {
    for (const name of ["additional_params", "api_key"]) {
      const attribute: JSONObject = resource?.schema[
        name
      ] as unknown as JSONObject;

      expect(attribute).toBeDefined();
      expect(Boolean(attribute["optional"] || attribute["required"])).toBe(
        true,
      );
    }
  });
});

describe("no column of these models is documented as readable by Public", () => {
  test.each([
    ["LlmProvider", LlmProvider],
    ["Probe", Probe],
    ["AIAgent", AIAgent],
  ])("%s", (tableName: string, modelType: ModelType) => {
    const readProperties: Record<string, JSONObject> = properties(
      `${tableName}ReadSchema`,
    );

    // The schema is in the document, and documents its read lists.
    expect(Object.keys(readProperties).length).toBeGreaterThan(5);
    expect(
      Object.values(readProperties).some((property: JSONObject) => {
        return String(property["description"] || "").includes("Read: [");
      }),
    ).toBe(true);

    const publicColumns: Array<string> = Object.entries(readProperties)
      .filter(([, property]: [string, JSONObject]) => {
        return READ_BY_PUBLIC.test(String(property["description"] || ""));
      })
      .map(([column]: [string, JSONObject]) => {
        return column;
      });

    expect(publicColumns).toEqual([]);
    expect(new modelType().getTableColumns().columns.length).toBeGreaterThan(5);
  });
});
