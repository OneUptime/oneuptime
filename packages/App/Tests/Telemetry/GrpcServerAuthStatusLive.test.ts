import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import zlib from "zlib";
import {
  OTLP_PROTO_LOADER_OPTIONS,
  startGrpcServer,
} from "../../FeatureSet/Telemetry/GrpcServer";
import LogsQueueService from "../../FeatureSet/Telemetry/Services/Queue/LogsQueueService";
import MetricsQueueService from "../../FeatureSet/Telemetry/Services/Queue/MetricsQueueService";
import ProfilesQueueService from "../../FeatureSet/Telemetry/Services/Queue/ProfilesQueueService";
import TracesQueueService from "../../FeatureSet/Telemetry/Services/Queue/TracesQueueService";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import TelemetryIngest, {
  TelemetryRequest,
} from "Common/Server/Middleware/TelemetryIngest";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import TelemetryIngestionKeyRateLimiter from "Common/Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter";
import ObjectID from "Common/Types/ObjectID";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import PaymentRequiredException from "Common/Types/Exception/PaymentRequiredException";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";

/*
 * LIVE gRPC: the OTLP ingest server's auth status, over a real socket
 * ===================================================================
 * GH#3978. An OTel pipeline pointed at OneUptime with a mistyped, revoked or
 * wrong-type ingestion key used to be answered with gRPC OK and have its
 * batch dropped, so the exporter logged nothing and the customer saw a
 * healthy pipeline that never showed data. handleExport now answers every
 * refused credential with the sentence the HTTP ingest middleware
 * (TelemetryIngest) sends for the same refusal, under the gRPC status that
 * corresponds to its HTTP one: 401 -> UNAUTHENTICATED, 422 ->
 * PERMISSION_DENIED. Both are non-retryable for an OTLP exporter.
 *
 * GrpcServerEnqueueAck.test.ts pins that by calling the captured Export
 * closure with a hand-made callback. That cannot see what an exporter
 * actually receives: whether the ServiceError survives grpc-js' server-side
 * serialization, what the status code and grpc-message trailer look like on
 * the wire, whether anything leaks into trailing metadata, and whether the
 * client's own retry machinery re-sends the batch. This suite answers those
 * by running the PRODUCTION server — startGrpcServer() itself, with its own
 * proto loading, its own four service registrations and its own
 * signal-to-queue wiring — on an ephemeral 127.0.0.1 port, and calling
 * Export through real @grpc/grpc-js clients built from the same .proto files
 * an exporter compiles against.
 *
 * The expected sentences are NOT copied into this file. Each case is first
 * put to the real HTTP middleware, and the gRPC reply must match what it
 * said, so rewording either side without the other fails here.
 *
 * Only these are substituted: the key-policy resolver (so each test can hand
 * both servers an exact key state without Postgres), the per-signal queue
 * services (so admission can be observed and failed without Redis) and the
 * per-key rate limiter (Redis-backed, and never reached by any case here).
 */

jest.mock("Common/Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: { getPolicyFromSecretKey: jest.fn(), markUsed: jest.fn() },
  };
});
/*
 * Only consume() is replaced; the real outcome enum stays, because the
 * middleware compares against it by value.
 */
jest.mock(
  "Common/Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "Common/Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter",
    ) as Record<string, unknown>;
    return { __esModule: true, ...actual, default: { consume: jest.fn() } };
  },
);
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {},
    QueueName: { Telemetry: "Telemetry" },
  };
});
jest.mock("../../FeatureSet/Telemetry/Services/Queue/LogsQueueService", () => {
  return { __esModule: true, default: { addLogIngestJob: jest.fn() } };
});
jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/MetricsQueueService",
  () => {
    return { __esModule: true, default: { addMetricIngestJob: jest.fn() } };
  },
);
jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/ProfilesQueueService",
  () => {
    return { __esModule: true, default: { addProfileIngestJob: jest.fn() } };
  },
);
jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TracesQueueService",
  () => {
    return { __esModule: true, default: { addTraceIngestJob: jest.fn() } };
  },
);

/*
 * The status codes an OTLP/gRPC exporter RETRIES. From the OpenTelemetry
 * Protocol specification, "OTLP/gRPC Response" -> "Failures"
 * (https://opentelemetry.io/docs/specs/otlp/#failures): the client SHOULD
 * treat CANCELLED, DEADLINE_EXCEEDED, ABORTED, OUT_OF_RANGE, UNAVAILABLE and
 * DATA_LOSS as retryable, and RESOURCE_EXHAUSTED as retryable when the
 * server signals it can recover (a RetryInfo detail) — listed here
 * unconditionally, because a test that must prove "never retried" has to
 * assume the exporter takes the retrying reading. Every other non-OK code
 * is non-retryable: the exporter drops the batch and logs the status.
 *
 * That split is the whole of FIX 3's safety argument. A refused key must be
 * answered with a code OUTSIDE this list, or every misconfigured exporter
 * retries against the auth path forever; a queue failure must be answered
 * with a code INSIDE it, or a transient Redis outage silently loses data.
 */
const OTLP_RETRYABLE_GRPC_STATUS_CODES: ReadonlyArray<grpc.status> = [
  grpc.status.CANCELLED,
  grpc.status.DEADLINE_EXCEEDED,
  grpc.status.ABORTED,
  grpc.status.OUT_OF_RANGE,
  grpc.status.UNAVAILABLE,
  grpc.status.DATA_LOSS,
  grpc.status.RESOURCE_EXHAUSTED,
];

/*
 * The gRPC status that corresponds to each HTTP status the ingest middleware
 * refuses a credential with. Keyed by ExceptionCode rather than literal
 * numbers, so these are the statuses the exceptions really carry: 401 for
 * NotAuthenticatedException (missing, unknown or expired key) and 422 for
 * NotAuthorizedException (a recognised key that may not write here). A
 * refusal with any other HTTP status has no agreed gRPC reply and fails.
 */
const GRPC_CODE_FOR_HTTP_REFUSAL_STATUS: ReadonlyMap<number, grpc.status> =
  new Map<number, grpc.status>([
    [ExceptionCode.NotAuthenticatedException, grpc.status.UNAUTHENTICATED],
    [ExceptionCode.NotAuthorizedException, grpc.status.PERMISSION_DENIED],
  ]);

const QUEUE_UNAVAILABLE_DETAILS: string =
  "Telemetry queue unavailable. Please retry.";

// The three metadata keys authenticateRequest accepts, in precedence order.
const TOKEN_HEADERS: Array<string> = [
  "x-oneuptime-token",
  "x-oneuptime-service-token",
  "x-oneuptime-ingestion-key",
];

const PROTO_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Telemetry",
  "ProtoFiles",
  "OTel",
  "v1",
);

// Generous, but far below the jest timeout, so a hang fails as a status.
const CALL_DEADLINE_MS: number = 10000;

type MockedFn = jest.Mock;

type ExportCallback = (
  error: grpc.ServiceError | null,
  response?: Record<string, unknown>,
) => void;

interface OtlpExportClient extends grpc.Client {
  Export: (
    request: Record<string, unknown>,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: ExportCallback,
  ) => grpc.ClientUnaryCall;
}

interface Signal {
  name: string;
  protoFile: string;
  packagePath: Array<string>;
  product: ProductType;
  getQueue: () => MockedFn;
  // A small but real OTLP export request, as an SDK would build it.
  request: Record<string, unknown>;
  /*
   * What the server must hand the queue for that request, decoded with the
   * production loader options: uint64/fixed64 as exact decimal strings,
   * enums as their names, bytes as Buffers, plus the virtual `oneofs` name.
   */
  expectedBody: Record<string, unknown>;
}

