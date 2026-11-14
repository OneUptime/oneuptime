import * as grpc from "@grpc/grpc-js";
import { startGrpcServer } from "../../FeatureSet/Telemetry/GrpcServer";
import LogsQueueService from "../../FeatureSet/Telemetry/Services/Queue/LogsQueueService";
import MetricsQueueService from "../../FeatureSet/Telemetry/Services/Queue/MetricsQueueService";
import ProfilesQueueService from "../../FeatureSet/Telemetry/Services/Queue/ProfilesQueueService";
import TracesQueueService from "../../FeatureSet/Telemetry/Services/Queue/TracesQueueService";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import logger from "Common/Server/Utils/Logger";
import TelemetryIngestionBudget from "Common/Server/Utils/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionKeyLastUsed from "Common/Server/Utils/Telemetry/TelemetryIngestionKeyLastUsed";
import TelemetryIngestRefusalRecorder from "Common/Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import PaymentRequiredException from "Common/Types/Exception/PaymentRequiredException";
import ProjectBlockedException from "Common/Types/Exception/ProjectBlockedException";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import {
  TelemetryIngestionBudgetRefusal,
  TelemetryIngestionBudgetRefusalKind,
  TelemetryIngestionBudgetScope,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";

/*
 * A KEY USED ONLY OVER OTLP/gRPC SHOWS AS USED (issue #7887).
 *
 * An ingestion key's lastUsedAt is what "Last Used At" and the telemetry
 * guides' first-data wait read. The HTTP ingest middleware stamped it; the
 * gRPC server authenticated keys its own way and never did, so a key used
 * only over gRPC - the OpenTelemetry Collector's default exporter - read
 * "never used" however much it sent.
 *
 * Both now stamp through one helper, TelemetryIngestionKeyLastUsed. This
 * suite drives the Export closures startGrpcServer itself registers, for all
 * four signals, through every way an export can end:
 *
 *   - accepted: the key that sent it is stamped once, through the shared
 *     helper, only after the queue has taken the export, and the
 *     acknowledgement waits for neither the write nor its failure;
 *   - refused (no key, unknown, disabled, expired, a browser key, over a
 *     budget, unpaid or blocked project) or failed (the queue, the key
 *     lookup), or dropped because ingestion is switched off: nothing is
 *     stamped. A refused key is not "used", and a failed export is retried
 *     by the exporter, and the retry stamps.
 *
 * The key service, the budget gate and the queues are replaced at the module
 * boundary; GrpcServerAuthStatusLive.test.ts runs the same server over a
 * real socket, beside the HTTP middleware, and
 * GrpcServerKeyLastUsedPostgres.test.ts writes the stamp to a real row.
 */

jest.mock("Common/Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: { getPolicyFromSecretKey: jest.fn(), markUsed: jest.fn() },
  };
});
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {},
    QueueName: { Telemetry: "Telemetry" },
  };
});
jest.mock("Common/Server/Utils/Telemetry/TelemetryIngestionBudget", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Telemetry/TelemetryIngestionBudget",
  ) as Record<string, unknown>;

  return { __esModule: true, ...actual, default: { admit: jest.fn() } };
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

type ExportCallback = (
  error: grpc.ServiceError | null,
  response?: Record<string, unknown>,
) => void;

type ExportHandler = (
  call: { request: Record<string, unknown>; metadata: grpc.Metadata },
  callback: ExportCallback,
) => void;

interface Signal {
  name: string;
  service: string;
  product: ProductType;
  getQueue: () => jest.Mock;
}

const signals: Array<Signal> = [
  {
    name: "traces",
    service: "TraceService",
    product: ProductType.Traces,
    getQueue: (): jest.Mock => {
      return TracesQueueService.addTraceIngestJob as unknown as jest.Mock;
    },
  },
  {
    name: "logs",
    service: "LogsService",
    product: ProductType.Logs,
    getQueue: (): jest.Mock => {
      return LogsQueueService.addLogIngestJob as unknown as jest.Mock;
    },
  },
  {
    name: "metrics",
    service: "MetricsService",
    product: ProductType.Metrics,
    getQueue: (): jest.Mock => {
      return MetricsQueueService.addMetricIngestJob as unknown as jest.Mock;
    },
  },
  {
    name: "profiles",
    service: "ProfilesService",
    product: ProductType.Profiles,
    getQueue: (): jest.Mock => {
      return ProfilesQueueService.addProfileIngestJob as unknown as jest.Mock;
    },
  },
];

