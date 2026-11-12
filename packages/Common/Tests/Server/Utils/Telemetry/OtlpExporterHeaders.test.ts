import { describe, expect, test } from "@jest/globals";
import {
  describeUnreadableOtlpHeaders,
  NOTHING_EXPORTED_WITHOUT_A_HEADER,
  OTLP_EXPORTER_HEADERS_HELM_VALUE,
  OTLP_EXPORTER_HEADERS_SETTING,
  OtlpExporterHeaders,
  readOtlpExporterHeaders,
  UnreadableOtlpHeaderReason,
} from "../../../../Server/Utils/Telemetry/OtlpExporterHeaders";
import { redactLogString } from "../../../../Server/Utils/LogRedaction";

/*
 * OPENTELEMETRY_EXPORTER_OTLP_HEADERS is how an operator gives OneUptime's own
 * traces, metrics and logs their credentials. It used to be split at EVERY
 * '=', and a header was kept only when that gave two parts, so a Basic
 * Authorization value (base64 padding) or a token ending in '=' was dropped
 * without a word - and when it was the only header, Telemetry.init exported
 * nothing at all. These tests pin the reading: ';' between headers, the
 * FIRST '=' between a name and a value, and a report of what cannot be sent
 * that never repeats a name or a value from the setting.
 */

const BASIC_AUTHORIZATION: string = "Basic dXNlcjpwYXNzd29yZA==";

const read: (setting: string | undefined) => OtlpExporterHeaders = (
  setting: string | undefined,
): OtlpExporterHeaders => {
  return readOtlpExporterHeaders(setting);
};

describe("readOtlpExporterHeaders: what is sent", () => {
  test("keeps a value that ends in '=', as a Basic Authorization value does", () => {
    expect(read(`Authorization=${BASIC_AUTHORIZATION}`)).toEqual({
      headers: { Authorization: BASIC_AUTHORIZATION },
      written: 1,
      unreadable: [],
    });
  });

  test("keeps the issue's own example whole", () => {
    expect(read("Authorization=Basic abc==").headers).toEqual({
      Authorization: "Basic abc==",
    });
  });

  test("keeps a token that ends in a single '='", () => {
    expect(read("x-oneuptime-token=c2VjcmV0dG9rZW4=").headers).toEqual({
      "x-oneuptime-token": "c2VjcmV0dG9rZW4=",
    });
  });

  test("keeps a value with '=' in the middle, splitting at the first '=' only", () => {
    expect(read("x-api-key=a=b=c").headers).toEqual({
      "x-api-key": "a=b=c",
    });
  });

  test("keeps a value that starts with '='", () => {
    expect(read("x-api-key==abc").headers).toEqual({ "x-api-key": "=abc" });
  });

  test("reads two headers separated by ';'", () => {
    expect(read("a=1;b=2")).toEqual({
      headers: { a: "1", b: "2" },
      written: 2,
      unreadable: [],
    });
  });

  test("reads the page's own example, a OneUptime token and a second header", () => {
    expect(read("x-oneuptime-token=key;x-extra=1").headers).toEqual({
      "x-oneuptime-token": "key",
      "x-extra": "1",
    });
  });

  test("reads several headers that each hold '='", () => {
    expect(
      read(`Authorization=${BASIC_AUTHORIZATION};x-scope=tenant=eu==`).headers,
    ).toEqual({
      Authorization: BASIC_AUTHORIZATION,
      "x-scope": "tenant=eu==",
    });
  });

  test("skips a trailing ';' without counting or reporting it", () => {
    expect(read("a=1;")).toEqual({
      headers: { a: "1" },
      written: 1,
      unreadable: [],
    });
  });

  test("skips empty parts and parts of spaces anywhere", () => {
    expect(read(";a=1;;  ;\tb=2;")).toEqual({
      headers: { a: "1", b: "2" },
      written: 2,
      unreadable: [],
    });
  });

  test("trims spaces around the name and the value", () => {
    expect(read("  a  =  1  ;  b =2")).toEqual({
      headers: { a: "1", b: "2" },
      written: 2,
      unreadable: [],
    });
  });

  test("keeps spaces inside a value", () => {
    expect(read("Authorization = Bearer  abc ").headers).toEqual({
      Authorization: "Bearer  abc",
    });
  });

  test("trims a carriage return a file saved on Windows leaves at the end", () => {
    expect(read("x-oneuptime-token=key\r\n")).toEqual({
      headers: { "x-oneuptime-token": "key" },
      written: 1,
      unreadable: [],
    });
  });

  test("keeps the last value of a name written twice, as it always has", () => {
    expect(read("a=1;a=2").headers).toEqual({ a: "2" });
  });

  test("keeps every character an HTTP token allows in a name", () => {
    const name: string = "!#$%&'*+-.^_`|~09AZaz";

    expect(read(`${name}=1`).headers).toEqual({ [name]: "1" });
  });

  test("keeps a value with a tab and Latin-1 letters, which Node sends", () => {
    expect(read("x-note=caf\u00e9\tcr\u00e8me").headers).toEqual({
      "x-note": "caf\u00e9\tcr\u00e8me",
    });
  });

  test("reads nothing from an unset or empty setting", () => {
    const nothing: OtlpExporterHeaders = {
      headers: {},
      written: 0,
      unreadable: [],
    };

    expect(read(undefined)).toEqual(nothing);
    expect(read("")).toEqual(nothing);
    expect(read(";")).toEqual(nothing);
    expect(read("  ;  ")).toEqual(nothing);
  });
});