const RESOURCE: Record<string, unknown> = {
  attributes: [
    { key: "service.name", value: { stringValue: "live-grpc-exporter" } },
  ],
};

/*
 * Every timestamp is above Number.MAX_SAFE_INTEGER, so a regression to
 * numeric longs would show up as a changed digit, not a passing test.
 */
const TIME_UNIX_NANO: string = "1758800000123456789";
const END_TIME_UNIX_NANO: string = "1758800000623456789";

const TRACE_ID: Buffer = Buffer.from("0af7651916cd43dd8448eb211c80319c", "hex");
const SPAN_ID: Buffer = Buffer.from("b7ad6b7169203331", "hex");
const PROFILE_ID: Buffer = Buffer.from(
  "5c1b1f9a6e3d4c0b8e2f7a9d1c3b5e7f",
  "hex",
);

const signals: Array<Signal> = [
  {
    name: "traces",
    protoFile: "trace_service.proto",
    packagePath: [
      "opentelemetry",
      "proto",
      "collector",
      "trace",
      "v1",
      "TraceService",
    ],
    product: ProductType.Traces,
    getQueue: (): MockedFn => {
      return TracesQueueService.addTraceIngestJob as unknown as MockedFn;
    },
    request: {
      resourceSpans: [
        {
          resource: RESOURCE,
          scopeSpans: [
            {
              scope: { name: "live-scope" },
              spans: [
                {
                  traceId: TRACE_ID,
                  spanId: SPAN_ID,
                  name: "GET /checkout",
                  kind: "SPAN_KIND_SERVER",
                  startTimeUnixNano: TIME_UNIX_NANO,
                  endTimeUnixNano: END_TIME_UNIX_NANO,
                },
              ],
            },
          ],
        },
      ],
    },
    expectedBody: {
      resourceSpans: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: {
                  stringValue: "live-grpc-exporter",
                  value: "stringValue",
                },
              },
            ],
          },
          scopeSpans: [
            {
              scope: { name: "live-scope" },
              spans: [
                {
                  traceId: TRACE_ID,
                  spanId: SPAN_ID,
                  name: "GET /checkout",
                  kind: "SPAN_KIND_SERVER",
                  startTimeUnixNano: TIME_UNIX_NANO,
                  endTimeUnixNano: END_TIME_UNIX_NANO,
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    name: "logs",
    protoFile: "logs_service.proto",
    packagePath: [
      "opentelemetry",
      "proto",
      "collector",
      "logs",
      "v1",
      "LogsService",
    ],
    product: ProductType.Logs,
    getQueue: (): MockedFn => {
      return LogsQueueService.addLogIngestJob as unknown as MockedFn;
    },
    request: {
      resourceLogs: [
        {
          resource: RESOURCE,
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: TIME_UNIX_NANO,
                  severityNumber: "SEVERITY_NUMBER_WARN",
                  severityText: "WARN",
                  body: { stringValue: "disk 91% full" },
                },
              ],
            },
          ],
        },
      ],
    },
    expectedBody: {
      resourceLogs: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: {
                  stringValue: "live-grpc-exporter",
                  value: "stringValue",
                },
              },
            ],
          },
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: TIME_UNIX_NANO,
                  severityNumber: "SEVERITY_NUMBER_WARN",
                  severityText: "WARN",
                  body: { stringValue: "disk 91% full", value: "stringValue" },
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    name: "metrics",
    protoFile: "metrics_service.proto",
    packagePath: [
      "opentelemetry",
      "proto",
      "collector",
      "metrics",
      "v1",
      "MetricsService",
    ],
    product: ProductType.Metrics,
    getQueue: (): MockedFn => {
      return MetricsQueueService.addMetricIngestJob as unknown as MockedFn;
    },
    request: {
      resourceMetrics: [
        {
          resource: RESOURCE,
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "http.server.requests",
                  sum: {
                    aggregationTemporality:
                      "AGGREGATION_TEMPORALITY_CUMULATIVE",
                    isMonotonic: true,
                    dataPoints: [{ timeUnixNano: TIME_UNIX_NANO, asInt: "42" }],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    expectedBody: {
      resourceMetrics: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: {
                  stringValue: "live-grpc-exporter",
                  value: "stringValue",
                },
              },
            ],
          },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "http.server.requests",
                  data: "sum",
                  sum: {
                    /*
                     * The gRPC producer hands the worker the enum NAME, not
                     * the OTLP/JSON integer 2 — the other half of FIX 1's
                     * "both forms reach ingest" premise.
                     */
                    aggregationTemporality:
                      "AGGREGATION_TEMPORALITY_CUMULATIVE",
                    isMonotonic: true,
                    dataPoints: [
                      {
                        timeUnixNano: TIME_UNIX_NANO,
                        asInt: "42",
                        value: "asInt",
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    name: "profiles",
    protoFile: "profiles_service.proto",
    packagePath: [
      "opentelemetry",
      "proto",
      "collector",
      "profiles",
      "v1development",
      "ProfilesService",
    ],
    product: ProductType.Profiles,
    getQueue: (): MockedFn => {
      return ProfilesQueueService.addProfileIngestJob as unknown as MockedFn;
    },
    request: {
      resourceProfiles: [
        {
          resource: RESOURCE,
          scopeProfiles: [
            {
              profiles: [
                {
                  profileId: PROFILE_ID,
                  timeUnixNano: TIME_UNIX_NANO,
                  durationNano: "10000000000",
                },
              ],
            },
          ],
        },
      ],
      dictionary: { stringTable: ["", "cpu", "nanoseconds"] },
    },
    expectedBody: {
      resourceProfiles: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: {
                  stringValue: "live-grpc-exporter",
                  value: "stringValue",
                },
              },
            ],
          },
          scopeProfiles: [
            {
              profiles: [
                {
                  profileId: PROFILE_ID,
                  timeUnixNano: TIME_UNIX_NANO,
                  durationNano: "10000000000",
                },
              ],
            },
          ],
        },
      ],
      dictionary: { stringTable: ["", "cpu", "nanoseconds"] },
    },
  },
];

const getPolicyResolverMock: () => MockedFn = (): MockedFn => {
  return TelemetryIngestionKeyService.getPolicyFromSecretKey as unknown as MockedFn;
};

const assertNothingEnqueued: () => void = (): void => {
  for (const signal of signals) {
    expect(signal.getQueue()).not.toHaveBeenCalled();
  }
};

/*
 * A healthy legacy Server key. Every refusal case below changes exactly one
 * field of this, so a refusal can only be attributed to that field.
 */
type BuildPolicyFunction = (
  overrides?: Partial<TelemetryIngestionKeyPolicy>,
) => TelemetryIngestionKeyPolicy;

const buildServerKeyPolicy: BuildPolicyFunction = (
  overrides: Partial<TelemetryIngestionKeyPolicy> = {},
): TelemetryIngestionKeyPolicy => {
  return {
    ingestionKeyId: ObjectID.generate(),
    projectId: ObjectID.generate(),
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
    ...overrides,
  };
};

type SentinelTokenFunction = (label: string) => string;

const sentinelToken: SentinelTokenFunction = (label: string): string => {
  return `sentinel-live-grpc-${label}-${ObjectID.generate().toString()}`;
};

/*
 * ---------------------------------------------------------------------------
 * The refusal reasons. `policy` is what the resolver answers for the
 * presented token; `token: null` means no credential is presented, in which
 * case the resolver must not even be consulted.
 * ---------------------------------------------------------------------------
 */
