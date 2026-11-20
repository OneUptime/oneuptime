import { afterEach, describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import {
  COMPATIBLE_JSON_MAX_VALUES,
  LOKI_PUSH_MAX_ELEMENTS,
} from "Common/Types/Telemetry/CompatibleIngest";
import LokiPush, {
  LokiElementBudget,
  LokiPushError,
  LokiPushRequestType,
  LokiStream,
  LokiTranslation,
} from "../../../FeatureSet/Telemetry/Utils/Compatible/LokiPush";
import SnappyBlock from "../../../FeatureSet/Telemetry/Utils/Compatible/SnappyBlock";
import { snappyCompress } from "./SnappyTestCompressor";

/*
 * Loki's push API as OTLP logs: both encodings (JSON, and the snappy
 * protobuf Promtail and Alloy send), the legacy JSON shape, label sets with
 * Go escapes, Loki 3's service-name discovery, levels from labels,
 * metadata or the line itself, and trace context from structured metadata -
 * and the limits a push is held to, counted before it is decoded and as it
 * is read, so a small body cannot become millions of objects.
 */

const NOW_MS: number = 1700000100000;

interface FlatRecord {
  resource: Record<string, unknown>;
  record: JSONObject;
  attributes: Record<string, unknown>;
}

const attributesOf: (value: unknown) => Record<string, unknown> = (
  value: unknown,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  for (const attribute of (value || []) as Array<{
    key: string;
    value: Record<string, unknown>;
  }>) {
    result[attribute.key] = Object.values(attribute.value)[0];
  }

  return result;
};

const recordsOf: (translation: LokiTranslation) => Array<FlatRecord> = (
  translation: LokiTranslation,
): Array<FlatRecord> => {
  const result: Array<FlatRecord> = [];

  for (const resourceLog of (translation.logs?.["resourceLogs"] ||
    []) as Array<JSONObject>) {
    const resource: Record<string, unknown> = attributesOf(
      (resourceLog["resource"] as JSONObject)["attributes"],
    );

    for (const scopeLog of resourceLog["scopeLogs"] as Array<JSONObject>) {
      expect((scopeLog["scope"] as JSONObject)["name"]).toBe("loki-push");

      for (const record of scopeLog["logRecords"] as Array<JSONObject>) {
        result.push({
          resource: resource,
          record: record,
          attributes: attributesOf(record["attributes"]),
        });
      }
    }
  }

  return result;
};

const translateJson: (
  body: JSONObject,
  options?: { serviceName?: string },
) => LokiTranslation = (
  body: JSONObject,
  options?: { serviceName?: string },
): LokiTranslation => {
  return LokiPush.toOtlp(LokiPush.parseJson(JSON.stringify(body)), {
    nowInMs: NOW_MS,
    ...options,
  });
};

describe("LokiPush - JSON", () => {
  test("each entry is a log record with its own time, its line and its stream's labels", () => {
    const translation: LokiTranslation = translateJson({
      streams: [
        {
          stream: { app: "checkout", env: "prod", namespace: "shop" },
          values: [
            ["1700000000123456789", "order 42 paid"],
            ["1700000001000000000", "order 43 paid"],
          ],
        },
      ],
    });

    const records: Array<FlatRecord> = recordsOf(translation);

    expect(translation.entryCount).toBe(2);
    expect(records).toHaveLength(2);
    expect(records[0]!.resource).toEqual({ "service.name": "checkout" });
    expect(records[0]!.record["timeUnixNano"]).toBe("1700000000123456789");
    expect(records[0]!.record["observedTimeUnixNano"]).toBe(
      "1700000100000000000",
    );
    expect(records[0]!.record["body"]).toEqual({
      stringValue: "order 42 paid",
    });
    expect(records[0]!.attributes).toEqual({
      app: "checkout",
      env: "prod",
      namespace: "shop",
    });
  });

  test("structured metadata becomes attributes, and its trace_id and span_id the trace context", () => {
    const records: Array<FlatRecord> = recordsOf(
      translateJson({
        streams: [
          {
            stream: { service_name: "api", level: "info" },
            values: [
              [
                "1700000000000000000",
                "GET /pay 200",
                {
                  trace_id: "4BF92F3577B34DA6A3CE929D0E0E4736",
                  span_id: "00f067aa0ba902b7",
                  user: "u-1",
                  level: "warn",
                },
              ],
            ],
          },
        ],
      }),
    );

    expect(records[0]!.record["traceId"]).toBe(
      "4bf92f3577b34da6a3ce929d0e0e4736",
    );
    expect(records[0]!.record["spanId"]).toBe("00f067aa0ba902b7");
    // A name in both keeps the metadata's value.
    expect(records[0]!.attributes).toMatchObject({
      service_name: "api",
      level: "warn",
      user: "u-1",
    });
    expect(records[0]!.record["severityNumber"]).toBe(13);
  });

  test("the legacy shape - labels as a string, entries with RFC 3339 times - is read too", () => {
    const records: Array<FlatRecord> = recordsOf(
      translateJson({
        streams: [
          {
            labels: '{job="varlogs", filename="/var/log/syslog"}',
            entries: [
              { ts: "2023-11-14T22:13:20.123456789Z", line: "kernel: hello" },
            ],
          },
        ],
      }),
    );

    expect(records[0]!.resource).toEqual({ "service.name": "varlogs" });
    expect(records[0]!.record["timeUnixNano"]).toBe("1700000000123456789");
    expect(records[0]!.attributes).toEqual({
      job: "varlogs",
      filename: "/var/log/syslog",
    });
  });

  test("an entry with an unreadable time is stamped with the time it arrived", () => {
    const records: Array<FlatRecord> = recordsOf(
      translateJson({
        streams: [
          {
            stream: { app: "a" },
            values: [
              ["not-a-time", "one"],
              ["0", "two"],
              [1700000000000000000, "three"],
            ],
          },
        ],
      }),
    );

    expect(records[0]!.record["timeUnixNano"]).toBe("1700000100000000000");
    expect(records[1]!.record["timeUnixNano"]).toBe("1700000100000000000");
    expect(records[2]!.record["timeUnixNano"]).toBe("1700000000000000000");
  });

  test("entries that are not [time, line] are skipped", () => {
    const translation: LokiTranslation = translateJson({
      streams: [
        {
          stream: { app: "a" },
          values: [
            ["1700000000000000000"],
            [1, 2],
            "x",
            ["1700000000000000000", "ok"],
          ],
        },
        "not a stream",
        { stream: { app: "b" }, values: [] },
      ] as unknown as JSONObject[],
    });

    expect(translation.entryCount).toBe(1);
  });

  test("a body with no streams, or no entries, holds nothing", () => {
    expect(translateJson({ streams: [] }).logs).toBeNull();
    expect(
      translateJson({ streams: [{ stream: { app: "a" }, values: [] }] }).logs,
    ).toBeNull();
  });

  test.each<[string, string]>([
    ["not JSON", "streams: nope"],
    ["no streams array", '{"stream": {}}'],
    ["a JSON array", "[]"],
  ])("refuses a body that is %s", (_name: string, body: string) => {
    expect(() => {
      LokiPush.parseJson(body);
    }).toThrow(LokiPushError);
  });
});

describe("LokiPush - service names", () => {
  test.each<[Record<string, string>, string | undefined]>([
    [{ service_name: "a", service: "b", app: "c", job: "j" }, "a"],
    [{ service: "b", app: "c", job: "j" }, "b"],
    [{ app: "c", container: "x", job: "j" }, "c"],
    [{ app_kubernetes_io_name: "frontend", job: "j" }, "frontend"],
    [{ container: "redis", job: "docker" }, "redis"],
    [{ job: "systemd-journal" }, "systemd-journal"],
    [{ filename: "/var/log/x.log" }, undefined],
  ])(
    "labels %o name the service %s",
    (labels: Record<string, string>, expected: string | undefined) => {
      const records: Array<FlatRecord> = recordsOf(
        translateJson({
          streams: [{ stream: labels, values: [["1700000000000000000", "x"]] }],
        }),
      );

      expect(records[0]!.resource["service.name"]).toBe(expected);
    },
  );

  test("an x-oneuptime-service-name header names it instead", () => {
    const records: Array<FlatRecord> = recordsOf(
      translateJson(
        {
          streams: [
            { stream: { app: "c" }, values: [["1700000000000000000", "x"]] },
          ],
        },
        { serviceName: "storefront" },
      ),
    );

    expect(records[0]!.resource["service.name"]).toBe("storefront");
    expect(records[0]!.attributes["app"]).toBe("c");
  });

  test("a host label is the resource's host.name, and streams group by service and host", () => {
    const translation: LokiTranslation = translateJson({
      streams: [
        {
          stream: { app: "a", host: "web-1" },
          values: [["1700000000000000000", "1"]],
        },
        {
          stream: { app: "a", host: "web-1", stream: "stderr" },
          values: [["1700000000000000000", "2"]],
        },
        {
          stream: { app: "a", hostname: "web-2" },
          values: [["1700000000000000000", "3"]],
        },
      ],
    });

    const resourceLogs: Array<JSONObject> = translation.logs![
      "resourceLogs"
    ] as Array<JSONObject>;

    expect(resourceLogs).toHaveLength(2);
    expect(recordsOf(translation)[0]!.resource).toEqual({
      "service.name": "a",
      "host.name": "web-1",
    });
  });
});

describe("LokiPush - levels", () => {
  const severityOf: (
    labels: Record<string, string>,
    line: string,
    metadata?: Record<string, string>,
  ) => number = (
    labels: Record<string, string>,
    line: string,
    metadata?: Record<string, string>,
  ): number => {
    const value: Array<unknown> = ["1700000000000000000", line];

    if (metadata) {
      value.push(metadata);
    }

    return recordsOf(
      translateJson({
        streams: [
          { stream: labels, values: [value] as unknown as JSONObject[] },
        ],
      }),
    )[0]!.record["severityNumber"] as number;
  };

  test.each<[string, Record<string, string>, string, number]>([
    ["a level label", { level: "error" }, "x", 17],
    ["a detected_level label", { detected_level: "warn" }, "x", 13],
    ["a severity label", { severity: "debug" }, "x", 5],
    ["a logfmt level in the line", {}, 'ts=1 level=error msg="boom"', 17],
    ["a quoted logfmt level", {}, 'level="warning" msg=x', 13],
    // log15's dbug: a level word every log ingest reads (issue #8536).
    ["a logfmt lvl", {}, "lvl=dbug msg=x", 5],
    ["a logfmt lvl that names no level", {}, "lvl=chatty msg=x", 0],
    // The shared level words, as every other path reads them.
    ["a critical level label", { level: "critical" }, "x", 21],
    ["a crit level label", { level: "crit" }, "x", 18],
    ["a verbose level label", { level: "verbose" }, "x", 5],
    ["a panic level label", { level: "panic" }, "x", 19],
    ["a Serilog short level label", { level: "WRN" }, "x", 13],
    ["a numbered step", { level: "ERROR3" }, "x", 19],
    ["a level named like an Object member", { level: "constructor" }, "x", 0],
    ["a logfmt lvl it knows", {}, "lvl=info msg=x", 9],
    ["a JSON line's level", {}, '{"level":"fatal","msg":"down"}', 21],
    ["a JSON line's severity", {}, '{"severity":"INFO","msg":"up"}', 9],
    ["a word that only looks like a key", {}, "mylevel=error happened", 0],
    ["no level anywhere", {}, "just words, error included", 0],
  ])(
    "from %s",
    (
      _name: string,
      labels: Record<string, string>,
      line: string,
      expected: number,
    ) => {
      expect(severityOf(labels, line)).toBe(expected);
    },
  );

  test("structured metadata's level wins over the stream's", () => {
    expect(
      severityOf({ level: "info" }, "x", { detected_level: "error" }),
    ).toBe(17);
  });

  test("a JSON line too long to parse falls back to logfmt detection", () => {
    const line: string = `{"level":"error","pad":"${"x".repeat(20_000)}"}`;

    expect(LokiPush.detectLevel(line).number).toBe(0);
  });
});

describe("LokiPush.parseLabelSet", () => {
  test.each<[string, Array<[string, string]>]>([
    ["{}", []],
    ["", []],
    ['{app="checkout"}', [["app", "checkout"]]],
    [
      '{app="checkout", env="prod",region="eu-west-1"}',
      [
        ["app", "checkout"],
        ["env", "prod"],
        ["region", "eu-west-1"],
      ],
    ],
    ['{msg="say \\"hi\\"\\n"}', [["msg", 'say "hi"\n']]],
    ['{path="C:\\\\logs"}', [["path", "C:\\logs"]]],
    ['{emoji="\\u00e9\\U0001F600\\x41"}', [["emoji", "é😀A"]]],
    [
      "{a='single', b=`raw \\n`}",
      [
        ["a", "single"],
        ["b", "raw \\n"],
      ],
    ],
    [
      '  app = "spaced" , env="x"  ',
      [
        ["app", "spaced"],
        ["env", "x"],
      ],
    ],
    ['{a="}"}', [["a", "}"]]],
    ['{a="1",}', [["a", "1"]]],
  ])("reads %s", (input: string, expected: Array<[string, string]>) => {
    expect(LokiPush.parseLabelSet(input)).toEqual(expected);
  });

  test.each<[string]>([
    ['{app="checkout"'],
    ["{app=checkout}"],
    ['{="x"}'],
    ['{app "x"}'],
    ['{app="unterminated}'],
    ['{a="1" b="2"}'],
    ['{a="\\q"}'],
    ['{a="\\u12"}'],
  ])("refuses %s", (input: string) => {
    expect(() => {
      LokiPush.parseLabelSet(input);
    }).toThrow(LokiPushError);
  });
});

describe("LokiPush - protobuf", () => {
  const encode: (request: JSONObject) => Buffer = (
    request: JSONObject,
  ): Buffer => {
    return Buffer.from(
      LokiPushRequestType.encode(
        LokiPushRequestType.fromObject(request),
      ).finish(),
    );
  };

  test("a snappy-compressed PushRequest, as Promtail and Alloy send it", () => {
    const body: Buffer = snappyCompress(
      encode({
        streams: [
          {
            labels:
              '{job="varlogs", host="web-1", filename="/var/log/app.log"}',
            entries: [
              {
                timestamp: { seconds: 1700000000, nanos: 123456789 },
                line: 'level=error msg="payment failed"',
                structuredMetadata: [
                  {
                    name: "trace_id",
                    value: "0af7651916cd43dd8448eb211c80319c",
                  },
                ],
              },
              {
                timestamp: { seconds: 1700000001, nanos: 0 },
                line: "level=info msg=ok",
              },
            ],
          },
        ],
      }),
    );

    const streams: Array<LokiStream> = LokiPush.parseProtobuf(
      SnappyBlock.decompress(body, 64 * 1024 * 1024),
    );
    const records: Array<FlatRecord> = recordsOf(
      LokiPush.toOtlp(streams, { nowInMs: NOW_MS }),
    );

    expect(records).toHaveLength(2);
    expect(records[0]!.resource).toEqual({
      "service.name": "varlogs",
      "host.name": "web-1",
    });
    expect(records[0]!.record["timeUnixNano"]).toBe("1700000000123456789");
    expect(records[0]!.record["severityNumber"]).toBe(17);
    expect(records[0]!.record["traceId"]).toBe(
      "0af7651916cd43dd8448eb211c80319c",
    );
    expect(records[0]!.attributes).toEqual({
      job: "varlogs",
      host: "web-1",
      filename: "/var/log/app.log",
      trace_id: "0af7651916cd43dd8448eb211c80319c",
    });
    expect(records[1]!.record["timeUnixNano"]).toBe("1700000001000000000");
    expect(records[1]!.record["severityNumber"]).toBe(9);
  });

  test("an entry with no timestamp is stamped with the time it arrived", () => {
    const streams: Array<LokiStream> = LokiPush.parseProtobuf(
      encode({ streams: [{ labels: '{app="a"}', entries: [{ line: "x" }] }] }),
    );

    expect(
      recordsOf(LokiPush.toOtlp(streams, { nowInMs: NOW_MS }))[0]!.record[
        "timeUnixNano"
      ],
    ).toBe("1700000100000000000");
  });

  test("bytes that are not a PushRequest are refused", () => {
    expect(() => {
      LokiPush.parseProtobuf(Buffer.from([0x0a, 0xff, 0xff, 0xff, 0xff, 0x0f]));
    }).toThrow(LokiPushError);
  });

  test("a malformed label set in a protobuf stream is refused", () => {
    expect(() => {
      LokiPush.parseProtobuf(
        encode({ streams: [{ labels: "{app=", entries: [{ line: "x" }] }] }),
      );
    }).toThrow(LokiPushError);
  });

  test("the output is plain JSON", () => {
    const translation: LokiTranslation = LokiPush.toOtlp(
      LokiPush.parseProtobuf(
        encode({
          streams: [
            {
              labels: '{app="a"}',
              entries: [{ timestamp: { seconds: 1700000000 }, line: "x" }],
            },
          ],
        }),
      ),
      { nowInMs: NOW_MS },
    );

    expect(JSON.parse(JSON.stringify(translation.logs))).toEqual(
      translation.logs,
    );
  });
});

// A LokiPushError's status: 413 over a limit, 400 for a body it cannot read.
const refusalOf: (read: () => unknown) => {
  status: number;
  message: string;
} = (read: () => unknown): { status: number; message: string } => {
  try {
    read();
  } catch (error) {
    if (error instanceof LokiPushError) {
      return { status: error.statusCode, message: error.message };
    }

    throw error;
  }

  throw new Error("Expected the push to be refused.");
};

const encodePush: (request: JSONObject) => Buffer = (
  request: JSONObject,
): Buffer => {
  return Buffer.from(
    LokiPushRequestType.encode(
      LokiPushRequestType.fromObject(request),
    ).finish(),
  );
};

// One stream of `labels` labels and `entries` entries, in either encoding.
const pushOf: (
  labels: number,
  entries: number,
  metadata?: number,
) => { json: string; protobuf: Buffer } = (
  labels: number,
  entries: number,
  metadata?: number,
): { json: string; protobuf: Buffer } => {
  const labelPairs: Array<[string, string]> = Array.from(
    { length: labels },
    (_: unknown, index: number): [string, string] => {
      return [`l${index}`, "v"];
    },
  );
  const metadataPairs: Array<[string, string]> = Array.from(
    { length: metadata ?? 0 },
    (_: unknown, index: number): [string, string] => {
      return [`m${index}`, "v"];
    },
  );

  return {
    json: JSON.stringify({
      streams: [
        {
          stream: Object.fromEntries(labelPairs),
          values: Array.from({ length: entries }, (): Array<unknown> => {
            return metadataPairs.length > 0
              ? [
                  "1700000000000000000",
                  "line",
                  Object.fromEntries(metadataPairs),
                ]
              : ["1700000000000000000", "line"];
          }),
        },
      ],
    }),
    protobuf: encodePush({
      streams: [
        {
          labels: `{${labelPairs
            .map(([name, value]: [string, string]): string => {
              return `${name}="${value}"`;
            })
            .join(", ")}}`,
          entries: Array.from({ length: entries }, (): JSONObject => {
            return {
              timestamp: { seconds: 1700000000 },
              line: "line",
              structuredMetadata: metadataPairs.map(
                ([name, value]: [string, string]): JSONObject => {
                  return { name: name, value: value };
                },
              ),
            };
          }),
        },
      ],
    }),
  };
};

describe("LokiPush - limits", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a stream's labels count once for each of its entries, in both encodings", () => {
    // 1 stream + 3 labels + 1 entry, then 4 for each entry after it: 25.
    const atTheLimit: { json: string; protobuf: Buffer } = pushOf(3, 6);
    const pastIt: { json: string; protobuf: Buffer } = pushOf(3, 7);

    expect(
      LokiPush.parseJson(atTheLimit.json, { maxElements: 25 })[0]!.entries,
    ).toHaveLength(6);
    expect(
      LokiPush.parseProtobuf(atTheLimit.protobuf, { maxElements: 25 })[0]!
        .entries,
    ).toHaveLength(6);
    expect(
      refusalOf(() => {
        return LokiPush.parseJson(pastIt.json, { maxElements: 25 });
      }).status,
    ).toBe(413);
    expect(
      refusalOf(() => {
        return LokiPush.parseProtobuf(pastIt.protobuf, { maxElements: 25 });
      }).status,
    ).toBe(413);
  });

  test("an entry's structured metadata counts too", () => {
    /*
     * 1 stream + 1 label, then 2 entries of 1 + 3 metadata, the second with
     * its stream's label too: 1 + 1 + 4 + 5 = 11.
     */
    const push: { json: string; protobuf: Buffer } = pushOf(1, 2, 3);

    expect(LokiPush.parseJson(push.json, { maxElements: 11 })).toHaveLength(1);
    expect(
      LokiPush.parseProtobuf(push.protobuf, { maxElements: 11 }),
    ).toHaveLength(1);
    expect(
      refusalOf(() => {
        return LokiPush.parseJson(push.json, { maxElements: 10 });
      }).status,
    ).toBe(413);
    expect(
      refusalOf(() => {
        return LokiPush.parseProtobuf(push.protobuf, { maxElements: 10 });
      }).status,
    ).toBe(413);
  });

  test("the legacy JSON shape's label set and entries are counted alike", () => {
    const legacy: string = JSON.stringify({
      streams: [
        {
          labels: '{app="a", env="b"}',
          entries: [
            { ts: "2023-11-14T22:13:20Z", line: "one" },
            { ts: "2023-11-14T22:13:21Z", line: "two" },
          ],
        },
      ],
    });

    // 1 stream + 2 labels + 1 entry + (1 + 2) for the second: 7.
    expect(LokiPush.parseJson(legacy, { maxElements: 7 })).toHaveLength(1);
    expect(
      refusalOf(() => {
        return LokiPush.parseJson(legacy, { maxElements: 6 });
      }).status,
    ).toBe(413);
  });

  test("a 413 says what was refused, and how to send less", () => {
    expect(
      refusalOf(() => {
        return LokiPush.parseJson(pushOf(5, 1000).json, { maxElements: 100 });
      }),
    ).toEqual({
      status: 413,
      message:
        "The push holds more than 100 entries, labels and structured metadata, a stream's labels counted once for each of its entries. Send fewer entries a push: lower the client's batch size.",
    });
  });

  test("a protobuf push of more elements than the limit is refused before it is decoded", () => {
    const decode: jest.SpyInstance = jest.spyOn(LokiPushRequestType, "decode");
    const streams: number = LOKI_PUSH_MAX_ELEMENTS + 1;
    const body: Buffer = Buffer.alloc(streams * 2);

    for (let index: number = 0; index < streams; index++) {
      body[index * 2] = 0x0a;
      body[index * 2 + 1] = 0x00;
    }

    expect(
      refusalOf(() => {
        return LokiPush.parseProtobuf(body);
      }),
    ).toEqual({
      status: 413,
      message: LokiPush.tooManyElements(LOKI_PUSH_MAX_ELEMENTS).message,
    });
    expect(decode).not.toHaveBeenCalled();
  });

  test("a protobuf push that is not a PushRequest is a 400, and is not decoded", () => {
    const decode: jest.SpyInstance = jest.spyOn(LokiPushRequestType, "decode");

    expect(
      refusalOf(() => {
        return LokiPush.parseProtobuf(Buffer.from([0x0a, 0x05, 0x0a]));
      }).status,
    ).toBe(400);
    expect(decode).not.toHaveBeenCalled();
  });

  test("a JSON push of more values than JSON may hold is refused before it is parsed", () => {
    const body: string = `{"streams":[${"{},".repeat(COMPATIBLE_JSON_MAX_VALUES)}{}]}`;
    const parse: jest.SpyInstance = jest.spyOn(JSON, "parse");

    const refusal: { status: number; message: string } = refusalOf(() => {
      return LokiPush.parseJson(body);
    });

    expect(parse).not.toHaveBeenCalled();
    expect(refusal.status).toBe(413);
    expect(refusal.message).toBe(
      `The request holds more than ${COMPATIBLE_JSON_MAX_VALUES} JSON values (objects, arrays, strings and numbers). Send fewer entries a push: lower the client's batch size.`,
    );
  });

  test("a JSON push of half a million empty streams - within the values JSON may hold - is refused as it is read", () => {
    // One JSON value a stream: past the push's limit, not JSON's.
    const body: string = `{"streams":[${"{},".repeat(LOKI_PUSH_MAX_ELEMENTS)}{}]}`;

    expect(
      refusalOf(() => {
        return LokiPush.parseJson(body);
      }),
    ).toEqual({
      status: 413,
      message: LokiPush.tooManyElements(LOKI_PUSH_MAX_ELEMENTS).message,
    });
  });

  test("a default Promtail batch - 1 MiB of 100-byte lines from a stream of five labels - is far inside the limits", () => {
    const line: string = "x".repeat(100);
    const entries: number = Math.floor((1024 * 1024) / 120);
    const body: Buffer = encodePush({
      streams: [
        {
          labels:
            '{job="varlogs", host="web-1", env="prod", app="checkout", filename="/var/log/app.log"}',
          entries: Array.from({ length: entries }, (): JSONObject => {
            return { timestamp: { seconds: 1700000000 }, line: line };
          }),
        },
      ],
    });

    const streams: Array<LokiStream> = LokiPush.parseProtobuf(body);

    expect(streams[0]!.entries).toHaveLength(entries);
    // 1 + 5 labels + every entry with its labels: about 52,000 of 500,000.
    expect(1 + 5 + entries + (entries - 1) * 5).toBeLessThan(
      LOKI_PUSH_MAX_ELEMENTS / 9,
    );
  });
});