describe("readOtlpExporterHeaders: what is left out", () => {
  test("leaves out a part without '=', and says which and why", () => {
    expect(read("a=1;Authorization;b=2")).toEqual({
      headers: { a: "1", b: "2" },
      written: 3,
      unreadable: [
        { position: 2, reason: UnreadableOtlpHeaderReason.NoEqualsSign },
      ],
    });
  });

  test("leaves out a header written the HTTP way, with ':' and no '='", () => {
    expect(read("Authorization: Bearer abc").unreadable).toEqual([
      { position: 1, reason: UnreadableOtlpHeaderReason.NoEqualsSign },
    ]);
  });

  test("leaves out a part with nothing before its '='", () => {
    expect(read("=abc").unreadable).toEqual([
      { position: 1, reason: UnreadableOtlpHeaderReason.NoName },
    ]);
    expect(read("   =abc").unreadable).toEqual([
      { position: 1, reason: UnreadableOtlpHeaderReason.NoName },
    ]);
  });

  test("leaves out a name Node would refuse to send: a space or ':' in it", () => {
    expect(read(`Authorization: ${BASIC_AUTHORIZATION}`)).toEqual({
      headers: {},
      written: 1,
      unreadable: [
        { position: 1, reason: UnreadableOtlpHeaderReason.NameNotAllowed },
      ],
    });
    expect(read("x oneuptime token=key").unreadable).toEqual([
      { position: 1, reason: UnreadableOtlpHeaderReason.NameNotAllowed },
    ]);
  });

  test("leaves out a name with a character past ASCII", () => {
    expect(read("x-cl\u00e9=1").unreadable).toEqual([
      { position: 1, reason: UnreadableOtlpHeaderReason.NameNotAllowed },
    ]);
  });

  test("leaves out a part with nothing after its '='", () => {
    expect(read("x-oneuptime-token=")).toEqual({
      headers: {},
      written: 1,
      unreadable: [{ position: 1, reason: UnreadableOtlpHeaderReason.NoValue }],
    });
    expect(read("x-oneuptime-token=   ").unreadable).toEqual([
      { position: 1, reason: UnreadableOtlpHeaderReason.NoValue },
    ]);
  });

  test("leaves out a value ending in '=' written without its name, so a token is never sent as a name", () => {
    expect(read("dXNlcjpwYXNzd29yZA==")).toEqual({
      headers: {},
      written: 1,
      unreadable: [
        { position: 1, reason: UnreadableOtlpHeaderReason.OnlyEqualsSigns },
      ],
    });
    // One '=' of padding leaves no value at all: left out all the same.
    expect(read("c2VjcmV0dG9rZW4=").unreadable).toEqual([
      { position: 1, reason: UnreadableOtlpHeaderReason.NoValue },
    ]);
    expect(read("x-oneuptime-token= == ").unreadable).toEqual([
      { position: 1, reason: UnreadableOtlpHeaderReason.OnlyEqualsSigns },
    ]);
    expect(read("x-oneuptime-token===").unreadable).toEqual([
      { position: 1, reason: UnreadableOtlpHeaderReason.OnlyEqualsSigns },
    ]);
  });

  test("still sends a value that holds more than '='", () => {
    expect(read("x-api-key==a").headers).toEqual({ "x-api-key": "=a" });
    expect(read("x-api-key=a=").headers).toEqual({ "x-api-key": "a=" });
  });

  test("leaves out a value with a line break, a control character or DEL inside it", () => {
    for (const value of ["a\nb", "a\rb", "a\u0000b", "a\u001fb", "a\u007fb"]) {
      expect(read(`x-api-key=${value}`)).toEqual({
        headers: {},
        written: 1,
        unreadable: [
          { position: 1, reason: UnreadableOtlpHeaderReason.ValueNotAllowed },
        ],
      });
    }
  });

  test("leaves out a value with a character past Latin-1, which Node refuses", () => {
    expect(read("x-api-key=\u2713").unreadable).toEqual([
      { position: 1, reason: UnreadableOtlpHeaderReason.ValueNotAllowed },
    ]);
  });

  test("numbers each header among the ones written, not counting empty parts", () => {
    expect(read(";;a=1;;nope;;b=;c=3").unreadable).toEqual([
      { position: 2, reason: UnreadableOtlpHeaderReason.NoEqualsSign },
      { position: 3, reason: UnreadableOtlpHeaderReason.NoValue },
    ]);
  });

  test("keeps the readable headers around the ones it leaves out", () => {
    expect(read("first=1;=x;second=2;third").headers).toEqual({
      first: "1",
      second: "2",
    });
  });

  test("reports nothing when every header can be sent", () => {
    expect(read("a=1;b=2==;c= 3 ").unreadable).toEqual([]);
  });
});

