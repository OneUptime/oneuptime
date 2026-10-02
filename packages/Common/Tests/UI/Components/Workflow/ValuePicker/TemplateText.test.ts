/*
 * The text model behind a setting that holds references: the stored string
 * split into text and chips, edited by offset; the "{{" someone is typing a
 * reference after; and the quotes a reference needs in JSON.
 */

import {
  ReferenceTrigger,
  TemplateSegment,
  TemplateSegmentKind,
  containsTemplateExpression,
  findReferenceTrigger,
  isInsideJSONString,
  isSingleReference,
  referenceForJSON,
  referencesIn,
  replaceRange,
  splitTemplateText,
} from "../../../../../UI/Components/Workflow/ValuePicker/TemplateText";
import { describe, expect, test } from "@jest/globals";

const BODY: string = "{{local.components.webhook-1.returnValues.request-body}}";
const ENV: string = "{{local.variables.DEPLOY_ENV}}";

describe("splitTemplateText", () => {
  test("text and references, each with where it starts", () => {
    const value: string = `Body: ${BODY} in ${ENV}.`;

    expect(splitTemplateText(value)).toEqual([
      { kind: TemplateSegmentKind.Text, text: "Body: ", start: 0 },
      { kind: TemplateSegmentKind.Reference, text: BODY, start: 6 },
      { kind: TemplateSegmentKind.Text, text: " in ", start: 6 + BODY.length },
      {
        kind: TemplateSegmentKind.Reference,
        text: ENV,
        start: 10 + BODY.length,
      },
      {
        kind: TemplateSegmentKind.Text,
        text: ".",
        start: 10 + BODY.length + ENV.length,
      },
    ]);
  });

  test("put back together, the segments are exactly the value", () => {
    for (const value of [
      "",
      "plain",
      BODY,
      `${BODY}${ENV}`,
      `line one\n${BODY}\n\nline four\n`,
      "{{ local.variables.x }} and {{#each local.variables.items}}{{name}}{{/each}}",
      "unclosed {{local.variables",
      "emoji 🚀 {{local.variables.x}} ✓",
    ]) {
      expect(
        splitTemplateText(value)
          .map((segment: TemplateSegment) => {
            return segment.text;
          })
          .join(""),
      ).toBe(value);
    }
  });

  test("a reference the runtime would not resolve stays in the text", () => {
    expect(splitTemplateText("Hi {{ local.variables.x }}!")).toEqual([
      {
        kind: TemplateSegmentKind.Text,
        text: "Hi {{ local.variables.x }}!",
        start: 0,
      },
    ]);
  });

  test("a loop's tags stay text; a full reference inside it is a chip", () => {
    const value: string =
      "{{#each local.components.x.returnValues.items}}- {{name}} {{local.variables.env}}\n{{/each}}";

    expect(
      splitTemplateText(value).map((segment: TemplateSegment) => {
        return segment.kind;
      }),
    ).toEqual([
      TemplateSegmentKind.Text,
      TemplateSegmentKind.Reference,
      TemplateSegmentKind.Text,
    ]);
  });

  test("two references side by side are two chips", () => {
    expect(
      splitTemplateText(`${BODY}${ENV}`).map((segment: TemplateSegment) => {
        return segment.kind;
      }),
    ).toEqual([TemplateSegmentKind.Reference, TemplateSegmentKind.Reference]);
  });

  test("not a string is nothing", () => {
    expect(splitTemplateText(undefined as unknown as string)).toEqual([]);
  });
});

describe("replaceRange", () => {
  test("inserts at the caret, the caret ending after it", () => {
    expect(replaceRange("Body: ", 6, 6, BODY)).toEqual({
      value: `Body: ${BODY}`,
      caret: 6 + BODY.length,
    });
  });

  test("replaces a selection, whichever way round it is given", () => {
    expect(replaceRange("Hello world", 6, 11, ENV).value).toBe(`Hello ${ENV}`);
    expect(replaceRange("Hello world", 11, 6, ENV).value).toBe(`Hello ${ENV}`);
  });

  test("an out-of-range offset is held to the value", () => {
    expect(replaceRange("abc", 10, 20, "!")).toEqual({
      value: "abc!",
      caret: 4,
    });
    expect(replaceRange("abc", -5, 0, "!")).toEqual({
      value: "!abc",
      caret: 1,
    });
  });
});

