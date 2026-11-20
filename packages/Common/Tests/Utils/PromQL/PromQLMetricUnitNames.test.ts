import {
  PromQLMetricRequest,
  PromQLSeriesKind,
  PromQLStoredMetric,
  PrometheusMetricType,
  canonicalPromQLNamesOf,
  getPrometheusMetricType,
  getPrometheusUnitSuffixes,
  isPrometheusMetricName,
  prometheusSeriesNamesOf,
  resolvePromQLMetricName,
  toPrometheusFamilyName,
  toPrometheusMetricName,
  toPrometheusUnit,
} from "../../../Utils/PromQL/PromQLMetricNames";
import { describe, expect, test } from "@jest/globals";

/*
 * OpenTelemetry metrics by the names Prometheus and the OpenTelemetry
 * Collector's exporters give them, with their units (issue #7715).
 *
 * Every expected name below is worked out by hand from OpenTelemetry's
 * Prometheus compatibility rules as Prometheus' otlptranslator applies
 * them (normalizeName): the name's words, the unit's word from its table,
 * `x/y` as `x_per_y`, a unit in braces dropped, a unit already in the name
 * not written twice, `_total` for a counter and `_ratio` for a gauge in
 * `1`, and `_` before a name that starts with a digit.
 */

const nameOf: (
  name: string,
  unit: string,
  type: PrometheusMetricType,
) => string = (
  name: string,
  unit: string,
  type: PrometheusMetricType,
): string => {
  return toPrometheusMetricName({ name, unit, type });
};

const requestsOf: (requests: Array<PromQLMetricRequest>) => Array<string> = (
  requests: Array<PromQLMetricRequest>,
): Array<string> => {
  return requests
    .map((request: PromQLMetricRequest): string => {
      return `${request.storedName}:${request.kind}`;
    })
    .sort();
};

describe("each unit in otlptranslator's table", () => {
  test.each([
    // Time
    ["s", "x_duration_seconds"],
    ["ms", "x_duration_milliseconds"],
    ["us", "x_duration_microseconds"],
    ["ns", "x_duration_nanoseconds"],
    ["min", "x_duration_minutes"],
    ["h", "x_duration_hours"],
    ["d", "x_duration_days"],
    // Bytes
    ["By", "x_duration_bytes"],
    ["KiBy", "x_duration_kibibytes"],
    ["MiBy", "x_duration_mebibytes"],
    ["GiBy", "x_duration_gibibytes"],
    ["TiBy", "x_duration_tibibytes"],
    ["KBy", "x_duration_kilobytes"],
    ["MBy", "x_duration_megabytes"],
    ["GBy", "x_duration_gigabytes"],
    ["TBy", "x_duration_terabytes"],
    // SI
    ["m", "x_duration_meters"],
    ["V", "x_duration_volts"],
    ["A", "x_duration_amperes"],
    ["J", "x_duration_joules"],
    ["W", "x_duration_watts"],
    ["g", "x_duration_grams"],
    // Misc
    ["Cel", "x_duration_celsius"],
    ["Hz", "x_duration_hertz"],
    ["%", "x_duration_percent"],
  ])(
    "the unit %s names an up-down counter %s",
    (unit: string, expected: string) => {
      expect(
        nameOf("x.duration", unit, PrometheusMetricType.UpDownCounter),
      ).toBe(expected);
    },
  );

  test("1 is a ratio on a gauge, and nothing on any other kind", () => {
    expect(
      nameOf("system.cpu.utilization", "1", PrometheusMetricType.Gauge),
    ).toBe("system_cpu_utilization_ratio");
    expect(
      nameOf("system.cpu.utilization", "1", PrometheusMetricType.UpDownCounter),
    ).toBe("system_cpu_utilization");
    expect(nameOf("k8s.pod.restarts", "1", PrometheusMetricType.Counter)).toBe(
      "k8s_pod_restarts_total",
    );
    expect(
      nameOf("http.server.size", "1", PrometheusMetricType.Histogram),
    ).toBe("http_server_size");
  });

  test("x/y is x_per_y, with the per unit's own table", () => {
    expect(nameOf("x.throughput", "By/s", PrometheusMetricType.Gauge)).toBe(
      "x_throughput_bytes_per_second",
    );
    expect(nameOf("x.speed", "m/h", PrometheusMetricType.Gauge)).toBe(
      "x_speed_meters_per_hour",
    );
    expect(nameOf("x.load", "By/d", PrometheusMetricType.Gauge)).toBe(
      "x_load_bytes_per_day",
    );
    expect(nameOf("x.load", "By/w", PrometheusMetricType.Gauge)).toBe(
      "x_load_bytes_per_week",
    );
    expect(nameOf("x.load", "By/mo", PrometheusMetricType.Gauge)).toBe(
      "x_load_bytes_per_month",
    );
    expect(nameOf("x.load", "By/y", PrometheusMetricType.Gauge)).toBe(
      "x_load_bytes_per_year",
    );
    expect(nameOf("x.load", "By/min", PrometheusMetricType.Gauge)).toBe(
      // `min` is not in the per table: written as it is.
      "x_load_bytes_per_min",
    );
  });

  test("a unit in braces is left out, the per unit after it kept", () => {
    expect(
      nameOf(
        "system.network.packets",
        "{packets}",
        PrometheusMetricType.Counter,
      ),
    ).toBe("system_network_packets_total");
    expect(nameOf("x.rate", "{packet}/s", PrometheusMetricType.Gauge)).toBe(
      "x_rate_per_second",
    );
    expect(nameOf("x.rate", "By/{batch}", PrometheusMetricType.Gauge)).toBe(
      "x_rate_bytes",
    );
  });

  test("1/s is per second only, and never a ratio", () => {
    expect(nameOf("x.rate", "1/s", PrometheusMetricType.Gauge)).toBe(
      "x_rate_per_second",
    );
  });

  test("a unit the table does not name is written as it is, cleaned", () => {
    expect(nameOf("x.distance", "km", PrometheusMetricType.Gauge)).toBe(
      "x_distance_km",
    );
    // Its own word is in the name already: only the per unit is added.
    expect(
      nameOf("x.requests", "requests/mo", PrometheusMetricType.Gauge),
    ).toBe("x_requests_per_month");
    expect(nameOf("x.thing", "foo.bar", PrometheusMetricType.Gauge)).toBe(
      "x_thing_foo_bar",
    );
    // Spaces around the unit are not part of it.
    expect(nameOf("x.duration", " s ", PrometheusMetricType.Gauge)).toBe(
      "x_duration_seconds",
    );
  });
});