describe("describeUnreadableOtlpHeaders", () => {
  test("says nothing when every header can be sent", () => {
    expect(describeUnreadableOtlpHeaders(read("a=1;b=2"))).toBeNull();
    expect(describeUnreadableOtlpHeaders(read(undefined))).toBeNull();
    expect(describeUnreadableOtlpHeaders(read(""))).toBeNull();
  });

  test("names the setting and the Helm value, the header's place and why it is not sent", () => {
    expect(describeUnreadableOtlpHeaders(read("a=1;secret-only;b=2"))).toBe(
      "OPENTELEMETRY_EXPORTER_OTLP_HEADERS (openTelemetryExporter.headers in the Helm chart): " +
        "OneUptime cannot read header 2 of 3, so it does not send it. " +
        "Header 2 has no '=' between a name and a value. " +
        "Write each header as name=value, and separate headers with ';'.",
    );
  });

  test("lists several headers in one line, each with its own reason", () => {
    expect(
      describeUnreadableOtlpHeaders(read("=a;Authorization: Basic x==;c=;d=1")),
    ).toBe(
      "OPENTELEMETRY_EXPORTER_OTLP_HEADERS (openTelemetryExporter.headers in the Helm chart): " +
        "OneUptime cannot read headers 1, 2 and 3 of 4, so it does not send them. " +
        "Header 1 has nothing before its first '='. " +
        "Header 2 has a name, before its first '=', with a character no header name may hold, such as a space or ':'. " +
        "Header 3 has nothing after its first '='. " +
        "Write each header as name=value, and separate headers with ';'.",
    );
  });

  test("joins two places with 'and'", () => {
    expect(describeUnreadableOtlpHeaders(read("a;b"))).toContain(
      "OneUptime cannot read headers 1 and 2 of 2, so it does not send them.",
    );
  });

  test("says why a token written without its name is not sent", () => {
    expect(describeUnreadableOtlpHeaders(read("abc=="))).toContain(
      "Header 1 has only '=' after its first '=', as a value ending in '=' does when it is written without a name.",
    );
  });

  test("says why a value cannot be sent", () => {
    expect(describeUnreadableOtlpHeaders(read("x-api-key=a\u0007b"))).toContain(
      "Header 1 has a value with a character no header value may hold, such as a line break.",
    );
  });

  test("has words for every reason", () => {
    const settings: Record<UnreadableOtlpHeaderReason, string> = {
      [UnreadableOtlpHeaderReason.NoEqualsSign]: "abc",
      [UnreadableOtlpHeaderReason.NoName]: "=abc",
      [UnreadableOtlpHeaderReason.NameNotAllowed]: "a b=c",
      [UnreadableOtlpHeaderReason.NoValue]: "abc=",
      [UnreadableOtlpHeaderReason.OnlyEqualsSigns]: "abc==",
      [UnreadableOtlpHeaderReason.ValueNotAllowed]: "abc=\u0001",
    };

    for (const reason of Object.values(UnreadableOtlpHeaderReason)) {
      const headers: OtlpExporterHeaders = read(settings[reason]);

      expect(headers.unreadable).toEqual([{ position: 1, reason }]);

      const line: string = describeUnreadableOtlpHeaders(headers) as string;

      // "Header 1 has <the reason>." and then the advice, every time.
      const reasonStart: number = line.indexOf("Header 1 has ");

      expect(reasonStart).toBeGreaterThan(0);
      expect(
        line.indexOf(
          ". Write each header as name=value",
          reasonStart + "Header 1 has ".length + 1,
        ),
      ).toBeGreaterThan(reasonStart);
      expect(line).not.toContain("undefined");
    }
  });

  /*
   * These headers hold credentials. A part OneUptime cannot read may be a
   * token pasted without its name, and a name it cannot read may hold the
   * credential after a ':', so nothing of the setting may reach a log line.
   */
  test("never repeats a name or a value from the setting", () => {
    const secrets: Array<string> = [
      "dXNlcjpwYXNzd29yZA",
      "sk-live-1234567890",
      "my-secret-token",
      "tenant-42",
      "x-custom-auth",
    ];

    const setting: string = [
      "dXNlcjpwYXNzd29yZA==",
      "Authorization: Basic sk-live-1234567890=",
      "x-custom-auth=",
      "=my-secret-token",
      "x-tenant=tenant-42\u0000",
      "x-oneuptime-token",
    ].join(";");

    const line: string = describeUnreadableOtlpHeaders(read(setting)) as string;

    expect(line).toContain(
      "OneUptime cannot read headers 1, 2, 3, 4, 5 and 6 of 6, so it does not send them.",
    );
    expect(line).toContain(
      "Header 1 has only '=' after its first '=', as a value ending in '=' does when it is written without a name.",
    );

    for (const secret of secrets) {
      expect(line).not.toContain(secret);
    }

    expect(line).not.toContain("Authorization");
    expect(line).not.toContain("x-oneuptime-token");
  });

  test("reaches the log as written: log redaction leaves the line alone", () => {
    const line: string = describeUnreadableOtlpHeaders(
      read("=a;Authorization: Basic x==;c=;d;e=\u0001"),
    ) as string;

    expect(redactLogString(line)).toBe(line);
  });
});

describe("NOTHING_EXPORTED_WITHOUT_A_HEADER", () => {
  test("says nothing is sent, which settings to look at, and what to write", () => {
    expect(NOTHING_EXPORTED_WITHOUT_A_HEADER).toBe(
      "OneUptime sends none of its own traces, metrics or logs: " +
        "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT is set, but " +
        "OPENTELEMETRY_EXPORTER_OTLP_HEADERS (openTelemetryExporter.headers in the Helm chart) " +
        "holds no header it can send, and it exports only with one. " +
        "Set at least one header, written as name=value, such as the x-oneuptime-token header with a Server ingestion key.",
    );
  });

  test("reaches the log as written: log redaction leaves the line alone", () => {
    expect(redactLogString(NOTHING_EXPORTED_WITHOUT_A_HEADER)).toBe(
      NOTHING_EXPORTED_WITHOUT_A_HEADER,
    );
  });

  test("names the setting and the Helm value this module reads", () => {
    expect(OTLP_EXPORTER_HEADERS_SETTING).toBe(
      "OPENTELEMETRY_EXPORTER_OTLP_HEADERS",
    );
    expect(OTLP_EXPORTER_HEADERS_HELM_VALUE).toBe(
      "openTelemetryExporter.headers",
    );
  });
});
