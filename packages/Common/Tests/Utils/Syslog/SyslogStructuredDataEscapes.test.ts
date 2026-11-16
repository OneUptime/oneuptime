import {
  ParsedSyslogMessage,
  SyslogStructuredDataParam,
  escapeSyslogStructuredDataValue,
  parseSyslogMessage,
  readSyslogStructuredData,
  syslogStructuredDataAttributeKey,
} from "../../../Utils/Syslog/SyslogMessageParser";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { describe, expect, it } from "@jest/globals";

/*
 * RFC 5424 STRUCTURED DATA, ESCAPES AND ALL (#9039).
 *
 * In a parameter's value, '"', '\' and ']' are written '\"', '\\' and
 * '\]', and a backslash before any other character is that backslash
 * (RFC 5424 6.3.3). The reader took a value to end at the first quote and
 * an element at the first "]": a value holding '\"' lost its whole element
 * - so a Sensitive Attribute Keys rule had no `password` attribute to hide,
 * and the password stayed in syslog.structured.raw - and a '\]' cut the
 * structured data short, filing the rest of it as the message.
 *
 * Each parameter now also says where its value sits in the structured
 * data, so a copy of it can be put together again from what the scrub
 * rules left of each value (SyslogRawCopies).
 */

function parse(raw: string): ParsedSyslogMessage {
  const parsed: ParsedSyslogMessage | null = parseSyslogMessage(raw);

  if (!parsed) {
    throw new Error(`Expected ${JSON.stringify(raw)} to parse`);
  }

  return parsed;
}

function line(structuredData: string, message: string = "the message"): string {
  return `<165>1 2026-11-16T10:11:12.003Z web-01 checkout 4711 ID47 ${structuredData} ${message}`;
}

describe("a value's escapes are read", () => {
  it.each([
    ['\\"', '"'],
    ["\\\\", "\\"],
    ["\\]", "]"],
  ])("%s is read as %s", (written: string, read: string) => {
    const parsed: ParsedSyslogMessage = parse(
      line(`[auth@1 password="a${written}b" user="ada"]`),
    );

    expect(parsed.structuredData).toEqual({
      auth_1: { password: `a${read}b`, user: "ada" },
    });
    expect(parsed.structuredDataRaw).toBe(
      `[auth@1 password="a${written}b" user="ada"]`,
    );
    expect(parsed.message).toBe("the message");
  });

  it("reads all three in one value, at its start and its end", () => {
    const parsed: ParsedSyslogMessage = parse(
      line('[x@1 v="\\"q\\\\ \\] \\"" w="\\\\"]'),
    );

    expect(parsed.structuredData).toEqual({
      x_1: { v: '"q\\ ] "', w: "\\" },
    });
  });

  it("keeps a backslash before any other character, and that character", () => {
    const parsed: ParsedSyslogMessage = parse(
      line('[win@1 path="C:\\temp\\new" re="\\d+\\n"]'),
    );

    expect(parsed.structuredData).toEqual({
      win_1: { path: "C:\\temp\\new", re: "\\d+\\n" },
    });
  });

  it("a '\\]' no longer ends the structured data: the message is the message", () => {
    const parsed: ParsedSyslogMessage = parse(
      line('[auth@1 password="hunter\\]2"]', '{"token":"t-1"}'),
    );

    expect(parsed.structuredDataRaw).toBe('[auth@1 password="hunter\\]2"]');
    expect(parsed.structuredData).toEqual({
      auth_1: { password: "hunter]2" },
    });
    expect(parsed.message).toBe('{"token":"t-1"}');
  });

  it("a ']' a device leaves unescaped inside a quoted value does not end it either", () => {
    const parsed: ParsedSyslogMessage = parse(
      line('[a@1 note="see ]" x="1"]', "after"),
    );

    expect(parsed.structuredData).toEqual({ a_1: { note: "see ]", x: "1" } });
    expect(parsed.message).toBe("after");
  });

  it("an unbalanced '[' inside a quoted value does not swallow the message", () => {
    const parsed: ParsedSyslogMessage = parse(
      line('[a@1 note="a [ b"]', "after"),
    );

    expect(parsed.structuredData).toEqual({ a_1: { note: "a [ b" } });
    expect(parsed.message).toBe("after");
  });

  it("reads the escapes in every element of a line, and elements with spaces between them", () => {
    const parsed: ParsedSyslogMessage = parse(
      line('[a@1 x="\\"1\\""] [b@2 y="2\\]"][c@3 z="\\\\3"]'),
    );

    expect(parsed.structuredData).toEqual({
      a_1: { x: '"1"' },
      b_2: { y: "2]" },
      c_3: { z: "\\3" },
    });
  });
});

