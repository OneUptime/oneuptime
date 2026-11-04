import { describe, expect, test } from "@jest/globals";
import GoogleWorkspaceConnector, {
  GOOGLE_WORKSPACE_LATE_APPLICATIONS,
  GOOGLE_WORKSPACE_LATE_SWEEP_EVERY_HOURS,
  GOOGLE_WORKSPACE_LATE_SWEEP_LOOK_BACK_HOURS,
  GOOGLE_WORKSPACE_LATE_SWEEP_PAGES,
  GOOGLE_WORKSPACE_PAGE_BUDGETS,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleWorkspace/GoogleWorkspaceConnector";
import { GOOGLE_WORKSPACE_PAGE_SIZE } from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleWorkspace/GoogleWorkspaceClient";
import SecurityEventConnectorRegistry from "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry";
import {
  ConnectorFetchOptions,
  ConnectorFetchResult,
  ConnectorTestResult,
  SecurityConnectorSettings,
  readConnectorChecks,
  readConnectorFetchSummary,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { SecurityConnectorCheck } from "../../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import SecurityEventConnectorProvider from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { GOOGLE_WORKSPACE_DRIVE_KEY } from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import {
  GOOGLE_DRIVE_EVENTS,
  GoogleWorkspaceApplication,
} from "../../../../../../Utils/SecurityEvent/Connectors/GoogleWorkspaceNormalizer";
import {
  FAKE_ADMIN_EMAIL,
  FAKE_CLIENT_EMAIL,
  FAKE_SERVICE_ACCOUNT_JSON,
  FakeWorkspace,
  FakeWorkspaceApi,
  activityRequests,
  createFakeWorkspaceApi,
  googleError,
} from "./GoogleWorkspaceFakeApi";
import { googleWorkspaceActivity } from "../../../../../Utils/SecurityEvent/Connectors/GoogleWorkspaceFixtures";
import { FastestRun, fastestRun } from "../../../../../Helpers/FastestRun";

/*
 * The connector is what the poller and the tester call. These pin the
 * settings contract, the test report and its remediation for each way
 * domain-wide delegation and the Reports privilege go wrong, and the
 * fetch: the applications read in order, each listing with its own
 * budget, Drive read one event at a time, a sign-out read but not kept,
 * an activity two listings return imported once, Drive's own failure a
 * warning, and the bounds that stop a read without a resume point
 * (Google lists newest first). A fake Google Workspace answers behind the
 * transport and checks every signed assertion; no network.
 */

const MINUTE_IN_MS: number = 60 * 1000;
const HOUR_IN_MS: number = 60 * MINUTE_IN_MS;
const WINDOW: { startTime: Date; endTime: Date } = {
  startTime: new Date("2026-10-30T09:00:00.000Z"),
  endTime: new Date("2026-10-30T10:00:00.000Z"),
};

function settings(
  config: JSONObject = {},
  secrets: JSONObject = { serviceAccountJson: FAKE_SERVICE_ACCOUNT_JSON },
): SecurityConnectorSettings {
  return {
    provider: SecurityEventConnectorProvider.GoogleWorkspace,
    config: { adminEmail: FAKE_ADMIN_EMAIL, ...config },
    secrets,
    alertingOnly: false,
  };
}

function withDrive(): SecurityConnectorSettings {
  return settings({ [GOOGLE_WORKSPACE_DRIVE_KEY]: true });
}

function fetchOptions(
  overrides: Partial<ConnectorFetchOptions> = {},
): ConnectorFetchOptions {
  const connector: GoogleWorkspaceConnector = new GoogleWorkspaceConnector();

  return {
    maxRequests: connector.fetchBudget.maxRequests!,
    maxEvents: connector.fetchBudget.maxEvents!,
    requestTimeoutInMs: 60000,
    sampleLimit: 25,
    ...overrides,
  };
}

// An activity at a time, with an id of its own.
function activity(
  application: string,
  eventName: string,
  time: string,
  uniqueQualifier: string,
  parameters: Array<JSONObject> = [],
): JSONObject {
  return googleWorkspaceActivity(application, eventName, parameters, {
    id: {
      time,
      uniqueQualifier,
      applicationName: application,
      customerId: "C03az79cb",
    },
  });
}

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function connectorFor(workspace: FakeWorkspace): {
  api: FakeWorkspaceApi;
  connector: GoogleWorkspaceConnector;
} {
  const api: FakeWorkspaceApi = createFakeWorkspaceApi(workspace);

  return { api, connector: new GoogleWorkspaceConnector(api.transport) };
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

function statuses(
  checks: Array<SecurityConnectorCheck>,
): Array<[string, string]> {
  return checks.map((candidate: SecurityConnectorCheck): [string, string] => {
    return [candidate.key, candidate.status];
  });
}

async function caught(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected the call to throw.");
}

const FORBIDDEN: { statusCode: number; body: JSONObject } = {
  statusCode: 403,
  body: googleError(
    403,
    "PERMISSION_DENIED",
    "Not Authorized to access this resource/api",
    "forbidden",
  ),
};

describe("GoogleWorkspaceConnector - settings", () => {
  const connector: GoogleWorkspaceConnector = new GoogleWorkspaceConnector(
    createFakeWorkspaceApi({}).transport,
  );

  test("an administrator's address and a service account key are what it takes", () => {
    expect(() => {
      connector.validateSettings(settings());
    }).not.toThrow();
    expect(() => {
      connector.validateSettings(withDrive());
    }).not.toThrow();
  });

  test("an address that is not one is named by the field's title", () => {
    for (const adminEmail of [
      "",
      "admin",
      "admin@",
      "@example.com",
      "admin@example",
      "admin@example.",
      "ad min@example.com",
      "admin@@example.com",
      `${"a".repeat(250)}@example.com`,
    ]) {
      expect(() => {
        connector.validateSettings(settings({ adminEmail }));
      }).toThrow(
        "Administrator email must be the email address of a Google Workspace administrator, such as admin@example.com.",
      );
    }
  });

  test("a missing or unusable key is refused", () => {
    expect(() => {
      connector.validateSettings(settings({}, {}));
    }).toThrow("Service account JSON is required.");
    expect(() => {
      connector.validateSettings(
        settings({}, { serviceAccountJson: '{"client_email": "x"}' }),
      );
    }).toThrow(BadDataException);
    expect(() => {
      connector.validateSettings(
        settings({}, { serviceAccountJson: "not json" }),
      );
    }).toThrow("Service account JSON is not valid JSON.");
  });

  test("settings for another provider are refused", () => {
    expect(() => {
      connector.validateSettings({
        ...settings(),
        provider: SecurityEventConnectorProvider.OktaSystemLog,
      });
    }).toThrow(BadDataException);
  });

  test("checking an address takes time that grows with it, not faster", () => {
    const address: string = `${"a@".repeat(200000)}x`;
    const checked: FastestRun<boolean> = fastestRun({
      run: (): boolean => {
        return GoogleWorkspaceConnector.isEmailAddress(address);
      },
      limitInMs: 2000,
    });

    expect(checked.result).toBe(false);
    expect(checked.inMs).toBeLessThan(2000);
  });

  test("the registry hands out this connector for Google Workspace", () => {
    expect(
      SecurityEventConnectorRegistry.getConnector(
        SecurityEventConnectorProvider.GoogleWorkspace,
      ),
    ).toBeInstanceOf(GoogleWorkspaceConnector);
  });
});

describe("GoogleWorkspaceConnector - testConnection", () => {
  test("a working Google Workspace passes every check, counts the last day and shows samples", async () => {
    const { connector } = connectorFor({
      activities: {
        login: [
          activity("login", "login_success", ago(HOUR_IN_MS), "1"),
          activity("login", "login_failure", ago(2 * HOUR_IN_MS), "2"),
        ],
        admin: [
          activity("admin", "ASSIGN_ROLE", ago(3 * HOUR_IN_MS), "3", [
            { name: "ROLE_NAME", value: "_SEED_ADMIN_ROLE" },
            { name: "USER_EMAIL", value: "bob@example.com" },
          ]),
        ],
      },
    });
    const result: ConnectorTestResult = await connector.testConnection(
      settings(),
      { requestTimeoutInMs: 15000 },
    );

    expect(statuses(result.checks)).toEqual([
      ["authentication", "pass"],
      ["read-audit-logs", "pass"],
      ["detections-available", "pass"],
    ]);
    expect(check(result.checks, "authentication").message).toBe(
      `Google let the service account ${FAKE_CLIENT_EMAIL} act as ${FAKE_ADMIN_EMAIL} to read the audit logs.`,
    );
    expect(check(result.checks, "read-audit-logs").message).toBe(
      "Google returned the sign-in and admin logs. The latest in the last 24 hours: alice@example.com signed in to Google from 203.0.113.7; alice@example.com: Assign role (_SEED_ADMIN_ROLE → bob@example.com).",
    );
    expect(check(result.checks, "detections-available").message).toBe(
      "2 sign-in activities and 1 admin change in the last 24 hours.",
    );
    expect(result.samples).toHaveLength(2);
  });

  test("no domain-wide delegation fails authentication with where to set it, and skips the rest", async () => {
    const { connector } = connectorFor({
      tokenFailure: {
        statusCode: 401,
        body: {
          error: "unauthorized_client",
          error_description:
            "Client is unauthorized to retrieve access tokens using this method, or client not authorized for any of the scopes requested.",
        },
      },
    });
    const result: ConnectorTestResult = await connector.testConnection(
      withDrive(),
      { requestTimeoutInMs: 15000 },
    );

    expect(statuses(result.checks)).toEqual([
      ["authentication", "fail"],
      ["read-audit-logs", "skip"],
      ["read-drive", "skip"],
      ["detections-available", "skip"],
    ]);
    expect(check(result.checks, "authentication").remediation).toContain(
      "Manage domain-wide delegation",
    );
    expect(check(result.checks, "authentication").remediation).toContain(
      "https://www.googleapis.com/auth/admin.reports.audit.readonly",
    );
  });

  test("an administrator Google does not know is named, with what to set instead", async () => {
    const { connector } = connectorFor({
      admins: ["someone-else@example.com"],
    });
    const result: ConnectorTestResult = await connector.testConnection(
      settings(),
      { requestTimeoutInMs: 15000 },
    );
    const authentication: SecurityConnectorCheck = check(
      result.checks,
      "authentication",
    );

    expect(authentication.status).toBe("fail");
    expect(authentication.message).toContain(
      "Google does not know the Administrator email",
    );
    expect(authentication.remediation).toContain("Set Administrator email");
  });

  test("an administrator without the Reports privilege fails the read, and the counting is skipped", async () => {
    const { connector } = connectorFor({ failures: { login: FORBIDDEN } });
    const result: ConnectorTestResult = await connector.testConnection(
      settings(),
      { requestTimeoutInMs: 15000 },
    );
    const read: SecurityConnectorCheck = check(
      result.checks,
      "read-audit-logs",
    );

    expect(read.status).toBe("fail");
    expect(read.remediation).toContain("Reports privilege");
    expect(check(result.checks, "detections-available").status).toBe("skip");
  });

  test("the Admin SDK API turned off is named, with where to turn it on", async () => {
    const { connector } = connectorFor({
      failures: {
        login: {
          statusCode: 403,
          body: {
            error: {
              code: 403,
              message:
                "Admin SDK API has not been used in project 1234 before or it is disabled.",
              status: "PERMISSION_DENIED",
              details: [
                {
                  "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                  reason: "SERVICE_DISABLED",
                },
              ],
            },
          },
        },
      },
    });
    const result: ConnectorTestResult = await connector.testConnection(
      settings(),
      { requestTimeoutInMs: 15000 },
    );

    expect(check(result.checks, "read-audit-logs").remediation).toContain(
      "Turn on the Admin SDK API",
    );
  });

  test("Drive's log is checked when the connection reads it, and its failure names the editions that have it", async () => {
    const passing: ConnectorTestResult = await connectorFor(
      {},
    ).connector.testConnection(withDrive(), { requestTimeoutInMs: 15000 });

    expect(statuses(passing.checks)).toEqual([
      ["authentication", "pass"],
      ["read-audit-logs", "pass"],
      ["read-drive", "pass"],
      ["detections-available", "warn"],
    ]);

    const failing: ConnectorTestResult = await connectorFor({
      failures: { drive: FORBIDDEN },
    }).connector.testConnection(withDrive(), { requestTimeoutInMs: 15000 });
    const drive: SecurityConnectorCheck = check(failing.checks, "read-drive");

    expect(drive.status).toBe("fail");
    expect(drive.remediation).toContain("Business Standard");
    expect(check(failing.checks, "read-audit-logs").status).toBe("pass");
  });

  test("a queued test reads one activity of each log and leaves the counting out", async () => {
    const { api, connector } = connectorFor({});
    const result: ConnectorTestResult = await connector.testConnection(
      settings(),
      { requestTimeoutInMs: 15000, skipAvailability: true },
    );

    for (const url of activityRequests(api)) {
      expect(url.searchParams.get("maxResults")).toBe("1");
    }

    expect(check(result.checks, "detections-available").status).toBe("skip");
  });

  test("an empty day is a warning that names the likely cause", async () => {
    const result: ConnectorTestResult = await connectorFor(
      {},
    ).connector.testConnection(settings(), { requestTimeoutInMs: 15000 });
    const availability: SecurityConnectorCheck = check(
      result.checks,
      "detections-available",
    );

    expect(availability.status).toBe("warn");
    expect(availability.remediation).toContain("Administrator email");
  });

  test("settings that cannot work fail before anything is contacted", async () => {
    const { api, connector } = connectorFor({});
    const result: ConnectorTestResult = await connector.testConnection(
      settings({ adminEmail: "admin" }),
      { requestTimeoutInMs: 15000 },
    );

    expect(check(result.checks, "authentication").status).toBe("fail");
    expect(api.requests).toHaveLength(0);
  });
});

describe("GoogleWorkspaceConnector - fetchEvents", () => {
  test("reads admin activity first, then sign-ins, OAuth grants, single sign-on and account security, as Google Workspace events", async () => {
    const { api, connector } = connectorFor({
      activities: {
        admin: [
          activity("admin", "ASSIGN_ROLE", "2026-10-30T09:50:00.000Z", "a1"),
        ],
        login: [
          activity("login", "login_failure", "2026-10-30T09:40:00.000Z", "l1"),
          activity("login", "logout", "2026-10-30T09:41:00.000Z", "l2"),
        ],
        token: [
          activity("token", "authorize", "2026-10-30T09:30:00.000Z", "t1", [
            { name: "app_name", value: "Files Exporter" },
          ]),
        ],
        saml: [
          activity("saml", "login_success", "2026-10-30T09:20:00.000Z", "s1"),
        ],
        user_accounts: [
          activity(
            "user_accounts",
            "2sv_disable",
            "2026-10-30T09:10:00.000Z",
            "u1",
          ),
        ],
      },
    });
    const result: ConnectorFetchResult = await connector.fetchEvents(
      settings(),
      WINDOW,
      fetchOptions(),
    );

    expect(
      activityRequests(api).map((url: URL): string => {
        return url.pathname.split("/").pop()!;
      }),
    ).toEqual(["admin", "login", "token", "saml", "user_accounts"]);
    expect(result.complete).toBe(true);
    expect(result.resumeAfter).toBeUndefined();
    expect(
      result.events.map((event: NormalizedSecurityEvent): string => {
        return event.className;
      }),
    ).toEqual([
      "User Access Management",
      "Authentication",
      "Authorize Session",
      "Authentication",
      "Account Change",
    ]);
    expect(
      result.events.every((event: NormalizedSecurityEvent): boolean => {
        return (
          event.vendorName === "Google" &&
          event.productName === "Google Workspace"
        );
      }),
    ).toBe(true);
    // The sign-out was read, not kept.
    expect(result.fetchedCount).toBe(5);
    expect(result.details).toEqual({
      basis: "activity-time",
      activitiesRead: {
        admin: 1,
        login: 2,
        token: 1,
        saml: 1,
        user_accounts: 1,
      },
    });
    expect(statuses(result.checks!)).toEqual([["read-audit-logs", "pass"]]);
    expect(check(result.checks!, "read-audit-logs").message).toBe(
      "Activities read in the window: admin 1, sign-ins 2, OAuth tokens 1, SAML 1, account security 1.",
    );
    expect(result.requestCount).toBe(api.requests.length);
  });

  test("Drive is read one kept event at a time, and an activity two listings return is imported once", async () => {
    const shared: JSONObject = googleWorkspaceActivity(
      "drive",
      "change_user_access",
      [
        { name: "doc_title", value: "Budget" },
        { name: "owner", value: "alice@example.com" },
        { name: "target_user", value: "bob@fabrikam.example" },
      ],
      {
        id: {
          time: "2026-10-30T09:30:00.000Z",
          uniqueQualifier: "d1",
          applicationName: "drive",
          customerId: "C03az79cb",
        },
      },
    );
    // The same activity holds a second kept event.
    (shared["events"] as Array<JSONObject>).push({
      type: "acl_change",
      name: "change_document_visibility",
      parameters: [{ name: "visibility", value: "people_with_link" }],
    });
    const { api, connector } = connectorFor({
      activities: { drive: [shared] },
    });
    const result: ConnectorFetchResult = await connector.fetchEvents(
      withDrive(),
      WINDOW,
      fetchOptions(),
    );
    const driveListings: Array<URL> = activityRequests(api).filter(
      (url: URL): boolean => {
        return url.pathname.endsWith("/drive");
      },
    );

    expect(
      driveListings.map((url: URL): string | null => {
        return url.searchParams.get("eventName");
      }),
    ).toEqual([...GOOGLE_DRIVE_EVENTS]);
    expect(result.events).toHaveLength(2);
    expect(statuses(result.checks!)).toEqual([
      ["read-audit-logs", "pass"],
      ["read-drive", "pass"],
    ]);
    expect(check(result.checks!, "read-drive").message).toBe(
      "2 Drive events about sharing and downloads in the window.",
    );
  });

  test("Drive's log refused is a warning: the other logs are imported and the window moves on", async () => {
    const { connector } = connectorFor({
      activities: {
        login: [
          activity("login", "login_failure", "2026-10-30T09:40:00.000Z", "l1"),
        ],
      },
      failures: { drive: FORBIDDEN },
    });
    const result: ConnectorFetchResult = await connector.fetchEvents(
      withDrive(),
      WINDOW,
      fetchOptions(),
    );

    expect(result.events).toHaveLength(1);
    expect(result.complete).toBe(true);
    expect(check(result.checks!, "read-drive").status).toBe("warn");
    expect(result.warnings.join(" ")).toContain("Drive activity was not read");
  });

  test("Drive failing on Google's side throws, naming Drive's read", async () => {
    const { connector } = connectorFor({
      failures: {
        drive: {
          statusCode: 503,
          body: googleError(
            503,
            "UNAVAILABLE",
            "The service is currently unavailable.",
            "backendError",
          ),
        },
      },
    });
    const error: Error = await caught(
      connector.fetchEvents(withDrive(), WINDOW, fetchOptions()),
    );

    expect(statuses(readConnectorChecks(error)!)).toEqual([
      ["read-audit-logs", "pass"],
      ["read-drive", "fail"],
    ]);
  });

  test("a log refused throws, keeping what the listings before it read", async () => {
    const { api, connector } = connectorFor({
      activities: {
        admin: [
          activity("admin", "ASSIGN_ROLE", "2026-10-30T09:50:00.000Z", "a1"),
        ],
      },
      failures: { login: FORBIDDEN },
    });
    const error: Error = await caught(
      connector.fetchEvents(settings(), WINDOW, fetchOptions()),
    );
    const checks: Array<SecurityConnectorCheck> = readConnectorChecks(error)!;

    expect(error.message).toContain(
      "login activities request failed (HTTP 403)",
    );
    expect(statuses(checks)).toEqual([["read-audit-logs", "fail"]]);
    expect(checks[0]!.remediation).toContain("Reports privilege");
    expect(readConnectorFetchSummary(error)).toEqual({
      warnings: [],
      requestCount: api.requests.length,
      fetchedCount: 1,
      details: { activitiesRead: { admin: 1 } },
    });
  });

  test("a page budget that stops sign-ins leaves the window incomplete with no resume point", async () => {
    const logins: Array<JSONObject> = Array.from(
      { length: 12 },
      (_: unknown, index: number): JSONObject => {
        return activity(
          "login",
          "login_failure",
          new Date(
            WINDOW.startTime.getTime() + index * MINUTE_IN_MS,
          ).toISOString(),
          `l${index}`,
        );
      },
    );
    const { connector } = connectorFor({
      activities: { login: logins },
      pageCap: 2,
    });
    const planned: number = GoogleWorkspaceConnector.plannedPages(false);
    const result: ConnectorFetchResult = await connector.fetchEvents(
      settings(),
      WINDOW,
      // A fifth of the plan: sign-ins get 2 pages.
      fetchOptions({ maxRequests: planned / 5 + 0.5 }),
    );

    expect(
      GOOGLE_WORKSPACE_PAGE_BUDGETS[GoogleWorkspaceApplication.Login],
    ).toBe(10);
    expect(result.complete).toBe(false);
    expect(result.resumeAfter).toBeUndefined();
    expect(result.events).toHaveLength(4);
    expect(result.warnings.join(" ")).toContain(
      "Stopped reading sign-in activity after 4 activities (the per-run request limit) before reading the whole window. Google lists activities newest first",
    );
    expect(check(result.checks!, "read-audit-logs").status).toBe("warn");
  });

  test("an activity that is not one is rejected", async () => {
    const { connector } = connectorFor({
      activities: {
        admin: [
          {
            id: {
              time: "2026-10-30T09:50:00.000Z",
              uniqueQualifier: "x",
              applicationName: "",
            },
          },
        ],
      },
    });
    const result: ConnectorFetchResult = await connector.fetchEvents(
      settings(),
      WINDOW,
      fetchOptions(),
    );

    expect(result.rejectedCount).toBe(1);
    expect(result.events).toHaveLength(0);
  });
});

/*
 * Google documents every log the connection reads as readable within
 * minutes, but OAuth token activity, which can take a few hours - past the
 * two-hour overlap each poll reads again. So once every six hours of UTC
 * time a poll also sweeps the day before its window for token activity,
 * with a budget of its own; the id dedupe drops what was imported before.
 * A sweep adds to a poll: a bound or a failure is a warning, never a
 * window left unread.
 */
describe("GoogleWorkspaceConnector - the late sweep", () => {
  const OVERLAP_IN_MS: number = 120 * MINUTE_IN_MS;

  // A poll's window as the poller makes it: from the last end, less the overlap.
  function pollWindow(
    previousEnd: string,
    end: string,
  ): { startTime: Date; endTime: Date } {
    return {
      startTime: new Date(new Date(previousEnd).getTime() - OVERLAP_IN_MS),
      endTime: new Date(end),
    };
  }

  test("only the poll whose new ground takes in a six-hour boundary sweeps, the day before that ground", () => {
    expect(GOOGLE_WORKSPACE_LATE_APPLICATIONS).toEqual([
      GoogleWorkspaceApplication.Token,
    ]);
    expect(GOOGLE_WORKSPACE_LATE_SWEEP_EVERY_HOURS).toBe(6);
    expect(GOOGLE_WORKSPACE_LATE_SWEEP_LOOK_BACK_HOURS).toBe(24);

    // 11:58 to 12:03 takes in 12:00.
    const sweeping: { startTime: Date; endTime: Date } = pollWindow(
      "2026-10-30T11:58:00.000Z",
      "2026-10-30T12:03:00.000Z",
    );

    expect(
      GoogleWorkspaceConnector.getLateSweepWindow({ window: sweeping }),
    ).toEqual({
      startTime: new Date("2026-10-29T11:58:00.000Z"),
      endTime: sweeping.startTime,
    });

    // The next poll, 12:03 to 12:08, adds no boundary.
    expect(
      GoogleWorkspaceConnector.getLateSweepWindow({
        window: pollWindow(
          "2026-10-30T12:03:00.000Z",
          "2026-10-30T12:08:00.000Z",
        ),
      }),
    ).toBeNull();

    // A poll that ends right on the boundary leaves it to the next one.
    expect(
      GoogleWorkspaceConnector.getLateSweepWindow({
        window: pollWindow(
          "2026-10-30T11:55:00.000Z",
          "2026-10-30T12:00:00.000Z",
        ),
      }),
    ).toBeNull();
    expect(
      GoogleWorkspaceConnector.getLateSweepWindow({
        window: pollWindow(
          "2026-10-30T12:00:00.000Z",
          "2026-10-30T12:05:00.000Z",
        ),
      }),
    ).not.toBeNull();
  });

  test("polls every five minutes for a day sweep four times, once a boundary, whatever the interval", () => {
    for (const intervalInMinutes of [1, 5, 15, 60]) {
      const sweeps: Array<string> = [];
      let previousEnd: number = new Date("2026-10-30T00:01:00.000Z").getTime();

      for (
        let end: number = previousEnd + intervalInMinutes * MINUTE_IN_MS;
        end <= new Date("2026-10-31T00:01:00.000Z").getTime();
        end += intervalInMinutes * MINUTE_IN_MS
      ) {
        const sweep: { startTime: Date; endTime: Date } | null =
          GoogleWorkspaceConnector.getLateSweepWindow({
            window: pollWindow(
              new Date(previousEnd).toISOString(),
              new Date(end).toISOString(),
            ),
          });

        if (sweep) {
          sweeps.push(new Date(end).toISOString());
          // A day back from the new ground, up to where the window starts.
          expect(sweep.endTime.getTime() - sweep.startTime.getTime()).toBe(
            GOOGLE_WORKSPACE_LATE_SWEEP_LOOK_BACK_HOURS * HOUR_IN_MS -
              OVERLAP_IN_MS,
          );
        }

        previousEnd = end;
      }

      expect([intervalInMinutes, sweeps.length]).toEqual([
        intervalInMinutes,
        4,
      ]);
    }
  });

  test("a preview, a backfill and a first poll's day-long look back never sweep", () => {
    const sweeping: { startTime: Date; endTime: Date } = pollWindow(
      "2026-10-30T11:58:00.000Z",
      "2026-10-30T12:03:00.000Z",
    );

    expect(
      GoogleWorkspaceConnector.getLateSweepWindow({
        window: sweeping,
        purpose: "poll",
      }),
    ).not.toBeNull();

    for (const purpose of ["preview", "backfill"]) {
      expect(
        GoogleWorkspaceConnector.getLateSweepWindow({
          window: sweeping,
          purpose,
        }),
      ).toBeNull();
    }

    expect(
      GoogleWorkspaceConnector.getLateSweepWindow({
        window: {
          startTime: new Date("2026-10-29T12:00:00.000Z"),
          endTime: new Date("2026-10-30T12:03:00.000Z"),
        },
      }),
    ).toBeNull();
  });

  test("a sweeping poll imports the token activity Google made readable late, once, and reads nothing else again", async () => {
    const window: { startTime: Date; endTime: Date } = pollWindow(
      "2026-10-30T11:58:00.000Z",
      "2026-10-30T12:03:00.000Z",
    );
    const late: JSONObject = activity(
      GoogleWorkspaceApplication.Token,
      "authorize",
      "2026-10-30T03:00:00.000Z",
      "late-token-grant",
      [
        { name: "client_id", value: "1234.apps.googleusercontent.com" },
        { name: "app_name", value: "Mail Exporter Pro" },
        { name: "scope", multiValue: ["https://mail.google.com/"] },
      ],
    );
    const inWindow: JSONObject = activity(
      GoogleWorkspaceApplication.Token,
      "authorize",
      "2026-10-30T11:00:00.000Z",
      "window-token-grant",
      [
        { name: "client_id", value: "5678.apps.googleusercontent.com" },
        { name: "app_name", value: "Calendar Sync" },
        { name: "scope", multiValue: ["https://mail.google.com/"] },
      ],
    );
    const lateSignIn: JSONObject = activity(
      GoogleWorkspaceApplication.Login,
      "login_failure",
      "2026-10-30T03:00:00.000Z",
      "late-login",
    );
    const { api, connector } = connectorFor({
      activities: {
        [GoogleWorkspaceApplication.Token]: [late, inWindow],
        [GoogleWorkspaceApplication.Login]: [lateSignIn],
      },
    });
    const result: ConnectorFetchResult = await connector.fetchEvents(
      settings(),
      window,
      fetchOptions(),
    );

    expect(result.complete).toBe(true);
    expect(
      result.events
        .map((event: NormalizedSecurityEvent): string => {
          return event.eventUid;
        })
        .filter((uid: string): boolean => {
          return uid.includes("token-grant") || uid.includes("late-login");
        })
        .sort(),
    ).toEqual(
      [
        expect.stringContaining("late-token-grant"),
        expect.stringContaining("window-token-grant"),
      ].sort(),
    );
    // A sign-in Google makes readable in minutes is never read again.
    expect(
      result.events.some((event: NormalizedSecurityEvent): boolean => {
        return event.eventUid.includes("late-login");
      }),
    ).toBe(false);

    const sweepReads: Array<URL> = activityRequests(api).filter(
      (url: URL): boolean => {
        return url.searchParams.get("startTime") === "2026-10-29T11:58:00.000Z";
      },
    );

    expect(
      sweepReads.map((url: URL): string => {
        return url.pathname.split("/").pop() || "";
      }),
    ).toEqual([GoogleWorkspaceApplication.Token]);
    expect(sweepReads[0]!.searchParams.get("endTime")).toBe(
      window.startTime.toISOString(),
    );
    expect(check(result.checks!, "read-late-activity")).toMatchObject({
      status: "pass",
    });
    expect(check(result.checks!, "read-late-activity").message).toContain(
      "Read OAuth token activity again from 2026-10-29T11:58:00.000Z to 2026-10-30T09:58:00.000Z, which Google can make readable hours late: 1 activity, 1 not in this run already",
    );
    expect(result.details!["lateSweep"]).toEqual({
      from: "2026-10-29T11:58:00.000Z",
      to: "2026-10-30T09:58:00.000Z",
      activitiesRead: 1,
    });
  });

  test("a poll that does not sweep reads no day before its window", async () => {
    const { api, connector } = connectorFor({});
    const result: ConnectorFetchResult = await connector.fetchEvents(
      settings(),
      WINDOW,
      fetchOptions(),
    );

    expect(
      result.checks!.some((candidate: SecurityConnectorCheck): boolean => {
        return candidate.key === "read-late-activity";
      }),
    ).toBe(false);
    expect(result.details!["lateSweep"]).toBeUndefined();
    expect(
      activityRequests(api).every((url: URL): boolean => {
        return (
          url.searchParams.get("startTime") === WINDOW.startTime.toISOString()
        );
      }),
    ).toBe(true);
  });

  test("a sweep Google refuses is a warning; the window was read and stays read", async () => {
    const window: { startTime: Date; endTime: Date } = pollWindow(
      "2026-10-30T11:58:00.000Z",
      "2026-10-30T12:03:00.000Z",
    );
    const { connector } = connectorFor({
      activities: {
        [GoogleWorkspaceApplication.Token]: [
          activity(
            GoogleWorkspaceApplication.Token,
            "authorize",
            "2026-10-30T11:00:00.000Z",
            "window-token-grant",
            [
              { name: "client_id", value: "5678.apps.googleusercontent.com" },
              { name: "app_name", value: "Calendar Sync" },
              { name: "scope", multiValue: ["https://mail.google.com/"] },
            ],
          ),
        ],
      },
      failuresStartingBefore: {
        [GoogleWorkspaceApplication.Token]: {
          time: window.startTime.toISOString(),
          failure: {
            statusCode: 503,
            body: googleError(
              503,
              "UNAVAILABLE",
              "Backend Error",
              "backendError",
            ),
          },
        },
      },
    });
    const result: ConnectorFetchResult = await connector.fetchEvents(
      settings(),
      window,
      fetchOptions(),
    );

    expect(result.complete).toBe(true);
    expect(result.events.length).toBeGreaterThan(0);
    expect(check(result.checks!, "read-late-activity").status).toBe("warn");
    expect(result.warnings.join(" ")).toContain(
      "Late OAuth token activity was not read:",
    );
  });

  test("a sweep reads within pages of its own, and one its bound stops says so without leaving the window unread", async () => {
    const window: { startTime: Date; endTime: Date } = pollWindow(
      "2026-10-30T11:58:00.000Z",
      "2026-10-30T12:03:00.000Z",
    );
    const many: Array<JSONObject> = Array.from(
      { length: 12 },
      (_: unknown, index: number): JSONObject => {
        return activity(
          GoogleWorkspaceApplication.Token,
          "authorize",
          new Date(
            new Date("2026-10-30T03:00:00.000Z").getTime() -
              index * MINUTE_IN_MS,
          ).toISOString(),
          `late-${index}`,
          [
            { name: "client_id", value: `${index}.apps.googleusercontent.com` },
            { name: "app_name", value: `App ${index}` },
            { name: "scope", multiValue: ["https://mail.google.com/"] },
          ],
        );
      },
    );
    // Two activities a page: the sweep's five pages read ten of the twelve.
    const { connector } = connectorFor({
      activities: { [GoogleWorkspaceApplication.Token]: many },
      pageCap: 2,
    });
    const result: ConnectorFetchResult = await connector.fetchEvents(
      settings(),
      window,
      fetchOptions(),
    );

    expect(GOOGLE_WORKSPACE_LATE_SWEEP_PAGES).toBe(5);
    expect(result.complete).toBe(true);
    expect((result.details!["lateSweep"] as JSONObject)["activitiesRead"]).toBe(
      10,
    );
    expect(check(result.checks!, "read-late-activity").status).toBe("warn");
    expect(result.warnings.join(" ")).toContain(
      "Stopped sweeping OAuth token activity after 10 activities",
    );
    expect(result.warnings.join(" ")).toContain("The window itself was read.");
  });

  test("the fetch's budget holds the sweep's pages besides every listing's own", () => {
    const connector: GoogleWorkspaceConnector = new GoogleWorkspaceConnector();

    expect(GoogleWorkspaceConnector.lateSweepPages()).toBe(
      GOOGLE_WORKSPACE_LATE_APPLICATIONS.length *
        GOOGLE_WORKSPACE_LATE_SWEEP_PAGES,
    );
    expect(connector.fetchBudget.maxEvents).toBe(
      (connector.fetchBudget.maxRequests! - 3) * GOOGLE_WORKSPACE_PAGE_SIZE,
    );
  });
});