interface RefusalCase {
  reason: string;
  token: string | null;
  policy: TelemetryIngestionKeyPolicy | null;
  /*
   * The status this reason must get. Stated here as the contract, and also
   * checked against what the HTTP middleware's own status maps to.
   */
  expectedCode: grpc.status;
  /*
   * The caller is told the problem, not the key: this server log line is the
   * only place the key id (what an operator searches the dashboard with) and
   * the guard's closed-vocabulary reason appear, and it never names the
   * token.
   */
  expectedLogLine: string;
}

type RefusedPolicyCaseFunction = (data: {
  reason: string;
  label: string;
  overrides: Partial<TelemetryIngestionKeyPolicy>;
  expectedCode: grpc.status;
  loggedReason: string;
}) => RefusalCase;

const refusedPolicyCase: RefusedPolicyCaseFunction = (data: {
  reason: string;
  label: string;
  overrides: Partial<TelemetryIngestionKeyPolicy>;
  expectedCode: grpc.status;
  loggedReason: string;
}): RefusalCase => {
  const policy: TelemetryIngestionKeyPolicy = buildServerKeyPolicy(
    data.overrides,
  );
  return {
    reason: data.reason,
    token: sentinelToken(data.label),
    policy,
    expectedCode: data.expectedCode,
    expectedLogLine: `gRPC: Ingestion key ${policy.ingestionKeyId.toString()} refused: ${data.loggedReason}.`,
  };
};

type BuildRefusalCasesFunction = () => Array<RefusalCase>;

const buildRefusalCases: BuildRefusalCasesFunction = (): Array<RefusalCase> => {
  return [
    {
      reason: "missing token",
      token: null,
      policy: null,
      expectedCode: grpc.status.UNAUTHENTICATED,
      expectedLogLine: "gRPC: Missing metadata: x-oneuptime-token",
    },
    {
      reason: "unknown token",
      token: sentinelToken("unknown"),
      policy: null,
      expectedCode: grpc.status.UNAUTHENTICATED,
      expectedLogLine: "gRPC: Invalid service token.",
    },
    refusedPolicyCase({
      reason: "disabled key",
      label: "disabled",
      overrides: { isEnabled: false },
      expectedCode: grpc.status.PERMISSION_DENIED,
      loggedReason: "disabled",
    }),
    refusedPolicyCase({
      reason: "expired key",
      label: "expired",
      overrides: { expiresAt: new Date(Date.now() - 60 * 1000) },
      expectedCode: grpc.status.UNAUTHENTICATED,
      loggedReason: "expired",
    }),
    /*
     * A correctly configured Browser key — origin allowlist set, service
     * name pinned — so the refusal is about the gRPC surface alone. No
     * browser can speak gRPC, so this key was scraped and replayed.
     */
    refusedPolicyCase({
      reason: "browser key",
      label: "browser",
      overrides: {
        keyType: TelemetryIngestionKeyType.Browser,
        allowedOrigins: ["https://shop.example.com"],
        pinnedServiceName: "shop-frontend",
      },
      expectedCode: grpc.status.PERMISSION_DENIED,
      loggedReason: "surface-not-allowed-for-browser-key",
    }),
  ];
};

type FindRefusalCaseFunction = (reason: string) => RefusalCase;

// A fresh case (new key ids, new sentinel token) for one reason.
const buildRefusalCase: FindRefusalCaseFunction = (
  reason: string,
): RefusalCase => {
  return buildRefusalCases().find((candidate: RefusalCase): boolean => {
    return candidate.reason === reason;
  })!;
};

/*
 * One row per reason per way of presenting it. A presented token goes in
 * each of the three accepted headers in turn. The missing-token reason is
 * sent both with no credential header at all (`header: null`) and with each
 * header present but EMPTY, which both HTTP and gRPC treat as missing.
 */
interface RefusalRow {
  reason: string;
  header: string | null;
  via: string;
}

const REFUSAL_ROWS: Array<RefusalRow> = buildRefusalCases().flatMap(
  (refusal: RefusalCase): Array<RefusalRow> => {
    const headers: Array<string | null> =
      refusal.token === null ? [null, ...TOKEN_HEADERS] : TOKEN_HEADERS;
    return headers.map((header: string | null): RefusalRow => {
      let via: string = "no credential header";
      if (header !== null) {
        via = refusal.token === null ? `empty ${header}` : header;
      }
      return { reason: refusal.reason, header, via };
    });
  },
);

type PresentedTokenFunction = (
  refusal: RefusalCase,
  header: string | null,
) => string | null;

// What actually goes on the wire for a row: null sends no header at all.
const presentedToken: PresentedTokenFunction = (
  refusal: RefusalCase,
  header: string | null,
): string | null => {
  if (header === null) {
    return null;
  }
  return refusal.token ?? "";
};

/*
 * ---------------------------------------------------------------------------
 * Live-call plumbing.
 * ---------------------------------------------------------------------------
 */
interface ExportOutcome {
  error: grpc.ServiceError | null;
  response: Record<string, unknown> | undefined;
  // The final status event: code, details and trailing metadata.
  status: grpc.StatusObject;
  // Response headers, when the server sent any before the trailers.
  headers: grpc.Metadata | null;
}

let liveServer: grpc.Server | null = null;
let requestedBindAddress: string | null = null;
let boundPort: number = 0;
let startupInfoLines: Array<unknown> = [];
const clients: Map<string, OtlpExportClient> = new Map();
/*
 * Same services, but every message gzip-compressed: the OpenTelemetry
 * Collector's otlp (gRPC) exporter defaults to `compression: gzip`, so this
 * is the wire shape a migrated collector actually sends.
 */
const gzipClients: Map<string, OtlpExportClient> = new Map();

type MakeMetadataFunction = (entries: Array<[string, string]>) => grpc.Metadata;

const makeMetadata: MakeMetadataFunction = (
  entries: Array<[string, string]>,
): grpc.Metadata => {
  const metadata: grpc.Metadata = new grpc.Metadata();
  for (const [key, value] of entries) {
    metadata.set(key, value);
  }
  return metadata;
};

type CredentialEntriesFunction = (
  token: string | null,
  header?: string,
) => Array<[string, string]>;

/*
 * Every call also carries a non-secret header the worker does consume, so
 * a success test can see the whitelist pass it through while the token is
 * stripped. The same entries become gRPC metadata or HTTP headers, so both
 * servers are asked exactly the same thing.
 */
const credentialEntries: CredentialEntriesFunction = (
  token: string | null,
  header: string = "x-oneuptime-token",
): Array<[string, string]> => {
  const entries: Array<[string, string]> = [
    ["x-oneuptime-service-name", "live-grpc-exporter"],
  ];
  if (token !== null) {
    entries.push([header, token]);
  }
  return entries;
};

type TokenMetadataFunction = (
  token: string | null,
  header?: string,
) => grpc.Metadata;

const tokenMetadata: TokenMetadataFunction = (
  token: string | null,
  header: string = "x-oneuptime-token",
): grpc.Metadata => {
  return makeMetadata(credentialEntries(token, header));
};

type ExportFunction = (
  signal: Signal,
  metadata: grpc.Metadata,
  clientSet?: Map<string, OtlpExportClient>,
) => Promise<ExportOutcome>;

