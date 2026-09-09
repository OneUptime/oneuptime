import { generateKeyPairSync } from "crypto";
import http, { IncomingMessage, Server, ServerResponse } from "http";
import { AddressInfo } from "net";
import jwt from "jsonwebtoken";
import GoogleSecOpsConnection from "../../../../Models/DatabaseModels/GoogleSecOpsConnection";
import GoogleSecOpsConnectionService from "../../../../Server/Services/GoogleSecOpsConnectionService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../../Server/Services/SecurityEventService";
import GoogleSecOpsClient, {
  FetchAlertsResult,
  FetchInitLike,
  FetchLike,
  FetchResponseLike,
} from "../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsClient";
import GoogleSecOpsPoller from "../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsPoller";
import ThreatIntelEnricher from "../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import logger from "../../../../Server/Utils/Logger";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { getJestSpyOn } from "../../../Spy";
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

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const TOKEN_URL: string = "https://oauth2.googleapis.com/token";
const SERVICE_ACCOUNT_EMAIL: string = "poller@example.iam.gserviceaccount.com";
const INSTANCE: string =
  "projects/test-project/locations/us/instances/test-instance";
const ALERTS_PATH: string = `/v1alpha/${INSTANCE}/legacy:legacyFetchAlertsView`;
const SERVICE_ACCOUNT_JSON: string = JSON.stringify({
  client_email: SERVICE_ACCOUNT_EMAIL,
  private_key: privateKey,
  token_uri: TOKEN_URL,
});
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
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
 * Exercise signing, HTTP serialization, streamed response parsing and the
 * poller's persistence decisions together. Only the transport destination
 * changes: known Google URLs go to a loopback contract simulator. It requires
 * the documented snapshotQuery field to be explicitly serialized; this does
 * not establish whether a live tenant rejects an omitted empty proto field.
 * No Google credentials or external network are needed.
 */
