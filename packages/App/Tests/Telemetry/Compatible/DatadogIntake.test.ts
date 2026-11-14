import { describe, expect, it, test } from "@jest/globals";
import protobuf from "protobufjs";
import { JSONObject } from "Common/Types/JSON";
import DatadogIntake, {
  DatadogIntakeError,
  DatadogLogsOptions,
  DatadogLogsTranslation,
  DatadogMetricPayload,
  DatadogMetricsTranslation,
  DatadogSketchPayload,
  MAX_DATADOG_LOGS_PER_REQUEST,
} from "../../../FeatureSet/Telemetry/Utils/Compatible/DatadogIntake";

/*
 * The Datadog Agent's and Datadog HTTP API's intake payloads as OTLP:
 * logs (/api/v2/logs) as log records, series (/api/v1/series and
 * /api/v2/series, JSON and the Agent's protobuf) as gauges and delta
 * sums, sketches (/api/beta/sketches) as summaries, and service checks
 * (/api/v1/check_run) as gauges. Tags become attributes, Datadog's
 * reserved tags also name the resource, and what OTLP JSON cannot carry
 * is dropped and counted.
 */

type Attributes = Record<string, unknown>;

interface KeyValue {
  key: string;
  value: Record<string, unknown>;
}

// 2023-11-14T22:15:00Z; the payloads below are from 22:13:20 on.
const NOW_MS: number = 1700000100000;
const NOW_UNIX_NANO: string = "1700000100000000000";

const kv: (key: string, value: string) => KeyValue = (
  key: string,
  value: string,
): KeyValue => {
  return { key: key, value: { stringValue: value } };
};

// A record's, datapoint's or resource's attributes, as key -> value.
const attributesOf: (item: unknown) => Attributes = (
  item: unknown,
): Attributes => {
  const result: Attributes = {};

  for (const attribute of ((item as JSONObject)["attributes"] ||
    []) as unknown as Array<KeyValue>) {
    result[attribute.key] = Object.values(attribute.value)[0];
  }

  return result;
};

const attributeKeysOf: (item: unknown) => Array<string> = (
  item: unknown,
): Array<string> => {
  return ((item as JSONObject)["attributes"] as unknown as Array<KeyValue>).map(
    (attribute: KeyValue): string => {
      return attribute.key;
    },
  );
};

const resourceLogsOf: (
  translation: DatadogLogsTranslation,
) => Array<JSONObject> = (
  translation: DatadogLogsTranslation,
): Array<JSONObject> => {
  expect(translation.logs).not.toBeNull();
  return (translation.logs as JSONObject)["resourceLogs"] as Array<JSONObject>;
};

const logRecordsOf: (resource: JSONObject) => Array<JSONObject> = (
  resource: JSONObject,
): Array<JSONObject> => {
  const scopeLogs: Array<JSONObject> = resource[
    "scopeLogs"
  ] as Array<JSONObject>;

  expect(scopeLogs).toHaveLength(1);
  expect(scopeLogs[0]!["scope"]).toEqual({ name: "datadog" });

  return scopeLogs[0]!["logRecords"] as Array<JSONObject>;
};

const allLogRecordsOf: (
  translation: DatadogLogsTranslation,
) => Array<JSONObject> = (
  translation: DatadogLogsTranslation,
): Array<JSONObject> => {
  const records: Array<JSONObject> = [];

  for (const resource of resourceLogsOf(translation)) {
    records.push(...logRecordsOf(resource));
  }

  return records;
};

// The one record a body of one log becomes, and its resource.
const translateLog: (
  log: Record<string, unknown>,
  options?: DatadogLogsOptions,
) => { record: JSONObject; resource: Attributes } = (
  log: Record<string, unknown>,
  options?: DatadogLogsOptions,
): { record: JSONObject; resource: Attributes } => {
  const translation: DatadogLogsTranslation = DatadogIntake.logsToOtlp(
    JSON.stringify([log]),
    { nowInMs: NOW_MS, ...options },
  );

  expect(translation.count).toBe(1);
  expect(translation.droppedCount).toBe(0);

  const resources: Array<JSONObject> = resourceLogsOf(translation);
  expect(resources).toHaveLength(1);

  const records: Array<JSONObject> = logRecordsOf(resources[0]!);
  expect(records).toHaveLength(1);

  return {
    record: records[0]!,
    resource: attributesOf(resources[0]!["resource"]),
  };
};

const resourceMetricsOf: (
  translation: DatadogMetricsTranslation,
) => Array<JSONObject> = (
  translation: DatadogMetricsTranslation,
): Array<JSONObject> => {
  expect(translation.metrics).not.toBeNull();
  return (translation.metrics as JSONObject)[
    "resourceMetrics"
  ] as Array<JSONObject>;
};

const metricsOf: (resource: JSONObject) => Array<JSONObject> = (
  resource: JSONObject,
): Array<JSONObject> => {
  const scopeMetrics: Array<JSONObject> = resource[
    "scopeMetrics"
  ] as Array<JSONObject>;

  expect(scopeMetrics).toHaveLength(1);
  expect(scopeMetrics[0]!["scope"]).toEqual({ name: "datadog" });

  return scopeMetrics[0]!["metrics"] as Array<JSONObject>;
};

// A metric's datapoints, whichever of gauge, sum and summary it is.
const dataPointsOf: (metric: JSONObject) => Array<JSONObject> = (
  metric: JSONObject,
): Array<JSONObject> => {
  const data: JSONObject = (metric["gauge"] ||
    metric["sum"] ||
    metric["summary"]) as JSONObject;

  return data["dataPoints"] as Array<JSONObject>;
};

// Every datapoint of a translation, in order.
const allDataPointsOf: (
  translation: DatadogMetricsTranslation,
) => Array<JSONObject> = (
  translation: DatadogMetricsTranslation,
): Array<JSONObject> => {
  const dataPoints: Array<JSONObject> = [];

  for (const resource of resourceMetricsOf(translation)) {
    for (const metric of metricsOf(resource)) {
      dataPoints.push(...dataPointsOf(metric));
    }
  }

  return dataPoints;
};

