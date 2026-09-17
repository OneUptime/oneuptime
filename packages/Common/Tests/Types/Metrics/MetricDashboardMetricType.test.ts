import MetricDashboardMetricType from "../../../Types/Metrics/MetricDashboardMetricType";
import { describe, expect, test } from "@jest/globals";

/*
 * MetricDashboardMetricType is a plain string enum whose values are the
 * OpenTelemetry-style metric identifiers surfaced in dashboards. The tests
 * below lock down the exact member-to-value mapping, the structural
 * invariants a string enum guarantees (uniqueness, no reverse mapping) and
 * the naming/namespacing conventions the values are expected to follow.
 */

/*
 * The single source of truth for what the enum is expected to contain. Any
 * accidental rename, typo or duplicated value will diverge from this table
 * and fail the mapping assertions below.
 */
const EXPECTED_ENTRIES: Record<string, string> = {
  /* HTTP metrics */
  HttpRequestDuration: "http.server.request.duration",
  HttpRequestCount: "http.server.request.count",
  HttpRequestErrorRate: "http.server.request.error.rate",
  HttpResponseSize: "http.server.response.body.size",
  HttpRequestSize: "http.server.request.body.size",
  HttpActiveRequests: "http.server.active_requests",

  /* System metrics */
  SystemCpuUtilization: "system.cpu.utilization",
  SystemMemoryUsage: "system.memory.usage",
  SystemDiskIo: "system.disk.io",
  SystemNetworkIo: "system.network.io",

  /* Runtime metrics */
  ProcessCpuUtilization: "process.cpu.utilization",
  ProcessMemoryUsage: "process.runtime.jvm.memory.usage",
  GcDuration: "process.runtime.jvm.gc.duration",
  ThreadCount: "process.runtime.jvm.threads.count",

  /* Custom application metrics */
  CustomCounter: "custom.counter",
  CustomGauge: "custom.gauge",
  CustomHistogram: "custom.histogram",
};

