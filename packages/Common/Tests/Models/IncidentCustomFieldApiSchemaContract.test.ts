import { describe, expect, test } from "@jest/globals";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../Models/DatabaseModels/IncidentCustomField";
import IncidentTemplate from "../../Models/DatabaseModels/IncidentTemplate";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "../../Types/JSON";
import { ModelSchema, ModelSchemaType } from "../../Utils/Schema/ModelSchema";

/*
 * What the published API says about the incident custom field settings, and
 * about the custom field values an incident and an incident template hold.
 *
 * The OpenAPI spec, the MCP tools and the Terraform provider are all
 * generated from these columns' metadata (Scripts/OpenAPI,
 * Scripts/TerraformProvider). The provider reads the spec like this:
 *
 *   - a field in the create or update schema is writable; one that is only
 *     in the read schema is Computed (read-only);
 *   - a writable field the server also returns, and that is not required on
 *     create, is Optional+Computed, so a server-filled default causes no
 *     "inconsistent result after apply";
 *   - a spec `default` becomes a value the provider always sends.
 *
 * So these pin, for oneuptime_incident_custom_field: the four settings are
 * writable on create and update, none is required, the three switches say
 * `default: false` (the value a field has when nobody turns them on - never
 * true, which would send every new field to external subscribers), and
 * variableKey is read-only, never in a create or update body. None of them is
 * hidden from the API reference: the docs send readers to it for them.
 */

const SETTINGS: Array<string> = [
  "sortOrder",
  "showOnCreate",
  "isRequiredOnCreate",
  "includeInSubscriberNotifications",
];

const SWITCHES: Array<string> = [
  "showOnCreate",
  "isRequiredOnCreate",
  "includeInSubscriberNotifications",
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

describe("IncidentCustomField settings in the published API", () => {
  const create: JSONObject = generated(IncidentCustomField, getCreate);
  const read: JSONObject = generated(IncidentCustomField, getRead);
  const update: JSONObject = generated(IncidentCustomField, getUpdate);

  test.each(SETTINGS)(
    "%s is documented, not hidden from the API reference",
    (column: string) => {
      expect(
        new IncidentCustomField().getTableColumnMetadata(column)
          .hideColumnInDocumentation,
      ).toBeFalsy();
    },
  );

  test.each(SETTINGS)(
    "%s is writable on create and update, and returned on read",
    (column: string) => {
      expect(propertiesOf(create)[column]).toBeDefined();
      expect(propertiesOf(update)[column]).toBeDefined();
      expect(propertiesOf(read)[column]).toBeDefined();
    },
  );

  test.each(SETTINGS)(
    "%s is not required on create, so a field can be made without it",
    (column: string) => {
      expect(requiredOf(create)).not.toContain(column);
    },
  );

  test.each(SWITCHES)(
    "%s is a boolean whose published default is off",
    (column: string) => {
      const property: JSONObject = propertiesOf(create)[column] as JSONObject;

      expect(property["type"]).toBe("boolean");
      expect(property["default"]).toBe(false);
    },
  );

  /*
   * No published default: a client that leaves it out sends nothing, and
   * the server puts the new field at the end of the list (@ListOrderColumn).
   * A default would be sent on every create and put each new field there.
   */
  test("sortOrder is a number with no default, so leaving it out puts the field at the end", () => {
    const property: JSONObject = propertiesOf(create)[
      "sortOrder"
    ] as JSONObject;

    expect(property["type"]).toBe("number");
    expect(property).not.toHaveProperty("default");
  });

  test("variableKey is read-only: returned on read, never in a create or update body", () => {
    expect(propertiesOf(create)["variableKey"]).toBeUndefined();
    expect(propertiesOf(update)["variableKey"]).toBeUndefined();

    const property: JSONObject = propertiesOf(read)[
      "variableKey"
    ] as JSONObject;

    expect(property).toBeDefined();
    expect(property["type"]).toBe("string");
    expect(property["readOnly"]).toBe(true);
  });

  test("the descriptions say what readers of the API reference need to know", () => {
    const description: (column: string) => string = (
      column: string,
    ): string => {
      return String(
        new IncidentCustomField().getTableColumnMetadata(column).description,
      );
    };

    // 'Required on Create' is the dashboard's, not the API's.
    expect(description("isRequiredOnCreate")).toContain(
      "Incidents created by monitors, the API",
    );
    // Webhooks key the fields by the template variable key.
    expect(description("includeInSubscriberNotifications")).toContain(
      "template variable key",
    );
    // The key survives a rename.
    expect(description("variableKey")).toContain("never changed afterwards");
  });
});

describe("custom field values on incidents and incident templates in the published API", () => {
  test.each([
    ["Incident", Incident],
    ["IncidentTemplate", IncidentTemplate],
  ] as Array<[string, new () => BaseModel]>)(
    "%s.customFields is a writable object whose description says how values are keyed and checked",
    (_name: string, modelType: new () => BaseModel) => {
      const model: BaseModel = new modelType();

      expect(
        model.getTableColumnMetadata("customFields").hideColumnInDocumentation,
      ).toBeFalsy();

      for (const getSchema of [getCreate, getUpdate, getRead]) {
        expect(
          propertiesOf(generated(modelType, getSchema))["customFields"],
        ).toBeDefined();
      }

      const description: string = String(
        model.getTableColumnMetadata("customFields").description,
      );

      expect(description).toContain("keyed by");
      expect(description).toContain("name");
    },
  );

  test("Incident.customFields says a value that does not fit its field is refused", () => {
    const description: string = String(
      new Incident().getTableColumnMetadata("customFields").description,
    );

    expect(description).toContain("refused");
    expect(description).toContain("Required on Create");
  });
});
