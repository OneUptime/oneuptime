import OTelIngestAPI from "../../FeatureSet/Telemetry/API/OTelIngest";
import VercelLogDrainAPI from "../../FeatureSet/Telemetry/API/VercelLogDrain";
import {
  IngestMetricsSignal,
  ingestMetricsMiddleware,
} from "../../FeatureSet/Telemetry/Middleware/IngestRequestMetrics";
import OpenTelemetryRequestMiddleware from "../../FeatureSet/Telemetry/Middleware/OtelRequestMiddleware";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import OtelProfilesIngestService from "../../FeatureSet/Telemetry/Services/OtelProfilesIngestService";
import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import VercelLogDrainIngestService from "../../FeatureSet/Telemetry/Services/VercelLogDrainIngestService";
import TelemetryBodyStore from "../../FeatureSet/Telemetry/Utils/TelemetryBodyStore";
import Queue from "Common/Server/Infrastructure/Queue";
import TelemetryIngest from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import VercelSignature, {
  VERCEL_SIGNATURE_HEADER,
} from "Common/Server/Utils/Marketplace/Vercel/VercelSignature";
import {
  expressErrorHandler,
  isVercelLogDrainPath,
} from "Common/Server/Utils/StartServer";
import AppMetrics from "Common/Server/Utils/Telemetry/AppMetrics";
import TelemetryIngestAttributionSettings from "Common/Server/Utils/Telemetry/TelemetryIngestAttributionSettings";
import TelemetryIngestionBudgetCounter, {
  TelemetryIngestionBudgetCounterDecision,
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
  KIB,
  MIB,
  READ_OR_TWO,
  SentRequest,
  sendOverHttp,
  sendWithFetch,
  startBodyServer,
} from "Common/Tests/Server/TestingUtils/RequestBodyOverHttp";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import {
  getEmptyTelemetryIngestionBudgetStoredSettings,
  TelemetryIngestionBudgetStoredSettings,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
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
import http from "http";
import { Readable } from "stream";
import zlib from "zlib";

/*
 * OTLP/HTTP AND THE VERCEL LOG DRAIN READ A BODY ONLY ONCE ITS INGEST KEY IS
 * RIGHT (#10814), over HTTP, through StartServer's own middleware - as the
 * App mounts it - the real routers, the real key check and ingestion budget
 * gate, and the real handlers and queue, with real clients. Only the key
 * lookup, the key's rate, the budget's settings and counter, the body store
 * and the queue are stubbed.
 *
 * StartServer leaves both to their own reader by their paths
 * (OpenTelemetryRequestMiddleware.parseBody: the bytes raw, held to 50 MiB,
 * a coding the worker cannot undo refused 415), and both ran it before the
 * key check: up to 50 MiB buffered for a client with no key at all, and the
 * Vercel drain inflated a compressed delivery to check Vercel's signature
 * over it. Every exporter, and every drain, sends its key in a header, so
 * the key is checked first now and the body read in the key check, between
 * the key and the ingestion budget, which measures it.
 *
 * How main read them is here too: main's chains, built of the same parts in
 * the same order, under a prefix StartServer leaves to them as well
 * (AS_MAIN_READ_IT). Every request is sent both ways: what a sender with the
 * right key sends is stored, queued and counted alike, and what is refused
 * is refused in the same words - but a request without the right key, which
 * main read first.
 */

jest.setTimeout(300000);

const KEY: string = "10814000-0000-4000-8000-000000010814";
const WRONG_KEY: string = "00000000-0000-4000-8000-000000000000";

// Keys that are known, each refused for what it is.
const DISABLED_KEY: string = "10814000-0000-4000-8000-0000000d15ab";
const EXPIRED_KEY: string = "10814000-0000-4000-8000-0000000e4b1d";
const BROWSER_KEY: string = "10814000-0000-4000-8000-0000000b4053";
const MOBILE_KEY: string = "10814000-0000-4000-8000-00000000b11e";
const RATE_LIMITED_KEY: string = "10814000-0000-4000-8000-0000000004a7";

// A prefix StartServer leaves OTLP's and the drain's paths unread under.
const AS_MAIN_READ_IT: string = "/as-main-read-it";

// What a client sends of a body refused for its key: far more than is read.
const UNKEYED: number = 40 * MIB;

// What a client sends of a body over OTLP's cap.
const OVER: number = 64 * MIB;

const MISSING_KEY: JSONObject = {
  message:
    "Missing ingestion token. Send your OneUptime telemetry ingestion key in the x-oneuptime-token header.",
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

const RANDOM: SeededRandom = seededRandom(10814);

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

const TOKEN: Record<string, string> = { "x-oneuptime-token": KEY };
const JSON_TYPE: Record<string, string> = {
  "content-type": "application/json",
};
const PROTOBUF_TYPE: Record<string, string> = {
  "content-type": "application/x-protobuf",
};

interface Send {
  // Who sends it so.
  how: string;
  headers: Record<string, string>;
  body: Buffer;
}

const LOGS_EXPORT: Buffer = json({
  resourceLogs: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "checkout" } },
        ],
      },
      scopeLogs: [
        {
          logRecords: [
            {
              timeUnixNano: "1763890000123456789",
              body: { stringValue: "order placed for jürgen" },
            },
          ],
        },
      ],
    },
  ],
});

