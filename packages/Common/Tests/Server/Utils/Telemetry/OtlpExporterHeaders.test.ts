import { describe, expect, test } from "@jest/globals";
import { parseKeyPairsIntoRecord } from "@opentelemetry/core";
import {
  describeSignalsExportedWithoutAHeader,
  describeUnreadableOtlpHeaders,
  hasOtlpHeadersFor,
  NOTHING_EXPORTED_WITHOUT_A_HEADER,
  OTEL_EXPORTER_OTLP_HEADERS_SETTING,
  otelSignalHeadersSetting,
  OTLP_EXPORTER_HEADERS_HELM_VALUE,
  OTLP_EXPORTER_HEADERS_SETTING,
  OTLP_SIGNALS,
  OtlpExporterHeaders,
  OtlpSignal,
  readOtlpExporterHeaders,
  readStandardOtlpHeaders,
  readStandardOtlpSignalHeaders,
  UnreadableOtlpHeaderReason,
} from "../../../../Server/Utils/Telemetry/OtlpExporterHeaders";
import { redactLogString } from "../../../../Server/Utils/LogRedaction";

/*
 * OPENTELEMETRY_EXPORTER_OTLP_HEADERS is how an operator gives OneUptime's own
 * traces, metrics and logs their credentials. It used to be split at EVERY
 * '=', and a header was kept only when that gave two parts, so a Basic
 * Authorization value (base64 padding) or a token ending in '=' was dropped
 * without a word - and when it was the only header, Telemetry.init exported
 * nothing at all. These tests pin the reading: ';' between headers, or ','
 * as the standard OTEL_EXPORTER_OTLP_HEADERS writes them, with its
 * percent-encoded values decoded (issue #7162); the FIRST '=' between a name
 * and a value; and a report of what cannot be sent that never repeats a name
 * or a value from the setting.
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
    expect(read(",")).toEqual(nothing);
    expect(read(" , ,")).toEqual(nothing);
  });
});

/*
 * The standard form (issue #7162): OTEL_EXPORTER_OTLP_HEADERS separates
 * headers with ',' and percent-encodes their values, and it is what a
 * backend's setup guide gives an operator to copy. Read with ';' only,
 * "x-a=1,x-b=2" was one header x-a whose value was "1,x-b=2".
 */
