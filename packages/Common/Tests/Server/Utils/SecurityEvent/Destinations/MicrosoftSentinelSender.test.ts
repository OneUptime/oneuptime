import MicrosoftSentinelSender, {
  SENTINEL_LOGS_INGESTION_API_VERSION,
  isDcrImmutableId,
  isEntraTenant,
  isGuid,
  isSentinelStreamName,
} from "../../../../../Server/Utils/SecurityEvent/Destinations/MicrosoftSentinel/MicrosoftSentinelSender";
import SecurityEventDestinationRegistry from "../../../../../Server/Utils/SecurityEvent/Destinations/SecurityEventDestinationRegistry";
import {
  SecurityEventDestinationSettings,
  SecurityEventSendResult,
} from "../../../../../Server/Utils/SecurityEvent/Destinations/Types";
import { DataSourceHttpRequest } from "../../../../../Server/Utils/DataSource/HttpFetch";
import { JSONArray, JSONObject } from "../../../../../Types/JSON";
import SecurityEventDestinationProvider from "../../../../../Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";
import {
  FakeReply,
  FakeSiem,
  fakeSiem,
  noSleep,
  securityRecord,
  securityRecords,
} from "./FakeSiem";
import { describe, expect, test } from "@jest/globals";

/*
 * Microsoft Sentinel through the Azure Monitor Logs Ingestion API: a token
 * for the app registration from Microsoft Entra, then the records as a
 * JSON array to the data collection rule's stream, answered 204. A call is
 * all or nothing, so a refused batch is split until the record Azure will
 * not take is found.
 * https://learn.microsoft.com/en-us/azure/azure-monitor/logs/logs-ingestion-api-overview
 */

const TENANT: string = "11111111-2222-3333-4444-555555555555";
const CLIENT: string = "66666666-7777-8888-9999-000000000000";
const DCR: string = "dcr-0123456789abcdef0123456789abcdef";
const ENDPOINT: string =
  "https://oneuptime-dce-ab12.eastus-1.ingest.monitor.azure.com";

const SETTINGS: SecurityEventDestinationSettings = {
  provider: SecurityEventDestinationProvider.MicrosoftSentinel,
  config: {
    tenantId: TENANT,
    clientId: CLIENT,
    logsIngestionEndpoint: ENDPOINT,
    dcrImmutableId: DCR,
    cloud: "public",
  },
  secrets: { clientSecret: "s3cr3t~value" },
};

const TOKEN_REPLY: FakeReply = {
  status: 200,
  body: { access_token: "token-1", expires_in: 3599, token_type: "Bearer" },
};

function isTokenRequest(request: DataSourceHttpRequest): boolean {
  return request.url.includes("/oauth2/v2.0/token");
}

function ingestions(siem: FakeSiem): Array<DataSourceHttpRequest> {
  return siem.requests.filter((request: DataSourceHttpRequest): boolean => {
    return !isTokenRequest(request);
  });
}

function rows(request: DataSourceHttpRequest): JSONArray {
  return JSON.parse(String(request.body)) as JSONArray;
}

function sender(siem: FakeSiem): MicrosoftSentinelSender {
  return new MicrosoftSentinelSender({
    transport: siem.transport,
    sleep: noSleep,
  });
}

