import { JSONArray, JSONObject, JSONValue, ObjectType } from "../../Types/JSON";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import JSONFunctions from "../../Types/JSONFunctions";

describe("JSONFunctions Class", () => {
  let baseModel: BaseModel;

  beforeEach(() => {
    baseModel = new BaseModel();
  });

  describe("isEmptyObject Method", () => {
    test("Returns true for an empty object", () => {
      const emptyObj: JSONObject = {};
      expect(JSONFunctions.isEmptyObject(emptyObj)).toBe(true);
    });

    test("Returns false for a non-empty object", () => {
      const nonEmptyObj: JSONObject = { key: "value" };
      expect(JSONFunctions.isEmptyObject(nonEmptyObj)).toBe(false);
    });

    test("Returns true for null or undefined", () => {
      expect(JSONFunctions.isEmptyObject(null)).toBe(true);
      expect(JSONFunctions.isEmptyObject(undefined)).toBe(true);
    });
  });

  describe("toJSON and fromJSON Methods", () => {
    test("toJSON returns a valid JSON object", () => {
      const json: JSONObject = BaseModel.toJSON(baseModel, BaseModel);
      expect(json).toEqual(expect.objectContaining({}));
    });

    test("toJSONObject returns a valid JSON object", () => {
      const json: JSONObject = BaseModel.toJSONObject(baseModel, BaseModel);
      expect(json).toEqual(expect.objectContaining({}));
    });

    test("fromJSON returns a BaseModel instance", () => {
      const json: JSONObject = { name: "oneuptime" };
      const result: BaseModel | BaseModel[] = BaseModel.fromJSON(
        json,
        BaseModel,
      );
      expect(result).toBeInstanceOf(BaseModel);
    });
  });

  describe("deepEqual Method", () => {
    test("Returns true for two structurally equal objects", () => {
      expect(
        JSONFunctions.deepEqual(
          { a: 1, b: { c: [1, 2] } },
          { a: 1, b: { c: [1, 2] } },
        ),
      ).toBe(true);
    });

    test("Returns false when a nested value differs", () => {
      expect(
        JSONFunctions.deepEqual({ a: 1, b: { c: 1 } }, { a: 1, b: { c: 2 } }),
      ).toBe(false);
    });

    test("Returns false when keys differ", () => {
      expect(JSONFunctions.deepEqual({ a: 1 }, { b: 1 })).toBe(false);
    });

    test("Compares arrays element by element", () => {
      expect(JSONFunctions.deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
      expect(JSONFunctions.deepEqual([1, 2], [1, 2, 3])).toBe(false);
    });

    test("Compares Date instances by time value", () => {
      expect(JSONFunctions.deepEqual(new Date(0), new Date(0))).toBe(true);
      expect(JSONFunctions.deepEqual(new Date(0), new Date(1000))).toBe(false);
    });

    test("Returns false when comparing an object with null", () => {
      expect(JSONFunctions.deepEqual({ a: 1 }, null)).toBe(false);
      expect(JSONFunctions.deepEqual(null, null)).toBe(true);
    });
  });

  describe("isJSONObjectDifferent Method", () => {
    test("Returns false for equal objects", () => {
      expect(JSONFunctions.isJSONObjectDifferent({ a: 1 }, { a: 1 })).toBe(
        false,
      );
    });

    test("Returns true for different objects", () => {
      expect(JSONFunctions.isJSONObjectDifferent({ a: 1 }, { a: 2 })).toBe(
        true,
      );
    });
  });

  describe("isEqualObject Method", () => {
    test("Returns true for two objects with the same keys and values", () => {
      expect(JSONFunctions.isEqualObject({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(
        true,
      );
    });

    test("Returns false when a value differs", () => {
      expect(JSONFunctions.isEqualObject({ a: 1 }, { a: 2 })).toBe(false);
    });

    test("Returns false when the number of keys differs", () => {
      expect(JSONFunctions.isEqualObject({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    });

    test("Returns true when both objects are undefined", () => {
      expect(JSONFunctions.isEqualObject(undefined, undefined)).toBe(true);
    });

    test("Returns false when only one object is undefined", () => {
      expect(JSONFunctions.isEqualObject({ a: 1 }, undefined)).toBe(false);
    });
  });

  describe("nestJson Method", () => {
    test("Expands dot-separated keys into nested objects", () => {
      const input: JSONObject = {
        "a.b.c": 1,
        "a.b.d": 2,
        x: 3,
      };
      expect(JSONFunctions.nestJson(input)).toEqual({
        a: { b: { c: 1, d: 2 } },
        x: 3,
      });
    });

    test("builds null-prototype dictionaries at every generated level", () => {
      const result: JSONObject = JSONFunctions.nestJson({ "a.b": 1 });

      expect(Object.getPrototypeOf(result)).toBeNull();
      expect(Object.getPrototypeOf(result["a"] as JSONObject)).toBeNull();
    });

    test.each([
      "__proto__.polluted",
      "safe.__proto__.polluted",
      "constructor.prototype.polluted",
      "safe.constructor.polluted",
      "safe.prototype.polluted",
    ])("rejects the unsafe object path %s", (unsafePath: string) => {
      const input: JSONObject = JSON.parse(
        JSON.stringify({
          [unsafePath]: "yes",
          "safe.value": "preserved",
        }),
      ) as JSONObject;

      const result: JSONObject = JSONFunctions.nestJson(input);

      expect((Object.prototype as Record<string, unknown>)["polluted"]).toBe(
        undefined,
      );
      expect(result).toEqual({ safe: { value: "preserved" } });
    });

    test("ignores inherited enumerable properties", () => {
      const input: JSONObject = Object.create({
        "inherited.value": "not-owned",
      }) as JSONObject;
      input["owned.value"] = "kept";

      expect(JSONFunctions.nestJson(input)).toEqual({
        owned: { value: "kept" },
      });
    });

    test("does not traverse an already polluted Object prototype", () => {
      (Object.prototype as Record<string, unknown>)["inheritedPollution"] = {
        secret: "must-not-be-copied",
      };

      try {
        expect(JSONFunctions.nestJson({ "safe.value": "kept" })).toEqual({
          safe: { value: "kept" },
        });
      } finally {
        delete (Object.prototype as Record<string, unknown>)[
          "inheritedPollution"
        ];
      }
    });

    test("replaces a scalar path collision with a safe dictionary", () => {
      const result: JSONObject = JSONFunctions.nestJson({
        a: "scalar",
        "a.b": "nested",
      });

      expect(result).toEqual({ a: { b: "nested" } });
      expect(Object.getPrototypeOf(result["a"] as JSONObject)).toBeNull();
    });

    test("copies a preexisting object bridge before traversing a later path", () => {
      const callerBridge: JSONObject = Object.create({
        inherited: "must-not-survive",
      }) as JSONObject;
      callerBridge["owned"] = "preserved";

      const input: JSONObject = {};
      input["bridge"] = callerBridge;
      input["bridge.added"] = "generated-only";

      const result: JSONObject = JSONFunctions.nestJson(input);
      const resultBridge: JSONObject = result["bridge"] as JSONObject;

      expect(resultBridge).toEqual({
        owned: "preserved",
        added: "generated-only",
      });
      expect(Object.getPrototypeOf(resultBridge)).toBeNull();
      expect(
        Object.prototype.hasOwnProperty.call(resultBridge, "inherited"),
      ).toBe(false);
      expect(callerBridge["added"]).toBeUndefined();
      expect(resultBridge).not.toBe(callerBridge);
    });

    test("recursively copies terminal objects and arrays into safe containers", () => {
      const terminalValue: JSONObject = JSON.parse(
        '{"child":{"safe":"kept","__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},"prototype":{"polluted":"yes"}},"items":[{"safe":"array-kept","__proto__":{"polluted":"yes"}}]}',
      ) as JSONObject;

      const result: JSONObject = JSONFunctions.nestJson({
        terminal: terminalValue,
      });
      const copiedTerminal: JSONObject = result["terminal"] as JSONObject;
      const copiedChild: JSONObject = copiedTerminal["child"] as JSONObject;
      const copiedItems: Array<JSONValue> = copiedTerminal[
        "items"
      ] as Array<JSONValue>;
      const copiedArrayItem: JSONObject = copiedItems[0] as JSONObject;

      expect(copiedTerminal).not.toBe(terminalValue);
      expect(Object.getPrototypeOf(copiedTerminal)).toBeNull();
      expect(Object.getPrototypeOf(copiedChild)).toBeNull();
      expect(copiedItems).not.toBe(terminalValue["items"]);
      expect(Object.getPrototypeOf(copiedArrayItem)).toBeNull();
      expect(copiedChild).toEqual({ safe: "kept" });
      expect(copiedArrayItem).toEqual({ safe: "array-kept" });
      expect((Object.prototype as Record<string, unknown>)["polluted"]).toBe(
        undefined,
      );
    });

    test("does not invoke accessors while copying terminal data", () => {
      let accessorInvoked: boolean = false;
      const terminalValue: JSONObject = { safe: "kept" };
      Object.defineProperty(terminalValue, "attackerGetter", {
        enumerable: true,
        get: (): string => {
          accessorInvoked = true;
          return "must-not-be-read";
        },
      });

      const result: JSONObject = JSONFunctions.nestJson({
        terminal: terminalValue,
      });

      expect(accessorInvoked).toBe(false);
      expect(result).toEqual({ terminal: { safe: "kept" } });
    });

    test("preserves reserved-looking terminal primitives on safe dictionaries", () => {
      const input: JSONObject = JSON.parse(
        '{"__proto__":"literal-proto","http.constructor":"literal-constructor","http.prototype":"literal-prototype"}',
      ) as JSONObject;

      const result: JSONObject = JSONFunctions.nestJson(input);
      const http: JSONObject = result["http"] as JSONObject;

      expect(Object.getPrototypeOf(result)).toBeNull();
      expect(Object.getPrototypeOf(http)).toBeNull();
      expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(
        true,
      );
      expect(result["__proto__"]).toBe("literal-proto");
      expect(http["constructor"]).toBe("literal-constructor");
      expect(http["prototype"]).toBe("literal-prototype");
      expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    });
  });

  describe("flattenObject and unflattenObject Methods", () => {
    test("flattenObject collapses nested objects into dot-separated keys", () => {
      const input: JSONObject = { a: { b: { c: 1 } }, d: 2 };
      expect(JSONFunctions.flattenObject(input)).toEqual({
        "a.b.c": 1,
        d: 2,
      });
    });

    test("unflattenObject is the inverse of flattenObject", () => {
      const flat: JSONObject = { "a.b.c": 1, d: 2 };
      expect(JSONFunctions.unflattenObject(flat)).toEqual({
        a: { b: { c: 1 } },
        d: 2,
      });
    });

    test("flattenObject returns a null-prototype dictionary", () => {
      const result: JSONObject = JSONFunctions.flattenObject({
        a: { b: 1 },
      });

      expect(result).toEqual({ "a.b": 1 });
      expect(Object.getPrototypeOf(result)).toBeNull();
    });

    test("flattenObject ignores inherited and dangerous keys", () => {
      const nested: JSONObject = JSON.parse(
        '{"safe":{"value":"kept"},"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}',
      ) as JSONObject;
      const input: JSONObject = Object.create({
        inherited: "not-owned",
      }) as JSONObject;
      input["nested"] = nested;

      const result: JSONObject = JSONFunctions.flattenObject(input);

      expect(result).toEqual({ "nested.safe.value": "kept" });
      expect(Object.keys(result)).not.toEqual(
        expect.arrayContaining([
          expect.stringContaining("__proto__"),
          expect.stringContaining("constructor"),
          expect.stringContaining("inherited"),
        ]),
      );
      expect((Object.prototype as Record<string, unknown>)["polluted"]).toBe(
        undefined,
      );
    });

    test.each([
      "__proto__.polluted",
      "safe.__proto__.polluted",
      "constructor.prototype.polluted",
      "safe.constructor.polluted",
      "safe.prototype.polluted",
    ])(
      "unflattenObject rejects the unsafe object path %s",
      (unsafePath: string) => {
        const result: JSONObject = JSONFunctions.unflattenObject(
          JSON.parse(
            JSON.stringify({
              [unsafePath]: "yes",
              "safe.value": "preserved",
            }),
          ) as JSONObject,
        );

        expect(result).toEqual({ safe: { value: "preserved" } });
        expect((Object.prototype as Record<string, unknown>)["polluted"]).toBe(
          undefined,
        );
      },
    );

    test("flattens reserved-looking primitive names without retaining object bridges", () => {
      const input: JSONObject = JSON.parse(
        '{"safe":{"constructor":"literal","prototype":"also-literal","__proto__":{"polluted":"yes"}}}',
      ) as JSONObject;

      const result: JSONObject = JSONFunctions.flattenObject(input);

      expect(result).toEqual({
        "safe.constructor": "literal",
        "safe.prototype": "also-literal",
      });
      expect(Object.getPrototypeOf(result)).toBeNull();
      expect((Object.prototype as Record<string, unknown>)["polluted"]).toBe(
        undefined,
      );
    });

    test("returns detached flattened values and omits inherited nested data", () => {
      const callerValue: JSONObject = Object.create({
        inherited: "must-not-flatten",
      }) as JSONObject;
      callerValue["owned"] = "kept";
      const input: JSONObject = { nested: callerValue };

      const result: JSONObject = JSONFunctions.flattenObject(input);

      callerValue["owned"] = "changed-after-copy";
      expect(result).toEqual({ "nested.owned": "kept" });
      expect(result["nested.inherited"]).toBeUndefined();
    });
  });

  describe("flattenArray and unflattenArray Methods", () => {
    test("flattenArray flattens each object in the array", () => {
      const input: JSONArray = [{ a: { b: 1 } }, { c: { d: 2 } }];
      expect(JSONFunctions.flattenArray(input)).toEqual([
        { "a.b": 1 },
        { "c.d": 2 },
      ]);
    });

    test("unflattenArray unflattens each object in the array", () => {
      const input: JSONArray = [{ "a.b": 1 }, { "c.d": 2 }];
      expect(JSONFunctions.unflattenArray(input)).toEqual([
        { a: { b: 1 } },
        { c: { d: 2 } },
      ]);
    });

    test("array helpers reject dangerous paths without dropping safe values", () => {
      const input: JSONArray = [
        JSON.parse('{"safe.value":1,"__proto__.polluted":"yes"}') as JSONObject,
      ];

      const unflattened: JSONArray = JSONFunctions.unflattenArray(input);
      const flattened: JSONArray = JSONFunctions.flattenArray(unflattened);

      expect(unflattened).toEqual([{ safe: { value: 1 } }]);
      expect(flattened).toEqual([{ "safe.value": 1 }]);
      expect((Object.prototype as Record<string, unknown>)["polluted"]).toBe(
        undefined,
      );
    });
  });

  describe("getJSONValueInPath Method", () => {
    test("Returns the value at the given dot-separated path", () => {
      const obj: JSONObject = { a: { b: { c: 5 } } };
      expect(JSONFunctions.getJSONValueInPath(obj, "a.b.c")).toBe(5);
    });

    test("Returns null when the path does not exist", () => {
      const obj: JSONObject = { a: { b: 1 } };
      expect(JSONFunctions.getJSONValueInPath(obj, "a.x")).toBeNull();
    });
  });

  describe("toString Method", () => {
    test("Returns the string unchanged when given a string", () => {
      expect(JSONFunctions.toString("hello")).toBe("hello");
    });

    test("Stringifies non-string values", () => {
      expect(JSONFunctions.toString(123)).toBe("123");
      expect(JSONFunctions.toString({ a: 1 })).toBe('{"a":1}');
      expect(JSONFunctions.toString(true)).toBe("true");
    });
  });

  describe("toCompressedString and toFormattedString Methods", () => {
    test("toCompressedString uses 2-space indentation", () => {
      expect(JSONFunctions.toCompressedString({ a: 1 })).toBe(
        JSON.stringify({ a: 1 }, null, 2),
      );
    });

    test("toFormattedString uses 4-space indentation", () => {
      expect(JSONFunctions.toFormattedString({ a: 1 })).toBe(
        JSON.stringify({ a: 1 }, null, 4),
      );
    });
  });

  describe("parse, parseJSONObject and parseJSONArray Methods", () => {
    test("parse handles JSON5 syntax with unquoted keys", () => {
      expect(JSONFunctions.parse("{ a: 1 }")).toEqual({ a: 1 });
    });

    test("parseJSONObject returns an object", () => {
      expect(JSONFunctions.parseJSONObject('{ "a": 1 }')).toEqual({ a: 1 });
    });

    test("parseJSONObject throws when given an array", () => {
      expect(() => {
        return JSONFunctions.parseJSONObject("[1, 2]");
      }).toThrow("Expected JSONObject, but got JSONArray");
    });

    /*
     * An array was once the only shape refused, so every other non-object -
     * all of them valid JSON - came back typed as a JSONObject and was read
     * as one. The two callers that matter both did exactly that: the Text to
     * JSON workflow component announced a bare number as a successful parse,
     * and JSONWebToken.decodeJsonPayload took a string payload and read
     * undefined out of every field of it.
     */
    test("parseJSONObject throws when given a bare number", () => {
      expect(() => {
        return JSONFunctions.parseJSONObject("42");
      }).toThrow("Expected JSONObject, but got number");
    });

    test("parseJSONObject throws when given a bare string", () => {
      expect(() => {
        return JSONFunctions.parseJSONObject('"just a string"');
      }).toThrow("Expected JSONObject, but got string");
    });

    test("parseJSONObject throws when given a bare boolean", () => {
      expect(() => {
        return JSONFunctions.parseJSONObject("true");
      }).toThrow("Expected JSONObject, but got boolean");
    });

    test("parseJSONObject throws when given null", () => {
      expect(() => {
        return JSONFunctions.parseJSONObject("null");
      }).toThrow("Expected JSONObject, but got null");
    });

    test("parseJSONObject still accepts an empty object", () => {
      expect(JSONFunctions.parseJSONObject("{}")).toEqual({});
    });

    test("parseJSONObject still accepts JSON5 unquoted keys", () => {
      expect(JSONFunctions.parseJSONObject("{ a: 1 }")).toEqual({ a: 1 });
    });

    test("parseJSONArray returns an array", () => {
      expect(JSONFunctions.parseJSONArray("[1, 2]")).toEqual([1, 2]);
    });

    test("parseJSONArray throws when given an object", () => {
      expect(() => {
        return JSONFunctions.parseJSONArray('{ "a": 1 }');
      }).toThrow("Expected JSONArray, but got JSONObject");
    });
  });

  describe("anyObjectToJSONObject Method", () => {
    test("Converts an object to a plain JSON object", () => {
      expect(JSONFunctions.anyObjectToJSONObject({ a: 1, b: "two" })).toEqual({
        a: 1,
        b: "two",
      });
    });
  });

  describe("removeCircularReferences Method", () => {
    test("Removes circular references without throwing", () => {
      const obj: JSONObject = { a: 1 };
      (obj as Record<string, unknown>)["self"] = obj;

      const result: JSONObject = JSONFunctions.removeCircularReferences(obj);
      expect(result["a"]).toBe(1);
      expect(result["self"]).toBeUndefined();
    });
  });

  describe("getSizeOfJSONinGB Method", () => {
    test("Returns a non-negative number", () => {
      const size: number = JSONFunctions.getSizeOfJSONinGB({ a: 1 });
      expect(typeof size).toBe("number");
      expect(size).toBeGreaterThanOrEqual(0);
    });
  });

  describe("serialize and serializeArray Methods", () => {
    test("Passes primitives and null through, and drops undefined keys", () => {
      const input: JSONObject = {
        n: 1,
        s: "x",
        b: true,
        nil: null,
        gone: undefined,
      };
      expect(JSONFunctions.serialize(input)).toEqual({
        n: 1,
        s: "x",
        b: true,
        nil: null,
      });
    });

    test("Tags a Date value with its DateTime object type", () => {
      const serialized: JSONObject = JSONFunctions.serialize({
        when: new Date("2023-01-01T00:00:00.000Z"),
      });
      const when: JSONObject = serialized["when"] as JSONObject;
      expect(when["_type"]).toBe(ObjectType.DateTime);
      expect(typeof when["value"]).toBe("string");
    });

    test("Serializes nested objects recursively", () => {
      expect(JSONFunctions.serialize({ a: { b: 2 } })).toEqual({ a: { b: 2 } });
    });

    test("Serializes each value inside an array", () => {
      expect(JSONFunctions.serialize({ arr: [1, "x", null] })).toEqual({
        arr: [1, "x", null],
      });
    });

    test("serializeArray serializes each object in the array", () => {
      const input: JSONArray = [{ a: 1 }, { b: 2 }];
      expect(JSONFunctions.serializeArray(input)).toEqual([{ a: 1 }, { b: 2 }]);
    });
  });

  describe("deserialize and deserializeArray Methods", () => {
    test("Passes primitives and null through", () => {
      const input: JSONObject = { n: 1, s: "x", nil: null };
      expect(JSONFunctions.deserialize(input)).toEqual({
        n: 1,
        s: "x",
        nil: null,
      });
    });

    test("Rebuilds a Buffer-tagged value into a Buffer", () => {
      const input: JSONObject = {
        payload: {
          _type: ObjectType.Buffer,
          value: { type: ObjectType.Buffer, data: [1, 2, 3] },
        },
      };
      const deserialized: JSONObject = JSONFunctions.deserialize(input);
      expect(Buffer.isBuffer(deserialized["payload"])).toBe(true);
      expect(deserialized["payload"]).toEqual(Buffer.from([1, 2, 3]));
    });

    test("deserializeArray deserializes each object in the array", () => {
      const input: JSONArray = [{ a: 1 }, { b: 2 }];
      expect(JSONFunctions.deserializeArray(input)).toEqual([
        { a: 1 },
        { b: 2 },
      ]);
    });
  });

  describe("serializeValue and deserializeValue Methods", () => {
    test("Pass numbers and non-empty strings through unchanged", () => {
      expect(JSONFunctions.serializeValue(5)).toBe(5);
      expect(JSONFunctions.serializeValue("hi")).toBe("hi");
      expect(JSONFunctions.deserializeValue(5)).toBe(5);
      expect(JSONFunctions.deserializeValue("hi")).toBe("hi");
    });

    test("Pass null through unchanged", () => {
      expect(JSONFunctions.serializeValue(null)).toBeNull();
      expect(JSONFunctions.deserializeValue(null)).toBeNull();
    });
  });

  /*
   * serializeValue used to have no Array.isArray branch. Arrays are typeof
   * "object", so anything nested deeper than one level fell through to
   * serialize(), which walks with `for (const key in val)` and returned
   * { "0": ..., "1": ... } in place of the array. Only the OUTERMOST array was
   * safe, because serialize() special-cases an array-valued key — which is
   * exactly why this went unnoticed: `{ a: [1, 2] }` looked fine.
   *
   * Everything stored deeper than that was silently rewritten on its way into
   * a JSON column, and the object that came back out was no longer iterable.
   * These tests pin the array shape at every depth.
   */
  describe("Nested arrays survive serialization", () => {
    test("Serializes an array of tuples without collapsing the tuples into objects", () => {
      const serialized: JSONObject = JSONFunctions.serialize({
        filters: [
          ["service", "api"],
          ["status", "error"],
        ],
      });

      expect(serialized).toEqual({
        filters: [
          ["service", "api"],
          ["status", "error"],
        ],
      });
    });

    test("Every element of a serialized array of tuples is still an array", () => {
      const serialized: JSONObject = JSONFunctions.serialize({
        filters: [["service", "api"]],
      });

      const filters: JSONArray = serialized["filters"] as JSONArray;

      expect(Array.isArray(filters)).toBe(true);
      expect(Array.isArray(filters[0])).toBe(true);
    });

    test("A serialized tuple is still destructurable, which is how callers read it", () => {
      const serialized: JSONObject = JSONFunctions.serialize({
        filters: [["service", "api"]],
      });

      const filters: JSONArray = serialized["filters"] as JSONArray;

      // This threw "(destructured parameter) is not iterable" before the fix.
      const read: Array<string> = (
        filters as unknown as Array<[string, string]>
      ).map(([facetKey, value]: [string, string]): string => {
        return `${facetKey}:${value}`;
      });

      expect(read).toEqual(["service:api"]);
    });

    test("Serializes arrays nested three and four levels deep", () => {
      expect(JSONFunctions.serialize({ deep: [[[1, 2]]] })).toEqual({
        deep: [[[1, 2]]],
      });
      expect(JSONFunctions.serialize({ deeper: [[[["x"]]]] })).toEqual({
        deeper: [[[["x"]]]],
      });
    });

    test("Serializes an array held by an object that itself sits inside an array", () => {
      expect(
        JSONFunctions.serialize({
          queries: [{ groupBy: ["host", "region"] }, { groupBy: [] }],
        }),
      ).toEqual({
        queries: [{ groupBy: ["host", "region"] }, { groupBy: [] }],
      });
    });

    test("Keeps empty arrays at every depth as arrays", () => {
      const serialized: JSONObject = JSONFunctions.serialize({
        outer: [],
        nested: [[]],
      });

      expect(serialized["outer"]).toEqual([]);
      expect(Array.isArray(serialized["nested"])).toBe(true);
      expect((serialized["nested"] as JSONArray)[0]).toEqual([]);
    });

    test("Keeps null and empty-string elements inside a nested array", () => {
      expect(JSONFunctions.serialize({ rows: [[null, ""]] })).toEqual({
        rows: [[null, ""]],
      });
    });

    test("Still tags a Date held inside a nested array", () => {
      const serialized: JSONObject = JSONFunctions.serialize({
        rows: [[new Date("2023-01-01T00:00:00.000Z")]],
      });

      const rows: JSONArray = serialized["rows"] as JSONArray;
      const inner: JSONArray = rows[0] as unknown as JSONArray;
      const when: JSONObject = inner[0] as JSONObject;

      expect(Array.isArray(rows)).toBe(true);
      expect(Array.isArray(inner)).toBe(true);
      expect(when["_type"]).toBe(ObjectType.DateTime);
    });

    test("Still tags a Buffer held inside a nested array rather than treating it as an array", () => {
      const serialized: JSONObject = JSONFunctions.serialize({
        rows: [[Buffer.from([1, 2, 3])]],
      });

      const inner: JSONArray = (
        serialized["rows"] as JSONArray
      )[0] as unknown as JSONArray;
      const payload: JSONObject = inner[0] as JSONObject;

      expect(Array.isArray(inner)).toBe(true);
      expect(payload["_type"]).toBe(ObjectType.Buffer);
    });

    test("A Buffer inside a nested array rebuilds into a Buffer", () => {
      const roundTripped: JSONObject = JSONFunctions.deserialize(
        JSON.parse(
          JSON.stringify(
            JSONFunctions.serialize({ rows: [[Buffer.from([1, 2, 3])]] }),
          ),
        ),
      );

      const inner: JSONArray = (
        roundTripped["rows"] as JSONArray
      )[0] as unknown as JSONArray;

      expect(Buffer.isBuffer(inner[0])).toBe(true);
      expect(inner[0]).toEqual(Buffer.from([1, 2, 3]));
    });

    test("A typed array is tagged as a Buffer, never walked as an array", () => {
      /*
       * ArrayBuffer.isView is checked before the array branch, and it has to
       * stay that way: a Uint8Array is not array-literal data and walking it
       * element by element would lose the Buffer tag deserialize looks for.
       */
      const serialized: JSONObject = JSONFunctions.serialize({
        payload: new Uint8Array([1, 2, 3]),
      });

      const payload: JSONObject = serialized["payload"] as JSONObject;

      expect(Array.isArray(payload)).toBe(false);
      expect(payload["_type"]).toBe(ObjectType.Buffer);
    });

    test("serializeValue returns an array when handed one directly", () => {
      /*
       * The path LocalStorage/SessionStorage/Cookie take — they serialize the
       * caller's value itself, with no wrapper object, so a flat array reaches
       * serializeValue and used to come back as { "0": ..., "1": ... }.
       */
      const serialized: JSONValue = JSONFunctions.serializeValue([
        "service",
        "api",
      ]);

      expect(Array.isArray(serialized)).toBe(true);
      expect(serialized).toEqual(["service", "api"]);
    });

    test("A flat top-level array survives a serializeValue round trip", () => {
      const original: JSONValue = ["time", "body", "severityText"];

      const roundTripped: JSONValue = JSONFunctions.deserializeValue(
        JSON.parse(
          JSON.stringify(JSONFunctions.serializeValue(original)),
        ) as JSONValue,
      );

      expect(Array.isArray(roundTripped)).toBe(true);
      expect(roundTripped).toEqual(original);
    });

    test("serializeValue and deserializeValue agree on array-ness", () => {
      const input: JSONValue = [["a", "b"], ["c"], []];

      expect(JSONFunctions.serializeValue(input)).toEqual(input);
      expect(JSONFunctions.deserializeValue(input)).toEqual(input);
    });

    test("A numeric-keyed object is still serialized as an object", () => {
      // The corrupted shape itself must not be mistaken for an array.
      const serialized: JSONObject = JSONFunctions.serialize({
        legacy: [{ "0": "service", "1": "api" }],
      });

      const legacy: JSONArray = serialized["legacy"] as JSONArray;

      expect(Array.isArray(legacy[0])).toBe(false);
      expect(legacy[0]).toEqual({ "0": "service", "1": "api" });
    });
  });

  describe("serialize and deserialize round trip", () => {
    test("A plain object survives a serialize -> JSON -> deserialize round trip", () => {
      const original: JSONObject = {
        a: 1,
        b: "x",
        c: { d: 2 },
        e: [1, 2, 3],
      };
      const roundTripped: JSONObject = JSONFunctions.deserialize(
        JSON.parse(JSON.stringify(JSONFunctions.serialize(original))),
      );
      expect(roundTripped).toEqual(original);
    });

    test("A saved telemetry view survives the round trip it is stored through", () => {
      /*
       * The exact shape TelemetrySavedViewState puts in the `query` JSON
       * column of TraceSavedView / MetricSavedView.
       */
      const original: JSONObject = {
        search: "status:error",
        filters: [
          ["primaryEntityId", "6512f1a0a1b2c3d4e5f60718"],
          ["attributes.http.method", "GET"],
        ],
        timeRange: { range: "Past one hour" },
        pageSize: 50,
        rootOnly: false,
      };

      const roundTripped: JSONObject = JSONFunctions.deserialize(
        JSON.parse(JSON.stringify(JSONFunctions.serialize(original))),
      );

      expect(roundTripped).toEqual(original);
    });

    test("Arrays nested at any depth survive the round trip", () => {
      const original: JSONObject = {
        tuples: [
          ["a", "b"],
          ["c", "d"],
        ],
        deep: [[[1, 2]]],
        mixed: [{ groupBy: ["host"] }, ["x", ["y"]]],
        empty: [[]],
      };

      const roundTripped: JSONObject = JSONFunctions.deserialize(
        JSON.parse(JSON.stringify(JSONFunctions.serialize(original))),
      );

      expect(roundTripped).toEqual(original);
    });

    test("serializeArray keeps nested arrays inside each object", () => {
      const input: JSONArray = [{ filters: [["a", "b"]] }];

      expect(JSONFunctions.serializeArray(input)).toEqual([
        { filters: [["a", "b"]] },
      ]);
    });
  });
});