describe("what a device writes without its escapes is read as before", () => {
  it("a value that ends in a backslash, written without escaping it", () => {
    const parsed: ParsedSyslogMessage = parse(
      line('[win@1 path="C:\\" user="ada"]', "after"),
    );

    expect(parsed.structuredData).toEqual({
      win_1: { path: "C:\\", user: "ada" },
    });
    expect(parsed.message).toBe("after");
  });

  it("an element with an unescaped quote in a value ends where its brackets close", () => {
    const parsed: ParsedSyslogMessage = parse(
      line('[a@1 note="it"s"]', 'the "message"'),
    );

    expect(parsed.structuredDataRaw).toBe('[a@1 note="it"s"]');
    // It reads neither way, and keeps no parameters, as before.
    expect(parsed.structuredData).toEqual({});
    expect(parsed.message).toBe('the "message"');
  });

  it("an element that never closes keeps the rest of the line as structured data", () => {
    const parsed: ParsedSyslogMessage = parse(
      '<165>1 2026-11-16T10:11:12.003Z host app - - [a@1 x="1"][b@2 y="2" and then nothing',
    );

    expect(parsed.structuredDataRaw).toBe(
      '[a@1 x="1"][b@2 y="2" and then nothing',
    );
    expect(parsed.structuredData).toEqual({ a_1: { x: "1" } });
    expect(parsed.message).toBe("");
  });

  it("a backslash at the very end of an element that never closes", () => {
    const parsed: ParsedSyslogMessage = parse(
      '<165>1 2026-11-16T10:11:12.003Z host app - - [a@1 x="\\',
    );

    expect(parsed.structuredDataRaw).toBe('[a@1 x="\\');
    expect(parsed.structuredData).toEqual({});
    expect(parsed.message).toBe("");
  });

  it.each([
    ['[a@1 x="1" ]', {}],
    ['[ a@1 x="1"]', {}],
    ["[a@1 x=1]", {}],
    ['[a@1 x="1"y="2"]', {}],
    ["[origin]", { origin: {} }],
    ['[a@1 x=""]', { a_1: { x: "" } }],
    ['[a@1 my$key="v"]', { a_1: { my_key: "v" } }],
  ])("%s reads as it did", (structuredData: string, expected: unknown) => {
    expect(parse(line(structuredData, "after")).structuredData).toEqual(
      expected,
    );
  });
});

