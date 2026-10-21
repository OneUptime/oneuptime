import PostgresStorableValue, {
  toStorableJson,
  toStorableText,
  UNSTORABLE_CHARACTER_REPLACEMENT,
} from "../../../../Server/Utils/Database/PostgresStorableValue";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  assertJsonbAccepts,
  findJsonbRefusal,
  jsonbWouldRefuse,
} from "../../../Helpers/PostgresJsonbInput";
import { describe, expect, test } from "@jest/globals";

/*
 * Production Postgres logged hundreds of these an hour:
 *
 *   ERROR:  unsupported Unicode escape sequence
 *   DETAIL: \u0000 cannot be converted to text.
 *   STATEMENT: UPDATE "MonitorProbe" SET "lastMonitoringLog" = $1, ...
 *
 * A probe response whose body or headers held a NUL character was written
 * verbatim to a jsonb column, the driver serialized the NUL as the escape
 * \u0000, and Postgres refused the statement. Lone UTF-16 surrogates (a
 * string cut between the halves of an emoji) are refused the same way, with
 * "Unicode low surrogate must follow a high surrogate".
 *
 * `jsonbWouldRefuse` (Tests/Helpers/PostgresJsonbInput) reproduces Postgres'
 * check on the exact text the driver binds - JSON.stringify of the value -
 * so these tests can show both the failure and the fix without a database.
 */

// A lone high surrogate: the first half of U+1F600, an emoji.
const LONE_HIGH: string = "\uD83D";
// A lone low surrogate: the second half of U+1F600.
const LONE_LOW: string = "\uDE00";
const EMOJI: string = "\uD83D\uDE00";

describe("jsonbWouldRefuse (the test's stand-in for Postgres)", () => {
  /*
   * The rest of the suite leans on this check, so pin it against the
   * statements verified on a real Postgres 15 first.
   */
  test("refuses NUL in a value and in a key", () => {
    expect(jsonbWouldRefuse({ a: "x\u0000y" })).toBe(true);
    expect(jsonbWouldRefuse({ ["x\u0000y"]: "a" })).toBe(true);
  });

  test("refuses a surrogate half on its own, either half", () => {
    expect(jsonbWouldRefuse({ a: `cut ${LONE_HIGH}` })).toBe(true);
    expect(jsonbWouldRefuse({ a: `${LONE_LOW} cut` })).toBe(true);
  });

  test("accepts a whole surrogate pair", () => {
    expect(jsonbWouldRefuse({ a: `smile ${EMOJI}` })).toBe(false);
  });

  test("accepts the six characters \\u0000 as text", () => {
    expect(jsonbWouldRefuse({ a: "\\u0000" })).toBe(false);
    expect(jsonbWouldRefuse({ a: "\\\\u0000" })).toBe(false);
  });

  test("accepts other control characters", () => {
    expect(jsonbWouldRefuse({ a: "\t\n\r\u0001\u001f\u007f" })).toBe(false);
  });

  test("names the refusal and fails with Postgres' own message", () => {
    expect(findJsonbRefusal({ a: "\u0000" })).toBe("nul");
    expect(findJsonbRefusal({ a: LONE_HIGH })).toBe("lone-surrogate");
    expect(findJsonbRefusal({ a: "fine" })).toBeNull();

    expect(() => {
      assertJsonbAccepts({ a: "\u0000" });
    }).toThrow("unsupported Unicode escape sequence");
    expect(() => {
      assertJsonbAccepts({ a: LONE_LOW });
    }).toThrow("invalid input syntax for type json");
    expect(() => {
      assertJsonbAccepts({ a: "fine" });
    }).not.toThrow();
  });
});

