import { describe, expect, test } from "@jest/globals";
import {
  MAX_WINDOWS_EVENT_FIELDS,
  MAX_WINDOWS_FIELD_VALUE_LENGTH,
  STRING_INSERT_FIELDS,
  WindowsEventRecord,
  decodeXmlText,
  readOtlpAnyValue,
  readWindowsEventRecord,
} from "../../../../Utils/SecurityEvent/LogParsers/WindowsEventRecord";
import { MAX_JSON_LINE_LENGTH } from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogLine";
import {
  NAMED_SHAPES,
  WindowsEventSpec,
  WindowsShape,
  collectorOtlpBody,
  failedSignIn,
  fluentBitBody,
  windowsEvent,
  xmlBody,
} from "./WindowsEventFixtures";

/*
 * Contract under test - one Windows event read into one record, whichever
 * shape it arrived in (WindowsEventRecord.readWindowsEventRecord).
 */

function read(body: string): WindowsEventRecord {
  const record: WindowsEventRecord | null = readWindowsEventRecord(body);

  if (!record) {
    throw new Error(`Expected a Windows event in ${body.slice(0, 80)}`);
  }

  return record;
}

describe("readWindowsEventRecord - the same record from every shape", () => {
  test.each(NAMED_SHAPES)(
    "%s",
    (_shape: WindowsShape, render: (spec: WindowsEventSpec) => string) => {
      const record: WindowsEventRecord = read(render(failedSignIn()));

      expect({
        eventId: record.eventId,
        provider: record.provider,
        channel: record.channel,
        computer: record.computer,
        recordId: record.recordId,
        targetUserName: record.data["TargetUserName"],
        ipAddress: record.data["IpAddress"],
        fields: Object.keys(record.data).length,
      }).toEqual({
        eventId: 4625,
        provider: "Microsoft-Windows-Security-Auditing",
        channel: "Security",
        computer: "WIN-01.corp.example",
        recordId: "81542",
        targetUserName: "alice",
        ipAddress: "203.0.113.7",
        fields: 21,
      });
    },
  );

  test("Fluent Bit's positional fields are named for the events that have names", () => {
    const record: WindowsEventRecord = read(fluentBitBody(failedSignIn()));

    STRING_INSERT_FIELDS["microsoft-windows-security-auditing:4625"]!.forEach(
      (name: string, index: number): void => {
        expect([name, record.data[name]]).toEqual([
          name,
          failedSignIn().data![index]![1],
        ]);
      },
    );
  });

  test("an unnamed field is param1, param2... in order", () => {
    const xml: string = xmlBody(
      windowsEvent(7040, "Service Control Manager", "System", []),
    ).replace(
      "<EventData></EventData>",
      "<EventData><Data>Spooler</Data><Data>auto start</Data><Data Name='x'>named</Data><Data>disabled</Data></EventData>",
    );
    const record: WindowsEventRecord = read(xml);

    expect(record.data).toEqual({
      param1: "Spooler",
      param2: "auto start",
      x: "named",
      param3: "disabled",
    });
  });

  test("an empty field written <Data Name='x'/> is empty", () => {
    const xml: string = xmlBody(
      windowsEvent(4625, "Microsoft-Windows-Security-Auditing", "Security", []),
    ).replace(
      "<EventData></EventData>",
      "<EventData><Data Name='Empty'/><Data Name=\"Quoted\">v</Data></EventData>",
    );

    expect(read(xml).data).toEqual({ Empty: "", Quoted: "v" });
  });

  test("the first of two fields with one name is kept", () => {
    const xml: string = xmlBody(
      windowsEvent(4625, "Microsoft-Windows-Security-Auditing", "Security", [
        ["TargetUserName", "first"],
        ["TargetUserName", "second"],
      ]),
    );

    expect(read(xml).data["TargetUserName"]).toBe("first");
  });

  test("a field named __proto__ never touches the record's prototype", () => {
    const record: WindowsEventRecord = read(
      collectorOtlpBody(
        windowsEvent(4625, "Microsoft-Windows-Security-Auditing", "Security", [
          ["__proto__", "polluted"],
          ["TargetUserName", "alice"],
        ]),
      ),
    );

    expect(Object.getPrototypeOf(record.data)).toBe(Object.prototype);
    expect(record.data["TargetUserName"]).toBe("alice");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  test(`keeps at most ${MAX_WINDOWS_EVENT_FIELDS} fields, each cut to ${MAX_WINDOWS_FIELD_VALUE_LENGTH} characters`, () => {
    const many: Array<[string, string]> = Array.from(
      { length: MAX_WINDOWS_EVENT_FIELDS + 50 },
      (_value: unknown, index: number): [string, string] => {
        return [`F${index}`, "v"];
      },
    );
    const record: WindowsEventRecord = read(
      collectorOtlpBody(
        windowsEvent(4625, "Microsoft-Windows-Security-Auditing", "Security", [
          ["Long", "x".repeat(MAX_WINDOWS_FIELD_VALUE_LENGTH + 10)],
          ...many,
        ]),
      ),
    );

    expect(Object.keys(record.data)).toHaveLength(MAX_WINDOWS_EVENT_FIELDS);
    expect(record.data["Long"]).toHaveLength(MAX_WINDOWS_FIELD_VALUE_LENGTH);
  });

  test("XML's level and keywords are read as written", () => {
    const record: WindowsEventRecord = read(
      xmlBody({ ...failedSignIn(), level: "Warning" }),
    );

    expect(record.level).toBe("3");
    expect(record.keywords).toBe("0x8010000000000000");
  });

  test("XML's rendered message is the event's message", () => {
    const xml: string = `${xmlBody(failedSignIn()).replace(
      "</Event>",
      "<RenderingInfo Culture='en-US'><Message>An account failed to log on.</Message><Level>Information</Level></RenderingInfo></Event>",
    )}`;

    expect(read(xml).message).toBe("An account failed to log on.");
  });
});

describe("readWindowsEventRecord - what is not a Windows event", () => {
  test.each([
    ["empty", ""],
    ["text", "An account failed to log on."],
    ["a JSON list", "[1,2]"],
    ["JSON that does not close", '{"EventID":4625,'],
    ["no provider", '{"EventID":4625,"Channel":"Security"}'],
    ["no id", '{"SourceName":"Microsoft-Windows-Security-Auditing"}'],
    ["an id that is not one", '{"EventID":0,"SourceName":"x"}'],
    ["an id too large", '{"EventID":65536,"SourceName":"x"}'],
    ["a negative id", '{"EventID":-4625,"SourceName":"x"}'],
    ["XML with no System", "<Event><EventData/></Event>"],
    [
      "XML with no EventID",
      "<Event><System><Provider Name='x'/></System></Event>",
    ],
    [
      "XML with no provider",
      "<Event><System><EventID>4625</EventID></System></Event>",
    ],
    ["a kvlist that is not a map", '{"kvlistValue":"x"}'],
    ["a collector map without an id", '{"event_id":{},"provider":{"name":"x"}}'],
  ])("%s", (_name: string, body: string) => {
    expect(readWindowsEventRecord(body)).toBeNull();
  });

  test("a body longer than a JSON line may be is not read", () => {
    const body: string = collectorOtlpBody(
      windowsEvent(4625, "Microsoft-Windows-Security-Auditing", "Security", [
        ["Padding", "x".repeat(MAX_JSON_LINE_LENGTH)],
      ]),
    );

    expect(readWindowsEventRecord(body)).toBeNull();
  });
});

describe("readOtlpAnyValue", () => {
  test("reads each kind of value, in either spelling", () => {
    expect(readOtlpAnyValue({ stringValue: "a" })).toBe("a");
    expect(readOtlpAnyValue({ string_value: "a" })).toBe("a");
    expect(readOtlpAnyValue({ intValue: "4625" })).toBe("4625");
    expect(readOtlpAnyValue({ int_value: 7 })).toBe("7");
    expect(readOtlpAnyValue({ doubleValue: 1.5 })).toBe("1.5");
    expect(readOtlpAnyValue({ boolValue: true })).toBe("true");
    expect(
      readOtlpAnyValue({
        kvlistValue: {
          values: [
            { key: "a", value: { stringValue: "1" } },
            { key: "b", value: { arrayValue: { values: [{ intValue: "2" }] } } },
          ],
        },
      }),
    ).toEqual({ a: "1", b: ["2"] });
  });

  test("protobuf's oneof name beside a value changes nothing", () => {
    expect(readOtlpAnyValue({ stringValue: "a", value: "stringValue" })).toBe(
      "a",
    );
  });

  test("is null for anything that is not a value", () => {
    for (const value of [null, undefined, "a", 1, [], {}]) {
      expect(readOtlpAnyValue(value)).toBeNull();
    }
  });

  test("stops following nested values eight deep", () => {
    let value: unknown = { stringValue: "deep" };

    for (let depth: number = 0; depth < 20; depth++) {
      value = { kvlistValue: { values: [{ key: "k", value }] } };
    }

    let read: unknown = readOtlpAnyValue(value);
    let depth: number = 0;

    while (read && typeof read === "object" && depth < 30) {
      read = (read as Record<string, unknown>)["k"];
      depth++;
    }

    expect(depth).toBeLessThanOrEqual(10);
    expect(read).toBeNull();
  });

  test("a key named __proto__ is skipped", () => {
    const value: unknown = readOtlpAnyValue({
      kvlistValue: {
        values: [
          { key: "__proto__", value: { stringValue: "polluted" } },
          { key: "a", value: { stringValue: "1" } },
        ],
      },
    });

    expect(value).toEqual({ a: "1" });
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  });
});

describe("decodeXmlText", () => {
  test("decodes the five named entities and numeric ones", () => {
    expect(decodeXmlText("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;")).toBe(
      "a & b <c> \"d\" 'e'",
    );
    expect(decodeXmlText("&#65;&#x42;&#X43;")).toBe("ABC");
  });

  test("keeps what is not an entity as written", () => {
    expect(decodeXmlText("a & b")).toBe("a & b");
    expect(decodeXmlText("&bogus;")).toBe("&bogus;");
    expect(decodeXmlText("&#0;&#x110000;")).toBe("&#0;&#x110000;");
    expect(decodeXmlText("& and a far ;")).toBe("& and a far ;");
    expect(decodeXmlText("text")).toBe("text");
  });
});