describe("how a name is put together", () => {
  test("OpenTelemetry's semantic conventions, as exporters name them", () => {
    expect(
      nameOf(
        "http.server.request.duration",
        "s",
        PrometheusMetricType.Histogram,
      ),
    ).toBe("http_server_request_duration_seconds");
    expect(
      nameOf("system.memory.usage", "By", PrometheusMetricType.UpDownCounter),
    ).toBe("system_memory_usage_bytes");
    expect(
      nameOf("system.network.io", "By", PrometheusMetricType.Counter),
    ).toBe("system_network_io_bytes_total");
    expect(nameOf("jvm.memory.used", "By", PrometheusMetricType.Gauge)).toBe(
      "jvm_memory_used_bytes",
    );
  });

  test("a unit already in the name is not written twice", () => {
    expect(
      nameOf("process.cpu.seconds", "s", PrometheusMetricType.Counter),
    ).toBe("process_cpu_seconds_total");
    expect(
      nameOf("x.bytes.sent", "By", PrometheusMetricType.UpDownCounter),
    ).toBe("x_bytes_sent");
  });

  test("a counter's total, and a gauge's ratio, come last and once", () => {
    expect(
      nameOf("http.requests.total", "", PrometheusMetricType.Counter),
    ).toBe("http_requests_total");
    expect(nameOf("a.total.b", "", PrometheusMetricType.Counter)).toBe(
      "a_b_total",
    );
    expect(nameOf("cache.hit.ratio", "1", PrometheusMetricType.Gauge)).toBe(
      "cache_hit_ratio",
    );
  });

  test("separators collapse, and a leading digit gets an underscore", () => {
    expect(nameOf("x..y-z", "", PrometheusMetricType.Gauge)).toBe("x_y_z");
    expect(nameOf("5xx.responses", "", PrometheusMetricType.Counter)).toBe(
      "_5xx_responses_total",
    );
    expect(nameOf("job:rate:5m", "", PrometheusMetricType.Gauge)).toBe(
      "job:rate:5m",
    );
  });

  test("the unit's words, apart", () => {
    expect(getPrometheusUnitSuffixes("By/s")).toEqual({
      main: "bytes",
      per: "per_second",
    });
    expect(getPrometheusUnitSuffixes("1")).toEqual({ main: "", per: "" });
    expect(getPrometheusUnitSuffixes(undefined)).toEqual({
      main: "",
      per: "",
    });
    // A table key is never read off Object.prototype.
    expect(getPrometheusUnitSuffixes("constructor")).toEqual({
      main: "constructor",
      per: "",
    });
  });

  test("the unit as metadata writes it", () => {
    expect(toPrometheusUnit("s")).toBe("seconds");
    expect(toPrometheusUnit("By/s")).toBe("bytes_per_second");
    expect(toPrometheusUnit("{packet}/s")).toBe("per_second");
    expect(toPrometheusUnit("1")).toBe("");
    expect(toPrometheusUnit("{request}")).toBe("");
    expect(toPrometheusUnit("%")).toBe("percent");
    expect(toPrometheusUnit(undefined)).toBe("");
  });
});

