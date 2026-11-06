import { describe, expect, test } from "@jest/globals";
import {
  CloudMonitoredResource,
  resolveCloudMonitoredResource,
} from "Common/Types/Cloud/CloudMonitoredResource";
import { JSONObject } from "Common/Types/JSON";
import {
  CLOUD_LOGGING_SEVERITIES,
  CloudLoggingEntry,
  buildCloudLoggingResourceLogs,
  readCloudLoggingEntry,
  readLogId,
  readLogProject,
  readTraceId,
  rfc3339ToUnixNano,
} from "../../FeatureSet/Telemetry/Utils/GcpPubSub/CloudLoggingEntries";
import {
  ENTRY_TIME,
  ENTRY_TIME_UNIX_NANO,
  PROJECT,
  auditLogEntry,
  cloudFunctionEntry,
  cloudRunRequestEntry,
  computeSyslogEntry,
  gkeContainerEntry,
} from "./Helpers/FakePubSub";

/*
 * A Cloud Logging entry as Pub/Sub carries it, read as one OTLP log record:
 * its time to the nanosecond, its severity in OpenTelemetry's numbers, its
 * body from whichever payload it has, its trace, its HTTP request, and its
 * resource - the project, the region, and the cloud resource its
 * monitored resource's labels name, the very one its metrics land on.
 */

function build(entry: JSONObject): ReturnType<typeof buildCloudLoggingResourceLogs> {
  const read: CloudLoggingEntry | null = readCloudLoggingEntry(entry);

  expect(read).not.toBeNull();

  return buildCloudLoggingResourceLogs({
    entry: read!,
    serviceName: "Production Google Cloud",
    connectionId: "33333333-3333-4333-8333-333333333333",
    observedAtMs: Date.UTC(2026, 10, 6, 10, 0, 0),
  });
}

function resourceAttributes(resourceLogs: JSONObject): Record<string, string> {
  const values: Record<string, string> = {};

  for (const attribute of (resourceLogs["resource"] as JSONObject)[
    "attributes"
  ] as Array<JSONObject>) {
    values[attribute["key"] as string] = (attribute["value"] as JSONObject)[
      "stringValue"
    ] as string;
  }

  return values;
}

function recordOf(resourceLogs: JSONObject): JSONObject {
  return (
    (resourceLogs["scopeLogs"] as Array<JSONObject>)[0]![
      "logRecords"
    ] as Array<JSONObject>
  )[0]!;
}

function recordAttributes(record: JSONObject): Record<string, JSONObject> {
  const values: Record<string, JSONObject> = {};

  for (const attribute of record["attributes"] as Array<JSONObject>) {
    values[attribute["key"] as string] = attribute["value"] as JSONObject;
  }

  return values;
}

function resourceOf(type: string, labels: Record<string, string>): CloudMonitoredResource {
  const attributes: Record<string, string> = { "resource.gcp.resource_type": type };

  for (const key of Object.keys(labels)) {
    attributes[`resource.${key}`] = labels[key]!;
  }

  return resolveCloudMonitoredResource({ metricName: "x", attributes })!;
}

describe("the entry's time", () => {
  test("is kept to the nanosecond, whatever fraction Cloud Logging writes", () => {
    expect(rfc3339ToUnixNano(ENTRY_TIME)).toBe(ENTRY_TIME_UNIX_NANO);
    expect(rfc3339ToUnixNano("2026-11-06T09:59:01Z")).toBe("1793959141000000000");
    expect(rfc3339ToUnixNano("2026-11-06T09:59:01.5Z")).toBe("1793959141500000000");
    expect(rfc3339ToUnixNano("2026-11-06T09:59:01.123456789123Z")).toBe(
      "1793959141123456789",
    );
    expect(rfc3339ToUnixNano("2026-11-06T10:59:01.25+01:00")).toBe("1793959141250000000");
    expect(rfc3339ToUnixNano("1970-01-01T00:00:00.000000042Z")).toBe("42");
  });

  test("a time that is none is no time", () => {
    for (const value of ["", "yesterday", 1793959141, null, "x".repeat(100), "1969-12-31T23:59:59Z"]) {
      expect(rfc3339ToUnixNano(value)).toBeNull();
    }
  });

  test("an entry without its own time takes when Cloud Logging received it", () => {
    const record: JSONObject = recordOf(
      build({ ...computeSyslogEntry(), timestamp: undefined }).resourceLogs,
    );

    expect(record["timeUnixNano"]).toBe("1793959141512345678");
    expect(record["observedTimeUnixNano"]).toBe("1793959141512345678");
  });
});

