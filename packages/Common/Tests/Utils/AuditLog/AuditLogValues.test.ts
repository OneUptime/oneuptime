import { describe, expect, test } from "@jest/globals";
import { AUDIT_LOG_REDACTED_VALUE } from "../../../Types/AuditLog/AuditLogRedaction";
import {
  AUDIT_LOG_JSON_LIMIT,
  AUDIT_LOG_SUMMARY_LINE_LIMIT,
  AUDIT_LOG_TEXT_LIMIT,
  describeLargeJson,
  formatCount,
  getFirstDifference,
  getJsonChangeLines,
  getJsonLength,
  isJsonStructure,
  isLargeJson,
  isSameJson,
  limitChangedText,
  limitText,
  redactSecretsInJson,
} from "../../../Utils/AuditLog/AuditLogValues";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * What an audit log entry keeps of a value (issue #6187): JSON without its
 * secrets and with the paths that changed, large JSON by its size, and long
 * text around where it changed.
 */

// Whether a text holds half of a character written as two: a cut made in the wrong place.
function hasLoneSurrogate(text: string): boolean {
  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next: number = text.charCodeAt(index + 1);

      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }

      index++;
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }

  return false;
}

describe("secrets in JSON are redacted wherever they sit", () => {
  test("a monitor's request headers", () => {
    expect(
      redactSecretsInJson({
        requestHeaders: {
          Authorization: "Bearer abc.def.ghi",
          "X-Api-Key": "k-123",
          "Content-Type": "application/json",
          Cookie: "session=1",
        },
        url: "https://example.com",
      }),
    ).toEqual({
      requestHeaders: {
        Authorization: AUDIT_LOG_REDACTED_VALUE,
        "X-Api-Key": AUDIT_LOG_REDACTED_VALUE,
        "Content-Type": "application/json",
        Cookie: AUDIT_LOG_REDACTED_VALUE,
      },
      url: "https://example.com",
    });
  });

  test.each([
    "password",
    "smtpPassword",
    "db_passwd",
    "passphrase",
    "apiKey",
    "api_key",
    "x-api-key",
    "accessToken",
    "refresh_token",
    "clientSecret",
    "privateKey",
    "private-key",
    "snmpV3PrivKey",
    "snmpV3AuthKey",
    "AWS_ACCESS_KEY",
    "signingKey",
    "credentials",
    "bearerToken",
    "communityString",
    "slackWebhookUrl",
    "connectionString",
    "Authorization",
    "set-cookie",
  ])("the value under %s", (key: string) => {
    expect(redactSecretsInJson({ [key]: "value-1" })).toEqual({
      [key]: AUDIT_LOG_REDACTED_VALUE,
    });
  });

  test.each(["name", "description", "url", "monitorType", "keyword", "key"])(
    "a key that names no secret keeps its value: %s",
    (key: string) => {
      expect(redactSecretsInJson({ [key]: "value-1" })).toEqual({
        [key]: "value-1",
      });
    },
  );

  test("a key that only might name one is redacted, on the safe side", () => {
    expect(redactSecretsInJson({ tokenizerLanguage: "en" })).toEqual({
      tokenizerLanguage: AUDIT_LOG_REDACTED_VALUE,
    });
  });

  test("a secret holding an object or a list is redacted whole", () => {
    expect(
      redactSecretsInJson({ credentials: { user: "u", pass: "p" }, tokens: ["a"] }),
    ).toEqual({
      credentials: AUDIT_LOG_REDACTED_VALUE,
      tokens: AUDIT_LOG_REDACTED_VALUE,
    });
  });

  test("an empty secret stays empty, so an entry shows it unset", () => {
    expect(redactSecretsInJson({ password: null, token: undefined })).toEqual({
      password: null,
      token: undefined,
    });
  });

  test("a pair that names a secret has its value redacted", () => {
    expect(
      redactSecretsInJson({
        headers: [
          { key: "Authorization", value: "Bearer x" },
          { name: "X-Api-Key", value: "y" },
          { header: "Accept", value: "text/html" },
          { headerName: "Cookie", value: "z" },
        ],
      }),
    ).toEqual({
      headers: [
        { key: "Authorization", value: AUDIT_LOG_REDACTED_VALUE },
        { name: "X-Api-Key", value: AUDIT_LOG_REDACTED_VALUE },
        { header: "Accept", value: "text/html" },
        { headerName: "Cookie", value: AUDIT_LOG_REDACTED_VALUE },
      ],
    });
  });

  test("deep inside lists of objects", () => {
    expect(
      redactSecretsInJson({
        steps: [{ data: { requestHeaders: { authorization: "x" } } }],
      }),
    ).toEqual({
      steps: [{ data: { requestHeaders: { authorization: AUDIT_LOG_REDACTED_VALUE } } }],
    });
  });

  test("scalars and nothing come back as they are", () => {
    for (const value of ["text", 4, true, null, undefined]) {
      expect(redactSecretsInJson(value)).toBe(value);
    }
  });

  test("the value it was given is left as it was", () => {
    const value: { password: string } = { password: "p" };

    redactSecretsInJson(value);

    expect(value.password).toBe("p");
  });

  test("past the deepest level read, nothing is kept", () => {
    let nested: Record<string, unknown> = { leaf: "secret-sauce" };

    for (let level: number = 0; level < 40; level++) {
      nested = { child: nested };
    }

    expect(JSON.stringify(redactSecretsInJson(nested))).not.toContain(
      "secret-sauce",
    );
  });
});

