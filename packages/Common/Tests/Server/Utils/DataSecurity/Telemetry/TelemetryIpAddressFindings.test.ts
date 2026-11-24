import { describe, expect, test } from "@jest/globals";
import {
  readTelemetryRecordValues,
  TelemetryRecordValue,
  TelemetrySampleCaps,
  TelemetrySampleSource,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryDataScanner";
import { JSONObject } from "../../../../../Types/JSON";
import {
  classifyField,
  FieldClassification,
} from "../../../../../Utils/DataSecurity/FieldClassifier";

/*
 * ---------------------------------------------------------------------------
 * DATA SECURITY FINDS AN ADDRESS WITH ONE GROUP EACH SIDE OF "::" (#10466)
 * AND ONE IN A PERCENT-ENCODED URL (#10467) WHEREVER ITS SCAN READS.
 *
 * The hourly scan reads each kind of record by its own reader - a log's
 * body and attributes, a span's attributes and events, an exception's
 * message and stack trace, an AI call's prompts, a metric point's
 * attributes - and classifies each place's values. These tests hand each
 * reader a record as the database answers it and classify each place the
 * way the scan does, so a finding at every place is the change's, not a
 * helper's. The same detectors hide what they find in an IP Address scrub
 * rule (Utils/Telemetry/ScrubIpAddress.ts).
 * ---------------------------------------------------------------------------
 */

const CAPS: TelemetrySampleCaps = {
  textLength: 4096,
  attributeValueLength: 1024,
  attributesPerRecord: 64,
  eventsPerSpan: 16,
  attributesPerEvent: 32,
};

const ONE_GROUP: string = "2001::1";
const ENCODED_URL: string = "http%3A%2F%2F%5B2606%3A4700%3A%3A1111%5D%2F";
const NEAR_MISSES: string =
  "Abc::Def v1::api fe80%3A%3A1 12%3A30%3A45 10%2E0%2E0%2E1";

// Each place of a record and whether the scan calls what it holds an IP address.
function ipAddressPlaces(
  source: TelemetrySampleSource,
  row: JSONObject,
): Record<string, boolean> {
  const values: Array<TelemetryRecordValue> = readTelemetryRecordValues(
    source,
    row,
    CAPS,
  )!;
  const places: Record<string, boolean> = {};

  for (const value of values) {
    places[value.location] = classifyField(value.location, [value.value]).some(
      (classification: FieldClassification): boolean => {
        return (
          classification.dataTypeId === "ip-address" &&
          classification.valuesWithMatch > 0
        );
      },
    );
  }

  return places;
}

// An event as the read answers it: its name, and its attributes' raw JSON.
function event(name: string, attributes: Record<string, string>): unknown {
  return [
    name,
    Object.keys(attributes).map((key: string): Array<string> => {
      return [key, JSON.stringify(attributes[key])];
    }),
  ];
}

describe("the scan finds both shapes at every place it reads", () => {
  test("a log's body and attributes", () => {
    expect(
      ipAddressPlaces(TelemetrySampleSource.Logs, {
        readBody: `GET /cb?target=${ENCODED_URL} from ${ONE_GROUP}`,
        readAttributes: [
          ["client.address", "2a00::1"],
          ["url.query", "peer=8%2E8%2E8%2E8"],
          ["note", NEAR_MISSES],
        ],
      }),
    ).toEqual({
      body: true,
      "attributes.client.address": true,
      "attributes.url.query": true,
      "attributes.note": false,
    });
  });

  test("a span's attributes and its events' attributes", () => {
    expect(
      ipAddressPlaces(TelemetrySampleSource.Traces, {
        readAttributes: [
          ["client.address", ONE_GROUP],
          ["url.query", `target=${ENCODED_URL}`],
          ["note", NEAR_MISSES],
        ],
        readEvents: [
          event("exception", {
            "exception.message": `connect ${ENCODED_URL} refused`,
          }),
          event("retry", { "peer.address": "2606::1", note: NEAR_MISSES }),
        ],
      }),
    ).toEqual({
      "attributes.client.address": true,
      "attributes.url.query": true,
      "attributes.note": false,
      "events.exception.exception.message": true,
      "events.retry.peer.address": true,
      "events.retry.note": false,
    });
  });

  test("an exception's message, stack trace and attributes", () => {
    expect(
      ipAddressPlaces(TelemetrySampleSource.Exceptions, {
        readMessage: `connect ${ENCODED_URL} refused`,
        readStackTrace: `Error: connect ${ONE_GROUP}\n    at dial (net.js:10:5)`,
        readAttributes: [
          ["server.address", "2a00%3A%3A1"],
          ["note", NEAR_MISSES],
        ],
      }),
    ).toEqual({
      message: true,
      stackTrace: true,
      "attributes.server.address": true,
      "attributes.note": false,
    });
  });

  test("an AI call's prompts and attributes", () => {
    expect(
      ipAddressPlaces(TelemetrySampleSource.AiConversations, {
        readAttributes: [
          [
            "gen_ai.input.messages",
            JSON.stringify([
              { role: "user", content: `fetch ${ENCODED_URL} for me` },
            ]),
          ],
          ["user.id", ONE_GROUP],
          ["note", NEAR_MISSES],
        ],
        readEvents: [],
      }),
    ).toEqual({
      "gen_ai.input.messages": true,
      "attributes.user.id": true,
      "attributes.note": false,
    });
  });

  test("a metric point's attributes", () => {
    expect(
      ipAddressPlaces(TelemetrySampleSource.Metrics, {
        readMetricName: "http.server.requests",
        readAttributes: [
          ["client.address", ONE_GROUP],
          ["http.target", `/cb?to=${ENCODED_URL}`],
          ["http.route", "/orders"],
          ["note", NEAR_MISSES],
        ],
      }),
    ).toEqual({
      name: false,
      "attributes.client.address": true,
      "attributes.http.target": true,
      "attributes.http.route": false,
      "attributes.note": false,
    });
  });
});
