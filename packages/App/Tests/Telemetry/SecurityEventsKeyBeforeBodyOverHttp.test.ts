import SecurityEventsIngestAPI from "../../FeatureSet/Telemetry/API/SecurityEventsIngest";
import SecurityEventsIngestService from "../../FeatureSet/Telemetry/Services/SecurityEventsIngestService";
import Queue from "Common/Server/Infrastructure/Queue";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import getRequestBodyLimit, {
  LARGE_REQUEST_BODY_BYTES,
  LARGE_REQUEST_BODY_LIMIT,
  TELEMETRY_ROUTE_PREFIXES,
  readsBodyAfterAuthentication,
} from "Common/Server/Utils/RequestBodyLimit";
import RealTimeDetections from "Common/Server/Utils/SecurityEvent/RealTime/RealTimeDetections";
import ThreatIntelEnricher from "Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
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
import TelemetryIngestionKeyRateLimiter, {
  TelemetryIngestionKeyLimitDecision,
  TelemetryIngestionKeyLimitOutcome,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter";
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
import { TelemetryIngestRefusalReason } from "Common/Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
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
import { Readable } from "stream";
import zlib from "zlib";

/*
 * SECURITY EVENTS ARE READ ONLY ONCE THEIR INGEST KEY IS RIGHT (#10795),
 * over HTTP, through StartServer's own middleware - as the App mounts it -
 * the real router, the real key check, the real ingestion budget gate, the
 * real handler and queue, and the real worker that makes the events, with
 * real clients. Only the key lookup, the key's rate, the budget's settings
 * and counter, the queue's store and what the worker writes to (the fan-in
 * writer, the service lookup, threat intelligence, the real-time
 * detections) are stubbed.
 *
 * StartServer read this route's body before routing, before TelemetryIngest
 * checked the key: a client with no key had up to 50 MiB parsed as JSON, or
 * inflated, before it was refused 401. Every sender sends its key in a
 * header (x-oneuptime-token), and the check reads only headers, so the key
 * is checked first now, and the body read after it - between the key and
 * the ingestion budget, which measures it - with StartServer's own parsers
 * (RequestBodyAfterAuthentication.readBody).
 *
 * How main read it is here too: the same router, mounted under a path
 * StartServer reads the body of before routing, at the limit it read this
 * route's at (AS_MAIN_READ_IT). Its reader finds the body read, and leaves
 * it, so the body there is read as main read it, then handed to the same
 * handler. Every batch is sent both ways and makes the same events, counted
 * at the same bytes, admitted or refused - but for a gzip batch, which main
 * read as its bytes and stored as one event of them.
 *
 * What each request cost is counted where it is spent: the bytes the server
 * read off the connection (by the time it closed it), the bytes zlib
 * inflated, the JSON parsed, and - when the key was checked - what had been
 * inflated and parsed by then.
 */

jest.setTimeout(300000);

const KEY: string = "10795000-0000-4000-8000-000000010795";
const WRONG_KEY: string = "00000000-0000-4000-8000-000000000000";

// Keys that are known, each refused for what it is.
const DISABLED_KEY: string = "10795000-0000-4000-8000-0000000d15ab";
const EXPIRED_KEY: string = "10795000-0000-4000-8000-0000000e4b1d";
const BROWSER_KEY: string = "10795000-0000-4000-8000-0000000b4053";
const MOBILE_KEY: string = "10795000-0000-4000-8000-00000000b11e";
const RATE_LIMITED_KEY: string = "10795000-0000-4000-8000-0000000004a7";

const ROUTE: string = "/security-events/v1/ingest";

// The route under each prefix its router is mounted on.
const ROUTES: Array<string> = TELEMETRY_ROUTE_PREFIXES.map(
  (prefix: string): string => {
    return `${prefix}${ROUTE}`;
  },
);

/*
 * Where the router reads its body as main did: under a path StartServer
 * reads the body of before routing, held to the 50 MB and 1,000,000 values
 * it held /security-events/* to (RequestBodyLimit's /workflow/*).
 */
const AS_MAIN_READ_IT_PREFIX: string = "/workflow/as-main-read-it";
const AS_MAIN_READ_IT: string = `${AS_MAIN_READ_IT_PREFIX}${ROUTE}`;

// The most the route takes (RequestBodyLimit), as sent and once inflated.
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

const NO_EVENTS: JSONObject = {
  error:
    'No security events found in request. Send a JSON object, an array of objects, or { "events": [...] }.',
};

const PROJECT_ID: ObjectID = ObjectID.generate();

const policyOf: (
  overrides?: Partial<TelemetryIngestionKeyPolicy>,
) => TelemetryIngestionKeyPolicy = (
  overrides?: Partial<TelemetryIngestionKeyPolicy>,
): TelemetryIngestionKeyPolicy => {
  return {
    ingestionKeyId: ObjectID.generate(),
    projectId: PROJECT_ID,
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
    ingestionBudgets: null,
    ...(overrides || {}),
  };
};

const POLICIES: Map<string, TelemetryIngestionKeyPolicy> = new Map([
  [KEY, policyOf()],
  [DISABLED_KEY, policyOf({ isEnabled: false })],
  [EXPIRED_KEY, policyOf({ expiresAt: new Date(Date.now() - 60_000) })],
  [
    BROWSER_KEY,
    policyOf({
      keyType: TelemetryIngestionKeyType.Browser,
      allowedOrigins: ["https://shop.example.com"],
    }),
  ],
  [
    MOBILE_KEY,
    policyOf({
      keyType: TelemetryIngestionKeyType.Mobile,
      pinnedServiceName: "com.example.shop",
    }),
  ],
  [RATE_LIMITED_KEY, policyOf({ requestsPerMinuteLimit: 60 })],
]);

const RANDOM: SeededRandom = seededRandom(10795);

// Bytes drawn from the shared seeded generator: they do not compress.
const noise: (bytes: number) => Buffer = (bytes: number): Buffer => {
  const buffer: Buffer = Buffer.alloc(bytes);

  for (let offset: number = 0; offset + 4 <= bytes; offset += 4) {
    buffer.writeUInt32LE(RANDOM(4294967296), offset);
  }

  return buffer;
};

const json: (value: unknown) => Buffer = (value: unknown): Buffer => {
  return Buffer.from(JSON.stringify(value));
};

// A minute ago: inside the window ingest places an event at its own time.
const AT: string = new Date(Date.now() - 60_000).toISOString();

const TOKEN: Record<string, string> = { "x-oneuptime-token": KEY };
const JSON_TYPE: Record<string, string> = {
  "content-type": "application/json",
};

interface Send {
  // Who sends it so.
  how: string;
  // The URL's query, "" for none.
  query: string;
  headers: Record<string, string>;
  body: Buffer;
  // What each event made of it says, in part: what ties it to the batch.
  events: Array<JSONObject>;
}

const gzipped: (send: Send) => Send = (send: Send): Send => {
  return {
    how: `${send.how}, gzip-encoded`,
    query: send.query,
    headers: { ...send.headers, "content-encoding": "gzip" },
    body: zlib.gzipSync(send.body),
    events: send.events,
  };
};

// The three snippets the Security Events page shows, as they are.
const CURL_OCSF: Send = {
  how: "the docs' OCSF curl",
  query: "?format=ocsf",
  headers: {
    ...JSON_TYPE,
    ...TOKEN,
    "x-oneuptime-service-name": "my-security-source",
  },
  body: json({
    events: [
      {
        class_uid: 3002,
        severity_id: 4,
        status: "Failure",
        message: "Failed logon for alice",
        actor: { user: { name: "alice" } },
        src_endpoint: { ip: "203.0.113.7", hostname: "laptop-alice" },
      },
    ],
  }),
  events: [
    {
      classUid: 3002,
      message: "Failed logon for alice",
      principalUser: "alice",
      principalIp: "203.0.113.7",
    },
  ],
};

const CURL_UDM: Send = {
  how: "the docs' Google UDM curl",
  query: "?format=udm",
  headers: { ...JSON_TYPE, ...TOKEN },
  body: json({
    events: [
      {
        metadata: { event_type: "USER_LOGIN" },
        principal: {
          hostname: "laptop-alice",
          user: { userid: "alice" },
          ip: ["203.0.113.7"],
        },
        security_result: [{ severity: "HIGH", action: ["BLOCK"] }],
      },
    ],
  }),
  events: [
    {
      classUid: 3002,
      principalUser: "alice",
      principalHost: "laptop-alice",
      principalIp: "203.0.113.7",
    },
  ],
};

const CURL_GENERIC: Send = {
  how: "the docs' generic JSON curl",
  query: "",
  headers: { ...JSON_TYPE, ...TOKEN },
  body: json({
    events: [
      {
        severity: "high",
        event_type: "ssh_brute_force",
        message: "12 failed SSH logins in 60s",
        username: "root",
        hostname: "web-01",
        src_ip: "203.0.113.7",
      },
    ],
  }),
  events: [
    {
      className: "Ssh Brute Force",
      message: "12 failed SSH logins in 60s",
      principalUser: "root",
      principalHost: "web-01",
      principalIp: "203.0.113.7",
    },
  ],
};

/*
 * Fluent Bit's http output as the page configures it (Format json,
 * Json_date_key timestamp, Json_date_format iso8601): a buffer chunk as one
 * JSON array of records.
 */
const FLUENT_BIT_RECORDS: Array<JSONObject> = [
  {
    timestamp: AT,
    type: "USER_AUTH",
    msg: "op=PAM:authentication acct=jürgen exe=/usr/sbin/sshd res=failed",
    user: "jürgen",
    hostname: "web-02",
    src_ip: "198.51.100.23",
  },
  {
    timestamp: AT,
    type: "USER_LOGIN",
    msg: "op=login acct=root exe=/usr/sbin/sshd res=success 中",
    user: "root",
    hostname: "web-02",
    src_ip: "198.51.100.24",
  },
];

const FLUENT_BIT: Send = {
  how: "Fluent Bit's http output, as the page sets it up",
  query: "",
  headers: {
    ...JSON_TYPE,
    ...TOKEN,
    "x-oneuptime-service-name": "my-security-source",
    "user-agent": "Fluent-Bit",
  },
  body: json(FLUENT_BIT_RECORDS),
  events: [
    {
      principalUser: "jürgen",
      principalHost: "web-02",
      principalIp: "198.51.100.23",
    },
    {
      principalUser: "root",
      principalHost: "web-02",
      principalIp: "198.51.100.24",
    },
  ],
};

// A Google SecOps SOAR playbook's HTTP request: a rule's detection.
const SECOPS_DETECTION: Send = {
  how: "a Google SecOps SOAR playbook's HTTP request, with a rule's detection",
  query: "",
  headers: { ...JSON_TYPE, ...TOKEN },
  body: json({
    type: "RULE_DETECTION",
    id: "de_10795000-0b1d-4c55-9e3a-7d1f0c2b8a41",
    createdTime: AT,
    detectionTime: AT,
    detection: [
      {
        ruleName: "Suspicious LLMNR traffic observed",
        description: "LLMNR traffic from a host that should not broadcast it",
        ruleId: "ru_10795000-3f7e-4a0d-8c1e-5d2b9f6a4c10",
        alertState: "ALERTING",
        ruleType: "SINGLE_EVENT",
        ruleLabels: [{ key: "severity", value: "Medium" }],
        riskScore: 40,
      },
    ],
    collectionElements: [
      {
        label: "e",
        references: [
          {
            event: {
              metadata: { eventType: "NETWORK_CONNECTION" },
              principal: { hostname: "ws-042", ip: ["10.20.0.42"] },
            },
          },
        ],
      },
    ],
  }),
  events: [
    {
      className: "Detection Finding",
      ruleName: "Suspicious LLMNR traffic observed",
    },
  ],
};

// The other shapes and ways of naming a format that ingest takes.
const SENDS: Array<Send> = [
  CURL_OCSF,
  CURL_UDM,
  CURL_GENERIC,
  FLUENT_BIT,
  SECOPS_DETECTION,
  {
    how: "one event, as a bare object",
    query: "",
    headers: { ...JSON_TYPE, ...TOKEN },
    body: json({
      timestamp: AT,
      severity: "medium",
      event_type: "port_scan",
      message: "Port scan from 198.51.100.7",
      src_ip: "198.51.100.7",
      dest_ip: "10.0.0.5",
    }),
    events: [{ principalIp: "198.51.100.7", targetIp: "10.0.0.5" }],
  },
  {
    how: "a bare array, with something in it that is no event",
    query: "",
    headers: { ...JSON_TYPE, ...TOKEN },
    body: json([
      { timestamp: AT, message: "first", src_ip: "192.0.2.1" },
      42,
      { timestamp: AT, message: "second", src_ip: "192.0.2.2" },
    ]),
    events: [
      { message: "first", principalIp: "192.0.2.1" },
      { message: "second", principalIp: "192.0.2.2" },
    ],
  },
  {
    how: "{ entries: [...] }",
    query: "",
    headers: { ...JSON_TYPE, ...TOKEN },
    body: json({ entries: [{ timestamp: AT, message: "from entries" }] }),
    events: [{ message: "from entries" }],
  },
  {
    how: "{ logs: [...] }, as some forwarders write it",
    query: "",
    headers: { ...JSON_TYPE, ...TOKEN },
    body: json({ logs: [{ timestamp: AT, message: "from logs" }] }),
    events: [{ message: "from logs" }],
  },
  {
    how: "a UDM event, its format named by the header",
    query: "",
    headers: {
      ...JSON_TYPE,
      ...TOKEN,
      "x-oneuptime-security-event-format": "udm",
    },
    body: json({
      events: [
        {
          metadata: { event_type: "USER_LOGIN", event_timestamp: AT },
          principal: { user: { userid: "bob" }, ip: ["192.0.2.9"] },
        },
      ],
    }),
    events: [{ classUid: 3002, principalUser: "bob" }],
  },
  {
    how: "an OCSF event, its format named in the body",
    query: "",
    headers: { ...JSON_TYPE, ...TOKEN },
    body: json({
      format: "ocsf",
      events: [
        {
          class_uid: 4001,
          severity_id: 3,
          time: Date.now() - 60_000,
          message: "Blocked outbound connection",
          src_endpoint: { ip: "10.0.0.2" },
          dst_endpoint: { ip: "8.8.8.8", port: 53 },
        },
      ],
    }),
    events: [{ classUid: 4001, principalIp: "10.0.0.2", targetIp: "8.8.8.8" }],
  },
  {
    how: "JSON with its charset",
    query: "",
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...TOKEN,
    },
    body: json({ events: [{ timestamp: AT, message: "with a charset" }] }),
    events: [{ message: "with a charset" }],
  },
  {
    how: "a form, which StartServer parsed too",
    query: "",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...TOKEN,
    },
    body: Buffer.from(
      "message=Login+failed&severity=high&src_ip=203.0.113.50&user=d%C3%BCrer",
    ),
    events: [{ message: "Login failed", principalUser: "dürer" }],
  },
];