const TRACES_EXPORT: Buffer = json({
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "checkout" } },
        ],
      },
      scopeSpans: [
        {
          spans: [
            {
              traceId: "5b8efff798038103d269b633813fc60c",
              spanId: "eee19b7ec3c1b174",
              name: "POST /orders",
              startTimeUnixNano: "1763890000000000000",
              endTimeUnixNano: "1763890000123456789",
            },
          ],
        },
      ],
    },
  ],
});

const METRICS_EXPORT: Buffer = json({
  resourceMetrics: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "checkout" } },
        ],
      },
      scopeMetrics: [
        {
          metrics: [
            {
              name: "orders.placed",
              sum: {
                dataPoints: [
                  { asInt: "3", timeUnixNano: "1763890000000000000" },
                ],
                aggregationTemporality: 2,
                isMonotonic: true,
              },
            },
          ],
        },
      ],
    },
  ],
});

// A Vercel delivery: its records, as a JSON array.
const VERCEL_RECORDS: Array<JSONObject> = [
  {
    id: "1573817187330377061717300000",
    message: "GET /api/orders 200",
    timestamp: 1763890000123,
    source: "lambda",
    projectId: "prj_10814",
    deploymentId: "dpl_10814",
    host: "shop.vercel.app",
    path: "/api/orders",
    level: "info",
  },
  {
    id: "1573817187330377061717300001",
    message: "payment declined for jürgen",
    timestamp: 1763890001123,
    source: "lambda",
    projectId: "prj_10814",
    deploymentId: "dpl_10814",
    level: "error",
  },
];

const VERCEL_JSON: Buffer = json(VERCEL_RECORDS);
const VERCEL_NDJSON: Buffer = Buffer.from(
  `${VERCEL_RECORDS.map((record: JSONObject): string => {
    return JSON.stringify(record);
  }).join("\n")}\n`,
);

/*
 * Signed as Vercel signs a delivery, HMAC-SHA1 of the bytes, with the
 * secret a drain set up by hand has: its ingestion key.
 */
const signedOver: (
  bytes: Buffer,
  secret?: string | undefined,
) => Record<string, string> = (
  bytes: Buffer,
  secret?: string | undefined,
): Record<string, string> => {
  return {
    [VERCEL_SIGNATURE_HEADER]: VercelSignature.sign(bytes, secret || KEY),
  };
};

interface IngestRoute {
  name: string;
  // The route, under the root; its router is mounted under /telemetry too.
  path: string;
  surface: TelemetryIngestSurface;
  // What its senders send, each taken.
  sends: Array<Send>;
  // A content type its body may be: what a client with no key sends.
  contentType: string;
  // Main's chain for it, built of the same parts.
  mainChain: Array<RequestHandler>;
}

// The handler a route runs once its key and body are through.
const handlerOf: (
  handle: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void>,
) => RequestHandler = (
  handle: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void>,
): RequestHandler => {
  return (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return handle(req, res, next);
  };
};

// An OTLP route as main mounted it: its body read before the key check.
const mainOtlpChain: (
  signal: IngestMetricsSignal,
  surface: TelemetryIngestSurface,
  handle: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void>,
) => Array<RequestHandler> = (
  signal: IngestMetricsSignal,
  surface: TelemetryIngestSurface,
  handle: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void>,
): Array<RequestHandler> => {
  return [
    TelemetryIngestionDisabled.middleware,
    OpenTelemetryRequestMiddleware.parseBody,
    ingestMetricsMiddleware(signal),
    OpenTelemetryRequestMiddleware.getProductType,
    TelemetryIngest.forSurface(surface),
    handlerOf(handle),
  ];
};

const otlpSends: (exported: Buffer) => Array<Send> = (
  exported: Buffer,
): Array<Send> => {
  return [
    {
      how: "an OTLP/JSON export, as an SDK posts it",
      headers: { ...JSON_TYPE, ...TOKEN },
      body: exported,
    },
    {
      how: "the same gzip-compressed, as the Collector's otlphttp exporter posts it",
      headers: { ...JSON_TYPE, ...TOKEN, "content-encoding": "gzip" },
      body: zlib.gzipSync(exported),
    },
    {
      how: "protobuf, which the worker decodes, stored as it came",
      headers: { ...PROTOBUF_TYPE, ...TOKEN },
      body: noise(4 * KIB),
    },
    {
      how: "protobuf deflate-compressed",
      headers: { ...PROTOBUF_TYPE, ...TOKEN, "content-encoding": "deflate" },
      body: zlib.deflateSync(noise(4 * KIB)),
    },
  ];
};

