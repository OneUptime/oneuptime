import { describe, expect, test } from "@jest/globals";
import ElasticSecurityConnector from "../../../../../../Server/Utils/SecurityEvent/Connectors/ElasticSecurity/ElasticSecurityConnector";
import {
  ELASTIC_SECURITY_MAX_EXCLUDED_ID_BYTES,
  ELASTIC_SECURITY_MAX_PAGE_SIZE,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/ElasticSecurity/ElasticSecurityClient";
import {
  ConnectorFetchOptions,
  ConnectorFetchResult,
  SecurityConnectorSettings,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../../Server/Utils/DataSource/HttpFetch";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../../../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  SecurityConnectorCheck,
  SecurityConnectorSample,
} from "../../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import SecurityEventConnectorProvider from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  ConnectorField,
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";

/*
 * The connector as the poller and the tester see it: settings validation
 * in the catalog's vocabulary, the three provider checks with their
 * skip-on-earlier-failure rule, and a creation-time fetch that pages by
 * advancing the @timestamp lower bound while excluding the alerts already
 * read at that instant, respects every bound, and reports a bound hit as
 * incomplete with the resume point. Transport is injected; nothing
 * touches the network.
 */

const KIBANA_URL: string = "https://kibana.example.com";
const SPACE: string = "security";
const API_KEY: string =
  "VnVhQ2ZHY0JDZGJrUW0tZTVhT3g6dWkybHAyYXhUTm1zeWFrdzl0dk5udw==";
const START: Date = new Date("2026-09-12T10:00:00.000Z");
const END: Date = new Date("2026-09-13T10:00:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

const DEFINITION: SecurityEventConnectorDefinition =
  getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.ElasticSecurity,
  )!;

function fieldTitle(key: string): string {
  const field: ConnectorField | undefined = [
    ...DEFINITION.configFields,
    ...DEFINITION.secretFields,
  ].find((candidate: ConnectorField): boolean => {
    return candidate.key === key;
  });

  return field!.title;
}

type Responder = (
  request: DataSourceHttpRequest,
) => DataSourceHttpResponse | Promise<DataSourceHttpResponse>;

interface Harness {
  requests: Array<DataSourceHttpRequest>;
  connector: ElasticSecurityConnector;
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

function statusBody(): JSONObject {
  return {
    name: "kibana-0",
    version: { number: "9.1.0" },
    status: {
      overall: {
        level: "available",
        summary: "All services and plugins are available",
      },
    },
  };
}

function alertHit(
  id: string,
  timestamp: string,
  overrides?: JSONObject | undefined,
): JSONObject {
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
      "kibana.alert.rule.threat": [
        {
          framework: "MITRE ATT&CK",
          tactic: {
            id: "TA0004",
            name: "Privilege Escalation",
            reference: "https://attack.mitre.org/tactics/TA0004/",
          },
          technique: [
            {
              id: "T1068",
              name: "Exploitation for Privilege Escalation",
              reference: "https://attack.mitre.org/techniques/T1068/",
            },
          ],
        },
      ],
      "kibana.alert.severity": "high",
      "kibana.alert.risk_score": 73,
      "kibana.alert.workflow_status": "open",
      "kibana.alert.reason":
        "process event with process pkexec, by www-data on web-01 created high alert Potential Privilege Escalation via PKEXEC.",
      "kibana.alert.original_time": "2026-09-12T09:58:41.117Z",
      host: { name: "web-01", ip: ["10.20.30.40"] },
      user: { name: "www-data" },
      process: { name: "pkexec" },
      ...(overrides || {}),
    },
    sort: [Date.parse(timestamp)],
  };
}

/*
 * A full page of distinct alerts, one second apart, starting `offset`
 * seconds into the window. Full pages are what make the connector page.
 */
function fullPage(offset: number): Array<JSONObject> {
  const hits: Array<JSONObject> = [];

  for (let index: number = 0; index < ELASTIC_SECURITY_MAX_PAGE_SIZE; index++) {
    const timestamp: string = new Date(
      START.getTime() + (offset + index) * 1000,
    ).toISOString();
    hits.push(alertHit(`alert-${offset + index}`, timestamp));
  }

  return hits;
}

function searchBody(
  hits: Array<JSONObject>,
  total?: JSONObject | undefined,
): JSONObject {
  const envelope: JSONObject = { hits };

  if (total !== undefined) {
    envelope["total"] = total;
  }

  return {
    took: 3,
    timed_out: false,
    _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
    hits: envelope,
  };
}

function settings(
  overrides?: Partial<SecurityConnectorSettings> | undefined,
): SecurityConnectorSettings {
  return {
    provider: SecurityEventConnectorProvider.ElasticSecurity,
    config: { kibanaUrl: KIBANA_URL, space: SPACE },
    secrets: { apiKey: API_KEY },
    alertingOnly: false,
    ...(overrides || {}),
  };
}

