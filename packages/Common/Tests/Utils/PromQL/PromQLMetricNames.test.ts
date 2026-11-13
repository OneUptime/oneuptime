import {
  PromQLMetricRequest,
  PromQLSeriesKind,
  attributesToPromQLLabels,
  promQLSeriesNamesOf,
  resolvePromQLMetricName,
  toPromQLLabelName,
  toPromQLMetricName,
} from "../../../Utils/PromQL/PromQLMetricNames";
import { describe, expect, test } from "@jest/globals";

/*
 * How OneUptime's OpenTelemetry metrics are named in PromQL (issue #6796):
 * the way Prometheus' own OpenTelemetry translation names them, so a query
 * written for Prometheus finds the same metric here.
 */

const requestsOf: (requests: Array<PromQLMetricRequest>) => Array<string> = (
  requests: Array<PromQLMetricRequest>,
): Array<string> => {
  return requests
    .map((request: PromQLMetricRequest): string => {
      return `${request.storedName}:${request.kind}`;
    })
    .sort();
};

describe("PromQL names of OpenTelemetry metrics", () => {
  test.each([
    ["http.server.request.duration", "http_server_request_duration"],
    ["system.cpu.utilization", "system_cpu_utilization"],
    ["job:requests:rate5m", "job:requests:rate5m"],
    ["k8s.pod-memory", "k8s_pod_memory"],
    ["already_valid", "already_valid"],
  ])("the metric %s is %s", (stored: string, promName: string) => {
    expect(toPromQLMetricName(stored)).toBe(promName);
  });

  test.each([
    ["resource.service.name", "resource_service_name"],
    ["http.route", "http_route"],
    ["a:b", "a_b"],
    ["code", "code"],
  ])("the attribute %s is the label %s", (key: string, label: string) => {
    expect(toPromQLLabelName(key)).toBe(label);
  });
});

describe("PromQL labels of a series' attributes", () => {
  test("every attribute becomes a label, dots made underscores", () => {
    expect(
      attributesToPromQLLabels({
        "http.method": "GET",
        "resource.host.name": "web-1",
        code: 200,
      }),
    ).toEqual({
      code: "200",
      http_method: "GET",
      resource_host_name: "web-1",
    });
  });

  test("job and instance come from the resource, as in Prometheus", () => {
    expect(
      attributesToPromQLLabels({
        "resource.service.name": "checkout",
        "resource.service.namespace": "shop",
        "resource.service.instance.id": "pod-7",
      }),
    ).toMatchObject({ job: "shop/checkout", instance: "pod-7" });

    expect(
      attributesToPromQLLabels({ "resource.service.name": "checkout" }),
    ).toMatchObject({ job: "checkout" });
  });

  test("an attribute named job or instance wins over the derived one", () => {
    expect(
      attributesToPromQLLabels({
        job: "node-exporter",
        instance: "10.0.0.1:9100",
        "resource.service.name": "otel-collector",
      }),
    ).toMatchObject({ job: "node-exporter", instance: "10.0.0.1:9100" });
  });

  test("two keys that name one label join their values in key order", () => {
    expect(attributesToPromQLLabels({ "a.b": "x", a_b: "y" })).toEqual({
      a_b: "x;y",
    });
  });

  test("empty values, a scope's raw attribute list and reserved names are left out", () => {
    expect(
      attributesToPromQLLabels({
        empty: "",
        missing: null,
        "scope.attributes": "[{...}]",
        "scope.name": "io.opentelemetry.http",
        le: "0.5",
        __name__: "spoofed",
      }),
    ).toEqual({ scope_name: "io.opentelemetry.http" });
  });
});

describe("resolving a queried metric name to stored metrics", () => {
  const stored: Array<string> = [
    "http.server.request.duration",
    "http_requests",
    "system.cpu.utilization",
    "queue_depth_bucket",
  ];

  test("a dotted name is found by its underscored PromQL name", () => {
    expect(
      requestsOf(resolvePromQLMetricName("system_cpu_utilization", stored)),
    ).toEqual(["system.cpu.utilization:value", "system_cpu_utilization:value"]);
  });

  test("a histogram is found by its _bucket, _count and _sum names", () => {
    expect(
      requestsOf(
        resolvePromQLMetricName("http_server_request_duration_bucket", stored),
      ),
    ).toEqual([
      "http.server.request.duration:bucket",
      "http_server_request_duration:bucket",
      "http_server_request_duration_bucket:value",
    ]);
    expect(
      requestsOf(
        resolvePromQLMetricName("http_server_request_duration_count", stored),
      ),
    ).toContain("http.server.request.duration:count");
    expect(
      requestsOf(
        resolvePromQLMetricName("http_server_request_duration_sum", stored),
      ),
    ).toContain("http.server.request.duration:sum");
  });

  test("a counter is found with or without _total", () => {
    expect(
      requestsOf(resolvePromQLMetricName("http_requests_total", stored)),
    ).toEqual(["http_requests:value", "http_requests_total:value"]);
  });

  test("a metric literally named x_bucket is tried as itself too", () => {
    expect(
      requestsOf(resolvePromQLMetricName("queue_depth_bucket", stored)),
    ).toEqual(["queue_depth:bucket", "queue_depth_bucket:value"]);
  });

  test("Prometheus 3's quoted name reaches the stored name", () => {
    expect(
      requestsOf(
        resolvePromQLMetricName("http.server.request.duration", stored),
      ),
    ).toEqual(["http.server.request.duration:value"]);
  });

  test("names are compared in lowercase, as ingest stores them", () => {
    expect(
      requestsOf(resolvePromQLMetricName("System_CPU_Utilization", stored)),
    ).toContain("system.cpu.utilization:value");
  });

  test("a series keeps the name the query wrote", () => {
    for (const request of resolvePromQLMetricName(
      "http_requests_total",
      stored,
    )) {
      expect(request.seriesName).toBe("http_requests_total");
    }
  });

  test("a name the catalog does not list yet is still read", () => {
    expect(requestsOf(resolvePromQLMetricName("brand_new_metric", []))).toEqual(
      ["brand_new_metric:value"],
    );
  });
});

describe("the PromQL names a stored metric's series have", () => {
  test.each([
    ["Gauge", ["temperature:value"]],
    ["Sum", ["temperature:value"]],
    [undefined, ["temperature:value"]],
    [
      "Histogram",
      [
        "temperature_bucket:bucket",
        "temperature_count:count",
        "temperature_sum:sum",
      ],
    ],
    [
      "ExponentialHistogram",
      ["temperature_count:count", "temperature_sum:sum"],
    ],
    [
      "Summary",
      ["temperature:value", "temperature_count:count", "temperature_sum:sum"],
    ],
  ])("a %s", (pointType: string | undefined, names: Array<string>) => {
    expect(
      promQLSeriesNamesOf("temperature", pointType).map(
        (series: { name: string; kind: PromQLSeriesKind }): string => {
          return `${series.name}:${series.kind}`;
        },
      ),
    ).toEqual(names);
  });
});
