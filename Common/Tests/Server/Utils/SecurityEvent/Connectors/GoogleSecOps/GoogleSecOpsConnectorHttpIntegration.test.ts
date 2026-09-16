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
  FetchInitLike,
  FetchLike,
  FetchResponseLike,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import GoogleSecOpsConnector from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsConnector";
import {
  ConnectorFetchResult,
  ConnectorFetchWindow,
  ConnectorTestResult,
  readConnectorChecks,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import logger from "../../../../../../Server/Utils/Logger";
import OneUptimeDate from "../../../../../../Types/Date";
import { JSONObject } from "../../../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { getJestSpyOn } from "../../../../../Spy";
import {
  INSTANCE,
  PRIVATE_KEY,
  PUBLIC_KEY,
  SERVICE_ACCOUNT_EMAIL,
  TOKEN_URI,
  checkByKey,
  fetchOptions,
  rejectionOf,
  secOpsSettings,
  statusesOf,
} from "./GoogleSecOpsConnectorFixtures";

/*
 * Signing, HTTP serialization, streamed response parsing and the
 * connector's passes together, over real sockets. Only the destination
 * changes: the Google URLs are forwarded to a loopback contract simulator
 * that verifies the RS256 assertion against the key's public half, requires
 * the alerts view's documented query (snapshotQuery serialized explicitly,
 * no unknown parameters), and streams its answer in two chunks. No Google
 * credentials or external network are needed.
 */

const ALERTS_PATH: string = `/v1alpha/${INSTANCE}/legacy:legacyFetchAlertsView`;
const RULE_SEARCH_PATH: string = `/v1alpha/${INSTANCE}/legacy:legacySearchDetections`;
const CURATED_SEARCH_PATH: string = `/v1alpha/${INSTANCE}/legacy:legacySearchCuratedDetections`;
const SEARCH_PATHS: Array<string> = [RULE_SEARCH_PATH, CURATED_SEARCH_PATH];
const COUNT_PATH: string = `/v1alpha/${INSTANCE}:countAllCuratedRuleSetDetections`;
// The one curated rule the simulated tenant reports detections for.
const CURATED_RULE_ID: string = "ur_http_curated_rule";
const NOW: Date = new Date("2026-09-09T12:00:00.000Z");
const WINDOW: ConnectorFetchWindow = {
  startTime: new Date("2026-09-09T11:54:00.000Z"),
  endTime: NOW,
};
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
const NON_ALERTING_DETECTION: JSONObject = {
  id: "detection-only",
  detectionTime: "2026-09-08T01:30:00.000Z",
  createdTime: "2026-09-09T04:16:00.000Z",
  detection: [
    { ruleName: "Detection without alert", alertState: "NOT_ALERTING" },
  ],
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

function uidsOf(result: ConnectorFetchResult): Array<string> {
  return result.events.map((event: NormalizedSecurityEvent): string => {
    return event.eventUid;
  });
}

describe("GoogleSecOpsConnector over HTTP", () => {
  let server: Server;
  let port: number;
  let alertsRequests: Array<URL>;
  let curatedSearchRequests: Array<URL>;
  let countBodies: Array<JSONObject>;
  let assertions: Array<JSONObject>;
  let alertsErrorBody: string | null;

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
       * countAllCuratedRuleSetDetections: a POST whose JSON body carries the
       * interval, answered with one curated rule's count.
       */
      if (url.pathname === COUNT_PATH && request.method === "POST") {
        if (
          request.headers["authorization"] !== "Bearer local-verified-token"
        ) {
          response.writeHead(401);
          response.end("Bearer token required");
          return;
        }
        let parsed: JSONObject;
        try {
          parsed = JSON.parse(body) as JSONObject;
        } catch {
          rejectRequest(response, "Invalid JSON payload received.");
          return;
        }
        const interval: JSONObject = (parsed["interval"] || {}) as JSONObject;
        if (
          request.headers["content-type"] !== "application/json" ||
          url.search !== "" ||
          Object.keys(parsed).join(",") !== "interval" ||
          !(
            Date.parse(String(interval["startTime"])) <
            Date.parse(String(interval["endTime"]))
          )
        ) {
          rejectRequest(response, "Invalid interval");
          return;
        }
        countBodies.push(parsed);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            curatedRuleSetCounts: [
              {
                curatedRuleSet: `${INSTANCE}/curatedRuleSetCategories/c1/curatedRuleSets/s1`,
                count: 2,
              },
            ],
            curatedRuleCounts: [
              {
                curatedRule: `${INSTANCE}/curatedRules/${CURATED_RULE_ID}`,
                precision: "BROAD",
                count: 2,
              },
            ],
          }),
        );
        return;
      }

      if (SEARCH_PATHS.includes(url.pathname) && request.method === "GET") {
        if (
          request.headers["authorization"] !== "Bearer local-verified-token"
        ) {
          response.writeHead(401);
          response.end("Bearer token required");
          return;
        }
        if (url.pathname === CURATED_SEARCH_PATH) {
          curatedSearchRequests.push(url);
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
      const closedAlerts: Array<JSONObject> =
        url.searchParams.get("snapshotQuery") === "" ? [CLOSED_ALERT] : [];
      const allAlerts: Array<JSONObject> = [
        OPEN_ALERT,
        ...closedAlerts,
        ...(url.searchParams.get("includeNonAlertingDetections") ===
        "ALERTS_FEATURE_PREFERENCE_ENABLED"
          ? [NON_ALERTING_DETECTION]
          : []),
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
          destination.pathname === COUNT_PATH ||
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
    alertsRequests = [];
    curatedSearchRequests = [];
    countBodies = [];
    assertions = [];
    alertsErrorBody = null;
    getJestSpyOn(logger, "warn").mockImplementation((): void => {});
  });

  afterEach((): void => {
    jest.restoreAllMocks();
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

  test("a poll signs a verifiable assertion and imports open and closed alerts from the streamed view", async (): Promise<void> => {
    const result: ConnectorFetchResult = await new GoogleSecOpsConnector(
      forwardToServer,
    ).fetchEvents(secOpsSettings(), WINDOW, fetchOptions());

    expect(assertions).toHaveLength(1);
    expect(
      (assertions[0]!["exp"] as number) - (assertions[0]!["iat"] as number),
    ).toBe(3600);
    // The window's read, then the late-alert sweep of the day before it.
    expect(alertsRequests).toHaveLength(2);
    expect([...alertsRequests[0]!.searchParams.entries()].sort()).toEqual([
      ["alertListOptions.maxReturnedAlerts", "1000"],
      ["includeNonAlertingDetections", "ALERTS_FEATURE_PREFERENCE_DISABLED"],
      ["snapshotQuery", ""],
      ["timeRange.endTime", NOW.toISOString()],
      ["timeRange.startTime", "2026-09-09T11:54:00.000Z"],
    ]);
    expect([...alertsRequests[1]!.searchParams.entries()].sort()).toEqual([
      ["alertListOptions.maxReturnedAlerts", "1000"],
      ["includeNonAlertingDetections", "ALERTS_FEATURE_PREFERENCE_DISABLED"],
      ["snapshotQuery", ""],
      ["timeRange.endTime", "2026-09-09T11:54:00.000Z"],
      ["timeRange.startTime", "2026-09-08T12:00:00.000Z"],
    ]);
    // The curated rules are counted over HTTP, then searched by their id.
    expect(countBodies).toEqual([
      {
        interval: {
          startTime: "2026-09-02T11:54:00.000Z",
          endTime: NOW.toISOString(),
        },
      },
    ]);
    expect(
      curatedSearchRequests.map((url: URL): string | null => {
        return url.searchParams.get("ruleId");
      }),
    ).toEqual([CURATED_RULE_ID]);
    expect(uidsOf(result)).toEqual(["open-alert", "closed-alert"]);
    expect(result).toMatchObject({
      fetchedCount: 2,
      complete: true,
      // Rule search, curated count and search, window read and sweep.
      requestCount: 5,
    });
    for (const event of result.events) {
      expect(event.classUid).toBe(2004);
    }
  });

  test.each([true, false])(
    "alertingOnly %s is serialized as the alerts view's non-alerting preference over HTTP",
    async (alertingOnly: boolean): Promise<void> => {
      const result: ConnectorFetchResult = await new GoogleSecOpsConnector(
        forwardToServer,
      ).fetchEvents(secOpsSettings({ alertingOnly }), WINDOW, fetchOptions());

      expect(uidsOf(result).includes("detection-only")).toBe(!alertingOnly);
      expect(
        alertsRequests[0]!.searchParams.get("includeNonAlertingDetections"),
      ).toBe(
        alertingOnly
          ? "ALERTS_FEATURE_PREFERENCE_DISABLED"
          : "ALERTS_FEATURE_PREFERENCE_ENABLED",
      );
    },
  );

  test.each([
    ["pageSize", "Unknown name"],
    ["missing snapshotQuery", "Missing required field: snapshotQuery"],
    ["full Google diagnostic", "Google request diagnostic."],
  ])(
    "an alerts-view rejection (%s) throws the full diagnostic, and the same window reads cleanly once it is fixed",
    async (invalidRequest: string, expectedError: string): Promise<void> => {
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

      const error: unknown = await rejectionOf(
        connector.fetchEvents(secOpsSettings(), WINDOW, fetchOptions()),
      );
      const message: string = (error as Error).message;
      expect(message).toContain("HTTP 400");
      expect(message).toContain(expectedError);
      expect(
        message.startsWith("Google SecOps alerts fetch failed (HTTP 400): "),
      ).toBe(true);
      expect(statusesOf(readConnectorChecks(error))).toEqual([
        "read-rule-detections:pass",
        "read-curated-detections:pass",
        "read-alerts-view:fail",
      ]);

      if (invalidRequest === "full Google diagnostic") {
        /*
         * Both the old 500-character client slice and the 1,000-character
         * storage clamp would discard these troubleshooting details.
         */
        expect(FULL_GOOGLE_ERROR_BODY.indexOf(FULL_ERROR_TAIL)).toBeGreaterThan(
          1000,
        );
        expect(message).toContain(FULL_ERROR_TAIL);
        const failed: string = checkByKey(
          readConnectorChecks(error),
          "read-alerts-view",
        ).message;
        expect(failed.length).toBeGreaterThan(1000);
        expect(failed).toContain(FULL_ERROR_TAIL);
        expect(failed).toContain(INSTANCE);
        expect(failed).toContain('"code":400');
        expect(failed).toContain('"status":"INVALID_ARGUMENT"');
        expect(failed).toContain("type.googleapis.com/google.rpc.BadRequest");
        expect(failed).toContain('"field":"snapshotQuery"');
        expect(failed).toContain("Required query field was not supplied.");
        expect(failed).toContain('"access_token":"[REDACTED]"');
        expect(failed).toContain('"private_key":"[REDACTED]"');
        expect(failed).toContain('"client_secret":"[REDACTED]"');
        expect(failed).not.toContain("local-verified-token");
        expect(failed).not.toContain("nested-http-diagnostic-token-123");
        expect(failed).not.toContain("http-integration-private-key-material");
        expect(failed).not.toContain("http-integration-client-secret-material");
        expect(failed).not.toContain("(truncated)");
      }

      injectInvalidRequest = false;
      alertsErrorBody = null;
      const retry: ConnectorFetchResult = await connector.fetchEvents(
        secOpsSettings(),
        WINDOW,
        fetchOptions(),
      );

      // Each fetch opens its own session, so each one signs an assertion.
      expect(assertions).toHaveLength(2);
      /*
       * The rejected window read, the same window read again, and the
       * retry's late-alert sweep (a failed read never reaches the sweep).
       */
      expect(
        alertsRequests.map((request: URL): string => {
          return `${request.searchParams.get("timeRange.startTime")}/${request.searchParams.get("timeRange.endTime")}`;
        }),
      ).toEqual([
        `2026-09-09T11:54:00.000Z/${NOW.toISOString()}`,
        `2026-09-09T11:54:00.000Z/${NOW.toISOString()}`,
        "2026-09-08T12:00:00.000Z/2026-09-09T11:54:00.000Z",
      ]);
      expect(uidsOf(retry)).toEqual(["open-alert", "closed-alert"]);
      expect(retry.complete).toBe(true);
    },
  );

  test("Test connection authenticates once and proves read permission over HTTP", async (): Promise<void> => {
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

    const result: ConnectorTestResult = await new GoogleSecOpsConnector(
      forwardToServer,
    ).testConnection(secOpsSettings(), { requestTimeoutInMs: 20000 });

    expect(statusesOf(result.checks)).toEqual([
      "authentication:pass",
      "rule-detections-read:pass",
      "curated-detections-read:pass",
      "alerts-view-read:pass",
      "detections-available:pass",
    ]);
    expect(assertions).toHaveLength(1);
    expect(countBodies).toEqual([
      {
        interval: {
          startTime: "2026-09-02T12:00:00.000Z",
          endTime: NOW.toISOString(),
        },
      },
    ]);
    expect(
      curatedSearchRequests.map((url: URL): string => {
        return `${url.searchParams.get("ruleId")}:${url.searchParams.get("pageSize")}`;
      }),
    ).toEqual([`${CURATED_RULE_ID}:1`]);
    expect(alertsRequests).toHaveLength(5);
    for (const request of alertsRequests) {
      expect(
        request.searchParams.get("alertListOptions.maxReturnedAlerts"),
      ).toBe("1");
    }
    expect(result.counts).toMatchObject({
      scope: "alerts-only",
      alertsViewLast24h: 2,
      otherScope: expect.objectContaining({ alertsViewLast24h: 3 }),
    });
  });

  test("a key the token endpoint cannot verify fails authentication over HTTP", async (): Promise<void> => {
    const result: ConnectorTestResult = await new GoogleSecOpsConnector(
      forwardToServer,
    ).testConnection(
      secOpsSettings({
        secrets: {
          serviceAccountJson: JSON.stringify({
            client_email: "someone-else@example.iam.gserviceaccount.com",
            private_key: PRIVATE_KEY,
            token_uri: TOKEN_URI,
          }),
        },
      }),
      { requestTimeoutInMs: 20000 },
    );

    expect(statusesOf(result.checks)).toEqual([
      "authentication:fail",
      "detections-available:skip",
    ]);
    expect(checkByKey(result.checks, "authentication").message).toContain(
      "Google token exchange failed (HTTP 401)",
    );
    expect(alertsRequests).toHaveLength(0);
  });
});