describe("the paths that changed in JSON", () => {
  test("keys added, removed and changed, in key order", () => {
    expect(
      getJsonChangeLines({
        before: { b: 1, a: { x: 1, y: 2 }, gone: true },
        after: { b: 2, a: { x: 1, y: 3, z: 0 }, added: "n" },
      }),
    ).toEqual([
      "Changed a › y",
      "Added a › z",
      "Added added",
      "Changed b",
      "Removed gone",
    ]);
  });

  test("never quotes a value, so a changed secret is named and not shown", () => {
    const lines: Array<string> = getJsonChangeLines({
      before: { requestHeaders: { Authorization: "Bearer old-secret" } },
      after: { requestHeaders: { Authorization: "Bearer new-secret" } },
    });

    expect(lines).toEqual(["Changed requestHeaders › Authorization"]);
    expect(lines.join(" ")).not.toContain("secret");
  });

  test("lists compared item by item, numbered from 1", () => {
    expect(
      getJsonChangeLines({ before: [1, 2, 3], after: [1, 5, 3, 4] }),
    ).toEqual(["Changed 2", "Added 4"]);
    expect(getJsonChangeLines({ before: [1, 2], after: [1] })).toEqual([
      "Removed 2",
    ]);
  });

  test("lists whose items have ids are compared by id, so an insert at the top is one line", () => {
    expect(
      getJsonChangeLines({
        before: { widgets: [{ id: "a", t: 1 }, { id: "b", t: 2 }] },
        after: {
          widgets: [
            { id: "new", t: 0 },
            { id: "a", t: 1 },
            { id: "b", t: 9 },
          ],
        },
      }),
    ).toEqual(["Added widgets › new", "Changed widgets › b › t"]);
  });

  test("an item removed by id", () => {
    expect(
      getJsonChangeLines({
        before: [{ _id: "a" }, { _id: "b" }],
        after: [{ _id: "b" }],
      }),
    ).toEqual(["Removed a"]);
  });

  test("ids that repeat are not ids", () => {
    expect(
      getJsonChangeLines({
        before: [{ id: "a", v: 1 }, { id: "a", v: 2 }],
        after: [{ id: "a", v: 1 }, { id: "a", v: 3 }],
      }),
    ).toEqual(["Changed 2 › v"]);
  });

  test("a value that changes type, and a whole value that changes", () => {
    expect(getJsonChangeLines({ before: { a: [1] }, after: { a: { b: 1 } } })).toEqual([
      "Changed a",
    ]);
    expect(getJsonChangeLines({ before: 1, after: 2 })).toEqual([
      "Changed the value",
    ]);
  });

  test("the same JSON in another key order, and nothing over null, are no change", () => {
    expect(
      getJsonChangeLines({
        before: { a: 1, b: { c: [1, 2] } },
        after: { b: { c: [1, 2] }, a: 1 },
      }),
    ).toEqual([]);
    expect(getJsonChangeLines({ before: { a: null }, after: {} })).toEqual([]);
    expect(isSameJson({ a: null }, { a: undefined })).toBe(true);
    expect(isSameJson([1], [1, 2])).toBe(false);
    expect(isSameJson({ a: 1 }, [1])).toBe(false);
  });

  test("a long list of changes is cut to the limit, counting the rest", () => {
    const before: Record<string, number> = {};
    const after: Record<string, number> = {};

    for (let index: number = 0; index < 100; index++) {
      before[`k${String(index).padStart(3, "0")}`] = index;
      after[`k${String(index).padStart(3, "0")}`] = index + 1;
    }

    const lines: Array<string> = getJsonChangeLines({ before, after });

    expect(lines).toHaveLength(AUDIT_LOG_SUMMARY_LINE_LIMIT);
    expect(lines[lines.length - 1]).toBe(
      `and ${100 - (AUDIT_LOG_SUMMARY_LINE_LIMIT - 1)} more changes`,
    );
  });

  test("a change deeper than is read is named where reading stopped", () => {
    let before: unknown = 1;
    let after: unknown = 2;

    for (let level: number = 0; level < 40; level++) {
      before = { n: before };
      after = { n: after };
    }

    const lines: Array<string> = getJsonChangeLines({ before, after });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.startsWith("Changed n › n")).toBe(true);
  });
});

