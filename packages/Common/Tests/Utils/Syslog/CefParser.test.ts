import {
  MAX_CEF_EXTENSIONS,
  MAX_CEF_INPUT_LENGTH,
  MAX_CEF_KEY_LENGTH,
  MAX_CEF_PREFIX_LENGTH,
  MAX_CEF_VALUE_LENGTH,
  ParsedCef,
  cefSeverityToSyslogSeverity,
  findCefStart,
  parseCef,
} from "../../../Utils/Syslog/CefParser";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test - the Common Event Format reader.
 *
 * CEF is what controllers and security products export their events in:
 * UniFi Network, MikroTik RouterOS, FortiGate. Seven header fields between
 * pipes, then key=value pairs whose values may hold spaces. The lines below
 * are the two vendors' own documented examples, the standard's, and the
 * shapes that go wrong: escapes, missing parts, pairs that are not pairs,
 * and text built to be as long or as slow as it can.
 */

function parse(text: string): ParsedCef {
  const parsed: ParsedCef | null = parseCef(text);

  if (!parsed) {
    throw new Error(`Expected ${JSON.stringify(text)} to parse as CEF`);
  }

  return parsed;
}

// The standard's own example (ArcSight CEF implementation standard).
const STANDARD_LINE: string =
  "Sep 19 08:26:10 host CEF:0|Security|threatmanager|1.0|100|worm successfully stopped|10|src=10.0.0.1 dst=2.1.2.2 spt=1232";

// Ubiquiti's (help.ui.com, UniFi System Logs & SIEM Integration).
const UNIFI_LINE: string =
  "CEF:0|Ubiquiti|UniFi Network|9.3.33|544|Admin Accessed UniFi Network|1|UNIFIcategory=System UNIFIsubCategory=Admin UNIFIhost=Office UDM Pro UNIFIaccessMethod=web UNIFIadmin=Craig src=105.5.138.59 msg=Craig accessed UniFi Network using the web. Source IP: 105.5.138.59";

// MikroTik's (manual.mikrotik.com, Log).
const MIKROTIK_LINE: string =
  "Oct  2 17:36:35 MikroTik CEF:0|MikroTik|hAP ax^2|7.25beta5|10|system,error,critical|High|dvchost=MikroTik dvc=192.168.88.36 msg=login failure for user guest from 192.168.88.17 via ssh app=ssh duser=guest outcome=failure src=192.168.88.17";

describe("parseCef - vendors' documented lines", () => {
  it("reads the standard's example, header and extension", () => {
    expect(parse(STANDARD_LINE)).toEqual({
      version: "0",
      deviceVendor: "Security",
      deviceProduct: "threatmanager",
      deviceVersion: "1.0",
      deviceEventClassId: "100",
      name: "worm successfully stopped",
      severity: "10",
      extensions: { src: "10.0.0.1", dst: "2.1.2.2", spt: "1232" },
    });
  });

  it("reads a UniFi line, whose values hold spaces without quotes", () => {
    const parsed: ParsedCef = parse(UNIFI_LINE);

    expect(parsed.deviceVendor).toBe("Ubiquiti");
    expect(parsed.deviceProduct).toBe("UniFi Network");
    expect(parsed.deviceVersion).toBe("9.3.33");
    expect(parsed.deviceEventClassId).toBe("544");
    expect(parsed.name).toBe("Admin Accessed UniFi Network");
    expect(parsed.severity).toBe("1");
    expect(parsed.extensions).toEqual({
      UNIFIcategory: "System",
      UNIFIsubCategory: "Admin",
      UNIFIhost: "Office UDM Pro",
      UNIFIaccessMethod: "web",
      UNIFIadmin: "Craig",
      src: "105.5.138.59",
      msg: "Craig accessed UniFi Network using the web. Source IP: 105.5.138.59",
    });
  });

  it("reads a RouterOS line, whose name is a list and whose severity is a word", () => {
    const parsed: ParsedCef = parse(MIKROTIK_LINE);

    expect(parsed.deviceVendor).toBe("MikroTik");
    expect(parsed.deviceProduct).toBe("hAP ax^2");
    expect(parsed.name).toBe("system,error,critical");
    expect(parsed.severity).toBe("High");
    expect(parsed.extensions).toEqual({
      dvchost: "MikroTik",
      dvc: "192.168.88.36",
      msg: "login failure for user guest from 192.168.88.17 via ssh",
      app: "ssh",
      duser: "guest",
      outcome: "failure",
      src: "192.168.88.17",
    });
  });

  it("keeps the pairs in the order the line has them", () => {
    expect(Object.keys(parse(MIKROTIK_LINE).extensions)).toEqual([
      "dvchost",
      "dvc",
      "msg",
      "app",
      "duser",
      "outcome",
      "src",
    ]);
  });
});

