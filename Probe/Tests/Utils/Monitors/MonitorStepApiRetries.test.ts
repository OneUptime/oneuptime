// Set required env vars before importing anything that pulls Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";
// A different value from the portal's usual default of 3 exposes inheritance.
process.env["PROBE_MONITOR_RETRY_LIMIT"] = "2";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import MonitorUtil from "../../../Utils/Monitors/Monitor";
import { HttpMonitorExecutionContext } from "../../../Utils/Monitors/HttpMonitorRequest";
import OnlineCheck from "../../../Utils/OnlineCheck";
import DataSourceEgressGuard from "Common/Server/Utils/DataSource/EgressGuard";
import EgressGuardException, {
  EgressFailureReason,
} from "Common/Types/Exception/EgressGuardException";
import { JSONObject } from "Common/Types/JSON";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import * as http from "http";
import { AddressInfo } from "net";

jest.setTimeout(30000);

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

const PROJECT_ID: ObjectID = ObjectID.generate();
const MONITOR_ID: ObjectID = ObjectID.generate();

interface RetryCase {
  name: string;
  retryCount: number | null | undefined;
  expectedAttempts: number;
}

const RETRY_CASES: Array<RetryCase> = [
  { name: "omitted", retryCount: undefined, expectedAttempts: 3 },
  { name: "null", retryCount: null, expectedAttempts: 3 },
  { name: "explicit 0", retryCount: 0, expectedAttempts: 1 },
  { name: "explicit 1", retryCount: 1, expectedAttempts: 2 },
  { name: "explicit 2", retryCount: 2, expectedAttempts: 3 },
  { name: "explicit 3", retryCount: 3, expectedAttempts: 4 },
  { name: "above the maximum", retryCount: 99, expectedAttempts: 4 },
];

function apiStepFromPayload(data: {
  url: string;
  retryCount?: number | null | undefined;
  requestTimeoutInMs?: number | undefined;
}): MonitorStep {
  const value: JSONObject = {
    id: ObjectID.generate().toString(),
    monitorDestination: { _type: "URL", value: data.url },
    requestType: "GET",
    monitorCriteria: {
      _type: "MonitorCriteria",
      value: { monitorCriteriaInstanceArray: [] },
    },
  };

  // Match an API-created/stored step where the property is actually absent.
  if (data.retryCount !== undefined) {
    value["retryCount"] = data.retryCount;
  }

  if (data.requestTimeoutInMs !== undefined) {
    value["requestTimeoutInMs"] = data.requestTimeoutInMs;
  }

  return MonitorStep.fromJSON({ _type: "MonitorStep", value });
}

async function probeStep(step: MonitorStep): Promise<ProbeMonitorResponse> {
  const response: ProbeMonitorResponse | null =
    await MonitorUtil.probeMonitorStep({
      monitorStep: step,
      monitorType: MonitorType.API,
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
    });

  expect(response).not.toBeNull();
  return response!;
}

function expectAttempts(
  response: ProbeMonitorResponse,
  expectedAttempts: number,
): void {
  expect(response.totalAttempts).toBe(expectedAttempts);
  expect(response.probeAttempts).toHaveLength(expectedAttempts);
  expect(
    response.probeAttempts!.map((attempt: ProbeAttempt) => {
      return attempt.attemptNumber;
    }),
  ).toEqual(
    Array.from(
      { length: expectedAttempts },
      (_value: unknown, index: number) => {
        return index + 1;
      },
    ),
  );
}

