import { beforeAll, describe, expect, test } from "@jest/globals";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import { JSONObject } from "../../../Types/JSON";
import Models from "../../../Models/DatabaseModels/Index";
import { OpenAPIParser } from "../../../../../Scripts/TerraformProvider/Core/OpenAPIParser";
import { TerraformResource } from "../../../../../Scripts/TerraformProvider/Core/Types";

/*
 * WHAT THE API REFERENCE SAYS OF TWO THINGS AN API CALLER MEETS, FROM THE
 * SPEC THE MODELS GIVE (OpenAPIUtil):
 *
 *   - an update can add single entries to a list of related records, and
 *     take them off, in addToList and removeFromList beside data (#10135):
 *     documented on the update of every model with such a list a caller
 *     may change, naming each list, and on no other;
 *   - a create names the fields it left out because only OneUptime writes
 *     them, in its X-OneUptime-Fields-Left-Out header (#10136).
 *
 * And the Terraform provider generated from the spec reads its attributes
 * from data alone, so it is made the same as before.
 */

let spec: JSONObject;

function operation(path: string, method: string): JSONObject {
  const paths: JSONObject = spec["paths"] as JSONObject;
  return (paths[path] as JSONObject)[method] as JSONObject;
}

function requestBodyProperties(path: string, method: string): JSONObject {
  const body: JSONObject = operation(path, method)["requestBody"] as JSONObject;
  const content: JSONObject = (body["content"] as JSONObject)[
    "application/json"
  ] as JSONObject;
  return (content["schema"] as JSONObject)["properties"] as JSONObject;
}

beforeAll(() => {
  spec = OpenAPIUtil.generateOpenAPISpec();
});

describe("an update's addToList and removeFromList", () => {
  test("a monitor's name its lists, each a list of IDs, and nothing else", () => {
    const properties: JSONObject = requestBodyProperties(
      "/monitor/{id}",
      "put",
    );

    for (const key of ["addToList", "removeFromList"]) {
      const schema: JSONObject = properties[key] as JSONObject;
      const lists: JSONObject = schema["properties"] as JSONObject;

      expect(schema["type"]).toBe("object");
      expect(schema["additionalProperties"]).toBe(false);
      expect(Object.keys(lists)).toEqual(
        expect.arrayContaining(["labels", "dependsOnMonitors"]),
      );
      expect(lists["labels"]).toEqual({
        type: "array",
        items: { type: "string", format: "uuid" },
      });
      // A field that is no list is not one of them.
      expect(lists).not.toHaveProperty("name");
    }

    expect(String(operation("/monitor/{id}", "put")["description"])).toContain(
      "send them in addToList and removeFromList",
    );
    // data is still the update's, as every client sends it.
    expect(properties).toHaveProperty("data");
  });

  test("a model with no list of related records documents neither", () => {
    const properties: JSONObject = requestBodyProperties("/label/{id}", "put");

    expect(Object.keys(properties)).toEqual(["data"]);
    expect(operation("/label/{id}", "put")["description"]).toBe(
      "Endpoint to update an existing Label",
    );
  });
});

describe("a create's X-OneUptime-Fields-Left-Out", () => {
  // The header names of a create's answer, by its path.
  function createdHeaders(path: string): Array<string> | null {
    const methods: JSONObject | undefined = (spec["paths"] as JSONObject)[
      path
    ] as JSONObject | undefined;
    const create: JSONObject | undefined = methods?.["post"] as
      | JSONObject
      | undefined;

    if (!create || !String(create["operationId"] || "").startsWith("create")) {
      return null;
    }

    const created: JSONObject = (create["responses"] as JSONObject)[
      "201"
    ] as JSONObject;

    return Object.keys((created["headers"] as JSONObject) || {});
  }

  test("is documented on the answer of every record's create (BaseAPI sends it)", () => {
    let creates: number = 0;

    for (const modelType of Models) {
      const path: string | undefined = new modelType().crudApiPath?.toString();
      const headers: Array<string> | null = path ? createdHeaders(path) : null;

      if (headers === null) {
        continue;
      }

      creates++;
      expect({ path, headers }).toEqual({
        path,
        headers: ["X-OneUptime-Fields-Left-Out"],
      });
    }

    expect(creates).toBeGreaterThan(100);
  });

  test("not on a telemetry create, which leaves nothing out this way", () => {
    expect(createdHeaders("/logs")).toEqual([]);
  });
});

describe("the Terraform provider made from the spec", () => {
  test("takes a monitor's attributes from data alone: no attribute for addToList or removeFromList", () => {
    const parser: OpenAPIParser = new OpenAPIParser();
    parser.setSpec(spec as never);
    const monitor: TerraformResource | undefined = parser
      .getResources()
      .find((resource: TerraformResource): boolean => {
        return resource.name === "monitor";
      });

    expect(monitor).toBeDefined();
    expect(Object.keys(monitor!.schema)).toContain("labels");
    expect(Object.keys(monitor!.schema)).not.toContain("add_to_list");
    expect(Object.keys(monitor!.schema)).not.toContain("remove_from_list");
  });
});