describe("readOtlpExporterHeaders: ',' between headers, as OTEL_EXPORTER_OTLP_HEADERS writes them", () => {
  test("'a=1,b=2' gives two headers", () => {
    expect(read("a=1,b=2")).toEqual({
      headers: { a: "1", b: "2" },
      written: 2,
      unreadable: [],
    });
  });

  test("the issue's own example is two headers, not one whose value holds the other", () => {
    expect(read("x-a=1,x-b=2").headers).toEqual({ "x-a": "1", "x-b": "2" });
  });

  test("reads a OneUptime token and a second header, separated the standard way", () => {
    expect(read("x-oneuptime-token=key,x-extra=1").headers).toEqual({
      "x-oneuptime-token": "key",
      "x-extra": "1",
    });
  });

  test("decodes a percent-encoded space, as a backend's guide writes an Authorization value", () => {
    expect(read("Authorization=Basic%20dXNlcjpwYXNzd29yZA==")).toEqual({
      headers: { Authorization: BASIC_AUTHORIZATION },
      written: 1,
      unreadable: [],
    });
    expect(
      read("Authorization=Bearer%20sk-live-123,X-Scope-OrgID=tenant-1").headers,
    ).toEqual({
      Authorization: "Bearer sk-live-123",
      "X-Scope-OrgID": "tenant-1",
    });
  });

  test("keeps a value that ends in '=', or holds '=', splitting each header at its first '='", () => {
    expect(
      read(`Authorization=${BASIC_AUTHORIZATION},x-scope=tenant=eu==`).headers,
    ).toEqual({ Authorization: BASIC_AUTHORIZATION, "x-scope": "tenant=eu==" });
    expect(read("x-a=b%3Dc,x-b=1").headers).toEqual({
      "x-a": "b=c",
      "x-b": "1",
    });
  });

  test("decodes a ',' or a ';' a value holds, which the standard form can only hold encoded", () => {
    expect(read("x-list=a%2Cb,x-other=1").headers).toEqual({
      "x-list": "a,b",
      "x-other": "1",
    });
    expect(read("x-a=1%3B2,x-b=3").headers).toEqual({
      "x-a": "1;2",
      "x-b": "3",
    });
  });

  test("decodes octets as UTF-8, to a character Node sends", () => {
    expect(read("x-note=caf%C3%A9,x-b=1").headers).toEqual({
      "x-note": "café",
      "x-b": "1",
    });
    expect(read("x-a=%7e%7E").headers).toEqual({ "x-a": "~~" });
  });

  test("keeps a '%' that does not start two hex digits as written", () => {
    expect(read("x-note=100%,x-b=1").headers).toEqual({
      "x-note": "100%",
      "x-b": "1",
    });
    expect(read("x-a=50%2,x-b=%zz").headers).toEqual({
      "x-a": "50%2",
      "x-b": "%zz",
    });
    expect(read("x-a=50%25%").headers).toEqual({ "x-a": "50%%" });
  });

  test("leaves '+' as it is: percent-encoding, not a form's encoding", () => {
    expect(read("x-a=a+b,x-b=1").headers).toEqual({ "x-a": "a+b", "x-b": "1" });
  });

  test("decodes only the value: a name is an HTTP token, and '%' is one of its characters", () => {
    expect(read("x%2Dtoken=1,x-b=2").headers).toEqual({
      "x%2Dtoken": "1",
      "x-b": "2",
    });
  });

  test("trims spaces around the commas, the names and the values", () => {
    expect(read(" a = 1 , b=2 ")).toEqual({
      headers: { a: "1", b: "2" },
      written: 2,
      unreadable: [],
    });
  });

  test("skips empty parts and a trailing ',' without counting or reporting them", () => {
    expect(read(",a=1,,b=2,")).toEqual({
      headers: { a: "1", b: "2" },
      written: 2,
      unreadable: [],
    });
    // Read with ';' only, this token was sent as "key," and refused.
    expect(read("x-oneuptime-token=key,").headers).toEqual({
      "x-oneuptime-token": "key",
    });
  });

  test("keeps the last value of a name written twice", () => {
    expect(read("a=1,a=2").headers).toEqual({ a: "2" });
  });

  test("reports a header it cannot send by its place among the comma-separated ones", () => {
    expect(read("a=1,b==,c=3")).toEqual({
      headers: { a: "1", c: "3" },
      written: 3,
      unreadable: [
        { position: 2, reason: UnreadableOtlpHeaderReason.OnlyEqualsSigns },
      ],
    });
    expect(read("a=1,b=x\u0001,c=3").unreadable).toEqual([
      { position: 2, reason: UnreadableOtlpHeaderReason.ValueNotAllowed },
    ]);
  });

  test("leaves out a value whose decoding no header may hold: a line break, a character past Latin-1, octets that are not UTF-8", () => {
    for (const encoded of [
      "1%0A2",
      "1%0d2",
      "%00",
      "%E2%9C%93",
      "%FF",
      "%C3",
    ]) {
      expect(read(`x-a=${encoded},x-b=1`)).toEqual({
        headers: { "x-b": "1" },
        written: 2,
        unreadable: [
          { position: 1, reason: UnreadableOtlpHeaderReason.ValueNotAllowed },
        ],
      });
    }
  });

  /*
   * The OpenTelemetry SDK's own reading of OTEL_EXPORTER_OTLP_HEADERS
   * (@opentelemetry/core's parseKeyPairsIntoRecord, which the OTLP
   * exporters OneUptime builds call): for a setting written the standard
   * way, OneUptime sends what an exporter reading it from that variable
   * would.
   */
  test.each([
    "api-key=key,other-config-value=value",
    "Authorization=Basic%20dXNlcjpwYXNzd29yZA==",
    "Authorization=Bearer%20sk-live-123,X-Scope-OrgID=tenant-1",
    "x-oneuptime-token=0f8fad5b-d9cb-469f-a165-70867728950e,x-extra=1",
    "x-list=a%2Cb,x-semi=1%3B2,x-eq=b%3Dc",
    " a = 1 , b=2 ",
    "x-note=caf%C3%A9,a=1,a=2",
    "x-scope=tenant=eu==,x-b=1",
  ])(
    "reads %p as the OpenTelemetry SDK reads OTEL_EXPORTER_OTLP_HEADERS",
    (setting: string) => {
      const sdk: Record<string, string> = parseKeyPairsIntoRecord(setting);

      expect(Object.keys(sdk).length).toBeGreaterThan(0);
      expect(read(setting)).toEqual({
        headers: sdk,
        written: setting.split(",").length,
        unreadable: [],
      });
    },
  );
});

