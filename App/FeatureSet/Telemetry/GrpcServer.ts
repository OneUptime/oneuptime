import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TracesQueueService from "./Services/Queue/TracesQueueService";
import LogsQueueService from "./Services/Queue/LogsQueueService";
import MetricsQueueService from "./Services/Queue/MetricsQueueService";
import ProfilesQueueService from "./Services/Queue/ProfilesQueueService";

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

async function authenticateRequest(
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

  const token: TelemetryIngestionKey | null =
    await TelemetryIngestionKeyService.findOneBy({
      query: {
        secretKey: new ObjectID(oneuptimeToken),
      },
      select: {
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

  if (!token || !token.projectId) {
    logger.error("gRPC: Invalid service token: " + oneuptimeToken, {
      service: "telemetry",
    });
    return null;
  }

  return token.projectId as ObjectID;
}

function buildTelemetryRequest(
  body: Record<string, unknown>,
  metadata: grpc.Metadata,
  projectId: ObjectID,
  productType: ProductType,
): TelemetryRequest {
  const headers: Record<string, string> = {};
  const metadataMap: { [key: string]: grpc.MetadataValue } = metadata.getMap();

  for (const key in metadataMap) {
    headers[key] = metadataMap[key]!.toString();
  }

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

export function startGrpcServer(): void {
  const traceServiceDef: protoLoader.PackageDefinition = protoLoader.loadSync(
    path.join(PROTO_DIR, "trace_service.proto"),
    {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_DIR],
    },
  );

  const logsServiceDef: protoLoader.PackageDefinition = protoLoader.loadSync(
    path.join(PROTO_DIR, "logs_service.proto"),
    {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_DIR],
    },
  );

  const metricsServiceDef: protoLoader.PackageDefinition = protoLoader.loadSync(
    path.join(PROTO_DIR, "metrics_service.proto"),
    {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_DIR],
    },
  );

  const profilesServiceDef: protoLoader.PackageDefinition =
    protoLoader.loadSync(path.join(PROTO_DIR, "profiles_service.proto"), {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_DIR],
    });

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