describe("API-created monitor step retries over HTTP", () => {
  let server: http.Server;
  let serverUrl: string;
  let requestCount: number;
  let sleepSpy: jest.SpyInstance;

  beforeAll(async () => {
    server = http.createServer(
      (request: http.IncomingMessage, response: http.ServerResponse): void => {
        requestCount++;

        if (request.url === "/disconnect") {
          request.socket.destroy();
          return;
        }

        if (request.url === "/timeout") {
          // Leave the response pending until the monitor's deadline aborts it.
          return;
        }

        response.setHeader("Content-Type", "application/json");
        if (request.url === "/healthy") {
          response.statusCode = 200;
        } else if (request.url === "/not-found") {
          response.statusCode = 404;
        } else if (request.url === "/recover" && requestCount > 1) {
          response.statusCode = 200;
        } else {
          response.statusCode = 503;
        }
        response.end(JSON.stringify({ statusCode: response.statusCode }));
      },
    );

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address: AddressInfo = server.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    requestCount = 0;
    // Keep real request preparation, destination pinning, sockets and retries.
    // Only this test server is permitted through the private-network guard.
    jest
      .spyOn(DataSourceEgressGuard, "assertUrlAllowed")
      .mockImplementation(async (rawUrl: string) => {
        const url: globalThis.URL = new globalThis.URL(rawUrl);
        if (url.origin !== serverUrl) {
          throw new Error("Unexpected request outside the HTTP retry fixture");
        }
        return {
          url,
          addresses: [{ address: "127.0.0.1", family: 4 }],
        };
      });
    sleepSpy = jest
      .spyOn(HttpMonitorExecutionContext.prototype, "sleep")
      .mockResolvedValue(undefined);
    jest
      .spyOn(OnlineCheck, "canProbeMonitorWebsiteMonitors")
      .mockResolvedValue(true);
  });

  afterEach(() => {
    server.closeAllConnections();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  describe.each([
    { name: "HTTP 503 responses", path: "/unavailable", isOnline: true },
    { name: "connection failures", path: "/disconnect", isOnline: false },
  ])(
    "with persistent $name",
    (failure: { name: string; path: string; isOnline: boolean }) => {
      it.each(RETRY_CASES)(
        "makes $expectedAttempts attempts when retryCount is $name",
        async (retryCase: RetryCase) => {
          const step: MonitorStep = apiStepFromPayload({
            url: `${serverUrl}${failure.path}`,
            retryCount: retryCase.retryCount,
          });

          const response: ProbeMonitorResponse = await probeStep(step);

          expect(requestCount).toBe(retryCase.expectedAttempts);
          expectAttempts(response, retryCase.expectedAttempts);
          expect(response.isOnline).toBe(failure.isOnline);
          expect(response.responseCode).toBe(
            failure.isOnline ? 503 : undefined,
          );
          expect(sleepSpy).toHaveBeenCalledTimes(
            retryCase.expectedAttempts - 1,
          );
          if (
            retryCase.retryCount === undefined ||
            retryCase.retryCount === null
          ) {
            // Execution must inherit the probe setting without storing an override.
            expect(step.data!.retryCount).toBeUndefined();
          }
        },
      );
    },
  );

  it.each([
    { name: "the inherited retry count", retryCount: undefined },
    { name: "an explicit retry count", retryCount: 3 },
  ])(
    "recovers on the second attempt with $name",
    async (retryCase: { name: string; retryCount: number | undefined }) => {
      const response: ProbeMonitorResponse = await probeStep(
        apiStepFromPayload({
          url: `${serverUrl}/recover`,
          retryCount: retryCase.retryCount,
        }),
      );

      expect(requestCount).toBe(2);
      expectAttempts(response, 2);
      expect(response.responseCode).toBe(200);
      expect(
        response.probeAttempts!.map((attempt: ProbeAttempt) => {
          return attempt.responseCode;
        }),
      ).toEqual([503, 200]);
      expect(sleepSpy).toHaveBeenCalledTimes(1);
    },
  );

  it("does not hide an initial failure when zero retries are requested", async () => {
    const response: ProbeMonitorResponse = await probeStep(
      apiStepFromPayload({ url: `${serverUrl}/recover`, retryCount: 0 }),
    );

    expect(requestCount).toBe(1);
    expectAttempts(response, 1);
    expect(response.responseCode).toBe(503);
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  it.each([
    { path: "/healthy", statusCode: 200 },
    { path: "/not-found", statusCode: 404 },
  ])(
    "does not retry an HTTP $statusCode response",
    async (scenario: { path: string; statusCode: number }) => {
      const response: ProbeMonitorResponse = await probeStep(
        apiStepFromPayload({ url: `${serverUrl}${scenario.path}` }),
      );

      expect(requestCount).toBe(1);
      expectAttempts(response, 1);
      expect(response.responseCode).toBe(scenario.statusCode);
      expect(sleepSpy).not.toHaveBeenCalled();
    },
  );

  it("stops after the whole-check timeout even when retries are inherited", async () => {
    const response: ProbeMonitorResponse = await probeStep(
      apiStepFromPayload({
        url: `${serverUrl}/timeout`,
        requestTimeoutInMs: 1000,
      }),
    );

    expect(requestCount).toBe(1);
    expectAttempts(response, 1);
    expect(response.isTimeout).toBe(true);
    expect(response.isOnline).toBe(false);
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  it("does not retry an invalid target when retries are inherited", async () => {
    jest
      .spyOn(DataSourceEgressGuard, "assertUrlAllowed")
      .mockRejectedValue(
        new EgressGuardException(
          "Monitor target is invalid.",
          EgressFailureReason.InvalidTarget,
        ),
      );

    const response: ProbeMonitorResponse = await probeStep(
      apiStepFromPayload({ url: `${serverUrl}/unavailable` }),
    );

    expect(requestCount).toBe(0);
    expectAttempts(response, 1);
    expect(response.isOnline).toBe(false);
    expect(response.failureCause).toBe("Monitor target is invalid.");
    expect(sleepSpy).not.toHaveBeenCalled();
    expect(OnlineCheck.canProbeMonitorWebsiteMonitors).not.toHaveBeenCalled();
  });
});
