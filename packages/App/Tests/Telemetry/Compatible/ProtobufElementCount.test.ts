import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";
import { seededRandom } from "Common/Tests/Helpers/SeededRandom";
import { JSONObject } from "Common/Types/JSON";
import ProtobufElementCounter, {
  ProtobufCountSchema,
  ProtobufElementCount,
  ProtobufElementCountOutcome,
} from "../../../FeatureSet/Telemetry/Utils/Compatible/ProtobufElementCount";
import {
  REMOTE_WRITE_V1_COUNT,
  REMOTE_WRITE_V2_COUNT,
  WriteRequestV1,
  WriteRequestV2,
} from "../../../FeatureSet/Telemetry/Utils/Compatible/PrometheusRemoteWrite";
import {
  LOKI_PUSH_COUNT,
  LokiPushRequestType,
} from "../../../FeatureSet/Telemetry/Utils/Compatible/LokiPush";
import {
  DATADOG_METRIC_PAYLOAD_COUNT,
  DATADOG_SKETCH_PAYLOAD_COUNT,
  DatadogMetricPayload,
  DatadogMetricPayloadAsRead,
  DatadogSketchPayload,
  DatadogSketchPayloadAsRead,
} from "../../../FeatureSet/Telemetry/Utils/Compatible/DatadogIntake";

/*
 * A protobuf body's objects, counted on its wire format before it is
 * decoded: the count a remote write body is held to, so a small body that
 * decodes into millions of objects is refused before it takes the memory.
 * The count must be what the decoder makes - checked here against
 * protobufjs' own decoding of generated requests - and must never let a
 * body it cannot read through.
 */

const count: (
  body: Uint8Array,
  schema: ProtobufCountSchema,
  limit?: number,
) => ProtobufElementCount = (
  body: Uint8Array,
  schema: ProtobufCountSchema,
  limit?: number,
): ProtobufElementCount => {
  return ProtobufElementCounter.count(
    body,
    schema,
    limit ?? Number.MAX_SAFE_INTEGER,
  );
};

const encodeV1: (request: JSONObject) => Uint8Array = (
  request: JSONObject,
): Uint8Array => {
  return WriteRequestV1.encode(WriteRequestV1.fromObject(request)).finish();
};

const encodeV2: (request: JSONObject) => Uint8Array = (
  request: JSONObject,
): Uint8Array => {
  return WriteRequestV2.encode(WriteRequestV2.fromObject(request)).finish();
};

/*
 * The objects and repeated values protobufjs' decoded message holds, as
 * the schema names them: what the count must equal.
 */
const decodedElements: (
  value: unknown,
  schema: ProtobufCountSchema,
) => number = (value: unknown, schema: ProtobufCountSchema): number => {
  const message: Record<string, unknown> = value as Record<string, unknown>;
  let total: number = 0;
  const type: Record<string, unknown> = (
    message as { $type?: { fieldsById: Record<number, { name: string }> } }
  ).$type as unknown as Record<string, unknown>;
  const fieldsById: Record<number, { name: string }> = (
    type as unknown as { fieldsById: Record<number, { name: string }> }
  ).fieldsById;

  for (const [id, child] of Object.entries(schema.messages || {})) {
    const field: { name: string } | undefined = fieldsById[Number(id)];
    const items: unknown = field ? message[field.name] : undefined;
    const list: Array<unknown> = Array.isArray(items)
      ? items
      : items
        ? [items]
        : [];

    for (const item of list) {
      total += 1 + decodedElements(item, child);
    }
  }

  for (const set of [schema.varints, schema.fixed64s, schema.strings]) {
    for (const id of set || []) {
      const field: { name: string } | undefined = fieldsById[id];
      const items: unknown = field ? message[field.name] : undefined;

      total += Array.isArray(items) ? items.length : 0;
    }
  }

  return total;
};

