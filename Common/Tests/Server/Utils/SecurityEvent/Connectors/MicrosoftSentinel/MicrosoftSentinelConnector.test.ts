import { afterEach, describe, expect, jest, test } from "@jest/globals";
import MicrosoftSentinelConnector from "../../../../../../Server/Utils/SecurityEvent/Connectors/MicrosoftSentinel/MicrosoftSentinelConnector";
import { MICROSOFT_SENTINEL_DEFAULT_PAGE_SIZE } from "../../../../../../Server/Utils/SecurityEvent/Connectors/MicrosoftSentinel/MicrosoftSentinelClient";
import {
  ConnectorFetchOptions,
  ConnectorFetchResult,
  SecurityConnectorSettings,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../../Server/Utils/DataSource/HttpFetch";
import MicrosoftSentinelNormalizer from "../../../../../../Utils/SecurityEvent/Connectors/MicrosoftSentinelNormalizer";
import APIException from "../../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { SecurityConnectorCheck } from "../../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";

/*
 * The connector as the poller and the tester use it: settings are read by
 * the catalog's keys, the test checklist carries the fixed keys with a
 * remediation per failure mode, and fetchEvents walks nextLink within the
 * request and record bounds, holding `complete` false whenever a bound
 * stopped it. The transport is injected; nothing touches the network.
 */

const TENANT_ID: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const CLIENT_ID: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const CLIENT_SECRET: string = "A1bC2dE3fH4iJ5kL6mN7oP8qR9sT0u~verySecret";
const SUBSCRIPTION_ID: string = "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0";
const ACCESS_TOKEN: string =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJodHRwczovL21hbmFnZW1lbnQifQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ";
const START: Date = new Date("2026-09-12T10:00:00.000Z");
const END: Date = new Date("2026-09-13T10:00:00.000Z");
const INCIDENTS_PATH: string = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/myRg/providers/Microsoft.OperationalInsights/workspaces/myWorkspace/providers/Microsoft.SecurityInsights/incidents`;
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

const definition: SecurityEventConnectorDefinition =
  getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.MicrosoftSentinel,
  )!;

type Responder = (
  request: DataSourceHttpRequest,
) => DataSourceHttpResponse | Promise<DataSourceHttpResponse>;

interface Harness {
  requests: Array<DataSourceHttpRequest>;
  connector: MicrosoftSentinelConnector;
}

function settings(
  overrides: {
    config?: JSONObject;
    secrets?: JSONObject;
    provider?: SecurityEventConnectorProvider;
  } = {},
): SecurityConnectorSettings {
  return {
    provider:
      overrides.provider || SecurityEventConnectorProvider.MicrosoftSentinel,
    config: {
      tenantId: TENANT_ID,
      clientId: CLIENT_ID,
      subscriptionId: SUBSCRIPTION_ID,
      resourceGroup: "myRg",
      workspaceName: "myWorkspace",
      cloud: "public",
      ...(overrides.config || {}),
    },
    secrets: { clientSecret: CLIENT_SECRET, ...(overrides.secrets || {}) },
    alertingOnly: false,
  };
}

function fetchOptions(
  overrides: Partial<ConnectorFetchOptions> = {},
): ConnectorFetchOptions {
  return {
    maxRequests: 20,
    maxEvents: 10000,
    requestTimeoutInMs: 60000,
    sampleLimit: 25,
    ...overrides,
  };
}

function ok(body: JSONObject): DataSourceHttpResponse {
  return {
    statusCode: 200,
    bodyText: JSON.stringify(body),
    bodyJson: body,
    headers: {},
  };
}

function status(code: number, body: string): DataSourceHttpResponse {
  let bodyJson: unknown = undefined;

  try {
    bodyJson = JSON.parse(body);
  } catch {
    bodyJson = undefined;
  }

  return { statusCode: code, bodyText: body, bodyJson, headers: {} };
}

function tokenResponse(): DataSourceHttpResponse {
  return ok({
    token_type: "Bearer",
    expires_in: 3599,
    access_token: ACCESS_TOKEN,
  });
}

function incident(name: string, severity: string = "High"): JSONObject {
  return {
    id: `${INCIDENTS_PATH}/${name}`,
    name,
    type: "Microsoft.SecurityInsights/incidents",
    properties: {
      lastModifiedTimeUtc: "2026-09-12T13:15:30Z",
      createdTimeUtc: "2026-09-12T13:15:30Z",
      firstActivityTimeUtc: "2026-09-12T13:00:30Z",
      title: `Incident ${name}`,
      severity,
      status: "New",
      incidentNumber: 42,
      owner: {
        objectId: "2046feea-040d-4a46-9e2b-91c2941bfa70",
        email: "john.doe@contoso.com",
        userPrincipalName: "john@contoso.com",
        assignedTo: "john doe",
      },
      labels: [],
      additionalData: { alertsCount: 1, tactics: ["Persistence"] },
    },
  };
}

function nextLink(token: string): string {
  return `https://management.azure.com${INCIDENTS_PATH}?api-version=2024-03-01&$skipToken=${token}`;
}

