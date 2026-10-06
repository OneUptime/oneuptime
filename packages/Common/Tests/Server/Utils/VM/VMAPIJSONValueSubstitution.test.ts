/*
 * How VMUtil.replaceValueInPlace writes a {{...}} value into a JSON template,
 * decided by where the placeholder stands.
 *
 * https://github.com/OneUptime/oneuptime/issues/4469 - a Data argument of
 *
 *   { "customFields": {{local.components.example.returnValues.returnValue.updatedCustomFields}} }
 *
 * failed with "Invalid JSON provided for argument data", because every value
 * was escaped as if it sat inside a string: the object came out as
 * {\n  \"Application\": ...}. The variables guide says a reference that is a
 * whole value on its own drops the object in. Inside a string a value is still
 * escaped text, exactly as before.
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

// What the customer's Run Custom JavaScript step returned.
const UPDATED_CUSTOM_FIELDS: JSONObject = {
  Application: "Example Application",
  Duration: "2 hours",
  Impact: "Service unavailable",
  Locations: ["Location A"],
  "Notification Count": "1",
};

type RenderJSONFunction = (storage: JSONObject, template: string) => JSONValue;

// Renders a JSON template and parses it, as the workflow runner does.
const renderJSON: RenderJSONFunction = (
  storage: JSONObject,
  template: string,
): JSONValue => {
  return JSON.parse(VMUtil.replaceValueInPlace(storage, template, true));
};

describe("a value on its own in a JSON template", () => {
  it("drops in the object the customer passed to Update One Incident", () => {
    const storage: JSONObject = {
      local: {
        components: {
          example: {
            returnValues: {
              returnValue: { updatedCustomFields: UPDATED_CUSTOM_FIELDS },
            },
          },
        },
      },
    };

    expect(
      renderJSON(
        storage,
        '{\n  "customFields": {{local.components.example.returnValues.returnValue.updatedCustomFields}}\n}',
      ),
    ).toEqual({ customFields: UPDATED_CUSTOM_FIELDS });
  });

  it("keeps quotes, backslashes and newlines inside the object's strings", () => {
    const value: JSONObject = {
      note: 'he said "hi"',
      path: "C:\\Users",
      lines: "one\ntwo",
    };

    expect(renderJSON({ value: value }, '{"data": {{value}}}')).toEqual({
      data: value,
    });
  });

  it("drops in a list", () => {
    expect(
      renderJSON({ list: ["a", { b: 1 }, 2] }, '{"list": {{list}}}'),
    ).toEqual({ list: ["a", { b: 1 }, 2] });
  });

  it("drops in an empty object and an empty list", () => {
    expect(
      renderJSON({ empty: {}, none: [] }, '{"a": {{empty}}, "b": {{none}}}'),
    ).toEqual({ a: {}, b: [] });
  });

  it("writes numbers, booleans and null as themselves", () => {
    expect(
      renderJSON(
        { count: 5, ratio: 0.5, zero: 0, yes: true, no: false, nothing: null },
        '{"count": {{count}}, "ratio": {{ratio}}, "zero": {{zero}}, "yes": {{yes}}, "no": {{no}}, "nothing": {{nothing}}}',
      ),
    ).toEqual({
      count: 5,
      ratio: 0.5,
      zero: 0,
      yes: true,
      no: false,
      nothing: null,
    });
  });

  it("drops in values inside a list, and several side by side", () => {
    expect(
      renderJSON(
        { first: { id: 1 }, second: { id: 2 }, third: 3 },
        "[{{first}}, {{second}},{{third}}]",
      ),
    ).toEqual([{ id: 1 }, { id: 2 }, 3]);
  });

  it("drops in an object nested deep inside the template", () => {
    expect(
      renderJSON(
        { fields: UPDATED_CUSTOM_FIELDS },
        '{"incident": {"title": "Down", "customFields": {{fields}}}}',
      ),
    ).toEqual({
      incident: { title: "Down", customFields: UPDATED_CUSTOM_FIELDS },
    });
  });

  it("drops in an object with no whitespace around it", () => {
    expect(
      renderJSON({ fields: { a: 1 } }, '{"customFields":{{fields}}}'),
    ).toEqual({ customFields: { a: 1 } });
  });

  it("drops in an object after a string that holds braces, colons and an escaped quote", () => {
    expect(
      renderJSON(
        { fields: { a: 1 } },
        '{"note": "x: { \\"y\\" }", "customFields": {{fields}}}',
      ),
    ).toEqual({ note: 'x: { "y" }', customFields: { a: 1 } });
  });

  it("drops in an object after a string that ends in an escaped backslash", () => {
    expect(
      renderJSON(
        { fields: { a: 1 } },
        '{"path": "C:\\\\", "customFields": {{fields}}}',
      ),
    ).toEqual({ path: "C:\\", customFields: { a: 1 } });
  });

  /*
   * A value on its own that is text: what it holds, if it is JSON, and a
   * string otherwise. Text that is a number was always written as that
   * number, so this keeps it; text that holds an object - what a step that
   * returns JSON.stringify(...) hands on - is the object; and other text,
   * which until now made a document that does not parse, is a string.
   */
  describe("text on its own", () => {
    it("keeps a number written as text a number, as it always was", () => {
      expect(renderJSON({ count: "5" }, '{"count": {{count}}}')).toEqual({
        count: 5,
      });
    });

    it("keeps true, false and null written as text themselves", () => {
      expect(
        renderJSON(
          { yes: "true", no: "false", nothing: "null" },
          '{"yes": {{yes}}, "no": {{no}}, "nothing": {{nothing}}}',
        ),
      ).toEqual({ yes: true, no: false, nothing: null });
    });

    it("drops in an object a step handed on as JSON text", () => {
      expect(
        renderJSON(
          { fields: JSON.stringify(UPDATED_CUSTOM_FIELDS) },
          '{"customFields": {{fields}}}',
        ),
      ).toEqual({ customFields: UPDATED_CUSTOM_FIELDS });
    });

    it("drops in a list a step handed on as JSON text", () => {
      expect(renderJSON({ list: '["a", "b"]' }, '{"list": {{list}}}')).toEqual({
        list: ["a", "b"],
      });
    });

    it("writes other text as a string", () => {
      expect(
        renderJSON({ title: "Server down" }, '{"title": {{title}}}'),
      ).toEqual({ title: "Server down" });
    });

    it("writes text with quotes, backslashes and line breaks as that string", () => {
      const title: string = 'He said "it\'s down"\nC:\\logs\t1';

      expect(renderJSON({ title: title }, '{"title": {{title}}}')).toEqual({
        title: title,
      });
    });

    it("writes empty text as an empty string", () => {
      expect(renderJSON({ title: "" }, '{"title": {{title}}}')).toEqual({
        title: "",
      });
    });

    it("writes text that only looks like JSON as a string", () => {
      expect(
        renderJSON(
          { zip: "02134", broken: '{"a": ', word: "undefined" },
          '{"zip": {{zip}}, "broken": {{broken}}, "word": {{word}}}',
        ),
      ).toEqual({ zip: "02134", broken: '{"a": ', word: "undefined" });
    });
  });
});