describe("ProtobufElementCounter - remote write 1.0", () => {
  test("counts every series, label, sample, exemplar and exemplar label", () => {
    const body: Uint8Array = encodeV1({
      timeseries: [
        {
          labels: [
            { name: "__name__", value: "up" },
            { name: "job", value: "node" },
          ],
          samples: [
            { value: 1, timestamp: 1 },
            { value: 2, timestamp: 2 },
          ],
          exemplars: [
            { labels: [{ name: "trace_id", value: "ab" }], value: 1 },
          ],
        },
      ],
      metadata: [{ type: 1, metricFamilyName: "up" }],
    });

    // 1 series + 2 labels + 2 samples + 1 exemplar + 1 label + 1 metadata.
    expect(count(body, REMOTE_WRITE_V1_COUNT)).toEqual({
      outcome: ProtobufElementCountOutcome.Counted,
      elements: 8,
    });
  });

  test("counts a native histogram's spans and buckets, packed", () => {
    const body: Uint8Array = encodeV1({
      timeseries: [
        {
          histograms: [
            {
              countInt: 3,
              positiveSpans: [
                { offset: 0, length: 2 },
                { offset: 1, length: 1 },
              ],
              positiveDeltas: [1, 1, -1],
              negativeCounts: [0.5],
              customValues: [0.1, 0.2],
            },
          ],
        },
      ],
    });

    // 1 series + 1 histogram + 2 spans + 3 deltas + 1 count + 2 bounds.
    expect(count(body, REMOTE_WRITE_V1_COUNT).elements).toBe(10);
  });

  test("equals what protobufjs decodes, over many generated requests", () => {
    const next: () => number = seededRandom(7);

    for (let run: number = 0; run < 200; run++) {
      const timeseries: Array<JSONObject> = [];
      const seriesCount: number = Math.floor(next() * 6);

      for (let series: number = 0; series < seriesCount; series++) {
        const labelCount: number = Math.floor(next() * 5);
        const sampleCount: number = Math.floor(next() * 4);
        const exemplarCount: number = Math.floor(next() * 3);
        const histogramCount: number = Math.floor(next() * 2);

        timeseries.push({
          labels: Array.from(
            { length: labelCount },
            (_: unknown, i: number) => {
              return { name: `l${i}`, value: next() < 0.2 ? "" : `v${i}` };
            },
          ),
          samples: Array.from({ length: sampleCount }, () => {
            return { value: next(), timestamp: Math.floor(next() * 1e12) };
          }),
          exemplars: Array.from({ length: exemplarCount }, () => {
            return {
              labels: next() < 0.5 ? [{ name: "trace_id", value: "ab" }] : [],
              value: next(),
              timestamp: 5,
            };
          }),
          histograms: Array.from({ length: histogramCount }, () => {
            const spans: number = Math.floor(next() * 3);

            return {
              countInt: 4,
              sum: next(),
              schema: 1,
              positiveSpans: Array.from({ length: spans }, () => {
                return { offset: 1, length: 2 };
              }),
              positiveDeltas: Array.from({ length: spans * 2 }, () => {
                return Math.floor(next() * 10) - 5;
              }),
              negativeCounts: next() < 0.5 ? [1.5, 2.5] : [],
              customValues: next() < 0.3 ? [1, 2, 3] : [],
            };
          }),
        });
      }

      const body: Uint8Array = encodeV1({ timeseries: timeseries });
      const decoded: unknown = WriteRequestV1.decode(body);

      expect(count(body, REMOTE_WRITE_V1_COUNT)).toEqual({
        outcome: ProtobufElementCountOutcome.Counted,
        elements: decodedElements(decoded, REMOTE_WRITE_V1_COUNT),
      });
    }
  });

  test("stops at the first element past the limit, without reading the rest", () => {
    const body: Uint8Array = encodeV1({
      timeseries: Array.from({ length: 100 }, () => {
        return { labels: [{ name: "a", value: "b" }] };
      }),
    });

    expect(count(body, REMOTE_WRITE_V1_COUNT, 10)).toEqual({
      outcome: ProtobufElementCountOutcome.OverLimit,
      elements: 11,
    });
    expect(count(body, REMOTE_WRITE_V1_COUNT, 200).outcome).toBe(
      ProtobufElementCountOutcome.Counted,
    );
  });

  test("an empty body is an empty request", () => {
    expect(count(new Uint8Array(0), REMOTE_WRITE_V1_COUNT)).toEqual({
      outcome: ProtobufElementCountOutcome.Counted,
      elements: 0,
    });
  });

  test("fields it does not know are stepped over, whatever their wire type", () => {
    const body: Uint8Array = Uint8Array.from([
      // field 2 (reserved: Cortex's source), varint 1
      0x10, 0x01,
      // field 9, fixed64
      0x49, 0, 0, 0, 0, 0, 0, 0, 0,
      // field 10, fixed32
      0x55, 0, 0, 0, 0,
      // field 11, bytes of length 2
      0x5a, 0x02, 0x01, 0x02,
      // one empty series
      0x0a, 0x00,
    ]);

    expect(count(body, REMOTE_WRITE_V1_COUNT)).toEqual({
      outcome: ProtobufElementCountOutcome.Counted,
      elements: 1,
    });
    // protobufjs reads it too.
    expect(WriteRequestV1.decode(body)).toBeDefined();
  });

  test.each<[string, Array<number>]>([
    ["a series longer than the body", [0x0a, 0x05, 0x0a, 0x00]],
    ["a series sent as a varint", [0x08, 0x01]],
    ["a tag cut off", [0x8a]],
    ["a length cut off", [0x0a, 0x80]],
    ["field number zero", [0x02, 0x00]],
    ["a group", [0x0b, 0x0c]],
    [
      "a label that runs past its series",
      // series of length 2 holding a label of length 5
      [0x0a, 0x02, 0x0a, 0x05, 0x0a, 0x01, 0x61, 0x12, 0x00],
    ],
    ["an unknown field's bytes past the end", [0x5a, 0x09, 0x01]],
  ])(
    "a body it cannot read is malformed: %s",
    (_name: string, bytes: Array<number>) => {
      expect(count(Uint8Array.from(bytes), REMOTE_WRITE_V1_COUNT).outcome).toBe(
        ProtobufElementCountOutcome.Malformed,
      );
    },
  );

  test("16 MiB of empty series is counted to the limit in well under a second", () => {
    const body: Buffer = Buffer.alloc(16 * 1024 * 1024);

    for (let index: number = 0; index < body.length; index += 2) {
      body[index] = 0x0a;
      body[index + 1] = 0x00;
    }

    const timed: FastestRun<ProtobufElementCount> = fastestRun({
      run: (): ProtobufElementCount => {
        return count(body, REMOTE_WRITE_V1_COUNT, 500000);
      },
      limitInMs: 1000,
    });

    expect(timed.result).toEqual({
      outcome: ProtobufElementCountOutcome.OverLimit,
      elements: 500001,
    });
    expect(timed.inMs).toBeLessThan(1000);
  });
});