describe("readOtlpExporterHeaders: ';' between headers, OneUptime's own form, reads as it always has", () => {
  test("'a=1;b=2' is unchanged", () => {
    expect(read("a=1;b=2")).toEqual({
      headers: { a: "1", b: "2" },
      written: 2,
      unreadable: [],
    });
  });

  test("a value is sent as written, its '%' included", () => {
    expect(read("Authorization=Basic%20abc;x-b=1").headers).toEqual({
      Authorization: "Basic%20abc",
      "x-b": "1",
    });
  });

  test("a ';' at the end keeps one header as written", () => {
    expect(read("x-signature=abc%2Bdef%3D;").headers).toEqual({
      "x-signature": "abc%2Bdef%3D",
    });
    expect(read("x-filter=a=1,b=2;").headers).toEqual({
      "x-filter": "a=1,b=2",
    });
  });

  test("a value may hold ',' between ';'-separated headers", () => {
    expect(read("x-list=a,b;x-other=1").headers).toEqual({
      "x-list": "a,b",
      "x-other": "1",
    });
  });

  test("';' and ',' together are read as ';'", () => {
    expect(read("a=1,b=2;c=3")).toEqual({
      headers: { a: "1,b=2", c: "3" },
      written: 2,
      unreadable: [],
    });
  });
});

/*
 * A setting with no ';' is read the standard way only when every part
 * between its commas is a header. Otherwise its commas are part of one
 * header's value, as before: a setting that worked keeps working.
 */