describe("a value inside a string in a JSON template", () => {
  it("is still text, escaped, when it is an object", () => {
    const value: JSONObject = { a: 1, note: 'he said "hi"' };

    expect(
      renderJSON({ value: value }, '{"text": "Fields: {{value}}"}'),
    ).toEqual({ text: `Fields: ${JSON.stringify(value, null, 2)}` });
  });

  it("is still text when the string holds nothing else", () => {
    expect(
      renderJSON(
        { fields: UPDATED_CUSTOM_FIELDS },
        '{"customFields": "{{fields}}"}',
      ),
    ).toEqual({ customFields: JSON.stringify(UPDATED_CUSTOM_FIELDS, null, 2) });
  });

  it("keeps a number text inside a string", () => {
    expect(renderJSON({ count: 5 }, '{"count": "{{count}}"}')).toEqual({
      count: "5",
    });
  });

  it("escapes text that would otherwise end the string", () => {
    expect(
      renderJSON(
        { title: 'a", "isPrivate": true, "b": "' },
        '{"title": "{{title}}"}',
      ),
    ).toEqual({ title: 'a", "isPrivate": true, "b": "' });
  });

  it("is text after an escaped quote in the same string", () => {
    expect(
      renderJSON({ name: 'ops "core"' }, '{"text": "team \\"{{name}}\\""}'),
    ).toEqual({ text: 'team "ops "core""' });
  });

  it("is text in a key", () => {
    expect(
      renderJSON({ field: 'Notification "Count"' }, '{"{{field}}": 1}'),
    ).toEqual({ 'Notification "Count"': 1 });
  });

  it("is told apart from a value on its own in the same template", () => {
    expect(
      renderJSON(
        { name: "Impact", fields: { Impact: "High" } },
        '{"label": "Field {{name}}", "customFields": {{fields}}, "name": "{{name}}"}',
      ),
    ).toEqual({
      label: "Field Impact",
      customFields: { Impact: "High" },
      name: "Impact",
    });
  });
});

