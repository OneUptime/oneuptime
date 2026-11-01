import { describe, expect, test } from "@jest/globals";
import MicrosoftEntraIdConnector, {
  ENTRA_DIRECTORY_AUDIT_PAGE_BUDGET,
  ENTRA_SIGN_IN_PAGE_BUDGET,
  MICROSOFT_365_RECORD_BUDGET,
  MICROSOFT_365_REQUEST_BUDGET,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/MicrosoftEntraId/MicrosoftEntraIdConnector";
import { ENTRA_PREMIUM_REQUIRED_CODE } from "../../../../../../Server/Utils/SecurityEvent/Connectors/MicrosoftEntraId/MicrosoftEntraIdClient";
import SecurityEventConnectorRegistry from "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry";
import {
  ConnectorFetchOptions,
  ConnectorFetchResult,
  ConnectorTestResult,
  SecurityConnectorSettings,
  readConnectorChecks,
  readConnectorFetchSummary,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import { DataSourceHttpRequest } from "../../../../../../Server/Utils/DataSource/HttpFetch";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  SecurityConnectorCheck,
  SecurityConnectorSample,
} from "../../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import SecurityEventConnectorProvider from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { MICROSOFT_365_AUDIT_KEY } from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import {
  FAKE_CLIENT_ID,
  FAKE_CLIENT_SECRET,
  FAKE_TENANT_ID,
  FakeContent,
  FakeEntraApi,
  FakeEntraTenant,
  apiError,
  createFakeEntraApi,
  requestsTo,
} from "./MicrosoftEntraIdFakeApi";
import {
  entraFailedSignIn,
  entraRoleAssignment,
  entraSignIn,
} from "../../../../../Utils/SecurityEvent/Connectors/EntraIdFixtures";
import {
  exchangeCmdlet,
  fileAccessed,
  sharing,
} from "../../../../../Utils/SecurityEvent/Connectors/Microsoft365Fixtures";

/*
 * The connector is what the poller and the tester call. These pin the
 * settings contract (a GUID tenant when the Microsoft 365 audit log is
 * read), the test report and its remediation per failure, and the fetch:
 * its passes in order, each with its own budget, the bounds that stop a
 * read without a resume point (Graph lists newest first), a tenant
 * without P1 or P2 still importing its directory changes, and the
 * Microsoft 365 pass - subscriptions started, content read a day at a
 * time within the last 7 days, only the records a security team acts on
 * imported, and its failures never stopping the Entra ID passes. A fake
 * tenant answers behind the transport; no network.
 */

const MINUTE_IN_MS: number = 60 * 1000;
const HOUR_IN_MS: number = 60 * MINUTE_IN_MS;
const DAY_IN_MS: number = 24 * HOUR_IN_MS;

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function settings(
  config: JSONObject = {},
  secrets: JSONObject = { clientSecret: FAKE_CLIENT_SECRET },
): SecurityConnectorSettings {
  return {
    provider: SecurityEventConnectorProvider.MicrosoftEntraId,
    config: {
      tenantId: FAKE_TENANT_ID,
      clientId: FAKE_CLIENT_ID,
      cloud: "public",
      ...config,
    },
    secrets,
    alertingOnly: false,
  };
}

function withMicrosoft365(config: JSONObject = {}): SecurityConnectorSettings {
  return settings({ [MICROSOFT_365_AUDIT_KEY]: true, ...config });
}

function fetchOptions(
  overrides: Partial<ConnectorFetchOptions> = {},
): ConnectorFetchOptions {
  const connector: MicrosoftEntraIdConnector = new MicrosoftEntraIdConnector();

  return {
    maxRequests: connector.fetchBudget.maxRequests!,
    maxEvents: connector.fetchBudget.maxEvents!,
    requestTimeoutInMs: 60000,
    sampleLimit: 25,
    ...overrides,
  };
}

function lastHour(): { startTime: Date; endTime: Date } {
  return {
    startTime: new Date(Date.now() - HOUR_IN_MS),
    endTime: new Date(),
  };
}