describe("ProtobufElementCounter - remote write 2.0", () => {
  test("counts symbols, label references (packed), samples, histograms, exemplars and metadata", () => {
    const body: Uint8Array = encodeV2({
      symbols: ["", "__name__", "up", "trace_id", "ab"],
      timeseries: [
        {
          labelsRefs: [1, 2],
          samples: [{ value: 1, timestamp: 1 }],
          exemplars: [{ labelsRefs: [3, 4], value: 1, timestamp: 1 }],
          metadata: { type: 2 },
        },
      ],
    });

    // 5 symbols + 1 series + 2 refs + 1 sample + 1 exemplar + 2 refs + 1 metadata.
    expect(count(body, REMOTE_WRITE_V2_COUNT).elements).toBe(13);
  });

  test("label references sent unpacked count the same", () => {
    // series (field 5) holding labels_refs (field 1) as three varints.
    const body: Uint8Array = Uint8Array.from([
      0x2a, 0x06, 0x08, 0x01, 0x08, 0x02, 0x08, 0x03,
    ]);

    expect(count(body, REMOTE_WRITE_V2_COUNT)).toEqual({
      outcome: ProtobufElementCountOutcome.Counted,
      elements: 4,
    });
    expect(
      (
        WriteRequestV2.toObject(WriteRequestV2.decode(body), {
          arrays: true,
        }) as { timeseries: Array<{ labelsRefs: Array<number> }> }
      ).timeseries[0]!.labelsRefs,
    ).toEqual([1, 2, 3]);
  });

  test("equals what protobufjs decodes, over many generated requests", () => {
    const next: () => number = seededRandom(11);

    for (let run: number = 0; run < 200; run++) {
      const symbols: Array<string> = Array.from(
        { length: Math.floor(next() * 8) },
        (_: unknown, i: number) => {
          return `s${i}`;
        },
      );
      const timeseries: Array<JSONObject> = Array.from(
        { length: Math.floor(next() * 5) },
        () => {
          return {
            labelsRefs: Array.from({ length: Math.floor(next() * 6) }, () => {
              return Math.floor(next() * 300);
            }),
            samples: Array.from({ length: Math.floor(next() * 3) }, () => {
              return { value: next(), timestamp: 1, startTimestamp: 1 };
            }),
            exemplars: Array.from({ length: Math.floor(next() * 3) }, () => {
              return { labelsRefs: [1, 2], value: 1, timestamp: 1 };
            }),
            histograms:
              next() < 0.3
                ? [
                    {
                      countInt: 1,
                      positiveSpans: [{ offset: 0, length: 1 }],
                      positiveDeltas: [1],
                    },
                  ]
                : [],
            ...(next() < 0.5 ? { metadata: { type: 1 } } : {}),
          };
        },
      );

      const body: Uint8Array = encodeV2({
        symbols: symbols,
        timeseries: timeseries,
      });

      expect(count(body, REMOTE_WRITE_V2_COUNT)).toEqual({
        outcome: ProtobufElementCountOutcome.Counted,
        elements: decodedElements(
          WriteRequestV2.decode(body),
          REMOTE_WRITE_V2_COUNT,
        ),
      });
    }
  });

  test("a packed field whose varints run past it is malformed", () => {
    // series (field 5, length 3) with labels_refs (field 1, packed, length 1) holding a 2-byte varint.
    const body: Uint8Array = Uint8Array.from([0x2a, 0x03, 0x0a, 0x01, 0x80]);

    expect(count(body, REMOTE_WRITE_V2_COUNT).outcome).toBe(
      ProtobufElementCountOutcome.Malformed,
    );
  });

  test("a packed double field that is not whole doubles is malformed", () => {
    // series (5) > histogram (3) > negative_counts (10) packed, 3 bytes.
    const body: Uint8Array = Uint8Array.from([
      0x2a, 0x07, 0x1a, 0x05, 0x52, 0x03, 0x00, 0x00, 0x00,
    ]);

    expect(count(body, REMOTE_WRITE_V2_COUNT).outcome).toBe(
      ProtobufElementCountOutcome.Malformed,
    );
  });
});