describe("what a JSON template leaves alone", () => {
  it("leaves a reference that does not resolve as written", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { fields: {} },
        '{"customFields": {{missing}}, "title": "{{also.missing}}"}',
        true,
      ),
    ).toBe('{"customFields": {{missing}}, "title": "{{also.missing}}"}');
  });

  it("writes a value carrying {{...}} text as it is, not rendered again", () => {
    expect(
      renderJSON(
        { fields: { note: "{{secret}}" }, secret: "s3cret" },
        '{"customFields": {{fields}}}',
      ),
    ).toEqual({ customFields: { note: "{{secret}}" } });
  });

  it("writes a value with $ patterns literally", () => {
    expect(
      renderJSON(
        { fields: { price: "$& $1 $$" } },
        '{"customFields": {{fields}}}',
      ),
    ).toEqual({ customFields: { price: "$& $1 $$" } });
  });

  it("returns a template that is only a placeholder as the raw value, as before", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { fields: UPDATED_CUSTOM_FIELDS },
        "{{fields}}",
        true,
      ),
    ).toBe(JSON.stringify(UPDATED_CUSTOM_FIELDS, null, 2));

    expect(
      VMUtil.replaceValueInPlace({ count: 5 }, "{{count}}", true) as unknown,
    ).toBe(5);
  });

  it("returns a template with no placeholders unchanged", () => {
    expect(VMUtil.replaceValueInPlace({}, '{"a": "b"}', true)).toBe(
      '{"a": "b"}',
    );
  });
});

describe("templates that are not JSON are unchanged", () => {
  it("writes an object into text as indented JSON", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { value: { a: 1 } },
        "Value: {{value}}",
        false,
      ),
    ).toBe(`Value: ${JSON.stringify({ a: 1 }, null, 2)}`);
  });

  it("does not escape a quote in text", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { title: 'he said "hi"' },
        "Title: {{title}}",
        false,
      ),
    ).toBe('Title: he said "hi"');
  });

  it("does not quote text on its own, even where it looks like a JSON value", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { title: "Server down" },
        '{"title": {{title}}}',
        false,
      ),
    ).toBe('{"title": Server down}');
  });

  it("still escapes every value of an object input, all of which sit in strings", () => {
    const result: JSONValue = VMUtil.replaceValueInPlace(
      { fields: { a: 1 }, note: 'say "hi"' },
      { "X-Fields": "{{fields}}", "X-Note": "{{note}}" } as never,
      false,
    ) as unknown as JSONValue;

    expect(result).toEqual({
      "X-Fields": JSON.stringify({ a: 1 }, null, 2),
      "X-Note": 'say "hi"',
    });
  });
});

describe("{{#each}} in a JSON template", () => {
  it("drops in an element's object on its own", () => {
    expect(
      renderJSON(
        {
          items: [
            { name: "a", meta: { id: 1 } },
            { name: "b", meta: { id: 2 } },
          ],
        },
        '[{{#each items}}{"name": "{{name}}", "meta": {{meta}}},{{/each}} {}]',
      ),
    ).toEqual([
      { name: "a", meta: { id: 1 } },
      { name: "b", meta: { id: 2 } },
      {},
    ]);
  });

  it("writes plain elements on their own as JSON values", () => {
    expect(
      renderJSON(
        { counts: [1, 2], names: ["a", 'b "c"'] },
        '{"counts": [{{#each counts}}{{this}}, {{/each}}0], "names": [{{#each names}}{{this}}, {{/each}}"end"]}',
      ),
    ).toEqual({ counts: [1, 2, 0], names: ["a", 'b "c"', "end"] });
  });

  it("still escapes plain elements inside a string", () => {
    expect(
      renderJSON(
        { tags: ['say "hi"', "C:\\path"] },
        '{"text": "{{#each tags}}[{{this}}]{{/each}}"}',
      ),
    ).toEqual({ text: '[say "hi"][C:\\path]' });
  });

  it("drops in a value on its own after a loop that was inside a string", () => {
    expect(
      renderJSON(
        { items: [{ name: 'a "b"' }, { name: "c" }], fields: { x: 1 } },
        '{"names": "{{#each items}}{{name}}, {{/each}}", "customFields": {{fields}}}',
      ),
    ).toEqual({ names: 'a "b", c, ', customFields: { x: 1 } });
  });

  it("is written the same way through expandEachLoops", () => {
    expect(
      JSON.parse(
        VMUtil.expandEachLoops(
          { items: [{ meta: { id: 1 } }, { meta: ["x"] }] },
          "[{{#each items}}{{meta}}, {{/each}}null]",
          true,
        ),
      ),
    ).toEqual([{ id: 1 }, ["x"], null]);
  });
});
