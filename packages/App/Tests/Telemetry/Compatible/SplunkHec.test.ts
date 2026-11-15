import { describe, expect, it, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import SplunkHec, {
  HEC_HTTP_STATUS,
  HEC_RESPONSES,
  MAX_HEC_EVENTS_PER_REQUEST,
  SplunkHecEventsOtlp,
  SplunkHecParseFailure,
  SplunkHecParseResult,
  SplunkHecRawOtlp,
  SplunkHecTranslateOptions,
} from "../../../FeatureSet/Telemetry/Utils/Compatible/SplunkHec";

/*
 * Splunk HTTP Event Collector requests as OTLP: the events of
 * /services/collector/event (JSON objects, concatenated) and the lines of
 * /services/collector/raw, as the clients teams already run send them -
 * Splunk's Docker logging driver, Fluent Bit, the OpenTelemetry Collector's
 * splunk_hec exporter, Splunk Connect for Kubernetes, Splunk's logging
 * libraries, and the curl examples in Splunk's documentation.
 */

const NOW_MS: number = 1_700_000_100_000;
const NOW_UNIX_NANO: string = "1700000100000000000";

type Attributes = Record<string, unknown>;

// The events parseEvents reads; a refusal fails the test.
function parsedEvents(body: Buffer | string): Array<JSONObject> {
  const result: SplunkHecParseResult = SplunkHec.parseEvents(body);

  if ("error" in result) {
    throw new Error(`Refused: ${JSON.stringify(result)}`);
  }

  return result.events;
}

// The refusal parseEvents answers; reading events fails the test.
function refusalOf(body: Buffer | string): SplunkHecParseFailure {
  const result: SplunkHecParseResult = SplunkHec.parseEvents(body);

  if (!("error" in result)) {
    throw new Error(`Not refused: read ${result.events.length} events`);
  }

  return result;
}

function concatenated(events: Array<JSONObject>, separator: string): string {
  return events
    .map((event: JSONObject): string => {
      return JSON.stringify(event);
    })
    .join(separator);
}

function translate(
  body: string,
  options?: SplunkHecTranslateOptions,
): SplunkHecEventsOtlp {
  return SplunkHec.eventsToOtlp(parsedEvents(body), {
    nowInMs: NOW_MS,
    ...options,
  });
}

function resourceLogsOf(
  otlp: SplunkHecEventsOtlp | SplunkHecRawOtlp,
): Array<JSONObject> {
  expect(otlp.logs).not.toBeNull();
  return (otlp.logs as JSONObject)["resourceLogs"] as Array<JSONObject>;
}

function logRecordsIn(resourceLog: JSONObject): Array<JSONObject> {
  const scopeLogs: Array<JSONObject> = resourceLog[
    "scopeLogs"
  ] as Array<JSONObject>;

  expect(scopeLogs).toHaveLength(1);
  expect(scopeLogs[0]!["scope"]).toEqual({ name: "splunk-hec" });

  return scopeLogs[0]!["logRecords"] as Array<JSONObject>;
}

function logRecordsOf(
  otlp: SplunkHecEventsOtlp | SplunkHecRawOtlp,
): Array<JSONObject> {
  const logRecords: Array<JSONObject> = [];

  for (const resourceLog of resourceLogsOf(otlp)) {
    logRecords.push(...logRecordsIn(resourceLog));
  }

  return logRecords;
}

function onlyLogRecord(otlp: SplunkHecEventsOtlp): JSONObject {
  const logRecords: Array<JSONObject> = logRecordsOf(otlp);

  expect(logRecords).toHaveLength(1);

  return logRecords[0]!;
}

function bodyOf(logRecord: JSONObject): unknown {
  return (logRecord["body"] as JSONObject)["stringValue"];
}

// Attributes as key -> value, whichever of OTLP's value fields holds it.
function attributesOf(attributes: unknown): Attributes {
  const result: Attributes = {};

  for (const attribute of attributes as Array<{
    key: string;
    value: Record<string, unknown>;
  }>) {
    expect(Object.keys(attribute.value)).toHaveLength(1);
    result[attribute.key] = Object.values(attribute.value)[0];
  }

  return result;
}

function resourceAttributesOf(resource: JSONObject): Attributes {
  return attributesOf((resource["resource"] as JSONObject)["attributes"]);
}

function resourceMetricsOf(otlp: SplunkHecEventsOtlp): Array<JSONObject> {
  expect(otlp.metrics).not.toBeNull();
  return (otlp.metrics as JSONObject)["resourceMetrics"] as Array<JSONObject>;
}

function metricsIn(resourceMetric: JSONObject): Array<JSONObject> {
  const scopeMetrics: Array<JSONObject> = resourceMetric[
    "scopeMetrics"
  ] as Array<JSONObject>;

  expect(scopeMetrics).toHaveLength(1);
  expect(scopeMetrics[0]!["scope"]).toEqual({ name: "splunk-hec" });

  return scopeMetrics[0]!["metrics"] as Array<JSONObject>;
}

function dataPointsOf(metric: JSONObject): Array<JSONObject> {
  return (metric["gauge"] as JSONObject)["dataPoints"] as Array<JSONObject>;
}

function metricNamesIn(resourceMetric: JSONObject): Array<unknown> {
  return metricsIn(resourceMetric).map((metric: JSONObject): unknown => {
    return metric["name"];
  });
}

function manyEvents(count: number): string {
  return Array.from({ length: count }, (_: unknown, index: number): string => {
    return `{"event":"event ${index}"}`;
  }).join("");
}

/*
 * Splunk's Docker logging driver (splunk-format=inline, the default): one
 * object a line, its time a string with six decimals, the container's line,
 * stream and tag in an object event.
 */
const DOCKER_LOGGING_DRIVER_BODY: string =
  '{"event":{"line":"GET /healthz HTTP/1.1 200 3ms","source":"stdout","tag":"0e94a4d6d5f5"},"time":"1700000000.123456","host":"docker-host-01"}\n' +
  '{"event":{"line":"connection refused: redis:6379","source":"stderr","tag":"0e94a4d6d5f5","attrs":{"com.docker.compose.service":"web"}},"time":"1700000000.223456","host":"docker-host-01","source":"docker","sourcetype":"httpevent","index":"main"}\n';

const KUBERNETES_METADATA: JSONObject = {
  pod_name: "api-6d4cf56db6-7xk2p",
  namespace_name: "shop",
  container_name: "api",
  labels: { app: "api" },
};

// Fluent Bit's splunk output: the record as the event, objects back to back.
const FLUENT_BIT_BODY: string = concatenated(
  [
    {
      time: 1700000001.5,
      event: {
        log: 'level=warn msg="slow query" duration=1.2s',
        stream: "stdout",
        level: "warn",
        kubernetes: KUBERNETES_METADATA,
      },
    },
    {
      time: 1700000001.75,
      event: {
        log: "GET /cart 200",
        stream: "stdout",
        kubernetes: KUBERNETES_METADATA,
      },
    },
  ],
  "",
);

/*
 * The OpenTelemetry Collector's splunk_hec exporter: the record's body as
 * the event, its resource and record attributes - service.name with them -
 * and its trace context and severity as indexed fields.
 */
const OTEL_EXPORTER_LOG: JSONObject = {
  time: 1700000002.345,
  host: "ip-10-0-0-12",
  source: "otel",
  sourcetype: "otel",
  index: "main",
  event: "payment authorized for order 7781",
  fields: {
    "service.name": "checkout",
    "deployment.environment": "production",
    "k8s.pod.name": "checkout-7f9c6b-xk2p",
    "otel.log.severity.text": "Information",
    "otel.log.severity.number": 9,
    trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
    span_id: "00f067aa0ba902b7",
  },
};

function otelExporterMetric(fields: JSONObject): JSONObject {
  return {
    time: 1700000003.5,
    host: "ip-10-0-0-12",
    source: "otel",
    sourcetype: "otel",
    event: "metric",
    fields: { "service.name": "checkout", ...fields },
  };
}

// The exporter's metric events: one point each, its type in metric_type.
const OTEL_EXPORTER_METRICS_BODY: string = concatenated(
  [
    otelExporterMetric({
      "http.route": "/pay",
      metric_type: "Gauge",
      "metric_name:http.server.active_requests": 4,
    }),
    otelExporterMetric({
      "http.route": "/refund",
      metric_type: "Gauge",
      "metric_name:http.server.active_requests": 1,
    }),
    otelExporterMetric({
      "http.route": "/pay",
      metric_type: "Histogram",
      "metric_name:http.server.duration_sum": 1234.5,
    }),
    otelExporterMetric({
      "http.route": "/pay",
      metric_type: "Histogram",
      le: "+Inf",
      "metric_name:http.server.duration_bucket": 42,
    }),
    otelExporterMetric({
      metric_type: "Gauge",
      "metric_name:queue.depth": "NaN",
    }),
  ],
  "\n",
);

// Splunk Connect for Kubernetes (fluentd-hec): the line, and indexed fields.
const SPLUNK_CONNECT_FOR_KUBERNETES_EVENT: JSONObject = {
  host: "ip-10-0-1-5.ec2.internal",
  source: "/var/log/containers/nginx-7c5ddbdf54-2xkqv_default_nginx-3f2a.log",
  sourcetype: "kube:container:nginx",
  index: "k8s",
  time: 1700000004.123,
  event:
    '10.0.0.1 - - [14/Nov/2023:22:13:24 +0000] "GET / HTTP/1.1" 200 615 "-" "curl/8.4.0"',
  fields: {
    container_name: "nginx",
    namespace: "default",
    pod: "nginx-7c5ddbdf54-2xkqv",
    container_id: "3f2a9c0d1e7b",
    cluster_name: "prod-eks",
  },
};

// Splunk's metrics format, as Splunk's documentation sends it with curl.
const SPLUNK_DOCS_SINGLE_METRIC: string =
  '{"time": 1486683865.000, "event":"metric", "source":"disk", "host":"host_99", "fields":{"region":"us-west-1", "datacenter":"us-west-1a", "rack":"63", "os":"Ubuntu16.10", "arch":"x64", "team":"LON", "service":"6", "service_version":"0", "service_environment":"test", "path":"/dev/sda1", "fstype":"ext3", "_value":1099511627776, "metric_name":"total"}}';

const SPLUNK_DOCS_MULTIPLE_METRICS: string =
  '{"time": 1486683865, "event": "metric", "source": "metrics", "sourcetype": "perflog", "host": "host_1.splunk.com", "fields": {"service_version": "0", "service_environment": "test", "path": "/dev/sda1", "fstype": "ext3", "metric_name:cpu.usr": 11.12, "metric_name:cpu.sys": 12.23, "metric_name:cpu.idle": 13.34}}';

describe("HEC's answers", () => {
  it("are written exactly as Splunk writes them, with Splunk's HTTP statuses", () => {
    expect(HEC_RESPONSES).toEqual({
      success: { text: "Success", code: 0 },
      tokenRequired: { text: "Token is required", code: 2 },
      invalidAuthorization: { text: "Invalid authorization", code: 3 },
      invalidToken: { text: "Invalid token", code: 4 },
      noData: { text: "No data", code: 5 },
      invalidDataFormat: { text: "Invalid data format", code: 6 },
      internalServerError: { text: "Internal server error", code: 8 },
      serverBusy: { text: "Server is busy", code: 9 },
      eventFieldRequired: { text: "Event field is required", code: 12 },
      eventFieldBlank: { text: "Event field cannot be blank", code: 13 },
      healthy: { text: "HEC is healthy", code: 17 },
    });

    expect(HEC_HTTP_STATUS).toEqual({
      success: 200,
      tokenRequired: 401,
      invalidAuthorization: 401,
      invalidToken: 403,
      noData: 400,
      invalidDataFormat: 400,
      internalServerError: 500,
      serverBusy: 503,
      eventFieldRequired: 400,
      eventFieldBlank: 400,
      healthy: 200,
    });

    // Byte for byte, text before code, as clients that compare bodies see.
    expect(JSON.stringify(HEC_RESPONSES.success)).toBe(
      '{"text":"Success","code":0}',
    );
    expect(JSON.stringify(HEC_RESPONSES.healthy)).toBe(
      '{"text":"HEC is healthy","code":17}',
    );
  });

  it("name the invalid event of a refused batch, as HEC does", () => {
    expect(
      SplunkHec.refusalFor({
        error: "invalidDataFormat",
        invalidEventNumber: 2,
      }),
    ).toEqual({
      httpStatus: 400,
      body: { text: "Invalid data format", code: 6, "invalid-event-number": 2 },
    });

    expect(
      SplunkHec.refusalFor(refusalOf('{"event":"ok"}{"host":"web-01"}')),
    ).toEqual({
      httpStatus: 400,
      body: {
        text: "Event field is required",
        code: 12,
        "invalid-event-number": 1,
      },
    });

    expect(SplunkHec.refusalFor(refusalOf('{"event":"   "}'))).toEqual({
      httpStatus: 400,
      body: {
        text: "Event field cannot be blank",
        code: 13,
        "invalid-event-number": 0,
      },
    });
  });

  it("do not name an event for an empty request, which has none", () => {
    expect(SplunkHec.refusalFor(refusalOf(""))).toEqual({
      httpStatus: 400,
      body: { text: "No data", code: 5 },
    });
  });

  it("are not changed by building a refusal", () => {
    SplunkHec.refusalFor({ error: "invalidDataFormat", invalidEventNumber: 3 });

    expect(HEC_RESPONSES.invalidDataFormat).toEqual({
      text: "Invalid data format",
      code: 6,
    });
  });
});

describe("SplunkHec.parseEvents", () => {
  it("reads one event, as Splunk's curl example sends it", () => {
    expect(SplunkHec.parseEvents('{"event": "hello world"}')).toEqual({
      events: [{ event: "hello world" }],
      droppedEventCount: 0,
    });
  });

  it("reads events concatenated with nothing between them, as Fluent Bit sends them", () => {
    expect(
      parsedEvents('{"event":"one"}{"event":"two"}{"event":"three"}'),
    ).toEqual([{ event: "one" }, { event: "two" }, { event: "three" }]);
  });

  it("reads events separated by newlines, CRLF, spaces and tabs", () => {
    expect(
      parsedEvents(
        '\n{"event":"one"}\r\n\r\n{"event":"two"} \t {"event":"three"}\n\n',
      ),
    ).toEqual([{ event: "one" }, { event: "two" }, { event: "three" }]);

    expect(parsedEvents(DOCKER_LOGGING_DRIVER_BODY)).toHaveLength(2);
  });

  it("does not end an event at a brace inside a string", () => {
    expect(
      parsedEvents(
        '{"event":"a } b"}{"event":"{ not an object"}{"event":"}{","fields":{"x":"}}}"}}',
      ),
    ).toEqual([
      { event: "a } b" },
      { event: "{ not an object" },
      { event: "}{", fields: { x: "}}}" } },
    ]);
  });

  it("does not end a string at an escaped quote, and does at a quote after escaped backslashes", () => {
    expect(
      parsedEvents(
        String.raw`{"event":"say \"}{\" twice","fields":{"q":"\""}}`,
      ),
    ).toEqual([{ event: 'say "}{" twice', fields: { q: '"' } }]);

    expect(
      parsedEvents(String.raw`{"event":"C:\\temp\\"}{"event":"next"}`),
    ).toEqual([{ event: "C:\\temp\\" }, { event: "next" }]);

    expect(parsedEvents(String.raw`{"event":"\\\"}"}{"event":"\\\\"}`)).toEqual(
      [{ event: '\\"}' }, { event: "\\\\" }],
    );
  });

  it("reads nested objects and unicode as they are", () => {
    expect(
      parsedEvents(
        '{"event":{"a":{"b":{}}},"fields":{"x":"}"}}{"event":"café ☕ 日本語 \\u00e9"}',
      ),
    ).toEqual([
      { event: { a: { b: {} } }, fields: { x: "}" } },
      { event: "café ☕ 日本語 é" },
    ]);
  });

  it("keeps a large event whole, with braces, quotes and runs of backslashes in it", () => {
    const message: string = `${"x".repeat(2 * 1024 * 1024)} } { "quoted" ${"\\".repeat(1024)}`;
    const records: Array<JSONObject> = logRecordsOf(
      translate(concatenated([{ event: message }, { event: "after it" }], "")),
    );

    expect(records).toHaveLength(2);
    expect(bodyOf(records[0]!)).toBe(message);
    expect(bodyOf(records[1]!)).toBe("after it");
  });

  it("reads a JSON array of events, though HEC itself refuses one", () => {
    expect(
      SplunkHec.parseEvents('  [ {"event":"one"}, {"event":"two"} ]\n'),
    ).toEqual({
      events: [{ event: "one" }, { event: "two" }],
      droppedEventCount: 0,
    });
  });

  it("reads a Buffer, without the byte order mark some clients write", () => {
    expect(parsedEvents(Buffer.from('{"event":"from a buffer"}'))).toEqual([
      { event: "from a buffer" },
    ]);

    expect(
      parsedEvents(
        Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]),
          Buffer.from('{"event":"after a BOM"}'),
        ]),
      ),
    ).toEqual([{ event: "after a BOM" }]);

    expect(parsedEvents('\uFEFF[{"event":"array after a BOM"}]')).toEqual([
      { event: "array after a BOM" },
    ]);
  });

  it("accepts number and boolean events, which are not blank", () => {
    expect(parsedEvents('{"event":0}{"event":false}{"event":3.14}')).toEqual([
      { event: 0 },
      { event: false },
      { event: 3.14 },
    ]);
  });

  test.each(["", "   ", "\n\r\n\t ", "[]", "  [ ]  ", "\uFEFF"])(
    "refuses %j as No data",
    (body: string) => {
      expect(SplunkHec.parseEvents(body)).toEqual({
        error: "noData",
        invalidEventNumber: 0,
      });
    },
  );

  test.each([
    { body: '{"event":"one"}{"event":', invalidEventNumber: 1 },
    { body: '{"event":"one"}{"event": nope}', invalidEventNumber: 1 },
    { body: '{"event":"one"},{"event":"two"}', invalidEventNumber: 1 },
    { body: '{"event":"one"}{"event":"two"}trailing', invalidEventNumber: 2 },
    { body: '{"event":"one"}}', invalidEventNumber: 1 },
    { body: '"just a string"', invalidEventNumber: 0 },
    { body: "42", invalidEventNumber: 0 },
    { body: '{"event":"unterminated string}', invalidEventNumber: 0 },
    { body: '{event:"unquoted key"}', invalidEventNumber: 0 },
    {
      body: '{"event":"one"}\n{"event":"two"}\n{"event":"three",}',
      invalidEventNumber: 2,
    },
    { body: '{"event":"one"}[{"event":"two"}]', invalidEventNumber: 1 },
    { body: '[{"event":"one"},{"event":"two"}', invalidEventNumber: 0 },
    { body: '[{"event":"one"}]{"event":"two"}', invalidEventNumber: 0 },
    { body: '[{"event":"one"}, "two"]', invalidEventNumber: 1 },
    { body: '[{"event":"one"}, null]', invalidEventNumber: 1 },
    { body: '[{"event":"one"}, [{"event":"two"}]]', invalidEventNumber: 1 },
  ])(
    "refuses $body as Invalid data format at event $invalidEventNumber",
    (row: { body: string; invalidEventNumber: number }) => {
      expect(SplunkHec.parseEvents(row.body)).toEqual({
        error: "invalidDataFormat",
        invalidEventNumber: row.invalidEventNumber,
      });
    },
  );

  test.each([
    { body: '{"event":"one"}{"time":1700000000,"host":"web-01"}', number: 1 },
    { body: "{}", number: 0 },
    { body: '{"Event":"spelled otherwise"}', number: 0 },
    { body: '{"fields":{"event":"in the fields"}}', number: 0 },
    { body: '[{"event":"one"},{"event":"two"},{"host":"web-01"}]', number: 2 },
  ])(
    "refuses $body as Event field is required at event $number",
    (row: { body: string; number: number }) => {
      expect(SplunkHec.parseEvents(row.body)).toEqual({
        error: "eventFieldRequired",
        invalidEventNumber: row.number,
      });
    },
  );

  test.each(['""', '"   "', '"\\n\\t"', "{}", "[]", "null"])(
    "refuses an event of %s as Event field cannot be blank, naming it",
    (event: string) => {
      expect(
        SplunkHec.parseEvents(
          `{"event":"one"}\n{"event":${event}}\n{"event":"three"}`,
        ),
      ).toEqual({ error: "eventFieldBlank", invalidEventNumber: 1 });
    },
  );

  it("refuses the whole request for one invalid event, as HEC does", () => {
    const result: SplunkHecParseResult = SplunkHec.parseEvents(
      concatenated(
        [{ event: "one" }, { event: "two" }, { event: "" }, { event: "four" }],
        "",
      ),
    );

    expect(result).toEqual({ error: "eventFieldBlank", invalidEventNumber: 2 });
    expect(result).not.toHaveProperty("events");
  });

  it("keeps the first 100,000 events of a request, and counts the rest", () => {
    const result: SplunkHecParseResult = SplunkHec.parseEvents(
      manyEvents(MAX_HEC_EVENTS_PER_REQUEST + 2),
    );

    if ("error" in result) {
      throw new Error("Refused");
    }

    expect(MAX_HEC_EVENTS_PER_REQUEST).toBe(100_000);
    expect(result.events).toHaveLength(MAX_HEC_EVENTS_PER_REQUEST);
    expect(result.events[0]).toEqual({ event: "event 0" });
    expect(result.events[MAX_HEC_EVENTS_PER_REQUEST - 1]).toEqual({
      event: `event ${MAX_HEC_EVENTS_PER_REQUEST - 1}`,
    });
    expect(result.droppedEventCount).toBe(2);
  });

  it("does not read past the cap: what follows is counted, even what is not valid", () => {
    expect(
      SplunkHec.parseEvents(
        `${manyEvents(MAX_HEC_EVENTS_PER_REQUEST)} {"event":"x"} {"event":`,
      ),
    ).toMatchObject({ droppedEventCount: 2 });
  });

  it("keeps the first 100,000 events of an array, and counts the rest", () => {
    const result: SplunkHecParseResult = SplunkHec.parseEvents(
      `[${Array.from({ length: MAX_HEC_EVENTS_PER_REQUEST + 5 }, (): string => {
        return '{"event":"e"}';
      }).join(",")}]`,
    );

    if ("error" in result) {
      throw new Error("Refused");
    }

    expect(result.events).toHaveLength(MAX_HEC_EVENTS_PER_REQUEST);
    expect(result.droppedEventCount).toBe(5);
  });
});