describe("toStorableText", () => {
  test("returns a string with nothing to replace as the very same string", () => {
    const text: string = "HTTP/1.1 200 OK - all good";
    expect(toStorableText(text)).toBe(text);
  });

  test("returns an empty string unchanged", () => {
    expect(toStorableText("")).toBe("");
  });

  test("replaces a NUL with U+FFFD", () => {
    expect(toStorableText("a\u0000b")).toBe("a\uFFFDb");
    expect(UNSTORABLE_CHARACTER_REPLACEMENT).toBe("\uFFFD");
  });

  test("replaces every NUL, at the start, the end and in runs", () => {
    expect(toStorableText("\u0000start mid\u0000\u0000dle end\u0000")).toBe(
      "\uFFFDstart mid\uFFFD\uFFFDdle end\uFFFD",
    );
  });

  test("replaces a string made only of NULs", () => {
    expect(toStorableText("\u0000\u0000\u0000")).toBe("\uFFFD\uFFFD\uFFFD");
  });

  test("keeps the length, so offsets into the stored copy still line up", () => {
    const text: string = `\u0000binary\u0000${LONE_HIGH}${EMOJI}${LONE_LOW}`;
    expect(toStorableText(text)).toHaveLength(text.length);
  });

  test("keeps a whole surrogate pair", () => {
    const text: string = `deployed ${EMOJI} and ${EMOJI}`;
    expect(toStorableText(text)).toBe(text);
  });

  test("replaces the high surrogate a cut leaves at the end", () => {
    // What `slice` does to a body that ends in an emoji.
    const cut: string = `body ${EMOJI}`.slice(0, -1);
    expect(cut.endsWith(LONE_HIGH)).toBe(true);

    expect(toStorableText(cut)).toBe("body \uFFFD");
  });

  test("replaces a low surrogate on its own", () => {
    expect(toStorableText(`${LONE_LOW}tail`)).toBe("\uFFFDtail");
  });

  test("replaces both halves of a pair written the wrong way round", () => {
    expect(toStorableText(`${LONE_LOW}${LONE_HIGH}`)).toBe("\uFFFD\uFFFD");
  });

  test("replaces the extra half and keeps the pair after it", () => {
    expect(toStorableText(`${LONE_HIGH}${EMOJI}`)).toBe(`\uFFFD${EMOJI}`);
    expect(toStorableText(`${EMOJI}${LONE_LOW}`)).toBe(`${EMOJI}\uFFFD`);
  });

  test("leaves tabs, line breaks and other control characters alone", () => {
    // Postgres stores these; only NUL is refused.
    const text: string = "line\none\ttab\r\u0001\u0007\u001f\u007f";
    expect(toStorableText(text)).toBe(text);
  });

  test("leaves the six characters \\u0000 alone", () => {
    const text: string = '{"escaped":"\\u0000"}';
    expect(toStorableText(text)).toBe(text);
  });

  test("leaves U+FFFD alone, so applying it twice changes nothing more", () => {
    const once: string = toStorableText(`a\u0000b${LONE_HIGH}`);
    expect(toStorableText(once)).toBe(once);
  });

  test("gives the same answer on every call", () => {
    /*
     * Global regular expressions carry state between calls. Calling
     * repeatedly, alternating clean and dirty input, pins that none leaks.
     */
    for (let i: number = 0; i < 5; i++) {
      expect(toStorableText("x\u0000y")).toBe("x\uFFFDy");
      expect(toStorableText("clean")).toBe("clean");
      expect(toStorableText(`${LONE_HIGH}z`)).toBe("\uFFFDz");
    }
  });

  test("makes any string one jsonb accepts", () => {
    const texts: Array<string> = [
      "\u0000",
      LONE_HIGH,
      LONE_LOW,
      `${LONE_LOW}${LONE_HIGH}`,
      `ok\u0000${EMOJI}${LONE_HIGH}`,
    ];

    for (const text of texts) {
      expect(jsonbWouldRefuse({ value: text, [text]: true })).toBe(true);
      expect(
        jsonbWouldRefuse({
          value: toStorableText(text),
          [toStorableText(text)]: true,
        }),
      ).toBe(false);
    }
  });
});