describe("findCefStart - where the message begins", () => {
  it("is 0 for a line that is all CEF", () => {
    expect(findCefStart("CEF:0|a|b|c|d|e|f|")).toBe(0);
  });

  it("is past a syslog header", () => {
    expect(findCefStart(STANDARD_LINE)).toBe(STANDARD_LINE.indexOf("CEF:0"));
  });

  it("is right after a syslog priority glued to it", () => {
    expect(findCefStart("<134>CEF:0|a|b|c|d|e|f|")).toBe(5);
  });

  it("takes version 1, and a two-digit version", () => {
    expect(findCefStart("CEF:1|a|b|c|d|e|f|")).toBe(0);
    expect(findCefStart("CEF:10|a|b|c|d|e|f|")).toBe(0);
  });

  it("is -1 for a line with no CEF in it", () => {
    for (const text of [
      "",
      "plain text",
      "CEF",
      "CEF:",
      "CEF:0",
      "CEF:x|a|b|c|d|e|f|",
      "CEF:|a|b|c|d|e|f|",
      "CEF:123|a|b|c|d|e|f|",
      "the word CEF: 0|a",
    ]) {
      expect({ text, start: findCefStart(text) }).toEqual({ text, start: -1 });
    }
  });

  it("does not read the letters inside another word", () => {
    expect(findCefStart("notCEF:0|a|b|c|d|e|f|")).toBe(-1);
    expect(findCefStart("x=CEF:0|a|b|c|d|e|f|")).toBe(-1);
  });

  it("passes a false start and finds the real one after it", () => {
    const line: string = "CEF: said the host CEF:0|a|b|c|d|e|f|";

    expect(findCefStart(line)).toBe(line.indexOf("CEF:0"));
  });

  it("only looks at the start of a line: a header, not the payload", () => {
    const farIn: string = `${"x".repeat(MAX_CEF_PREFIX_LENGTH + 1)} CEF:0|a|b|c|d|e|f|`;
    const justIn: string = `${"x".repeat(MAX_CEF_PREFIX_LENGTH - 1)} CEF:0|a|b|c|d|e|f|`;

    expect(findCefStart(farIn)).toBe(-1);
    expect(parseCef(farIn)).toBeNull();
    expect(findCefStart(justIn)).toBe(MAX_CEF_PREFIX_LENGTH);
  });

  it("answers -1 for anything that is not text", () => {
    for (const value of [null, undefined, 0, 12, {}, [], true]) {
      expect(findCefStart(value)).toBe(-1);
      expect(parseCef(value)).toBeNull();
    }
  });
});