function signIns(count: number): Array<JSONObject> {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return entraSignIn({
      id: `sign-in-${index}`,
      createdDateTime: ago((index + 1) * 1000),
    });
  });
}

function connectorFor(tenant: FakeEntraTenant): {
  api: FakeEntraApi;
  connector: MicrosoftEntraIdConnector;
} {
  const api: FakeEntraApi = createFakeEntraApi(tenant);

  return { api, connector: new MicrosoftEntraIdConnector(api.transport) };
}

function check(
  checks: Array<SecurityConnectorCheck>,
  key: string,
): SecurityConnectorCheck {
  const found: SecurityConnectorCheck | undefined = checks.find(
    (candidate: SecurityConnectorCheck): boolean => {
      return candidate.key === key;
    },
  );

  expect(found).toBeDefined();

  return found!;
}

function content(
  contentId: string,
  contentType: string,
  createdAgoMs: number,
  records: Array<JSONObject>,
): FakeContent {
  return { contentId, contentType, contentCreated: ago(createdAgoMs), records };
}

async function caught(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected the call to throw.");
}

describe("MicrosoftEntraIdConnector - settings", () => {
  const connector: MicrosoftEntraIdConnector = new MicrosoftEntraIdConnector(
    createFakeEntraApi({}).transport,
  );

  test("a tenant GUID or verified domain, an app GUID, a cloud and a secret are what it takes", () => {
    expect(() => {
      connector.validateSettings(settings());
    }).not.toThrow();
    expect(() => {
      connector.validateSettings(
        settings({ tenantId: "contoso.onmicrosoft.com", cloud: "usgov" }),
      );
    }).not.toThrow();
  });

  test("reading the Microsoft 365 audit log needs the tenant's GUID", () => {
    expect(() => {
      connector.validateSettings(
        withMicrosoft365({ tenantId: "contoso.onmicrosoft.com" }),
      );
    }).toThrow(
      "Directory (tenant) ID must be the tenant GUID to read the Microsoft 365 audit log: the Office 365 Management API names a tenant only by its GUID.",
    );
    expect(() => {
      connector.validateSettings(withMicrosoft365());
    }).not.toThrow();
  });

  test("each bad setting is named by the title the form shows", () => {
    const cases: Array<[SecurityConnectorSettings, string]> = [
      [settings({ tenantId: "" }), "Directory (tenant) ID must be"],
      [
        settings({ tenantId: "contoso tenant" }),
        "Directory (tenant) ID must be",
      ],
      [settings({ clientId: "my-app" }), "Application (client) ID must be"],
      [settings({ cloud: "china" }), "Cloud must be one of: public, usgov."],
      [settings({}, {}), "Client secret is required."],
    ];

    for (const [candidate, message] of cases) {
      expect(() => {
        connector.validateSettings(candidate);
      }).toThrow(message);
    }
  });

  test("settings for another provider are refused", () => {
    expect(() => {
      connector.validateSettings({
        ...settings(),
        provider: SecurityEventConnectorProvider.OktaSystemLog,
      });
    }).toThrow(BadDataException);
  });

  test("the registry hands out this connector for Microsoft Entra ID", () => {
    expect(
      SecurityEventConnectorRegistry.getConnector(
        SecurityEventConnectorProvider.MicrosoftEntraId,
      ),
    ).toBeInstanceOf(MicrosoftEntraIdConnector);
  });
});