const sendNamed: (how: string) => Send = (how: string): Send => {
  return SENDS.find((send: Send): boolean => {
    return send.how === how;
  })!;
};

/*
 * 40 MiB a client with no key sends: JSON with one long string - what
 * StartServer parsed whole before routing, under the route's 1,000,000
 * values - and the same gzipped.
 */
let unkeyedJson: Buffer;
let unkeyedJsonGzip: Buffer;

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

// The budget's counter: every decision it was asked for, and its answer.
const counted: Array<TelemetryIngestionBudgetCounterRequest> = [];
let counterAnswer: TelemetryIngestionBudgetCounterOutcome =
  TelemetryIngestionBudgetCounterOutcome.Admitted;
let budgetInForce: boolean = false;

// A day's budget of `gb` for security events, and a rate when given.
const budgetOf: (
  gb: number,
  mbPerSecond: number | null,
) => TelemetryIngestionBudgetStoredSettings = (
  gb: number,
  mbPerSecond: number | null,
): TelemetryIngestionBudgetStoredSettings => {
  const settings: TelemetryIngestionBudgetStoredSettings =
    getEmptyTelemetryIngestionBudgetStoredSettings();

  settings[ProductType.SecurityEvents] = {
    dailyBudgetInGB: gb,
    rateLimitInMBPerSecond: mbPerSecond,
  };

  return settings;
};