const OTLP_ROUTES: Array<IngestRoute> = [
  {
    name: "OTLP traces",
    path: "/otlp/v1/traces",
    surface: TelemetryIngestSurface.OtelTraces,
    sends: otlpSends(TRACES_EXPORT),
    contentType: "application/x-protobuf",
    mainChain: mainOtlpChain(
      "traces",
      TelemetryIngestSurface.OtelTraces,
      (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        return OtelTracesIngestService.ingestTraces(req, res, next);
      },
    ),
  },
  {
    name: "OTLP metrics",
    path: "/otlp/v1/metrics",
    surface: TelemetryIngestSurface.OtelMetrics,
    sends: otlpSends(METRICS_EXPORT),
    contentType: "application/x-protobuf",
    mainChain: mainOtlpChain(
      "metrics",
      TelemetryIngestSurface.OtelMetrics,
      (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        return OtelMetricsIngestService.ingestMetrics(req, res, next);
      },
    ),
  },
  {
    name: "OTLP logs",
    path: "/otlp/v1/logs",
    surface: TelemetryIngestSurface.OtelLogs,
    sends: otlpSends(LOGS_EXPORT),
    contentType: "application/json",
    mainChain: mainOtlpChain(
      "logs",
      TelemetryIngestSurface.OtelLogs,
      (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        return OtelLogsIngestService.ingestLogs(req, res, next);
      },
    ),
  },
  {
    name: "OTLP profiles",
    path: "/otlp/v1/profiles",
    surface: TelemetryIngestSurface.OtelProfiles,
    sends: [
      {
        how: "an OTLP profiles export, protobuf, as the eBPF profiler posts it",
        headers: { ...PROTOBUF_TYPE, ...TOKEN },
        body: noise(4 * KIB),
      },
      {
        how: "the same gzip-compressed",
        headers: { ...PROTOBUF_TYPE, ...TOKEN, "content-encoding": "gzip" },
        body: zlib.gzipSync(noise(4 * KIB)),
      },
    ],
    contentType: "application/x-protobuf",
    mainChain: mainOtlpChain(
      "profiles",
      TelemetryIngestSurface.OtelProfiles,
      (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        return OtelProfilesIngestService.ingestProfiles(req, res, next);
      },
    ),
  },
];

const VERCEL_ROUTE: IngestRoute = {
  name: "the Vercel log drain",
  path: "/vercel/v1/logs",
  surface: TelemetryIngestSurface.VercelLogDrain,
  sends: [
    {
      how: "a delivery of records as a JSON array, signed with the key, as a drain set up by hand posts it",
      headers: { ...JSON_TYPE, ...TOKEN, ...signedOver(VERCEL_JSON) },
      body: VERCEL_JSON,
    },
    {
      how: "the records as NDJSON",
      headers: {
        "content-type": "application/x-ndjson",
        ...TOKEN,
        ...signedOver(VERCEL_NDJSON),
      },
      body: VERCEL_NDJSON,
    },
    {
      how: "a gzip delivery signed over its bytes as sent",
      headers: {
        ...JSON_TYPE,
        ...TOKEN,
        "content-encoding": "gzip",
        ...signedOver(zlib.gzipSync(VERCEL_JSON)),
      },
      body: zlib.gzipSync(VERCEL_JSON),
    },
    {
      how: "a gzip delivery signed over its records, inflated to check it",
      headers: {
        ...JSON_TYPE,
        ...TOKEN,
        "content-encoding": "gzip",
        ...signedOver(VERCEL_JSON),
      },
      body: zlib.gzipSync(VERCEL_JSON),
    },
  ],
  contentType: "application/json",
  mainChain: [
    TelemetryIngestionDisabled.middleware,
    OpenTelemetryRequestMiddleware.parseBody,
    VercelLogDrainIngestService.verifySignature,
    VercelLogDrainIngestService.setProductType,
    TelemetryIngest.forSurface(TelemetryIngestSurface.VercelLogDrain),
    handlerOf(
      (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        return VercelLogDrainIngestService.ingest(req, res, next);
      },
    ),
  ],
};

const ROUTES: Array<IngestRoute> = [...OTLP_ROUTES, VERCEL_ROUTE];

// Main's path for a route: StartServer leaves both kinds unread there too.
const mainPathOf: (route: IngestRoute) => string = (
  route: IngestRoute,
): string => {
  return route === VERCEL_ROUTE
    ? `${AS_MAIN_READ_IT}/telemetry${route.path}`
    : `${AS_MAIN_READ_IT}${route.path}`;
};

/*
 * What zlib inflated, counted where its streams hand their output on, and
 * what had been read of a request's body when its key was checked.
 */
const watched: { inflated: number } = { inflated: 0 };
const readablePush: Readable["push"] = Readable.prototype.push;

const ZLIB_STREAMS: Array<{ push: Readable["push"] }> = [
  (zlib as unknown as { Gunzip: { prototype: { push: Readable["push"] } } })
    .Gunzip.prototype,
  (zlib as unknown as { Inflate: { prototype: { push: Readable["push"] } } })
    .Inflate.prototype,
];