describe("SplunkHec.eventsToOtlp: logs from real clients", () => {
  it("reads Splunk's Docker logging driver: the line is the body, the stream and tag attributes", () => {
    const otlp: SplunkHecEventsOtlp = translate(DOCKER_LOGGING_DRIVER_BODY);

    expect(otlp.logCount).toBe(2);
    expect(otlp.metrics).toBeNull();
    expect(otlp.metricPointCount).toBe(0);

    const resourceLogs: Array<JSONObject> = resourceLogsOf(otlp);
    expect(resourceLogs).toHaveLength(2);

    expect((resourceLogs[0]!["resource"] as JSONObject)["attributes"]).toEqual([
      { key: "host.name", value: { stringValue: "docker-host-01" } },
    ]);

    expect(logRecordsIn(resourceLogs[0]!)).toEqual([
      {
        timeUnixNano: "1700000000123456000",
        observedTimeUnixNano: NOW_UNIX_NANO,
        severityNumber: 0,
        severityText: "",
        body: { stringValue: "GET /healthz HTTP/1.1 200 3ms" },
        attributes: [
          { key: "source", value: { stringValue: "stdout" } },
          { key: "tag", value: { stringValue: "0e94a4d6d5f5" } },
        ],
      },
    ]);

    expect(resourceAttributesOf(resourceLogs[1]!)).toEqual({
      "host.name": "docker-host-01",
      "com.splunk.source": "docker",
      "com.splunk.sourcetype": "httpevent",
      "com.splunk.index": "main",
    });

    const stderrRecord: JSONObject = logRecordsIn(resourceLogs[1]!)[0]!;

    expect(bodyOf(stderrRecord)).toBe("connection refused: redis:6379");
    expect(stderrRecord["timeUnixNano"]).toBe("1700000000223456000");
    expect(attributesOf(stderrRecord["attributes"])).toEqual({
      source: "stderr",
      tag: "0e94a4d6d5f5",
      "attrs.com.docker.compose.service": "web",
    });
  });

  it("reads Fluent Bit: the log is the body, the Kubernetes metadata flattened, the level the severity", () => {
    const otlp: SplunkHecEventsOtlp = translate(FLUENT_BIT_BODY);
    const resourceLogs: Array<JSONObject> = resourceLogsOf(otlp);

    // No metadata, no service: one resource with no attributes at all.
    expect(resourceLogs).toHaveLength(1);
    expect(resourceAttributesOf(resourceLogs[0]!)).toEqual({});

    const [warning, request] = logRecordsIn(resourceLogs[0]!) as [
      JSONObject,
      JSONObject,
    ];

    expect(warning).toMatchObject({
      timeUnixNano: "1700000001500000000",
      severityNumber: 13,
      severityText: "WARN",
      body: { stringValue: 'level=warn msg="slow query" duration=1.2s' },
    });
    expect(attributesOf(warning["attributes"])).toEqual({
      stream: "stdout",
      level: "warn",
      "kubernetes.pod_name": "api-6d4cf56db6-7xk2p",
      "kubernetes.namespace_name": "shop",
      "kubernetes.container_name": "api",
      "kubernetes.labels.app": "api",
    });

    expect(request).toMatchObject({
      timeUnixNano: "1700000001750000000",
      severityNumber: 0,
      severityText: "",
      body: { stringValue: "GET /cart 200" },
    });
  });

  it("reads the OpenTelemetry Collector's splunk_hec exporter: its service, severity and trace context come back", () => {
    const otlp: SplunkHecEventsOtlp = translate(
      JSON.stringify(OTEL_EXPORTER_LOG),
    );

    const resourceLog: JSONObject = resourceLogsOf(otlp)[0]!;

    expect((resourceLog["resource"] as JSONObject)["attributes"]).toEqual([
      { key: "service.name", value: { stringValue: "checkout" } },
      { key: "host.name", value: { stringValue: "ip-10-0-0-12" } },
      { key: "com.splunk.source", value: { stringValue: "otel" } },
      { key: "com.splunk.sourcetype", value: { stringValue: "otel" } },
      { key: "com.splunk.index", value: { stringValue: "main" } },
    ]);

    const logRecord: JSONObject = onlyLogRecord(otlp);

    expect(logRecord).toMatchObject({
      timeUnixNano: "1700000002345000000",
      observedTimeUnixNano: NOW_UNIX_NANO,
      severityNumber: 9,
      severityText: "INFO",
      body: { stringValue: "payment authorized for order 7781" },
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
    });

    // service.name is the resource's, never repeated on the record.
    expect(logRecord["attributes"]).toEqual([
      {
        key: "deployment.environment",
        value: { stringValue: "production" },
      },
      { key: "k8s.pod.name", value: { stringValue: "checkout-7f9c6b-xk2p" } },
      {
        key: "otel.log.severity.text",
        value: { stringValue: "Information" },
      },
      { key: "otel.log.severity.number", value: { intValue: "9" } },
      {
        key: "trace_id",
        value: { stringValue: "4bf92f3577b34da6a3ce929d0e0e4736" },
      },
      { key: "span_id", value: { stringValue: "00f067aa0ba902b7" } },
    ]);
  });

  it("reads Splunk Connect for Kubernetes: the line is the body, the indexed fields attributes", () => {
    const otlp: SplunkHecEventsOtlp = translate(
      JSON.stringify(SPLUNK_CONNECT_FOR_KUBERNETES_EVENT),
    );

    expect(resourceAttributesOf(resourceLogsOf(otlp)[0]!)).toEqual({
      "host.name": "ip-10-0-1-5.ec2.internal",
      "com.splunk.source":
        "/var/log/containers/nginx-7c5ddbdf54-2xkqv_default_nginx-3f2a.log",
      "com.splunk.sourcetype": "kube:container:nginx",
      "com.splunk.index": "k8s",
    });

    const logRecord: JSONObject = onlyLogRecord(otlp);

    expect(logRecord["timeUnixNano"]).toBe("1700000004123000000");
    expect(bodyOf(logRecord)).toBe(
      '10.0.0.1 - - [14/Nov/2023:22:13:24 +0000] "GET / HTTP/1.1" 200 615 "-" "curl/8.4.0"',
    );
    expect(attributesOf(logRecord["attributes"])).toEqual({
      container_name: "nginx",
      namespace: "default",
      pod: "nginx-7c5ddbdf54-2xkqv",
      container_id: "3f2a9c0d1e7b",
      cluster_name: "prod-eks",
    });
  });

  it("reads the curl examples in Splunk's documentation", () => {
    const otlp: SplunkHecEventsOtlp = translate(
      '{"event": "Hello, world!", "sourcetype": "manual"}',
    );

    expect(resourceAttributesOf(resourceLogsOf(otlp)[0]!)).toEqual({
      "com.splunk.sourcetype": "manual",
    });
    expect(onlyLogRecord(otlp)).toEqual({
      timeUnixNano: NOW_UNIX_NANO,
      observedTimeUnixNano: NOW_UNIX_NANO,
      severityNumber: 0,
      severityText: "",
      body: { stringValue: "Hello, world!" },
      attributes: [],
    });

    // Batched events; a top-level key that is not HEC's is not kept.
    const batched: SplunkHecEventsOtlp = translate(
      '{"event": "Pony 1 has left the barn"}{"event": "Pony 2 has left the barn"}{"event": "Pony 3 has left the barn", "nested": {"key1": "value1"}}',
    );

    expect(batched.logCount).toBe(3);
    expect(logRecordsOf(batched).map(bodyOf)).toEqual([
      "Pony 1 has left the barn",
      "Pony 2 has left the barn",
      "Pony 3 has left the barn",
    ]);
    expect(logRecordsOf(batched)[2]!["attributes"]).toEqual([]);

    // Indexed fields, one of them multi-valued.
    const indexed: JSONObject = onlyLogRecord(
      translate(
        '{"event": "Hello, world!", "sourcetype": "cool-fields", "fields": {"device": "macbook", "users": ["joe", "bob"]}}',
      ),
    );

    expect(indexed["attributes"]).toEqual([
      { key: "device", value: { stringValue: "macbook" } },
      { key: "users", value: { stringValue: '["joe","bob"]' } },
    ]);
  });

  it("reads Splunk's Java logging library: its message, severity and exception", () => {
    const logRecord: JSONObject = onlyLogRecord(
      translate(
        '{"time":"1700000005.000","host":"app-01","source":"java","sourcetype":"log4j","event":{"severity":"ERROR","logger":"com.acme.checkout.PaymentService","thread":"http-nio-8080-exec-3","message":"Payment declined","exception":{"class":"java.lang.IllegalStateException","message":"card expired"}}}',
      ),
    );

    expect(logRecord).toMatchObject({
      timeUnixNano: "1700000005000000000",
      severityNumber: 17,
      severityText: "ERROR",
      body: { stringValue: "Payment declined" },
    });
    expect(attributesOf(logRecord["attributes"])).toEqual({
      severity: "ERROR",
      logger: "com.acme.checkout.PaymentService",
      thread: "http-nio-8080-exec-3",
      "exception.class": "java.lang.IllegalStateException",
      "exception.message": "card expired",
    });
  });

  it("reads Serilog's Splunk sink: its rendered message and Level", () => {
    const logRecord: JSONObject = onlyLogRecord(
      translate(
        String.raw`{"time":"1700000006.120","event":{"Level":"Warning","MessageTemplate":"Cart {CartId} abandoned","RenderedMessage":"Cart \"c-91\" abandoned","Properties":{"CartId":"c-91"}},"source":"shop-api","sourcetype":"_json","host":"web-03"}`,
      ),
    );

    expect(logRecord).toMatchObject({
      timeUnixNano: "1700000006120000000",
      severityNumber: 13,
      severityText: "WARN",
      body: { stringValue: 'Cart "c-91" abandoned' },
    });
    expect(attributesOf(logRecord["attributes"])).toEqual({
      Level: "Warning",
      MessageTemplate: "Cart {CartId} abandoned",
      "Properties.CartId": "c-91",
    });
  });

  it("reads journald entries: MESSAGE is the body, PRIORITY the severity", () => {
    const logRecord: JSONObject = onlyLogRecord(
      translate(
        '{"time":1700000007,"event":{"MESSAGE":"Started Daily apt download activities.","PRIORITY":"6","SYSLOG_IDENTIFIER":"systemd","_HOSTNAME":"node-1"}}',
      ),
    );

    expect(logRecord).toMatchObject({
      timeUnixNano: "1700000007000000000",
      severityNumber: 9,
      severityText: "INFO",
      body: { stringValue: "Started Daily apt download activities." },
    });
    expect(attributesOf(logRecord["attributes"])).toEqual({
      PRIORITY: "6",
      SYSLOG_IDENTIFIER: "systemd",
      _HOSTNAME: "node-1",
    });
  });
});