describe("the kind a stored point is in Prometheus", () => {
  test.each([
    ["Histogram", false, PrometheusMetricType.Histogram],
    ["ExponentialHistogram", false, PrometheusMetricType.ExponentialHistogram],
    ["Summary", false, PrometheusMetricType.Summary],
    ["Sum", true, PrometheusMetricType.Counter],
    ["Sum", false, PrometheusMetricType.UpDownCounter],
    ["Gauge", false, PrometheusMetricType.Gauge],
    [undefined, true, PrometheusMetricType.Counter],
    [undefined, false, PrometheusMetricType.Gauge],
  ])(
    "a %s point, monotonic %s, is a %s",
    (
      pointType: string | undefined,
      isMonotonic: boolean,
      expected: PrometheusMetricType,
    ) => {
      expect(getPrometheusMetricType({ pointType, isMonotonic })).toBe(
        expected,
      );
    },
  );
});

describe("finding a stored metric by its name with the unit", () => {
  const stored: Array<PromQLStoredMetric> = [
    { name: "http.server.request.duration", unit: "s" },
    { name: "system.memory.usage", unit: "By" },
    { name: "system.cpu.utilization", unit: "1" },
    { name: "system.network.io", unit: "By", isMonotonic: true },
    { name: "rpc.server.duration", unit: "ms" },
  ];

  test("a histogram's series, with the unit and without", () => {
    for (const suffix of ["bucket", "count", "sum"]) {
      expect(
        requestsOf(
          resolvePromQLMetricName(
            `http_server_request_duration_seconds_${suffix}`,
            stored,
          ),
        ),
      ).toContain(`http.server.request.duration:${suffix}`);
      expect(
        requestsOf(
          resolvePromQLMetricName(
            `http_server_request_duration_${suffix}`,
            stored,
          ),
        ),
      ).toContain(`http.server.request.duration:${suffix}`);
    }
  });

  test("only the unit the catalog has: seconds is no millisecond metric", () => {
    expect(
      requestsOf(
        resolvePromQLMetricName("rpc_server_duration_seconds_bucket", stored),
      ),
    ).not.toContain("rpc.server.duration:bucket");
    expect(
      requestsOf(
        resolvePromQLMetricName(
          "rpc_server_duration_milliseconds_bucket",
          stored,
        ),
      ),
    ).toContain("rpc.server.duration:bucket");
  });

  test("a gauge in bytes, a ratio and a counter with its total", () => {
    expect(
      requestsOf(resolvePromQLMetricName("system_memory_usage_bytes", stored)),
    ).toContain("system.memory.usage:value");
    expect(
      requestsOf(
        resolvePromQLMetricName("system_cpu_utilization_ratio", stored),
      ),
    ).toContain("system.cpu.utilization:value");
    expect(
      requestsOf(
        resolvePromQLMetricName("system_network_io_bytes_total", stored),
      ),
    ).toContain("system.network.io:value");
    // The names OneUptime has always given them still find them.
    expect(
      requestsOf(resolvePromQLMetricName("system_network_io", stored)),
    ).toContain("system.network.io:value");
    expect(
      requestsOf(resolvePromQLMetricName("system_cpu_utilization", stored)),
    ).toContain("system.cpu.utilization:value");
  });

  test("the series is named as the query wrote it", () => {
    const requests: Array<PromQLMetricRequest> = resolvePromQLMetricName(
      "http_server_request_duration_seconds_bucket",
      stored,
    );

    expect(
      requests.find((request: PromQLMetricRequest): boolean => {
        return request.storedName === "http.server.request.duration";
      }),
    ).toEqual({
      storedName: "http.server.request.duration",
      kind: PromQLSeriesKind.Bucket,
      seriesName: "http_server_request_duration_seconds_bucket",
    });
  });

  test("without the catalog's unit, a name with a unit finds nothing", () => {
    expect(
      requestsOf(
        resolvePromQLMetricName("system_memory_usage_bytes", [
          "system.memory.usage",
        ]),
      ),
    ).not.toContain("system.memory.usage:value");
  });
});