let watchers: Array<ReturnType<typeof jest.spyOn>> = [];

// The budget's counter: every decision it was asked for, and its answer.
const counted: Array<TelemetryIngestionBudgetCounterRequest> = [];
let counterAnswer: TelemetryIngestionBudgetCounterOutcome =
  TelemetryIngestionBudgetCounterOutcome.Admitted;
let budgetInForce: boolean = false;

const budgetOf: () => TelemetryIngestionBudgetStoredSettings =
  (): TelemetryIngestionBudgetStoredSettings => {
    const settings: TelemetryIngestionBudgetStoredSettings =
      getEmptyTelemetryIngestionBudgetStoredSettings();

    for (const signal of [
      ProductType.Traces,
      ProductType.Metrics,
      ProductType.Logs,
      ProductType.Profiles,
    ] as const) {
      settings[signal] = { dailyBudgetInGB: 1, rateLimitInMBPerSecond: null };
    }

    return settings;
  };

// What the body store was given, and the jobs queued, as Redis holds them.
const stored: Array<string> = [];
const queued: Array<JSONObject> = [];

// The ingest metrics: each request's outcome, and each payload's size.
const outcomes: Array<Record<string, string>> = [];
const payloadSizes: Array<{ bytes: number; surface: string }> = [];

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
    .mockImplementation((): void => {});

  // The ingestion budget: none in force unless a test sets one.
  jest
    .spyOn(TelemetryIngestionBudgetSettings, "getInstanceSettings")
    .mockImplementation(async () => {
      return {
        budgets: budgetInForce
          ? budgetOf()
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
        };
      },
    );
  jest
    .spyOn(TelemetryIngestAttributionSettings, "isAttributedProject")
    .mockResolvedValue(false);
  jest
    .spyOn(TelemetryIngestAttributionSettings, "getTeamLabelBudgetProjects")
    .mockResolvedValue(new Set<string>());

  // Where a taken export goes: its bytes to the body store, its job queued.
  jest
    .spyOn(TelemetryBodyStore, "storeBody")
    .mockImplementation(async (buffer: Buffer): Promise<string> => {
      stored.push(buffer.toString("hex"));
      return `telemetry:body:${stored.length}`;
    });
  jest.spyOn(Queue, "addJob").mockImplementation((async (
    _queueName: unknown,
    _jobId: unknown,
    _jobName: unknown,
    data: JSONObject,
  ) => {
    queued.push(data);
    return {};
  }) as never);

  // The ingest metrics.
  jest.spyOn(AppMetrics, "getIngestCounter").mockReturnValue({
    add: (_value: number, attributes: Record<string, string>): void => {
      outcomes.push(attributes);
    },
  } as unknown as ReturnType<typeof AppMetrics.getIngestCounter>);
  jest.spyOn(AppMetrics, "getIngestDuration").mockReturnValue({
    record: (): void => {},
  } as unknown as ReturnType<typeof AppMetrics.getIngestDuration>);
  jest.spyOn(AppMetrics, "getIngestPayloadBytes").mockReturnValue({
    record: (bytes: number, attributes: Record<string, string>): void => {
      payloadSizes.push({
        bytes: bytes,
        surface: attributes["telemetry.surface"]!,
      });
    },
  } as unknown as ReturnType<typeof AppMetrics.getIngestPayloadBytes>);

  // The App's own express app: importing StartServer mounted its middleware.
  const app: ExpressApplication = Express.getExpressApp();

  app.use(["/telemetry", "/"], OTelIngestAPI);
  app.use(["/telemetry", "/"], VercelLogDrainAPI);

  for (const route of ROUTES) {
    app.post(mainPathOf(route), ...route.mainChain);
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

  counted.length = 0;
  stored.length = 0;
  queued.length = 0;
  outcomes.length = 0;
  payloadSizes.length = 0;
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
});

afterEach(() => {
  for (const watcher of watchers) {
    watcher.mockRestore();
  }

  watchers = [];
});

/*
 * A job without what the clock and the body store set: when it arrived, its
 * id, and the key its body was stored under. A Vercel delivery's OTLP logs
 * carry the moment they were observed.
 */
const withoutTheClock: (value: unknown) => unknown = (
  value: unknown,
): unknown => {
  if (Array.isArray(value)) {
    return value.map(withoutTheClock);
  }

  if (value && typeof value === "object") {
    const kept: Record<string, unknown> = {};

    for (const [key, field] of Object.entries(value as JSONObject)) {
      if (
        ["ingestionTimestamp", "bodyKey", "observedTimeUnixNano"].includes(key)
      ) {
        continue;
      }

      kept[key] = withoutTheClock(field);
    }

    return kept;
  }

  return value;
};

// A stored body, without what the clock set in it.
const storedWithoutTheClock: (hex: string) => unknown = (
  hex: string,
): unknown => {
  const text: string = Buffer.from(hex, "hex").toString("utf8");

  try {
    return withoutTheClock(JSON.parse(text));
  } catch {
    return hex;
  }
};