describe("LokiPush.parseLabelSet - size", () => {
  test("a label value of 4 MiB is read exactly, in well under a second", () => {
    const value: string = 'a\\"b'.repeat(1024 * 1024);
    const startedAt: number = Date.now();

    const labels: Array<[string, string]> = LokiPush.parseLabelSet(
      `{big="${value}", small="x"}`,
    );

    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(labels).toHaveLength(2);
    expect(labels[0]![1]).toBe('a"b'.repeat(1024 * 1024));
    expect(labels[1]).toEqual(["small", "x"]);
  });

  test("a set of 200,000 labels is read in well under a second", () => {
    const set: string = `{${Array.from(
      { length: 200000 },
      (_: unknown, index: number): string => {
        return `l${index}="v${index}"`;
      },
    ).join(",")}}`;
    const startedAt: number = Date.now();

    const labels: Array<[string, string]> = LokiPush.parseLabelSet(set);

    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(labels).toHaveLength(200000);
    expect(labels[199999]).toEqual(["l199999", "v199999"]);
  });

  test("each label is counted as it is read: a set past the push's limit stops there, with a 413", () => {
    const budget: LokiElementBudget = new LokiElementBudget(3);

    expect(
      refusalOf(() => {
        return LokiPush.parseLabelSet('{a="1", b="2", c="3", d="4"}', budget);
      }).status,
    ).toBe(413);
    expect(
      LokiPush.parseLabelSet('{a="1", b="2", c="3"}', new LokiElementBudget(3)),
    ).toHaveLength(3);
  });

  test("whitespace is read as \\s reads it, Unicode's included", () => {
    expect(LokiPush.parseLabelSet('{ app =\t"x"　,\vb="y"\f}')).toEqual([
      ["app", "x"],
      ["b", "y"],
    ]);
  });
});