describe("toStorableJson", () => {
  /*
   * Roughly the shape MonitorResource stores for a Website check, with an
   * ObjectID and a Date in it the way a live payload carries them.
   */
  type MakeProbeResponseFunction = (responseBody: string) => JSONObject;

  const makeProbeResponse: MakeProbeResponseFunction = (
    responseBody: string,
  ): JSONObject => {
    return {
      projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
      monitorId: new ObjectID("22222222-2222-4222-8222-222222222222"),
      monitoredAt: new Date("2026-10-06T10:00:00.000Z"),
      isOnline: true,
      responseCode: 200,
      responseTimeInMs: 42.5,
      responseBody: responseBody,
      responseHeaders: {
        "content-type": "application/octet-stream",
      },
      failureCause: "",
      evaluationSummary: {
        criteriaResults: [],
        events: [{ type: "criteria-met", message: "Criteria met." }],
      },
    };
  };

  test("refused by jsonb before, accepted after: a NUL in the body", () => {
    const response: JSONObject = makeProbeResponse(
      "PK\u0003\u0004\u0000\u0000",
    );

    expect(jsonbWouldRefuse(response)).toBe(true);
    expect(jsonbWouldRefuse(toStorableJson(response))).toBe(false);
  });

  test("a payload with nothing to replace is stored exactly as before", () => {
    /*
     * Every jsonb write this replaces was already a JSON copy, so with no
     * NUL in sight the stored value must not change at all.
     */
    const response: JSONObject = makeProbeResponse(
      `<html><body>${EMOJI} fine</body></html>`,
    );

    expect(toStorableJson(response)).toEqual(
      JSON.parse(JSON.stringify(response)),
    );
  });

  test("replaces NUL in a string value", () => {
    const stored: JSONObject = toStorableJson(
      makeProbeResponse("before\u0000after"),
    );

    expect(stored["responseBody"]).toBe("before\uFFFDafter");
  });

  test("replaces NUL at any depth, in objects and in arrays", () => {
    const stored: JSONObject = toStorableJson({
      level1: {
        level2: {
          level3: ["ok", "bad\u0000", { level4: "\u0000deep" }],
        },
      },
      list: [["nested\u0000array"]],
    } as JSONObject);

    expect(stored).toEqual({
      level1: {
        level2: {
          level3: ["ok", "bad\uFFFD", { level4: "\uFFFDdeep" }],
        },
      },
      list: [["nested\uFFFDarray"]],
    });
    expect(jsonbWouldRefuse(stored)).toBe(false);
  });

  test("replaces NUL in a key, at any depth", () => {
    const stored: JSONObject = toStorableJson({
      responseHeaders: {
        "x-\u0000-header": "value",
        "content-type": "text/plain",
      },
      ["top\u0000level"]: { ["inner\u0000key"]: 1 },
    } as JSONObject);

    expect(stored).toEqual({
      responseHeaders: {
        "x-\uFFFD-header": "value",
        "content-type": "text/plain",
      },
      ["top\uFFFDlevel"]: { ["inner\uFFFDkey"]: 1 },
    });
    expect(jsonbWouldRefuse(stored)).toBe(false);
  });

  test("replaces a lone surrogate, keeps whole pairs", () => {
    const stored: JSONObject = toStorableJson({
      cut: `snippet ${LONE_HIGH}`,
      whole: `snippet ${EMOJI}`,
      [`key ${LONE_LOW}`]: true,
    } as JSONObject);

    expect(stored).toEqual({
      cut: "snippet \uFFFD",
      whole: `snippet ${EMOJI}`,
      ["key \uFFFD"]: true,
    });
    expect(jsonbWouldRefuse(stored)).toBe(false);
  });

  test("never modifies the value passed in", () => {
    const response: JSONObject = makeProbeResponse("body\u0000");
    (response["responseHeaders"] as JSONObject)["x-\u0000"] = "v\u0000";

    const before: string = JSON.stringify(response);
    const monitoredAt: unknown = response["monitoredAt"];
    const projectId: unknown = response["projectId"];

    toStorableJson(response);

    // Same text, and still the live instances - not their JSON forms.
    expect(JSON.stringify(response)).toBe(before);
    expect(response["responseBody"]).toBe("body\u0000");
    expect((response["responseHeaders"] as JSONObject)["x-\u0000"]).toBe(
      "v\u0000",
    );
    expect(response["monitoredAt"]).toBe(monitoredAt);
    expect(response["monitoredAt"]).toBeInstanceOf(Date);
    expect(response["projectId"]).toBe(projectId);
    expect(response["projectId"]).toBeInstanceOf(ObjectID);
  });

  test("returns a copy even when nothing needed replacing", () => {
    /*
     * The caller is about to keep evaluating the original, so the stored
     * copy must not share any object with it.
     */
    const response: JSONObject = makeProbeResponse("clean");
    const stored: JSONObject = toStorableJson(response);

    expect(stored).not.toBe(response);
    expect(stored["responseHeaders"]).not.toBe(response["responseHeaders"]);
    expect(stored["evaluationSummary"]).not.toBe(response["evaluationSummary"]);
  });

  test("Dates and ObjectIDs come back in their JSON form, as before", () => {
    const stored: JSONObject = toStorableJson(makeProbeResponse("x\u0000"));

    expect(stored["monitoredAt"]).toBe("2026-10-06T10:00:00.000Z");
    expect(stored["projectId"]).toEqual(
      JSON.parse(
        JSON.stringify(new ObjectID("11111111-1111-4111-8111-111111111111")),
      ),
    );
  });

  test("replaces inside what toJSON returns", () => {
    // The driver stores the toJSON form, so that is what has to be clean.
    class Reading {
      public toJSON(): JSONObject {
        return { raw: "sensor\u0000value", ["k\u0000"]: LONE_HIGH };
      }
    }

    const stored: JSONObject = toStorableJson({
      reading: new Reading(),
    } as unknown as JSONObject);

    expect(stored).toEqual({
      reading: { raw: "sensor\uFFFDvalue", ["k\uFFFD"]: "\uFFFD" },
    });
  });

  test("replaces keys on a class instance as well as on a plain object", () => {
    class Bag {
      public constructor() {
        (this as unknown as JSONObject)["field\u0000"] = "value\u0000";
      }
    }

    expect(toStorableJson({ bag: new Bag() } as unknown as JSONObject)).toEqual(
      { bag: { ["field\uFFFD"]: "value\uFFFD" } },
    );
  });

  test("drops undefined properties, as JSON does", () => {
    expect(
      toStorableJson({
        kept: "a\u0000",
        dropped: undefined,
      } as unknown as JSONObject),
    ).toEqual({ kept: "a\uFFFD" });
  });

  test("passes null and undefined straight through", () => {
    expect(toStorableJson(null)).toBeNull();
    expect(toStorableJson(undefined)).toBeUndefined();
  });

  test("handles a top-level string, number and boolean", () => {
    expect(toStorableJson("a\u0000b")).toBe("a\uFFFDb");
    expect(toStorableJson(7)).toBe(7);
    expect(toStorableJson(false)).toBe(false);
  });

  test("a value with no JSON form comes back undefined", () => {
    expect(
      toStorableJson((): string => {
        return "never stored";
      }),
    ).toBeUndefined();
  });

  test("a key the sender sent wins over the stand-in for another key", () => {
    // Both orders: the stand-in never displaces a real key.
    expect(
      toStorableJson({
        ["a\uFFFD"]: "sent",
        ["a\u0000"]: "replaced",
      } as JSONObject),
    ).toEqual({ ["a\uFFFD"]: "sent" });

    expect(
      toStorableJson({
        ["a\u0000"]: "replaced",
        ["a\uFFFD"]: "sent",
      } as JSONObject),
    ).toEqual({ ["a\uFFFD"]: "sent" });
  });

  test("of two keys that map to the same stand-in, the first is kept", () => {
    expect(
      toStorableJson({
        ["b\u0000"]: "first",
        [`b${LONE_HIGH}`]: "second",
      } as JSONObject),
    ).toEqual({ ["b\uFFFD"]: "first" });
  });

  test("a __proto__ key stays an ordinary key and changes no prototype", () => {
    // JSON.parse makes "__proto__" an own property, as a body parser would.
    const payload: JSONObject = JSON.parse(
      '{"__proto__":{"polluted":"yes"},"needs\\u0000repair":"x"}',
    ) as JSONObject;

    const stored: JSONObject = toStorableJson(payload);

    expect(Object.getPrototypeOf(stored)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(stored, "__proto__")).toBe(
      true,
    );
    expect((stored as unknown as { polluted?: string }).polluted).toBe(
      undefined,
    );
    expect(({} as { polluted?: string }).polluted).toBe(undefined);
    expect(stored["needs\uFFFDrepair"]).toBe("x");
  });

  test("typed arrays and Buffers are stored as JSON stores them", () => {
    const value: JSONObject = {
      bytes: new Uint8Array([0, 1, 2]),
      buffer: Buffer.from([0, 255]),
    } as unknown as JSONObject;

    expect(toStorableJson(value)).toEqual(JSON.parse(JSON.stringify(value)));
  });

  test("a circular payload throws, as JSON.stringify does", () => {
    const circular: JSONObject = { name: "loop" };
    circular["self"] = circular;

    expect(() => {
      return toStorableJson(circular);
    }).toThrow(TypeError);
  });

  test("a large body with scattered NULs is fully replaced", () => {
    // A downloaded binary: ~1 MB with a NUL every 64 characters.
    const chunk: string = `${"a".repeat(63)}\u0000`;
    const body: string = chunk.repeat(16 * 1024);

    const stored: JSONObject = toStorableJson(makeProbeResponse(body));
    const storedBody: string = stored["responseBody"] as string;

    expect(storedBody).toHaveLength(body.length);
    expect(storedBody.includes("\u0000")).toBe(false);
    expect(storedBody.split("\uFFFD")).toHaveLength(16 * 1024 + 1);
    expect(jsonbWouldRefuse(stored)).toBe(false);
  });

  test("the text \\u0000 in the data comes back unchanged", () => {
    /*
     * Serialized, it reads `\\u0000` - which also contains `\u0000`, so the
     * quick check sends it down the careful path. That path must not touch
     * it: it is six ordinary characters, not a NUL.
     */
    const payload: JSONObject = {
      escaped: "\\u0000",
      doubled: "\\\\u0000",
      surrogateText: "\\ud83d",
    };

    expect(toStorableJson(payload)).toEqual(payload);
  });

  test("a NUL straight after a backslash is still replaced", () => {
    expect(toStorableJson({ path: "C:\\\u0000" } as JSONObject)).toEqual({
      path: "C:\\\uFFFD",
    });
  });

  test("a payload with nothing to replace is copied in a single pass", () => {
    /*
     * This runs on every probe check. Counting toJSON calls shows how many
     * times the payload was serialized: once for a clean payload, the same
     * as the plain JSON copy it replaces, and a second, careful pass only
     * when there is something to replace.
     */
    let serializations: number = 0;

    class Counted {
      public constructor(private readonly text: string) {}

      public toJSON(): string {
        serializations++;
        return this.text;
      }
    }

    toStorableJson({ value: new Counted("clean") } as unknown as JSONObject);
    expect(serializations).toBe(1);

    serializations = 0;

    expect(
      toStorableJson({
        value: new Counted("dirty\u0000"),
      } as unknown as JSONObject),
    ).toEqual({ value: "dirty\uFFFD" });
    expect(serializations).toBe(2);
  });

  test("the default export carries both helpers", () => {
    expect(PostgresStorableValue.toStorableJson).toBe(toStorableJson);
    expect(PostgresStorableValue.toStorableText).toBe(toStorableText);
  });
});
