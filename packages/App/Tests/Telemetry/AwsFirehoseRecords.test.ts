import zlib from "zlib";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  FIREHOSE_MAX_ERROR_MESSAGE_LENGTH,
  FIREHOSE_MAX_REQUEST_ID_LENGTH,
  FirehoseEnvelopeReading,
  buildFirehoseResponseBody,
  readFirehoseEnvelope,
  readFirehoseRequestId,
} from "../../FeatureSet/Telemetry/Utils/AwsFirehose/FirehoseContract";
import {
  decodeJsonMetricRecord,
  readJsonMetricUpdate,
  stampConnection,
} from "../../FeatureSet/Telemetry/Utils/AwsFirehose/CloudWatchMetricStream";
import {
  CloudWatchLogsMessage,
  DecodeBudget,
  inferCloudWatchLogSeverity,
  readCloudWatchLogsMessage,
  readConcatenatedJson,
  readRecordText,
} from "../../FeatureSet/Telemetry/Utils/AwsFirehose/CloudWatchLogs";
import {
  DecodedDelivery,
  decodeFirehoseRecords,
  readRegionFromSourceArn,
} from "../../FeatureSet/Telemetry/Utils/AwsFirehose/FirehoseRecords";
import AwsFirehoseIngestService from "../../FeatureSet/Telemetry/Services/AwsFirehoseIngestService";
import {
  CONTROL_MESSAGE_DOCUMENT,
  cloudWatchLogsDocument,
  cloudWatchLogsRecord,
  openTelemetryMetric,
  openTelemetryRecord,
  openTelemetryRequest,
} from "./Helpers/FakeFirehose";

/*
 * The pieces of the stream endpoint, one at a time: Firehose's envelope and
 * answer, a metric stream's JSON format, a CloudWatch Logs delivery and the
 * severity its lines say, how each record is told apart - an OpenTelemetry
 * record whose first byte is "{" too - and how a delivery is split into
 * jobs. Everything that reads text from outside reads it in one pass:
 * 400,000 characters of the worst case in well under two seconds.
 */

function budget(): DecodeBudget {
  return { bytesLeft: 32 * 1024 * 1024, perRecordBytes: 8 * 1024 * 1024 };
}

describe("Firehose's request id", () => {
  test("is echoed as Firehose wrote it: a GUID", () => {
    expect(readFirehoseRequestId("ed4acda5-034f-9f42-bba1-f29aea6d7d8f")).toBe(
      "ed4acda5-034f-9f42-bba1-f29aea6d7d8f",
    );
    expect(readFirehoseRequestId(["a-1", "b-2"])).toBe("a-1");
  });

  test("anything that is not one is not echoed", () => {
    for (const value of [
      undefined,
      42,
      "",
      "has space",
      '"><script>',
      "x".repeat(FIREHOSE_MAX_REQUEST_ID_LENGTH + 1),
    ]) {
      expect(readFirehoseRequestId(value)).toBe("");
    }
  });
});

describe("Firehose's answer", () => {
  const NOW: Date = new Date("2026-11-04T10:00:00.000Z");

  test("is the request's id and the time it was processed", () => {
    expect(
      JSON.parse(
        buildFirehoseResponseBody({ requestId: "r-1", now: NOW }).toString(),
      ),
    ).toEqual({ requestId: "r-1", timestamp: NOW.getTime() });
  });

  test("a refusal says why, cut so the whole answer stays under 1,000 bytes", () => {
    const body: Buffer = buildFirehoseResponseBody({
      requestId: "r".repeat(FIREHOSE_MAX_REQUEST_ID_LENGTH),
      now: NOW,
      errorMessage: "é".repeat(5000),
    });

    expect(body.length).toBeLessThan(2000);
    expect(
      (JSON.parse(body.toString()) as JSONObject)["errorMessage"],
    ).toHaveLength(FIREHOSE_MAX_ERROR_MESSAGE_LENGTH);

    const ascii: Buffer = buildFirehoseResponseBody({
      requestId: "r".repeat(FIREHOSE_MAX_REQUEST_ID_LENGTH),
      now: NOW,
      errorMessage: "a".repeat(5000),
    });

    expect(ascii.length).toBeLessThan(1000);
  });
});

