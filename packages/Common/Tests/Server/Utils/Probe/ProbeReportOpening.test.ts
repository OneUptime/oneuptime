import ProbeReportOpening, {
  MAX_REPORT_OPENING_BYTES,
  ProbeReportOpeningCredentials,
} from "../../../../Server/Utils/Probe/ProbeReportOpening";
import { JSONObject } from "../../../../Types/JSON";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * THE ID AND KEY A PROBE'S REPORT OPENS WITH (#10222).
 *
 * Every probe release that uploads a collection builds the body as
 * JSON.stringify({ ...ProbeAPIRequest.getDefaultRequestBody(), ...report }),
 * so its text opens with the probe's key and id. OneUptime reads those two
 * off the start of the bytes - without JSON.parse, which is what it must
 * not run on millions of values before the key is checked - and checks the
 * key before it parses the report. What it reads must be what JSON.parse
 * would make of the same members, every escape included, and anything it
 * cannot be sure of reads as no opening at all.
 */

const PROBE_ID: string = "11111111-2222-4333-8444-555555555555";
const PROBE_KEY: string = "0b1c2d3e-4f50-4a61-8b72-9c83d4e5f601";

// ProbeAPIRequest.getDefaultRequestBody, as every probe release builds it.
function defaultRequestBody(probeKey: string, probeId: string): JSONObject {
  return {
    probeKey: probeKey,
    probeId: probeId,
    probeCapabilities: ["networkDevicePing", "snmpTables", "totpCodes"],
    probeVersion: "17.1.0",
  };
}

// A vCenter's collection as FetchVMwareWork.postCollectionReport builds it.
function vmwareReport(probeKey: string, probeId: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      ...defaultRequestBody(probeKey, probeId),
      vmwareVCenterId: "44444444-4444-4444-8444-444444444444",
      settingsVersion: 3,
      collectedAt: "2026-11-20T12:00:00.000Z",
      status: "Succeeded",
      durationInMs: 900,
      resourceMetrics: [{ resource: { attributes: [] }, scopeMetrics: [] }],
    }),
  );
}

function read(text: string | Buffer): ProbeReportOpeningCredentials | null {
  return ProbeReportOpening.read(
    Buffer.isBuffer(text) ? text : Buffer.from(text, "utf8"),
  );
}

