import { describe, expect, test } from "@jest/globals";
import CrowdStrikeFalconConnector from "../../../../../../Server/Utils/SecurityEvent/Connectors/CrowdStrikeFalcon/CrowdStrikeFalconConnector";
import CrowdStrikeFalconClient, {
  CROWDSTRIKE_ALERTS_OFFSET_CEILING,
  CROWDSTRIKE_ALERTS_PAGE_SIZE,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/CrowdStrikeFalcon/CrowdStrikeFalconClient";
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
import APIException from "../../../../../../Types/Exception/ApiException";
import Dictionary from "../../../../../../Types/Dictionary";
import { JSONObject } from "../../../../../../Types/JSON";
import { SecurityConnectorCheck } from "../../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import SecurityEventConnectorProvider from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import OcsfSeverity from "../../../../../../Types/SecurityEvent/OcsfSeverity";

/*
 * The connector as the framework depends on it: settings are read by the
 * catalog's keys, the three test checks carry the keys the report UI
 * groups on, fetchEvents pages by created_timestamp and stops — with
 * complete=false, a warning and the created_timestamp of the last alert
 * read as resumeAfter — at every bound, and nothing secret can appear in
 * a check message. The transport is the injected seam; nothing
 * here touches the network.
 */

const CLIENT_ID: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const CLIENT_SECRET: string = "Zx9YwV8uT7sR6qP5oN4mL3kJ2iH1gF0eDcBa";
const ACCESS_TOKEN: string =
  "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmYWxjb24ifQ.c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWduYXR1cmU";
const CID: string = "92012896127c4a8236ba7601b886b0";
const START: Date = new Date("2026-09-12T10:00:00.000Z");
const END: Date = new Date("2026-09-13T10:00:00.000Z");

const DEFINITION: SecurityEventConnectorDefinition =
  getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.CrowdStrikeFalcon,
  )!;

type Responder = (
  request: DataSourceHttpRequest,
) => DataSourceHttpResponse | Promise<DataSourceHttpResponse>;

interface Harness {
  requests: Array<DataSourceHttpRequest>;
  connector: CrowdStrikeFalconConnector;
}

function settings(overrides?: {
  config?: JSONObject;
  secrets?: JSONObject;
}): SecurityConnectorSettings {
  return {
    provider: SecurityEventConnectorProvider.CrowdStrikeFalcon,
    config: overrides?.config || { clientId: CLIENT_ID, cloud: "us-2" },
    secrets: overrides?.secrets || { clientSecret: CLIENT_SECRET },
    alertingOnly: false,
  };
}

function fetchOptions(
  overrides?: Partial<ConnectorFetchOptions>,
): ConnectorFetchOptions {
  return {
    maxRequests: 20,
    maxEvents: 10000,
    requestTimeoutInMs: 5000,
    sampleLimit: 25,
    ...overrides,
  };
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
  return ok(
    { access_token: ACCESS_TOKEN, expires_in: 1799, token_type: "bearer" },
    201,
  );
}

function compositeId(index: number): string {
  return `${CID}:ind:2ce412d17b334ad4adc8c1c54dbfec4b:${String(index).padStart(12, "0")}-5761-42627600`;
}

function idsPage(
  ids: Array<string>,
  total: number | null,
): DataSourceHttpResponse {
  return ok({
    meta: {
      query_time: 0.012,
      ...(total === null
        ? {}
        : { pagination: { total, offset: 0, limit: 1000 } }),
    },
    resources: ids,
    errors: [],
  });
}

function alert(id: string, overrides?: JSONObject): JSONObject {
  return {
    composite_id: id,
    id: id.split(":").slice(1).join(":"),
    cid: CID,
    name: "PrewittPupAdwareSensorDetect-Lowest",
    display_name: "Adware/PUP detected",
    description:
      "This file meets the Adware/PUP Anti-malware ML algorithm's lowest-confidence threshold.",
    severity: 21,
    severity_name: "low",
    status: "new",
    tactic: "MachineLearning",
    tactic_id: "CSTA0004",
    technique: "Adware/PUP",
    technique_id: "CST0000",
    created_timestamp: "2026-09-12T18:01:23.995Z",
    timestamp: "2026-09-12T18:00:22.328Z",
    updated_timestamp: "2026-09-12T19:00:23.985Z",
    product: "epp",
    type: "ldt",
    device: {
      hostname: "ABC709-1175",
      local_ip: "10.20.30.40",
      external_ip: "81.2.69.142",
      platform_name: "Windows",
    },
    user_name: "mohit.jha",
    user_id: "S-1-5-21-1909377054-3469629671-4104191496-4425",
    filename: "openvpn-install.exe",
    cmdline: '"C:\\Users\\mohit.jha\\Downloads\\openvpn-install.exe"',
    sha256: "b26a6791b72753d2317efd5e1363d93fdd33e611c8b9e08a3b24ea4d755b81fd",
    ...overrides,
  };
}

