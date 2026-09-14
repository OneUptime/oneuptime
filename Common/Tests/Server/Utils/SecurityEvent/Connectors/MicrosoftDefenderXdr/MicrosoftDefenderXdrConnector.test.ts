import { afterEach, describe, expect, jest, test } from "@jest/globals";
import MicrosoftDefenderXdrConnector from "../../../../../../Server/Utils/SecurityEvent/Connectors/MicrosoftDefenderXdr/MicrosoftDefenderXdrConnector";
import { MICROSOFT_DEFENDER_XDR_DEFAULT_PAGE_SIZE } from "../../../../../../Server/Utils/SecurityEvent/Connectors/MicrosoftDefenderXdr/MicrosoftDefenderXdrClient";
import {
  ConnectorFetchOptions,
  ConnectorFetchResult,
  SecurityConnectorSettings,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../../Server/Utils/DataSource/HttpFetch";
import MicrosoftDefenderXdrNormalizer from "../../../../../../Utils/SecurityEvent/Connectors/MicrosoftDefenderXdrNormalizer";
import { SecurityConnectorCheck } from "../../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import SecurityEventConnectorProvider from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import APIException from "../../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import Dictionary from "../../../../../../Types/Dictionary";
import { JSONObject } from "../../../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../../../Types/SecurityEvent/NormalizedSecurityEvent";

/*
 * The connector is what the poller and the tester call. These tests pin
 * the settings contract (catalog keys), the three-check test report and
 * its remediation per failure mode, and the creation-time fetch: its
 * request shape, pagination, the request and record budgets that stop a
 * read without a resume point (Graph lists alerts newest first, so the
 * poller narrows instead), sample building, and that every outbound
 * request leaves through the injected transport with the caller's
 * timeout. No network.
 */

const TENANT_ID: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const CLIENT_ID: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const CLIENT_SECRET: string = "A1bC2dE3fH4iJ5kL6mN7oP8qR9sT0u~verySecret";
const ACCESS_TOKEN: string =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJodHRwczovL2dyYXBoIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ";
const WINDOW_START: Date = new Date("2026-09-12T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-09-13T10:00:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

const DEFINITION: SecurityEventConnectorDefinition =
  getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.MicrosoftDefenderXdr,
  )!;

type Responder = (
  request: DataSourceHttpRequest,
) => DataSourceHttpResponse | Promise<DataSourceHttpResponse>;

interface Harness {
  requests: Array<DataSourceHttpRequest>;
  connector: MicrosoftDefenderXdrConnector;
}

function ok(body: JSONObject): DataSourceHttpResponse {
  return {
    statusCode: 200,
    bodyText: JSON.stringify(body),
    bodyJson: body,
    headers: {},
  };
}

function status(
  code: number,
  body: string,
  headers?: Dictionary<string>,
): DataSourceHttpResponse {
  let bodyJson: unknown = undefined;

  try {
    bodyJson = JSON.parse(body);
  } catch {
    bodyJson = undefined;
  }

  return { statusCode: code, bodyText: body, bodyJson, headers: headers || {} };
}

function tokenResponse(): DataSourceHttpResponse {
  return ok({
    token_type: "Bearer",
    expires_in: 3599,
    access_token: ACCESS_TOKEN,
  });
}

function graphError(code: string, message: string): string {
  return JSON.stringify({ error: { code, message } });
}

function settings(
  overrides?: Partial<SecurityConnectorSettings>,
): SecurityConnectorSettings {
  return {
    provider: SecurityEventConnectorProvider.MicrosoftDefenderXdr,
    config: { tenantId: TENANT_ID, clientId: CLIENT_ID, cloud: "public" },
    secrets: { clientSecret: CLIENT_SECRET },
    alertingOnly: false,
    ...overrides,
  };
}

function fetchOptions(
  overrides?: Partial<ConnectorFetchOptions>,
): ConnectorFetchOptions {
  return {
    maxRequests: 20,
    maxEvents: 10000,
    requestTimeoutInMs: 60000,
    sampleLimit: 25,
    ...overrides,
  };
}

/*
 * Shaped like the List alerts_v2 example on
 * https://learn.microsoft.com/en-us/graph/api/security-list-alerts_v2
 */
function alert(id: string, overrides?: JSONObject): JSONObject {
  return {
    "@odata.type": "#microsoft.graph.security.alert",
    id,
    providerAlertId: id,
    incidentId: "28282",
    status: "new",
    severity: "low",
    classification: "unknown",
    determination: "unknown",
    serviceSource: "microsoftDefenderForEndpoint",
    detectionSource: "antivirus",
    detectorId: "e0da400f-affd-43ef-b1d5-afc2eb6f2756",
    tenantId: TENANT_ID,
    title: "Suspicious execution of hidden file",
    description: "A hidden file has been launched.",
    category: "DefenseEvasion",
    alertWebUrl: `https://security.microsoft.com/alerts/${id}?tid=${TENANT_ID}`,
    mitreTechniques: ["T1564.001"],
    createdDateTime: "2026-09-12T12:19:27.7211305Z",
    lastUpdateDateTime: "2026-09-12T14:19:01.3266667Z",
    firstActivityDateTime: "2026-09-12T07:45:50.116Z",
    lastActivityDateTime: "2026-09-12T07:56:58.222Z",
    evidence: [
      {
        "@odata.type": "#microsoft.graph.security.deviceEvidence",
        roles: ["compromised"],
        deviceDnsName: "yonif-lap3.middleeast.corp.microsoft.com",
        hostName: "yonif-lap3",
        ipInterfaces: ["1.1.1.1"],
      },
    ],
    ...(overrides || {}),
  };
}

function alerts(count: number, prefix: string): Array<JSONObject> {
  const items: Array<JSONObject> = [];

  for (let index: number = 0; index < count; index++) {
    items.push(alert(`${prefix}-${index}`));
  }

  return items;
}

/*
 * Token requests answer with the token responder; alerts requests consume
 * the scripted responders in order so a test can express "page 1, page 2"
 * or "401 then 200". A request nobody scripted fails the test loudly.
 */
function buildHarness(options: {
  token?: Responder;
  alerts?: Array<Responder>;
}): Harness {
  const requests: Array<DataSourceHttpRequest> = [];
  const alertsResponders: Array<Responder> = [...(options.alerts || [])];
  const tokenResponder: Responder = options.token || tokenResponse;

  const connector: MicrosoftDefenderXdrConnector =
    new MicrosoftDefenderXdrConnector(
      async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        requests.push(request);

        if (request.url.includes("/oauth2/v2.0/token")) {
          return tokenResponder(request);
        }

        const responder: Responder | undefined = alertsResponders.shift();

        if (!responder) {
          throw new Error(`Unexpected request to ${request.url}`);
        }

        return responder(request);
      },
    );

  return { requests, connector };
}