describe("Firehose's envelope", () => {
  test("is its records' data in order, empty records left out", () => {
    const reading: FirehoseEnvelopeReading = readFirehoseEnvelope(
      Buffer.from(
        JSON.stringify({
          requestId: "r-1",
          timestamp: 1578090901599,
          records: [{ data: "aGVsbG8=" }, { data: "" }, { data: "d29ybGQ=" }],
        }),
      ),
    );

    expect(reading).toEqual({
      envelope: {
        requestId: "r-1",
        timestamp: 1578090901599,
        records: ["aGVsbG8=", "d29ybGQ="],
      },
    });
  });

  test.each([
    ["not JSON", "hello"],
    ["no records", '{"requestId":"r"}'],
    ["records not a list", '{"records":{}}'],
    ["a record not an object", '{"records":["aGVsbG8="]}'],
    ["data not text", '{"records":[{"data":42}]}'],
    ["an array", "[]"],
  ])("%s is what it says it is", (_name: string, text: string) => {
    expect("problem" in readFirehoseEnvelope(Buffer.from(text))).toBe(true);
  });

  test("holds at most 10,000 records, each of Firehose's own size", () => {
    expect(
      "problem" in
        readFirehoseEnvelope(
          Buffer.from(
            JSON.stringify({
              records: Array.from({ length: 10_001 }).map(() => {
                return { data: "YQ==" };
              }),
            }),
          ),
        ),
    ).toBe(true);
    expect(
      "problem" in
        readFirehoseEnvelope(
          Buffer.from(JSON.stringify({ records: [{ data: "a".repeat(1_365_337) }] })),
        ),
    ).toBe(true);
  });
});

describe("the stream's Region", () => {
  test("is read from the Firehose stream's ARN", () => {
    expect(
      readRegionFromSourceArn(
        "arn:aws:firehose:eu-central-1:123456789012:deliverystream/OneUptime-x-logs",
      ),
    ).toBe("eu-central-1");
    expect(
      readRegionFromSourceArn([
        "arn:aws-us-gov:firehose:us-gov-west-1:123456789012:deliverystream/x",
      ]),
    ).toBe("us-gov-west-1");
  });

  test("is nothing for anything else", () => {
    for (const value of [
      undefined,
      "",
      "arn:aws:s3:::bucket",
      "arn:aws:firehose:not a region:1:x",
      `arn:aws:firehose:${"x".repeat(3000)}`,
    ]) {
      expect(readRegionFromSourceArn(value)).toBe("");
    }
  });
});