describe("a report as every probe release writes it", () => {
  test("a vCenter's collection: its key and id", () => {
    expect(read(vmwareReport(PROBE_KEY, PROBE_ID))).toEqual({
      probeId: PROBE_ID,
      probeKey: PROBE_KEY,
    });
  });

  test("an OpenStack cloud's collection: its key and id", () => {
    const body: Buffer = Buffer.from(
      JSON.stringify({
        ...defaultRequestBody(PROBE_KEY, PROBE_ID),
        openStackCloudId: "55555555-5555-4555-8555-555555555555",
        status: "PartiallySucceeded",
        resourceMetrics: [],
        resourceLogs: [],
      }),
    );

    expect(read(body)).toEqual({ probeId: PROBE_ID, probeKey: PROBE_KEY });
  });

  test("a probe of a release that declared no build: still the two first", () => {
    const body: string = JSON.stringify({
      probeKey: PROBE_KEY,
      probeId: PROBE_ID,
      probeCapabilities: ["networkDevicePing"],
      vmwareVCenterId: "44444444-4444-4444-8444-444444444444",
      status: "Failed",
      errorMessage: "Refused.",
    });

    expect(read(body)).toEqual({ probeId: PROBE_ID, probeKey: PROBE_KEY });
  });

  test("a body of the two alone", () => {
    expect(
      read(JSON.stringify({ probeKey: PROBE_KEY, probeId: PROBE_ID })),
    ).toEqual({ probeId: PROBE_ID, probeKey: PROBE_KEY });
  });

  test("in either order, and with the white space JSON allows between tokens", () => {
    expect(
      read(JSON.stringify({ probeId: PROBE_ID, probeKey: PROBE_KEY, a: 1 })),
    ).toEqual({ probeId: PROBE_ID, probeKey: PROBE_KEY });

    expect(
      read(
        JSON.stringify(
          { ...defaultRequestBody(PROBE_KEY, PROBE_ID), status: "Failed" },
          null,
          2,
        ),
      ),
    ).toEqual({ probeId: PROBE_ID, probeKey: PROBE_KEY });

    expect(
      read(
        ` \r\n\t{ "probeKey" :\t"${PROBE_KEY}"\n ,\r\n "probeId"  : "${PROBE_ID}" \n}`,
      ),
    ).toEqual({ probeId: PROBE_ID, probeKey: PROBE_KEY });
  });

  test("a key an operator typed, with any character, reads as JSON.parse reads it", () => {
    for (const probeKey of [
      "pr0be-(key)!*~Zq9Lm2Xv8Nc4Bt6Hj1Kp",
      'a "quoted" key with \\ backslashes \\\\ and / slashes',
      "tab\there, newline\nthere, return\r, and \b\f",
      "\u0000\u0001\u001f control characters",
      "clé 東京 Grüße 🚀 beyond Latin-1",
      " spaces at both ends ",
      // Line separators, written as escapes so no tool turns them into line breaks.
      `${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)} line separators`,
      // A lone surrogate, which JSON.stringify writes as an escape.
      "half a pair: \ud83d",
      "%41%20 percent signs",
    ]) {
      const body: Buffer = vmwareReport(probeKey, PROBE_ID);
      const parsed: JSONObject = JSON.parse(body.toString("utf8"));

      expect({ probeKey, read: read(body) }).toEqual({
        probeKey,
        read: {
          probeId: parsed["probeId"],
          probeKey: parsed["probeKey"],
        },
      });
    }
  });

  test("escapes written by hand read as JSON.parse reads them", () => {
    for (const text of [
      '{"probeKey":"caf\\u00e9 \\uD83D\\uDE80 \\/ \\"","probeId":"x"}',
      '{"probe\\u004bey":"k","probe\\u0049d":"i","status":"Failed"}',
      '{"probeKey":"\\b\\f\\n\\r\\t\\\\","probeId":"\\u0031"}',
    ]) {
      const parsed: JSONObject = JSON.parse(text);

      expect({ text, read: read(text) }).toEqual({
        text,
        read: { probeId: parsed["probeId"], probeKey: parsed["probeKey"] },
      });
    }
  });

  test("500 generated keys and ids read exactly as JSON.parse reads them", () => {
    const pool: Array<string> = [
      "a",
      "Z",
      "0",
      "-",
      " ",
      '"',
      "\\",
      "/",
      "\n",
      "\t",
      "\u0007",
      "é",
      "東",
      "🚀",
      "\ud800",
      "\udfff",
      // A line separator, written as an escape so no tool turns it into a line break.
      String.fromCharCode(0x2028),
      "{",
      "}",
      ",",
      ":",
    ];

    // Seeded: the same 500 cases every run, so a failing index replays.
    const random: SeededRandom = seededRandom(20261120);

    const text: (length: number) => string = (length: number): string => {
      let value: string = "";

      for (let index: number = 0; index < length; index++) {
        value += pool[random(pool.length)];
      }

      return value;
    };

    for (let index: number = 0; index < 500; index++) {
      const probeKey: string = text(1 + random(60));
      const probeId: string = text(1 + random(40));
      const body: Buffer = vmwareReport(probeKey, probeId);
      const parsed: JSONObject = JSON.parse(body.toString("utf8"));

      const result: ProbeReportOpeningCredentials | null = read(body);

      expect({ index, result }).toEqual({
        index,
        result: { probeId: parsed["probeId"], probeKey: parsed["probeKey"] },
      });
    }
  });
});