let rateInForce: number | null = null;

// The batches queued, as BullMQ stores them: JSON.
const queued: Array<JSONObject> = [];

/*
 * JSON.parse as it is before a test watches it: a job read back as BullMQ
 * stores it is no JSON the server parsed of a request.
 */
const readBackAsStored: (text: string) => unknown = JSON.parse;

// The rows the worker wrote, in order.
const written: Array<JSONObject> = [];

// What a known key was refused for, and on which surface.
const refusals: Array<{ reason: string; surface: string | null }> = [];

// One telemetry service per name, as a project has.
const services: Map<string, ObjectID> = new Map();

let server: BodyServer;

beforeAll(async () => {
  for (const level of ["error", "warn", "info", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined;
    });
  }

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

        return POLICIES.get(secretKey) || null;
      },
    );
  jest
    .spyOn(TelemetryIngestionKeyService, "markUsed")
    .mockResolvedValue(undefined);
  jest
    .spyOn(TelemetryIngestionKeyRateLimiter, "consume")
    .mockImplementation(
      async (data: {
        ingestionKeyId: ObjectID;
      }): Promise<TelemetryIngestionKeyLimitDecision> => {
        if (
          data.ingestionKeyId.toString() ===
          POLICIES.get(RATE_LIMITED_KEY)!.ingestionKeyId.toString()
        ) {
          return {
            outcome: TelemetryIngestionKeyLimitOutcome.RateLimited,
            retryAfterSeconds: 30,
            isFirstRejectionInWindow: false,
          };
        }

        return { outcome: TelemetryIngestionKeyLimitOutcome.Allowed };
      },
    );
  jest
    .spyOn(TelemetryIngestRefusalRecorder, "record")
    .mockImplementation(
      (data: {
        reason: TelemetryIngestRefusalReason;
        surface: TelemetryIngestSurface | null;
      }): void => {
        refusals.push({ reason: data.reason, surface: data.surface });
      },
    );

  // The ingestion budget: none in force unless a test sets one.
  jest
    .spyOn(TelemetryIngestionBudgetSettings, "getInstanceSettings")
    .mockImplementation(async () => {
      return {
        budgets: budgetInForce
          ? budgetOf(1, rateInForce)
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

        if (counterAnswer === TelemetryIngestionBudgetCounterOutcome.Admitted) {
          return { outcome: TelemetryIngestionBudgetCounterOutcome.Admitted };
        }

        return {
          outcome: counterAnswer,
          scopeIndex: 0,
          isFirstExhaustion: false,
          ...(counterAnswer ===
          TelemetryIngestionBudgetCounterOutcome.RateLimited
            ? { retryAfterSeconds: 1 }
            : {}),
        };
      },
    );
  jest
    .spyOn(TelemetryIngestAttributionSettings, "isAttributedProject")
    .mockResolvedValue(false);
  jest
    .spyOn(TelemetryIngestAttributionSettings, "getTeamLabelBudgetProjects")
    .mockResolvedValue(new Set<string>());

  // The queue: each job as BullMQ stores it, JSON.
  jest.spyOn(Queue, "addJob").mockImplementation((async (
    _queueName: unknown,
    _jobId: unknown,
    _jobName: unknown,
    data: JSONObject,
  ) => {
    queued.push(readBackAsStored(JSON.stringify(data)) as JSONObject);
    return {};
  }) as never);

  // What the worker writes to and reads.
  jest
    .spyOn(OTelIngestService, "telemetryServiceFromName")
    .mockImplementation(
      async (data: {
        serviceName: string;
      }): Promise<TelemetryServiceMetadata> => {
        if (!services.has(data.serviceName)) {
          services.set(data.serviceName, ObjectID.generate());
        }

        return {
          serviceName: data.serviceName,
          primaryEntityId: services.get(data.serviceName)!,
          primaryEntityType: ServiceType.OpenTelemetry,
          dataRententionInDays: 30,
          serviceRetentionConfig: null,
          serviceRetentionInDays: 30,
          projectRetentionConfig: null,
          projectRetentionInDays: 15,
        } as TelemetryServiceMetadata;
      },
    );
  jest
    .spyOn(ThreatIntelEnricher, "enrichNormalizedEvents")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(RealTimeDetections, "screen")
    .mockResolvedValue(undefined as never);
  jest.spyOn(TelemetryFanInWriter, "submit").mockImplementation((async (
    _service: unknown,
    rows: Array<JSONObject>,
  ) => {
    written.push(...rows);
    return { flushed: Promise.resolve() };
  }) as never);

  unkeyedJson = json({
    events: [
      {
        message: noise(UNKEYED / 2)
          .toString("hex")
          .slice(0, UNKEYED - 64),
      },
    ],
  });
  unkeyedJsonGzip = zlib.gzipSync(
    json({ events: [{ message: "a".repeat(UNKEYED - 64) }] }),
  );

  // The App's own express app: importing StartServer mounted its middleware.
  const app: ExpressApplication = Express.getExpressApp();

  app.use(["/telemetry", "/"], SecurityEventsIngestAPI);
  app.use(AS_MAIN_READ_IT_PREFIX, SecurityEventsIngestAPI);
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

  atKeyCheck.length = 0;
  counted.length = 0;
  queued.length = 0;
  written.length = 0;
  refusals.length = 0;
  counterAnswer = TelemetryIngestionBudgetCounterOutcome.Admitted;
  budgetInForce = false;
  rateInForce = null;
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

/*
 * A row without what the clock sets as it is written - its id, when it was
 * written and kept until, and the time of an event that has none of its own
 * - so two deliveries of one batch make equal rows. Every field the batch
 * sent is in its attributes, its time among them.
 */
const withoutTheClock: (row: JSONObject) => JSONObject = (
  row: JSONObject,
): JSONObject => {
  const rest: JSONObject = { ...row };

  delete rest["_id"];
  delete rest["createdAt"];
  delete rest["retentionDate"];
  delete rest["time"];

  return rest;
};

// What a budget's counter was asked, without when.
const asCounted: (
  request: TelemetryIngestionBudgetCounterRequest,
) => unknown = (request: TelemetryIngestionBudgetCounterRequest): unknown => {
  return {
    projectId: request.projectId,
    signalSlug: request.signalSlug,
    mode: request.mode,
    bytes: request.bytes,
    scopes: request.scopes,
  };
};

interface Delivered {
  status: number | null;
  json: unknown;
  // The batches queued, as the worker reads them back.
  queued: Array<unknown>;
  // The events the worker made of them (withoutTheClock).
  events: Array<JSONObject>;
  // What the budget's counter was asked (asCounted).
  counted: Array<unknown>;
  sent: SentRequest;
}

// Each job queued, processed by the worker as ProcessTelemetry hands it on.
const processQueued: () => Promise<Array<unknown>> = async (): Promise<
  Array<unknown>
> => {
  const jobs: Array<JSONObject> = queued.splice(0, queued.length);

  for (const job of jobs) {
    await SecurityEventsIngestService.processSecurityEventsFromQueue({
      projectId: new ObjectID(String(job["projectId"])),
      body: job["requestBody"],
      headers: job["requestHeaders"],
    } as unknown as TelemetryRequest);
  }

  return jobs.map((job: JSONObject): unknown => {
    return job["requestBody"];
  });
};

// Sends a batch to `path`, and reads all it made.
const deliver: (
  path: string,
  send: Send,
  options?: { connection?: Connection; chunked?: boolean } | undefined,
) => Promise<Delivered> = async (
  path: string,
  send: Send,
  options?: { connection?: Connection; chunked?: boolean } | undefined,
): Promise<Delivered> => {
  queued.length = 0;
  written.length = 0;
  counted.length = 0;

  const sent: SentRequest = await sendOverHttp(server, {
    path: `${path}${send.query}`,
    headers: send.headers,
    connection: options?.connection,
    chunked: options?.chunked,
    body: send.body,
  });

  const jobBodies: Array<unknown> = await processQueued();

  return {
    status: sent.answer.status,
    json: sent.answer.json,
    queued: jobBodies,
    events: written.splice(0, written.length).map(withoutTheClock),
    counted: counted.splice(0, counted.length).map(asCounted),
    sent: sent,
  };
};

// What two deliveries of a batch both say: what is compared.
const outcomeOf: (delivered: Delivered) => unknown = (
  delivered: Delivered,
): unknown => {
  return {
    status: delivered.status,
    json: delivered.json,
    queued: delivered.queued,
    events: delivered.events,
    counted: delivered.counted,
  };
};

// Nothing of a refused batch was queued, or made into an event.
const expectNothingTaken: () => void = (): void => {
  expect(queued).toEqual([]);
  expect(written).toEqual([]);
};

describe("the route", () => {
  test("is read after its key, under both telemetry prefixes, in any case and with a trailing slash: StartServer leaves its body unread", () => {
    for (const path of [
      ...ROUTES,
      "/Security-Events/V1/Ingest/",
      "/TELEMETRY/SECURITY-EVENTS/V1/INGEST",
    ]) {
      expect({
        path,
        afterKey: readsBodyAfterAuthentication(path),
        limit: getRequestBodyLimit(path),
      }).toEqual({ path, afterKey: true, limit: LARGE_REQUEST_BODY_LIMIT });
    }
  });

  test("is read as main read it under AS_MAIN_READ_IT: by StartServer, before routing, at the same limit", () => {
    expect({
      afterKey: readsBodyAfterAuthentication(AS_MAIN_READ_IT),
      limit: getRequestBodyLimit(AS_MAIN_READ_IT),
    }).toEqual({ afterKey: false, limit: LARGE_REQUEST_BODY_LIMIT });
  });
});

/*
 * A batch with the right key: the same answer, the same batch queued, the
 * same events made of it and the same bytes counted, read after the key as
 * when StartServer read it before - each client's own request, declared and
 * chunked, on kept and closed connections.
 */
describe("with the right key, a batch makes the events it made before", () => {
  test.each(
    SENDS.map((send: Send): [string, Send] => {
      return [send.how, send];
    }),
  )(
    "%s: taken, declared and chunked, on kept and closed connections, as when StartServer read it",
    async (_how: string, send: Send) => {
      const before: Delivered = await deliver(AS_MAIN_READ_IT, send);

      expect(before.status).toBe(200);
      expect(before.events).toHaveLength(send.events.length);

      for (const [index, event] of send.events.entries()) {
        expect(before.events[index]).toMatchObject(event);
      }

      for (const path of ROUTES) {
        for (const connection of CONNECTIONS) {
          for (const chunked of [false, true]) {
            const after: Delivered = await deliver(path, send, {
              connection,
              chunked,
            });

            expect({
              path,
              connection,
              chunked,
              outcome: outcomeOf(after),
            }).toEqual({
              path,
              connection,
              chunked,
              outcome: outcomeOf(before),
            });
            expect(after.sent.answer.clientError).toBeNull();
          }
        }
      }

      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  test("the key is checked from the headers before a byte of the body is inflated or parsed", async () => {
    const send: Send = gzipped(CURL_GENERIC);
    const after: Delivered = await deliver(ROUTE, send);

    expect(after.status).toBe(200);
    // Once, with nothing inflated or parsed yet; then the batch, whole.
    expect(atKeyCheck).toEqual([{ inflated: 0, parsed: 0 }]);
    expect(watched.inflated).toBe(CURL_GENERIC.body.length);
  });

  test("and uncompressed, before a byte of it is parsed", async () => {
    const after: Delivered = await deliver(ROUTE, CURL_GENERIC);

    expect(after.status).toBe(200);
    expect(atKeyCheck).toEqual([{ inflated: 0, parsed: 0 }]);
  });

  test("main checked it once all of the body was parsed", async () => {
    const before: Delivered = await deliver(AS_MAIN_READ_IT, CURL_GENERIC);

    expect(before.status).toBe(200);
    expect(atKeyCheck).toEqual([
      { inflated: 0, parsed: CURL_GENERIC.body.length },
    ]);
  });

  test("main checked it once all of a gzip body was inflated", async () => {
    await deliver(AS_MAIN_READ_IT, gzipped(CURL_GENERIC));

    expect(atKeyCheck).toEqual([
      { inflated: CURL_GENERIC.body.length, parsed: 0 },
    ]);
  });

  test("the service is the header's, or the first event's product, as before", async () => {
    const named: Delivered = await deliver(ROUTE, CURL_OCSF);
    const unnamed: Delivered = await deliver(ROUTE, CURL_GENERIC);

    expect(named.events[0]!["primaryEntityId"]).toBe(
      services.get("my-security-source")!.toString(),
    );
    expect(unnamed.events[0]!["primaryEntityId"]).toBe(
      services.get("Security Events")!.toString(),
    );
    expect(named.events[0]!["projectId"]).toBe(PROJECT_ID.toString());
  });
});

/*
 * A gzip batch: StartServer handed it on as its inflated bytes, whatever
 * its type, and the handler made one event of them - their numbered keys,
 * stored as { type: "Buffer", data: [...] } - so the batch's own events
 * were lost behind a 200. A gzip JSON batch is read as the same batch
 * uncompressed now (RequestBodyAfterAuthentication's parseGzipJson), and
 * bytes of any other type, which hold no events, are refused 400 as plain
 * text is (SecurityEventsIngestService.test.ts pins the handler).
 */
describe("a gzip batch is read as the same batch uncompressed", () => {
  test.each([
    ["Fluent Bit's records, with compress gzip", FLUENT_BIT],
    ["the docs' generic curl, its body gzipped", CURL_GENERIC],
    ["the docs' OCSF curl, its body gzipped", CURL_OCSF],
  ])(
    "%s: the events it carries, as uncompressed, declared and chunked",
    async (_what: string, send: Send) => {
      const uncompressed: Delivered = await deliver(ROUTE, send);

      expect(uncompressed.status).toBe(200);

      for (const chunked of [false, true]) {
        const after: Delivered = await deliver(ROUTE, gzipped(send), {
          chunked,
        });

        expect({
          status: after.status,
          queued: after.queued,
          events: after.events,
        }).toEqual({
          status: 200,
          queued: uncompressed.queued,
          events: uncompressed.events,
        });
      }

      // As main read it, it is its bytes, which hold no events.
      const before: Delivered = await deliver(AS_MAIN_READ_IT, gzipped(send));

      expect({
        status: before.status,
        json: before.json,
        queued: before.queued,
      }).toEqual({ status: 400, json: NO_EVENTS, queued: [] });
    },
  );

  test.each([
    [
      "gzip lines of no JSON type",
      { "content-type": "text/plain", "content-encoding": "gzip" },
      zlib.gzipSync(Buffer.from("op=login acct=root res=failed\n")),
    ],
    [
      "gzip newline-delimited JSON",
      { "content-type": "application/x-ndjson", "content-encoding": "gzip" },
      zlib.gzipSync(
        Buffer.from(
          `${JSON.stringify({ message: "one", src_ip: "192.0.2.1" })}\n`,
        ),
      ),
    ],
    ["protobuf", { "content-type": "application/x-protobuf" }, noise(256)],
  ])(
    "%s: bytes, which hold no events, refused 400 as plain text is, read either way",
    async (_what: string, headers: Record<string, string>, body: Buffer) => {
      const send: Send = {
        how: "bytes",
        query: "",
        headers: { ...headers, ...TOKEN },
        body: body,
        events: [],
      };

      const after: Delivered = await deliver(ROUTE, send);

      expect({
        status: after.status,
        json: after.json,
        queued: after.queued,
      }).toEqual({ status: 400, json: NO_EVENTS, queued: [] });

      const before: Delivered = await deliver(AS_MAIN_READ_IT, send);

      expect(outcomeOf(after)).toEqual(outcomeOf(before));
    },
  );

  test("the same lines uncompressed are refused alike, as before", async () => {
    const send: Send = {
      how: "plain lines",
      query: "",
      headers: { "content-type": "text/plain", ...TOKEN },
      body: Buffer.from("op=login acct=root res=failed\n"),
      events: [],
    };

    for (const path of [ROUTE, AS_MAIN_READ_IT]) {
      const delivered: Delivered = await deliver(path, send);

      expect({ status: delivered.status, json: delivered.json }).toEqual({
        status: 400,
        json: NO_EVENTS,
      });
    }
  });

  test("gzip JSON that does not parse is refused 400 before any budget is asked, as the same JSON uncompressed is", async () => {
    budgetInForce = true;

    const broken: Buffer = Buffer.from('{ "events": [ { "message": "cut');
    const uncompressed: Delivered = await deliver(ROUTE, {
      how: "broken JSON",
      query: "",
      headers: { ...JSON_TYPE, ...TOKEN },
      body: broken,
      events: [],
    });
    const compressed: Delivered = await deliver(ROUTE, {
      how: "broken JSON, gzipped",
      query: "",
      headers: { ...JSON_TYPE, ...TOKEN, "content-encoding": "gzip" },
      body: zlib.gzipSync(broken),
      events: [],
    });

    expect(uncompressed.status).toBe(400);
    expect(outcomeOf(compressed)).toEqual(outcomeOf(uncompressed));
    expect(compressed.counted).toEqual([]);
  });

  test("gzip that does not inflate is refused 400, as before", async () => {
    const send: Send = {
      how: "not gzip",
      query: "",
      headers: { ...JSON_TYPE, ...TOKEN, "content-encoding": "gzip" },
      body: Buffer.from("not gzip at all, though it says so"),
      events: [],
    };

    const after: Delivered = await deliver(ROUTE, send);
    const before: Delivered = await deliver(AS_MAIN_READ_IT, send);

    expect(after.status).toBe(400);
    expect(outcomeOf(after)).toEqual(outcomeOf(before));
  });
});

/*
 * Every way a key is refused - none, one no key has, one switched off,
 * expired, a browser's or a mobile app's, one over its rate - is refused
 * before a byte of the body is read, in the words it was refused in before.
 */
interface Refusal {
  what: string;
  headers: Record<string, string>;
  status: number;
  // The words it is refused in, as every client has read them.
  json: JSONObject;
  /*
   * Where it is sent: a request with no key under both prefixes, each other
   * under one, in turn - the server closes under each refused body after a
   * grace, which every request waits out.
   */
  paths: Array<string>;
}

const REFUSALS: Array<Refusal> = [
  {
    what: "no key",
    headers: JSON_TYPE,
    status: 401,
    json: MISSING_KEY,
    paths: ROUTES,
  },
  {
    what: "a key no key has",
    headers: { ...JSON_TYPE, "x-oneuptime-token": WRONG_KEY },
    status: 401,
    json: INVALID_KEY,
    paths: [ROUTES[0]!],
  },
  {
    what: "a key switched off",
    headers: { ...JSON_TYPE, "x-oneuptime-token": DISABLED_KEY },
    status: 422,
    json: { message: "This telemetry ingestion key has been disabled." },
    paths: [ROUTES[1]!],
  },
  {
    what: "an expired key",
    headers: { ...JSON_TYPE, "x-oneuptime-token": EXPIRED_KEY },
    status: 401,
    json: { message: "This telemetry ingestion key expired." },
    paths: [ROUTES[0]!],
  },
  {
    what: "a browser key, from its own origin",
    headers: {
      ...JSON_TYPE,
      "x-oneuptime-token": BROWSER_KEY,
      origin: "https://shop.example.com",
    },
    status: 422,
    json: {
      message:
        "A browser ingestion key cannot be used for security event ingest. Use a server ingestion key.",
    },
    paths: [ROUTES[1]!],
  },
  {
    what: "a mobile key",
    headers: { ...JSON_TYPE, "x-oneuptime-token": MOBILE_KEY },
    status: 422,
    json: {
      message:
        "A mobile ingestion key cannot be used for security event ingest: it sends only a mobile app's OTLP traces, logs and metrics over HTTP, and its session replays. Use a server ingestion key here.",
    },
    paths: [ROUTES[0]!],
  },
  {
    what: "a key over its rate",
    headers: { ...JSON_TYPE, "x-oneuptime-token": RATE_LIMITED_KEY },
    status: 429,
    json: {
      message:
        "Too many telemetry requests for this ingestion key. Please retry later.",
    },
    paths: [ROUTES[1]!],
  },
];

describe.each(REFUSALS)("$what", (refusal: Refusal) => {
  test.each([...CONNECTIONS])(
    "40 MiB are refused, declared or chunked, with a socket read or two read: nothing inflated or parsed, nothing queued, no budget asked, in the words it was refused in before (%s)",
    async (connection: Connection) => {
      budgetInForce = true;

      // Its words before: from main's read, of a small batch.
      const before: SentRequest = await sendOverHttp(server, {
        path: AS_MAIN_READ_IT,
        headers: refusal.headers,
        body: CURL_GENERIC.body,
      });

      expect({
        status: before.answer.status,
        json: before.answer.json,
      }).toEqual({ status: refusal.status, json: refusal.json });

      for (const path of refusal.paths) {
        for (const chunked of [false, true]) {
          const sent: SentRequest = await sendOverHttp(server, {
            path: path,
            headers: refusal.headers,
            connection: connection,
            chunked: chunked,
            body: unkeyedJson,
          });

          expect({
            status: sent.answer.status,
            json: sent.answer.json,
          }).toEqual({
            status: before.answer.status,
            json: before.answer.json,
          });
          expect(sent.answer.clientError).toBeNull();
          // Closed under the rest, which is never read.
          expect(sent.answer.connection).toBe("close");
          expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(
            READ_OR_TWO,
          );
        }
      }

      expect(watched.inflated).toBe(0);
      expect(longestJsonParsed()).toBeLessThan(READ_OR_TWO);
      expect(counted).toEqual([]);
      expectNothingTaken();
    },
  );

  test("a gzip batch is refused with nothing of it inflated", async () => {
    const sent: SentRequest = await sendOverHttp(server, {
      path: refusal.paths[0]!,
      headers: { ...refusal.headers, "content-encoding": "gzip" },
      body: unkeyedJsonGzip,
    });

    expect(sent.answer.status).toBe(refusal.status);
    expect(watched.inflated).toBe(0);
    expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(READ_OR_TWO);
    expectNothingTaken();
  });
});

describe("what main read of a refused batch", () => {
  test("with no key, all 40 MiB were read and parsed before the 401", async () => {
    const before: SentRequest = await sendOverHttp(server, {
      path: AS_MAIN_READ_IT,
      headers: JSON_TYPE,
      body: unkeyedJson,
    });

    expect({ status: before.answer.status, json: before.answer.json }).toEqual({
      status: 401,
      json: MISSING_KEY,
    });
    expect(await server.readInAll(before.tag)).toBeGreaterThanOrEqual(UNKEYED);
    expect(longestJsonParsed()).toBeGreaterThanOrEqual(UNKEYED - 64);
  });

  test("with no key, 40 MiB of gzip were inflated before the 401", async () => {
    const before: SentRequest = await sendOverHttp(server, {
      path: AS_MAIN_READ_IT,
      headers: { ...JSON_TYPE, "content-encoding": "gzip" },
      body: unkeyedJsonGzip,
    });

    expect(before.answer.status).toBe(401);
    expect(watched.inflated).toBeGreaterThanOrEqual(UNKEYED - 64);
  });
});

describe("with no key, sent another way", () => {
  test("with fetch: the refusal is read, the rest unread", async () => {
    const sent: SentRequest = await sendWithFetch(server, {
      path: ROUTE,
      headers: JSON_TYPE,
      bytes: UNKEYED,
    });

    expect(sent.answer.clientError).toBeNull();
    expect({ status: sent.answer.status, json: sent.answer.json }).toEqual({
      status: 401,
      json: MISSING_KEY,
    });
    expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(READ_OR_TWO);
  });

  test("a key in the body alone was never a key: refused 401 as one with none, now unread", async () => {
    /*
     * No sender puts its key only in the body: each sends it in a header,
     * and the check reads only headers, so a key in the body was refused
     * before as well - once all of the body had been read and parsed.
     */
    const sent: SentRequest = await sendOverHttp(server, {
      path: ROUTE,
      headers: JSON_TYPE,
      body: json({
        "x-oneuptime-token": KEY,
        ingestionKey: KEY,
        events: [{ message: "a".repeat(UNKEYED) }],
      }),
    });

    expect({ status: sent.answer.status, json: sent.answer.json }).toEqual({
      status: 401,
      json: MISSING_KEY,
    });
    expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(READ_OR_TWO);
    expect(longestJsonParsed()).toBeLessThan(READ_OR_TWO);
    expectNothingTaken();
  });
});

describe("with the right key, over the limit", () => {
  test("over 50 MB uncompressed: refused 413 before a byte is read when declared, at the limit when chunked, in the words it was before", async () => {
    const headers: Record<string, string> = { ...JSON_TYPE, ...TOKEN };

    const declared: SentRequest = await sendOverHttp(server, {
      path: ROUTE,
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

    const declaredBefore: SentRequest = await sendOverHttp(server, {
      path: AS_MAIN_READ_IT,
      headers: headers,
      bytes: OVER,
      fill: 0x20,
    });

    expect({
      status: declaredBefore.answer.status,
      json: declaredBefore.answer.json,
    }).toEqual({ status: declared.answer.status, json: declared.answer.json });

    const chunked: SentRequest = await sendOverHttp(server, {
      path: ROUTE,
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

  test("a gzip batch over 50 MB is refused 413 in the same words, as it inflates", async () => {
    // 64 MiB of one byte in about 64 KiB: refused once 50 MB have inflated.
    const bomb: SentRequest = await sendOverHttp(server, {
      path: ROUTE,
      headers: { ...JSON_TYPE, ...TOKEN, "content-encoding": "gzip" },
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

  test("JSON with more values than the route reads is refused 413 before it is parsed, as before", async () => {
    const send: Send = {
      how: "a million and one values",
      query: "",
      headers: { ...JSON_TYPE, ...TOKEN },
      body: Buffer.from(`[${"0,".repeat(LARGE_REQUEST_BODY_LIMIT.values)}0]`),
      events: [],
    };

    const after: Delivered = await deliver(ROUTE, send);

    expect(after.status).toBe(413);
    expect(longestJsonParsed()).toBeLessThan(READ_OR_TWO);

    const before: Delivered = await deliver(AS_MAIN_READ_IT, send);

    expect(outcomeOf(after)).toEqual(outcomeOf(before));
  });
});

/*
 * THE INGESTION BUDGET, WHICH MEASURES THE BODY IN REFUSE MODE. Security
 * Events' budget is decided in the key check, on the body as it arrived -
 * exactly what is admitted, and exactly what is refused, which the day's
 * dropped counter adds and the Usage page shows - so the body is read
 * there, between the key and the budget (#10722's pattern for Fluent and
 * syslog), not counted later in Check mode, which would add nothing to the
 * dropped bytes of a refused batch. A request without the right key
 * reaches no budget at all.
 */
describe("the ingestion budget, once the key is right", () => {
  beforeEach(() => {
    budgetInForce = true;
  });

  test.each([
    ["the docs' OCSF curl", CURL_OCSF, CURL_OCSF.body.length],
    [
      "Fluent Bit's records, which hold letters of two and three bytes",
      FLUENT_BIT,
      FLUENT_BIT.body.length,
    ],
    [
      "a form",
      sendNamed("a form, which StartServer parsed too"),
      sendNamed("a form, which StartServer parsed too").body.length,
    ],
  ])(
    "%s is counted in Refuse mode at its exact size, as before",
    async (_what: string, send: Send, bytes: number) => {
      const before: Delivered = await deliver(AS_MAIN_READ_IT, send);
      const after: Delivered = await deliver(ROUTE, send);

      expect(after.counted).toEqual(before.counted);
      expect(after.counted).toEqual([
        {
          projectId: PROJECT_ID.toString(),
          signalSlug: "security-events",
          mode: TelemetryIngestionBudgetCounterMode.Refuse,
          bytes: bytes,
          scopes: expect.any(Array),
        },
      ]);
      expect(outcomeOf(after)).toEqual(outcomeOf(before));
    },
  );

  test("a gzip batch is counted at its size once inflated, as before", async () => {
    for (const send of [gzipped(FLUENT_BIT), gzipped(CURL_GENERIC)]) {
      const before: Delivered = await deliver(AS_MAIN_READ_IT, send);
      const after: Delivered = await deliver(ROUTE, send);
      const inflated: number = zlib.gunzipSync(send.body).length;

      expect(after.counted).toEqual(before.counted);
      expect(
        after.counted.map((request: unknown): unknown => {
          return (request as { bytes: number }).bytes;
        }),
      ).toEqual([inflated]);
    }
  });

  test("a used-up budget refuses the batch 403, adding exactly the batch's bytes to what it dropped, as before; nothing is queued", async () => {
    counterAnswer = TelemetryIngestionBudgetCounterOutcome.DailyBudgetExhausted;

    for (const send of [CURL_GENERIC, gzipped(FLUENT_BIT)]) {
      const before: Delivered = await deliver(AS_MAIN_READ_IT, send);
      const after: Delivered = await deliver(ROUTE, send);
      const bytes: number = send.headers["content-encoding"]
        ? zlib.gunzipSync(send.body).length
        : send.body.length;

      expect(after.status).toBe(403);
      expect(after.json).toMatchObject({
        error: "daily-budget-exhausted",
        message: expect.stringContaining(
          "This project's daily security events ingestion budget of 1 GB is used up",
        ),
      });
      // The bytes the counter adds to the day's dropped: the batch's own.
      expect(after.counted).toEqual([
        {
          projectId: PROJECT_ID.toString(),
          signalSlug: "security-events",
          mode: TelemetryIngestionBudgetCounterMode.Refuse,
          bytes: bytes,
          scopes: expect.any(Array),
        },
      ]);
      expect({
        status: after.status,
        json: { ...(after.json as JSONObject), resetsAt: null },
        counted: after.counted,
      }).toEqual({
        status: before.status,
        json: { ...(before.json as JSONObject), resetsAt: null },
        counted: before.counted,
      });
      expect(after.queued).toEqual([]);
      expect(after.events).toEqual([]);
    }

    expect(refusals).toEqual([
      {
        reason: TelemetryIngestRefusalReason.ProjectDailyBudget,
        surface: TelemetryIngestSurface.SecurityEvents,
      },
      {
        reason: TelemetryIngestRefusalReason.ProjectDailyBudget,
        surface: TelemetryIngestSurface.SecurityEvents,
      },
      {
        reason: TelemetryIngestRefusalReason.ProjectDailyBudget,
        surface: TelemetryIngestSurface.SecurityEvents,
      },
      {
        reason: TelemetryIngestRefusalReason.ProjectDailyBudget,
        surface: TelemetryIngestSurface.SecurityEvents,
      },
    ]);
  });

  test("a rate refuses the batch 429 with Retry-After, counting it as before", async () => {
    rateInForce = 1;
    counterAnswer = TelemetryIngestionBudgetCounterOutcome.RateLimited;

    const before: Delivered = await deliver(AS_MAIN_READ_IT, CURL_GENERIC);
    const after: Delivered = await deliver(ROUTE, CURL_GENERIC);

    expect(after.status).toBe(429);
    expect({
      json: { ...(after.json as JSONObject), resetsAt: null },
      counted: after.counted,
    }).toEqual({
      json: { ...(before.json as JSONObject), resetsAt: null },
      counted: before.counted,
    });
    expect(after.counted).toHaveLength(1);
    expect(after.queued).toEqual([]);
  });

  test("with no key or a wrong one, no budget is asked: nothing is counted", async () => {
    for (const headers of [
      JSON_TYPE,
      { ...JSON_TYPE, "x-oneuptime-token": WRONG_KEY },
    ]) {
      for (const path of ROUTES) {
        const sent: SentRequest = await sendOverHttp(server, {
          path: path,
          headers: headers,
          body: unkeyedJson,
        });

        expect(sent.answer.status).toBe(401);
      }
    }

    expect(counted).toEqual([]);
  });
});

/*
 * #10703: a request with no key, or a key no key has, comes from anyone.
 * Each is a debug line and a count by surface, logged at warn at most once
 * a minute; a known key's refusal is counted against it, by why and where.
 */
describe("refused keys are logged at debug, and counted", () => {
  test("a burst of 20 requests with no key and 20 with a wrong one writes no error line, one warn line, and a debug line each", async () => {
    for (let index: number = 0; index < 20; index++) {
      await sendOverHttp(server, {
        path: ROUTES[index % ROUTES.length]!,
        headers: JSON_TYPE,
        body: CURL_GENERIC.body,
      });
      await sendOverHttp(server, {
        path: ROUTES[index % ROUTES.length]!,
        headers: { ...JSON_TYPE, "x-oneuptime-token": WRONG_KEY },
        body: CURL_GENERIC.body,
      });
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
    ).toHaveLength(20);
    expect(
      lines("debug").filter((line: string): boolean => {
        return line === "Invalid service token.";
      }),
    ).toHaveLength(20);
    // The first of the minute, with what was counted: one line.
    expect(lines("warn")).toEqual([
      "TelemetryIngest: refused 1 request with no ingestion key (security-events: 1). Each is logged at debug; these counts at most once a minute.",
    ]);
    // The rest are counted, by surface, for the next line.
    expect(
      Object.fromEntries(TelemetryIngestUnknownKeyRefusals.getCounts()),
    ).toEqual({
      "missing|security-events": 19,
      "unknown|security-events": 20,
    });
    expectNothingTaken();

    // No token is ever logged.
    for (const level of ["error", "warn", "info", "debug"] as const) {
      expect(
        JSON.stringify((logger[level] as unknown as jest.Mock).mock.calls),
      ).not.toContain(WRONG_KEY);
    }
  });

  test("a known key refused for what it is - switched off, expired, a browser's or a mobile app's, over its rate - is counted against it, by why, on Security Events, and logged at debug", async () => {
    for (const refusal of REFUSALS.slice(2)) {
      const sent: SentRequest = await sendOverHttp(server, {
        path: ROUTE,
        headers: refusal.headers,
        body: CURL_GENERIC.body,
      });

      expect({ what: refusal.what, status: sent.answer.status }).toEqual({
        what: refusal.what,
        status: refusal.status,
      });
    }

    expect(refusals).toEqual([
      {
        reason: TelemetryIngestRefusalReason.KeyDisabled,
        surface: TelemetryIngestSurface.SecurityEvents,
      },
      {
        reason: TelemetryIngestRefusalReason.KeyExpired,
        surface: TelemetryIngestSurface.SecurityEvents,
      },
      {
        reason: TelemetryIngestRefusalReason.BrowserKeyNotAllowedHere,
        surface: TelemetryIngestSurface.SecurityEvents,
      },
      {
        reason: TelemetryIngestRefusalReason.MobileKeyNotAllowedHere,
        surface: TelemetryIngestSurface.SecurityEvents,
      },
      {
        reason: TelemetryIngestRefusalReason.KeyRequestsPerMinute,
        surface: TelemetryIngestSurface.SecurityEvents,
      },
    ]);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
    expectNothingTaken();
  });
});
