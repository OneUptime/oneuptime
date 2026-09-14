import { describe, expect, test } from "@jest/globals";
import SplunkConnector from "../../../../../../Server/Utils/SecurityEvent/Connectors/Splunk/SplunkConnector";
import {
  ConnectorFetchResult,
  SecurityConnectorSettings,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../../Server/Utils/DataSource/HttpFetch";
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
 * The Splunk connector as the framework calls it: settings validation
 * keyed by the catalog's field titles, the three test checks and their
 * remediation per failure mode, and a creation-time fetch that reads the
 * window oldest first, respects the event and request bounds, marks
 * itself incomplete with a resume point when a bound stops it, and never
 * leaks a credential.
 */

const BASE_URL: string = "https://splunk.example.com:8089";
const API_TOKEN: string =
  "eyJraWQiOiJzcGx1bmsuc2VjcmV0IiwiYWxnIjoiSFM1MTIiLCJ2ZXIiOiJ2MiIsInR0eXAiOiJzdGF0aWMifQ.eyJpc3MiOiJhZG1pbiJ9.c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWduYXR1cmU";
const PASSWORD: string = "hunter2-Sup3rSecret";
const START: Date = new Date("2026-09-12T10:00:00.000Z");
const END: Date = new Date("2026-09-13T10:00:00.000Z");

type Responder = (
  request: DataSourceHttpRequest,
) => DataSourceHttpResponse | Promise<DataSourceHttpResponse>;

interface Harness {
  requests: Array<DataSourceHttpRequest>;
  connector: SplunkConnector;
}

function settings(
  overrides: Partial<SecurityConnectorSettings> = {},
): SecurityConnectorSettings {
  return {
    provider: SecurityEventConnectorProvider.SplunkEnterpriseSecurity,
    config: { url: BASE_URL, searchString: "index=notable" },
    secrets: { apiToken: API_TOKEN },
    alertingOnly: false,
    ...overrides,
  };
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

function contextResponse(): DataSourceHttpResponse {
  return text(
    200,
    JSON.stringify({
      entry: [
        {
          name: "context",
          content: {
            capabilities: ["search"],
            roles: ["oneuptime_reader", "user"],
            username: "oneuptime",
          },
        },
      ],
    }),
  );
}

function notable(eventId: string, index: number): JSONObject {
  return {
    _bkt: "notable~12~C8D6C9F5-4C3B-4F3E-9A3E-0F2B2C9D4E1A",
    _cd: `12:${4800 + index}`,
    _time: `2026-09-12T1${index}:15:00.000+00:00`,
    event_id: eventId,
    rule_name: "Access - Brute Force Access Behavior Detected - Rule",
    rule_title: `Brute force against wkstn-04${index}`,
    urgency: "high",
    status_label: "New",
    src: "10.20.30.40",
    dest: `wkstn-04${index}`,
    user: "alice",
    orig_time: "1789209300",
  };
}

function ndjson(rows: Array<JSONObject>): DataSourceHttpResponse {
  const lines: Array<string> = rows.map(
    (row: JSONObject, index: number): string => {
      return JSON.stringify({
        preview: false,
        offset: index,
        ...(index === rows.length - 1 ? { lastrow: true } : {}),
        result: row,
      });
    },
  );

  return {
    statusCode: 200,
    bodyText: lines.join("\n") + "\n",
    bodyJson: undefined,
    headers: {},
  };
}

function countRow(count: number): DataSourceHttpResponse {
  return ndjson([{ count: String(count) }]);
}

function buildHarness(options: {
  context?: Responder;
  exports?: Array<Responder>;
}): Harness {
  const requests: Array<DataSourceHttpRequest> = [];
  const exportResponders: Array<Responder> = [...(options.exports || [])];

  const connector: SplunkConnector = new SplunkConnector(
    async (request: DataSourceHttpRequest): Promise<DataSourceHttpResponse> => {
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

function headSize(request: DataSourceHttpRequest): number {
  const search: string = (request.body as Dictionary<string>)["search"] || "";
  const match: RegExpMatchArray | null = search.match(/\| head (\d+)$/);
  return match ? Number(match[1]) : Number.NaN;
}

describe("SplunkConnector", () => {
  const definition: SecurityEventConnectorDefinition =
    getSecurityEventConnectorDefinition(
      SecurityEventConnectorProvider.SplunkEnterpriseSecurity,
    )!;

  test("registers under the catalog's provider key", () => {
    expect(new SplunkConnector().provider).toBe("splunk");
    expect(definition.provider).toBe(new SplunkConnector().provider);
  });

  describe("validateSettings", () => {
    test("accepts a token-authenticated connection with the default search", () => {
      expect(() => {
        return new SplunkConnector().validateSettings(
          settings({ config: { url: BASE_URL } }),
        );
      }).not.toThrow();
    });

    test("accepts username and password when no token is set", () => {
      expect(() => {
        return new SplunkConnector().validateSettings(
          settings({
            config: { url: BASE_URL, username: "oneuptime" },
            secrets: { password: PASSWORD },
          }),
        );
      }).not.toThrow();
    });

    test("names the catalog field titles in every rejection", () => {
      const connector: SplunkConnector = new SplunkConnector();

      expect(() => {
        return connector.validateSettings(settings({ config: {} }));
      }).toThrow("Splunk management URL is required.");

      expect(() => {
        return connector.validateSettings(
          settings({ config: { url: "http://splunk.example.com:8089" } }),
        );
      }).toThrow(BadDataException);

      expect(() => {
        return connector.validateSettings(
          settings({ config: { url: BASE_URL }, secrets: {} }),
        );
      }).toThrow(
        "Provide an Authentication token, or a Username and Password.",
      );

      expect(() => {
        return connector.validateSettings(
          settings({
            config: { url: BASE_URL, username: "oneuptime" },
            secrets: {},
          }),
        );
      }).toThrow(/^Password is required when a Username is set/);

      expect(() => {
        return connector.validateSettings(
          settings({
            config: { url: BASE_URL },
            secrets: { password: PASSWORD },
          }),
        );
      }).toThrow("Username is required when a Password is set.");

      expect(() => {
        return connector.validateSettings(
          settings({
            config: {
              url: BASE_URL,
              searchString: "index=notable earliest=-1d",
            },
          }),
        );
      }).toThrow(/earliest or latest/);
    });
  });

  describe("testConnection", () => {
    test("passes all three checks and reports user, roles, endpoint version and counts", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return ndjson([notable("A1", 0)]);
          },
          (): DataSourceHttpResponse => {
            return countRow(12);
          },
          (): DataSourceHttpResponse => {
            return countRow(140);
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 15000,
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

      const authentication: SecurityConnectorCheck = checkByKey(
        checks,
        "authentication",
      );
      expect(authentication.message).toContain("authentication token");
      expect(authentication.message).toContain("user oneuptime");
      expect(authentication.message).toContain("oneuptime_reader, user");
      expect(authentication.details).toEqual({
        username: "oneuptime",
        roles: ["oneuptime_reader", "user"],
        hasSearchCapability: true,
      });

      const read: SecurityConnectorCheck = checkByKey(
        checks,
        "read-permission",
      );
      expect(read.message).toContain("search/v2/jobs/export");
      expect(read.message).toContain("1 record returned");
      expect(read.details).toEqual({ apiVersion: "v2" });

      const available: SecurityConnectorCheck = checkByKey(
        checks,
        "detections-available",
      );
      expect(available.message).toBe(
        "12 records created in the last 24 hours and 140 in the last 7 days.",
      );
      expect(available.details).toEqual({
        createdLast24h: 12,
        createdLast7d: 140,
        hasMoreLast24h: false,
        hasMoreLast7d: false,
      });

      // One context probe, a one-row read (head 2 = cap + 1), then two counts.
      expect(harness.requests).toHaveLength(4);
      expect(headSize(harness.requests[1]!)).toBe(2);
      // Any row proves the search runs, so the probe does not sort a day.
      expect((harness.requests[1]!.body as Dictionary<string>)["search"]).toBe(
        "search index=notable | fields * | head 2",
      );
      expect((harness.requests[2]!.body as Dictionary<string>)["search"]).toBe(
        "search index=notable | stats count",
      );
      for (const request of harness.requests) {
        expect(request.timeoutInMs).toBe(15000);
      }
    });

    test("warns instead of passing when nothing was created in the last 7 days", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return text(200, "");
          },
          (): DataSourceHttpResponse => {
            return countRow(0);
          },
          (): DataSourceHttpResponse => {
            return text(200, "");
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
      expect(available.status).toBe("warn");
      expect(available.message).toContain("No records matched");
      expect(available.remediation).toContain("Incident Review");
    });

    test("fails authentication on an invalid setting without contacting Splunk", async () => {
      const harness: Harness = buildHarness({});

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(
          settings({ config: { url: BASE_URL }, secrets: {} }),
          { requestTimeoutInMs: 1000 },
        );

      expect(checks).toHaveLength(1);
      expect(checks[0]!.key).toBe("authentication");
      expect(checks[0]!.status).toBe("fail");
      expect(checks[0]!.message).toContain("Authentication token");
      expect(checks[0]!.remediation).toContain("Nothing was contacted");
      expect(harness.requests).toHaveLength(0);
    });

    test("fails authentication on a 401, skips the rest, and points at Settings > Tokens", async () => {
      const harness: Harness = buildHarness({
        context: (): DataSourceHttpResponse => {
          return text(
            401,
            JSON.stringify({
              messages: [
                { type: "WARN", text: "call not properly authenticated" },
              ],
            }),
          );
        },
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
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
      expect(checks[0]!.message).toMatch(
        /^Splunk Enterprise Security authentication request failed \(HTTP 401\)/,
      );
      expect(checks[0]!.remediation).toContain("Settings > Tokens");
      expect(checks[0]!.message).not.toContain(API_TOKEN);
      expect(harness.requests).toHaveLength(1);
    });

    test("fails authentication with the port hint when the URL answers HTML", async () => {
      const harness: Harness = buildHarness({
        context: (): DataSourceHttpResponse => {
          return text(200, "<!DOCTYPE html><html><title>Splunk</title></html>");
        },
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(checks[0]!.status).toBe("fail");
      expect(checks[0]!.remediation).toContain("8089");
    });

    test("fails authentication with the connectivity hint on a timeout", async () => {
      const harness: Harness = buildHarness({
        context: (): DataSourceHttpResponse => {
          throw new BadDataException(
            "Could not reach data source: timeout of 1000ms exceeded",
          );
        },
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
        });

      expect(checks[0]!.status).toBe("fail");
      expect(checks[0]!.message).toMatch(
        /^Splunk Enterprise Security authentication request did not complete: /,
      );
      expect(checks[0]!.remediation).toContain("private addresses are refused");
    });

    test("fails read-permission on a 403 with the role remediation and skips availability", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return text(
              403,
              JSON.stringify({
                messages: [
                  {
                    type: "ERROR",
                    text: "You (user=oneuptime) do not have permission to perform this operation (requires capability: search)",
                  },
                ],
              }),
            );
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 1000,
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
        /^Splunk Enterprise Security search export failed \(HTTP 403\)/,
      );
      expect(read.remediation).toContain("search capability");
      expect(read.remediation).toContain("notable");
    });

    test("fails read-permission on a 400 with the search remediation", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return text(
              400,
              JSON.stringify({
                messages: [
                  {
                    type: "FATAL",
                    text: "Error in 'search' command: Unable to parse the search",
                  },
                ],
              }),
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
      expect(read.remediation).toContain("Fix the Search setting");
    });

    test("fails detections-available on a 429 with the throttling remediation", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return ndjson([notable("A1", 0)]);
          },
          (): DataSourceHttpResponse => {
            return text(429, "Too Many Requests");
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
      expect(available.message).toMatch(
        /^Splunk Enterprise Security count search failed \(HTTP 429\)/,
      );
      expect(available.remediation).toContain("throttling");
    });

    test("reports the deprecated v1 endpoint when v2 answers 404", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return text(404, "Not Found");
          },
          (): DataSourceHttpResponse => {
            return ndjson([notable("A1", 0)]);
          },
          (): DataSourceHttpResponse => {
            return countRow(1);
          },
          (): DataSourceHttpResponse => {
            return countRow(3);
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
      expect(read.message).toContain("deprecated search/jobs/export");
      expect(read.details).toEqual({ apiVersion: "v1" });
      expect(checkByKey(checks, "detections-available").status).toBe("pass");
    });

    test("uses basic authentication and names it in the passing message", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return ndjson([]);
          },
          (): DataSourceHttpResponse => {
            return countRow(0);
          },
          (): DataSourceHttpResponse => {
            return countRow(1);
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(
          settings({
            config: { url: BASE_URL, username: "oneuptime" },
            secrets: { password: PASSWORD },
          }),
          { requestTimeoutInMs: 1000 },
        );

      expect(checkByKey(checks, "authentication").message).toContain(
        "username and password",
      );
      expect(harness.requests[0]!.headers?.["Authorization"]).toBe(
        `Basic ${Buffer.from(`oneuptime:${PASSWORD}`).toString("base64")}`,
      );
      for (const check of checks) {
        expect(JSON.stringify(check)).not.toContain(PASSWORD);
      }
    });
  });

  describe("fetchEvents", () => {
    test("reads the window by creation time, normalizes with the catalog's vendor and product, and builds samples", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return ndjson([
              notable("A1", 0),
              notable("B2", 1),
              notable("C3", 2),
            ]);
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        {
          maxRequests: 20,
          maxEvents: 100,
          requestTimeoutInMs: 30000,
          sampleLimit: 2,
        },
      );

      expect(result.complete).toBe(true);
      expect(result.resumeAfter).toBeUndefined();
      expect(result.warnings).toEqual([]);
      expect(result.requestCount).toBe(1);
      expect(result.fetchedCount).toBe(3);
      expect(result.rejectedCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.events).toHaveLength(3);

      for (const event of result.events) {
        expect(event.vendorName).toBe(definition.vendorName);
        expect(event.productName).toBe(definition.productName);
        expect(event.classUid).toBe(2004);
      }

      expect(
        result.events.map((event: { eventUid: string }): string => {
          return event.eventUid;
        }),
      ).toEqual(["A1", "B2", "C3"]);

      expect(result.samples).toHaveLength(2);
      expect(result.samples[0]).toEqual({
        id: "A1",
        title: "Brute force against wkstn-040",
        severity: "High",
        createdTime: "2026-09-12T10:15:00.000Z",
        eventTime: "2026-09-12T10:35:00.000Z",
      });

      const request: DataSourceHttpRequest = harness.requests[0]!;
      const body: Dictionary<string> = request.body as Dictionary<string>;
      expect(new URL(request.url).pathname).toBe(
        "/services/search/v2/jobs/export",
      );
      expect(Object.keys(body).sort()).toEqual([
        "earliest_time",
        "latest_time",
        "output_mode",
        "search",
      ]);
      expect(body["earliest_time"]).toBe(String(START.getTime() / 1000));
      expect(body["latest_time"]).toBe(String(END.getTime() / 1000));
      expect(body["search"]).toBe(
        "search index=notable | fields * | sort 0 _time | head 101",
      );
      expect(headSize(request)).toBe(101);
      expect(request.timeoutInMs).toBe(30000);
    });

    /*
     * Review finding bound-hit-window-never-advances: this test used to
     * assert that a capped read only warned "the cursor is held", which
     * re-read the same rows on every poll. A capped read now keeps the
     * oldest rows (sorted ascending by Splunk) and reports the `_time` of
     * the last one as the resume point.
     */
    test("stops at the event bound with the oldest rows and reports the last row's _time as the resume point", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            // Splunk answers in the order `sort 0 _time` produces.
            return ndjson([
              notable("A1", 0),
              notable("B2", 1),
              notable("C3", 2),
            ]);
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        {
          maxRequests: 20,
          maxEvents: 2,
          requestTimeoutInMs: 1000,
          sampleLimit: 5,
        },
      );

      expect(result.complete).toBe(false);
      expect(result.events).toHaveLength(2);
      expect(
        result.events.map((event: { eventUid: string }): string => {
          return event.eventUid;
        }),
      ).toEqual(["A1", "B2"]);
      expect(result.fetchedCount).toBe(2);
      expect(result.resumeAfter?.toISOString()).toBe(
        "2026-09-12T11:15:00.000Z",
      );
      expect(result.warnings).toEqual([
        "Stopped after collecting 2 records; the window holds more. Records are read oldest first, and the last one read was created at 2026-09-12T11:15:00.000Z, where the next poll can resume.",
      ]);
      expect(headSize(harness.requests[0]!)).toBe(3);
      expect((harness.requests[0]!.body as Dictionary<string>)["search"]).toBe(
        "search index=notable | fields * | sort 0 _time | head 3",
      );
    });

    test("resumes from the last readable _time when the final row has none", async () => {
      const withoutTime: JSONObject = notable("B2", 1);
      delete withoutTime["_time"];

      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return ndjson([notable("A1", 0), withoutTime, notable("C3", 2)]);
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        {
          maxRequests: 20,
          maxEvents: 2,
          requestTimeoutInMs: 1000,
          sampleLimit: 5,
        },
      );

      expect(result.complete).toBe(false);
      expect(result.resumeAfter?.toISOString()).toBe(
        "2026-09-12T10:15:00.000Z",
      );
    });

    test("reports no resume point when no row read carries a _time, or the last one lies past the window end", async () => {
      const noTime: JSONObject = notable("A1", 0);
      delete noTime["_time"];
      const pastEnd: JSONObject = {
        ...notable("B2", 1),
        _time: "2026-09-14T10:15:00.000+00:00",
      };

      for (const rows of [
        [noTime, { ...noTime, event_id: "A2" }, notable("C3", 2)],
        [notable("A1", 0), pastEnd, notable("C3", 2)],
      ]) {
        const harness: Harness = buildHarness({
          exports: [
            (): DataSourceHttpResponse => {
              return ndjson(rows);
            },
          ],
        });

        const result: ConnectorFetchResult =
          await harness.connector.fetchEvents(
            settings(),
            { startTime: START, endTime: END },
            {
              maxRequests: 20,
              maxEvents: 2,
              requestTimeoutInMs: 1000,
              sampleLimit: 5,
            },
          );

        expect(result.complete).toBe(false);
        expect(result.resumeAfter).toBeUndefined();
      }
    });

    test("refuses to read with a zero request budget and reports it instead of exceeding it", async () => {
      const harness: Harness = buildHarness({});

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        {
          maxRequests: 0,
          maxEvents: 10,
          requestTimeoutInMs: 1000,
          sampleLimit: 5,
        },
      );

      expect(result.complete).toBe(false);
      expect(result.resumeAfter).toBeUndefined();
      expect(result.requestCount).toBe(0);
      expect(result.warnings[0]).toContain("request budget");
      expect(harness.requests).toHaveLength(0);
    });

    test("falls back to v1 within the request budget and warns about the deprecated endpoint", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return text(404, "Not Found");
          },
          (): DataSourceHttpResponse => {
            return ndjson([notable("A1", 0)]);
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        {
          maxRequests: 1,
          maxEvents: 10,
          requestTimeoutInMs: 1000,
          sampleLimit: 5,
        },
      );

      expect(result.complete).toBe(true);
      expect(result.resumeAfter).toBeUndefined();
      expect(result.events).toHaveLength(1);
      expect(result.requestCount).toBe(2);
      expect(
        result.warnings.some((warning: string): boolean => {
          return warning.includes("deprecated search/jobs/export");
        }),
      ).toBe(true);
      expect(
        result.warnings.some((warning: string): boolean => {
          return warning.includes("budget of 1");
        }),
      ).toBe(true);
    });

    test("counts rows the normalizer does not recognize as rejected", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            return ndjson([notable("A1", 0), { count: "3" }, { foo: "bar" }]);
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        {
          maxRequests: 20,
          maxEvents: 10,
          requestTimeoutInMs: 1000,
          sampleLimit: 5,
        },
      );

      expect(result.fetchedCount).toBe(3);
      expect(result.rejectedCount).toBe(2);
      expect(result.events).toHaveLength(1);
    });

    test("throws with the step prefix for authentication, permission, throttling and server failures", async () => {
      for (const status of [401, 403, 429, 500]) {
        const harness: Harness = buildHarness({
          exports: [
            (): DataSourceHttpResponse => {
              return text(
                status,
                JSON.stringify({
                  messages: [
                    { type: "ERROR", text: `rejected Bearer ${API_TOKEN}` },
                  ],
                }),
              );
            },
          ],
        });

        let thrown: unknown = undefined;

        try {
          await harness.connector.fetchEvents(
            settings(),
            { startTime: START, endTime: END },
            {
              maxRequests: 20,
              maxEvents: 10,
              requestTimeoutInMs: 1000,
              sampleLimit: 5,
            },
          );
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(APIException);
        expect((thrown as APIException).message).toMatch(
          new RegExp(
            `^Splunk Enterprise Security search export failed \\(HTTP ${status}\\): `,
          ),
        );
        expect((thrown as APIException).message).not.toContain(API_TOKEN);
      }
    });

    test("throws with the step prefix when the transport times out", async () => {
      const harness: Harness = buildHarness({
        exports: [
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              "Could not reach data source: timeout of 1000ms exceeded",
            );
          },
        ],
      });

      await expect(
        harness.connector.fetchEvents(
          settings(),
          { startTime: START, endTime: END },
          {
            maxRequests: 20,
            maxEvents: 10,
            requestTimeoutInMs: 1000,
            sampleLimit: 5,
          },
        ),
      ).rejects.toThrow(
        "Splunk Enterprise Security search export did not complete: Could not reach data source: timeout of 1000ms exceeded",
      );
    });

    test("throws a BadDataException for invalid settings before any request", async () => {
      const harness: Harness = buildHarness({});

      await expect(
        harness.connector.fetchEvents(
          settings({ secrets: {} }),
          { startTime: START, endTime: END },
          {
            maxRequests: 20,
            maxEvents: 10,
            requestTimeoutInMs: 1000,
            sampleLimit: 5,
          },
        ),
      ).rejects.toBeInstanceOf(BadDataException);
      expect(harness.requests).toHaveLength(0);
    });
  });
});