describe("MetricDashboardMetricType", () => {
  describe("member-to-value mapping", () => {
    test("maps every member to its exact OpenTelemetry-style value", () => {
      /*
       * Comparing the spread enum object against the expected table checks
       * both directions at once: no member is missing, none is unexpected,
       * and every value string matches character-for-character.
       */
      expect({ ...MetricDashboardMetricType }).toEqual(EXPECTED_ENTRIES);
    });

    test("keeps the representative HTTP members stable", () => {
      expect(MetricDashboardMetricType.HttpRequestDuration).toBe(
        "http.server.request.duration",
      );
      expect(MetricDashboardMetricType.HttpRequestCount).toBe(
        "http.server.request.count",
      );
      /* active_requests intentionally uses an underscore, not a dot. */
      expect(MetricDashboardMetricType.HttpActiveRequests).toBe(
        "http.server.active_requests",
      );
    });

    test("keeps request vs response body size distinct", () => {
      /*
       * These two are easy to confuse — response uses "response.body.size"
       * while request uses "request.body.size". Guard the pair explicitly.
       */
      expect(MetricDashboardMetricType.HttpResponseSize).toBe(
        "http.server.response.body.size",
      );
      expect(MetricDashboardMetricType.HttpRequestSize).toBe(
        "http.server.request.body.size",
      );
      expect(MetricDashboardMetricType.HttpResponseSize).not.toBe(
        MetricDashboardMetricType.HttpRequestSize,
      );
    });

    test("keeps the custom application members stable", () => {
      expect(MetricDashboardMetricType.CustomCounter).toBe("custom.counter");
      expect(MetricDashboardMetricType.CustomGauge).toBe("custom.gauge");
      expect(MetricDashboardMetricType.CustomHistogram).toBe(
        "custom.histogram",
      );
    });
  });

  describe("completeness and uniqueness", () => {
    const keys: Array<string> = Object.keys(MetricDashboardMetricType);
    const values: Array<string> = Object.values(MetricDashboardMetricType);

    test("declares exactly seventeen members", () => {
      expect(keys.length).toBe(17);
      expect(values.length).toBe(17);
    });

    test("exposes no reverse mapping (string enums are one-way)", () => {
      /*
       * Numeric enums generate a value -> name reverse mapping; string enums
       * do not. Object.keys must therefore be the member names only, and a
       * lookup by value string must resolve to undefined.
       */
      expect(keys).toEqual(Object.keys(EXPECTED_ENTRIES));
      const asRecord: Record<string, string> =
        MetricDashboardMetricType as unknown as Record<string, string>;
      expect(asRecord["http.server.request.count"]).toBeUndefined();
      expect(asRecord["custom.counter"]).toBeUndefined();
    });

    test("has no duplicate value strings", () => {
      const unique: Set<string> = new Set(values);
      expect(unique.size).toBe(values.length);
    });

    test("has no duplicate member names", () => {
      const unique: Set<string> = new Set(keys);
      expect(unique.size).toBe(keys.length);
    });

    test("Object.values returns precisely the expected value set", () => {
      const expectedValues: Array<string> = Object.values(EXPECTED_ENTRIES);
      expect([...values].sort()).toEqual([...expectedValues].sort());
    });
  });

  describe("value format invariants", () => {
    const values: Array<string> = Object.values(MetricDashboardMetricType);

    test("every value is a non-empty string", () => {
      for (const value of values) {
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    });

    test("every value is lowercase with no surrounding or inner whitespace", () => {
      for (const value of values) {
        expect(value).toBe(value.toLowerCase());
        expect(value).toBe(value.trim());
        const whitespace: RegExp = /\s/;
        expect(whitespace.test(value)).toBe(false);
      }
    });

    test("every value uses only [a-z0-9._] characters", () => {
      const allowed: RegExp = /^[a-z0-9]+([._][a-z0-9]+)*$/;
      for (const value of values) {
        expect(allowed.test(value)).toBe(true);
      }
    });

    test("no dot-delimited segment is empty (no leading, trailing or doubled dots)", () => {
      for (const value of values) {
        expect(value.startsWith(".")).toBe(false);
        expect(value.endsWith(".")).toBe(false);
        expect(value.includes("..")).toBe(false);
        const segments: Array<string> = value.split(".");
        for (const segment of segments) {
          expect(segment.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("namespacing conventions", () => {
    test("all HTTP members live under the http.server. namespace", () => {
      const httpValues: Array<string> = [
        MetricDashboardMetricType.HttpRequestDuration,
        MetricDashboardMetricType.HttpRequestCount,
        MetricDashboardMetricType.HttpRequestErrorRate,
        MetricDashboardMetricType.HttpResponseSize,
        MetricDashboardMetricType.HttpRequestSize,
        MetricDashboardMetricType.HttpActiveRequests,
      ];
      for (const value of httpValues) {
        expect(value.startsWith("http.server.")).toBe(true);
      }
    });

    test("all system members live under the system. namespace", () => {
      const systemValues: Array<string> = [
        MetricDashboardMetricType.SystemCpuUtilization,
        MetricDashboardMetricType.SystemMemoryUsage,
        MetricDashboardMetricType.SystemDiskIo,
        MetricDashboardMetricType.SystemNetworkIo,
      ];
      for (const value of systemValues) {
        expect(value.startsWith("system.")).toBe(true);
      }
    });

    test("all custom members live under the custom. namespace", () => {
      const customValues: Array<string> = [
        MetricDashboardMetricType.CustomCounter,
        MetricDashboardMetricType.CustomGauge,
        MetricDashboardMetricType.CustomHistogram,
      ];
      for (const value of customValues) {
        expect(value.startsWith("custom.")).toBe(true);
      }
    });

    test("all runtime members live under the process. namespace", () => {
      const runtimeValues: Array<string> = [
        MetricDashboardMetricType.ProcessCpuUtilization,
        MetricDashboardMetricType.ProcessMemoryUsage,
        MetricDashboardMetricType.GcDuration,
        MetricDashboardMetricType.ThreadCount,
      ];
      for (const value of runtimeValues) {
        expect(value.startsWith("process.")).toBe(true);
      }
    });

    test("only the JVM runtime members carry the process.runtime.jvm. prefix", () => {
      /*
       * Edge case worth pinning: ProcessCpuUtilization deliberately sits at
       * "process.cpu.utilization" (host-level), while memory/gc/thread
       * metrics are JVM-scoped under "process.runtime.jvm.". A refactor that
       * "normalised" the CPU value under the JVM prefix would be caught here.
       */
      expect(
        MetricDashboardMetricType.ProcessCpuUtilization.startsWith(
          "process.runtime.jvm.",
        ),
      ).toBe(false);

      const jvmValues: Array<string> = [
        MetricDashboardMetricType.ProcessMemoryUsage,
        MetricDashboardMetricType.GcDuration,
        MetricDashboardMetricType.ThreadCount,
      ];
      for (const value of jvmValues) {
        expect(value.startsWith("process.runtime.jvm.")).toBe(true);
      }
    });

    test("each value belongs to exactly one of the four known namespaces", () => {
      const prefixes: Array<string> = [
        "http.server.",
        "system.",
        "process.",
        "custom.",
      ];
      for (const value of Object.values(MetricDashboardMetricType)) {
        const matched: Array<string> = prefixes.filter((prefix: string) => {
          return value.startsWith(prefix);
        });
        expect(matched.length).toBe(1);
      }
    });
  });

  describe("membership helpers", () => {
    test("recognises a declared value as a member", () => {
      const values: Array<string> = Object.values(MetricDashboardMetricType);
      expect(values.includes("http.server.request.duration")).toBe(true);
      expect(values.includes("custom.histogram")).toBe(true);
    });

    test("rejects near-miss strings that are not members", () => {
      const values: Array<string> = Object.values(MetricDashboardMetricType);
      /* Empty, casing variants and plausible-but-absent identifiers. */
      expect(values.includes("")).toBe(false);
      expect(values.includes("HTTP.SERVER.REQUEST.DURATION")).toBe(false);
      expect(values.includes("http.server.request.latency")).toBe(false);
      expect(values.includes("custom.timer")).toBe(false);
      expect(values.includes("process.runtime.jvm.cpu.utilization")).toBe(
        false,
      );
    });
  });
});
