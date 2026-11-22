import AndroidAgentLogSessionsAPI from "../../FeatureSet/Telemetry/API/AndroidAgentLogSessions";
import ChangeEventsIngestAPI from "../../FeatureSet/Telemetry/API/ChangeEventsIngest";
import DbtArtifactsIngestAPI from "../../FeatureSet/Telemetry/API/DbtArtifactsIngest";
import FluentAPI from "../../FeatureSet/Telemetry/API/Fluent";
import HostCollectorOpAmpAPI from "../../FeatureSet/Telemetry/API/HostCollectorOpAmp";
import KubernetesCostIngestAPI from "../../FeatureSet/Telemetry/API/KubernetesCostIngest";
import OpenLineageIngestAPI from "../../FeatureSet/Telemetry/API/OpenLineageIngest";
import PyroscopeAPI from "../../FeatureSet/Telemetry/API/Pyroscope";
import SyncWebhooksIngestAPI from "../../FeatureSet/Telemetry/API/SyncWebhooksIngest";
import SyslogAPI from "../../FeatureSet/Telemetry/API/Syslog";
import FluentLogsQueueService from "../../FeatureSet/Telemetry/Services/Queue/FluentLogsQueueService";
import SyslogQueueService from "../../FeatureSet/Telemetry/Services/Queue/SyslogQueueService";
import TelemetryQueueService from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import TelemetryBodyStore from "../../FeatureSet/Telemetry/Utils/TelemetryBodyStore";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import Queue from "Common/Server/Infrastructure/Queue";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import HostLogSessionService from "Common/Server/Services/HostLogSessionService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import DbtIngest, {
  DbtIngestSummary,
} from "Common/Server/Utils/DataObservability/DbtIngest";
import { DbtRunResults } from "Common/Server/Utils/DataObservability/DbtArtifacts";
import { OpenLineageRunEvent } from "Common/Server/Utils/DataObservability/OpenLineageEvent";
import OpenLineageIngest from "Common/Server/Utils/DataObservability/OpenLineageIngest";
import SyncWebhookIngest, {
  FIVETRAN_SIGNATURE_HEADER,
} from "Common/Server/Utils/DataObservability/SyncWebhooks";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import HostCollectorAgent, {
  HostCollectorMessageResult,
} from "Common/Server/Utils/HostCollector/HostCollectorAgent";
import logger from "Common/Server/Utils/Logger";
import {
  LARGE_REQUEST_BODY_BYTES,
  TELEMETRY_ROUTE_PREFIXES,
  readsBodyAfterAuthentication,
} from "Common/Server/Utils/RequestBodyLimit";
import { expressErrorHandler } from "Common/Server/Utils/StartServer";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import TelemetryIngestAttributionSettings from "Common/Server/Utils/Telemetry/TelemetryIngestAttributionSettings";
import TelemetryIngestionBudgetCounter, {
  TelemetryIngestionBudgetCounterDecision,
  TelemetryIngestionBudgetCounterMode,
  TelemetryIngestionBudgetCounterOutcome,
  TelemetryIngestionBudgetCounterRequest,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionBudgetCounter";
import TelemetryIngestionBudgetSettings from "Common/Server/Utils/Telemetry/TelemetryIngestionBudgetSettings";
import TelemetryIngestRefusalRecorder from "Common/Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import TelemetryIngestUnknownKeyRefusals from "Common/Server/Utils/Telemetry/TelemetryIngestUnknownKeyRefusals";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import {
  BodyServer,
  CONNECTIONS,
  Connection,
  MIB,
  READ_OR_TWO,
  SentRequest,
  sendOverHttp,
  sendWithFetch,
  startBodyServer,
} from "Common/Tests/Server/TestingUtils/RequestBodyOverHttp";
import { UNEXPLAINED_ERROR_MESSAGES } from "Common/Types/Exception/UnexplainedError";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  getEmptyTelemetryIngestionBudgetStoredSettings,
  TelemetryIngestionBudgetStoredSettings,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import crypto from "crypto";
import path from "path";
import protobuf from "protobufjs";
import { Readable } from "stream";
import zlib from "zlib";

/*
 * THE BATCHES COLLECTORS, AGENTS AND CI SEND ARE READ ONLY ONCE THEIR
 * INGEST KEY IS RIGHT (#10702), over HTTP, through StartServer's own
 * middleware - as the App mounts it - the real routers, the real key check
 * and the real ingestion budget gate, with real clients. Only the key
 * lookup, the budget's settings and counter, and what a taken batch is
 * handed to (the queue, the stores, the services behind the routes) are
 * stubbed.
 *
 * StartServer read every one of these bodies before routing, so before
 * TelemetryIngest checked the key: a client with no key had up to 50 MiB
 * read and parsed as JSON, or inflated, before it was refused 401. Each
 * client sends its key in a header or in the URL, and the check reads only
 * those, so the key is checked first now, and the body read after it, with
 * StartServer's own parsers (RequestBodyAfterAuthentication.readBody) -
 * between the key and the ingestion budget, which measures it.
 *
 * What each request cost is counted where it is spent: the bytes the server
 * read off the connection (by the time it closed it), the bytes zlib
 * inflated, the JSON parsed, and - when the key was checked - what had been
 * inflated and parsed by then.
 */

jest.setTimeout(300000);

const KEY: string = "10702000-0000-4000-8000-000000010702";
const WRONG_KEY: string = "00000000-0000-4000-8000-000000000000";

// A Fivetran webhook's ingestion key, named in its URL by its id.
const FIVETRAN_KEY_ID: string = "10702000-0000-4000-8000-0000000f1f7a";

// The most these routes take (RequestBodyLimit), as sent and once inflated.
const LIMIT: number = LARGE_REQUEST_BODY_BYTES;

// What a client sends of a body refused for its key: far more than is read.
const UNKEYED: number = 40 * MIB;

// What a client sends of a body over the limit.
const OVER: number = 64 * MIB;

const MISSING_KEY: JSONObject = {
  message:
    "Missing ingestion token. Send your OneUptime telemetry ingestion key in the x-oneuptime-token header.",
};

const INVALID_KEY: JSONObject = {
  message:
    "Invalid ingestion token. Send a valid OneUptime telemetry ingestion key in the x-oneuptime-token header.",
};

const FIVETRAN_REFUSAL: JSONObject = {
  message:
    "This delivery is not signed with the ingestion key the URL names. Set the Fivetran webhook's secret to the ingestion key whose ID is in the URL.",
};

const PROTO_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Telemetry",
  "ProtoFiles",
);

const PprofProfile: protobuf.Type = protobuf
  .loadSync(path.join(PROTO_DIR, "pprof", "profile.proto"))
  .lookupType("perftools.profiles.Profile");

const PushRequestType: protobuf.Type = protobuf
  .loadSync(path.join(PROTO_DIR, "pyroscope", "push.proto"))
  .lookupType("push.v1.PushRequest");

// One CPU sample in one function: the smallest pprof the push path keeps.
const minimalPprof: () => Buffer = (): Buffer => {
  return Buffer.from(
    PprofProfile.encode(
      PprofProfile.fromObject({
        sampleType: [{ type: 1, unit: 2 }],
        sample: [{ locationId: [1], value: [10_000_000] }],
        location: [{ id: 1, line: [{ functionId: 1 }] }],
        function: [{ id: 1, name: 3 }],
        stringTable: ["", "cpu", "nanoseconds", "main"],
        period: 1,
        periodType: { type: 1, unit: 2 },
        timeNanos: Date.now() * 1_000_000,
        durationNanos: 10_000_000_000,
      }),
    ).finish(),
  );
};