const PROJECT_ID: ObjectID = ObjectID.generate();
const TOKEN: string = "grpc-key-last-used-token";

// The Export closures startGrpcServer registers, by service name.
const handlers: Map<string, ExportHandler> = new Map();

let stamp: jest.SpyInstance;

interface ExportOutcome {
  error: grpc.ServiceError | null;
  response: Record<string, unknown> | undefined;
}

const getResolverMock: () => jest.Mock = (): jest.Mock => {
  return TelemetryIngestionKeyService.getPolicyFromSecretKey as unknown as jest.Mock;
};

const getMarkUsedMock: () => jest.Mock = (): jest.Mock => {
  return TelemetryIngestionKeyService.markUsed as unknown as jest.Mock;
};

const getAdmitMock: () => jest.Mock = (): jest.Mock => {
  return TelemetryIngestionBudget.admit as unknown as jest.Mock;
};

type BuildPolicyFunction = (
  overrides?: Partial<TelemetryIngestionKeyPolicy>,
) => TelemetryIngestionKeyPolicy;

// A healthy Server key with an id of its own.
const buildPolicy: BuildPolicyFunction = (
  overrides: Partial<TelemetryIngestionKeyPolicy> = {},
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
    ...overrides,
  };
};

type TokenMetadataFunction = (token: string | null) => grpc.Metadata;

const tokenMetadata: TokenMetadataFunction = (
  token: string | null,
): grpc.Metadata => {
  const metadata: grpc.Metadata = new grpc.Metadata();
  metadata.set("x-oneuptime-service-name", "grpc-key-last-used");
  if (token !== null) {
    metadata.set("x-oneuptime-token", token);
  }
  return metadata;
};

type ExportWithFunction = (
  signal: Signal,
  metadata: grpc.Metadata,
) => Promise<ExportOutcome>;

// One Export call, through the closure the production server registered.
const exportWith: ExportWithFunction = (
  signal: Signal,
  metadata: grpc.Metadata,
): Promise<ExportOutcome> => {
  return new Promise<ExportOutcome>(
    (resolve: (outcome: ExportOutcome) => void): void => {
      handlers.get(signal.service)!(
        { request: { syntheticPayload: signal.name }, metadata },
        (
          error: grpc.ServiceError | null,
          response?: Record<string, unknown>,
        ): void => {
          resolve({ error, response });
        },
      );
    },
  );
};

type BudgetRefusalFunction = (
  kind: TelemetryIngestionBudgetRefusalKind,
  scope: TelemetryIngestionBudgetScope,
) => TelemetryIngestionBudgetRefusal;

const budgetRefusal: BudgetRefusalFunction = (
  kind: TelemetryIngestionBudgetRefusalKind,
  scope: TelemetryIngestionBudgetScope,
): TelemetryIngestionBudgetRefusal => {
  return {
    kind,
    scope,
    signal: ProductType.Logs,
    message: "refused for a test",
    retryAfterSeconds:
      kind === TelemetryIngestionBudgetRefusalKind.RateLimited ? 4 : null,
    resetsAt: new Date("2026-11-15T00:00:00Z"),
  };
};

// Lets fire-and-forget work (a rejected stamp and its .catch) run out.
const settle: () => Promise<void> = (): Promise<void> => {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
};

const expectNothingStamped: () => void = (): void => {
  expect(stamp).not.toHaveBeenCalled();
  expect(getMarkUsedMock()).not.toHaveBeenCalled();
};

beforeAll(() => {
  // Capture the registered Export closures, without binding any port.
  jest
    .spyOn(grpc.Server.prototype, "addService")
    .mockImplementation(
      (
        definition: grpc.ServiceDefinition,
        implementation: grpc.UntypedServiceImplementation,
      ): void => {
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

  // Calls through: the key service's (mocked) markUsed is still reached.
  stamp = jest.spyOn(TelemetryIngestionKeyLastUsed, "stamp");
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const level of ["error", "warn", "info"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined;
    });
  }
  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
  // Refusals are counted against the key; that count has its own suites.
  jest
    .spyOn(TelemetryIngestRefusalRecorder, "record")
    .mockImplementation(() => {});
  getResolverMock().mockReset().mockResolvedValue(buildPolicy());
  getMarkUsedMock().mockReset().mockResolvedValue(undefined);
  getAdmitMock().mockReset().mockResolvedValue({ refusal: null, charge: null });
  for (const signal of signals) {
    signal.getQueue().mockReset().mockResolvedValue(undefined);
  }
});

