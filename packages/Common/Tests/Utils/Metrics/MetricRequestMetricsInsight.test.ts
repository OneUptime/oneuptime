/*
 * Metrics AI's fourth kind of finding, Missing Request Metrics (Utils/
 * Metrics/MetricInsight): a busy service that sends metrics, but has never
 * sent one of the request metrics OpenTelemetry's semantic conventions name
 * for what its entry spans serve. Held here: which metric names count as
 * request metrics (the semantic conventions' old and new names, the names
 * they take through Prometheus and Micrometer, and the span metrics a
 * collector records), which services the hour's reads leave to ask about,
 * what a sample of a service's entry spans says it serves, and what the
 * finding is called, how severe it is, what a person reads on it and what
 * OneUptime asks the AI for it.
 */

import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../../Types/AI/AIInsightType";
import { MetricInsightEvidence } from "../../../Types/AI/AIInsightEvidence";
import {
  METRIC_INSIGHT_FINGERPRINT_PREFIXES,
  METRIC_INSIGHT_MAX_MISSING_REQUEST_METRICS_SERVICES,
  METRIC_INSIGHT_MAX_SERVED_SPAN_READS,
  METRIC_INSIGHT_MIN_SERVED_SPANS,
  METRIC_INSIGHT_MIN_SERVICE_SPANS,
  METRIC_INSIGHT_REQUEST_METRIC_ATTRIBUTES,
  METRIC_INSIGHT_REQUEST_METRIC_BY_PROTOCOL,
  METRIC_INSIGHT_REQUEST_METRIC_PREFIXES,
  METRIC_INSIGHT_SENT_METRIC_NAMES,
  METRIC_INSIGHT_SERVED_PROTOCOLS,
  METRIC_INSIGHT_SERVED_SPANS,
  METRIC_INSIGHT_SERVED_SPAN_SAMPLE_SIZE,
  METRIC_INSIGHT_TYPE_BY_KIND,
  MetricInsightKind,
  MetricRequestMetricsCandidate,
  MetricServedProtocol,
  MetricServedSpansReading,
  MetricServiceTraffic,
  MetricVolumeReading,
  buildMetricFixEvidenceNote,
  buildMetricFixRequestMessage,
  buildMetricInsightDetail,
  describeMetricProblem,
  describeServedProtocols,
  getEvidenceServedProtocols,
  getMetricFixRequestTitle,
  getMetricInsightFingerprint,
  getMetricInsightSeverity,
  getMetricInsightTitle,
  getMissingRequestMetricNames,
  isMetricInsightFingerprintOfService,
  isMetricServedProtocol,
  isRequestMetricName,
  pickServicesMissingRequestMetrics,
  readServedProtocols,
} from "../../../Utils/Metrics/MetricInsight";
import {
  SPAN_METRICS_CALLS_METRIC,
  SPAN_METRICS_DURATION_METRIC,
} from "../../../Utils/Metrics/SpanMetricsCollectorStep";
import { describe, expect, test } from "@jest/globals";

const CHECKOUT: string = "5231aaaa-0000-4000-8000-0000000000c1";
const WORKER: string = "5231aaaa-0000-4000-8000-0000000000c2";
const EDGE: string = "5231aaaa-0000-4000-8000-0000000000c3";
const SEARCH: string = "5231aaaa-0000-4000-8000-0000000000c4";
// A host's id: metrics are sent for hosts too, and a host is no service.
const HOST: string = "5231aaaa-0000-4000-8000-0000000000c5";

const WINDOW_START: string = "2026-11-03T08:00:00.000Z";
const WINDOW_END: string = "2026-11-03T09:00:00.000Z";

function volume(
  metricName: string,
  serviceId: string,
  dataPointCount: number,
): MetricVolumeReading {
  return { metricName, serviceId, dataPointCount };
}

function traffic(
  serviceId: string,
  spanCount: number,
  failedSpanCount: number = 0,
): MetricServiceTraffic {
  return { serviceId, spanCount, failedSpanCount };
}

function served(
  overrides: Partial<MetricServedSpansReading>,
): MetricServedSpansReading {
  return {
    sampledSpanCount: 1000,
    httpServerSpanCount: 0,
    rpcServerSpanCount: 0,
    messagingConsumerSpanCount: 0,
    ...overrides,
  };
}