function fetchOptions(
  overrides?: Partial<ConnectorFetchOptions> | undefined,
): ConnectorFetchOptions {
  return {
    maxRequests: 20,
    maxEvents: 10000,
    requestTimeoutInMs: 60000,
    sampleLimit: 25,
    ...(overrides || {}),
  };
}

/*
 * Scripted responders are consumed in order; `kibana` answers every search
 * request once they run out, for tests that simulate the index itself.
 */
function buildHarness(options: {
  status?: Responder | undefined;
  search?: Array<Responder> | undefined;
  kibana?: Responder | undefined;
}): Harness {
  const requests: Array<DataSourceHttpRequest> = [];
  const searchResponders: Array<Responder> = [...(options.search || [])];

  const connector: ElasticSecurityConnector = new ElasticSecurityConnector(
    async (request: DataSourceHttpRequest): Promise<DataSourceHttpResponse> => {
      requests.push(request);

      if (new URL(request.url).pathname.endsWith("/api/status")) {
        const responder: Responder =
          options.status ||
          ((): DataSourceHttpResponse => {
            return ok(statusBody());
          });
        return responder(request);
      }

      const responder: Responder | undefined =
        searchResponders.shift() || options.kibana;

      if (!responder) {
        throw new Error(`Unexpected request to ${request.url}`);
      }

      return responder(request);
    },
  );

  return { requests, connector };
}

function parseBody(request: DataSourceHttpRequest): JSONObject {
  expect(typeof request.body).toBe("string");
  return JSON.parse(request.body as string) as JSONObject;
}

/*
 * The range sits at the top of the query, or inside bool.filter when the
 * request also excludes the ids already read at the lower bound.
 */
function rangeOf(request: DataSourceHttpRequest): { gte: string; lt: string } {
  const query: JSONObject = parseBody(request)["query"] as JSONObject;
  const bool: JSONObject | undefined = query["bool"] as JSONObject | undefined;
  const clause: JSONObject = bool
    ? ((bool["filter"] as JSONArray)[0] as JSONObject)
    : query;
  const range: JSONObject = (clause["range"] as JSONObject)[
    "@timestamp"
  ] as JSONObject;

  return { gte: String(range["gte"]), lt: String(range["lt"]) };
}

function excludedIdsOf(request: DataSourceHttpRequest): Array<string> {
  const query: JSONObject = parseBody(request)["query"] as JSONObject;
  const bool: JSONObject | undefined = query["bool"] as JSONObject | undefined;

  if (!bool) {
    return [];
  }

  const mustNot: JSONArray = bool["must_not"] as JSONArray;
  return (mustNot[0]!["ids"] as JSONObject)["values"] as Array<string>;
}

interface FakeAlert {
  id: string;
  timestamp: string;
}

/*
 * A detection alerts index that answers the way Elasticsearch does: the
 * range on @timestamp, the must_not ids exclusion, ascending @timestamp
 * and the size. Elasticsearch promises no order among hits with equal
 * sort values, so the tie order flips on every request: a connector that
 * relied on it would re-read or skip alerts here.
 */
function fakeKibana(alerts: Array<FakeAlert>): Responder {
  let requestNumber: number = 0;

  return (request: DataSourceHttpRequest): DataSourceHttpResponse => {
    requestNumber += 1;

    const range: { gte: string; lt: string } = rangeOf(request);
    const from: number = Date.parse(range.gte);
    const to: number = Date.parse(range.lt);
    const excluded: Set<string> = new Set<string>(excludedIdsOf(request));
    const size: number = Number(parseBody(request)["size"]);
    const tieDirection: number = requestNumber % 2 === 0 ? -1 : 1;

    const matching: Array<FakeAlert> = alerts
      .filter((alert: FakeAlert): boolean => {
        const time: number = Date.parse(alert.timestamp);
        return time >= from && time < to && !excluded.has(alert.id);
      })
      .sort((left: FakeAlert, right: FakeAlert): number => {
        const byTime: number =
          Date.parse(left.timestamp) - Date.parse(right.timestamp);

        if (byTime !== 0) {
          return byTime;
        }

        return tieDirection * left.id.localeCompare(right.id);
      });

    return ok(
      searchBody(
        matching.slice(0, size).map((alert: FakeAlert): JSONObject => {
          return alertHit(alert.id, alert.timestamp);
        }),
      ),
    );
  };
}

function alertsAt(
  prefix: string,
  count: number,
  timestamp: (index: number) => string,
): Array<FakeAlert> {
  const alerts: Array<FakeAlert> = [];

  for (let index: number = 0; index < count; index++) {
    alerts.push({ id: `${prefix}-${index}`, timestamp: timestamp(index) });
  }

  return alerts;
}

