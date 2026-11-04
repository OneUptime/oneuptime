import { describe, expect, test } from "@jest/globals";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OpenStackCloud from "../../Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudConnectionTest from "../../Models/DatabaseModels/OpenStackCloudConnectionTest";
import { JSONObject } from "../../Types/JSON";
import {
  TerraformAttributeDescriptor,
  TerraformSecretKind,
  TerraformValueKind,
  getTerraformAttributes,
  getTerraformTypeName,
} from "../../Utils/DeveloperDocs/TerraformSchema";
import { ModelSchema, ModelSchemaType } from "../../Utils/Schema/ModelSchema";

/*
 * What the published API says about a cloud one of a project's probes collects: the spec the
 * API reference, the MCP tools and the Terraform provider are generated from
 * (Scripts/OpenAPI, Scripts/TerraformProvider). The provider reads it like this:
 *
 *   - a field in the create or update schema is writable, and one only in the read schema
 *     is Computed;
 *   - a writable field no response carries is write-only, so the provider keeps the value
 *     it was given instead of reading it back;
 *   - `format: password` makes the attribute Sensitive, so plans and outputs never print it.
 *
 * So these pin, for oneuptime_openstack_cloud: the connection settings are writable and none
 * is required (a cloud the agent sends has none), the secret is write-only and a secret, and
 * what the probe reports is read-only. That is what lets a cloud be connected from Terraform
 * alone.
 */

const CONNECTION_SETTINGS: Array<string> = [
  "collectionMethod",
  "authUrl",
  "endpointInterface",
  "collectionRegions",
  "credentialKind",
  "applicationCredentialId",
  "keystoneUsername",
  "userDomainName",
  "projectName",
  "projectDomainName",
  "credentialSecret",
  "collectionProbeId",
  "trustedCertificateFingerprints",
  "collectionIntervalInMinutes",
  "collectionOptions",
];

