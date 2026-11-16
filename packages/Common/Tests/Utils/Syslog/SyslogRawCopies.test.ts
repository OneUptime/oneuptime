import { JSONObject } from "../../../Types/JSON";
import SyslogAttribute from "../../../Types/Syslog/SyslogAttribute";
import {
  ParsedSyslogMessage,
  escapeSyslogStructuredDataValue,
  parseSyslogMessage,
  syslogStructuredDataAttributeKey,
} from "../../../Utils/Syslog/SyslogMessageParser";
import SyslogRawCopies, {
  ScrubLogRow,
} from "../../../Utils/Syslog/SyslogRawCopies";
import { describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * THE RAW COPIES OF A SYSLOG LINE HOLD WHAT THE SCRUB RULES LEFT OF ITS
 * PARTS (#9039).
 *
 * SyslogRawCopies runs a project's scrub rules over a syslog log row and
 * puts syslog.raw and syslog.structured.raw together again from what the
 * rules left of the header's fields, each structured-data parameter and
 * the message, then has the rules read them as the attributes they are.
 *
 * The rules here are stand-ins with the shape of the real ones - a keys
 * rule that hides the value of an attribute whose key names a secret, and
 * an email rule over the body, the attributes or both - so each step can
 * be watched. The real rules, through the real ingest routes, are in
 * App/Tests/Telemetry/ScrubRulesSyslogRawCopies.test.ts.
 * ---------------------------------------------------------------------------
 */

const EMAIL: RegExp = /[a-z0-9.]+@example\.com/g;
const SECRET_KEY: RegExp = /password|token|secret/i;

type Scope = "body" | "attributes" | "both";

interface StandInRules {
  keys?: boolean | undefined;
  email?: Scope | undefined;
  // Hides a pattern in the attributes' text, as a custom regex would.
  custom?: RegExp | undefined;
}

// Every row the rules were asked about, in order.
interface Recorded {
  rows: Array<JSONObject>;
}

function standIn(rules: StandInRules, recorded?: Recorded): ScrubLogRow {
  return (row: JSONObject): JSONObject => {
    recorded?.rows.push(JSON.parse(JSON.stringify(row)) as JSONObject);

    const attributes: JSONObject = (row["attributes"] as JSONObject) || {};

    for (const key of Object.keys(attributes)) {
      const value: unknown = attributes[key];

      if (typeof value !== "string") {
        continue;
      }

      let scrubbed: string = value;

      if (rules.keys && SECRET_KEY.test(key)) {
        scrubbed = "[REDACTED]";
      }

      if (rules.email === "attributes" || rules.email === "both") {
        scrubbed = scrubbed.replace(EMAIL, "[REDACTED]");
      }

      if (rules.custom) {
        scrubbed = scrubbed.replace(
          new RegExp(rules.custom.source, "g"),
          "[REDACTED]",
        );
      }

      attributes[key] = scrubbed;
    }

    if (
      typeof row["body"] === "string" &&
      (rules.email === "body" || rules.email === "both")
    ) {
      row["body"] = (row["body"] as string).replace(EMAIL, "[REDACTED]");
    }

    return row;
  };
}

// The row syslog posted over HTTP is stored as, before the rules.
function httpRow(line: string): {
  row: JSONObject;
  parsed: ParsedSyslogMessage;
} {
  const parsed: ParsedSyslogMessage = parseSyslogMessage(
    line,
  ) as ParsedSyslogMessage;
  const attributes: JSONObject = {
    "service.name": "checkout",
    [SyslogAttribute.Raw]: parsed.raw,
  };

  if (parsed.hostname) {
    attributes[SyslogAttribute.Hostname] = parsed.hostname;
  }

  if (parsed.appName) {
    attributes[SyslogAttribute.AppName] = parsed.appName;
  }

  if (parsed.procId) {
    attributes[SyslogAttribute.ProcessId] = parsed.procId;
  }

  if (parsed.msgId) {
    attributes[SyslogAttribute.MessageId] = parsed.msgId;
  }

  if (parsed.structuredDataRaw) {
    attributes[SyslogAttribute.StructuredRaw] = parsed.structuredDataRaw;
  }

  for (const [sdId, params] of Object.entries(parsed.structuredData || {})) {
    for (const [name, value] of Object.entries(params)) {
      attributes[syslogStructuredDataAttributeKey(sdId, name)] = value;
    }
  }

  return {
    row: { body: parsed.message, attributes: attributes },
    parsed: parsed,
  };
}

function attributesOf(row: JSONObject): JSONObject {
  return row["attributes"] as JSONObject;
}

const ISSUE_LINE: string =
  '<165>1 2026-11-16T10:11:12.003Z web-01 checkout 4711 ID47 [auth@1 password="hunter2"] {"token":"t-1"}';

describe("a line the rules change nothing in", () => {
  it("keeps both raw copies byte for byte, and asks the rules once", () => {
    const { row, parsed } = httpRow(
      '<165>1 2026-11-16T10:11:12.003Z web-01 checkout 4711 ID47 [meta seq="9" note="a \\"quoted\\" \\] word"] all is well',
    );
    const recorded: Recorded = { rows: [] };
    const before: string = JSON.stringify(row);

    const scrubbed: JSONObject = SyslogRawCopies.scrubLog({
      logRow: row,
      line: parsed,
      scrub: standIn({ keys: true, email: "both" }, recorded),
    });

    expect(JSON.stringify(scrubbed)).toBe(before);
    expect(recorded.rows).toHaveLength(1);
  });

  it("a row with no raw copies is only scrubbed", () => {
    const recorded: Recorded = { rows: [] };
    const row: JSONObject = {
      body: "mail ada@example.com",
      attributes: { password: "p" },
    };

    const scrubbed: JSONObject = SyslogRawCopies.scrubLog({
      logRow: row,
      scrub: standIn({ keys: true, email: "both" }, recorded),
    });

    expect(recorded.rows).toHaveLength(1);
    expect(scrubbed).toEqual({
      body: "mail [REDACTED]",
      attributes: { password: "[REDACTED]" },
    });
  });
});

describe("the issue's line, with a Sensitive Attribute Keys rule", () => {
  it("hides the password in both raw copies, written as RFC 5424 writes it", () => {
    const { row, parsed } = httpRow(ISSUE_LINE);

    const scrubbed: JSONObject = SyslogRawCopies.scrubLog({
      logRow: row,
      line: parsed,
      scrub: (logRow: JSONObject): JSONObject => {
        // The keys rule, and the token in the JSON message.
        const keys: ScrubLogRow = standIn({ keys: true });
        const read: JSONObject = keys(logRow);

        if (typeof read["body"] === "string") {
          read["body"] = (read["body"] as string).replace(
            '"t-1"',
            '"[REDACTED]"',
          );
        }

        return read;
      },
    });

    const attributes: JSONObject = attributesOf(scrubbed);

    expect(scrubbed["body"]).toBe('{"token":"[REDACTED]"}');
    expect(attributes["syslog.structured.auth_1.password"]).toBe("[REDACTED]");
    expect(attributes[SyslogAttribute.StructuredRaw]).toBe(
      '[auth@1 password="[REDACTED\\]"]',
    );
    expect(attributes[SyslogAttribute.Raw]).toBe(
      '<165>1 2026-11-16T10:11:12.003Z web-01 checkout 4711 ID47 [auth@1 password="[REDACTED\\]"] {"token":"[REDACTED]"}',
    );
  });
});

describe("each part of the line", () => {
  it("a message a Body Only rule changed is the message of syslog.raw", () => {
    const { row, parsed } = httpRow(
      "<34>Oct 11 22:14:15 mymachine su[123]: failed for ada@example.com",
    );

    const scrubbed: JSONObject = SyslogRawCopies.scrubLog({
      logRow: row,
      line: parsed,
      scrub: standIn({ email: "body" }),
    });

    expect(scrubbed["body"]).toBe("failed for [REDACTED]");
    expect(attributesOf(scrubbed)[SyslogAttribute.Raw]).toBe(
      "<34>Oct 11 22:14:15 mymachine su[123]: failed for [REDACTED]",
    );
  });

  it("a header field the rules changed is changed where the line writes it", () => {
    const { row, parsed } = httpRow(
      "<165>1 2026-11-16T10:11:12.003Z ada@example.com app ada@example.com ID47 - sent by ada@example.com",
    );

    const scrubbed: JSONObject = SyslogRawCopies.scrubLog({
      logRow: row,
      line: parsed,
      // An anchored pattern: it finds the whole host name, and nothing in the line.
      scrub: standIn({ custom: /^ada@example\.com$/ }),
    });

    const attributes: JSONObject = attributesOf(scrubbed);

    expect(attributes[SyslogAttribute.Hostname]).toBe("[REDACTED]");
    expect(attributes[SyslogAttribute.ProcessId]).toBe("[REDACTED]");
    // The message is the body's, which this rule does not read.
    expect(attributes[SyslogAttribute.Raw]).toBe(
      "<165>1 2026-11-16T10:11:12.003Z [REDACTED] app [REDACTED] ID47 - sent by ada@example.com",
    );
  });

  it("a parameter whose value has escapes is replaced whole, and written with escapes again", () => {
    const { row, parsed } = httpRow(
      '<165>1 2026-11-16T10:11:12.003Z web-01 app - - [auth@1 user="ada" password="hu\\"nt\\]er\\\\2" note="x"] done',
    );

    expect(attributesOf(row)["syslog.structured.auth_1.password"]).toBe(
      'hu"nt]er\\2',
    );

    const scrubbed: JSONObject = SyslogRawCopies.scrubLog({
      logRow: row,
      line: parsed,
      scrub: standIn({ keys: true }),
    });

    expect(attributesOf(scrubbed)[SyslogAttribute.StructuredRaw]).toBe(
      '[auth@1 user="ada" password="[REDACTED\\]" note="x"]',
    );
    expect(attributesOf(scrubbed)[SyslogAttribute.Raw]).toBe(
      '<165>1 2026-11-16T10:11:12.003Z web-01 app - - [auth@1 user="ada" password="[REDACTED\\]" note="x"] done',
    );
  });

  it("a value a pattern rule changed in part keeps the rest, its escapes written again", () => {
    const { row, parsed } = httpRow(
      '<165>1 2026-11-16T10:11:12.003Z web-01 app - - [mail@1 to="say \\"hi\\" to ada@example.com \\]"] ok',
    );

    const scrubbed: JSONObject = SyslogRawCopies.scrubLog({
      logRow: row,
      line: parsed,
      scrub: standIn({ email: "attributes" }),
    });

    expect(attributesOf(scrubbed)["syslog.structured.mail_1.to"]).toBe(
      'say "hi" to [REDACTED] ]',
    );
    expect(attributesOf(scrubbed)[SyslogAttribute.StructuredRaw]).toBe(
      '[mail@1 to="say \\"hi\\" to [REDACTED\\] \\]"]',
    );
  });

  it("the raw copies are then read by the rules, as attributes: what spans two parts is still found", () => {
    const { row, parsed } = httpRow(
      '<165>1 2026-11-16T10:11:12.003Z web-01 checkout 4711 ID47 [auth@1 password="hunter2"] plain',
    );
    const recorded: Recorded = { rows: [] };

    const scrubbed: JSONObject = SyslogRawCopies.scrubLog({
      logRow: row,
      line: parsed,
      scrub: standIn({ keys: true, custom: /web-01 checkout/ }, recorded),
    });

    expect(attributesOf(scrubbed)[SyslogAttribute.Raw]).toBe(
      '<165>1 2026-11-16T10:11:12.003Z [REDACTED] 4711 ID47 [auth@1 password="[REDACTED\\]"] plain',
    );
    // The row, then both copies together.
    expect(recorded.rows).toHaveLength(2);
    expect(Object.keys(attributesOf(recorded.rows[1]!)).sort()).toEqual([
      SyslogAttribute.Raw,
      SyslogAttribute.StructuredRaw,
    ]);
  });

  it("an attributes-only rule keeps hiding the message's address in syslog.raw when another part changes", () => {
    const { row, parsed } = httpRow(
      '<165>1 2026-11-16T10:11:12.003Z web-01 app - - [auth@1 password="p"] for ada@example.com',
    );

    const scrubbed: JSONObject = SyslogRawCopies.scrubLog({
      logRow: row,
      line: parsed,
      scrub: standIn({ keys: true, email: "attributes" }),
    });

    // The body is not the rule's to scrub; syslog.raw, an attribute, is.
    expect(scrubbed["body"]).toBe("for ada@example.com");
    expect(attributesOf(scrubbed)[SyslogAttribute.Raw]).toBe(
      '<165>1 2026-11-16T10:11:12.003Z web-01 app - - [auth@1 password="[REDACTED\\]"] for [REDACTED]',
    );
  });
});

describe("a parameter written twice", () => {
  it("the value the record does not keep is what the rules leave of it on its own, read once", () => {
    const { row, parsed } = httpRow(
      '<165>1 2026-11-16T10:11:12.003Z web-01 app - - [auth@1 password="first" password="second"][auth@1 password="third"] msg',
    );
    const recorded: Recorded = { rows: [] };

    expect(attributesOf(row)["syslog.structured.auth_1.password"]).toBe(
      "third",
    );

    const scrubbed: JSONObject = SyslogRawCopies.scrubLog({
      logRow: row,
      line: parsed,
      scrub: standIn({ keys: true }, recorded),
    });

    expect(attributesOf(scrubbed)[SyslogAttribute.StructuredRaw]).toBe(
      '[auth@1 password="[REDACTED\\]" password="[REDACTED\\]"][auth@1 password="[REDACTED\\]"]',
    );
    expect(attributesOf(scrubbed)[SyslogAttribute.Raw]).toContain(
      '[auth@1 password="[REDACTED\\]" password="[REDACTED\\]"][auth@1 password="[REDACTED\\]"] msg',
    );

    // The row; "first" and "second" alone, once each for both copies; the copies.
    const alone: Array<JSONObject> = recorded.rows.filter(
      (asked: JSONObject): boolean => {
        return (
          Object.keys(attributesOf(asked)).length === 1 &&
          attributesOf(asked)["syslog.structured.auth_1.password"] !== undefined
        );
      },
    );

    expect(
      alone.map((asked: JSONObject): unknown => {
        return attributesOf(asked)["syslog.structured.auth_1.password"];
      }),
    ).toEqual(["first", "second"]);
    expect(recorded.rows).toHaveLength(4);
  });

  it("an address in the first of two values is found by a pattern rule too", () => {
    const { row, parsed } = httpRow(
      '<165>1 2026-11-16T10:11:12.003Z web-01 app - - [origin ip="ada@example.com" ip="10.0.0.1"] msg',
    );

    const scrubbed: JSONObject = SyslogRawCopies.scrubLog({
      logRow: row,
      line: parsed,
      // An anchored pattern does not find it in the copy's text.
      scrub: standIn({ custom: /^ada@example\.com$/ }),
    });

    expect(attributesOf(scrubbed)[SyslogAttribute.StructuredRaw]).toBe(
      '[origin ip="[REDACTED\\]" ip="10.0.0.1"]',
    );
  });
});

describe("the rules may hand back a new row", () => {
  it("rebuilds from the row they hand back, and keeps what they hand back for the copies", () => {
    const { row, parsed } = httpRow(ISSUE_LINE);
    const handedTo: Array<JSONObject> = [];

    const scrubbed: JSONObject = SyslogRawCopies.scrubLog({
      logRow: row,
      line: parsed,
      scrub: (logRow: JSONObject): JSONObject => {
        handedTo.push(logRow);

        const copy: JSONObject = JSON.parse(JSON.stringify(logRow));

        return standIn({ keys: true, custom: /web-01 checkout/ })(copy);
      },
    });

    expect(scrubbed).not.toBe(row);
    expect(attributesOf(scrubbed)[SyslogAttribute.StructuredRaw]).toBe(
      '[auth@1 password="[REDACTED\\]"]',
    );
    expect(attributesOf(scrubbed)[SyslogAttribute.Raw]).toBe(
      '<165>1 2026-11-16T10:11:12.003Z [REDACTED] 4711 ID47 [auth@1 password="[REDACTED\\]"] {"token":"t-1"}',
    );
    // What the rules were handed is left as it was.
    expect(attributesOf(row)[SyslogAttribute.StructuredRaw]).toBe(
      '[auth@1 password="hunter2"]',
    );
    expect(attributesOf(handedTo[1]!)[SyslogAttribute.Raw]).toBe(
      '<165>1 2026-11-16T10:11:12.003Z web-01 checkout 4711 ID47 [auth@1 password="[REDACTED\\]"] {"token":"t-1"}',
    );
  });
});

describe("the reading of the line", () => {
  it("is read again when the caller has none, or one of another line", () => {
    for (const line of [
      undefined,
      null,
      parseSyslogMessage("<13>another line") as ParsedSyslogMessage,
    ]) {
      const { row } = httpRow(ISSUE_LINE);

      const scrubbed: JSONObject = SyslogRawCopies.scrubLog({
        logRow: row,
        line: line,
        scrub: standIn({ keys: true }),
      });

      expect(attributesOf(scrubbed)[SyslogAttribute.Raw]).toBe(
        '<165>1 2026-11-16T10:11:12.003Z web-01 checkout 4711 ID47 [auth@1 password="[REDACTED\\]"] {"token":"t-1"}',
      );
    }
  });

  it("a reading that cannot say where the parts are: syslog.raw is dropped once a part changes, and kept when none does", () => {
    const withoutLayout: (line: string) => ParsedSyslogMessage = (
      line: string,
    ): ParsedSyslogMessage => {
      const parsed: ParsedSyslogMessage = parseSyslogMessage(
        line,
      ) as ParsedSyslogMessage;

      return { ...parsed, layout: undefined };
    };

    const changed: { row: JSONObject; parsed: ParsedSyslogMessage } =
      httpRow(ISSUE_LINE);
    const dropped: JSONObject = SyslogRawCopies.scrubLog({
      logRow: changed.row,
      line: withoutLayout(ISSUE_LINE),
      scrub: standIn({ keys: true }),
    });

    expect(attributesOf(dropped)[SyslogAttribute.Raw]).toBeUndefined();
    // The structured data's copy is read on its own, and rebuilt.
    expect(attributesOf(dropped)[SyslogAttribute.StructuredRaw]).toBe(
      '[auth@1 password="[REDACTED\\]"]',
    );

    const unchanged: { row: JSONObject; parsed: ParsedSyslogMessage } =
      httpRow(ISSUE_LINE);
    const kept: JSONObject = SyslogRawCopies.scrubLog({
      logRow: unchanged.row,
      line: withoutLayout(ISSUE_LINE),
      scrub: standIn({ email: "both" }),
    });

    expect(attributesOf(kept)[SyslogAttribute.Raw]).toBe(ISSUE_LINE);
  });
});

describe("the syslog a probe forwards: structured data, and no syslog.raw", () => {
  it("rebuilds syslog.structured.raw alone", () => {
    const parsed: ParsedSyslogMessage = parseSyslogMessage(
      '<165>1 2026-11-16T10:11:12.003Z ap-1 hostapd - - [auth@1 token="t-9" user="ada"] associated',
    ) as ParsedSyslogMessage;
    const row: JSONObject = {
      body: parsed.message,
      attributes: {
        [SyslogAttribute.StructuredRaw]: parsed.structuredDataRaw!,
        "syslog.structured.auth_1.token": "t-9",
        "syslog.structured.auth_1.user": "ada",
        [SyslogAttribute.Hostname]: "ap-1",
      },
    };

    const scrubbed: JSONObject = SyslogRawCopies.scrubLog({
      logRow: row,
      scrub: standIn({ keys: true }),
    });

    expect(attributesOf(scrubbed)).toEqual({
      [SyslogAttribute.StructuredRaw]:
        '[auth@1 token="[REDACTED\\]" user="ada"]',
      "syslog.structured.auth_1.token": "[REDACTED]",
      "syslog.structured.auth_1.user": "ada",
      [SyslogAttribute.Hostname]: "ap-1",
    });
  });
});

/*
 * Seeded, so a failure names the line and the rules that broke it. Every
 * secret and address is a mark of its own, so a mark found in a raw copy
 * can be looked for in the parts: whatever the rules hid in every part
 * that holds it must be gone from the copies too, and a line in which they
 * changed nothing keeps its copies as they arrived.
 */
describe("any line, any rules", () => {
  let seed: number = 9039;

  function random(): number {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  }

  function pick<T>(choices: ReadonlyArray<T>): T {
    return choices[Math.floor(random() * choices.length)]!;
  }

  let marks: number = 0;

  function mark(kind: "secret" | "email"): string {
    marks++;
    return kind === "secret" ? `S3CRET${marks}x` : `u${marks}@example.com`;
  }

  const MARK: RegExp = /S3CRET\d+x|u\d+@example\.com/g;

  function value(): string {
    return pick([
      (): string => {
        return mark("secret");
      },
      (): string => {
        return `mail ${mark("email")} now`;
      },
      (): string => {
        return `say "${mark("secret")}" \\ ] [`;
      },
      (): string => {
        return "plain";
      },
      (): string => {
        return "";
      },
    ])();
  }

  function structuredData(): string {
    const elements: Array<string> = [];
    let element: number = 0;

    for (let count: number = 1 + Math.floor(random() * 2); count > 0; count--) {
      element++;
      const params: Array<string> = [];
      const names: Array<string> = ["password", "user", "note", "api_token"];

      for (let param: number = Math.floor(random() * 4); param > 0; param--) {
        const name: string = names.splice(
          Math.floor(random() * names.length),
          1,
        )[0]!;

        params.push(`${name}="${escapeSyslogStructuredDataValue(value())}"`);
      }

      elements.push(
        `[e${element}@1${params.length ? " " : ""}${params.join(" ")}]`,
      );
    }

    return elements.join(pick(["", " "]));
  }

  function message(): string {
    return pick([
      (): string => {
        return `login for ${mark("email")}`;
      },
      (): string => {
        return "nothing to hide";
      },
      (): string => {
        return `{"token":"${mark("secret")}","user":"${mark("email")}"}`;
      },
      (): string => {
        return "";
      },
    ])();
  }

  function anyLine(): string {
    if (random() < 0.6) {
      return `<165>1 2026-11-16T10:11:12.003Z ${pick(["web-01", mark("email"), "-"])} ${pick(["app", "-"])} ${pick(["4711", "-"])} ${pick(["ID47", "-"])} ${pick(["-", structuredData()])} ${message()}`;
    }

    return `<34>Oct 11 22:14:15 ${pick(["host", mark("email")])} ${pick(["su:", "su[1]:", "sshd"])} ${message()}`;
  }

  function anyRules(): StandInRules {
    return {
      keys: random() < 0.5,
      email: pick([undefined, "body", "attributes", "both"] as const),
      custom: pick([undefined, undefined, /S3CRET\d+x/]),
    };
  }

  function marksIn(texts: Array<unknown>): Set<string> {
    const found: Set<string> = new Set<string>();

    for (const text of texts) {
      if (typeof text === "string") {
        for (const match of text.match(MARK) || []) {
          found.add(match);
        }
      }
    }

    return found;
  }

  it("leaves in the raw copies no mark the rules hid in every part that holds it", () => {
    for (let round: number = 0; round < 2000; round++) {
      const line: string = anyLine();
      const rules: StandInRules = anyRules();
      const { row, parsed } = httpRow(line);
      const original: string = JSON.stringify(row);

      const scrubbed: JSONObject = SyslogRawCopies.scrubLog({
        logRow: row,
        line: parsed,
        scrub: standIn(rules),
      });

      const attributes: JSONObject = attributesOf(scrubbed);
      const copies: Array<unknown> = [
        attributes[SyslogAttribute.Raw],
        attributes[SyslogAttribute.StructuredRaw],
      ];
      const parts: Array<unknown> = [
        scrubbed["body"],
        ...Object.keys(attributes)
          .filter((key: string): boolean => {
            return (
              key !== SyslogAttribute.Raw &&
              key !== SyslogAttribute.StructuredRaw
            );
          })
          .map((key: string): unknown => {
            return attributes[key];
          }),
      ];
      const inParts: Set<string> = marksIn(parts);
      const leaked: Array<string> = Array.from(marksIn(copies)).filter(
        (found: string): boolean => {
          return !inParts.has(found);
        },
      );

      const described: string = `keys=${rules.keys} email=${rules.email} custom=${rules.custom}`;

      expect({ line, rules: described, leaked }).toEqual({
        line,
        rules: described,
        leaked: [],
      });

      // Nothing for these rules to hide: the copies are as they arrived.
      if (!rules.keys && marksIn([original]).size === 0) {
        const before: JSONObject = attributesOf(
          JSON.parse(original) as JSONObject,
        );

        expect({
          line,
          raw: attributes[SyslogAttribute.Raw],
          structured: attributes[SyslogAttribute.StructuredRaw],
        }).toEqual({
          line,
          raw: before[SyslogAttribute.Raw],
          structured: before[SyslogAttribute.StructuredRaw],
        });
      }
    }
  });
});
