import SecurityEventConnection from "../../../../../../Models/DatabaseModels/SecurityEventConnection";
import OTelIngestService from "../../../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventConnectionService from "../../../../../../Server/Services/SecurityEventConnectionService";
import SecurityEventService from "../../../../../../Server/Services/SecurityEventService";
import {
  FetchInitLike,
  FetchLike,
  FetchResponseLike,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import GoogleSecOpsConnector from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsConnector";
import SecurityEventConnectionPoller, {
  PollerOverrides,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionPoller";
import SecurityEventConnectorRegistry from "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry";
import OneUptimeDate from "../../../../../../Types/Date";
import { JSONObject } from "../../../../../../Types/JSON";
import { SecurityEventConnectionRunResult } from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import { getJestSpyOn } from "../../../../../Spy";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import http, { IncomingMessage, Server, ServerResponse } from "http";
import { AddressInfo } from "net";
import jwt from "jsonwebtoken";
import {
  INSTANCE,
  PUBLIC_KEY,
  SERVICE_ACCOUNT_EMAIL,
  TOKEN_URI,
  secOpsSettings,
} from "./GoogleSecOpsConnectorFixtures";
import {
  ConnectionUpdate,
  PROJECT_ID,
  PollPersistence,
  keysAndStatuses,
  secOpsConnection,
  stubPollPersistence,
} from "./GoogleSecOpsPollingFixtures";

/*
 * Signing, HTTP serialization, streamed response parsing and the shared
 * poller's persistence decisions together, over real sockets: the REAL
 * SecurityEventConnectionPoller runs a Google SecOps connection whose REAL
 * GoogleSecOpsConnector and GoogleSecOpsClient send every request through a
 * transport that forwards the known Google URLs to a loopback contract
 * simulator. The simulator verifies the RS256 assertion against the key's
 * public half, requires the alerts view's documented query (snapshotQuery
 * serialized explicitly, no unknown parameters) and streams its answer in
 * two chunks. No Google credentials or external network are needed.
 *
 * Only persistence and the source lock are stubbed, as the retired Google
 * SecOps HTTP integration suite stubbed them.
 */

jest.mock(
  "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry",
  () => {
    return {
      __esModule: true,
      default: { getConnector: jest.fn() },
    };
  },
);

const ALERTS_PATH: string = `/v1alpha/${INSTANCE}/legacy:legacyFetchAlertsView`;
const SEARCH_PATHS: Array<string> = [
  `/v1alpha/${INSTANCE}/legacy:legacySearchDetections`,
  `/v1alpha/${INSTANCE}/legacy:legacySearchCuratedDetections`,
];
/*
 * legacySearchCuratedDetections has no wildcard, so the curated pass asks
 * countAllCuratedRuleSetDetections which curated rules to name before it
 * searches any.
 */
const CURATED_COUNTS_PATH: string = `/v1alpha/${INSTANCE}:countAllCuratedRuleSetDetections`;
const WEEK_MS: number = 7 * 24 * 60 * 60 * 1000;
const NOW: Date = new Date("2026-09-09T12:00:00.000Z");
const CURSOR: string = "2026-09-09T11:55:00.000Z";
const OPEN_ALERT: JSONObject = {
  id: "open-alert",
  detectionTime: "2026-09-09T11:56:00.000Z",
  detection: [{ ruleName: "Open detection", severity: "HIGH" }],
  feedbackSummary: { status: "OPEN" },
};
const CLOSED_ALERT: JSONObject = {
  id: "closed-alert",
  detectionTime: "2026-09-09T11:57:00.000Z",
  detection: [{ ruleName: "Closed detection", severity: "LOW" }],
  feedbackSummary: { status: "CLOSED" },
};
const QUERY_FIELDS: Array<string> = [
  "alertListOptions.maxReturnedAlerts",
  "includeNonAlertingDetections",
  "snapshotQuery",
  "timeRange.endTime",
  "timeRange.startTime",
];
const FULL_ERROR_TAIL: string = "final-diagnostic-details-remain-copyable";
const FULL_GOOGLE_ERROR_BODY: string = JSON.stringify({
  error: {
    code: 400,
    status: "INVALID_ARGUMENT",
    message: "Google request diagnostic. ".repeat(80),
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ResourceInfo",
        resourceName: INSTANCE,
        diagnostic: JSON.stringify({
          access_token: "nested-http-diagnostic-token-123",
          resource: INSTANCE,
        }),
      },
      {
        "@type": "type.googleapis.com/google.rpc.BadRequest",
        fieldViolations: [
          {
            field: "snapshotQuery",
            description: "Required query field was not supplied.",
          },
        ],
      },
    ],
    access_token: "local-verified-token",
    private_key: "http-integration-private-key-material",
    client_secret: "http-integration-client-secret-material",
    supportReference: FULL_ERROR_TAIL,
  },
});