interface Delivered {
  status: number | null;
  json: unknown;
  stored: Array<unknown>;
  queued: Array<unknown>;
  counted: Array<unknown>;
  sent: SentRequest;
}

const deliver: (
  path: string,
  send: Send,
  options?: { connection?: Connection; chunked?: boolean } | undefined,
) => Promise<Delivered> = async (
  path: string,
  send: Send,
  options?: { connection?: Connection; chunked?: boolean } | undefined,
): Promise<Delivered> => {
  stored.length = 0;
  queued.length = 0;
  counted.length = 0;

  const sent: SentRequest = await sendOverHttp(server, {
    path: path,
    headers: send.headers,
    connection: options?.connection,
    chunked: options?.chunked,
    body: send.body,
  });

  // Once the server is done with it: its answer sent and its metrics in.
  await server.readInAll(sent.tag);

  return {
    status: sent.answer.status,
    json: sent.answer.json,
    stored: stored.splice(0, stored.length).map(storedWithoutTheClock),
    queued: queued.splice(0, queued.length).map(withoutTheClock),
    counted: counted
      .splice(0, counted.length)
      .map((request: TelemetryIngestionBudgetCounterRequest): unknown => {
        return {
          projectId: request.projectId,
          signalSlug: request.signalSlug,
          mode: request.mode,
          bytes: request.bytes,
          scopes: request.scopes,
        };
      }),
    sent: sent,
  };
};

const outcomeOf: (delivered: Delivered) => unknown = (
  delivered: Delivered,
): unknown => {
  return {
    status: delivered.status,
    json: delivered.json,
    stored: delivered.stored,
    queued: delivered.queued,
    counted: delivered.counted,
  };
};

const expectNothingTaken: () => void = (): void => {
  expect(stored).toEqual([]);
  expect(queued).toEqual([]);
};