function buildHarness(options: {
  token?: Responder;
  incidents?: Array<Responder>;
}): Harness {
  const requests: Array<DataSourceHttpRequest> = [];
  const incidentResponders: Array<Responder> = [...(options.incidents || [])];

  const connector: MicrosoftSentinelConnector = new MicrosoftSentinelConnector(
    async (request: DataSourceHttpRequest): Promise<DataSourceHttpResponse> => {
      requests.push(request);

      if (request.url.includes("/oauth2/v2.0/token")) {
        return (options.token || tokenResponse)(request);
      }

      const responder: Responder | undefined = incidentResponders.shift();

      if (!responder) {
        throw new Error(`Unexpected request to ${request.url}`);
      }

      return responder(request);
    },
  );

  return { requests, connector };
}

function incidentRequests(
  requests: Array<DataSourceHttpRequest>,
): Array<DataSourceHttpRequest> {
  return requests.filter((request: DataSourceHttpRequest): boolean => {
    return request.url.includes("/incidents");
  });
}

function windowOf(request: DataSourceHttpRequest): { start: Date; end: Date } {
  const filter: string = new URL(request.url).searchParams.get("$filter") || "";
  const match: RegExpMatchArray | null = filter.match(
    /^\(properties\/createdTimeUtc ge (\S+)\) and \(properties\/createdTimeUtc lt (\S+)\)$/,
  );

  if (!match) {
    throw new Error(`Unexpected $filter: ${filter}`);
  }

  return { start: new Date(match[1]!), end: new Date(match[2]!) };
}

function checkByKey(
  checks: Array<SecurityConnectorCheck>,
  key: string,
): SecurityConnectorCheck {
  const check: SecurityConnectorCheck | undefined = checks.find(
    (candidate: SecurityConnectorCheck): boolean => {
      return candidate.key === key;
    },
  );

  if (!check) {
    throw new Error(`Missing check ${key}`);
  }

  return check;
}