describe("MicrosoftEntraIdConnector - testConnection", () => {
  test("a working tenant passes every check, counts the last day and shows samples", async () => {
    const { connector } = connectorFor({
      signIns: [
        entraSignIn({ createdDateTime: ago(HOUR_IN_MS) }),
        entraFailedSignIn({
          id: "failed",
          createdDateTime: ago(2 * HOUR_IN_MS),
        }),
      ],
      directoryAudits: [
        entraRoleAssignment("Global Administrator", {
          activityDateTime: ago(3 * HOUR_IN_MS),
        }),
      ],
    });
    const result: ConnectorTestResult = await connector.testConnection(
      settings(),
      { requestTimeoutInMs: 15000 },
    );

    expect(
      result.checks.map((candidate: SecurityConnectorCheck) => {
        return [candidate.key, candidate.status];
      }),
    ).toEqual([
      ["authentication", "pass"],
      ["read-sign-ins", "pass"],
      ["read-directory-audits", "pass"],
      ["detections-available", "pass"],
    ]);
    expect(check(result.checks, "authentication").message).toBe(
      "Microsoft Entra issued an access token for Microsoft Graph in the Azure public cloud.",
    );
    expect(check(result.checks, "read-sign-ins").message).toContain(
      "alice@contoso.example signed in to Azure Portal from 203.0.113.7 in Seattle, US",
    );
    expect(check(result.checks, "detections-available").message).toBe(
      "2 sign-ins and 1 directory change in the last 24 hours.",
    );
    expect(result.samples).toHaveLength(2);
  });

  test("a tenant without P1 or P2 warns about sign-ins and still counts directory changes", async () => {
    const { connector } = connectorFor({
      signInsFailure: {
        statusCode: 403,
        body: apiError(
          ENTRA_PREMIUM_REQUIRED_CODE,
          "Neither tenant is B2C or tenant doesn't have premium license",
        ),
      },
      directoryAudits: [
        entraRoleAssignment("Global Administrator", {
          activityDateTime: ago(HOUR_IN_MS),
        }),
      ],
    });
    const result: ConnectorTestResult = await connector.testConnection(
      settings(),
      { requestTimeoutInMs: 15000 },
    );
    const signInCheck: SecurityConnectorCheck = check(
      result.checks,
      "read-sign-ins",
    );

    expect(signInCheck.status).toBe("warn");
    expect(signInCheck.message).toContain(
      "no Microsoft Entra ID P1 or P2 license",
    );
    expect(check(result.checks, "read-directory-audits").status).toBe("pass");
    expect(check(result.checks, "detections-available").message).toBe(
      "1 directory change in the last 24 hours.",
    );
    expect(
      result.checks.some((candidate: SecurityConnectorCheck): boolean => {
        return candidate.status === "fail";
      }),
    ).toBe(false);
  });

  test("a missing permission fails the read with what to grant, and skips the counts", async () => {
    const { connector } = connectorFor({
      signInsFailure: {
        statusCode: 403,
        body: apiError(
          "Authorization_RequestDenied",
          "Insufficient privileges to complete the operation.",
        ),
      },
      directoryAuditsFailure: {
        statusCode: 403,
        body: apiError(
          "Authorization_RequestDenied",
          "Insufficient privileges to complete the operation.",
        ),
      },
    });
    const result: ConnectorTestResult = await connector.testConnection(
      settings(),
      { requestTimeoutInMs: 15000 },
    );
    const signInCheck: SecurityConnectorCheck = check(
      result.checks,
      "read-sign-ins",
    );

    expect(signInCheck.status).toBe("fail");
    expect(signInCheck.remediation).toContain("AuditLog.Read.All");
    expect(signInCheck.remediation).toContain("Directory.Read.All");
    expect(check(result.checks, "read-directory-audits").remediation).toContain(
      "AuditLog.Read.All",
    );
    expect(check(result.checks, "detections-available").status).toBe("skip");
  });

  test("a refused secret fails authentication and skips the rest, the Microsoft 365 check included", async () => {
    const { connector } = connectorFor({
      tokenFailure: {
        statusCode: 401,
        body: { error: "invalid_client", error_codes: [7000215] },
      },
    });
    const result: ConnectorTestResult = await connector.testConnection(
      withMicrosoft365(),
      { requestTimeoutInMs: 15000 },
    );

    expect(
      result.checks.map((candidate: SecurityConnectorCheck) => {
        return [candidate.key, candidate.status];
      }),
    ).toEqual([
      ["authentication", "fail"],
      ["read-sign-ins", "skip"],
      ["read-directory-audits", "skip"],
      ["read-microsoft-365", "skip"],
      ["detections-available", "skip"],
    ]);
    expect(check(result.checks, "authentication").remediation).toContain(
      "Client secret has not expired",
    );
  });

  test("settings that cannot work fail before anything is contacted", async () => {
    const { api, connector } = connectorFor({});
    const result: ConnectorTestResult = await connector.testConnection(
      settings({ clientId: "not-a-guid" }),
      { requestTimeoutInMs: 15000 },
    );

    expect(check(result.checks, "authentication").status).toBe("fail");
    expect(check(result.checks, "authentication").remediation).toContain(
      "Nothing was contacted",
    );
    expect(api.requests).toHaveLength(0);
  });

  test("the Microsoft 365 check says what the first poll subscribes to", async () => {
    const { connector } = connectorFor({
      subscriptions: [{ contentType: "Audit.Exchange", status: "enabled" }],
    });
    const result: ConnectorTestResult = await connector.testConnection(
      withMicrosoft365(),
      { requestTimeoutInMs: 15000 },
    );
    const microsoft365: SecurityConnectorCheck = check(
      result.checks,
      "read-microsoft-365",
    );

    expect(microsoft365.status).toBe("pass");
    expect(microsoft365.message).toBe(
      "The Office 365 Management API answered. The first poll subscribes this app to Audit.SharePoint, Audit.General; Microsoft makes the first records of a new subscription available within 12 hours.",
    );
  });

  test("the Microsoft 365 check passes quietly once every content type is read", async () => {
    const { connector } = connectorFor({
      subscriptions: [
        { contentType: "Audit.Exchange", status: "enabled" },
        { contentType: "Audit.SharePoint", status: "enabled" },
        { contentType: "Audit.General", status: "enabled" },
      ],
    });
    const result: ConnectorTestResult = await connector.testConnection(
      withMicrosoft365(),
      { requestTimeoutInMs: 15000 },
    );

    expect(check(result.checks, "read-microsoft-365").message).toBe(
      "The Office 365 Management API answered, and this app reads Audit.Exchange, Audit.SharePoint, Audit.General.",
    );
  });

  test("a Microsoft 365 permission missing fails its check with what to grant", async () => {
    const { connector } = connectorFor({
      subscriptionsFailure: {
        statusCode: 401,
        body: apiError(
          "AF10001",
          "The permission set () sent in the request did not include the expected permission.",
        ),
      },
    });
    const result: ConnectorTestResult = await connector.testConnection(
      withMicrosoft365(),
      { requestTimeoutInMs: 15000 },
    );
    const microsoft365: SecurityConnectorCheck = check(
      result.checks,
      "read-microsoft-365",
    );

    expect(microsoft365.status).toBe("fail");
    expect(microsoft365.remediation).toContain("ActivityFeed.Read");
  });

  test("a queued test reads one record of each log and leaves the counting out", async () => {
    const { api, connector } = connectorFor({ signIns: signIns(3) });
    const result: ConnectorTestResult = await connector.testConnection(
      settings(),
      { requestTimeoutInMs: 15000, skipAvailability: true },
    );

    for (const request of [
      ...requestsTo(api, "/auditLogs/signIns"),
      ...requestsTo(api, "/auditLogs/directoryAudits"),
    ]) {
      expect(new URL(request.url).searchParams.get("$top")).toBe("1");
    }

    expect(check(result.checks, "detections-available").status).toBe("skip");
  });

  test("a full page of sign-ins is counted as that many or more", async () => {
    const { connector } = connectorFor({
      signIns: signIns(501),
      directoryAudits: [
        entraRoleAssignment("Global Administrator", {
          activityDateTime: ago(HOUR_IN_MS),
        }),
      ],
    });
    const result: ConnectorTestResult = await connector.testConnection(
      settings(),
      { requestTimeoutInMs: 15000 },
    );

    expect(check(result.checks, "detections-available").message).toBe(
      "500+ sign-ins and 1 directory change in the last 24 hours.",
    );
  });

  test("an empty day is a warning that names the likely cause", async () => {
    const { connector } = connectorFor({});
    const result: ConnectorTestResult = await connector.testConnection(
      settings(),
      { requestTimeoutInMs: 15000 },
    );
    const availability: SecurityConnectorCheck = check(
      result.checks,
      "detections-available",
    );

    expect(availability.status).toBe("warn");
    expect(availability.remediation).toContain("test tenant");
  });
});