describe("large JSON is recorded by its size", () => {
  test("the limit and the size markers", () => {
    const small: Record<string, string> = { a: "x".repeat(100) };
    const large: Record<string, string> = {
      a: "x".repeat(AUDIT_LOG_JSON_LIMIT + 1),
    };

    expect(isLargeJson(small)).toBe(false);
    expect(isLargeJson(large)).toBe(true);
    expect(isLargeJson("x".repeat(AUDIT_LOG_JSON_LIMIT * 2))).toBe(false);
    expect(describeLargeJson(12_595)).toBe("[12.3 KB of JSON]");
    expect(describeLargeJson(3 * 1024 * 1024)).toBe("[3.0 MB of JSON]");
    expect(describeLargeJson(Number.POSITIVE_INFINITY)).toBe(
      "[JSON too large to record]",
    );
  });

  test("lengths, and what is JSON", () => {
    expect(getJsonLength({ a: 1 })).toBe(7);
    expect(getJsonLength(undefined)).toBe(0);

    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    expect(getJsonLength(circular)).toBe(Number.POSITIVE_INFINITY);
    expect(isJsonStructure({})).toBe(true);
    expect(isJsonStructure([])).toBe(true);
    expect(isJsonStructure(null)).toBe(false);
    expect(isJsonStructure("{}")).toBe(false);
  });
});