const errorOf: (run: () => unknown) => DatadogIntakeError = (
  run: () => unknown,
): DatadogIntakeError => {
  try {
    run();
  } catch (error) {
    if (error instanceof DatadogIntakeError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected a DatadogIntakeError.");
};

const hex: (bytes: string) => Buffer = (bytes: string): Buffer => {
  return Buffer.from(bytes.replace(/\s+/g, ""), "hex");
};

const encodeMetricPayload: (payload: Record<string, unknown>) => Uint8Array = (
  payload: Record<string, unknown>,
): Uint8Array => {
  return DatadogMetricPayload.encode(
    DatadogMetricPayload.fromObject(payload),
  ).finish();
};

const encodeSketchPayload: (payload: Record<string, unknown>) => Uint8Array = (
  payload: Record<string, unknown>,
): Uint8Array => {
  return DatadogSketchPayload.encode(
    DatadogSketchPayload.fromObject(payload),
  ).finish();
};

/*
 * What the Agent's logs pipeline posts (pkg/logs' JSON encoder): message,
 * status, timestamp in milliseconds, hostname, service, ddsource and
 * ddtags - two services on two hosts here.
 */
const AGENT_LOGS: Array<JSONObject> = [
  {
    message: "GET /checkout 200 12ms",
    status: "info",
    timestamp: 1700000000123,
    hostname: "web-1",
    service: "checkout",
    ddsource: "nginx",
    ddtags: "env:prod,version:1.4.2,team:payments,kube_namespace:shop,canary",
  },
  {
    message: "upstream timed out (110: Connection timed out)",
    status: "error",
    timestamp: 1700000001456,
    hostname: "web-1",
    service: "checkout",
    ddsource: "nginx",
    ddtags: "env:prod,version:1.4.2,team:payments,kube_namespace:shop,canary",
  },
  {
    message: "cache warmed in 840ms",
    status: "warn",
    timestamp: 1700000002000,
    hostname: "worker-7",
    service: "cache",
    ddsource: "python",
    ddtags: "env:staging",
  },
];

/*
 * One log as Datadog's winston HTTP transport posts it, with dd-trace's
 * log injection: the trace context nested under "dd", in decimal.
 */
const WINSTON_LOG: JSONObject = {
  level: "warn",
  message: "Payment declined",
  timestamp: "2023-11-14T22:13:20.123Z",
  orderId: 42,
  amount: 19.99,
  retried: false,
  user: { id: "u_1", plan: "pro" },
  items: ["sku-1", "sku-2"],
  coupon: null,
  dd: {
    trace_id: "1234567890123456789",
    span_id: "987654321098765432",
    service: "checkout",
    env: "prod",
    version: "1.4.2",
  },
};

describe("DatadogIntake.logsToOtlp: what the Agent sends", () => {
  it("makes each service, host, environment and version a resource, and each log a record", () => {
    const translation: DatadogLogsTranslation = DatadogIntake.logsToOtlp(
      Buffer.from(JSON.stringify(AGENT_LOGS)),
      { nowInMs: NOW_MS },
    );

    expect(translation.count).toBe(3);
    expect(translation.droppedCount).toBe(0);

    const resources: Array<JSONObject> = resourceLogsOf(translation);
    expect(resources).toHaveLength(2);

    expect((resources[0]!["resource"] as JSONObject)["attributes"]).toEqual([
      kv("service.name", "checkout"),
      kv("host.name", "web-1"),
      kv("deployment.environment.name", "prod"),
      kv("service.version", "1.4.2"),
    ]);
    expect((resources[1]!["resource"] as JSONObject)["attributes"]).toEqual([
      kv("service.name", "cache"),
      kv("host.name", "worker-7"),
      kv("deployment.environment.name", "staging"),
    ]);

    const checkout: Array<JSONObject> = logRecordsOf(resources[0]!);
    expect(checkout).toHaveLength(2);

    expect(checkout[0]).toEqual({
      timeUnixNano: "1700000000123000000",
      observedTimeUnixNano: NOW_UNIX_NANO,
      severityNumber: 9,
      severityText: "INFO",
      body: { stringValue: "GET /checkout 200 12ms" },
      attributes: [
        kv("datadog.source", "nginx"),
        kv("env", "prod"),
        kv("version", "1.4.2"),
        kv("team", "payments"),
        kv("kube_namespace", "shop"),
        kv("datadog.tags", "canary"),
      ],
    });

    expect(checkout[1]).toMatchObject({
      timeUnixNano: "1700000001456000000",
      severityNumber: 17,
      severityText: "ERROR",
      body: { stringValue: "upstream timed out (110: Connection timed out)" },
    });

    const cache: Array<JSONObject> = logRecordsOf(resources[1]!);
    expect(cache).toEqual([
      {
        timeUnixNano: "1700000002000000000",
        observedTimeUnixNano: NOW_UNIX_NANO,
        severityNumber: 13,
        severityText: "WARN",
        body: { stringValue: "cache warmed in 840ms" },
        attributes: [kv("datadog.source", "python"), kv("env", "staging")],
      },
    ]);
  });

  it("survives JSON.stringify unchanged", () => {
    const translation: DatadogLogsTranslation = DatadogIntake.logsToOtlp(
      JSON.stringify([...AGENT_LOGS, WINSTON_LOG]),
      { nowInMs: NOW_MS },
    );

    expect(JSON.parse(JSON.stringify(translation.logs))).toStrictEqual(
      translation.logs,
    );
  });

  it("observes the logs now when no time is given", () => {
    const before: number = Date.now();
    const translation: DatadogLogsTranslation = DatadogIntake.logsToOtlp(
      '{"message":"no clock"}',
    );
    const after: number = Date.now();

    const record: JSONObject = allLogRecordsOf(translation)[0]!;
    const observed: bigint = BigInt(record["observedTimeUnixNano"] as string);

    expect(observed >= BigInt(before) * BigInt(1_000_000)).toBe(true);
    expect(observed <= BigInt(after) * BigInt(1_000_000)).toBe(true);
    expect(record["timeUnixNano"]).toBe(record["observedTimeUnixNano"]);
  });
});

describe("DatadogIntake.logsToOtlp: Datadog's log libraries and tracers", () => {
  it("reads a single log, its nested dd-trace context and the request's query parameters", () => {
    const original: string = JSON.stringify(WINSTON_LOG);

    const translation: DatadogLogsTranslation = DatadogIntake.logsToOtlp(
      JSON.stringify(WINSTON_LOG),
      {
        nowInMs: NOW_MS,
        query: {
          ddsource: "nodejs",
          service: "checkout-api",
          hostname: "web-2",
          ddtags: "env:prod,team:payments",
        },
      },
    );

    expect(translation.count).toBe(1);

    const resources: Array<JSONObject> = resourceLogsOf(translation);
    expect(resources).toHaveLength(1);

    // dd.service is the log's own service, so it wins over ?service=.
    expect((resources[0]!["resource"] as JSONObject)["attributes"]).toEqual([
      kv("service.name", "checkout"),
      kv("host.name", "web-2"),
      kv("deployment.environment.name", "prod"),
    ]);

    expect(logRecordsOf(resources[0]!)).toEqual([
      {
        timeUnixNano: "1700000000123000000",
        observedTimeUnixNano: NOW_UNIX_NANO,
        severityNumber: 13,
        severityText: "WARN",
        body: { stringValue: "Payment declined" },
        attributes: [
          kv("datadog.source", "nodejs"),
          { key: "orderId", value: { intValue: "42" } },
          { key: "amount", value: { doubleValue: 19.99 } },
          { key: "retried", value: { boolValue: false } },
          kv("user.id", "u_1"),
          kv("user.plan", "pro"),
          kv("items", '["sku-1","sku-2"]'),
          kv("dd.env", "prod"),
          kv("dd.version", "1.4.2"),
          kv("env", "prod"),
          kv("team", "payments"),
        ],
        traceId: "0000000000000000112210f47de98115",
        spanId: "0db4da5f49f8b478",
      },
    ]);

    // The log it read is left as it was.
    expect(JSON.stringify(WINSTON_LOG)).toBe(original);
  });

  it("lets a log's own source and host win over the query's, and adds the query's tags to its own", () => {
    const { record, resource } = translateLog(
      {
        message: "m",
        ddsource: "java",
        hostname: "app-3",
        ddtags: "env:prod",
      },
      {
        query: {
          ddsource: "nodejs",
          hostname: "web-2",
          service: "from-query",
          ddtags: "team:payments,env:staging",
        },
      },
    );

    expect(resource).toEqual({
      "service.name": "from-query",
      "host.name": "app-3",
      "deployment.environment.name": "prod",
    });
    expect(attributesOf(record)).toEqual({
      "datadog.source": "java",
      env: "prod,staging",
      team: "payments",
    });
  });

  it("reads Java's flat MDC keys (dd.trace_id, dd.span_id, dd.service)", () => {
    const { record, resource } = translateLog({
      message: "Charging card",
      status: "INFO",
      "dd.trace_id": "8448014628134867840",
      "dd.span_id": "4295845374034557133",
      "dd.service": "payments",
      logger_name: "com.shop.Payments",
    });

    expect(record["traceId"]).toBe("0000000000000000753d608b77485380");
    expect(record["spanId"]).toBe("3b9de89b7955b8cd");
    expect(resource).toEqual({ "service.name": "payments" });
    expect(attributesOf(record)).toEqual({
      logger_name: "com.shop.Payments",
    });
  });

  it("reads Log4j 2's contextMap and keeps the rest of it", () => {
    const { record } = translateLog({
      message: "m",
      contextMap: {
        "dd.trace_id": "123",
        "dd.span_id": "456",
        requestId: "r-1",
      },
    });

    expect(record["traceId"]).toBe("0000000000000000000000000000007b");
    expect(record["spanId"]).toBe("00000000000001c8");
    expect(attributesOf(record)).toEqual({ "contextMap.requestId": "r-1" });
  });

  it("reads a 128-bit trace ID logged in hex, and OpenTelemetry's trace_id / span_id", () => {
    expect(
      translateLog({
        message: "m",
        "dd.trace_id": "6553B0C80000000052A7A4E0D6C8A9B7",
      }).record["traceId"],
    ).toBe("6553b0c80000000052a7a4e0d6c8a9b7");

    const { record } = translateLog({
      message: "m",
      trace_id: "4BF92F3577B34DA6A3CE929D0E0E4736",
      span_id: "00F067AA0BA902B7",
    });

    expect(record["traceId"]).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(record["spanId"]).toBe("00f067aa0ba902b7");
    expect(attributesOf(record)).toEqual({});
  });

  it("keeps a trace or span ID that is no ID as an attribute, and sets none", () => {
    const { record } = translateLog({
      message: "m",
      "dd.trace_id": "abc-not-an-id",
      "dd.span_id": 0,
    });

    expect(record["traceId"]).toBeUndefined();
    expect(record["spanId"]).toBeUndefined();
    expect(attributesOf(record)).toEqual({
      "dd.trace_id": "abc-not-an-id",
      "dd.span_id": "0",
    });
  });

  it("reads syslog's nested fields, and drops the object they leave empty", () => {
    const { record, resource } = translateLog({
      message: "Accepted publickey for deploy",
      syslog: {
        severity: 4,
        appname: "sshd",
        hostname: "bastion",
        timestamp: "2023-11-14T22:13:20Z",
      },
    });

    expect(resource).toEqual({
      "service.name": "sshd",
      "host.name": "bastion",
    });
    expect(record).toMatchObject({
      timeUnixNano: "1700000000000000000",
      severityNumber: 13,
      severityText: "WARN",
    });
    expect(record["attributes"]).toEqual([]);
  });
});

describe("DatadogIntake.logsToOtlp: message", () => {
  it("keeps a string message as it is, and writes any other as its JSON", () => {
    expect(translateLog({ message: "  spaced out\n" }).record["body"]).toEqual({
      stringValue: "  spaced out\n",
    });
    expect(
      translateLog({ message: { event: "login", ok: true } }).record["body"],
    ).toEqual({ stringValue: '{"event":"login","ok":true}' });
    expect(translateLog({ message: 42 }).record["body"]).toEqual({
      stringValue: "42",
    });
    expect(translateLog({ message: ["a", 1] }).record["body"]).toEqual({
      stringValue: '["a",1]',
    });
  });

  it("reads msg (pino, bunyan) and log (Docker) when there is no message", () => {
    const pino: JSONObject = translateLog({
      msg: "server listening",
      pid: 7,
    }).record;
    expect(pino["body"]).toEqual({ stringValue: "server listening" });
    expect(attributesOf(pino)).toEqual({ pid: "7" });

    const docker: JSONObject = translateLog({
      log: "line from the container\n",
      stream: "stdout",
    }).record;
    expect(docker["body"]).toEqual({
      stringValue: "line from the container\n",
    });
    expect(attributesOf(docker)).toEqual({ stream: "stdout" });
  });

  it("leaves an ECS log object alone, and writes an empty body for a log with no message", () => {
    const { record } = translateLog({
      log: { level: "warn", logger: "app" },
    });

    expect(record["body"]).toEqual({ stringValue: "" });
    expect(attributesOf(record)).toEqual({
      "log.level": "warn",
      "log.logger": "app",
    });

    const both: JSONObject = translateLog({
      message: "the message",
      msg: "not this",
    }).record;
    expect(both["body"]).toEqual({ stringValue: "the message" });
    expect(attributesOf(both)).toEqual({ msg: "not this" });
  });
});

describe("DatadogIntake.logsToOtlp: status", () => {
  test.each<[unknown, number, string]>([
    ["emergency", 21, "FATAL"],
    ["EMERG", 21, "FATAL"],
    ["alert", 19, "ERROR3"],
    ["critical", 18, "ERROR2"],
    ["error", 17, "ERROR"],
    ["Warning", 13, "WARN"],
    ["warn", 13, "WARN"],
    ["notice", 10, "INFO2"],
    ["info", 9, "INFO"],
    ["debug", 5, "DEBUG"],
    ["trace", 1, "TRACE"],
    ["ok", 9, "INFO"],
    ["success", 9, "INFO"],
    [0, 21, "FATAL"],
    [1, 19, "ERROR3"],
    [2, 18, "ERROR2"],
    [3, 17, "ERROR"],
    [4, 13, "WARN"],
    [5, 10, "INFO2"],
    [6, 9, "INFO"],
    [7, 5, "DEBUG"],
    ["3", 17, "ERROR"],
    // Datadog's status remapper: by the first letters.
    ["errors", 17, "ERROR"],
    ["fail", 21, "FATAL"],
    ["warned", 13, "WARN"],
    ["dbg-detail", 5, "DEBUG"],
    ["verbose2", 1, "TRACE"],
    ["notable", 10, "INFO2"],
    ["started", 9, "INFO"],
  ])(
    "status %p is severity %i (%s)",
    (status: unknown, severityNumber: number, severityText: string): void => {
      const { record } = translateLog({ message: "m", status: status });

      expect(record["severityNumber"]).toBe(severityNumber);
      expect(record["severityText"]).toBe(severityText);
      expect(attributesOf(record)).toEqual({});
    },
  );

  test.each<[unknown, unknown]>([
    ["major", "major"],
    ["8", "8"],
    [9, "9"],
    [-1, "-1"],
    [true, true],
    ["", ""],
  ])(
    "a status that is no level (%p) leaves the severity unspecified and stays an attribute",
    (status: unknown, attribute: unknown): void => {
      const { record } = translateLog({ message: "m", status: status });

      expect(record["severityNumber"]).toBe(0);
      expect(record["severityText"]).toBe("");
      expect(attributesOf(record)).toEqual({ status: attribute });
    },
  );

  it("reads severity, level and syslog.severity, in Datadog's order, past a status that is no level", () => {
    const { record } = translateLog({
      message: "m",
      status: "major",
      level: "error",
      severity: "debug",
    });

    expect(record["severityNumber"]).toBe(5);
    expect(attributesOf(record)).toEqual({ status: "major", level: "error" });

    expect(
      translateLog({ message: "m", level: "error" }).record["severityNumber"],
    ).toBe(17);
    expect(
      translateLog({ message: "m", "syslog.severity": "2" }).record[
        "severityNumber"
      ],
    ).toBe(18);
  });

  it("leaves a log with no status unspecified", () => {
    const { record } = translateLog({ message: "m" });

    expect(record["severityNumber"]).toBe(0);
    expect(record["severityText"]).toBe("");
  });
});

describe("DatadogIntake.logsToOtlp: time", () => {
  test.each<[string, unknown, string]>([
    [
      "milliseconds (what the Agent sends)",
      1700000000123,
      "1700000000123000000",
    ],
    ["milliseconds with a fraction", 1700000000123.5, "1700000000123500000"],
    ["seconds", 1700000000, "1700000000000000000"],
    ["fractional seconds", 1700000000.25, "1700000000250000000"],
    ["milliseconds as a string", "1700000000123", "1700000000123000000"],
    [
      "seconds as a string, to the nanosecond",
      "1700000000.123456789",
      "1700000000123456789",
    ],
    ["microseconds", 1700000000123456, "1700000000123456000"],
    ["nanoseconds as a string", "1700000000123456789", "1700000000123456789"],
    ["RFC 3339 in UTC", "2023-11-14T22:13:20Z", "1700000000000000000"],
    [
      "RFC 3339 to the nanosecond",
      "2023-11-14T22:13:20.123456789Z",
      "1700000000123456789",
    ],
    ["an offset", "2023-11-14T23:13:20+01:00", "1700000000000000000"],
    [
      "an offset with no colon",
      "2023-11-14T17:43:20-0430",
      "1700000000000000000",
    ],
    ["no zone, read as UTC", "2023-11-14 22:13:20", "1700000000000000000"],
    [
      "a comma before the fraction",
      "2023-11-14T22:13:20,5Z",
      "1700000000500000000",
    ],
    ["UTC spelled out", "2023-11-14 22:13:20 UTC", "1700000000000000000"],
  ])(
    "reads a timestamp in %s",
    (_label: string, timestamp: unknown, timeUnixNano: string): void => {
      const { record } = translateLog({ message: "m", timestamp: timestamp });

      expect(record["timeUnixNano"]).toBe(timeUnixNano);
      expect(record["observedTimeUnixNano"]).toBe(NOW_UNIX_NANO);
      expect(attributesOf(record)).toEqual({});
    },
  );

  it("reads date and @timestamp, and passes over a timestamp that is no time", () => {
    expect(
      translateLog({ message: "m", date: 1700000000123 }).record[
        "timeUnixNano"
      ],
    ).toBe("1700000000123000000");
    expect(
      translateLog({ message: "m", "@timestamp": "2023-11-14T22:13:20Z" })
        .record["timeUnixNano"],
    ).toBe("1700000000000000000");

    const { record } = translateLog({
      message: "m",
      timestamp: "garbage",
      date: 1700000000,
    });
    expect(record["timeUnixNano"]).toBe("1700000000000000000");
    expect(attributesOf(record)).toEqual({ timestamp: "garbage" });
  });

  test.each<[unknown, unknown]>([
    ["yesterday", "yesterday"],
    [-5, "-5"],
    [0, "0"],
    ["0", "0"],
    ["1969-12-31T23:59:59Z", "1969-12-31T23:59:59Z"],
    ["2023-13-01T00:00:00Z", "2023-13-01T00:00:00Z"],
    ["2023-11-14T22:13:20+25:00", "2023-11-14T22:13:20+25:00"],
    ["123456789012345678901", "123456789012345678901"],
    [true, true],
  ])(
    "a timestamp that is no time (%p) is now, and stays an attribute",
    (timestamp: unknown, attribute: unknown): void => {
      const { record } = translateLog({ message: "m", timestamp: timestamp });

      expect(record["timeUnixNano"]).toBe(NOW_UNIX_NANO);
      expect(attributesOf(record)).toEqual({ timestamp: attribute });
    },
  );

  it("is now when the log has no time", () => {
    const { record } = translateLog({ message: "m" });

    expect(record["timeUnixNano"]).toBe(NOW_UNIX_NANO);
    expect(record["observedTimeUnixNano"]).toBe(NOW_UNIX_NANO);
  });
});

describe("DatadogIntake.logsToOtlp: tags, resources and attributes", () => {
  it("splits tags at the first colon, joins a repeated key's values, and keeps keyless tags as datadog.tags", () => {
    const { record, resource } = translateLog({
      message: "m",
      ddtags:
        " env:prod , url:http://shop.example.com/a?b=c,kube_service:web,kube_service:api,kube_service:web,flag,flag,:odd,empty:,host:tagged-host,service:from-tag,version:2.0.0",
    });

    expect(record["attributes"]).toEqual([
      kv("env", "prod"),
      kv("url", "http://shop.example.com/a?b=c"),
      kv("kube_service", "web,api"),
      kv("empty", ""),
      kv("host", "tagged-host"),
      kv("service", "from-tag"),
      kv("version", "2.0.0"),
      kv("datadog.tags", "flag,:odd"),
    ]);

    // With no hostname or service of its own, the tags name the resource.
    expect(resource).toEqual({
      "service.name": "from-tag",
      "host.name": "tagged-host",
      "deployment.environment.name": "prod",
      "service.version": "2.0.0",
    });
  });

  it("reads ddtags given as an array", () => {
    const { record, resource } = translateLog({
      message: "m",
      ddtags: ["env:prod", "team:x", 5, "solo"],
    });

    expect(attributesOf(record)).toEqual({
      env: "prod",
      team: "x",
      "datadog.tags": "solo",
    });
    expect(resource).toEqual({ "deployment.environment.name": "prod" });
  });

  it("names the service after the header, keeping the log's own service as an attribute", () => {
    const { record, resource } = translateLog(
      {
        message: "m",
        service: "checkout",
        hostname: "web-1",
        ddtags: "service:from-tag,env:prod",
      },
      { serviceName: " storefront " },
    );

    expect(resource).toEqual({
      "service.name": "storefront",
      "host.name": "web-1",
      "deployment.environment.name": "prod",
    });
    expect(record["attributes"]).toEqual([
      kv("service", "checkout"),
      kv("env", "prod"),
    ]);
  });

  it("writes each attribute once: a log's own field wins over a tag of the same key", () => {
    const { record, resource } = translateLog({
      message: "m",
      env: "dev",
      ddtags: "env:prod",
      ddsource: "go",
      "datadog.source": "shadowed",
    });

    expect(record["attributes"]).toEqual([
      kv("datadog.source", "go"),
      kv("env", "dev"),
    ]);
    expect(resource).toEqual({ "deployment.environment.name": "prod" });
  });

  it("reads source when there is no ddsource, and keeps host, service and source that are no names as attributes", () => {
    const { record, resource } = translateLog({
      message: "m",
      source: "stdout",
      service: 42,
      host: { name: "ecs-host" },
    });

    expect(resource).toEqual({});
    expect(attributesOf(record)).toEqual({
      "datadog.source": "stdout",
      service: "42",
      "host.name": "ecs-host",
    });
  });

  it("leaves service.name unset when nothing names the service", () => {
    const { resource } = translateLog({ message: "m", hostname: "web-1" });

    expect(resource).toEqual({ "host.name": "web-1" });
  });

  it("keeps every other field, flattened, and leaves nulls out", () => {
    const { record } = translateLog({
      message: "m",
      http: { method: "POST", status_code: 502, url_details: { path: "/pay" } },
      duration: 1.25,
      tags_list: [1, 2],
      nothing: null,
    });

    expect(attributesOf(record)).toEqual({
      "http.method": "POST",
      "http.status_code": "502",
      "http.url_details.path": "/pay",
      duration: 1.25,
      tags_list: "[1,2]",
    });
  });
});

describe("DatadogIntake.logsToOtlp: the body", () => {
  it("reads NDJSON, one log or array of logs a line, counting lines that are not logs", () => {
    const translation: DatadogLogsTranslation = DatadogIntake.logsToOtlp(
      '{"message":"a"}\n\n{"message":"b"}\r\nnot json\n[{"message":"c"},{"message":"d"}]\n7\n',
      { nowInMs: NOW_MS },
    );

    expect(translation.count).toBe(4);
    expect(translation.droppedCount).toBe(2);
    expect(
      allLogRecordsOf(translation).map((record: JSONObject): unknown => {
        return (record["body"] as JSONObject)["stringValue"];
      }),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("skips array entries that are not logs, and counts them", () => {
    const translation: DatadogLogsTranslation = DatadogIntake.logsToOtlp(
      '["just a string", 7, null, [1], {"message":"ok"}]',
      { nowInMs: NOW_MS },
    );

    expect(translation.count).toBe(1);
    expect(translation.droppedCount).toBe(4);
  });

  it("reads a body that starts with a byte order mark", () => {
    expect(DatadogIntake.logsToOtlp('﻿[{"message":"bom"}]').count).toBe(1);
  });

  it("is no logs for an empty body or array", () => {
    for (const body of ["", "  \n ", "[]", Buffer.alloc(0)]) {
      expect(DatadogIntake.logsToOtlp(body)).toEqual({
        logs: null,
        count: 0,
        droppedCount: 0,
      });
    }
  });

  test.each<[string]>([
    ["hello world"],
    ['"a JSON string"'],
    ["42"],
    ["null"],
    ["[{broken"],
    ["not json\nalso not json"],
  ])(
    "throws a 400 DatadogIntakeError for a body that is no logs: %p",
    (body: string): void => {
      const error: DatadogIntakeError = errorOf(() => {
        return DatadogIntake.logsToOtlp(body);
      });

      expect(error.statusCode).toBe(400);
      expect(error.name).toBe("DatadogIntakeError");
    },
  );

  it(`translates at most ${MAX_DATADOG_LOGS_PER_REQUEST} logs a request, and counts the rest`, () => {
    const logs: Array<JSONObject> = [];

    for (
      let index: number = 0;
      index <= MAX_DATADOG_LOGS_PER_REQUEST;
      index++
    ) {
      logs.push({ message: `log ${index}` });
    }

    const translation: DatadogLogsTranslation = DatadogIntake.logsToOtlp(
      JSON.stringify(logs),
      { nowInMs: NOW_MS },
    );

    expect(MAX_DATADOG_LOGS_PER_REQUEST).toBe(10_000);
    expect(translation.count).toBe(10_000);
    expect(translation.droppedCount).toBe(1);

    const records: Array<JSONObject> = allLogRecordsOf(translation);
    expect(records).toHaveLength(10_000);
    expect(records[9_999]!["body"]).toEqual({ stringValue: "log 9999" });
  });
});

describe("DatadogIntake.parseJson", () => {
  it("reads JSON, with or without a byte order mark", () => {
    expect(DatadogIntake.parseJson('{"series":[]}')).toEqual({ series: [] });
    expect(DatadogIntake.parseJson(Buffer.from("﻿[1]"))).toEqual([1]);
  });

  it("throws a 400 DatadogIntakeError for a body that is not JSON", () => {
    expect(
      errorOf(() => {
        return DatadogIntake.parseJson("{series:");
      }).statusCode,
    ).toBe(400);
  });
});

/*
 * What an Agent with the v1 series API posts: a check's gauges, a gauge
 * with a device, a DogStatsD counter (sent as a per-second rate) and a
 * count, and the same metric from a second host with no type.
 */
const V1_SERIES: JSONObject = {
  series: [
    {
      metric: "system.load.1",
      points: [
        [1700000000, 0.42],
        [1700000010, 0.5],
      ],
      type: "gauge",
      interval: 10,
      host: "web-1",
      tags: ["env:prod", "role:db", "canary"],
    },
    {
      metric: "system.disk.free",
      points: [[1700000000, 52428800000]],
      type: "gauge",
      interval: 0,
      host: "web-1",
      device: "sda1",
      tags: ["env:prod", "role:db", "canary"],
      source_type_name: "System",
    },
    {
      metric: "checkout.requests",
      points: [[1700000000, 1.5]],
      type: "rate",
      interval: 10,
      host: "web-1",
      tags: ["env:prod", "service:checkout", "version:1.4.2"],
    },
    {
      metric: "checkout.errors",
      points: [
        [1700000010, 3],
        [1700000020, -1],
      ],
      type: "count",
      interval: 10,
      host: "web-1",
      tags: ["env:prod", "service:checkout", "version:1.4.2"],
    },
    {
      metric: "system.load.1",
      points: [[1700000000, 1.1]],
      host: "web-2",
      tags: ["env:prod", "role:db"],
    },
  ],
};

describe("DatadogIntake.seriesV1ToOtlp", () => {
  it("writes gauges, rates and counts, grouped by resource and then by metric", () => {
    const translation: DatadogMetricsTranslation = DatadogIntake.seriesV1ToOtlp(
      V1_SERIES,
      { nowInMs: NOW_MS },
    );

    const load: Array<KeyValue> = [
      kv("env", "prod"),
      kv("role", "db"),
      kv("datadog.tags", "canary"),
    ];
    const checkout: Array<KeyValue> = [
      kv("env", "prod"),
      kv("service", "checkout"),
      kv("version", "1.4.2"),
    ];

    expect(translation).toEqual({
      metrics: {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                kv("host.name", "web-1"),
                kv("deployment.environment.name", "prod"),
              ],
            },
            scopeMetrics: [
              {
                scope: { name: "datadog" },
                metrics: [
                  {
                    name: "system.load.1",
                    gauge: {
                      dataPoints: [
                        {
                          timeUnixNano: "1700000000000000000",
                          asDouble: 0.42,
                          attributes: load,
                        },
                        {
                          timeUnixNano: "1700000010000000000",
                          asDouble: 0.5,
                          attributes: load,
                        },
                      ],
                    },
                  },
                  {
                    name: "system.disk.free",
                    gauge: {
                      dataPoints: [
                        {
                          timeUnixNano: "1700000000000000000",
                          asDouble: 52428800000,
                          attributes: [kv("device", "sda1"), ...load],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
          {
            resource: {
              attributes: [
                kv("service.name", "checkout"),
                kv("host.name", "web-1"),
                kv("deployment.environment.name", "prod"),
                kv("service.version", "1.4.2"),
              ],
            },
            scopeMetrics: [
              {
                scope: { name: "datadog" },
                metrics: [
                  {
                    name: "checkout.requests",
                    gauge: {
                      dataPoints: [
                        {
                          timeUnixNano: "1700000000000000000",
                          asDouble: 1.5,
                          attributes: [
                            kv("datadog.metric.type", "rate"),
                            ...checkout,
                          ],
                        },
                      ],
                    },
                  },
                  {
                    name: "checkout.errors",
                    sum: {
                      aggregationTemporality: 1,
                      isMonotonic: false,
                      dataPoints: [
                        {
                          startTimeUnixNano: "1700000000000000000",
                          timeUnixNano: "1700000010000000000",
                          asDouble: 3,
                          attributes: checkout,
                        },
                        {
                          startTimeUnixNano: "1700000010000000000",
                          timeUnixNano: "1700000020000000000",
                          asDouble: -1,
                          attributes: checkout,
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
          {
            resource: {
              attributes: [
                kv("host.name", "web-2"),
                kv("deployment.environment.name", "prod"),
              ],
            },
            scopeMetrics: [
              {
                scope: { name: "datadog" },
                metrics: [
                  {
                    name: "system.load.1",
                    gauge: {
                      dataPoints: [
                        {
                          timeUnixNano: "1700000000000000000",
                          asDouble: 1.1,
                          attributes: [kv("env", "prod"), kv("role", "db")],
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
      pointCount: 7,
      droppedPointCount: 0,
    });

    expect(JSON.parse(JSON.stringify(translation.metrics))).toStrictEqual(
      translation.metrics,
    );
  });

  it("drops points whose value is null, NaN, infinite or no number, or whose time is no time, and counts them", () => {
    const translation: DatadogMetricsTranslation = DatadogIntake.seriesV1ToOtlp(
      {
        series: [
          {
            metric: "queue.depth",
            host: "worker-1",
            points: [
              [1700000000, null],
              [1700000010, "NaN"],
              [1700000020, "1e400"],
              [1700000030, "abc"],
              [1700000040, 2],
              ["yesterday", 3],
              [-5, 4],
              [1700000050],
              "not a point",
              [1700000060, "2.5"],
              [1700000070, true],
            ],
          },
        ],
      },
      { nowInMs: NOW_MS },
    );

    expect(translation.pointCount).toBe(2);
    expect(translation.droppedPointCount).toBe(9);
    expect(
      allDataPointsOf(translation).map((dataPoint: JSONObject): unknown => {
        return [dataPoint["timeUnixNano"], dataPoint["asDouble"]];
      }),
    ).toEqual([
      ["1700000040000000000", 2],
      ["1700000060000000000", 2.5],
    ]);

    const json: string = JSON.stringify(translation.metrics);
    expect(json).not.toContain("NaN");
    expect(json).not.toContain("Infinity");
    expect(json).not.toContain("null");
  });

  it("is now for a point with no time, and reads fractional seconds and milliseconds sent by mistake", () => {
    const translation: DatadogMetricsTranslation = DatadogIntake.seriesV1ToOtlp(
      {
        series: [
          {
            metric: "m",
            points: [
              [null, 1],
              [0, 2],
              [1700000000.25, 3],
              [1700000000123, 4],
            ],
          },
        ],
      },
      { nowInMs: NOW_MS },
    );

    expect(
      allDataPointsOf(translation).map((dataPoint: JSONObject): unknown => {
        return dataPoint["timeUnixNano"];
      }),
    ).toEqual([
      NOW_UNIX_NANO,
      NOW_UNIX_NANO,
      "1700000000250000000",
      "1700000000123000000",
    ]);
  });

  it("starts a count with no interval at its own time, and writes an unknown type as a gauge", () => {
    const translation: DatadogMetricsTranslation = DatadogIntake.seriesV1ToOtlp(
      {
        series: [
          { metric: "jobs.done", type: "count", points: [[1700000000, 5]] },
          { metric: "odd.type", type: "histogram", points: [[1700000000, 1]] },
        ],
      },
    );

    const metrics: Array<JSONObject> = metricsOf(
      resourceMetricsOf(translation)[0]!,
    );

    expect(metrics[0]).toEqual({
      name: "jobs.done",
      sum: {
        aggregationTemporality: 1,
        isMonotonic: false,
        dataPoints: [
          {
            startTimeUnixNano: "1700000000000000000",
            timeUnixNano: "1700000000000000000",
            asDouble: 5,
            attributes: [],
          },
        ],
      },
    });
    expect(metrics[1]).toEqual({
      name: "odd.type",
      gauge: {
        dataPoints: [
          {
            timeUnixNano: "1700000000000000000",
            asDouble: 1,
            attributes: [],
          },
        ],
      },
    });
  });

  it("drops the points of a series with no name, and skips entries that are no series", () => {
    const translation: DatadogMetricsTranslation = DatadogIntake.seriesV1ToOtlp(
      {
        series: [
          {
            points: [
              [1700000000, 1],
              [1700000010, 2],
            ],
          },
          { metric: "   ", points: [[1700000000, 1]] },
          "not a series",
          null,
        ],
      },
    );

    expect(translation).toEqual({
      metrics: null,
      pointCount: 0,
      droppedPointCount: 3,
    });
  });

  it("names the service after the header, keeping the service tag as an attribute", () => {
    const translation: DatadogMetricsTranslation = DatadogIntake.seriesV1ToOtlp(
      {
        series: [
          {
            metric: "checkout.requests",
            points: [[1700000000, 1]],
            host: "web-1",
            tags: ["service:checkout"],
          },
        ],
      },
      { serviceName: "billing" },
    );

    const resource: JSONObject = resourceMetricsOf(translation)[0]!;

    expect(attributesOf(resource["resource"])).toEqual({
      "service.name": "billing",
      "host.name": "web-1",
    });
    expect(attributesOf(allDataPointsOf(translation)[0])).toEqual({
      service: "checkout",
    });
  });

  it("reads a bare array of series, and is no metrics for none", () => {
    expect(
      DatadogIntake.seriesV1ToOtlp([{ metric: "m", points: [[1700000000, 1]] }])
        .pointCount,
    ).toBe(1);
    expect(DatadogIntake.seriesV1ToOtlp({ series: [] })).toEqual({
      metrics: null,
      pointCount: 0,
      droppedPointCount: 0,
    });
  });

  test.each<[unknown]>([
    [{ foo: 1 }],
    [{ series: "x" }],
    [{ series: null }],
    ["series"],
    [null],
    [42],
  ])(
    "throws a 400 DatadogIntakeError for a payload that is no series: %p",
    (json: unknown): void => {
      expect(
        errorOf(() => {
          return DatadogIntake.seriesV1ToOtlp(json);
        }).statusCode,
      ).toBe(400);
    },
  );
});

/*
 * POST /api/v2/series as Datadog's API docs show it: types as numbers (and
 * names), points as objects, the host as a resource, units.
 */
const V2_SERIES: JSONObject = {
  series: [
    {
      metric: "system.mem.used",
      type: 3,
      points: [{ timestamp: 1700000000, value: 2147483648 }],
      resources: [{ name: "web-1", type: "host" }],
      tags: ["env:prod"],
      unit: "byte",
    },
    {
      metric: "nginx.requests",
      type: 1,
      points: [{ timestamp: 1700000010, value: 25 }],
      resources: [
        { name: "web-1", type: "host" },
        { name: "sda1", type: "device" },
        { name: "orders-db", type: "database_instance" },
      ],
      tags: ["env:prod", "service:nginx"],
      interval: 10,
    },
    {
      metric: "jvm.gc.rate",
      type: 2,
      points: [{ timestamp: 1700000000, value: 0.2 }],
      resources: [{ name: "web-1", type: "host" }],
      tags: ["env:prod", "service:checkout"],
      interval: 10,
    },
    {
      metric: "custom.unspecified",
      type: 0,
      points: [{ timestamp: 1700000000, value: 7 }],
      tags: ["host:tagged-host"],
    },
    {
      metric: "system.mem.used",
      type: 3,
      points: [{ timestamp: 1700000010, value: 1024 }],
      resources: [{ name: "web-1", type: "host" }],
      tags: ["env:prod"],
    },
  ],
};

const V2_SERIES_OTLP: Record<string, unknown> = {
  resourceMetrics: [
    {
      resource: {
        attributes: [
          kv("host.name", "web-1"),
          kv("deployment.environment.name", "prod"),
        ],
      },
      scopeMetrics: [
        {
          scope: { name: "datadog" },
          metrics: [
            {
              name: "system.mem.used",
              unit: "byte",
              gauge: {
                dataPoints: [
                  {
                    timeUnixNano: "1700000000000000000",
                    asDouble: 2147483648,
                    attributes: [kv("env", "prod")],
                  },
                ],
              },
            },
            {
              name: "system.mem.used",
              gauge: {
                dataPoints: [
                  {
                    timeUnixNano: "1700000010000000000",
                    asDouble: 1024,
                    attributes: [kv("env", "prod")],
                  },
                ],
              },
            },
          ],
        },
      ],
    },
    {
      resource: {
        attributes: [
          kv("service.name", "nginx"),
          kv("host.name", "web-1"),
          kv("deployment.environment.name", "prod"),
        ],
      },
      scopeMetrics: [
        {
          scope: { name: "datadog" },
          metrics: [
            {
              name: "nginx.requests",
              sum: {
                aggregationTemporality: 1,
                isMonotonic: false,
                dataPoints: [
                  {
                    startTimeUnixNano: "1700000000000000000",
                    timeUnixNano: "1700000010000000000",
                    asDouble: 25,
                    attributes: [
                      kv("device", "sda1"),
                      kv("datadog.resource.database_instance", "orders-db"),
                      kv("env", "prod"),
                      kv("service", "nginx"),
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    },
    {
      resource: {
        attributes: [
          kv("service.name", "checkout"),
          kv("host.name", "web-1"),
          kv("deployment.environment.name", "prod"),
        ],
      },
      scopeMetrics: [
        {
          scope: { name: "datadog" },
          metrics: [
            {
              name: "jvm.gc.rate",
              gauge: {
                dataPoints: [
                  {
                    timeUnixNano: "1700000000000000000",
                    asDouble: 0.2,
                    attributes: [
                      kv("datadog.metric.type", "rate"),
                      kv("env", "prod"),
                      kv("service", "checkout"),
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    },
    {
      resource: { attributes: [kv("host.name", "tagged-host")] },
      scopeMetrics: [
        {
          scope: { name: "datadog" },
          metrics: [
            {
              name: "custom.unspecified",
              gauge: {
                dataPoints: [
                  {
                    timeUnixNano: "1700000000000000000",
                    asDouble: 7,
                    attributes: [kv("host", "tagged-host")],
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
};

describe("DatadogIntake.seriesV2ToOtlp", () => {
  it("reads types, the host and device resources, and units, grouping by name, type and unit", () => {
    expect(
      DatadogIntake.seriesV2ToOtlp(V2_SERIES, { nowInMs: NOW_MS }),
    ).toEqual({ metrics: V2_SERIES_OTLP, pointCount: 5, droppedPointCount: 0 });
  });

  test.each<[unknown, string, boolean]>([
    [0, "gauge", false],
    [1, "sum", false],
    [2, "gauge", true],
    [3, "gauge", false],
    [9, "gauge", false],
    ["unspecified", "gauge", false],
    ["COUNT", "sum", false],
    ["Rate", "gauge", true],
    ["gauge", "gauge", false],
    [undefined, "gauge", false],
  ])(
    "type %p is an OTLP %s",
    (type: unknown, shape: string, isRate: boolean): void => {
      const series: Record<string, unknown> = {
        metric: "m",
        points: [{ timestamp: 1700000000, value: 1 }],
      };

      if (type !== undefined) {
        series["type"] = type;
      }

      const translation: DatadogMetricsTranslation =
        DatadogIntake.seriesV2ToOtlp({ series: [series] });
      const metric: JSONObject = metricsOf(
        resourceMetricsOf(translation)[0]!,
      )[0]!;

      expect(Object.keys(metric)).toEqual(["name", shape]);
      expect(attributesOf(dataPointsOf(metric)[0])).toEqual(
        isRate ? { "datadog.metric.type": "rate" } : {},
      );
    },
  );

  it("reads proto3 JSON's string int64s, and drops points that are no points", () => {
    const translation: DatadogMetricsTranslation = DatadogIntake.seriesV2ToOtlp(
      {
        series: [
          {
            metric: "m",
            type: "COUNT",
            interval: "10",
            points: [
              { timestamp: "1700000010", value: 4 },
              { timestamp: 1700000020 },
              { timestamp: 1700000030, value: null },
              "not a point",
              [1700000040, 1],
            ],
          },
        ],
      },
    );

    expect(translation.pointCount).toBe(1);
    expect(translation.droppedPointCount).toBe(4);
    expect(allDataPointsOf(translation)).toEqual([
      {
        startTimeUnixNano: "1700000000000000000",
        timeUnixNano: "1700000010000000000",
        asDouble: 4,
        attributes: [],
      },
    ]);
  });

  it("keeps the first host resource, and skips resources with no type or name", () => {
    const translation: DatadogMetricsTranslation = DatadogIntake.seriesV2ToOtlp(
      {
        series: [
          {
            metric: "m",
            points: [{ timestamp: 1700000000, value: 1 }],
            resources: [
              { name: "", type: "host" },
              { name: "first", type: "HOST" },
              { name: "second", type: "host" },
              { name: "no-type" },
              "not a resource",
              { name: "sdb", type: "device" },
              { name: "sdc", type: "device" },
            ],
          },
        ],
      },
    );

    expect(
      attributesOf(resourceMetricsOf(translation)[0]!["resource"]),
    ).toEqual({ "host.name": "first" });
    expect(attributesOf(allDataPointsOf(translation)[0])).toEqual({
      device: "sdb",
    });
  });
});

/*
 * A MetricPayload assembled by hand from agent-payload's field numbers,
 * so the .proto itself is under test: two series on host web-1, a gauge
 * whose first point is 0 (which proto3 leaves off the wire) and a count.
 */
const HAND_ASSEMBLED_METRIC_PAYLOAD: string = `
  0a 72                                      series (1), 114 bytes
    0a 0d 0a 04 686f7374 12 05 7765622d31      resources (1): type "host", name "web-1"
    0a 0e 0a 06 646576696365 12 04 73646131    resources (1): type "device", name "sda1"
    12 10 73797374656d2e6469736b2e66726565     metric (2): "system.disk.free"
    1a 08 656e763a70726f64                     tags (3): "env:prod"
    1a 0c 7465616d3a73746f72616765             tags (3): "team:storage"
    22 06 10 80e2cfaa06                        points (4): timestamp (2) 1700000000; value 0 omitted
    22 0f 09 000000000000f83f 10 8ae2cfaa06    points (4): value (1) 1.5, timestamp (2) 1700000010
    28 03                                      type (5): GAUGE
    32 04 62797465                             unit (6): "byte"
    4a 06 0a 04 20 0a 28 0b                    metadata (9): origin (1) { product (4) 10, category (5) 11 }
  0a 40                                      series (1), 64 bytes
    0a 0d 0a 04 686f7374 12 05 7765622d31      resources (1): type "host", name "web-1"
    12 08 7265717565737473                     metric (2): "requests"
    1a 08 656e763a70726f64                     tags (3): "env:prod"
    22 0f 09 00000000000000c0 10 8ae2cfaa06    points (4): value (1) -2, timestamp (2) 1700000010
    28 01                                      type (5): COUNT
    3a 06 53797374656d                         source_type_name (7): "System"
    40 0a                                      interval (8): 10
`;

// The bytes of a hex dump whose lines end in a description.
const dumpBytes: (dump: string) => Buffer = (dump: string): Buffer => {
  return hex(
    dump
      .split("\n")
      .map((line: string): string => {
        // Two or more spaces after the bytes start the description.
        return line.trim().split(/\s{2,}/)[0] || "";
      })
      .join(" "),
  );
};

describe("DatadogIntake.seriesV2ProtobufToOtlp", () => {
  it("reads a MetricPayload assembled by hand from agent-payload's field numbers", () => {
    const bytes: Buffer = dumpBytes(HAND_ASSEMBLED_METRIC_PAYLOAD);

    expect(bytes).toHaveLength(182);

    // protobufjs, from the repository's .proto, writes the same bytes.
    expect(
      Buffer.from(
        encodeMetricPayload({
          series: [
            {
              resources: [
                { type: "host", name: "web-1" },
                { type: "device", name: "sda1" },
              ],
              metric: "system.disk.free",
              tags: ["env:prod", "team:storage"],
              points: [
                { timestamp: 1700000000 },
                { value: 1.5, timestamp: 1700000010 },
              ],
              type: 3,
              unit: "byte",
              metadata: { origin: { originProduct: 10, originCategory: 11 } },
            },
            {
              resources: [{ type: "host", name: "web-1" }],
              metric: "requests",
              tags: ["env:prod"],
              points: [{ value: -2, timestamp: 1700000010 }],
              type: 1,
              sourceTypeName: "System",
              interval: 10,
            },
          ],
        }),
      ).equals(bytes),
    ).toBe(true);

    expect(
      DatadogIntake.seriesV2ProtobufToOtlp(bytes, { nowInMs: NOW_MS }),
    ).toEqual({
      metrics: {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                kv("host.name", "web-1"),
                kv("deployment.environment.name", "prod"),
              ],
            },
            scopeMetrics: [
              {
                scope: { name: "datadog" },
                metrics: [
                  {
                    name: "system.disk.free",
                    unit: "byte",
                    gauge: {
                      dataPoints: [
                        {
                          timeUnixNano: "1700000000000000000",
                          asDouble: 0,
                          attributes: [
                            kv("device", "sda1"),
                            kv("env", "prod"),
                            kv("team", "storage"),
                          ],
                        },
                        {
                          timeUnixNano: "1700000010000000000",
                          asDouble: 1.5,
                          attributes: [
                            kv("device", "sda1"),
                            kv("env", "prod"),
                            kv("team", "storage"),
                          ],
                        },
                      ],
                    },
                  },
                  {
                    name: "requests",
                    sum: {
                      aggregationTemporality: 1,
                      isMonotonic: false,
                      dataPoints: [
                        {
                          startTimeUnixNano: "1700000000000000000",
                          timeUnixNano: "1700000010000000000",
                          asDouble: -2,
                          attributes: [kv("env", "prod")],
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
      pointCount: 3,
      droppedPointCount: 0,
    });
  });

  it("reads the Agent's protobuf exactly as its JSON twin", () => {
    const protobufSeries: Array<JSONObject> = (
      V2_SERIES["series"] as Array<JSONObject>
    ).map((series: JSONObject): JSONObject => {
      return { ...series };
    });

    const translation: DatadogMetricsTranslation =
      DatadogIntake.seriesV2ProtobufToOtlp(
        Buffer.from(encodeMetricPayload({ series: protobufSeries })),
        { nowInMs: NOW_MS },
      );

    expect(translation).toEqual({
      metrics: V2_SERIES_OTLP,
      pointCount: 5,
      droppedPointCount: 0,
    });
    expect(JSON.parse(JSON.stringify(translation.metrics))).toStrictEqual(
      translation.metrics,
    );
  });

  it("drops NaN and infinite values and negative timestamps, and is now for a timestamp of 0", () => {
    const translation: DatadogMetricsTranslation =
      DatadogIntake.seriesV2ProtobufToOtlp(
        encodeMetricPayload({
          series: [
            {
              metric: "m",
              type: 3,
              points: [
                { value: NaN, timestamp: 1700000000 },
                { value: Infinity, timestamp: 1700000000 },
                { value: -Infinity, timestamp: 1700000000 },
                { value: 1, timestamp: -5 },
                { value: 2 },
              ],
            },
          ],
        }),
        { nowInMs: NOW_MS },
      );

    expect(translation.pointCount).toBe(1);
    expect(translation.droppedPointCount).toBe(4);
    expect(allDataPointsOf(translation)).toEqual([
      { timeUnixNano: NOW_UNIX_NANO, asDouble: 2, attributes: [] },
    ]);
  });

  it("is no metrics for an empty body", () => {
    expect(DatadogIntake.seriesV2ProtobufToOtlp(Buffer.alloc(0))).toEqual({
      metrics: null,
      pointCount: 0,
      droppedPointCount: 0,
    });
  });

  test.each<[string, Buffer]>([
    ["JSON", Buffer.from('{"series":[{"metric":"a"}]}')],
    ["text", Buffer.from("hello world")],
    ["a truncated message", Buffer.from([0x0a, 0xff, 0xff])],
    ["a cut-off string", hex("0a 05 12 10 73 79")],
  ])(
    "throws a 400 DatadogIntakeError for a body that is no MetricPayload: %s",
    (_label: string, body: Buffer): void => {
      const error: DatadogIntakeError = errorOf(() => {
        return DatadogIntake.seriesV2ProtobufToOtlp(body);
      });

      expect(error.statusCode).toBe(400);
    },
  );
});

/*
 * A SketchPayload assembled by hand: one DDSketch of three requests
 * (0.25 s, 1 s, 4 s), with its bin keys as packed zig-zag sint32s.
 */
const HAND_ASSEMBLED_SKETCH_PAYLOAD: string = `
  0a 6d                                      sketches (1), 109 bytes
    0a 0f 726571756573742e6c6174656e6379       metric (1): "request.latency"
    12 05 7765622d31                           host (2): "web-1"
    22 08 656e763a70726f64                     tags (4): "env:prod"
    22 10 736572766963653a636865636b6f7574     tags (4): "service:checkout"
    3a 37                                      dogsketches (7), 55 bytes
      08 80e2cfaa06                              ts (1): 1700000000
      10 03                                      cnt (2): 3
      19 000000000000d03f                        min (3): 0.25
      21 0000000000001040                        max (4): 4
      29 000000000000fc3f                        avg (5): 1.75
      31 0000000000001540                        sum (6): 5.25
      3a 04 01 00 8c15                           k (7), packed: -1, 0, 1350
      42 03 01 01 01                             n (8), packed: 1, 1, 1
  12 08 0a 06 372e35302e30                   metadata (2): agent_version (1) "7.50.0"
`;

describe("DatadogIntake.sketchesToOtlp", () => {
  it("reads a SketchPayload assembled by hand from agent-payload's field numbers", () => {
    const bytes: Buffer = dumpBytes(HAND_ASSEMBLED_SKETCH_PAYLOAD);

    expect(bytes).toHaveLength(121);
    expect(
      Buffer.from(
        encodeSketchPayload({
          sketches: [
            {
              metric: "request.latency",
              host: "web-1",
              tags: ["env:prod", "service:checkout"],
              dogsketches: [
                {
                  ts: 1700000000,
                  cnt: 3,
                  min: 0.25,
                  max: 4,
                  avg: 1.75,
                  sum: 5.25,
                  k: [-1, 0, 1350],
                  n: [1, 1, 1],
                },
              ],
            },
          ],
          metadata: { agentVersion: "7.50.0" },
        }),
      ).equals(bytes),
    ).toBe(true);

    expect(DatadogIntake.sketchesToOtlp(bytes, { nowInMs: NOW_MS })).toEqual({
      metrics: {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                kv("service.name", "checkout"),
                kv("host.name", "web-1"),
                kv("deployment.environment.name", "prod"),
              ],
            },
            scopeMetrics: [
              {
                scope: { name: "datadog" },
                metrics: [
                  {
                    name: "request.latency",
                    summary: {
                      dataPoints: [
                        {
                          timeUnixNano: "1700000000000000000",
                          count: "3",
                          sum: 5.25,
                          quantileValues: [
                            { quantile: 0, value: 0.25 },
                            { quantile: 1, value: 4 },
                          ],
                          attributes: [
                            kv("env", "prod"),
                            kv("service", "checkout"),
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
      pointCount: 1,
      droppedPointCount: 0,
    });
  });

  it("writes each Dogsketch, and an older Agent's Distribution, as a summary point", () => {
    const translation: DatadogMetricsTranslation = DatadogIntake.sketchesToOtlp(
      encodeSketchPayload({
        sketches: [
          {
            metric: "checkout.latency",
            host: "web-1",
            tags: ["env:prod", "service:checkout", "endpoint:/pay"],
            dogsketches: [
              {
                ts: 1700000000,
                cnt: 4,
                min: 0.012,
                max: 0.25,
                avg: 0.0805,
                sum: 0.322,
                k: [1290, 1310, 1388, 1400],
                n: [1, 1, 1, 1],
              },
              {
                ts: 1700000010,
                cnt: 1,
                min: 0.03,
                max: 0.03,
                avg: 0.03,
                sum: 0.03,
                k: [1335],
                n: [1],
              },
            ],
          },
          {
            metric: "legacy.histogram",
            host: "old-agent",
            distributions: [
              {
                ts: 1700000000,
                cnt: 2,
                min: 1,
                max: 3,
                avg: 2,
                sum: 4,
                v: [1, 3],
                g: [1, 1],
                delta: [0, 0],
              },
            ],
          },
        ],
      }),
      { nowInMs: NOW_MS },
    );

    expect(translation.pointCount).toBe(3);
    expect(translation.droppedPointCount).toBe(0);

    const resources: Array<JSONObject> = resourceMetricsOf(translation);
    expect(resources).toHaveLength(2);

    expect(attributesOf(resources[0]!["resource"])).toEqual({
      "service.name": "checkout",
      "host.name": "web-1",
      "deployment.environment.name": "prod",
    });
    expect(metricsOf(resources[0]!)).toEqual([
      {
        name: "checkout.latency",
        summary: {
          dataPoints: [
            {
              timeUnixNano: "1700000000000000000",
              count: "4",
              sum: 0.322,
              quantileValues: [
                { quantile: 0, value: 0.012 },
                { quantile: 1, value: 0.25 },
              ],
              attributes: [
                kv("env", "prod"),
                kv("service", "checkout"),
                kv("endpoint", "/pay"),
              ],
            },
            {
              timeUnixNano: "1700000010000000000",
              count: "1",
              sum: 0.03,
              quantileValues: [
                { quantile: 0, value: 0.03 },
                { quantile: 1, value: 0.03 },
              ],
              attributes: [
                kv("env", "prod"),
                kv("service", "checkout"),
                kv("endpoint", "/pay"),
              ],
            },
          ],
        },
      },
    ]);

    expect(attributesOf(resources[1]!["resource"])).toEqual({
      "host.name": "old-agent",
    });
    expect(metricsOf(resources[1]!)).toEqual([
      {
        name: "legacy.histogram",
        summary: {
          dataPoints: [
            {
              timeUnixNano: "1700000000000000000",
              count: "2",
              sum: 4,
              quantileValues: [
                { quantile: 0, value: 1 },
                { quantile: 1, value: 3 },
              ],
              attributes: [],
            },
          ],
        },
      },
    ]);

    expect(JSON.parse(JSON.stringify(translation.metrics))).toStrictEqual(
      translation.metrics,
    );
  });

  it("drops a sketch point with no sum and the points of a sketch with no name, and leaves out quantiles that are no numbers", () => {
    const translation: DatadogMetricsTranslation = DatadogIntake.sketchesToOtlp(
      encodeSketchPayload({
        sketches: [
          {
            metric: "edge",
            host: "h",
            dogsketches: [
              { ts: 1700000000, cnt: 0, min: Infinity, max: -Infinity },
              { ts: 1700000000, cnt: 2, sum: NaN, min: 1, max: 2 },
              { ts: 1700000000, cnt: 2, sum: 3, min: -Infinity, max: 2 },
              { ts: -1, cnt: 1, sum: 1, min: 1, max: 1 },
            ],
          },
          {
            host: "h",
            dogsketches: [{ ts: 1700000000, cnt: 1, sum: 1 }],
          },
        ],
      }),
      { nowInMs: NOW_MS },
    );

    expect(translation.pointCount).toBe(2);
    expect(translation.droppedPointCount).toBe(3);
    expect(allDataPointsOf(translation)).toEqual([
      {
        timeUnixNano: "1700000000000000000",
        count: "0",
        sum: 0,
        quantileValues: [],
        attributes: [],
      },
      {
        timeUnixNano: "1700000000000000000",
        count: "2",
        sum: 3,
        quantileValues: [{ quantile: 1, value: 2 }],
        attributes: [],
      },
    ]);

    const json: string = JSON.stringify(translation.metrics);
    expect(json).not.toContain("null");
  });

  it("names the service after the header", () => {
    const translation: DatadogMetricsTranslation = DatadogIntake.sketchesToOtlp(
      encodeSketchPayload({
        sketches: [
          {
            metric: "m",
            host: "web-1",
            tags: ["service:checkout"],
            dogsketches: [{ ts: 1700000000, cnt: 1, sum: 1, min: 1, max: 1 }],
          },
        ],
      }),
      { serviceName: "billing" },
    );

    expect(
      attributesOf(resourceMetricsOf(translation)[0]!["resource"]),
    ).toEqual({ "service.name": "billing", "host.name": "web-1" });
  });

  it("throws a 400 DatadogIntakeError for a body that is no SketchPayload, and is no metrics for an empty one", () => {
    expect(
      errorOf(() => {
        return DatadogIntake.sketchesToOtlp(Buffer.from("{}\n{}"));
      }).statusCode,
    ).toBe(400);
    expect(DatadogIntake.sketchesToOtlp(Buffer.alloc(0)).metrics).toBeNull();
  });
});

/*
 * What the Agent posts to /api/v1/check_run: its own datadog.agent.up, a
 * failing check with a message, an HTTP check, and a check run with no
 * timestamp.
 */
const CHECK_RUNS: Array<JSONObject> = [
  {
    check: "datadog.agent.up",
    host_name: "web-1",
    timestamp: 1700000000,
    status: 0,
    message: "",
    tags: [],
  },
  {
    check: "postgres.can_connect",
    host_name: "db-1",
    timestamp: 1700000000,
    status: 2,
    message: "could not connect to server: Connection refused",
    tags: ["port:5432", "db:orders", "env:prod"],
  },
  {
    check: "http.can_connect",
    host_name: "web-1",
    timestamp: 1700000010,
    status: 1,
    message: "Slow response",
    tags: ["url:https://shop.example.com/health", "service:storefront"],
  },
  {
    check: "ntp.in_sync",
    host_name: "web-1",
    status: 3,
    tags: null,
  },
  {
    check: "datadog.agent.up",
    host_name: "web-1",
    timestamp: 1700000010,
    status: 0,
  },
];

describe("DatadogIntake.checkRunsToOtlp", () => {
  it("writes each check run as a gauge point valued at its status", () => {
    const translation: DatadogMetricsTranslation =
      DatadogIntake.checkRunsToOtlp(CHECK_RUNS, { nowInMs: NOW_MS });

    expect(translation).toEqual({
      metrics: {
        resourceMetrics: [
          {
            resource: { attributes: [kv("host.name", "web-1")] },
            scopeMetrics: [
              {
                scope: { name: "datadog" },
                metrics: [
                  {
                    name: "datadog.agent.up",
                    gauge: {
                      dataPoints: [
                        {
                          timeUnixNano: "1700000000000000000",
                          asDouble: 0,
                          attributes: [kv("datadog.check.status", "ok")],
                        },
                        {
                          timeUnixNano: "1700000010000000000",
                          asDouble: 0,
                          attributes: [kv("datadog.check.status", "ok")],
                        },
                      ],
                    },
                  },
                  {
                    name: "ntp.in_sync",
                    gauge: {
                      dataPoints: [
                        {
                          timeUnixNano: NOW_UNIX_NANO,
                          asDouble: 3,
                          attributes: [kv("datadog.check.status", "unknown")],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
          {
            resource: {
              attributes: [
                kv("host.name", "db-1"),
                kv("deployment.environment.name", "prod"),
              ],
            },
            scopeMetrics: [
              {
                scope: { name: "datadog" },
                metrics: [
                  {
                    name: "postgres.can_connect",
                    gauge: {
                      dataPoints: [
                        {
                          timeUnixNano: "1700000000000000000",
                          asDouble: 2,
                          attributes: [
                            kv("datadog.check.status", "critical"),
                            kv(
                              "datadog.check.message",
                              "could not connect to server: Connection refused",
                            ),
                            kv("port", "5432"),
                            kv("db", "orders"),
                            kv("env", "prod"),
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
          {
            resource: {
              attributes: [
                kv("service.name", "storefront"),
                kv("host.name", "web-1"),
              ],
            },
            scopeMetrics: [
              {
                scope: { name: "datadog" },
                metrics: [
                  {
                    name: "http.can_connect",
                    gauge: {
                      dataPoints: [
                        {
                          timeUnixNano: "1700000010000000000",
                          asDouble: 1,
                          attributes: [
                            kv("datadog.check.status", "warning"),
                            kv("datadog.check.message", "Slow response"),
                            kv("url", "https://shop.example.com/health"),
                            kv("service", "storefront"),
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
      pointCount: 5,
      droppedPointCount: 0,
    });

    expect(JSON.parse(JSON.stringify(translation.metrics))).toStrictEqual(
      translation.metrics,
    );
  });

  it("drops check runs with no name, an unknown status or a time that is no time, and counts them", () => {
    const translation: DatadogMetricsTranslation =
      DatadogIntake.checkRunsToOtlp([
        { check: "a", status: 4 },
        { check: "b", status: "0" },
        { check: "c", status: 1.5 },
        { check: "d", status: -1 },
        { status: 0 },
        { check: "e", status: 0, timestamp: "soon" },
        "not a check run",
        null,
        { check: "kept", status: 0, timestamp: 1700000000 },
      ]);

    expect(translation.pointCount).toBe(1);
    expect(translation.droppedPointCount).toBe(8);
  });

  it("reads one check run on its own, and names the service after the header", () => {
    const translation: DatadogMetricsTranslation =
      DatadogIntake.checkRunsToOtlp(
        {
          check: "redis.can_connect",
          host_name: "cache-1",
          status: 0,
          timestamp: 1700000000,
          tags: ["service:redis"],
        },
        { serviceName: "platform" },
      );

    expect(translation.pointCount).toBe(1);
    expect(
      attributesOf(resourceMetricsOf(translation)[0]!["resource"]),
    ).toEqual({ "service.name": "platform", "host.name": "cache-1" });
    expect(attributeKeysOf(allDataPointsOf(translation)[0])).toEqual([
      "datadog.check.status",
      "service",
    ]);
  });

  test.each<[unknown]>([["check"], [5], [null], [true]])(
    "throws a 400 DatadogIntakeError for a payload that is no check runs: %p",
    (json: unknown): void => {
      expect(
        errorOf(() => {
          return DatadogIntake.checkRunsToOtlp(json);
        }).statusCode,
      ).toBe(400);
    },
  );

  it("is no metrics for no check runs", () => {
    expect(DatadogIntake.checkRunsToOtlp([])).toEqual({
      metrics: null,
      pointCount: 0,
      droppedPointCount: 0,
    });
  });
});

describe("agent_payload.proto", () => {
  type FieldRow = [name: string, id: number, type: string, repeated: boolean];

  const fieldsOf: (typeName: string) => Array<FieldRow> = (
    typeName: string,
  ): Array<FieldRow> => {
    return DatadogMetricPayload.root
      .lookupType(`datadog.agentpayload.${typeName}`)
      .fieldsArray.map((field: protobuf.Field): FieldRow => {
        return [field.name, field.id, field.type, field.repeated];
      });
  };

  it("keeps agent-payload's field numbers and types", () => {
    expect(fieldsOf("MetricPayload")).toEqual([
      ["series", 1, "MetricSeries", true],
    ]);
    expect(fieldsOf("MetricPayload.MetricSeries")).toEqual([
      ["resources", 1, "Resource", true],
      ["metric", 2, "string", false],
      ["tags", 3, "string", true],
      ["points", 4, "MetricPoint", true],
      ["type", 5, "MetricType", false],
      ["unit", 6, "string", false],
      ["sourceTypeName", 7, "string", false],
      ["interval", 8, "int64", false],
      ["metadata", 9, "Metadata", false],
    ]);
    expect(fieldsOf("MetricPayload.MetricPoint")).toEqual([
      ["value", 1, "double", false],
      ["timestamp", 2, "int64", false],
    ]);
    expect(fieldsOf("MetricPayload.Resource")).toEqual([
      ["type", 1, "string", false],
      ["name", 2, "string", false],
    ]);
    expect(fieldsOf("SketchPayload")).toEqual([
      ["sketches", 1, "Sketch", true],
      ["metadata", 2, "CommonMetadata", false],
    ]);
    expect(fieldsOf("SketchPayload.Sketch")).toEqual([
      ["metric", 1, "string", false],
      ["host", 2, "string", false],
      ["distributions", 3, "Distribution", true],
      ["tags", 4, "string", true],
      ["dogsketches", 7, "Dogsketch", true],
      ["metadata", 8, "Metadata", false],
    ]);
    expect(fieldsOf("SketchPayload.Sketch.Dogsketch")).toEqual([
      ["ts", 1, "int64", false],
      ["cnt", 2, "int64", false],
      ["min", 3, "double", false],
      ["max", 4, "double", false],
      ["avg", 5, "double", false],
      ["sum", 6, "double", false],
      ["k", 7, "sint32", true],
      ["n", 8, "uint32", true],
    ]);
    expect(fieldsOf("SketchPayload.Sketch.Distribution")).toEqual([
      ["ts", 1, "int64", false],
      ["cnt", 2, "int64", false],
      ["min", 3, "double", false],
      ["max", 4, "double", false],
      ["avg", 5, "double", false],
      ["sum", 6, "double", false],
      ["v", 7, "double", true],
      ["g", 8, "uint32", true],
      ["delta", 9, "uint32", true],
      ["buf", 10, "double", true],
    ]);
    expect(fieldsOf("Metadata")).toEqual([["origin", 1, "Origin", false]]);
    expect(fieldsOf("Origin")).toEqual([
      ["originProduct", 4, "uint32", false],
      ["originCategory", 5, "uint32", false],
      ["originService", 6, "uint32", false],
    ]);
    expect(fieldsOf("CommonMetadata")).toEqual([
      ["agentVersion", 1, "string", false],
      ["timezone", 2, "string", false],
      ["currentEpoch", 3, "double", false],
      ["internalIp", 4, "string", false],
      ["publicIp", 5, "string", false],
      ["apiKey", 6, "string", false],
    ]);
  });

  it("keeps MetricType's numbers and Sketch's reserved fields", () => {
    expect(
      DatadogMetricPayload.root.lookupEnum(
        "datadog.agentpayload.MetricPayload.MetricType",
      ).values,
    ).toEqual({ UNSPECIFIED: 0, COUNT: 1, RATE: 2, GAUGE: 3 });
    expect(
      DatadogSketchPayload.root.lookupType(
        "datadog.agentpayload.SketchPayload.Sketch",
      ).reserved,
    ).toEqual([[5, 5], [6, 6], "distributionsK", "distributionsC"]);
  });
});