describe("the routes", () => {
  test("StartServer leaves their bodies to them under both prefixes, and under main's", () => {
    for (const route of ROUTES) {
      for (const path of [
        route.path,
        `/telemetry${route.path}`,
        mainPathOf(route),
      ]) {
        expect({
          path,
          leftToTheRoute:
            path.includes("/otlp/v1/") || isVercelLogDrainPath(path),
        }).toEqual({ path, leftToTheRoute: true });
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
    "with the right key, %s is taken as main took it - stored, queued and counted alike - declared and chunked, on kept and closed connections",
    async (_how: string, send: Send) => {
      budgetInForce = true;

      const before: Delivered = await deliver(mainPathOf(route), send);

      expect(before.status).toBe(200);
      expect(before.queued).toHaveLength(1);

      for (const prefix of ["", "/telemetry"]) {
        for (const connection of CONNECTIONS) {
          for (const chunked of [false, true]) {
            const after: Delivered = await deliver(
              `${prefix}${route.path}`,
              send,
              { connection, chunked },
            );

            expect({
              prefix,
              connection,
              chunked,
              outcome: outcomeOf(after),
            }).toEqual({
              prefix,
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

  test.each([...CONNECTIONS])(
    "with no key, 40 MiB are refused, declared or chunked, with a socket read or two read: nothing stored, queued or counted (%s)",
    async (connection: Connection) => {
      budgetInForce = true;

      for (const prefix of ["", "/telemetry"]) {
        for (const chunked of [false, true]) {
          const sent: SentRequest = await sendOverHttp(server, {
            path: `${prefix}${route.path}`,
            headers: { "content-type": route.contentType },
            connection: connection,
            chunked: chunked,
            bytes: UNKEYED,
            fill: 0x61,
          });

          expect({
            status: sent.answer.status,
            json: sent.answer.json,
          }).toEqual({ status: 401, json: MISSING_KEY });
          expect(sent.answer.clientError).toBeNull();
          // Closed under the rest, which is never read.
          expect(sent.answer.connection).toBe("close");
          expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(
            READ_OR_TWO,
          );
        }
      }

      expect(counted).toEqual([]);
      expectNothingTaken();
    },
  );

  test("main read all 40 MiB of a request with no key before it refused it", async () => {
    const before: SentRequest = await sendOverHttp(server, {
      path: mainPathOf(route),
      headers: { "content-type": route.contentType },
      bytes: UNKEYED,
      fill: 0x61,
    });

    // The drain checked Vercel's signature first, and refused it 403.
    expect(before.answer.status).toBe(route === VERCEL_ROUTE ? 403 : 401);
    expect(await server.readInAll(before.tag)).toBeGreaterThanOrEqual(UNKEYED);
  });

  test("with a wrong key, 40 MiB are refused alike, unread", async () => {
    const sent: SentRequest = await sendOverHttp(server, {
      path: route.path,
      headers: {
        "content-type": route.contentType,
        "x-oneuptime-token": WRONG_KEY,
      },
      bytes: UNKEYED,
      fill: 0x61,
    });

    expect(sent.answer.status).toBe(401);
    expect(sent.answer.connection).toBe("close");
    expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(READ_OR_TWO);
    expectNothingTaken();
  });

  test("with no key, a request is answered while its upload is still in flight: nothing waits for its body", async () => {
    // Declared at 8 MiB; the headers and a first 64 KiB, and never the rest.
    const request: http.ClientRequest = http.request({
      host: "127.0.0.1",
      port: server.port,
      method: "POST",
      path: route.path,
      headers: {
        "content-type": route.contentType,
        "content-length": 8 * MIB,
      },
    });
    // Destroying the socket mid-upload, below, raises one on the client.
    request.on("error", (): void => {});

    const answered: Promise<number> = new Promise<number>(
      (resolve: (status: number) => void): void => {
        request.on("response", (response: http.IncomingMessage): void => {
          response.resume();
          resolve(response.statusCode ?? 0);
        });
      },
    );

    let timer: NodeJS.Timeout | undefined;
    const timedOut: Promise<number> = new Promise<number>(
      (_resolve: (status: number) => void, reject: (e: Error) => void) => {
        timer = setTimeout((): void => {
          reject(new Error("no answer while the body was in flight"));
        }, 10_000);
      },
    );

    request.write(Buffer.alloc(64 * KIB, 0x61));

    let status: number;

    try {
      status = await Promise.race([answered, timedOut]);
    } finally {
      clearTimeout(timer);
      // Only now is the upload abandoned: it was still open when answered.
      expect(request.writableEnded).toBe(false);
      request.destroy();
    }

    expect(status).toBe(401);
    expectNothingTaken();
  });

  test("with fetch and no key: the refusal is read, the rest unread", async () => {
    const sent: SentRequest = await sendWithFetch(server, {
      path: route.path,
      headers: { "content-type": route.contentType },
      bytes: UNKEYED,
    });

    expect(sent.answer.clientError).toBeNull();
    expect(sent.answer.status).toBe(401);
    expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(READ_OR_TWO);
  });

  test("with the right key, over OTLP's 50 MiB: refused 413 as main refused it, unread when declared", async () => {
    const overTheCap: (
      path: string,
      chunked: boolean,
    ) => Promise<SentRequest> = (
      path: string,
      chunked: boolean,
    ): Promise<SentRequest> => {
      return sendOverHttp(server, {
        path: path,
        headers: { "content-type": route.contentType, ...TOKEN },
        chunked: chunked,
        bytes: OVER,
        fill: 0x61,
      });
    };

    // Declared: refused on its Content-Length, in the same words.
    const declared: SentRequest = await overTheCap(route.path, false);
    const declaredBefore: SentRequest = await overTheCap(
      mainPathOf(route),
      false,
    );

    expect({
      status: declared.answer.status,
      json: declared.answer.json,
    }).toEqual({
      status: declaredBefore.answer.status,
      json: declaredBefore.answer.json,
    });
    expect(declared.answer.status).toBe(413);
    expect(await server.readInAll(declared.tag)).toBeLessThanOrEqual(
      READ_OR_TWO,
    );

    /*
     * Chunked: refused once it passes the cap. Its words name how much had
     * arrived by then, which the sockets' reads decide.
     */
    const chunked: SentRequest = await overTheCap(route.path, true);
    const chunkedBefore: SentRequest = await overTheCap(
      mainPathOf(route),
      true,
    );

    for (const answer of [chunked.answer, chunkedBefore.answer]) {
      expect({ status: answer.status, json: answer.json }).toEqual({
        status: 413,
        json: {
          error: "payload-too-large",
          message: expect.stringContaining(
            "An OTLP ingest request may not exceed 52428800 bytes.",
          ),
        },
      });
    }

    expectNothingTaken();
  });

  test("with the right key, a coding the worker cannot undo is refused 415 in the same words, before a byte is read", async () => {
    const send: Send = {
      how: "brotli",
      headers: {
        "content-type": route.contentType,
        "content-encoding": "br",
        ...TOKEN,
      },
      body: noise(KIB),
    };

    const after: Delivered = await deliver(route.path, send);
    const before: Delivered = await deliver(mainPathOf(route), send);

    expect(after.status).toBe(415);
    expect(outcomeOf(after)).toEqual(outcomeOf(before));
  });

  test("with no key, a coding the worker cannot undo is refused 401 now, its key first: main refused it 415", async () => {
    const send: Send = {
      how: "brotli, with no key",
      headers: { "content-type": route.contentType, "content-encoding": "br" },
      body: noise(KIB),
    };

    const after: Delivered = await deliver(route.path, send);
    const before: Delivered = await deliver(mainPathOf(route), send);

    expect({ status: after.status, json: after.json }).toEqual({
      status: 401,
      json: MISSING_KEY,
    });
    expect(before.status).toBe(415);
  });

  test("a used-up budget refuses an export as main did, counting exactly what it refused, and nothing is stored", async () => {
    budgetInForce = true;
    counterAnswer = TelemetryIngestionBudgetCounterOutcome.DailyBudgetExhausted;

    for (const send of route.sends) {
      const after: Delivered = await deliver(route.path, send);
      const before: Delivered = await deliver(mainPathOf(route), send);

      expect(after.status).toBe(403);
      expect({
        how: send.how,
        counted: after.counted,
        stored: after.stored,
        queued: after.queued,
      }).toEqual({
        how: send.how,
        counted: before.counted,
        stored: [],
        queued: [],
      });
      expect(after.counted).toHaveLength(1);
      expect(after.sent.answer.text).toBe(before.sent.answer.text);
    }
  });
});

/*
 * Every other way a key is refused - one switched off or expired, a
 * browser's from an origin it does not list, a mobile app's from a web page,
 * one over its rate - is refused before a byte is read, in the words main
 * refused it in. Spread over the routes: the server closes under each
 * refused body after a grace, which each request waits out.
 */
interface Refusal {
  what: string;
  headers: Record<string, string>;
  route: IngestRoute;
}

const REFUSALS: Array<Refusal> = [
  {
    what: "a key switched off",
    headers: { "x-oneuptime-token": DISABLED_KEY },
    route: OTLP_ROUTES[0]!,
  },
  {
    what: "an expired key",
    headers: { "x-oneuptime-token": EXPIRED_KEY },
    route: VERCEL_ROUTE,
  },
  {
    what: "a browser key, from an origin it does not list",
    headers: {
      "x-oneuptime-token": BROWSER_KEY,
      origin: "https://elsewhere.example.com",
    },
    route: OTLP_ROUTES[2]!,
  },
  {
    what: "a browser key, on the drain",
    headers: {
      "x-oneuptime-token": BROWSER_KEY,
      origin: "https://shop.example.com",
    },
    route: VERCEL_ROUTE,
  },
  {
    what: "a mobile key, from a web page",
    headers: {
      "x-oneuptime-token": MOBILE_KEY,
      origin: "https://shop.example.com",
    },
    route: OTLP_ROUTES[1]!,
  },
  {
    what: "a key over its rate",
    headers: { "x-oneuptime-token": RATE_LIMITED_KEY },
    route: OTLP_ROUTES[3]!,
  },
];

describe.each(REFUSALS)("$what, on $route.name", (refusal: Refusal) => {
  test("40 MiB are refused with a socket read or two read, in the words main refused them in", async () => {
    budgetInForce = true;

    const body: Buffer = refusal.route.sends[0]!.body;
    const headers: Record<string, string> = {
      "content-type": refusal.route.contentType,
      ...refusal.headers,
      /*
       * Signed by Vercel with the key it carries: main checked the
       * signature first, and the key only for a delivery Vercel signed.
       */
      ...(refusal.route === VERCEL_ROUTE
        ? signedOver(body, refusal.headers["x-oneuptime-token"])
        : {}),
    };
    const before: SentRequest = await sendOverHttp(server, {
      path: mainPathOf(refusal.route),
      headers: headers,
      body: body,
    });

    expect(before.answer.status).not.toBe(200);

    const sent: SentRequest = await sendOverHttp(server, {
      path: refusal.route.path,
      headers: headers,
      bytes: UNKEYED,
      fill: 0x61,
    });

    expect({ status: sent.answer.status, json: sent.answer.json }).toEqual({
      status: before.answer.status,
      json: before.answer.json,
    });
    expect(sent.answer.connection).toBe("close");
    expect(await server.readInAll(sent.tag)).toBeLessThanOrEqual(READ_OR_TWO);
    expect(counted).toEqual([]);
    expectNothingTaken();
  });
});

/*
 * The drain's own proof, Vercel's signature over the body, is checked once
 * the key is right, as it was checked for anyone before: a delivery Vercel
 * did not sign is refused 403 in the same words, its bytes inflated only for
 * a request whose key is right.
 */
describe("the Vercel log drain's signature", () => {
  const unsigned: Send = {
    how: "a delivery signed with another secret",
    headers: {
      ...JSON_TYPE,
      ...TOKEN,
      [VERCEL_SIGNATURE_HEADER]: VercelSignature.sign(VERCEL_JSON, "not it"),
    },
    body: VERCEL_JSON,
  };

  test("a delivery with the right key that Vercel did not sign is refused 403 in the same words, nothing stored", async () => {
    for (const send of [
      unsigned,
      {
        how: "gzip, signed with another secret",
        headers: {
          ...unsigned.headers,
          "content-encoding": "gzip",
        },
        body: zlib.gzipSync(VERCEL_JSON),
      },
    ]) {
      const after: Delivered = await deliver(VERCEL_ROUTE.path, send);
      const before: Delivered = await deliver(mainPathOf(VERCEL_ROUTE), send);

      expect(after.status).toBe(403);
      expect(outcomeOf(after)).toEqual(outcomeOf(before));
    }
  });

  test("with no key, a delivery Vercel did not sign is refused 401 now, nothing inflated: main inflated it to refuse it 403", async () => {
    const send: Send = {
      how: "gzip with no key, signed with another secret",
      headers: {
        ...JSON_TYPE,
        "content-encoding": "gzip",
        [VERCEL_SIGNATURE_HEADER]: VercelSignature.sign(VERCEL_JSON, "not it"),
      },
      body: zlib.gzipSync(Buffer.alloc(4 * MIB, 0x61)),
    };

    const after: Delivered = await deliver(VERCEL_ROUTE.path, send);

    expect({ status: after.status, json: after.json }).toEqual({
      status: 401,
      json: MISSING_KEY,
    });
    expect(watched.inflated).toBe(0);

    const before: Delivered = await deliver(mainPathOf(VERCEL_ROUTE), send);

    expect(before.status).toBe(403);
    expect(watched.inflated).toBeGreaterThanOrEqual(4 * MIB);
    expectNothingTaken();
  });
});

/*
 * OneUptime's own ingest metrics, mounted before the key check as before:
 * every request is counted by its outcome, a refused key's as rejected. The
 * payload's size is recorded once the body is read, as a compatible
 * endpoint's is - so a request refused for its key, whose body is not read,
 * has none now.
 */
describe("OTLP's ingest metrics", () => {
  test("an export taken is counted accepted, its payload's size as main recorded it", async () => {
    const send: Send = OTLP_ROUTES[2]!.sends[1]!;

    await deliver(OTLP_ROUTES[2]!.path, send);
    const after: unknown = {
      outcomes: outcomes.splice(0, outcomes.length),
      sizes: payloadSizes.splice(0, payloadSizes.length),
    };

    await deliver(mainPathOf(OTLP_ROUTES[2]!), send);
    const before: unknown = {
      outcomes: outcomes.splice(0, outcomes.length),
      sizes: payloadSizes.splice(0, payloadSizes.length),
    };

    expect(after).toEqual(before);
    expect(after).toEqual({
      outcomes: [
        {
          "telemetry.signal": "logs",
          "telemetry.surface": "otel-logs",
          outcome: "accepted",
        },
      ],
      sizes: [{ bytes: send.body.length, surface: "otel-logs" }],
    });
  });

  test("a request with no key is counted rejected, and has no payload size now: its body is not read", async () => {
    await deliver(OTLP_ROUTES[0]!.path, {
      how: "no key",
      headers: JSON_TYPE,
      body: TRACES_EXPORT,
    });

    expect(outcomes).toEqual([
      {
        "telemetry.signal": "traces",
        "telemetry.surface": "otel-traces",
        outcome: "rejected",
      },
    ]);
    expect(payloadSizes).toEqual([]);
  });

  test("a body over the cap, or in a coding the worker cannot undo, is counted rejected now: main answered it before the metrics", async () => {
    await deliver(OTLP_ROUTES[1]!.path, {
      how: "brotli",
      headers: { ...JSON_TYPE, ...TOKEN, "content-encoding": "br" },
      body: noise(KIB),
    });

    expect(outcomes).toEqual([
      {
        "telemetry.signal": "metrics",
        "telemetry.surface": "otel-metrics",
        outcome: "rejected",
      },
    ]);
    outcomes.length = 0;

    await deliver(mainPathOf(OTLP_ROUTES[1]!), {
      how: "brotli",
      headers: { ...JSON_TYPE, ...TOKEN, "content-encoding": "br" },
      body: noise(KIB),
    });

    expect(outcomes).toEqual([]);
  });
});

/*
 * #10703: a request with no key, or a key no key has, comes from anyone:
 * a debug line each, and a count by surface, logged at warn at most once a
 * minute.
 */
describe("refused keys are logged at debug, and counted by surface", () => {
  test("a burst of requests with no key and with a wrong one writes no error line and one warn line, and is counted by surface", async () => {
    for (let index: number = 0; index < 10; index++) {
      for (const route of ROUTES) {
        await sendOverHttp(server, {
          path: route.path,
          headers: { "content-type": route.contentType },
          body: route.sends[0]!.body,
        });
      }

      await sendOverHttp(server, {
        path: VERCEL_ROUTE.path,
        headers: { ...JSON_TYPE, "x-oneuptime-token": WRONG_KEY },
        body: VERCEL_JSON,
      });
    }

    const lines: (level: "error" | "warn") => Array<string> = (
      level: "error" | "warn",
    ): Array<string> => {
      return (logger[level] as unknown as jest.Mock).mock.calls.map(
        (call: Array<unknown>): string => {
          return String(call[0]);
        },
      );
    };

    expect(lines("error")).toEqual([]);
    expect(lines("warn")).toEqual([
      "TelemetryIngest: refused 1 request with no ingestion key (otel-traces: 1). Each is logged at debug; these counts at most once a minute.",
    ]);
    expect(
      Object.fromEntries(TelemetryIngestUnknownKeyRefusals.getCounts()),
    ).toEqual({
      "missing|otel-traces": 9,
      "missing|otel-metrics": 10,
      "missing|otel-logs": 10,
      "missing|otel-profiles": 10,
      "missing|vercel-log-drain": 10,
      "unknown|vercel-log-drain": 10,
    });
    expectNothingTaken();
  });
});
