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
  MAX_REMEMBERED_STREAMED_SERIES,
  STREAMED_KEY_METRICS,
  STREAMED_SERIES_MEMORY_MS,
  StreamedSeriesMemory,
  countDimensions,
  decodeJsonMetricRecord,
  readJsonMetricUpdate,
  readStatisticValue,
  shapeStreamedKeyMetrics,
  stampConnection,
} from "../../FeatureSet/Telemetry/Utils/AwsFirehose/CloudWatchMetricStream";
import {
  AWS_KEY_METRICS,
  AwsKeyMetric,
  AwsNamespaceKeyMetrics,
  getAwsStoredMetricName,
} from "Common/Types/Cloud/CloudKeyMetrics";
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
          Buffer.from(
            JSON.stringify({ records: [{ data: "a".repeat(1_365_337) }] }),
          ),
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
    const update: {
      accountId: string;
      region: string;
      metric: JSONObject;
    } | null = readJsonMetricUpdate({
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

    expect(message?.logEvents).toEqual([
      { id: "1", timestamp: 5, message: "kept" },
    ]);
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
    [
      '{"timestamp":"2026-11-04T09:59:01Z","level":"ERROR","message":"x"}',
      "ERROR",
    ],
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
        return inferCloudWatchLogSeverity(`x\t${"\t".repeat(400_000)}`)?.text;
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
    const resource: (count: number) => {
      resource: JSONObject;
      count: number;
    } = (count: number): { resource: JSONObject; count: number } => {
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

/*
 * The key metrics a stream delivers, in the shape a connection's read
 * writes them: a gauge of the read's statistic, for each resource's own
 * aggregate - so that, while the read leaves a namespace to the stream,
 * every chart and monitor of a key metric reads one series of one type.
 */
describe("the key metrics, shaped as the connection's read writes them", () => {
  const CONNECTION_ID: string = "33333333-3333-4333-8333-333333333333";
  const NOW: Date = new Date("2026-11-04T10:01:30.000Z");
  const MINUTE_START_NANOS: string = `${Date.UTC(2026, 10, 4, 9, 59)}000000`;
  const MINUTE_END_NANOS: string = `${Date.UTC(2026, 10, 4, 10, 0)}000000`;

  function attribute(key: string, value: string): JSONObject {
    return { key, value: { stringValue: value } };
  }

  // One summary datapoint of a minute, as protobuf's toJSON gives it.
  function summaryPoint(data: {
    namespace: string;
    metricName: string;
    dimensions: Record<string, string>;
    count: number | string;
    sum: number;
    quantiles?: Array<JSONObject> | undefined;
  }): JSONObject {
    return {
      startTimeUnixNano: MINUTE_START_NANOS,
      timeUnixNano: MINUTE_END_NANOS,
      count: data.count,
      sum: data.sum,
      quantileValues: (data.quantiles || []) as unknown as JSONArray,
      attributes: [
        attribute("Namespace", data.namespace),
        attribute("MetricName", data.metricName),
        {
          key: "Dimensions",
          value: {
            kvlistValue: {
              values: Object.entries(data.dimensions).map(
                ([key, value]: [string, string]) => {
                  return attribute(key, value);
                },
              ),
            },
          },
        },
      ],
    };
  }

  function resourceOf(
    metrics: Array<JSONObject>,
    accountId: string = "123456789012",
  ): JSONObject {
    return {
      resource: {
        attributes: [
          attribute("service.name", "Production AWS"),
          attribute("cloud.provider", "aws"),
          attribute("oneuptime.cloud.connection.id", CONNECTION_ID),
          attribute("cloud.account.id", accountId),
          attribute("cloud.region", "us-east-1"),
        ],
      },
      scopeMetrics: [{ scope: { name: "s" }, metrics }],
    };
  }

  function summaryMetric(name: string, points: Array<JSONObject>): JSONObject {
    return { name, unit: "1", summary: { dataPoints: points } };
  }

  function metricsOf(resources: Array<JSONObject>): Array<JSONObject> {
    return resources.flatMap((resource: JSONObject) => {
      return (resource["scopeMetrics"] as Array<JSONObject>).flatMap(
        (scope: JSONObject) => {
          return scope["metrics"] as Array<JSONObject>;
        },
      );
    });
  }

  function gaugeValues(resources: Array<JSONObject>): Array<number> {
    return metricsOf(resources).flatMap((metric: JSONObject) => {
      return (
        ((metric["gauge"] as JSONObject)?.["dataPoints"] as
          | Array<JSONObject>
          | undefined) || []
      ).map((point: JSONObject) => {
        return point["asDouble"] as number;
      });
    });
  }

  async function shape(
    resources: Array<JSONObject>,
    memory: StreamedSeriesMemory = new StreamedSeriesMemory(),
    data: { now?: Date; connectionId?: string } = {},
  ): Promise<Array<JSONObject>> {
    return await shapeStreamedKeyMetrics({
      resources,
      connectionId: data.connectionId || CONNECTION_ID,
      now: data.now || NOW,
      memory,
    });
  }

  function invocations(
    dimensions: Record<string, string>,
    sum: number,
  ): JSONObject {
    return summaryPoint({
      namespace: "AWS/Lambda",
      metricName: "Invocations",
      dimensions,
      count: 1,
      sum,
    });
  }

  test("every key metric is known by its stored name, with the one statistic and unit the read reads", () => {
    const expected: Map<string, { statistic: string; unit: string }> =
      new Map();

    for (const namespace of AWS_KEY_METRICS as ReadonlyArray<AwsNamespaceKeyMetrics>) {
      for (const metric of namespace.metrics as ReadonlyArray<AwsKeyMetric>) {
        const name: string = getAwsStoredMetricName(
          namespace.namespace,
          metric.metricName,
        ).toLowerCase();
        const known: { statistic: string; unit: string } | undefined =
          expected.get(name);

        // A metric two namespaces' entries list is read one way.
        if (known) {
          expect(known).toEqual({
            statistic: metric.statistic,
            unit: metric.unit,
          });
          continue;
        }

        expected.set(name, { statistic: metric.statistic, unit: metric.unit });
      }
    }

    expect(new Map(STREAMED_KEY_METRICS)).toEqual(expected);
    expect(
      STREAMED_KEY_METRICS.get("amazonaws.com/aws/ec2/cpuutilization"),
    ).toEqual({ statistic: "Average", unit: "Percent" });
  });

  test("a minute's summary is the value of the statistic: Average, Sum, Maximum and Minimum", () => {
    const point: JSONObject = summaryPoint({
      namespace: "AWS/EC2",
      metricName: "CPUUtilization",
      dimensions: { InstanceId: "i-1" },
      // A fixed64 count is a string of digits in OTLP/JSON.
      count: "4",
      sum: 50,
      quantiles: [
        { quantile: 0, value: 2 },
        { quantile: 0.99, value: 29 },
        { quantile: 1, value: 30 },
      ],
    });

    expect(readStatisticValue(point, "Average")).toBe(12.5);
    expect(readStatisticValue(point, "Sum")).toBe(50);
    expect(readStatisticValue(point, "Maximum")).toBe(30);
    expect(readStatisticValue(point, "Minimum")).toBe(2);
  });

  test("protobuf's left-out zeros are read as zeros: a quantile 0, a value 0", () => {
    const point: JSONObject = summaryPoint({
      namespace: "AWS/Route53",
      metricName: "HealthCheckStatus",
      dimensions: { HealthCheckId: "h-1" },
      count: 6,
      sum: 5,
      // toJSON writes neither the quantile 0 nor a value 0.
      quantiles: [{}, { quantile: 1, value: 1 }],
    });

    expect(readStatisticValue(point, "Minimum")).toBe(0);
    expect(readStatisticValue(point, "Maximum")).toBe(1);
  });

  test("a minute without an observation, or without the quantile asked for, says nothing", () => {
    const empty: JSONObject = summaryPoint({
      namespace: "AWS/EC2",
      metricName: "CPUUtilization",
      dimensions: { InstanceId: "i-1" },
      count: 0,
      sum: 0,
    });
    const single: JSONObject = summaryPoint({
      namespace: "AWS/EC2",
      metricName: "StatusCheckFailed",
      dimensions: { InstanceId: "i-1" },
      count: 1,
      sum: 1,
    });
    const several: JSONObject = summaryPoint({
      namespace: "AWS/EC2",
      metricName: "StatusCheckFailed",
      dimensions: { InstanceId: "i-1" },
      count: 3,
      sum: 1,
    });

    for (const statistic of ["Average", "Sum", "Maximum", "Minimum"] as const) {
      expect(readStatisticValue(empty, statistic)).toBeNull();
    }

    // One observation is its own maximum; three without their quantiles are not.
    expect(readStatisticValue(single, "Maximum")).toBe(1);
    expect(readStatisticValue(several, "Maximum")).toBeNull();
    expect(readStatisticValue(several, "Average")).toBeCloseTo(1 / 3, 10);
  });

  test("a datapoint's dimensions are its Dimensions kvlist's entries with a value", () => {
    expect(
      countDimensions(
        summaryPoint({
          namespace: "AWS/Lambda",
          metricName: "Invocations",
          dimensions: { FunctionName: "checkout", Resource: "checkout:live" },
          count: 1,
          sum: 1,
        })["attributes"] as JSONArray,
      ),
    ).toBe(2);
    expect(
      countDimensions([
        attribute("Namespace", "AWS/Lambda"),
        {
          key: "Dimensions",
          value: {
            kvlistValue: {
              values: [attribute("FunctionName", " "), attribute("A", "b")],
            },
          },
        },
      ]),
    ).toBe(1);
    expect(countDimensions([attribute("Namespace", "AWS/Lambda")])).toBe(0);
  });

  test("a key metric becomes the read's gauge: its name, its unit, the start of its minute, its attributes", async () => {
    const point: JSONObject = summaryPoint({
      namespace: "AWS/EC2",
      metricName: "CPUUtilization",
      dimensions: { InstanceId: "i-1" },
      count: 4,
      sum: 50,
    });
    const shaped: Array<JSONObject> = await shape([
      resourceOf([
        summaryMetric("amazonaws.com/AWS/EC2/CPUUtilization", [point]),
      ]),
    ]);

    expect(metricsOf(shaped)).toEqual([
      {
        name: "amazonaws.com/AWS/EC2/CPUUtilization",
        unit: "Percent",
        gauge: {
          dataPoints: [
            {
              startTimeUnixNano: MINUTE_START_NANOS,
              timeUnixNano: MINUTE_START_NANOS,
              asDouble: 12.5,
              attributes: point["attributes"],
            },
          ],
        },
      },
    ]);
  });

  test("a minute with no start time is written at the time it has", async () => {
    const point: JSONObject = summaryPoint({
      namespace: "AWS/EC2",
      metricName: "CPUUtilization",
      dimensions: { InstanceId: "i-1" },
      count: 1,
      sum: 7,
    });
    delete point["startTimeUnixNano"];

    const shaped: Array<JSONObject> = await shape([
      resourceOf([
        summaryMetric("amazonaws.com/AWS/EC2/CPUUtilization", [point]),
      ]),
    ]);
    const written: JSONObject = (
      (metricsOf(shaped)[0]!["gauge"] as JSONObject)[
        "dataPoints"
      ] as Array<JSONObject>
    )[0]!;

    expect(written["timeUnixNano"]).toBe(MINUTE_END_NANOS);
  });

  test("a metric that is not a key one is left as the stream sent it, and so is its resource", async () => {
    const resource: JSONObject = resourceOf([
      summaryMetric("amazonaws.com/AWS/EC2/CPUCreditBalance", [
        summaryPoint({
          namespace: "AWS/EC2",
          metricName: "CPUCreditBalance",
          dimensions: { InstanceId: "i-1" },
          count: 5,
          sum: 390,
        }),
      ]),
    ]);
    const shaped: Array<JSONObject> = await shape([resource]);

    expect(shaped).toEqual([resource]);
    expect(shaped[0]).toBe(resource);
  });

  test("a resource's own aggregate is kept, and its splits left out", async () => {
    const shaped: Array<JSONObject> = await shape([
      resourceOf([
        summaryMetric("amazonaws.com/AWS/Lambda/Invocations", [
          invocations(
            { FunctionName: "checkout", Resource: "checkout:live" },
            100,
          ),
          invocations({ FunctionName: "checkout" }, 120),
          invocations(
            {
              FunctionName: "checkout",
              Resource: "checkout:live",
              ExecutedVersion: "7",
            },
            100,
          ),
          invocations({ FunctionName: "refunds" }, 3),
        ]),
      ]),
    ]);

    expect(gaugeValues(shaped)).toEqual([120, 3]);
  });

  test("a series of no resource - the namespace's own total - is left out, as the read leaves it", async () => {
    const shaped: Array<JSONObject> = await shape([
      resourceOf([
        summaryMetric("amazonaws.com/AWS/Lambda/Invocations", [
          invocations({}, 500),
          invocations({ FunctionName: "checkout" }, 120),
        ]),
      ]),
    ]);

    expect(gaugeValues(shaped)).toEqual([120]);
  });

  test("when no series is a resource's own, every series with its fewest dimensions is kept", async () => {
    const node: (nodeId: string, sum: number) => JSONObject = (
      nodeId: string,
      sum: number,
    ): JSONObject => {
      return summaryPoint({
        namespace: "AWS/ElastiCache",
        metricName: "CPUUtilization",
        dimensions: { CacheClusterId: "sessions-001", CacheNodeId: nodeId },
        count: 1,
        sum,
      });
    };

    expect(
      gaugeValues(
        await shape([
          resourceOf([
            summaryMetric("amazonaws.com/AWS/ElastiCache/CPUUtilization", [
              node("0001", 20),
              node("0002", 40),
            ]),
          ]),
        ]),
      ),
    ).toEqual([20, 40]);
  });

  test("the same resource of two accounts is two resources", async () => {
    const shaped: Array<JSONObject> = await shape([
      resourceOf(
        [
          summaryMetric("amazonaws.com/AWS/Lambda/Invocations", [
            invocations({ FunctionName: "checkout" }, 120),
          ]),
        ],
        "111111111111",
      ),
      resourceOf(
        [
          summaryMetric("amazonaws.com/AWS/Lambda/Invocations", [
            invocations(
              { FunctionName: "checkout", Resource: "checkout:7" },
              9,
            ),
          ]),
        ],
        "222222222222",
      ),
    ]);

    expect(gaugeValues(shaped)).toEqual([120, 9]);
  });

  test("a split that comes after its resource's aggregate is left out too, for an hour", async () => {
    const memory: StreamedSeriesMemory = new StreamedSeriesMemory();
    const split: () => Array<JSONObject> = (): Array<JSONObject> => {
      return [
        resourceOf([
          summaryMetric("amazonaws.com/AWS/Lambda/Invocations", [
            invocations(
              { FunctionName: "checkout", Resource: "checkout:live" },
              100,
            ),
          ]),
        ]),
      ];
    };

    await shape(
      [
        resourceOf([
          summaryMetric("amazonaws.com/AWS/Lambda/Invocations", [
            invocations({ FunctionName: "checkout" }, 120),
          ]),
        ]),
      ],
      memory,
    );

    expect(gaugeValues(await shape(split(), memory))).toEqual([]);
    expect(
      gaugeValues(
        await shape(split(), memory, {
          now: new Date(NOW.getTime() + STREAMED_SERIES_MEMORY_MS - 1000),
        }),
      ),
    ).toEqual([]);

    // An hour after the aggregate last came - its splits never kept it - they are written.
    expect(
      gaugeValues(
        await shape(split(), memory, {
          now: new Date(NOW.getTime() + STREAMED_SERIES_MEMORY_MS + 1000),
        }),
      ),
    ).toEqual([100]);
  });

  test("what one connection's deliveries carried never decides another's", async () => {
    const memory: StreamedSeriesMemory = new StreamedSeriesMemory();

    await shape(
      [
        resourceOf([
          summaryMetric("amazonaws.com/AWS/Lambda/Invocations", [
            invocations({ FunctionName: "checkout" }, 120),
          ]),
        ]),
      ],
      memory,
    );

    expect(
      gaugeValues(
        await shape(
          [
            resourceOf([
              summaryMetric("amazonaws.com/AWS/Lambda/Invocations", [
                invocations(
                  { FunctionName: "checkout", Resource: "checkout:live" },
                  100,
                ),
              ]),
            ]),
          ],
          memory,
          { connectionId: "44444444-4444-4444-8444-444444444444" },
        ),
      ),
    ).toEqual([100]);
  });

  test("a key metric left with no datapoint is left out of its scope", async () => {
    const shaped: Array<JSONObject> = await shape([
      resourceOf([
        summaryMetric("amazonaws.com/AWS/Lambda/Invocations", [
          summaryPoint({
            namespace: "AWS/Lambda",
            metricName: "Invocations",
            dimensions: { FunctionName: "checkout" },
            count: 0,
            sum: 0,
          }),
        ]),
        summaryMetric("amazonaws.com/AWS/Lambda/ConcurrentExecutions", [
          summaryPoint({
            namespace: "AWS/Lambda",
            metricName: "ConcurrentExecutions",
            dimensions: { FunctionName: "checkout" },
            count: 1,
            sum: 4,
          }),
        ]),
      ]),
    ]);

    expect(
      metricsOf(shaped).map((metric: JSONObject) => {
        return metric["name"];
      }),
    ).toEqual(["amazonaws.com/AWS/Lambda/ConcurrentExecutions"]);
  });

  test("the memory holds at most its bound, the oldest let go first", () => {
    const memory: StreamedSeriesMemory = new StreamedSeriesMemory();

    for (
      let index: number = 0;
      index < MAX_REMEMBERED_STREAMED_SERIES + 5;
      index++
    ) {
      memory.note(`series-${index}`, 1, NOW);
    }

    expect(memory.size).toBe(MAX_REMEMBERED_STREAMED_SERIES);
    expect(memory.get("series-0", NOW)).toBeUndefined();
    expect(
      memory.get(`series-${MAX_REMEMBERED_STREAMED_SERIES + 4}`, NOW),
    ).toBe(1);
  });

  test("a delivery in the JSON format is shaped the same", async () => {
    const shaped: Array<JSONObject> = await shape(
      decodeJsonMetricRecord(
        [
          JSON.stringify({
            metric_stream_name: "OneUptime-6f1c3a2e",
            account_id: "123456789012",
            region: "us-east-1",
            namespace: "AWS/Lambda",
            metric_name: "Duration",
            dimensions: { FunctionName: "checkout" },
            timestamp: Date.UTC(2026, 10, 4, 9, 59),
            value: { max: 900, min: 100, sum: 1500, count: 5 },
            unit: "Milliseconds",
          }),
          JSON.stringify({
            metric_stream_name: "OneUptime-6f1c3a2e",
            account_id: "123456789012",
            region: "us-east-1",
            namespace: "AWS/Lambda",
            metric_name: "Duration",
            dimensions: { FunctionName: "checkout", Resource: "checkout:live" },
            timestamp: Date.UTC(2026, 10, 4, 9, 59),
            value: { max: 900, min: 100, sum: 1500, count: 5 },
            unit: "Milliseconds",
          }),
        ].join("\n"),
      ),
    );

    // The Average the read reads - 300 ms - once, not the 1,500 ms sum twice.
    expect(gaugeValues(shaped)).toEqual([300]);
    expect(metricsOf(shaped)[0]!["unit"]).toBe("Milliseconds");
  });
});
