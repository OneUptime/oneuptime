import { describe, expect, test } from "@jest/globals";
import MicrosoftDefenderXdrClient, {
  MICROSOFT_DEFENDER_XDR_DEFAULT_PAGE_SIZE,
  MicrosoftDefenderXdrAlertCount,
  MicrosoftDefenderXdrAlertsPage,
  MicrosoftDefenderXdrCloud,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/MicrosoftDefenderXdr/MicrosoftDefenderXdrClient";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../../Server/Utils/DataSource/HttpFetch";
import APIException from "../../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import Dictionary from "../../../../../../Types/Dictionary";
import { JSONObject } from "../../../../../../Types/JSON";

/*
 * The Graph client contract as the connector depends on it: token request
 * shape, alerts URL, pagination, the 401 retry, the failure taxonomy per
 * status, and — above everything — that no credential can leave through
 * an error message. The transport is the injected seam; nothing here
 * touches the network.
 */

const TENANT_ID: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const CLIENT_ID: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const CLIENT_SECRET: string = "A1bC2dE3fH4iJ5kL6mN7oP8qR9sT0u~verySecret";
const ACCESS_TOKEN: string =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJodHRwczovL2dyYXBoIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ";
const START: Date = new Date("2026-09-12T10:00:00.000Z");
const END: Date = new Date("2026-09-13T10:00:00.000Z");

type Responder = (
  request: DataSourceHttpRequest,
) => DataSourceHttpResponse | Promise<DataSourceHttpResponse>;

interface Harness {
  requests: Array<DataSourceHttpRequest>;
  client: MicrosoftDefenderXdrClient;
}

function ok(
  body: JSONObject,
  headers?: Dictionary<string>,
): DataSourceHttpResponse {
  return {
    statusCode: 200,
    bodyText: JSON.stringify(body),
    bodyJson: body,
    headers: headers || {},
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

function alert(id: string): JSONObject {
  return {
    "@odata.type": "#microsoft.graph.security.alert",
    id,
    title: "Suspicious execution of hidden file",
    severity: "low",
    status: "new",
    createdDateTime: "2026-09-12T12:19:27.7211305Z",
  };
}

/*
 * Routes token and alerts requests to scripted responders. Alerts
 * responders are consumed in order so a test can script "401 then 200".
 */
function buildHarness(options: {
  cloud?: MicrosoftDefenderXdrCloud;
  token?: Responder | Array<Responder>;
  alerts?: Array<Responder>;
  requestTimeoutInMs?: number;
}): Harness {
  const requests: Array<DataSourceHttpRequest> = [];
  const tokenResponders: Array<Responder> = Array.isArray(options.token)
    ? [...options.token]
    : [options.token || tokenResponse];
  const alertsResponders: Array<Responder> = [...(options.alerts || [])];

  const client: MicrosoftDefenderXdrClient = new MicrosoftDefenderXdrClient({
    tenantId: TENANT_ID,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    cloud: options.cloud || "public",
    requestTimeoutInMs: options.requestTimeoutInMs || 20000,
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      requests.push(request);

      if (request.url.includes("/oauth2/v2.0/token")) {
        const responder: Responder | undefined =
          tokenResponders.length > 1
            ? tokenResponders.shift()
            : tokenResponders[0];
        return responder!(request);
      }

      const responder: Responder | undefined = alertsResponders.shift();

      if (!responder) {
        throw new Error(`Unexpected request to ${request.url}`);
      }

      return responder(request);
    },
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

describe("MicrosoftDefenderXdrClient", () => {
  describe("token request", () => {
    test("posts the client credentials grant as a form body to the tenant's v2.0 token endpoint", async () => {
      const harness: Harness = buildHarness({ requestTimeoutInMs: 12345 });

      const token: string = await harness.client.getAccessToken();

      expect(token).toBe(ACCESS_TOKEN);
      expect(harness.requests).toHaveLength(1);

      const request: DataSourceHttpRequest = harness.requests[0]!;
      expect(request.method).toBe("POST");
      expect(request.url).toBe(
        `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
      );
      expect(request.formUrlEncoded).toBe(true);
      expect(request.timeoutInMs).toBe(12345);

      const body: Dictionary<string> = request.body as Dictionary<string>;
      expect(Object.keys(body).sort()).toEqual([
        "client_id",
        "client_secret",
        "grant_type",
        "scope",
      ]);
      expect(body["client_id"]).toBe(CLIENT_ID);
      expect(body["client_secret"]).toBe(CLIENT_SECRET);
      expect(body["grant_type"]).toBe("client_credentials");
      expect(body["scope"]).toBe("https://graph.microsoft.com/.default");
    });

    test("uses the Azure Government login and Graph hosts for the usgov cloud", async () => {
      const harness: Harness = buildHarness({
        cloud: "usgov",
        alerts: [
          (): DataSourceHttpResponse => {
            return ok({ value: [] });
          },
        ],
      });

      await harness.client.listAlerts({ startTime: START, endTime: END });

      expect(new URL(harness.requests[0]!.url).host).toBe(
        "login.microsoftonline.us",
      );
      expect((harness.requests[0]!.body as Dictionary<string>)["scope"]).toBe(
        "https://graph.microsoft.us/.default",
      );
      expect(new URL(harness.requests[1]!.url).host).toBe("graph.microsoft.us");
    });

    test("rejects an unknown cloud before anything is contacted", () => {
      expect(() => {
        return new MicrosoftDefenderXdrClient({
          tenantId: TENANT_ID,
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
          cloud: "china" as unknown as MicrosoftDefenderXdrCloud,
          requestTimeoutInMs: 1000,
          transport: (): Promise<DataSourceHttpResponse> => {
            throw new Error("must not be called");
          },
        });
      }).toThrow(BadDataException);
    });

    test("caches the token across requests on the same instance", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return ok({ value: [] });
          },
          (): DataSourceHttpResponse => {
            return ok({ value: [] });
          },
        ],
      });

      await harness.client.listAlerts({ startTime: START, endTime: END });
      await harness.client.listAlerts({ startTime: START, endTime: END });

      const tokenRequests: Array<DataSourceHttpRequest> =
        harness.requests.filter((request: DataSourceHttpRequest): boolean => {
          return request.url.includes("/oauth2/v2.0/token");
        });
      expect(tokenRequests).toHaveLength(1);
      expect(harness.client.getRequestCount()).toBe(3);
    });

    test("names the token step and the status on an Entra rejection, with a hint for invalid_client, and never echoes the secret", async () => {
      const entraBody: string = JSON.stringify({
        error: "invalid_client",
        error_description: `AADSTS7000215: Invalid client secret provided. Ensure the secret being sent in the request is the client secret value, not the client secret ID. client_secret=${CLIENT_SECRET}`,
        error_codes: [7000215],
      });
      const harness: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          return status(401, entraBody);
        },
      });

      const error: APIException = await expectRejection(
        harness.client.getAccessToken(),
      );

      expect(error.message).toMatch(
        /^Microsoft Defender XDR token request failed \(HTTP 401\): /,
      );
      expect(error.message).toContain("AADSTS7000215");
      expect(error.message).toContain("rejected the client secret");
      expect(error.message).not.toContain(CLIENT_SECRET);
    });

    test("hints at the tenant and client id when Entra cannot find the application", async () => {
      const harness: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          return status(
            400,
            JSON.stringify({
              error: "unauthorized_client",
              error_description:
                "AADSTS700016: Application with identifier '...' was not found in the directory.",
              error_codes: [700016],
            }),
          );
        },
      });

      const error: APIException = await expectRejection(
        harness.client.getAccessToken(),
      );

      expect(error.message).toMatch(
        /^Microsoft Defender XDR token request failed \(HTTP 400\): /,
      );
      expect(error.message).toContain(
        "did not find the Application (client) ID",
      );
    });

    test("reports a non-JSON token body without guessing", async () => {
      const harness: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          return status(200, "<html>gateway</html>");
        },
      });

      const error: APIException = await expectRejection(
        harness.client.getAccessToken(),
      );

      expect(error.message).toBe(
        "Microsoft Defender XDR token request returned a non-JSON body.",
      );
    });

    test("reports a JSON token body that carries no access_token", async () => {
      const harness: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          return ok({ token_type: "Bearer", expires_in: 3599 });
        },
      });

      const error: APIException = await expectRejection(
        harness.client.getAccessToken(),
      );

      expect(error.message).toBe(
        "Microsoft Defender XDR token request returned no access_token.",
      );
    });

    test("surfaces a transport failure on the token step as a did-not-complete error", async () => {
      const harness: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          throw new BadDataException(
            "Could not reach data source: timeout of 20000ms exceeded",
          );
        },
      });

      const error: APIException = await expectRejection(
        harness.client.getAccessToken(),
      );

      expect(error.message).toBe(
        "Microsoft Defender XDR token request did not complete: Could not reach data source: timeout of 20000ms exceeded",
      );
    });
  });

  describe("alerts request", () => {
    test("filters by createdDateTime over the half-open window with $top and a bearer token, and nothing else", async () => {
      const harness: Harness = buildHarness({
        requestTimeoutInMs: 4321,
        alerts: [
          (): DataSourceHttpResponse => {
            return ok({ value: [alert("a1"), alert("a2")] });
          },
        ],
      });

      const page: MicrosoftDefenderXdrAlertsPage =
        await harness.client.listAlerts({ startTime: START, endTime: END });

      expect(
        page.alerts.map((item: JSONObject): string => {
          return String(item["id"]);
        }),
      ).toEqual(["a1", "a2"]);
      expect(page.nextLink).toBeNull();

      const request: DataSourceHttpRequest = harness.requests[1]!;
      const url: URL = new URL(request.url);

      expect(request.method).toBe("GET");
      expect(url.origin).toBe("https://graph.microsoft.com");
      expect(url.pathname).toBe("/v1.0/security/alerts_v2");
      expect(Array.from(url.searchParams.keys()).sort()).toEqual([
        "$filter",
        "$top",
      ]);
      expect(url.searchParams.get("$filter")).toBe(
        `createdDateTime ge ${START.toISOString()} and createdDateTime lt ${END.toISOString()}`,
      );
      expect(url.searchParams.get("$top")).toBe(
        String(MICROSOFT_DEFENDER_XDR_DEFAULT_PAGE_SIZE),
      );
      expect(request.headers?.["Authorization"]).toBe(`Bearer ${ACCESS_TOKEN}`);
      expect(request.headers?.["Accept"]).toBe("application/json");
      expect(request.timeoutInMs).toBe(4321);
      expect(request.body).toBeUndefined();
    });

    test("clamps the page size to the documented example maximum and never below one", () => {
      expect(MicrosoftDefenderXdrClient.clampPageSize(1)).toBe(1);
      expect(MicrosoftDefenderXdrClient.clampPageSize(500)).toBe(
        MICROSOFT_DEFENDER_XDR_DEFAULT_PAGE_SIZE,
      );
      expect(MicrosoftDefenderXdrClient.clampPageSize(0)).toBe(
        MICROSOFT_DEFENDER_XDR_DEFAULT_PAGE_SIZE,
      );
      expect(MicrosoftDefenderXdrClient.clampPageSize(undefined)).toBe(
        MICROSOFT_DEFENDER_XDR_DEFAULT_PAGE_SIZE,
      );

      const harness: Harness = buildHarness({});
      const url: URL = new URL(
        harness.client.buildAlertsUrl({
          startTime: START,
          endTime: END,
          pageSize: 1,
        }),
      );
      expect(url.searchParams.get("$top")).toBe("1");
    });

    test("follows @odata.nextLink exactly as Graph returned it and stops when the last page has none", async () => {
      const nextLink: string = `https://graph.microsoft.com/v1.0/security/alerts_v2?$filter=createdDateTime+ge+${START.toISOString()}&$top=100&$skiptoken=abc123`;
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return ok({ value: [alert("a1")], "@odata.nextLink": nextLink });
          },
          (): DataSourceHttpResponse => {
            return ok({ value: [alert("a2")] });
          },
        ],
      });

      const first: MicrosoftDefenderXdrAlertsPage =
        await harness.client.listAlerts({ startTime: START, endTime: END });
      expect(first.nextLink).toBe(nextLink);

      const second: MicrosoftDefenderXdrAlertsPage =
        await harness.client.listAlertsByNextLink(first.nextLink!);

      expect(
        second.alerts.map((item: JSONObject): string => {
          return String(item["id"]);
        }),
      ).toEqual(["a2"]);
      expect(second.nextLink).toBeNull();
      expect(harness.requests[2]!.url).toBe(nextLink);
      expect(harness.requests[2]!.headers?.["Authorization"]).toBe(
        `Bearer ${ACCESS_TOKEN}`,
      );
    });

    test("refuses a next page link that points off the Graph host, without sending the token there", async () => {
      const harness: Harness = buildHarness({});

      const error: APIException = await expectRejection(
        harness.client.listAlertsByNextLink(
          "https://evil.example.com/v1.0/security/alerts_v2?$skiptoken=x",
        ),
      );

      expect(error.message).toBe(
        "Microsoft Defender XDR alerts request returned a next page link on an unexpected host: evil.example.com",
      );
      expect(harness.requests).toHaveLength(0);
    });

    test("refuses a next page link that is not a URL", async () => {
      const harness: Harness = buildHarness({});

      const error: APIException = await expectRejection(
        harness.client.listAlertsByNextLink("not a url"),
      );

      expect(error.message).toBe(
        "Microsoft Defender XDR alerts request returned an unusable next page link.",
      );
    });

    test("retries once with a fresh token after a 401 and succeeds", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return status(
              401,
              JSON.stringify({
                error: {
                  code: "InvalidAuthenticationToken",
                  message: "Access token has expired.",
                },
              }),
            );
          },
          (): DataSourceHttpResponse => {
            return ok({ value: [alert("a1")] });
          },
        ],
      });

      const page: MicrosoftDefenderXdrAlertsPage =
        await harness.client.listAlerts({ startTime: START, endTime: END });

      expect(page.alerts).toHaveLength(1);

      const tokenRequests: Array<DataSourceHttpRequest> =
        harness.requests.filter((request: DataSourceHttpRequest): boolean => {
          return request.url.includes("/oauth2/v2.0/token");
        });
      expect(tokenRequests).toHaveLength(2);
      expect(harness.client.getRequestCount()).toBe(4);
    });

    test("fails with the alerts prefix and a 401 hint when the fresh token is refused too", async () => {
      const denied: Responder = (): DataSourceHttpResponse => {
        return status(
          401,
          JSON.stringify({
            error: {
              code: "InvalidAuthenticationToken",
              message: "CompactToken parsing failed",
            },
          }),
        );
      };
      const harness: Harness = buildHarness({ alerts: [denied, denied] });

      const error: APIException = await expectRejection(
        harness.client.listAlerts({ startTime: START, endTime: END }),
      );

      expect(error.message).toMatch(
        /^Microsoft Defender XDR alerts request failed \(HTTP 401\): /,
      );
      expect(error.message).toContain("InvalidAuthenticationToken");
      expect(error.message).toContain("did not accept the access token");
      expect(error.message).not.toContain(ACCESS_TOKEN);
    });

    test("explains a 403 as the missing application permission or license", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return status(
              403,
              JSON.stringify({
                error: {
                  code: "Authorization_RequestDenied",
                  message: "Insufficient privileges to complete the operation.",
                },
              }),
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.listAlerts({ startTime: START, endTime: END }),
      );

      expect(error.message).toMatch(
        /^Microsoft Defender XDR alerts request failed \(HTTP 403\): /,
      );
      expect(error.message).toContain("SecurityAlert.Read.All");
      expect(error.message).toContain("Microsoft Defender XDR license");
    });

    test("reports throttling with the Retry-After value", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return status(
              429,
              JSON.stringify({
                error: {
                  code: "TooManyRequests",
                  message: "Please retry again later.",
                },
              }),
              { "retry-after": "10" },
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.listAlerts({ startTime: START, endTime: END }),
      );

      expect(error.message).toMatch(
        /^Microsoft Defender XDR alerts request failed \(HTTP 429\): /,
      );
      expect(error.message).toContain("retry after 10 seconds");
    });

    test("reports a 5xx as Graph's fault and keeps the body", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return status(503, "<html>Service Unavailable</html>");
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.listAlerts({ startTime: START, endTime: END }),
      );

      expect(error.message).toMatch(
        /^Microsoft Defender XDR alerts request failed \(HTTP 503\): <html>Service Unavailable<\/html>/,
      );
      expect(error.message).toContain("server-side error");
    });

    test("folds the transport's own HTTP-status exception back into the status taxonomy", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              `Data source responded with HTTP 403: ${JSON.stringify({
                error: { code: "Authorization_RequestDenied", message: "no" },
              })}`,
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.listAlerts({ startTime: START, endTime: END }),
      );

      expect(error.message).toMatch(
        /^Microsoft Defender XDR alerts request failed \(HTTP 403\): /,
      );
      expect(error.message).toContain("Authorization_RequestDenied");
      expect(error.message).toContain("SecurityAlert.Read.All");
    });

    test("surfaces a timeout on the alerts step as a did-not-complete error", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              "Could not reach data source: timeout of 20000ms exceeded",
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.listAlerts({ startTime: START, endTime: END }),
      );

      expect(error.message).toBe(
        "Microsoft Defender XDR alerts request did not complete: Could not reach data source: timeout of 20000ms exceeded",
      );
    });

    test("reports a non-JSON alerts body rather than treating it as an empty window", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return status(200, "<html>ok</html>");
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.listAlerts({ startTime: START, endTime: END }),
      );

      expect(error.message).toBe(
        "Microsoft Defender XDR alerts request returned a non-JSON body.",
      );
    });

    test("reports a JSON alerts body without a value array as an unrecognized shape", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return ok({ alerts: [] });
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.listAlerts({ startTime: START, endTime: END }),
      );

      expect(error.message).toBe(
        'Microsoft Defender XDR alerts request returned an unrecognized response shape: {"alerts":[]}',
      );
    });

    test("drops non-object entries from value instead of passing them to the normalizer", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return ok({ value: [alert("a1"), "junk", null, 42] as never });
          },
        ],
      });

      const page: MicrosoftDefenderXdrAlertsPage =
        await harness.client.listAlerts({ startTime: START, endTime: END });

      expect(page.alerts).toHaveLength(1);
    });

    test("redacts credentials Graph echoes back in an error body", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return status(
              400,
              JSON.stringify({
                error: {
                  code: "BadRequest",
                  message: `Authorization: Bearer ${ACCESS_TOKEN} was malformed; client_secret=${CLIENT_SECRET}`,
                  access_token: ACCESS_TOKEN,
                },
              }),
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.listAlerts({ startTime: START, endTime: END }),
      );

      expect(error.message).toMatch(
        /^Microsoft Defender XDR alerts request failed \(HTTP 400\): /,
      );
      expect(error.message).not.toContain(ACCESS_TOKEN);
      expect(error.message).not.toContain(CLIENT_SECRET);
      expect(error.message).toContain("[REDACTED]");
    });
  });

  describe("countAlerts", () => {
    test("returns the first page size and flags a floor when Graph paged", async () => {
      const harness: Harness = buildHarness({
        alerts: [
          (): DataSourceHttpResponse => {
            return ok({
              value: [alert("a1"), alert("a2")],
              "@odata.nextLink":
                "https://graph.microsoft.com/v1.0/security/alerts_v2?$skiptoken=x",
            });
          },
          (): DataSourceHttpResponse => {
            return ok({ value: [] });
          },
        ],
      });

      const paged: MicrosoftDefenderXdrAlertCount =
        await harness.client.countAlerts({ startTime: START, endTime: END });
      expect(paged).toEqual({ count: 2, hasMore: true });

      const empty: MicrosoftDefenderXdrAlertCount =
        await harness.client.countAlerts({ startTime: START, endTime: END });
      expect(empty).toEqual({ count: 0, hasMore: false });

      // Counting reads a single full page, never a second one.
      const alertsRequests: Array<DataSourceHttpRequest> =
        harness.requests.filter((request: DataSourceHttpRequest): boolean => {
          return request.url.includes("/security/alerts_v2");
        });
      expect(alertsRequests).toHaveLength(2);
      expect(new URL(alertsRequests[0]!.url).searchParams.get("$top")).toBe(
        String(MICROSOFT_DEFENDER_XDR_DEFAULT_PAGE_SIZE),
      );
    });
  });
});
