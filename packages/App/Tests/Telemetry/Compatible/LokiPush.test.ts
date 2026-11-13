import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import LokiPush, {
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
 * metadata or the line itself, and trace context from structured metadata.
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
    ["a logfmt lvl", {}, "lvl=dbug msg=x", 0],
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
