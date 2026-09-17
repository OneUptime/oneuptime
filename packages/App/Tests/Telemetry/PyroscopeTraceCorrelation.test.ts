/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr)
 * at import time via the services' queue imports; nothing queue-related
 * is under test here, so the module is replaced — same idiom as
 * TelemetryQueueService.test.ts in this directory.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

import PyroscopeIngestService from "../../FeatureSet/Telemetry/Services/PyroscopeIngestService";
import {
  SPAN_ID_KEYS,
  TRACE_ID_KEYS,
  findCorrelationValue,
  findHexCorrelationValue,
  isEmptyHexId,
  normalizeHexIdFromLabel,
} from "../../FeatureSet/Telemetry/Utils/ProfileCorrelation";
import Dictionary from "Common/Types/Dictionary";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * Pyroscope SDKs carry trace context as pprof SAMPLE LABELS (pprof has no
 * link table), so the converter must lift trace_id / span_id labels into
 * OTLP linkTable entries referenced per sample via linkIndex — the exact
 * shape the profiles worker already resolves into traceId/spanId columns
 * on Profile and ProfileSample rows. The recognized key spellings and the
 * hex normalization are shared with the OTLP ingest path through
 * Utils/ProfileCorrelation, so a label means the same thing on both
 * paths.
 */

const HEX_TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const HEX_SPAN_ID: string = "00f067aa0ba902b7";

/*
 * Minimal pprof structure in the shape parsePprof produces: one function,
 * one location, samples carrying labels through the string table.
 * `labels` maps label name -> label value per sample.
 */
function makePprofData(sampleLabelSets: Array<Dictionary<string>>): JSONObject {
  const stringTable: Array<string> = ["", "samples", "count", "main"];
  const stringIndex: (value: string) => number = (value: string): number => {
    const existing: number = stringTable.indexOf(value);
    if (existing >= 0) {
      return existing;
    }
    stringTable.push(value);
    return stringTable.length - 1;
  };

  const samples: Array<JSONObject> = sampleLabelSets.map(
    (labels: Dictionary<string>): JSONObject => {
      const label: Array<JSONObject> = Object.keys(labels).map(
        (key: string): JSONObject => {
          return {
            key: stringIndex(key),
            str: stringIndex(labels[key]!),
          };
        },
      );

      return {
        locationId: [1],
        value: [7],
        label: label,
      };
    },
  );

  return {
    stringTable: stringTable,
    sampleType: [{ type: 1, unit: 2 }],
    sample: samples,
    location: [{ id: 1, line: [{ functionId: 1, line: 10 }] }],
    function: [{ id: 1, name: 3, filename: 0 }],
    timeNanos: 1_753_782_000_000_000_000,
    durationNanos: 10_000_000_000,
    period: 0,
  };
}

type ConvertPprofToOTLP = (data: {
  pprofData: JSONObject;
  appName: string;
  fromSeconds: number;
  untilSeconds: number;
}) => JSONObject;

/* Same private-static cast idiom as OtelIdDecoding.test.ts. */
const convertPprofToOTLP: ConvertPprofToOTLP = (
  PyroscopeIngestService as unknown as {
    convertPprofToOTLP: ConvertPprofToOTLP;
  }
).convertPprofToOTLP.bind(PyroscopeIngestService);

function convert(sampleLabelSets: Array<Dictionary<string>>): {
  profile: JSONObject;
  samples: JSONArray;
  linkTable: JSONArray;
  attributeTable: JSONArray;
} {
  const body: JSONObject = convertPprofToOTLP({
    pprofData: makePprofData(sampleLabelSets),
    appName: "checkout-service",
    fromSeconds: 0,
    untilSeconds: 0,
  });

  const resourceProfiles: JSONArray = body["resourceProfiles"] as JSONArray;
  const scopeProfiles: JSONArray = (resourceProfiles[0] as JSONObject)[
    "scopeProfiles"
  ] as JSONArray;
  const profiles: JSONArray = (scopeProfiles[0] as JSONObject)[
    "profiles"
  ] as JSONArray;
  const profile: JSONObject = (profiles[0] as JSONObject)[
    "profile"
  ] as JSONObject;

  return {
    profile: profile,
    samples: profile["sample"] as JSONArray,
    linkTable: profile["linkTable"] as JSONArray,
    attributeTable: profile["attributeTable"] as JSONArray,
  };
}

