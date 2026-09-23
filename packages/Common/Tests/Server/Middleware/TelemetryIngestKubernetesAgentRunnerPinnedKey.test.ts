import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import TelemetryIngest, {
  TelemetryRequest,
} from "../../../Server/Middleware/TelemetryIngest";
import TelemetryIngestionKeyService from "../../../Server/Services/TelemetryIngestionKeyService";
import Response from "../../../Server/Utils/Response";
import TelemetryIngestionKeyRateLimiter, {
  TelemetryIngestionKeyLimitOutcome,
} from "../../../Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import TelemetryIngestionKeyPolicy from "../../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import TelemetryIngestSurface from "../../../Types/Telemetry/TelemetryIngestSurface";

/*
 * The Kubernetes agent Runner registration endpoint mints the Runner
 * identity every kubectl job for a cluster is targeted at. A telemetry
 * ingestion key pinned to one service's name was scoped by its owner to
 * that service's telemetry, so it must not stand up cluster access:
 *
 *   1. On the registration surface a pinned server key is refused (403),
 *      before the rate limiter is even consulted, with a message that says
 *      which key to use instead — and nothing about the key itself.
 *   2. An unpinned server key is admitted there as before.
 *   3. A pinned key keeps working on every telemetry surface (its pin is
 *      applied when the payload is processed, as it always was).
 *
 * Same module-boundary mocks as the other ingest guard suites: no Postgres,
 * no Redis.
 */

jest.mock("../../../Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: {
      getPolicyFromSecretKey: jest.fn(),
      getProjectIdFromSecretKey: jest.fn(),
      markUsed: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
    },
  };
});

jest.mock(
  "../../../Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter",
    ) as Record<string, unknown>;

    return {
      __esModule: true,
      ...actual,
      default: {
        consume: jest.fn(),
      },
    };
  },
);

type MockFn = jest.Mock;

const PROJECT_ID: string = "5d3b0f1a-0000-4000-8000-000000000021";
const INGESTION_KEY_ID: string = "5d3b0f1a-0000-4000-8000-000000000022";
const SENTINEL_TOKEN: string = "sentinel-secret-ingestion-key-24680";

function serverPolicy(
  overrides: Partial<TelemetryIngestionKeyPolicy>,
): TelemetryIngestionKeyPolicy {
  return {
    ingestionKeyId: new ObjectID(INGESTION_KEY_ID),
    projectId: new ObjectID(PROJECT_ID),
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
    ...overrides,
  };
}

interface RunResult {
  req: ExpressRequest;
  next: MockFn;
}

async function run(surface: TelemetryIngestSurface): Promise<RunResult> {
  const req: ExpressRequest = {
    headers: { "x-oneuptime-token": SENTINEL_TOKEN },
    id: "test-request-id",
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    setHeader: jest.fn(),
  } as unknown as ExpressResponse;
  const next: MockFn = jest.fn();

  await TelemetryIngest.forSurface(surface)(
    req,
    res,
    next as unknown as NextFunction,
  );

  return { req, next };
}

describe("TelemetryIngest refuses a service-pinned key for Kubernetes agent Runner registration", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (TelemetryIngestionKeyService.markUsed as MockFn).mockResolvedValue(
      undefined as never,
    );
    (TelemetryIngestionKeyRateLimiter.consume as MockFn).mockResolvedValue({
      outcome: TelemetryIngestionKeyLimitOutcome.Allowed,
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a pinned server key is refused 403 on the registration surface, before the limiter", async () => {
    (
      TelemetryIngestionKeyService.getPolicyFromSecretKey as MockFn
    ).mockResolvedValue(
      serverPolicy({ pinnedServiceName: "checkout-api" }) as never,
    );

    const result: RunResult = await run(
      TelemetryIngestSurface.KubernetesAgentRunner,
    );

    expect(result.next).not.toHaveBeenCalled();
    expect(
      TelemetryIngestionKeyRateLimiter.consume as MockFn,
    ).not.toHaveBeenCalled();

    const sendErrorResponse: MockFn = Response.sendErrorResponse as MockFn;
    expect(sendErrorResponse).toHaveBeenCalledTimes(1);

    const error: Error = sendErrorResponse.mock.calls[0]?.[2] as Error;
    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error.message).toContain("pinned to a single service");
    expect(error.message).toContain("unpinned server ingestion key");
    expect(error.message).not.toContain(SENTINEL_TOKEN);
    expect(error.message).not.toContain("checkout-api");

    // The request never learns which project the key belongs to.
    expect((result.req as TelemetryRequest).projectId).toBeUndefined();
  });

  test("negative control: an unpinned server key registers as before", async () => {
    (
      TelemetryIngestionKeyService.getPolicyFromSecretKey as MockFn
    ).mockResolvedValue(serverPolicy({ pinnedServiceName: null }) as never);

    const result: RunResult = await run(
      TelemetryIngestSurface.KubernetesAgentRunner,
    );

    expect(Response.sendErrorResponse as MockFn).not.toHaveBeenCalled();
    expect(result.next).toHaveBeenCalledTimes(1);
    expect((result.req as TelemetryRequest).projectId.toString()).toBe(
      PROJECT_ID,
    );
  });

  test("negative control: the pinned key keeps working on every telemetry surface", async () => {
    (
      TelemetryIngestionKeyService.getPolicyFromSecretKey as MockFn
    ).mockResolvedValue(
      serverPolicy({ pinnedServiceName: "checkout-api" }) as never,
    );

    const telemetrySurfaces: Array<TelemetryIngestSurface> = (
      Object.values(TelemetryIngestSurface) as Array<TelemetryIngestSurface>
    ).filter((surface: TelemetryIngestSurface): boolean => {
      return surface !== TelemetryIngestSurface.KubernetesAgentRunner;
    });

    expect(telemetrySurfaces.length).toBeGreaterThan(0);

    for (const surface of telemetrySurfaces) {
      jest.clearAllMocks();
      (TelemetryIngestionKeyService.markUsed as MockFn).mockResolvedValue(
        undefined as never,
      );

      const result: RunResult = await run(surface);

      expect(Response.sendErrorResponse as MockFn).not.toHaveBeenCalled();
      expect(result.next).toHaveBeenCalledTimes(1);
    }
  });
});