function eventUids(result: ConnectorFetchResult): Array<string> {
  return result.events.map((event: NormalizedSecurityEvent): string => {
    return event.eventUid;
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

  expect(check).toBeDefined();
  return check!;
}

function expectNoSecret(checks: Array<SecurityConnectorCheck>): void {
  expect(JSON.stringify(checks)).not.toContain(API_KEY);
}

describe("ElasticSecurityConnector", () => {
  test("registers under the catalog's provider", () => {
    const connector: ElasticSecurityConnector = new ElasticSecurityConnector(
      (): Promise<DataSourceHttpResponse> => {
        throw new Error("must not be called");
      },
    );

    expect(connector.provider).toBe(
      SecurityEventConnectorProvider.ElasticSecurity,
    );
    expect(connector.provider).toBe(DEFINITION.provider);
  });

  describe("validateSettings", () => {
    const connector: ElasticSecurityConnector = new ElasticSecurityConnector(
      (): Promise<DataSourceHttpResponse> => {
        throw new Error("must not be called");
      },
    );

    test("accepts a Kibana origin, a space id and a base64 key", () => {
      expect(() => {
        connector.validateSettings(settings());
      }).not.toThrow();
      expect(() => {
        connector.validateSettings(
          settings({ config: { kibanaUrl: `${KIBANA_URL}/`, space: "" } }),
        );
      }).not.toThrow();
      expect(() => {
        connector.validateSettings(
          settings({
            config: {
              kibanaUrl: "https://abc123.kb.us-east-1.aws.found.io:9243",
            },
          }),
        );
      }).not.toThrow();
    });

    test.each([
      [
        { kibanaUrl: "", space: "" },
        { apiKey: API_KEY },
        `${fieldTitle("kibanaUrl")} is required.`,
      ],
      [
        { kibanaUrl: "kibana.example.com", space: "" },
        { apiKey: API_KEY },
        `${fieldTitle("kibanaUrl")} must be an absolute URL`,
      ],
      [
        { kibanaUrl: "ftp://kibana.example.com", space: "" },
        { apiKey: API_KEY },
        `${fieldTitle("kibanaUrl")} must use https`,
      ],
      [
        { kibanaUrl: `${KIBANA_URL}/?x=1`, space: "" },
        { apiKey: API_KEY },
        "must not contain a query string",
      ],
      [
        { kibanaUrl: `${KIBANA_URL}/s/security`, space: "" },
        { apiKey: API_KEY },
        `put the space id in the ${fieldTitle("space")} field`,
      ],
      [
        { kibanaUrl: `${KIBANA_URL}/api/status`, space: "" },
        { apiKey: API_KEY },
        "without an /api path",
      ],
      [
        { kibanaUrl: KIBANA_URL, space: "Security Team" },
        { apiKey: API_KEY },
        `${fieldTitle("space")} must be a space id`,
      ],
      [
        { kibanaUrl: KIBANA_URL, space: "" },
        { apiKey: "" },
        `${fieldTitle("apiKey")} is required.`,
      ],
      [
        { kibanaUrl: KIBANA_URL, space: "" },
        { apiKey: `ApiKey ${API_KEY}` },
        "without the 'ApiKey' prefix",
      ],
      [
        { kibanaUrl: KIBANA_URL, space: "" },
        { apiKey: "VuaCfGcBCdbkQm-e5aOx:ui2lp2axTNmsyakw9tvNnw" },
        "not the raw id:api_key pair",
      ],
    ])(
      "rejects config %j with secrets shaped like %j",
      (config: JSONObject, secrets: JSONObject, expected: string) => {
        expect(() => {
          connector.validateSettings(settings({ config, secrets }));
        }).toThrow(BadDataException);
        expect(() => {
          connector.validateSettings(settings({ config, secrets }));
        }).toThrow(expected);
      },
    );
  });

  describe("testConnection", () => {
    test("runs status, a one-record read over the last day, then 24h and 7d counts, and passes every check", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return ok(searchBody([alertHit("a1", "2026-09-12T10:05:03.412Z")]));
          },
          (): DataSourceHttpResponse => {
            return ok(searchBody([], { value: 12, relation: "eq" }));
          },
          (): DataSourceHttpResponse => {
            return ok(searchBody([], { value: 140, relation: "eq" }));
          },
        ],
      });

      const before: number = Date.now();
      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 20000,
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
      expectNoSecret(checks);

      expect(checkByKey(checks, "authentication").message).toContain(
        "kibana.example.com accepted the API key",
      );
      expect(checkByKey(checks, "authentication").details).toEqual({
        kibanaVersion: "9.1.0",
        level: "available",
        summary: "All services and plugins are available",
      });
      expect(checkByKey(checks, "read-permission").message).toContain(
        'rule "Potential Privilege Escalation via PKEXEC"',
      );
      expect(checkByKey(checks, "detections-available").message).toBe(
        "12 alerts created in the last 24 hours and 140 in the last 7 days.",
      );
      expect(checkByKey(checks, "detections-available").details).toEqual({
        createdLast24h: 12,
        createdLast7d: 140,
        hasMoreLast24h: false,
        hasMoreLast7d: false,
      });

      expect(harness.requests).toHaveLength(4);
      expect(new URL(harness.requests[0]!.url).pathname).toBe(
        `/s/${SPACE}/api/status`,
      );

      for (const request of harness.requests) {
        expect(request.timeoutInMs).toBe(20000);
        expect(request.headers?.["Authorization"]).toBe(`ApiKey ${API_KEY}`);
      }

      const probe: JSONObject = parseBody(harness.requests[1]!);
      expect(Object.keys(probe).sort()).toEqual(["query", "size", "sort"]);
      expect(probe["size"]).toBe(1);
      const probeRange: { gte: string; lt: string } = rangeOf(
        harness.requests[1]!,
      );
      expect(Date.parse(probeRange.lt) - Date.parse(probeRange.gte)).toBe(
        DAY_IN_MS,
      );
      expect(Date.parse(probeRange.lt)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(probeRange.lt)).toBeLessThanOrEqual(after);

      const count24h: JSONObject = parseBody(harness.requests[2]!);
      expect(Object.keys(count24h).sort()).toEqual([
        "query",
        "size",
        "track_total_hits",
      ]);
      expect(count24h["size"]).toBe(0);
      const range24h: { gte: string; lt: string } = rangeOf(
        harness.requests[2]!,
      );
      expect(Date.parse(range24h.lt) - Date.parse(range24h.gte)).toBe(
        DAY_IN_MS,
      );
      const range7d: { gte: string; lt: string } = rangeOf(
        harness.requests[3]!,
      );
      expect(Date.parse(range7d.lt) - Date.parse(range7d.gte)).toBe(
        7 * DAY_IN_MS,
      );
    });

    test("warns with remediation when nothing was created in seven days", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return ok(searchBody([]));
          },
          (): DataSourceHttpResponse => {
            return ok(searchBody([], { value: 0, relation: "eq" }));
          },
          (): DataSourceHttpResponse => {
            return ok(searchBody([], { value: 0, relation: "eq" }));
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 20000,
        });

      expect(checkByKey(checks, "read-permission").message).toContain(
        "No alert was created in the last 24 hours",
      );

      const availability: SecurityConnectorCheck = checkByKey(
        checks,
        "detections-available",
      );
      expect(availability.status).toBe("warn");
      expect(availability.message).toBe(
        "No alerts were created in the last 7 days. Polling will import new alerts as Elastic Security creates them.",
      );
      expect(availability.remediation).toContain("detection rules are enabled");
    });

    test("labels a lower-bound count with a plus sign", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return ok(searchBody([alertHit("a1", "2026-09-12T10:05:03.412Z")]));
          },
          (): DataSourceHttpResponse => {
            return ok(searchBody([], { value: 1, relation: "eq" }));
          },
          (): DataSourceHttpResponse => {
            return ok(searchBody([], { value: 10000, relation: "gte" }));
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
      expect(availability.status).toBe("pass");
      expect(availability.message).toBe(
        "1 alert created in the last 24 hours and 10000+ in the last 7 days.",
      );
      expect(availability.details?.["hasMoreLast7d"]).toBe(true);
    });

    test("fails authentication on a redacted status document and skips the rest without another request", async () => {
      const harness: Harness = buildHarness({
        status: (): DataSourceHttpResponse => {
          return ok({ status: { overall: { level: "degraded" } } });
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
      expect(checkByKey(checks, "authentication").message).toContain(
        "redacted to the overall level only (degraded)",
      );
      expect(checkByKey(checks, "authentication").remediation).toContain(
        "anonymous access",
      );
      expect(harness.requests).toHaveLength(1);
    });

    test("fails authentication on a 401 with key remediation and never leaks the key", async () => {
      const harness: Harness = buildHarness({
        status: (): DataSourceHttpResponse => {
          return status(
            401,
            JSON.stringify({
              statusCode: 401,
              error: "Unauthorized",
              message: `unable to authenticate; Authorization: ApiKey ${API_KEY}`,
              api_key: API_KEY,
            }),
          );
        },
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 20000,
        });

      const auth: SecurityConnectorCheck = checkByKey(checks, "authentication");
      expect(auth.status).toBe("fail");
      expect(auth.message).toMatch(
        /^Elastic Security status request failed \(HTTP 401\): /,
      );
      expect(auth.remediation).toContain("Create a new API key");
      expect(checkByKey(checks, "read-permission").status).toBe("skip");
      expect(checkByKey(checks, "detections-available").status).toBe("skip");
      expectNoSecret(checks);
    });

    test("fails the read check on a 403 with privilege remediation and skips the count", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return status(
              403,
              JSON.stringify({
                statusCode: 403,
                error: "Forbidden",
                message:
                  "action [indices:data/read/search] is unauthorized for API key",
              }),
            );
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 20000,
        });

      expect(checkByKey(checks, "authentication").status).toBe("pass");

      const read: SecurityConnectorCheck = checkByKey(
        checks,
        "read-permission",
      );
      expect(read.status).toBe("fail");
      expect(read.message).toMatch(
        /^Elastic Security alerts search failed \(HTTP 403\): /,
      );
      expect(read.remediation).toContain(".alerts-security.alerts-<space-id>");
      expect(checkByKey(checks, "detections-available").status).toBe("skip");
      expect(harness.requests).toHaveLength(2);
    });

    test("fails the count check on a 429 after a successful read", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return ok(searchBody([]));
          },
          (): DataSourceHttpResponse => {
            return status(429, "Too Many Requests");
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
      expect(availability.message).toMatch(
        /^Elastic Security alerts search failed \(HTTP 429\): Too Many Requests/,
      );
      expect(availability.remediation).toContain("rate limiting");
    });

    test("explains a timeout on the status probe as a reachability problem", async () => {
      const harness: Harness = buildHarness({
        status: (): DataSourceHttpResponse => {
          throw new BadDataException(
            "Could not reach data source: timeout of 20000ms exceeded",
          );
        },
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 20000,
        });

      const auth: SecurityConnectorCheck = checkByKey(checks, "authentication");
      expect(auth.status).toBe("fail");
      expect(auth.message).toBe(
        "Elastic Security status request did not complete: Could not reach data source: timeout of 20000ms exceeded",
      );
      expect(auth.remediation).toContain("reachable from the OneUptime");
    });

    test("explains a 404 on the read as a wrong URL or space", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return status(
              404,
              JSON.stringify({ statusCode: 404, error: "Not Found" }),
            );
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 20000,
        });

      expect(checkByKey(checks, "read-permission").remediation).toContain(
        `Check the ${fieldTitle("kibanaUrl")} and ${fieldTitle("space")}`,
      );
    });

    test("never contacts Kibana when the settings are invalid", async () => {
      const harness: Harness = buildHarness({});

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(
          settings({ secrets: { apiKey: "" } }),
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
      expect(checkByKey(checks, "authentication").message).toBe(
        `${fieldTitle("apiKey")} is required.`,
      );
      expect(harness.requests).toHaveLength(0);
    });
  });

  describe("fetchEvents", () => {
    test("reads one short page over the window, normalizes it and attributes it to the catalog's vendor and product", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return ok(
              searchBody([
                alertHit("a1", "2026-09-12T10:05:03.412Z"),
                alertHit("a2", "2026-09-12T11:00:00.000Z", {
                  "kibana.alert.severity": "low",
                  "kibana.alert.reason": "",
                }),
              ]),
            );
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ sampleLimit: 1, requestTimeoutInMs: 60000 }),
      );

      expect(result.complete).toBe(true);
      expect(result.resumeAfter).toBeUndefined();
      expect(result.requestCount).toBe(1);
      expect(result.fetchedCount).toBe(2);
      expect(result.rejectedCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.warnings).toEqual([]);
      expect(result.events).toHaveLength(2);

      const first: NormalizedSecurityEvent = result.events[0]!;
      expect(first.eventUid).toBe("a1");
      expect(first.vendorName).toBe(DEFINITION.vendorName);
      expect(first.productName).toBe(DEFINITION.productName);
      expect(first.classUid).toBe(2004);
      expect(first.severityName).toBe("High");
      expect(first.ruleName).toBe("Potential Privilege Escalation via PKEXEC");
      expect(first.principalHost).toBe("web-01");
      expect(first.mitreTechniques).toEqual(["T1068"]);
      expect(first.time.toISOString()).toBe("2026-09-12T09:58:41.117Z");

      expect(result.samples).toHaveLength(1);
      const sample: SecurityConnectorSample = result.samples[0]!;
      expect(sample).toEqual({
        id: "a1",
        title: "Potential Privilege Escalation via PKEXEC",
        severity: "High",
        createdTime: "2026-09-12T10:05:03.412Z",
        eventTime: "2026-09-12T09:58:41.117Z",
      });

      const request: DataSourceHttpRequest = harness.requests[0]!;
      expect(request.timeoutInMs).toBe(60000);
      expect(new URL(request.url).pathname).toBe(
        `/s/${SPACE}/api/detection_engine/signals/search`,
      );
      expect(rangeOf(request)).toEqual({
        gte: START.toISOString(),
        lt: END.toISOString(),
      });
      expect(parseBody(request)["size"]).toBe(ELASTIC_SECURITY_MAX_PAGE_SIZE);
      expect(parseBody(request)["sort"]).toEqual([{ "@timestamp": "asc" }]);
    });

    test("pages by advancing the lower bound to the last hit's @timestamp, excludes the alert read there, and reports where to resume", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return ok(
              searchBody([
                alertHit("a1", "2026-09-12T10:05:03.412Z"),
                alertHit("a2", "2026-09-12T11:00:00.000Z"),
              ]),
            );
          },
          (): DataSourceHttpResponse => {
            return ok(
              searchBody([
                alertHit("a2", "2026-09-12T11:00:00.000Z"),
                alertHit("a3", "2026-09-12T12:00:00.000Z"),
              ]),
            );
          },
          (): DataSourceHttpResponse => {
            return ok(searchBody([alertHit("a3", "2026-09-12T12:00:00.000Z")]));
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ maxEvents: 2 }),
      );

      expect(result.complete).toBe(false);
      expect(result.fetchedCount).toBe(2);
      expect(eventUids(result)).toEqual(["a1", "a2"]);
      expect(result.requestCount).toBe(2);
      /*
       * Review finding bound-hit-window-never-advances: the warning used to
       * say the cursor is held, and the poller re-read the same alerts
       * forever. The fetch now reports the last alert read as the resume
       * point.
       */
      expect(result.resumeAfter?.toISOString()).toBe(
        "2026-09-12T11:00:00.000Z",
      );
      expect(result.warnings).toEqual([
        "Stopped after collecting 2 alerts; the window holds more.",
      ]);

      expect(parseBody(harness.requests[0]!)["size"]).toBe(2);
      expect(excludedIdsOf(harness.requests[0]!)).toEqual([]);
      expect(rangeOf(harness.requests[1]!)).toEqual({
        gte: "2026-09-12T11:00:00.000Z",
        lt: END.toISOString(),
      });
      expect(excludedIdsOf(harness.requests[1]!)).toEqual(["a2"]);
    });

    test("reads a full page, then the rest from the last timestamp, and finishes complete on the short page", async () => {
      const firstPage: Array<JSONObject> = fullPage(0);
      const lastOfFirstPage: JSONObject = firstPage[firstPage.length - 1]!;
      const lastTimestamp: string = String(
        (lastOfFirstPage["_source"] as JSONObject)["@timestamp"],
      );
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return ok(searchBody(firstPage));
          },
          (): DataSourceHttpResponse => {
            return ok(
              searchBody([
                lastOfFirstPage,
                alertHit("tail", "2026-09-12T20:00:00.000Z"),
              ]),
            );
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions(),
      );

      expect(result.complete).toBe(true);
      expect(result.resumeAfter).toBeUndefined();
      expect(result.warnings).toEqual([]);
      expect(result.requestCount).toBe(2);
      expect(result.fetchedCount).toBe(ELASTIC_SECURITY_MAX_PAGE_SIZE + 1);
      expect(result.events).toHaveLength(ELASTIC_SECURITY_MAX_PAGE_SIZE + 1);
      expect(result.events[result.events.length - 1]!.eventUid).toBe("tail");
      expect(result.samples).toHaveLength(25);

      expect(parseBody(harness.requests[0]!)["size"]).toBe(
        ELASTIC_SECURITY_MAX_PAGE_SIZE,
      );
      expect(rangeOf(harness.requests[0]!)).toEqual({
        gte: START.toISOString(),
        lt: END.toISOString(),
      });
      expect(rangeOf(harness.requests[1]!)).toEqual({
        gte: lastTimestamp,
        lt: END.toISOString(),
      });
      expect(excludedIdsOf(harness.requests[1]!)).toEqual([
        String(lastOfFirstPage["_id"]),
      ]);
    });

    test("stops at the request bound and reports the window as incomplete", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return ok(
              searchBody([
                alertHit("a1", "2026-09-12T10:05:03.412Z"),
                alertHit("a2", "2026-09-12T11:00:00.000Z"),
              ]),
            );
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ maxEvents: 2, maxRequests: 1 }),
      );

      expect(result.complete).toBe(false);
      expect(result.requestCount).toBe(1);
      expect(result.fetchedCount).toBe(2);
      expect(result.events).toHaveLength(2);
      expect(result.resumeAfter?.toISOString()).toBe(
        "2026-09-12T11:00:00.000Z",
      );
      expect(result.warnings).toEqual([
        "Stopped after 1 requests with alerts still unread from 2026-09-12T11:00:00.000Z.",
      ]);
      expect(harness.requests).toHaveLength(1);
    });

    /*
     * Review finding bound-hit-window-never-advances: this test used to
     * assert that a full page sharing one creation time ends the fetch as
     * incomplete. Nothing could ever read past it, so the poller stayed on
     * that window (and a rule execution that wrote exactly a page of
     * alerts was reported Partial with everything read). The next request
     * now excludes the ids already read at that instant.
     */
    test("pages past a full page sharing one creation time by excluding the alerts already read there", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return ok(
              searchBody([
                alertHit("a1", "2026-09-12T10:05:03.412Z"),
                alertHit("a2", "2026-09-12T10:05:03.412Z"),
              ]),
            );
          },
          (): DataSourceHttpResponse => {
            return ok(searchBody([]));
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ maxEvents: 2 }),
      );

      expect(result.complete).toBe(true);
      expect(result.resumeAfter).toBeUndefined();
      expect(result.warnings).toEqual([]);
      expect(result.requestCount).toBe(2);
      expect(eventUids(result)).toEqual(["a1", "a2"]);
      expect(rangeOf(harness.requests[1]!)).toEqual({
        gte: "2026-09-12T10:05:03.412Z",
        lt: END.toISOString(),
      });
      expect(excludedIdsOf(harness.requests[1]!)).toEqual(["a1", "a2"]);
    });

    test("reads more than one page of alerts sharing one @timestamp without skipping or re-reading any", async () => {
      const tie: string = "2026-09-12T12:00:00.000Z";
      const alerts: Array<FakeAlert> = [
        ...alertsAt("before", 10, (index: number): string => {
          return new Date(START.getTime() + (index + 1) * 1000).toISOString();
        }),
        ...alertsAt("tie", 2500, (): string => {
          return tie;
        }),
        ...alertsAt("after", 10, (index: number): string => {
          return new Date(Date.parse(tie) + (index + 1) * 1000).toISOString();
        }),
      ];
      const harness: Harness = buildHarness({ kibana: fakeKibana(alerts) });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions(),
      );

      expect(result.complete).toBe(true);
      expect(result.resumeAfter).toBeUndefined();
      expect(result.warnings).toEqual([]);
      expect(result.fetchedCount).toBe(alerts.length);

      const uids: Array<string> = eventUids(result);
      expect(new Set<string>(uids).size).toBe(alerts.length);
      expect(uids.slice(-10)).toEqual(
        alertsAt("after", 10, (): string => {
          return "";
        }).map((alert: FakeAlert): string => {
          return alert.id;
        }),
      );

      /*
       * Page 1: 10 older alerts and 990 at the tie. Page 2: 1,000 more at
       * the tie, excluding the 990. Page 3: the last 510 at the tie and the
       * 10 newer alerts, excluding all 1,990 read at the tie.
       */
      expect(result.requestCount).toBe(3);
      expect(
        harness.requests.map((request: DataSourceHttpRequest): number => {
          return excludedIdsOf(request).length;
        }),
      ).toEqual([0, 990, 1990]);
      expect(rangeOf(harness.requests[1]!).gte).toBe(tie);
      expect(rangeOf(harness.requests[2]!).gte).toBe(tie);
    });

    test("finishes complete when exactly one page of alerts shares a timestamp", async () => {
      const tie: string = "2026-09-12T12:00:00.000Z";
      const alerts: Array<FakeAlert> = alertsAt(
        "tie",
        ELASTIC_SECURITY_MAX_PAGE_SIZE,
        (): string => {
          return tie;
        },
      );
      const harness: Harness = buildHarness({ kibana: fakeKibana(alerts) });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions(),
      );

      expect(result.complete).toBe(true);
      expect(result.resumeAfter).toBeUndefined();
      expect(result.fetchedCount).toBe(ELASTIC_SECURITY_MAX_PAGE_SIZE);
      expect(result.requestCount).toBe(2);
    });

    test("resumes from resumeAfter across fetches, the way the poller does, until every alert is read", async () => {
      const firstTie: string = "2026-09-12T12:00:00.000Z";
      const secondTie: string = "2026-09-12T15:00:00.000Z";
      const alerts: Array<FakeAlert> = [
        ...alertsAt("early", 300, (index: number): string => {
          return new Date(START.getTime() + (index + 10) * 1000).toISOString();
        }),
        ...alertsAt("first-tie", 1500, (): string => {
          return firstTie;
        }),
        ...alertsAt("middle", 700, (index: number): string => {
          return new Date(
            Date.parse(firstTie) + (index + 1) * 1000,
          ).toISOString();
        }),
        ...alertsAt("second-tie", 1200, (): string => {
          return secondTie;
        }),
        ...alertsAt("late", 100, (index: number): string => {
          return new Date(
            Date.parse(secondTie) + (index + 1) * 1000,
          ).toISOString();
        }),
      ];
      const harness: Harness = buildHarness({ kibana: fakeKibana(alerts) });
      const overlapInMs: number = 60 * 1000;
      const imported: Set<string> = new Set<string>();
      let startTime: Date = START;
      let polls: number = 0;
      let complete: boolean = false;

      while (!complete && polls < 10) {
        polls += 1;

        const result: ConnectorFetchResult =
          await harness.connector.fetchEvents(
            settings(),
            { startTime, endTime: END },
            fetchOptions({ maxEvents: 2000 }),
          );

        for (const uid of eventUids(result)) {
          imported.add(uid);
        }

        complete = result.complete;

        if (!complete) {
          // The poller only moves on when the resume point is past the overlap.
          expect(result.resumeAfter).toBeDefined();
          expect(result.resumeAfter!.getTime()).toBeGreaterThan(
            startTime.getTime() + overlapInMs,
          );
          startTime = new Date(result.resumeAfter!.getTime() - overlapInMs);
        }
      }

      expect(complete).toBe(true);
      expect(polls).toBe(2);
      expect(imported.size).toBe(alerts.length);
    });

    test("stops as incomplete when the alerts sharing one timestamp are too many to exclude in one request", async () => {
      const tie: string = "2026-09-12T12:00:00.000Z";
      const padding: string = "x".repeat(600);
      const alerts: Array<FakeAlert> = alertsAt(
        `${padding}-tie`,
        ELASTIC_SECURITY_MAX_PAGE_SIZE + 100,
        (): string => {
          return tie;
        },
      );
      expect(
        Buffer.byteLength(
          JSON.stringify(
            alerts
              .slice(0, ELASTIC_SECURITY_MAX_PAGE_SIZE)
              .map((alert: FakeAlert): string => {
                return alert.id;
              }),
          ),
        ),
      ).toBeGreaterThan(ELASTIC_SECURITY_MAX_EXCLUDED_ID_BYTES);
      const harness: Harness = buildHarness({ kibana: fakeKibana(alerts) });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions(),
      );

      expect(result.complete).toBe(false);
      expect(result.requestCount).toBe(1);
      expect(result.fetchedCount).toBe(ELASTIC_SECURITY_MAX_PAGE_SIZE);
      expect(result.resumeAfter?.toISOString()).toBe(tie);
      expect(result.warnings).toEqual([
        `${ELASTIC_SECURITY_MAX_PAGE_SIZE} alerts read so far share the creation time ${tie}, more than one search request can exclude, so the rest of the alerts created at that instant were not read.`,
      ]);
    });

    test("stops when a full page carries only already-read alerts instead of looping", async () => {
      const page: Array<JSONObject> = fullPage(0);
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return ok(searchBody(page));
          },
          (): DataSourceHttpResponse => {
            return ok(searchBody(page));
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions(),
      );

      const lastTimestamp: string = new Date(
        START.getTime() + (ELASTIC_SECURITY_MAX_PAGE_SIZE - 1) * 1000,
      ).toISOString();

      expect(result.complete).toBe(false);
      expect(result.requestCount).toBe(2);
      expect(result.fetchedCount).toBe(ELASTIC_SECURITY_MAX_PAGE_SIZE);
      expect(result.resumeAfter?.toISOString()).toBe(lastTimestamp);
      expect(result.warnings).toEqual([
        `A full page of alerts from ${lastTimestamp} contained only alerts already read, so the window cannot be paged further.`,
      ]);
      expect(harness.requests).toHaveLength(2);
      // The scripted source ignored this exclusion; the id memory still held.
      expect(excludedIdsOf(harness.requests[1]!)).toEqual([
        `alert-${ELASTIC_SECURITY_MAX_PAGE_SIZE - 1}`,
      ]);
    });

    test("counts documents the normalizer does not recognize as rejected and keeps going", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return ok(
              searchBody([
                alertHit("a1", "2026-09-12T10:05:03.412Z"),
                {
                  _index: "logs-000001",
                  _id: "not-an-alert",
                  _source: {
                    "@timestamp": "2026-09-12T10:06:00.000Z",
                    message: "hi",
                  },
                },
              ]),
            );
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions(),
      );

      expect(result.complete).toBe(true);
      expect(result.fetchedCount).toBe(2);
      expect(result.rejectedCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(result.events).toHaveLength(1);
    });

    test("throws on an authentication failure so the poller records a failed run, without the key", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            return status(
              401,
              JSON.stringify({
                statusCode: 401,
                error: "Unauthorized",
                message: `Authorization: ApiKey ${API_KEY}`,
              }),
            );
          },
        ],
      });

      let thrown: Error | null = null;

      try {
        await harness.connector.fetchEvents(
          settings(),
          { startTime: START, endTime: END },
          fetchOptions(),
        );
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown).not.toBeNull();
      expect(thrown!.message).toMatch(
        /^Elastic Security alerts search failed \(HTTP 401\): /,
      );
      expect(thrown!.message).not.toContain(API_KEY);
    });

    test("throws on a timeout so the cursor is held", async () => {
      const harness: Harness = buildHarness({
        search: [
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              "Could not reach data source: timeout of 60000ms exceeded",
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
        "Elastic Security alerts search did not complete: Could not reach data source: timeout of 60000ms exceeded",
      );
    });

    test("rejects invalid settings before contacting Kibana", async () => {
      const harness: Harness = buildHarness({});

      await expect(
        harness.connector.fetchEvents(
          settings({ config: { kibanaUrl: "not a url" } }),
          { startTime: START, endTime: END },
          fetchOptions(),
        ),
      ).rejects.toThrow(BadDataException);
      expect(harness.requests).toHaveLength(0);
    });
  });
});