describe("Pyroscope trace correlation labels", () => {
  for (const traceKey of TRACE_ID_KEYS) {
    test(`a "${traceKey}" label becomes a link table entry`, () => {
      const converted: ReturnType<typeof convert> = convert([
        { [traceKey]: HEX_TRACE_ID },
      ]);

      /* Index 0 is the OTLP sentinel; the real link sits at index 1. */
      expect(converted.linkTable.length).toBe(2);
      expect(converted.linkTable[1]).toEqual({
        traceId: HEX_TRACE_ID,
        spanId: "",
      });
      expect((converted.samples[0] as JSONObject)["linkIndex"]).toBe(1);
    });
  }

  for (const spanKey of SPAN_ID_KEYS) {
    test(`a "${spanKey}" label becomes a link table entry`, () => {
      const converted: ReturnType<typeof convert> = convert([
        { [spanKey]: HEX_SPAN_ID },
      ]);

      expect(converted.linkTable[1]).toEqual({
        traceId: "",
        spanId: HEX_SPAN_ID,
      });
      expect((converted.samples[0] as JSONObject)["linkIndex"]).toBe(1);
    });
  }

  test("trace and span ids on one sample land in one link entry", () => {
    const converted: ReturnType<typeof convert> = convert([
      { trace_id: HEX_TRACE_ID, span_id: HEX_SPAN_ID },
    ]);

    expect(converted.linkTable[1]).toEqual({
      traceId: HEX_TRACE_ID,
      spanId: HEX_SPAN_ID,
    });
  });

  test("uppercase hex is normalized to the lowercase the Span table stores", () => {
    const converted: ReturnType<typeof convert> = convert([
      {
        trace_id: HEX_TRACE_ID.toUpperCase(),
        span_id: HEX_SPAN_ID.toUpperCase(),
      },
    ]);

    expect(converted.linkTable[1]).toEqual({
      traceId: HEX_TRACE_ID,
      spanId: HEX_SPAN_ID,
    });
  });

  test("samples sharing a correlation share one deduped link entry", () => {
    const converted: ReturnType<typeof convert> = convert([
      { trace_id: HEX_TRACE_ID, span_id: HEX_SPAN_ID },
      { trace_id: HEX_TRACE_ID, span_id: HEX_SPAN_ID },
      { trace_id: "aa".repeat(16) },
    ]);

    /* sentinel + two distinct correlations, not one per sample. */
    expect(converted.linkTable.length).toBe(3);
    expect((converted.samples[0] as JSONObject)["linkIndex"]).toBe(1);
    expect((converted.samples[1] as JSONObject)["linkIndex"]).toBe(1);
    expect((converted.samples[2] as JSONObject)["linkIndex"]).toBe(2);
  });

  test("invalid hex is ignored entirely, never stamped and never a label", () => {
    /*
     * Label values are operator-typed text: anything that is not an
     * exact 16/32-char hex id must be dropped, and must NOT survive as a
     * sample attribute either — the worker's raw label fallback would
     * resurrect the unvalidated value into the traceId column.
     */
    const converted: ReturnType<typeof convert> = convert([
      { trace_id: "not-a-trace-id", span_id: "deadbeef" },
    ]);

    expect(converted.linkTable).toEqual([]);
    expect((converted.samples[0] as JSONObject)["linkIndex"]).toBeUndefined();
    expect(converted.attributeTable).toEqual([]);
  });

  test("all-zero ids mean unset, exactly as on the OTLP path", () => {
    const converted: ReturnType<typeof convert> = convert([
      { trace_id: "0".repeat(32), span_id: "0".repeat(16) },
    ]);

    expect(converted.linkTable).toEqual([]);
    expect((converted.samples[0] as JSONObject)["linkIndex"]).toBeUndefined();
  });

  test("an invalid spelling cannot shadow a valid one on the same sample", () => {
    const converted: ReturnType<typeof convert> = convert([
      { trace_id: "garbage", traceId: HEX_TRACE_ID },
    ]);

    expect(converted.linkTable[1]).toEqual({
      traceId: HEX_TRACE_ID,
      spanId: "",
    });
  });

  test("absent labels leave the sample and tables untouched", () => {
    const converted: ReturnType<typeof convert> = convert([{}]);

    expect(converted.linkTable).toEqual([]);
    expect(converted.attributeTable).toEqual([]);

    const sample: JSONObject = converted.samples[0] as JSONObject;
    expect(sample["linkIndex"]).toBeUndefined();
    expect(sample["attributeIndices"]).toBeUndefined();
    /* The pre-existing sample shape is preserved byte for byte. */
    expect(sample["value"]).toEqual(["7"]);
    expect(sample["stackIndex"]).toBe(0);
  });

  test("non-correlation labels ride along as sample attributes", () => {
    const converted: ReturnType<typeof convert> = convert([
      { endpoint: "/checkout", trace_id: HEX_TRACE_ID },
      { endpoint: "/checkout" },
    ]);

    /* Index 0 is the attribute table sentinel. */
    expect(converted.attributeTable.length).toBe(2);
    expect(converted.attributeTable[1]).toEqual({
      key: "endpoint",
      value: { stringValue: "/checkout" },
    });

    /* Both samples reference the SAME deduped entry. */
    expect((converted.samples[0] as JSONObject)["attributeIndices"]).toEqual([
      1,
    ]);
    expect((converted.samples[1] as JSONObject)["attributeIndices"]).toEqual([
      1,
    ]);

    /*
     * The promoted correlation key is NOT duplicated into the attribute
     * table — it lives in the link table as a first-class id.
     */
    const attributeKeys: Array<unknown> = converted.attributeTable.map(
      (entry: unknown): unknown => {
        return (entry as JSONObject)["key"];
      },
    );
    expect(attributeKeys).not.toContain("trace_id");
  });
});