describe("readOtlpExporterHeaders: one header whose value holds ',' stays one header", () => {
  test("'x-list=a,b' stays one header: 'b' is not a header", () => {
    expect(read("x-list=a,b")).toEqual({
      headers: { "x-list": "a,b" },
      written: 1,
      unreadable: [],
    });
  });

  test("'a=1,b' stays one header", () => {
    expect(read("a=1,b").headers).toEqual({ a: "1,b" });
  });

  test("a value of JSON stays one header", () => {
    expect(read('x-tenant={"region": "eu", "tier": 1}').headers).toEqual({
      "x-tenant": '{"region": "eu", "tier": 1}',
    });
  });

  test("so does one with a part that has no name, a name no header may have, or no value", () => {
    expect(read("a=1,=b").headers).toEqual({ a: "1,=b" });
    expect(read("a=1, b c=2").headers).toEqual({ a: "1, b c=2" });
    expect(read("x-a=1,x-b=").headers).toEqual({ "x-a": "1,x-b=" });
  });

  test("and its value is sent as written, its '%' included", () => {
    expect(read("x-list=a%20b,c").headers).toEqual({ "x-list": "a%20b,c" });
  });

  test("'Authorization=Basic x==' is unchanged", () => {
    expect(read("Authorization=Basic x==")).toEqual({
      headers: { Authorization: "Basic x==" },
      written: 1,
      unreadable: [],
    });
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
        "Write each header as name=value, and separate headers with ';' (or ',' as in OTEL_EXPORTER_OTLP_HEADERS).",
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
        "Write each header as name=value, and separate headers with ';' (or ',' as in OTEL_EXPORTER_OTLP_HEADERS).",
    );
  });

  test("joins two places with 'and'", () => {
    expect(describeUnreadableOtlpHeaders(read("a;b"))).toContain(
      "OneUptime cannot read headers 1 and 2 of 2, so it does not send them.",
    );
  });

  test("counts places among the comma-separated headers of a setting written the standard way, and says ',' may separate them", () => {
    expect(describeUnreadableOtlpHeaders(read("a=1,b==,c=%0A"))).toBe(
      "OPENTELEMETRY_EXPORTER_OTLP_HEADERS (openTelemetryExporter.headers in the Helm chart): " +
        "OneUptime cannot read headers 2 and 3 of 3, so it does not send them. " +
        "Header 2 has only '=' after its first '=', as a value ending in '=' does when it is written without a name. " +
        "Header 3 has a value with a character no header value may hold, such as a line break. " +
        "Write each header as name=value, and separate headers with ';' (or ',' as in OTEL_EXPORTER_OTLP_HEADERS).",
    );
  });

  test("names the standard variable whose form it reads", () => {
    expect(OTEL_EXPORTER_OTLP_HEADERS_SETTING).toBe(
      "OTEL_EXPORTER_OTLP_HEADERS",
    );
    expect(describeUnreadableOtlpHeaders(read("a;b"))).toContain(
      `(or ',' as in ${OTEL_EXPORTER_OTLP_HEADERS_SETTING})`,
    );
  });

  test("never repeats a name, a value or a value's encoding from a setting written the standard way", () => {
    const setting: string = [
      "Authorization=Basic%20c2VjcmV0LXRva2Vu",
      "x-tenant=tenant-42%0A",
      "x-mark=%E2%9C%93sk-live-0123",
      "x-oneuptime-token==",
    ].join(",");

    const line: string = describeUnreadableOtlpHeaders(read(setting)) as string;

    expect(line).toContain(
      "OneUptime cannot read headers 2, 3 and 4 of 4, so it does not send them.",
    );

    for (const secret of [
      "c2VjcmV0LXRva2Vu",
      "tenant-42",
      "sk-live-0123",
      "%0A",
      "%E2%9C%93",
      "✓",
      "x-tenant",
      "x-mark",
      "x-oneuptime-token",
      "Authorization",
    ]) {
      expect(line).not.toContain(secret);
    }
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
        "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT is set, but neither " +
        "OPENTELEMETRY_EXPORTER_OTLP_HEADERS (openTelemetryExporter.headers in the Helm chart) " +
        "nor OTEL_EXPORTER_OTLP_HEADERS holds a header it can send, and it exports only with one. " +
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

/*
 * Issue #8884: the OTLP exporters read OTEL_EXPORTER_OTLP_HEADERS and
 * OTEL_EXPORTER_OTLP_<SIGNAL>_HEADERS on their own, with @opentelemetry/core's
 * parseKeyPairsIntoRecord, and OneUptime decides whether an exporter has a
 * header to send, and the profiler's token, from what they read.
 * readStandardOtlpHeaders is that reading, held here to the SDK's own.
 */
describe("readStandardOtlpHeaders: OTEL_EXPORTER_OTLP_HEADERS as the OTLP exporters read it", () => {
  test.each([
    undefined,
    "",
    " ",
    ",",
    " , , ",
    "a=1",
    "a=1,b=2",
    " a = 1 , b=2 ",
    "x-oneuptime-token=0f8fad5b-d9cb-469f-a165-70867728950e",
    "Authorization=Basic%20dXNlcjpwYXNzd29yZA==",
    "Authorization=Bearer%20sk-live-123,X-Scope-OrgID=tenant-1",
    "x-list=a%2Cb,x-semi=1%3B2,x-eq=b%3Dc",
    "x-note=caf%C3%A9,a=1,a=2",
    "x-scope=tenant=eu==,x-b=1",
    // What OneUptime's own form writes: the SDK leaves out what follows ';'.
    "a=1;b=2",
    "x-oneuptime-token=abc;",
    "a=1;metadata,b=2",
    // Headers it leaves out.
    "=1",
    "a=",
    "a= ",
    " =1",
    "a",
    "a%=1",
    "a=%",
    "a=%E0%A4%A",
    "a=%20",
    "%61=1",
    "a b=1",
    "Authorization: Bearer the-secret",
    "x-a=1,,x-b=2,",
  ])("reads %p as parseKeyPairsIntoRecord does", (setting?: string) => {
    expect(readStandardOtlpHeaders(setting)).toEqual(
      parseKeyPairsIntoRecord(setting),
    );
  });

  test("the corpus holds headers it reads and headers it leaves out", () => {
    expect(readStandardOtlpHeaders("a=1;b=2")).toEqual({ a: "1" });
    expect(readStandardOtlpHeaders("a=%E0%A4%A")).toEqual({});
    expect(readStandardOtlpHeaders("%61=1")).toEqual({ a: "1" });
  });
});

describe("readStandardOtlpSignalHeaders: one exporter's headers from the environment", () => {
  test("OTEL_EXPORTER_OTLP_HEADERS for every signal, the signal's own variable over it", () => {
    const environment: NodeJS.ProcessEnv = {
      OTEL_EXPORTER_OTLP_HEADERS: "x-oneuptime-token=all,x-tenant=eu",
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: "x-oneuptime-token=traces",
      OTEL_EXPORTER_OTLP_LOGS_HEADERS: "x-logs=1",
    };

    expect(
      readStandardOtlpSignalHeaders(environment, OtlpSignal.Traces),
    ).toEqual({ "x-oneuptime-token": "traces", "x-tenant": "eu" });
    expect(
      readStandardOtlpSignalHeaders(environment, OtlpSignal.Metrics),
    ).toEqual({ "x-oneuptime-token": "all", "x-tenant": "eu" });
    expect(readStandardOtlpSignalHeaders(environment, OtlpSignal.Logs)).toEqual(
      {
        "x-oneuptime-token": "all",
        "x-tenant": "eu",
        "x-logs": "1",
      },
    );
  });

  test("names each signal's own variable as the exporters read it", () => {
    expect(
      OTLP_SIGNALS.map((signal: OtlpSignal): string => {
        return otelSignalHeadersSetting(signal);
      }),
    ).toEqual([
      "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
      "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
      "OTEL_EXPORTER_OTLP_LOGS_HEADERS",
    ]);
  });

  test("an environment without them holds none", () => {
    for (const signal of OTLP_SIGNALS) {
      expect(readStandardOtlpSignalHeaders({}, signal)).toEqual({});
    }
  });
});

describe("hasOtlpHeadersFor: whether a signal's exporter has a header to send", () => {
  test.each([
    [{}, {}, [false, false, false]],
    [{ a: "1" }, {}, [true, true, true]],
    [{}, { OTEL_EXPORTER_OTLP_HEADERS: "a=1" }, [true, true, true]],
    [{}, { OTEL_EXPORTER_OTLP_HEADERS: "a=" }, [false, false, false]],
    [{}, { OTEL_EXPORTER_OTLP_METRICS_HEADERS: "a=1" }, [false, true, false]],
    [
      {},
      {
        OTEL_EXPORTER_OTLP_TRACES_HEADERS: "a=1",
        OTEL_EXPORTER_OTLP_LOGS_HEADERS: "b=2",
      },
      [true, false, true],
    ],
    [
      { a: "1" },
      { OTEL_EXPORTER_OTLP_TRACES_HEADERS: "b" },
      [true, true, true],
    ],
  ])(
    "own %j with %j: traces, metrics, logs %j",
    (
      ownHeaders: Record<string, string>,
      environment: NodeJS.ProcessEnv,
      expected: Array<boolean>,
    ) => {
      expect(
        OTLP_SIGNALS.map((signal: OtlpSignal): boolean => {
          return hasOtlpHeadersFor({ ownHeaders, environment, signal });
        }),
      ).toEqual(expected);
    },
  );
});

describe("describeSignalsExportedWithoutAHeader", () => {
  test("says nothing when every signal is exported", () => {
    expect(describeSignalsExportedWithoutAHeader([])).toBeNull();
  });

  test("is NOTHING_EXPORTED_WITHOUT_A_HEADER when no signal is", () => {
    expect(describeSignalsExportedWithoutAHeader(OTLP_SIGNALS)).toBe(
      NOTHING_EXPORTED_WITHOUT_A_HEADER,
    );
    expect(
      describeSignalsExportedWithoutAHeader([
        OtlpSignal.Logs,
        OtlpSignal.Traces,
        OtlpSignal.Metrics,
      ]),
    ).toBe(NOTHING_EXPORTED_WITHOUT_A_HEADER);
  });

  test.each([
    [
      [OtlpSignal.Traces],
      "OneUptime sends none of its own traces: OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT is set, but its only headers are in OTEL_EXPORTER_OTLP_METRICS_HEADERS and OTEL_EXPORTER_OTLP_LOGS_HEADERS, for metrics and logs alone, and it exports a signal only with a header. Set one for every signal in OPENTELEMETRY_EXPORTER_OTLP_HEADERS (openTelemetryExporter.headers in the Helm chart) or OTEL_EXPORTER_OTLP_HEADERS, or set OTEL_EXPORTER_OTLP_TRACES_HEADERS.",
    ],
    [
      [OtlpSignal.Logs, OtlpSignal.Metrics],
      "OneUptime sends none of its own metrics or logs: OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT is set, but its only headers are in OTEL_EXPORTER_OTLP_TRACES_HEADERS, for traces alone, and it exports a signal only with a header. Set one for every signal in OPENTELEMETRY_EXPORTER_OTLP_HEADERS (openTelemetryExporter.headers in the Helm chart) or OTEL_EXPORTER_OTLP_HEADERS, or set OTEL_EXPORTER_OTLP_METRICS_HEADERS and OTEL_EXPORTER_OTLP_LOGS_HEADERS.",
    ],
    [
      [OtlpSignal.Traces, OtlpSignal.Logs],
      "OneUptime sends none of its own traces or logs: OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT is set, but its only headers are in OTEL_EXPORTER_OTLP_METRICS_HEADERS, for metrics alone, and it exports a signal only with a header. Set one for every signal in OPENTELEMETRY_EXPORTER_OTLP_HEADERS (openTelemetryExporter.headers in the Helm chart) or OTEL_EXPORTER_OTLP_HEADERS, or set OTEL_EXPORTER_OTLP_TRACES_HEADERS and OTEL_EXPORTER_OTLP_LOGS_HEADERS.",
    ],
  ])(
    "names the signals %j are not sent, in the order of the signals",
    (unexported: Array<OtlpSignal>, line: string) => {
      expect(describeSignalsExportedWithoutAHeader(unexported)).toBe(line);
    },
  );

  test("each line reaches the log as written: log redaction leaves it alone", () => {
    for (const unexported of [
      [OtlpSignal.Traces],
      [OtlpSignal.Metrics],
      [OtlpSignal.Logs],
      [OtlpSignal.Traces, OtlpSignal.Metrics],
      [OtlpSignal.Metrics, OtlpSignal.Logs],
    ]) {
      const line: string = describeSignalsExportedWithoutAHeader(
        unexported,
      ) as string;

      expect(redactLogString(line)).toBe(line);
    }
  });
});