function evidence(
  overrides: Partial<MetricInsightEvidence> = {},
): MetricInsightEvidence {
  return {
    serviceId: CHECKOUT,
    kind: MetricInsightKind.MissingRequestMetrics,
    windowStartTime: WINDOW_START,
    windowEndTime: WINDOW_END,
    spanCount: 12400,
    failedSpanCount: 310,
    servedProtocols: [MetricServedProtocol.Http],
    sentMetricNames: [
      "jvm.memory.used",
      "process.cpu.time",
      "db.client.connections.usage",
    ],
    sentMetricCount: 14,
    topOperations: [
      { name: "GET /orders", spanCount: 4000 },
      { name: "POST /checkout", spanCount: 2100 },
    ],
    sdkLanguage: "java",
    ...overrides,
  };
}

describe("which metrics are request metrics", () => {
  test.each([
    // The semantic conventions' own, new and old.
    "http.server.request.duration",
    "http.server.duration",
    "http.server.active_requests",
    "http.server.request.body.size",
    "rpc.server.call.duration",
    "rpc.server.duration",
    "messaging.process.duration",
    "messaging.receive.duration",
    "messaging.client.consumed.messages",
    "messaging.client.operation.duration",
    // The same through Prometheus: dots as underscores, a unit after.
    "http_server_request_duration_seconds",
    "http_server_duration_milliseconds",
    "rpc_server_duration_milliseconds",
    "messaging_process_duration_seconds",
    // Micrometer's (Spring Boot), and through Prometheus.
    "http.server.requests",
    "http_server_requests_seconds",
    // The Prometheus client libraries' own.
    "http_requests_total",
    "http_request_duration_seconds",
    // gRPC's.
    "grpc.server.call.duration",
    "grpc_server_handled_total",
    // Span metrics a collector records, and their older names.
    "traces.span.metrics.calls",
    "traces.span.metrics.duration",
    "traces_span_metrics_calls_total",
    "traces_spanmetrics_calls_total",
    "traces_spanmetrics_latency",
  ])("%s is one", (name: string) => {
    expect(isRequestMetricName(name)).toBe(true);
  });

  test.each([
    // A client's calls out, not the requests it handles.
    "http.client.request.duration",
    "http_client_request_duration_seconds",
    "rpc.client.call.duration",
    "db.client.operation.duration",
    // A producer's sends, not the messages it handles.
    "messaging.publish.duration",
    "messaging.client.sent.messages",
    // The runtime and the process.
    "jvm.memory.used",
    "process.cpu.time",
    "system.cpu.utilization",
    "nodejs.eventloop.delay.p99",
    // Names that only look close.
    "httpserver.duration",
    "my.http.server.request.duration",
    "",
    "   ",
  ])("%s is not one", (name: string) => {
    expect(isRequestMetricName(name)).toBe(false);
  });

  test("names are read without case, and with the spaces round them dropped", () => {
    expect(isRequestMetricName("HTTP.Server.Request.Duration")).toBe(true);
    expect(isRequestMetricName("  http_requests_total ")).toBe(true);
  });

  test("every metric a finding asks for, and the collector step records, ends the finding", () => {
    for (const protocol of METRIC_INSIGHT_SERVED_PROTOCOLS) {
      expect(
        isRequestMetricName(METRIC_INSIGHT_REQUEST_METRIC_BY_PROTOCOL[protocol]),
      ).toBe(true);
    }

    expect(isRequestMetricName(SPAN_METRICS_CALLS_METRIC)).toBe(true);
    expect(isRequestMetricName(SPAN_METRICS_DURATION_METRIC)).toBe(true);
  });

  test("the prefixes are lower case, and each dotted one has its underscored twin", () => {
    for (const prefix of METRIC_INSIGHT_REQUEST_METRIC_PREFIXES) {
      expect(prefix).toBe(prefix.toLowerCase());
      expect(prefix.trim()).toBe(prefix);
    }

    const dotted: Array<string> = METRIC_INSIGHT_REQUEST_METRIC_PREFIXES.filter(
      (prefix: string): boolean => {
        return prefix.includes(".");
      },
    );

    for (const prefix of dotted) {
      expect(METRIC_INSIGHT_REQUEST_METRIC_PREFIXES).toContain(
        prefix.split(".").join("_"),
      );
    }
  });
});