describe("the one name a series has, for a pattern", () => {
  test("the Prometheus name, with its unit", () => {
    expect(
      canonicalPromQLNamesOf({
        name: "http.server.request.duration",
        unit: "s",
      }),
    ).toEqual([
      {
        name: "http_server_request_duration_seconds",
        kind: PromQLSeriesKind.Value,
      },
      {
        name: "http_server_request_duration_seconds_bucket",
        kind: PromQLSeriesKind.Bucket,
      },
      {
        name: "http_server_request_duration_seconds_count",
        kind: PromQLSeriesKind.Count,
      },
      {
        name: "http_server_request_duration_seconds_sum",
        kind: PromQLSeriesKind.Sum,
      },
    ]);
  });

  test("a counter is its _total, a gauge in 1 its _ratio", () => {
    expect(
      canonicalPromQLNamesOf({
        name: "system.network.io",
        unit: "By",
        isMonotonic: true,
      })[0],
    ).toEqual({
      name: "system_network_io_bytes_total",
      kind: PromQLSeriesKind.Value,
    });
    expect(
      canonicalPromQLNamesOf({ name: "system.cpu.utilization", unit: "1" })[0],
    ).toEqual({
      name: "system_cpu_utilization_ratio",
      kind: PromQLSeriesKind.Value,
    });
  });

  test("a name sent as a Prometheus name stays as it is, counter or not", () => {
    expect(isPrometheusMetricName("http_request_duration_seconds_bucket")).toBe(
      true,
    );
    expect(isPrometheusMetricName("http.server.request.duration")).toBe(false);
    expect(
      canonicalPromQLNamesOf({
        name: "http_request_duration_seconds_bucket",
        unit: "seconds",
        isMonotonic: true,
      })[0],
    ).toEqual({
      name: "http_request_duration_seconds_bucket",
      kind: PromQLSeriesKind.Value,
    });
  });
});

describe("the names a metric is listed under", () => {
  test("a histogram in seconds", () => {
    expect(
      prometheusSeriesNamesOf(
        { name: "http.server.request.duration", unit: "s" },
        "Histogram",
      ),
    ).toEqual([
      {
        name: "http_server_request_duration_seconds_bucket",
        kind: PromQLSeriesKind.Bucket,
      },
      {
        name: "http_server_request_duration_seconds_count",
        kind: PromQLSeriesKind.Count,
      },
      {
        name: "http_server_request_duration_seconds_sum",
        kind: PromQLSeriesKind.Sum,
      },
    ]);
  });

  test("an exponential histogram and a summary", () => {
    expect(
      prometheusSeriesNamesOf(
        { name: "rpc.latency", unit: "ms" },
        "ExponentialHistogram",
      ).map((series: { name: string }): string => {
        return series.name;
      }),
    ).toEqual([
      "rpc_latency_milliseconds_count",
      "rpc_latency_milliseconds_sum",
    ]);
    expect(
      prometheusSeriesNamesOf(
        { name: "rpc.latency", unit: "ms" },
        "Summary",
      ).map((series: { name: string }): string => {
        return series.name;
      }),
    ).toEqual([
      "rpc_latency_milliseconds",
      "rpc_latency_milliseconds_count",
      "rpc_latency_milliseconds_sum",
    ]);
  });

  test("a counter, an up-down counter and a gauge in 1", () => {
    expect(
      prometheusSeriesNamesOf(
        {
          name: "http.server.requests",
          unit: "{request}",
          isMonotonic: true,
        },
        undefined,
      )[0]!.name,
    ).toBe("http_server_requests_total");
    expect(
      prometheusSeriesNamesOf(
        { name: "system.cpu.utilization", unit: "1" },
        undefined,
      )[0]!.name,
    ).toBe("system_cpu_utilization_ratio");
    expect(
      prometheusSeriesNamesOf(
        { name: "system.memory.usage", unit: "By" },
        undefined,
      )[0]!.name,
    ).toBe("system_memory_usage_bytes");
  });

  test("remote-written series keep their names, never adding _total", () => {
    expect(
      prometheusSeriesNamesOf(
        {
          name: "http_request_duration_seconds_bucket",
          unit: "seconds",
          isMonotonic: true,
        },
        undefined,
      ),
    ).toEqual([
      {
        name: "http_request_duration_seconds_bucket",
        kind: PromQLSeriesKind.Value,
      },
    ]);
  });

  test("the family name metadata is keyed by", () => {
    expect(
      toPrometheusFamilyName({
        metric: { name: "http.server.request.duration", unit: "s" },
        pointType: "Histogram",
      }),
    ).toBe("http_server_request_duration_seconds");
    expect(
      toPrometheusFamilyName({
        metric: { name: "system.network.io", unit: "By", isMonotonic: true },
        pointType: undefined,
      }),
    ).toBe("system_network_io_bytes_total");
    expect(
      toPrometheusFamilyName({
        metric: { name: "node_cpu_seconds_total", isMonotonic: true },
        pointType: undefined,
      }),
    ).toBe("node_cpu_seconds_total");
  });
});
