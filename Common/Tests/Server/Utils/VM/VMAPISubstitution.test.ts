/*
 * Substitution behaviour of VMUtil.replaceValueInPlace, focused on the three
 * ways a resolved value used to come out wrong: unescaped quotes when the
 * caller passed an object, `$`-patterns in the replacement text, and
 * `[last]` against a key that is not an array.
 */

jest.mock("../../../../Server/Utils/VM/VMRunner", () => {
  return {
    __esModule: true,
    default: {
      runCodeInSandbox: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (
        _target: any,
        _propertyKey: string,
        descriptor: PropertyDescriptor,
      ) => {
        return descriptor;
      };
    },
  };
});

import VMUtil from "../../../../Server/Utils/VM/VMAPI";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

type MakeStorageFunction = (variables: JSONObject) => JSONObject;

const makeStorage: MakeStorageFunction = (
  variables: JSONObject,
): JSONObject => {
  return {
    local: {
      variables: variables,
      components: {},
    },
    global: {
      variables: {},
    },
  };
};

describe("replaceValueInPlace — object input (the key/value headers shape)", () => {
  it("returns an object, not a string", () => {
    const result: JSONValue = VMUtil.replaceValueInPlace(
      makeStorage({ token: "abc" }),
      { Authorization: "Bearer {{local.variables.token}}" } as never,
      false,
    ) as unknown as JSONValue;

    expect(typeof result).toBe("object");
    expect(result).toEqual({ Authorization: "Bearer abc" });
  });

  /*
   * The regression this guards: the object is stringified, so every
   * placeholder sits inside a JSON string literal. A resolved value carrying a
   * quote used to be spliced in raw, the JSON.parse on the way back out threw,
   * and the caller silently received a corrupted string where it asked for an
   * object — which then spread into per-character HTTP headers.
   */
  it("escapes a resolved value containing a double quote", () => {
    const result: JSONValue = VMUtil.replaceValueInPlace(
      makeStorage({ note: 'he said "hi"' }),
      { "X-Note": "{{local.variables.note}}" } as never,
      false,
    ) as unknown as JSONValue;

    expect(typeof result).toBe("object");
    expect(result).toEqual({ "X-Note": 'he said "hi"' });
  });

  it("escapes a resolved value containing a newline", () => {
    const result: JSONValue = VMUtil.replaceValueInPlace(
      makeStorage({ note: "line1\nline2" }),
      { "X-Note": "{{local.variables.note}}" } as never,
      false,
    ) as unknown as JSONValue;

    expect(typeof result).toBe("object");
    expect(result).toEqual({ "X-Note": "line1\nline2" });
  });

  it("escapes a resolved value containing a backslash", () => {
    const result: JSONValue = VMUtil.replaceValueInPlace(
      makeStorage({ path: "C:\\Users" }),
      { "X-Path": "{{local.variables.path}}" } as never,
      false,
    ) as unknown as JSONValue;

    expect(typeof result).toBe("object");
    expect((result as JSONObject)["X-Path"]).toBe("C:\\Users");
  });

  it("escapes a resolved value containing a regex", () => {
    const result: JSONValue = VMUtil.replaceValueInPlace(
      makeStorage({ pattern: "\\d+\\s" }),
      { "X-Pattern": "{{local.variables.pattern}}" } as never,
      false,
    ) as unknown as JSONValue;

    expect((result as JSONObject)["X-Pattern"]).toBe("\\d+\\s");
  });

  it("escapes a value carrying a backslash and a quote together", () => {
    const result: JSONValue = VMUtil.replaceValueInPlace(
      makeStorage({ v: 'a\\b"c' }),
      { "X-V": "{{local.variables.v}}" } as never,
      false,
    ) as unknown as JSONValue;

    expect((result as JSONObject)["X-V"]).toBe('a\\b"c');
  });

  it("leaves an object with no placeholders untouched", () => {
    const result: JSONValue = VMUtil.replaceValueInPlace(
      makeStorage({}),
      { A: "b" } as never,
      false,
    ) as unknown as JSONValue;

    expect(result).toEqual({ A: "b" });
  });
});

describe("replaceValueInPlace — $ in resolved values", () => {
  /*
   * String.replace treats $&, $', $` and $1 in the REPLACEMENT as substitution
   * patterns. A resolved value of "A$&B" used to render as "A{{v}}B", pasting
   * the matched placeholder back into the output.
   */
  it("does not treat $& in a value as a substitution pattern", () => {
    const result: string = VMUtil.replaceValueInPlace(
      makeStorage({ v: "A$&B" }),
      "start {{local.variables.v}} end",
      false,
    );

    expect(result).toBe("start A$&B end");
  });

  it("does not treat $` or $' as substitution patterns", () => {
    expect(
      VMUtil.replaceValueInPlace(
        makeStorage({ v: "x$`y" }),
        "a {{local.variables.v}} b",
        false,
      ),
    ).toBe("a x$`y b");

    expect(
      VMUtil.replaceValueInPlace(
        makeStorage({ v: "x$'y" }),
        "a {{local.variables.v}} b",
        false,
      ),
    ).toBe("a x$'y b");
  });

  it("keeps a plain dollar amount intact", () => {
    expect(
      VMUtil.replaceValueInPlace(
        makeStorage({ price: "$50" }),
        "Total: {{local.variables.price}} today",
        false,
      ),
    ).toBe("Total: $50 today");
  });
});

describe("deepFind — [last] accessor", () => {
  type FindFunction = (storage: JSONObject, path: string) => JSONValue;

  const find: FindFunction = (
    storage: JSONObject,
    path: string,
  ): JSONValue => {
    return VMUtil.deepFind(storage, path);
  };

  it("resolves the final element of an array", () => {
    expect(find({ items: ["a", "b", "c"] }, "items[last]")).toBe("c");
  });

  it("returns undefined rather than throwing when the key is missing", () => {
    expect(find({}, "items[last]")).toBeUndefined();
  });

  it("returns undefined rather than throwing when the key is not an array", () => {
    expect(find({ items: "not an array" }, "items[last]")).toBeUndefined();
    expect(find({ items: 5 }, "items[last]")).toBeUndefined();
    expect(find({ items: null }, "items[last]")).toBeUndefined();
  });

  it("returns undefined for an empty array", () => {
    expect(find({ items: [] }, "items[last]")).toBeUndefined();
  });

  it("still resolves a numeric accessor", () => {
    expect(find({ items: ["a", "b"] }, "items[0]")).toBe("a");
    expect(find({ items: ["a", "b"] }, "items[9]")).toBeUndefined();
  });
});

describe("replaceValueInPlace — unresolved references", () => {
  it("leaves the braces in place, which is what the builder warns about", () => {
    expect(
      VMUtil.replaceValueInPlace(
        makeStorage({}),
        "hello {{local.variables.missing}}",
        false,
      ),
    ).toBe("hello {{local.variables.missing}}");
  });

  it("does not resolve a reference padded with spaces", () => {
    expect(
      VMUtil.replaceValueInPlace(
        makeStorage({ v: "x" }),
        "a {{ local.variables.v }} b",
        false,
      ),
    ).toBe("a {{ local.variables.v }} b");
  });
});