describe("SplunkHec.eventsToOtlp: bodies and attributes", () => {
  it("keeps a string event as it is, whitespace and all", () => {
    expect(
      bodyOf(onlyLogRecord(translate('{"event":"  indented line  "}'))),
    ).toBe("  indented line  ");
  });

  it("writes a number or boolean event as its text, and an array as its JSON", () => {
    expect(
      logRecordsOf(
        translate(
          '{"event":42}{"event":0}{"event":true}{"event":false}{"event":-1.5}{"event":["a",1,{"b":null}]}',
        ),
      ).map(bodyOf),
    ).toEqual(["42", "0", "true", "false", "-1.5", '["a",1,{"b":null}]']);
  });

  it("takes the first message key holding text as the body, in order, and keeps the others as attributes", () => {
    const records: Array<JSONObject> = logRecordsOf(
      translate(
        concatenated(
          [
            { event: { message: "first", msg: "second", log: "third" } },
            { event: { msg: "from msg", message: 5 } },
            { event: { message: "", log: "from log" } },
            { event: { text: "from text", line: "from line" } },
            { event: { MESSAGE: "from MESSAGE", text: { not: "text" } } },
          ],
          "\n",
        ),
      ),
    );

    expect(records.map(bodyOf)).toEqual([
      "first",
      "from msg",
      "from log",
      "from line",
      "from MESSAGE",
    ]);

    expect(records[0]!["attributes"]).toEqual([
      { key: "msg", value: { stringValue: "second" } },
      { key: "log", value: { stringValue: "third" } },
    ]);
    expect(records[1]!["attributes"]).toEqual([
      { key: "message", value: { intValue: "5" } },
    ]);
    expect(records[2]!["attributes"]).toEqual([
      { key: "message", value: { stringValue: "" } },
    ]);
    expect(records[3]!["attributes"]).toEqual([
      { key: "text", value: { stringValue: "from text" } },
    ]);
    expect(records[4]!["attributes"]).toEqual([
      { key: "text.not", value: { stringValue: "text" } },
    ]);
  });

  it("writes an object event without a message as its JSON, and still keeps its keys as attributes", () => {
    const logRecord: JSONObject = onlyLogRecord(
      translate(
        '{"event":{"action":"login","user":{"id":7,"admin":false},"tags":["web","eu"],"note":null}}',
      ),
    );

    expect(bodyOf(logRecord)).toBe(
      '{"action":"login","user":{"id":7,"admin":false},"tags":["web","eu"],"note":null}',
    );
    expect(logRecord["attributes"]).toEqual([
      { key: "action", value: { stringValue: "login" } },
      { key: "user.id", value: { intValue: "7" } },
      { key: "user.admin", value: { boolValue: false } },
      { key: "tags", value: { stringValue: '["web","eu"]' } },
    ]);
  });

  it("keeps indexed fields typed, arrays as JSON, nested objects flattened, nulls out", () => {
    const logRecord: JSONObject = onlyLogRecord(
      translate(
        JSON.stringify({
          event: "checkout finished",
          fields: {
            device: "macbook",
            users: ["joe", "bob"],
            cpu: 4,
            load: 0.75,
            canary: true,
            missing: null,
            geo: { region: "eu", zone: { id: "b" } },
          },
        }),
      ),
    );

    expect(logRecord["attributes"]).toEqual([
      { key: "device", value: { stringValue: "macbook" } },
      { key: "users", value: { stringValue: '["joe","bob"]' } },
      { key: "cpu", value: { intValue: "4" } },
      { key: "load", value: { doubleValue: 0.75 } },
      { key: "canary", value: { boolValue: true } },
      { key: "geo.region", value: { stringValue: "eu" } },
      { key: "geo.zone.id", value: { stringValue: "b" } },
    ]);
  });

  it("keeps a key the fields and the event both have once, as the field says it", () => {
    const logRecord: JSONObject = onlyLogRecord(
      translate(
        JSON.stringify({
          event: { message: "m", region: "from the event", extra: 1 },
          fields: { region: "from the fields" },
        }),
      ),
    );

    expect(logRecord["attributes"]).toEqual([
      { key: "region", value: { stringValue: "from the fields" } },
      { key: "extra", value: { intValue: "1" } },
    ]);
  });

  it("leaves out fields that are not an object", () => {
    expect(
      logRecordsOf(
        translate(
          '{"event":"a","fields":"device=macbook"}{"event":"b","fields":["x"]}',
        ),
      ).map((logRecord: JSONObject): unknown => {
        return logRecord["attributes"];
      }),
    ).toEqual([[], []]);
  });

  it("skips an event parseEvents would refuse, when handed one directly", () => {
    const otlp: SplunkHecEventsOtlp = SplunkHec.eventsToOtlp(
      [{ host: "web-01" }, { event: "" }, { event: {} }, { event: "kept" }],
      { nowInMs: NOW_MS },
    );

    expect(otlp.logCount).toBe(1);
    expect(logRecordsOf(otlp).map(bodyOf)).toEqual(["kept"]);
  });

  it("writes nothing when there is nothing to write", () => {
    expect(SplunkHec.eventsToOtlp([], { nowInMs: NOW_MS })).toEqual({
      logs: null,
      metrics: null,
      logCount: 0,
      metricPointCount: 0,
      droppedMetricPointCount: 0,
    });
  });
});

