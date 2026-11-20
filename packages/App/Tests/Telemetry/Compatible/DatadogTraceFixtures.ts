import { JSONObject } from "Common/Types/JSON";
import { DatadogAgentPayload } from "../../../FeatureSet/Telemetry/Utils/Compatible/DatadogTraces";

/*
 * Datadog APM payloads as their senders write them, for the translator's
 * and the routes' suites:
 *
 *   - the trace-agent's AgentPayload (pkg/trace/writer/trace.go): a Python
 *     Flask service's request, its Postgres query and a failed charge, as
 *     dd-trace-py 2.x hands them to the Agent - a 128-bit trace whose high
 *     half (_dd.p.tid) only the request's span carries, the integration's
 *     service marked _dd.base_service, the Agent's resolved container tags;
 *   - the same Agent's v1 ("idx") payload, from a dd-trace-go that speaks
 *     /v1.0/traces: every string a reference into its table.
 *
 * protobufjs writes each, from the full message types.
 */

export const TRACE_ID_LOW: string = "11259375";
export const TRACE_ID_HIGH_HEX: string = "6553f10000000000";
export const START: string = "1700000000123456789";

export const PYTHON_TRACEBACK: string =
  'Traceback (most recent call last):\n  File "/app/charge.py", line 12, in charge\n    raise ValueError("card declined")\nValueError: card declined\n';

export function pythonAgentPayloadObject(): JSONObject {
  return {
    hostName: "web-1",
    env: "prod",
    agentVersion: "7.60.0",
    targetTPS: 10,
    errorTPS: 10,
    rareSamplerEnabled: false,
    tags: { "_dd.apm_mode": "edge" },
    tracerPayloads: [
      {
        containerID: "3f9e1b7c2a",
        languageName: "python",
        languageVersion: "3.11.4",
        tracerVersion: "2.14.2",
        runtimeID: "7c9ea8c8-31f5-4a5f-9c3b-0d2a61e1c111",
        env: "prod",
        hostname: "",
        appVersion: "1.4.2",
        tags: {
          "_dd.tags.container":
            "kube_namespace:shop,pod_name:checkout-7d9f8,kube_deployment:checkout,image_tag:1.4.2,unmapped_tag:kept-out",
        },
        containerDebug: { error: "", latencyMs: "3" },
        chunks: [
          {
            priority: 1,
            origin: "",
            droppedTrace: false,
            tags: { "_dd.p.dm": "-0" },
            spans: [
              {
                service: "checkout",
                name: "flask.request",
                resource: "GET /users/<int:user_id>",
                traceID: TRACE_ID_LOW,
                spanID: "1",
                parentID: "0",
                start: START,
                duration: "25000000",
                error: 0,
                type: "web",
                meta: {
                  "_dd.p.tid": TRACE_ID_HIGH_HEX,
                  "_dd.p.dm": "-0",
                  "http.method": "GET",
                  "http.route": "/users/<int:user_id>",
                  "http.status_code": "200",
                  "http.url": "http://shop.example/users/7",
                  "span.kind": "server",
                  component: "flask",
                  language: "python",
                  "runtime-id": "7c9ea8c8-31f5-4a5f-9c3b-0d2a61e1c111",
                  env: "prod",
                  version: "1.4.2",
                },
                metrics: {
                  _sampling_priority_v1: 1,
                  "_dd.top_level": 1,
                  "_dd.measured": 1,
                  process_id: 4242,
                },
                meta_struct: { appsec: Buffer.from([1, 2, 3]) },
              },
              {
                service: "checkout-postgres",
                name: "postgres.query",
                resource: "SELECT * FROM users WHERE id = %s",
                traceID: TRACE_ID_LOW,
                spanID: "2",
                parentID: "1",
                start: "1700000000124000000",
                duration: "3000000",
                error: 0,
                type: "sql",
                meta: {
                  "_dd.base_service": "checkout",
                  "db.type": "postgresql",
                  "db.instance": "shop",
                  "out.host": "db-1.internal",
                  "span.kind": "client",
                  component: "psycopg",
                },
                metrics: { "out.port": 5432, "db.row_count": 1 },
              },
              {
                service: "checkout",
                name: "checkout.charge",
                resource: "charge",
                traceID: TRACE_ID_LOW,
                spanID: "3",
                parentID: "1",
                start: "1700000000130000000",
                duration: "5000000",
                error: 1,
                type: "",
                meta: {
                  "error.type": "builtins.ValueError",
                  "error.message": "card declined",
                  "error.stack": PYTHON_TRACEBACK,
                },
                metrics: {},
              },
            ],
          },
        ],
      },
    ],
  };
}

