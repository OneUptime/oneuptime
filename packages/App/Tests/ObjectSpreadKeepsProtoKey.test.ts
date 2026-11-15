import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import { copyOwnValues } from "Common/Utils/LookupTable";
import { INHERITED_PROPERTY_NAMES } from "Common/Tests/Helpers/InheritedNames";

/*
 * AN OBJECT SPREAD, AS THE APP COMPILES IT (issue #8223).
 *
 * The App runs on ts-node with packages/App/tsconfig.json, and these tests
 * with it too. Its target is ES2018 or later, so `{ ...record }` is the
 * language's own spread, which defines every key of the copy: a key named
 * "__proto__" - an attribute or a label a sender wrote, a decoded body's
 * key - is kept as the copy's own, and an object under it never becomes
 * the copy's prototype. At ES2017 a spread compiled to Object.assign,
 * which dropped the key and took such an object as the prototype, so
 * every spread of a sender's map on the server lost it
 * (Common/Tests/Dependencies/TypeScriptTargets.test.ts pins the targets).
 *
 * Object.assign and plain assignment still drop the key at any target, so
 * a merge or a write by a sender's key goes through Common/Utils/LookupTable.
 */

describe("an object spread in the App's code", () => {
  test.each(INHERITED_PROPERTY_NAMES)(
    "keeps an attribute named %s as the copy's own, as copyOwnValues does",
    (name: string) => {
      const attributes: JSONObject = JSON.parse(
        `{"team":"payments",${JSON.stringify(name)}:"own ${name}"}`,
      ) as JSONObject;
      const spread: JSONObject = { ...attributes };
      const merged: JSONObject = { "service.name": "checkout", ...attributes };

      expect(spread).toEqual(copyOwnValues(attributes));
      expect(Object.keys(spread)).toEqual(["team", name]);
      expect(Object.getOwnPropertyDescriptor(spread, name)?.value).toBe(
        `own ${name}`,
      );
      expect(Object.keys(merged)).toEqual(["service.name", "team", name]);
      expect(Object.getPrototypeOf(spread)).toBe(Object.prototype);
      expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    },
  );

  test("never takes an object or an array under __proto__ as the copy's prototype", () => {
    for (const value of ['{"polluted":"yes"}', '["polluted"]', "null"]) {
      const attributes: JSONObject = JSON.parse(
        `{"__proto__":${value},"team":"payments"}`,
      ) as JSONObject;
      const spread: JSONObject = { ...attributes };

      expect(Object.getPrototypeOf(spread)).toBe(Object.prototype);
      expect((spread as Record<string, unknown>)["polluted"]).toBeUndefined();
      expect(Object.keys(spread)).toEqual(["__proto__", "team"]);
      expect(
        Object.getOwnPropertyDescriptor(spread, "__proto__")?.value,
      ).toEqual(JSON.parse(value));
    }
  });

  test("Object.assign still drops it, which is why a merge of a sender's map uses assignOwnValues", () => {
    const attributes: JSONObject = JSON.parse(
      '{"__proto__":"x","team":"payments"}',
    ) as JSONObject;

    expect(Object.keys(Object.assign({}, attributes))).toEqual(["team"]);
  });
});