describe("the entry's log name", () => {
  test("its id is decoded, and its project read", () => {
    expect(readLogId("projects/acme/logs/run.googleapis.com%2Frequests")).toBe(
      "run.googleapis.com/requests",
    );
    expect(readLogId("organizations/123/logs/cloudaudit.googleapis.com%2Factivity")).toBe(
      "cloudaudit.googleapis.com/activity",
    );
    expect(readLogId("projects/acme/logs/%E0%A4%A")).toBe("%E0%A4%A");
    expect(readLogId("nothing")).toBe("");
    expect(readLogProject("projects/acme/logs/syslog")).toBe("acme");
    expect(readLogProject("folders/1/logs/syslog")).toBe("");
  });
});

describe("the entry's severity", () => {
  test("Cloud Logging's words in OpenTelemetry's numbers, as the Collector maps them", () => {
    expect(Object.fromEntries(CLOUD_LOGGING_SEVERITIES)).toEqual({
      DEBUG: { number: 5, text: "DEBUG" },
      INFO: { number: 9, text: "INFO" },
      NOTICE: { number: 10, text: "INFO" },
      WARNING: { number: 13, text: "WARN" },
      ERROR: { number: 17, text: "ERROR" },
      CRITICAL: { number: 18, text: "ERROR" },
      ALERT: { number: 21, text: "FATAL" },
      EMERGENCY: { number: 22, text: "FATAL" },
    });
  });

  test("DEFAULT, or none, says nothing", () => {
    for (const severity of ["DEFAULT", undefined, "LOUD"]) {
      const record: JSONObject = recordOf(
        build(computeSyslogEntry({ severity })).resourceLogs,
      );

      expect(record["severityNumber"]).toBe(0);
      expect(record["severityText"]).toBe("");
    }
  });
});

