import { afterEach, describe, expect, jest, test } from "@jest/globals";
import OktaConnector from "../../../../../../Server/Utils/SecurityEvent/Connectors/Okta/OktaConnector";
import {
  OKTA_DEFAULT_EVENT_FILTER,
  OKTA_MAX_PAGE_SIZE,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Okta/OktaClient";
import {
  ConnectorFetchResult,
  SecurityConnectorSettings,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../../Server/Utils/DataSource/HttpFetch";
import OktaNormalizer from "../../../../../../Utils/SecurityEvent/Connectors/OktaNormalizer";
import APIException from "../../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import Dictionary from "../../../../../../Types/Dictionary";
import { JSONObject } from "../../../../../../Types/JSON";
import { SecurityConnectorCheck } from "../../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import SecurityEventConnectorProvider from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";

/*
 * The Okta connector as the framework calls it: settings validation keyed
 * by the catalog's field titles, the three test checks and their
 * remediation per failure mode, and a published-time fetch that follows
 * the Link header page by page, respects the event and request bounds,
 * marks itself incomplete when a bound stops it, and never leaks the
 * SSWS token.
 */

const ORG_URL: string = "https://acme.okta.com";
const API_TOKEN: string = "00Zx9QkLm3VpR7tWyB2nHc5JdF8gS4aE6uK1oP0iNv";
const START: Date = new Date("2026-09-12T10:00:00.000Z");
const END: Date = new Date("2026-09-13T10:00:00.000Z");
const CUSTOM_FILTER: string = 'eventType sw "user.session"';

type Responder = (
  request: DataSourceHttpRequest,
) => DataSourceHttpResponse | Promise<DataSourceHttpResponse>;

interface Harness {
  requests: Array<DataSourceHttpRequest>;
  connector: OktaConnector;
}

function settings(
  overrides: Partial<SecurityConnectorSettings> = {},
): SecurityConnectorSettings {
  return {
    provider: SecurityEventConnectorProvider.OktaSystemLog,
    config: { orgUrl: ORG_URL, filter: "" },
    secrets: { apiToken: API_TOKEN },
    alertingOnly: false,
    ...overrides,
  };
}

function text(
  code: number,
  body: string,
  headers: Dictionary<string> = {},
): DataSourceHttpResponse {
  let bodyJson: unknown = undefined;

  try {
    bodyJson = JSON.parse(body);
  } catch {
    bodyJson = undefined;
  }

  return { statusCode: code, bodyText: body, bodyJson, headers };
}

function oktaError(
  code: number,
  errorCode: string,
  errorSummary: string,
): DataSourceHttpResponse {
  return text(
    code,
    JSON.stringify({
      errorCode,
      errorSummary,
      errorLink: errorCode,
      errorId: "oaeQ9pJ1bK2SxW3yLm4nO5pQ6",
      errorCauses: [],
    }),
  );
}

function logEvent(
  uuid: string,
  index: number,
  overrides: JSONObject = {},
): JSONObject {
  return {
    uuid,
    published: `2026-09-12T1${index}:15:00.123Z`,
    eventType: "user.session.start",
    version: "0",
    severity: "INFO",
    legacyEventType: "core.user_auth.login_success",
    displayMessage: "User login to Okta",
    actor: {
      id: "00u1abcd2EFGHijkl3m4",
      type: "User",
      alternateId: `user${index}@example.com`,
      displayName: `User ${index}`,
      detailEntry: null,
    },
    client: {
      userAgent: {
        rawUserAgent: "Mozilla/5.0",
        os: "Mac OS X",
        browser: "CHROME",
      },
      zone: "null",
      device: "Computer",
      id: null,
      ipAddress: `203.0.113.${index}`,
      geographicalContext: null,
    },
    device: null,
    outcome: { result: "SUCCESS", reason: null },
    target: null,
    transaction: { type: "WEB", id: `tx-${index}`, detail: {} },
    debugContext: { debugData: { requestUri: "/idp/idx/identify" } },
    authenticationContext: {
      credentialType: "PASSWORD",
      authenticationStep: 0,
    },
    securityContext: { asNumber: 64496, isProxy: false },
    request: { ipChain: [{ ip: `203.0.113.${index}`, version: "V4" }] },
    ...overrides,
  };
}

function nextLink(after: string): string {
  return `${ORG_URL}/api/v1/logs?since=${encodeURIComponent(
    START.toISOString(),
  )}&until=${encodeURIComponent(
    END.toISOString(),
  )}&sortOrder=ASCENDING&limit=1000&after=${after}`;
}

function page(
  events: Array<JSONObject>,
  nextUrl: string | null = null,
): DataSourceHttpResponse {
  const self: string = `<${ORG_URL}/api/v1/logs?limit=1000>; rel="self"`;

  return text(200, JSON.stringify(events), {
    link: nextUrl ? `${self}, <${nextUrl}>; rel="next"` : self,
  });
}

function isProbe(request: DataSourceHttpRequest): boolean {
  const url: URL = new URL(request.url);
  return !url.searchParams.has("since") && !url.searchParams.has("after");
}

/*
 * The probe (limit=1, no bounds) has its own responder; every bounded
 * request — the one-event read, the two counts, the fetch pages — is
 * served from the queue in order.
 */
function buildHarness(options: {
  probe?: Responder;
  responders?: Array<Responder>;
}): Harness {
  const requests: Array<DataSourceHttpRequest> = [];
  const responders: Array<Responder> = [...(options.responders || [])];

  const connector: OktaConnector = new OktaConnector(
    async (request: DataSourceHttpRequest): Promise<DataSourceHttpResponse> => {
      requests.push(request);

      if (isProbe(request)) {
        return (
          options.probe ||
          ((): DataSourceHttpResponse => {
            return page([logEvent("probe-1", 0)]);
          })
        )(request);
      }

      const responder: Responder | undefined = responders.shift();

      if (!responder) {
        throw new Error(`Unexpected request to ${request.url}`);
      }

      return responder(request);
    },
  );

  return { requests, connector };
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

function statuses(checks: Array<SecurityConnectorCheck>): Array<string> {
  return checks.map((check: SecurityConnectorCheck): string => {
    return `${check.key}:${check.status}`;
  });
}

function sortedParamKeys(url: string): Array<string> {
  return Array.from(new URL(url).searchParams.keys()).sort();
}

function param(request: DataSourceHttpRequest, key: string): string | null {
  return new URL(request.url).searchParams.get(key);
}

function fetchOptions(
  overrides: Partial<{
    maxRequests: number;
    maxEvents: number;
    requestTimeoutInMs: number;
    sampleLimit: number;
  }> = {},
): {
  maxRequests: number;
  maxEvents: number;
  requestTimeoutInMs: number;
  sampleLimit: number;
} {
  return {
    maxRequests: 20,
    maxEvents: 100,
    requestTimeoutInMs: 30000,
    sampleLimit: 5,
    ...overrides,
  };
}

describe("OktaConnector", () => {
  const definition: SecurityEventConnectorDefinition =
    getSecurityEventConnectorDefinition(
      SecurityEventConnectorProvider.OktaSystemLog,
    )!;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("registers under the catalog's provider key", () => {
    expect(new OktaConnector().provider).toBe("okta");
    expect(definition.provider).toBe(new OktaConnector().provider);
  });

  describe("validateSettings", () => {
    test("accepts an org URL with a trailing slash, preview and EMEA cells, and an empty filter", () => {
      const connector: OktaConnector = new OktaConnector();

      for (const orgUrl of [
        ORG_URL,
        "https://acme.okta.com/",
        "https://acme.oktapreview.com",
        "https://acme.okta-emea.com",
        "https://login.example.com",
      ]) {
        expect(() => {
          return connector.validateSettings(settings({ config: { orgUrl } }));
        }).not.toThrow();
      }

      expect(() => {
        return connector.validateSettings(
          settings({ config: { orgUrl: ORG_URL, filter: CUSTOM_FILTER } }),
        );
      }).not.toThrow();
    });

    test("names the catalog field titles in every rejection", () => {
      const connector: OktaConnector = new OktaConnector();

      expect(() => {
        return connector.validateSettings(settings({ config: {} }));
      }).toThrow("Okta organization URL is required.");

      expect(() => {
        return connector.validateSettings(
          settings({ config: { orgUrl: "acme okta" } }),
        );
      }).toThrow(/^Okta organization URL must be an absolute URL/);

      expect(() => {
        return connector.validateSettings(
          settings({ config: { orgUrl: "http://acme.okta.com" } }),
        );
      }).toThrow("Okta organization URL must use https.");

      expect(() => {
        return connector.validateSettings(
          settings({ config: { orgUrl: "https://acme.okta.com/?x=1" } }),
        );
      }).toThrow(/^Okta organization URL must not contain a query string/);

      expect(() => {
        return connector.validateSettings(
          settings({ config: { orgUrl: "https://acme.okta.com/api/v1/logs" } }),
        );
      }).toThrow(
        /^Okta organization URL must be the org's base URL without a path/,
      );

      expect(() => {
        return connector.validateSettings(
          settings({ config: { orgUrl: "https://acme-admin.okta.com" } }),
        );
      }).toThrow(/not the Admin Console's -admin URL/);

      expect(() => {
        return connector.validateSettings(
          settings({
            config: { orgUrl: ORG_URL, filter: "x".repeat(2001) },
          }),
        );
      }).toThrow("Event filter must be at most 2000 characters.");

      expect(() => {
        return connector.validateSettings(
          settings({
            config: {
              orgUrl: ORG_URL,
              filter: 'eventType eq "a"\nor eventType eq "b"',
            },
          }),
        );
      }).toThrow("Event filter must be a single-line filter expression.");

      expect(() => {
        return connector.validateSettings(
          settings({
            config: {
              orgUrl: ORG_URL,
              filter: 'published gt "2026-01-01T00:00:00.000Z"',
            },
          }),
        );
      }).toThrow(/^Event filter must not filter on the published attribute/);

      expect(() => {
        return connector.validateSettings(settings({ secrets: {} }));
      }).toThrow("API token is required.");

      expect(() => {
        return connector.validateSettings(
          settings({ secrets: { apiToken: `SSWS ${API_TOKEN}` } }),
        );
      }).toThrow("API token must be pasted without the 'SSWS' prefix.");

      expect(() => {
        return connector.validateSettings(
          settings({ secrets: { apiToken: "00abc def" } }),
        );
      }).toThrow("API token must be the token value alone, without spaces.");
    });

    test("throws BadDataException and never quotes the token", () => {
      const connector: OktaConnector = new OktaConnector();

      for (const bad of [
        settings({ config: {} }),
        settings({ secrets: { apiToken: `SSWS ${API_TOKEN}` } }),
        settings({ secrets: { apiToken: `${API_TOKEN} extra` } }),
      ]) {
        let thrown: unknown = undefined;

        try {
          connector.validateSettings(bad);
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(BadDataException);
        expect((thrown as Error).message).not.toContain(API_TOKEN);
      }
    });

    test("accepts a filter that mentions published as part of another attribute", () => {
      expect(() => {
        return new OktaConnector().validateSettings(
          settings({
            config: { orgUrl: ORG_URL, filter: 'target.published_by eq "x"' },
          }),
        );
      }).not.toThrow();
    });
  });

  describe("effectiveFilter", () => {
    test("uses the default event families when the tenant set no filter", () => {
      expect(OktaConnector.effectiveFilter("")).toBe(OKTA_DEFAULT_EVENT_FILTER);
      expect(OktaConnector.effectiveFilter("   ")).toBe(
        OKTA_DEFAULT_EVENT_FILTER,
      );
      expect(OktaConnector.effectiveFilter(` ${CUSTOM_FILTER} `)).toBe(
        CUSTOM_FILTER,
      );
    });
  });

  describe("testConnection", () => {
    test("passes all three checks and reports the event type, the filter in use and bounded counts", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page([logEvent("A1", 0)], nextLink("cursor-1"));
          },
          (): DataSourceHttpResponse => {
            return page([
              logEvent("A1", 0),
              logEvent("B2", 1),
              logEvent("C3", 2),
            ]);
          },
          (): DataSourceHttpResponse => {
            return page([logEvent("A1", 0), logEvent("B2", 1)], nextLink("c"));
          },
        ],
      });

      const before: number = Date.now();
      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 15000,
        });

      expect(statuses(checks)).toEqual([
        "authentication:pass",
        "read-permission:pass",
        "detections-available:pass",
      ]);

      const authentication: SecurityConnectorCheck = checkByKey(
        checks,
        "authentication",
      );
      expect(authentication.name).toBe("Authenticate with Okta");
      expect(authentication.message).toBe(
        "Okta at acme.okta.com accepted the API token for the System Log.",
      );
      expect(authentication.details).toEqual({ probeReturnedEvents: 1 });

      const read: SecurityConnectorCheck = checkByKey(
        checks,
        "read-permission",
      );
      expect(read.name).toBe("Read System Log events");
      expect(read.message).toContain("through the default event filter");
      expect(read.message).toContain('returned a "user.session.start" event');
      expect(read.details).toEqual({ usingDefaultFilter: true });

      const available: SecurityConnectorCheck = checkByKey(
        checks,
        "detections-available",
      );
      expect(available.name).toBe("Events available to import");
      expect(available.message).toBe(
        "3 events published in the last 24 hours and 2+ in the last 7 days.",
      );
      expect(available.remediation).toBeUndefined();
      expect(available.details).toEqual({
        createdLast24h: 3,
        createdLast7d: 2,
        hasMoreLast24h: false,
        hasMoreLast7d: true,
        usingDefaultFilter: true,
      });

      // One probe, a one-event read, then two one-page counts.
      expect(harness.requests).toHaveLength(4);

      const probe: DataSourceHttpRequest = harness.requests[0]!;
      expect(new URL(probe.url).pathname).toBe("/api/v1/logs");
      expect(sortedParamKeys(probe.url)).toEqual(["limit"]);
      expect(param(probe, "limit")).toBe("1");

      const readRequest: DataSourceHttpRequest = harness.requests[1]!;
      expect(sortedParamKeys(readRequest.url)).toEqual([
        "filter",
        "limit",
        "since",
        "sortOrder",
        "until",
      ]);
      expect(param(readRequest, "limit")).toBe("1");
      expect(param(readRequest, "sortOrder")).toBe("ASCENDING");
      expect(param(readRequest, "filter")).toBe(OKTA_DEFAULT_EVENT_FILTER);

      const readSince: number = new Date(
        param(readRequest, "since")!,
      ).getTime();
      const readUntil: number = new Date(
        param(readRequest, "until")!,
      ).getTime();
      expect(readUntil - readSince).toBe(24 * 60 * 60 * 1000);
      expect(readUntil).toBeGreaterThanOrEqual(before);
      expect(readUntil).toBeLessThanOrEqual(Date.now());

      const count24h: DataSourceHttpRequest = harness.requests[2]!;
      const count7d: DataSourceHttpRequest = harness.requests[3]!;
      expect(param(count24h, "limit")).toBe(String(OKTA_MAX_PAGE_SIZE));
      expect(param(count7d, "limit")).toBe(String(OKTA_MAX_PAGE_SIZE));
      expect(
        new Date(param(count7d, "until")!).getTime() -
          new Date(param(count7d, "since")!).getTime(),
      ).toBe(7 * 24 * 60 * 60 * 1000);
      expect(param(count7d, "filter")).toBe(OKTA_DEFAULT_EVENT_FILTER);

      for (const request of harness.requests) {
        expect(request.method).toBe("GET");
        expect(request.headers?.["Authorization"]).toBe(`SSWS ${API_TOKEN}`);
        expect(request.timeoutInMs).toBe(15000);
      }

      for (const check of checks) {
        expect(JSON.stringify(check)).not.toContain(API_TOKEN);
      }
    });

    test("uses the tenant's Event filter for the read and the counts and says so", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page([]);
          },
          (): DataSourceHttpResponse => {
            return page([logEvent("A1", 0)]);
          },
          (): DataSourceHttpResponse => {
            return page([logEvent("A1", 0)]);
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(
          settings({ config: { orgUrl: ORG_URL, filter: CUSTOM_FILTER } }),
          { requestTimeoutInMs: 1000 },
        );

      const read: SecurityConnectorCheck = checkByKey(
        checks,
        "read-permission",
      );
      expect(read.status).toBe("pass");
      expect(read.message).toBe(
        "The System Log is readable through the connection's Event filter. No matching event was published in the last 24 hours.",
      );
      expect(read.details).toEqual({ usingDefaultFilter: false });

      const available: SecurityConnectorCheck = checkByKey(
        checks,
        "detections-available",
      );
      expect(available.message).toBe(
        "1 event published in the last 24 hours and 1 in the last 7 days.",
      );

      for (const request of harness.requests.slice(1)) {
        expect(param(request, "filter")).toBe(CUSTOM_FILTER);
      }
    });

    test("warns instead of passing when nothing was published in the last 7 days", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page([]);
          },
          (): DataSourceHttpResponse => {
            return page([]);
          },
          (): DataSourceHttpResponse => {
            return page([]);
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(statuses(checks)).toEqual([
        "authentication:pass",
        "read-permission:pass",
        "detections-available:warn",
      ]);

      const available: SecurityConnectorCheck = checkByKey(
        checks,
        "detections-available",
      );
      expect(available.message).toContain(
        "No matching events were published in the last 7 days",
      );
      expect(available.remediation).toContain(
        "Check the Okta organization URL",
      );
      expect(available.details).toEqual({
        createdLast24h: 0,
        createdLast7d: 0,
        hasMoreLast24h: false,
        hasMoreLast7d: false,
        usingDefaultFilter: true,
      });
    });

    test("blames the Event filter when a custom filter matched nothing in 7 days", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page([]);
          },
          (): DataSourceHttpResponse => {
            return page([]);
          },
          (): DataSourceHttpResponse => {
            return page([]);
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(
          settings({ config: { orgUrl: ORG_URL, filter: CUSTOM_FILTER } }),
          { requestTimeoutInMs: 1000 },
        );

      const available: SecurityConnectorCheck = checkByKey(
        checks,
        "detections-available",
      );
      expect(available.status).toBe("warn");
      expect(available.remediation).toContain(
        "The connection's Event filter matched nothing",
      );
    });

    test("fails authentication on an invalid setting without contacting Okta", async () => {
      const harness: Harness = buildHarness({});

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings({ secrets: {} }), {
          requestTimeoutInMs: 1000,
        });

      expect(statuses(checks)).toEqual([
        "authentication:fail",
        "read-permission:skip",
        "detections-available:skip",
      ]);
      expect(checks[0]!.message).toBe("API token is required.");
      expect(checks[0]!.remediation).toContain("Nothing was contacted");
      expect(checks[1]!.message).toContain("configuration is invalid");
      expect(harness.requests).toHaveLength(0);
    });

    test("fails authentication on a 401, skips the rest, and points at Security > API > Tokens", async () => {
      const harness: Harness = buildHarness({
        probe: (): DataSourceHttpResponse => {
          return oktaError(
            401,
            "E0000011",
            `Invalid token provided: SSWS ${API_TOKEN}`,
          );
        },
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(statuses(checks)).toEqual([
        "authentication:fail",
        "read-permission:skip",
        "detections-available:skip",
      ]);
      expect(checks[0]!.message).toMatch(
        /^Okta System Log events request failed \(HTTP 401\): /,
      );
      expect(checks[0]!.message).toContain("Invalid token provided");
      expect(checks[0]!.message).not.toContain(API_TOKEN);
      expect(checks[0]!.remediation).toContain("Security > API > Tokens");
      expect(checks[0]!.remediation).toContain("Update credentials");
      expect(checks[1]!.message).toContain("authentication did not succeed");
      expect(harness.requests).toHaveLength(1);
    });

    test("fails authentication on a 403 with the admin role remediation", async () => {
      const harness: Harness = buildHarness({
        probe: (): DataSourceHttpResponse => {
          return oktaError(
            403,
            "E0000006",
            "You do not have permission to perform the requested action",
          );
        },
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(checks[0]!.status).toBe("fail");
      expect(checks[0]!.message).toMatch(/\(HTTP 403\)/);
      expect(checks[0]!.remediation).toContain("Read-only Administrator");
      expect(checks[0]!.remediation).toContain("network zone");
    });

    test("fails authentication on a 404 with the org URL remediation", async () => {
      const harness: Harness = buildHarness({
        probe: (): DataSourceHttpResponse => {
          return oktaError(404, "E0000007", "Not found: Resource not found");
        },
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(checks[0]!.status).toBe("fail");
      expect(checks[0]!.remediation).toContain(
        "Check the Okta organization URL",
      );
      expect(checks[0]!.remediation).toContain("-admin");
    });

    test("fails authentication on a 400 from the probe with the URL remediation", async () => {
      const harness: Harness = buildHarness({
        probe: (): DataSourceHttpResponse => {
          return oktaError(
            400,
            "E0000003",
            "The request body was not well-formed.",
          );
        },
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(checks[0]!.status).toBe("fail");
      expect(checks[0]!.remediation).toContain(
        "Okta rejected the probe request",
      );
    });

    test("fails authentication with the connectivity hint on a timeout", async () => {
      const harness: Harness = buildHarness({
        probe: (): DataSourceHttpResponse => {
          throw new BadDataException(
            "Could not reach data source: timeout of 1000ms exceeded",
          );
        },
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(statuses(checks)).toEqual([
        "authentication:fail",
        "read-permission:skip",
        "detections-available:skip",
      ]);
      expect(checks[0]!.message).toBe(
        "Okta System Log events request did not complete: Could not reach data source: timeout of 1000ms exceeded",
      );
      expect(checks[0]!.remediation).toContain(
        "reachable from the OneUptime API and worker processes",
      );
    });

    test("fails authentication when the URL answers HTML instead of JSON", async () => {
      const harness: Harness = buildHarness({
        probe: (): DataSourceHttpResponse => {
          return text(
            200,
            "<!DOCTYPE html><html><head><title>Sign In</title></head></html>",
          );
        },
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(checks[0]!.status).toBe("fail");
      expect(checks[0]!.message).toBe(
        "Okta System Log events request returned a non-JSON body.",
      );
      expect(checks[0]!.remediation).toContain("not behind a proxy");
    });

    test("fails read-permission on a 403 with the role remediation and skips availability", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return oktaError(
              403,
              "E0000006",
              "You do not have permission to perform the requested action",
            );
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(statuses(checks)).toEqual([
        "authentication:pass",
        "read-permission:fail",
        "detections-available:skip",
      ]);
      const read: SecurityConnectorCheck = checkByKey(
        checks,
        "read-permission",
      );
      expect(read.message).toMatch(
        /^Okta System Log events request failed \(HTTP 403\): /,
      );
      expect(read.remediation).toContain("Read-only Administrator");
      expect(checks[2]!.message).toContain("could not be read");
      expect(harness.requests).toHaveLength(2);
    });

    test("fails read-permission on a 400 with the Event filter remediation", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return oktaError(
              400,
              "E0000053",
              "Invalid filter expression: unknown attribute 'evenType'",
            );
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(
          settings({
            config: { orgUrl: ORG_URL, filter: 'evenType sw "user."' },
          }),
          { requestTimeoutInMs: 1000 },
        );

      const read: SecurityConnectorCheck = checkByKey(
        checks,
        "read-permission",
      );
      expect(read.status).toBe("fail");
      expect(read.message).toContain("unknown attribute 'evenType'");
      expect(read.remediation).toContain(
        "Event filter is not a valid System Log filter expression",
      );
    });

    test("fails read-permission with the filter hint when the filtered read times out after a good probe", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              "Could not reach data source: timeout of 1000ms exceeded",
            );
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      const read: SecurityConnectorCheck = checkByKey(
        checks,
        "read-permission",
      );
      expect(read.status).toBe("fail");
      expect(read.remediation).toContain("simplify the Event filter");
    });

    test("fails detections-available on a 429 with the rate limit remediation", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page([logEvent("A1", 0)]);
          },
          (): DataSourceHttpResponse => {
            return oktaError(
              429,
              "E0000047",
              "API call exceeded rate limit. Consult docs.",
            );
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(statuses(checks)).toEqual([
        "authentication:pass",
        "read-permission:pass",
        "detections-available:fail",
      ]);
      const available: SecurityConnectorCheck = checkByKey(
        checks,
        "detections-available",
      );
      expect(available.message).toMatch(
        /^Okta System Log events request failed \(HTTP 429\): /,
      );
      expect(available.remediation).toContain("rate limiting this token");
      expect(harness.requests).toHaveLength(3);
    });

    test("fails detections-available on a 500 with the Okta status remediation", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page([logEvent("A1", 0)]);
          },
          (): DataSourceHttpResponse => {
            return page([logEvent("A1", 0)]);
          },
          (): DataSourceHttpResponse => {
            return oktaError(500, "E0000009", "Internal Server Error");
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      const available: SecurityConnectorCheck = checkByKey(
        checks,
        "detections-available",
      );
      expect(available.status).toBe("fail");
      expect(available.message).toMatch(/\(HTTP 500\)/);
      expect(available.remediation).toContain("status.okta.com");
    });

    test("describes an unrecognized first record without failing the read", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page([{ foo: "bar" }]);
          },
          (): DataSourceHttpResponse => {
            return page([]);
          },
          (): DataSourceHttpResponse => {
            return page([]);
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      const read: SecurityConnectorCheck = checkByKey(
        checks,
        "read-permission",
      );
      expect(read.status).toBe("pass");
      expect(read.message).toContain('returned a "unrecognized record" event');
    });
  });

  describe("fetchEvents", () => {
    test("reads the window by published time, normalizes with the catalog's vendor and product, and builds samples", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page([
              logEvent("A1", 0),
              logEvent("B2", 1, {
                eventType: "user.account.update_password",
                displayMessage: "User update password for Okta",
                target: [
                  {
                    id: "00u9",
                    type: "User",
                    alternateId: "bob@example.com",
                    displayName: "Bob",
                  },
                ],
              }),
              logEvent("C3", 2, {
                eventType: "security.threat.detected",
                severity: "WARN",
                displayMessage: "Threat detected",
              }),
            ]);
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ sampleLimit: 2 }),
      );

      expect(result.complete).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(result.requestCount).toBe(1);
      expect(result.fetchedCount).toBe(3);
      expect(result.rejectedCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.events).toHaveLength(3);

      for (const event of result.events) {
        expect(event.vendorName).toBe(definition.vendorName);
        expect(event.productName).toBe(definition.productName);
      }

      expect(
        result.events.map((event: { eventUid: string }): string => {
          return event.eventUid;
        }),
      ).toEqual(["A1", "B2", "C3"]);
      expect(
        result.events.map((event: { classUid: number }): number => {
          return event.classUid;
        }),
      ).toEqual([3002, 3001, 2004]);
      expect(result.events[1]!.targetUser).toBe("bob@example.com");

      expect(result.samples).toHaveLength(2);
      expect(result.samples[0]).toEqual({
        id: "A1",
        title: "User login to Okta",
        severity: "Informational",
        createdTime: "2026-09-12T10:15:00.123Z",
        eventTime: "2026-09-12T10:15:00.123Z",
      });
      expect(result.samples[1]!.id).toBe("B2");

      const request: DataSourceHttpRequest = harness.requests[0]!;
      const url: URL = new URL(request.url);
      expect(request.method).toBe("GET");
      expect(url.origin).toBe(ORG_URL);
      expect(url.pathname).toBe("/api/v1/logs");
      expect(sortedParamKeys(request.url)).toEqual([
        "filter",
        "limit",
        "since",
        "sortOrder",
        "until",
      ]);
      expect(url.searchParams.get("since")).toBe(START.toISOString());
      expect(url.searchParams.get("until")).toBe(END.toISOString());
      expect(url.searchParams.get("sortOrder")).toBe("ASCENDING");
      expect(url.searchParams.get("limit")).toBe("100");
      expect(url.searchParams.get("filter")).toBe(OKTA_DEFAULT_EVENT_FILTER);
      expect(request.headers?.["Authorization"]).toBe(`SSWS ${API_TOKEN}`);
      expect(request.timeoutInMs).toBe(30000);
    });

    test('follows the Link rel="next" header until an empty page and drops events re-sent across pages', async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page([logEvent("A1", 0), logEvent("B2", 1)], nextLink("p1"));
          },
          (): DataSourceHttpResponse => {
            return page([logEvent("B2", 1), logEvent("C3", 2)], nextLink("p2"));
          },
          (): DataSourceHttpResponse => {
            return page([], nextLink("p3"));
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions(),
      );

      expect(result.complete).toBe(true);
      expect(result.requestCount).toBe(3);
      expect(result.fetchedCount).toBe(3);
      expect(
        result.events.map((event: { eventUid: string }): string => {
          return event.eventUid;
        }),
      ).toEqual(["A1", "B2", "C3"]);
      expect(harness.requests).toHaveLength(3);
      expect(harness.requests[1]!.url).toBe(nextLink("p1"));
      expect(harness.requests[2]!.url).toBe(nextLink("p2"));
      expect(harness.requests[1]!.headers).toEqual(
        harness.requests[0]!.headers,
      );
    });

    test("stops at the last page when Okta sends no next link", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page([logEvent("A1", 0)], nextLink("p1"));
          },
          (): DataSourceHttpResponse => {
            return page([logEvent("B2", 1)]);
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions(),
      );

      expect(result.complete).toBe(true);
      expect(result.requestCount).toBe(2);
      expect(result.events).toHaveLength(2);
      expect(harness.requests).toHaveLength(2);
    });

    test("sends the tenant's Event filter and clamps the page size to Okta's maximum", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page([]);
          },
        ],
      });

      await harness.connector.fetchEvents(
        settings({ config: { orgUrl: ORG_URL, filter: CUSTOM_FILTER } }),
        { startTime: START, endTime: END },
        fetchOptions({ maxEvents: 10000 }),
      );

      expect(param(harness.requests[0]!, "filter")).toBe(CUSTOM_FILTER);
      expect(param(harness.requests[0]!, "limit")).toBe("1000");
    });

    test("stops at the request bound, marks the fetch incomplete and warns so the cursor is held", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page([logEvent("A1", 0)], nextLink("p1"));
          },
          (): DataSourceHttpResponse => {
            return page([logEvent("B2", 1)], nextLink("p2"));
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ maxRequests: 2 }),
      );

      expect(result.complete).toBe(false);
      expect(result.requestCount).toBe(2);
      expect(result.events).toHaveLength(2);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("Stopped after 2 requests");
      expect(result.warnings[0]).toContain(START.toISOString());
      expect(result.warnings[0]).toContain("cursor is held");
      expect(harness.requests).toHaveLength(2);
    });

    test("refuses to read with a zero request budget and reports it instead of exceeding it", async () => {
      const harness: Harness = buildHarness({});

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ maxRequests: 0 }),
      );

      expect(result.complete).toBe(false);
      expect(result.requestCount).toBe(0);
      expect(result.events).toEqual([]);
      expect(result.warnings[0]).toContain("Stopped after 0 requests");
      expect(harness.requests).toHaveLength(0);
    });

    test("stops at the event bound, marks the fetch incomplete and warns so the cursor is held", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page(
              [logEvent("A1", 0), logEvent("B2", 1), logEvent("C3", 2)],
              nextLink("p1"),
            );
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ maxEvents: 2 }),
      );

      expect(result.complete).toBe(false);
      expect(result.events).toHaveLength(2);
      expect(result.fetchedCount).toBe(2);
      expect(result.requestCount).toBe(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("Stopped after collecting 2 events");
      expect(result.warnings[0]).toContain("cursor is held");
      expect(param(harness.requests[0]!, "limit")).toBe("2");
      // The next link was not followed once the bound was hit.
      expect(harness.requests).toHaveLength(1);
    });

    test("counts records the normalizer does not recognize as rejected", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page([
              logEvent("A1", 0),
              { errorCode: "E0000011", errorSummary: "Invalid token provided" },
              { uuid: "no-type", published: "2026-09-12T10:15:00.123Z" },
            ]);
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions(),
      );

      expect(result.fetchedCount).toBe(3);
      expect(result.rejectedCount).toBe(2);
      expect(result.failedCount).toBe(0);
      expect(result.events).toHaveLength(1);
      expect(result.warnings).toEqual([]);
    });

    test("counts a record that throws during normalization as failed and warns with the error redacted", async () => {
      /*
       * The normalizer only ever sees the event, never the token, so the
       * quoted error is run through the generic credential redaction
       * (header dumps, bearer tokens) rather than the client's literal
       * token scrub.
       */
      jest
        .spyOn(OktaNormalizer, "normalize")
        .mockImplementationOnce((): never => {
          throw new Error(
            "boom while reading Authorization: Bearer abcdefghij0123456789",
          );
        });

      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page([logEvent("A1", 0), logEvent("B2", 1)]);
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions(),
      );

      expect(result.fetchedCount).toBe(2);
      expect(result.failedCount).toBe(1);
      expect(result.events).toHaveLength(1);
      expect(result.complete).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/^Event A1 could not be normalized: /);
      expect(result.warnings[0]).toContain("boom while reading");
      expect(result.warnings[0]).not.toContain("abcdefghij0123456789");
      expect(result.warnings[0]).toContain("[REDACTED]");
    });

    test("keys events without a uuid by content so an identical copy on a later page is not stored twice", async () => {
      const noId: JSONObject = logEvent("", 0);
      delete noId["uuid"];

      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page([noId], nextLink("p1"));
          },
          (): DataSourceHttpResponse => {
            return page([{ ...noId }]);
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions(),
      );

      expect(result.fetchedCount).toBe(1);
      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.eventUid).toMatch(/^sha256:/);
    });

    test("throws with the step prefix for authentication, permission, throttling and server failures", async () => {
      for (const status of [401, 403, 429, 500]) {
        const harness: Harness = buildHarness({
          responders: [
            (): DataSourceHttpResponse => {
              return oktaError(
                status,
                "E0000000",
                `rejected Authorization: SSWS ${API_TOKEN}`,
              );
            },
          ],
        });

        let thrown: unknown = undefined;

        try {
          await harness.connector.fetchEvents(
            settings(),
            { startTime: START, endTime: END },
            fetchOptions(),
          );
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(APIException);
        expect((thrown as APIException).message).toMatch(
          new RegExp(
            `^Okta System Log events request failed \\(HTTP ${status}\\): `,
          ),
        );
        expect((thrown as APIException).message).not.toContain(API_TOKEN);
      }
    });

    test("throws with the step prefix when the transport times out", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              "Could not reach data source: timeout of 30000ms exceeded",
            );
          },
        ],
      });

      await expect(
        harness.connector.fetchEvents(
          settings(),
          { startTime: START, endTime: END },
          fetchOptions(),
        ),
      ).rejects.toThrow(
        "Okta System Log events request did not complete: Could not reach data source: timeout of 30000ms exceeded",
      );
    });

    test("throws when a 200 body is not a JSON array rather than advancing past it", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return text(200, "<html>Sign in</html>");
          },
        ],
      });

      await expect(
        harness.connector.fetchEvents(
          settings(),
          { startTime: START, endTime: END },
          fetchOptions(),
        ),
      ).rejects.toThrow(
        "Okta System Log events request returned a non-JSON body.",
      );
    });

    test("throws and stops when the next link points outside the org", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page(
              [logEvent("A1", 0)],
              "https://evil.example.net/api/v1/logs?after=1",
            );
          },
        ],
      });

      await expect(
        harness.connector.fetchEvents(
          settings(),
          { startTime: START, endTime: END },
          fetchOptions(),
        ),
      ).rejects.toThrow(
        "Okta System Log events request returned a next link outside the Okta organization URL (evil.example.net); it was not followed.",
      );
      expect(harness.requests).toHaveLength(1);
    });

    test("throws a BadDataException for invalid settings before any request", async () => {
      const harness: Harness = buildHarness({});

      await expect(
        harness.connector.fetchEvents(
          settings({ secrets: {} }),
          { startTime: START, endTime: END },
          fetchOptions(),
        ),
      ).rejects.toBeInstanceOf(BadDataException);
      expect(harness.requests).toHaveLength(0);
    });
  });
});