/*
 * Loki's PushRequest and the Datadog Agent's payloads, counted with the
 * schemas their endpoints hold them to: each must equal what protobufjs
 * decodes - for Datadog, the payloads as read, whose bins and metadata are
 * not decoded, so are not counted either.
 */

const pairsOf: (next: () => number, prefix: string) => Array<JSONObject> = (
  next: () => number,
  prefix: string,
): Array<JSONObject> => {
  return Array.from(
    { length: Math.floor(next() * 4) },
    (_: unknown, index: number): JSONObject => {
      return { name: `${prefix}${index}`, value: next() < 0.3 ? "" : "v" };
    },
  );
};

describe("ProtobufElementCounter - Loki's PushRequest", () => {
  test("counts every stream, entry, timestamp and label pair of structured metadata", () => {
    const body: Uint8Array = LokiPushRequestType.encode(
      LokiPushRequestType.fromObject({
        streams: [
          {
            labels: '{job="varlogs", env="prod"}',
            entries: [
              {
                timestamp: { seconds: 1700000000 },
                line: "one",
                structuredMetadata: [
                  { name: "trace_id", value: "ab" },
                  { name: "pod", value: "p" },
                ],
              },
              { line: "two" },
            ],
          },
          { labels: '{job="empty"}' },
        ],
      }),
    ).finish();

    // 2 streams + 2 entries + 1 timestamp + 2 metadata pairs.
    expect(count(body, LOKI_PUSH_COUNT)).toEqual({
      outcome: ProtobufElementCountOutcome.Counted,
      elements: 7,
    });
  });

  test("equals what protobufjs decodes, over many generated pushes", () => {
    const next: () => number = seededRandom(11);

    for (let run: number = 0; run < 200; run++) {
      const streams: Array<JSONObject> = Array.from(
        { length: Math.floor(next() * 5) },
        (_: unknown, index: number): JSONObject => {
          return {
            labels: `{job="j${index}"}`,
            hash: Math.floor(next() * 1000),
            entries: Array.from(
              { length: Math.floor(next() * 5) },
              (): JSONObject => {
                return {
                  ...(next() < 0.7
                    ? {
                        timestamp: {
                          seconds: Math.floor(next() * 1e9),
                          nanos: Math.floor(next() * 1e9),
                        },
                      }
                    : {}),
                  line: next() < 0.2 ? "" : "a line",
                  structuredMetadata: pairsOf(next, "m"),
                  parsed: next() < 0.2 ? pairsOf(next, "p") : [],
                };
              },
            ),
          };
        },
      );

      const body: Uint8Array = LokiPushRequestType.encode(
        LokiPushRequestType.fromObject({ streams: streams }),
      ).finish();

      expect(count(body, LOKI_PUSH_COUNT)).toEqual({
        outcome: ProtobufElementCountOutcome.Counted,
        elements: decodedElements(
          LokiPushRequestType.decode(body),
          LOKI_PUSH_COUNT,
        ),
      });
    }
  });

  test("16 MiB of empty streams is counted to the limit in well under a second", () => {
    const body: Buffer = Buffer.alloc(16 * 1024 * 1024);

    for (let index: number = 0; index < body.length; index += 2) {
      body[index] = 0x0a;
      body[index + 1] = 0x00;
    }

    const timed: FastestRun<ProtobufElementCount> = fastestRun({
      run: (): ProtobufElementCount => {
        return count(body, LOKI_PUSH_COUNT, 500000);
      },
      limitInMs: 1000,
    });

    expect(timed.result).toEqual({
      outcome: ProtobufElementCountOutcome.OverLimit,
      elements: 500001,
    });
    expect(timed.inMs).toBeLessThan(1000);
  });

  test("an entry that is not a message is malformed", () => {
    // A stream whose entries field is a varint.
    expect(
      count(Uint8Array.from([0x0a, 0x02, 0x10, 0x01]), LOKI_PUSH_COUNT).outcome,
    ).toBe(ProtobufElementCountOutcome.Malformed);
  });
});