describe("the entry's body", () => {
  test("a text payload is the body", () => {
    expect(
      (recordOf(build(computeSyslogEntry()).resourceLogs)["body"] as JSONObject)[
        "stringValue"
      ],
    ).toBe("kernel: Out of memory: Killed process 1234 (java)");
  });

  test("a JSON payload's message is the body, its other fields beside it", () => {
    const record: JSONObject = recordOf(build(cloudFunctionEntry()).resourceLogs);
    const attributes: Record<string, JSONObject> = recordAttributes(record);

    expect((record["body"] as JSONObject)["stringValue"]).toBe("Payment failed: card declined");
    expect(attributes["gcp.json_payload.orderId"]).toEqual({ stringValue: "o-981" });
    expect(attributes["gcp.json_payload.attempt"]).toEqual({ intValue: "2" });
    expect(attributes["gcp.json_payload.retryable"]).toEqual({ boolValue: false });
    expect(attributes["gcp.json_payload.message"]).toBeUndefined();
    expect(attributes["gcp.label.execution_id"]).toEqual({ stringValue: "abc123xyz" });
  });

  test("a JSON payload with msg is read like message; one with neither is the body whole", () => {
    expect(
      (
        recordOf(
          build(cloudFunctionEntry({ jsonPayload: { msg: "pino says hi", pid: 7 } })).resourceLogs,
        )["body"] as JSONObject
      )["stringValue"],
    ).toBe("pino says hi");

    const whole: JSONObject = recordOf(
      build(cloudFunctionEntry({ jsonPayload: { event: "deploy", version: 42 } })).resourceLogs,
    );
    expect((whole["body"] as JSONObject)["stringValue"]).toBe('{"event":"deploy","version":42}');
    expect(recordAttributes(whole)["gcp.json_payload.event"]).toBeUndefined();
  });

  test("an audit log is its method on its resource, with who and from where", () => {
    const record: JSONObject = recordOf(build(auditLogEntry()).resourceLogs);
    const attributes: Record<string, JSONObject> = recordAttributes(record);

    expect((record["body"] as JSONObject)["stringValue"]).toBe(
      `cloudsql.instances.update projects/${PROJECT}/instances/orders-db`,
    );
    expect(attributes["enduser.id"]).toEqual({ stringValue: "alice@acme.com" });
    expect(attributes["client.address"]).toEqual({ stringValue: "198.51.100.4" });
    expect(attributes["gcp.audit.service_name"]).toEqual({
      stringValue: "cloudsql.googleapis.com",
    });

    const failed: JSONObject = recordOf(
      build(
        auditLogEntry({
          protoPayload: {
            methodName: "storage.buckets.delete",
            resourceName: "projects/_/buckets/orders",
            status: { code: 7, message: "PERMISSION_DENIED" },
          },
        }),
      ).resourceLogs,
    );
    expect((failed["body"] as JSONObject)["stringValue"]).toBe(
      "storage.buckets.delete projects/_/buckets/orders: PERMISSION_DENIED",
    );
    expect(recordAttributes(failed)["gcp.audit.status_code"]).toEqual({ intValue: "7" });
  });

  test("a body is bounded, however long the payload", () => {
    const record: JSONObject = recordOf(
      build(computeSyslogEntry({ textPayload: "x".repeat(200 * 1024) })).resourceLogs,
    );

    expect(((record["body"] as JSONObject)["stringValue"] as string).length).toBe(64 * 1024);
  });
});

describe("the entry's trace and HTTP request", () => {
  test("its trace and span are the record's own, so it lines up with the trace", () => {
    const record: JSONObject = recordOf(build(cloudRunRequestEntry()).resourceLogs);

    expect(record["traceId"]).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(record["spanId"]).toBe("a1b2c3d4e5f60718");
    expect(readTraceId("projects/p/traces/NOT-HEX")).toBe("");
    expect(readTraceId("4BF92F3577B34DA6A3CE929D0E0E4736")).toBe(
      "4bf92f3577b34da6a3ce929d0e0e4736",
    );

    const noTrace: JSONObject = recordOf(
      build(cloudRunRequestEntry({ trace: undefined })).resourceLogs,
    );
    expect(noTrace["traceId"]).toBeUndefined();
    // A span without its trace is no span.
    expect(noTrace["spanId"]).toBeUndefined();
  });

  test("its HTTP request is in the semantic conventions' names", () => {
    const attributes: Record<string, JSONObject> = recordAttributes(
      recordOf(build(cloudRunRequestEntry()).resourceLogs),
    );

    expect(attributes["http.request.method"]).toEqual({ stringValue: "GET" });
    expect(attributes["url.full"]).toEqual({
      stringValue: "https://checkout-abc123-uc.a.run.app/health",
    });
    expect(attributes["http.response.status_code"]).toEqual({ intValue: "503" });
    expect(attributes["client.address"]).toEqual({ stringValue: "203.0.113.7" });
    expect(attributes["user_agent.original"]).toEqual({
      stringValue: "Mozilla/5.0 (X11; Linux x86_64)",
    });
    expect(attributes["http.response.body.size"]).toEqual({ intValue: "753" });
    expect(attributes["http.server.request.duration"]).toEqual({ doubleValue: 0.004387 });
  });
});

