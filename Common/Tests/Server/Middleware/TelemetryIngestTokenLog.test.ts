import { describe, expect, test, beforeEach } from "@jest/globals";
import TelemetryIngest from "../../../Server/Middleware/TelemetryIngest";
import TelemetryIngestionKeyService from "../../../Server/Services/TelemetryIngestionKeyService";
import Response from "../../../Server/Utils/Response";
import logger from "../../../Server/Utils/Logger";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";

/*
 * The token resolver is mocked so the invalid-token branch can be forced
 * without a database; the middleware under test must never see a real
 * Postgres/Redis dependency.
 */
jest.mock("../../../Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: {
      getProjectIdFromSecretKey: jest.fn(),
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

type MockFn = jest.Mock;

/*
 * Regression pin for the secret-leak fix in isAuthorizedServiceMiddleware:
 * an invalid ingestion token must never appear in any log output. The gRPC
 * half of the same fix is pinned by GrpcServerAuth.test.ts in App; this
 * covers the HTTP middleware half, which fronts the higher-traffic
 * OTLP/syslog/fluent ingest routes and whose logger.error lines also land
 * in the in-process recentLogs ring buffer surfaced on the admin health
 * pages.
 */
describe("TelemetryIngest.isAuthorizedServiceMiddleware token logging", () => {
  /*
   * Deliberately shaped like a real (mistyped) ingestion key so a substring
   * check is meaningful.
   */
  const SENTINEL_TOKEN: string = "sentinel-secret-ingestion-key-12345";

  let loggedErrorArgs: Array<Array<unknown>>;
  let errorSpy: { mockRestore: () => void };

  const buildRequest: (headers: Record<string, string>) => ExpressRequest = (
    headers: Record<string, string>,
  ): ExpressRequest => {
    return {
      headers,
      id: "test-request-id",
    } as unknown as ExpressRequest;
  };

  const runMiddleware: (req: ExpressRequest) => Promise<void> = async (
    req: ExpressRequest,
  ): Promise<void> => {
    const res: ExpressResponse = {} as ExpressResponse;
    const next: NextFunction = jest.fn() as unknown as NextFunction;
    await TelemetryIngest.isAuthorizedServiceMiddleware(req, res, next);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    loggedErrorArgs = [];
    const spy: unknown = jest
      .spyOn(logger, "error")
      .mockImplementation((...args: Array<unknown>) => {
        loggedErrorArgs.push(args);
        return undefined as never;
      });
    errorSpy = spy as { mockRestore: () => void };
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  test("invalid token: responds 401 and never logs the token value", async () => {
    (
      TelemetryIngestionKeyService.getProjectIdFromSecretKey as MockFn
    ).mockResolvedValue(null as never);

    await runMiddleware(buildRequest({ "x-oneuptime-token": SENTINEL_TOKEN }));

    // The invalid-token branch must still log — just without the secret.
    expect(loggedErrorArgs.length).toBeGreaterThan(0);
    for (const args of loggedErrorArgs) {
      expect(JSON.stringify(args)).not.toContain(SENTINEL_TOKEN);
    }

    const sendErrorResponse: MockFn = Response.sendErrorResponse as MockFn;
    expect(sendErrorResponse).toHaveBeenCalledTimes(1);
    const errorArg: unknown = sendErrorResponse.mock.calls[0]?.[2];
    expect(errorArg).toBeInstanceOf(NotAuthenticatedException);
    // The response body must not echo the token either.
    expect(JSON.stringify((errorArg as Error).message)).not.toContain(
      SENTINEL_TOKEN,
    );
  });

  test("invalid token via the alternate header names is not logged either", async () => {
    (
      TelemetryIngestionKeyService.getProjectIdFromSecretKey as MockFn
    ).mockResolvedValue(null as never);

    for (const headerName of [
      "x-oneuptime-service-token",
      "x-oneuptime-ingestion-key",
    ]) {
      loggedErrorArgs = [];
      await runMiddleware(buildRequest({ [headerName]: SENTINEL_TOKEN }));

      expect(loggedErrorArgs.length).toBeGreaterThan(0);
      for (const args of loggedErrorArgs) {
        expect(JSON.stringify(args)).not.toContain(SENTINEL_TOKEN);
      }
    }
  });

  test("missing token: responds 401 without consulting the resolver", async () => {
    await runMiddleware(buildRequest({}));

    expect(
      TelemetryIngestionKeyService.getProjectIdFromSecretKey as MockFn,
    ).not.toHaveBeenCalled();
    expect(Response.sendErrorResponse as MockFn).toHaveBeenCalledTimes(1);
  });
});
