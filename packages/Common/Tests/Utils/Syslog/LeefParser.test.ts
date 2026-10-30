import {
  MAX_LEEF_ATTRIBUTES,
  MAX_LEEF_INPUT_LENGTH,
  MAX_LEEF_KEY_LENGTH,
  MAX_LEEF_PREFIX_LENGTH,
  MAX_LEEF_VALUE_LENGTH,
  ParsedLeef,
  findLeefStart,
  parseLeef,
  readLeefDelimiter,
} from "../../../Utils/Syslog/LeefParser";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test - the Log Event Extended Format reader.
 *
 * LEEF is IBM QRadar's line format, which firewalls, proxies and endpoint
 * products send beside CEF. Five header fields between pipes (six in 2.0,
 * whose sixth names the separator), then key=value attributes. The lines
 * below are IBM's own documented examples and the vendors' shapes, then the
 * shapes that go wrong: escapes, missing parts, separators that are not
 * tabs, and text built to be as long or as slow as it can.
 */

function parse(text: string): ParsedLeef {
  const parsed: ParsedLeef | null = parseLeef(text);

  if (!parsed) {
    throw new Error(`Expected ${JSON.stringify(text)} to parse as LEEF`);
  }

  return parsed;
}

// IBM's LEEF 1.0 example (QRadar DSM guide, "LEEF event components").
const IBM_LEEF_1: string =
  "Jan 18 11:07:53 host LEEF:1.0|Microsoft|MSExchange|4.0 SP1|15345|src=10.50.1.1\tdst=2.10.20.20\tspt=1200";

// IBM's LEEF 2.0 example, with "^" as its separator.
const IBM_LEEF_2_CARET: string =
  "LEEF:2.0|Lancope|StealthWatch|1.0|41|^|src=10.0.1.8^dst=10.0.0.5^sev=5^srcPort=81^dstPort=21";

// LEEF 2.0 naming a tab by its code, as IBM's guide also shows.
const IBM_LEEF_2_HEX: string =
  "LEEF:2.0|Lancope|StealthWatch|1.0|41|x09|src=10.0.1.8\tdst=10.0.0.5\tsev=5";

// Zscaler NSS's web log in LEEF, its attributes tab-separated.
const ZSCALER_LINE: string =
  "<13>LEEF:1.0|Zscaler|NSSWeblog|5.7|Blocked|cat=Malicious Content\tdevTime=Oct 30 2026 10:00:00\tsrc=192.0.2.15\tdst=203.0.113.80\tusrName=alice@example.com\taction=Blocked\turl=evil.example/payload.exe\tsev=9";

describe("parseLeef - documented lines", () => {
  it("reads IBM's LEEF 1.0 example, header and tab-separated attributes", () => {
    expect(parse(IBM_LEEF_1)).toEqual({
      version: "1.0",
      vendor: "Microsoft",
      product: "MSExchange",
      productVersion: "4.0 SP1",
      eventId: "15345",
      delimiter: "\t",
      attributes: { src: "10.50.1.1", dst: "2.10.20.20", spt: "1200" },
    });
  });

  it("reads IBM's LEEF 2.0 example, separated by the caret its header names", () => {
    const parsed: ParsedLeef = parse(IBM_LEEF_2_CARET);

    expect(parsed.version).toBe("2.0");
    expect(parsed.delimiter).toBe("^");
    expect(parsed.eventId).toBe("41");
    expect(parsed.attributes).toEqual({
      src: "10.0.1.8",
      dst: "10.0.0.5",
      sev: "5",
      srcPort: "81",
      dstPort: "21",
    });
  });

  it("reads a separator named by its hex code", () => {
    const parsed: ParsedLeef = parse(IBM_LEEF_2_HEX);

    expect(parsed.delimiter).toBe("\t");
    expect(parsed.attributes).toEqual({
      src: "10.0.1.8",
      dst: "10.0.0.5",
      sev: "5",
    });
  });

  it("reads Zscaler's web log, whose values hold spaces", () => {
    const parsed: ParsedLeef = parse(ZSCALER_LINE);

    expect(parsed.vendor).toBe("Zscaler");
    expect(parsed.product).toBe("NSSWeblog");
    expect(parsed.eventId).toBe("Blocked");
    expect(parsed.attributes["cat"]).toBe("Malicious Content");
    expect(parsed.attributes["devTime"]).toBe("Oct 30 2026 10:00:00");
    expect(parsed.attributes["usrName"]).toBe("alice@example.com");
    expect(parsed.attributes["url"]).toBe("evil.example/payload.exe");
    expect(parsed.attributes["sev"]).toBe("9");
  });
});

