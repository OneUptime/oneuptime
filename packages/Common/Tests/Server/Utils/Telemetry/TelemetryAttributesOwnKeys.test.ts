import TelemetryUtil, {
  AttributeType,
} from "../../../../Server/Utils/Telemetry/Telemetry";
import Dictionary from "../../../../Types/Dictionary";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import { readOwnValue } from "../../../../Utils/LookupTable";
import { INHERITED_PROPERTY_NAMES } from "../../../Helpers/InheritedNames";
import { describe, expect, test } from "@jest/globals";

/*
 * TelemetryUtil.getAttributes turns an OTLP attribute list into the map a
 * log, span, metric or profile row stores (issue #8025). Each key is the
 * sender's, and it was written with an assignment: a key named __proto__
 * was dropped - a string under it ignored, and an array under it made the
 * map's prototype. Every name an object inherits is a key of its own now,
 * whatever value it holds.
 */

type Attributes = Dictionary<AttributeType | Array<AttributeType>>;

const attributesOf: (items: JSONArray, prefix?: string) => Attributes = (
  items: JSONArray,
  prefix: string = "",
): Attributes => {
  // As a decoded OTLP/JSON body holds them.
  return TelemetryUtil.getAttributes({
    items: JSON.parse(JSON.stringify(items)) as JSONArray,
    prefixKeysWithString: prefix,
  });
};

const keyValue: (key: string, value: JSONObject) => JSONObject = (
  key: string,
  value: JSONObject,
): JSONObject => {
  return { key, value };
};

describe("TelemetryUtil.getAttributes keeps every key as the map's own", () => {
  test.each(INHERITED_PROPERTY_NAMES)(
    "an attribute named %s, of every value type OTLP has",
    (name: string) => {
      for (const [value, expected] of [
        [{ stringValue: "text" }, "text"],
        [{ stringValue: "" }, ""],
        [{ intValue: 42 }, 42],
        [{ doubleValue: 1.5 }, 1.5],
        [{ boolValue: false }, false],
        [{ arrayValue: { values: [{ stringValue: "a" }] } }, ["a"]],
        [{ nullValue: 0 }, null],
      ] as Array<[JSONObject, unknown]>) {
        const attributes: Attributes = attributesOf([
          keyValue("service.zone", { stringValue: "eu" }),
          keyValue(name, value),
        ]);

        expect({ name, value, keys: Object.keys(attributes) }).toEqual({
          name,
          value,
          keys: ["service.zone", name],
        });
        expect(readOwnValue(attributes, name)).toEqual(expected);
        expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype);
        expect(TelemetryUtil.getAttributeKeys(attributes)).toEqual(
          ["service.zone", name].sort(),
        );
      }
    },
  );

  test("an array under __proto__ is the attribute's value, never the map's prototype", () => {
    const attributes: Attributes = attributesOf([
      keyValue("__proto__", {
        arrayValue: { values: [{ stringValue: "a" }, { intValue: 2 }] },
      }),
    ]);

    expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype);
    expect(readOwnValue(attributes, "__proto__")).toEqual(["a", 2]);
    // The array's members are no attributes of the map.
    expect((attributes as Record<string, unknown>)["length"]).toBeUndefined();
    expect(JSON.stringify(attributes)).toBe('{"__proto__":["a",2]}');
  });

  test("a kvlist under __proto__ is flattened under its own prefix, as any key's is", () => {
    const attributes: Attributes = attributesOf([
      keyValue("__proto__", {
        kvlistValue: {
          values: [
            keyValue("inner", { stringValue: "x" }),
            keyValue("__proto__", { stringValue: "y" }),
          ],
        },
      }),
    ]);

    expect(Object.keys(attributes)).toEqual([
      "__proto__.inner",
      "__proto__.__proto__",
    ]);
    expect(readOwnValue(attributes, "__proto__")).toBeUndefined();
    expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype);
  });

  test("a kvlist that holds a key named like an inherited member keeps it under its prefix", () => {
    for (const name of INHERITED_PROPERTY_NAMES) {
      const attributes: Attributes = attributesOf([
        keyValue("http", {
          kvlistValue: { values: [keyValue(name, { stringValue: "v" })] },
        }),
      ]);

      expect(readOwnValue(attributes, `http.${name}`)).toBe("v");
    }
  });

  test("under a prefix, such as a resource's, the key is the prefixed one", () => {
    const attributes: Attributes = attributesOf(
      [keyValue("__proto__", { stringValue: "r" })],
      "resource",
    );

    expect(Object.keys(attributes)).toEqual(["resource.__proto__"]);
  });

  test("every name an object inherits at once, in the order sent, and as JSON writes it", () => {
    const sent: JSONArray = INHERITED_PROPERTY_NAMES.map(
      (name: string): JSONObject => {
        return keyValue(name, { stringValue: `own ${name}` });
      },
    );
    const attributes: Attributes = attributesOf(sent);

    expect(Object.keys(attributes)).toEqual([...INHERITED_PROPERTY_NAMES]);

    const written: JSONObject = JSON.parse(JSON.stringify(attributes));

    for (const name of INHERITED_PROPERTY_NAMES) {
      expect(readOwnValue(written, name)).toBe(`own ${name}`);
    }
  });

  test("an attribute without such a name writes none of their keys", () => {
    const attributes: Attributes = attributesOf([
      keyValue("http.method", { stringValue: "GET" }),
    ]);

    for (const name of INHERITED_PROPERTY_NAMES) {
      expect(readOwnValue(attributes, name)).toBeUndefined();
    }
  });
});
