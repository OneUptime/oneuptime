import { describe, expect, test } from "@jest/globals";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import type { ZodType } from "zod";
import Color from "../../../Types/Color";
import DatabaseProperty from "../../../Types/Database/DatabaseProperty";
import Domain from "../../../Types/Domain";
import Email from "../../../Types/Email";
import IP from "../../../Types/IP/IP";
import { JSONObject, JSONValue, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import Port from "../../../Types/Port";
import Version from "../../../Types/Version";
import {
  getColorSchema,
  getDateSchema,
  getDomainSchema,
  getEmailSchema,
  getIPSchema,
  getNameSchema,
  getObjectIDSchema,
  getPhoneSchema,
  getPortSchema,
  getVersionSchema,
} from "../../../Utils/Schema/TypeSchemas";

/*
 * The API schemas of Common's value Types, which the Types built themselves
 * (Email.getSchema() ...) until they moved to Utils/Schema/TypeSchemas so
 * that no frontend loads zod for them (ZodOutOfBrowserGuard).
 *
 * These hold each schema to three things: the OpenAPI it writes into the API
 * reference, exactly as the Types wrote it (a column of each type reads the
 * same in the spec, the MCP tools and the Terraform provider); a value of its
 * Type, as the API takes it, parses - the { _type, value } the Type's
 * toJSON() writes, or an ID's UUID - and so does its own example; and a value
 * of another Type does not.
 */

interface TypeSchemaCase {
  name: string;
  schema: () => ZodType;
  // A value of the Type, as the API takes it.
  value: () => JSONValue;
  // What the OpenAPI document says about a column of the Type.
  openApi: JSONObject;
}

function wrapped(type: ObjectType, value: JSONValue): JSONObject {
  return { _type: type, value: value };
}

const CASES: Array<TypeSchemaCase> = [
  {
    name: "ObjectID",
    schema: getObjectIDSchema,
    value: (): JSONValue => {
      return new ObjectID("123e4567-e89b-12d3-a456-426614174000").toString();
    },
    openApi: {
      type: "string",
      example: "123e4567-e89b-12d3-a456-426614174000",
      format: "uuid",
      description: "A unique identifier for an object, represented as a UUID.",
    },
  },
  {
    name: "Email",
    schema: getEmailSchema,
    value: (): JSONValue => {
      return new Email("Someone@Example.com").toJSON();
    },
    openApi: {
      type: "object",
      description: "Email object",
      example: wrapped(ObjectType.Email, "user@example.com"),
    },
  },
  {
    name: "Phone",
    schema: getPhoneSchema,
    value: (): JSONValue => {
      return new Phone("+15551234567").toJSON();
    },
    openApi: {
      type: "object",
      description: "Phone object",
      example: wrapped(ObjectType.Phone, "+1-555-123-4567"),
    },
  },
  {
    name: "Name",
    schema: getNameSchema,
    value: (): JSONValue => {
      return new Name("Ada Lovelace").toJSON();
    },
    openApi: {
      type: "object",
      description: "Name object",
      example: wrapped(ObjectType.Name, "John Doe"),
    },
  },
  {
    name: "Domain",
    schema: getDomainSchema,
    value: (): JSONValue => {
      return new Domain("status.example.com").toJSON();
    },
    openApi: {
      type: "object",
      description: "Domain object",
      example: wrapped(ObjectType.Domain, "example.com"),
    },
  },
  {
    name: "Version",
    schema: getVersionSchema,
    value: (): JSONValue => {
      return new Version("14.0.95").toJSON();
    },
    openApi: {
      type: "object",
      description: "Version object",
      example: wrapped(ObjectType.Version, "1.0.0"),
    },
  },
  {
    name: "IP",
    schema: getIPSchema,
    value: (): JSONValue => {
      return new IP("10.0.0.7").toJSON();
    },
    openApi: {
      type: "object",
      description: "IP object",
      example: wrapped(ObjectType.IP, "192.168.1.1"),
    },
  },
  {
    name: "Port",
    schema: getPortSchema,
    value: (): JSONValue => {
      return new Port(5432).toJSON();
    },
    openApi: {
      type: "object",
      description: "Port object",
      example: wrapped(ObjectType.Port, 8080),
    },
  },
  {
    name: "Color",
    schema: getColorSchema,
    value: (): JSONValue => {
      return new Color("#00aa55").toJSON();
    },
    openApi: {
      type: "object",
      description: "Color object",
      example: wrapped(ObjectType.Color, "#ff0000"),
    },
  },
  {
    name: "DateTime",
    schema: getDateSchema,
    value: (): JSONValue => {
      // How the API writes a date: JSONFunctions, as every response does.
      return JSONFunctions.serializeValue(
        new Date(Date.UTC(2026, 9, 28, 7, 58, 0)),
      );
    },
    openApi: {
      type: "object",
      description: "A date time object.",
      // The Terraform provider generator reads this wrapper as an RFC 3339 timestamp.
      "x-oneuptime-type": ObjectType.DateTime,
      example: wrapped(ObjectType.DateTime, "2023-10-01T12:00:00Z"),
    },
  },
];

// The component the OpenAPI generator writes for a schema, as the API reference has it.
function openApiOf(schema: ZodType): JSONObject {
  const registry: OpenAPIRegistry = new OpenAPIRegistry();

  registry.register("Schema", schema);

  const document: JSONObject = new OpenApiGeneratorV3(
    registry.definitions,
  ).generateComponents() as unknown as JSONObject;

  return ((document["components"] as JSONObject)["schemas"] as JSONObject)[
    "Schema"
  ] as JSONObject;
}

function accepts(schema: ZodType, value: unknown): boolean {
  return schema.safeParse(value).success;
}

describe("the value Types' API schemas", () => {
  test.each(CASES)(
    "$name: the OpenAPI document says what it said when the Type built it",
    (testCase: TypeSchemaCase) => {
      expect(openApiOf(testCase.schema())).toEqual(testCase.openApi);
    },
  );

  test.each(CASES)(
    "$name: a value of the Type, as the API takes it, parses - and so does the schema's own example",
    (testCase: TypeSchemaCase) => {
      const value: JSONValue = testCase.value();

      expect({ value, accepted: accepts(testCase.schema(), value) }).toEqual({
        value,
        accepted: true,
      });

      const example: unknown = testCase.openApi["example"];

      expect({
        example,
        accepted: accepts(testCase.schema(), example),
      }).toEqual({ example, accepted: true });
    },
  );

  test.each(
    CASES.filter((testCase: TypeSchemaCase): boolean => {
      return testCase.name !== "ObjectID";
    }),
  )(
    "$name: a value written as another Type does not parse",
    (testCase: TypeSchemaCase) => {
      const value: JSONObject = testCase.value() as JSONObject;
      const otherType: ObjectType =
        value["_type"] === ObjectType.Name ? ObjectType.Email : ObjectType.Name;

      expect(accepts(testCase.schema(), { ...value, _type: otherType })).toBe(
        false,
      );
      expect(accepts(testCase.schema(), value["value"])).toBe(false);
    },
  );

  test("each call builds a schema of its own: a model's schema owns the schemas of its columns", () => {
    for (const testCase of CASES) {
      expect({
        name: testCase.name,
        same: testCase.schema() === testCase.schema(),
      }).toEqual({
        name: testCase.name,
        same: false,
      });
    }
  });

  test("an email has to be an address, and a port a whole number from 0 to 65535", () => {
    expect(
      accepts(getEmailSchema(), wrapped(ObjectType.Email, "not an address")),
    ).toBe(false);

    for (const port of [0, 443, 65535]) {
      expect(accepts(getPortSchema(), wrapped(ObjectType.Port, port))).toBe(
        true,
      );
    }

    for (const port of [-1, 65536, 80.5, "80"]) {
      expect({
        port,
        accepted: accepts(getPortSchema(), wrapped(ObjectType.Port, port)),
      }).toEqual({ port, accepted: false });
    }
  });

  test("the Types build no schema themselves any more", () => {
    for (const type of [
      DatabaseProperty,
      Color,
      Domain,
      Email,
      IP,
      Name,
      ObjectID,
      Phone,
      Port,
      Version,
    ]) {
      expect({ type: type.name, getSchema: "getSchema" in type }).toEqual({
        type: type.name,
        getSchema: false,
      });
    }
  });
});