afterAll(() => {
  jest.restoreAllMocks();
});

/*
 * One way an export ends without being accepted. `arrange` sets up what the
 * key lookup, the budget gate, the queue or the kill switch does; `code` is
 * what the exporter is answered, checked so each case is known to have
 * reached the branch it names.
 */
interface UnstampedCase {
  label: string;
  token: string | null;
  arrange: (signal: Signal) => void;
  code: grpc.status;
}

const UNSTAMPED_CASES: Array<UnstampedCase> = [
  {
    label: "no token",
    token: null,
    arrange: (): void => {},
    code: grpc.status.UNAUTHENTICATED,
  },
  {
    label: "a token no key has",
    token: TOKEN,
    arrange: (): void => {
      getResolverMock().mockResolvedValue(null);
    },
    code: grpc.status.UNAUTHENTICATED,
  },
  {
    label: "a disabled key",
    token: TOKEN,
    arrange: (): void => {
      getResolverMock().mockResolvedValue(buildPolicy({ isEnabled: false }));
    },
    code: grpc.status.PERMISSION_DENIED,
  },
  {
    label: "an expired key",
    token: TOKEN,
    arrange: (): void => {
      getResolverMock().mockResolvedValue(
        buildPolicy({ expiresAt: new Date(Date.now() - 60 * 1000) }),
      );
    },
    code: grpc.status.UNAUTHENTICATED,
  },
  {
    label: "a browser key, which no browser can send over gRPC",
    token: TOKEN,
    arrange: (): void => {
      getResolverMock().mockResolvedValue(
        buildPolicy({
          keyType: TelemetryIngestionKeyType.Browser,
          allowedOrigins: ["https://shop.example.com"],
        }),
      );
    },
    code: grpc.status.PERMISSION_DENIED,
  },
  {
    label: "an export over the project's daily ingestion budget",
    token: TOKEN,
    arrange: (): void => {
      getAdmitMock().mockResolvedValue({
        refusal: budgetRefusal(
          TelemetryIngestionBudgetRefusalKind.DailyBudgetExhausted,
          TelemetryIngestionBudgetScope.Project,
        ),
        charge: null,
      });
    },
    code: grpc.status.RESOURCE_EXHAUSTED,
  },
  {
    label: "an export over the key's own ingestion rate",
    token: TOKEN,
    arrange: (): void => {
      getAdmitMock().mockResolvedValue({
        refusal: budgetRefusal(
          TelemetryIngestionBudgetRefusalKind.RateLimited,
          TelemetryIngestionBudgetScope.IngestionKey,
        ),
        charge: null,
      });
    },
    code: grpc.status.RESOURCE_EXHAUSTED,
  },
  {
    label: "an export the queue rejects",
    token: TOKEN,
    arrange: (signal: Signal): void => {
      signal.getQueue().mockRejectedValue(new Error("queue is down"));
    },
    code: grpc.status.UNAVAILABLE,
  },
  {
    label: "an export the queue throws on",
    token: TOKEN,
    arrange: (signal: Signal): void => {
      signal.getQueue().mockImplementation(() => {
        throw new Error("queue is down");
      });
    },
    code: grpc.status.UNAVAILABLE,
  },
  {
    label: "a key of a project with no way to pay",
    token: TOKEN,
    arrange: (): void => {
      getResolverMock().mockRejectedValue(
        new PaymentRequiredException("Add a payment method to ingest."),
      );
    },
    code: grpc.status.PERMISSION_DENIED,
  },
  {
    label: "a key of a project an administrator blocked",
    token: TOKEN,
    arrange: (): void => {
      getResolverMock().mockRejectedValue(new ProjectBlockedException());
    },
    code: grpc.status.PERMISSION_DENIED,
  },
  /*
   * The two branches answered OK on purpose (no retry storm on a degraded
   * key lookup; a paused install): the export is dropped, not accepted.
   */
  {
    label: "a key whose lookup fails (answered OK, data dropped)",
    token: TOKEN,
    arrange: (): void => {
      getResolverMock().mockRejectedValue(new Error("postgres is down"));
    },
    code: grpc.status.OK,
  },
  {
    label:
      "an export while ingestion is switched off (answered OK, data dropped)",
    token: TOKEN,
    arrange: (): void => {
      jest
        .spyOn(TelemetryIngestionDisabled, "isDisabled")
        .mockReturnValue(true);
    },
    code: grpc.status.OK,
  },
];