describe("anything else reads as no opening", () => {
  test.each([
    ["an empty body", ""],
    ["white space alone", "  \n "],
    ["an array", `[{"probeKey":"${PROBE_KEY}","probeId":"${PROBE_ID}"}]`],
    ["a string", `"${PROBE_KEY}"`],
    [
      "an object that opens with another member",
      `{"status":"Failed","probeKey":"k","probeId":"i"}`,
    ],
    [
      "the key with another member before the id",
      `{"probeKey":"k","status":"Failed","probeId":"i"}`,
    ],
    ["the key twice", `{"probeKey":"a","probeKey":"b","probeId":"i"}`],
    ["the id twice", `{"probeId":"a","probeId":"b"}`],
    ["a key that is a number", `{"probeKey":12345,"probeId":"i"}`],
    ["a key that is null", `{"probeKey":null,"probeId":"i"}`],
    ["an id that is an object", `{"probeKey":"k","probeId":{"value":"i"}}`],
    ["a name in other case", `{"ProbeKey":"k","probeId":"i"}`],
    ["a missing colon", `{"probeKey" "k","probeId":"i"}`],
    ["a missing comma", `{"probeKey":"k" "probeId":"i"}`],
    ["what follows the two is no JSON", `{"probeKey":"k","probeId":"i" x}`],
    ["the two cut off", `{"probeKey":"k","probeId":"i`],
    ["nothing after the two", `{"probeKey":"k","probeId":"i"`],
    ["a raw newline in a string", `{"probeKey":"a\nb","probeId":"i"}`],
    ["an escape JSON does not have", `{"probeKey":"a\\xb","probeId":"i"}`],
    ["a short unicode escape", `{"probeKey":"a\\u12","probeId":"i"}`],
    ["an escape cut off", `{"probeKey":"a\\`],
    ["single quotes", `{'probeKey':'k','probeId':'i'}`],
  ])("%s", (_what: string, text: string) => {
    expect(read(text)).toBeNull();
  });

  test("a key that runs past the bytes read", () => {
    const probeKey: string = "k".repeat(MAX_REPORT_OPENING_BYTES);

    expect(read(vmwareReport(probeKey, PROBE_ID))).toBeNull();
  });
});

describe("what it costs", () => {
  test("only the start of a body is read, whatever its size: 48 MiB in a few milliseconds", () => {
    const opening: string = JSON.stringify(
      defaultRequestBody(PROBE_KEY, PROBE_ID),
    ).slice(0, -1);
    const body: Buffer = Buffer.alloc(48 * 1024 * 1024, " ");
    body.write(`${opening},"resourceMetrics":[`, 0, "utf8");

    // The fastest of up to three attempts: one timing on a busy runner is noisy.
    const reads: FastestRun<Array<ProbeReportOpeningCredentials | null>> =
      fastestRun({
        run: (): Array<ProbeReportOpeningCredentials | null> => {
          const opened: Array<ProbeReportOpeningCredentials | null> = [];

          for (let index: number = 0; index < 100; index++) {
            opened.push(read(body));
          }

          return opened;
        },
        limitInMs: 1000,
      });

    expect(reads.result).toHaveLength(100);

    for (const opened of reads.result) {
      expect(opened).toEqual({ probeId: PROBE_ID, probeKey: PROBE_KEY });
    }

    // 100 reads of a 48 MiB body: each one reads 4 KiB.
    expect(reads.inMs).toBeLessThan(1000);
  });

  test("never calls JSON.parse", () => {
    const jsonParse: ReturnType<typeof jest.spyOn> = jest.spyOn(JSON, "parse");

    try {
      expect(read(vmwareReport('a "quoted" \\ key 🚀', PROBE_ID))).toEqual({
        probeId: PROBE_ID,
        probeKey: 'a "quoted" \\ key 🚀',
      });
      expect(read("{not json")).toBeNull();
      expect(jsonParse).not.toHaveBeenCalled();
    } finally {
      jsonParse.mockRestore();
    }
  });

  test("a view into a larger buffer is read from its own start", () => {
    const report: Buffer = vmwareReport(PROBE_KEY, PROBE_ID);
    const larger: Buffer = Buffer.concat([
      Buffer.from('{"probeKey":"someone else","probeId":"x"}'),
      report,
    ]);
    const view: Uint8Array = new Uint8Array(
      larger.buffer,
      larger.byteOffset + larger.length - report.length,
      report.length,
    );

    expect(ProbeReportOpening.read(view)).toEqual({
      probeId: PROBE_ID,
      probeKey: PROBE_KEY,
    });
  });

  test("a character cut in two where the read stops leaves what comes before it whole", () => {
    const opening: string = `{"probeKey":"${PROBE_KEY}","probeId":"${PROBE_ID}","note":"`;
    const filler: string = "x".repeat(
      MAX_REPORT_OPENING_BYTES - opening.length - 1,
    );
    // A three-byte character across the end of what is read.
    const body: Buffer = Buffer.from(`${opening}${filler}東東"}`, "utf8");

    expect(read(body)).toEqual({ probeId: PROBE_ID, probeKey: PROBE_KEY });
  });
});