function entitiesFor(ids: Array<string>): DataSourceHttpResponse {
  return ok({
    meta: { query_time: 0.02 },
    resources: ids.map((id: string): JSONObject => {
      return alert(id);
    }),
    errors: [],
  });
}

/*
 * A created_timestamp one second after START per index, so ids listed in
 * index order are in the ascending creation order the query asks for.
 */
function createdAtFor(index: number): string {
  return new Date(START.getTime() + index * 1000).toISOString();
}

function datedEntitiesFor(
  ids: Array<string>,
  indexOf: (id: string) => number,
): DataSourceHttpResponse {
  return ok({
    meta: { query_time: 0.02 },
    resources: ids.map((id: string): JSONObject => {
      return alert(id, { created_timestamp: createdAtFor(indexOf(id)) });
    }),
    errors: [],
  });
}

function compositeIdIndex(id: string): number {
  const match: RegExpMatchArray | null = id.match(/:(\d{12})-5761-42627600/);

  if (!match) {
    throw new Error(`Unexpected composite id ${id}`);
  }

  return Number(match[1]);
}

function entityRequestIds(request: DataSourceHttpRequest): Array<string> {
  return (JSON.parse(request.body as string) as JSONObject)[
    "composite_ids"
  ] as Array<string>;
}

/*
 * Entity responders default to "echo an alert for every id in the body",
 * which keeps pagination tests about the ids pages; override for the
 * rejected/malformed cases.
 */
function buildHarness(options: {
  token?: Responder;
  queries?: Array<Responder>;
  entities?: Array<Responder>;
}): Harness {
  const requests: Array<DataSourceHttpRequest> = [];
  const queryResponders: Array<Responder> = [...(options.queries || [])];
  const entityResponders: Array<Responder> = [...(options.entities || [])];

  const connector: CrowdStrikeFalconConnector = new CrowdStrikeFalconConnector(
    async (request: DataSourceHttpRequest): Promise<DataSourceHttpResponse> => {
      requests.push(request);

      const url: URL = new URL(request.url);

      if (url.pathname === "/oauth2/token") {
        return (options.token || tokenResponse)(request);
      }

      if (url.pathname === "/alerts/queries/alerts/v2") {
        const responder: Responder | undefined = queryResponders.shift();

        if (!responder) {
          throw new Error(`Unexpected alerts query: ${request.url}`);
        }

        return responder(request);
      }

      if (url.pathname === "/alerts/entities/alerts/v2") {
        const responder: Responder | undefined = entityResponders.shift();

        if (responder) {
          return responder(request);
        }

        const body: JSONObject = JSON.parse(request.body as string);
        return entitiesFor(body["composite_ids"] as Array<string>);
      }

      throw new Error(`Unexpected request to ${request.url}`);
    },
  );

  return { requests, connector };
}

function pathnames(harness: Harness): Array<string> {
  return harness.requests.map((request: DataSourceHttpRequest): string => {
    return new URL(request.url).pathname;
  });
}