describe("findReferenceTrigger", () => {
  test("just typed {{", () => {
    expect(findReferenceTrigger("Hello {{", 8)).toEqual({
      start: 6,
      query: "",
      end: 8,
    });
  });

  test("what follows it is the query", () => {
    expect(findReferenceTrigger("Hello {{request bo", 18)).toEqual({
      start: 6,
      query: "request bo",
      end: 18,
    });
    expect(findReferenceTrigger("{{local.comp", 12)!.query).toBe("local.comp");
  });

  test("a closing }} already there is replaced along with it", () => {
    const value: string = "Hello {{web}} there";
    const trigger: ReferenceTrigger | null = findReferenceTrigger(value, 11);

    expect(trigger).toEqual({ start: 6, query: "web", end: 13 });
  });

  test("no trigger: closed, too far back, across a line, a loop, a space first", () => {
    expect(findReferenceTrigger(`Hi ${ENV} there`, 34)).toBeNull();
    expect(findReferenceTrigger("{{abc\ndef", 9)).toBeNull();
    expect(findReferenceTrigger("{{#each", 7)).toBeNull();
    expect(findReferenceTrigger("{{ spaced", 9)).toBeNull();
    expect(findReferenceTrigger("{{a{b", 5)).toBeNull();
    expect(findReferenceTrigger(`{{${"x".repeat(81)}`, 83)).toBeNull();
    expect(findReferenceTrigger("no braces", 9)).toBeNull();
    expect(findReferenceTrigger("{", 1)).toBeNull();
  });

  test("only what is before the caret counts", () => {
    expect(findReferenceTrigger("ab {{cd", 2)).toBeNull();
  });
});

describe("references in JSON", () => {
  test("isInsideJSONString", () => {
    const json: string = '{"title": "Alert: ", "count": 1}';

    expect(isInsideJSONString(json, json.indexOf("Alert") + 7)).toBe(true);
    expect(isInsideJSONString(json, json.indexOf(":") + 1)).toBe(false);
    expect(isInsideJSONString(json, json.length)).toBe(false);
    // An escaped quote does not end the string.
    expect(isInsideJSONString('{"a": "say \\"hi', 15)).toBe(true);
    // Single quotes only count for JSON5.
    expect(isInsideJSONString("{a: 'x", 6)).toBe(false);
    expect(isInsideJSONString("{a: 'x", 6, true)).toBe(true);
  });

  test("outside a string, it comes with its quotes", () => {
    const text: string = '{"title": }';

    expect(
      referenceForJSON({
        text: text,
        start: 10,
        end: 10,
        reference: BODY,
      }),
    ).toBe(`"${BODY}"`);
  });

  test("inside a string, it goes in as it is", () => {
    const text: string = '{"title": "Alert: "}';

    expect(
      referenceForJSON({
        text: text,
        start: 18,
        end: 18,
        reference: ENV,
      }),
    ).toBe(ENV);
  });

  test("on its own it stands for the whole document, bare", () => {
    expect(
      referenceForJSON({ text: "", start: 0, end: 0, reference: BODY }),
    ).toBe(BODY);
    expect(
      referenceForJSON({ text: "  \n", start: 1, end: 1, reference: BODY }),
    ).toBe(BODY);
    // Replacing everything that was there.
    expect(
      referenceForJSON({ text: '{"a": 1}', start: 0, end: 8, reference: BODY }),
    ).toBe(BODY);
  });

  test("JSON5's single-quoted strings count when the field is read as JSON5", () => {
    expect(
      referenceForJSON({
        text: "{title: 'x'}",
        start: 9,
        end: 9,
        reference: ENV,
        allowJSON5: true,
      }),
    ).toBe(ENV);
  });
});

describe("small helpers", () => {
  test("referencesIn lists the chips' references, in order", () => {
    expect(referencesIn(`a ${BODY} b {{ x }} ${ENV}`)).toEqual([BODY, ENV]);
    expect(referencesIn(undefined as unknown as string)).toEqual([]);
  });

  test("isSingleReference", () => {
    expect(isSingleReference(ENV)).toBe(true);
    expect(isSingleReference(`  ${ENV} `)).toBe(true);
    expect(isSingleReference(`${ENV}!`)).toBe(false);
    expect(isSingleReference(5)).toBe(false);
  });

  test("containsTemplateExpression sees any {{...}}", () => {
    expect(containsTemplateExpression("a {{ x }}")).toBe(true);
    expect(containsTemplateExpression(ENV)).toBe(true);
    expect(containsTemplateExpression("plain")).toBe(false);
    expect(containsTemplateExpression(7)).toBe(false);
  });
});