describe("what a service serves", () => {
  test("three kinds of request, in this order, each with the metric and attributes the semantic conventions name", () => {
    expect(METRIC_INSIGHT_SERVED_PROTOCOLS).toEqual([
      MetricServedProtocol.Http,
      MetricServedProtocol.Rpc,
      MetricServedProtocol.Messaging,
    ]);
    expect(METRIC_INSIGHT_REQUEST_METRIC_BY_PROTOCOL).toEqual({
      [MetricServedProtocol.Http]: "http.server.request.duration",
      [MetricServedProtocol.Rpc]: "rpc.server.call.duration",
      [MetricServedProtocol.Messaging]: "messaging.process.duration",
    });
    expect(METRIC_INSIGHT_REQUEST_METRIC_ATTRIBUTES).toEqual({
      [MetricServedProtocol.Http]: [
        "http.request.method",
        "http.route",
        "http.response.status_code",
      ],
      [MetricServedProtocol.Rpc]: [
        "rpc.system.name",
        "rpc.method",
        "rpc.response.status_code",
      ],
      [MetricServedProtocol.Messaging]: [
        "messaging.system",
        "messaging.destination.name",
        "messaging.operation.name",
      ],
    });
    expect(isMetricServedProtocol("Http")).toBe(true);
    expect(isMetricServedProtocol("http")).toBe(false);
    expect(isMetricServedProtocol(undefined)).toBe(false);
  });

  test("an entry span tells by its kind and an attribute, under its new name or its old one", () => {
    expect(METRIC_INSIGHT_SERVED_SPANS).toEqual({
      [MetricServedProtocol.Http]: {
        kind: "SPAN_KIND_SERVER",
        attributeKeys: ["http.request.method", "http.method"],
      },
      [MetricServedProtocol.Rpc]: {
        kind: "SPAN_KIND_SERVER",
        attributeKeys: ["rpc.system.name", "rpc.system"],
      },
      [MetricServedProtocol.Messaging]: {
        kind: "SPAN_KIND_CONSUMER",
        attributeKeys: ["messaging.system"],
      },
    });
  });

  test("a kind of request with 100 or more spans in the sample is served, the others not", () => {
    expect(METRIC_INSIGHT_MIN_SERVED_SPANS).toBe(100);
    expect(METRIC_INSIGHT_SERVED_SPAN_SAMPLE_SIZE).toBe(1000);

    expect(readServedProtocols(served({ httpServerSpanCount: 100 }))).toEqual(
      [MetricServedProtocol.Http],
    );
    expect(readServedProtocols(served({ httpServerSpanCount: 99 }))).toEqual(
      [],
    );
    expect(
      readServedProtocols(
        served({
          httpServerSpanCount: 120,
          rpcServerSpanCount: 40,
          messagingConsumerSpanCount: 880,
        }),
      ),
    ).toEqual([MetricServedProtocol.Http, MetricServedProtocol.Messaging]);
    expect(
      readServedProtocols(
        served({
          httpServerSpanCount: 300,
          rpcServerSpanCount: 300,
          messagingConsumerSpanCount: 300,
        }),
      ),
    ).toEqual([
      MetricServedProtocol.Http,
      MetricServedProtocol.Rpc,
      MetricServedProtocol.Messaging,
    ]);
  });

  test("a sample that could not be read, or reads nothing countable, serves nothing", () => {
    expect(readServedProtocols(null)).toEqual([]);
    expect(readServedProtocols(undefined)).toEqual([]);
    expect(
      readServedProtocols(
        served({ httpServerSpanCount: Number.NaN, rpcServerSpanCount: -5 }),
      ),
    ).toEqual([]);
  });

  test("the evidence's protocols are read back known ones only, in order", () => {
    expect(
      getEvidenceServedProtocols(
        evidence({ servedProtocols: ["Messaging", "Http", "Smtp", "Http"] }),
      ),
    ).toEqual([MetricServedProtocol.Http, MetricServedProtocol.Messaging]);
    expect(
      getEvidenceServedProtocols(evidence({ servedProtocols: undefined })),
    ).toEqual([]);
    expect(
      getEvidenceServedProtocols({
        ...evidence(),
        servedProtocols: "Http" as unknown as Array<string>,
      }),
    ).toEqual([]);
  });

  test("what it handles, in a phrase, and the metrics it lacks, in order", () => {
    expect(describeServedProtocols([MetricServedProtocol.Http])).toBe(
      "HTTP requests",
    );
    expect(
      describeServedProtocols([
        MetricServedProtocol.Messaging,
        MetricServedProtocol.Http,
      ]),
    ).toBe("HTTP requests and messages");
    expect(describeServedProtocols([...METRIC_INSIGHT_SERVED_PROTOCOLS])).toBe(
      "HTTP requests, RPC calls and messages",
    );
    expect(describeServedProtocols([])).toBe("requests");
    expect(
      getMissingRequestMetricNames([
        MetricServedProtocol.Messaging,
        MetricServedProtocol.Rpc,
      ]),
    ).toEqual(["rpc.server.call.duration", "messaging.process.duration"]);
    expect(getMissingRequestMetricNames([])).toEqual([]);
  });
});