describe("readSyslogStructuredData", () => {
  it("finds each parameter, where its value sits, and its value with the escapes read", () => {
    const structuredData: string =
      '[auth@1 password="hun\\"ter\\]2" user="ada"][meta x="\\\\"]';
    const params: Array<SyslogStructuredDataParam> =
      readSyslogStructuredData(structuredData).params;

    expect(
      params.map((param: SyslogStructuredDataParam) => {
        return {
          sdId: param.sdId,
          name: param.name,
          value: param.value,
          written: structuredData.slice(
            param.valueSpan.start,
            param.valueSpan.end,
          ),
        };
      }),
    ).toEqual([
      {
        sdId: "auth@1",
        name: "password",
        value: 'hun"ter]2',
        written: 'hun\\"ter\\]2',
      },
      { sdId: "auth@1", name: "user", value: "ada", written: "ada" },
      { sdId: "meta", name: "x", value: "\\", written: "\\\\" },
    ]);
  });

  it("keeps a parameter written twice twice, in the order written", () => {
    const params: Array<SyslogStructuredDataParam> = readSyslogStructuredData(
      '[origin ip="192.0.2.1" ip="192.0.2.129"]',
    ).params;

    expect(
      params.map((param: SyslogStructuredDataParam) => {
        return param.value;
      }),
    ).toEqual(["192.0.2.1", "192.0.2.129"]);
    // The record keeps the last.
    expect(
      readSyslogStructuredData('[origin ip="192.0.2.1" ip="192.0.2.129"]')
        .structuredData,
    ).toEqual({ origin: { ip: "192.0.2.129" } });
  });

  it("finds in a line's structured data what the line's reading found", () => {
    const lines: Array<string> = [
      line(
        '[exampleSDID@32473 iut="3" eventSource="Application" eventID="1011"]',
      ),
      line('[a@1 x="1"] [b@2 y="2\\]"][a@1 z="\\"3\\""]'),
      line('[win@1 path="C:\\" user="ada"]'),
      line('[a@1 note="it"s"][b@2 y="2"]'),
      '<165>1 2026-11-16T10:11:12.003Z host app - - [a@1 x="1"][b@2 y="2" and then nothing',
      line('[__proto__ polluted="yes"][constructor x="1"]'),
    ];

    for (const text of lines) {
      const parsed: ParsedSyslogMessage = parse(text);

      expect({
        text,
        structuredData: readSyslogStructuredData(parsed.structuredDataRaw || "")
          .structuredData,
      }).toEqual({ text, structuredData: parsed.structuredData });
    }
  });

  it("reads nothing from text that is not structured data", () => {
    expect(readSyslogStructuredData("-")).toEqual({
      structuredData: {},
      params: [],
    });
    expect(readSyslogStructuredData("")).toEqual({
      structuredData: {},
      params: [],
    });
  });
});

describe("escapeSyslogStructuredDataValue", () => {
  it("escapes '\"', '\\' and ']', and nothing else", () => {
    expect(escapeSyslogStructuredDataValue("[REDACTED]")).toBe("[REDACTED\\]");
    expect(escapeSyslogStructuredDataValue('a"b\\c]d[e')).toBe(
      'a\\"b\\\\c\\]d[e',
    );
    expect(escapeSyslogStructuredDataValue("plain text")).toBe("plain text");
  });

  // Seeded, so a failure names the value that broke it.
  it("is read back as the value it was, whatever the value", () => {
    const alphabet: string = 'ab "\\][=\n\t\u00e9\u4e2d\ud83d\ude00';
    let seed: number = 9039;
    const random: () => number = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let round: number = 0; round < 500; round++) {
      let value: string = "";
      const length: number = Math.floor(random() * 12);

      for (let index: number = 0; index < length; index++) {
        value +=
          Array.from(alphabet)[
            Math.floor(random() * Array.from(alphabet).length)
          ];
      }

      const structuredData: string = `[x@1 v="${escapeSyslogStructuredDataValue(value)}" w="1"]`;

      expect({
        value,
        read: readSyslogStructuredData(structuredData).structuredData,
      }).toEqual({ value, read: { x_1: { v: value, w: "1" } } });
    }
  });
});

describe("syslogStructuredDataAttributeKey", () => {
  it("is the attribute both ways syslog arrives keep a parameter as", () => {
    expect(syslogStructuredDataAttributeKey("auth@1", "password")).toBe(
      "syslog.structured.auth_1.password",
    );
    expect(syslogStructuredDataAttributeKey("a b", "c$d")).toBe(
      "syslog.structured.a_b.c_d",
    );
  });
});

describe("time in line with the text", () => {
  it.each([
    ["brackets", "[".repeat(200_000)],
    ["elements that never close", '[a x="1" '.repeat(30_000)],
    ["a value that never ends", `[a x="${"[b ".repeat(60_000)}`],
    ["escapes", `[a x="${'\\"'.repeat(100_000)}"]`],
    ["names", `[a ${"[".repeat(200_000)}="1"]`],
    ["elements", '[a x="1"]'.repeat(30_000)],
  ])("%s", (_name: string, structuredData: string) => {
    // The fastest of up to three attempts: one timing on a busy runner is noisy.
    const read: FastestRun<void> = fastestRun({
      run: (): void => {
        parse(line(structuredData));
        readSyslogStructuredData(structuredData);
      },
      limitInMs: 2000,
    });

    expect(read.inMs).toBeLessThan(2000);
  });
});
