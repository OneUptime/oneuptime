import Log from "../../../Models/AnalyticsModels/Log";
import { JSONObject } from "../../../Types/JSON";
import { exportLogsToCSV, exportLogsToJSON } from "../../../UI/Utils/LogExport";
import { describe, expect, test } from "@jest/globals";

/*
 * LogExport turns a set of Log rows + selected columns into CSV/JSON that the
 * user downloads. The two pure serializers are what these tests guard:
 *
 *   - CSV escaping (RFC-4180 style: quote fields containing comma/quote/newline,
 *     double embedded quotes) — a bug here corrupts every exported file.
 *   - Column resolution, including the "attribute:<key>" dynamic columns that
 *     read out of the log's attributes bag.
 */

function makeLog(fields: {
  time?: Date;
  body?: string;
  traceId?: string;
  spanId?: string;
  severityText?: string;
  attributes?: JSONObject;
}): Log {
  const log: Log = new Log();
  if (fields.time) {
    log.time = fields.time;
  }
  if (fields.body !== undefined) {
    log.body = fields.body;
  }
  if (fields.traceId !== undefined) {
    log.traceId = fields.traceId;
  }
  if (fields.spanId !== undefined) {
    log.spanId = fields.spanId;
  }
  if (fields.severityText !== undefined) {
    log.severityText = fields.severityText as unknown as Log["severityText"];
  }
  if (fields.attributes !== undefined) {
    log.attributes = fields.attributes;
  }
  return log;
}

describe("exportLogsToCSV", () => {
  test("emits a header row of human-readable labels", () => {
    const csv: string = exportLogsToCSV([], ["time", "message", "traceId"]);
    expect(csv).toBe("Time,Message,Trace ID");
  });

  test("serializes body/traceId/spanId fields into a row", () => {
    const log: Log = makeLog({
      body: "hello world",
      traceId: "trace-1",
      spanId: "span-1",
    });

    const csv: string = exportLogsToCSV(
      [log],
      ["message", "traceId", "spanId"],
    );
    const [, row] = csv.split("\n");
    expect(row).toBe("hello world,trace-1,span-1");
  });

  test("quotes and escapes fields containing commas and quotes", () => {
    const log: Log = makeLog({ body: 'a, b "c"' });
    const csv: string = exportLogsToCSV([log], ["message"]);
    // Message,\n"a, b ""c"""
    expect(csv.split("\n")[1]).toBe('"a, b ""c"""');
  });

  test("quotes fields containing newlines", () => {
    const log: Log = makeLog({ body: "line1\nline2" });
    const csv: string = exportLogsToCSV([log], ["message"]);
    // The whole field (including the embedded newline) is wrapped in quotes.
    expect(csv).toBe('Message\n"line1\nline2"');
  });

  test("renders an ISO timestamp for the time column", () => {
    const log: Log = makeLog({ time: new Date("2026-07-25T10:20:30.000Z") });
    const csv: string = exportLogsToCSV([log], ["time"]);
    expect(csv.split("\n")[1]).toBe("2026-07-25T10:20:30.000Z");
  });

  test("empty value for a missing scalar field", () => {
    const log: Log = makeLog({ body: "x" });
    const csv: string = exportLogsToCSV([log], ["traceId"]);
    expect(csv.split("\n")[1]).toBe("");
  });

  test("reads dynamic attribute columns via the attribute: prefix", () => {
    const log: Log = makeLog({
      attributes: { "http.method": "GET", nested: { a: 1 } },
    });

    const csv: string = exportLogsToCSV(
      [log],
      ["attribute:http.method", "attribute:nested"],
    );
    const row: string = csv.split("\n")[1]!;
    // nested object is JSON-stringified, which contains a comma -> quoted.
    expect(row).toContain("GET");
    expect(row).toContain('"{""a"":1}"');
  });

  test("attribute column is empty when the key is absent", () => {
    const log: Log = makeLog({ attributes: { present: "1" } });
    const csv: string = exportLogsToCSV([log], ["attribute:missing"]);
    expect(csv.split("\n")[1]).toBe("");
  });

  test("unknown column id yields an empty cell and echoes the id as label", () => {
    const log: Log = makeLog({ body: "x" });
    const csv: string = exportLogsToCSV([log], ["totally-unknown"]);
    expect(csv.split("\n")[0]).toBe("totally-unknown");
    expect(csv.split("\n")[1]).toBe("");
  });
});

describe("exportLogsToJSON", () => {
  test("produces a pretty-printed array of log objects", () => {
    const log: Log = makeLog({
      time: new Date("2026-07-25T10:20:30.000Z"),
      body: "hello",
      traceId: "t1",
      spanId: "s1",
      attributes: { k: "v" },
    });

    const json: string = exportLogsToJSON([log]);
    const parsed: Array<Record<string, unknown>> = JSON.parse(json);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]!["time"]).toBe("2026-07-25T10:20:30.000Z");
    expect(parsed[0]!["body"]).toBe("hello");
    expect(parsed[0]!["traceId"]).toBe("t1");
    expect(parsed[0]!["spanId"]).toBe("s1");
    expect(parsed[0]!["attributes"]).toEqual({ k: "v" });
  });

  test("null fields for a sparse log, empty attributes object default", () => {
    const log: Log = makeLog({ body: "only body" });
    const parsed: Array<Record<string, unknown>> = JSON.parse(
      exportLogsToJSON([log]),
    );

    expect(parsed[0]!["time"]).toBeNull();
    expect(parsed[0]!["traceId"]).toBeNull();
    expect(parsed[0]!["spanId"]).toBeNull();
    expect(parsed[0]!["attributes"]).toEqual({});
    expect(parsed[0]!["body"]).toBe("only body");
  });

  test("serializes an empty list to an empty JSON array", () => {
    expect(exportLogsToJSON([])).toBe("[]");
  });
});
