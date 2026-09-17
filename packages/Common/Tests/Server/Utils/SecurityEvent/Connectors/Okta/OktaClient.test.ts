import { describe, expect, test } from "@jest/globals";
import OktaClient, {
  OKTA_DEFAULT_EVENT_FILTER,
  OKTA_LOGS_STEP,
  OKTA_MAX_PAGE_SIZE,
  OktaClientOptions,
  OktaHttpError,
  OktaLogEventCount,
  OktaLogEventsPage,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Okta/OktaClient";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../../Server/Utils/DataSource/HttpFetch";
import APIException from "../../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import Dictionary from "../../../../../../Types/Dictionary";
import { JSONObject } from "../../../../../../Types/JSON";

/*
 * The Okta client contract as the connector depends on it: the bounded
 * System Log request (since/until/sortOrder/limit/filter), the one-event
 * probe, Link-header pagination that is followed verbatim but never off
 * the configured org, the one-page count, the failure taxonomy per HTTP
 * status, and — above everything — that the SSWS token can never leave
 * through an error message. The transport is the injected seam; nothing
 * here touches the network.
 */

const ORG_URL: string = "https://acme.okta.com";
// Okta API tokens are 42 characters and start with "00".
const API_TOKEN: string = "00Zx9QkLm3VpR7tWyB2nHc5JdF8gS4aE6uK1oP0iNv";
const START: Date = new Date("2026-09-12T10:00:00.250Z");
const END: Date = new Date("2026-09-13T10:00:00.750Z");

type Responder = (
  request: DataSourceHttpRequest,
) => DataSourceHttpResponse | Promise<DataSourceHttpResponse>;

interface Harness {
  requests: Array<DataSourceHttpRequest>;
  client: OktaClient;
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

/*
 * Okta's error envelope, as GET /api/v1/logs returns it on every non-2xx.
 */
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

/*
 * Shaped like one LogEvent of the System Log API.
 */
function logEvent(
  uuid: string,
  eventType: string = "user.session.start",
  published: string = "2026-09-12T10:15:00.123Z",
): JSONObject {
  return {
    uuid,
    published,
    eventType,
    version: "0",
    severity: "INFO",
    legacyEventType: "core.user_auth.login_success",
    displayMessage: "User login to Okta",
    actor: {
      id: "00u1abcd2EFGHijkl3m4",
      type: "User",
      alternateId: "alice@example.com",
      displayName: "Alice Example",
      detailEntry: null,
    },
    client: {
      userAgent: {
        rawUserAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0 Safari/537.36",
        os: "Mac OS X",
        browser: "CHROME",
      },
      zone: "null",
      device: "Computer",
      id: null,
      ipAddress: "203.0.113.42",
      geographicalContext: {
        city: "Seattle",
        state: "Washington",
        country: "United States",
        postalCode: "98101",
        geolocation: { lat: 47.6062, lon: -122.3321 },
      },
    },
    device: null,
    outcome: { result: "SUCCESS", reason: null },
    target: null,
    transaction: { type: "WEB", id: "Zq1WvX8yTk3LmN4oP5rS6A", detail: {} },
    debugContext: {
      debugData: {
        requestId: "Zq1WvX8yTk3LmN4oP5rS6A",
        requestUri: "/idp/idx/identify",
        threatSuspected: "false",
        url: "/idp/idx/identify?",
      },
    },
    authenticationContext: {
      authenticationProvider: "OKTA_AUTHENTICATION_PROVIDER",
      credentialProvider: null,
      credentialType: "PASSWORD",
      issuer: null,
      interface: null,
      authenticationStep: 0,
      rootSessionId: "102aBcDeFgHiJkLmNoPqRsTuV",
      externalSessionId: "102aBcDeFgHiJkLmNoPqRsTuV",
    },
    securityContext: {
      asNumber: 64496,
      asOrg: "example isp",
      isp: "example isp",
      domain: "example.net",
      isProxy: false,
    },
    request: {
      ipChain: [
        {
          ip: "203.0.113.42",
          geographicalContext: {
            city: "Seattle",
            state: "Washington",
            country: "United States",
            postalCode: "98101",
            geolocation: { lat: 47.6062, lon: -122.3321 },
          },
          version: "V4",
          source: null,
        },
      ],
    },
  };
}

/*
 * A 200 page. Okta always sends a rel="self" link and, while more pages
 * exist, a rel="next" link with its own `after` cursor.
 */
function page(
  events: Array<JSONObject>,
  nextUrl: string | null = null,
  headerName: string = "link",
): DataSourceHttpResponse {
  const self: string = `<${ORG_URL}/api/v1/logs?since=${encodeURIComponent(
    START.toISOString(),
  )}&limit=1000>; rel="self"`;
  const link: string = nextUrl ? `${self}, <${nextUrl}>; rel="next"` : self;

  return text(200, JSON.stringify(events), { [headerName]: link });
}

function nextLink(after: string): string {
  return `${ORG_URL}/api/v1/logs?since=${encodeURIComponent(
    START.toISOString(),
  )}&until=${encodeURIComponent(
    END.toISOString(),
  )}&sortOrder=ASCENDING&limit=1000&after=${after}`;
}

/*
 * Responders are consumed in order so a test can script "page, page,
 * empty page" or "401" without routing by URL.
 */
function buildHarness(options: {
  responders?: Array<Responder>;
  clientOverrides?: Partial<OktaClientOptions>;
  requestTimeoutInMs?: number;
}): Harness {
  const requests: Array<DataSourceHttpRequest> = [];
  const responders: Array<Responder> = [...(options.responders || [])];

  const client: OktaClient = new OktaClient({
    orgUrl: ORG_URL,
    apiToken: API_TOKEN,
    requestTimeoutInMs: options.requestTimeoutInMs || 20000,
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      requests.push(request);

      const responder: Responder | undefined = responders.shift();

      if (!responder) {
        throw new Error(`Unexpected request to ${request.url}`);
      }

      return responder(request);
    },
    ...(options.clientOverrides || {}),
  });

  return { requests, client };
}

async function expectRejection(
  promise: Promise<unknown>,
): Promise<APIException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(APIException);
    return error as APIException;
  }

  throw new Error("Expected the call to reject.");
}