/*
 * The shared helper itself — one behavior for both ingest paths. The
 * OTLP worker consumes findCorrelationValue / isEmptyHexId for its label
 * fallback; the Pyroscope converter layers strict hex validation on the
 * same key list via findHexCorrelationValue.
 */
describe("ProfileCorrelation shared helper", () => {
  test("both key lists carry every supported spelling once", () => {
    expect(new Set(TRACE_ID_KEYS).size).toBe(TRACE_ID_KEYS.length);
    expect(new Set(SPAN_ID_KEYS).size).toBe(SPAN_ID_KEYS.length);
    expect(TRACE_ID_KEYS).toContain("trace_id");
    expect(TRACE_ID_KEYS).toContain("trace.id");
    expect(SPAN_ID_KEYS).toContain("span_id");
    expect(SPAN_ID_KEYS).toContain("span.id");
  });

  test("findCorrelationValue takes the first non-empty, non-zero candidate", () => {
    const labels: Dictionary<unknown> = {
      trace_id: "0".repeat(32),
      traceId: HEX_TRACE_ID,
    };

    expect(findCorrelationValue(labels, TRACE_ID_KEYS)).toBe(HEX_TRACE_ID);
    expect(findCorrelationValue({}, TRACE_ID_KEYS)).toBe("");
  });

  test("findCorrelationValue accepts numeric values by stringifying them", () => {
    expect(findCorrelationValue({ trace_id: 12345 }, TRACE_ID_KEYS)).toBe(
      "12345",
    );
  });

  test("isEmptyHexId filters only empty and all-zero ids", () => {
    expect(isEmptyHexId("")).toBe(true);
    expect(isEmptyHexId("0")).toBe(true);
    expect(isEmptyHexId("0".repeat(32))).toBe(true);
    expect(isEmptyHexId(HEX_TRACE_ID)).toBe(false);
  });

  test("normalizeHexIdFromLabel accepts exactly the OTLP hex id shapes", () => {
    expect(normalizeHexIdFromLabel(HEX_TRACE_ID)).toBe(HEX_TRACE_ID);
    expect(normalizeHexIdFromLabel(HEX_SPAN_ID)).toBe(HEX_SPAN_ID);
    expect(normalizeHexIdFromLabel(` ${HEX_TRACE_ID} `)).toBe(HEX_TRACE_ID);
    expect(normalizeHexIdFromLabel(HEX_TRACE_ID.toUpperCase())).toBe(
      HEX_TRACE_ID,
    );

    /* Wrong length, wrong alphabet, base64-looking, all-zero: rejected. */
    expect(normalizeHexIdFromLabel("abc123")).toBe("");
    expect(normalizeHexIdFromLabel("not-a-trace-id!")).toBe("");
    expect(normalizeHexIdFromLabel("S/kvNXezTaajzpKdDg5HNg==")).toBe("");
    expect(normalizeHexIdFromLabel("0".repeat(32))).toBe("");
    expect(normalizeHexIdFromLabel("")).toBe("");
  });

  test("findHexCorrelationValue skips invalid candidates instead of stopping", () => {
    const labels: Dictionary<unknown> = {
      trace_id: "garbage",
      "trace.id": HEX_TRACE_ID,
    };

    expect(findHexCorrelationValue(labels, TRACE_ID_KEYS)).toBe(HEX_TRACE_ID);
    expect(findHexCorrelationValue({ trace_id: "junk" }, TRACE_ID_KEYS)).toBe(
      "",
    );
    expect(findHexCorrelationValue({}, SPAN_ID_KEYS)).toBe("");
  });
});
