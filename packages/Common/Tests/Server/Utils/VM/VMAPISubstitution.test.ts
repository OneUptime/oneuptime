/*
 * Substitution behaviour of VMUtil.replaceValueInPlace, focused on the four
 * ways a resolved value used to come out wrong: unescaped quotes when the
 * caller passed an object, `$`-patterns in the replacement text, `[last]`
 * against a key that is not an array, and `{{...}}` text inside a value being
 * matched by a later placeholder.
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

  const find: FindFunction = (storage: JSONObject, path: string): JSONValue => {
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

describe("replaceValueInPlace — a resolved value that carries {{...}} text", () => {
  /*
   * Substitution used to go one variable at a time over the progressively
   * rewritten string, replacing the first occurrence of each placeholder. A
   * value carrying placeholder text — an email subject, a request body, an API
   * response, all written by someone other than the template author — was
   * then matched by a later placeholder: the later value landed inside it, and
   * the placeholder the author wrote came out unrendered.
   */
  it("keeps an email subject that names another variable as written", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { emailSubject: "{{monitorName}}", monitorName: "Nightly backups" },
        "{{emailSubject}} - {{monitorName}}",
        false,
      ),
    ).toBe("{{monitorName}} - Nightly backups");
  });

  it("keeps a request body that names another variable as written", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { requestBody: "{{monitorName}}", monitorName: "Prod API" },
        "{{requestBody}} on {{monitorName}}",
        false,
      ),
    ).toBe("{{monitorName}} on Prod API");
  });

  it("renders the same whichever placeholder comes first", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { emailSubject: "{{monitorName}}", monitorName: "Nightly backups" },
        "{{monitorName}} - {{emailSubject}}",
        false,
      ),
    ).toBe("Nightly backups - {{monitorName}}");
  });

  it("leaves a variable that only the value names unresolved", () => {
    expect(
      VMUtil.replaceValueInPlace(
        {
          emailSubject: "{{monitorDescription}}",
          monitorDescription: "Internal runbook notes",
          monitorName: "Nightly backups",
        },
        "{{emailSubject}} - {{monitorName}}",
        false,
      ),
    ).toBe("{{monitorDescription}} - Nightly backups");
  });

  it("replaces every occurrence of a placeholder whose value contains it", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { emailSubject: "Fwd: {{emailSubject}}" },
        "{{emailSubject}} | {{emailSubject}}",
        false,
      ),
    ).toBe("Fwd: {{emailSubject}} | Fwd: {{emailSubject}}");
  });

  it("escapes each value where it stands in a JSON template", () => {
    const result: string = VMUtil.replaceValueInPlace(
      makeStorage({
        subject: '"{{local.variables.owner}}" is down',
        owner: 'ops "core"',
      }),
      '{"summary": "{{local.variables.subject}}", "owner": "{{local.variables.owner}}"}',
      true,
    );

    expect(JSON.parse(result)).toEqual({
      summary: '"{{local.variables.owner}}" is down',
      owner: 'ops "core"',
    });
  });

  it("keeps the other headers intact when one header's value names another variable", () => {
    const result: JSONValue = VMUtil.replaceValueInPlace(
      makeStorage({ subject: "{{local.variables.token}}", token: "abc" }),
      {
        "X-Subject": "{{local.variables.subject}}",
        Authorization: "Bearer {{local.variables.token}}",
      } as never,
      false,
    ) as unknown as JSONValue;

    expect(result).toEqual({
      "X-Subject": "{{local.variables.token}}",
      Authorization: "Bearer abc",
    });
  });
});

describe("replaceValueInPlace — a template that is a single placeholder", () => {
  /*
   * The raw value replaces the placeholder, so an argument that is nothing
   * but a reference keeps the type of what it points at. This used to be
   * decided inside the per-variable loop; these pin it now that substitution
   * is a single pass.
   */
  it("returns a number as a number", () => {
    expect(
      VMUtil.replaceValueInPlace({ count: 5 }, "{{count}}", false) as unknown,
    ).toBe(5);
  });

  it("ignores whitespace around the placeholder", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { count: 5 },
        "  {{count}}\n",
        false,
      ) as unknown,
    ).toBe(5);
  });

  it("returns an object as unescaped JSON, even for a JSON template", () => {
    const value: JSONObject = { a: 1, note: 'he said "hi"' };

    const result: string = VMUtil.replaceValueInPlace(
      { value: value },
      "{{value}}",
      true,
    );

    expect(result).toBe(JSON.stringify(value, null, 2));
    expect(JSON.parse(result)).toEqual(value);
  });

  it("leaves an unresolved placeholder untouched, whitespace and all", () => {
    expect(VMUtil.replaceValueInPlace({}, "  {{missing}}  ", false)).toBe(
      "  {{missing}}  ",
    );
  });

  it("does not resolve placeholder text inside the value", () => {
    expect(
      VMUtil.replaceValueInPlace({ a: "{{b}}", b: "x" }, "{{a}}", false),
    ).toBe("{{b}}");
  });

  /*
   * The old loop asked "is the whole string this placeholder?" of the
   * half-rewritten string, so an empty value in front of the last placeholder
   * switched it to the raw-value path: the result's type, and for a JSON
   * template whether it was escaped, hung on what another value rendered to.
   */
  it("is decided by the template, not by what the other placeholders render to", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { prefix: "", count: 5 },
        "{{prefix}}{{count}}",
        false,
      ) as unknown,
    ).toBe("5");
  });

  it("does not count braces after the placeholder as part of it", () => {
    expect(VMUtil.replaceValueInPlace({ a: 1 }, "{{a}}}}", false)).toBe("1}}");
  });
});
