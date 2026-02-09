import FluentLogsIngestService from "../../Services/FluentLogsIngestService";
import LogSeverity from "Common/Types/Log/LogSeverity";
import { JSONObject } from "Common/Types/JSON";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const service: any = FluentLogsIngestService as any;

describe("FluentLogsIngestService", () => {
  describe("normalizeLogEntries", () => {
    test("preserves structured JSON object as-is", () => {
      const payload: JSONObject = {
        message: "Connection refused",
        level: "error",
        stream: "stderr",
        kubernetes: {
          namespace_name: "default",
          pod_name: "my-app-xyz",
        },
      };

      const entries: Array<JSONObject> = service["normalizeLogEntries"](
        payload,
      ) as Array<JSONObject>;

      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(payload);
    });

    test("preserves array of structured objects", () => {
      const payload: Array<JSONObject> = [
        { message: "log 1", stream: "stdout" },
        { message: "log 2", stream: "stderr" },
      ];

      const entries: Array<JSONObject> = service["normalizeLogEntries"](
        payload,
      ) as Array<JSONObject>;

      expect(entries).toHaveLength(2);
      expect(entries[0]!["message"]).toBe("log 1");
      expect(entries[0]!["stream"]).toBe("stdout");
      expect(entries[1]!["message"]).toBe("log 2");
      expect(entries[1]!["stream"]).toBe("stderr");
    });

    test("unwraps 'json' container field", () => {
      const payload: JSONObject = {
        json: {
          message: "inner log",
          kubernetes: { pod_name: "test-pod" },
        },
      };

      const entries: Array<JSONObject> = service["normalizeLogEntries"](
        payload,
      ) as Array<JSONObject>;

      expect(entries).toHaveLength(1);
      expect(entries[0]!["message"]).toBe("inner log");
      expect((entries[0]!["kubernetes"] as JSONObject)["pod_name"]).toBe(
        "test-pod",
      );
    });

    test("unwraps 'entries' container field", () => {
      const payload: JSONObject = {
        entries: [
          { message: "entry 1", host: "node-1" },
          { message: "entry 2", host: "node-2" },
        ],
      };

      const entries: Array<JSONObject> = service["normalizeLogEntries"](
        payload,
      ) as Array<JSONObject>;

      expect(entries).toHaveLength(2);
      expect(entries[0]!["host"]).toBe("node-1");
      expect(entries[1]!["host"]).toBe("node-2");
    });

    test("wraps plain string in JSONObject with message field", () => {
      const entries: Array<JSONObject> = service["normalizeLogEntries"](
        "simple log line",
      ) as Array<JSONObject>;

      expect(entries).toHaveLength(1);
      expect(entries[0]!["message"]).toBe("simple log line");
    });

    test("splits multiline string into separate entries", () => {
      const entries: Array<JSONObject> = service["normalizeLogEntries"](
        "line one\nline two\nline three",
      ) as Array<JSONObject>;

      expect(entries).toHaveLength(3);
      expect(entries[0]!["message"]).toBe("line one");
      expect(entries[1]!["message"]).toBe("line two");
      expect(entries[2]!["message"]).toBe("line three");
    });

    test("handles null and undefined", () => {
      expect(service["normalizeLogEntries"](null)).toEqual([]);
      expect(service["normalizeLogEntries"](undefined)).toEqual([]);
    });

    test("handles empty string", () => {
      expect(service["normalizeLogEntries"]("")).toEqual([]);
      expect(service["normalizeLogEntries"]("   ")).toEqual([]);
    });
  });

  describe("extractBodyFromEntry", () => {
    test("extracts from 'message' field", () => {
      const entry: JSONObject = {
        message: "the log body",
        stream: "stdout",
      };

      const body: string = service["extractBodyFromEntry"](entry) as string;
      expect(body).toBe("the log body");
    });

    test("extracts from 'log' field", () => {
      const entry: JSONObject = {
        log: "container output line",
        stream: "stderr",
      };

      const body: string = service["extractBodyFromEntry"](entry) as string;
      expect(body).toBe("container output line");
    });

    test("extracts from 'msg' field", () => {
      const entry: JSONObject = { msg: "short msg field" };

      const body: string = service["extractBodyFromEntry"](entry) as string;
      expect(body).toBe("short msg field");
    });

    test("prefers 'message' over 'log'", () => {
      const entry: JSONObject = {
        message: "from message",
        log: "from log",
      };

      const body: string = service["extractBodyFromEntry"](entry) as string;
      expect(body).toBe("from message");
    });

    test("stringifies entire entry when no body field found", () => {
      const entry: JSONObject = {
        stream: "stdout",
        kubernetes: { pod_name: "test" },
      };

      const body: string = service["extractBodyFromEntry"](entry) as string;
      const parsed: JSONObject = JSON.parse(body) as JSONObject;
      expect(parsed["stream"]).toBe("stdout");
    });

    test("stringifies non-string body field values", () => {
      const entry: JSONObject = {
        message: { nested: "object" },
      };

      const body: string = service["extractBodyFromEntry"](entry) as string;
      expect(body).toBe('{"nested":"object"}');
    });
  });

  describe("extractSeverityFromEntry", () => {
    test("maps 'error' level", () => {
      const result: { number: number; text: LogSeverity } = service[
        "extractSeverityFromEntry"
      ]({ level: "error" }) as { number: number; text: LogSeverity };

      expect(result.number).toBe(17);
      expect(result.text).toBe(LogSeverity.Error);
    });

    test("maps 'info' level", () => {
      const result: { number: number; text: LogSeverity } = service[
        "extractSeverityFromEntry"
      ]({ level: "info" }) as { number: number; text: LogSeverity };

      expect(result.number).toBe(9);
      expect(result.text).toBe(LogSeverity.Information);
    });

    test("maps 'warn' level", () => {
      const result: { number: number; text: LogSeverity } = service[
        "extractSeverityFromEntry"
      ]({ level: "warn" }) as { number: number; text: LogSeverity };

      expect(result.number).toBe(13);
      expect(result.text).toBe(LogSeverity.Warning);
    });

    test("maps 'debug' level", () => {
      const result: { number: number; text: LogSeverity } = service[
        "extractSeverityFromEntry"
      ]({ level: "debug" }) as { number: number; text: LogSeverity };

      expect(result.number).toBe(5);
      expect(result.text).toBe(LogSeverity.Debug);
    });

    test("maps 'fatal' level", () => {
      const result: { number: number; text: LogSeverity } = service[
        "extractSeverityFromEntry"
      ]({ level: "fatal" }) as { number: number; text: LogSeverity };

      expect(result.number).toBe(23);
      expect(result.text).toBe(LogSeverity.Fatal);
    });

    test("reads from 'severity' field", () => {
      const result: { number: number; text: LogSeverity } = service[
        "extractSeverityFromEntry"
      ]({ severity: "warning" }) as { number: number; text: LogSeverity };

      expect(result.number).toBe(13);
      expect(result.text).toBe(LogSeverity.Warning);
    });

    test("is case-insensitive", () => {
      const result: { number: number; text: LogSeverity } = service[
        "extractSeverityFromEntry"
      ]({ level: "ERROR" }) as { number: number; text: LogSeverity };

      expect(result.number).toBe(17);
      expect(result.text).toBe(LogSeverity.Error);
    });

    test("returns Unspecified for missing severity", () => {
      const result: { number: number; text: LogSeverity } = service[
        "extractSeverityFromEntry"
      ]({ message: "no severity" }) as { number: number; text: LogSeverity };

      expect(result.number).toBe(0);
      expect(result.text).toBe(LogSeverity.Unspecified);
    });

    test("returns Unspecified for unknown severity value", () => {
      const result: { number: number; text: LogSeverity } = service[
        "extractSeverityFromEntry"
      ]({ level: "verbose" }) as { number: number; text: LogSeverity };

      expect(result.number).toBe(0);
      expect(result.text).toBe(LogSeverity.Unspecified);
    });
  });

  describe("extractStringField", () => {
    test("extracts string value from first matching field", () => {
      const result: string | undefined = service["extractStringField"](
        { trace_id: "abc123" },
        ["trace_id", "traceId"],
      ) as string | undefined;

      expect(result).toBe("abc123");
    });

    test("tries fields in order", () => {
      const result: string | undefined = service["extractStringField"](
        { traceId: "from-camel" },
        ["trace_id", "traceId"],
      ) as string | undefined;

      expect(result).toBe("from-camel");
    });

    test("converts number to string", () => {
      const result: string | undefined = service["extractStringField"](
        { priority: 42 },
        ["priority"],
      ) as string | undefined;

      expect(result).toBe("42");
    });

    test("returns undefined when no fields match", () => {
      const result: string | undefined = service["extractStringField"](
        { other: "value" },
        ["trace_id", "traceId"],
      ) as string | undefined;

      expect(result).toBeUndefined();
    });

    test("skips empty strings", () => {
      const result: string | undefined = service["extractStringField"](
        { trace_id: "", traceId: "fallback" },
        ["trace_id", "traceId"],
      ) as string | undefined;

      expect(result).toBe("fallback");
    });
  });

  describe("buildFluentAttributes", () => {
    test("extracts top-level scalar fields with fluentd. prefix", () => {
      const entry: JSONObject = {
        message: "body text",
        stream: "stdout",
        tag: "kube.var.log",
      };

      const attrs: Record<string, unknown> = service["buildFluentAttributes"](
        entry,
      ) as Record<string, unknown>;

      // 'message' is excluded (it's a body field)
      expect(attrs["fluentd.message"]).toBeUndefined();
      // other fields are included
      expect(attrs["fluentd.stream"]).toBe("stdout");
      expect(attrs["fluentd.tag"]).toBe("kube.var.log");
    });

    test("flattens nested objects with dot notation", () => {
      const entry: JSONObject = {
        message: "log",
        kubernetes: {
          namespace_name: "default",
          pod_name: "my-app-xyz",
          container_name: "app",
          labels: {
            app: "my-app",
            version: "v1",
          },
        },
      };

      const attrs: Record<string, unknown> = service["buildFluentAttributes"](
        entry,
      ) as Record<string, unknown>;

      expect(attrs["fluentd.kubernetes.namespace_name"]).toBe("default");
      expect(attrs["fluentd.kubernetes.pod_name"]).toBe("my-app-xyz");
      expect(attrs["fluentd.kubernetes.container_name"]).toBe("app");
      expect(attrs["fluentd.kubernetes.labels.app"]).toBe("my-app");
      expect(attrs["fluentd.kubernetes.labels.version"]).toBe("v1");
    });

    test("serializes arrays as JSON strings", () => {
      const entry: JSONObject = {
        message: "log",
        tags: ["web", "production"],
      };

      const attrs: Record<string, unknown> = service["buildFluentAttributes"](
        entry,
      ) as Record<string, unknown>;

      expect(attrs["fluentd.tags"]).toBe('["web","production"]');
    });

    test("handles boolean and numeric values", () => {
      const entry: JSONObject = {
        message: "log",
        count: 42,
        success: true,
      };

      const attrs: Record<string, unknown> = service["buildFluentAttributes"](
        entry,
      ) as Record<string, unknown>;

      expect(attrs["fluentd.count"]).toBe(42);
      expect(attrs["fluentd.success"]).toBe(true);
    });

    test("excludes all body, severity, trace, and span fields", () => {
      const entry: JSONObject = {
        message: "body",
        log: "also body",
        level: "info",
        severity: "info",
        trace_id: "abc",
        traceId: "abc",
        span_id: "def",
        spanId: "def",
        custom_field: "should be kept",
      };

      const attrs: Record<string, unknown> = service["buildFluentAttributes"](
        entry,
      ) as Record<string, unknown>;

      expect(attrs["fluentd.message"]).toBeUndefined();
      expect(attrs["fluentd.log"]).toBeUndefined();
      expect(attrs["fluentd.level"]).toBeUndefined();
      expect(attrs["fluentd.severity"]).toBeUndefined();
      expect(attrs["fluentd.trace_id"]).toBeUndefined();
      expect(attrs["fluentd.traceId"]).toBeUndefined();
      expect(attrs["fluentd.span_id"]).toBeUndefined();
      expect(attrs["fluentd.spanId"]).toBeUndefined();
      expect(attrs["fluentd.custom_field"]).toBe("should be kept");
    });

    test("skips null and undefined values", () => {
      const entry: JSONObject = {
        message: "log",
        null_field: null,
        valid_field: "kept",
      };

      const attrs: Record<string, unknown> = service["buildFluentAttributes"](
        entry,
      ) as Record<string, unknown>;

      expect(attrs["fluentd.null_field"]).toBeUndefined();
      expect(attrs["fluentd.valid_field"]).toBe("kept");
    });
  });

  describe("full Kubernetes Fluent Bit payload", () => {
    test("correctly processes a typical Kubernetes log entry", () => {
      const k8sPayload: JSONObject = {
        log: "2024-01-15T10:30:00.123Z ERROR Connection refused to database\n",
        stream: "stderr",
        time: "2024-01-15T10:30:00.123456789Z",
        level: "error",
        kubernetes: {
          pod_name: "api-server-7b9f4c8d5-xk2m9",
          namespace_name: "production",
          container_name: "api-server",
          pod_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          labels: {
            app: "api-server",
            "app.kubernetes.io/version": "2.1.0",
            team: "platform",
          },
          host: "node-pool-1-abc",
        },
      };

      // Test normalization preserves the object
      const entries: Array<JSONObject> = service["normalizeLogEntries"](
        k8sPayload,
      ) as Array<JSONObject>;
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(k8sPayload);

      // Test body extraction
      const body: string = service["extractBodyFromEntry"](
        k8sPayload,
      ) as string;
      expect(body).toBe(
        "2024-01-15T10:30:00.123Z ERROR Connection refused to database\n",
      );

      // Test severity extraction
      const severity: { number: number; text: LogSeverity } = service[
        "extractSeverityFromEntry"
      ](k8sPayload) as { number: number; text: LogSeverity };
      expect(severity.text).toBe(LogSeverity.Error);
      expect(severity.number).toBe(17);

      // Test attributes extraction
      const attrs: Record<string, unknown> = service["buildFluentAttributes"](
        k8sPayload,
      ) as Record<string, unknown>;

      // Body and severity fields excluded
      expect(attrs["fluentd.log"]).toBeUndefined();
      expect(attrs["fluentd.level"]).toBeUndefined();

      // Other fields preserved
      expect(attrs["fluentd.stream"]).toBe("stderr");
      expect(attrs["fluentd.time"]).toBe("2024-01-15T10:30:00.123456789Z");

      // Kubernetes metadata flattened
      expect(attrs["fluentd.kubernetes.pod_name"]).toBe(
        "api-server-7b9f4c8d5-xk2m9",
      );
      expect(attrs["fluentd.kubernetes.namespace_name"]).toBe("production");
      expect(attrs["fluentd.kubernetes.container_name"]).toBe("api-server");
      expect(attrs["fluentd.kubernetes.pod_id"]).toBe(
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      );
      expect(attrs["fluentd.kubernetes.labels.app"]).toBe("api-server");
      expect(attrs["fluentd.kubernetes.labels.app.kubernetes.io/version"]).toBe(
        "2.1.0",
      );
      expect(attrs["fluentd.kubernetes.labels.team"]).toBe("platform");
      expect(attrs["fluentd.kubernetes.host"]).toBe("node-pool-1-abc");
    });

    test("handles Fluentd json-wrapped Kubernetes payload", () => {
      const payload: JSONObject = {
        json: {
          log: "Application started successfully",
          stream: "stdout",
          level: "info",
          kubernetes: {
            namespace_name: "staging",
            pod_name: "web-abc123",
          },
        },
      };

      const entries: Array<JSONObject> = service["normalizeLogEntries"](
        payload,
      ) as Array<JSONObject>;
      expect(entries).toHaveLength(1);
      expect(entries[0]!["log"]).toBe("Application started successfully");
      expect((entries[0]!["kubernetes"] as JSONObject)["namespace_name"]).toBe(
        "staging",
      );
    });

    test("handles batch of Fluentd log entries", () => {
      const payload: Array<JSONObject> = [
        {
          message: "Request received",
          level: "info",
          kubernetes: { pod_name: "web-1" },
        },
        {
          message: "Processing failed",
          level: "error",
          kubernetes: { pod_name: "web-1" },
        },
        {
          message: "Retry succeeded",
          level: "warn",
          kubernetes: { pod_name: "web-1" },
        },
      ];

      const entries: Array<JSONObject> = service["normalizeLogEntries"](
        payload,
      ) as Array<JSONObject>;

      expect(entries).toHaveLength(3);

      const sev0: { text: LogSeverity } = service["extractSeverityFromEntry"](
        entries[0]!,
      ) as { text: LogSeverity };
      const sev1: { text: LogSeverity } = service["extractSeverityFromEntry"](
        entries[1]!,
      ) as { text: LogSeverity };
      const sev2: { text: LogSeverity } = service["extractSeverityFromEntry"](
        entries[2]!,
      ) as { text: LogSeverity };

      expect(sev0.text).toBe(LogSeverity.Information);
      expect(sev1.text).toBe(LogSeverity.Error);
      expect(sev2.text).toBe(LogSeverity.Warning);
    });
  });
});