describe("a send", () => {
  test("gets a token for Azure Monitor, then posts the rows to the rule's stream", async () => {
    const siem: FakeSiem = fakeSiem((request: DataSourceHttpRequest) => {
      return isTokenRequest(request) ? TOKEN_REPLY : { status: 204 };
    });

    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events: securityRecords(3),
    });

    expect(result).toMatchObject({
      processed: 3,
      sent: 3,
      rejected: 0,
      requests: 2,
      failure: "",
    });

    const token: DataSourceHttpRequest = siem.requests[0]!;

    expect(token.url).toBe(
      `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
    );
    expect(token.formUrlEncoded).toBe(true);
    expect(token.body).toEqual({
      grant_type: "client_credentials",
      client_id: CLIENT,
      client_secret: "s3cr3t~value",
      scope: "https://monitor.azure.com//.default",
    });

    const ingestion: DataSourceHttpRequest = siem.requests[1]!;

    expect(ingestion.url).toBe(
      `${ENDPOINT}/dataCollectionRules/${DCR}/streams/Custom-OneUptimeSecurityEvents_CL?api-version=${SENTINEL_LOGS_INGESTION_API_VERSION}`,
    );
    expect(ingestion.headers!["Authorization"]).toBe("Bearer token-1");
    expect(ingestion.egressOptions?.targetLabel).toBe(
      "Azure Monitor logs ingestion",
    );
    expect(rows(ingestion)).toHaveLength(3);
    expect((rows(ingestion)[0] as JSONObject)["TimeGenerated"]).toBe(
      "2026-10-21T10:00:00.000Z",
    );
  });

  test("Azure Government signs in and sends in its own cloud", async () => {
    const siem: FakeSiem = fakeSiem((request: DataSourceHttpRequest) => {
      return isTokenRequest(request) ? TOKEN_REPLY : { status: 204 };
    });

    await sender(siem).send({
      settings: {
        ...SETTINGS,
        config: {
          ...SETTINGS.config,
          cloud: "usgov",
          logsIngestionEndpoint:
            "https://oneuptime-dce-ab12.usgovvirginia-1.ingest.monitor.azure.us",
          streamName: "Custom-SecurityEvents_CL",
        },
      },
      events: [securityRecord()],
    });

    expect(siem.requests[0]!.url).toContain(
      "https://login.microsoftonline.us/",
    );
    expect((siem.requests[0]!.body as JSONObject)["scope"]).toBe(
      "https://monitor.azure.us//.default",
    );
    expect(siem.requests[1]!.url).toContain(
      "/streams/Custom-SecurityEvents_CL?",
    );
  });

  test("a token that ran out is fetched again once", async () => {
    let tokens: number = 0;
    const siem: FakeSiem = fakeSiem((request: DataSourceHttpRequest) => {
      if (isTokenRequest(request)) {
        tokens++;
        return {
          status: 200,
          body: { access_token: `token-${tokens}`, expires_in: 3599 },
        };
      }

      return request.headers!["Authorization"] === "Bearer token-1"
        ? { status: 401, body: { error: { code: "InvalidToken" } } }
        : { status: 204 };
    });

    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events: securityRecords(2),
    });

    expect(tokens).toBe(2);
    expect(result).toMatchObject({ sent: 2, failure: "" });
  });

  test("a rule the app may not send to stops the send, naming the role", async () => {
    const siem: FakeSiem = fakeSiem((request: DataSourceHttpRequest) => {
      return isTokenRequest(request)
        ? TOKEN_REPLY
        : {
            status: 403,
            body: {
              error: {
                code: "OperationFailed",
                message:
                  "The authentication token provided does not have access to ingest data for the data collection rule",
              },
            },
          };
    });

    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events: securityRecords(2),
    });

    expect(result.processed).toBe(0);
    expect(result.failure).toContain("Monitoring Metrics Publisher role");
    expect(ingestions(siem)).toHaveLength(1);
  });

  test("a rule or stream that is not there stops the send", async () => {
    const siem: FakeSiem = fakeSiem((request: DataSourceHttpRequest) => {
      return isTokenRequest(request)
        ? TOKEN_REPLY
        : { status: 404, body: { error: { code: "NotFound" } } };
    });

    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events: securityRecords(1),
    });

    expect(result.failure).toContain(
      "Azure did not find the data collection rule or its stream",
    );
  });

  test("a batch Azure refuses is split until the record it will not take is left out", async () => {
    const siem: FakeSiem = fakeSiem((request: DataSourceHttpRequest) => {
      if (isTokenRequest(request)) {
        return TOKEN_REPLY;
      }

      return String(request.body).includes("POISON")
        ? { status: 400, body: { error: { code: "InvalidStream" } } }
        : { status: 204 };
    });

    const events: Array<ReturnType<typeof securityRecord>> = securityRecords(4);
    events[1] = securityRecord({ message: "POISON" });

    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events,
    });

    expect(result).toMatchObject({ processed: 4, sent: 3, rejected: 1 });
    expect(result.rejectionReason).toContain("HTTP 400");
  });

  test("throttling is tried again, then the send stops to go on next run", async () => {
    const siem: FakeSiem = fakeSiem((request: DataSourceHttpRequest) => {
      return isTokenRequest(request) ? TOKEN_REPLY : { status: 429 };
    });

    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events: securityRecords(2),
    });

    expect(ingestions(siem)).toHaveLength(3);
    expect(result.failure).toContain("throttling");
  });

  test("Entra refusing the client secret sends nothing and says what to check", async () => {
    const siem: FakeSiem = fakeSiem(() => {
      return {
        status: 401,
        body: {
          error: "invalid_client",
          error_description: "AADSTS7000215: Invalid client secret provided.",
        },
      };
    });

    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events: securityRecords(2),
    });

    expect(result.processed).toBe(0);
    expect(result.failure).toContain(
      "Microsoft Entra did not give the app registration a token (HTTP 401)",
    );
    expect(result.failure).toContain("AADSTS7000215");
    expect(ingestions(siem)).toHaveLength(0);
  });

  test("nothing to send asks for no token", async () => {
    const siem: FakeSiem = fakeSiem();

    const result: SecurityEventSendResult = await sender(siem).send({
      settings: SETTINGS,
      events: [],
    });

    expect(result.processed).toBe(0);
    expect(siem.requests).toHaveLength(0);
  });
});

describe("the settings", () => {
  test.each([
    [{ tenantId: "not a tenant" }, "Directory (tenant) ID must be"],
    [{ clientId: "abc" }, "Application (client) ID must be a GUID"],
    [
      { logsIngestionEndpoint: "https://evil.example.com" },
      "must be an https address ending in .ingest.monitor.azure.com",
    ],
    [
      { logsIngestionEndpoint: "http://x.eastus-1.ingest.monitor.azure.com" },
      "must be an https address",
    ],
    [{ dcrImmutableId: "my-rule" }, "immutable ID must look like dcr-"],
    [{ streamName: "OneUptime" }, "Stream must be the rule's custom stream"],
  ])("%j is refused", (change: JSONObject, message: string) => {
    expect(() => {
      sender(fakeSiem()).validateSettings({
        ...SETTINGS,
        config: { ...SETTINGS.config, ...change },
      });
    }).toThrow(message);
  });

  test("an endpoint of the other cloud is refused", () => {
    expect(() => {
      sender(fakeSiem()).validateSettings({
        ...SETTINGS,
        config: { ...SETTINGS.config, cloud: "usgov" },
      });
    }).toThrow(".ingest.monitor.azure.us");
  });

  test("ids as Azure writes them", () => {
    expect(isGuid(TENANT)).toBe(true);
    expect(isGuid("11111111222233334444555555555555")).toBe(false);
    expect(isEntraTenant("contoso.onmicrosoft.com")).toBe(true);
    expect(isEntraTenant("contoso")).toBe(false);
    expect(isEntraTenant("a/b.com")).toBe(false);
    expect(isDcrImmutableId(DCR)).toBe(true);
    expect(isDcrImmutableId("dcr-123")).toBe(false);
    expect(isSentinelStreamName("Custom-OneUptimeSecurityEvents_CL")).toBe(
      true,
    );
    expect(isSentinelStreamName("Microsoft-Syslog")).toBe(false);
  });
});

describe("Send a test event", () => {
  test("sends one row, and says what to fix when Azure refuses it", async () => {
    let answer: number = 204;
    const siem: FakeSiem = fakeSiem((request: DataSourceHttpRequest) => {
      return isTokenRequest(request) ? TOKEN_REPLY : { status: answer };
    });

    await sender(siem).sendTestEvent(SETTINGS);

    const row: JSONObject = rows(ingestions(siem)[0]!)[0] as JSONObject;

    expect(row["Message"]).toContain(
      "connection test: this destination can send security events to Microsoft Sentinel.",
    );

    answer = 403;

    await expect(sender(siem).sendTestEvent(SETTINGS)).rejects.toThrow(
      "Monitoring Metrics Publisher role",
    );
  });

  test("is the sender the registry hands out for Microsoft Sentinel", () => {
    expect(
      SecurityEventDestinationRegistry.getSender(
        SecurityEventDestinationProvider.MicrosoftSentinel,
      ),
    ).toBeInstanceOf(MicrosoftSentinelSender);
  });
});