describe("pickServicesMissingRequestMetrics", () => {
  const serviceIds: Set<string> = new Set<string>([
    CHECKOUT,
    WORKER,
    EDGE,
    SEARCH,
  ]);

  function pick(data: {
    traffic: Array<MetricServiceTraffic>;
    readings: Array<MetricVolumeReading>;
    excluded?: Array<string>;
  }): Array<MetricRequestMetricsCandidate> {
    return pickServicesMissingRequestMetrics({
      traffic: data.traffic,
      serviceIds,
      readings: data.readings,
      excludedServiceIds: new Set<string>(data.excluded || []),
    });
  }

  test("a busy service that sent its runtime's metrics only is asked about, with its metrics busiest first", () => {
    expect(
      pick({
        traffic: [traffic(CHECKOUT, 12400, 310)],
        readings: [
          volume("process.cpu.time", CHECKOUT, 240),
          volume("jvm.memory.used", CHECKOUT, 960),
          volume("db.client.connections.usage", CHECKOUT, 240),
        ],
      }),
    ).toEqual([
      {
        serviceId: CHECKOUT,
        spanCount: 12400,
        failedSpanCount: 310,
        metricNames: [
          "jvm.memory.used",
          "db.client.connections.usage",
          "process.cpu.time",
        ],
        metricCount: 3,
      },
    ]);
  });

  test("a metric name with an id in it is named by its pattern, never the id, and counted as the metrics it is", () => {
    const [candidate] = pick({
      traffic: [traffic(CHECKOUT, 12400)],
      readings: [
        volume("job.8812.duration", CHECKOUT, 900),
        volume("job.8813.duration", CHECKOUT, 800),
        volume("Runtime.Uptime", CHECKOUT, 60),
        volume("job.6f1c2d3e-4a5b-4c6d-8e7f-001122334455.duration", CHECKOUT, 10),
      ],
    });

    expect(candidate!.metricNames).toEqual([
      "job.{id}.duration",
      // A name with no id keeps its own spelling.
      "Runtime.Uptime",
    ]);
    expect(candidate!.metricCount).toBe(4);
    expect(JSON.stringify(candidate)).not.toContain("8812");
  });

  test("a service that sent a request metric in the hour is not, whatever else it sent", () => {
    expect(
      pick({
        traffic: [traffic(CHECKOUT, 12400)],
        readings: [
          volume("jvm.memory.used", CHECKOUT, 960),
          volume("http_server_requests_seconds", CHECKOUT, 12),
        ],
      }),
    ).toEqual([]);
    expect(
      pick({
        traffic: [traffic(CHECKOUT, 12400)],
        readings: [
          volume("jvm.memory.used", CHECKOUT, 960),
          volume(SPAN_METRICS_DURATION_METRIC, CHECKOUT, 60),
        ],
      }),
    ).toEqual([]);
  });

  test("a service that sent no metric in the hour is Missing Metrics', not this", () => {
    expect(
      pick({
        traffic: [traffic(CHECKOUT, 12400)],
        readings: [volume("jvm.memory.used", WORKER, 960)],
      }),
    ).toEqual([]);
  });

  test("1,000 spans in the hour or more, as busy as a service missing its metrics", () => {
    const readings: Array<MetricVolumeReading> = [
      volume("jvm.memory.used", CHECKOUT, 960),
      volume("jvm.memory.used", WORKER, 960),
    ];

    expect(METRIC_INSIGHT_MIN_SERVICE_SPANS).toBe(1000);
    expect(
      pick({
        traffic: [traffic(CHECKOUT, 1000), traffic(WORKER, 999)],
        readings,
      }).map((candidate: MetricRequestMetricsCandidate): string => {
        return candidate.serviceId;
      }),
    ).toEqual([CHECKOUT]);
    expect(
      pick({
        traffic: [traffic(CHECKOUT, Number.NaN)],
        readings,
      }),
    ).toEqual([]);
  });

  test("only the project's own services, never a company AI tool's", () => {
    const readings: Array<MetricVolumeReading> = [
      volume("system.cpu.utilization", HOST, 100000),
      volume("jvm.memory.used", CHECKOUT, 960),
    ];

    expect(
      pick({
        traffic: [traffic(HOST, 50000), traffic(CHECKOUT, 4000)],
        readings,
        excluded: [CHECKOUT],
      }),
    ).toEqual([]);
  });

  test("busiest first, then by id, with every id read without case", () => {
    expect(
      pick({
        traffic: [
          traffic(EDGE.toUpperCase(), 4000),
          traffic(SEARCH, 9000),
          traffic(WORKER, 4000),
        ],
        readings: [
          volume("runtime.uptime", EDGE, 60),
          volume("runtime.uptime", SEARCH.toUpperCase(), 60),
          volume("runtime.uptime", WORKER, 60),
        ],
      }).map((candidate: MetricRequestMetricsCandidate): string => {
        return candidate.serviceId;
      }),
      // WORKER's id sorts before EDGE's: the two are as busy.
    ).toEqual([SEARCH, WORKER, EDGE]);
  });

  test("a metric sent under two entities is named once", () => {
    const [candidate] = pick({
      traffic: [traffic(CHECKOUT, 4000)],
      readings: [
        volume("jvm.memory.used", CHECKOUT, 960),
        volume("jvm.memory.used", CHECKOUT.toUpperCase(), 10),
        volume("", CHECKOUT, 99999),
      ],
    });

    expect(candidate!.metricNames).toEqual(["jvm.memory.used"]);
    expect(candidate!.metricCount).toBe(1);
  });

  test("at most three services a look, from at most six samples of entry spans", () => {
    expect(METRIC_INSIGHT_MAX_MISSING_REQUEST_METRICS_SERVICES).toBe(3);
    expect(METRIC_INSIGHT_MAX_SERVED_SPAN_READS).toBe(6);
    expect(METRIC_INSIGHT_SENT_METRIC_NAMES).toBe(3);
  });
});