describe("SplunkHec.eventsToOtlp: times", () => {
  test.each([
    {
      label: "a decimal string's nine fractional digits, exactly",
      time: '"1426279439.123456789"',
      unixNano: "1426279439123456789",
    },
    {
      label: "a decimal string with milliseconds",
      time: '"1426279439.123"',
      unixNano: "1426279439123000000",
    },
    {
      label: "a decimal string with surrounding spaces",
      time: '" 1426279439.25 "',
      unixNano: "1426279439250000000",
    },
    {
      label: "fractional digits past nine, dropped",
      time: '"1426279439.1234567891"',
      unixNano: "1426279439123456789",
    },
    {
      label: "whole seconds",
      time: "1426279439",
      unixNano: "1426279439000000000",
    },
    {
      label: "whole seconds written with decimals",
      time: "1426279439.000",
      unixNano: "1426279439000000000",
    },
    {
      label: "a fractional number",
      time: "1426279439.5",
      unixNano: "1426279439500000000",
    },
    {
      label: "milliseconds, as a number",
      time: "1426279439123",
      unixNano: "1426279439123000000",
    },
    {
      label: "milliseconds, as a string",
      time: '"1426279439123"',
      unixNano: "1426279439123000000",
    },
    {
      label: "milliseconds with a fraction",
      time: '"1426279439123.456"',
      unixNano: "1426279439123456000",
    },
    {
      label: "microseconds",
      time: "1426279439123456",
      unixNano: "1426279439123456000",
    },
    {
      label: "nanoseconds, as a string",
      time: '"1426279439123456789"',
      unixNano: "1426279439123456789",
    },
  ])(
    "reads $label",
    (row: { label: string; time: string; unixNano: string }) => {
      expect(
        onlyLogRecord(translate(`{"event":"x","time":${row.time}}`))[
          "timeUnixNano"
        ],
      ).toBe(row.unixNano);
    },
  );

  test.each([
    '"yesterday"',
    '"2023-11-14T22:13:20Z"',
    '""',
    '"1e9"',
    '"-5"',
    "-5",
    "0",
    '"0"',
    '"0.000"',
    "true",
    "null",
    '{"seconds":1426279439}',
    '"9999999999"',
    '"99999999999999999999999"',
    `"${"1".repeat(100)}"`,
  ])("reads %s as no time: the record is stamped now", (time: string) => {
    expect(
      onlyLogRecord(translate(`{"event":"x","time":${time}}`))["timeUnixNano"],
    ).toBe(NOW_UNIX_NANO);
  });

  it("stamps an event without a time with the query string's, or now", () => {
    const withDefault: Array<JSONObject> = logRecordsOf(
      translate('{"event":"no time"}{"event":"own time","time":1426279439}', {
        defaults: { time: "1700000000.5" },
      }),
    );

    expect(
      withDefault.map((logRecord: JSONObject): unknown => {
        return logRecord["timeUnixNano"];
      }),
    ).toEqual(["1700000000500000000", "1426279439000000000"]);

    expect(
      onlyLogRecord(
        translate('{"event":"no time"}', { defaults: { time: "soon" } }),
      )["timeUnixNano"],
    ).toBe(NOW_UNIX_NANO);
  });

  it("observes every record now", () => {
    expect(
      logRecordsOf(translate(DOCKER_LOGGING_DRIVER_BODY)).map(
        (logRecord: JSONObject): unknown => {
          return logRecord["observedTimeUnixNano"];
        },
      ),
    ).toEqual([NOW_UNIX_NANO, NOW_UNIX_NANO]);
  });
});