describe("MicrosoftSentinelConnector", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is registered under the microsoft-sentinel provider", () => {
    expect(new MicrosoftSentinelConnector().provider).toBe(
      SecurityEventConnectorProvider.MicrosoftSentinel,
    );
    expect(definition.provider).toBe("microsoft-sentinel");
  });

  describe("validateSettings", () => {
    test("accepts a complete configuration, trimming whitespace", () => {
      const connector: MicrosoftSentinelConnector =
        new MicrosoftSentinelConnector();

      expect(() => {
        connector.validateSettings(
          settings({
            config: { tenantId: ` ${TENANT_ID} `, cloud: " USGOV " },
          }),
        );
      }).not.toThrow();
    });

    test("rejects settings meant for another provider", () => {
      expect(() => {
        new MicrosoftSentinelConnector().validateSettings(
          settings({ provider: SecurityEventConnectorProvider.OktaSystemLog }),
        );
      }).toThrow(BadDataException);
    });

    test("names the offending catalog field", () => {
      const connector: MicrosoftSentinelConnector =
        new MicrosoftSentinelConnector();

      expect(() => {
        connector.validateSettings(settings({ config: { tenantId: "" } }));
      }).toThrow("Directory (tenant) ID");
      expect(() => {
        connector.validateSettings(settings({ config: { clientId: "abc" } }));
      }).toThrow("Application (client) ID must be a GUID");
      expect(() => {
        connector.validateSettings(
          settings({ config: { subscriptionId: "abc" } }),
        );
      }).toThrow("Subscription ID must be a GUID");
      expect(() => {
        connector.validateSettings(
          settings({ config: { resourceGroup: "bad rg" } }),
        );
      }).toThrow("Resource group");
      expect(() => {
        connector.validateSettings(
          settings({ config: { workspaceName: "_ws" } }),
        );
      }).toThrow("Workspace name");
      expect(() => {
        connector.validateSettings(settings({ config: { cloud: "china" } }));
      }).toThrow('Cloud must be "public" or "usgov"');
      expect(() => {
        connector.validateSettings(settings({ secrets: { clientSecret: "" } }));
      }).toThrow("Client secret is required.");
    });
  });

  describe("testConnection", () => {
    test("runs authentication, a one-incident read over the last day, and bounded counts over 24 hours and 7 days", async () => {
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return ok({ value: [incident("i1")] });
          },
          (): DataSourceHttpResponse => {
            return ok({
              value: [incident("i1"), incident("i2"), incident("i3")],
            });
          },
          (): DataSourceHttpResponse => {
            const value: Array<JSONObject> = [];
            for (
              let i: number = 0;
              i < MICROSOFT_SENTINEL_DEFAULT_PAGE_SIZE;
              i++
            ) {
              value.push(incident(`w${i}`));
            }
            return ok({ value, nextLink: nextLink("more") });
          },
        ],
      });

      const before: number = Date.now();
      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 5000,
        });
      const after: number = Date.now();

      expect(
        checks.map((check: SecurityConnectorCheck): string => {
          return `${check.key}:${check.status}`;
        }),
      ).toEqual([
        "authentication:pass",
        "read-permission:pass",
        "detections-available:pass",
      ]);

      const reads: Array<DataSourceHttpRequest> = incidentRequests(
        harness.requests,
      );
      expect(reads).toHaveLength(3);
      expect(harness.requests).toHaveLength(4);

      for (const request of harness.requests) {
        expect(request.timeoutInMs).toBe(5000);
      }

      // Read probe: one record over the last 24 hours.
      expect(new URL(reads[0]!.url).searchParams.get("$top")).toBe("1");
      const probeWindow: { start: Date; end: Date } = windowOf(reads[0]!);
      expect(probeWindow.end.getTime() - probeWindow.start.getTime()).toBe(
        DAY_IN_MS,
      );
      expect(probeWindow.end.getTime()).toBeGreaterThanOrEqual(before);
      expect(probeWindow.end.getTime()).toBeLessThanOrEqual(after);

      // Counts: one full page each over 24 hours and 7 days.
      expect(new URL(reads[1]!.url).searchParams.get("$top")).toBe(
        String(MICROSOFT_SENTINEL_DEFAULT_PAGE_SIZE),
      );
      expect(new URL(reads[2]!.url).searchParams.get("$top")).toBe(
        String(MICROSOFT_SENTINEL_DEFAULT_PAGE_SIZE),
      );
      const dayWindow: { start: Date; end: Date } = windowOf(reads[1]!);
      const weekWindow: { start: Date; end: Date } = windowOf(reads[2]!);
      expect(dayWindow.end.getTime() - dayWindow.start.getTime()).toBe(
        DAY_IN_MS,
      );
      expect(weekWindow.end.getTime() - weekWindow.start.getTime()).toBe(
        7 * DAY_IN_MS,
      );

      const available: SecurityConnectorCheck = checkByKey(
        checks,
        "detections-available",
      );
      expect(available.message).toBe(
        "3 incidents created in the last 24 hours and 50+ in the last 7 days.",
      );
      expect(available.details).toEqual({
        createdLast24h: 3,
        hasMoreLast24h: false,
        createdLast7d: 50,
        hasMoreLast7d: true,
      });
      expect(available.remediation).toBeUndefined();

      const read: SecurityConnectorCheck = checkByKey(
        checks,
        "read-permission",
      );
      expect(read.details).toEqual({
        workspaceName: "myWorkspace",
        sampleIncidentCount: 1,
      });
    });

    test("warns, with guidance, when nothing was created in the last 7 days", async () => {
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return ok({ value: [] });
          },
          (): DataSourceHttpResponse => {
            return ok({ value: [] });
          },
          (): DataSourceHttpResponse => {
            return ok({ value: [] });
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 5000,
        });

      const read: SecurityConnectorCheck = checkByKey(
        checks,
        "read-permission",
      );
      expect(read.status).toBe("pass");
      expect(read.message).toContain(
        "no incident was created in the last 24 hours",
      );

      const available: SecurityConnectorCheck = checkByKey(
        checks,
        "detections-available",
      );
      expect(available.status).toBe("warn");
      expect(available.message).toBe(
        "No incidents were created in the last 7 days. Polling will import new incidents as Microsoft Sentinel creates them.",
      );
      expect(available.remediation).toContain("analytics rules are enabled");
    });

    test("fails authentication with the Entra remediation and skips the rest when the token is refused", async () => {
      const harness: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          return status(
            401,
            JSON.stringify({
              error: "invalid_client",
              error_description: `AADSTS7000215: Invalid client secret provided. client_secret=${CLIENT_SECRET}`,
            }),
          );
        },
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 5000,
        });

      expect(
        checks.map((check: SecurityConnectorCheck): string => {
          return `${check.key}:${check.status}`;
        }),
      ).toEqual([
        "authentication:fail",
        "read-permission:skip",
        "detections-available:skip",
      ]);

      const auth: SecurityConnectorCheck = checkByKey(checks, "authentication");
      expect(auth.message).toMatch(
        /^Microsoft Sentinel token request failed \(HTTP 401\): /,
      );
      expect(auth.message).not.toContain(CLIENT_SECRET);
      expect(auth.remediation).toContain("Certificates & secrets");
      expect(harness.requests).toHaveLength(1);
    });

    test("maps authentication timeouts, throttling and outages to their own remediation", async () => {
      const timedOut: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          throw new APIException(
            "Microsoft Sentinel token request timed out after 5 seconds with no response.",
          );
        },
      });
      const timedOutChecks: Array<SecurityConnectorCheck> =
        await timedOut.connector.testConnection(settings(), {
          requestTimeoutInMs: 5000,
        });
      expect(
        checkByKey(timedOutChecks, "authentication").remediation,
      ).toContain("login.microsoftonline.com");

      const throttled: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          return status(
            429,
            JSON.stringify({ error: "temporarily_unavailable" }),
          );
        },
      });
      const throttledChecks: Array<SecurityConnectorCheck> =
        await throttled.connector.testConnection(settings(), {
          requestTimeoutInMs: 5000,
        });
      expect(
        checkByKey(throttledChecks, "authentication").remediation,
      ).toContain("throttling this app registration");

      const down: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          return status(502, "Bad Gateway");
        },
      });
      const downChecks: Array<SecurityConnectorCheck> =
        await down.connector.testConnection(settings(), {
          requestTimeoutInMs: 5000,
        });
      expect(checkByKey(downChecks, "authentication").remediation).toContain(
        "server-side problem",
      );
    });

    test("fails the read check with the role-assignment remediation on 403 and skips the counts", async () => {
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return status(
              403,
              JSON.stringify({
                error: {
                  code: "AuthorizationFailed",
                  message: "does not have authorization to perform action",
                },
              }),
            );
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 5000,
        });

      expect(
        checks.map((check: SecurityConnectorCheck): string => {
          return `${check.key}:${check.status}`;
        }),
      ).toEqual([
        "authentication:pass",
        "read-permission:fail",
        "detections-available:skip",
      ]);

      const read: SecurityConnectorCheck = checkByKey(
        checks,
        "read-permission",
      );
      expect(read.message).toMatch(
        /^Microsoft Sentinel incidents list failed \(HTTP 403\): /,
      );
      expect(read.remediation).toContain("Microsoft Sentinel Reader");
      expect(read.remediation).toContain("Access control (IAM)");
    });

    test("maps 404, 401, 429, 5xx and timeouts on the read check to their own remediation", async () => {
      const unauthorized: Responder = (): DataSourceHttpResponse => {
        return status(
          401,
          JSON.stringify({
            error: { code: "InvalidAuthenticationToken", message: "x" },
          }),
        );
      };
      const cases: Array<{ responses: Array<Responder>; expected: string }> = [
        {
          responses: [
            (): DataSourceHttpResponse => {
              return status(
                404,
                JSON.stringify({
                  error: { code: "ResourceNotFound", message: "x" },
                }),
              );
            },
          ],
          expected: "Workspace name against the workspace's Overview page",
        },
        {
          /*
           * The authentication check already cached a token, so the read
           * step retries a 401 once with a fresh token before giving up:
           * the case needs two refusals.
           */
          responses: [unauthorized, unauthorized],
          expected: "Confirm the Cloud setting",
        },
        {
          responses: [
            (): DataSourceHttpResponse => {
              return status(
                429,
                JSON.stringify({
                  error: { code: "TooManyRequests", message: "x" },
                }),
              );
            },
          ],
          expected: "throttling requests for this subscription",
        },
        {
          responses: [
            (): DataSourceHttpResponse => {
              return status(503, "Service Unavailable");
            },
          ],
          expected: "server-side problem",
        },
        {
          responses: [
            (): DataSourceHttpResponse => {
              throw new APIException(
                "Microsoft Sentinel incidents list timed out after 5 seconds with no response.",
              );
            },
          ],
          expected: "management.azure.com",
        },
      ];

      for (const testCase of cases) {
        const harness: Harness = buildHarness({
          incidents: testCase.responses,
        });
        const checks: Array<SecurityConnectorCheck> =
          await harness.connector.testConnection(settings(), {
            requestTimeoutInMs: 5000,
          });
        const read: SecurityConnectorCheck = checkByKey(
          checks,
          "read-permission",
        );
        expect(read.status).toBe("fail");
        expect(read.remediation).toContain(testCase.expected);
      }
    });

    test("fails only the availability check when a count request fails after the read probe passed", async () => {
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return ok({ value: [incident("i1")] });
          },
          (): DataSourceHttpResponse => {
            return ok({ value: [incident("i1")] });
          },
          (): DataSourceHttpResponse => {
            return status(500, "Internal Server Error");
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 5000,
        });

      expect(checkByKey(checks, "read-permission").status).toBe("pass");
      const available: SecurityConnectorCheck = checkByKey(
        checks,
        "detections-available",
      );
      expect(available.status).toBe("fail");
      expect(available.message).toMatch(
        /^Microsoft Sentinel incidents list failed \(HTTP 500\): /,
      );
      expect(available.remediation).toContain("server-side problem");
    });

    test("reports unusable settings as a failed authentication check without contacting anything", async () => {
      const harness: Harness = buildHarness({});

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(
          settings({ config: { subscriptionId: "nope" } }),
          { requestTimeoutInMs: 5000 },
        );

      expect(
        checks.map((check: SecurityConnectorCheck): string => {
          return `${check.key}:${check.status}`;
        }),
      ).toEqual([
        "authentication:fail",
        "read-permission:skip",
        "detections-available:skip",
      ]);
      expect(checkByKey(checks, "authentication").message).toContain(
        "Subscription ID must be a GUID",
      );
      expect(harness.requests).toHaveLength(0);
    });
  });

  describe("fetchEvents", () => {
    test("lists incidents created in the window, normalizes them with the catalog's vendor and product, and builds samples", async () => {
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return ok({
              value: [incident("i1", "High"), incident("i2", "Low")],
            });
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ requestTimeoutInMs: 1234, sampleLimit: 1 }),
      );

      expect(result.fetchedCount).toBe(2);
      expect(result.events).toHaveLength(2);
      expect(result.rejectedCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.complete).toBe(true);
      expect(result.requestCount).toBe(1);
      expect(result.warnings).toEqual([]);

      for (const event of result.events) {
        expect(event.vendorName).toBe(definition.vendorName);
        expect(event.productName).toBe(definition.productName);
        expect(event.classUid).toBe(2005);
      }
      expect(result.events[0]!.eventUid).toBe("i1");
      expect(result.events[1]!.severityName).toBe("Low");

      expect(result.samples).toEqual([
        {
          id: "i1",
          title: "Incident i1",
          severity: "High",
          createdTime: "2026-09-12T13:15:30Z",
          eventTime: "2026-09-12T13:00:30Z",
        },
      ]);

      const reads: Array<DataSourceHttpRequest> = incidentRequests(
        harness.requests,
      );
      expect(reads).toHaveLength(1);
      expect(windowOf(reads[0]!)).toEqual({ start: START, end: END });
      expect(new URL(reads[0]!.url).searchParams.get("$top")).toBe(
        String(MICROSOFT_SENTINEL_DEFAULT_PAGE_SIZE),
      );
      expect(new URL(reads[0]!.url).searchParams.get("$orderby")).toBe(
        "properties/createdTimeUtc asc",
      );
      expect(reads[0]!.timeoutInMs).toBe(1234);
    });

    test("follows nextLink to the end of the window and reports every page as a request", async () => {
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return ok({ value: [incident("i1")], nextLink: nextLink("p2") });
          },
          (): DataSourceHttpResponse => {
            return ok({ value: [incident("i2")], nextLink: nextLink("p3") });
          },
          (): DataSourceHttpResponse => {
            return ok({ value: [incident("i3")] });
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions(),
      );

      expect(
        result.events.map((event: NormalizedSecurityEvent): string => {
          return event.eventUid;
        }),
      ).toEqual(["i1", "i2", "i3"]);
      expect(result.requestCount).toBe(3);
      expect(result.complete).toBe(true);

      const reads: Array<DataSourceHttpRequest> = incidentRequests(
        harness.requests,
      );
      expect(reads[1]!.url).toBe(nextLink("p2"));
      expect(reads[2]!.url).toBe(nextLink("p3"));
      expect(harness.requests).toHaveLength(4);
    });

    test("stops at the request bound with complete=false and a warning, leaving the rest for the next poll", async () => {
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return ok({ value: [incident("i1")], nextLink: nextLink("p2") });
          },
          (): DataSourceHttpResponse => {
            return ok({ value: [incident("i2")], nextLink: nextLink("p3") });
          },
          (): DataSourceHttpResponse => {
            throw new Error("the third page must not be requested");
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ maxRequests: 2 }),
      );

      expect(result.events).toHaveLength(2);
      expect(result.requestCount).toBe(2);
      expect(result.complete).toBe(false);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("per-run request limit");
      expect(result.warnings[0]).toContain("cursor is held");
      expect(incidentRequests(harness.requests)).toHaveLength(2);
    });

    test("stops at the record bound mid-page with complete=false and a warning", async () => {
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return ok({
              value: [incident("i1"), incident("i2"), incident("i3")],
              nextLink: nextLink("p2"),
            });
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ maxEvents: 2 }),
      );

      expect(
        result.events.map((event: NormalizedSecurityEvent): string => {
          return event.eventUid;
        }),
      ).toEqual(["i1", "i2"]);
      expect(result.fetchedCount).toBe(2);
      expect(result.complete).toBe(false);
      expect(result.requestCount).toBe(1);
      expect(result.warnings[0]).toContain("per-run record limit");
    });

    test("treats reaching the record bound exactly as incomplete only when more pages exist", async () => {
      const withMore: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return ok({
              value: [incident("i1"), incident("i2")],
              nextLink: nextLink("p2"),
            });
          },
        ],
      });
      const incomplete: ConnectorFetchResult =
        await withMore.connector.fetchEvents(
          settings(),
          { startTime: START, endTime: END },
          fetchOptions({ maxEvents: 2 }),
        );
      expect(incomplete.complete).toBe(false);
      expect(incomplete.events).toHaveLength(2);

      const lastPage: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return ok({ value: [incident("i1"), incident("i2")] });
          },
        ],
      });
      const complete: ConnectorFetchResult =
        await lastPage.connector.fetchEvents(
          settings(),
          { startTime: START, endTime: END },
          fetchOptions({ maxEvents: 2 }),
        );
      expect(complete.complete).toBe(true);
      expect(complete.warnings).toEqual([]);
    });

    test("counts unrecognized records as rejected and normalization throws as failed, without stopping the page", async () => {
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return ok({
              value: [
                incident("i1"),
                { error: { code: "Partial", message: "not an incident" } },
                incident("i2"),
                incident("i3"),
              ],
            });
          },
        ],
      });

      const original: (
        raw: JSONObject,
      ) => ReturnType<typeof MicrosoftSentinelNormalizer.normalize> =
        MicrosoftSentinelNormalizer.normalize.bind(MicrosoftSentinelNormalizer);
      jest
        .spyOn(MicrosoftSentinelNormalizer, "normalize")
        .mockImplementation((raw: JSONObject) => {
          if (raw["name"] === "i2") {
            throw new Error("boom");
          }

          return original(raw);
        });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions(),
      );

      expect(result.fetchedCount).toBe(4);
      expect(result.rejectedCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(
        result.events.map((event: NormalizedSecurityEvent): string => {
          return event.eventUid;
        }),
      ).toEqual(["i1", "i3"]);
      expect(result.complete).toBe(true);
    });

    test("returns no samples when the sample limit is zero", async () => {
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return ok({ value: [incident("i1")] });
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ sampleLimit: 0 }),
      );

      expect(result.samples).toEqual([]);
      expect(result.events).toHaveLength(1);
    });

    test("propagates authentication and permission failures so the poller records a failed run", async () => {
      const denied: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return status(
              403,
              JSON.stringify({
                error: { code: "AuthorizationFailed", message: "no" },
              }),
            );
          },
        ],
      });

      await expect(
        denied.connector.fetchEvents(
          settings(),
          { startTime: START, endTime: END },
          fetchOptions(),
        ),
      ).rejects.toThrow(
        /^Microsoft Sentinel incidents list failed \(HTTP 403\): /,
      );

      const badToken: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          return status(
            401,
            JSON.stringify({
              error: "invalid_client",
              error_description: `AADSTS7000215: bad secret client_secret=${CLIENT_SECRET}`,
            }),
          );
        },
      });

      let thrown: Error | null = null;
      try {
        await badToken.connector.fetchEvents(
          settings(),
          { startTime: START, endTime: END },
          fetchOptions(),
        );
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown).toBeInstanceOf(APIException);
      expect(thrown!.message).toMatch(
        /^Microsoft Sentinel token request failed \(HTTP 401\): /,
      );
      expect(thrown!.message).not.toContain(CLIENT_SECRET);
    });

    test("rejects unusable settings before contacting anything", async () => {
      const harness: Harness = buildHarness({});

      await expect(
        harness.connector.fetchEvents(
          settings({ config: { workspaceName: "" } }),
          { startTime: START, endTime: END },
          fetchOptions(),
        ),
      ).rejects.toThrow(BadDataException);
      expect(harness.requests).toHaveLength(0);
    });
  });
});