describe("the entry's resource", () => {
  test("is the connection's service and id, its project and region, and its monitored resource's labels", () => {
    const attributes: Record<string, string> = resourceAttributes(
      build(cloudRunRequestEntry()).resourceLogs,
    );

    expect(attributes).toMatchObject({
      "service.name": "Production Google Cloud",
      "cloud.provider": "gcp",
      "oneuptime.cloud.connection.id": "33333333-3333-4333-8333-333333333333",
      "cloud.account.id": PROJECT,
      "cloud.region": "us-central1",
      "gcp.resource_type": "cloud_run_revision",
      service_name: "checkout",
      revision_name: "checkout-00042-xyz",
    });
  });

  test("a resource the catalog knows is named as cloud.resource_id - the one its metrics land on", () => {
    const cases: Array<[JSONObject, CloudMonitoredResource]> = [
      [
        computeSyslogEntry(),
        resourceOf("gce_instance", {
          instance_id: "4876543210987654321",
          project_id: PROJECT,
          zone: "us-central1-a",
        }),
      ],
      [
        cloudFunctionEntry(),
        resourceOf("cloud_function", {
          function_name: "charge-card",
          project_id: PROJECT,
          region: "us-central1",
        }),
      ],
      [
        auditLogEntry(),
        resourceOf("cloudsql_database", {
          database_id: `${PROJECT}:orders-db`,
          project_id: PROJECT,
          region: "us-central1",
        }),
      ],
    ];

    for (const [entry, expected] of cases) {
      const built: ReturnType<typeof buildCloudLoggingResourceLogs> = build(entry);

      expect(resourceAttributes(built.resourceLogs)["cloud.resource_id"]).toBe(
        expected.providerResourceId,
      );
      expect(built.facts.resource?.identityKey).toBe(expected.identityKey);
    }
  });

  test("a zone is said as its region", () => {
    expect(build(computeSyslogEntry()).facts.region).toBe("us-central1");
  });

  test("only a Cloud Functions function's logs name a platform: Cloud Run's and GKE's never", () => {
    expect(resourceAttributes(build(cloudFunctionEntry()).resourceLogs)).toMatchObject({
      "cloud.platform": "gcp_cloud_functions",
      "faas.name": "charge-card",
    });

    for (const entry of [cloudRunRequestEntry(), gkeContainerEntry(), computeSyslogEntry()]) {
      expect(resourceAttributes(build(entry).resourceLogs)["cloud.platform"]).toBeUndefined();
    }
  });

  test("a resource of a type no rule reads, or of none, streams unfiled under its project", () => {
    const gke: ReturnType<typeof buildCloudLoggingResourceLogs> = build(gkeContainerEntry());

    expect(gke.facts.resource).toBeNull();
    expect(resourceAttributes(gke.resourceLogs)["cloud.resource_id"]).toBeUndefined();

    const bare: ReturnType<typeof buildCloudLoggingResourceLogs> = build({
      logName: "projects/acme-data-2/logs/my-app",
      textPayload: "hello",
      timestamp: ENTRY_TIME,
    });
    expect(bare.facts).toEqual({
      projectId: "acme-data-2",
      region: "",
      logId: "my-app",
      resource: null,
    });
  });
});

describe("what is no log entry", () => {
  test("is not read as one", () => {
    for (const value of [
      null,
      [],
      "text",
      {},
      { logName: "projects/p/logs/x" },
      { textPayload: "no log name" },
    ]) {
      expect(readCloudLoggingEntry(value)).toBeNull();
    }
  });

  test("a label that would poison an object is not kept", () => {
    const entry: CloudLoggingEntry | null = readCloudLoggingEntry(
      JSON.parse(
        '{"logName":"projects/p/logs/x","textPayload":"t","labels":{"__proto__":{"admin":true},"ok":"1"}}',
      ),
    );

    expect(entry?.labels).toEqual({ ok: "1" });
    expect(({} as Record<string, unknown>)["admin"]).toBeUndefined();
  });
});