const callExport: ExportFunction = (
  signal: Signal,
  metadata: grpc.Metadata,
  clientSet: Map<string, OtlpExportClient> = clients,
): Promise<ExportOutcome> => {
  const client: OtlpExportClient = clientSet.get(signal.name)!;

  return new Promise<ExportOutcome>(
    (resolve: (outcome: ExportOutcome) => void): void => {
      let error: grpc.ServiceError | null = null;
      let response: Record<string, unknown> | undefined = undefined;
      let headers: grpc.Metadata | null = null;
      let callbackDone: boolean = false;
      let status: grpc.StatusObject | null = null;

      const settle: () => void = (): void => {
        if (callbackDone && status) {
          resolve({ error, response, status, headers });
        }
      };

      const call: grpc.ClientUnaryCall = client.Export(
        signal.request,
        metadata,
        { deadline: Date.now() + CALL_DEADLINE_MS },
        (
          callError: grpc.ServiceError | null,
          callResponse?: Record<string, unknown>,
        ): void => {
          error = callError;
          response = callResponse;
          callbackDone = true;
          settle();
        },
      );

      call.on("metadata", (received: grpc.Metadata): void => {
        headers = received;
      });

      call.on("status", (received: grpc.StatusObject): void => {
        status = received;
        settle();
      });
    },
  );
};

/*
 * A refusal is a trailers-only response, so grpc-js hands the client the
 * whole HTTP/2 header block as the status metadata — including the two
 * headers the transport writes on its own (content-type, and the `date`
 * Node's http2 stamps on every response). Those are not the application's.
 * Everything else is, and handleExport passes an empty grpc.Metadata, so
 * everything else must be empty.
 */
const TRANSPORT_HEADER_KEYS: ReadonlyArray<string> = ["content-type", "date"];

type ApplicationMetadataFunction = (
  metadata: grpc.Metadata,
) => Record<string, grpc.MetadataValue>;

const applicationMetadata: ApplicationMetadataFunction = (
  metadata: grpc.Metadata,
): Record<string, grpc.MetadataValue> => {
  const map: Record<string, grpc.MetadataValue> = { ...metadata.getMap() };
  for (const key of TRANSPORT_HEADER_KEYS) {
    delete map[key];
  }
  return map;
};

type IsRetryableFunction = (code: grpc.status) => boolean;

const isRetryableForOtlpExporter: IsRetryableFunction = (
  code: grpc.status,
): boolean => {
  return OTLP_RETRYABLE_GRPC_STATUS_CODES.includes(code);
};

/*
 * Everything the client can observe about a call besides the payload, as
 * one string: details, the formatted error message, the status trailers and
 * any response headers. A token anywhere in here reached the exporter.
 */
type ObservableTextFunction = (outcome: ExportOutcome) => string;

const clientObservableText: ObservableTextFunction = (
  outcome: ExportOutcome,
): string => {
  return [
    outcome.status.details,
    outcome.error?.message ?? "",
    outcome.error?.details ?? "",
    JSON.stringify(outcome.status.metadata.toJSON()),
    JSON.stringify(outcome.error?.metadata?.toJSON() ?? {}),
    JSON.stringify(outcome.headers?.toJSON() ?? {}),
  ].join("\n");
};

/*
 * Every logger call at every level, flattened. Errors are expanded by hand
 * because JSON.stringify(new Error("x")) is "{}", which would let a "token is
 * not in the log" assertion pass whatever was logged.
 */
type LogTranscriptFunction = () => string;

const logTranscript: LogTranscriptFunction = (): string => {
  return [logger.error, logger.warn, logger.info, logger.debug]
    .map((fn: unknown): string => {
      return (fn as MockedFn).mock.calls
        .flat()
        .map((arg: unknown): string => {
          if (arg instanceof Error) {
            return `${arg.name}: ${arg.message}\n${arg.stack ?? ""}`;
          }
          return typeof arg === "string" ? arg : JSON.stringify(arg);
        })
        .join("\n");
    })
    .join("\n");
};

/*
 * What the resolver does for the presented token: resolve to a policy,
 * resolve to null (unknown token), or throw (billing admission, an outage).
 */
type KeyResolution = TelemetryIngestionKeyPolicy | null | Error;

type ArmResolverFunction = (resolution: KeyResolution) => void;

const armResolver: ArmResolverFunction = (resolution: KeyResolution): void => {
  if (resolution instanceof Error) {
    getPolicyResolverMock().mockRejectedValue(resolution);
    return;
  }
  getPolicyResolverMock().mockResolvedValue(resolution);
};

/*
 * ---------------------------------------------------------------------------
 * The HTTP side: what TelemetryIngest, the Express middleware in front of
 * the OTLP/HTTP routes, answers for the same credential.
 *
 * It is asked about TelemetryIngestSurface.Grpc. No Express route names that
 * surface, but it is the one the gRPC server hands the shared guard, so the
 * browser-key sentence names the same surface on both sides. For every other
 * reason the surface plays no part in the middleware's answer.
 * ---------------------------------------------------------------------------
 */
interface HttpVerdict {
  // The response status, when the middleware answered the request itself.
  status: number | null;
  // The `message` of the JSON body it sent.
  message: string | null;
  // What it called next() with; null when it never called next().
  nextArgs: Array<unknown> | null;
}

type AskHttpMiddlewareFunction = (
  resolution: KeyResolution,
  entries: Array<[string, string]>,
) => Promise<HttpVerdict>;

/*
 * Runs the real middleware over a bare request/response pair, then clears
 * the call records it left, so the gRPC call that follows is observed on its
 * own: resolver call counts and the log transcript describe the gRPC server
 * alone. The resolver keeps answering the same way.
 */
const askHttpMiddleware: AskHttpMiddlewareFunction = async (
  resolution: KeyResolution,
  entries: Array<[string, string]>,
): Promise<HttpVerdict> => {
  armResolver(resolution);

  const verdict: HttpVerdict = { status: null, message: null, nextArgs: null };
  const res: Record<string, unknown> = {};
  res["status"] = (code: number): Record<string, unknown> => {
    verdict.status = code;
    return res;
  };
  res["send"] = (body: unknown): Record<string, unknown> => {
    const message: unknown = (body as { message?: unknown } | null)?.message;
    verdict.message = typeof message === "string" ? message : null;
    return res;
  };
  res["setHeader"] = (): void => {
    return undefined;
  };
  const next: (...args: Array<unknown>) => void = (
    ...args: Array<unknown>
  ): void => {
    verdict.nextArgs = args;
  };

  await TelemetryIngest.forSurface(TelemetryIngestSurface.Grpc)(
    { headers: Object.fromEntries(entries) } as unknown as ExpressRequest,
    res as unknown as ExpressResponse,
    next as unknown as NextFunction,
  );

  getPolicyResolverMock().mockClear();
  for (const fn of [logger.error, logger.warn, logger.info, logger.debug]) {
    (fn as unknown as MockedFn).mockClear();
  }

  return verdict;
};

interface ExpectedReply {
  code: grpc.status;
  details: string;
}

type ExpectedReplyFunction = (verdict: HttpVerdict) => ExpectedReply;

/*
 * The gRPC reply an HTTP refusal translates to: its sentence, under the gRPC
 * status for its HTTP status. Fails outright if HTTP admitted the request,
 * or refused it with a status that has no agreed gRPC code.
 */
const expectedReplyFor: ExpectedReplyFunction = (
  verdict: HttpVerdict,
): ExpectedReply => {
  expect(verdict.nextArgs).toBeNull();
  expect(verdict.status).not.toBeNull();
  expect(Array.from(GRPC_CODE_FOR_HTTP_REFUSAL_STATUS.keys())).toContain(
    verdict.status,
  );
  expect(verdict.message).toEqual(expect.stringMatching(/\S/));
  return {
    code: GRPC_CODE_FOR_HTTP_REFUSAL_STATUS.get(verdict.status!)!,
    details: verdict.message!,
  };
};

type ExpectRefusalReplyFunction = (
  outcome: ExportOutcome,
  expected: ExpectedReply,
) => void;

/*
 * Everything an exporter observes about a refusal: the status and its
 * sentence, the formatted client error, empty application trailers, and a
 * code the exporter will not retry.
 */
