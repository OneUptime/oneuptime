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
import OnlineCheck from "../../../Utils/OnlineCheck";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import DataSourceEgressGuard from "Common/Server/Utils/DataSource/EgressGuard";
import EgressGuardException, {
  EgressFailureReason,
} from "Common/Types/Exception/EgressGuardException";
import { JSONObject } from "Common/Types/JSON";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import Sleep from "Common/Types/Sleep";
import API, { APIFetchOptions } from "Common/Utils/API";
import * as http from "http";
import { AddressInfo, Socket } from "net";

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
  /*
   * Body-dependent criteria make Website request GET. These transport tests
   * do not evaluate criteria; that happens after the probe returns a result.
   */
  const bodyCriteria: MonitorCriteriaInstance =
    new MonitorCriteriaInstance().setFilters([
      {
        checkOn: CheckOn.ResponseBody,
        filterType: FilterType.IsNotEmpty,
        value: undefined,
      },
    ]);
  const value: JSONObject = {
    id: ObjectID.generate().toString(),
    monitorDestination: { _type: "URL", value: data.url },
    requestType: "GET",
    monitorCriteria: {
      _type: "MonitorCriteria",
      value: { monitorCriteriaInstanceArray: [bodyCriteria.toJSON()] },
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

async function executeStep(
  step: MonitorStep,
  monitorType: MonitorType,
): Promise<ProbeMonitorResponse> {
  const response: ProbeMonitorResponse | null =
    await MonitorUtil.probeMonitorStep({
      monitorStep: step,
      monitorType,
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

describe.each([
  { name: "API", monitorType: MonitorType.API },
  { name: "Website", monitorType: MonitorType.Website },
])(
  "API-created $name monitor step retries over HTTP",
  (monitorCase: { name: string; monitorType: MonitorType }) => {
    let server: http.Server;
    let serverUrl: string;
    let requestCount: number;
    let sleepSpy: jest.SpyInstance;
    const sockets: Set<Socket> = new Set();

    const probeStep: (step: MonitorStep) => Promise<ProbeMonitorResponse> = (
      step: MonitorStep,
    ) => {
      return executeStep(step, monitorCase.monitorType);
    };

    const expectSocketsClosed: () => Promise<void> = async () => {
      for (let turn: number = 0; turn < 100 && sockets.size > 0; turn++) {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 10);
        });
      }
      expect(sockets.size).toBe(0);
    };

    beforeAll(async () => {
      server = http.createServer(
        (
          request: http.IncomingMessage,
          response: http.ServerResponse,
        ): void => {
          requestCount++;

          if (
            request.url === "/body-timeout" ||
            (request.url === "/body-timeout-recover" && requestCount === 1)
          ) {
            response.writeHead(503, { "Content-Type": "application/json" });
            response.write('{"statusCode":503,"pending":');
            return;
          }

          if (
            request.url === "/disconnect" ||
            (request.url === "/mixed" && requestCount === 3)
          ) {
            request.socket.destroy();
            return;
          }

          if (
            request.url === "/timeout" ||
            (request.url === "/timeout-recover" && requestCount === 1) ||
            (request.url === "/mixed" && requestCount === 1)
          ) {
            // Leave the response pending until this attempt's deadline aborts it.
            return;
          }

          response.setHeader("Content-Type", "application/json");
          if (request.url === "/healthy") {
            response.statusCode = 200;
          } else if (request.url === "/not-found") {
            response.statusCode = 404;
          } else if (request.url === "/rate-limited") {
            response.statusCode = 429;
          } else if (
            (request.url === "/recover" || request.url === "/recover-404") &&
            requestCount > 1
          ) {
            response.statusCode = 200;
          } else if (request.url === "/recover-404") {
            response.statusCode = 404;
          } else if (
            request.url === "/timeout-recover" ||
            request.url === "/body-timeout-recover" ||
            (request.url === "/mixed" && requestCount === 4)
          ) {
            response.statusCode = 200;
          } else if (request.url === "/mixed") {
            response.statusCode = 429;
          } else {
            response.statusCode = 503;
          }
          response.end(JSON.stringify({ statusCode: response.statusCode }));
        },
      );

      server.on("connection", (socket: Socket) => {
        sockets.add(socket);
        socket.on("close", () => {
          sockets.delete(socket);
        });
      });

      await new Promise<void>((resolve: () => void) => {
        server.listen(0, "127.0.0.1", resolve);
      });
      const address: AddressInfo = server.address() as AddressInfo;
      serverUrl = `http://127.0.0.1:${address.port}`;
    });

    beforeEach(() => {
      requestCount = 0;
      /*
       * Keep real request preparation, destination pinning, sockets and retries.
       * Only this test server is permitted through the private-network guard.
       */
      jest
        .spyOn(DataSourceEgressGuard, "assertUrlAllowed")
        .mockImplementation(async (rawUrl: string) => {
          const url: globalThis.URL = new globalThis.URL(rawUrl);
          if (url.origin !== serverUrl) {
            throw new Error(
              "Unexpected request outside the HTTP retry fixture",
            );
          }
          return {
            url,
            addresses: [{ address: "127.0.0.1", family: 4 }],
          };
        });
      sleepSpy = jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined);
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
      { name: "HTTP 404 responses", path: "/not-found", statusCode: 404 },
      { name: "HTTP 429 responses", path: "/rate-limited", statusCode: 429 },
      { name: "HTTP 503 responses", path: "/unavailable", statusCode: 503 },
      {
        name: "connection failures",
        path: "/disconnect",
        statusCode: undefined,
      },
    ])(
      "with persistent $name",
      (failure: {
        name: string;
        path: string;
        statusCode: number | undefined;
      }) => {
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
            expect(response.isOnline).toBe(failure.statusCode !== undefined);
            expect(response.responseCode).toBe(failure.statusCode);
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

    it.each([
      { path: "/recover-404", firstCode: 404 },
      { path: "/timeout-recover", firstCode: undefined },
    ])(
      "recovers after $path with a fresh attempt and stops immediately",
      async (scenario: { path: string; firstCode: number | undefined }) => {
        const response: ProbeMonitorResponse = await probeStep(
          apiStepFromPayload({
            url: `${serverUrl}${scenario.path}`,
            retryCount: 3,
            requestTimeoutInMs: 1000,
          }),
        );

        expect(requestCount).toBe(2);
        expectAttempts(response, 2);
        expect(response.responseCode).toBe(200);
        expect(response.isOnline).toBe(true);
        expect(response.isTimeout).toBe(false);
        expect(
          response.probeAttempts!.map((attempt: ProbeAttempt) => {
            return attempt.responseCode;
          }),
        ).toEqual([scenario.firstCode, 200]);
        expect(sleepSpy).toHaveBeenCalledTimes(1);
        await expectSocketsClosed();
      },
    );

    it.each([
      { path: "/body-timeout", recovers: false },
      { path: "/body-timeout-recover", recovers: true },
    ])(
      "closes stalled error response bodies before finishing retries for $path",
      async (scenario: { path: string; recovers: boolean }) => {
        const response: ProbeMonitorResponse = await probeStep(
          apiStepFromPayload({
            url: `${serverUrl}${scenario.path}`,
            retryCount: 1,
            requestTimeoutInMs: 1000,
          }),
        );

        expect(requestCount).toBe(2);
        expectAttempts(response, 2);
        expect(response.isTimeout).toBe(!scenario.recovers);
        expect(response.isOnline).toBe(scenario.recovers);
        expect(response.responseCode).toBe(scenario.recovers ? 200 : undefined);
        expect(
          response.probeAttempts![0]!.failureCause?.toLowerCase(),
        ).toContain("timeout");
        expect(
          response.probeAttempts!.map((attempt: ProbeAttempt) => {
            return attempt.responseCode;
          }),
        ).toEqual([undefined, scenario.recovers ? 200 : undefined]);
        expect(sleepSpy).toHaveBeenCalledTimes(1);
        await expectSocketsClosed();
      },
    );

    it("records mixed failures and recovery as four ordered attempts", async () => {
      const response: ProbeMonitorResponse = await probeStep(
        apiStepFromPayload({
          url: `${serverUrl}/mixed`,
          retryCount: 3,
          requestTimeoutInMs: 1000,
        }),
      );

      expect(requestCount).toBe(4);
      expectAttempts(response, 4);
      expect(response.responseCode).toBe(200);
      expect(response.isTimeout).toBe(false);
      expect(
        response.probeAttempts!.map((attempt: ProbeAttempt) => {
          return attempt.responseCode;
        }),
      ).toEqual([undefined, 429, undefined, 200]);
      expect(sleepSpy).toHaveBeenCalledTimes(3);
      await expectSocketsClosed();
    });

    it("does not hide an initial failure when zero retries are requested", async () => {
      const response: ProbeMonitorResponse = await probeStep(
        apiStepFromPayload({ url: `${serverUrl}/recover`, retryCount: 0 }),
      );

      expect(requestCount).toBe(1);
      expectAttempts(response, 1);
      expect(response.responseCode).toBe(503);
      expect(sleepSpy).not.toHaveBeenCalled();
    });

    it.each([{ path: "/healthy", statusCode: 200 }])(
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

    it.each(
      RETRY_CASES.filter((retryCase: RetryCase) => {
        return (
          retryCase.retryCount === undefined ||
          retryCase.retryCount === null ||
          retryCase.retryCount === 0 ||
          retryCase.retryCount === 3
        );
      }),
    )(
      "makes $expectedAttempts timed-out attempts when retryCount is $name",
      async (retryCase: RetryCase) => {
        const response: ProbeMonitorResponse = await probeStep(
          apiStepFromPayload({
            url: `${serverUrl}/timeout`,
            requestTimeoutInMs: 1000,
            retryCount: retryCase.retryCount,
          }),
        );

        expect(requestCount).toBe(retryCase.expectedAttempts);
        expectAttempts(response, retryCase.expectedAttempts);
        expect(response.isTimeout).toBe(true);
        expect(response.isOnline).toBe(false);
        expect(sleepSpy).toHaveBeenCalledTimes(retryCase.expectedAttempts - 1);
        for (const attempt of response.probeAttempts!) {
          expect(attempt.isOnline).toBe(false);
          expect(attempt.responseReceivedAt.getTime()).toBeGreaterThanOrEqual(
            attempt.attemptedAt.getTime(),
          );
          expect(attempt.failureCause?.toLowerCase()).toContain("timeout");
        }
        await expectSocketsClosed();
      },
    );

    it.each([
      {
        name: "timeout recovery",
        path: "/timeout-recover",
        expectedAttempts: 2,
        expectedCode: 200,
      },
      {
        name: "exhausted HTTP failures",
        path: "/not-found",
        expectedAttempts: 4,
        expectedCode: 404,
      },
    ])(
      "ingests only the final result after $name",
      async (scenario: {
        name: string;
        path: string;
        expectedAttempts: number;
        expectedCode: number;
      }) => {
        const monitor: Monitor = new Monitor(MONITOR_ID);
        monitor.projectId = PROJECT_ID;
        monitor.monitorType = monitorCase.monitorType;
        monitor.monitorSteps = new MonitorSteps();
        monitor.monitorSteps.setMonitorStepsInstanceArray([
          apiStepFromPayload({
            url: `${serverUrl}${scenario.path}`,
            retryCount: 3,
            requestTimeoutInMs: 1000,
          }),
        ]);
        const ingestedResults: Array<ProbeMonitorResponse> = [];
        const requestCountsAtIngest: Array<number> = [];
        const realFetch: typeof API.fetch = API.fetch.bind(API);

        /*
         * Intercept only the result upload. The monitor still traverses production
         * request preparation, HTTP transport, retries and final-result ingestion.
         */
        jest
          .spyOn(API, "fetch")
          .mockImplementation((request: APIFetchOptions) => {
            if (
              request.method === HTTPMethod.POST &&
              request.url.toString().endsWith("/probe/response/ingest")
            ) {
              ingestedResults.push(
                (request.data as JSONObject)[
                  "probeMonitorResponse"
                ] as unknown as ProbeMonitorResponse,
              );
              requestCountsAtIngest.push(requestCount);
              request.options?.onRequestComplete?.({
                method: request.method,
                url: request.url.toString(),
                elapsedInMs: 0,
                attempts: 1,
                statusCode: 200,
              });
              return Promise.resolve(
                new HTTPResponse<JSONObject>(200, {}, {}),
              ) as never;
            }
            return realFetch(request) as never;
          });

        await MonitorUtil.probeMonitor(monitor);

        expect(ingestedResults).toHaveLength(1);
        expect(requestCountsAtIngest).toEqual([scenario.expectedAttempts]);
        expect(requestCount).toBe(scenario.expectedAttempts);
        expectAttempts(ingestedResults[0]!, scenario.expectedAttempts);
        expect(ingestedResults[0]!.responseCode).toBe(scenario.expectedCode);
        expect(ingestedResults[0]!.isTimeout).toBe(false);
        expect(sleepSpy).toHaveBeenCalledTimes(scenario.expectedAttempts - 1);
        await expectSocketsClosed();
      },
    );

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
  },
);