describe("long text keeps the part around where it changed", () => {
  test("text that fits is kept whole", () => {
    expect(limitText("short")).toBe("short");
    expect(
      limitChangedText({ before: "a", after: "b" }),
    ).toEqual({ before: "a", after: "b" });
  });

  test("a long text keeps its start and says how much is left out", () => {
    const text: string = "y".repeat(AUDIT_LOG_TEXT_LIMIT + 2500);

    expect(limitText(text)).toBe(
      `${"y".repeat(AUDIT_LOG_TEXT_LIMIT)} [… 2,500 more characters]`,
    );
  });

  test("a change near the end of a long text shows that change", () => {
    const start: string = "a".repeat(50_000);
    const result: { before: string; after: string } = limitChangedText({
      before: `${start}OLD ENDING`,
      after: `${start}NEW ENDING`,
      limit: 1000,
    });

    expect(result.before).toContain("OLD ENDING");
    expect(result.after).toContain("NEW ENDING");
    expect(result.before.startsWith("[… 49,800 characters] ")).toBe(true);
    expect(result.after.startsWith("[… 49,800 characters] ")).toBe(true);
  });

  test("a change at the start of a long text shows the start", () => {
    const rest: string = "b".repeat(30_000);
    const result: { before: string; after: string } = limitChangedText({
      before: `X${rest}`,
      after: `Y${rest}`,
      limit: 100,
    });

    expect(result.before.startsWith("X")).toBe(true);
    expect(result.after.startsWith("Y")).toBe(true);
    expect(result.before.endsWith(" [… 29,901 more characters]")).toBe(true);
  });

  test("a short text against a long one: the same window of each", () => {
    const result: { before: string; after: string } = limitChangedText({
      before: "abc",
      after: `abc${"z".repeat(500)}`,
      limit: 100,
    });

    expect(result.before).toBe("abc");
    expect(result.after.startsWith("abc")).toBe(true);
    expect(result.after.endsWith(" [… 403 more characters]")).toBe(true);
  });

  test("never cuts a character written as two in half", () => {
    const emoji: string = "😀";
    const text: string = `${"a".repeat(9)}${emoji}${"b".repeat(20)}`;

    // A limit of 10 would end inside the emoji.
    expect(limitText(text, 10)).toBe(
      `${"a".repeat(9)} [… ${formatCount(text.length - 9)} more characters]`,
    );

    /*
     * A window that would start inside it starts after it: the texts first
     * differ 200 characters after the emoji's second half.
     */
    const before: string = `${"c".repeat(300)}${emoji}${"d".repeat(199)}X${"e".repeat(400)}`;
    const after: string = `${"c".repeat(300)}${emoji}${"d".repeat(199)}Y${"e".repeat(400)}`;
    const window: { before: string; after: string } = limitChangedText({
      before,
      after,
      limit: 250,
    });

    expect(window.before.startsWith("[… 302 characters] d")).toBe(true);
    expect(window.after.startsWith("[… 302 characters] d")).toBe(true);
    expect(hasLoneSurrogate(window.before)).toBe(false);
    expect(hasLoneSurrogate(window.after)).toBe(false);
  });

  test("where two texts first differ", () => {
    expect(getFirstDifference("abc", "abd")).toBe(2);
    expect(getFirstDifference("abc", "abc")).toBe(3);
    expect(getFirstDifference("ab", "abc")).toBe(2);
    expect(getFirstDifference("", "x")).toBe(0);
  });

  test("counts are written with thousands separators", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1000)).toBe("1,000");
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(-5)).toBe("0");
    expect(formatCount(12.9)).toBe("12");
  });

  test("a megabyte-long line is limited in time linear in its length", () => {
    const line: string = "q".repeat(4 * 1024 * 1024);
    const started: number = Date.now();

    const limited: { before: string; after: string } = limitChangedText({
      before: line,
      after: `${line}!`,
    });

    expect(limited.after.length).toBeLessThan(AUDIT_LOG_TEXT_LIMIT + 100);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("property: every recorded change says nothing a secret holds", () => {
  /*
   * Random JSON whose secret-named keys hold a marker: neither the redacted
   * copy nor the lines of what changed ever carry it, and a change only to
   * a secret is still named.
   */
  const SECRET_MARKER: string = "SECRET-MARKER";
  const KEYS: ReadonlyArray<string> = [
    "name",
    "password",
    "headers",
    "apiKey",
    "items",
    "value",
    "token",
    "url",
  ];

  function randomJson(random: SeededRandom, depth: number): unknown {
    if (depth > 3 || random(4) === 0) {
      return random(2) === 0 ? random(100) : `text-${random(100)}`;
    }

    if (random(3) === 0) {
      const list: Array<unknown> = [];
      const length: number = random(4);

      for (let index: number = 0; index < length; index++) {
        list.push(randomJson(random, depth + 1));
      }

      return list;
    }

    const object: Record<string, unknown> = {};
    const count: number = 1 + random(4);

    for (let index: number = 0; index < count; index++) {
      const key: string = KEYS[random(KEYS.length)] as string;
      object[key] = ["password", "apiKey", "token"].includes(key)
        ? `${SECRET_MARKER}-${random(1000)}`
        : randomJson(random, depth + 1);
    }

    return object;
  }

  test("over 2,000 seeded values", () => {
    const random: SeededRandom = seededRandom(1876);

    for (let run: number = 0; run < 2000; run++) {
      const before: unknown = randomJson(random, 0);
      const after: unknown = randomJson(random, 0);

      expect(JSON.stringify(redactSecretsInJson(before) ?? null)).not.toContain(
        SECRET_MARKER,
      );
      expect(
        getJsonChangeLines({ before, after }).join("\n"),
      ).not.toContain(SECRET_MARKER);
      expect(getJsonChangeLines({ before, after: before })).toEqual([]);
    }
  });

  test("texts of every shape are limited to their window, whatever they hold", () => {
    const texts: Array<string> = generatedTexts(300, 6187, [
      "a",
      "😀",
      "\n",
      "|",
      "<",
      "`",
      " ",
    ]);

    for (const text of texts) {
      const longText: string = text.repeat(1 + Math.floor(20_000 / (text.length || 1)));
      const limited: string = limitText(longText, 500);

      expect(limited.length).toBeLessThanOrEqual(500 + 60);
      expect(hasLoneSurrogate(limited)).toBe(false);
      expect(limitText(text, 500)).toBe(text);
    }
  });
});