describe("the Missing Request Metrics finding", () => {
  test("is its own insight type, one finding a service", () => {
    expect(
      METRIC_INSIGHT_TYPE_BY_KIND[MetricInsightKind.MissingRequestMetrics],
    ).toBe(AIInsightType.MetricMissingRequestMetrics);
    expect(METRIC_INSIGHT_FINGERPRINT_PREFIXES.missingRequestMetrics).toBe(
      "metric-missing-request-metrics",
    );

    const fingerprint: string = getMetricInsightFingerprint({
      kind: MetricInsightKind.MissingRequestMetrics,
      serviceId: CHECKOUT.toUpperCase(),
    });

    expect(fingerprint).toBe(`metric-missing-request-metrics:${CHECKOUT}`);
    expect(isMetricInsightFingerprintOfService(fingerprint, CHECKOUT)).toBe(
      true,
    );
    expect(isMetricInsightFingerprintOfService(fingerprint, WORKER)).toBe(
      false,
    );

    // A service's missing metrics are another finding.
    expect(
      getMetricInsightFingerprint({
        kind: MetricInsightKind.MissingMetrics,
        serviceId: CHECKOUT,
      }),
    ).not.toBe(fingerprint);
  });

  test("its title says what the service handles that has no metrics", () => {
    expect(
      getMetricInsightTitle({ evidence: evidence(), serviceName: "checkout" }),
    ).toBe("checkout sends no metrics for the HTTP requests it handles");
    expect(
      getMetricInsightTitle({
        evidence: evidence({ servedProtocols: ["Messaging", "Http"] }),
        serviceName: "checkout",
      }),
    ).toBe(
      "checkout sends no metrics for the HTTP requests and messages it handles",
    );
    expect(
      getMetricInsightTitle({
        evidence: evidence({ servedProtocols: ["Rpc"] }),
        serviceName: "",
      }),
    ).toBe("A service sends no metrics for the RPC calls it handles");
    expect(
      getMetricInsightTitle({
        evidence: evidence({ servedProtocols: [] }),
        serviceName: "checkout",
      }),
    ).toBe("checkout sends no metrics for the requests it handles");
  });

  test("is Low: nothing is wrong yet, what it costs is visibility", () => {
    expect(getMetricInsightSeverity(evidence())).toBe(AIInsightSeverity.Low);
  });

  test("its problem, in sentences: the spans, the metrics it sent, the ones it never did, and its busiest requests", () => {
    expect(describeMetricProblem(evidence())).toBe(
      "It sent 12,400 spans over the last hour, and 14 metrics of its own, but has never sent a request metric for the HTTP requests it handles: none of the ones OpenTelemetry's semantic conventions name (http.server.request.duration), nor span metrics recorded from its traces. So nothing charts or alerts on its request rate, errors or latency over time without reading every span. Its busiest requests: GET /orders (4,000), POST /checkout (2,100).",
    );
    expect(
      describeMetricProblem(
        evidence({
          sentMetricCount: undefined,
          topOperations: undefined,
          servedProtocols: ["Http", "Messaging"],
        }),
      ),
    ).toBe(
      "It sent 12,400 spans over the last hour, and metrics of its own, but has never sent a request metric for the HTTP requests and messages it handles: none of the ones OpenTelemetry's semantic conventions name (http.server.request.duration, messaging.process.duration), nor span metrics recorded from its traces. So nothing charts or alerts on its request rate, errors or latency over time without reading every span.",
    );
    expect(describeMetricProblem(evidence({ sentMetricCount: 1 }))).toContain(
      "and 1 metric of its own,",
    );
  });

  test("its evidence, as a person reads it", () => {
    expect(
      buildMetricInsightDetail({
        serviceName: "checkout",
        evidence: evidence(),
      }).toString(),
    ).toBe(
      [
        "**Missing request metrics in checkout**",
        "",
        "- In the last hour: 12,400 spans, 310 failed",
        "- It handles: HTTP requests",
        "- Metrics it sent in the last hour: 14, such as `jvm.memory.used`, `process.cpu.time`, `db.client.connections.usage`",
        "- Request metric it has never sent: `http.server.request.duration`",
        "- Busiest requests: `GET /orders` (4,000), `POST /checkout` (2,100)",
        "- Telemetry SDK: Java",
        "- Without request metrics, nothing charts or alerts on its request rate, errors or latency over time",
      ].join("\n"),
    );
  });

  test("the metrics it sent are counted only when the hour's read held them all, and listed whole when they are all named", () => {
    const cut: string = buildMetricInsightDetail({
      serviceName: "checkout",
      evidence: evidence({ sentMetricCount: undefined }),
    }).toString();

    expect(cut).toContain(
      "- Metrics it sent in the last hour include `jvm.memory.used`, `process.cpu.time`, `db.client.connections.usage`",
    );

    const all: string = buildMetricInsightDetail({
      serviceName: "checkout",
      evidence: evidence({
        sentMetricCount: 2,
        sentMetricNames: ["jvm.memory.used", "process.cpu.time"],
      }),
    }).toString();

    expect(all).toContain(
      "- Metrics it sent in the last hour: `jvm.memory.used`, `process.cpu.time`",
    );

    const none: string = buildMetricInsightDetail({
      serviceName: "checkout",
      evidence: evidence({ sentMetricNames: undefined }),
    }).toString();

    expect(none).not.toContain("Metrics it sent");
  });

  test("two kinds of request name both metrics it never sent", () => {
    const detail: string = buildMetricInsightDetail({
      serviceName: "checkout",
      evidence: evidence({ servedProtocols: ["Http", "Rpc"] }),
    }).toString();

    expect(detail).toContain("- It handles: HTTP requests and RPC calls");
    expect(detail).toContain(
      "- Request metrics it has never sent: `http.server.request.duration`, `rpc.server.call.duration`",
    );
  });

  test("a service's and a metric's names are written into the detail escaped", () => {
    const detail: string = buildMetricInsightDetail({
      serviceName: "check*out",
      evidence: evidence({
        sentMetricNames: ["![x](https://example.com/p.png)", "`odd`"],
        sentMetricCount: 2,
      }),
    }).toString();

    expect(detail).toContain("**Missing request metrics in check\\*out**");
    // A metric's name is code: never an image the detail would load.
    expect(detail).toContain(
      "- Metrics it sent in the last hour: `![x](https://example.com/p.png)`, `` `odd` ``",
    );
  });

  test("what OneUptime asks the AI for: the request metrics, their attributes, and leave to change nothing", () => {
    expect(
      getMetricFixRequestTitle({ evidence: evidence(), serviceName: "checkout" }),
    ).toBe("Add request metrics to checkout");
    expect(
      getMetricFixRequestTitle({ evidence: evidence(), serviceName: "" }),
    ).toBe("Add request metrics to this service");

    const message: string = buildMetricFixRequestMessage({
      evidence: evidence({ servedProtocols: ["Http", "Messaging"] }),
      serviceName: "checkout",
      isStartedByOneUptime: true,
    });
    const lines: Array<string> = message.split("\n");

    expect(lines[0]).toBe("Add request metrics to checkout");
    expect(
      lines[2]!.startsWith(
        "OneUptime found this in the service's metrics on its own. It sent 12,400 spans",
      ),
    ).toBe(true);
    expect(lines[4]).toContain(
      "This service already exports metrics to OneUptime, but none for its requests.",
    );
    expect(lines[4]).toContain(
      "http.server.request.duration for its HTTP requests (with http.request.method, http.route and http.response.status_code) and messaging.process.duration for its messages (with messaging.system, messaging.destination.name and messaging.operation.name)",
    );
    expect(lines[4]).toContain("never IDs or full URLs");
    expect(lines[4]).toContain("Do not change what the code does.");
    expect(lines[4]).toContain(
      "If this service's request metrics are recorded somewhere other than this repository - a collector's span metrics, an agent, a proxy in front of it - or reach OneUptime under another service, say where and change nothing.",
    );

    // A person who asks waits on it: no leave to change nothing.
    const asked: string = buildMetricFixRequestMessage({
      evidence: evidence(),
      serviceName: "checkout",
      isStartedByOneUptime: false,
    });

    expect(asked).not.toContain("OneUptime found this");
    expect(asked).not.toContain("change nothing");
    expect(asked).toContain(
      "http.server.request.duration for its HTTP requests",
    );
  });

  test("a request with no protocol named asks for an HTTP server's metric", () => {
    expect(
      buildMetricFixRequestMessage({
        evidence: evidence({ servedProtocols: [] }),
        serviceName: "checkout",
        isStartedByOneUptime: false,
      }),
    ).toContain("http.server.request.duration for its HTTP requests");
  });

  test("the note the task keeps: what was found, in plain text", () => {
    expect(buildMetricFixEvidenceNote(evidence())).toBe(
      [
        `Window: ${WINDOW_START} to ${WINDOW_END}`,
        "Spans in the window: 12,400",
        "Failed spans: 310",
        "It handles: HTTP requests",
        "Metrics it sent in the window: 14 (jvm.memory.used, process.cpu.time, db.client.connections.usage)",
        "Request metrics it never sent: http.server.request.duration",
        "Busy request: GET /orders (4,000 spans)",
        "Busy request: POST /checkout (2,100 spans)",
        "Telemetry SDK language: java",
      ].join("\n"),
    );
    expect(
      buildMetricFixEvidenceNote(
        evidence({
          sentMetricCount: undefined,
          servedProtocols: [],
          failedSpanCount: undefined,
        }),
      ),
    ).toBe(
      [
        `Window: ${WINDOW_START} to ${WINDOW_END}`,
        "Spans in the window: 12,400",
        "It handles: requests",
        "Metrics it sent in the window include: jvm.memory.used, process.cpu.time, db.client.connections.usage",
        "Busy request: GET /orders (4,000 spans)",
        "Busy request: POST /checkout (2,100 spans)",
        "Telemetry SDK language: java",
      ].join("\n"),
    );
  });
});
