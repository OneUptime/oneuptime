import {
  ParsedSyslogMessage,
  SyslogLineLayout,
  SyslogTextSpan,
  escapeSyslogStructuredDataValue,
  parseSyslogMessage,
} from "../../../Utils/Syslog/SyslogMessageParser";
import { describe, expect, it } from "@jest/globals";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * WHERE EACH PART OF A SYSLOG LINE SITS IN IT (#9039).
 *
 * A log keeps the parts of its line on their own - the header's fields as
 * attributes, the message as the body - and the whole line as syslog.raw.
 * To put that copy together again from what the scrub rules left of each
 * part, the reading says where each part sits in the line: every span here
 * must name exactly the text of its field, the message must be what ends
 * the line, and no two parts may overlap.
 */

function parse(raw: string): ParsedSyslogMessage {
  const parsed: ParsedSyslogMessage | null = parseSyslogMessage(raw);

  if (!parsed) {
    throw new Error(`Expected ${JSON.stringify(raw)} to parse`);
  }

  return parsed;
}

function text(line: string, span: SyslogTextSpan | undefined): unknown {
  return span === undefined ? undefined : line.slice(span.start, span.end);
}

// What each span names, beside the field it is the span of.
function partsOf(parsed: ParsedSyslogMessage): {
  named: Record<string, unknown>;
  fields: Record<string, unknown>;
} {
  const layout: SyslogLineLayout = parsed.layout as SyslogLineLayout;

  return {
    named: {
      hostname: text(parsed.raw, layout.hostname),
      appName: text(parsed.raw, layout.appName),
      procId: text(parsed.raw, layout.procId),
      msgId: text(parsed.raw, layout.msgId),
      structuredData: text(parsed.raw, layout.structuredData),
      message: text(parsed.raw, layout.message),
    },
    fields: {
      hostname: parsed.hostname,
      appName: parsed.appName,
      procId: parsed.procId,
      msgId: parsed.msgId,
      structuredData: parsed.structuredDataRaw,
      message: parsed.message,
    },
  };
}

function expectLayoutHolds(line: string): ParsedSyslogMessage {
  const parsed: ParsedSyslogMessage = parse(line);

  expect({ line, hasLayout: parsed.layout !== undefined }).toEqual({
    line,
    hasLayout: true,
  });

  const { named, fields } = partsOf(parsed);

  expect({ line, named }).toEqual({ line, named: fields });

  const layout: SyslogLineLayout = parsed.layout as SyslogLineLayout;

  // The message ends the line.
  expect({ line, end: layout.message.end }).toEqual({
    line,
    end: parsed.raw.length,
  });

  // No two parts overlap, and they are in the order the line writes them.
  const spans: Array<SyslogTextSpan> = [
    layout.hostname,
    layout.appName,
    layout.procId,
    layout.msgId,
    layout.structuredData,
    layout.message,
  ].filter((span: SyslogTextSpan | undefined): span is SyslogTextSpan => {
    return span !== undefined;
  });

  for (let index: number = 1; index < spans.length; index++) {
    expect({
      line,
      ordered: spans[index]!.start >= spans[index - 1]!.end,
    }).toEqual({ line, ordered: true });
  }

  return parsed;
}

describe("RFC 5424", () => {
  it("names the host, app, process id, message id, structured data and message", () => {
    const parsed: ParsedSyslogMessage = expectLayoutHolds(
      '<165>1 2026-11-16T10:11:12.003Z web-01 checkout 4711 ID47 [auth@1 password="hunter2"] {"token":"t-1"}',
    );

    expect(partsOf(parsed).named).toEqual({
      hostname: "web-01",
      appName: "checkout",
      procId: "4711",
      msgId: "ID47",
      structuredData: '[auth@1 password="hunter2"]',
      message: '{"token":"t-1"}',
    });
  });

  it.each([
    "<34>1 2023-01-01T00:00:00Z host app - - - plain message",
    "<34>1 - - - - - -",
    "<34>1 2023-01-01T00:00:00Z",
    "<34>1 2023-01-01T00:00:00Z host",
    '<165>1 2003-10-11T22:14:15.003Z host evntslog - ID47 [a@1 x="1"] [b@2 y="2"] after',
    '<165>1 2003-10-11T22:14:15.003Z host app - - [a@1 x="1" and then nothing',
    '<165>1 2003-10-11T22:14:15.003Z host app - - [a@1 x="1"]',
    "<165>1 2003-10-11T22:14:15.003Z host app - - \uFEFFwith a byte order mark",
    "<165>1 2003-10-11T22:14:15.003Z host app - - BOMhello",
    '<165>1 2003-10-11T22:14:15.003Z host app - - [a@1 x="\\"1\\]"]   spaced   message',
    "<165>1 2003-10-11T22:14:15.003Z host app 77 - -no space after the nil value",
    "<165>1 2003-10-11T22:14:15.003Z host host host host host host",
    "<165>1 2003-10-11T22:14:15.003Z a a a a [a] a",
    "<165>1 2003-10-11T22:14:15.003Z [a] [a] [a] [a] [a] [a]",
    "<165>2 NILVALUE host app - - - message\twith a tab",
  ])("%s", (line: string) => {
    expectLayoutHolds(line);
  });

  it("names the host that is written, not an earlier word that looks the same", () => {
    const parsed: ParsedSyslogMessage = expectLayoutHolds(
      "<165>1 2003-10-11T22:14:15.003Z 2003 2003 2003 2003 - 2003",
    );

    // "<165>1 " and the 24 characters of the timestamp come first.
    expect(parsed.layout?.hostname).toEqual({ start: 32, end: 36 });
    expect(parsed.layout?.appName).toEqual({ start: 37, end: 41 });
    expect(parsed.layout?.message).toEqual({ start: 54, end: 58 });
  });
});

describe("RFC 3164", () => {
  it.each([
    "<34>Oct 11 22:14:15 mymachine su: 'su root' failed for lonvick",
    "<34>Oct 11 22:14:15 mymachine su[123]: failed",
    "<34>Oct 11 22:14:15 mymachine su[ 123 ]: spaces inside the brackets",
    "<34>Oct 11 22:14:15 mymachine su[]: empty brackets",
    "<34>Oct 11 22:14:15 mymachine su[   ]: blank brackets",
    "<38>Oct 13 10:11:09 ap-lobby sshd[4321]: Failed password for root from 192.0.2.10 port 51234 ssh2",
    "<134>Oct 13 10:11:12 vlan: <Info> Port 1:12 link down",
    "<134>Oct 13 10:11:12 vlan[7]: <Info> Port 1:12 link down",
    "<14>Jan  7 20:22:55 10.1.1.5 00076 ports: port 3 is now on-line",
    '<134>Feb  5 17:32:18 fw-01 log_component="IPSec" con_name="HQ-Branch1" status="Terminated"',
    "<134>Feb  5 17:32:18 fw-01 CEF:0|Vendor|Product|1|100|name|5|src=10.0.0.1",
    "<134>Feb  5 17:32:18 CEF:0|Vendor|Product|1|100|name|5|src=10.0.0.1",
    "<13>Oct 11 22:14:15 host app[1][2] nested brackets",
    "<13>Oct 11 22:14:15 host app: ",
    "<13>Oct 11 22:14:15 host app:",
    "<13>Oct 11 22:14:15 host host host: host",
    "<13>Oct 11 22:14:15 host app: \uFEFFbom",
    "Oct 11 22:14:15 host app: no priority",
  ])("%s", (line: string) => {
    expectLayoutHolds(line);
  });

  it("names the tag's process id without the spaces the reading trims", () => {
    const parsed: ParsedSyslogMessage = expectLayoutHolds(
      "<34>Oct 11 22:14:15 mymachine su[ 123 ]: spaced",
    );

    expect(parsed.procId).toBe("123");
    expect(text(parsed.raw, parsed.layout?.procId)).toBe("123");
  });
});

describe("neither format", () => {
  it.each([
    "something went wrong",
    "<13>totally freeform text",
    '{"event":"login","password":"hunter2"}',
    "<13>   spaced",
    "[not structured data]",
    "<34>",
  ])("%s", (line: string) => {
    expectLayoutHolds(line);
  });
});

/*
 * Seeded, so a failure names the line that broke it: lines built from
 * random parts in every shape a header comes in, each read and held to
 * where its reading says its parts are.
 */
describe("any line", () => {
  const random: SeededRandom = seededRandom(39);

  function pick<T>(choices: ReadonlyArray<T>): T {
    return choices[Math.floor(random() * choices.length)]!;
  }

  const WORDS: ReadonlyArray<string> = [
    "web-01",
    "-",
    "app",
    "su:",
    "su[12]:",
    "a[1]",
    "[x]",
    "CEF:0|V|P|1|2|n|3|",
    "key=value",
    "2026",
    "10.0.0.1",
    "\u00e9t\u00e9",
    "BOM",
    "\uFEFF",
    '"q"',
    "x\\y",
  ];

  const VALUES: ReadonlyArray<string> = [
    "hunter2",
    "",
    'say "hi"',
    "C:\\path\\",
    "a]b",
    "[REDACTED]",
    "line\nbreak",
    "\u4e2d\u6587",
  ];

  function structuredData(): string {
    const elements: Array<string> = [];
    const count: number = 1 + Math.floor(random() * 3);

    for (let index: number = 0; index < count; index++) {
      const params: Array<string> = [];
      const paramCount: number = Math.floor(random() * 3);

      for (let param: number = 0; param < paramCount; param++) {
        const value: string = pick(VALUES);
        const written: string =
          random() < 0.7 ? escapeSyslogStructuredDataValue(value) : value;

        params.push(`${pick(["password", "user", "ip", "x"])}="${written}"`);
      }

      elements.push(
        `[${pick(["auth@1", "meta", "origin", "a.b"])}${params.length ? " " : ""}${params.join(" ")}]`,
      );
    }

    return elements.join(pick(["", " "]));
  }

  function message(): string {
    const words: Array<string> = [];
    const count: number = Math.floor(random() * 4);

    for (let index: number = 0; index < count; index++) {
      words.push(pick([...WORDS, "jane@example.com", '{"token":"t-1"}']));
    }

    return words.join(pick([" ", "  ", "\t"]));
  }

  function anyLine(): string {
    const priority: string = pick(["", "<13>", "<165>", "<0>", "<999>"]);
    const shape: number = Math.floor(random() * 3);

    if (shape === 0) {
      return `${priority}1 ${pick(["2026-11-16T10:11:12.003Z", "-"])} ${pick(WORDS)} ${pick(WORDS)} ${pick(WORDS)} ${pick(WORDS)} ${pick(["-", structuredData(), structuredData()])} ${message()}`;
    }

    if (shape === 1) {
      return `${priority}Oct ${pick(["11", " 7"])} 22:14:15 ${pick(WORDS)} ${pick(WORDS)} ${message()}`;
    }

    return `${priority}${message()}`;
  }

  it("names exactly the text of each part, the message last", () => {
    for (let round: number = 0; round < 3000; round++) {
      const line: string = anyLine();
      const parsed: ParsedSyslogMessage | null = parseSyslogMessage(line);

      if (parsed) {
        expectLayoutHolds(line);
      }
    }
  });
});
