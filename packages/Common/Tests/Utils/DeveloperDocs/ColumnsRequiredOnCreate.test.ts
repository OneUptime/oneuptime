import { beforeAll, describe, expect, test } from "@jest/globals";
import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import Models from "../../../Models/DatabaseModels/Index";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OpenAPIUtil from "../../../Server/Utils/OpenAPI";
import { JSONObject } from "../../../Types/JSON";
import {
  getColumnsRequiredOnCreate,
  getTerraformModelOperations,
  isModelInPublicApi,
} from "../../../Utils/DeveloperDocs/TerraformSchema";

/*
 * getColumnsRequiredOnCreate is what the API reference badges Required
 * (APIReference/Service/Model, #5164's follow-ups): the columns a create
 * must send. It has to be the real create schema's required list - the one
 * the OpenAPI spec publishes and checkRequiredFields keeps to - for every
 * model a create can be made of, so the badge never says Required of a
 * column a create may leave out, nor leaves it off one it may not.
 */

let createSchemas: Record<string, JSONObject>;

beforeAll(() => {
  const spec: JSONObject = OpenAPIUtil.generateOpenAPISpec() as JSONObject;

  createSchemas = ((spec["components"] as JSONObject)["schemas"] ||
    {}) as Record<string, JSONObject>;
}, 600000);

function creatableModels(): Array<[string, DatabaseBaseModelType]> {
  return Models.filter((modelType: DatabaseBaseModelType): boolean => {
    return (
      isModelInPublicApi(modelType) &&
      getTerraformModelOperations(modelType).canCreate
    );
  }).map(
    (modelType: DatabaseBaseModelType): [string, DatabaseBaseModelType] => {
      return [modelType.name, modelType];
    },
  );
}

describe("the columns a create must send", () => {
  test("there are models to hold to the spec", () => {
    expect(creatableModels().length).toBeGreaterThan(100);
  });

  test.each(creatableModels())(
    "%s: the create schema's required list",
    (_name: string, modelType: DatabaseBaseModelType) => {
      const tableName: string = new modelType().tableName as string;
      const schema: JSONObject | undefined =
        createSchemas[`${tableName}CreateSchema`];

      expect(schema).toBeDefined();
      expect([...getColumnsRequiredOnCreate(modelType)].sort()).toEqual(
        [...((schema!["required"] as Array<string> | undefined) || [])].sort(),
      );
    },
  );

  test("a column with a default, the project id and the id are never among them", () => {
    expect(getColumnsRequiredOnCreate(DetectionRule)).not.toContain(
      "isEnabled",
    );
    expect(getColumnsRequiredOnCreate(DetectionRule)).toContain("name");
    expect(getColumnsRequiredOnCreate(Monitor)).not.toContain("projectId");
    expect(getColumnsRequiredOnCreate(Monitor)).not.toContain("_id");
    expect(getColumnsRequiredOnCreate(Monitor)).toContain("name");
  });
});
