import * as grpc from "@grpc/grpc-js";
import { startGrpcServer } from "../../FeatureSet/Telemetry/GrpcServer";
import LogsQueueService from "../../FeatureSet/Telemetry/Services/Queue/LogsQueueService";
import MetricsQueueService from "../../FeatureSet/Telemetry/Services/Queue/MetricsQueueService";
import ProfilesQueueService from "../../FeatureSet/Telemetry/Services/Queue/ProfilesQueueService";
import TracesQueueService from "../../FeatureSet/Telemetry/Services/Queue/TracesQueueService";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";

jest.mock("Common/Server/Services/TelemetryIngestionKeyService", () => {
  return { __esModule: true, default: { getPolicyFromSecretKey: jest.fn() } };
});
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

type ExportHandler = (
  call: { request: Record<string, unknown>; metadata: grpc.Metadata },
  callback: (
    error: grpc.ServiceError | null,
    response?: Record<string, unknown>,
  ) => void,
) => void;

const handlers: Map<string, ExportHandler> = new Map();
const projectId: ObjectID = ObjectID.generate();
interface Signal {
  name: string;
  queue: (req: TelemetryRequest) => Promise<void>;
  product: ProductType;
  service: string;
}

const signals: Array<Signal> = [
  {
    name: "logs",
    queue: LogsQueueService.addLogIngestJob,
    product: ProductType.Logs,
    service: "LogsService",
  },
  {
    name: "metrics",
    queue: MetricsQueueService.addMetricIngestJob,
    product: ProductType.Metrics,
    service: "MetricsService",
  },
  {
    name: "profiles",
    queue: ProfilesQueueService.addProfileIngestJob,
    product: ProductType.Profiles,
    service: "ProfilesService",
  },
  {
    name: "traces",
    queue: TracesQueueService.addTraceIngestJob,
    product: ProductType.Traces,
    service: "TraceService",
  },
];

function call(): { request: Record<string, unknown>; metadata: grpc.Metadata } {
  const metadata: grpc.Metadata = new grpc.Metadata();
  metadata.set("x-oneuptime-token", "synthetic-token");
  metadata.set("x-oneuptime-service-name", "synthetic-service");
  return { request: { syntheticPayload: "must-not-be-logged" }, metadata };
}

beforeAll(() => {
  /*
   * Capture the real registered Export closures, without binding any port.
   * Proto loading, signal-to-queue wiring and handleExport all remain real.
   */
  jest
    .spyOn(grpc.Server.prototype, "addService")
    .mockImplementation(
      (
        definition: grpc.ServiceDefinition,
        implementation: grpc.UntypedServiceImplementation,
      ) => {
        const exportMethod: grpc.MethodDefinition<unknown, unknown> =
          definition["Export"]!;
        const service: string = exportMethod.path
          .split("/")[1]!
          .split(".")
          .pop()!;
        handlers.set(service, implementation["Export"] as ExportHandler);
      },
    );
  jest.spyOn(grpc.Server.prototype, "bindAsync").mockImplementation(() => {
    return undefined;
  });
  startGrpcServer();
  expect(handlers.size).toBe(4);
});

beforeEach(() => {
  jest.clearAllMocks();
  (
    TelemetryIngestionKeyService.getPolicyFromSecretKey as jest.Mock
  ).mockResolvedValue({
    ingestionKeyId: ObjectID.generate(),
    projectId,
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
  });
  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
  for (const signal of signals) {
    (signal.queue as jest.Mock).mockReset();
  }
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe.each(signals)(
  "gRPC $name enqueue acknowledgement",
  ({ queue, product, service }: Signal) => {
    test("acknowledges exactly once only after admission, with unchanged empty response", async () => {
      let admit!: () => void;
      let started!: () => void;
      const enteredQueue: Promise<void> = new Promise((resolve: () => void) => {
        started = resolve;
      });
      (queue as jest.Mock).mockImplementation(() => {
        started();
        return new Promise<void>((resolve: () => void) => {
          admit = resolve;
        });
      });
      const request: ReturnType<typeof call> = call();
      const callback: jest.Mock = jest.fn();
      const completed: Promise<void> = new Promise((resolve: () => void) => {
        handlers.get(service)!(
          request,
          (
            error: grpc.ServiceError | null,
            result?: Record<string, unknown>,
          ) => {
            callback(error, result);
            resolve();
          },
        );
      });
      await enteredQueue;
      const earlyCallbacks: number = callback.mock.calls.length;
      admit();
      await completed;

      expect(earlyCallbacks).toBe(0);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(null, {});
      expect(queue).toHaveBeenCalledTimes(1);
      const queued: TelemetryRequest = (queue as jest.Mock).mock.calls[0]![0];
      expect(queued.body).toBe(request.request);
      expect(queued.projectId).toBe(projectId);
      expect(queued.productType).toBe(product);
      expect(queued.headers).toEqual({
        "x-oneuptime-service-name": "synthetic-service",
      });
    });

    test.each(["reject", "throw"])(
      "returns sanitized UNAVAILABLE exactly once on queue %s",
      async (mode: string) => {
        (queue as jest.Mock).mockImplementation(() => {
          const failure: Error = new Error("private-payload-and-backend-error");
          if (mode === "throw") {
            throw failure;
          }
          return Promise.reject(failure);
        });
        const callback: jest.Mock = jest.fn();
        await new Promise<void>((resolve: () => void) => {
          handlers.get(service)!(
            call(),
            (
              error: grpc.ServiceError | null,
              result?: Record<string, unknown>,
            ) => {
              callback(error, result);
              resolve();
            },
          );
        });
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(
          expect.objectContaining({
            code: grpc.status.UNAVAILABLE,
            details: "Telemetry queue unavailable. Please retry.",
          }),
          undefined,
        );
        expect(queue).toHaveBeenCalledTimes(1);
        const error: grpc.ServiceError = callback.mock.calls[0]![0];
        expect(error.message).toBe(
          "Telemetry queue unavailable. Please retry.",
        );
        expect(error.metadata).toBeInstanceOf(grpc.Metadata);
        expect(error.metadata.getMap()).toEqual({});
        expect(
          JSON.stringify((logger.error as jest.Mock).mock.calls),
        ).not.toContain("private-payload-and-backend-error");
        expect(
          JSON.stringify((logger.error as jest.Mock).mock.calls),
        ).not.toContain("must-not-be-logged");
      },
    );

    test.each(["disabled", "unauthenticated"])(
      "preserves intentional %s drop without queueing",
      async (mode: string) => {
        if (mode === "disabled") {
          jest
            .spyOn(TelemetryIngestionDisabled, "isDisabled")
            .mockReturnValue(true);
        } else {
          (
            TelemetryIngestionKeyService.getPolicyFromSecretKey as jest.Mock
          ).mockResolvedValue(null);
        }
        const callback: jest.Mock = jest.fn();
        await new Promise<void>((resolve: () => void) => {
          handlers.get(service)!(
            call(),
            (
              error: grpc.ServiceError | null,
              result?: Record<string, unknown>,
            ) => {
              callback(error, result);
              resolve();
            },
          );
        });
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(null, {});
        expect(queue).not.toHaveBeenCalled();
      },
    );
  },
);