// A push.v1.PushRequest, as Grafana Alloy and the SDKs post it.
const PUSH: Buffer = Buffer.from(
  PushRequestType.encode(
    PushRequestType.create({
      series: [
        {
          labels: [
            { name: "__name__", value: "process_cpu" },
            { name: "service_name", value: "checkout" },
          ],
          samples: [
            {
              rawProfile: new Uint8Array(
                zlib.gzipSync(minimalPprof() as unknown as Uint8Array),
              ),
            },
          ],
        },
      ],
    }),
  ).finish(),
);

const RANDOM: SeededRandom = seededRandom(10702);

// Bytes drawn from the shared seeded generator: they do not compress.
const noise: (bytes: number) => Buffer = (bytes: number): Buffer => {
  const buffer: Buffer = Buffer.alloc(bytes);

  for (let offset: number = 0; offset + 4 <= bytes; offset += 4) {
    buffer.writeUInt32LE(RANDOM(4294967296), offset);
  }

  return buffer;
};

// An AgentToServer as the OpAMP supervisor posts it: its instance uid, field 1.
const AGENT_TO_SERVER: Buffer = Buffer.concat([
  Buffer.from([0x0a, 0x10]),
  noise(16),
] as unknown as Array<Uint8Array>);

const json: (value: unknown) => Buffer = (value: unknown): Buffer => {
  return Buffer.from(JSON.stringify(value));
};

const FLUENT_RECORDS: Array<JSONObject> = [
  {
    message: "order placed",
    level: "info",
    fluentd_time: "2026-11-22T10:00:00.000Z",
  },
  {
    message: "payment declined",
    level: "error",
    fluentd_time: "2026-11-22T10:00:01.000Z",
  },
];

const SYSLOG_LINES: Array<string> = [
  "<13>1 2026-11-22T10:00:00Z web-01 checkout 2419 - - order placed",
  "<11>1 2026-11-22T10:00:01Z web-01 checkout 2419 - - payment declined",
];

const COST_PAYLOAD: JSONObject = {
  clusterName: "prod-eu",
  currency: "USD",
  allocations: [
    {
      namespace: "checkout",
      windowStart: "2026-11-22T09:00:00Z",
      windowEnd: "2026-11-22T10:00:00Z",
      totalCost: 1.25,
    },
  ],
};

const CHANGE_EVENTS: JSONObject = {
  events: [{ title: "Deploy checkout 1.4.2", serviceName: "checkout" }],
};

const LINEAGE_EVENT: JSONObject = {
  eventType: "COMPLETE",
  eventTime: "2026-11-22T10:00:00.000Z",
  producer: "https://github.com/apache/airflow",
  run: { runId: "0193a5b2-10f0-7000-8000-000000010702" },
  job: { namespace: "airflow", name: "orders_daily.load" },
  inputs: [],
  outputs: [],
};

const DBT_INVOCATION: string = "0193a5b2-10f0-7000-8000-0000000d0b70";

const DBT_ARTIFACTS: JSONObject = {
  project: "analytics",
  run_results: {
    metadata: {
      invocation_id: DBT_INVOCATION,
      generated_at: "2026-11-22T10:00:00Z",
    },
    results: [
      {
        unique_id: "model.analytics.orders",
        status: "success",
        execution_time: 1.5,
      },
    ],
  },
};

const DEVICE_EXCHANGE: JSONObject = {
  hostName: "pixel-8-warehouse",
  androidApiLevel: 34,
  agentVersion: "1.2.0",
  canSendLogs: true,
  sessions: [],
};

const FIVETRAN_EVENT: JSONObject = {
  event: "sync_end",
  created: "2026-11-22T10:00:00.000Z",
  connector_type: "postgres",
  connector_id: "mystified_presiding",
  connector_name: "orders_db",
  sync_id: "e5f8d9e3-c5c1-4d6f-a5d8-0b1d3a3a3a3a",
  data: { status: "SUCCESSFUL" },
};

const AIRBYTE_EVENT: JSONObject = {
  data: {
    workspace: { id: "w-1", name: "Analytics" },
    connection: { id: "c-1", name: "Orders to warehouse" },
    jobId: 10702,
    success: true,
  },
};

const fivetranSignature: (body: Buffer) => string = (body: Buffer): string => {
  return crypto
    .createHmac("sha256", KEY)
    .update(body.toString("utf8"), "utf8")
    .digest("hex")
    .toUpperCase();
};

const FIVETRAN_BODY: Buffer = json(FIVETRAN_EVENT);

interface Send {
  // Who sends it so.
  how: string;
  headers: Record<string, string>;
  body: Buffer;
  // What the route's handler was given of it.
  taken: unknown;
}

interface IngestRoute {
  name: string;
  path: string;
  // What its clients send, each taken.
  sends: Array<Send>;
  // What it answers once it took a batch.
  takenStatus: number;
  // How a client with no key is refused, and one with a wrong key.
  noKey: {
    path: string;
    headers: Record<string, string>;
    status: number;
    json: JSONObject;
  };
  wrongKey: {
    path: string;
    headers: Record<string, string>;
    status: number;
    json: JSONObject;
  };
  // A content type its body may be: what a client with no key sends.
  contentType: string;
  // The headers a client with the right key sends, without a body type.
  keyHeaders: Record<string, string>;
  /*
   * Fivetran: the key its URL names is looked up first, and the body read
   * only to check the signature over it - the key's proof.
   */
  readsBodyToCheckKey?: boolean;
}

const gzipped: (send: Send) => Send = (send: Send): Send => {
  return {
    how: `${send.how}, gzip-encoded`,
    headers: { ...send.headers, "content-encoding": "gzip" },
    body: zlib.gzipSync(send.body),
    taken: send.taken,
  };
};

const TOKEN: Record<string, string> = { "x-oneuptime-token": KEY };
const BEARER: Record<string, string> = { authorization: `Bearer ${KEY}` };
const JSON_TYPE: Record<string, string> = {
  "content-type": "application/json",
};

// What each route handed on, by the route's name.
const taken: Map<string, Array<unknown>> = new Map();

const take: (route: string, value: unknown) => void = (
  route: string,
  value: unknown,
): void => {
  taken.set(route, [...(taken.get(route) || []), value]);
};

const takenBy: (route: string) => Array<unknown> = (
  route: string,
): Array<unknown> => {
  return taken.get(route) || [];
};

const FLUENT_SEND: Send = {
  how: "a buffer chunk as one JSON array, as Fluentd's HTTP output with json_array posts it, and Fluent Bit's http output with Format json",
  headers: { ...JSON_TYPE, ...TOKEN, "x-oneuptime-service-name": "checkout" },
  body: json(FLUENT_RECORDS),
  taken: FLUENT_RECORDS,
};

const SYSLOG_JSON: Send = {
  how: "a JSON messages array, as rsyslog's omhttp posts it with the documented template",
  headers: { ...JSON_TYPE, ...TOKEN },
  body: json({ messages: SYSLOG_LINES }),
  taken: SYSLOG_LINES,
};

const PUSH_SEND: Send = {
  how: "a push.v1 protobuf, as Grafana Alloy and pyroscope-dotnet push it",
  headers: {
    "content-type": "application/proto",
    "connect-protocol-version": "1",
    ...BEARER,
  },
  body: PUSH,
  taken: 1,
};

