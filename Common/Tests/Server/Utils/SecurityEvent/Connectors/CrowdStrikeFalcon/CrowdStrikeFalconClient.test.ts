import { afterEach, describe, expect, jest, test } from "@jest/globals";
import CrowdStrikeFalconClient, {
  CROWDSTRIKE_ALERTS_ENTITY_BATCH_SIZE,
  CROWDSTRIKE_ALERTS_QUERY_MAX_LIMIT,
  CROWDSTRIKE_FALCON_CLOUD_BASE_URLS,
  CrowdStrikeAlertCount,
  CrowdStrikeAlertIdsPage,
  CrowdStrikeFalconCloud,
  getCrowdStrikeFalconBaseUrl,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/CrowdStrikeFalcon/CrowdStrikeFalconClient";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../../Server/Utils/DataSource/HttpFetch";
import APIException from "../../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import Dictionary from "../../../../../../Types/Dictionary";
import { JSONObject } from "../../../../../../Types/JSON";

/*
 * The Falcon client contract as the connector depends on it: the token
 * request shape, the alerts query URL, offset pagination metadata, the
 * entity fetch body, the 401 retry, the failure taxonomy per status, and
 * — above everything — that no credential can leave through an error
 * message. The transport is the injected seam; nothing here touches the
 * network.
 */

const CLIENT_ID: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const CLIENT_SECRET: string = "Zx9YwV8uT7sR6qP5oN4mL3kJ2iH1gF0eDcBa";
const ACCESS_TOKEN: string =
  "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmYWxjb24ifQ.c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWduYXR1cmU";
const START: Date = new Date("2026-09-12T10:00:00.000Z");
const END: Date = new Date("2026-09-13T10:00:00.000Z");
const CID: string = "92012896127c4a8236ba7601b886b0";

type Responder = (
  request: DataSourceHttpRequest,
) => DataSourceHttpResponse | Promise<DataSourceHttpResponse>;

interface Harness {
  requests: Array<DataSourceHttpRequest>;
  client: CrowdStrikeFalconClient;
}

function ok(
  body: JSONObject,
  statusCode: number = 200,
  headers?: Dictionary<string>,
): DataSourceHttpResponse {
  return {
    statusCode,
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
  // Falcon answers the token request with 201, not 200.
  return ok(
    {
      access_token: ACCESS_TOKEN,
      expires_in: 1799,
      token_type: "bearer",
    },
    201,
  );
}

function compositeId(index: number): string {
  return `${CID}:ind:2ce412d17b334ad4adc8c1c54dbfec4b:39974868799${index}-5761-42627600`;
}

function idsPage(
  ids: Array<string>,
  pagination?: JSONObject | null,
): DataSourceHttpResponse {
  const body: JSONObject = {
    meta: {
      query_time: 0.012,
      powered_by: "detectsapi",
      trace_id: "c3b9d1c2-7a5e-4c4a-9d0a-2c1f6e9d1a11",
      ...(pagination === null
        ? {}
        : {
            pagination: pagination || {
              total: ids.length,
              offset: 0,
              limit: 1000,
            },
          }),
    },
    resources: ids,
    errors: [],
  };

  return ok(body);
}

function alert(id: string): JSONObject {
  return {
    composite_id: id,
    id: id.split(":").slice(1).join(":"),
    cid: CID,
    name: "PrewittPupAdwareSensorDetect-Lowest",
    severity: 21,
    severity_name: "low",
    status: "new",
    created_timestamp: "2026-09-12T18:01:23.995Z",
  };
}

/*
 * Routes token, query and entity requests to scripted responders. Query
 * and entity responders are consumed in order so a test can script
 * "401 then 200".
 */
function buildHarness(options: {
  cloud?: string;
  token?: Responder | Array<Responder>;
  queries?: Array<Responder>;
  entities?: Array<Responder>;
  requestTimeoutInMs?: number;
}): Harness {
  const requests: Array<DataSourceHttpRequest> = [];
  const tokenResponders: Array<Responder> = Array.isArray(options.token)
    ? [...options.token]
    : [options.token || tokenResponse];
  const queryResponders: Array<Responder> = [...(options.queries || [])];
  const entityResponders: Array<Responder> = [...(options.entities || [])];

  const client: CrowdStrikeFalconClient = new CrowdStrikeFalconClient({
    cloud: options.cloud || "us-1",
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    requestTimeoutInMs: options.requestTimeoutInMs || 20000,
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      requests.push(request);

      const url: URL = new URL(request.url);

      if (url.pathname === "/oauth2/token") {
        const responder: Responder | undefined =
          tokenResponders.length > 1
            ? tokenResponders.shift()
            : tokenResponders[0];
        return responder!(request);
      }

      const responders: Array<Responder> =
        url.pathname === "/alerts/queries/alerts/v2"
          ? queryResponders
          : url.pathname === "/alerts/entities/alerts/v2"
            ? entityResponders
            : [];
      const responder: Responder | undefined = responders.shift();

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

describe("CrowdStrikeFalconClient", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe("clouds", () => {
    test.each<[CrowdStrikeFalconCloud, string]>([
      ["us-1", "https://api.crowdstrike.com"],
      ["us-2", "https://api.us-2.crowdstrike.com"],
      ["eu-1", "https://api.eu-1.crowdstrike.com"],
      ["us-gov-1", "https://api.laggar.gcw.crowdstrike.com"],
    ])("%s -> %s", (cloud: CrowdStrikeFalconCloud, baseUrl: string) => {
      expect(CROWDSTRIKE_FALCON_CLOUD_BASE_URLS[cloud]).toBe(baseUrl);
      expect(getCrowdStrikeFalconBaseUrl(cloud)).toBe(baseUrl);
      expect(getCrowdStrikeFalconBaseUrl(cloud.toUpperCase())).toBe(baseUrl);
      expect(buildHarness({ cloud }).client.getBaseUrl()).toBe(baseUrl);
    });

    test("rejects an unknown cloud before anything is contacted", () => {
      expect(getCrowdStrikeFalconBaseUrl("ap-1")).toBeNull();
      expect(getCrowdStrikeFalconBaseUrl("")).toBeNull();

      expect(() => {
        return new CrowdStrikeFalconClient({
          cloud: "ap-1",
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
          requestTimeoutInMs: 1000,
          transport: (): Promise<DataSourceHttpResponse> => {
            throw new Error("must not be called");
          },
        });
      }).toThrow(APIException);
    });
  });

  describe("token request", () => {
    test("posts client_id and client_secret as a form body to /oauth2/token with the configured timeout", async () => {
      const harness: Harness = buildHarness({ requestTimeoutInMs: 12345 });

      const token: string = await harness.client.getAccessToken();

      expect(token).toBe(ACCESS_TOKEN);
      expect(harness.requests).toHaveLength(1);

      const request: DataSourceHttpRequest = harness.requests[0]!;
      expect(request.method).toBe("POST");
      expect(request.url).toBe("https://api.crowdstrike.com/oauth2/token");
      expect(request.formUrlEncoded).toBe(true);
      expect(request.timeoutInMs).toBe(12345);
      expect(request.headers?.["Accept"]).toBe("application/json");
      expect(request.headers?.["Authorization"]).toBeUndefined();

      const body: Dictionary<string> = request.body as Dictionary<string>;
      expect(Object.keys(body).sort()).toEqual(["client_id", "client_secret"]);
      expect(body["client_id"]).toBe(CLIENT_ID);
      expect(body["client_secret"]).toBe(CLIENT_SECRET);
    });

    test("uses the cloud's hostname for the token endpoint", async () => {
      const harness: Harness = buildHarness({ cloud: "eu-1" });

      await harness.client.getAccessToken();

      expect(harness.requests[0]!.url).toBe(
        "https://api.eu-1.crowdstrike.com/oauth2/token",
      );
    });

    test("caches the token across requests on the same instance and counts every request", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage([]);
          },
          (): DataSourceHttpResponse => {
            return idsPage([]);
          },
        ],
      });

      await harness.client.queryAlertIds({ filter: "x", limit: 1, offset: 0 });
      await harness.client.queryAlertIds({ filter: "x", limit: 1, offset: 0 });

      const tokenRequests: Array<DataSourceHttpRequest> =
        harness.requests.filter((request: DataSourceHttpRequest): boolean => {
          return request.url.endsWith("/oauth2/token");
        });
      expect(tokenRequests).toHaveLength(1);
      expect(harness.client.getRequestCount()).toBe(3);
    });

    test("requests a new token once expires_in has elapsed", async () => {
      jest.useFakeTimers({ now: new Date("2026-09-13T10:00:00.000Z") });

      const harness: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          return ok(
            {
              access_token: ACCESS_TOKEN,
              expires_in: 120,
              token_type: "bearer",
            },
            201,
          );
        },
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage([]);
          },
          (): DataSourceHttpResponse => {
            return idsPage([]);
          },
          (): DataSourceHttpResponse => {
            return idsPage([]);
          },
        ],
      });

      await harness.client.queryAlertIds({ filter: "x", limit: 1, offset: 0 });
      // 30 seconds later: still within expires_in minus the safety margin.
      jest.setSystemTime(new Date("2026-09-13T10:00:30.000Z"));
      await harness.client.queryAlertIds({ filter: "x", limit: 1, offset: 0 });
      // 90 seconds later: past the 60 second margin, so a fresh token is minted.
      jest.setSystemTime(new Date("2026-09-13T10:01:30.000Z"));
      await harness.client.queryAlertIds({ filter: "x", limit: 1, offset: 0 });

      const tokenRequests: Array<DataSourceHttpRequest> =
        harness.requests.filter((request: DataSourceHttpRequest): boolean => {
          return request.url.endsWith("/oauth2/token");
        });
      expect(tokenRequests).toHaveLength(2);
    });

    test("names the token step and the status on a rejection and never echoes the secret", async () => {
      const falconBody: string = JSON.stringify({
        meta: { query_time: 0.001, powered_by: "crowdstrike-api-gateway" },
        errors: [
          {
            code: 401,
            message: `access denied, invalid bearer token; client_secret=${CLIENT_SECRET}`,
          },
        ],
      });
      const harness: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          return status(401, falconBody);
        },
      });

      const error: APIException = await expectRejection(
        harness.client.getAccessToken(),
      );

      expect(error.message).toMatch(
        /^CrowdStrike Falcon token request failed \(HTTP 401\): /,
      );
      expect(error.message).toContain("access denied");
      expect(error.message).not.toContain(CLIENT_SECRET);
    });

    test("names a 403 from the token endpoint (wrong cloud) without guessing", async () => {
      const harness: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          return status(
            403,
            JSON.stringify({
              errors: [
                { code: 403, message: "access denied, authorization failed" },
              ],
            }),
          );
        },
      });

      const error: APIException = await expectRejection(
        harness.client.getAccessToken(),
      );

      expect(error.message).toMatch(
        /^CrowdStrike Falcon token request failed \(HTTP 403\): /,
      );
      expect(error.message).toContain("authorization failed");
    });

    test("reports a non-JSON token body without guessing", async () => {
      const harness: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          return status(201, "<html>gateway</html>");
        },
      });

      const error: APIException = await expectRejection(
        harness.client.getAccessToken(),
      );

      expect(error.message).toBe(
        "CrowdStrike Falcon token request returned a non-JSON body.",
      );
    });

    test("reports a JSON token body that carries no access_token", async () => {
      const harness: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          return ok({ token_type: "bearer", expires_in: 1799 }, 201);
        },
      });

      const error: APIException = await expectRejection(
        harness.client.getAccessToken(),
      );

      expect(error.message).toBe(
        "CrowdStrike Falcon token request returned no access_token.",
      );
    });

    test("surfaces a transport timeout on the token step as a could-not-be-completed error", async () => {
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
        "CrowdStrike Falcon token request could not be completed: Could not reach data source: timeout of 20000ms exceeded",
      );
    });

    test("scrubs the secret from a transport error that echoes the request", async () => {
      const harness: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          throw new Error(
            `socket hang up while sending client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`,
          );
        },
      });

      const error: APIException = await expectRejection(
        harness.client.getAccessToken(),
      );

      expect(error.message).toMatch(
        /^CrowdStrike Falcon token request could not be completed: /,
      );
      expect(error.message).not.toContain(CLIENT_SECRET);
    });
  });

  describe("alerts query", () => {
    test("builds the created_timestamp FQL window as a half-open range joined with +", () => {
      expect(
        CrowdStrikeFalconClient.buildCreatedTimestampFilter(START, END),
      ).toBe(
        "created_timestamp:>='2026-09-12T10:00:00.000Z'+created_timestamp:<'2026-09-13T10:00:00.000Z'",
      );
    });

    test("sends filter, sort, limit and offset with a bearer token, and nothing else", async () => {
      const harness: Harness = buildHarness({
        requestTimeoutInMs: 4321,
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage([compositeId(1), compositeId(2)], {
              total: 2,
              offset: 0,
              limit: 1000,
            });
          },
        ],
      });
      const filter: string =
        CrowdStrikeFalconClient.buildCreatedTimestampFilter(START, END);

      const page: CrowdStrikeAlertIdsPage = await harness.client.queryAlertIds({
        filter,
        limit: 1000,
        offset: 0,
      });

      expect(page).toEqual({
        compositeIds: [compositeId(1), compositeId(2)],
        total: 2,
        offset: 0,
        limit: 1000,
      });

      const request: DataSourceHttpRequest = harness.requests[1]!;
      const url: URL = new URL(request.url);

      expect(request.method).toBe("GET");
      expect(url.origin).toBe("https://api.crowdstrike.com");
      expect(url.pathname).toBe("/alerts/queries/alerts/v2");
      expect(Array.from(url.searchParams.keys()).sort()).toEqual([
        "filter",
        "limit",
        "offset",
        "sort",
      ]);
      expect(url.searchParams.get("filter")).toBe(filter);
      // The `+` conjunction must survive as a literal plus, not become a space.
      expect(url.search).toContain("%2Bcreated_timestamp");
      expect(url.searchParams.get("sort")).toBe("created_timestamp.asc");
      expect(url.searchParams.get("limit")).toBe("1000");
      expect(url.searchParams.get("offset")).toBe("0");
      expect(request.headers?.["Authorization"]).toBe(`Bearer ${ACCESS_TOKEN}`);
      expect(request.headers?.["Accept"]).toBe("application/json");
      expect(request.timeoutInMs).toBe(4321);
      expect(request.body).toBeUndefined();
    });

    test("forwards the offset and an explicit sort", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage([]);
          },
        ],
      });

      await harness.client.queryAlertIds({
        filter: "x",
        limit: 50,
        offset: 2000,
        sort: "composite_id.asc",
      });

      const url: URL = new URL(harness.requests[1]!.url);
      expect(url.searchParams.get("offset")).toBe("2000");
      expect(url.searchParams.get("limit")).toBe("50");
      expect(url.searchParams.get("sort")).toBe("composite_id.asc");
    });

    test("refuses an out-of-range limit or a negative offset before sending anything", async () => {
      const harness: Harness = buildHarness({});

      await expectRejection(
        harness.client.queryAlertIds({ filter: "x", limit: 0, offset: 0 }),
      );
      await expectRejection(
        harness.client.queryAlertIds({
          filter: "x",
          limit: CROWDSTRIKE_ALERTS_QUERY_MAX_LIMIT + 1,
          offset: 0,
        }),
      );
      await expectRejection(
        harness.client.queryAlertIds({ filter: "x", limit: 1, offset: -1 }),
      );

      expect(harness.requests).toHaveLength(0);
    });

    test("tolerates a null resources array and a missing pagination block", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return ok({
              meta: { query_time: 0.01 },
              resources: null,
              errors: [],
            });
          },
        ],
      });

      const page: CrowdStrikeAlertIdsPage = await harness.client.queryAlertIds({
        filter: "x",
        limit: 7,
        offset: 3,
      });

      expect(page).toEqual({
        compositeIds: [],
        total: null,
        offset: 3,
        limit: 7,
      });
    });

    test("drops non-string entries from resources", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return ok({
              meta: { pagination: { total: "3", offset: "0", limit: "10" } },
              resources: [compositeId(1), 42, null, "", compositeId(2)],
            });
          },
        ],
      });

      const page: CrowdStrikeAlertIdsPage = await harness.client.queryAlertIds({
        filter: "x",
        limit: 10,
        offset: 0,
      });

      expect(page.compositeIds).toEqual([compositeId(1), compositeId(2)]);
      expect(page.total).toBe(3);
    });

    test("retries once with a fresh token after a 401 on a cached token", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage([]);
          },
          (): DataSourceHttpResponse => {
            return status(
              401,
              JSON.stringify({
                errors: [
                  { code: 401, message: "access denied, invalid bearer token" },
                ],
              }),
            );
          },
          (): DataSourceHttpResponse => {
            return idsPage([compositeId(1)]);
          },
        ],
      });

      await harness.client.queryAlertIds({ filter: "x", limit: 1, offset: 0 });
      const page: CrowdStrikeAlertIdsPage = await harness.client.queryAlertIds({
        filter: "x",
        limit: 1,
        offset: 0,
      });

      expect(page.compositeIds).toEqual([compositeId(1)]);
      expect(
        harness.requests.map((request: DataSourceHttpRequest): string => {
          return new URL(request.url).pathname;
        }),
      ).toEqual([
        "/oauth2/token",
        "/alerts/queries/alerts/v2",
        "/alerts/queries/alerts/v2",
        "/oauth2/token",
        "/alerts/queries/alerts/v2",
      ]);
    });

    test("does not retry a 401 answered to a freshly minted token", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return status(
              401,
              JSON.stringify({
                errors: [
                  { code: 401, message: "access denied, invalid bearer token" },
                ],
              }),
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.queryAlertIds({ filter: "x", limit: 1, offset: 0 }),
      );

      expect(error.message).toMatch(
        /^CrowdStrike Falcon alerts query failed \(HTTP 401\): /,
      );
      expect(harness.requests).toHaveLength(2);
    });

    test("names the query step on a 403 (missing Alerts: Read scope)", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return status(
              403,
              JSON.stringify({
                errors: [
                  { code: 403, message: "access denied, authorization failed" },
                ],
              }),
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.queryAlertIds({ filter: "x", limit: 1, offset: 0 }),
      );

      expect(error.message).toMatch(
        /^CrowdStrike Falcon alerts query failed \(HTTP 403\): /,
      );
      expect(error.message).toContain("authorization failed");
    });

    test("names the X-RateLimit-RetryAfter header and its value on a 429", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return status(
              429,
              JSON.stringify({
                errors: [{ code: 429, message: "Too Many Requests" }],
              }),
              {
                "x-ratelimit-limit": "6000",
                "x-ratelimit-remaining": "0",
                "x-ratelimit-retryafter": "1757757600",
              },
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.queryAlertIds({ filter: "x", limit: 1, offset: 0 }),
      );

      expect(error.message).toMatch(
        /^CrowdStrike Falcon alerts query failed \(HTTP 429\): /,
      );
      expect(error.message).toContain("X-RateLimit-RetryAfter: 1757757600");
    });

    test("says when the X-RateLimit-RetryAfter header was not available on a 429", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return status(
              429,
              JSON.stringify({
                errors: [{ code: 429, message: "Too Many Requests" }],
              }),
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.queryAlertIds({ filter: "x", limit: 1, offset: 0 }),
      );

      expect(error.message).toContain(
        "X-RateLimit-RetryAfter header was not available",
      );
    });

    test("names the query step on a 500 and bounds a huge body", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return status(500, "x".repeat(10000));
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.queryAlertIds({ filter: "x", limit: 1, offset: 0 }),
      );

      expect(error.message).toMatch(
        /^CrowdStrike Falcon alerts query failed \(HTTP 500\): /,
      );
      expect(error.message.length).toBeLessThan(2200);
      expect(error.message).toContain("... (truncated)");
    });

    test("recovers the status and body from a transport that throws on non-2xx", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              'Data source responded with HTTP 403: {"errors":[{"code":403,"message":"access denied, authorization failed"}]}',
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.queryAlertIds({ filter: "x", limit: 1, offset: 0 }),
      );

      expect(error.message).toMatch(
        /^CrowdStrike Falcon alerts query failed \(HTTP 403\): /,
      );
      expect(error.message).toContain("authorization failed");
    });

    test("reports a non-JSON query body", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return status(200, "<html>maintenance</html>");
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.queryAlertIds({ filter: "x", limit: 1, offset: 0 }),
      );

      expect(error.message).toBe(
        "CrowdStrike Falcon alerts query returned a non-JSON body.",
      );
    });

    test("reports an unrecognized query response shape", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return ok({ resources: "not-a-list" });
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.queryAlertIds({ filter: "x", limit: 1, offset: 0 }),
      );

      expect(error.message).toMatch(
        /^CrowdStrike Falcon alerts query returned an unrecognized response shape: /,
      );
    });

    test("surfaces a transport timeout on the query step", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              "Could not reach data source: timeout of 4321ms exceeded",
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.queryAlertIds({ filter: "x", limit: 1, offset: 0 }),
      );

      expect(error.message).toBe(
        "CrowdStrike Falcon alerts query could not be completed: Could not reach data source: timeout of 4321ms exceeded",
      );
    });

    test("never echoes the access token or the secret from an error body", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return status(
              500,
              `upstream error for Authorization: Bearer ${ACCESS_TOKEN} with secret ${CLIENT_SECRET}`,
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.queryAlertIds({ filter: "x", limit: 1, offset: 0 }),
      );

      expect(error.message).not.toContain(ACCESS_TOKEN);
      expect(error.message).not.toContain(CLIENT_SECRET);
    });
  });

  describe("countAlertsCreatedBetween", () => {
    test("probes with limit=1 over the window and returns Falcon's total", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage([compositeId(1)], {
              total: 4321,
              offset: 0,
              limit: 1,
            });
          },
        ],
      });

      const count: CrowdStrikeAlertCount =
        await harness.client.countAlertsCreatedBetween({
          startTime: START,
          endTime: END,
        });

      expect(count).toEqual({ count: 4321, exact: true });

      const url: URL = new URL(harness.requests[1]!.url);
      expect(url.searchParams.get("limit")).toBe("1");
      expect(url.searchParams.get("offset")).toBe("0");
      expect(url.searchParams.get("filter")).toBe(
        CrowdStrikeFalconClient.buildCreatedTimestampFilter(START, END),
      );
    });

    test("falls back to the probe page size when Falcon omits the total", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage([compositeId(1)], null);
          },
        ],
      });

      const count: CrowdStrikeAlertCount =
        await harness.client.countAlertsCreatedBetween({
          startTime: START,
          endTime: END,
        });

      expect(count).toEqual({ count: 1, exact: false });
    });
  });

  describe("alerts fetch", () => {
    test("posts composite_ids as a JSON body with a bearer token and returns the alert objects", async () => {
      const harness: Harness = buildHarness({
        requestTimeoutInMs: 9876,
        entities: [
          (): DataSourceHttpResponse => {
            return ok({
              meta: { query_time: 0.02 },
              resources: [alert(compositeId(1)), "junk", alert(compositeId(2))],
              errors: [],
            });
          },
        ],
      });

      const alerts: Array<JSONObject> = await harness.client.getAlerts([
        compositeId(1),
        compositeId(2),
      ]);

      expect(
        alerts.map((item: JSONObject): string => {
          return String(item["composite_id"]);
        }),
      ).toEqual([compositeId(1), compositeId(2)]);

      const request: DataSourceHttpRequest = harness.requests[1]!;
      expect(request.method).toBe("POST");
      expect(request.url).toBe(
        "https://api.crowdstrike.com/alerts/entities/alerts/v2",
      );
      expect(request.headers?.["Authorization"]).toBe(`Bearer ${ACCESS_TOKEN}`);
      expect(request.headers?.["Content-Type"]).toBe("application/json");
      expect(request.timeoutInMs).toBe(9876);
      expect(request.formUrlEncoded).toBeUndefined();

      const body: JSONObject = JSON.parse(request.body as string);
      expect(Object.keys(body)).toEqual(["composite_ids"]);
      expect(body["composite_ids"]).toEqual([compositeId(1), compositeId(2)]);
    });

    test("sends nothing for an empty id list", async () => {
      const harness: Harness = buildHarness({});

      expect(await harness.client.getAlerts([])).toEqual([]);
      expect(harness.requests).toHaveLength(0);
    });

    test("refuses more ids than one entity request accepts", async () => {
      const harness: Harness = buildHarness({});
      const ids: Array<string> = [];

      for (
        let index: number = 0;
        index <= CROWDSTRIKE_ALERTS_ENTITY_BATCH_SIZE;
        index++
      ) {
        ids.push(compositeId(index));
      }

      const error: APIException = await expectRejection(
        harness.client.getAlerts(ids),
      );

      expect(error.message).toBe(
        `CrowdStrike Falcon alerts fetch accepts at most ${CROWDSTRIKE_ALERTS_ENTITY_BATCH_SIZE} composite ids per request.`,
      );
      expect(harness.requests).toHaveLength(0);
    });

    test("names the fetch step on a 403, 429 and 500", async () => {
      for (const code of [403, 429, 500]) {
        const harness: Harness = buildHarness({
          entities: [
            (): DataSourceHttpResponse => {
              return status(
                code,
                JSON.stringify({ errors: [{ code, message: "nope" }] }),
              );
            },
          ],
        });

        const error: APIException = await expectRejection(
          harness.client.getAlerts([compositeId(1)]),
        );

        expect(error.message).toMatch(
          new RegExp(
            `^CrowdStrike Falcon alerts fetch failed \\(HTTP ${code}\\): `,
          ),
        );
      }
    });

    test("reports a non-JSON fetch body and an unrecognized shape", async () => {
      const nonJson: Harness = buildHarness({
        entities: [
          (): DataSourceHttpResponse => {
            return status(200, "partial");
          },
        ],
      });
      expect(
        (await expectRejection(nonJson.client.getAlerts([compositeId(1)])))
          .message,
      ).toBe("CrowdStrike Falcon alerts fetch returned a non-JSON body.");

      const wrongShape: Harness = buildHarness({
        entities: [
          (): DataSourceHttpResponse => {
            return ok({ resources: { a: 1 } });
          },
        ],
      });
      expect(
        (await expectRejection(wrongShape.client.getAlerts([compositeId(1)])))
          .message,
      ).toMatch(
        /^CrowdStrike Falcon alerts fetch returned an unrecognized response shape: /,
      );
    });

    test("surfaces a transport timeout on the fetch step", async () => {
      const harness: Harness = buildHarness({
        entities: [
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              "Could not reach data source: timeout of 20000ms exceeded",
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.getAlerts([compositeId(1)]),
      );

      expect(error.message).toBe(
        "CrowdStrike Falcon alerts fetch could not be completed: Could not reach data source: timeout of 20000ms exceeded",
      );
    });
  });
});