describe("SplunkHec.eventsToOtlp: resources", () => {
  it("takes an event's own metadata over the query string's, which fills in the rest", () => {
    const otlp: SplunkHecEventsOtlp = translate(
      concatenated(
        [
          { event: "from the query string" },
          {
            event: "its own",
            host: "web-02",
            source: "app.log",
            sourcetype: "app",
            index: "prod",
          },
          { event: "blank metadata", host: "  ", source: "", sourcetype: 5 },
        ],
        "\n",
      ),
      {
        defaults: {
          host: "web-01",
          source: "hec",
          sourcetype: "_json",
          index: "main",
        },
      },
    );

    const resourceLogs: Array<JSONObject> = resourceLogsOf(otlp);

    expect(resourceLogs.map(resourceAttributesOf)).toEqual([
      {
        "host.name": "web-01",
        "com.splunk.source": "hec",
        "com.splunk.sourcetype": "_json",
        "com.splunk.index": "main",
      },
      {
        "host.name": "web-02",
        "com.splunk.source": "app.log",
        "com.splunk.sourcetype": "app",
        "com.splunk.index": "prod",
      },
      {
        "host.name": "web-01",
        "com.splunk.source": "hec",
        "com.splunk.sourcetype": "5",
        "com.splunk.index": "main",
      },
    ]);
    expect(logRecordsIn(resourceLogs[0]!).map(bodyOf)).toEqual([
      "from the query string",
    ]);
  });

  it("groups records into one resource per distinct service and metadata, in the order first seen", () => {
    const otlp: SplunkHecEventsOtlp = translate(
      concatenated(
        [
          {
            event: "a",
            host: "web-01",
            fields: { "service.name": "checkout" },
          },
          { event: "b", host: "web-01" },
          {
            event: "c",
            host: "web-02",
            fields: { "service.name": "checkout" },
          },
          {
            event: "d",
            host: "web-01",
            fields: { "service.name": "checkout" },
          },
          { event: "e", host: "web-01", fields: { service: "checkout" } },
          { event: "f", host: "web-01", index: "audit" },
        ],
        "",
      ),
    );

    const resourceLogs: Array<JSONObject> = resourceLogsOf(otlp);

    expect(resourceLogs.map(resourceAttributesOf)).toEqual([
      { "service.name": "checkout", "host.name": "web-01" },
      { "host.name": "web-01" },
      { "service.name": "checkout", "host.name": "web-02" },
      { "host.name": "web-01", "com.splunk.index": "audit" },
    ]);
    expect(
      resourceLogs.map((resourceLog: JSONObject): Array<unknown> => {
        return logRecordsIn(resourceLog).map(bodyOf);
      }),
    ).toEqual([["a", "d", "e"], ["b"], ["c"], ["f"]]);
  });

  it("names the service from service.name, then service, and keeps service as an attribute", () => {
    const otlp: SplunkHecEventsOtlp = translate(
      concatenated(
        [
          {
            event: "both",
            fields: { "service.name": "checkout", service: "payments" },
          },
          { event: "service only", fields: { service: " payments " } },
        ],
        "",
      ),
    );
    const records: Array<JSONObject> = logRecordsOf(otlp);

    expect(resourceLogsOf(otlp).map(resourceAttributesOf)).toEqual([
      { "service.name": "checkout" },
      { "service.name": "payments" },
    ]);
    expect(records[0]!["attributes"]).toEqual([
      { key: "service", value: { stringValue: "payments" } },
    ]);
    expect(records[1]!["attributes"]).toEqual([
      { key: "service", value: { stringValue: " payments " } },
    ]);
  });

  it("files everything under the route's service when it names one", () => {
    const otlp: SplunkHecEventsOtlp = translate(
      concatenated(
        [
          { event: "a", fields: { "service.name": "checkout" } },
          { event: "b", fields: { service: "payments" } },
          { event: "c" },
        ],
        "",
      ),
      { serviceName: "storefront" },
    );

    expect(resourceLogsOf(otlp).map(resourceAttributesOf)).toEqual([
      { "service.name": "storefront" },
    ]);

    const records: Array<JSONObject> = logRecordsOf(otlp);

    expect(records[0]!["attributes"]).toEqual([]);
    expect(records[1]!["attributes"]).toEqual([
      { key: "service", value: { stringValue: "payments" } },
    ]);
  });

  it("leaves service.name unset when nothing names a service", () => {
    const resourceLog: JSONObject = resourceLogsOf(
      translate('{"event":"x","host":"web-01","fields":{"service.name":"  "}}'),
    )[0]!;

    expect((resourceLog["resource"] as JSONObject)["attributes"]).toEqual([
      { key: "host.name", value: { stringValue: "web-01" } },
    ]);
  });
});