const ROUTES: Array<IngestRoute> = [
  {
    name: "Fluentd and Fluent Bit",
    path: "/fluentd/v1/logs",
    sends: [
      FLUENT_SEND,
      // Read as JSON once inflated: it was stored as one log of its bytes.
      gzipped(FLUENT_SEND),
      {
        how: "newline-separated lines, gzip-encoded",
        headers: {
          "content-type": "application/x-ndjson",
          "content-encoding": "gzip",
          ...TOKEN,
        },
        body: zlib.gzipSync(Buffer.from("order placed\npayment declined\n")),
        taken: [{ message: "order placed" }, { message: "payment declined" }],
      },
    ],
    takenStatus: 200,
    noKey: {
      path: "/fluentd/v1/logs",
      headers: JSON_TYPE,
      status: 401,
      json: MISSING_KEY,
    },
    wrongKey: {
      path: "/fluentd/v1/logs",
      headers: { ...JSON_TYPE, "x-oneuptime-token": WRONG_KEY },
      status: 401,
      json: INVALID_KEY,
    },
    contentType: "application/json",
    keyHeaders: TOKEN,
  },
  {
    name: "syslog",
    path: "/syslog/v1/logs",
    sends: [
      SYSLOG_JSON,
      {
        how: "a batch of lines, gzip-compressed, as rsyslog's omhttp posts it with batch.format newline and compress on",
        headers: { ...JSON_TYPE, "content-encoding": "gzip", ...TOKEN },
        body: zlib.gzipSync(Buffer.from(SYSLOG_LINES.join("\n"))),
        taken: SYSLOG_LINES,
      },
      {
        how: "a JSON array of messages, as syslog-ng's HTTP destination posts it",
        headers: { ...JSON_TYPE, ...TOKEN },
        body: json(SYSLOG_LINES),
        taken: SYSLOG_LINES,
      },
    ],
    takenStatus: 200,
    noKey: {
      path: "/syslog/v1/logs",
      headers: JSON_TYPE,
      status: 401,
      json: MISSING_KEY,
    },
    wrongKey: {
      path: "/syslog/v1/logs",
      headers: { ...JSON_TYPE, "x-oneuptime-token": WRONG_KEY },
      status: 401,
      json: INVALID_KEY,
    },
    contentType: "application/json",
    keyHeaders: TOKEN,
  },
  {
    name: "Kubernetes cost",
    path: "/telemetry/kubernetes-cost/ingest",
    sends: [
      {
        how: "allocation rows, as the Kubernetes agent's cost poller posts them",
        headers: { ...JSON_TYPE, ...TOKEN },
        body: json(COST_PAYLOAD),
        taken: COST_PAYLOAD,
      },
      gzipped({
        how: "allocation rows",
        headers: { ...JSON_TYPE, ...TOKEN },
        body: json(COST_PAYLOAD),
        taken: COST_PAYLOAD,
      }),
    ],
    takenStatus: 200,
    noKey: {
      path: "/telemetry/kubernetes-cost/ingest",
      headers: JSON_TYPE,
      status: 401,
      json: MISSING_KEY,
    },
    wrongKey: {
      path: "/telemetry/kubernetes-cost/ingest",
      headers: { ...JSON_TYPE, "x-oneuptime-token": WRONG_KEY },
      status: 401,
      json: INVALID_KEY,
    },
    contentType: "application/json",
    keyHeaders: TOKEN,
  },
  {
    name: "change events",
    path: "/change-events/v1/ingest",
    sends: [
      {
        how: "a deploy marker, as CI posts it",
        headers: { ...JSON_TYPE, ...TOKEN },
        body: json(CHANGE_EVENTS),
        taken: ["Deploy checkout 1.4.2"],
      },
      gzipped({
        how: "a deploy marker",
        headers: { ...JSON_TYPE, ...TOKEN },
        body: json(CHANGE_EVENTS),
        taken: ["Deploy checkout 1.4.2"],
      }),
    ],
    takenStatus: 200,
    noKey: {
      path: "/change-events/v1/ingest",
      headers: JSON_TYPE,
      status: 401,
      json: MISSING_KEY,
    },
    wrongKey: {
      path: "/change-events/v1/ingest",
      headers: { ...JSON_TYPE, "x-oneuptime-token": WRONG_KEY },
      status: 401,
      json: INVALID_KEY,
    },
    contentType: "application/json",
    keyHeaders: TOKEN,
  },
  {
    name: "OpenLineage",
    path: "/telemetry/openlineage/api/v1/lineage",
    sends: [
      {
        how: "a run event, as an OpenLineage client posts it with an api_key (Bearer)",
        headers: { ...JSON_TYPE, ...BEARER },
        body: json(LINEAGE_EVENT),
        taken: ["orders_daily.load"],
      },
      // An OpenLineage transport's compression: gzip; it was answered 400.
      gzipped({
        how: "a run event, with Bearer",
        headers: { ...JSON_TYPE, ...BEARER },
        body: json(LINEAGE_EVENT),
        taken: ["orders_daily.load"],
      }),
    ],
    takenStatus: 200,
    noKey: {
      path: "/telemetry/openlineage/api/v1/lineage",
      headers: JSON_TYPE,
      status: 401,
      json: MISSING_KEY,
    },
    wrongKey: {
      path: "/telemetry/openlineage/api/v1/lineage",
      headers: { ...JSON_TYPE, authorization: `Bearer ${WRONG_KEY}` },
      status: 401,
      json: INVALID_KEY,
    },
    contentType: "application/json",
    keyHeaders: BEARER,
  },
  {
    name: "dbt",
    path: "/telemetry/dbt/v1/artifacts",
    sends: [
      {
        how: "a build's run results, as the OneUptime CLI's dbt upload posts them",
        headers: { ...JSON_TYPE, accept: "application/json", ...TOKEN },
        body: json(DBT_ARTIFACTS),
        taken: [DBT_INVOCATION],
      },
      {
        how: "the same from CI, with Bearer",
        headers: { ...JSON_TYPE, ...BEARER },
        body: json(DBT_ARTIFACTS),
        taken: [DBT_INVOCATION],
      },
      gzipped({
        how: "a build's run results",
        headers: { ...JSON_TYPE, ...TOKEN },
        body: json(DBT_ARTIFACTS),
        taken: [DBT_INVOCATION],
      }),
    ],
    takenStatus: 200,
    noKey: {
      path: "/telemetry/dbt/v1/artifacts",
      headers: JSON_TYPE,
      status: 401,
      json: MISSING_KEY,
    },
    wrongKey: {
      path: "/telemetry/dbt/v1/artifacts",
      headers: { ...JSON_TYPE, "x-oneuptime-token": WRONG_KEY },
      status: 401,
      json: INVALID_KEY,
    },
    contentType: "application/json",
    keyHeaders: TOKEN,
  },
  {
    name: "the Android agent's log sessions",
    path: "/telemetry/android-agent/v1/log-sessions",
    sends: [
      {
        how: "a device's exchange, as the Android agent posts it",
        headers: {
          ...JSON_TYPE,
          accept: "application/json",
          "user-agent": "OneUptime-Android-Agent/1.2.0",
          ...TOKEN,
        },
        body: json(DEVICE_EXCHANGE),
        taken: ["pixel-8-warehouse"],
      },
    ],
    takenStatus: 200,
    noKey: {
      path: "/telemetry/android-agent/v1/log-sessions",
      headers: JSON_TYPE,
      status: 401,
      json: MISSING_KEY,
    },
    wrongKey: {
      path: "/telemetry/android-agent/v1/log-sessions",
      headers: { ...JSON_TYPE, "x-oneuptime-token": WRONG_KEY },
      status: 401,
      json: INVALID_KEY,
    },
    contentType: "application/json",
    keyHeaders: TOKEN,
  },
  {
    name: "OpAMP",
    path: "/telemetry/opamp/v1",
    sends: [
      {
        how: "an AgentToServer, as the host collector's OpAMP supervisor posts it",
        headers: { "content-type": "application/x-protobuf", ...TOKEN },
        body: AGENT_TO_SERVER,
        taken: AGENT_TO_SERVER.toString("hex"),
      },
      gzipped({
        how: "an AgentToServer",
        headers: { "content-type": "application/x-protobuf", ...TOKEN },
        body: AGENT_TO_SERVER,
        taken: AGENT_TO_SERVER.toString("hex"),
      }),
    ],
    takenStatus: 200,
    noKey: {
      path: "/telemetry/opamp/v1",
      headers: { "content-type": "application/x-protobuf" },
      status: 401,
      json: MISSING_KEY,
    },
    wrongKey: {
      path: "/telemetry/opamp/v1",
      headers: {
        "content-type": "application/x-protobuf",
        "x-oneuptime-token": WRONG_KEY,
      },
      status: 401,
      json: INVALID_KEY,
    },
    contentType: "application/x-protobuf",
    keyHeaders: TOKEN,
  },
  {
    name: "Pyroscope's push",
    path: "/pyroscope/push.v1.PusherService/Push",
    sends: [
      PUSH_SEND,
      {
        how: "a push.v1 protobuf gzip-encoded, as current pyroscope-rs SDKs push it, with Basic",
        headers: {
          "content-type": "application/proto",
          "content-encoding": "gzip",
          authorization: `Basic ${Buffer.from(`oneuptime:${KEY}`).toString("base64")}`,
        },
        body: zlib.gzipSync(PUSH),
        taken: 1,
      },
      {
        how: "a push.v1 protobuf as application/x-protobuf",
        headers: { "content-type": "application/x-protobuf", ...BEARER },
        body: PUSH,
        taken: 1,
      },
    ],
    takenStatus: 200,
    noKey: {
      path: "/pyroscope/push.v1.PusherService/Push",
      headers: { "content-type": "application/proto" },
      status: 401,
      json: MISSING_KEY,
    },
    wrongKey: {
      path: "/pyroscope/push.v1.PusherService/Push",
      headers: {
        "content-type": "application/proto",
        authorization: `Bearer ${WRONG_KEY}`,
      },
      status: 401,
      json: INVALID_KEY,
    },
    contentType: "application/proto",
    keyHeaders: BEARER,
  },
  {
    name: "Fivetran",
    path: `/telemetry/fivetran/v1/webhook/${FIVETRAN_KEY_ID}`,
    sends: [
      {
        how: "a sync's webhook delivery, signed with the ingestion key its URL names, as Fivetran posts it",
        headers: {
          ...JSON_TYPE,
          [FIVETRAN_SIGNATURE_HEADER]: fivetranSignature(FIVETRAN_BODY),
        },
        body: FIVETRAN_BODY,
        taken: FIVETRAN_EVENT,
      },
    ],
    takenStatus: 200,
    // Its URL names no key: refused alike, unread.
    noKey: {
      path: `/telemetry/fivetran/v1/webhook/${ObjectID.generate().toString()}`,
      headers: { ...JSON_TYPE, [FIVETRAN_SIGNATURE_HEADER]: "0".repeat(64) },
      status: 403,
      json: FIVETRAN_REFUSAL,
    },
    // A delivery that carries no signature: refused alike, unread.
    wrongKey: {
      path: `/telemetry/fivetran/v1/webhook/${FIVETRAN_KEY_ID}`,
      headers: JSON_TYPE,
      status: 403,
      json: FIVETRAN_REFUSAL,
    },
    contentType: "application/json",
    keyHeaders: { [FIVETRAN_SIGNATURE_HEADER]: "0".repeat(64) },
    readsBodyToCheckKey: true,
  },
  {
    name: "Airbyte",
    path: `/telemetry/airbyte/v1/webhook/${KEY}`,
    sends: [
      {
        how: "a sync's webhook notification, to the URL that carries the key, as Airbyte posts it",
        headers: JSON_TYPE,
        body: json(AIRBYTE_EVENT),
        taken: AIRBYTE_EVENT,
      },
      gzipped({
        how: "a sync's webhook notification",
        headers: JSON_TYPE,
        body: json(AIRBYTE_EVENT),
        taken: AIRBYTE_EVENT,
      }),
    ],
    takenStatus: 200,
    // The key is in the URL: a URL with a key no key has.
    noKey: {
      path: `/telemetry/airbyte/v1/webhook/${WRONG_KEY}`,
      headers: JSON_TYPE,
      status: 401,
      json: INVALID_KEY,
    },
    wrongKey: {
      path: `/airbyte/v1/webhook/${WRONG_KEY}`,
      headers: JSON_TYPE,
      status: 401,
      json: INVALID_KEY,
    },
    contentType: "application/json",
    keyHeaders: {},
  },
];