describe("MicrosoftEntraIdConnector - fetchEvents, Microsoft Entra ID", () => {
  test("directory changes then sign-ins, each a check of its own, as Microsoft Entra ID events", async () => {
    const { api, connector } = connectorFor({
      signIns: signIns(3),
      directoryAudits: [
        entraRoleAssignment("Global Administrator", {
          activityDateTime: ago(10 * MINUTE_IN_MS),
        }),
      ],
    });
    const result: ConnectorFetchResult = await connector.fetchEvents(
      settings(),
      lastHour(),
      fetchOptions(),
    );

    expect(result.complete).toBe(true);
    expect(result.resumeAfter).toBeUndefined();
    expect(result.fetchedCount).toBe(4);
    expect(result.events).toHaveLength(4);
    expect(result.events[0]!.activityName).toBe("Add member to role");
    expect(
      result.events.every((event: NormalizedSecurityEvent): boolean => {
        return (
          event.vendorName === "Microsoft" &&
          event.productName === "Microsoft Entra ID"
        );
      }),
    ).toBe(true);
    expect(
      result.checks!.map((candidate: SecurityConnectorCheck) => {
        return [candidate.key, candidate.status];
      }),
    ).toEqual([
      ["read-directory-audits", "pass"],
      ["read-sign-ins", "pass"],
    ]);
    expect(result.details).toEqual({ directoryAudits: 1, signIns: 3 });
    expect(result.requestCount).toBe(api.requests.length);
    expect(result.samples[0]!.createdTime).toBeDefined();
    // Nothing went to the Management API without the option.
    expect(requestsTo(api, "subscriptions/list")).toHaveLength(0);
  });

  test("a page budget that stops sign-ins leaves the window incomplete with no resume point", async () => {
    const { connector } = connectorFor({
      signIns: signIns(30),
      graphPageCap: 5,
    });
    const result: ConnectorFetchResult = await connector.fetchEvents(
      settings(),
      lastHour(),
      fetchOptions({
        maxRequests:
          (ENTRA_DIRECTORY_AUDIT_PAGE_BUDGET + ENTRA_SIGN_IN_PAGE_BUDGET) / 10,
      }),
    );

    expect(result.complete).toBe(false);
    expect(result.resumeAfter).toBeUndefined();
    expect(result.events).toHaveLength(10);
    expect(result.warnings.join(" ")).toContain(
      "Stopped reading sign-ins after 10 records in 2 pages (the per-run request limit) before reading the whole window. Microsoft Graph lists them newest first",
    );
    expect(check(result.checks!, "read-sign-ins").status).toBe("warn");
  });

  test("a record budget stops a read too", async () => {
    const { connector } = connectorFor({ signIns: signIns(40) });
    const result: ConnectorFetchResult = await connector.fetchEvents(
      settings(),
      lastHour(),
      fetchOptions({ maxEvents: 30 }),
    );

    // 30 of 15,000 planned: sign-ins keep their share, 20.
    expect(result.complete).toBe(false);
    expect(result.events).toHaveLength(20);
    expect(result.warnings.join(" ")).toContain("the per-run record limit");
  });

  test("a tenant without P1 or P2 imports its directory changes and says why sign-ins are missing", async () => {
    const { connector } = connectorFor({
      signInsFailure: {
        statusCode: 403,
        body: apiError(ENTRA_PREMIUM_REQUIRED_CODE, "no premium license"),
      },
      directoryAudits: [
        entraRoleAssignment("Global Administrator", {
          activityDateTime: ago(10 * MINUTE_IN_MS),
        }),
      ],
    });
    const result: ConnectorFetchResult = await connector.fetchEvents(
      settings(),
      lastHour(),
      fetchOptions(),
    );

    expect(result.complete).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(check(result.checks!, "read-sign-ins").status).toBe("warn");
    expect(result.warnings[0]).toContain("Sign-ins were not read");
    expect(result.details!["signInsUnavailable"]).toBe(
      "premium-license-required",
    );
  });

  test("a Graph failure throws, naming the pass that failed and keeping what the passes before it read", async () => {
    const { api, connector } = connectorFor({
      directoryAudits: [
        entraRoleAssignment("Global Administrator", {
          activityDateTime: ago(10 * MINUTE_IN_MS),
        }),
      ],
      signInsFailure: {
        statusCode: 403,
        body: apiError(
          "Authorization_RequestDenied",
          "Insufficient privileges",
        ),
      },
    });
    const error: Error = await caught(
      connector.fetchEvents(settings(), lastHour(), fetchOptions()),
    );
    const checks: Array<SecurityConnectorCheck> = readConnectorChecks(error)!;

    expect(error.message).toContain("sign-ins request failed (HTTP 403)");
    expect(
      checks.map((candidate: SecurityConnectorCheck) => {
        return [candidate.key, candidate.status];
      }),
    ).toEqual([
      ["read-directory-audits", "pass"],
      ["read-sign-ins", "fail"],
    ]);
    expect(readConnectorFetchSummary(error)).toEqual({
      warnings: [],
      requestCount: api.requests.length,
      fetchedCount: 1,
      details: { directoryAudits: 1 },
    });
  });

  test("a record Graph returns twice while pages shift is imported once", async () => {
    const duplicate: JSONObject = entraSignIn({
      id: "same",
      createdDateTime: ago(MINUTE_IN_MS),
    });
    const { connector } = connectorFor({
      signIns: [duplicate, { ...duplicate }],
    });
    const result: ConnectorFetchResult = await connector.fetchEvents(
      settings(),
      lastHour(),
      fetchOptions(),
    );

    expect(result.events).toHaveLength(1);
    expect(result.fetchedCount).toBe(1);
  });

  test("a record that is not a sign-in is rejected, not imported", async () => {
    const { connector } = connectorFor({
      signIns: [{ id: "x", createdDateTime: ago(MINUTE_IN_MS) }],
    });
    const result: ConnectorFetchResult = await connector.fetchEvents(
      settings(),
      lastHour(),
      fetchOptions(),
    );

    expect(result.rejectedCount).toBe(1);
    expect(result.events).toHaveLength(0);
  });
});