describe("findLeefStart - where the message begins", () => {
  it("is 0 for a line that is all LEEF", () => {
    expect(findLeefStart(IBM_LEEF_2_CARET)).toBe(0);
  });

  it("is past a syslog header, and right after a priority glued to it", () => {
    expect(findLeefStart(IBM_LEEF_1)).toBe(IBM_LEEF_1.indexOf("LEEF:"));
    expect(findLeefStart(ZSCALER_LINE)).toBe(4);
  });

  it("is -1 for a line with no LEEF in it", () => {
    for (const line of [
      "",
      "LEEF:",
      "LEEF:|a|b",
      "LEEF:x.0|a|b|c|d|",
      "LEEF:1.0 a|b|c|d|",
      "CEF:0|a|b|c|d|e|f|",
      "just a line",
    ]) {
      expect({ line, start: findLeefStart(line) }).toEqual({
        line,
        start: -1,
      });
    }
  });

  it("does not read the letters inside another word", () => {
    expect(findLeefStart("xLEEF:1.0|a|b|c|d|")).toBe(-1);
  });

  it("passes a false start and finds the real one after it", () => {
    const line: string = "LEEF:none LEEF:1.0|a|b|c|d|k=v";

    expect(findLeefStart(line)).toBe(line.lastIndexOf("LEEF:"));
  });

  it("only looks at the start of a line: a header, not the payload", () => {
    const farIn: string = `${"x".repeat(MAX_LEEF_PREFIX_LENGTH + 1)} LEEF:1.0|a|b|c|d|`;
    const justIn: string = `${"x".repeat(MAX_LEEF_PREFIX_LENGTH - 1)} LEEF:1.0|a|b|c|d|`;

    expect(findLeefStart(farIn)).toBe(-1);
    expect(findLeefStart(justIn)).toBe(MAX_LEEF_PREFIX_LENGTH);
  });

  it("answers -1 for anything that is not text", () => {
    for (const value of [null, undefined, 1, {}, []]) {
      expect(findLeefStart(value)).toBe(-1);
    }
  });
});

describe("parseLeef - the header", () => {
  it("trims the space around a field", () => {
    expect(parse("LEEF:1.0| Vendor | Product | 1 | 7 |k=v").vendor).toBe(
      "Vendor",
    );
  });

  it("reads an escaped pipe and an escaped backslash inside a field", () => {
    const parsed: ParsedLeef = parse("LEEF:1.0|Ven\\|dor|Pro\\\\duct|1|7|k=v");

    expect(parsed.vendor).toBe("Ven|dor");
    expect(parsed.product).toBe("Pro\\duct");
  });

  it("is not LEEF when the header stops short", () => {
    for (const line of [
      "LEEF:1.0|Vendor|Product|1",
      "LEEF:1.0|Vendor|Product|1|7",
      "LEEF:2.0|Vendor|Product|1|7|",
    ]) {
      expect({ line, parsed: parseLeef(line) }).toEqual({ line, parsed: null });
    }
  });

  it("reads a line whose attributes are empty", () => {
    expect(parse("LEEF:1.0|Vendor|Product|1|7|").attributes).toEqual({});
    expect(parse("LEEF:2.0|Vendor|Product|1|7|^|").attributes).toEqual({});
  });
});