const routeNamed: (name: string) => IngestRoute = (
  name: string,
): IngestRoute => {
  return ROUTES.find((route: IngestRoute): boolean => {
    return route.name === name;
  })!;
};

/*
 * 40 MiB of the route's own kind, a client with no key sends: JSON with one
 * long string - what StartServer parsed whole before routing, under any
 * route's 1,000,000 values - or protobuf's bytes.
 */
let unkeyedJson: Buffer;
let unkeyedJsonGzip: Buffer;
let unkeyedProtobuf: Buffer;

// 64 MiB of noise gzipped: over the limit as it is sent, not only inflated.
let incompressibleOver: Buffer;

const unkeyedBodyOf: (route: IngestRoute, gzip: boolean) => Buffer = (
  route: IngestRoute,
  gzip: boolean,
): Buffer => {
  if (route.contentType === "application/json") {
    return gzip ? unkeyedJsonGzip : unkeyedJson;
  }

  return gzip ? zlib.gzipSync(Buffer.alloc(UNKEYED, 0x61)) : unkeyedProtobuf;
};

/*
 * What zlib inflated, counted where its streams hand their output on (its
 * own functions are read-only), and what had been inflated and parsed when
 * each key was checked.
 */
const watched: { inflated: number } = { inflated: 0 };
const atKeyCheck: Array<{ inflated: number; parsed: number }> = [];

const readablePush: Readable["push"] = Readable.prototype.push;

const ZLIB_STREAMS: Array<{ push: Readable["push"] }> = [
  (zlib as unknown as { Gunzip: { prototype: { push: Readable["push"] } } })
    .Gunzip.prototype,
  (zlib as unknown as { Inflate: { prototype: { push: Readable["push"] } } })
    .Inflate.prototype,
];

let watchers: Array<ReturnType<typeof jest.spyOn>> = [];
let jsonParse: ReturnType<typeof jest.spyOn>;

