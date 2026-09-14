import { describe, expect, test } from "@jest/globals";
import ElasticSecurityClient, {
  ELASTIC_SECURITY_MAX_PAGE_SIZE,
  ElasticAlertCount,
  ElasticKibanaStatus,
  ElasticSearchAlertsResult,
  ElasticSecurityHttpError,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/ElasticSecurity/ElasticSecurityClient";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../../Server/Utils/DataSource/HttpFetch";
import APIException from "../../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../../Types/JSON";

/*
 * The Kibana client contract as the connector depends on it: the status
 * probe, the signals search body (range + size + sort, and nothing the
 * documented endpoint would drop), pagination inputs, the failure taxonomy
 * per status, and — above everything — that the API key can never leave
 * through an error message. The transport is the injected seam; nothing
 * here touches the network.
 */

const KIBANA_URL: string = "https://kibana.example.com";
const SPACE: string = "security";
// base64("VuaCfGcBCdbkQm-e5aOx:ui2lp2axTNmsyakw9tvNnw"), the `encoded` value.
const API_KEY: string =
  "VnVhQ2ZHY0JDZGJrUW0tZTVhT3g6dWkybHAyYXhUTm1zeWFrdzl0dk5udw==";
const START: Date = new Date("2026-09-12T10:00:00.000Z");
const END: Date = new Date("2026-09-13T10:00:00.000Z");

type Responder = (
  request: DataSourceHttpRequest,
) => DataSourceHttpResponse | Promise<DataSourceHttpResponse>;

interface Harness {
  requests: Array<DataSourceHttpRequest>;
  client: ElasticSecurityClient;
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

/* The authenticated status document, trimmed to the fields the client reads. */
function statusBody(): JSONObject {
  return {
    name: "kibana-0",
    uuid: "7f2c9c1e-2b3d-4c5e-8f90-1a2b3c4d5e6f",
    version: {
      number: "9.1.0",
      build_hash: "abc123",
      build_number: 12345,
      build_snapshot: false,
    },
    status: {
      overall: {
        level: "available",
        summary: "All services and plugins are available",
      },
      core: { elasticsearch: { level: "available", summary: "ok" } },
    },
  };
}

/* What an unauthenticated caller gets: the overall level and nothing else. */
function redactedStatusBody(): JSONObject {
  return { status: { overall: { level: "available" } } };
}

function alertHit(id: string, timestamp: string): JSONObject {
  return {
    _index: `.internal.alerts-security.alerts-${SPACE}-000001`,
    _id: id,
    _score: null,
    _source: {
      "@timestamp": timestamp,
      "event.kind": "signal",
      "kibana.alert.uuid": id,
      "kibana.alert.rule.uuid": "5f2d8e1a-6c3b-4e9f-8a7d-1b2c3d4e5f60",
      "kibana.alert.rule.name": "Potential Privilege Escalation via PKEXEC",
      "kibana.alert.severity": "high",
      "kibana.alert.workflow_status": "open",
      host: { name: "web-01" },
    },
    sort: [Date.parse(timestamp)],
  };
}

function searchBody(
  hits: Array<JSONObject>,
  total?: JSONObject | number | undefined,
): JSONObject {
  const envelope: JSONObject = { hits };

  if (total !== undefined) {
    envelope["total"] = total;
  }

  return {
    took: 12,
    timed_out: false,
    _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
    hits: envelope,
  };
}

/*
 * Routes status and search requests to scripted responders. Search
 * responders are consumed in order so a test can script page sequences.
 */
function buildHarness(options: {
  space?: string | undefined;
  kibanaUrl?: string | undefined;
  status?: Responder | undefined;
  search?: Array<Responder> | undefined;
  requestTimeoutInMs?: number | undefined;
}): Harness {
  const requests: Array<DataSourceHttpRequest> = [];
  const searchResponders: Array<Responder> = [...(options.search || [])];

  const client: ElasticSecurityClient = new ElasticSecurityClient({
    kibanaUrl: options.kibanaUrl === undefined ? KIBANA_URL : options.kibanaUrl,
    space: options.space === undefined ? SPACE : options.space,
    apiKey: API_KEY,
    requestTimeoutInMs: options.requestTimeoutInMs || 20000,
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      requests.push(request);

      if (new URL(request.url).pathname.endsWith("/api/status")) {
        const responder: Responder =
          options.status ||
          ((): DataSourceHttpResponse => {
            return ok(statusBody());
          });
        return responder(request);
      }

      const responder: Responder | undefined = searchResponders.shift();

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

function parseBody(request: DataSourceHttpRequest): JSONObject {
  expect(typeof request.body).toBe("string");
  return JSON.parse(request.body as string) as JSONObject;
}

describe("ElasticSecurityClient", () => {
  describe("base URL", () => {
    test("strips trailing slashes and adds the space prefix only for a non-default space", () => {
      expect(
        ElasticSecurityClient.buildBaseUrl("https://kibana.example.com/", ""),
      ).toBe("https://kibana.example.com");
      expect(
        ElasticSecurityClient.buildBaseUrl(
          "https://kibana.example.com//",
          "default",
        ),
      ).toBe("https://kibana.example.com");
      expect(
        ElasticSecurityClient.buildBaseUrl(
          "https://kibana.example.com",
          " security ",
        ),
      ).toBe("https://kibana.example.com/s/security");
    });

    test("URL-encodes a space id so it cannot add path segments", () => {
      expect(
        ElasticSecurityClient.buildBaseUrl("https://kibana.example.com", "a/b"),
      ).toBe("https://kibana.example.com/s/a%2Fb");
    });
  });

  describe("status request", () => {
    test("GETs /api/status under the space with the ApiKey header, kbn-xsrf, the timeout and no query string", async () => {
      const harness: Harness = buildHarness({ requestTimeoutInMs: 12345 });

      const result: ElasticKibanaStatus = await harness.client.getStatus();

      expect(result).toEqual({
        name: "kibana-0",
        version: "9.1.0",
        level: "available",
        summary: "All services and plugins are available",
        authenticated: true,
      });
      expect(harness.requests).toHaveLength(1);

      const request: DataSourceHttpRequest = harness.requests[0]!;
      const url: URL = new URL(request.url);

      expect(request.method).toBe("GET");
      expect(url.origin).toBe(KIBANA_URL);
      expect(url.pathname).toBe(`/s/${SPACE}/api/status`);
      expect(Array.from(url.searchParams.keys()).sort()).toEqual([]);
      expect(request.headers?.["Authorization"]).toBe(`ApiKey ${API_KEY}`);
      expect(request.headers?.["kbn-xsrf"]).toBe("true");
      expect(request.headers?.["Accept"]).toBe("application/json");
      expect(request.timeoutInMs).toBe(12345);
      expect(request.body).toBeUndefined();
      expect(harness.client.getRequestCount()).toBe(1);
    });

    test("uses no space prefix for the default space", async () => {
      const harness: Harness = buildHarness({ space: "" });

      await harness.client.getStatus();

      expect(new URL(harness.requests[0]!.url).pathname).toBe("/api/status");
    });

    test("reports a redacted status document as not authenticated", async () => {
      const harness: Harness = buildHarness({
        status: (): DataSourceHttpResponse => {
          return ok(redactedStatusBody());
        },
      });

      const result: ElasticKibanaStatus = await harness.client.getStatus();

      expect(result.authenticated).toBe(false);
      expect(result.level).toBe("available");
      expect(result.name).toBe("");
      expect(result.version).toBe("");
    });

    test("reports a non-JSON status body without guessing", async () => {
      const harness: Harness = buildHarness({
        status: (): DataSourceHttpResponse => {
          return status(200, "<html><title>Log in</title></html>");
        },
      });

      const error: APIException = await expectRejection(
        harness.client.getStatus(),
      );

      expect(error.message).toBe(
        "Elastic Security status request returned a non-JSON body.",
      );
    });

    test("reports a JSON status body without a status object as an unrecognized shape", async () => {
      const harness: Harness = buildHarness({
        status: (): DataSourceHttpResponse => {
          return ok({ ok: true, service: "gateway" });
        },
      });

      const error: APIException = await expectRejection(
        harness.client.getStatus(),
      );

      expect(error.message).toBe(
        'Elastic Security status request returned an unrecognized response shape: {"ok":true,"service":"gateway"}',
      );
    });

    test("names the status step and the status on a 401, keeps Kibana's reason, and never echoes the key", async () => {
      const kibanaBody: string = JSON.stringify({
        statusCode: 401,
        error: "Unauthorized",
        message: `[security_exception] unable to authenticate with provided credentials and anonymous access is not allowed for this request; Authorization: ApiKey ${API_KEY}`,
      });
      const harness: Harness = buildHarness({
        status: (): DataSourceHttpResponse => {
          return status(401, kibanaBody);
        },
      });

      const error: APIException = await expectRejection(
        harness.client.getStatus(),
      );

      expect(error).toBeInstanceOf(ElasticSecurityHttpError);
      expect((error as ElasticSecurityHttpError).statusCode).toBe(401);
      expect(error.message).toMatch(
        /^Elastic Security status request failed \(HTTP 401\): /,
      );
      expect(error.message).toContain("unable to authenticate");
      expect(error.message).toContain("did not accept the API key");
      expect(error.message).not.toContain(API_KEY);
    });
  });

  describe("alerts search request", () => {
    test("POSTs a range on @timestamp with size and an ascending sort, and nothing the documented body would drop", async () => {
      const harness: Harness = buildHarness({
        requestTimeoutInMs: 4321,
        search: [
          (): DataSourceHttpResponse => {
            return ok(
              searchBody(
                [
                  alertHit("a1", "2026-09-12T10:05:03.412Z"),
                  alertHit("a2", "2026-09-12T11:00:00.000Z"),
                ],
                { value: 2, relation: "eq" },
              ),
            );
          },
        ],
      });

      const page: ElasticSearchAlertsResult = await harness.client.searchAlerts(
        { startTime: START, endTime: END, size: 500 },
      );

      expect(
        page.hits.map((hit: { id: string }): string => {
          return hit.id;
        }),
      ).toEqual(["a1", "a2"]);
      expect(page.hits[0]!.index).toBe(
        `.internal.alerts-security.alerts-${SPACE}-000001`,
      );
      expect(page.hits[0]!.timestamp).toBe("2026-09-12T10:05:03.412Z");
      expect(page.hits[0]!.source["kibana.alert.rule.name"]).toBe(
        "Potential Privilege Escalation via PKEXEC",
      );
      expect(page.total).toBe(2);
      expect(page.totalRelation).toBe("eq");

      const request: DataSourceHttpRequest = harness.requests[0]!;
      const url: URL = new URL(request.url);

      expect(request.method).toBe("POST");
      expect(url.origin).toBe(KIBANA_URL);
      expect(url.pathname).toBe(
        `/s/${SPACE}/api/detection_engine/signals/search`,
      );
      expect(Array.from(url.searchParams.keys()).sort()).toEqual([]);
      expect(request.headers?.["Authorization"]).toBe(`ApiKey ${API_KEY}`);
      expect(request.headers?.["kbn-xsrf"]).toBe("true");
      expect(request.headers?.["Content-Type"]).toBe("application/json");
      expect(request.timeoutInMs).toBe(4321);
      expect(request.formUrlEncoded).toBeUndefined();

      const body: JSONObject = parseBody(request);
      expect(Object.keys(body).sort()).toEqual(["query", "size", "sort"]);
      expect(body["query"]).toEqual({
        range: {
          "@timestamp": {
            gte: START.toISOString(),
            lt: END.toISOString(),
          },
        },
      });
      expect(body["size"]).toBe(500);
      expect(body["sort"]).toEqual([{ "@timestamp": "asc" }]);
    });

    test("accepts ISO strings as bounds and clamps the page size to the maximum", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return ok(searchBody([]));
          },
        ],
      });

      await harness.client.searchAlerts({
        startTime: "2026-09-12T10:05:03.412Z",
        endTime: "2026-09-13T00:00:00.000Z",
        size: 5000,
      });

      const body: JSONObject = parseBody(harness.requests[0]!);
      expect(body["size"]).toBe(ELASTIC_SECURITY_MAX_PAGE_SIZE);
      expect((body["query"] as JSONObject)["range"] as JSONObject).toEqual({
        "@timestamp": {
          gte: "2026-09-12T10:05:03.412Z",
          lt: "2026-09-13T00:00:00.000Z",
        },
      });
    });

    test("sends size 0 with track_total_hits and no sort for a count", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return ok(searchBody([], { value: 12, relation: "eq" }));
          },
        ],
      });

      const count: ElasticAlertCount = await harness.client.countAlerts({
        startTime: START,
        endTime: END,
      });

      expect(count).toEqual({ count: 12, exact: true });

      const body: JSONObject = parseBody(harness.requests[0]!);
      expect(Object.keys(body).sort()).toEqual([
        "query",
        "size",
        "track_total_hits",
      ]);
      expect(body["size"]).toBe(0);
      expect(body["track_total_hits"]).toBe(true);
    });

    test("flags a lower-bound total as inexact and reads a bare numeric total", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return ok(searchBody([], { value: 10000, relation: "gte" }));
          },
          (): DataSourceHttpResponse => {
            return ok(searchBody([], 7));
          },
        ],
      });

      const floor: ElasticAlertCount = await harness.client.countAlerts({
        startTime: START,
        endTime: END,
      });
      expect(floor).toEqual({ count: 10000, exact: false });

      const bare: ElasticAlertCount = await harness.client.countAlerts({
        startTime: START,
        endTime: END,
      });
      expect(bare).toEqual({ count: 7, exact: true });
    });

    test("reports a count response without hits.total as an unrecognized shape", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return ok(searchBody([]));
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.countAlerts({ startTime: START, endTime: END }),
      );

      expect(error.message).toBe(
        "Elastic Security alerts search returned an unrecognized response shape: hits.total is missing.",
      );
    });

    test("drops non-object hits and tolerates a hit without _source", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return ok(
              searchBody([
                alertHit("a1", "2026-09-12T10:05:03.412Z"),
                "junk" as never,
                null as never,
                { _id: "a3", _index: "x" },
              ]),
            );
          },
        ],
      });

      const page: ElasticSearchAlertsResult = await harness.client.searchAlerts(
        { startTime: START, endTime: END, size: 10 },
      );

      expect(page.hits).toHaveLength(2);
      expect(page.hits[1]).toEqual({
        id: "a3",
        index: "x",
        source: {},
        timestamp: "",
      });
      expect(page.total).toBeNull();
      expect(page.totalRelation).toBeNull();
    });

    test("explains a 403 with the exact index and feature privileges", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return status(
              403,
              JSON.stringify({
                statusCode: 403,
                error: "Forbidden",
                message:
                  "[security_exception] action [indices:data/read/search] is unauthorized for API key id [VuaCfGcBCdbkQm-e5aOx] of user [elastic] on indices [.alerts-security.alerts-security]",
              }),
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.searchAlerts({
          startTime: START,
          endTime: END,
          size: 1,
        }),
      );

      expect((error as ElasticSecurityHttpError).statusCode).toBe(403);
      expect(error.message).toMatch(
        /^Elastic Security alerts search failed \(HTTP 403\): /,
      );
      expect(error.message).toContain("indices:data/read/search");
      expect(error.message).toContain(".alerts-security.alerts-<space-id>");
      expect(error.message).toContain("view_index_metadata");
    });

    test("explains a 404 as a wrong Kibana URL or space", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return status(
              404,
              JSON.stringify({
                statusCode: 404,
                error: "Not Found",
                message: "Not Found",
              }),
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.searchAlerts({
          startTime: START,
          endTime: END,
          size: 1,
        }),
      );

      expect(error.message).toMatch(
        /^Elastic Security alerts search failed \(HTTP 404\): /,
      );
      expect(error.message).toContain("Check the Kibana URL");
    });

    test("reports throttling with a retry hint", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return status(
              429,
              JSON.stringify({
                statusCode: 429,
                error: "Too Many Requests",
                message: "rate limit exceeded",
              }),
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.searchAlerts({
          startTime: START,
          endTime: END,
          size: 1,
        }),
      );

      expect((error as ElasticSecurityHttpError).statusCode).toBe(429);
      expect(error.message).toMatch(
        /^Elastic Security alerts search failed \(HTTP 429\): /,
      );
      expect(error.message).toContain("rate limiting");
    });

    test("reports a 500 as Kibana's fault and keeps the body, and a 503 as unavailable", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return status(500, "<html>Internal Server Error</html>");
          },
          (): DataSourceHttpResponse => {
            return status(
              503,
              JSON.stringify({
                statusCode: 503,
                error: "Service Unavailable",
                message: "License is not available",
              }),
            );
          },
        ],
      });

      const internal: APIException = await expectRejection(
        harness.client.searchAlerts({
          startTime: START,
          endTime: END,
          size: 1,
        }),
      );
      expect(internal.message).toMatch(
        /^Elastic Security alerts search failed \(HTTP 500\): <html>Internal Server Error<\/html>/,
      );
      expect(internal.message).toContain("failed internally");

      const unavailable: APIException = await expectRejection(
        harness.client.searchAlerts({
          startTime: START,
          endTime: END,
          size: 1,
        }),
      );
      expect(unavailable.message).toMatch(
        /^Elastic Security alerts search failed \(HTTP 503\): /,
      );
      expect(unavailable.message).toContain("unavailable");
    });

    test("folds the transport's own HTTP-status exception back into the status taxonomy", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              `Data source responded with HTTP 401: ${JSON.stringify({
                statusCode: 401,
                error: "Unauthorized",
                message: "Unauthorized",
              })}`,
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.searchAlerts({
          startTime: START,
          endTime: END,
          size: 1,
        }),
      );

      expect(error).toBeInstanceOf(ElasticSecurityHttpError);
      expect((error as ElasticSecurityHttpError).statusCode).toBe(401);
      expect(error.message).toMatch(
        /^Elastic Security alerts search failed \(HTTP 401\): /,
      );
      expect(error.message).toContain("Unauthorized");
    });

    test("surfaces a timeout on the search step as a did-not-complete error without a status", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              "Could not reach data source: timeout of 20000ms exceeded",
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.searchAlerts({
          startTime: START,
          endTime: END,
          size: 1,
        }),
      );

      expect(error).not.toBeInstanceOf(ElasticSecurityHttpError);
      expect(error.message).toBe(
        "Elastic Security alerts search did not complete: Could not reach data source: timeout of 20000ms exceeded",
      );
    });

    test("surfaces a timeout on the status step under the status prefix", async () => {
      const harness: Harness = buildHarness({
        status: (): DataSourceHttpResponse => {
          throw new BadDataException(
            "Could not reach data source: timeout of 20000ms exceeded",
          );
        },
      });

      const error: APIException = await expectRejection(
        harness.client.getStatus(),
      );

      expect(error.message).toBe(
        "Elastic Security status request did not complete: Could not reach data source: timeout of 20000ms exceeded",
      );
    });

    test("reports a non-JSON search body rather than treating it as an empty window", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return status(200, "<html>ok</html>");
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.searchAlerts({
          startTime: START,
          endTime: END,
          size: 1,
        }),
      );

      expect(error.message).toBe(
        "Elastic Security alerts search returned a non-JSON body.",
      );
    });

    test("reports a JSON error envelope on a 200 as an unrecognized shape instead of an empty window", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return ok({
              statusCode: 404,
              error: "Not Found",
              message: "Not Found",
            });
          },
          (): DataSourceHttpResponse => {
            return ok({ hits: { hits: "nope" } });
          },
        ],
      });

      const envelope: APIException = await expectRejection(
        harness.client.searchAlerts({
          startTime: START,
          endTime: END,
          size: 1,
        }),
      );
      expect(envelope.message).toBe(
        'Elastic Security alerts search returned an unrecognized response shape: {"statusCode":404,"error":"Not Found","message":"Not Found"}',
      );

      const notArray: APIException = await expectRejection(
        harness.client.searchAlerts({
          startTime: START,
          endTime: END,
          size: 1,
        }),
      );
      expect(notArray.message).toBe(
        "Elastic Security alerts search returned an unrecognized response shape: hits.hits is not an array.",
      );
    });

    test("redacts the API key and other credentials Kibana echoes back in an error body", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return status(
              400,
              JSON.stringify({
                statusCode: 400,
                error: "Bad Request",
                message: `Authorization: ApiKey ${API_KEY} was malformed`,
                api_key: API_KEY,
                password: "hunter2",
              }),
            );
          },
          (): DataSourceHttpResponse => {
            return status(400, `plain text mentioning ${API_KEY} verbatim`);
          },
        ],
      });

      const json: APIException = await expectRejection(
        harness.client.searchAlerts({
          startTime: START,
          endTime: END,
          size: 1,
        }),
      );
      expect(json.message).toMatch(
        /^Elastic Security alerts search failed \(HTTP 400\): /,
      );
      expect(json.message).not.toContain(API_KEY);
      expect(json.message).not.toContain("hunter2");
      expect(json.message).toContain("[REDACTED]");

      const text: APIException = await expectRejection(
        harness.client.searchAlerts({
          startTime: START,
          endTime: END,
          size: 1,
        }),
      );
      expect(text.message).not.toContain(API_KEY);
      expect(text.message).toContain(
        "plain text mentioning [REDACTED] verbatim",
      );
    });

    test("counts every request sent through the transport, failures included", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return ok(searchBody([]));
          },
          (): DataSourceHttpResponse => {
            return status(500, "boom");
          },
        ],
      });

      await harness.client.getStatus();
      await harness.client.searchAlerts({
        startTime: START,
        endTime: END,
        size: 1,
      });
      await expectRejection(
        harness.client.searchAlerts({
          startTime: START,
          endTime: END,
          size: 1,
        }),
      );

      expect(harness.client.getRequestCount()).toBe(3);
      expect(harness.requests).toHaveLength(3);
    });
  });
});