describe("ProtobufElementCounter - the Datadog Agent's payloads, as read", () => {
  test("a MetricPayload: each series, resource, tag and point - and not its origin metadata", () => {
    const body: Uint8Array = DatadogMetricPayload.encode(
      DatadogMetricPayload.fromObject({
        series: [
          {
            metric: "system.cpu.user",
            resources: [{ type: "host", name: "h" }],
            tags: ["env:prod", "service:checkout"],
            points: [
              { value: 1, timestamp: 1700000000 },
              { value: 2, timestamp: 1700000010 },
            ],
            metadata: { origin: { originProduct: 10 } },
          },
        ],
      }),
    ).finish();

    // 1 series + 1 resource + 2 tags + 2 points.
    expect(count(body, DATADOG_METRIC_PAYLOAD_COUNT).elements).toBe(6);
  });

  test("a MetricPayload equals what its reading type decodes, over many generated payloads", () => {
    const next: () => number = seededRandom(13);

    for (let run: number = 0; run < 200; run++) {
      const series: Array<JSONObject> = Array.from(
        { length: Math.floor(next() * 5) },
        (): JSONObject => {
          return {
            metric: "m",
            resources: Array.from({ length: Math.floor(next() * 3) }, () => {
              return { type: "host", name: "h" };
            }),
            tags: Array.from(
              { length: Math.floor(next() * 4) },
              (_: unknown, index: number) => {
                return `t${index}:v`;
              },
            ),
            points: Array.from({ length: Math.floor(next() * 4) }, () => {
              return { value: next(), timestamp: 1700000000 };
            }),
            type: Math.floor(next() * 4),
            ...(next() < 0.5
              ? { metadata: { origin: { originProduct: 1 } } }
              : {}),
          };
        },
      );

      const body: Uint8Array = DatadogMetricPayload.encode(
        DatadogMetricPayload.fromObject({ series: series }),
      ).finish();

      expect(count(body, DATADOG_METRIC_PAYLOAD_COUNT)).toEqual({
        outcome: ProtobufElementCountOutcome.Counted,
        elements: decodedElements(
          DatadogMetricPayloadAsRead.decode(body),
          DATADOG_METRIC_PAYLOAD_COUNT,
        ),
      });
    }
  });

  test("a SketchPayload equals what its reading type decodes, its thousands of bins counted as nothing", () => {
    const next: () => number = seededRandom(17);

    for (let run: number = 0; run < 100; run++) {
      const sketches: Array<JSONObject> = Array.from(
        { length: Math.floor(next() * 4) },
        (): JSONObject => {
          const bins: number = Math.floor(next() * 3000);

          return {
            metric: "latency",
            host: "h",
            tags: Array.from({ length: Math.floor(next() * 3) }, () => {
              return "env:prod";
            }),
            dogsketches: Array.from(
              { length: Math.floor(next() * 3) },
              (): JSONObject => {
                return {
                  ts: 1700000000,
                  cnt: bins,
                  min: 1,
                  max: 9,
                  sum: 50,
                  k: Array.from(
                    { length: bins },
                    (_: unknown, index: number) => {
                      return index - 1500;
                    },
                  ),
                  n: Array.from({ length: bins }, () => {
                    return 1;
                  }),
                };
              },
            ),
            distributions:
              next() < 0.3
                ? [{ ts: 1700000000, cnt: 2, sum: 3, v: [1, 2], g: [1, 1] }]
                : [],
            metadata: { origin: { originService: 3 } },
          };
        },
      );

      const body: Uint8Array = DatadogSketchPayload.encode(
        DatadogSketchPayload.fromObject({
          sketches: sketches,
          metadata: { agentVersion: "7.60.0", apiKey: "secret" },
        }),
      ).finish();

      const decoded: unknown = DatadogSketchPayloadAsRead.decode(body);
      const expected: number = decodedElements(
        decoded,
        DATADOG_SKETCH_PAYLOAD_COUNT,
      );

      expect(count(body, DATADOG_SKETCH_PAYLOAD_COUNT)).toEqual({
        outcome: ProtobufElementCountOutcome.Counted,
        elements: expected,
      });
    }
  });
});