// The longest text JSON.parse was handed since the test began.
const longestJsonParsed: () => number = (): number => {
  return (jsonParse.mock.calls as Array<Array<unknown>>).reduce(
    (longest: number, call: Array<unknown>): number => {
      return typeof call[0] === "string"
        ? Math.max(longest, call[0].length)
        : longest;
    },
    0,
  );
};

const policy: TelemetryIngestionKeyPolicy = {
  ingestionKeyId: ObjectID.generate(),
  projectId: ObjectID.generate(),
  keyType: TelemetryIngestionKeyType.Server,
  allowedOrigins: [],
  pinnedServiceName: null,
  isEnabled: true,
  expiresAt: null,
  requestsPerMinuteLimit: null,
  ingestionBudgets: null,
};

// The budget's counter: every decision it was asked for, and its answer.
const counted: Array<TelemetryIngestionBudgetCounterRequest> = [];
let counterAnswer: TelemetryIngestionBudgetCounterOutcome =
  TelemetryIngestionBudgetCounterOutcome.Admitted;
let budgetInForce: boolean = false;

const budgetOf: (gb: number) => TelemetryIngestionBudgetStoredSettings = (
  gb: number,
): TelemetryIngestionBudgetStoredSettings => {
  const settings: TelemetryIngestionBudgetStoredSettings =
    getEmptyTelemetryIngestionBudgetStoredSettings();

  for (const signal of [ProductType.Logs, ProductType.Profiles]) {
    settings[signal] = { dailyBudgetInGB: gb, rateLimitInMBPerSecond: null };
  }

  return settings;
};

let server: BodyServer;

beforeAll(async () => {
  for (const level of ["error", "warn", "info", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined;
    });
  }

  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
  jest
    .spyOn(TelemetryIngestionKeyService, "getPolicyFromSecretKey")
    .mockImplementation(
      async (
        secretKey: string,
      ): Promise<TelemetryIngestionKeyPolicy | null> => {
        atKeyCheck.push({
          inflated: watched.inflated,
          parsed: longestJsonParsed(),
        });

        return secretKey === KEY ? policy : null;
      },
    );
  jest
    .spyOn(TelemetryIngestionKeyService, "markUsed")
    .mockResolvedValue(undefined);
  // Fivetran's URL names its key by its id; the webhook's secret is the key.
  jest
    .spyOn(TelemetryIngestionKeyService, "findOneById")
    .mockImplementation((async (data: { id: ObjectID }) => {
      if (data.id.toString() !== FIVETRAN_KEY_ID) {
        return null;
      }

      const key: TelemetryIngestionKey = new TelemetryIngestionKey();
      key.secretKey = new ObjectID(KEY);
      return key;
    }) as never);
  jest
    .spyOn(TelemetryIngestRefusalRecorder, "record")
    .mockImplementation((): void => {});

  // The ingestion budget: none in force unless a test sets one.
  jest
    .spyOn(TelemetryIngestionBudgetSettings, "getInstanceSettings")
    .mockImplementation(async () => {
      return {
        budgets: budgetInForce
          ? budgetOf(1)
          : getEmptyTelemetryIngestionBudgetStoredSettings(),
        warningPercent: 80,
        resetTime: "00:00",
        timezone: "UTC",
      };
    });
  jest
    .spyOn(TelemetryIngestionBudgetSettings, "getProjectOverrides")
    .mockResolvedValue(null);
  jest
    .spyOn(TelemetryIngestionBudgetCounter, "consume")
    .mockImplementation(
      async (
        request: TelemetryIngestionBudgetCounterRequest,
      ): Promise<TelemetryIngestionBudgetCounterDecision> => {
        counted.push(request);

        return counterAnswer ===
          TelemetryIngestionBudgetCounterOutcome.Admitted ||
          request.mode === TelemetryIngestionBudgetCounterMode.Charge
          ? { outcome: TelemetryIngestionBudgetCounterOutcome.Admitted }
          : { outcome: counterAnswer, scopeIndex: 0, isFirstExhaustion: false };
      },
    );
  jest
    .spyOn(TelemetryIngestAttributionSettings, "isAttributedProject")
    .mockResolvedValue(false);
  jest
    .spyOn(TelemetryIngestAttributionSettings, "getTeamLabelBudgetProjects")
    .mockResolvedValue(new Set<string>());

  // What a taken batch is handed to.
  jest
    .spyOn(FluentLogsQueueService, "addFluentLogIngestJob")
    .mockImplementation(async (req: TelemetryRequest): Promise<void> => {
      take("Fluentd and Fluent Bit", (req.body as JSONObject)["entries"]);
    });
  jest
    .spyOn(SyslogQueueService, "addSyslogIngestJob")
    .mockImplementation(async (req: TelemetryRequest): Promise<void> => {
      take("syslog", (req.body as JSONObject)["messages"]);
    });
  jest
    .spyOn(TelemetryQueueService, "addKubernetesCostIngestJob")
    .mockImplementation(
      async (data: { costPayload: JSONObject }): Promise<void> => {
        take("Kubernetes cost", data.costPayload);
      },
    );
  jest
    .spyOn(OTelIngestService, "telemetryServiceFromName")
    .mockImplementation(
      async (data: {
        serviceName: string;
      }): Promise<TelemetryServiceMetadata> => {
        return {
          serviceName: data.serviceName,
          primaryEntityId: ObjectID.generate(),
          primaryEntityType: ServiceType.OpenTelemetry,
        } as TelemetryServiceMetadata;
      },
    );
  jest.spyOn(TelemetryFanInWriter, "submit").mockImplementation((async (
    _service: unknown,
    rows: Array<JSONObject>,
  ) => {
    take(
      "change events",
      rows.map((row: JSONObject): unknown => {
        return row["title"];
      }),
    );
    return { flushed: Promise.resolve() };
  }) as never);
  jest
    .spyOn(OpenLineageIngest, "ingest")
    .mockImplementation(
      async (data: { events: Array<OpenLineageRunEvent> }): Promise<number> => {
        take(
          "OpenLineage",
          data.events.map((event: OpenLineageRunEvent): string => {
            return event.jobName;
          }),
        );
        return data.events.length;
      },
    );
  jest
    .spyOn(DbtIngest, "ingest")
    .mockImplementation(
      async (data: {
        runResults: DbtRunResults | null;
      }): Promise<DbtIngestSummary> => {
        take("dbt", [data.runResults?.invocationId]);
        return {
          projectName: "analytics",
          tables: 0,
          matchedTables: 0,
          tests: 0,
          matchedTests: 0,
          testResults: 0,
          run: "COMPLETE",
        };
      },
    );
  jest
    .spyOn(HostLogSessionService, "exchangeWithDevice")
    .mockImplementation((async (data: {
      request: { hostName: string };
    }): Promise<JSONObject> => {
      take("the Android agent's log sessions", [data.request.hostName]);
      return { sessions: [] };
    }) as never);
  jest
    .spyOn(HostCollectorAgent, "handleMessage")
    .mockImplementation(
      async (data: {
        body: Uint8Array;
      }): Promise<HostCollectorMessageResult> => {
        take("OpAMP", Buffer.from(data.body).toString("hex"));
        return { body: new Uint8Array([0x0a, 0x00]), isBadRequest: false };
      },
    );
  jest
    .spyOn(TelemetryBodyStore, "storeBody")
    .mockImplementation(async (): Promise<string> => {
      return `telemetry:body:${ObjectID.generate().toString()}`;
    });
  jest
    .spyOn(Queue, "addJob")
    .mockImplementation(
      async (): Promise<Awaited<ReturnType<typeof Queue.addJob>>> => {
        take("Pyroscope's push", 1);
        return {} as Awaited<ReturnType<typeof Queue.addJob>>;
      },
    );
  jest
    .spyOn(SyncWebhookIngest, "ingestFivetran")
    .mockImplementation(async (data: { body: unknown }): Promise<number> => {
      take("Fivetran", data.body);
      return 1;
    });
  jest
    .spyOn(SyncWebhookIngest, "ingestAirbyte")
    .mockImplementation(async (data: { body: unknown }): Promise<number> => {
      take("Airbyte", data.body);
      return 1;
    });

  unkeyedJson = json({
    messages: [
      noise(UNKEYED / 2)
        .toString("hex")
        .slice(0, UNKEYED - 64),
    ],
  });
  unkeyedJsonGzip = zlib.gzipSync(
    json({ messages: ["a".repeat(UNKEYED - 64)] }),
  );
  unkeyedProtobuf = noise(UNKEYED);
  incompressibleOver = zlib.gzipSync(noise(OVER), { level: 1 });

  // The App's own express app: importing StartServer mounted its middleware.
  const app: ExpressApplication = Express.getExpressApp();

  for (const router of [
    FluentAPI,
    SyslogAPI,
    KubernetesCostIngestAPI,
    ChangeEventsIngestAPI,
    OpenLineageIngestAPI,
    DbtArtifactsIngestAPI,
    AndroidAgentLogSessionsAPI,
    HostCollectorOpAmpAPI,
    PyroscopeAPI,
    SyncWebhooksIngestAPI,
  ]) {
    app.use(["/telemetry", "/"], router);
  }

  app.use(expressErrorHandler);

  server = await startBodyServer(app);
});