describe("parseCef - the header", () => {
  it("trims the space around a field", () => {
    expect(parse("CEF:0| Vendor |Product| 1.0 |7|Name |5|").deviceVendor).toBe(
      "Vendor",
    );
    expect(parse("CEF:0| Vendor |Product| 1.0 |7|Name |5|").name).toBe("Name");
  });

  it("reads an escaped pipe as a pipe inside the field", () => {
    const parsed: ParsedCef = parse(
      "CEF:0|Vendor|Fire\\|Wall|1.0|7|detected a \\| in a packet|5|src=10.0.0.1",
    );

    expect(parsed.deviceProduct).toBe("Fire|Wall");
    expect(parsed.name).toBe("detected a | in a packet");
    expect(parsed.extensions).toEqual({ src: "10.0.0.1" });
  });

  it("reads an escaped backslash as one backslash", () => {
    expect(parse("CEF:0|Vendor|Product|1.0|7|path C:\\\\logs|5|").name).toBe(
      "path C:\\logs",
    );
  });

  it("an escaped backslash before a pipe does not escape the pipe", () => {
    const parsed: ParsedCef = parse("CEF:0|Vendor|Product\\\\|1.0|7|Name|5|");

    expect(parsed.deviceProduct).toBe("Product\\");
    expect(parsed.deviceVersion).toBe("1.0");
  });

  it("keeps any other backslash as written", () => {
    expect(parse("CEF:0|Vendor|Product|1.0|7|a\\b c|5|").name).toBe("a\\b c");
  });

  it("accepts empty header fields", () => {
    expect(parse("CEF:0||||||5|")).toEqual({
      version: "0",
      deviceVendor: "",
      deviceProduct: "",
      deviceVersion: "",
      deviceEventClassId: "",
      name: "",
      severity: "5",
      extensions: {},
    });
  });

  it("reads a line with no extension", () => {
    expect(parse("CEF:0|Vendor|Product|1.0|7|Name|5|").extensions).toEqual({});
  });

  it("reads a line that stops at the severity, with no seventh pipe", () => {
    const parsed: ParsedCef = parse("CEF:0|Vendor|Product|1.0|7|Name|5");

    expect(parsed.severity).toBe("5");
    expect(parsed.extensions).toEqual({});
  });

  it("is not CEF with fewer than seven fields", () => {
    for (const text of [
      "CEF:0|",
      "CEF:0|Vendor",
      "CEF:0|Vendor|Product|1.0|7|",
      "CEF:0|Vendor|Product|1.0|7",
    ]) {
      expect({ text, parsed: parseCef(text) }).toEqual({ text, parsed: null });
    }
  });

  it("a pipe in the extension belongs to the value it is in", () => {
    expect(
      parse("CEF:0|Vendor|Product|1.0|7|Name|5|msg=a | b cs1=x").extensions,
    ).toEqual({ msg: "a | b", cs1: "x" });
  });
});