describe("SplunkHec.eventsToOtlp: severity", () => {
  test.each([
    { event: { message: "m", level: "warning" }, number: 13, text: "WARN" },
    { event: { message: "m", level: "ERR" }, number: 17, text: "ERROR" },
    { event: { message: "m", severity: "notice" }, number: 10, text: "INFO2" },
    { event: { message: "m", log_level: "crit" }, number: 18, text: "ERROR2" },
    { event: { message: "m", loglevel: "emerg" }, number: 21, text: "FATAL" },
    { event: { message: "m", level: 3 }, number: 17, text: "ERROR" },
    { event: { message: "m", severity: "4" }, number: 13, text: "WARN" },
    { event: { message: "m", level: 0 }, number: 21, text: "FATAL" },
    { event: { message: "m", level: 7 }, number: 5, text: "DEBUG" },
    { event: { message: "m", status: "error" }, number: 17, text: "ERROR" },
    { event: { message: "m", status: "ok" }, number: 9, text: "INFO" },
    { event: { message: "m", status: 0 }, number: 0, text: "" },
    { event: { message: "m", status: 500 }, number: 0, text: "" },
    { event: { message: "m", status: "200" }, number: 0, text: "" },
    { event: { message: "m", level: 30 }, number: 0, text: "" },
    { event: { message: "m", level: "8" }, number: 0, text: "" },
    {
      event: { message: "m", severity: "high", log_level: "debug" },
      number: 5,
      text: "DEBUG",
    },
    {
      event: { message: "m", status: 200, level: "warn" },
      number: 13,
      text: "WARN",
    },
    { event: { message: "m", Level: "Information" }, number: 9, text: "INFO" },
    { event: { MESSAGE: "m", PRIORITY: "3" }, number: 17, text: "ERROR" },
    { event: { message: "m" }, number: 0, text: "" },
    { event: "m", number: 0, text: "" },
  ])(
    "reads $event as severity $number",
    (row: { event: JSONObject | string; number: number; text: string }) => {
      expect(
        onlyLogRecord(translate(JSON.stringify({ event: row.event }))),
      ).toMatchObject({ severityNumber: row.number, severityText: row.text });
    },
  );

  test.each([
    {
      label: "a level field over the event's own level",
      fields: { level: "info" },
      number: 9,
      text: "INFO",
    },
    {
      label: "the exporter's severity number over any level",
      fields: { "otel.log.severity.number": 17, level: "info" },
      number: 17,
      text: "ERROR",
    },
    {
      label: "the exporter's severity number, with its place in the range",
      fields: { "otel.log.severity.number": 10 },
      number: 10,
      text: "INFO2",
    },
    {
      label: "the exporter's severity number written as text",
      fields: { "otel.log.severity.number": "24" },
      number: 24,
      text: "FATAL4",
    },
    {
      label: "the exporter's severity text when its number is no severity",
      fields: {
        "otel.log.severity.number": 99,
        "otel.log.severity.text": "Warning",
      },
      number: 13,
      text: "WARN",
    },
    {
      label: "a level when the exporter's fields say nothing",
      fields: {
        "otel.log.severity.number": 0,
        "otel.log.severity.text": "?",
        log_level: "trace",
      },
      number: 1,
      text: "TRACE",
    },
  ])(
    "reads $label",
    (row: {
      label: string;
      fields: JSONObject;
      number: number;
      text: string;
    }) => {
      expect(
        onlyLogRecord(
          translate(
            JSON.stringify({
              event: { message: "m", level: "error" },
              fields: row.fields,
            }),
          ),
        ),
      ).toMatchObject({ severityNumber: row.number, severityText: row.text });
    },
  );
});

describe("SplunkHec.eventsToOtlp: trace context", () => {
  it("reads trace_id and span_id from the fields, and traceId and spanId from the event", () => {
    const records: Array<JSONObject> = logRecordsOf(
      translate(
        concatenated(
          [
            {
              event: "from the fields",
              fields: {
                trace_id: "4BF92F3577B34DA6A3CE929D0E0E4736",
                span_id: "00F067AA0BA902B7",
              },
            },
            {
              event: {
                message: "from the event",
                traceId: "0af7651916cd43dd8448eb211c80319c",
                spanId: "b7ad6b7169203331",
              },
            },
            {
              event: {
                message: "a UUID-shaped trace ID",
                trace_id: "0af76519-16cd-43dd-8448-eb211c80319c",
              },
            },
            {
              event: { message: "fields first", traceId: "1".repeat(32) },
              fields: { trace_id: "2".repeat(32) },
            },
          ],
          "\n",
        ),
      ),
    );

    expect(records[0]).toMatchObject({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
    });
    expect(records[1]).toMatchObject({
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
    });
    expect(records[2]).toMatchObject({
      traceId: "0af7651916cd43dd8448eb211c80319c",
    });
    expect(records[2]).not.toHaveProperty("spanId");
    expect(records[3]).toMatchObject({ traceId: "2".repeat(32) });
  });

  it("drops IDs that are not hex of the right length, or are all zeros", () => {
    const records: Array<JSONObject> = logRecordsOf(
      translate(
        concatenated(
          [
            {
              event: "x",
              fields: { trace_id: "not-a-trace-id", span_id: "zz" },
            },
            {
              event: "y",
              fields: { trace_id: "0".repeat(32), span_id: "0".repeat(16) },
            },
            { event: "z", fields: { trace_id: "a".repeat(33), span_id: 12 } },
          ],
          "",
        ),
      ),
    );

    for (const logRecord of records) {
      expect(logRecord).not.toHaveProperty("traceId");
      expect(logRecord).not.toHaveProperty("spanId");
    }
  });
});