afterAll(async () => {
  await server.close();
  jest.restoreAllMocks();
});

beforeEach(() => {
  for (const level of ["error", "warn", "info", "debug"] as const) {
    (logger[level] as unknown as jest.Mock).mockClear();
  }

  taken.clear();
  atKeyCheck.length = 0;
  counted.length = 0;
  counterAnswer = TelemetryIngestionBudgetCounterOutcome.Admitted;
  budgetInForce = false;
  watched.inflated = 0;
  TelemetryIngestUnknownKeyRefusals.clear();

  watchers = ZLIB_STREAMS.map(
    (prototype: { push: Readable["push"] }): ReturnType<typeof jest.spyOn> => {
      return jest.spyOn(prototype, "push").mockImplementation(function (
        this: Readable,
        chunk: unknown,
        encoding?: Parameters<Readable["push"]>[1],
      ): boolean {
        if (Buffer.isBuffer(chunk)) {
          watched.inflated += chunk.length;
        }

        return readablePush.call(this, chunk, encoding);
      });
    },
  );
  jsonParse = jest.spyOn(JSON, "parse");
});

afterEach(() => {
  for (const watcher of watchers) {
    watcher.mockRestore();
  }

  watchers = [];
  jsonParse.mockRestore();
});

// Nothing of a refused batch was taken by any route.
const expectNothingTaken: () => void = (): void => {
  expect(Array.from(taken.entries())).toEqual([]);
};

describe("the routes", () => {
  test("are read after their key, under both telemetry prefixes: StartServer leaves their bodies unread", () => {
    for (const route of ROUTES) {
      const routePath: string = route.path.replace(/^\/telemetry/, "");

      for (const prefix of TELEMETRY_ROUTE_PREFIXES) {
        expect({
          path: `${prefix}${routePath}`,
          afterKey: readsBodyAfterAuthentication(`${prefix}${routePath}`),
        }).toEqual({ path: `${prefix}${routePath}`, afterKey: true });
      }
    }
  });
});