function alertsRequests(
  requests: Array<DataSourceHttpRequest>,
): Array<DataSourceHttpRequest> {
  return requests.filter((request: DataSourceHttpRequest): boolean => {
    return request.url.includes("/security/alerts_v2");
  });
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
    throw new Error(`No check with key ${key}`);
  }

  return check;
}

function expectNoSecrets(checks: Array<SecurityConnectorCheck>): void {
  const serialized: string = JSON.stringify(checks);
  expect(serialized).not.toContain(CLIENT_SECRET);
  expect(serialized).not.toContain(ACCESS_TOKEN);
}

async function expectRejection<T extends Error>(
  promise: Promise<unknown>,
  type: new (...args: Array<never>) => T,
): Promise<T> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(type);
    return error as T;
  }

  throw new Error("Expected the call to reject.");
}

describe("MicrosoftDefenderXdrConnector", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("identity", () => {
    test("is registered under the catalog's provider and defaults to the SSRF-guarded transport", () => {
      const connector: MicrosoftDefenderXdrConnector =
        new MicrosoftDefenderXdrConnector();

      expect(connector.provider).toBe(
        SecurityEventConnectorProvider.MicrosoftDefenderXdr,
      );
      expect(connector.provider).toBe(DEFINITION.provider);
    });
  });

  describe("validateSettings", () => {
    test("accepts a GUID tenant, a GUID client id, a known cloud and a secret", () => {
      const harness: Harness = buildHarness({});

      expect(() => {
        harness.connector.validateSettings(settings());
      }).not.toThrow();
      expect(() => {
        harness.connector.validateSettings(
          settings({
            config: {
              tenantId: "contoso.onmicrosoft.com",
              clientId: CLIENT_ID,
              cloud: "usgov",
            },
          }),
        );
      }).not.toThrow();
    });

    test("defaults the cloud to public when the form left it empty", () => {
      const harness: Harness = buildHarness({});

      expect(() => {
        harness.connector.validateSettings(
          settings({ config: { tenantId: TENANT_ID, clientId: CLIENT_ID } }),
        );
      }).not.toThrow();
    });

    test("rejects settings for another provider", () => {
      const harness: Harness = buildHarness({});

      expect(() => {
        harness.connector.validateSettings(
          settings({
            provider: SecurityEventConnectorProvider.MicrosoftSentinel,
          }),
        );
      }).toThrow(BadDataException);
    });

    test("names the offending field with the catalog's title", () => {
      const harness: Harness = buildHarness({});

      const cases: Array<{
        settings: SecurityConnectorSettings;
        title: string;
      }> = [
        {
          settings: settings({
            config: { tenantId: "", clientId: CLIENT_ID, cloud: "public" },
          }),
          title: "Directory (tenant) ID",
        },
        {
          settings: settings({
            config: {
              tenantId: "not a tenant!",
              clientId: CLIENT_ID,
              cloud: "public",
            },
          }),
          title: "Directory (tenant) ID",
        },
        {
          settings: settings({
            config: {
              tenantId: TENANT_ID,
              clientId: "not-a-guid",
              cloud: "public",
            },
          }),
          title: "Application (client) ID",
        },
        {
          settings: settings({
            config: {
              tenantId: TENANT_ID,
              clientId: CLIENT_ID,
              cloud: "china",
            },
          }),
          title: "Cloud",
        },
        {
          settings: settings({ secrets: { clientSecret: "   " } }),
          title: "Client secret",
        },
      ];

      for (const item of cases) {
        let thrown: unknown = null;

        try {
          harness.connector.validateSettings(item.settings);
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(BadDataException);
        expect((thrown as Error).message).toContain(item.title);
        expect((thrown as Error).message).not.toContain(CLIENT_SECRET);
      }
    });
  });

  describe("testConnection", () => {
    test("runs authentication, a one-record read probe and bounded counts, in that order, over the last day and week", async () => {
      const before: number = Date.now();
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return ok({ value: [alert("probe")] });
          },
          (): DataSourceHttpResponse => {
            return ok({ value: alerts(2, "day") });
          },
          (): DataSourceHttpResponse => {
            return ok({
              value: alerts(MICROSOFT_DEFENDER_XDR_DEFAULT_PAGE_SIZE, "week"),
              "@odata.nextLink":
                "https://graph.microsoft.com/v1.0/security/alerts_v2?$skiptoken=next",
            });
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 20000,
        });

      expect(
        checks.map((check: SecurityConnectorCheck): string => {
          return `${check.key}:${check.status}`;
        }),
      ).toEqual([
        "authentication:pass",
        "read-permission:pass",
        "detections-available:pass",
      ]);

      const availability: SecurityConnectorCheck = checkByKey(
        checks,
        "detections-available",
      );
      expect(availability.message).toBe(
        `2 alerts created in the last 24 hours and ${MICROSOFT_DEFENDER_XDR_DEFAULT_PAGE_SIZE}+ in the last 7 days.`,
      );
      expect(availability.details).toEqual({
        createdLast24h: "2",
        createdLast7d: `${MICROSOFT_DEFENDER_XDR_DEFAULT_PAGE_SIZE}+`,
        hasMoreLast24h: false,
        hasMoreLast7d: true,
      });
      expect(availability.remediation).toBeUndefined();

      // One token, then probe, count(24h), count(7d): the count never pages.
      expect(harness.requests).toHaveLength(4);
      const pages: Array<DataSourceHttpRequest> = alertsRequests(
        harness.requests,
      );
      expect(pages).toHaveLength(3);

      for (const request of pages) {
        expect(request.method).toBe("GET");
        expect(request.timeoutInMs).toBe(20000);
        expect(request.headers?.["Authorization"]).toBe(
          `Bearer ${ACCESS_TOKEN}`,
        );
        expect(
          Array.from(new URL(request.url).searchParams.keys()).sort(),
        ).toEqual(["$filter", "$top"]);
      }

      expect(harness.requests[0]!.timeoutInMs).toBe(20000);

      const probe: URL = new URL(pages[0]!.url);
      expect(probe.searchParams.get("$top")).toBe("1");
      const probeFilter: RegExpMatchArray | null = (
        probe.searchParams.get("$filter") || ""
      ).match(/^createdDateTime ge (\S+) and createdDateTime lt (\S+)$/);
      expect(probeFilter).not.toBeNull();
      const probeStart: number = new Date(probeFilter![1]!).getTime();
      const probeEnd: number = new Date(probeFilter![2]!).getTime();
      expect(Math.abs(probeEnd - probeStart - DAY_IN_MS)).toBeLessThan(5000);
      expect(probeEnd).toBeGreaterThanOrEqual(before - 1000);

      const week: URL = new URL(pages[2]!.url);
      expect(week.searchParams.get("$top")).toBe(
        String(MICROSOFT_DEFENDER_XDR_DEFAULT_PAGE_SIZE),
      );
      const weekFilter: RegExpMatchArray | null = (
        week.searchParams.get("$filter") || ""
      ).match(/^createdDateTime ge (\S+) and createdDateTime lt (\S+)$/);
      expect(
        Math.abs(
          new Date(weekFilter![2]!).getTime() -
            new Date(weekFilter![1]!).getTime() -
            7 * DAY_IN_MS,
        ),
      ).toBeLessThan(5000);

      expectNoSecrets(checks);
    });

    test("warns, with remediation, when nothing was created in the last 7 days", async () => {
      const harness: Harness = buildHarness({
        alerts: [
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
          requestTimeoutInMs: 20000,
        });

      const availability: SecurityConnectorCheck = checkByKey(
        checks,
        "detections-available",
      );
      expect(availability.status).toBe("warn");
      expect(availability.message).toBe(
        "No alerts were created in the last 7 days. Polling will import new alerts as Microsoft Defender XDR creates them.",
      );
      expect(availability.remediation).toContain("Microsoft Defender portal");
      expect(checkByKey(checks, "read-permission").status).toBe("pass");
    });

    test("fails authentication with remediation and skips the rest when Entra rejects the secret, contacting nothing else", async () => {
      const harness: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          return status(
            401,
            JSON.stringify({
              error: "invalid_client",
              error_description: `AADSTS7000215: Invalid client secret provided. client_secret=${CLIENT_SECRET}`,
              error_codes: [7000215],
            }),
          );
        },
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 20000,
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
        /^Microsoft Defender XDR token request failed \(HTTP 401\): /,
      );
      expect(auth.message).toContain("rejected the client secret");
      expect(auth.remediation).toContain("Certificates & secrets");
      expect(harness.requests).toHaveLength(1);
      expectNoSecrets(checks);
    });

    test("fails the read check with permission remediation on a 403 and skips availability", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return status(
              403,
              graphError(
                "Authorization_RequestDenied",
                "Insufficient privileges to complete the operation.",
              ),
            );
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 20000,
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
        /^Microsoft Defender XDR alerts request failed \(HTTP 403\): /,
      );
      expect(read.message).toContain("Authorization_RequestDenied");
      expect(read.remediation).toContain("SecurityAlert.Read.All");
      expect(read.remediation).toContain("Grant admin consent");
      expect(alertsRequests(harness.requests)).toHaveLength(1);
      expectNoSecrets(checks);
    });

    test("explains a 401 from Graph after a successful token as a cloud mismatch", async () => {
      const denied: Responder = (): DataSourceHttpResponse => {
        return status(
          401,
          graphError("InvalidAuthenticationToken", "Access token is empty."),
        );
      };
      const harness: Harness = buildHarness({ alerts: [denied, denied] });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 20000,
        });

      const read: SecurityConnectorCheck = checkByKey(
        checks,
        "read-permission",
      );
      expect(read.status).toBe("fail");
      expect(read.message).toContain("(HTTP 401)");
      expect(read.remediation).toContain("Cloud setting");
      expectNoSecrets(checks);
    });

    test("fails availability with throttling remediation on a 429 while the read check stays green", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return ok({ value: [] });
          },
          (): DataSourceHttpResponse => {
            return status(
              429,
              graphError("TooManyRequests", "Please retry again later."),
              { "retry-after": "30" },
            );
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 20000,
        });

      expect(checkByKey(checks, "read-permission").status).toBe("pass");
      const availability: SecurityConnectorCheck = checkByKey(
        checks,
        "detections-available",
      );
      expect(availability.status).toBe("fail");
      expect(availability.message).toContain("(HTTP 429)");
      expect(availability.message).toContain("retry after 30 seconds");
      expect(availability.remediation).toContain("Retry-After");
    });

    test("reports a 5xx on the read probe as a failure the docs can key on", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return status(503, "<html>Service Unavailable</html>");
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 20000,
        });

      const read: SecurityConnectorCheck = checkByKey(
        checks,
        "read-permission",
      );
      expect(read.status).toBe("fail");
      expect(read.message).toMatch(
        /^Microsoft Defender XDR alerts request failed \(HTTP 503\): /,
      );
      expect(read.remediation).toBeTruthy();
    });

    test("turns a transport timeout on the read probe into a connectivity remediation", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              "Could not reach data source: timeout of 20000ms exceeded",
            );
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 20000,
        });

      const read: SecurityConnectorCheck = checkByKey(
        checks,
        "read-permission",
      );
      expect(read.status).toBe("fail");
      expect(read.message).toBe(
        "Microsoft Defender XDR alerts request did not complete: Could not reach data source: timeout of 20000ms exceeded",
      );
      expect(read.remediation).toContain("graph.microsoft.com");
    });

    test("reports a non-JSON probe body as a read failure instead of an empty tenant", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return status(200, "<html>ok</html>");
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 20000,
        });

      const read: SecurityConnectorCheck = checkByKey(
        checks,
        "read-permission",
      );
      expect(read.status).toBe("fail");
      expect(read.message).toBe(
        "Microsoft Defender XDR alerts request returned a non-JSON body.",
      );
    });

    test("fails on unusable settings without contacting anything, and never throws", async () => {
      const harness: Harness = buildHarness({});

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(
          settings({ secrets: { clientSecret: "" } }),
          { requestTimeoutInMs: 20000 },
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
        "Client secret",
      );
      expect(checkByKey(checks, "authentication").remediation).toContain(
        "Nothing was contacted",
      );
      expect(harness.requests).toHaveLength(0);
    });

    test("never lets a credential Graph echoes back reach a check", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return status(
              400,
              JSON.stringify({
                error: {
                  code: "BadRequest",
                  message: `Authorization: Bearer ${ACCESS_TOKEN}; client_secret=${CLIENT_SECRET}`,
                },
              }),
            );
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 20000,
        });

      expect(checkByKey(checks, "read-permission").status).toBe("fail");
      expectNoSecrets(checks);
    });
  });

  describe("fetchEvents", () => {
    test("lists alerts created in the half-open window with a bearer token, $top=100 and the caller's timeout, through the injected transport only", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return ok({ value: alerts(2, "a") });
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: WINDOW_START, endTime: WINDOW_END },
        fetchOptions({ requestTimeoutInMs: 4321 }),
      );

      expect(result.complete).toBe(true);
      expect(result.resumeAfter).toBeUndefined();
      expect(result.fetchedCount).toBe(2);
      expect(result.events).toHaveLength(2);
      expect(result.rejectedCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.warnings).toEqual([]);
      // Token plus one page: every outbound request is counted and observed.
      expect(result.requestCount).toBe(2);
      expect(harness.requests).toHaveLength(2);

      const token: DataSourceHttpRequest = harness.requests[0]!;
      expect(token.method).toBe("POST");
      expect(token.url).toBe(
        `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
      );
      expect(token.timeoutInMs).toBe(4321);
      expect(Object.keys(token.body as Dictionary<string>).sort()).toEqual([
        "client_id",
        "client_secret",
        "grant_type",
        "scope",
      ]);

      const page: DataSourceHttpRequest = harness.requests[1]!;
      const url: URL = new URL(page.url);
      expect(page.method).toBe("GET");
      expect(page.timeoutInMs).toBe(4321);
      expect(page.headers?.["Authorization"]).toBe(`Bearer ${ACCESS_TOKEN}`);
      expect(url.origin).toBe("https://graph.microsoft.com");
      expect(url.pathname).toBe("/v1.0/security/alerts_v2");
      expect(Array.from(url.searchParams.keys()).sort()).toEqual([
        "$filter",
        "$top",
      ]);
      expect(url.searchParams.get("$filter")).toBe(
        `createdDateTime ge ${WINDOW_START.toISOString()} and createdDateTime lt ${WINDOW_END.toISOString()}`,
      );
      expect(url.searchParams.get("$top")).toBe(
        String(MICROSOFT_DEFENDER_XDR_DEFAULT_PAGE_SIZE),
      );
    });

    test("uses the Azure Government hosts when the cloud is usgov", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return ok({ value: [] });
          },
        ],
      });

      await harness.connector.fetchEvents(
        settings({
          config: { tenantId: TENANT_ID, clientId: CLIENT_ID, cloud: "usgov" },
        }),
        { startTime: WINDOW_START, endTime: WINDOW_END },
        fetchOptions(),
      );

      expect(new URL(harness.requests[0]!.url).host).toBe(
        "login.microsoftonline.us",
      );
      expect(new URL(harness.requests[1]!.url).host).toBe("graph.microsoft.us");
    });

    test("normalizes every alert and stamps the catalog's vendor and product on each", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return ok({ value: alerts(3, "a") });
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: WINDOW_START, endTime: WINDOW_END },
        fetchOptions(),
      );

      expect(result.events).toHaveLength(3);

      for (const event of result.events) {
        expect(event.vendorName).toBe(DEFINITION.vendorName);
        expect(event.productName).toBe(DEFINITION.productName);
        expect(event.classUid).toBe(2004);
        expect(event.mitreTechniques).toEqual(["T1564.001"]);
        expect(event.principalHost).toBe(
          "yonif-lap3.middleeast.corp.microsoft.com",
        );
      }

      expect(
        result.events.map((event: NormalizedSecurityEvent): string => {
          return event.eventUid;
        }),
      ).toEqual(["a-0", "a-1", "a-2"]);
    });

    test("follows @odata.nextLink to the last page and reports the window complete", async () => {
      const nextLink: string =
        "https://graph.microsoft.com/v1.0/security/alerts_v2?$filter=createdDateTime+ge+x&$top=100&$skiptoken=page2";
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return ok({ value: alerts(2, "p1"), "@odata.nextLink": nextLink });
          },
          (): DataSourceHttpResponse => {
            return ok({ value: alerts(1, "p2") });
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: WINDOW_START, endTime: WINDOW_END },
        fetchOptions(),
      );

      expect(result.complete).toBe(true);
      expect(result.resumeAfter).toBeUndefined();
      expect(result.fetchedCount).toBe(3);
      expect(result.requestCount).toBe(3);
      expect(result.warnings).toEqual([]);
      expect(harness.requests[2]!.url).toBe(nextLink);
      expect(
        result.events.map((event: NormalizedSecurityEvent): string => {
          return event.eventUid;
        }),
      ).toEqual(["p1-0", "p1-1", "p2-0"]);
    });

    /*
     * Review finding connector-bound-hit-permanent-stall: the warning used to
     * promise "the poll cursor is held so the next poll continues from the
     * same window", which re-read the same newest 2,000 alerts forever.
     * Graph's List alerts_v2 reference documents no $orderby and lists the
     * most recent alerts first, so a bounded read covers no "everything
     * created before X" prefix: the connector must NOT set resumeAfter (a
     * resume point would skip the older alerts it never reached), and the
     * poller narrows the next window instead.
     */
    test("stops at the request budget with complete=false, no resume point, and a warning explaining why", async () => {
      const nextLink: string =
        "https://graph.microsoft.com/v1.0/security/alerts_v2?$skiptoken=more";
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            // Newest first, as Graph documents: the second alert is older.
            return ok({
              value: [
                alert("p1-0", { createdDateTime: "2026-09-13T09:00:00Z" }),
                alert("p1-1", { createdDateTime: "2026-09-13T08:00:00Z" }),
              ],
              "@odata.nextLink": nextLink,
            });
          },
          (): DataSourceHttpResponse => {
            return ok({ value: alerts(2, "p2"), "@odata.nextLink": nextLink });
          },
          (): DataSourceHttpResponse => {
            return ok({ value: alerts(2, "p3") });
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: WINDOW_START, endTime: WINDOW_END },
        fetchOptions({ maxRequests: 2 }),
      );

      expect(result.complete).toBe(false);
      expect(result.resumeAfter).toBeUndefined();
      expect(result.fetchedCount).toBe(4);
      expect(result.events).toHaveLength(4);
      expect(alertsRequests(harness.requests)).toHaveLength(2);
      expect(result.requestCount).toBe(3);
      expect(result.warnings).toEqual([
        "Stopped after 2 alerts requests (the per-run request limit) before reading the whole window. Microsoft Graph lists alerts newest first and documents no way to sort them oldest first, so this run cannot name a point to resume from.",
      ]);
      expect(result.warnings[0]).not.toContain("cursor is held");

      // No request asks Graph for an order it does not document.
      for (const request of alertsRequests(harness.requests)) {
        expect(new URL(request.url).searchParams.has("$orderby")).toBe(false);
      }
    });

    test("stops at the record budget mid-page with complete=false and never reads the next page", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return ok({
              value: alerts(5, "p1"),
              "@odata.nextLink":
                "https://graph.microsoft.com/v1.0/security/alerts_v2?$skiptoken=more",
            });
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: WINDOW_START, endTime: WINDOW_END },
        fetchOptions({ maxEvents: 3 }),
      );

      expect(result.complete).toBe(false);
      // Graph's order is not ascending, so a record bound names no resume point either.
      expect(result.resumeAfter).toBeUndefined();
      expect(result.fetchedCount).toBe(3);
      expect(result.events).toHaveLength(3);
      expect(alertsRequests(harness.requests)).toHaveLength(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toBe(
        "Stopped after 3 alerts (the per-run record limit) before reading the whole window. Microsoft Graph lists alerts newest first and documents no way to sort them oldest first, so this run cannot name a point to resume from.",
      );
    });

    test("treats a page that exactly fills the record budget with more pages pending as incomplete", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return ok({
              value: alerts(2, "p1"),
              "@odata.nextLink":
                "https://graph.microsoft.com/v1.0/security/alerts_v2?$skiptoken=more",
            });
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: WINDOW_START, endTime: WINDOW_END },
        fetchOptions({ maxEvents: 2 }),
      );

      expect(result.complete).toBe(false);
      expect(result.resumeAfter).toBeUndefined();
      expect(result.fetchedCount).toBe(2);
      expect(alertsRequests(harness.requests)).toHaveLength(1);
    });

    test("treats a last page that exactly fills the record budget as complete", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return ok({ value: alerts(2, "p1") });
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: WINDOW_START, endTime: WINDOW_END },
        fetchOptions({ maxEvents: 2 }),
      );

      expect(result.complete).toBe(true);
      expect(result.resumeAfter).toBeUndefined();
      expect(result.warnings).toEqual([]);
    });

    test("builds samples from the normalized events, capped at sampleLimit, with creation and activity times", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return ok({ value: alerts(4, "s") });
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: WINDOW_START, endTime: WINDOW_END },
        fetchOptions({ sampleLimit: 2 }),
      );

      expect(result.events).toHaveLength(4);
      expect(result.samples).toHaveLength(2);
      expect(result.samples[0]).toEqual({
        id: "s-0",
        title: "Suspicious execution of hidden file",
        severity: "Low",
        createdTime: "2026-09-12T12:19:27.7211305Z",
        eventTime: new Date("2026-09-12T07:45:50.116Z").toISOString(),
      });
    });

    test("counts unrecognized records as rejected and normalizer throws as failed without aborting the fetch", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return ok({
              value: [
                alert("good"),
                { title: "no id, not an alert" },
                alert("explodes"),
              ],
            });
          },
        ],
      });

      const original: typeof MicrosoftDefenderXdrNormalizer.normalize =
        MicrosoftDefenderXdrNormalizer.normalize.bind(
          MicrosoftDefenderXdrNormalizer,
        );
      jest
        .spyOn(MicrosoftDefenderXdrNormalizer, "normalize")
        .mockImplementation((raw: JSONObject): NormalizedSecurityEvent => {
          if (raw["id"] === "explodes") {
            throw new Error("boom");
          }

          return original(raw);
        });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: WINDOW_START, endTime: WINDOW_END },
        fetchOptions(),
      );

      expect(result.fetchedCount).toBe(3);
      expect(result.events).toHaveLength(1);
      expect(result.rejectedCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.complete).toBe(true);
      expect(result.samples).toHaveLength(1);
    });

    test("rejects unusable settings before any request leaves", async () => {
      const harness: Harness = buildHarness({});

      await expectRejection(
        harness.connector.fetchEvents(
          settings({
            config: {
              tenantId: TENANT_ID,
              clientId: "nope",
              cloud: "public",
            },
          }),
          { startTime: WINDOW_START, endTime: WINDOW_END },
          fetchOptions(),
        ),
        BadDataException,
      );

      expect(harness.requests).toHaveLength(0);
    });

    test("throws the token step's error when Entra rejects the credentials", async () => {
      const harness: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          return status(
            400,
            JSON.stringify({
              error: "unauthorized_client",
              error_description:
                "AADSTS700016: Application with identifier was not found in the directory.",
              error_codes: [700016],
            }),
          );
        },
      });

      const error: APIException = await expectRejection(
        harness.connector.fetchEvents(
          settings(),
          { startTime: WINDOW_START, endTime: WINDOW_END },
          fetchOptions(),
        ),
        APIException,
      );

      expect(error.message).toMatch(
        /^Microsoft Defender XDR token request failed \(HTTP 400\): /,
      );
      expect(error.message).not.toContain(CLIENT_SECRET);
    });

    test.each([
      [401, "InvalidAuthenticationToken", "did not accept the access token"],
      [403, "Authorization_RequestDenied", "SecurityAlert.Read.All"],
      [429, "TooManyRequests", "throttled"],
      [500, "InternalServerError", "server-side error"],
    ])(
      "throws on an HTTP %s from Graph with the alerts prefix and a hint",
      async (code: number, graphCode: string, hint: string) => {
        const failing: Responder = (): DataSourceHttpResponse => {
          return status(code, graphError(graphCode, "nope"));
        };
        // A 401 is retried once with a fresh token before it is fatal.
        const harness: Harness = buildHarness({ alerts: [failing, failing] });

        const error: APIException = await expectRejection(
          harness.connector.fetchEvents(
            settings(),
            { startTime: WINDOW_START, endTime: WINDOW_END },
            fetchOptions(),
          ),
          APIException,
        );

        expect(error.message).toMatch(
          new RegExp(
            `^Microsoft Defender XDR alerts request failed \\(HTTP ${code}\\): `,
          ),
        );
        expect(error.message).toContain(graphCode);
        expect(error.message).toContain(hint);
        expect(error.message).not.toContain(ACCESS_TOKEN);
        expect(error.message).not.toContain(CLIENT_SECRET);
      },
    );

    test("surfaces a transport timeout on a later page with the step named, keeping nothing half-read", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return ok({
              value: alerts(1, "p1"),
              "@odata.nextLink":
                "https://graph.microsoft.com/v1.0/security/alerts_v2?$skiptoken=more",
            });
          },
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              "Could not reach data source: timeout of 60000ms exceeded",
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.connector.fetchEvents(
          settings(),
          { startTime: WINDOW_START, endTime: WINDOW_END },
          fetchOptions(),
        ),
        APIException,
      );

      expect(error.message).toBe(
        "Microsoft Defender XDR alerts request did not complete: Could not reach data source: timeout of 60000ms exceeded",
      );
    });

    test("throws on a non-JSON page body rather than treating it as an empty window", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return status(200, "<html>ok</html>");
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.connector.fetchEvents(
          settings(),
          { startTime: WINDOW_START, endTime: WINDOW_END },
          fetchOptions(),
        ),
        APIException,
      );

      expect(error.message).toBe(
        "Microsoft Defender XDR alerts request returned a non-JSON body.",
      );
    });

    test("refuses a next page link off the Graph host without sending the token there", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return ok({
              value: alerts(1, "p1"),
              "@odata.nextLink":
                "https://evil.example.com/v1.0/security/alerts_v2?$skiptoken=x",
            });
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.connector.fetchEvents(
          settings(),
          { startTime: WINDOW_START, endTime: WINDOW_END },
          fetchOptions(),
        ),
        APIException,
      );

      expect(error.message).toContain("unexpected host");
      expect(alertsRequests(harness.requests)).toHaveLength(1);
    });
  });
});
