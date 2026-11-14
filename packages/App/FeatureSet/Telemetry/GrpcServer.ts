import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import PaymentRequiredException from "Common/Types/Exception/PaymentRequiredException";
import ProjectBlockedException from "Common/Types/Exception/ProjectBlockedException";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import TelemetryIngestionKeyGuard, {
  TELEMETRY_INGEST_REFUSAL_REASON_FOR_KEY_REFUSAL,
  TelemetryIngestionKeyRefusal,
  TelemetryIngestionKeyRefusalReason,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionKeyGuard";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import TracesQueueService from "./Services/Queue/TracesQueueService";
import LogsQueueService from "./Services/Queue/LogsQueueService";
import MetricsQueueService from "./Services/Queue/MetricsQueueService";
import ProfilesQueueService from "./Services/Queue/ProfilesQueueService";
import {
  binaryToBase64Replacer,
  pickWorkerConsumedRequestHeaders,
} from "./Services/Queue/TelemetryQueueService";
import TelemetryIngestionBudget, {
  TelemetryIngestionBudgetAdmission,
  TelemetryIngestionBudgetAdmissionMode,
  TelemetryIngestionBudgetRefusal,
  TelemetryIngestionBudgetRefusalKind,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionBudget";
import { encodeGoogleRpcStatus } from "Common/Server/Utils/Telemetry/GoogleRpcStatus";
import { isTelemetryIngestionBudgetSignal } from "Common/Types/Telemetry/TelemetryIngestionBudget";
import { getTelemetryIngestRefusalReasonForBudget } from "Common/Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestRefusalRecorder, {
  recordTelemetryIngestBillingRefusal,
} from "Common/Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import TelemetryIngestionKeyLastUsed from "Common/Server/Utils/Telemetry/TelemetryIngestionKeyLastUsed";

const GRPC_PORT: number = 4317;

const PROTO_DIR: string = path.resolve(__dirname, "ProtoFiles", "OTel", "v1");

type GrpcCallback = (
  error: grpc.ServiceError | null,
  response?: Record<string, unknown>,
) => void;

interface GrpcCall {
  request: Record<string, unknown>;
  metadata: grpc.Metadata;
}

/*
 * What handleExport answers when it refuses a credential.
 *
 * GH#3978: a refusal used to be gRPC OK with the batch dropped, so an exporter
 * holding a mistyped, disabled or wrong-type key logged nothing and the
 * customer saw a healthy pipeline that never showed data. Every credential
 * refusal is now a non-OK status carrying the sentence the HTTP ingest
 * middleware (TelemetryIngest) sends for the same refusal, with the status
 * mapped from its HTTP one, so a customer reads the same explanation whether
 * the key is sent over OTLP/HTTP or OTLP/gRPC:
 *
 *   HTTP 401 (missing token, unknown token, expired key) -> UNAUTHENTICATED
 *   HTTP 422 (disabled key, browser key on a surface it
 *            may not use, which this port is)            -> PERMISSION_DENIED
 *
 * Both codes are non-retryable in the OTLP gRPC status mapping, so the
 * exporter drops the batch and logs the status rather than retrying a
 * credential that will never be accepted.
 *
 * Telling the reasons apart discloses nothing the HTTP endpoint does not
 * already say about the same key, and on an unpaid project this port already
 * set a live key apart from an unknown one through PaymentRequiredException's
 * PERMISSION_DENIED (see handleExport).
 */
export interface GrpcCredentialRefusal {
  code: grpc.status;

  /*
   * Sent to the caller as the status details. It names the problem, never
   * the presented token, the key id, the project, the allowlist or the
   * expiry timestamp.
   */
  message: string;
}

export type GrpcAuthenticationResult =
  | { projectId: ObjectID }
  | { refusal: GrpcCredentialRefusal };

/*
 * authenticateGrpcRequest's answer with the key's policy beside the project:
 * handleExport needs the key's own ingestion budgets as well as its project.
 */
export type GrpcPolicyAuthenticationResult =
  | { projectId: ObjectID; policy: TelemetryIngestionKeyPolicy }
  | { refusal: GrpcCredentialRefusal };

/*
 * How big each decoded Export request was before grpc-js decoded it - the
 * protobuf message, already decompressed from its grpc-encoding - recorded
 * by the services' deserializers (recordMessageSizes) and read by
 * handleExport, so an ingestion budget counts a gRPC export at the size an
 * OTLP/HTTP protobuf export of the same telemetry is counted at. A WeakMap
 * on the decoded object rather than a property on it: everything on the
 * request object is serialized into the queue job.
 */
const exportMessageSizes: WeakMap<
  Record<string, unknown>,
  number
> = new WeakMap<Record<string, unknown>, number>();

// Exported for tests.
export function getExportMessageSize(request: unknown): number | undefined {
  return request && typeof request === "object"
    ? exportMessageSizes.get(request as Record<string, unknown>)
    : undefined;
}

/*
 * Wrap a service definition's request deserializers so every decoded
 * message remembers its size. Exported for tests.
 */
export function recordMessageSizes(
  definition: grpc.ServiceDefinition,
): grpc.ServiceDefinition {
  for (const methodName of Object.keys(definition)) {
    const method: grpc.MethodDefinition<unknown, unknown> = definition[
      methodName
    ] as grpc.MethodDefinition<unknown, unknown>;
    const deserialize: grpc.deserialize<unknown> = method.requestDeserialize;

    method.requestDeserialize = (bytes: Buffer): unknown => {
      const decoded: unknown = deserialize(bytes);

      if (decoded && typeof decoded === "object") {
        exportMessageSizes.set(
          decoded as Record<string, unknown>,
          bytes.length,
        );
      }

      return decoded;
    };
  }

  return definition;
}

/*
 * TelemetryIngest's missing-token and invalid-token sentences, word for word.
 * It keeps them inline, so they are copied rather than imported;
 * GrpcServerAuthStatusLive.test.ts runs the HTTP middleware beside this server
 * and fails if the two drift apart. Like HTTP, they name only the primary
 * header, although x-oneuptime-service-token and x-oneuptime-ingestion-key are
 * accepted too.
 */
export const MISSING_INGESTION_TOKEN_MESSAGE: string =
  "Missing ingestion token. Send your OneUptime telemetry ingestion key in the x-oneuptime-token header.";

export const INVALID_INGESTION_TOKEN_MESSAGE: string =
  "Invalid ingestion token. Send a valid OneUptime telemetry ingestion key in the x-oneuptime-token header.";

/*
 * The status for each guard refusal, following the HTTP status TelemetryIngest
 * sends for the same reason: 401 (NotAuthenticatedException) for an expired
 * key, 422 (NotAuthorizedException) for a disabled key and for a browser key
 * on a surface it may not use. gRPC's status definitions say PERMISSION_DENIED
 * must not be used when the caller cannot be identified; in the 422 cases it
 * has been: the key was recognised, it is just not allowed to write here.
 *
 * A total Record, so a reason added to the guard fails to compile here instead
 * of reaching an exporter with no status chosen for it.
 */
const GRPC_STATUS_FOR_KEY_REFUSAL: Record<
  TelemetryIngestionKeyRefusalReason,
  grpc.status
> = {
  [TelemetryIngestionKeyRefusalReason.Disabled]: grpc.status.PERMISSION_DENIED,
  [TelemetryIngestionKeyRefusalReason.Expired]: grpc.status.UNAUTHENTICATED,
  [TelemetryIngestionKeyRefusalReason.SurfaceNotAllowedForBrowserKey]:
    grpc.status.PERMISSION_DENIED,
};

type BuildServiceErrorFunction = (
  code: grpc.status,
  message: string,
) => grpc.ServiceError;

/*
 * A ServiceError whose details are exactly `message` and whose trailing
 * metadata is empty, so that sentence is the only thing the exporter is told.
 */
const buildServiceError: BuildServiceErrorFunction = (
  code: grpc.status,
  message: string,
): grpc.ServiceError => {
  return Object.assign(new Error(message), {
    code: code,
    details: message,
    metadata: new grpc.Metadata(),
  });
};

// Exported for tests.
export async function authenticateGrpcRequest(
  metadata: grpc.Metadata,
): Promise<GrpcAuthenticationResult> {
  const authentication: GrpcPolicyAuthenticationResult =
    await authenticateGrpcRequestWithPolicy(metadata);

  return "refusal" in authentication
    ? { refusal: authentication.refusal }
    : { projectId: authentication.projectId };
}

// Exported for tests.
export async function authenticateGrpcRequestWithPolicy(
  metadata: grpc.Metadata,
): Promise<GrpcPolicyAuthenticationResult> {
  const tokenValues: grpc.MetadataValue[] = metadata.get("x-oneuptime-token");

  let oneuptimeToken: string | undefined = tokenValues[0]?.toString();

  if (!oneuptimeToken) {
    const serviceTokenValues: grpc.MetadataValue[] = metadata.get(
      "x-oneuptime-service-token",
    );
    oneuptimeToken = serviceTokenValues[0]?.toString();
  }

  if (!oneuptimeToken) {
    const ingestionKeyValues: grpc.MetadataValue[] = metadata.get(
      "x-oneuptime-ingestion-key",
    );
    oneuptimeToken = ingestionKeyValues[0]?.toString();
  }

  if (!oneuptimeToken) {
    logger.error("gRPC: Missing metadata: x-oneuptime-token", {
      service: "telemetry",
    });
    return {
      refusal: {
        code: grpc.status.UNAUTHENTICATED,
        message: MISSING_INGESTION_TOKEN_MESSAGE,
      },
    };
  }

  /*
   * Resolve the token through the shared in-process TTL cache
   * (TelemetryIngestionKeyService.getPolicyFromSecretKey) instead of
   * hitting Postgres with a findOneBy per RPC. OTLP exporters send an
   * Export call every schedule tick per signal per process, so an
   * uncached lookup here was one database round trip per exported batch.
   * The HTTP ingest middleware (TelemetryIngest) already resolves through
   * the same cache, so both entry points share staleness behavior: at most
   * 60s for a revoked key, 10s for a retried invalid one. The resolver
   * returns null for unknown / malformed / revoked tokens — same as the
   * previous no-row result.
   *
   * It returns the whole POLICY rather than just the projectId because a
   * project id alone cannot answer "may this key still write, and may it
   * write HERE?". Resolving it is not a decision: a disabled or expired key
   * resolves fine, and the refusal below is what turns it away.
   */
  const policy: TelemetryIngestionKeyPolicy | null =
    await TelemetryIngestionKeyService.getPolicyFromSecretKey(oneuptimeToken);

  if (!policy) {
    /*
     * Deliberately do NOT log the presented token: it is a secret (or a
     * typo away from someone else's secret) and log lines routinely land
     * in third-party sinks. Log only that authentication failed.
     */
    logger.error("gRPC: Invalid service token.", {
      service: "telemetry",
    });
    return {
      refusal: {
        code: grpc.status.UNAUTHENTICATED,
        message: INVALID_INGESTION_TOKEN_MESSAGE,
      },
    };
  }

  /*
   * Kill switch, expiry, and the key TYPE.
   *
   * The type check is the interesting one. No browser can speak OTLP over
   * gRPC — it needs HTTP/2 trailers, which no browser exposes to page
   * JavaScript, which is the entire reason grpc-web exists — so a Browser
   * key presented on this port did not come from a page running the
   * customer's site. It was scraped out of that page's source and replayed
   * by something else, which is precisely the attack the browser key type
   * exists to bound. Refusing it here costs no legitimate caller anything:
   * there is no legitimate caller.
   */
  const refusal: TelemetryIngestionKeyRefusal | null =
    TelemetryIngestionKeyGuard.getRefusal({
      policy: policy,
      surface: TelemetryIngestSurface.Grpc,
    });

  if (refusal) {
    /*
     * Same discipline as above — the reason is a short closed vocabulary,
     * and the token never appears. The key id is safe and is what an
     * operator needs to find the key in the dashboard.
     */
    logger.error(
      `gRPC: Ingestion key ${policy.ingestionKeyId.toString()} refused: ${refusal.reason}.`,
      {
        service: "telemetry",
      },
    );

    // Counted against the key, for its page (issue #6378).
    TelemetryIngestRefusalRecorder.record({
      projectId: policy.projectId,
      ingestionKeyId: policy.ingestionKeyId,
      reason: TELEMETRY_INGEST_REFUSAL_REASON_FOR_KEY_REFUSAL[refusal.reason],
      surface: TelemetryIngestSurface.Grpc,
    });
    return {
      refusal: {
        code: GRPC_STATUS_FOR_KEY_REFUSAL[refusal.reason],
        message: refusal.message,
      },
    };
  }

  return { projectId: policy.projectId, policy: policy };
}

/*
 * The status an ingestion budget refusal is answered with. RESOURCE_EXHAUSTED
 * either way, which the OTLP/gRPC specification makes retryable only when
 * the status details carry a RetryInfo:
 *
 *   - over a per-second rate, it carries one, with the delay to come back
 *     after, so the exporter retries the batch then;
 *   - over a used-up daily budget, it carries none, so the exporter drops
 *     the batch and logs the message rather than retrying until the reset.
 *
 * Exported for tests.
 */
export function buildIngestionBudgetServiceError(
  refusal: TelemetryIngestionBudgetRefusal,
): grpc.ServiceError {
  const metadata: grpc.Metadata = new grpc.Metadata();
  const isRateLimited: boolean =
    refusal.kind === TelemetryIngestionBudgetRefusalKind.RateLimited;

  if (isRateLimited && refusal.retryAfterSeconds) {
    metadata.set(
      "grpc-status-details-bin",
      encodeGoogleRpcStatus({
        code: grpc.status.RESOURCE_EXHAUSTED,
        message: refusal.message,
        retryDelaySeconds: refusal.retryAfterSeconds,
      }),
    );
  }

  return Object.assign(new Error(refusal.message), {
    code: grpc.status.RESOURCE_EXHAUSTED,
    details: refusal.message,
    metadata: metadata,
  });
}

/*
 * The yes/no view of authenticateGrpcRequest: the key's project, or null for
 * every refusal. handleExport needs the refusal itself and does not call this;
 * it stays for callers that only ask "which project, if any" (the gRPC auth
 * tests among them).
 */
// Exported for tests.
export async function authenticateRequest(
  metadata: grpc.Metadata,
): Promise<ObjectID | null> {
  const authentication: GrpcAuthenticationResult =
    await authenticateGrpcRequest(metadata);

  return "projectId" in authentication ? authentication.projectId : null;
}

// Exported for tests.
export function buildTelemetryRequest(
  body: Record<string, unknown>,
  metadata: grpc.Metadata,
  projectId: ObjectID,
  productType: ProductType,
): TelemetryRequest {
  const metadataMap: { [key: string]: grpc.MetadataValue } = metadata.getMap();

  const rawHeaders: Record<string, string> = {};
  for (const key in metadataMap) {
    rawHeaders[key] = metadataMap[key]!.toString();
  }

  /*
   * Project the metadata map down to only the headers worker-side code
   * actually consumes. The full map carries the raw ingestion token
   * (x-oneuptime-token / x-oneuptime-service-token / ...), and everything
   * placed on `headers` here is copied into the BullMQ job payload by
   * TelemetryQueueService and serialized into Redis per job — where it
   * would be visible in failed-job listings. The whitelist lives next to
   * the enqueue path so both the HTTP and gRPC producers share one
   * definition of "what the worker reads".
   */
  const headers: Record<string, string> =
    pickWorkerConsumedRequestHeaders(rawHeaders);

  const req: Partial<TelemetryRequest> = {
    body: body,
    headers: headers,
    projectId: projectId,
    productType: productType,
    path: `/otlp/v1/${productType}`,
    url: `/otlp/v1/${productType}`,
  };

  return req as TelemetryRequest;
}

export async function handleExport(
  call: GrpcCall,
  callback: GrpcCallback,
  productType: ProductType,
  queueFn: (req: TelemetryRequest) => Promise<void>,
): Promise<void> {
  try {
    if (TelemetryIngestionDisabled.isDisabled()) {
      /*
       * DISABLE_TELEMETRY_INGESTION is set. Drop the request silently and
       * return success so the OTel SDK does not retry.
       */
      callback(null, {});
      return;
    }

    const authentication: GrpcPolicyAuthenticationResult =
      await authenticateGrpcRequestWithPolicy(call.metadata);

    if ("refusal" in authentication) {
      /*
       * Answered, not swallowed (GH#3978): HTTP's sentence for the same
       * refusal under a non-retryable status - see GrpcCredentialRefusal.
       * For a key that resolved, its id - which the caller is not told - is
       * in the server log with the guard's reason code, from
       * authenticateGrpcRequest.
       */
      callback(
        buildServiceError(
          authentication.refusal.code,
          authentication.refusal.message,
        ),
      );
      return;
    }

    const projectId: ObjectID = authentication.projectId;

    const body: Record<string, unknown> = call.request;

    const req: TelemetryRequest = buildTelemetryRequest(
      body,
      call.metadata,
      projectId,
      productType,
    );

    /*
     * Ingestion budgets: the project's and the key's, for this signal,
     * counted at the export's protobuf size. Nothing is read from Redis unless
     * a budget or a rate is in force.
     */
    if (isTelemetryIngestionBudgetSignal(productType)) {
      const admission: TelemetryIngestionBudgetAdmission =
        await TelemetryIngestionBudget.admit({
          projectId: projectId,
          signal: productType,
          ingestionKeyPolicy: authentication.policy,
          mode: TelemetryIngestionBudgetAdmissionMode.Refuse,
          measure: () => {
            const size: number | undefined = getExportMessageSize(call.request);

            return {
              bytes:
                size !== undefined
                  ? size
                  : Buffer.byteLength(
                      JSON.stringify(body, binaryToBase64Replacer) || "",
                    ),
              isExact: true,
            };
          },
        });

      if (admission.refusal) {
        TelemetryIngestRefusalRecorder.record({
          projectId: projectId,
          ingestionKeyId: authentication.policy.ingestionKeyId,
          reason: getTelemetryIngestRefusalReasonForBudget(admission.refusal),
          surface: TelemetryIngestSurface.Grpc,
        });

        callback(buildIngestionBudgetServiceError(admission.refusal));
        return;
      }

      /*
       * The charge, not the policy, rides on the request: the queue reads
       * the charge so the export is counted once, and attaching the policy
       * would also start pinning service.name on this port, which it has
       * never done.
       */
      req.telemetryIngestionBudgetCharge = admission.charge;
    }

    /*
     * Acknowledge only after queue admission. A success returned for a batch
     * the queue never accepted is silent data loss: the exporter releases its
     * buffer on success and the payload cannot be re-derived. Same ordering
     * as SecurityEventsIngestService and the session replay ingest path - see
     * TelemetryQueueService.addSessionReplayIngestJob.
     *
     * Scoped to the enqueue ALONE, deliberately. The terminal catch below
     * also covers authenticateGrpcRequest, and mapping a Postgres or billing
     * outage onto a retryable UNAVAILABLE would have every exporter retry an
     * already-degraded auth backend - uncached, because
     * getPolicyFromSecretKey caches the not-found and success paths but never
     * a throw - on a port that carries no per-key rate limit (the limiter is
     * HTTP-only; see TelemetryIngestionKeyGuard).
     */
    try {
      await queueFn(req);
    } catch (queueErr) {
      /*
       * Logged in full here because the exporter is told nothing: the
       * ServiceError below carries a fixed string and empty metadata, so the
       * backend error, the request payload and the ingestion token never
       * leave the process. The server log is not part of that exposure
       * surface, and it is the only diagnostic an operator has.
       */
      logger.error(`gRPC ${productType} queue admission failed:`, {
        service: "telemetry",
      });
      logger.error(queueErr, { service: "telemetry" });

      // UNAVAILABLE is the retryable status in the OTLP gRPC status mapping.
      callback(
        buildServiceError(
          grpc.status.UNAVAILABLE,
          "Telemetry queue unavailable. Please retry.",
        ),
      );
      return;
    }

    /*
     * The key is now in use, so "Last Used At" and the guides' first-data
     * wait see a key that sends only over gRPC (issue #7887). Stamped through
     * the helper the HTTP ingest middleware uses, and only here, once the
     * queue has taken the export: a refused credential, a budget or billing
     * refusal and a failed enqueue all return before this line or throw past
     * it. Fire and forget, so the acknowledgement never waits on it.
     */
    TelemetryIngestionKeyLastUsed.stamp(authentication.policy);

    callback(null, {});
  } catch (err) {
    /*
     * A billing refusal is thrown while the key resolves; the key service
     * noted which key, so it is counted against it (issue #6378).
     */
    recordTelemetryIngestBillingRefusal({
      err,
      surface: TelemetryIngestSurface.Grpc,
    });

    if (err instanceof PaymentRequiredException) {
      /*
       * Billing admission, thrown by getPolicyFromSecretKey only for a key
       * that resolved and is enabled and unexpired. PERMISSION_DENIED is
       * non-retryable, so an unpaid project's exporter logs the reason once
       * per batch instead of retrying it.
       */
      callback({
        name: "PaymentRequiredException",
        message: err.message,
        code: grpc.status.PERMISSION_DENIED,
        details: err.message,
        metadata: new grpc.Metadata(),
      });
      return;
    }

    if (err instanceof ProjectBlockedException) {
      /*
       * A master admin blocked the key's project, also thrown by
       * getPolicyFromSecretKey. Non-retryable for the same reason: the
       * exporter is told once per batch, rather than its data being taken
       * and dropped as an answered success.
       */
      callback({
        name: "ProjectBlockedException",
        message: err.message,
        code: grpc.status.PERMISSION_DENIED,
        details: err.message,
        metadata: new grpc.Metadata(),
      });
      return;
    }

    logger.error(`gRPC ${productType} export error:`, { service: "telemetry" });
    logger.error(err, { service: "telemetry" });
    // Return success to avoid OTel SDK retries
    callback(null, {});
  }
}

/*
 * One shared option set for all four OTLP service definitions, exported so
 * a test can pin it — these options are load-bearing and a silent edit
 * would pass the whole suite otherwise:
 *
 * - `defaults: false`: with `defaults: true`, every decoded OTLP object
 *   carried explicit zero values for all UNSET fields —
 *   droppedAttributesCount: 0, flags: 0, empty arrays, "0" longs,
 *   zero-value enum names — and all of that got JSON.stringify'd into the
 *   Redis-backed job payload for every single export. The worker must
 *   tolerate the omitted form anyway: the HTTP OTLP/JSON path and the
 *   deferred protobuf decode (protobufjs' `.toJSON()` in
 *   OtelPayloadDecoder) both OMIT defaults, and the ingest services read
 *   these fields with fallbacks (`|| 0`, optional access, `Array.isArray`
 *   guards). Omitting defaults here just makes the gRPC producer emit the
 *   same lean shape as every other producer.
 * - `longs: String`: uint64 fields (timeUnixNano ~1.7e18) exceed
 *   Number.MAX_SAFE_INTEGER; the ingest services parse them from
 *   string|number. A Long object here would JSON.stringify as
 *   {low, high, unsigned} and corrupt every timestamp.
 * - `enums: String` / `keepCase: false` / `oneofs: true`: match the shape
 *   protobufjs `.toJSON()` produces on the HTTP protobuf path, so worker
 *   code sees one shape regardless of producer.
 */
export const OTLP_PROTO_LOADER_OPTIONS: protoLoader.Options = {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: false,
  oneofs: true,
  includeDirs: [PROTO_DIR],
};

export function startGrpcServer(): void {
  const traceServiceDef: protoLoader.PackageDefinition = protoLoader.loadSync(
    path.join(PROTO_DIR, "trace_service.proto"),
    OTLP_PROTO_LOADER_OPTIONS,
  );

  const logsServiceDef: protoLoader.PackageDefinition = protoLoader.loadSync(
    path.join(PROTO_DIR, "logs_service.proto"),
    OTLP_PROTO_LOADER_OPTIONS,
  );

  const metricsServiceDef: protoLoader.PackageDefinition = protoLoader.loadSync(
    path.join(PROTO_DIR, "metrics_service.proto"),
    OTLP_PROTO_LOADER_OPTIONS,
  );

  const profilesServiceDef: protoLoader.PackageDefinition =
    protoLoader.loadSync(
      path.join(PROTO_DIR, "profiles_service.proto"),
      OTLP_PROTO_LOADER_OPTIONS,
    );

  const traceProto: grpc.GrpcObject =
    grpc.loadPackageDefinition(traceServiceDef);
  const logsProto: grpc.GrpcObject = grpc.loadPackageDefinition(logsServiceDef);
  const metricsProto: grpc.GrpcObject =
    grpc.loadPackageDefinition(metricsServiceDef);
  const profilesProto: grpc.GrpcObject =
    grpc.loadPackageDefinition(profilesServiceDef);

  type ProtoServiceDef = {
    service: grpc.ServiceDefinition;
  };

  function getServiceDefinition(
    proto: grpc.GrpcObject,
    ...path: Array<string>
  ): grpc.ServiceDefinition {
    let current: unknown = proto;
    for (const key of path) {
      current = (current as Record<string, unknown>)[key];
    }
    return (current as ProtoServiceDef).service;
  }

  const traceServiceDefinition: grpc.ServiceDefinition = getServiceDefinition(
    traceProto,
    "opentelemetry",
    "proto",
    "collector",
    "trace",
    "v1",
    "TraceService",
  );

  const logsServiceDefinition: grpc.ServiceDefinition = getServiceDefinition(
    logsProto,
    "opentelemetry",
    "proto",
    "collector",
    "logs",
    "v1",
    "LogsService",
  );

  const metricsServiceDefinition: grpc.ServiceDefinition = getServiceDefinition(
    metricsProto,
    "opentelemetry",
    "proto",
    "collector",
    "metrics",
    "v1",
    "MetricsService",
  );

  const profilesServiceDefinition: grpc.ServiceDefinition =
    getServiceDefinition(
      profilesProto,
      "opentelemetry",
      "proto",
      "collector",
      "profiles",
      "v1development",
      "ProfilesService",
    );

  const server: grpc.Server = new grpc.Server({
    "grpc.max_receive_message_length": 50 * 1024 * 1024, // 50MB
  });

  server.addService(recordMessageSizes(traceServiceDefinition), {
    Export: (call: GrpcCall, callback: GrpcCallback): void => {
      handleExport(
        call,
        callback,
        ProductType.Traces,
        TracesQueueService.addTraceIngestJob.bind(TracesQueueService),
      );
    },
  });

  server.addService(recordMessageSizes(logsServiceDefinition), {
    Export: (call: GrpcCall, callback: GrpcCallback): void => {
      handleExport(
        call,
        callback,
        ProductType.Logs,
        LogsQueueService.addLogIngestJob.bind(LogsQueueService),
      );
    },
  });

  server.addService(recordMessageSizes(metricsServiceDefinition), {
    Export: (call: GrpcCall, callback: GrpcCallback): void => {
      handleExport(
        call,
        callback,
        ProductType.Metrics,
        MetricsQueueService.addMetricIngestJob.bind(MetricsQueueService),
      );
    },
  });

  server.addService(recordMessageSizes(profilesServiceDefinition), {
    Export: (call: GrpcCall, callback: GrpcCallback): void => {
      handleExport(
        call,
        callback,
        ProductType.Profiles,
        ProfilesQueueService.addProfileIngestJob.bind(ProfilesQueueService),
      );
    },
  });

  server.bindAsync(
    `0.0.0.0:${GRPC_PORT}`,
    grpc.ServerCredentials.createInsecure(),
    (err: Error | null, port: number): void => {
      if (err) {
        logger.error("Failed to start gRPC server:", { service: "telemetry" });
        logger.error(err, { service: "telemetry" });
        return;
      }
      logger.info(`gRPC OTLP server started on port: ${port}`, {
        service: "telemetry",
      });
    },
  );
}