export function encodeAgentPayload(object: JSONObject): Buffer {
  return Buffer.from(
    DatadogAgentPayload.encode(DatadogAgentPayload.fromObject(object)).finish(),
  );
}

// The v1 payload's string table: index 0 is "", as the tracers write it.
export const IDX_STRINGS: Array<string> = [
  "",
  "payments",
  "http.request",
  "POST /pay",
  "web",
  "staging",
  "2.0.1",
  "net/http",
  "http.method",
  "POST",
  "go",
  "go1.22.5",
  "v2.0.0",
  "http.status_code",
  "retry",
  "ratio",
  "tags",
  "a",
  "b",
  "headers",
  "content-type",
  "application/json",
  "link.kind",
  "follows",
  "rum",
  "error.type",
  "*errors.errorString",
  "error.message",
  "payment refused",
  "cache.hit",
  "runtime-x",
];

export const IDX_TRACE_ID: Buffer = Buffer.from(
  "0123456789abcdef0011223344556677",
  "hex",
);

export function idxAgentPayloadObject(): JSONObject {
  return {
    hostName: "agent-host",
    env: "",
    agentVersion: "7.70.0",
    idxTracerPayloads: [
      {
        strings: IDX_STRINGS,
        containerIDRef: 0,
        languageNameRef: 10,
        languageVersionRef: 11,
        tracerVersionRef: 12,
        runtimeIDRef: 30,
        envRef: 5,
        hostnameRef: 0,
        appVersionRef: 6,
        attributes: {},
        chunks: [
          {
            priority: 2,
            originRef: 24,
            attributes: {},
            droppedTrace: false,
            traceID: IDX_TRACE_ID,
            samplingMechanism: 4,
            spans: [
              {
                serviceRef: 1,
                nameRef: 2,
                resourceRef: 3,
                spanID: "12345678901234567890",
                parentID: "0",
                start: START,
                duration: "7000000",
                error: true,
                typeRef: 4,
                kind: 2,
                envRef: 5,
                versionRef: 6,
                componentRef: 7,
                attributes: {
                  8: { stringValueRef: 9 },
                  13: { intValue: "500" },
                  14: { boolValue: true },
                  15: { doubleValue: 0.25 },
                  16: {
                    arrayValue: {
                      values: [{ stringValueRef: 17 }, { stringValueRef: 18 }],
                    },
                  },
                  19: {
                    keyValueList: {
                      keyValues: [{ key: 20, value: { stringValueRef: 21 } }],
                    },
                  },
                  25: { stringValueRef: 26 },
                  27: { stringValueRef: 28 },
                },
                links: [
                  {
                    traceID: Buffer.from(
                      "ffeeddccbbaa99887766554433221100",
                      "hex",
                    ),
                    spanID: "42",
                    attributes: { 22: { stringValueRef: 23 } },
                    tracestateRef: 0,
                    flags: 2147483649,
                  },
                ],
                events: [
                  {
                    time: "1700000000125000000",
                    nameRef: 29,
                    attributes: { 14: { boolValue: false } },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

/*
 * A protobuf field written by hand, for payloads no encoder would write:
 * a tag of the field and wire type 2, a length, the bytes.
 */
export function lengthDelimited(field: number, bytes: Buffer): Buffer {
  return Buffer.concat([varint((field << 3) | 2), varint(bytes.length), bytes]);
}

export function varint(value: number): Buffer {
  const bytes: Array<number> = [];
  let rest: number = value;

  while (rest > 0x7f) {
    bytes.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }

  bytes.push(rest);

  return Buffer.from(bytes);
}