function queryRequests(harness: Harness): Array<URL> {
  return harness.requests
    .filter((request: DataSourceHttpRequest): boolean => {
      return request.url.includes("/alerts/queries/alerts/v2");
    })
    .map((request: DataSourceHttpRequest): URL => {
      return new URL(request.url);
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

describe("CrowdStrikeFalconConnector", () => {
  test("registers under the catalog's provider key", () => {
    expect(new CrowdStrikeFalconConnector().provider).toBe(
      SecurityEventConnectorProvider.CrowdStrikeFalcon,
    );
    expect(new CrowdStrikeFalconConnector().provider).toBe(
      "crowdstrike-falcon",
    );
  });

  describe("validateSettings", () => {
    test("accepts the catalog's config and secret keys, cloud case-insensitively", () => {
      const connector: CrowdStrikeFalconConnector =
        new CrowdStrikeFalconConnector();

      expect(() => {
        connector.validateSettings(settings());
      }).not.toThrow();
      expect(() => {
        connector.validateSettings(
          settings({ config: { clientId: CLIENT_ID, cloud: "US-GOV-1" } }),
        );
      }).not.toThrow();
    });

    test("defaults the cloud to us-1 when absent", () => {
      expect(() => {
        new CrowdStrikeFalconConnector().validateSettings(
          settings({ config: { clientId: CLIENT_ID } }),
        );
      }).not.toThrow();
    });

    test("names the Client ID field from the catalog when it is missing or malformed", () => {
      const connector: CrowdStrikeFalconConnector =
        new CrowdStrikeFalconConnector();

      for (const clientId of [
        "",
        "   ",
        "has space",
        "x".repeat(200),
        "short",
      ]) {
        expect(() => {
          connector.validateSettings(
            settings({ config: { clientId, cloud: "us-1" } }),
          );
        }).toThrow(BadDataException);
        expect(() => {
          connector.validateSettings(
            settings({ config: { clientId, cloud: "us-1" } }),
          );
        }).toThrow(/^Client ID must be the Falcon API client ID/);
      }
    });

    test("names the Falcon cloud field and lists the valid clouds on an unknown cloud", () => {
      expect(() => {
        new CrowdStrikeFalconConnector().validateSettings(
          settings({ config: { clientId: CLIENT_ID, cloud: "ap-1" } }),
        );
      }).toThrow("Falcon cloud must be one of: us-1, us-2, eu-1, us-gov-1.");
    });

    test("names the Client secret field when the secret is missing", () => {
      expect(() => {
        new CrowdStrikeFalconConnector().validateSettings(
          settings({ secrets: {} }),
        );
      }).toThrow("Client secret is required.");
    });

    test("field titles come from the catalog entry", () => {
      const titles: Array<string> = [
        ...DEFINITION.configFields,
        ...DEFINITION.secretFields,
      ].map((field: { title: string }): string => {
        return field.title;
      });

      expect(titles).toEqual(["Client ID", "Falcon cloud", "Client secret"]);
    });
  });

  describe("testConnection", () => {
    test("returns authentication, read-permission and detections-available checks, all passing", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage([compositeId(1)], 12);
          },
          (): DataSourceHttpResponse => {
            return idsPage([compositeId(1)], 12);
          },
          (): DataSourceHttpResponse => {
            return idsPage([compositeId(1)], 140);
          },
        ],
      });
      const before: number = Date.now();

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 20000,
        });

      expect(
        checks.map((check: SecurityConnectorCheck): string => {
          return check.key;
        }),
      ).toEqual(["authentication", "read-permission", "detections-available"]);
      expect(
        checks.map((check: SecurityConnectorCheck): string => {
          return check.status;
        }),
      ).toEqual(["pass", "pass", "pass"]);

      expect(checkByKey(checks, "authentication").message).toContain(
        "api.us-2.crowdstrike.com",
      );
      expect(checkByKey(checks, "read-permission").message).toContain(
        "Alerts: Read",
      );

      const available: SecurityConnectorCheck = checkByKey(
        checks,
        "detections-available",
      );
      expect(available.message).toBe(
        "12 alerts created in the last 24 hours and 140 in the last 7 days.",
      );
      expect(available.details).toEqual({
        createdLast24h: "12",
        createdLast7d: "140",
        hasMoreLast24h: false,
        hasMoreLast7d: false,
      });
      expect(available.remediation).toBeUndefined();
      expectNoSecrets(checks);

      // One token request, then three one-record probes.
      expect(pathnames(harness)).toEqual([
        "/oauth2/token",
        "/alerts/queries/alerts/v2",
        "/alerts/queries/alerts/v2",
        "/alerts/queries/alerts/v2",
      ]);

      for (const request of harness.requests) {
        expect(request.timeoutInMs).toBe(20000);
      }

      const probes: Array<URL> = queryRequests(harness);

      for (const probe of probes) {
        expect(Array.from(probe.searchParams.keys()).sort()).toEqual([
          "filter",
          "limit",
          "offset",
          "sort",
        ]);
        expect(probe.searchParams.get("limit")).toBe("1");
        expect(probe.searchParams.get("offset")).toBe("0");
      }

      /*
       * The read probe and the 24h count cover the last day; the 7d count
       * covers the last week. Parsed from the FQL rather than matched as a
       * substring so a reordered filter still passes.
       */
      const windows: Array<[Date, Date]> = probes.map(
        (probe: URL): [Date, Date] => {
          const filter: string = probe.searchParams.get("filter") || "";
          const match: RegExpMatchArray | null = filter.match(
            /^created_timestamp:>='([^']+)'\+created_timestamp:<'([^']+)'$/,
          );
          expect(match).not.toBeNull();
          return [new Date(match![1]!), new Date(match![2]!)];
        },
      );

      const dayInMs: number = 24 * 60 * 60 * 1000;
      expect(windows[0]![1].getTime() - windows[0]![0].getTime()).toBe(dayInMs);
      expect(windows[1]![1].getTime() - windows[1]![0].getTime()).toBe(dayInMs);
      expect(windows[2]![1].getTime() - windows[2]![0].getTime()).toBe(
        7 * dayInMs,
      );
      expect(windows[0]![1].getTime()).toBeGreaterThanOrEqual(before);
    });

    test("warns instead of passing when no alert was created in the last 7 days", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage([], 0);
          },
          (): DataSourceHttpResponse => {
            return idsPage([], 0);
          },
          (): DataSourceHttpResponse => {
            return idsPage([], 0);
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 20000,
        });

      const available: SecurityConnectorCheck = checkByKey(
        checks,
        "detections-available",
      );
      expect(available.status).toBe("warn");
      expect(available.message).toBe(
        "No alerts were created in the last 7 days. Polling will import new alerts as Falcon creates them.",
      );
      expect(available.remediation).toContain("Falcon console");
    });

    test("labels counts as N+ when Falcon omits the pagination total", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage([compositeId(1)], null);
          },
          (): DataSourceHttpResponse => {
            return idsPage([compositeId(1)], null);
          },
          (): DataSourceHttpResponse => {
            return idsPage([compositeId(1)], null);
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 20000,
        });

      const available: SecurityConnectorCheck = checkByKey(
        checks,
        "detections-available",
      );
      expect(available.status).toBe("pass");
      expect(available.message).toBe(
        "1+ alerts created in the last 24 hours and 1+ in the last 7 days.",
      );
      expect(available.details?.["hasMoreLast24h"]).toBe(true);
    });

    test("fails authentication without contacting Falcon when the settings are malformed", async () => {
      const harness: Harness = buildHarness({});

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(
          settings({ config: { clientId: CLIENT_ID, cloud: "mars-1" } }),
          { requestTimeoutInMs: 20000 },
        );

      expect(checks).toHaveLength(1);
      expect(checks[0]!.key).toBe("authentication");
      expect(checks[0]!.status).toBe("fail");
      expect(checks[0]!.message).toContain("Falcon cloud must be one of");
      expect(harness.requests).toHaveLength(0);
    });

    test("fails authentication on a 401 with cloud and credential remediation, and skips the later checks", async () => {
      const harness: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          return status(
            401,
            JSON.stringify({
              errors: [
                {
                  code: 401,
                  message: `access denied, invalid bearer token client_secret=${CLIENT_SECRET}`,
                },
              ],
            }),
          );
        },
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 20000,
        });

      expect(
        checks.map((check: SecurityConnectorCheck): [string, string] => {
          return [check.key, check.status];
        }),
      ).toEqual([
        ["authentication", "fail"],
        ["read-permission", "skip"],
        ["detections-available", "skip"],
      ]);

      const auth: SecurityConnectorCheck = checkByKey(checks, "authentication");
      expect(auth.message).toMatch(
        /^CrowdStrike Falcon token request failed \(HTTP 401\): /,
      );
      expect(auth.remediation).toContain("Falcon cloud (us-2)");
      expect(auth.remediation).toContain("Client secret");
      expectNoSecrets(checks);
      expect(pathnames(harness)).toEqual(["/oauth2/token"]);
    });

    test("fails authentication on a timeout with a connectivity remediation naming the cloud host", async () => {
      const harness: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
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
        "CrowdStrike Falcon token request could not be completed: Could not reach data source: timeout of 20000ms exceeded",
      );
      expect(auth.remediation).toContain("api.us-2.crowdstrike.com");
    });

    test("fails read-permission on a 403 with the Alerts: Read scope remediation and skips the count", async () => {
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

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 20000,
        });

      expect(
        checks.map((check: SecurityConnectorCheck): [string, string] => {
          return [check.key, check.status];
        }),
      ).toEqual([
        ["authentication", "pass"],
        ["read-permission", "fail"],
        ["detections-available", "skip"],
      ]);

      const read: SecurityConnectorCheck = checkByKey(
        checks,
        "read-permission",
      );
      expect(read.message).toMatch(
        /^CrowdStrike Falcon alerts query failed \(HTTP 403\): /,
      );
      expect(read.remediation).toContain("Alerts: Read");
      expectNoSecrets(checks);
    });

    test("names the rate limit header in the read-permission remediation on a 429", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return status(
              429,
              JSON.stringify({
                errors: [{ code: 429, message: "Too Many Requests" }],
              }),
              {
                "x-ratelimit-retryafter": "1757757600",
              },
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
      expect(read.message).toContain("X-RateLimit-RetryAfter: 1757757600");
      expect(read.remediation).toContain("X-RateLimit-RetryAfter");
    });

    test("fails detections-available when a count request errors after the read probe passed", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage([compositeId(1)], 1);
          },
          (): DataSourceHttpResponse => {
            return idsPage([compositeId(1)], 1);
          },
          (): DataSourceHttpResponse => {
            return status(500, "upstream connect error");
          },
        ],
      });

      const checks: Array<SecurityConnectorCheck> =
        await harness.connector.testConnection(settings(), {
          requestTimeoutInMs: 20000,
        });

      expect(checkByKey(checks, "read-permission").status).toBe("pass");

      const available: SecurityConnectorCheck = checkByKey(
        checks,
        "detections-available",
      );
      expect(available.status).toBe("fail");
      expect(available.message).toMatch(
        /^CrowdStrike Falcon alerts query failed \(HTTP 500\): /,
      );
      expect(available.remediation).toBeTruthy();
    });
  });

  describe("fetchEvents", () => {
    test("queries one page by created_timestamp, fetches its entities and normalizes them", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage([compositeId(1), compositeId(2)], 2);
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ requestTimeoutInMs: 7777 }),
      );

      expect(result.complete).toBe(true);
      expect(result.resumeAfter).toBeUndefined();
      expect(result.warnings).toEqual([]);
      expect(result.fetchedCount).toBe(2);
      expect(result.rejectedCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.requestCount).toBe(3);
      expect(result.events).toHaveLength(2);

      const first: JSONObject = result.events[0] as unknown as JSONObject;
      expect(first["eventUid"]).toBe(compositeId(1));
      expect(first["vendorName"]).toBe(DEFINITION.vendorName);
      expect(first["productName"]).toBe(DEFINITION.productName);
      expect(first["classUid"]).toBe(2004);
      expect(first["severityName"]).toBe(OcsfSeverity.Low);
      expect(first["principalHost"]).toBe("ABC709-1175");
      expect(first["mitreTactics"]).toEqual(["CSTA0004"]);
      expect((first["time"] as Date).toISOString()).toBe(
        "2026-09-12T18:01:23.995Z",
      );

      expect(result.samples).toEqual([
        {
          id: compositeId(1),
          title:
            "This file meets the Adware/PUP Anti-malware ML algorithm's lowest-confidence threshold.",
          severity: OcsfSeverity.Low,
          createdTime: "2026-09-12T18:01:23.995Z",
          eventTime: "2026-09-12T18:00:22.328Z",
        },
        {
          id: compositeId(2),
          title:
            "This file meets the Adware/PUP Anti-malware ML algorithm's lowest-confidence threshold.",
          severity: OcsfSeverity.Low,
          createdTime: "2026-09-12T18:01:23.995Z",
          eventTime: "2026-09-12T18:00:22.328Z",
        },
      ]);

      expect(pathnames(harness)).toEqual([
        "/oauth2/token",
        "/alerts/queries/alerts/v2",
        "/alerts/entities/alerts/v2",
      ]);

      const query: URL = queryRequests(harness)[0]!;
      expect(query.origin).toBe("https://api.us-2.crowdstrike.com");
      expect(Array.from(query.searchParams.keys()).sort()).toEqual([
        "filter",
        "limit",
        "offset",
        "sort",
      ]);
      expect(query.searchParams.get("filter")).toBe(
        CrowdStrikeFalconClient.buildCreatedTimestampFilter(START, END),
      );
      expect(query.searchParams.get("sort")).toBe("created_timestamp.asc");
      expect(query.searchParams.get("limit")).toBe(
        String(CROWDSTRIKE_ALERTS_PAGE_SIZE),
      );
      expect(query.searchParams.get("offset")).toBe("0");

      const entityRequest: DataSourceHttpRequest = harness.requests[2]!;
      expect(entityRequest.method).toBe("POST");
      expect(JSON.parse(entityRequest.body as string)).toEqual({
        composite_ids: [compositeId(1), compositeId(2)],
      });

      for (const request of harness.requests) {
        expect(request.timeoutInMs).toBe(7777);
      }
    });

    test("returns an empty, complete result for a quiet window without an entity request", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage([], 0);
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions(),
      );

      expect(result.complete).toBe(true);
      expect(result.events).toEqual([]);
      expect(result.fetchedCount).toBe(0);
      expect(result.requestCount).toBe(2);
      expect(pathnames(harness)).toEqual([
        "/oauth2/token",
        "/alerts/queries/alerts/v2",
      ]);
    });

    test("pages by offset until the reported total is reached", async () => {
      const firstPage: Array<string> = [];
      const secondPage: Array<string> = [];

      for (
        let index: number = 0;
        index < CROWDSTRIKE_ALERTS_PAGE_SIZE;
        index++
      ) {
        firstPage.push(compositeId(index));
      }

      for (let index: number = 0; index < 5; index++) {
        secondPage.push(compositeId(CROWDSTRIKE_ALERTS_PAGE_SIZE + index));
      }

      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage(firstPage, 1005);
          },
          (): DataSourceHttpResponse => {
            return idsPage(secondPage, 1005);
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
      expect(result.fetchedCount).toBe(1005);
      expect(result.events).toHaveLength(1005);
      expect(result.requestCount).toBe(5);
      expect(result.samples).toHaveLength(25);

      const offsets: Array<string | null> = queryRequests(harness).map(
        (url: URL): string | null => {
          return url.searchParams.get("offset");
        },
      );
      expect(offsets).toEqual(["0", "1000"]);
    });

    test("stops when a page is full but the total says the window is fully read", async () => {
      const fullPage: Array<string> = [];

      for (
        let index: number = 0;
        index < CROWDSTRIKE_ALERTS_PAGE_SIZE;
        index++
      ) {
        fullPage.push(compositeId(index));
      }

      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage(fullPage, CROWDSTRIKE_ALERTS_PAGE_SIZE);
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions(),
      );

      expect(result.complete).toBe(true);
      expect(result.fetchedCount).toBe(CROWDSTRIKE_ALERTS_PAGE_SIZE);
      expect(queryRequests(harness)).toHaveLength(1);
    });

    test("keeps paging without a total until Falcon returns a short page", async () => {
      const fullPage: Array<string> = [];

      for (
        let index: number = 0;
        index < CROWDSTRIKE_ALERTS_PAGE_SIZE;
        index++
      ) {
        fullPage.push(compositeId(index));
      }

      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage(fullPage, null);
          },
          (): DataSourceHttpResponse => {
            return idsPage([], null);
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions(),
      );

      expect(result.complete).toBe(true);
      expect(result.fetchedCount).toBe(CROWDSTRIKE_ALERTS_PAGE_SIZE);
      expect(queryRequests(harness)).toHaveLength(2);
      expect(pathnames(harness)).toEqual([
        "/oauth2/token",
        "/alerts/queries/alerts/v2",
        "/alerts/entities/alerts/v2",
        "/alerts/queries/alerts/v2",
      ]);
    });

    test("drops a composite id repeated across pages by live offset paging", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage(
              Array.from(
                { length: CROWDSTRIKE_ALERTS_PAGE_SIZE },
                (_: unknown, index: number): string => {
                  return compositeId(index);
                },
              ),
              1002,
            );
          },
          (): DataSourceHttpResponse => {
            return idsPage([compositeId(999), compositeId(1000)], 1002);
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions(),
      );

      expect(result.complete).toBe(true);
      expect(result.fetchedCount).toBe(1001);

      const secondEntityBody: JSONObject = JSON.parse(
        harness.requests[4]!.body as string,
      );
      expect(secondEntityBody["composite_ids"]).toEqual([compositeId(1000)]);
    });

    /*
     * Review finding connector-bound-hit-permanent-stall: every bound used to
     * return complete=false with nothing to resume from and a warning
     * promising "the poll cursor is held so the next poll continues from the
     * same window", so a CID with more than 9,000 alerts in a window re-read
     * the same first 9,000 forever. Each bound now reports the
     * created_timestamp of the last alert read as resumeAfter.
     */
    test("stops at the request bound with complete=false, resumeAfter at the last alert read, and a warning naming it", async () => {
      /*
       * Each page carries its own ids: the connector drops ids it has
       * already seen, so a repeated fixture would skip the entity fetch
       * and change the request arithmetic under test.
       */
      const pageOfIds: (page: number) => Array<string> = (
        page: number,
      ): Array<string> => {
        const ids: Array<string> = [];

        for (
          let index: number = 0;
          index < CROWDSTRIKE_ALERTS_PAGE_SIZE;
          index++
        ) {
          ids.push(compositeId(page * CROWDSTRIKE_ALERTS_PAGE_SIZE + index));
        }

        return ids;
      };

      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage(pageOfIds(0), 5000);
          },
          (): DataSourceHttpResponse => {
            return idsPage(pageOfIds(1), 5000);
          },
          (): DataSourceHttpResponse => {
            return idsPage(pageOfIds(2), 5000);
          },
        ],
        entities: [
          (request: DataSourceHttpRequest): DataSourceHttpResponse => {
            return datedEntitiesFor(
              entityRequestIds(request),
              compositeIdIndex,
            );
          },
          (request: DataSourceHttpRequest): DataSourceHttpResponse => {
            return datedEntitiesFor(
              entityRequestIds(request),
              compositeIdIndex,
            );
          },
        ],
      });

      // token + (query + fetch) * 2 = 5; a third page would need 7.
      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ maxRequests: 6 }),
      );

      const lastRead: string = createdAtFor(
        2 * CROWDSTRIKE_ALERTS_PAGE_SIZE - 1,
      );

      expect(result.complete).toBe(false);
      expect(result.requestCount).toBe(5);
      expect(result.fetchedCount).toBe(2 * CROWDSTRIKE_ALERTS_PAGE_SIZE);
      expect(result.resumeAfter).toEqual(new Date(lastRead));
      expect(result.warnings).toEqual([
        `Stopped after 5 requests before reading the whole window. Alerts are read oldest first; every alert created before ${lastRead} was read.`,
      ]);
    });

    test("stops at the request bound the poller really uses (20) after 9 pages, with resumeAfter so the next poll moves on", async () => {
      const queries: Array<Responder> = [];

      for (let page: number = 0; page < 10; page++) {
        queries.push((): DataSourceHttpResponse => {
          return idsPage(
            Array.from(
              { length: CROWDSTRIKE_ALERTS_PAGE_SIZE },
              (_: unknown, index: number): string => {
                return compositeId(page * CROWDSTRIKE_ALERTS_PAGE_SIZE + index);
              },
            ),
            12000,
          );
        });
      }

      const entities: Array<Responder> = [];

      for (let page: number = 0; page < 10; page++) {
        entities.push(
          (request: DataSourceHttpRequest): DataSourceHttpResponse => {
            return datedEntitiesFor(
              entityRequestIds(request),
              compositeIdIndex,
            );
          },
        );
      }

      const harness: Harness = buildHarness({ queries, entities });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ maxRequests: 20, maxEvents: 10000 }),
      );

      const lastRead: string = createdAtFor(
        9 * CROWDSTRIKE_ALERTS_PAGE_SIZE - 1,
      );

      expect(queryRequests(harness)).toHaveLength(9);
      expect(result.requestCount).toBe(19);
      expect(result.fetchedCount).toBe(9 * CROWDSTRIKE_ALERTS_PAGE_SIZE);
      expect(result.complete).toBe(false);
      expect(result.resumeAfter).toEqual(new Date(lastRead));
      expect(result.warnings).toEqual([
        `Stopped after 19 requests before reading the whole window. Alerts are read oldest first; every alert created before ${lastRead} was read.`,
      ]);
    });

    test("stops at the event bound mid-page with complete=false, fetching only the ids that fit and resuming after the last one", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage([compositeId(1), compositeId(2), compositeId(3)], 3);
          },
        ],
        entities: [
          (request: DataSourceHttpRequest): DataSourceHttpResponse => {
            return datedEntitiesFor(
              entityRequestIds(request),
              compositeIdIndex,
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
      expect(result.fetchedCount).toBe(2);
      expect(result.events).toHaveLength(2);
      expect(result.resumeAfter).toEqual(new Date(createdAtFor(2)));
      expect(result.warnings).toEqual([
        `Stopped after collecting 2 alerts; the window holds more. Alerts are read oldest first; every alert created before ${createdAtFor(2)} was read.`,
      ]);
      expect(JSON.parse(harness.requests[2]!.body as string)).toEqual({
        composite_ids: [compositeId(1), compositeId(2)],
      });
    });

    test("stops at the event bound on a page boundary when more pages remain", async () => {
      const fullPage: Array<string> = [];

      for (
        let index: number = 0;
        index < CROWDSTRIKE_ALERTS_PAGE_SIZE;
        index++
      ) {
        fullPage.push(compositeId(index));
      }

      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage(fullPage, 3000);
          },
        ],
        entities: [
          (request: DataSourceHttpRequest): DataSourceHttpResponse => {
            return datedEntitiesFor(
              entityRequestIds(request),
              compositeIdIndex,
            );
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ maxEvents: CROWDSTRIKE_ALERTS_PAGE_SIZE }),
      );

      expect(result.complete).toBe(false);
      expect(result.fetchedCount).toBe(CROWDSTRIKE_ALERTS_PAGE_SIZE);
      expect(result.resumeAfter).toEqual(
        new Date(createdAtFor(CROWDSTRIKE_ALERTS_PAGE_SIZE - 1)),
      );
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain(
        `Stopped after collecting ${CROWDSTRIKE_ALERTS_PAGE_SIZE} alerts`,
      );
      expect(queryRequests(harness)).toHaveLength(1);
    });

    /*
     * Review findings connector-bound-hit-permanent-stall and
     * crowdstrike-docs-quote-unreachable-warning: the ceiling warning used
     * to hold the cursor and advise shortening the poll interval, which
     * could not unpin a held window. The ceiling now resumes like every
     * other bound, and the next poll queries from offset 0 past it.
     */
    test("stops at Falcon's 10,000 offset ceiling with complete=false and resumeAfter so the next poll queries past it", async () => {
      const pages: number =
        CROWDSTRIKE_ALERTS_OFFSET_CEILING / CROWDSTRIKE_ALERTS_PAGE_SIZE;
      const queries: Array<Responder> = [];
      const entities: Array<Responder> = [];

      for (let page: number = 0; page < pages; page++) {
        queries.push((): DataSourceHttpResponse => {
          return idsPage(
            Array.from(
              { length: CROWDSTRIKE_ALERTS_PAGE_SIZE },
              (_: unknown, index: number): string => {
                return compositeId(page * CROWDSTRIKE_ALERTS_PAGE_SIZE + index);
              },
            ),
            CROWDSTRIKE_ALERTS_OFFSET_CEILING + 500,
          );
        });
        entities.push(
          (request: DataSourceHttpRequest): DataSourceHttpResponse => {
            return datedEntitiesFor(
              entityRequestIds(request),
              compositeIdIndex,
            );
          },
        );
      }

      const harness: Harness = buildHarness({ queries, entities });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ maxRequests: 100, maxEvents: 100000 }),
      );

      const lastRead: string = createdAtFor(
        CROWDSTRIKE_ALERTS_OFFSET_CEILING - 1,
      );

      expect(result.complete).toBe(false);
      expect(result.fetchedCount).toBe(CROWDSTRIKE_ALERTS_OFFSET_CEILING);
      expect(queryRequests(harness)).toHaveLength(pages);
      expect(result.resumeAfter).toEqual(new Date(lastRead));
      expect(result.warnings).toEqual([
        `Falcon's alerts query cannot page past ${CROWDSTRIKE_ALERTS_OFFSET_CEILING} results and this window holds more. Alerts are read oldest first; every alert created before ${lastRead} was read.`,
      ]);
      expect(result.warnings[0]).not.toContain("Poll interval");
      expect(result.warnings[0]).not.toContain("cursor is held");
    });

    test("puts entities back in the ids query's order before naming the resume point", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage([compositeId(1), compositeId(2), compositeId(3)], 9);
          },
        ],
        entities: [
          (request: DataSourceHttpRequest): DataSourceHttpResponse => {
            /*
             * Falcon may answer the entity fetch in any order. Read in
             * response order these would look out of order and name no
             * resume point at all.
             */
            return datedEntitiesFor(
              [...entityRequestIds(request)].reverse(),
              compositeIdIndex,
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
      expect(result.resumeAfter).toEqual(new Date(createdAtFor(2)));
      expect(result.warnings).toHaveLength(1);
      expect(
        result.events.map((event: { eventUid: string }): string => {
          return event.eventUid;
        }),
      ).toEqual([compositeId(1), compositeId(2)]);
    });

    test("names no resume point, and says why, when the ids query did not honour ascending creation order", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage([compositeId(5), compositeId(2), compositeId(7)], 9);
          },
        ],
        entities: [
          (request: DataSourceHttpRequest): DataSourceHttpResponse => {
            return datedEntitiesFor(
              entityRequestIds(request),
              compositeIdIndex,
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
      expect(result.resumeAfter).toBeUndefined();
      expect(result.warnings).toEqual([
        "Stopped after collecting 2 alerts; the window holds more.",
        "Falcon returned alerts out of created_timestamp order, so this run cannot name a point to resume from.",
      ]);
    });

    test("never resumes past an alert that failed normalization, so the poller can retry it", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage(
              [compositeId(1), compositeId(2), compositeId(3), compositeId(4)],
              9,
            );
          },
        ],
        entities: [
          (request: DataSourceHttpRequest): DataSourceHttpResponse => {
            const response: DataSourceHttpResponse = datedEntitiesFor(
              entityRequestIds(request),
              compositeIdIndex,
            );
            const resources: Array<JSONObject> = (
              response.bodyJson as JSONObject
            )["resources"] as Array<JSONObject>;
            // A getter that throws makes the normalizer fail on this alert only.
            Object.defineProperty(resources[1]!, "display_name", {
              enumerable: true,
              get: (): string => {
                throw new Error("boom");
              },
            });
            return response;
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ maxEvents: 3 }),
      );

      expect(result.complete).toBe(false);
      expect(result.failedCount).toBe(1);
      expect(result.resumeAfter).toEqual(new Date(createdAtFor(2)));
    });

    test("counts unrecognized entity objects as rejected without failing the fetch", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage([compositeId(1), compositeId(2)], 2);
          },
        ],
        entities: [
          (): DataSourceHttpResponse => {
            return ok({
              resources: [
                alert(compositeId(1)),
                { unrelated: true, message: "not an alert" },
              ],
            });
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
      expect(result.events).toHaveLength(1);
    });

    test("caps samples at sampleLimit while normalizing every alert", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage([compositeId(1), compositeId(2), compositeId(3)], 3);
          },
        ],
      });

      const result: ConnectorFetchResult = await harness.connector.fetchEvents(
        settings(),
        { startTime: START, endTime: END },
        fetchOptions({ sampleLimit: 1 }),
      );

      expect(result.events).toHaveLength(3);
      expect(result.samples).toHaveLength(1);
    });

    test("throws the client's step-prefixed error on an authentication failure", async () => {
      const harness: Harness = buildHarness({
        token: (): DataSourceHttpResponse => {
          return status(
            401,
            JSON.stringify({
              errors: [{ code: 401, message: "access denied" }],
            }),
          );
        },
      });

      await expect(
        harness.connector.fetchEvents(
          settings(),
          { startTime: START, endTime: END },
          fetchOptions(),
        ),
      ).rejects.toThrow(
        /^CrowdStrike Falcon token request failed \(HTTP 401\): /,
      );
    });

    test("throws the client's step-prefixed error on a 403 from the alerts query", async () => {
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

      let caught: unknown = null;

      try {
        await harness.connector.fetchEvents(
          settings(),
          { startTime: START, endTime: END },
          fetchOptions(),
        );
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(APIException);
      expect((caught as APIException).message).toMatch(
        /^CrowdStrike Falcon alerts query failed \(HTTP 403\): /,
      );
    });

    test("throws the client's step-prefixed error on a 500 from the entity fetch", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            return idsPage([compositeId(1)], 1);
          },
        ],
        entities: [
          (): DataSourceHttpResponse => {
            return status(500, "boom");
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
        /^CrowdStrike Falcon alerts fetch failed \(HTTP 500\): /,
      );
    });

    test("surfaces a transport timeout with the step named", async () => {
      const harness: Harness = buildHarness({
        queries: [
          (): DataSourceHttpResponse => {
            throw new BadDataException(
              "Could not reach data source: timeout of 5000ms exceeded",
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
        "CrowdStrike Falcon alerts query could not be completed: Could not reach data source: timeout of 5000ms exceeded",
      );
    });

    test("rejects malformed settings before contacting Falcon", async () => {
      const harness: Harness = buildHarness({});

      await expect(
        harness.connector.fetchEvents(
          settings({ secrets: {} }),
          { startTime: START, endTime: END },
          fetchOptions(),
        ),
      ).rejects.toThrow(BadDataException);
      expect(harness.requests).toHaveLength(0);
    });
  });
});