const REPORTED_BY_THE_PROBE: Array<string> = [
  "isCredentialSet",
  "credentialsUpdatedAt",
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

describe("the cloud API, as Terraform and API clients read it", () => {
  const create: JSONObject = generated(OpenStackCloud, getCreate);
  const update: JSONObject = generated(OpenStackCloud, getUpdate);
  const read: JSONObject = generated(OpenStackCloud, getRead);
  const general: JSONObject = generated(OpenStackCloud, getGeneral);

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

  test("a client that only names a cloud still gets a valid create: the agent's way in", () => {
    expect(requiredOf(create)).toEqual(["name"]);
  });

  test("the secret is write-only: no response carries it", () => {
    expect(propertiesOf(read)).not.toHaveProperty("credentialSecret");
    expect(propertiesOf(general)).not.toHaveProperty("credentialSecret");

    // Whether one is saved, and when, is what a reader is told instead.
    expect(propertiesOf(read)).toHaveProperty("isCredentialSet");
    expect(propertiesOf(read)).toHaveProperty("credentialsUpdatedAt");
  });

  test("the secret is a secret: Terraform marks it Sensitive", () => {
    for (const schema of [create, update]) {
      expect(
        (propertiesOf(schema)["credentialSecret"] as JSONObject)["format"],
      ).toBe("password");
    }

    // The settings beside it are not secrets.
    for (const field of [
      "applicationCredentialId",
      "keystoneUsername",
      "projectName",
      "authUrl",
    ]) {
      expect((propertiesOf(create)[field] as JSONObject)["format"]).not.toBe(
        "password",
      );
    }
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

  test("a setting with only a few values says which it takes", () => {
    expect(
      (propertiesOf(create)["collectionMethod"] as JSONObject)["enum"],
    ).toEqual(["Agent", "Probe"]);
    expect(
      (propertiesOf(create)["endpointInterface"] as JSONObject)["enum"],
    ).toEqual(["public", "internal", "admin"]);
    expect(
      (propertiesOf(create)["credentialKind"] as JSONObject)["enum"],
    ).toEqual(["applicationCredential", "password"]);
  });
});

describe("the cloud's Terraform attributes", () => {
  const attributes: Array<TerraformAttributeDescriptor> =
    getTerraformAttributes(OpenStackCloud);

  function attribute(name: string): TerraformAttributeDescriptor {
    const found: TerraformAttributeDescriptor | undefined = attributes.find(
      (descriptor: TerraformAttributeDescriptor): boolean => {
        return descriptor.attributeName === name;
      },
    );

    expect({ name, isAttribute: Boolean(found) }).toEqual({
      name,
      isAttribute: true,
    });

    return found!;
  }

  test("the resource is oneuptime_openstack_cloud, with the word whole", () => {
    expect(getTerraformTypeName(OpenStackCloud)).toBe(
      "oneuptime_openstack_cloud",
    );
  });

  test("the secret is one a configuration sets and never reads back", () => {
    const secret: TerraformAttributeDescriptor = attribute("credential_secret");

    expect(secret.secretKind).toBe(TerraformSecretKind.Secret);
    expect(secret.readPermissions).toEqual([]);
    expect(secret.inCreateSchema).toBe(true);
    expect(secret.inUpdateSchema).toBe(true);
    expect(secret.isRequired).toBe(false);
  });

  test("whether one is saved is the server's to say, and no attribute a configuration sets", () => {
    expect(
      attributes
        .map((descriptor: TerraformAttributeDescriptor): string => {
          return descriptor.columnName;
        })
        .filter((columnName: string): boolean => {
          return /^is\w+Set$/.test(columnName);
        }),
    ).toEqual([]);
  });

  test("a configuration can say everything a connection needs", () => {
    expect(attribute("collection_method").kind).toBe(TerraformValueKind.String);
    expect(attribute("auth_url").kind).toBe(TerraformValueKind.String);
    expect(attribute("application_credential_id").kind).toBe(
      TerraformValueKind.String,
    );
    expect(attribute("collection_probe_id").kind).toBe(
      TerraformValueKind.String,
    );
    expect(attribute("collection_interval_in_minutes").kind).toBe(
      TerraformValueKind.Number,
    );

    // JSON columns: the regions and certificates are arrays written as JSON.
    for (const name of [
      "collection_regions",
      "trusted_certificate_fingerprints",
      "collection_options",
    ]) {
      expect(attribute(name).kind).toBe(TerraformValueKind.Json);
    }
  });

  test("the only attribute a cloud needs is its name", () => {
    expect(
      attributes
        .filter((descriptor: TerraformAttributeDescriptor): boolean => {
          return descriptor.isRequired;
        })
        .map((descriptor: TerraformAttributeDescriptor): string => {
          return descriptor.attributeName;
        }),
    ).toEqual(["name"]);
  });
});

/*
 * A connection test holds a secret too, and it is the dashboard's: it goes in with the
 * request and never comes back. The sweep of every encrypted column in
 * VMwareVCenterApiSchemaContract.test.ts holds it to `format: password` as well.
 */
describe("a connection test, as the API reads it", () => {
  const create: JSONObject = generated(OpenStackCloudConnectionTest, getCreate);
  const read: JSONObject = generated(OpenStackCloudConnectionTest, getRead);

  test("a test carries a secret in, and no response carries it out", () => {
    expect(propertiesOf(create)).toHaveProperty("credentialSecret");
    expect(
      (propertiesOf(create)["credentialSecret"] as JSONObject)["format"],
    ).toBe("password");
    expect(propertiesOf(read)).not.toHaveProperty("credentialSecret");
  });

  test("what the probe found is read-only", () => {
    for (const field of [
      "status",
      "errorCode",
      "errorMessage",
      "presentedCertificate",
      "summary",
      "claimedAt",
      "completedAt",
    ]) {
      expect({
        field,
        create: field in propertiesOf(create),
        read: field in propertiesOf(read),
      }).toEqual({ field, create: false, read: true });
    }
  });

  test("a test names its address and its probe, and needs nothing else to be started", () => {
    expect(requiredOf(create).sort()).toEqual(["authUrl", "probeId"]);
  });
});