const expectRefusalReply: ExpectRefusalReplyFunction = (
  outcome: ExportOutcome,
  expected: ExpectedReply,
): void => {
  // The exporter receives a status, not a success with an empty body.
  expect(outcome.response).toBeUndefined();
  expect(outcome.error).not.toBeNull();
  expect(outcome.error!.code).toBe(expected.code);
  expect(outcome.error!.details).toBe(expected.details);
  expect(outcome.error!.message).toBe(
    `${expected.code} ${grpc.status[expected.code]}: ${expected.details}`,
  );
  expect(outcome.status.code).toBe(expected.code);
  expect(outcome.status.details).toBe(expected.details);

  /*
   * The server sends empty metadata, so beyond the transport's own headers
   * the trailers carry nothing — no key id, no project, no reason code, no
   * echo of the presented header.
   */
  expect(applicationMetadata(outcome.status.metadata)).toEqual({});
  expect(applicationMetadata(outcome.error!.metadata)).toEqual({});
  expect(outcome.status.metadata.get("content-type")).toEqual([
    "application/grpc+proto",
  ]);

  // Non-retryable: the exporter drops the batch and logs the status.
  expect(isRetryableForOtlpExporter(outcome.error!.code)).toBe(false);
};

/*
 * ---------------------------------------------------------------------------
 * Server lifecycle.
 * ---------------------------------------------------------------------------
 */
beforeAll(async () => {
  for (const level of ["error", "warn", "info", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined;
    });
  }

  /*
   * Let startGrpcServer build and register everything exactly as it does in
   * production, then redirect ONLY the listen address: port 4317 on every
   * interface becomes an ephemeral loopback port, so the suite cannot
   * collide with a running collector or a parallel jest worker. The
   * production bind callback still runs, so its logging stays covered.
   */
  const realBindAsync: grpc.Server["bindAsync"] =
    grpc.Server.prototype.bindAsync;
  const bindSpy: jest.SpyInstance = jest.spyOn(
    grpc.Server.prototype,
    "bindAsync",
  );
  const bound: Promise<number> = new Promise<number>(
    (resolve: (port: number) => void, reject: (error: Error) => void): void => {
      bindSpy.mockImplementation(function (
        this: grpc.Server,
        address: string,
        credentials: grpc.ServerCredentials,
        productionCallback: (error: Error | null, port: number) => void,
      ): void {
        requestedBindAddress = address;
        realBindAsync.call(
          this,
          "127.0.0.1:0",
          credentials,
          (error: Error | null, port: number): void => {
            productionCallback(error, port);
            if (error) {
              reject(error);
              return;
            }
            resolve(port);
          },
        );
      });
    },
  );

  startGrpcServer();
  boundPort = await bound;
  // The `this` of the one bindAsync call is the production server instance.
  expect(bindSpy).toHaveBeenCalledTimes(1);
  liveServer = bindSpy.mock.contexts[0] as grpc.Server;
  // Kept before any beforeEach clears the spies' call history.
  startupInfoLines = (logger.info as unknown as MockedFn).mock.calls.map(
    (args: Array<unknown>): unknown => {
      return args[0];
    },
  );

  for (const signal of signals) {
    const definition: protoLoader.PackageDefinition = protoLoader.loadSync(
      path.join(PROTO_DIR, signal.protoFile),
      OTLP_PROTO_LOADER_OPTIONS,
    );
    let node: unknown = grpc.loadPackageDefinition(definition);
    for (const key of signal.packagePath) {
      node = (node as Record<string, unknown>)[key];
    }
    const ClientConstructor: grpc.ServiceClientConstructor =
      node as grpc.ServiceClientConstructor;
    clients.set(
      signal.name,
      new ClientConstructor(
        `127.0.0.1:${boundPort}`,
        grpc.credentials.createInsecure(),
      ) as unknown as OtlpExportClient,
    );
    gzipClients.set(
      signal.name,
      new ClientConstructor(
        `127.0.0.1:${boundPort}`,
        grpc.credentials.createInsecure(),
        {
          "grpc.default_compression_algorithm": grpc.compressionAlgorithms.gzip,
        },
      ) as unknown as OtlpExportClient,
    );
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  getPolicyResolverMock().mockReset();
  // Fire-and-forget bookkeeping on the HTTP middleware's accept path.
  (TelemetryIngestionKeyService.markUsed as unknown as MockedFn)
    .mockReset()
    .mockResolvedValue(undefined);
  for (const signal of signals) {
    signal.getQueue().mockReset();
    signal.getQueue().mockResolvedValue(undefined);
  }
  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
});

afterAll(async () => {
  for (const clientSet of [clients, gzipClients]) {
    for (const client of clientSet.values()) {
      client.close();
    }
    clientSet.clear();
  }

  const server: grpc.Server | null = liveServer;
  if (server) {
    await new Promise<void>((resolve: () => void): void => {
      server.tryShutdown((error?: Error): void => {
        if (error) {
          server.forceShutdown();
        }
        resolve();
      });
    });
  }

  jest.restoreAllMocks();
});

/*
 * ---------------------------------------------------------------------------
 * The harness itself: prove this is the production server on a real port.
 * ---------------------------------------------------------------------------
 */
describe("live gRPC harness", () => {
  test("runs the production server, which asked for 0.0.0.0:4317 and is listening on a loopback port", () => {
    expect(requestedBindAddress).toBe("0.0.0.0:4317");
    expect(liveServer).toBeInstanceOf(grpc.Server);
    expect(boundPort).toBeGreaterThan(0);
    expect(boundPort).not.toBe(4317);
    expect(clients.size).toBe(4);
    expect(gzipClients.size).toBe(4);
    // The production bind callback ran, and reported the port it really got.
    expect(startupInfoLines).toContain(
      `gRPC OTLP server started on port: ${boundPort}`,
    );
  });

  test("the retryable-code list is the spec's, and neither end of FIX 3 sits on the wrong side of it", () => {
    expect(isRetryableForOtlpExporter(grpc.status.UNAUTHENTICATED)).toBe(false);
    expect(isRetryableForOtlpExporter(grpc.status.PERMISSION_DENIED)).toBe(
      false,
    );
    expect(isRetryableForOtlpExporter(grpc.status.UNAVAILABLE)).toBe(true);
    expect(isRetryableForOtlpExporter(grpc.status.OK)).toBe(false);
    expect(new Set(OTLP_RETRYABLE_GRPC_STATUS_CODES).size).toBe(7);
  });
});