describe("MicrosoftEntraIdConnector - fetchEvents, the Microsoft 365 audit log", () => {
  const forwarding: JSONObject = exchangeCmdlet("Set-Mailbox", {
    Identity: "bob",
    ForwardingSmtpAddress: "smtp:collector@fabrikam.example",
  });

  test("subscribes to what it does not read yet, then imports the records a security team acts on", async () => {
    const { api, connector } = connectorFor({
      subscriptions: [{ contentType: "Audit.Exchange", status: "enabled" }],
      contents: [
        content("exchange-1", "Audit.Exchange", 20 * MINUTE_IN_MS, [
          forwarding,
          { ...forwarding, Id: "second-cmdlet" },
        ]),
        content("sharepoint-1", "Audit.SharePoint", 10 * MINUTE_IN_MS, [
          sharing("SharingInvitationCreated", "Guest"),
          fileAccessed(),
          fileAccessed({ Id: "another-open" }),
        ]),
      ],
    });
    const result: ConnectorFetchResult = await connector.fetchEvents(
      withMicrosoft365(),
      lastHour(),
      fetchOptions(),
    );

    expect(
      requestsTo(api, "subscriptions/start").map(
        (request: DataSourceHttpRequest) => {
          return new URL(request.url).searchParams.get("contentType");
        },
      ),
    ).toEqual(["Audit.SharePoint", "Audit.General"]);
    expect(result.complete).toBe(true);
    expect(
      result.events.map((event: NormalizedSecurityEvent): string => {
        return event.activityName;
      }),
    ).toEqual(["Set-Mailbox", "Set-Mailbox", "Share"]);
    expect(result.fetchedCount).toBe(3);
    expect(result.details!["microsoft365"]).toEqual({
      contentBlobs: 2,
      recordsRead: 5,
      recordsImported: 3,
      requests: 8,
      subscriptionsStarted: "Audit.SharePoint, Audit.General",
    });

    const microsoft365: SecurityConnectorCheck = check(
      result.checks!,
      "read-microsoft-365",
    );

    expect(microsoft365.status).toBe("pass");
    expect(microsoft365.message).toBe(
      "3 of 5 audit records in 2 content blobs are activity a security team acts on. Subscribed to Audit.SharePoint, Audit.General on this run. Microsoft makes the first records of a new subscription available within 12 hours.",
    );
    // A sample says when Microsoft made the record available.
    expect(
      result.samples.find((sample: SecurityConnectorSample): boolean => {
        return sample.id === "m365:4c8e3e3a-2d4b-4b8e-9d5c-08dcf8a1b001";
      })?.createdTime,
    ).toBeDefined();
  });

  test("content is listed a day at a time, and never further back than the Management API keeps it", async () => {
    const { api, connector } = connectorFor({
      subscriptions: [
        { contentType: "Audit.Exchange", status: "enabled" },
        { contentType: "Audit.SharePoint", status: "enabled" },
        { contentType: "Audit.General", status: "enabled" },
      ],
    });
    const result: ConnectorFetchResult = await connector.fetchEvents(
      withMicrosoft365(),
      {
        startTime: new Date(Date.now() - 9 * DAY_IN_MS),
        endTime: new Date(Date.now() - 6 * DAY_IN_MS + 2 * HOUR_IN_MS),
      },
      fetchOptions(),
    );
    const exchangeListings: Array<URL> = requestsTo(
      api,
      "subscriptions/content",
    )
      .map((request: DataSourceHttpRequest): URL => {
        return new URL(request.url);
      })
      .filter((url: URL): boolean => {
        return url.searchParams.get("contentType") === "Audit.Exchange";
      });

    expect(exchangeListings.length).toBe(2);

    const oldest: number = Date.now() - 7 * DAY_IN_MS;

    for (const listing of exchangeListings) {
      const start: number = new Date(
        `${listing.searchParams.get("startTime")}Z`,
      ).getTime();
      const end: number = new Date(
        `${listing.searchParams.get("endTime")}Z`,
      ).getTime();

      expect(start).toBeGreaterThan(oldest);
      expect(end - start).toBeLessThanOrEqual(DAY_IN_MS);
    }

    expect(result.warnings.join(" ")).toContain(
      "The Microsoft 365 audit log keeps content for 7 days",
    );
  });

  test("a missing permission is a warning: the Entra ID passes are imported and the window moves on", async () => {
    const { connector } = connectorFor({
      signIns: signIns(2),
      subscriptionsFailure: {
        statusCode: 401,
        body: apiError(
          "AF10001",
          "The permission set () sent in the request did not include the expected permission.",
        ),
      },
    });
    const result: ConnectorFetchResult = await connector.fetchEvents(
      withMicrosoft365(),
      lastHour(),
      fetchOptions(),
    );
    const microsoft365: SecurityConnectorCheck = check(
      result.checks!,
      "read-microsoft-365",
    );

    expect(result.events).toHaveLength(2);
    expect(result.complete).toBe(true);
    expect(microsoft365.status).toBe("warn");
    expect(microsoft365.remediation).toContain("ActivityFeed.Read");
    expect(result.warnings.join(" ")).toContain(
      "The Microsoft 365 audit log was not read to the end of the window",
    );
  });

  test("a failure Microsoft may not repeat leaves the window to be read again", async () => {
    const { connector } = connectorFor({
      signIns: signIns(2),
      subscriptions: [{ contentType: "Audit.Exchange", status: "enabled" }],
      contents: [
        content("exchange-1", "Audit.Exchange", 20 * MINUTE_IN_MS, [
          forwarding,
        ]),
      ],
      blobFailure: {
        statusCode: 503,
        body: apiError(
          "AF50000",
          "An internal error occurred. Retry the request.",
        ),
      },
    });
    const result: ConnectorFetchResult = await connector.fetchEvents(
      withMicrosoft365(),
      lastHour(),
      fetchOptions(),
    );

    expect(result.events).toHaveLength(2);
    expect(result.complete).toBe(false);
    expect(result.warnings.join(" ")).toContain(
      "The window is read again on the next poll.",
    );
    expect(check(result.checks!, "read-microsoft-365").status).toBe("warn");
  });

  test("a content type that cannot be subscribed to is named, and the others are read", async () => {
    const { connector } = connectorFor({
      subscriptions: [{ contentType: "Audit.Exchange", status: "enabled" }],
      startFailures: {
        "Audit.General": {
          statusCode: 400,
          body: apiError(
            "AF20023",
            "The subscription was disabled by an administrator.",
          ),
        },
      },
      contents: [
        content("exchange-1", "Audit.Exchange", 20 * MINUTE_IN_MS, [
          forwarding,
        ]),
      ],
    });
    const result: ConnectorFetchResult = await connector.fetchEvents(
      withMicrosoft365(),
      lastHour(),
      fetchOptions(),
    );

    expect(result.events).toHaveLength(1);
    expect(result.complete).toBe(true);
    expect(result.warnings.join(" ")).toContain(
      "A Microsoft 365 content type could not be subscribed to and was not read. Audit.General:",
    );
    expect(check(result.checks!, "read-microsoft-365").status).toBe("warn");
  });

  test("its record budget stops the pass with the window incomplete", async () => {
    const records: Array<JSONObject> = Array.from(
      { length: 30 },
      (_: unknown, index: number): JSONObject => {
        return { ...forwarding, Id: `cmdlet-${index}` };
      },
    );
    const { connector } = connectorFor({
      subscriptions: [
        { contentType: "Audit.Exchange", status: "enabled" },
        { contentType: "Audit.SharePoint", status: "enabled" },
        { contentType: "Audit.General", status: "enabled" },
      ],
      contents: [
        content("exchange-1", "Audit.Exchange", 20 * MINUTE_IN_MS, records),
      ],
    });
    const planned: number =
      (ENTRA_DIRECTORY_AUDIT_PAGE_BUDGET + ENTRA_SIGN_IN_PAGE_BUDGET) * 500 +
      MICROSOFT_365_RECORD_BUDGET;
    const result: ConnectorFetchResult = await connector.fetchEvents(
      withMicrosoft365(),
      lastHour(),
      // A thousandth of the plan: 10 Microsoft 365 records.
      fetchOptions({ maxEvents: Math.floor(planned / 1000) }),
    );

    expect(result.events).toHaveLength(10);
    expect(result.complete).toBe(false);
    expect(result.warnings.join(" ")).toContain(
      "Stopped reading the Microsoft 365 audit log after 1 content blob (the per-run record limit)",
    );
  });

  test("its request budget is its own share of the fetch's, spent on listings and blobs", async () => {
    const contents: Array<FakeContent> = Array.from(
      { length: 40 },
      (_: unknown, index: number): FakeContent => {
        return content(
          `blob-${index}`,
          "Audit.Exchange",
          (index + 1) * MINUTE_IN_MS,
          [{ ...forwarding, Id: `cmdlet-${index}` }],
        );
      },
    );
    const { api, connector } = connectorFor({
      subscriptions: [
        { contentType: "Audit.Exchange", status: "enabled" },
        { contentType: "Audit.SharePoint", status: "enabled" },
        { contentType: "Audit.General", status: "enabled" },
      ],
      contents,
    });
    const options: ConnectorFetchOptions = fetchOptions({
      maxRequests: Math.floor(
        (ENTRA_DIRECTORY_AUDIT_PAGE_BUDGET +
          ENTRA_SIGN_IN_PAGE_BUDGET +
          MICROSOFT_365_REQUEST_BUDGET) /
          4,
      ),
    });
    const result: ConnectorFetchResult = await connector.fetchEvents(
      withMicrosoft365(),
      lastHour(),
      options,
    );
    const managementRequests: number = api.requests.filter(
      (request: DataSourceHttpRequest): boolean => {
        return new URL(request.url).host === "manage.office.com";
      },
    ).length;

    const share: number = MicrosoftEntraIdConnector.splitBudget(options, true)
      .microsoft365.maxRequests;

    expect(share).toBeLessThan(MICROSOFT_365_REQUEST_BUDGET);
    expect(managementRequests).toBe(share);
    expect(result.complete).toBe(false);
    expect(result.warnings.join(" ")).toContain("the per-run request limit");
  });
});