function sortedParamKeys(url: string): Array<string> {
  return Array.from(new URL(url).searchParams.keys()).sort();
}

describe("OktaClient", () => {
  describe("base URL", () => {
    test("strips trailing slashes and surrounding whitespace from the org URL", () => {
      expect(OktaClient.buildBaseUrl("https://acme.okta.com/")).toBe(
        "https://acme.okta.com",
      );
      expect(OktaClient.buildBaseUrl("  https://acme.okta.com///  ")).toBe(
        "https://acme.okta.com",
      );
      expect(
        buildHarness({
          clientOverrides: { orgUrl: "https://acme.oktapreview.com/" },
        }).client.getBaseUrl(),
      ).toBe("https://acme.oktapreview.com");
    });
  });

  describe("default event filter", () => {
    test("selects the security-relevant event families with sw joined by or", () => {
      expect(OKTA_DEFAULT_EVENT_FILTER).toContain(
        'eventType sw "user.session"',
      );
      expect(OKTA_DEFAULT_EVENT_FILTER).toContain('eventType sw "user.mfa"');
      expect(OKTA_DEFAULT_EVENT_FILTER).toContain('eventType sw "security."');
      expect(OKTA_DEFAULT_EVENT_FILTER).toContain(
        'eventType sw "system.api_token"',
      );
      expect(OKTA_DEFAULT_EVENT_FILTER).not.toContain("published");
      expect(OKTA_DEFAULT_EVENT_FILTER.split(" or ")).toHaveLength(10);
    });
  });

  describe("Link header parsing", () => {
    test('reads rel="next" out of a header that also carries rel="self"', () => {
      const links: Dictionary<string> = OktaClient.parseLinkHeader(
        `<${ORG_URL}/api/v1/logs?limit=1000>; rel="self", <${nextLink(
          "1626817878000_1",
        )}>; rel="next"`,
      );

      expect(Object.keys(links).sort()).toEqual(["next", "self"]);
      expect(links["next"]).toBe(nextLink("1626817878000_1"));
      expect(links["self"]).toBe(`${ORG_URL}/api/v1/logs?limit=1000`);
    });

    test("does not split a URL on commas inside the angle brackets", () => {
      const url: string = `${ORG_URL}/api/v1/logs?filter=eventType%20eq%20%22a,b%22&limit=1000`;

      expect(OktaClient.parseLinkHeader(`<${url}>; rel="next"`)["next"]).toBe(
        url,
      );
    });

    test("accepts unquoted and multi-valued rel parameters", () => {
      expect(
        OktaClient.parseLinkHeader(`<${ORG_URL}/a>; rel=next`)["next"],
      ).toBe(`${ORG_URL}/a`);

      const links: Dictionary<string> = OktaClient.parseLinkHeader(
        `<${ORG_URL}/b>; rel="next prefetch"; title="x"`,
      );
      expect(links["next"]).toBe(`${ORG_URL}/b`);
      expect(links["prefetch"]).toBe(`${ORG_URL}/b`);
    });

    test("returns nothing for an empty or malformed header", () => {
      expect(OktaClient.parseLinkHeader("")).toEqual({});
      expect(OktaClient.parseLinkHeader("rel=next")).toEqual({});
      expect(OktaClient.parseLinkHeader(`<${ORG_URL}/c>`)).toEqual({});
    });
  });

  describe("probe", () => {
    test("sends an SSWS GET for a single event with no bounds and the configured timeout", async () => {
      const harness: Harness = buildHarness({
        requestTimeoutInMs: 12345,
        responders: [
          (): DataSourceHttpResponse => {
            return page([logEvent("evt-1")]);
          },
        ],
      });

      const result: OktaLogEventsPage = await harness.client.probe();

      expect(result.events).toHaveLength(1);
      expect(harness.requests).toHaveLength(1);

      const request: DataSourceHttpRequest = harness.requests[0]!;
      const url: URL = new URL(request.url);

      expect(request.method).toBe("GET");
      expect(url.origin).toBe(ORG_URL);
      expect(url.pathname).toBe("/api/v1/logs");
      expect(sortedParamKeys(request.url)).toEqual(["limit"]);
      expect(url.searchParams.get("limit")).toBe("1");
      expect(request.headers).toEqual({
        Authorization: `SSWS ${API_TOKEN}`,
        Accept: "application/json",
      });
      expect(request.body).toBeUndefined();
      expect(request.timeoutInMs).toBe(12345);
      expect(harness.client.getRequestCount()).toBe(1);
    });
  });

  describe("list request contract", () => {
    test("sends since, until, sortOrder=ASCENDING, limit and the filter as query parameters", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page([]);
          },
        ],
      });

      await harness.client.listLogEvents({
        startTime: START,
        endTime: END,
        limit: 250,
        filter: 'eventType sw "user.session"',
      });

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
      expect(url.searchParams.get("limit")).toBe("250");
      expect(url.searchParams.get("filter")).toBe(
        'eventType sw "user.session"',
      );
      expect(request.headers?.["Authorization"]).toBe(`SSWS ${API_TOKEN}`);
      expect(request.timeoutInMs).toBe(20000);
    });

    test("omits the filter parameter when the filter is empty or blank and passes string bounds through", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page([]);
          },
          (): DataSourceHttpResponse => {
            return page([]);
          },
        ],
      });

      await harness.client.listLogEvents({
        startTime: "2026-09-12T10:00:00.000Z",
        endTime: "2026-09-13T10:00:00.000Z",
        limit: 10,
      });
      await harness.client.listLogEvents({
        startTime: START,
        endTime: END,
        limit: 10,
        filter: "   ",
      });

      for (const request of harness.requests) {
        expect(sortedParamKeys(request.url)).toEqual([
          "limit",
          "since",
          "sortOrder",
          "until",
        ]);
      }

      expect(new URL(harness.requests[0]!.url).searchParams.get("since")).toBe(
        "2026-09-12T10:00:00.000Z",
      );
      expect(new URL(harness.requests[0]!.url).searchParams.get("until")).toBe(
        "2026-09-13T10:00:00.000Z",
      );
    });

    test("clamps the limit to Okta's 0..1000 range and truncates fractions", async () => {
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

      await harness.client.listLogEvents({
        startTime: START,
        endTime: END,
        limit: 1_000_000,
      });
      await harness.client.listLogEvents({
        startTime: START,
        endTime: END,
        limit: -5,
      });
      await harness.client.listLogEvents({
        startTime: START,
        endTime: END,
        limit: 2.9,
      });

      expect(OKTA_MAX_PAGE_SIZE).toBe(1000);
      expect(new URL(harness.requests[0]!.url).searchParams.get("limit")).toBe(
        "1000",
      );
      expect(new URL(harness.requests[1]!.url).searchParams.get("limit")).toBe(
        "0",
      );
      expect(new URL(harness.requests[2]!.url).searchParams.get("limit")).toBe(
        "2",
      );
    });
  });

  describe("response parsing", () => {
    test('returns the events and the rel="next" URL, whatever the header name\'s case', async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page(
              [logEvent("evt-1"), logEvent("evt-2")],
              nextLink("1757671200000_1"),
              "Link",
            );
          },
        ],
      });

      const result: OktaLogEventsPage = await harness.client.listLogEvents({
        startTime: START,
        endTime: END,
        limit: 2,
      });

      expect(
        result.events.map((event: JSONObject): string => {
          return String(event["uuid"]);
        }),
      ).toEqual(["evt-1", "evt-2"]);
      expect(result.nextUrl).toBe(nextLink("1757671200000_1"));
    });

    test("reports the end of pagination when the header has no next link or is absent", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page([logEvent("evt-1")]);
          },
          (): DataSourceHttpResponse => {
            return text(200, JSON.stringify([]));
          },
          (): DataSourceHttpResponse => {
            return {
              statusCode: 200,
              bodyText: "[]",
              bodyJson: [],
            };
          },
        ],
      });

      const withSelfOnly: OktaLogEventsPage =
        await harness.client.listLogEvents({
          startTime: START,
          endTime: END,
          limit: 5,
        });
      const withEmptyHeaders: OktaLogEventsPage =
        await harness.client.listLogEvents({
          startTime: START,
          endTime: END,
          limit: 5,
        });
      const withoutHeaders: OktaLogEventsPage =
        await harness.client.listLogEvents({
          startTime: START,
          endTime: END,
          limit: 5,
        });

      expect(withSelfOnly.nextUrl).toBeNull();
      expect(withEmptyHeaders.nextUrl).toBeNull();
      expect(withEmptyHeaders.events).toEqual([]);
      expect(withoutHeaders.nextUrl).toBeNull();
    });

    test("keeps only object items of the array", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return text(
              200,
              JSON.stringify([logEvent("evt-1"), "junk", 42, null, []]),
            );
          },
        ],
      });

      const result: OktaLogEventsPage = await harness.client.listLogEvents({
        startTime: START,
        endTime: END,
        limit: 5,
      });

      expect(result.events).toHaveLength(1);
      expect(result.events[0]!["uuid"]).toBe("evt-1");
    });

    test("rejects a non-JSON 200 body instead of treating it as an empty window", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return text(
              200,
              "<!DOCTYPE html><html><head><title>Sign In</title></head></html>",
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.listLogEvents({
          startTime: START,
          endTime: END,
          limit: 5,
        }),
      );

      expect(error.message).toBe(`${OKTA_LOGS_STEP} returned a non-JSON body.`);
      expect(error).not.toBeInstanceOf(OktaHttpError);
    });

    test("rejects a JSON object on a 200 (an error envelope or a proxy answer) as an unrecognized shape", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return text(
              200,
              JSON.stringify({
                errorCode: "E0000053",
                errorSummary: "Invalid filter expression",
              }),
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.listLogEvents({
          startTime: START,
          endTime: END,
          limit: 5,
        }),
      );

      expect(error.message).toMatch(
        /^Okta System Log events request returned an unrecognized response shape: /,
      );
      expect(error.message).toContain("E0000053");
      expect(error.message).toContain("Invalid filter expression");
    });
  });

  describe("following the next link", () => {
    test("re-requests Okta's own next URL verbatim with the same headers", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page([logEvent("evt-1")], nextLink("1757671200000_1"));
          },
          (): DataSourceHttpResponse => {
            return page([logEvent("evt-2")]);
          },
        ],
      });

      const first: OktaLogEventsPage = await harness.client.listLogEvents({
        startTime: START,
        endTime: END,
        limit: 1,
      });
      const second: OktaLogEventsPage = await harness.client.listNextPage(
        first.nextUrl!,
      );

      expect(second.events[0]!["uuid"]).toBe("evt-2");
      expect(second.nextUrl).toBeNull();
      expect(harness.requests[1]!.url).toBe(nextLink("1757671200000_1"));
      expect(new URL(harness.requests[1]!.url).searchParams.get("after")).toBe(
        "1757671200000_1",
      );
      expect(harness.requests[1]!.method).toBe("GET");
      expect(harness.requests[1]!.headers).toEqual(
        harness.requests[0]!.headers,
      );
      expect(harness.requests[1]!.timeoutInMs).toBe(20000);
      expect(harness.client.getRequestCount()).toBe(2);
    });

    test("refuses a next link on another host without sending the token there", async () => {
      const harness: Harness = buildHarness({});

      const error: APIException = await expectRejection(
        harness.client.listNextPage(
          "https://evil.example.net/api/v1/logs?after=1&limit=1000",
        ),
      );

      expect(error.message).toBe(
        `${OKTA_LOGS_STEP} returned a next link outside the Okta organization URL (evil.example.net); it was not followed.`,
      );
      expect(harness.requests).toHaveLength(0);
      expect(harness.client.getRequestCount()).toBe(0);
    });

    test("refuses a next link that changes scheme or port even on the same host", async () => {
      const harness: Harness = buildHarness({});

      await expectRejection(
        harness.client.listNextPage("http://acme.okta.com/api/v1/logs?after=1"),
      );
      await expectRejection(
        harness.client.listNextPage(
          "https://acme.okta.com:8443/api/v1/logs?after=1",
        ),
      );

      expect(harness.requests).toHaveLength(0);
    });

    test("refuses a next link that is not a URL", async () => {
      const harness: Harness = buildHarness({});

      const error: APIException = await expectRejection(
        harness.client.listNextPage("/api/v1/logs?after=1"),
      );

      expect(error.message).toBe(
        `${OKTA_LOGS_STEP} returned a next link that is not a URL; it was not followed.`,
      );
      expect(harness.requests).toHaveLength(0);
    });
  });

  describe("count", () => {
    test("counts one full page and reports whether Okta offered more", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page(
              [logEvent("evt-1"), logEvent("evt-2"), logEvent("evt-3")],
              nextLink("1757671200000_3"),
            );
          },
        ],
      });

      const count: OktaLogEventCount = await harness.client.countLogEvents({
        startTime: START,
        endTime: END,
        filter: 'eventType sw "security."',
      });

      expect(count).toEqual({ count: 3, hasMore: true });

      const url: URL = new URL(harness.requests[0]!.url);
      expect(sortedParamKeys(harness.requests[0]!.url)).toEqual([
        "filter",
        "limit",
        "since",
        "sortOrder",
        "until",
      ]);
      expect(url.searchParams.get("limit")).toBe(String(OKTA_MAX_PAGE_SIZE));
      expect(url.searchParams.get("filter")).toBe('eventType sw "security."');
      expect(url.searchParams.get("since")).toBe(START.toISOString());
      expect(url.searchParams.get("until")).toBe(END.toISOString());
    });

    test("is exact when the page is the last one, and never 'more' on an empty page", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return page([logEvent("evt-1"), logEvent("evt-2")]);
          },
          (): DataSourceHttpResponse => {
            return page([], nextLink("stale"));
          },
        ],
      });

      expect(
        await harness.client.countLogEvents({ startTime: START, endTime: END }),
      ).toEqual({ count: 2, hasMore: false });
      expect(
        await harness.client.countLogEvents({ startTime: START, endTime: END }),
      ).toEqual({ count: 0, hasMore: false });
      expect(sortedParamKeys(harness.requests[0]!.url)).toEqual([
        "limit",
        "since",
        "sortOrder",
        "until",
      ]);
    });
  });

  describe("failure taxonomy", () => {
    const cases: Array<{
      status: number;
      body: DataSourceHttpResponse;
      hint: string;
    }> = [
      {
        status: 400,
        body: oktaError(
          400,
          "E0000053",
          "Invalid filter expression: unknown attribute 'foo'",
        ),
        hint: "not a valid System Log filter expression",
      },
      {
        status: 401,
        body: oktaError(401, "E0000011", "Invalid token provided"),
        hint: "did not accept the API token",
      },
      {
        status: 403,
        body: oktaError(
          403,
          "E0000006",
          "You do not have permission to perform the requested action",
        ),
        hint: "not allowed to read the System Log",
      },
      {
        status: 404,
        body: oktaError(404, "E0000007", "Not found: Resource not found"),
        hint: "Check the Okta organization URL",
      },
      {
        status: 429,
        body: oktaError(429, "E0000047", "API call exceeded rate limit"),
        hint: "rate limiting the token",
      },
      {
        status: 500,
        body: oktaError(500, "E0000009", "Internal Server Error"),
        hint: "failed internally",
      },
      {
        status: 503,
        body: text(503, "Service Unavailable"),
        hint: "failed internally",
      },
      {
        status: 302,
        body: text(302, ""),
        hint: "Redirects are refused",
      },
    ];

    for (const testCase of cases) {
      test(`names the step and HTTP ${testCase.status} with the status code, the body and a hint`, async () => {
        const harness: Harness = buildHarness({
          responders: [
            (): DataSourceHttpResponse => {
              return testCase.body;
            },
          ],
        });

        const error: APIException = await expectRejection(
          harness.client.listLogEvents({
            startTime: START,
            endTime: END,
            limit: 5,
          }),
        );

        expect(error).toBeInstanceOf(OktaHttpError);
        expect((error as OktaHttpError).statusCode).toBe(testCase.status);
        expect(error.message).toMatch(
          new RegExp(
            `^Okta System Log events request failed \\(HTTP ${testCase.status}\\): `,
          ),
        );
        expect(error.message).toContain(testCase.hint);

        if (testCase.body.bodyJson) {
          expect(error.message).toContain(
            String((testCase.body.bodyJson as JSONObject)["errorSummary"]),
          );
        }
      });
    }

    test("folds the transport's HTTP-status exception back into the status taxonomy", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              'Data source responded with HTTP 403: {"errorCode":"E0000006","errorSummary":"You do not have permission to perform the requested action"}',
            );
          },
        ],
      });

      const error: APIException = await expectRejection(harness.client.probe());

      expect(error).toBeInstanceOf(OktaHttpError);
      expect((error as OktaHttpError).statusCode).toBe(403);
      expect(error.message).toMatch(
        /^Okta System Log events request failed \(HTTP 403\): /,
      );
      expect(error.message).toContain("You do not have permission");
    });

    test("names the step when the transport times out or refuses egress, without assigning a status", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              "Could not reach data source: timeout of 20000ms exceeded",
            );
          },
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              "Could not reach data source: Data source host resolves to a private address (10.0.0.5), which is not allowed.",
            );
          },
        ],
      });

      const timeoutError: APIException = await expectRejection(
        harness.client.listLogEvents({
          startTime: START,
          endTime: END,
          limit: 5,
        }),
      );
      expect(timeoutError.message).toBe(
        `${OKTA_LOGS_STEP} did not complete: Could not reach data source: timeout of 20000ms exceeded`,
      );
      expect(timeoutError).not.toBeInstanceOf(OktaHttpError);

      const egressError: APIException = await expectRejection(
        harness.client.probe(),
      );
      expect(egressError.message).toMatch(
        /^Okta System Log events request did not complete: /,
      );
      expect(egressError.message).toContain("private address");
      expect(harness.client.getRequestCount()).toBe(2);
    });

    test("truncates a long error body to keep the stored message bounded", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return text(502, "x".repeat(5000));
          },
        ],
      });

      const error: APIException = await expectRejection(harness.client.probe());

      expect(error.message.length).toBeLessThan(1000);
      expect(error.message).toContain("x".repeat(500));
      expect(error.message).not.toContain("x".repeat(501));
    });
  });

  describe("redaction", () => {
    test("never lets the SSWS token through a JSON error body, in any field", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return text(
              401,
              JSON.stringify({
                errorCode: "E0000011",
                errorSummary: `Invalid token provided: SSWS ${API_TOKEN}`,
                errorCauses: [{ errorSummary: `token=${API_TOKEN}` }],
                request: { headers: { Authorization: `SSWS ${API_TOKEN}` } },
              }),
            );
          },
        ],
      });

      const error: APIException = await expectRejection(harness.client.probe());

      expect(error.message).not.toContain(API_TOKEN);
      expect(error.message).toContain("[REDACTED]");
      expect(error.message).toContain("Invalid token provided");
    });

    test("redacts the token echoed in a non-JSON error body", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return text(
              502,
              `Bad Gateway: upstream rejected Authorization: SSWS ${API_TOKEN}`,
            );
          },
        ],
      });

      const error: APIException = await expectRejection(harness.client.probe());

      expect(error.message).not.toContain(API_TOKEN);
      expect(error.message).toContain("Bad Gateway");
    });

    test("redacts the token from a thrown transport message, with or without a status", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              `Data source responded with HTTP 401: Invalid token: SSWS ${API_TOKEN}`,
            );
          },
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              `Could not reach data source: request to ${ORG_URL}/api/v1/logs with SSWS ${API_TOKEN} timed out`,
            );
          },
        ],
      });

      const statusError: APIException = await expectRejection(
        harness.client.probe(),
      );
      expect(statusError.message).not.toContain(API_TOKEN);
      expect(statusError.message).toMatch(/\(HTTP 401\)/);

      const timeoutError: APIException = await expectRejection(
        harness.client.probe(),
      );
      expect(timeoutError.message).not.toContain(API_TOKEN);
      expect(timeoutError.message).toContain("did not complete");
    });

    test("redacts the token from an unrecognized 200 body", async () => {
      const harness: Harness = buildHarness({
        responders: [
          (): DataSourceHttpResponse => {
            return text(
              200,
              JSON.stringify({
                echo: `SSWS ${API_TOKEN}`,
                apiToken: API_TOKEN,
              }),
            );
          },
        ],
      });

      const error: APIException = await expectRejection(harness.client.probe());

      expect(error.message).toContain("unrecognized response shape");
      expect(error.message).not.toContain(API_TOKEN);
    });
  });
});