describe.each(signals)("live gRPC $name Export", (signal: Signal) => {
  /*
   * -------------------------------------------------------------------------
   * Refused credentials: every reason, via every header, on this signal.
   * -------------------------------------------------------------------------
   */
  test.each(REFUSAL_ROWS)(
    "$reason via $via gets HTTP's sentence under its gRPC status, leaks nothing and enqueues nothing",
    async (row: RefusalRow) => {
      const refusal: RefusalCase = buildRefusalCase(row.reason);
      const token: string | null = presentedToken(refusal, row.header);
      const entries: Array<[string, string]> =
        row.header === null
          ? credentialEntries(null)
          : credentialEntries(token, row.header);

      // What the HTTP middleware says about exactly this credential.
      const expected: ExpectedReply = expectedReplyFor(
        await askHttpMiddleware(refusal.policy, entries),
      );
      // The contract for this reason, and HTTP's status maps onto it.
      expect(expected.code).toBe(refusal.expectedCode);

      const outcome: ExportOutcome = await callExport(
        signal,
        makeMetadata(entries),
      );

      expectRefusalReply(outcome, expected);

      if (refusal.token !== null) {
        expect(clientObservableText(outcome)).not.toContain(refusal.token);
        expect(logTranscript()).not.toContain(refusal.token);
        expect(getPolicyResolverMock()).toHaveBeenCalledTimes(1);
        expect(getPolicyResolverMock()).toHaveBeenCalledWith(refusal.token);
      } else {
        // No usable credential: refused before any lookup.
        expect(getPolicyResolverMock()).not.toHaveBeenCalled();
      }

      /*
       * The caller is told the problem; the key id and the guard's reason
       * code are only in the server log.
       */
      expect(logger.error).toHaveBeenCalledWith(refusal.expectedLogLine, {
        service: "telemetry",
      });

      assertNothingEnqueued();
    },
  );

  test("all three token headers present but empty is a missing token: refused without a lookup", async () => {
    const entries: Array<[string, string]> = [
      ["x-oneuptime-token", ""],
      ["x-oneuptime-service-token", ""],
      ["x-oneuptime-ingestion-key", ""],
    ];
    const expected: ExpectedReply = expectedReplyFor(
      await askHttpMiddleware(null, entries),
    );
    // The same reply as sending no credential header at all.
    const noHeader: ExpectedReply = expectedReplyFor(
      await askHttpMiddleware(null, credentialEntries(null)),
    );
    expect(expected).toEqual(noHeader);

    const outcome: ExportOutcome = await callExport(
      signal,
      makeMetadata(entries),
    );

    expectRefusalReply(outcome, expected);
    expect(outcome.error!.code).toBe(grpc.status.UNAUTHENTICATED);
    expect(getPolicyResolverMock()).not.toHaveBeenCalled();
    assertNothingEnqueued();
  });

  /*
   * -------------------------------------------------------------------------
   * Accepted credentials: the fix must not have tightened the happy path.
   * -------------------------------------------------------------------------
   */
  test.each(TOKEN_HEADERS)(
    "a valid Server key via %s is answered OK and enqueued exactly once for its project",
    async (header: string) => {
      const token: string = sentinelToken("valid");
      const policy: TelemetryIngestionKeyPolicy = buildServerKeyPolicy();
      getPolicyResolverMock().mockResolvedValue(policy);

      const outcome: ExportOutcome = await callExport(
        signal,
        tokenMetadata(token, header),
      );

      expect(outcome.error).toBeNull();
      expect(outcome.response).toEqual({});
      expect(outcome.status.code).toBe(grpc.status.OK);
      expect(clientObservableText(outcome)).not.toContain(token);
      expect(getPolicyResolverMock()).toHaveBeenCalledTimes(1);
      expect(getPolicyResolverMock()).toHaveBeenCalledWith(token);

      const queue: MockedFn = signal.getQueue();
      expect(queue).toHaveBeenCalledTimes(1);
      const queued: TelemetryRequest = queue.mock.calls[0]![0];
      expect(queued.projectId).toBe(policy.projectId);
      expect(queued.productType).toBe(signal.product);
      expect(queued.path).toBe(`/otlp/v1/${signal.product}`);
      expect(queued.body).toMatchObject(signal.expectedBody);
      /*
       * The job payload is serialized into Redis; the ingestion key must not
       * ride along with it, whichever header carried it.
       */
      expect(queued.headers).toEqual({
        "x-oneuptime-service-name": "live-grpc-exporter",
      });
      expect(JSON.stringify(queued.headers)).not.toContain(token);

      // The batch went to this signal's queue and no other.
      for (const other of signals) {
        if (other.name !== signal.name) {
          expect(other.getQueue()).not.toHaveBeenCalled();
        }
      }
    },
  );

  test("a key whose expiry is still in the future is accepted", async () => {
    const policy: TelemetryIngestionKeyPolicy = buildServerKeyPolicy({
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    getPolicyResolverMock().mockResolvedValue(policy);

    const outcome: ExportOutcome = await callExport(
      signal,
      tokenMetadata(sentinelToken("future-expiry")),
    );

    expect(outcome.error).toBeNull();
    expect(outcome.status.code).toBe(grpc.status.OK);
    expect(signal.getQueue()).toHaveBeenCalledTimes(1);
    expect(signal.getQueue().mock.calls[0]![0].projectId).toBe(
      policy.projectId,
    );
  });

  test("a mixed-case header name, as typed into a collector config, still authenticates", async () => {
    const token: string = sentinelToken("mixed-case");
    const policy: TelemetryIngestionKeyPolicy = buildServerKeyPolicy();
    getPolicyResolverMock().mockResolvedValue(policy);

    const outcome: ExportOutcome = await callExport(
      signal,
      makeMetadata([["X-OneUptime-Token", token]]),
    );

    expect(outcome.error).toBeNull();
    expect(getPolicyResolverMock()).toHaveBeenCalledWith(token);
    expect(signal.getQueue()).toHaveBeenCalledTimes(1);
  });

  type GzipScenarioFunction = () => Promise<void>;

  // A refused then an accepted export, both over the gzip clients.
  const exportGzipRefusedThenAccepted: GzipScenarioFunction =
    async (): Promise<void> => {
      const refusedToken: string = sentinelToken("gzip-refused");
      const expected: ExpectedReply = expectedReplyFor(
        await askHttpMiddleware(null, credentialEntries(refusedToken)),
      );
      const refused: ExportOutcome = await callExport(
        signal,
        tokenMetadata(refusedToken),
        gzipClients,
      );
      expectRefusalReply(refused, expected);
      expect(refused.error!.code).toBe(grpc.status.UNAUTHENTICATED);
      expect(clientObservableText(refused)).not.toContain(refusedToken);
      assertNothingEnqueued();

      const policy: TelemetryIngestionKeyPolicy = buildServerKeyPolicy();
      getPolicyResolverMock().mockResolvedValue(policy);
      const accepted: ExportOutcome = await callExport(
        signal,
        tokenMetadata(sentinelToken("gzip-accepted")),
        gzipClients,
      );
      expect(accepted.error).toBeNull();
      expect(accepted.response).toEqual({});
      expect(signal.getQueue()).toHaveBeenCalledTimes(1);
      const queued: TelemetryRequest = signal.getQueue().mock.calls[0]![0];
      expect(queued.projectId).toBe(policy.projectId);
      expect(queued.body).toMatchObject(signal.expectedBody);
    };

  test("a gzip-compressed export (the Collector's default) is refused and accepted exactly like an uncompressed one", async () => {
    /*
     * Count the server's gzip decompressions, so the test proves the
     * messages really arrived compressed rather than trusting the client
     * option. Wrapped by hand: Node defines zlib.createGunzip non-writable
     * (but configurable), which jest.spyOn cannot restore.
     */
    const originalGunzip: PropertyDescriptor = Object.getOwnPropertyDescriptor(
      zlib,
      "createGunzip",
    )!;
    const realCreateGunzip: typeof zlib.createGunzip = zlib.createGunzip;
    let gunzipCalls: number = 0;
    Object.defineProperty(zlib, "createGunzip", {
      ...originalGunzip,
      value: (options?: zlib.ZlibOptions): zlib.Gunzip => {
        gunzipCalls += 1;
        return realCreateGunzip(options);
      },
    });

    try {
      await exportGzipRefusedThenAccepted();
    } finally {
      Object.defineProperty(zlib, "createGunzip", originalGunzip);
    }

    // One decompression per request; responses come back uncompressed.
    expect(gunzipCalls).toBe(2);
  });

  /*
   * -------------------------------------------------------------------------
   * The other non-OK and deliberately-OK branches of handleExport.
   * -------------------------------------------------------------------------
   */
  test.each(["reject", "throw"])(
    "a queue that fails to admit (%s) is answered UNAVAILABLE — retryable — once, without a client-side resend",
    async (mode: string) => {
      getPolicyResolverMock().mockResolvedValue(buildServerKeyPolicy());
      signal.getQueue().mockImplementation(() => {
        const failure: Error = new Error("redis-backend-detail-must-not-leak");
        if (mode === "throw") {
          throw failure;
        }
        return Promise.reject(failure);
      });
      const token: string = sentinelToken("queue-failure");

      const outcome: ExportOutcome = await callExport(
        signal,
        tokenMetadata(token),
      );

      expect(outcome.response).toBeUndefined();
      expect(outcome.error?.code).toBe(grpc.status.UNAVAILABLE);
      expect(outcome.error?.details).toBe(QUEUE_UNAVAILABLE_DETAILS);
      expect(applicationMetadata(outcome.status.metadata)).toEqual({});
      expect(isRetryableForOtlpExporter(outcome.error!.code)).toBe(true);
      expect(clientObservableText(outcome)).not.toContain(
        "redis-backend-detail-must-not-leak",
      );
      expect(clientObservableText(outcome)).not.toContain(token);
      /*
       * Exactly one admission attempt: the retry belongs to the exporter's
       * own backoff, not to a transparent grpc-js resend.
       */
      expect(signal.getQueue()).toHaveBeenCalledTimes(1);
      expect(logTranscript()).toContain("redis-backend-detail-must-not-leak");
    },
  );

  test("DISABLE_TELEMETRY_INGESTION answers OK and enqueues nothing, before any key lookup", async () => {
    jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(true);
    getPolicyResolverMock().mockResolvedValue(buildServerKeyPolicy());

    const withKey: ExportOutcome = await callExport(
      signal,
      tokenMetadata(sentinelToken("disabled-ingestion")),
    );
    /*
     * Even a request that would be refused is dropped silently: the switch
     * is checked first, so a paused install never looks like an auth fault.
     */
    const withoutKey: ExportOutcome = await callExport(
      signal,
      tokenMetadata(null),
    );

    for (const outcome of [withKey, withoutKey]) {
      expect(outcome.error).toBeNull();
      expect(outcome.response).toEqual({});
      expect(outcome.status.code).toBe(grpc.status.OK);
    }
    expect(getPolicyResolverMock()).not.toHaveBeenCalled();
    assertNothingEnqueued();
  });

  test("an auth backend that throws is answered OK (documented: no retry storm on a degraded backend) and enqueues nothing", async () => {
    getPolicyResolverMock().mockRejectedValue(
      new Error("postgres-connection-refused"),
    );
    const token: string = sentinelToken("auth-backend-down");

    const outcome: ExportOutcome = await callExport(
      signal,
      tokenMetadata(token),
    );

    expect(outcome.error).toBeNull();
    expect(outcome.response).toEqual({});
    expect(outcome.status.code).toBe(grpc.status.OK);
    expect(outcome.status.details).not.toContain("postgres-connection-refused");
    expect(clientObservableText(outcome)).not.toContain(token);
    expect(getPolicyResolverMock()).toHaveBeenCalledTimes(1);
    assertNothingEnqueued();
    expect(logTranscript()).toContain("postgres-connection-refused");
  });

  test("a PaymentRequiredException from the auth path is answered PERMISSION_DENIED (non-retryable) and enqueues nothing", async () => {
    getPolicyResolverMock().mockRejectedValue(
      new PaymentRequiredException("Upgrade to a paid plan to ingest."),
    );

    const outcome: ExportOutcome = await callExport(
      signal,
      tokenMetadata(sentinelToken("payment-required")),
    );

    expect(outcome.error?.code).toBe(grpc.status.PERMISSION_DENIED);
    expect(outcome.error?.details).toBe("Upgrade to a paid plan to ingest.");
    expect(isRetryableForOtlpExporter(outcome.error!.code)).toBe(false);
    assertNothingEnqueued();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Cross-signal: one reply per reason.
 * ---------------------------------------------------------------------------
 */
describe("live gRPC refusal reply depends on the reason alone", () => {
  test("every reason, via every header, on every signal: the header and the signal never change the reply, the reason always does", async () => {
    interface ObservedStatus {
      code: grpc.status;
      details: string;
      message: string;
      trailers: string;
    }

    const reasons: Array<string> = buildRefusalCases().map(
      (refusal: RefusalCase): string => {
        return refusal.reason;
      },
    );

    // HTTP's answer for each reason, asked before any gRPC call is observed.
    const expectedByReason: Map<string, ObservedStatus> = new Map();
    for (const reason of reasons) {
      const refusal: RefusalCase = buildRefusalCase(reason);
      const expected: ExpectedReply = expectedReplyFor(
        await askHttpMiddleware(
          refusal.policy,
          credentialEntries(refusal.token),
        ),
      );
      expectedByReason.set(reason, {
        code: expected.code,
        details: expected.details,
        message: `${expected.code} ${grpc.status[expected.code]}: ${expected.details}`,
        trailers: "{}",
      });
    }

    const observedByReason: Map<string, Array<string>> = new Map();
    const presentedTokens: Array<string> = [];

    for (const signal of signals) {
      for (const row of REFUSAL_ROWS) {
        const refusal: RefusalCase = buildRefusalCase(row.reason);
        const token: string | null = presentedToken(refusal, row.header);
        if (refusal.token !== null) {
          presentedTokens.push(refusal.token);
        }
        armResolver(refusal.policy);

        const outcome: ExportOutcome = await callExport(
          signal,
          row.header === null
            ? tokenMetadata(null)
            : tokenMetadata(token, row.header),
        );

        const observed: ObservedStatus = {
          code: outcome.status.code,
          details: outcome.status.details,
          message: outcome.error?.message ?? "",
          /*
           * Transport headers excluded: `date` ticks every second, and
           * would make identical replies look different across a second
           * boundary.
           */
          trailers: JSON.stringify(
            applicationMetadata(outcome.status.metadata),
          ),
        };
        const seen: Array<string> = observedByReason.get(row.reason) ?? [];
        seen.push(JSON.stringify(observed));
        observedByReason.set(row.reason, seen);
      }
    }

    expect(Array.from(observedByReason.keys())).toEqual(reasons);

    // 4 signals x (missing: no header + 3 empty ones; 4 others x 3 headers).
    const totalObserved: number = Array.from(observedByReason.values()).reduce(
      (sum: number, seen: Array<string>): number => {
        return sum + seen.length;
      },
      0,
    );
    expect(totalObserved).toBe(4 * (4 + 4 * 3));

    for (const reason of reasons) {
      const distinct: Set<string> = new Set(observedByReason.get(reason));
      // Neither the header nor the signal changes the reply...
      expect(distinct.size).toBe(1);
      // ...and it is HTTP's answer for this reason.
      expect(JSON.parse(Array.from(distinct)[0]!)).toEqual(
        expectedByReason.get(reason),
      );
    }

    // ...while no two reasons get the same reply.
    const replies: Set<string> = new Set(
      Array.from(expectedByReason.values()).map(
        (reply: ObservedStatus): string => {
          return JSON.stringify(reply);
        },
      ),
    );
    expect(replies.size).toBe(reasons.length);

    const transcript: string = logTranscript();
    for (const token of presentedTokens) {
      expect(transcript).not.toContain(token);
    }
    // The transcript is not vacuous: every refusal was logged.
    expect(
      (logger.error as unknown as MockedFn).mock.calls.length,
    ).toBeGreaterThanOrEqual(totalObserved);
    assertNothingEnqueued();
  });

  test("the server keeps serving after a burst of refusals: a valid key right after is accepted on every signal", async () => {
    for (const signal of signals) {
      getPolicyResolverMock().mockResolvedValue(null);
      const refused: ExportOutcome = await callExport(
        signal,
        tokenMetadata(sentinelToken("burst-refused")),
      );
      expect(refused.status.code).toBe(grpc.status.UNAUTHENTICATED);

      const policy: TelemetryIngestionKeyPolicy = buildServerKeyPolicy();
      getPolicyResolverMock().mockResolvedValue(policy);
      const accepted: ExportOutcome = await callExport(
        signal,
        tokenMetadata(sentinelToken("burst-accepted")),
      );
      expect(accepted.status.code).toBe(grpc.status.OK);
      expect(signal.getQueue()).toHaveBeenCalledTimes(1);
      expect(signal.getQueue().mock.calls[0]![0].projectId).toBe(
        policy.projectId,
      );
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * HTTP and gRPC, side by side, case by case.
 *
 * Each case is one key state. It is put to the HTTP middleware and then to
 * the live gRPC server with the same resolver answer and the same token in
 * the same header, and the two answers must agree: admitted on both, or
 * refused on both with HTTP's sentence as the gRPC details and HTTP's status
 * mapped onto the gRPC code. The combinations (a key both disabled and
 * expired, a disabled browser key, ...) pin that both sides check in the
 * same order, since only the first refusal is reported.
 * ---------------------------------------------------------------------------
 */
interface AgreementCase {
  label: string;
  presentsToken: boolean;
  // Built fresh per call, so every call gets its own key ids.
  resolve: () => KeyResolution;
  // What gRPC must answer; OK means admitted and enqueued.
  expectedCode: grpc.status;
}

const PAYMENT_REQUIRED_MESSAGE: string = "Upgrade to a paid plan to ingest.";

const browserKeyOverrides: Partial<TelemetryIngestionKeyPolicy> = {
  keyType: TelemetryIngestionKeyType.Browser,
  allowedOrigins: ["https://shop.example.com"],
  pinnedServiceName: "shop-frontend",
};

const PAST: () => Date = (): Date => {
  return new Date(Date.now() - 60 * 1000);
};

const FUTURE: () => Date = (): Date => {
  return new Date(Date.now() + 60 * 60 * 1000);
};

const AGREEMENT_CASES: Array<AgreementCase> = [
  {
    label: "no token",
    presentsToken: false,
    resolve: (): KeyResolution => {
      return null;
    },
    expectedCode: grpc.status.UNAUTHENTICATED,
  },
  {
    label: "unknown token",
    presentsToken: true,
    resolve: (): KeyResolution => {
      return null;
    },
    expectedCode: grpc.status.UNAUTHENTICATED,
  },
  {
    label: "disabled server key",
    presentsToken: true,
    resolve: (): KeyResolution => {
      return buildServerKeyPolicy({ isEnabled: false });
    },
    expectedCode: grpc.status.PERMISSION_DENIED,
  },
  {
    label: "expired server key",
    presentsToken: true,
    resolve: (): KeyResolution => {
      return buildServerKeyPolicy({ expiresAt: PAST() });
    },
    expectedCode: grpc.status.UNAUTHENTICATED,
  },
  {
    label: "browser key",
    presentsToken: true,
    resolve: (): KeyResolution => {
      return buildServerKeyPolicy(browserKeyOverrides);
    },
    expectedCode: grpc.status.PERMISSION_DENIED,
  },
  {
    label: "disabled and expired key (the kill switch is reported)",
    presentsToken: true,
    resolve: (): KeyResolution => {
      return buildServerKeyPolicy({ isEnabled: false, expiresAt: PAST() });
    },
    expectedCode: grpc.status.PERMISSION_DENIED,
  },
  {
    label: "expired browser key (expiry is reported before the key type)",
    presentsToken: true,
    resolve: (): KeyResolution => {
      return buildServerKeyPolicy({
        ...browserKeyOverrides,
        expiresAt: PAST(),
      });
    },
    expectedCode: grpc.status.UNAUTHENTICATED,
  },
  {
    label: "disabled browser key (the kill switch is reported)",
    presentsToken: true,
    resolve: (): KeyResolution => {
      return buildServerKeyPolicy({
        ...browserKeyOverrides,
        isEnabled: false,
      });
    },
    expectedCode: grpc.status.PERMISSION_DENIED,
  },
  {
    label: "valid server key",
    presentsToken: true,
    resolve: (): KeyResolution => {
      return buildServerKeyPolicy();
    },
    expectedCode: grpc.status.OK,
  },
  {
    label: "server key expiring in the future",
    presentsToken: true,
    resolve: (): KeyResolution => {
      return buildServerKeyPolicy({ expiresAt: FUTURE() });
    },
    expectedCode: grpc.status.OK,
  },
  {
    label: "server key pinned to one service",
    presentsToken: true,
    resolve: (): KeyResolution => {
      return buildServerKeyPolicy({ pinnedServiceName: "checkout" });
    },
    expectedCode: grpc.status.OK,
  },
  {
    label: "live key on a project without payment set up",
    presentsToken: true,
    resolve: (): KeyResolution => {
      return new PaymentRequiredException(PAYMENT_REQUIRED_MESSAGE);
    },
    expectedCode: grpc.status.PERMISSION_DENIED,
  },
];

describe("HTTP and gRPC agree on every credential, case by case", () => {
  test.each(AGREEMENT_CASES)("$label", async (agreementCase: AgreementCase) => {
    const headers: Array<string | null> = agreementCase.presentsToken
      ? TOKEN_HEADERS
      : [null];
    let comparisons: number = 0;

    for (const signal of signals) {
      for (const header of headers) {
        const resolution: KeyResolution = agreementCase.resolve();
        const token: string | null = agreementCase.presentsToken
          ? sentinelToken("agreement")
          : null;
        const entries: Array<[string, string]> =
          header === null
            ? credentialEntries(null)
            : credentialEntries(token, header);

        const http: HttpVerdict = await askHttpMiddleware(resolution, entries);
        for (const other of signals) {
          other.getQueue().mockClear();
        }

        const outcome: ExportOutcome = await callExport(
          signal,
          makeMetadata(entries),
        );
        expect(outcome.status.code).toBe(agreementCase.expectedCode);

        if (http.nextArgs !== null && http.nextArgs.length === 0) {
          // HTTP admitted it: gRPC accepts and enqueues for the project.
          expect(http.status).toBeNull();
          expect(outcome.error).toBeNull();
          expect(outcome.response).toEqual({});
          expect(signal.getQueue()).toHaveBeenCalledTimes(1);
          expect(signal.getQueue().mock.calls[0]![0].projectId).toBe(
            (resolution as TelemetryIngestionKeyPolicy).projectId,
          );
        } else if (
          http.nextArgs !== null &&
          http.nextArgs[0] instanceof PaymentRequiredException
        ) {
          /*
           * HTTP hands billing admission to the Express error handler;
           * gRPC sends the same exception's message, non-retryable.
           */
          expectRefusalReply(outcome, {
            code: grpc.status.PERMISSION_DENIED,
            details: (http.nextArgs[0] as PaymentRequiredException).message,
          });
          assertNothingEnqueued();
        } else {
          // HTTP refused it: gRPC refuses with the same sentence.
          expectRefusalReply(outcome, expectedReplyFor(http));
          assertNothingEnqueued();
        }

        if (token !== null) {
          expect(clientObservableText(outcome)).not.toContain(token);
          expect(logTranscript()).not.toContain(token);
        }
        comparisons += 1;
      }
    }

    expect(comparisons).toBe(signals.length * headers.length);
    // No case here may reach the Redis-backed per-key limiter on HTTP.
    expect(
      TelemetryIngestionKeyRateLimiter.consume as unknown as MockedFn,
    ).not.toHaveBeenCalled();
  });
});
