import { describe, expect, test } from "@jest/globals";
import MicrosoftSentinelClient, {
  MICROSOFT_SENTINEL_API_VERSION,
  MICROSOFT_SENTINEL_DEFAULT_PAGE_SIZE,
  MICROSOFT_SENTINEL_MAX_PAGE_SIZE,
  MicrosoftSentinelCloud,
  MicrosoftSentinelIncidentCount,
  MicrosoftSentinelIncidentsPage,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/MicrosoftSentinel/MicrosoftSentinelClient";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../../Server/Utils/DataSource/HttpFetch";
import APIException from "../../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import Dictionary from "../../../../../../Types/Dictionary";
import { JSONObject } from "../../../../../../Types/JSON";

/*
 * The ARM client contract as the connector depends on it: the Entra token
 * request, the incidents URL (creation-time filter, ascending order, page
 * size), nextLink pagination and its host pinning, the one-shot 401
 * retry, the failure taxonomy per status, and — above everything — that
 * no credential can leave through an error message. The transport is the
 * injected seam; nothing here touches the network.
 */

const TENANT_ID: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const CLIENT_ID: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const CLIENT_SECRET: string = "A1bC2dE3fH4iJ5kL6mN7oP8qR9sT0u~verySecret";
const SUBSCRIPTION_ID: string = "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0";
const RESOURCE_GROUP: string = "myRg";
const WORKSPACE_NAME: string = "myWorkspace";
const ACCESS_TOKEN: string =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJodHRwczovL21hbmFnZW1lbnQifQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ";
const FRESH_TOKEN: string =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJmcmVzaC10b2tlbi1hdWRpZW5jZSJ9.ZnJlc2gtc2lnbmF0dXJl";
const START: Date = new Date("2026-09-12T10:00:00.000Z");
const END: Date = new Date("2026-09-13T10:00:00.000Z");
const INCIDENTS_PATH: string = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.OperationalInsights/workspaces/${WORKSPACE_NAME}/providers/Microsoft.SecurityInsights/incidents`;

type Responder = (
  request: DataSourceHttpRequest,
) => DataSourceHttpResponse | Promise<DataSourceHttpResponse>;

interface Harness {
  requests: Array<DataSourceHttpRequest>;
  client: MicrosoftSentinelClient;
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

function tokenResponse(token: string = ACCESS_TOKEN): DataSourceHttpResponse {
  return ok({ token_type: "Bearer", expires_in: 3599, access_token: token });
}

/*
 * Shaped like the sample response of the Incidents - List reference
 * (api-version 2024-03-01).
 */
function incident(name: string): JSONObject {
  return {
    id: `${INCIDENTS_PATH}/${name}`,
    name,
    type: "Microsoft.SecurityInsights/incidents",
    etag: '"0300bf09-0000-0000-0000-5c37296e0000"',
    properties: {
      lastModifiedTimeUtc: "2026-09-12T13:15:30Z",
      createdTimeUtc: "2026-09-12T13:15:30Z",
      lastActivityTimeUtc: "2026-09-12T13:05:30Z",
      firstActivityTimeUtc: "2026-09-12T13:00:30Z",
      description: "This is a demo incident",
      title: "My incident",
      severity: "High",
      status: "New",
      incidentNumber: 3177,
      labels: [],
      providerName: "Azure Sentinel",
      providerIncidentId: "3177",
      relatedAnalyticRuleIds: [],
      additionalData: {
        alertsCount: 1,
        bookmarksCount: 0,
        commentsCount: 0,
        alertProductNames: ["Azure Sentinel"],
        tactics: ["Persistence"],
      },
    },
  };
}

function armError(code: string, message: string): string {
  return JSON.stringify({ error: { code, message } });
}

/*
 * Routes token and incidents requests to scripted responders. Incidents
 * responders are consumed in order so a test can script "401 then 200";
 * token responders are consumed in order when more than one is given.
 */
function buildHarness(options: {
  cloud?: MicrosoftSentinelCloud;
  token?: Responder | Array<Responder>;
  incidents?: Array<Responder>;
  requestTimeoutInMs?: number;
}): Harness {
  const requests: Array<DataSourceHttpRequest> = [];
  const tokenResponders: Array<Responder> = Array.isArray(options.token)
    ? [...options.token]
    : [
        options.token ||
          ((): DataSourceHttpResponse => {
            return tokenResponse();
          }),
      ];
  const incidentResponders: Array<Responder> = [...(options.incidents || [])];

  const client: MicrosoftSentinelClient = new MicrosoftSentinelClient({
    tenantId: TENANT_ID,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    subscriptionId: SUBSCRIPTION_ID,
    resourceGroup: RESOURCE_GROUP,
    workspaceName: WORKSPACE_NAME,
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

      const responder: Responder | undefined = incidentResponders.shift();

      if (!responder) {
        throw new Error(`Unexpected request to ${request.url}`);
      }

      return responder(request);
    },
  });

  return { requests, client };
}

function tokenRequests(
  requests: Array<DataSourceHttpRequest>,
): Array<DataSourceHttpRequest> {
  return requests.filter((request: DataSourceHttpRequest): boolean => {
    return request.url.includes("/oauth2/v2.0/token");
  });
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

describe("MicrosoftSentinelClient", () => {
  describe("construction and validation", () => {
    test("rejects an unknown cloud before anything is contacted", () => {
      expect(() => {
        return new MicrosoftSentinelClient({
          tenantId: TENANT_ID,
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
          subscriptionId: SUBSCRIPTION_ID,
          resourceGroup: RESOURCE_GROUP,
          workspaceName: WORKSPACE_NAME,
          cloud: "china" as unknown as MicrosoftSentinelCloud,
          transport: (): Promise<DataSourceHttpResponse> => {
            throw new Error("must not be called");
          },
        });
      }).toThrow(BadDataException);
    });

    test("accepts a tenant GUID or a verified tenant domain and refuses path-like values", () => {
      expect(() => {
        MicrosoftSentinelClient.validateTenantId(TENANT_ID);
      }).not.toThrow();
      expect(() => {
        MicrosoftSentinelClient.validateTenantId("contoso.onmicrosoft.com");
      }).not.toThrow();
      expect(() => {
        MicrosoftSentinelClient.validateTenantId("contoso/../common");
      }).toThrow(BadDataException);
      expect(() => {
        MicrosoftSentinelClient.validateTenantId("");
      }).toThrow(BadDataException);
    });

    test("requires GUIDs for the client and subscription ids", () => {
      expect(() => {
        MicrosoftSentinelClient.validateGuid("not-a-guid", "Subscription ID");
      }).toThrow("Subscription ID must be a GUID");
      expect(() => {
        MicrosoftSentinelClient.validateGuid(` ${CLIENT_ID} `, "x");
      }).not.toThrow();
    });

    test("applies the Azure resource group and workspace name rules", () => {
      expect(() => {
        MicrosoftSentinelClient.validateResourceGroup("rg-sentinel_(prod).1");
      }).not.toThrow();
      expect(() => {
        MicrosoftSentinelClient.validateResourceGroup("ends-with-period.");
      }).toThrow(BadDataException);
      expect(() => {
        MicrosoftSentinelClient.validateResourceGroup("has space");
      }).toThrow(BadDataException);
      expect(() => {
        MicrosoftSentinelClient.validateResourceGroup("a".repeat(91));
      }).toThrow(BadDataException);

      expect(() => {
        MicrosoftSentinelClient.validateWorkspaceName("my-Workspace-01");
      }).not.toThrow();
      expect(() => {
        MicrosoftSentinelClient.validateWorkspaceName("-leading");
      }).toThrow(BadDataException);
      expect(() => {
        MicrosoftSentinelClient.validateWorkspaceName("has_underscore");
      }).toThrow(BadDataException);
      expect(() => {
        MicrosoftSentinelClient.validateWorkspaceName("a".repeat(91));
      }).toThrow(BadDataException);
    });

    test("requires a client secret", () => {
      expect(() => {
        return new MicrosoftSentinelClient({
          tenantId: TENANT_ID,
          clientId: CLIENT_ID,
          clientSecret: "",
          subscriptionId: SUBSCRIPTION_ID,
          resourceGroup: RESOURCE_GROUP,
          workspaceName: WORKSPACE_NAME,
          cloud: "public",
          transport: (): Promise<DataSourceHttpResponse> => {
            throw new Error("must not be called");
          },
        });
      }).toThrow("Client secret is required.");
    });
  });

  describe("token request", () => {
    test("posts the client credentials grant as a form body to the tenant's v2.0 token endpoint with the ARM scope", async () => {
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
      expect(request.headers?.["Accept"]).toBe("application/json");

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
      expect(body["scope"]).toBe("https://management.azure.com/.default");
    });

    test("uses the Azure Government login and Resource Manager hosts for the usgov cloud", async () => {
      const harness: Harness = buildHarness({
        cloud: "usgov",
        incidents: [
          (): DataSourceHttpResponse => {
            return ok({ value: [] });
          },
        ],
      });

      await harness.client.listIncidents({ startTime: START, endTime: END });

      expect(new URL(harness.requests[0]!.url).host).toBe(
        "login.microsoftonline.us",
      );
      expect((harness.requests[0]!.body as Dictionary<string>)["scope"]).toBe(
        "https://management.usgovcloudapi.net/.default",
      );
      expect(new URL(harness.requests[1]!.url).host).toBe(
        "management.usgovcloudapi.net",
      );
    });

    test("caches the token across requests on the same instance and counts every request", async () => {
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return ok({ value: [] });
          },
          (): DataSourceHttpResponse => {
            return ok({ value: [] });
          },
        ],
      });

      await harness.client.listIncidents({ startTime: START, endTime: END });
      await harness.client.listIncidents({ startTime: START, endTime: END });

      expect(tokenRequests(harness.requests)).toHaveLength(1);
      expect(harness.client.getRequestCount()).toBe(3);
    });

    test("names the token step and the status on an Entra rejection, hints at the secret for invalid_client, and never echoes the secret", async () => {
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
        /^Microsoft Sentinel token request failed \(HTTP 401\): /,
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
        /^Microsoft Sentinel token request failed \(HTTP 400\): /,
      );
      expect(error.message).toContain("was not found in this tenant");
    });

    test("hints at the tenant id when Entra reports the tenant does not exist", async () => {
      const harness: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          return status(
            400,
            JSON.stringify({
              error: "invalid_request",
              error_description:
                "AADSTS90002: Tenant 'x' not found. Check to make sure you have the correct tenant ID.",
            }),
          );
        },
      });

      const error: APIException = await expectRejection(
        harness.client.getAccessToken(),
      );

      expect(error.message).toContain("does not name an existing tenant");
    });

    test("reports throttling and server-side failures on the token step", async () => {
      const throttled: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          return status(
            429,
            JSON.stringify({ error: "temporarily_unavailable" }),
          );
        },
      });
      const throttledError: APIException = await expectRejection(
        throttled.client.getAccessToken(),
      );
      expect(throttledError.message).toMatch(
        /^Microsoft Sentinel token request failed \(HTTP 429\): /,
      );
      expect(throttledError.message).toContain("throttling token requests");

      const down: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          return status(503, "Service Unavailable");
        },
      });
      const downError: APIException = await expectRejection(
        down.client.getAccessToken(),
      );
      expect(downError.message).toBe(
        "Microsoft Sentinel token request failed (HTTP 503): Service Unavailable — Microsoft Entra reported a server-side problem; the next poll retries.",
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
        "Microsoft Sentinel token request returned a non-JSON body: <html>gateway</html>",
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
        'Microsoft Sentinel token request returned no access_token: {"token_type":"Bearer","expires_in":3599}',
      );
    });

    test("surfaces a transport failure on the token step with the step prefix", async () => {
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
        "Microsoft Sentinel token request failed: Could not reach data source: timeout of 20000ms exceeded",
      );
    });

    test("gives up on a transport that never settles once the request timeout elapses", async () => {
      const harness: Harness = buildHarness({
        requestTimeoutInMs: 30,
        token: (): Promise<DataSourceHttpResponse> => {
          return new Promise<DataSourceHttpResponse>((): void => {
            // Never resolves: simulates a socket that neither answers nor closes.
          });
        },
      });

      const error: APIException = await expectRejection(
        harness.client.getAccessToken(),
      );

      expect(error.message).toMatch(
        /^Microsoft Sentinel token request timed out after \d+ seconds with no response\.$/,
      );
    });
  });

  describe("incidents request", () => {
    test("filters by createdTimeUtc over the half-open window, orders ascending, pages with $top, and sends the bearer token", async () => {
      const harness: Harness = buildHarness({
        requestTimeoutInMs: 4321,
        incidents: [
          (): DataSourceHttpResponse => {
            return ok({ value: [incident("i1"), incident("i2")] });
          },
        ],
      });

      const page: MicrosoftSentinelIncidentsPage =
        await harness.client.listIncidents({ startTime: START, endTime: END });

      expect(
        page.incidents.map((item: JSONObject): string => {
          return String(item["name"]);
        }),
      ).toEqual(["i1", "i2"]);
      expect(page.nextLink).toBeNull();

      const request: DataSourceHttpRequest = harness.requests[1]!;
      const url: URL = new URL(request.url);

      expect(request.method).toBe("GET");
      expect(url.origin).toBe("https://management.azure.com");
      expect(url.pathname).toBe(INCIDENTS_PATH);
      expect(Array.from(url.searchParams.keys()).sort()).toEqual([
        "$filter",
        "$orderby",
        "$top",
        "api-version",
      ]);
      expect(url.searchParams.get("api-version")).toBe(
        MICROSOFT_SENTINEL_API_VERSION,
      );
      expect(url.searchParams.get("$filter")).toBe(
        `(properties/createdTimeUtc ge ${START.toISOString()}) and (properties/createdTimeUtc lt ${END.toISOString()})`,
      );
      expect(url.searchParams.get("$orderby")).toBe(
        "properties/createdTimeUtc asc",
      );
      expect(url.searchParams.get("$top")).toBe(
        String(MICROSOFT_SENTINEL_DEFAULT_PAGE_SIZE),
      );
      expect(request.headers?.["Authorization"]).toBe(`Bearer ${ACCESS_TOKEN}`);
      expect(request.headers?.["Accept"]).toBe("application/json");
      expect(request.timeoutInMs).toBe(4321);
      expect(request.body).toBeUndefined();
    });

    test("clamps $top to the documented maximum of 1000 and never below one", () => {
      expect(MicrosoftSentinelClient.clampPageSize(1)).toBe(1);
      expect(MicrosoftSentinelClient.clampPageSize(5000)).toBe(
        MICROSOFT_SENTINEL_MAX_PAGE_SIZE,
      );
      expect(MicrosoftSentinelClient.clampPageSize(0)).toBe(
        MICROSOFT_SENTINEL_DEFAULT_PAGE_SIZE,
      );
      expect(MicrosoftSentinelClient.clampPageSize(undefined)).toBe(
        MICROSOFT_SENTINEL_DEFAULT_PAGE_SIZE,
      );

      const harness: Harness = buildHarness({});
      expect(
        new URL(
          harness.client.buildIncidentsUrl({
            startTime: START,
            endTime: END,
            top: 1,
          }),
        ).searchParams.get("$top"),
      ).toBe("1");
      expect(
        new URL(
          harness.client.buildIncidentsUrl({
            startTime: START,
            endTime: END,
            top: 99999,
          }),
        ).searchParams.get("$top"),
      ).toBe("1000");
    });

    test("builds the incidents path from the trimmed settings, which validation keeps URL-safe", () => {
      const client: MicrosoftSentinelClient = new MicrosoftSentinelClient({
        tenantId: ` ${TENANT_ID} `,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        subscriptionId: ` ${SUBSCRIPTION_ID} `,
        resourceGroup: " rg-(prod).01 ",
        workspaceName: ` ${WORKSPACE_NAME} `,
        cloud: "public",
        transport: (): Promise<DataSourceHttpResponse> => {
          throw new Error("must not be called");
        },
      });

      expect(new URL(client.getIncidentsBaseUrl()).pathname).toBe(
        `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-(prod).01/providers/Microsoft.OperationalInsights/workspaces/${WORKSPACE_NAME}/providers/Microsoft.SecurityInsights/incidents`,
      );
      expect(client.getTokenUrl()).toBe(
        `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
      );

      // A value that would need escaping never reaches the URL builder.
      expect(() => {
        MicrosoftSentinelClient.validateResourceGroup("rg/../other");
      }).toThrow(BadDataException);
    });

    test("follows nextLink exactly as ARM returned it and stops when the last page has none", async () => {
      const nextLink: string = `https://management.azure.com${INCIDENTS_PATH}?api-version=2024-03-01&$filter=properties%2FcreatedTimeUtc+ge+${START.toISOString()}&$top=50&$skipToken=abc123`;
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return ok({ value: [incident("i1")], nextLink: ` ${nextLink} ` });
          },
          (): DataSourceHttpResponse => {
            return ok({ value: [incident("i2")] });
          },
        ],
      });

      const first: MicrosoftSentinelIncidentsPage =
        await harness.client.listIncidents({ startTime: START, endTime: END });
      expect(first.nextLink).toBe(nextLink);

      const second: MicrosoftSentinelIncidentsPage =
        await harness.client.listIncidents({
          startTime: START,
          endTime: END,
          nextLink: first.nextLink,
        });

      expect(
        second.incidents.map((item: JSONObject): string => {
          return String(item["name"]);
        }),
      ).toEqual(["i2"]);
      expect(second.nextLink).toBeNull();
      expect(harness.requests[2]!.url).toBe(nextLink);
      expect(harness.requests[2]!.headers?.["Authorization"]).toBe(
        `Bearer ${ACCESS_TOKEN}`,
      );
      expect(tokenRequests(harness.requests)).toHaveLength(1);
    });

    test("refuses a nextLink that points off the Resource Manager host, without sending the token anywhere", async () => {
      const harness: Harness = buildHarness({});

      const error: APIException = await expectRejection(
        harness.client.listIncidents({
          startTime: START,
          endTime: END,
          nextLink: `https://evil.example.com${INCIDENTS_PATH}?$skipToken=x`,
        }),
      );

      expect(error.message).toBe(
        "Microsoft Sentinel incidents list returned a nextLink on an unexpected host: evil.example.com (expected management.azure.com).",
      );
      expect(harness.requests).toHaveLength(0);
    });

    test("refuses a plain-http nextLink and one that is not a URL", async () => {
      const harness: Harness = buildHarness({});

      const insecure: APIException = await expectRejection(
        harness.client.listIncidents({
          startTime: START,
          endTime: END,
          nextLink: `http://management.azure.com${INCIDENTS_PATH}?$skipToken=x`,
        }),
      );
      expect(insecure.message).toContain("nextLink on an unexpected host");

      const garbage: APIException = await expectRejection(
        harness.client.listIncidents({
          startTime: START,
          endTime: END,
          nextLink: "not a url",
        }),
      );
      expect(garbage.message).toBe(
        "Microsoft Sentinel incidents list returned an unusable nextLink: not a url",
      );
      expect(harness.requests).toHaveLength(0);
    });

    test("retries once with a fresh token when a cached token is refused with 401", async () => {
      const harness: Harness = buildHarness({
        token: [
          (): DataSourceHttpResponse => {
            return tokenResponse(ACCESS_TOKEN);
          },
          (): DataSourceHttpResponse => {
            return tokenResponse(FRESH_TOKEN);
          },
        ],
        incidents: [
          (): DataSourceHttpResponse => {
            return ok({ value: [] });
          },
          (): DataSourceHttpResponse => {
            return status(
              401,
              armError(
                "ExpiredAuthenticationToken",
                "The access token expiry UTC time is earlier than current UTC time.",
              ),
            );
          },
          (): DataSourceHttpResponse => {
            return ok({ value: [incident("i1")] });
          },
        ],
      });

      await harness.client.listIncidents({ startTime: START, endTime: END });
      const page: MicrosoftSentinelIncidentsPage =
        await harness.client.listIncidents({ startTime: START, endTime: END });

      expect(page.incidents).toHaveLength(1);
      expect(tokenRequests(harness.requests)).toHaveLength(2);
      expect(harness.client.getRequestCount()).toBe(5);
      expect(harness.requests[4]!.headers?.["Authorization"]).toBe(
        `Bearer ${FRESH_TOKEN}`,
      );
    });

    test("does not retry when a freshly minted token is refused, and hints at the cloud setting", async () => {
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return status(
              401,
              armError(
                "InvalidAuthenticationToken",
                "The access token has been obtained for wrong audience or resource.",
              ),
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.listIncidents({ startTime: START, endTime: END }),
      );

      expect(error.message).toMatch(
        /^Microsoft Sentinel incidents list failed \(HTTP 401\): /,
      );
      expect(error.message).toContain("InvalidAuthenticationToken");
      expect(error.message).toContain("wrong audience or resource");
      expect(error.message).toContain("rejected the access token");
      expect(error.message).not.toContain(ACCESS_TOKEN);
      expect(harness.client.getRequestCount()).toBe(2);
    });

    test("explains a 403 as the missing Microsoft Sentinel Reader role", async () => {
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return status(
              403,
              armError(
                "AuthorizationFailed",
                `The client '${CLIENT_ID}' with object id '...' does not have authorization to perform action 'Microsoft.SecurityInsights/incidents/read' over scope '...'.`,
              ),
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.listIncidents({ startTime: START, endTime: END }),
      );

      expect(error.message).toMatch(
        /^Microsoft Sentinel incidents list failed \(HTTP 403\): /,
      );
      expect(error.message).toContain("AuthorizationFailed");
      expect(error.message).toContain("Microsoft Sentinel Reader");
    });

    test("explains a 404 as a workspace that could not be found", async () => {
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return status(
              404,
              armError(
                "ResourceNotFound",
                "The Resource 'Microsoft.OperationalInsights/workspaces/myWorkspace' under resource group 'myRg' was not found.",
              ),
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.listIncidents({ startTime: START, endTime: END }),
      );

      expect(error.message).toMatch(
        /^Microsoft Sentinel incidents list failed \(HTTP 404\): /,
      );
      expect(error.message).toContain("No workspace matched");
    });

    test("reports throttling as ARM's rate limit", async () => {
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return status(
              429,
              armError("TooManyRequests", "Too many requests. Please retry."),
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.listIncidents({ startTime: START, endTime: END }),
      );

      expect(error.message).toMatch(
        /^Microsoft Sentinel incidents list failed \(HTTP 429\): /,
      );
      expect(error.message).toContain("throttling requests");
    });

    test("reports a 5xx as ARM's fault and keeps the non-JSON body", async () => {
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return status(500, "<html>Internal Server Error</html>");
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.listIncidents({ startTime: START, endTime: END }),
      );

      expect(error.message).toBe(
        "Microsoft Sentinel incidents list failed (HTTP 500): <html>Internal Server Error</html> — Azure Resource Manager reported a server-side problem; the next poll retries.",
      );
    });

    test("reports a 400 as a connector-built query ARM rejected", async () => {
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return status(
              400,
              armError("BadRequest", "Invalid filter clause."),
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.listIncidents({ startTime: START, endTime: END }),
      );

      expect(error.message).toMatch(
        /^Microsoft Sentinel incidents list failed \(HTTP 400\): /,
      );
      expect(error.message).toContain("rejected the query");
    });

    test("folds the transport's own HTTP-status exception back into the status taxonomy", async () => {
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              `Data source responded with HTTP 403: ${armError(
                "AuthorizationFailed",
                "no",
              )}`,
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.listIncidents({ startTime: START, endTime: END }),
      );

      expect(error.message).toMatch(
        /^Microsoft Sentinel incidents list failed \(HTTP 403\): /,
      );
      expect(error.message).toContain("AuthorizationFailed");
      expect(error.message).toContain("Microsoft Sentinel Reader");
    });

    test("surfaces a transport timeout on the incidents step with the step prefix", async () => {
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              "Could not reach data source: timeout of 20000ms exceeded",
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.listIncidents({ startTime: START, endTime: END }),
      );

      expect(error.message).toBe(
        "Microsoft Sentinel incidents list failed: Could not reach data source: timeout of 20000ms exceeded",
      );
    });

    test("gives up on an incidents request that never settles once the request timeout elapses", async () => {
      const harness: Harness = buildHarness({
        requestTimeoutInMs: 30,
        incidents: [
          (): Promise<DataSourceHttpResponse> => {
            return new Promise<DataSourceHttpResponse>((): void => {
              // Never resolves.
            });
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.listIncidents({ startTime: START, endTime: END }),
      );

      expect(error.message).toMatch(
        /^Microsoft Sentinel incidents list timed out after \d+ seconds with no response\.$/,
      );
    });

    test("reports a non-JSON incidents body rather than treating it as an empty window", async () => {
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return status(200, "<html>ok</html>");
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.listIncidents({ startTime: START, endTime: END }),
      );

      expect(error.message).toBe(
        "Microsoft Sentinel incidents list returned a non-JSON body: <html>ok</html>",
      );
    });

    test("reports a JSON body that is not an object or has no value array as an unrecognized shape", async () => {
      const arrayBody: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return status(200, JSON.stringify([incident("i1")]));
          },
        ],
      });
      const arrayError: APIException = await expectRejection(
        arrayBody.client.listIncidents({ startTime: START, endTime: END }),
      );
      expect(arrayError.message).toBe(
        "Microsoft Sentinel incidents list returned an unrecognized response shape: expected a JSON object, received an array.",
      );

      const noValue: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return ok({ incidents: [] });
          },
        ],
      });
      const noValueError: APIException = await expectRejection(
        noValue.client.listIncidents({ startTime: START, endTime: END }),
      );
      expect(noValueError.message).toBe(
        'Microsoft Sentinel incidents list returned an unrecognized response shape: expected a "value" array, received keys incidents.',
      );
    });

    test("drops non-object entries from value instead of passing them to the normalizer", async () => {
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return ok({ value: [incident("i1"), "junk", null, 42] as never });
          },
        ],
      });

      const page: MicrosoftSentinelIncidentsPage =
        await harness.client.listIncidents({ startTime: START, endTime: END });

      expect(page.incidents).toHaveLength(1);
    });

    test("redacts credentials ARM echoes back in an error body", async () => {
      const harness: Harness = buildHarness({
        incidents: [
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
        harness.client.listIncidents({ startTime: START, endTime: END }),
      );

      expect(error.message).toMatch(
        /^Microsoft Sentinel incidents list failed \(HTTP 400\): /,
      );
      expect(error.message).not.toContain(ACCESS_TOKEN);
      expect(error.message).not.toContain(CLIENT_SECRET);
      expect(error.message).toContain("[REDACTED]");
    });
  });

  describe("countIncidentsCreated", () => {
    test("returns the first page size and flags a floor when ARM paged, reading a single page", async () => {
      const harness: Harness = buildHarness({
        incidents: [
          (): DataSourceHttpResponse => {
            return ok({
              value: [incident("i1"), incident("i2")],
              nextLink: `https://management.azure.com${INCIDENTS_PATH}?$skipToken=x`,
            });
          },
          (): DataSourceHttpResponse => {
            return ok({ value: [] });
          },
        ],
      });

      const paged: MicrosoftSentinelIncidentCount =
        await harness.client.countIncidentsCreated({
          startTime: START,
          endTime: END,
        });
      expect(paged).toEqual({ count: 2, hasMore: true });

      const empty: MicrosoftSentinelIncidentCount =
        await harness.client.countIncidentsCreated({
          startTime: START,
          endTime: END,
          top: 7,
        });
      expect(empty).toEqual({ count: 0, hasMore: false });

      const incidentRequests: Array<DataSourceHttpRequest> =
        harness.requests.filter((request: DataSourceHttpRequest): boolean => {
          return request.url.includes("/incidents");
        });
      expect(incidentRequests).toHaveLength(2);
      expect(new URL(incidentRequests[0]!.url).searchParams.get("$top")).toBe(
        String(MICROSOFT_SENTINEL_DEFAULT_PAGE_SIZE),
      );
      expect(new URL(incidentRequests[1]!.url).searchParams.get("$top")).toBe(
        "7",
      );
    });
  });
});
