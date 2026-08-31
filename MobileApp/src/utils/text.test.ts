import { toPlainText } from "./text";
import { describe, expect, test } from "@jest/globals";

/*
 * Everything a responder actually READS on a detail screen - a description, a
 * root cause, the name of whoever left a note - goes through here first.
 *
 * The API does not hand those back as plain strings. They arrive as serialized
 * { _type, value } envelopes, sometimes nested one inside another, sometimes as
 * a list of them, and very often not at all. The callers assign the result
 * straight into `const x: string` and pass it to <Text>, so the one contract
 * that matters is that a string comes back for EVERY input - a non-string child
 * makes React Native throw, which turns a missing description into a blank
 * screen in the middle of a page at 3am.
 */

describe("toPlainText on plain primitives", () => {
  test("hands a string straight back", () => {
    expect(toPlainText("Database is down")).toBe("Database is down");
  });

  test("keeps an empty string empty rather than inventing a placeholder", () => {
    expect(toPlainText("")).toBe("");
  });

  test("renders a number as its digits", () => {
    expect(toPlainText(503)).toBe("503");
  });

  test("renders zero rather than treating it as absent", () => {
    /*
     * Zero is falsy, so any implementation that leans on truthiness would drop
     * it. A monitor reporting "0" is meaningfully different from one reporting
     * nothing.
     */
    expect(toPlainText(0)).toBe("0");
  });

  test("renders a boolean as its word", () => {
    expect(toPlainText(true)).toBe("true");
    expect(toPlainText(false)).toBe("false");
  });
});

describe("toPlainText on absent values", () => {
  test("null becomes the empty string, not the word null", () => {
    expect(toPlainText(null)).toBe("");
  });

  test("undefined becomes the empty string, not the word undefined", () => {
    /*
     * This is the common case: `note.createdByUser?.name` on a note whose
     * author relation was not expanded. Printing "undefined" under a note is a
     * bug a responder can see.
     */
    expect(toPlainText(undefined)).toBe("");
  });
});

describe("toPlainText on serialized envelopes", () => {
  test("unwraps a { _type, value } envelope to its value", () => {
    expect(toPlainText({ _type: "Markdown", value: "## Root cause" })).toBe(
      "## Root cause",
    );
  });

  test("unwraps an envelope nested inside another envelope", () => {
    /*
     * The server round-trips some fields through more than one serializer, so
     * the payload can arrive double-wrapped. One level of unwrapping would
     * leave the responder looking at JSON.
     */
    expect(
      toPlainText({
        _type: "Wrapper",
        value: { _type: "Markdown", value: "Disk full" },
      }),
    ).toBe("Disk full");
  });

  test("an envelope carrying nothing resolves to the empty string", () => {
    expect(toPlainText({ _type: "Markdown", value: null })).toBe("");
  });

  test("an envelope carrying a number still resolves to text", () => {
    expect(toPlainText({ _type: "Count", value: 42 })).toBe("42");
  });

  test("an object with a _type but no value key is not treated as an envelope", () => {
    /*
     * Both keys have to be present. Half an envelope is just an object, and
     * unwrapping it would silently produce "" for a payload that does hold
     * something.
     */
    expect(toPlainText({ _type: "Markdown" })).toBe('{"_type":"Markdown"}');
  });

  test("an object with a value but no _type key is not treated as an envelope", () => {
    expect(toPlainText({ value: "Disk full" })).toBe('{"value":"Disk full"}');
  });
});

describe("toPlainText on arrays", () => {
  test("joins the entries with a comma and a space", () => {
    expect(toPlainText(["api", "worker", "probe"])).toBe("api, worker, probe");
  });

  test("unwraps envelopes inside the array", () => {
    expect(
      toPlainText([
        { _type: "Name", value: "api" },
        { _type: "Name", value: "worker" },
      ]),
    ).toBe("api, worker");
  });

  test("drops entries that resolve to nothing instead of leaving gaps", () => {
    /*
     * A relation the API did not expand comes back as null inside an otherwise
     * populated list. Keeping it would render "api, , probe" - a stray comma
     * that reads like a missing service name.
     */
    expect(toPlainText(["api", null, "", undefined, "probe"])).toBe(
      "api, probe",
    );
  });

  test("an array of nothing but empty entries resolves to the empty string", () => {
    expect(toPlainText([null, undefined, ""])).toBe("");
  });

  test("an empty array resolves to the empty string", () => {
    expect(toPlainText([])).toBe("");
  });

  test("keeps a false entry, which is content rather than absence", () => {
    expect(toPlainText([true, false])).toBe("true, false");
  });

  test("flattens a nested array rather than printing its brackets", () => {
    expect(toPlainText(["api", ["worker", "probe"]])).toBe(
      "api, worker, probe",
    );
  });
});

describe("toPlainText on anything else", () => {
  test("serializes a plain object rather than printing [object Object]", () => {
    expect(toPlainText({ region: "us-east", replicas: 3 })).toBe(
      '{"region":"us-east","replicas":3}',
    );
  });

  test("still returns a string for a structure JSON cannot serialize", () => {
    /*
     * A circular reference makes JSON.stringify throw. The declared return type
     * is `string` and every caller assigns it into one, so the throw has to be
     * absorbed here - the alternative is an exception thrown during render,
     * which unmounts the screen rather than degrading one line of it.
     */
    const circular: Record<string, unknown> = { name: "api" };
    circular["self"] = circular;

    const result: string = toPlainText(circular);

    expect(typeof result).toBe("string");
    expect(result).toBe("[object Object]");
  });

  test("does not throw on a circular structure reached through an envelope", () => {
    const circular: Record<string, unknown> = { name: "api" };
    circular["self"] = circular;

    expect(typeof toPlainText({ _type: "Wrapper", value: circular })).toBe(
      "string",
    );
  });

  test("does not throw on a circular structure reached through an array", () => {
    const circular: Record<string, unknown> = { name: "api" };
    circular["self"] = circular;

    expect(typeof toPlainText([circular, "api"])).toBe("string");
  });
});