describe("parseCef - the extension", () => {
  function extensions(extension: string): Record<string, string> {
    return parse(`CEF:0|Vendor|Product|1.0|7|Name|5|${extension}`).extensions;
  }

  it("a value runs to the next key, spaces and all", () => {
    expect(
      extensions("msg=the user signed in from the lobby suser=craig"),
    ).toEqual({ msg: "the user signed in from the lobby", suser: "craig" });
  });

  it("the last value runs to the end of the line", () => {
    expect(extensions("src=10.0.0.1 msg=ends with a full stop.")).toEqual({
      src: "10.0.0.1",
      msg: "ends with a full stop.",
    });
  });

  it("an escaped equals sign is part of the value, not a new pair", () => {
    expect(extensions("msg=a\\=b c\\=d src=10.0.0.1")).toEqual({
      msg: "a=b c=d",
      src: "10.0.0.1",
    });
  });

  it("an escaped backslash is one backslash", () => {
    expect(extensions("filePath=C:\\\\Windows\\\\System32 act=read")).toEqual({
      filePath: "C:\\Windows\\System32",
      act: "read",
    });
  });

  it("\\n and \\r are a line break and a carriage return", () => {
    expect(extensions("msg=line one\\nline two\\rend")).toEqual({
      msg: "line one\nline two\rend",
    });
  });

  it("keeps any other backslash as written", () => {
    expect(extensions("msg=a\\tb")).toEqual({ msg: "a\\tb" });
  });

  it("a word with no equals sign belongs to the value before it", () => {
    expect(extensions("msg=hello world again")).toEqual({
      msg: "hello world again",
    });
  });

  it("text before the first pair is not a pair", () => {
    expect(extensions("stray words src=10.0.0.1")).toEqual({
      src: "10.0.0.1",
    });
  });

  it("an equals sign in the middle of a word is not a new key", () => {
    // "b=c" does not start a word, so it stays in msg.
    expect(extensions("msg=a/b=c src=10.0.0.1")).toEqual({
      msg: "a/b=c",
      src: "10.0.0.1",
    });
  });

  it("an empty value is an empty string", () => {
    expect(extensions("suser= src=10.0.0.1 msg=")).toEqual({
      suser: "",
      src: "10.0.0.1",
      msg: "",
    });
  });

  it("keys may hold letters, digits, dots, underscores and hyphens", () => {
    expect(
      extensions("cs1Label=Rule ad.field_1=x device-id=7 UNIFIhost=udm"),
    ).toEqual({
      cs1Label: "Rule",
      "ad.field_1": "x",
      "device-id": "7",
      UNIFIhost: "udm",
    });
  });

  it("a key that repeats keeps its first value", () => {
    expect(extensions("src=10.0.0.1 src=10.0.0.2")).toEqual({
      src: "10.0.0.1",
    });
  });

  it("tabs and line breaks separate pairs like spaces", () => {
    expect(extensions("src=10.0.0.1\tdst=10.0.0.2\nspt=80")).toEqual({
      src: "10.0.0.1",
      dst: "10.0.0.2",
      spt: "80",
    });
  });

  it("never lets a pair named __proto__ touch the result's prototype", () => {
    const parsed: Record<string, string> = extensions(
      "__proto__=polluted constructor=kept src=10.0.0.1",
    );

    expect(Object.keys(parsed)).toEqual(["constructor", "src"]);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});

describe("parseCef - limits", () => {
  it("keeps at most MAX_CEF_EXTENSIONS pairs", () => {
    const pairs: Array<string> = [];

    for (let index: number = 0; index < MAX_CEF_EXTENSIONS + 50; index++) {
      pairs.push(`k${index}=${index}`);
    }

    const parsed: ParsedCef = parse(
      `CEF:0|Vendor|Product|1.0|7|Name|5|${pairs.join(" ")}`,
    );

    expect(Object.keys(parsed.extensions)).toHaveLength(MAX_CEF_EXTENSIONS);
    expect(parsed.extensions["k0"]).toBe("0");
    expect(parsed.extensions[`k${MAX_CEF_EXTENSIONS - 1}`]).toBe(
      String(MAX_CEF_EXTENSIONS - 1),
    );
    expect(parsed.extensions[`k${MAX_CEF_EXTENSIONS}`]).toBeUndefined();
  });

  it("skips a key longer than MAX_CEF_KEY_LENGTH and keeps the pairs around it", () => {
    const longKey: string = "k".repeat(MAX_CEF_KEY_LENGTH + 1);
    const parsed: ParsedCef = parse(
      `CEF:0|Vendor|Product|1.0|7|Name|5|src=10.0.0.1 ${longKey}=x dst=10.0.0.2`,
    );

    expect(parsed.extensions).toEqual({ src: "10.0.0.1", dst: "10.0.0.2" });
  });

  it("keeps a key of exactly MAX_CEF_KEY_LENGTH", () => {
    const key: string = "k".repeat(MAX_CEF_KEY_LENGTH);

    expect(
      parse(`CEF:0|Vendor|Product|1.0|7|Name|5|${key}=x`).extensions[key],
    ).toBe("x");
  });

  it("cuts a value longer than MAX_CEF_VALUE_LENGTH", () => {
    const parsed: ParsedCef = parse(
      `CEF:0|Vendor|Product|1.0|7|Name|5|msg=${"m".repeat(MAX_CEF_VALUE_LENGTH + 100)}`,
    );

    expect(parsed.extensions["msg"]).toHaveLength(MAX_CEF_VALUE_LENGTH);
  });

  it("never cuts a value in the middle of a surrogate pair", () => {
    const value: string = `${"m".repeat(MAX_CEF_VALUE_LENGTH - 1)}\u{1F600}tail`;
    const parsed: ParsedCef = parse(
      `CEF:0|Vendor|Product|1.0|7|Name|5|msg=${value}`,
    );

    expect(parsed.extensions["msg"]).toBe("m".repeat(MAX_CEF_VALUE_LENGTH - 1));
  });

  it("reads only the first MAX_CEF_INPUT_LENGTH characters of the message", () => {
    const early: string = "src=10.0.0.1 ";
    const filler: string = `msg=${"x".repeat(MAX_CEF_INPUT_LENGTH)} `;
    const parsed: ParsedCef = parse(
      `CEF:0|Vendor|Product|1.0|7|Name|5|${early}${filler}late=never`,
    );

    expect(parsed.extensions["src"]).toBe("10.0.0.1");
    expect(parsed.extensions["late"]).toBeUndefined();
  });

  it("reads megabytes built to be slow in a few milliseconds", () => {
    const shapes: Array<string> = [
      `CEF:0|${"|".repeat(2_000_000)}`,
      `CEF:0|a|b|c|d|e|f|${"k=v ".repeat(500_000)}`,
      `CEF:0|a|b|c|d|e|f|${"=".repeat(2_000_000)}`,
      `CEF:0|a|b|c|d|e|f|${"\\".repeat(2_000_000)}`,
      `CEF:0|a|b|c|d|e|f|${"a ".repeat(1_000_000)}`,
      `CEF:0|a|b|c|d|e|f|${"k".repeat(2_000_000)}=v`,
      `CEF:0|${"\\|".repeat(1_000_000)}`,
      "CEF:".repeat(500_000),
      `${"CEF:0 ".repeat(300_000)}`,
    ];

    for (const shape of shapes) {
      const startedAt: number = Date.now();

      parseCef(shape);

      expect({
        shape: shape.slice(0, 30),
        fast: Date.now() - startedAt < 250,
      }).toEqual({ shape: shape.slice(0, 30), fast: true });
    }
  });
});

describe("cefSeverityToSyslogSeverity", () => {
  it("maps the numbers 0 to 10 the way the standard groups them", () => {
    const expected: Record<string, number> = {
      "0": 6,
      "1": 6,
      "2": 6,
      "3": 6,
      "4": 4,
      "5": 4,
      "6": 4,
      "7": 3,
      "8": 3,
      "9": 2,
      "10": 2,
    };

    for (const level of Object.keys(expected)) {
      expect({ level, severity: cefSeverityToSyslogSeverity(level) }).toEqual({
        level,
        severity: expected[level],
      });
    }
  });

  it("maps the standard's words, in any case", () => {
    expect(cefSeverityToSyslogSeverity("Low")).toBe(6);
    expect(cefSeverityToSyslogSeverity("Medium")).toBe(4);
    expect(cefSeverityToSyslogSeverity("High")).toBe(3);
    expect(cefSeverityToSyslogSeverity("HIGH")).toBe(3);
    expect(cefSeverityToSyslogSeverity("Very-High")).toBe(2);
    expect(cefSeverityToSyslogSeverity(" very high ")).toBe(2);
  });

  it("says nothing for a severity it cannot read", () => {
    for (const value of ["", "11", "99", "-1", "Unknown", "urgent", "5.5"]) {
      expect({
        value,
        severity: cefSeverityToSyslogSeverity(value),
      }).toEqual({ value, severity: undefined });
    }

    for (const value of [null, undefined, 5, {}, []]) {
      expect(cefSeverityToSyslogSeverity(value)).toBeUndefined();
    }
  });
});