describe("Google SecOps alerts HTTP integration", () => {
  let server: Server;
  let port: number;
  let alertsRequests: Array<URL>;
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
            publicKey,
            {
              algorithms: ["RS256"],
              audience: TOKEN_URL,
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
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write(
        `[${JSON.stringify({ alerts: { alerts: [OPEN_ALERT] }, progress: 0.5 })},`,
      );
      response.end(
        `${JSON.stringify({
          alerts: { alerts: closedAlerts },
          complete: true,
          progress: 1,
          baselineAlertsCount: 2,
          filteredAlertsCount: 1 + closedAlerts.length,
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
      url !== TOKEN_URL &&
      !(
        destination.origin === "https://us-chronicle.googleapis.com" &&
        destination.pathname === ALERTS_PATH
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

  function makeClient(
    fetchImplementation: FetchLike = forwardToServer,
  ): GoogleSecOpsClient {
    return new GoogleSecOpsClient({
      region: "us",
      instanceResourceName: INSTANCE,
      serviceAccountJson: SERVICE_ACCOUNT_JSON,
      fetchImplementation,
    });
  }

  beforeAll(async (): Promise<void> => {
    server = http.createServer(handleRequest);
    await new Promise<void>((resolve: () => void): void => {
      server.listen(0, "127.0.0.1", resolve);
    });
    port = (server.address() as AddressInfo).port;
  });

  beforeEach((): void => {
    alertsRequests = [];
    assertions = [];
    alertsErrorBody = null;
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

  test.each([undefined, 23])(
    "authenticates and requests all alert statuses with maxAlerts=%s",
    async (maxAlerts: number | undefined): Promise<void> => {
      const result: FetchAlertsResult = await makeClient().fetchDetectionAlerts(
        {
          startTime: new Date("2026-09-09T11:54:00.000Z"),
          endTime: NOW,
          maxAlerts,
        },
      );

      expect(assertions).toHaveLength(1);
      expect(
        (assertions[0]!["exp"] as number) - (assertions[0]!["iat"] as number),
      ).toBe(3600);
      expect(alertsRequests).toHaveLength(1);
      expect([...alertsRequests[0]!.searchParams.entries()].sort()).toEqual([
        ["alertListOptions.maxReturnedAlerts", String(maxAlerts || 1000)],
        ["snapshotQuery", ""],
        ["timeRange.endTime", NOW.toISOString()],
        ["timeRange.startTime", "2026-09-09T11:54:00.000Z"],
      ]);
      expect(result).toEqual({
        alerts: [OPEN_ALERT, CLOSED_ALERT],
        complete: true,
        progress: 1,
        truncatedByCount: false,
        truncatedByBytes: false,
        baselineAlertsCount: 2,
        filteredAlertsCount: 2,
        chunkCount: 2,
      });
    },
  );

  test.each([
    ["pageSize", "Unknown name"],
    ["missing snapshotQuery", "Missing required field: snapshotQuery"],
    ["full Google diagnostic", "Google request diagnostic."],
  ])(
    "records %s rejection without advancing, then retries from the cursor and ingests",
    async (invalidRequest: string, expectedError: string): Promise<void> => {
      const connection: GoogleSecOpsConnection = new GoogleSecOpsConnection();
      connection._id = "22222222-2222-4222-8222-222222222222";
      connection.projectId = PROJECT_ID;
      connection.region = "us";
      connection.instanceResourceName = INSTANCE;
      connection.serviceAccountJson = SERVICE_ACCOUNT_JSON;
      connection.cursor = CURSOR;

      const updates: Array<JSONObject> = [];
      const rows: Array<JSONObject> = [];
      let currentTime: Date = NOW;
      getJestSpyOn(OneUptimeDate, "getCurrentDate").mockImplementation(
        (): Date => {
          return currentTime;
        },
      );
      getJestSpyOn(logger, "error").mockImplementation((): void => {
        return;
      });
      getJestSpyOn(GoogleSecOpsConnectionService, "findBy").mockResolvedValue([
        connection,
      ]);
      getJestSpyOn(
        GoogleSecOpsConnectionService,
        "updateOneById",
      ).mockImplementation(
        async (call: { data: JSONObject }): Promise<void> => {
          updates.push(call.data);
          Object.assign(connection, call.data);
        },
      );
      const metadata: TelemetryServiceMetadata = {
        serviceName: "Google SecOps",
        primaryEntityId: new ObjectID("33333333-3333-4333-8333-333333333333"),
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 15,
        serviceRetentionConfig: null,
        serviceRetentionInDays: null,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      };
      getJestSpyOn(
        OTelIngestService,
        "telemetryServiceFromName",
      ).mockResolvedValue(metadata);
      getJestSpyOn(
        ThreatIntelEnricher,
        "enrichNormalizedEvents",
      ).mockResolvedValue({ eventsMatched: 0, valuesLookedUp: 0 });
      getJestSpyOn(SecurityEventService, "insertJsonRows").mockImplementation(
        async (batch: Array<JSONObject>): Promise<void> => {
          rows.push(...batch);
        },
      );

      let injectInvalidRequest: boolean = true;
      if (invalidRequest === "full Google diagnostic") {
        alertsErrorBody = FULL_GOOGLE_ERROR_BODY;
      }
      const client: GoogleSecOpsClient = makeClient(
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
      const realPollConnection: typeof GoogleSecOpsPoller.pollConnection =
        GoogleSecOpsPoller.pollConnection.bind(GoogleSecOpsPoller);
      getJestSpyOn(GoogleSecOpsPoller, "pollConnection").mockImplementation(
        async (dueConnection: GoogleSecOpsConnection): Promise<number> => {
          return realPollConnection(dueConnection, client);
        },
      );

      await GoogleSecOpsPoller.pollAllDueConnections();

      expect(updates).toHaveLength(1);
      expect(updates[0]!["lastError"]).toContain("HTTP 400");
      expect(updates[0]!["lastError"]).toContain(expectedError);
      expect(updates[0]).not.toHaveProperty("cursor");
      expect(updates[0]!["lastPolledAt"]).toEqual(NOW);
      expect(connection.cursor).toBe(CURSOR);
      expect(rows).toEqual([]);
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
      await GoogleSecOpsPoller.pollAllDueConnections();

      expect(assertions).toHaveLength(1);
      expect(alertsRequests).toHaveLength(2);
      for (const request of alertsRequests) {
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
      expect(
        rows.map((row: JSONObject): unknown => {
          return row["eventUid"];
        }),
      ).toEqual(["open-alert", "closed-alert"]);
      expect(
        rows.every((row: JSONObject): boolean => {
          return (
            row["projectId"] === PROJECT_ID.toString() &&
            row["classUid"] === 2004
          );
        }),
      ).toBe(true);
      expect(updates).toHaveLength(2);
      expect(updates[1]).toEqual({
        lastPolledAt: currentTime,
        cursor: currentTime.toISOString(),
        lastError: null,
      });
      expect(connection.cursor).toBe(currentTime.toISOString());
      expect(connection.lastError).toBeNull();
    },
  );
});