describe.each(signals)(
  "gRPC $name export: the key's last-used stamp",
  (signal: Signal) => {
    test("an accepted export stamps the key that sent it, once, through the shared helper - after the queue has taken it", async () => {
      const policy: TelemetryIngestionKeyPolicy = buildPolicy();
      getResolverMock().mockResolvedValue(policy);

      let takeIntoQueue!: () => void;
      let enterQueue!: () => void;
      const enteredQueue: Promise<void> = new Promise<void>(
        (resolve: () => void): void => {
          enterQueue = resolve;
        },
      );
      signal.getQueue().mockImplementation((): Promise<void> => {
        enterQueue();
        return new Promise<void>((resolve: () => void): void => {
          takeIntoQueue = resolve;
        });
      });

      const outcome: Promise<ExportOutcome> = exportWith(
        signal,
        tokenMetadata(TOKEN),
      );

      // Authenticated and within budget, but not yet taken: not yet used.
      await enteredQueue;
      expectNothingStamped();

      takeIntoQueue();

      expect(await outcome).toEqual({ error: null, response: {} });
      expect(stamp).toHaveBeenCalledTimes(1);
      expect(stamp).toHaveBeenCalledWith(policy);
      expect(getMarkUsedMock()).toHaveBeenCalledTimes(1);
      expect(getMarkUsedMock().mock.calls[0]![0]).toBe(policy.ingestionKeyId);
      expect(signal.getQueue()).toHaveBeenCalledTimes(1);
    });

    test("each export stamps its own key", async () => {
      const first: TelemetryIngestionKeyPolicy = buildPolicy();
      const second: TelemetryIngestionKeyPolicy = buildPolicy({
        pinnedServiceName: "checkout",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      getResolverMock()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second);

      for (let call: number = 0; call < 2; call++) {
        expect(
          (await exportWith(signal, tokenMetadata(TOKEN))).error,
        ).toBeNull();
      }

      expect(
        getMarkUsedMock().mock.calls.map((args: Array<unknown>): unknown => {
          return args[0];
        }),
      ).toEqual([first.ingestionKeyId, second.ingestionKeyId]);
    });

    test("the acknowledgement does not wait for the stamp to be written", async () => {
      // A write that never finishes must not hold the export's answer.
      getMarkUsedMock().mockReturnValue(new Promise<void>((): void => {}));

      expect(await exportWith(signal, tokenMetadata(TOKEN))).toEqual({
        error: null,
        response: {},
      });
      expect(getMarkUsedMock()).toHaveBeenCalledTimes(1);
    });

    test("a stamp that fails is logged with the key's id, and the export is still acknowledged", async () => {
      const policy: TelemetryIngestionKeyPolicy = buildPolicy();
      getResolverMock().mockResolvedValue(policy);
      getMarkUsedMock().mockRejectedValue(
        new Error("database is having a bad day"),
      );

      expect(await exportWith(signal, tokenMetadata(TOKEN))).toEqual({
        error: null,
        response: {},
      });
      await settle();

      // Caught by the helper's .catch, not by handleExport's error path.
      expect(logger.warn).toHaveBeenCalledWith(
        `TelemetryIngest: failed to record last used for ingestion key ${policy.ingestionKeyId.toString()}`,
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    test.each(UNSTAMPED_CASES)(
      "nothing is stamped for $label",
      async (unstamped: UnstampedCase) => {
        unstamped.arrange(signal);

        const outcome: ExportOutcome = await exportWith(
          signal,
          tokenMetadata(unstamped.token),
        );
        await settle();

        expect(outcome.error?.code ?? grpc.status.OK).toBe(unstamped.code);
        expectNothingStamped();
      },
    );
  },
);