/*
 * Captured at import time, before any spy replaces it, so a spy on
 * pollConnection can hand the due connection back to the real poll with the
 * loopback transport attached.
 */
const realPollConnection: (
  connection: SecurityEventConnection,
  overrides?: PollerOverrides | undefined,
) => Promise<number> = SecurityEventConnectionPoller.pollConnection.bind(
  SecurityEventConnectionPoller,
);

describe("Google SecOps polls over HTTP through the shared poller", () => {
  let server: Server;
  let port: number;
  let alertsRequests: Array<URL>;
  let countIntervals: Array<JSONObject>;
  let assertions: Array<JSONObject>;
  let alertsErrorBody: string | null;
  let persistence: PollPersistence;

  function rejectRequest(response: ServerResponse, message: string): void {
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        error: { code: 400, status: "INVALID_ARGUMENT", message },
      }),
    );
  }

  function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    let body: string = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string): void => {
      body += chunk;
    });
    request.on("end", (): void => {
      const url: URL = new URL(request.url || "/", "http://127.0.0.1");

      if (url.pathname === "/token") {
        try {
          const form: URLSearchParams = new URLSearchParams(body);
          if (
            request.method !== "POST" ||
            request.headers["content-type"] !==
              "application/x-www-form-urlencoded" ||
            form.get("grant_type") !==
              "urn:ietf:params:oauth:grant-type:jwt-bearer"
          ) {
            throw new Error("Invalid token exchange request");
          }
          const assertion: JSONObject = jwt.verify(
            form.get("assertion") || "",
            PUBLIC_KEY,
            {
              algorithms: ["RS256"],
              audience: TOKEN_URI,
              issuer: SERVICE_ACCOUNT_EMAIL,
            },
          ) as JSONObject;
          if (
            assertion["scope"] !==
            "https://www.googleapis.com/auth/cloud-platform"
          ) {
            throw new Error("Invalid OAuth scope");
          }
          assertions.push(assertion);
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              access_token: "local-verified-token",
              expires_in: 3600,
            }),
          );
        } catch {
          response.writeHead(401, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "invalid_grant" }));
        }
        return;
      }

      /*
       * The curated rule counts: a POST carrying the interval, answered the
       * way a tenant whose curated rules have not fired answers it, with a
       * bare {}. The curated pass then has no rule to search.
       */
      if (url.pathname === CURATED_COUNTS_PATH && request.method === "POST") {
        if (
          request.headers["authorization"] !== "Bearer local-verified-token"
        ) {
          response.writeHead(401);
          response.end("Bearer token required");
          return;
        }
        if (request.headers["content-type"] !== "application/json") {
          rejectRequest(response, "Expected a JSON request body.");
          return;
        }
        countIntervals.push(
          ((JSON.parse(body || "{}") as JSONObject)["interval"] ||
            {}) as JSONObject,
        );
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end("{}");
        return;
      }

      // The created-time searches answer with an empty page.
      if (SEARCH_PATHS.includes(url.pathname) && request.method === "GET") {
        if (
          request.headers["authorization"] !== "Bearer local-verified-token"
        ) {
          response.writeHead(401);
          response.end("Bearer token required");
          return;
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end("{}");
        return;
      }

      alertsRequests.push(url);
      if (url.pathname !== ALERTS_PATH || request.method !== "GET") {
        response.writeHead(404);
        response.end();
        return;
      }
      if (request.headers["authorization"] !== "Bearer local-verified-token") {
        response.writeHead(401);
        response.end("Bearer token required");
        return;
      }
      for (const key of url.searchParams.keys()) {
        if (!QUERY_FIELDS.includes(key)) {
          rejectRequest(
            response,
            `Cannot bind query parameter. Unknown name "${key}".`,
          );
          return;
        }
      }
      if (!url.searchParams.has("snapshotQuery")) {
        rejectRequest(response, "Missing required field: snapshotQuery");
        return;
      }
      if (
        ![
          "ALERTS_FEATURE_PREFERENCE_ENABLED",
          "ALERTS_FEATURE_PREFERENCE_DISABLED",
        ].includes(url.searchParams.get("includeNonAlertingDetections") || "")
      ) {
        rejectRequest(response, "Invalid includeNonAlertingDetections enum");
        return;
      }
      const startTime: number = Date.parse(
        url.searchParams.get("timeRange.startTime") || "",
      );
      const endTime: number = Date.parse(
        url.searchParams.get("timeRange.endTime") || "",
      );
      const count: number = Number(
        url.searchParams.get("alertListOptions.maxReturnedAlerts"),
      );
      if (!(startTime < endTime) || !Number.isInteger(count) || count < 1) {
        rejectRequest(
          response,
          "Invalid timeRange or alertListOptions.maxReturnedAlerts",
        );
        return;
      }
      if (alertsErrorBody !== null) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(alertsErrorBody);
        return;
      }

      // Match-all must return closed alerts too; a status filter loses them.
      const allAlerts: Array<JSONObject> = [
        OPEN_ALERT,
        ...(url.searchParams.get("snapshotQuery") === "" ? [CLOSED_ALERT] : []),
      ];
      const returnedAlerts: Array<JSONObject> = allAlerts.slice(0, count);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write(
        `[${JSON.stringify({ alerts: { alerts: returnedAlerts.slice(0, 1) }, progress: 0.5 })},`,
      );
      response.end(
        `${JSON.stringify({
          alerts: { alerts: returnedAlerts.slice(1) },
          complete: true,
          progress: 1,
          baselineAlertsCount: allAlerts.length,
          filteredAlertsCount: allAlerts.length,
        })}]`,
      );
    });
  }

  const forwardToServer: FetchLike = (
    url: string,
    init: FetchInitLike,
  ): Promise<FetchResponseLike> => {
    const destination: URL = new URL(url);
    if (
      url !== TOKEN_URI &&
      !(
        destination.origin === "https://us-chronicle.googleapis.com" &&
        (destination.pathname === ALERTS_PATH ||
          destination.pathname === CURATED_COUNTS_PATH ||
          SEARCH_PATHS.includes(destination.pathname))
      )
    ) {
      return Promise.reject(new Error(`Unexpected outbound URL: ${url}`));
    }
    return new Promise<FetchResponseLike>(
      (
        resolve: (response: FetchResponseLike) => void,
        reject: (error: Error) => void,
      ): void => {
        const request: http.ClientRequest = http.request(
          {
            hostname: "127.0.0.1",
            port,
            path: `${destination.pathname}${destination.search}`,
            method: init.method,
            headers: init.headers,
            agent: false,
          },
          (response: IncomingMessage): void => {
            let body: string = "";
            response.setEncoding("utf8");
            response.on("data", (chunk: string): void => {
              body += chunk;
            });
            response.on("error", reject);
            response.on("end", (): void => {
              const status: number = response.statusCode || 500;
              resolve({
                status,
                ok: status >= 200 && status < 300,
                text: async (): Promise<string> => {
                  return body;
                },
              });
            });
          },
        );
        request.on("error", reject);
        request.end(init.body);
      },
    );
  };

  beforeAll(async (): Promise<void> => {
    server = http.createServer(handleRequest);
    await new Promise<void>((resolve: () => void): void => {
      server.listen(0, "127.0.0.1", resolve);
    });
    port = (server.address() as AddressInfo).port;
  });

  beforeEach((): void => {
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
    persistence = stubPollPersistence();
    alertsRequests = [];
    countIntervals = [];
    assertions = [];
    alertsErrorBody = null;
  });

  afterEach((): void => {
    jest.restoreAllMocks();
    (
      SecurityEventConnectorRegistry.getConnector as unknown as jest.Mock
    ).mockReset();
  });

  afterAll(async (): Promise<void> => {
    await new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void): void => {
        server.close((error?: Error): void => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      },
    );
  });

  test("a queued connection test authenticates once and proves read permission over HTTP without importing or writing", async (): Promise<void> => {
    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        secOpsConnection({ cursor: CURSOR }),
        { type: "test" },
        {
          connector: new GoogleSecOpsConnector(forwardToServer),
          settings: secOpsSettings(),
        },
      );

    expect(result.status).toBe("success");
    /*
     * The retired poller reported "Authenticate with Google" and the read
     * steps as "success". The shared loop keeps the connector's own check
     * keys, and a queued test skips the availability counts.
     */
    expect(keysAndStatuses(result.checks)).toEqual([
      "configuration:pass",
      "authentication:pass",
      "rule-detections-read:pass",
      "curated-detections-read:pass",
      "alerts-view-read:pass",
      "detections-available:skip",
    ]);
    expect(alertsRequests).toHaveLength(1);
    expect(
      alertsRequests[0]!.searchParams.get("alertListOptions.maxReturnedAlerts"),
    ).toBe("1");
    /*
     * The curated read probe proves the curated permission through the
     * counts route, over the last 7 days: with no curated rule reported it
     * has no rule id to probe a search with, and the curated route has no
     * wildcard to fall back on.
     */
    expect(countIntervals).toEqual([
      {
        startTime: new Date(NOW.getTime() - WEEK_MS).toISOString(),
        endTime: NOW.toISOString(),
      },
    ]);
    expect(assertions).toHaveLength(1);
    expect(SecurityEventService.insertJsonRows).not.toHaveBeenCalled();
    expect(persistence.updates).toHaveLength(0);
  });

  test.each([
    ["pageSize", "Unknown name"],
    ["missing snapshotQuery", "Missing required field: snapshotQuery"],
    ["full Google diagnostic", "Google request diagnostic."],
  ])(
    "records a %s rejection without advancing, then retries from the cursor and ingests",
    async (invalidRequest: string, expectedError: string): Promise<void> => {
      const connection: SecurityEventConnection = secOpsConnection({
        cursor: CURSOR,
      });
      const updates: Array<JSONObject> = [];
      let currentTime: Date = NOW;
      getJestSpyOn(OneUptimeDate, "getCurrentDate").mockImplementation(
        (): Date => {
          return currentTime;
        },
      );
      getJestSpyOn(SecurityEventConnectionService, "findBy").mockResolvedValue([
        connection,
      ] as never);
      // The row keeps what each poll wrote, as the database would.
      getJestSpyOn(
        SecurityEventConnectionService,
        "updateOneById",
      ).mockImplementation(((call: ConnectionUpdate): Promise<void> => {
        updates.push(call.data);
        Object.assign(connection, call.data);
        return Promise.resolve();
      }) as never);

      let injectInvalidRequest: boolean = true;
      if (invalidRequest === "full Google diagnostic") {
        alertsErrorBody = FULL_GOOGLE_ERROR_BODY;
      }
      const connector: GoogleSecOpsConnector = new GoogleSecOpsConnector(
        (url: string, init: FetchInitLike): Promise<FetchResponseLike> => {
          const outgoing: URL = new URL(url);
          if (injectInvalidRequest && outgoing.pathname === ALERTS_PATH) {
            if (invalidRequest === "pageSize") {
              outgoing.searchParams.set("pageSize", "1000");
            } else if (invalidRequest === "missing snapshotQuery") {
              outgoing.searchParams.delete("snapshotQuery");
            }
          }
          return forwardToServer(outgoing.toString(), init);
        },
      );
      getJestSpyOn(
        SecurityEventConnectionPoller,
        "pollConnection",
      ).mockImplementation(((
        dueConnection: SecurityEventConnection,
      ): Promise<number> => {
        return realPollConnection(dueConnection, {
          connector,
          settings: secOpsSettings(),
        });
      }) as never);

      await SecurityEventConnectionPoller.pollAllDueConnections();

      /*
       * One write: the poll books its own failure, and the loop does not
       * stamp it a second time.
       */
      expect(updates).toHaveLength(1);
      expect(updates[0]!["lastError"]).toContain("HTTP 400");
      expect(updates[0]!["lastError"]).toContain(expectedError);
      expect(updates[0]).not.toHaveProperty("cursor");
      expect(updates[0]!["lastPolledAt"]).toEqual(NOW);
      expect(connection.cursor).toBe(CURSOR);
      expect(persistence.insertedBatches).toEqual([]);
      expect(OTelIngestService.telemetryServiceFromName).not.toHaveBeenCalled();

      if (invalidRequest === "full Google diagnostic") {
        const lastError: string = updates[0]!["lastError"] as string;
        /*
         * Both the old 500-character client slice and the 1,000-character
         * persistence clamp would discard these Google troubleshooting details.
         */
        expect(FULL_GOOGLE_ERROR_BODY.indexOf(FULL_ERROR_TAIL)).toBeGreaterThan(
          1000,
        );
        expect(lastError.length).toBeGreaterThan(1000);
        expect(lastError).toContain(FULL_ERROR_TAIL);
        expect(lastError).toContain(INSTANCE);
        expect(lastError).toContain('"code":400');
        expect(lastError).toContain('"status":"INVALID_ARGUMENT"');
        expect(lastError).toContain(
          "type.googleapis.com/google.rpc.BadRequest",
        );
        expect(lastError).toContain('"field":"snapshotQuery"');
        expect(lastError).toContain("Required query field was not supplied.");
        expect(lastError).toContain('"access_token":"[REDACTED]"');
        expect(lastError).toContain('"private_key":"[REDACTED]"');
        expect(lastError).toContain('"client_secret":"[REDACTED]"');
        expect(lastError).not.toContain("local-verified-token");
        expect(lastError).not.toContain("nested-http-diagnostic-token-123");
        expect(lastError).not.toContain(
          "http-integration-private-key-material",
        );
        expect(lastError).not.toContain(
          "http-integration-client-secret-material",
        );
        expect(lastError).not.toContain("(truncated)");
        expect(connection.lastError).toBe(lastError);
      }

      injectInvalidRequest = false;
      alertsErrorBody = null;
      currentTime = new Date("2026-09-09T12:05:00.000Z");
      await SecurityEventConnectionPoller.pollAllDueConnections();

      /*
       * Every fetch opens its own client session, so each poll signs one
       * assertion. The retired poller reused one client across both ticks
       * and signed once.
       */
      expect(assertions).toHaveLength(2);
      /*
       * Three alerts-view reads: each poll reads its own window from the
       * cursor, and the second poll, whose window read succeeded, then
       * sweeps the day before that window for alerts Google made readable
       * after their detection time. The first poll failed at its window
       * read, so it never reached its sweep.
       */
      expect(alertsRequests).toHaveLength(3);
      for (const request of alertsRequests.slice(0, 2)) {
        expect(request.searchParams.get("timeRange.startTime")).toBe(
          "2026-09-09T11:54:00.000Z",
        );
      }
      expect(alertsRequests[0]!.searchParams.get("timeRange.endTime")).toBe(
        NOW.toISOString(),
      );
      expect(alertsRequests[1]!.searchParams.get("timeRange.endTime")).toBe(
        currentTime.toISOString(),
      );
      // The sweep ends where the window starts and reads alerts only.
      expect(alertsRequests[2]!.searchParams.get("timeRange.startTime")).toBe(
        new Date(currentTime.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      );
      expect(alertsRequests[2]!.searchParams.get("timeRange.endTime")).toBe(
        "2026-09-09T11:54:00.000Z",
      );
      expect(
        alertsRequests[2]!.searchParams.get("includeNonAlertingDetections"),
      ).toBe("ALERTS_FEATURE_PREFERENCE_DISABLED");
      /*
       * Each poll's curated pass asked which curated rules to search first,
       * over the week before its own window.
       */
      expect(countIntervals).toEqual([
        {
          startTime: new Date(
            Date.parse("2026-09-09T11:54:00.000Z") - WEEK_MS,
          ).toISOString(),
          endTime: NOW.toISOString(),
        },
        {
          startTime: new Date(
            Date.parse("2026-09-09T11:54:00.000Z") - WEEK_MS,
          ).toISOString(),
          endTime: currentTime.toISOString(),
        },
      ]);
      const rows: Array<JSONObject> = persistence.insertedBatches.flat();
      expect(
        rows.map((row: JSONObject): unknown => {
          return row["eventUid"];
        }),
      ).toEqual(["open-alert", "closed-alert"]);
      expect(
        rows.every((row: JSONObject): boolean => {
          return (
            row["projectId"] === PROJECT_ID.toString() &&
            row["classUid"] === 2004 &&
            row["vendorName"] === "Google" &&
            row["productName"] === "Google SecOps"
          );
        }),
      ).toBe(true);
      expect(updates).toHaveLength(2);
      expect(updates[1]).toMatchObject({
        lastPolledAt: currentTime,
        lastSuccessfulPollAt: currentTime,
        lastEventIngestedAt: currentTime,
        lastPollResult: {
          status: "success",
          fetchedCount: 2,
          ingestedCount: 2,
          complete: true,
        },
        cursor: currentTime.toISOString(),
        lastError: null,
      });
      expect(connection.cursor).toBe(currentTime.toISOString());
      expect(connection.lastError).toBeNull();
    },
  );
});