describe("SplunkHec.eventsToOtlp: metric events", () => {
  it("reads the OpenTelemetry Collector's metric events as gauges, one metric per name", () => {
    const otlp: SplunkHecEventsOtlp = translate(OTEL_EXPORTER_METRICS_BODY);

    expect(otlp.logs).toBeNull();
    expect(otlp.logCount).toBe(0);
    expect(otlp.metricPointCount).toBe(4);
    // queue.depth was NaN, which the exporter writes as "NaN".
    expect(otlp.droppedMetricPointCount).toBe(1);

    const resourceMetrics: Array<JSONObject> = resourceMetricsOf(otlp);
    expect(resourceMetrics).toHaveLength(1);

    expect(
      (resourceMetrics[0]!["resource"] as JSONObject)["attributes"],
    ).toEqual([
      { key: "service.name", value: { stringValue: "checkout" } },
      { key: "host.name", value: { stringValue: "ip-10-0-0-12" } },
      { key: "com.splunk.source", value: { stringValue: "otel" } },
      { key: "com.splunk.sourcetype", value: { stringValue: "otel" } },
    ]);

    const metrics: Array<JSONObject> = metricsIn(resourceMetrics[0]!);

    expect(metricNamesIn(resourceMetrics[0]!)).toEqual([
      "http.server.active_requests",
      "http.server.duration_sum",
      "http.server.duration_bucket",
    ]);

    expect(metrics[0]).toEqual({
      name: "http.server.active_requests",
      gauge: {
        dataPoints: [
          {
            timeUnixNano: "1700000003500000000",
            asDouble: 4,
            attributes: [
              { key: "http.route", value: { stringValue: "/pay" } },
              { key: "metric_type", value: { stringValue: "Gauge" } },
            ],
          },
          {
            timeUnixNano: "1700000003500000000",
            asDouble: 1,
            attributes: [
              { key: "http.route", value: { stringValue: "/refund" } },
              { key: "metric_type", value: { stringValue: "Gauge" } },
            ],
          },
        ],
      },
    });

    expect(dataPointsOf(metrics[1]!)[0]!["asDouble"]).toBe(1234.5);
    expect(attributesOf(dataPointsOf(metrics[2]!)[0]!["attributes"])).toEqual({
      "http.route": "/pay",
      metric_type: "Histogram",
      le: "+Inf",
    });
  });

  it("reads Splunk's single-measurement format: metric_name and _value", () => {
    const otlp: SplunkHecEventsOtlp = translate(SPLUNK_DOCS_SINGLE_METRIC, {
      defaults: { index: "metrics" },
    });

    const resourceMetric: JSONObject = resourceMetricsOf(otlp)[0]!;

    /*
     * Splunk's own example has a `service` dimension ("6"). On a metric
     * event it stays a dimension: only service.name names a metric's
     * service, so no service called "6" appears.
     */
    expect(resourceAttributesOf(resourceMetric)).toEqual({
      "host.name": "host_99",
      "com.splunk.source": "disk",
      "com.splunk.index": "metrics",
    });

    expect(metricsIn(resourceMetric)).toEqual([
      {
        name: "total",
        gauge: {
          dataPoints: [
            {
              timeUnixNano: "1486683865000000000",
              asDouble: 1099511627776,
              attributes: [
                { key: "region", value: { stringValue: "us-west-1" } },
                { key: "datacenter", value: { stringValue: "us-west-1a" } },
                { key: "rack", value: { stringValue: "63" } },
                { key: "os", value: { stringValue: "Ubuntu16.10" } },
                { key: "arch", value: { stringValue: "x64" } },
                { key: "team", value: { stringValue: "LON" } },
                { key: "service", value: { stringValue: "6" } },
                { key: "service_version", value: { stringValue: "0" } },
                { key: "service_environment", value: { stringValue: "test" } },
                { key: "path", value: { stringValue: "/dev/sda1" } },
                { key: "fstype", value: { stringValue: "ext3" } },
              ],
            },
          ],
        },
      },
    ]);
  });

  it("reads Splunk's multiple-measurement format: one metric_name:<name> field each", () => {
    const otlp: SplunkHecEventsOtlp = translate(SPLUNK_DOCS_MULTIPLE_METRICS);
    const resourceMetric: JSONObject = resourceMetricsOf(otlp)[0]!;

    expect(otlp.metricPointCount).toBe(3);
    expect(resourceAttributesOf(resourceMetric)).toEqual({
      "host.name": "host_1.splunk.com",
      "com.splunk.source": "metrics",
      "com.splunk.sourcetype": "perflog",
    });

    const metrics: Array<JSONObject> = metricsIn(resourceMetric);

    expect(metricNamesIn(resourceMetric)).toEqual([
      "cpu.usr",
      "cpu.sys",
      "cpu.idle",
    ]);
    expect(
      metrics.map((metric: JSONObject): unknown => {
        return dataPointsOf(metric)[0]!["asDouble"];
      }),
    ).toEqual([11.12, 12.23, 13.34]);

    for (const metric of metrics) {
      expect(dataPointsOf(metric)).toHaveLength(1);
      expect(dataPointsOf(metric)[0]).toMatchObject({
        timeUnixNano: "1486683865000000000",
        attributes: [
          { key: "service_version", value: { stringValue: "0" } },
          { key: "service_environment", value: { stringValue: "test" } },
          { key: "path", value: { stringValue: "/dev/sda1" } },
          { key: "fstype", value: { stringValue: "ext3" } },
        ],
      });
    }
  });

  it("reads numbers and numeric text as values, and drops everything else", () => {
    const otlp: SplunkHecEventsOtlp = translate(
      JSON.stringify({
        time: 1700000000,
        event: "metric",
        fields: {
          "metric_name:decimal_text": "42.5",
          "metric_name:padded_text": " 7 ",
          "metric_name:exponent_text": "1e3",
          "metric_name:negative": -3,
          "metric_name:not_a_number": "n/a",
          "metric_name:empty": "",
          "metric_name:boolean": true,
          "metric_name:null": null,
          "metric_name:positive_infinity": "+Inf",
          "metric_name:negative_infinity": "-Inf",
          "metric_name:infinity": "Infinity",
          "metric_name:overflow": "1e400",
          "metric_name:hex": "0x10",
          "metric_name:array": [1],
          "metric_name:long": "1".repeat(200),
        },
      }),
    );

    const resourceMetric: JSONObject = resourceMetricsOf(otlp)[0]!;

    expect(metricNamesIn(resourceMetric)).toEqual([
      "decimal_text",
      "padded_text",
      "exponent_text",
      "negative",
    ]);
    expect(
      metricsIn(resourceMetric).map((metric: JSONObject): unknown => {
        return dataPointsOf(metric)[0]!["asDouble"];
      }),
    ).toEqual([42.5, 7, 1000, -3]);
    expect(otlp.metricPointCount).toBe(4);
    expect(otlp.droppedMetricPointCount).toBe(11);
  });

  it("reads metric_name and metric_name:<name> fields in the same event", () => {
    const otlp: SplunkHecEventsOtlp = translate(
      '{"event":"metric","time":1700000000,"fields":{"metric_name":" requests ","_value":"5","metric_name:errors":1,"route":"/pay"}}',
    );

    const metrics: Array<JSONObject> = metricsIn(resourceMetricsOf(otlp)[0]!);

    expect(
      metrics.map((metric: JSONObject): unknown => {
        return [metric["name"], dataPointsOf(metric)[0]!["asDouble"]];
      }),
    ).toEqual([
      ["requests", 5],
      ["errors", 1],
    ]);
    expect(dataPointsOf(metrics[0]!)[0]!["attributes"]).toEqual([
      { key: "route", value: { stringValue: "/pay" } },
    ]);
  });

  it("writes nothing for a metric event without a measurement, and never a log", () => {
    expect(
      translate(
        '{"event":"metric","fields":{"region":"eu"}}{"event":"metric"}{"event":"metric","fields":{"metric_name":"  ","_value":3}}{"event":"metric","fields":{"metric_name:":3}}',
      ),
    ).toEqual({
      logs: null,
      metrics: null,
      logCount: 0,
      metricPointCount: 0,
      droppedMetricPointCount: 0,
    });

    // No resource is left without a metric when every value is dropped.
    expect(
      translate('{"event":"metric","fields":{"metric_name:a":"NaN"}}'),
    ).toEqual({
      logs: null,
      metrics: null,
      logCount: 0,
      metricPointCount: 0,
      droppedMetricPointCount: 1,
    });
  });

  it("stamps a metric event without a time with the query string's, or now", () => {
    const body: string = '{"event":"metric","fields":{"metric_name:up":1}}';

    expect(
      dataPointsOf(
        metricsIn(
          resourceMetricsOf(
            translate(body, { defaults: { time: "1700000000" } }),
          )[0]!,
        )[0]!,
      )[0]!["timeUnixNano"],
    ).toBe("1700000000000000000");

    expect(
      dataPointsOf(metricsIn(resourceMetricsOf(translate(body))[0]!)[0]!)[0]![
        "timeUnixNano"
      ],
    ).toBe(NOW_UNIX_NANO);
  });

  it("splits logs and metric events of one request, and groups points by resource", () => {
    const otlp: SplunkHecEventsOtlp = translate(
      concatenated(
        [
          { event: "a log line", host: "web-01" },
          {
            event: "metric",
            host: "web-01",
            fields: { "metric_name:cpu.idle": 93.5 },
          },
          {
            event: "metric",
            host: "web-02",
            fields: { "metric_name:cpu.idle": 71 },
          },
          {
            event: "metric",
            host: "web-01",
            fields: {
              "metric_name:cpu.idle": 92.25,
              "metric_name:mem.free": 2048,
            },
          },
          { event: "another log line", host: "web-02" },
        ],
        "\n",
      ),
    );

    expect(otlp.logCount).toBe(2);
    expect(otlp.metricPointCount).toBe(4);
    expect(logRecordsOf(otlp).map(bodyOf)).toEqual([
      "a log line",
      "another log line",
    ]);

    const resourceMetrics: Array<JSONObject> = resourceMetricsOf(otlp);

    expect(resourceMetrics.map(resourceAttributesOf)).toEqual([
      { "host.name": "web-01" },
      { "host.name": "web-02" },
    ]);
    expect(metricNamesIn(resourceMetrics[0]!)).toEqual([
      "cpu.idle",
      "mem.free",
    ]);
    expect(
      dataPointsOf(metricsIn(resourceMetrics[0]!)[0]!).map(
        (dataPoint: JSONObject): unknown => {
          return dataPoint["asDouble"];
        },
      ),
    ).toEqual([93.5, 92.25]);
    expect(metricNamesIn(resourceMetrics[1]!)).toEqual(["cpu.idle"]);
  });
});