describe("a metric stream's JSON format", () => {
  test("an update is the OpenTelemetry 1.0 summary of its minute", () => {
    const update: { accountId: string; region: string; metric: JSONObject } | null =
      readJsonMetricUpdate({
        metric_stream_name: "OneUptime-6f1c3a2e",
        account_id: "123456789012",
        region: "us-east-1",
        namespace: "AWS/ELB",
        metric_name: "RequestCount",
        dimensions: {
          AvailabilityZone: "us-east-1a",
          LoadBalancerName: "some-load-balancer",
        },
        timestamp: 1611929698000,
        value: { max: 10.0, min: 0.0, sum: 12.0, count: 2.0, "p99.9": 9.5 },
        unit: "Count",
      });

    expect(update).toEqual({
      accountId: "123456789012",
      region: "us-east-1",
      metric: {
        name: "amazonaws.com/AWS/ELB/RequestCount",
        unit: "Count",
        summary: {
          dataPoints: [
            {
              timeUnixNano: "1611929698000000000",
              count: 2,
              sum: 12,
              quantileValues: [
                { quantile: 0, value: 0 },
                { quantile: 0.999, value: 9.5 },
                { quantile: 1, value: 10 },
              ],
              attributes: [
                { key: "Namespace", value: { stringValue: "AWS/ELB" } },
                { key: "MetricName", value: { stringValue: "RequestCount" } },
                {
                  key: "Dimensions",
                  value: {
                    kvlistValue: {
                      values: [
                        {
                          key: "AvailabilityZone",
                          value: { stringValue: "us-east-1a" },
                        },
                        {
                          key: "LoadBalancerName",
                          value: { stringValue: "some-load-balancer" },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    });
  });

  test("a record's lines are grouped by account and Region; a line that is no update is skipped", () => {
    const line: (accountId: string, region: string) => string = (
      accountId: string,
      region: string,
    ): string => {
      return JSON.stringify({
        account_id: accountId,
        region,
        namespace: "AWS/EC2",
        metric_name: "CPUUtilization",
        dimensions: { InstanceId: "i-1" },
        timestamp: 1,
        value: { sum: 1, count: 1 },
      });
    };

    const resources: Array<JSONObject> = decodeJsonMetricRecord(
      [
        line("111111111111", "us-east-1"),
        "not json",
        '{"account_id":"1"}',
        line("111111111111", "us-east-1"),
        line("222222222222", "eu-west-1"),
        "",
      ].join("\n"),
    );

    expect(resources).toHaveLength(2);
    expect(
      (
        (resources[0]!["scopeMetrics"] as Array<JSONObject>)[0]![
          "metrics"
        ] as JSONArray
      ).length,
    ).toBe(2);
  });

  test("is read in one pass: 400,000 characters of newlines", () => {
    const run: FastestRun<number> = fastestRun({
      run: (): number => {
        return decodeJsonMetricRecord("\n".repeat(400_000)).length;
      },
      limitInMs: 2000,
    });

    expect(run.result).toBe(0);
    expect(run.inMs).toBeLessThan(2000);
  });
});

describe("the connection's stamp on a streamed resource", () => {
  test("puts the connection's service and id first, and drops any the record carries", () => {
    const stamped: JSONObject = stampConnection({
      resourceMetrics: {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "forged" } },
            { key: "cloud.provider", value: { stringValue: "gcp" } },
            { key: "cloud.account.id", value: { stringValue: "123" } },
          ],
        },
        scopeMetrics: [],
      },
      serviceName: "Production AWS",
      connectionId: "33333333-3333-4333-8333-333333333333",
    });

    expect((stamped["resource"] as JSONObject)["attributes"]).toEqual([
      { key: "service.name", value: { stringValue: "Production AWS" } },
      { key: "cloud.provider", value: { stringValue: "aws" } },
      {
        key: "oneuptime.cloud.connection.id",
        value: { stringValue: "33333333-3333-4333-8333-333333333333" },
      },
      { key: "cloud.account.id", value: { stringValue: "123" } },
    ]);
  });
});

describe("a CloudWatch Logs delivery", () => {
  test("is read gzipped or not", async () => {
    const document: JSONObject = cloudWatchLogsDocument({
      logGroup: "/aws/lambda/checkout",
      logStream: "s",
      events: [{ id: "1", timestamp: 1, message: "m" }],
    });

    for (const gzip of [true, false]) {
      const text: string = await readRecordText(
        cloudWatchLogsRecord(document, { gzip }),
        budget(),
      );

      expect(readCloudWatchLogsMessage(JSON.parse(text))?.logGroup).toBe(
        "/aws/lambda/checkout",
      );
    }
  });

  test("of more documents than one, one after the other, is read whole", () => {
    const documents: Array<unknown> = readConcatenatedJson(
      `{"messageType":"DATA_MESSAGE","logEvents":[{"message":"a } { b \\" }"}]}{"x":1}\n{"y":"{"}`,
    );

    expect(documents).toEqual([
      {
        messageType: "DATA_MESSAGE",
        logEvents: [{ message: 'a } { b " }' }],
      },
      { x: 1 },
      { y: "{" },
    ]);
  });

  test("events without a time are left out; a type that is not CloudWatch Logs' is no delivery", () => {
    const message: CloudWatchLogsMessage | null = readCloudWatchLogsMessage({
      messageType: "DATA_MESSAGE",
      owner: "123456789012",
      logGroup: "g",
      logStream: "s",
      logEvents: [
        { id: "1", timestamp: 5, message: "kept" },
        { id: "2", message: "no time" },
        "not an event",
      ],
    });

    expect(message?.logEvents).toEqual([{ id: "1", timestamp: 5, message: "kept" }]);
    expect(readCloudWatchLogsMessage({ messageType: "OTHER" })).toBeNull();
    expect(readCloudWatchLogsMessage(null)).toBeNull();
  });

  test("a gzip that decompresses past its budget is refused, not held", async () => {
    await expect(
      readRecordText(zlib.gzipSync(Buffer.alloc(2 * 1024 * 1024)), {
        bytesLeft: 32 * 1024 * 1024,
        perRecordBytes: 1024 * 1024,
      }),
    ).rejects.toThrow();
  });

  test("reads 400,000 characters of unclosed braces and strings in one pass", () => {
    for (const worst of [
      "{".repeat(400_000),
      `{"${"\\".repeat(400_000)}`,
      '{"a":"}{"'.repeat(50_000),
    ]) {
      const run: FastestRun<number> = fastestRun({
        run: (): number => {
          return readConcatenatedJson(worst).length;
        },
        limitInMs: 2000,
      });

      expect(run.inMs).toBeLessThan(2000);
    }
  });
});

describe("the severity a log line says", () => {
  test.each([
    // Node.js on Lambda.
    ["2026-11-04T09:59:01.200Z\t0b1d2c3e-1111\tERROR\tPayment failed", "ERROR"],
    ["2026-11-04T09:59:01.200Z\t0b1d2c3e-1111\tWARN\tslow", "WARN"],
    ["2026-11-04T09:59:01.200Z\t0b1d2c3e-1111\tINFO\tpaid", "INFO"],
    ["2026-11-04T09:59:01.200Z\t0b1d2c3e-1111\tDEBUG\tx", "DEBUG"],
    // Python on Lambda.
    ["[ERROR]\t2026-11-04T09:59:01.200Z\treq\tTraceback", "ERROR"],
    ["[WARNING]\t2026-11-04T09:59:01.200Z\treq\tdeprecated", "WARN"],
    // Lambda's JSON log format, and loggers that write JSON.
    ['{"timestamp":"2026-11-04T09:59:01Z","level":"ERROR","message":"x"}', "ERROR"],
    ['{"severity":"warning","msg":"x"}', "WARN"],
    ['{"levelname":"CRITICAL"}', "FATAL"],
    // A first word that is a level.
    ["ERROR: deadlock detected", "ERROR"],
    ["FATAL could not start", "FATAL"],
    ["[info] ready", "INFO"],
  ])("%s is %s", (message: string, severity: string) => {
    expect(inferCloudWatchLogSeverity(message)?.text).toBe(severity);
  });

  test.each([
    "START RequestId: 0b1d2c3e Version: $LATEST",
    "REPORT RequestId: 0b1d2c3e Duration: 12.3 ms",
    "Errors were fixed",
    '{"level":42}',
    "{not json",
    "",
  ])("%s says none", (message: string) => {
    expect(inferCloudWatchLogSeverity(message)).toBeNull();
  });

  test("reads only the start of a long line", () => {
    const run: FastestRun<string | undefined> = fastestRun({
      run: (): string | undefined => {
        return inferCloudWatchLogSeverity(
          `x\t${"\t".repeat(400_000)}`,
        )?.text;
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);

    const longJson: string = `{"level":"error","pad":"${"a".repeat(400_000)}"}`;

    // Too long to parse for its level: read as text, which says none.
    expect(inferCloudWatchLogSeverity(longJson)).toBeNull();
  });
});

describe("telling records apart", () => {
  const CONNECTION_ID: string = "33333333-3333-4333-8333-333333333333";

  async function decode(records: Array<Buffer>): Promise<DecodedDelivery> {
    return await decodeFirehoseRecords({
      records: records.map((record: Buffer): string => {
        return record.toString("base64");
      }),
      serviceName: "Production AWS",
      connectionId: CONNECTION_ID,
      region: "us-east-1",
      now: new Date(),
      budget: budget(),
    });
  }

  test("an OpenTelemetry record whose first byte is '{' is still a metric record", async () => {
    // A message of 123 bytes is led by the varint 123: "{".
    let record: Buffer = Buffer.alloc(0);

    for (let length: number = 1; length < 120; length++) {
      record = openTelemetryRecord([
        {
          resourceMetrics: [
            {
              resource: {
                attributes: [
                  { key: "cloud.account.id", value: { stringValue: "1" } },
                ],
              },
              scopeMetrics: [
                {
                  metrics: [
                    {
                      name: "m".repeat(length),
                      summary: {
                        dataPoints: [
                          {
                            sum: 1,
                            count: 1,
                            attributes: [
                              {
                                key: "Namespace",
                                value: { stringValue: "AWS/EC2" },
                              },
                            ],
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]);

      if (record[0] === 0x7b) {
        break;
      }
    }

    expect(record[0]).toBe(0x7b);
    expect(record.length).toBe(124);

    const delivery: DecodedDelivery = await decode([record]);

    expect(delivery.unrecognized).toBe(0);
    expect(delivery.datapoints).toBe(1);
  });

  test("counts the test message, the records that are none of the formats, and the rest", async () => {
    const delivery: DecodedDelivery = await decode([
      cloudWatchLogsRecord(CONTROL_MESSAGE_DOCUMENT),
      Buffer.from("plain text", "utf8"),
      openTelemetryRecord([
        openTelemetryRequest([
          openTelemetryMetric({
            namespace: "AWS/EC2",
            metricName: "CPUUtilization",
            dimensions: { InstanceId: "i-1" },
            count: 1,
            sum: 1,
            min: 1,
            max: 1,
          }),
        ]),
      ]),
      cloudWatchLogsRecord(
        cloudWatchLogsDocument({
          logGroup: "/aws/lambda/a",
          logStream: "s",
          events: [
            { id: "1", timestamp: 1, message: "x" },
            { id: "2", timestamp: 2, message: "y" },
          ],
        }),
      ),
    ]);

    expect(delivery.controlMessages).toBe(1);
    expect(delivery.unrecognized).toBe(1);
    expect(delivery.datapoints).toBe(1);
    expect(delivery.logEvents).toBe(2);
    expect(Array.from(delivery.sightings.logs.values())).toEqual([
      {
        accountId: "123456789012",
        region: "us-east-1",
        logGroups: new Set(["/aws/lambda/a"]),
      },
    ]);
  });

  test("a record cut short is left out", async () => {
    const whole: Buffer = openTelemetryRecord([
      openTelemetryRequest([
        openTelemetryMetric({
          namespace: "AWS/EC2",
          metricName: "CPUUtilization",
          dimensions: { InstanceId: "i-1" },
          count: 1,
          sum: 1,
          min: 1,
          max: 1,
        }),
      ]),
    ]);

    const delivery: DecodedDelivery = await decode([
      whole.subarray(0, whole.length - 5),
    ]);

    expect(delivery.unrecognized).toBe(1);
    expect(delivery.resourceMetrics).toEqual([]);
  });
});

describe("splitting a delivery into jobs", () => {
  test("keeps whole resources together, up to the limit, and one larger alone", () => {
    const resource: (count: number) => { resource: JSONObject; count: number } = (
      count: number,
    ): { resource: JSONObject; count: number } => {
      return { resource: { count }, count };
    };

    expect(
      AwsFirehoseIngestService.chunk(
        [resource(4), resource(5), resource(3), resource(20), resource(1)],
        10,
      ),
    ).toEqual([
      [{ count: 4 }, { count: 5 }],
      [{ count: 3 }],
      [{ count: 20 }],
      [{ count: 1 }],
    ]);
    expect(AwsFirehoseIngestService.chunk([], 10)).toEqual([]);
  });
});
