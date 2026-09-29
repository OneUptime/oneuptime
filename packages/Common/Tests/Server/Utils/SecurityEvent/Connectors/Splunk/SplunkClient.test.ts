import { describe, expect, test } from "@jest/globals";
import SplunkClient, {
  SPLUNK_MAX_EXPORT_ROWS,
  SplunkClientOptions,
  SplunkCount,
  SplunkCurrentContext,
  SplunkExportResult,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Splunk/SplunkClient";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../../Server/Utils/DataSource/HttpFetch";
import APIException from "../../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import Dictionary from "../../../../../../Types/Dictionary";
import { JSONObject } from "../../../../../../Types/JSON";

/*
 * The Splunk client contract as the connector depends on it: the
 * current-context probe, the export request shape (endpoint, form
 * fields, epoch bounds, row cap), newline-delimited JSON parsing, the
 * v2 -> v1 fallback, the failure taxonomy per status, and — above
 * everything — that no credential can leave through an error message.
 * The transport is the injected seam; nothing here touches the network.
 */

const BASE_URL: string = "https://splunk.example.com:8089";
const API_TOKEN: string =
  "eyJraWQiOiJzcGx1bmsuc2VjcmV0IiwiYWxnIjoiSFM1MTIiLCJ2ZXIiOiJ2MiIsInR0eXAiOiJzdGF0aWMifQ.eyJpc3MiOiJhZG1pbiJ9.c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWduYXR1cmU";
const USERNAME: string = "oneuptime";
const PASSWORD: string = "hunter2-Sup3rSecret";
const START: Date = new Date("2026-09-12T10:00:00.250Z");
const END: Date = new Date("2026-09-13T10:00:00.750Z");

type Responder = (
  request: DataSourceHttpRequest,
) => DataSourceHttpResponse | Promise<DataSourceHttpResponse>;

interface Harness {
  requests: Array<DataSourceHttpRequest>;
  client: SplunkClient;
}

function text(code: number, body: string): DataSourceHttpResponse {
  let bodyJson: unknown = undefined;

  try {
    bodyJson = JSON.parse(body);
  } catch {
    bodyJson = undefined;
  }

  return { statusCode: code, bodyText: body, bodyJson, headers: {} };
}

function ok(body: JSONObject): DataSourceHttpResponse {
  return text(200, JSON.stringify(body));
}

/*
 * Shaped like Splunk's own JSON rendering of the Atom feed for
 * /services/authentication/current-context.
 */
function contextResponse(): DataSourceHttpResponse {
  return ok({
    links: {},
    origin: `${BASE_URL}/services/authentication/current-context`,
    updated: "2026-09-13T10:00:00+00:00",
    generator: { build: "a7f645ddaf91", version: "9.1.2" },
    entry: [
      {
        name: "context",
        id: `${BASE_URL}/services/authentication/current-context/context`,
        updated: "1970-01-01T00:00:00+00:00",
        author: "system",
        content: {
          capabilities: ["search", "rest_properties_get", "list_inputs"],
          defaultApp: "launcher",
          defaultAppIsUserOverride: false,
          defaultAppSourceRole: "system",
          email: "",
          realname: "OneUptime Reader",
          roles: ["oneuptime_reader"],
          type: "Splunk",
          tz: "",
          username: "oneuptime",
        },
      },
    ],
    paging: { total: 1, perPage: 30, offset: 0 },
    messages: [],
  });
}

function notable(eventId: string, ruleName: string): JSONObject {
  return {
    _bkt: "notable~12~C8D6C9F5-4C3B-4F3E-9A3E-0F2B2C9D4E1A",
    _cd: "12:4821",
    _indextime: "1757671200",
    _raw: `09/12/2026 10:15:00 +0000, search_name="${ruleName}", orig_time="1757670900"`,
    _serial: "0",
    _si: ["idx-01", "notable"],
    _sourcetype: "stash",
    _time: "2026-09-12T10:15:00.000+00:00",
    event_id: eventId,
    host: "sh-01",
    index: "notable",
    rule_name: ruleName,
    rule_title: `${ruleName} on wkstn-042`,
    search_name: ruleName,
    security_domain: "access",
    source: ruleName,
    sourcetype: "stash",
    urgency: "high",
    status: "1",
    status_label: "New",
    src: "10.20.30.40",
    dest: "wkstn-042",
    user: "alice",
    "annotations.mitre_attack": ["T1110", "T1110.001"],
  };
}

function exportLine(
  result: JSONObject,
  offset: number,
  last?: boolean,
): string {
  return JSON.stringify({
    preview: false,
    offset,
    ...(last ? { lastrow: true } : {}),
    result,
  });
}

function ndjson(lines: Array<string>): DataSourceHttpResponse {
  return {
    statusCode: 200,
    bodyText: lines.join("\n") + "\n",
    bodyJson: undefined,
    headers: {},
  };
}

/*
 * Routes context and export requests to scripted responders. Export
 * responders are consumed in order so a test can script "404 then 200".
 */
function buildHarness(options: {
  clientOverrides?: Partial<SplunkClientOptions>;
  context?: Responder;
  exports?: Array<Responder>;
  requestTimeoutInMs?: number;
}): Harness {
  const requests: Array<DataSourceHttpRequest> = [];
  const exportResponders: Array<Responder> = [...(options.exports || [])];

  const client: SplunkClient = new SplunkClient({
    url: BASE_URL,
    apiToken: API_TOKEN,
    searchString: "index=notable",
    requestTimeoutInMs: options.requestTimeoutInMs || 20000,
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      requests.push(request);

      if (request.url.includes("/services/authentication/current-context")) {
        return (options.context || contextResponse)(request);
      }

      const responder: Responder | undefined = exportResponders.shift();

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

function sortedKeys(value: Dictionary<string> | undefined): Array<string> {
  return Object.keys(value || {}).sort();
}

describe("SplunkClient", () => {
  describe("settings normalization", () => {
    test("accepts a management URL with a trailing slash and keeps a reverse-proxy path", () => {
      expect(
        SplunkClient.normalizeBaseUrl("https://Splunk.Example.com:8089/"),
      ).toBe("https://splunk.example.com:8089");
      expect(
        SplunkClient.normalizeBaseUrl("https://proxy.example.com/splunk/"),
      ).toBe("https://proxy.example.com/splunk");
    });

    test("rejects non-https, query strings and inline credentials before anything is contacted", () => {
      expect(() => {
        return SplunkClient.normalizeBaseUrl("http://splunk.example.com:8089");
      }).toThrow(BadDataException);
      expect(() => {
        return SplunkClient.normalizeBaseUrl(
          "https://splunk.example.com:8089/?output_mode=json",
        );
      }).toThrow(BadDataException);
      expect(() => {
        return SplunkClient.normalizeBaseUrl(
          `https://${USERNAME}:${PASSWORD}@splunk.example.com:8089`,
        );
      }).toThrow(BadDataException);
      expect(() => {
        return SplunkClient.normalizeBaseUrl("not a url");
      }).toThrow(BadDataException);
    });

    test("strips a pasted leading search command and defaults an empty search to the notable index", () => {
      expect(SplunkClient.normalizeSearchString("search index=notable")).toBe(
        "index=notable",
      );
      expect(SplunkClient.normalizeSearchString("  ")).toBe("index=notable");
      expect(
        SplunkClient.normalizeSearchString(
          'index=notable rule_name="Threat - *"',
        ),
      ).toBe('index=notable rule_name="Threat - *"');
    });

    test("rejects generating commands and time modifiers inside the search", () => {
      expect(() => {
        return SplunkClient.normalizeSearchString(
          "| tstats count from datamodel=Risk",
        );
      }).toThrow(BadDataException);
      expect(() => {
        return SplunkClient.normalizeSearchString("index=notable earliest=-7d");
      }).toThrow(BadDataException);
      expect(() => {
        return SplunkClient.normalizeSearchString("index=notable latest = now");
      }).toThrow(BadDataException);
    });

    test("requires a token or a complete username/password pair", () => {
      expect(() => {
        return new SplunkClient({
          url: BASE_URL,
          username: USERNAME,
          searchString: "index=notable",
          requestTimeoutInMs: 1000,
          transport: (): Promise<DataSourceHttpResponse> => {
            throw new Error("must not be called");
          },
        });
      }).toThrow(BadDataException);
    });

    test("clamps the row cap to the export ceiling", () => {
      expect(SplunkClient.clampRows(0)).toBe(1);
      expect(SplunkClient.clampRows(Number.NaN)).toBe(1);
      expect(SplunkClient.clampRows(2.9)).toBe(2);
      expect(SplunkClient.clampRows(SPLUNK_MAX_EXPORT_ROWS * 5)).toBe(
        SPLUNK_MAX_EXPORT_ROWS,
      );
    });
  });

  describe("current context", () => {
    test("sends a bearer GET to /services/authentication/current-context with output_mode=json and the configured timeout", async () => {
      const harness: Harness = buildHarness({ requestTimeoutInMs: 12345 });

      const context: SplunkCurrentContext =
        await harness.client.getCurrentContext();

      expect(context).toEqual({
        username: "oneuptime",
        roles: ["oneuptime_reader"],
        capabilities: ["search", "rest_properties_get", "list_inputs"],
      });
      expect(harness.requests).toHaveLength(1);

      const request: DataSourceHttpRequest = harness.requests[0]!;
      const url: URL = new URL(request.url);

      expect(request.method).toBe("GET");
      expect(url.origin).toBe(BASE_URL);
      expect(url.pathname).toBe("/services/authentication/current-context");
      expect(Array.from(url.searchParams.keys()).sort()).toEqual([
        "output_mode",
      ]);
      expect(url.searchParams.get("output_mode")).toBe("json");
      expect(request.headers?.["Authorization"]).toBe(`Bearer ${API_TOKEN}`);
      expect(request.timeoutInMs).toBe(12345);
      expect(request.egressOptions?.targetLabel).toBe("Splunk");
      expect(harness.client.getRequestCount()).toBe(1);
    });

    test("uses HTTP basic authentication when no token is configured", async () => {
      const harness: Harness = buildHarness({
        clientOverrides: {
          apiToken: undefined,
          username: USERNAME,
          password: PASSWORD,
        },
      });

      await harness.client.getCurrentContext();

      expect(harness.requests[0]!.headers?.["Authorization"]).toBe(
        `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`,
      );
    });

    test("names the authentication step on a 401 with Splunk's message and a hint, never echoing the token", async () => {
      const harness: Harness = buildHarness({
        context: (): DataSourceHttpResponse => {
          return text(
            401,
            JSON.stringify({
              messages: [
                {
                  type: "WARN",
                  text: `call not properly authenticated (Authorization: Bearer ${API_TOKEN})`,
                },
              ],
            }),
          );
        },
      });

      const error: APIException = await expectRejection(
        harness.client.getCurrentContext(),
      );

      expect(error.message).toMatch(
        /^Splunk Enterprise Security authentication request failed \(HTTP 401\): /,
      );
      expect(error.message).toContain("call not properly authenticated");
      expect(error.message).toContain("did not accept the credentials");
      expect(error.message).not.toContain(API_TOKEN);
    });

    test("reports an HTML answer (Splunk Web on port 8000) as a non-JSON body with the port hint", async () => {
      const harness: Harness = buildHarness({
        context: (): DataSourceHttpResponse => {
          return text(
            200,
            "<!DOCTYPE html><html><head><title>Splunk</title></head></html>",
          );
        },
      });

      const error: APIException = await expectRejection(
        harness.client.getCurrentContext(),
      );

      expect(error.message).toMatch(
        /^Splunk Enterprise Security authentication request returned a non-JSON body\./,
      );
      expect(error.message).toContain("usually 8089");
    });

    test("reports a JSON body without an entry list as an unrecognized shape", async () => {
      const harness: Harness = buildHarness({
        context: (): DataSourceHttpResponse => {
          return ok({ status: "ok" });
        },
      });

      const error: APIException = await expectRejection(
        harness.client.getCurrentContext(),
      );

      expect(error.message).toMatch(
        /^Splunk Enterprise Security authentication request returned an unrecognized response shape: /,
      );
    });
  });

  describe("export request contract", () => {
    test("posts a form body to search/v2/jobs/export with the search, epoch bounds, json output and one row beyond the cap", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return ndjson([]);
          },
        ],
      });

      await harness.client.exportSearch({
        startTime: START,
        endTime: END,
        maxResults: 2,
      });

      expect(harness.requests).toHaveLength(1);

      const request: DataSourceHttpRequest = harness.requests[0]!;
      const url: URL = new URL(request.url);

      expect(request.method).toBe("POST");
      expect(url.origin).toBe(BASE_URL);
      expect(url.pathname).toBe("/services/search/v2/jobs/export");
      expect(Array.from(url.searchParams.keys())).toEqual([]);
      expect(request.formUrlEncoded).toBe(true);
      expect(request.headers?.["Authorization"]).toBe(`Bearer ${API_TOKEN}`);
      expect(request.timeoutInMs).toBe(20000);

      const body: Dictionary<string> = request.body as Dictionary<string>;
      expect(sortedKeys(body)).toEqual([
        "earliest_time",
        "latest_time",
        "output_mode",
        "search",
      ]);
      /*
       * Review finding bound-hit-window-never-advances: the export streams
       * newest first, so a bare `head` kept the newest rows of an
       * overflowing window. The window is sorted ascending with no sort
       * limit before the cap, so a capped read keeps the oldest rows.
       */
      expect(body["search"]).toBe(
        "search index=notable | fields * | sort 0 _time | head 3",
      );
      expect(body["output_mode"]).toBe("json");
      // Floor the inclusive start, ceil the exclusive end: widen, never lose.
      expect(body["earliest_time"]).toBe(
        String(Math.floor(START.getTime() / 1000)),
      );
      expect(body["latest_time"]).toBe(String(Math.ceil(END.getTime() / 1000)));
    });

    test("never asks for more than the export ceiling plus one", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return ndjson([]);
          },
        ],
      });

      await harness.client.exportSearch({
        startTime: START,
        endTime: END,
        maxResults: 1_000_000,
      });

      const body: Dictionary<string> = harness.requests[0]!
        .body as Dictionary<string>;
      expect(body["search"]).toBe(
        `search index=notable | fields * | sort 0 _time | head ${SPLUNK_MAX_EXPORT_ROWS + 1}`,
      );
    });

    test("prefixes the tenant's search with the search command and keeps its filters", async () => {
      const harness: Harness = buildHarness({
        clientOverrides: {
          searchString: 'search index=notable rule_name="Threat - *"',
        },
        exports: [
          (): DataSourceHttpResponse => {
            return ndjson([]);
          },
        ],
      });

      await harness.client.exportSearch({
        startTime: START,
        endTime: END,
        maxResults: 5,
      });

      expect((harness.requests[0]!.body as Dictionary<string>)["search"]).toBe(
        'search index=notable rule_name="Threat - *" | fields * | sort 0 _time | head 6',
      );
    });

    test("leaves the sort out only when the caller does not need the oldest rows", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return ndjson([]);
          },
        ],
      });

      await harness.client.exportSearch({
        startTime: START,
        endTime: END,
        maxResults: 1,
        oldestFirst: false,
      });

      expect((harness.requests[0]!.body as Dictionary<string>)["search"]).toBe(
        "search index=notable | fields * | head 2",
      );
    });
  });

  describe("export parsing", () => {
    test("collects result rows, skips preview rows and blank lines, and reports the served version", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return ndjson([
              JSON.stringify({
                preview: true,
                offset: 0,
                result: notable("preview-only", "Threat - Preview - Rule"),
              }),
              "",
              exportLine(
                notable(
                  "A1",
                  "Access - Brute Force Access Behavior Detected - Rule",
                ),
                0,
              ),
              "   ",
              exportLine(
                notable("B2", "Threat - Ransomware Note Files - Rule"),
                1,
                true,
              ),
            ]);
          },
        ],
      });

      const result: SplunkExportResult = await harness.client.exportSearch({
        startTime: START,
        endTime: END,
        maxResults: 10,
      });

      expect(result.apiVersion).toBe("v2");
      expect(result.truncated).toBe(false);
      expect(
        result.results.map((row: JSONObject): string => {
          return String(row["event_id"]);
        }),
      ).toEqual(["A1", "B2"]);
    });

    test("marks the export truncated and drops the probe row when Splunk returns more than the cap", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return ndjson([
              exportLine(notable("A1", "Rule A"), 0),
              exportLine(notable("B2", "Rule B"), 1),
              exportLine(notable("C3", "Rule C"), 2, true),
            ]);
          },
        ],
      });

      const result: SplunkExportResult = await harness.client.exportSearch({
        startTime: START,
        endTime: END,
        maxResults: 2,
      });

      expect(result.truncated).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(String(result.results[1]!["event_id"])).toBe("B2");
    });

    test("treats an empty body as an empty window", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return text(200, "");
          },
        ],
      });

      const result: SplunkExportResult = await harness.client.exportSearch({
        startTime: START,
        endTime: END,
        maxResults: 5,
      });

      expect(result.results).toEqual([]);
      expect(result.truncated).toBe(false);
    });

    test("rejects a body that is not newline-delimited JSON instead of treating it as empty", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return text(200, "<html><body>Splunk Web</body></html>");
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.exportSearch({
          startTime: START,
          endTime: END,
          maxResults: 5,
        }),
      );

      expect(error.message).toMatch(
        /^Splunk Enterprise Security search export returned a body that is not newline-delimited JSON\./,
      );
      expect(error.message).toContain("port 8000");
    });

    test("surfaces a FATAL message line returned on an HTTP 200 as a rejection", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return ndjson([
              JSON.stringify({
                preview: false,
                messages: [
                  {
                    type: "FATAL",
                    text: "Error in 'search' command: Unable to parse the search: Comparator '=' is missing a term on the right hand side.",
                  },
                ],
              }),
            ]);
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.exportSearch({
          startTime: START,
          endTime: END,
          maxResults: 5,
        }),
      );

      expect(error.message).toMatch(
        /^Splunk Enterprise Security search export was rejected by Splunk on an HTTP 200: /,
      );
      expect(error.message).toContain("Unable to parse the search");
    });
  });

  describe("v1 fallback", () => {
    test("falls back to search/jobs/export on a v2 404 and remembers the choice for later calls", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return text(
              404,
              JSON.stringify({
                messages: [{ type: "ERROR", text: "Not Found" }],
              }),
            );
          },
          (): DataSourceHttpResponse => {
            return ndjson([exportLine(notable("A1", "Rule A"), 0, true)]);
          },
          (): DataSourceHttpResponse => {
            return ndjson([exportLine({ count: "7" }, 0, true)]);
          },
        ],
      });

      const result: SplunkExportResult = await harness.client.exportSearch({
        startTime: START,
        endTime: END,
        maxResults: 5,
      });

      expect(result.apiVersion).toBe("v1");
      expect(result.results).toHaveLength(1);
      expect(new URL(harness.requests[0]!.url).pathname).toBe(
        "/services/search/v2/jobs/export",
      );
      expect(new URL(harness.requests[1]!.url).pathname).toBe(
        "/services/search/jobs/export",
      );
      expect(harness.requests[1]!.body).toEqual(harness.requests[0]!.body);

      const count: SplunkCount = await harness.client.countSearch({
        startTime: START,
        endTime: END,
      });

      expect(count.count).toBe(7);
      expect(new URL(harness.requests[2]!.url).pathname).toBe(
        "/services/search/jobs/export",
      );
      expect(harness.client.getRequestCount()).toBe(3);
    });

    test("does not fall back when v1 also answers 404", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return text(404, "Not Found");
          },
          (): DataSourceHttpResponse => {
            return text(404, "Not Found");
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.exportSearch({
          startTime: START,
          endTime: END,
          maxResults: 5,
        }),
      );

      expect(error.message).toMatch(
        /^Splunk Enterprise Security search export failed \(HTTP 404\): /,
      );
      expect(error.message).toContain("usually 8089");
      expect(harness.requests).toHaveLength(2);
    });
  });

  describe("count search", () => {
    test("runs a stats count over the window and parses the single row", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return ndjson([exportLine({ count: "42" }, 0, true)]);
          },
        ],
      });

      const count: SplunkCount = await harness.client.countSearch({
        startTime: START,
        endTime: END,
      });

      expect(count).toEqual({ count: 42 });

      const body: Dictionary<string> = harness.requests[0]!
        .body as Dictionary<string>;
      expect(sortedKeys(body)).toEqual([
        "earliest_time",
        "latest_time",
        "output_mode",
        "search",
      ]);
      expect(body["search"]).toBe("search index=notable | stats count");
    });

    test("reads zero when the stats search streams no rows", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return text(200, "");
          },
        ],
      });

      const count: SplunkCount = await harness.client.countSearch({
        startTime: START,
        endTime: END,
      });

      expect(count.count).toBe(0);
    });

    test("rejects a count row without a numeric count", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return ndjson([exportLine({ total: "many" }, 0, true)]);
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.countSearch({ startTime: START, endTime: END }),
      );

      expect(error.message).toMatch(
        /^Splunk Enterprise Security count search returned an unrecognized response shape: /,
      );
    });
  });

  describe("failure taxonomy", () => {
    const cases: Array<{
      status: number;
      body: string;
      hint: string;
    }> = [
      {
        status: 401,
        body: JSON.stringify({
          messages: [{ type: "WARN", text: "call not properly authenticated" }],
        }),
        hint: "did not accept the credentials",
      },
      {
        status: 403,
        body: JSON.stringify({
          messages: [
            {
              type: "ERROR",
              text: "You (user=oneuptime) do not have permission to perform this operation (requires capability: search)",
            },
          ],
        }),
        hint: "lacks what this needs",
      },
      {
        status: 400,
        body: JSON.stringify({
          messages: [
            {
              type: "FATAL",
              text: "Error in 'search' command: Unable to parse the search",
            },
          ],
        }),
        hint: "Splunk rejected the search",
      },
      {
        status: 429,
        body: JSON.stringify({
          messages: [{ type: "ERROR", text: "Too many requests" }],
        }),
        hint: "throttled the request",
      },
      {
        status: 500,
        body: JSON.stringify({
          messages: [{ type: "ERROR", text: "Internal Server Error" }],
        }),
        hint: "server-side error",
      },
      {
        status: 503,
        body: "Service Unavailable",
        hint: "server-side error",
      },
    ];

    for (const testCase of cases) {
      test(`names the export step and HTTP ${testCase.status} with a hint`, async () => {
        const harness: Harness = buildHarness({
          exports: [
            (): DataSourceHttpResponse => {
              return text(testCase.status, testCase.body);
            },
          ],
        });

        const error: APIException = await expectRejection(
          harness.client.exportSearch({
            startTime: START,
            endTime: END,
            maxResults: 5,
          }),
        );

        expect(error.message).toMatch(
          new RegExp(
            `^Splunk Enterprise Security search export failed \\(HTTP ${testCase.status}\\): `,
          ),
        );
        expect(error.message).toContain(testCase.hint);
      });
    }

    test("quotes the Retry-After header on a 429", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return {
              statusCode: 429,
              bodyText: "",
              bodyJson: undefined,
              headers: { "retry-after": "30" },
            };
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.exportSearch({
          startTime: START,
          endTime: END,
          maxResults: 5,
        }),
      );

      expect(error.message).toContain("retry after 30 seconds");
    });

    test("folds the transport's HTTP-status exception back into the status taxonomy", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              'Data source responded with HTTP 403: {"messages":[{"type":"ERROR","text":"You do not have permission"}]}',
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.exportSearch({
          startTime: START,
          endTime: END,
          maxResults: 5,
        }),
      );

      expect(error.message).toMatch(
        /^Splunk Enterprise Security search export failed \(HTTP 403\): /,
      );
      expect(error.message).toContain("You do not have permission");
    });

    test("names the step when the transport times out or refuses egress", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              "Could not reach data source: timeout of 20000ms exceeded",
            );
          },
        ],
        context: (): DataSourceHttpResponse => {
          throw new BadDataException(
            "Could not reach data source: Splunk resolves to a private address (10.0.0.5), which is not allowed.",
          );
        },
      });

      const exportError: APIException = await expectRejection(
        harness.client.exportSearch({
          startTime: START,
          endTime: END,
          maxResults: 5,
        }),
      );
      expect(exportError.message).toBe(
        "Splunk Enterprise Security search export did not complete: Could not reach data source: timeout of 20000ms exceeded",
      );

      const contextError: APIException = await expectRejection(
        harness.client.getCurrentContext(),
      );
      expect(contextError.message).toMatch(
        /^Splunk Enterprise Security authentication request did not complete: /,
      );
      expect(contextError.message).toContain("private address");
    });
  });

  describe("redaction", () => {
    test("never lets the token, a password or a bearer header through an error body", async () => {
      const leakyBody: string = JSON.stringify({
        messages: [
          {
            type: "ERROR",
            text: `Authorization: Bearer ${API_TOKEN} was rejected`,
          },
        ],
        password: PASSWORD,
        session: { authorization: `Bearer ${API_TOKEN}` },
      });
      const harness: Harness = buildHarness({
        clientOverrides: {
          apiToken: undefined,
          username: USERNAME,
          password: PASSWORD,
        },
        exports: [
          (): DataSourceHttpResponse => {
            return text(500, leakyBody);
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.exportSearch({
          startTime: START,
          endTime: END,
          maxResults: 5,
        }),
      );

      expect(error.message).not.toContain(API_TOKEN);
      expect(error.message).not.toContain(PASSWORD);
      expect(error.message).toContain("[REDACTED]");
    });

    test("redacts a credential echoed in a non-JSON error body", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return text(
              502,
              `Bad Gateway: upstream rejected Bearer ${API_TOKEN}`,
            );
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.exportSearch({
          startTime: START,
          endTime: END,
          maxResults: 5,
        }),
      );

      expect(error.message).toMatch(
        /^Splunk Enterprise Security search export failed \(HTTP 502\): /,
      );
      expect(error.message).not.toContain(API_TOKEN);
    });

    test("redacts a credential inside a FATAL message line", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return ndjson([
              JSON.stringify({
                preview: false,
                messages: [
                  {
                    type: "ERROR",
                    text: `Search rejected for token=${API_TOKEN}`,
                  },
                ],
              }),
            ]);
          },
        ],
      });

      const error: APIException = await expectRejection(
        harness.client.exportSearch({
          startTime: START,
          endTime: END,
          maxResults: 5,
        }),
      );

      expect(error.message).not.toContain(API_TOKEN);
    });
  });
});