describe("SplunkHec output", () => {
  it("is JSON that round-trips: no NaN or infinity anywhere", () => {
    const otlp: SplunkHecEventsOtlp = translate(
      [
        DOCKER_LOGGING_DRIVER_BODY,
        FLUENT_BIT_BODY,
        JSON.stringify(OTEL_EXPORTER_LOG),
        OTEL_EXPORTER_METRICS_BODY,
        JSON.stringify(SPLUNK_CONNECT_FOR_KUBERNETES_EVENT),
        SPLUNK_DOCS_SINGLE_METRIC,
        SPLUNK_DOCS_MULTIPLE_METRICS,
      ].join("\n"),
    );

    expect(otlp.logCount).toBe(6);
    expect(otlp.metricPointCount).toBe(8);

    for (const payload of [otlp.logs, otlp.metrics]) {
      const json: string = JSON.stringify(payload);

      expect(JSON.parse(json)).toEqual(payload);
      expect(json).not.toMatch(/NaN|Infinity|null/);
    }

    for (const resourceMetric of resourceMetricsOf(otlp)) {
      for (const metric of metricsIn(resourceMetric)) {
        for (const dataPoint of dataPointsOf(metric)) {
          expect(Number.isFinite(dataPoint["asDouble"])).toBe(true);
        }
      }
    }
  });
});

describe("SplunkHec.rawToOtlp", () => {
  it("makes each line that is not blank a record, its text as it is", () => {
    const otlp: SplunkHecRawOtlp = SplunkHec.rawToOtlp(
      '2023-11-14 22:13:20 INFO  starting worker\r\n2023-11-14 22:13:21 WARN  disk /var at 91%\n\n   \n\t  indented continuation  \n{"looks":"like json"}\nbare\rcarriage return\nlast line\r',
      { nowInMs: NOW_MS },
    );

    expect(otlp.logCount).toBe(6);
    expect(otlp.droppedEventCount).toBe(0);
    expect(logRecordsOf(otlp).map(bodyOf)).toEqual([
      "2023-11-14 22:13:20 INFO  starting worker",
      "2023-11-14 22:13:21 WARN  disk /var at 91%",
      "\t  indented continuation  ",
      '{"looks":"like json"}',
      "bare\rcarriage return",
      "last line",
    ]);

    expect(logRecordsOf(otlp)[0]).toEqual({
      timeUnixNano: NOW_UNIX_NANO,
      observedTimeUnixNano: NOW_UNIX_NANO,
      severityNumber: 0,
      severityText: "",
      body: { stringValue: "2023-11-14 22:13:20 INFO  starting worker" },
      attributes: [],
    });
  });

  it("takes its resource and time from the query string", () => {
    const otlp: SplunkHecRawOtlp = SplunkHec.rawToOtlp(
      Buffer.from("1, 2, 3... Hello, world!\nGoodbye.\n"),
      {
        nowInMs: NOW_MS,
        defaults: {
          host: "web-01",
          source: "nginx",
          sourcetype: "nginx:access",
          index: "web",
          time: "1700000000.25",
        },
      },
    );

    const resourceLogs: Array<JSONObject> = resourceLogsOf(otlp);

    expect(resourceLogs).toHaveLength(1);
    expect((resourceLogs[0]!["resource"] as JSONObject)["attributes"]).toEqual([
      { key: "host.name", value: { stringValue: "web-01" } },
      { key: "com.splunk.source", value: { stringValue: "nginx" } },
      { key: "com.splunk.sourcetype", value: { stringValue: "nginx:access" } },
      { key: "com.splunk.index", value: { stringValue: "web" } },
    ]);
    expect(
      logRecordsOf(otlp).map((logRecord: JSONObject): unknown => {
        return logRecord["timeUnixNano"];
      }),
    ).toEqual(["1700000000250000000", "1700000000250000000"]);
  });

  it("stamps lines now when the query string's time is no time", () => {
    expect(
      logRecordsOf(
        SplunkHec.rawToOtlp("x", {
          nowInMs: NOW_MS,
          defaults: { time: "in a minute" },
        }),
      )[0]!["timeUnixNano"],
    ).toBe(NOW_UNIX_NANO);
  });

  it("files the lines under the route's service when it names one", () => {
    expect(
      resourceAttributesOf(
        resourceLogsOf(
          SplunkHec.rawToOtlp("x", {
            nowInMs: NOW_MS,
            serviceName: "storefront",
            defaults: { host: "web-01" },
          }),
        )[0]!,
      ),
    ).toEqual({ "service.name": "storefront", "host.name": "web-01" });
  });

  test.each(["", "\n", " \r\n\t\n", "\uFEFF"])(
    "writes nothing for %j",
    (body: string) => {
      expect(SplunkHec.rawToOtlp(body, { nowInMs: NOW_MS })).toEqual({
        logs: null,
        logCount: 0,
        droppedEventCount: 0,
      });
    },
  );

  it("reads past a byte order mark", () => {
    expect(
      logRecordsOf(
        SplunkHec.rawToOtlp("\uFEFFfirst line\nsecond line", {
          nowInMs: NOW_MS,
        }),
      ).map(bodyOf),
    ).toEqual(["first line", "second line"]);
  });

  it("keeps the first 100,000 lines of a request, and counts the rest", () => {
    const otlp: SplunkHecRawOtlp = SplunkHec.rawToOtlp(
      "line\n".repeat(MAX_HEC_EVENTS_PER_REQUEST + 3),
      { nowInMs: NOW_MS },
    );

    expect(otlp.logCount).toBe(MAX_HEC_EVENTS_PER_REQUEST);
    expect(otlp.droppedEventCount).toBe(3);
  });
});
