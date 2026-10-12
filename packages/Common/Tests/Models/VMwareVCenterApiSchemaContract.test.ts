import { describe, expect, test } from "@jest/globals";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import AllModelTypes from "../../Models/DatabaseModels/Index";
import VMwareVCenter from "../../Models/DatabaseModels/VMwareVCenter";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import Dictionary from "../../Types/Dictionary";
import { JSONObject } from "../../Types/JSON";
import { ModelSchema, ModelSchemaType } from "../../Utils/Schema/ModelSchema";

/*
 * What the published API says about a vCenter one of a project's probes
 * collects - the spec the API reference, the MCP tools and the Terraform
 * provider are generated from (Scripts/OpenAPI, Scripts/TerraformProvider).
 * The provider reads it like this:
 *
 *   - a field in the create or update schema is writable; one only in the
 *     read schema is Computed;
 *   - a writable field no response carries is write-only: the provider keeps
 *     the value it was given instead of reading it back;
 *   - `format: password` makes the attribute Sensitive, so plans and
 *     outputs never print it.
 *
 * So these pin, for oneuptime_vmware_vcenter: the connection settings are
 * writable and none is required (a vCenter the agent sends has none); the
 * password is write-only and a secret; what the probe reports is read-only.
 * And every encrypted text column of every model is a secret to the spec,
 * not only this one.
 */

const CONNECTION_SETTINGS: Array<string> = [
  "collectionMethod",
  "vcenterUrl",
  "vcenterUsername",
  "vcenterPassword",
  "collectionProbeId",
  "trustedCertificateFingerprint",
  "collectionIntervalInMinutes",
];

const REPORTED_BY_THE_PROBE: Array<string> = [
  "isVCenterPasswordSet",
  "vcenterCredentialsUpdatedAt",
  "collectionStatus",
  "collectionErrorCode",
  "collectionError",
  "presentedCertificate",
  "collectionSummary",
  "nextCollectionAt",
  "lastCollectionAt",
  "lastSuccessfulCollectionAt",
  "collectionSettingsVersion",
];

const SECRET_TEXT_TYPES: Array<TableColumnType> = [
  TableColumnType.ShortText,
  TableColumnType.LongText,
  TableColumnType.VeryLongText,
];

type SchemaGetter = (data: {
  modelType: new () => BaseModel;
}) => ModelSchemaType;

function generated(
  modelType: new () => BaseModel,
  getSchema: SchemaGetter,
): JSONObject {
  const registry: OpenAPIRegistry = new OpenAPIRegistry();

  registry.register("Schema", getSchema({ modelType: modelType }));

  const document: JSONObject = new OpenApiGeneratorV3(
    registry.definitions,
  ).generateComponents() as unknown as JSONObject;

  return ((document["components"] as JSONObject)["schemas"] as JSONObject)[
    "Schema"
  ] as JSONObject;
}

function propertiesOf(schema: JSONObject): JSONObject {
  return (schema["properties"] || {}) as JSONObject;
}

function requiredOf(schema: JSONObject): Array<string> {
  return (schema["required"] as Array<string> | undefined) || [];
}

const getCreate: SchemaGetter = (data: {
  modelType: new () => BaseModel;
}): ModelSchemaType => {
  return ModelSchema.getCreateModelSchema(data);
};

const getRead: SchemaGetter = (data: {
  modelType: new () => BaseModel;
}): ModelSchemaType => {
  return ModelSchema.getReadModelSchema(data);
};

const getUpdate: SchemaGetter = (data: {
  modelType: new () => BaseModel;
}): ModelSchemaType => {
  return ModelSchema.getUpdateModelSchema(data);
};

const getGeneral: SchemaGetter = (data: {
  modelType: new () => BaseModel;
}): ModelSchemaType => {
  return ModelSchema.getModelSchema(data);
};

describe("the vCenter API, as Terraform and API clients read it", () => {
  const create: JSONObject = generated(VMwareVCenter, getCreate);
  const update: JSONObject = generated(VMwareVCenter, getUpdate);
  const read: JSONObject = generated(VMwareVCenter, getRead);
  const general: JSONObject = generated(VMwareVCenter, getGeneral);

  test("the connection settings are writable on create and update, and none is required", () => {
    for (const field of CONNECTION_SETTINGS) {
      expect({ field, create: field in propertiesOf(create) }).toEqual({
        field,
        create: true,
      });
      expect({ field, update: field in propertiesOf(update) }).toEqual({
        field,
        update: true,
      });
      expect(requiredOf(create)).not.toContain(field);
    }
  });

  test("the password is write-only: no response carries it", () => {
    expect(propertiesOf(read)).not.toHaveProperty("vcenterPassword");
    expect(propertiesOf(general)).not.toHaveProperty("vcenterPassword");

    // Whether one is saved, and when, is what a reader is told instead.
    expect(propertiesOf(read)).toHaveProperty("isVCenterPasswordSet");
    expect(propertiesOf(read)).toHaveProperty("vcenterCredentialsUpdatedAt");
  });

  test("the password is a secret: Terraform marks it Sensitive", () => {
    for (const schema of [create, update]) {
      expect(
        (propertiesOf(schema)["vcenterPassword"] as JSONObject)["format"],
      ).toBe("password");
    }

    // The settings beside it are not secrets.
    expect(
      (propertiesOf(create)["vcenterUsername"] as JSONObject)["format"],
    ).toBeUndefined();
  });

  test("what the probe reports is read-only", () => {
    for (const field of REPORTED_BY_THE_PROBE) {
      expect({
        field,
        create: field in propertiesOf(create),
        update: field in propertiesOf(update),
        read: field in propertiesOf(read),
      }).toEqual({ field, create: false, update: false, read: true });
    }
  });
});

describe("every encrypted text column is a secret to the spec", () => {
  const models: Array<new () => BaseModel> = AllModelTypes as Array<
    new () => BaseModel
  >;

  // [model, column] for every encrypted text column of every model.
  const secrets: Array<[string, new () => BaseModel, string]> = [];

  for (const modelType of models) {
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(
      new modelType(),
    );

    for (const [column, metadata] of Object.entries(columns)) {
      if (metadata.encrypted && SECRET_TEXT_TYPES.includes(metadata.type)) {
        secrets.push([`${modelType.name}.${column}`, modelType, column]);
      }
    }
  }

  test("there are such columns, this vCenter's password among them", () => {
    expect(
      secrets.map((secret: [string, new () => BaseModel, string]): string => {
        return secret[0];
      }),
    ).toContain("VMwareVCenter.vcenterPassword");
  });

  test.each(secrets)(
    "%s: format password wherever the spec has it",
    (_name: string, modelType: new () => BaseModel, column: string) => {
      for (const getSchema of [getCreate, getUpdate, getRead, getGeneral]) {
        const property: JSONObject | undefined = propertiesOf(
          generated(modelType, getSchema),
        )[column] as JSONObject | undefined;

        if (property) {
          expect(property["format"]).toBe("password");
        }
      }
    },
  );
});