describe("parseLeef - the attributes", () => {
  it("a tab-separated value keeps its spaces", () => {
    expect(
      parse("LEEF:1.0|V|P|1|7|msg=two words here\tsrc=192.0.2.1").attributes,
    ).toEqual({ msg: "two words here", src: "192.0.2.1" });
  });

  it("a 1.0 line with no tab separates its pairs with spaces, as CEF does", () => {
    expect(
      parse(
        "LEEF:1.0|V|P|1|7|src=192.0.2.1 dst=198.51.100.2 msg=a long message usrName=bob",
      ).attributes,
    ).toEqual({
      src: "192.0.2.1",
      dst: "198.51.100.2",
      msg: "a long message",
      usrName: "bob",
    });
  });

  it("an equals sign inside a delimited value belongs to the value", () => {
    expect(parse("LEEF:2.0|V|P|1|7|^|url=/a?b=c^k=v").attributes).toEqual({
      url: "/a?b=c",
      k: "v",
    });
  });

  it("a part without an equals sign is skipped", () => {
    expect(parse("LEEF:2.0|V|P|1|7|^|nothing^k=v^=novalue").attributes).toEqual(
      { k: "v" },
    );
  });

  it("a key that repeats keeps its first value", () => {
    expect(parse("LEEF:2.0|V|P|1|7|^|k=first^k=second").attributes).toEqual({
      k: "first",
    });
  });

  it("never lets an attribute named __proto__ touch the result's prototype", () => {
    const parsed: ParsedLeef = parse(
      "LEEF:2.0|V|P|1|7|^|__proto__=polluted^k=v",
    );

    expect(Object.getPrototypeOf(parsed.attributes)).toBe(Object.prototype);
    expect(parsed.attributes).toEqual({ k: "v" });
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});

describe("readLeefDelimiter", () => {
  it("takes one character as written", () => {
    expect(readLeefDelimiter("^")).toBe("^");
    expect(readLeefDelimiter("|")).toBe("|");
    expect(readLeefDelimiter(" ")).toBe(" ");
  });

  it("reads a character code in hex, with x or 0x before it", () => {
    expect(readLeefDelimiter("x09")).toBe("\t");
    expect(readLeefDelimiter("0x09")).toBe("\t");
    expect(readLeefDelimiter("X5E")).toBe("^");
    expect(readLeefDelimiter("0x7C")).toBe("|");
  });

  it("is a tab for anything else: empty, unreadable or a line break", () => {
    for (const field of ["", "xZZ", "0x", "tab", "x0a", "0x0D", "x123456"]) {
      expect({ field, delimiter: readLeefDelimiter(field) }).toEqual({
        field,
        delimiter: "\t",
      });
    }
  });
});

describe("parseLeef - limits", () => {
  it("keeps at most MAX_LEEF_ATTRIBUTES attributes", () => {
    const pairs: Array<string> = [];

    for (let index: number = 0; index < MAX_LEEF_ATTRIBUTES + 20; index++) {
      pairs.push(`k${index}=v`);
    }

    const parsed: ParsedLeef = parse(`LEEF:1.0|V|P|1|7|${pairs.join("\t")}`);

    expect(Object.keys(parsed.attributes)).toHaveLength(MAX_LEEF_ATTRIBUTES);
  });

  it("skips a key longer than MAX_LEEF_KEY_LENGTH and keeps the pairs around it", () => {
    const longKey: string = "k".repeat(MAX_LEEF_KEY_LENGTH + 1);
    const parsed: ParsedLeef = parse(`LEEF:1.0|V|P|1|7|a=1\t${longKey}=2\tb=3`);

    expect(parsed.attributes).toEqual({ a: "1", b: "3" });
  });

  it("cuts a value longer than MAX_LEEF_VALUE_LENGTH, never inside a surrogate pair", () => {
    const value: string = `${"m".repeat(MAX_LEEF_VALUE_LENGTH - 1)}\u{1F600}tail`;
    const parsed: ParsedLeef = parse(`LEEF:1.0|V|P|1|7|msg=${value}`);

    expect(parsed.attributes["msg"]).toBe(
      "m".repeat(MAX_LEEF_VALUE_LENGTH - 1),
    );
  });

  it("reads only the first MAX_LEEF_INPUT_LENGTH characters of the message", () => {
    const parsed: ParsedLeef = parse(
      `LEEF:1.0|V|P|1|7|src=192.0.2.1\tmsg=${"x".repeat(MAX_LEEF_INPUT_LENGTH)}\tlate=never`,
    );

    expect(parsed.attributes["src"]).toBe("192.0.2.1");
    expect(parsed.attributes["late"]).toBeUndefined();
  });

  /*
   * Lines whoever reaches the syslog port can send: the time to read one
   * must grow in line with it. 400,000 characters of each worst shape.
   */
  const LENGTH: number = 400000;
  const SLOW_SHAPES: Array<[string, string]> = [
    ["only pipes", `LEEF:1.0|${"|".repeat(LENGTH)}`],
    ["only backslashes", `LEEF:1.0|${"\\".repeat(LENGTH)}`],
    ["many tab pairs", `LEEF:1.0|a|b|c|d|${"k=v\t".repeat(LENGTH / 4)}`],
    ["many caret parts", `LEEF:2.0|a|b|c|d|^|${"^".repeat(LENGTH)}`],
    ["many space pairs", `LEEF:1.0|a|b|c|d|${"k=v ".repeat(LENGTH / 4)}`],
    ["equals signs", `LEEF:1.0|a|b|c|d|${"=".repeat(LENGTH)}`],
    ["one endless key", `LEEF:1.0|a|b|c|d|${"k".repeat(LENGTH)}=v`],
    ["false starts", "LEEF:".repeat(LENGTH / 5)],
  ];

  it.each(SLOW_SHAPES)(
    "reads %s in time that grows with the line",
    (_name: string, line: string) => {
      const run: FastestRun<ParsedLeef | null> = fastestRun({
        run: (): ParsedLeef | null => {
          return parseLeef(line);
        },
        limitInMs: 2000,
      });

      expect(run.inMs).toBeLessThan(2000);
    },
  );
});