describe.each(ROUTES)("$name", (route: IngestRoute) => {
  test.each(
    route.sends.map((send: Send): [string, Send] => {
      return [send.how, send];
    }),
  )(
    "with the right key, %s is taken, declared and chunked, on kept and closed connections",
    async (_how: string, send: Send) => {
      for (const connection of CONNECTIONS) {
        for (const chunked of [false, true]) {
          const sent: SentRequest = await sendOverHttp(server, {
            path: route.path,
            headers: send.headers,
            connection: connection,
            chunked: chunked,
            body: send.body,
          });

          expect({
            status: sent.answer.status,
            text: sent.answer.text,
          }).toEqual({
            status: route.takenStatus,
            text: expect.any(String),
          });
          expect(sent.answer.clientError).toBeNull();
        }
      }

      // Four times, each as it was sent: on two connections, declared and chunked.
      expect(takenBy(route.name)).toEqual([
        send.taken,
        send.taken,
        send.taken,
        send.taken,
      ]);
      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  if (!route.readsBodyToCheckKey) {
    test("the key is checked from the headers or the URL before a byte of the body is inflated or parsed", async () => {
      const send: Send = route.sends[0]!;
      const sent: SentRequest = await sendOverHttp(server, {
        path: route.path,
        headers: { ...send.headers, "content-encoding": "gzip" },
        body: zlib.gzipSync(send.body),
      });

      expect(sent.answer.status).toBe(route.takenStatus);
      /*
       * Once, with nothing inflated or parsed yet; then the batch, whole -
       * and, for Pyroscope's push, each sample's profile, which its handler
       * inflates.
       */
      expect(atKeyCheck).toEqual([{ inflated: 0, parsed: 0 }]);
      expect(watched.inflated).toBeGreaterThanOrEqual(send.body.length);
    });
  }

  test.each([...CONNECTIONS])(
    "with no key, 40 MiB are refused, declared or chunked, with a socket read or two read: nothing inflated or parsed (%s)",
    async (connection: Connection) => {
      for (const chunked of [false, true]) {
        const sent: SentRequest = await sendOverHttp(server, {
          path: route.noKey.path,
          headers: route.noKey.headers,
          connection: connection,
          chunked: chunked,
          body: unkeyedBodyOf(route, false),
        });

        expect({ status: sent.answer.status, json: sent.answer.json }).toEqual({
          status: route.noKey.status,
          json: route.noKey.json,
        });
        expect(sent.answer.clientError).toBeNull();
        // Closed under the rest, which is never read.
        expect(sent.answer.connection).toBe("close");
        expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(
          READ_OR_TWO,
        );
      }

      expect(watched.inflated).toBe(0);
      expect(longestJsonParsed()).toBeLessThan(READ_OR_TWO);
      expectNothingTaken();
    },
  );

  test.each([...CONNECTIONS])(
    "with a wrong key, 40 MiB are refused the same way, unread (%s)",
    async (connection: Connection) => {
      const sent: SentRequest = await sendOverHttp(server, {
        path: route.wrongKey.path,
        headers: route.wrongKey.headers,
        connection: connection,
        body: unkeyedBodyOf(route, false),
      });

      expect({ status: sent.answer.status, json: sent.answer.json }).toEqual({
        status: route.wrongKey.status,
        json: route.wrongKey.json,
      });
      expect(sent.answer.connection).toBe("close");
      expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(READ_OR_TWO);
      expect(watched.inflated).toBe(0);
      expect(longestJsonParsed()).toBeLessThan(READ_OR_TWO);
      expectNothingTaken();
    },
  );

  test("with no key, a gzip batch is refused with nothing of it inflated", async () => {
    const sent: SentRequest = await sendOverHttp(server, {
      path: route.noKey.path,
      headers: { ...route.noKey.headers, "content-encoding": "gzip" },
      body: unkeyedBodyOf(route, true),
    });

    expect(sent.answer.status).toBe(route.noKey.status);
    // StartServer inflated all 40 MiB of it before routing, for anyone.
    expect(watched.inflated).toBe(0);
    expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(READ_OR_TWO);
    expectNothingTaken();
  });

  test("with no key, sent with fetch: the refusal is read, the rest unread", async () => {
    const sent: SentRequest = await sendWithFetch(server, {
      path: route.noKey.path,
      headers: route.noKey.headers,
      bytes: UNKEYED,
    });

    expect(sent.answer.clientError).toBeNull();
    expect(sent.answer.status).toBe(route.noKey.status);
    expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(READ_OR_TWO);
  });

  test("with the right key, over 50 MB uncompressed: refused 413 before a byte is read when declared, at the limit when chunked", async () => {
    const headers: Record<string, string> = {
      ...route.sends[0]!.headers,
      "content-type": route.contentType,
    };

    const declared: SentRequest = await sendOverHttp(server, {
      path: route.path,
      headers: headers,
      bytes: OVER,
      fill: 0x20,
    });

    expect({
      status: declared.answer.status,
      json: declared.answer.json,
    }).toEqual({
      status: 413,
      json: { error: UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime },
    });
    expect(declared.answer.connection).toBe("close");
    expect(await server.readInAll(declared.tag)).toBeLessThanOrEqual(
      READ_OR_TWO,
    );

    const chunked: SentRequest = await sendOverHttp(server, {
      path: route.path,
      headers: headers,
      chunked: true,
      bytes: OVER,
      fill: 0x20,
    });

    expect(chunked.answer.status).toBe(413);
    expect(chunked.answer.connection).toBe("close");

    const read: number = await server.readInAll(chunked.tag);

    expect(read).toBeGreaterThan(LIMIT);
    expect(read).toBeLessThanOrEqual(LIMIT + READ_OR_TWO);
    expectNothingTaken();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("with the right key, a gzip batch over 50 MB is refused 413 in the same words, as it inflates", async () => {
    // 64 MiB of one byte in about 64 KiB: refused once 50 MB have inflated.
    const bomb: SentRequest = await sendOverHttp(server, {
      path: route.path,
      headers: {
        ...route.sends[0]!.headers,
        "content-type": route.contentType,
        "content-encoding": "gzip",
      },
      chunked: true,
      body: zlib.gzipSync(Buffer.alloc(OVER, 0x61)),
    });

    expect({ status: bomb.answer.status, json: bomb.answer.json }).toEqual({
      status: 413,
      json: { error: UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime },
    });
    expect(bomb.answer.connection).toBe("close");
    expect(await server.readInAll(bomb.tag)).toBeLessThanOrEqual(READ_OR_TWO);
    expect(watched.inflated).toBeGreaterThan(LIMIT);
    expect(watched.inflated).toBeLessThanOrEqual(LIMIT + MIB);
    expectNothingTaken();
  });
});

/*
 * Noise sent gzipped as JSON is refused as it inflates for its JSON values
 * first (1,000,000), in those words: aimed at the batches of bytes, it is
 * refused for its size.
 */
describe("over the limit as it is sent, gzip-compressed", () => {
  test.each(["/telemetry/opamp/v1", "/pyroscope/push.v1.PusherService/Push"])(
    "%s: 64 MiB that do not compress are refused 413, declared unread, chunked at the limit",
    async (routePath: string) => {
      const route: IngestRoute = ROUTES.find(
        (candidate: IngestRoute): boolean => {
          return candidate.path === routePath;
        },
      )!;
      const headers: Record<string, string> = {
        ...route.sends[0]!.headers,
        "content-encoding": "gzip",
      };

      const declared: SentRequest = await sendOverHttp(server, {
        path: route.path,
        headers: headers,
        body: incompressibleOver,
      });

      expect(declared.answer.status).toBe(413);
      expect(await server.readInAll(declared.tag)).toBeLessThanOrEqual(
        READ_OR_TWO,
      );

      const chunked: SentRequest = await sendOverHttp(server, {
        path: route.path,
        headers: headers,
        chunked: true,
        body: incompressibleOver,
      });

      expect({
        status: chunked.answer.status,
        json: chunked.answer.json,
      }).toEqual({
        status: 413,
        json: { error: UNEXPLAINED_ERROR_MESSAGES.tooLargeForOneUptime },
      });

      const read: number = await server.readInAll(chunked.tag);

      expect(read).toBeGreaterThan(LIMIT);
      expect(read).toBeLessThanOrEqual(LIMIT + READ_OR_TWO);
      expectNothingTaken();
    },
  );
});

describe("a key sent in the body alone was never a key", () => {
  test.each([
    "/fluentd/v1/logs",
    "/syslog/v1/logs",
    "/telemetry/dbt/v1/artifacts",
  ])(
    "%s: refused 401 as one with none, now unread",
    async (routePath: string) => {
      /*
       * No client sends its key only in the body: each sends it in a header
       * or the URL (RequestBodyLimit's TELEMETRY_KEYED_INGEST_PATHS says
       * which), and the check reads only those, so a key in the body was
       * refused before as well - once all of the body had been read and
       * parsed.
       */
      const body: Buffer = json({
        "x-oneuptime-token": KEY,
        ingestionKey: KEY,
        messages: ["a".repeat(UNKEYED)],
      });

      const sent: SentRequest = await sendOverHttp(server, {
        path: routePath,
        headers: JSON_TYPE,
        body: body,
      });

      expect({ status: sent.answer.status, json: sent.answer.json }).toEqual({
        status: 401,
        json: MISSING_KEY,
      });
      expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(READ_OR_TWO);
      expect(longestJsonParsed()).toBeLessThan(READ_OR_TWO);
      expectNothingTaken();
    },
  );
});

describe("Fivetran, whose key proves itself by the body's signature", () => {
  test("a delivery signed with another secret is read, to check it, and refused alike", async () => {
    const sent: SentRequest = await sendOverHttp(server, {
      path: `/fivetran/v1/webhook/${FIVETRAN_KEY_ID}`,
      headers: {
        ...JSON_TYPE,
        [FIVETRAN_SIGNATURE_HEADER]: crypto
          .createHmac("sha256", "not the key")
          .update(FIVETRAN_BODY)
          .digest("hex"),
      },
      body: FIVETRAN_BODY,
    });

    expect({ status: sent.answer.status, json: sent.answer.json }).toEqual({
      status: 403,
      json: FIVETRAN_REFUSAL,
    });
    expectNothingTaken();
  });

  test("an unknown key and a missing signature are refused in the same words as a wrong signature, so the URL tells nothing", async () => {
    const answers: Array<unknown> = [];

    for (const request of [
      {
        path: `/fivetran/v1/webhook/${ObjectID.generate().toString()}`,
        signed: true,
      },
      { path: `/fivetran/v1/webhook/not-a-key-id`, signed: true },
      { path: `/fivetran/v1/webhook/${FIVETRAN_KEY_ID}`, signed: false },
    ]) {
      const sent: SentRequest = await sendOverHttp(server, {
        path: request.path,
        headers: {
          ...JSON_TYPE,
          ...(request.signed
            ? { [FIVETRAN_SIGNATURE_HEADER]: fivetranSignature(FIVETRAN_BODY) }
            : {}),
        },
        body: FIVETRAN_BODY,
      });

      answers.push({ status: sent.answer.status, json: sent.answer.json });
    }

    expect(answers).toEqual([
      { status: 403, json: FIVETRAN_REFUSAL },
      { status: 403, json: FIVETRAN_REFUSAL },
      { status: 403, json: FIVETRAN_REFUSAL },
    ]);
    expectNothingTaken();
  });
});

/*
 * THE INGESTION BUDGET, WHICH MEASURES THE BODY IN REFUSE MODE (#10685's
 * counts, kept). Fluent's and syslog's budget is decided in the key check,
 * on the body as it arrived - exactly what is admitted, and exactly what is
 * refused - so the body is read there, between the key and the budget. A
 * request without the right key reaches no budget at all.
 */
describe("the ingestion budget, once the key is right", () => {
  beforeEach(() => {
    budgetInForce = true;
  });

  test.each([
    ["Fluent's JSON", "/fluentd/v1/logs", FLUENT_SEND],
    ["Fluent's JSON, gzip-encoded", "/fluentd/v1/logs", gzipped(FLUENT_SEND)],
    ["syslog's JSON", "/syslog/v1/logs", SYSLOG_JSON],
    [
      "syslog's lines, gzip-compressed",
      "/syslog/v1/logs",
      {
        ...SYSLOG_JSON,
        headers: { ...SYSLOG_JSON.headers, "content-encoding": "gzip" },
        body: zlib.gzipSync(Buffer.from(SYSLOG_LINES.join("\n"))),
      },
    ],
  ])(
    "%s is counted in Refuse mode at its exact size, as it arrived and once inflated",
    async (_what: string, routePath: string, send: Send) => {
      const sent: SentRequest = await sendOverHttp(server, {
        path: routePath,
        headers: send.headers,
        body: send.body,
      });

      expect(sent.answer.status).toBe(200);

      const inflated: number = send.headers["content-encoding"]
        ? zlib.gunzipSync(send.body).length
        : send.body.length;

      expect(
        counted.map((request: TelemetryIngestionBudgetCounterRequest) => {
          return { mode: request.mode, bytes: request.bytes };
        }),
      ).toEqual([
        { mode: TelemetryIngestionBudgetCounterMode.Refuse, bytes: inflated },
      ]);
      expect(counted[0]!.signalSlug).toBe("logs");
    },
  );

  test("a used-up budget refuses the batch 403, counting exactly what it refused, and nothing is taken", async () => {
    counterAnswer = TelemetryIngestionBudgetCounterOutcome.DailyBudgetExhausted;

    const sent: SentRequest = await sendOverHttp(server, {
      path: "/fluentd/v1/logs",
      headers: FLUENT_SEND.headers,
      body: FLUENT_SEND.body,
    });

    expect(sent.answer.status).toBe(403);
    expect(sent.answer.json).toMatchObject({
      error: "daily-budget-exhausted",
      message: expect.stringContaining(
        "This project's daily logs ingestion budget of 1 GB is used up",
      ),
    });
    // The bytes the counter adds to the day's dropped: the batch's own.
    expect(
      counted.map((request: TelemetryIngestionBudgetCounterRequest) => {
        return { mode: request.mode, bytes: request.bytes };
      }),
    ).toEqual([
      {
        mode: TelemetryIngestionBudgetCounterMode.Refuse,
        bytes: FLUENT_SEND.body.length,
      },
    ]);
    expectNothingTaken();
  });

  test("with no key or a wrong one, no budget is asked: nothing is counted", async () => {
    for (const headers of [
      JSON_TYPE,
      { ...JSON_TYPE, "x-oneuptime-token": WRONG_KEY },
    ]) {
      for (const routePath of ["/fluentd/v1/logs", "/syslog/v1/logs"]) {
        const sent: SentRequest = await sendOverHttp(server, {
          path: routePath,
          headers: headers,
          body: unkeyedJson,
        });

        expect(sent.answer.status).toBe(401);
      }
    }

    expect(counted).toEqual([]);
  });

  test("Pyroscope's push is checked at the key, and counted at its size when it is queued", async () => {
    const sent: SentRequest = await sendOverHttp(server, {
      path: "/pyroscope/push.v1.PusherService/Push",
      headers: PUSH_SEND.headers,
      body: PUSH_SEND.body,
    });

    expect(sent.answer.status).toBe(200);
    expect(
      counted.map((request: TelemetryIngestionBudgetCounterRequest) => {
        return request.mode;
      }),
    ).toEqual([
      TelemetryIngestionBudgetCounterMode.Check,
      TelemetryIngestionBudgetCounterMode.Charge,
    ]);
    expect(counted[0]!.bytes).toBe(0);
    expect(counted[1]!.bytes).toBeGreaterThan(0);
    expect(counted[0]!.signalSlug).toBe("profiles");
  });
});

/*
 * #10703: a request with no key, or a key no key has, comes from anyone, and
 * each was an error-level line - at the default LOG_LEVEL=ERROR, one line in
 * the sink and an error alert a request, at no cost to the client.
 */
describe("refused keys are logged at debug, and counted", () => {
  test("a burst of 40 requests with no key and 40 with a wrong one writes no error line, one warn line, and a debug line each", async () => {
    const fluent: IngestRoute = routeNamed("Fluentd and Fluent Bit");
    const syslog: IngestRoute = routeNamed("syslog");
    const push: IngestRoute = routeNamed("Pyroscope's push");

    for (let index: number = 0; index < 20; index++) {
      for (const route of [fluent, syslog]) {
        await sendOverHttp(server, {
          path: route.noKey.path,
          headers: route.noKey.headers,
          body: route.sends[0]!.body,
        });
      }

      for (const route of [fluent, push]) {
        await sendOverHttp(server, {
          path: route.wrongKey.path,
          headers: route.wrongKey.headers,
          body: route.sends[0]!.body,
        });
      }
    }

    const lines: (level: "error" | "warn" | "debug") => Array<string> = (
      level: "error" | "warn" | "debug",
    ): Array<string> => {
      return (logger[level] as unknown as jest.Mock).mock.calls.map(
        (call: Array<unknown>): string => {
          return String(call[0]);
        },
      );
    };

    expect(lines("error")).toEqual([]);
    expect(
      lines("debug").filter((line: string): boolean => {
        return line === "Missing header: x-oneuptime-token";
      }),
    ).toHaveLength(40);
    expect(
      lines("debug").filter((line: string): boolean => {
        return line === "Invalid service token.";
      }),
    ).toHaveLength(40);
    // The first of the minute, with what was counted: one line.
    expect(lines("warn")).toEqual([
      "TelemetryIngest: refused 1 request with no ingestion key (fluent: 1). Each is logged at debug; these counts at most once a minute.",
    ]);
    // The rest are counted, by surface, for the next line.
    expect(
      Object.fromEntries(TelemetryIngestUnknownKeyRefusals.getCounts()),
    ).toEqual({
      "missing|fluent": 19,
      "missing|syslog": 20,
      "unknown|fluent": 20,
      "unknown|pyroscope": 20,
    });

    // No token is ever logged.
    for (const level of ["error", "warn", "info", "debug"] as const) {
      expect(
        JSON.stringify((logger[level] as unknown as jest.Mock).mock.calls),
      ).not.toContain(WRONG_KEY);
    }
  });
});
