import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import TelemetryIngestionKeyGuard, {
  TelemetryIngestionKeyRefusal,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionKeyGuard";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import TracesQueueService from "./Services/Queue/TracesQueueService";
import LogsQueueService from "./Services/Queue/LogsQueueService";
import MetricsQueueService from "./Services/Queue/MetricsQueueService";
import ProfilesQueueService from "./Services/Queue/ProfilesQueueService";
import { pickWorkerConsumedRequestHeaders } from "./Services/Queue/TelemetryQueueService";

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

// Exported for tests.
export async function authenticateRequest(
  metadata: grpc.Metadata,
): Promise<ObjectID | null> {
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
    return null;
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
    return null;
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
    return null;
  }

  return policy.projectId;
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

async function handleExport(
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

    const projectId: ObjectID | null = await authenticateRequest(call.metadata);

    if (!projectId) {
      // Return success to avoid OTel SDK retries
      callback(null, {});
      return;
    }

    const body: Record<string, unknown> = call.request;

    const req: TelemetryRequest = buildTelemetryRequest(
      body,
      call.metadata,
      projectId,
      productType,
    );

    await queueFn(req);

    callback(null, {});
  } catch (err) {
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

  server.addService(traceServiceDefinition, {
    Export: (call: GrpcCall, callback: GrpcCallback): void => {
      handleExport(
        call,
        callback,
        ProductType.Traces,
        TracesQueueService.addTraceIngestJob.bind(TracesQueueService),
      );
    },
  });

  server.addService(logsServiceDefinition, {
    Export: (call: GrpcCall, callback: GrpcCallback): void => {
      handleExport(
        call,
        callback,
        ProductType.Logs,
        LogsQueueService.addLogIngestJob.bind(LogsQueueService),
      );
    },
  });

  server.addService(metricsServiceDefinition, {
    Export: (call: GrpcCall, callback: GrpcCallback): void => {
      handleExport(
        call,
        callback,
        ProductType.Metrics,
        MetricsQueueService.addMetricIngestJob.bind(MetricsQueueService),
      );
    },
  });

  server.addService(profilesServiceDefinition, {
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
