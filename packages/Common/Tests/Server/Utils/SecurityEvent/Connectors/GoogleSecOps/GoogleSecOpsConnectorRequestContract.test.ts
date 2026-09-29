import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  FetchInitLike,
  FetchLike,
  FetchResponseLike,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import GoogleSecOpsConnector from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsConnector";
import {
  ConnectorFetchPurpose,
  ConnectorFetchResult,
  ConnectorFetchWindow,
  ConnectorTestResult,
  readConnectorChecks,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import logger from "../../../../../../Server/Utils/Logger";
import OneUptimeDate from "../../../../../../Types/Date";
import APIException from "../../../../../../Types/Exception/ApiException";
import { JSONObject } from "../../../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { SecurityConnectorCheck } from "../../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { getJestSpyOn } from "../../../../../Spy";
import {
  API_BASE,
  INSTANCE,
  TOKEN_URI,
  checkByKey,
  fetchOptions,
  rejectionOf,
  secOpsSettings,
  statusesOf,
} from "./GoogleSecOpsConnectorFixtures";

/*
 * The connector over the REAL GoogleSecOpsClient, with only the transport
 * replaced by a FetchLike fixture routed by URL. This pins what leaves the
 * process for each pass (routes, listBasis, alertState, page sizes, the
 * alerts view's query), that Google's own response envelopes become events,
 * that every failure reaches the caller under the client's documented
 * message prefix with the passes that ran attached, and that the client's
 * token exchange and internal re-issues are not counted as pass requests.
 */

const NOW: Date = new Date("2026-09-14T12:00:00.000Z");
const WINDOW: ConnectorFetchWindow = {
  startTime: new Date("2026-09-14T11:54:00.000Z"),
  endTime: NOW,
};

interface StubbedResponse {
  status: number;
  body: string;
}

interface RecordedRequest {
  url: URL;
  raw: string;
  method: string;
  headers: Record<string, string>;
  body?: string | undefined;
}

type Responder = (
  request: RecordedRequest,
) => StubbedResponse | Promise<FetchResponseLike>;

type Route = "token" | "search" | "count" | "curated" | "alerts";

/*
 * The curated rule the default count answer reports detections for, so every
 * fetch exercises one real per-rule curated search:
 * legacySearchCuratedDetections has no wildcard.
 */
const CURATED_RULE_ID: string = "ur_contract_rule";
const COUNT_URL: string = `${API_BASE}:countAllCuratedRuleSetDetections`;

interface Transport {
  fetchImplementation: FetchLike;
  requests: Array<RecordedRequest>;
  of: (route: Route) => Array<RecordedRequest>;
}

function ok(body: JSONObject | Array<JSONObject>): StubbedResponse {
  return { status: 200, body: JSON.stringify(body) };
}

function stream(chunks: Array<JSONObject>): StubbedResponse {
  return ok(chunks);
}

function routeOf(url: string): Route | null {
  if (url === TOKEN_URI) {
    return "token";
  }

  if (url.includes("legacy:legacySearchDetections")) {
    return "search";
  }

  if (url.includes("legacy:legacySearchCuratedDetections")) {
    return "curated";
  }

  if (url === COUNT_URL) {
    return "count";
  }

  if (url.includes("legacy:legacyFetchAlertsView")) {
    return "alerts";
  }

  return null;
}

/*
 * Each route answers from its own queue, repeating the last entry. Unset
 * routes answer the way a quiet, healthy tenant does: nothing in the window,
 * and one curated rule (CURATED_RULE_ID) with detections earlier that week.
 */
function makeTransport(
  routes: Partial<Record<Route, Array<Responder>>> = {},
): Transport {
  const requests: Array<RecordedRequest> = [];
  const indexes: Map<Route, number> = new Map<Route, number>();
  const defaults: Record<Route, Array<Responder>> = {
    token: [
      (): StubbedResponse => {
        return ok({ access_token: "test-token", expires_in: 3600 });
      },
    ],
    search: [
      (): StubbedResponse => {
        return ok({});
      },
    ],
    count: [
      (): StubbedResponse => {
        return ok({
          curatedRuleSetCounts: [
            {
              curatedRuleSet: `${INSTANCE}/curatedRuleSetCategories/c1/curatedRuleSets/s1`,
              count: 3,
            },
          ],
          curatedRuleCounts: [
            {
              curatedRule: `${INSTANCE}/curatedRules/${CURATED_RULE_ID}`,
              precision: "PRECISE",
              count: 3,
            },
          ],
        });
      },
    ],
    curated: [
      (): StubbedResponse => {
        return ok({});
      },
    ],
    alerts: [
      (): StubbedResponse => {
        return stream([{ complete: true, progress: 1 }]);
      },
    ],
  };

  const fetchImplementation: FetchLike = (
    url: string,
    init: FetchInitLike,
  ): Promise<FetchResponseLike> => {
    const route: Route | null = routeOf(url);

    if (!route) {
      return Promise.reject(new Error(`Unexpected outbound URL: ${url}`));
    }

    const request: RecordedRequest = {
      url: new URL(url),
      raw: url,
      method: init.method,
      headers: init.headers,
      body: init.body,
    };
    requests.push(request);

    const queue: Array<Responder> = routes[route] || defaults[route];
    const index: number = indexes.get(route) || 0;
    indexes.set(route, index + 1);
    const answer: StubbedResponse | Promise<FetchResponseLike> =
      queue[Math.min(index, queue.length - 1)]!(request);

    if (answer instanceof Promise) {
      return answer;
    }

    return Promise.resolve({
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      text: async (): Promise<string> => {
        return answer.body;
      },
    });
  };

  return {
    fetchImplementation,
    requests,
    of: (route: Route): Array<RecordedRequest> => {
      return requests.filter((request: RecordedRequest): boolean => {
        return routeOf(request.raw) === route;
      });
    },
  };
}

function answer(response: StubbedResponse): Array<Responder> {
  return [
    (): StubbedResponse => {
      return response;
    },
  ];
}

function never(): Array<Responder> {
  return [
    (): Promise<FetchResponseLike> => {
      return new Promise<FetchResponseLike>((): void => {});
    },
  ];
}

function paramsOf(request: RecordedRequest): Record<string, string> {
  const params: Record<string, string> = {};

  request.url.searchParams.forEach((value: string, key: string): void => {
    params[key] = value;
  });

  return params;
}

function uidsOf(result: ConnectorFetchResult): Array<string> {
  return result.events.map((event: NormalizedSecurityEvent): string => {
    return event.eventUid;
  });
}

const OPEN_ALERT: JSONObject = {
  id: "open-alert",
  type: "RULE_DETECTION",
  detectionTime: "2026-09-14T11:56:00.000Z",
  createdTime: "2026-09-14T11:57:00.000Z",
  detection: [{ ruleName: "Open detection", severity: "HIGH" }],
};

const CLOSED_ALERT: JSONObject = {
  id: "closed-alert",
  type: "RULE_DETECTION",
  detectionTime: "2026-09-14T11:57:00.000Z",
  detection: [{ ruleName: "Closed detection", severity: "LOW" }],
  feedbackSummary: { status: "CLOSED" },
};

function alertWithEntities(): JSONObject {
  return {
    id: "alert-1",
    type: "RULE_DETECTION",
    detectionTime: "2026-08-21T09:30:00.000Z",
    detection: [
      {
        ruleName: "Suspicious PowerShell",
        ruleId: "ru_1a2b",
        severity: "HIGH",
        alertState: "ALERTING",
      },
    ],
    collectionElements: [
      {
        label: "e1",
        references: [
          {
            event: {
              metadata: {
                eventType: "PROCESS_LAUNCH",
                eventTimestamp: "2026-08-21T09:29:58.000Z",
              },
              principal: {
                hostname: "workstation-14",
                ip: ["10.1.2.3"],
                user: { userid: "jsmith" },
              },
              target: { ip: ["203.0.113.9"], port: 443 },
            },
          },
        ],
      },
    ],
  };
}

describe("GoogleSecOpsConnector request contract over the real client", () => {
  beforeEach(() => {
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
    getJestSpyOn(logger, "warn").mockImplementation((): void => {});
    getJestSpyOn(logger, "error").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a poll searches by created time with alertState=ALERTING, pages with the token, and asks the alerts view for every status", async () => {
    const transport: Transport = makeTransport({
      search: [
        (): StubbedResponse => {
          return ok({
            detections: [{ ...OPEN_ALERT, id: "d1" }],
            nextPageToken: "t1",
          });
        },
        (): StubbedResponse => {
          return ok({ detections: [{ ...OPEN_ALERT, id: "d2" }] });
        },
      ],
      alerts: answer(
        stream([
          { alerts: { alerts: [OPEN_ALERT] }, progress: 0.5 },
          {
            alerts: { alerts: [CLOSED_ALERT] },
            complete: true,
            progress: 1,
            baselineAlertsCount: 2,
            filteredAlertsCount: 2,
          },
        ]),
      ),
    });
    const connector: GoogleSecOpsConnector = new GoogleSecOpsConnector(
      transport.fetchImplementation,
    );

    const result: ConnectorFetchResult = await connector.fetchEvents(
      secOpsSettings(),
      WINDOW,
      fetchOptions(),
    );

    expect(
      transport.requests.map((request: RecordedRequest): string => {
        return routeOf(request.raw)!;
      }),
    ).toEqual([
      "token",
      "search",
      "search",
      "count",
      "curated",
      "alerts",
      "alerts",
    ]);

    const [firstPage, secondPage] = transport.of("search");
    expect(
      firstPage!.raw.startsWith(`${API_BASE}/legacy:legacySearchDetections?`),
    ).toBe(true);
    expect(paramsOf(firstPage!)).toEqual({
      ruleId: "-",
      startTime: "2026-09-14T11:54:00.000Z",
      endTime: "2026-09-14T12:00:00.000Z",
      listBasis: "CREATED_TIME",
      pageSize: "1000",
      alertState: "ALERTING",
    });
    expect(paramsOf(secondPage!)).toEqual({
      ...paramsOf(firstPage!),
      pageToken: "t1",
    });
    /*
     * The curated rules are discovered first, over the week before the
     * window through its end, and each one is then searched by its own id:
     * the curated route has no wildcard.
     */
    const count: RecordedRequest = transport.of("count")[0]!;
    expect(count.raw).toBe(COUNT_URL);
    expect(count.method).toBe("POST");
    expect(count.headers).toEqual({
      Authorization: "Bearer test-token",
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(count.body!)).toEqual({
      interval: {
        startTime: "2026-09-07T11:54:00.000Z",
        endTime: "2026-09-14T12:00:00.000Z",
      },
    });
    expect(
      transport
        .of("curated")[0]!
        .raw.startsWith(`${API_BASE}/legacy:legacySearchCuratedDetections?`),
    ).toBe(true);
    expect(paramsOf(transport.of("curated")[0]!)).toEqual({
      ...paramsOf(firstPage!),
      ruleId: CURATED_RULE_ID,
    });

    const [alerts, lateAlerts] = transport.of("alerts");
    expect([...alerts!.url.searchParams.entries()].sort()).toEqual([
      ["alertListOptions.maxReturnedAlerts", "1000"],
      ["includeNonAlertingDetections", "ALERTS_FEATURE_PREFERENCE_DISABLED"],
      ["snapshotQuery", ""],
      ["timeRange.endTime", "2026-09-14T12:00:00.000Z"],
      ["timeRange.startTime", "2026-09-14T11:54:00.000Z"],
    ]);
    // The late-alert sweep: the day before the window, alerts only.
    expect([...lateAlerts!.url.searchParams.entries()].sort()).toEqual([
      ["alertListOptions.maxReturnedAlerts", "1000"],
      ["includeNonAlertingDetections", "ALERTS_FEATURE_PREFERENCE_DISABLED"],
      ["snapshotQuery", ""],
      ["timeRange.endTime", "2026-09-14T11:54:00.000Z"],
      ["timeRange.startTime", "2026-09-13T12:00:00.000Z"],
    ]);

    for (const request of transport.requests.slice(1)) {
      if (routeOf(request.raw) === "count") {
        continue;
      }

      expect(request.method).toBe("GET");
      expect(request.headers).toEqual({
        Authorization: "Bearer test-token",
        Accept: "application/json",
      });
      expect(request.body).toBeUndefined();
    }

    // The token exchange is neither repeated within a fetch nor counted.
    expect(transport.of("token")).toHaveLength(1);
    expect(result.requestCount).toBe(6);
    expect(uidsOf(result).sort()).toEqual([
      "closed-alert",
      "d1",
      "d2",
      "open-alert",
    ]);
    expect(result.details).toMatchObject({
      sourceCounts: {
        ruleDetections: 2,
        curatedDetections: 0,
        alertsView: 2,
        lateAlertsView: 2,
      },
      curatedRulesWithDetections: 1,
    });
    expect(result.complete).toBe(true);
  });

  test("Detections selected drops alertState from the searches and enables non-alerting detections in the alerts view", async () => {
    const transport: Transport = makeTransport();
    const connector: GoogleSecOpsConnector = new GoogleSecOpsConnector(
      transport.fetchImplementation,
    );

    await connector.fetchEvents(
      secOpsSettings({ alertingOnly: false }),
      WINDOW,
      fetchOptions(),
    );

    expect(transport.of("curated")).toHaveLength(1);
    for (const request of [
      ...transport.of("search"),
      ...transport.of("curated"),
    ]) {
      expect(request.url.searchParams.has("alertState")).toBe(false);
    }
    expect(
      transport.of("alerts").map((request: RecordedRequest): string => {
        return `${request.url.searchParams.get("timeRange.startTime")}:${request.url.searchParams.get("includeNonAlertingDetections")}`;
      }),
    ).toEqual([
      "2026-09-14T11:54:00.000Z:ALERTS_FEATURE_PREFERENCE_ENABLED",
      // The late-alert sweep stays alerts only whatever is imported.
      "2026-09-13T12:00:00.000Z:ALERTS_FEATURE_PREFERENCE_DISABLED",
    ]);
  });

  test.each(["preview", "backfill"] as Array<ConnectorFetchPurpose>)(
    "a %s sends both listBasis values on both search routes",
    async (purpose: ConnectorFetchPurpose) => {
      const transport: Transport = makeTransport();
      const connector: GoogleSecOpsConnector = new GoogleSecOpsConnector(
        transport.fetchImplementation,
      );

      await connector.fetchEvents(
        secOpsSettings(),
        WINDOW,
        fetchOptions({ purpose }),
      );

      expect(
        transport.requests
          .filter((request: RecordedRequest): boolean => {
            return ["search", "curated"].includes(routeOf(request.raw)!);
          })
          .map((request: RecordedRequest): string => {
            return `${routeOf(request.raw)}:${request.url.searchParams.get("listBasis")}`;
          }),
      ).toEqual([
        "search:CREATED_TIME",
        "search:DETECTION_TIME",
        "curated:CREATED_TIME",
        "curated:DETECTION_TIME",
      ]);
      for (const request of transport.of("curated")) {
        expect(request.url.searchParams.get("ruleId")).toBe(CURATED_RULE_ID);
      }
      expect(transport.of("count")).toHaveLength(1);
      // A preview or backfill never sweeps for late alerts.
      expect(transport.of("alerts")).toHaveLength(1);
    },
  );

  test("a streamed chunk array becomes Detection Findings, a restated alert counted once", async () => {
    const transport: Transport = makeTransport({
      alerts: answer(
        stream([
          { progress: 0.25, alerts: { alerts: [alertWithEntities()] } },
          {
            progress: 0.75,
            alerts: {
              alerts: [
                alertWithEntities(),
                {
                  id: "alert-2",
                  type: "RULE_DETECTION",
                  detectionTime: "2026-08-21T09:31:00.000Z",
                  detection: [
                    { ruleName: "Impossible travel", severity: "CRITICAL" },
                  ],
                },
              ],
            },
          },
          {
            progress: 1,
            complete: true,
            baselineAlertsCount: 2,
            filteredAlertsCount: 2,
          },
        ]),
      ),
    });
    const connector: GoogleSecOpsConnector = new GoogleSecOpsConnector(
      transport.fetchImplementation,
    );

    const result: ConnectorFetchResult = await connector.fetchEvents(
      secOpsSettings(),
      WINDOW,
      fetchOptions(),
    );

    expect(result.fetchedCount).toBe(2);
    const first: NormalizedSecurityEvent = result.events.find(
      (event: NormalizedSecurityEvent): boolean => {
        return event.eventUid === "alert-1";
      },
    )!;
    expect(first).toMatchObject({
      classUid: 2004,
      className: "Detection Finding",
      vendorName: "Google",
      productName: "Google SecOps",
      ruleName: "Suspicious PowerShell",
      ruleId: "ru_1a2b",
      severityName: "High",
      principalHost: "workstation-14",
      principalIp: "10.1.2.3",
      principalUser: "jsmith",
      targetIp: "203.0.113.9",
    });
    expect(
      result.events.find((event: NormalizedSecurityEvent): boolean => {
        return event.eventUid === "alert-2";
      })!.severityName,
    ).toBe("Critical");
  });

  test("a curated response on either key parses, and a quiet {} is zero records", async () => {
    const transport: Transport = makeTransport({
      curated: answer(
        ok({ curatedDetections: [{ ...OPEN_ALERT, id: "curated-1" }] }),
      ),
    });
    const connector: GoogleSecOpsConnector = new GoogleSecOpsConnector(
      transport.fetchImplementation,
    );

    const result: ConnectorFetchResult = await connector.fetchEvents(
      secOpsSettings(),
      WINDOW,
      fetchOptions(),
    );

    expect(uidsOf(result)).toEqual(["curated-1"]);
    expect(result.details).toMatchObject({
      sourceCounts: { ruleDetections: 0, curatedDetections: 1, alertsView: 0 },
    });
  });

  test("a 401 on an API call re-mints the token once without counting another pass request", async () => {
    const transport: Transport = makeTransport({
      search: [
        (): StubbedResponse => {
          return { status: 401, body: "{}" };
        },
        (): StubbedResponse => {
          return ok({});
        },
      ],
    });
    const connector: GoogleSecOpsConnector = new GoogleSecOpsConnector(
      transport.fetchImplementation,
    );

    const result: ConnectorFetchResult = await connector.fetchEvents(
      secOpsSettings(),
      WINDOW,
      fetchOptions(),
    );

    expect(transport.of("token")).toHaveLength(2);
    expect(transport.of("search")).toHaveLength(2);
    // One rule search, the curated count and search, the window and sweep.
    expect(result.requestCount).toBe(5);
    expect(result.complete).toBe(true);
  });

  test("an alerts stream that never completes is re-issued by the client, counted once, and left unread", async () => {
    const transport: Transport = makeTransport({
      alerts: answer(
        stream([{ alerts: { alerts: [OPEN_ALERT] }, progress: 0.5 }]),
      ),
    });
    const connector: GoogleSecOpsConnector = new GoogleSecOpsConnector(
      transport.fetchImplementation,
    );

    const result: ConnectorFetchResult = await connector.fetchEvents(
      secOpsSettings(),
      WINDOW,
      fetchOptions(),
    );

    /*
     * Both alerts-view reads (the window and the late-alert sweep) are
     * issued three times each by the client and counted once each.
     */
    expect(transport.of("alerts")).toHaveLength(6);
    expect(result.requestCount).toBe(5);
    expect(result.complete).toBe(false);
    expect(statusesOf(result.checks)).toEqual([
      "read-rule-detections:pass",
      "read-curated-detections:pass",
      "read-alerts-view:warn",
      "read-late-alerts-view:warn",
    ]);
    expect(result.warnings).toEqual([
      "Google ended an alerts view response without confirming it was complete.",
    ]);
    expect(uidsOf(result)).toEqual(["open-alert"]);
  });

  test("every fetch opens its own session: a connector shares no token across calls", async () => {
    const transport: Transport = makeTransport();
    const connector: GoogleSecOpsConnector = new GoogleSecOpsConnector(
      transport.fetchImplementation,
    );

    await connector.fetchEvents(secOpsSettings(), WINDOW, fetchOptions());
    await connector.fetchEvents(secOpsSettings(), WINDOW, fetchOptions());

    expect(transport.of("token")).toHaveLength(2);
  });

  test("the fetch's request deadline reaches every request", async () => {
    const transport: Transport = makeTransport({ search: never() });
    const connector: GoogleSecOpsConnector = new GoogleSecOpsConnector(
      transport.fetchImplementation,
    );

    const error: unknown = await rejectionOf(
      connector.fetchEvents(
        secOpsSettings(),
        WINDOW,
        fetchOptions({ requestTimeoutInMs: 50 }),
      ),
    );

    expect((error as Error).message).toBe(
      "Google SecOps detections search timed out after 1 seconds with no response.",
    );
    expect(statusesOf(readConnectorChecks(error))).toEqual([
      "read-rule-detections:fail",
    ]);
  });
});

/*
 * What `Last Error` means is keyed on the message prefix, and the docs
 * quote those prefixes: a token exchange rejected at Google's OAuth host, a
 * search or alerts-view request Chronicle rejected, or anything else. The
 * connector must hand every one of them to the poller unchanged.
 */
describe("GoogleSecOpsConnector failure taxonomy over the real client", () => {
  beforeEach(() => {
    getJestSpyOn(logger, "warn").mockImplementation((): void => {});
    getJestSpyOn(logger, "error").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function failWith(
    routes: Partial<Record<Route, Array<Responder>>>,
  ): Promise<{ error: Error; transport: Transport }> {
    const transport: Transport = makeTransport(routes);
    const connector: GoogleSecOpsConnector = new GoogleSecOpsConnector(
      transport.fetchImplementation,
    );
    const error: unknown = await rejectionOf(
      connector.fetchEvents(secOpsSettings(), WINDOW, fetchOptions()),
    );
    expect(error).toBeInstanceOf(APIException);
    return { error: error as Error, transport };
  }

  test("a token exchange rejected at Google's OAuth host keeps its prefix and contacts Chronicle not at all", async () => {
    const { error, transport } = await failWith({
      token: answer({
        status: 401,
        body: JSON.stringify({
          error: "invalid_grant",
          error_description: "Invalid JWT Signature.",
        }),
      }),
    });

    expect(
      error.message.startsWith("Google token exchange failed (HTTP 401): "),
    ).toBe(true);
    expect(error.message).toContain("invalid_grant");
    expect(transport.requests).toHaveLength(1);
    expect(statusesOf(readConnectorChecks(error))).toEqual([
      "read-rule-detections:fail",
    ]);
  });

  test("a search Chronicle rejects keeps the detections-search prefix and Google's body", async () => {
    const { error } = await failWith({
      search: answer({
        status: 403,
        body: JSON.stringify({
          error: {
            code: 403,
            status: "PERMISSION_DENIED",
            message: "denied",
          },
        }),
      }),
    });

    expect(
      error.message.startsWith(
        "Google SecOps detections search failed (HTTP 403): ",
      ),
    ).toBe(true);
    expect(error.message).toContain("PERMISSION_DENIED");
    expect(
      checkByKey(readConnectorChecks(error), "read-rule-detections").status,
    ).toBe("fail");
  });

  test("the curated route answering 403 is a warning over HTTP, and 500 fails with its prefix", async () => {
    // A tenant without curated rule access is refused at the count.
    const warned: Transport = makeTransport({
      count: answer({ status: 403, body: '{"error":{"code":403}}' }),
    });
    const result: ConnectorFetchResult = await new GoogleSecOpsConnector(
      warned.fetchImplementation,
    ).fetchEvents(secOpsSettings(), WINDOW, fetchOptions());
    expect(checkByKey(result.checks, "read-curated-detections")).toMatchObject({
      status: "warn",
      details: { httpStatus: 403 },
    });
    expect(result.warnings).toContain(
      "Curated rule detections could not be read (HTTP 403); this tenant may not have curated rule access. Rule detections and the alerts view were still read.",
    );
    expect(warned.of("curated")).toHaveLength(0);
    // The window's alerts-view read and the late-alert sweep.
    expect(warned.of("alerts")).toHaveLength(2);
    expect(result.complete).toBe(true);

    // One curated rule the search refuses is a warning for that rule alone.
    const ruleWarned: Transport = makeTransport({
      curated: answer({ status: 403, body: '{"error":{"code":403}}' }),
    });
    const ruleResult: ConnectorFetchResult = await new GoogleSecOpsConnector(
      ruleWarned.fetchImplementation,
    ).fetchEvents(secOpsSettings(), WINDOW, fetchOptions());
    expect(
      checkByKey(ruleResult.checks, "read-curated-detections"),
    ).toMatchObject({
      status: "warn",
      message:
        "0 curated rule detections returned for the window by created time (1 of 1 curated rule with recent detections searched, 1 could not be read). Google did not return part of the window.",
    });
    expect(ruleResult.warnings).toContain(
      `Detections of curated rule ${CURATED_RULE_ID} could not be read (HTTP 403); the other curated rules were still read.`,
    );
    expect(ruleWarned.of("alerts")).toHaveLength(2);
    expect(ruleResult.complete).toBe(true);

    const { error } = await failWith({
      curated: answer({ status: 500, body: '{"error":{"code":500}}' }),
    });
    expect(
      error.message.startsWith(
        "Google SecOps detections search failed (HTTP 500): ",
      ),
    ).toBe(true);
    expect(statusesOf(readConnectorChecks(error))).toEqual([
      "read-rule-detections:pass",
      "read-curated-detections:fail",
    ]);

    const { error: countError } = await failWith({
      count: answer({ status: 500, body: '{"error":{"code":500}}' }),
    });
    expect(
      countError.message.startsWith(
        "Google SecOps curated rule detection counts failed (HTTP 500): ",
      ),
    ).toBe(true);
    expect(statusesOf(readConnectorChecks(countError))).toEqual([
      "read-rule-detections:pass",
      "read-curated-detections:fail",
    ]);
  });

  test("an alerts view Chronicle rejects keeps the alerts-fetch prefix after both searches ran", async () => {
    const { error, transport } = await failWith({
      alerts: answer({
        status: 403,
        body: JSON.stringify({
          error: {
            code: 403,
            status: "PERMISSION_DENIED",
            message:
              "Caller does not have permission 'chronicle.legacies.legacyFetchAlertsView'.",
          },
        }),
      }),
    });

    expect(
      error.message.startsWith(
        "Google SecOps alerts fetch failed (HTTP 403): ",
      ),
    ).toBe(true);
    expect(error.message).toContain("PERMISSION_DENIED");
    expect(
      transport.requests.map((request: RecordedRequest): string => {
        return routeOf(request.raw)!;
      }),
    ).toEqual(["token", "search", "count", "curated", "alerts"]);
    expect(statusesOf(readConnectorChecks(error))).toEqual([
      "read-rule-detections:pass",
      "read-curated-detections:pass",
      "read-alerts-view:fail",
    ]);
  });

  const bodyFailures: Array<[string, StubbedResponse, string]> = [
    [
      "a non-JSON body",
      { status: 200, body: "<html><body>502 Bad Gateway</body></html>" },
      "Google SecOps alerts fetch returned a non-JSON body.",
    ],
    [
      "an unrecognized shape",
      { status: 200, body: '{"nope":true}' },
      'Google SecOps alerts fetch returned an unrecognized response shape: {"nope":true}',
    ],
    [
      "an in-band query rejection",
      {
        status: 200,
        body: JSON.stringify([
          {
            complete: true,
            queryValidationErrors: [{ errorText: "bad query" }],
          },
        ]),
      },
      "Google SecOps alerts query was rejected by Chronicle on an HTTP 200: bad query",
    ],
    [
      "an error ending the stream",
      {
        status: 200,
        body: JSON.stringify([
          { alerts: { alerts: [{ id: "a" }] } },
          { error: { code: 500, message: "boom" } },
        ]),
      },
      'Google SecOps alerts fetch returned an error in the response stream: {"code":500,"message":"boom"}',
    ],
  ];

  test.each(bodyFailures)(
    "%s from the alerts view fails with the client's message and no HTTP-status prefix",
    async (_label: string, response: StubbedResponse, expected: string) => {
      const { error } = await failWith({ alerts: answer(response) });

      expect(error.message).toBe(expected);
      expect(error.message).not.toContain("(HTTP");
      expect(
        checkByKey(readConnectorChecks(error), "read-alerts-view"),
      ).toMatchObject({
        status: "fail",
        message: expected,
      });
    },
  );

  test("the request prefixes are distinct families", async () => {
    const messages: Array<string> = [
      (await failWith({ token: answer({ status: 401, body: "{}" }) })).error
        .message,
      (await failWith({ search: answer({ status: 403, body: "{}" }) })).error
        .message,
      (await failWith({ count: answer({ status: 500, body: "{}" }) })).error
        .message,
      (await failWith({ alerts: answer({ status: 403, body: "{}" }) })).error
        .message,
    ];
    const families: Array<string> = messages.map((message: string): string => {
      return message.slice(0, message.indexOf(" (HTTP"));
    });

    expect(families).toEqual([
      "Google token exchange failed",
      "Google SecOps detections search failed",
      "Google SecOps curated rule detection counts failed",
      "Google SecOps alerts fetch failed",
    ]);
    expect(new Set(messages).size).toBe(4);
  });

  test("a full Google diagnostic survives whole in the error and redacted, untruncated, in the failed check", async () => {
    const tail: string = "final-diagnostic-details-remain-copyable";
    const body: string = JSON.stringify({
      error: {
        code: 400,
        status: "INVALID_ARGUMENT",
        message: "Google request diagnostic. ".repeat(80),
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ResourceInfo",
            resourceName: INSTANCE,
            diagnostic: JSON.stringify({
              access_token: "nested-http-diagnostic-token-123",
              resource: INSTANCE,
            }),
          },
          {
            "@type": "type.googleapis.com/google.rpc.BadRequest",
            fieldViolations: [
              {
                field: "snapshotQuery",
                description: "Required query field was not supplied.",
              },
            ],
          },
        ],
        access_token: "leaked-body-token",
        private_key: "http-integration-private-key-material",
        client_secret: "http-integration-client-secret-material",
        supportReference: tail,
      },
    });

    const { error } = await failWith({
      alerts: answer({ status: 400, body }),
    });

    expect(body.indexOf(tail)).toBeGreaterThan(1000);
    expect(
      error.message.startsWith(
        "Google SecOps alerts fetch failed (HTTP 400): ",
      ),
    ).toBe(true);
    expect(error.message.length).toBeGreaterThan(1000);
    expect(error.message).toContain(tail);

    const failed: string = checkByKey(
      readConnectorChecks(error),
      "read-alerts-view",
    ).message;
    expect(failed.length).toBeGreaterThan(1000);
    expect(failed).not.toContain("(truncated)");
    expect(failed).toContain(tail);
    expect(failed).toContain(INSTANCE);
    expect(failed).toContain('"code":400');
    expect(failed).toContain('"status":"INVALID_ARGUMENT"');
    expect(failed).toContain("type.googleapis.com/google.rpc.BadRequest");
    expect(failed).toContain('"field":"snapshotQuery"');
    expect(failed).toContain("Required query field was not supplied.");
    expect(failed).toContain('"access_token":"[REDACTED]"');
    expect(failed).toContain('"private_key":"[REDACTED]"');
    expect(failed).toContain('"client_secret":"[REDACTED]"');
    expect(failed).not.toContain("leaked-body-token");
    expect(failed).not.toContain("nested-http-diagnostic-token-123");
    expect(failed).not.toContain("http-integration-private-key-material");
    expect(failed).not.toContain("http-integration-client-secret-material");
  });
});

describe("GoogleSecOpsConnector.testConnection over the real client", () => {
  beforeEach(() => {
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
    getJestSpyOn(logger, "warn").mockImplementation((): void => {});
    getJestSpyOn(logger, "error").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("authenticates once and probes every documented route with the saved scope, then the other", async () => {
    const transport: Transport = makeTransport({
      search: [
        (request: RecordedRequest): StubbedResponse => {
          return request.url.searchParams.get("pageSize") === "1"
            ? ok({ detections: [{ ...OPEN_ALERT, id: "d1" }] })
            : ok({
                detections: [
                  { ...OPEN_ALERT, id: "d1" },
                  { ...OPEN_ALERT, id: "d2" },
                ],
              });
        },
      ],
      alerts: answer(
        stream([
          {
            alerts: { alerts: [OPEN_ALERT] },
            complete: true,
            progress: 1,
            baselineAlertsCount: 3,
            filteredAlertsCount: 3,
          },
        ]),
      ),
    });
    const connector: GoogleSecOpsConnector = new GoogleSecOpsConnector(
      transport.fetchImplementation,
    );

    const result: ConnectorTestResult = await connector.testConnection(
      secOpsSettings(),
      { requestTimeoutInMs: 20000 },
    );

    expect(statusesOf(result.checks)).toEqual([
      "authentication:pass",
      "rule-detections-read:pass",
      "curated-detections-read:pass",
      "alerts-view-read:pass",
      "detections-available:pass",
    ]);
    expect(result.counts).toEqual({
      scope: "alerts-only",
      alertsViewLast24h: 3,
      alertsViewLast7d: 3,
      ruleDetectionsCreatedLast24h: "2",
      ruleDetectionsCreatedLast7d: "2",
      hasMoreLast7d: false,
      otherScope: {
        scope: "alerts-and-detections",
        alertsViewLast24h: 3,
        alertsViewLast7d: 3,
        ruleDetectionsCreatedLast24h: "2",
        ruleDetectionsCreatedLast7d: "2",
        hasMoreLast7d: false,
      },
    });
    expect(result.samples).toHaveLength(2);

    expect(transport.of("token")).toHaveLength(1);
    expect(transport.requests).toHaveLength(13);

    const searches: Array<RecordedRequest> = transport.of("search");
    expect(
      searches.map((request: RecordedRequest): string => {
        const params: Record<string, string> = paramsOf(request);
        return `${params["pageSize"]}:${params["alertState"] || "any"}:${params["startTime"]}:${params["listBasis"]}`;
      }),
    ).toEqual([
      "1:ALERTING:2026-09-13T12:00:00.000Z:CREATED_TIME",
      "1000:ALERTING:2026-09-13T12:00:00.000Z:CREATED_TIME",
      "1000:ALERTING:2026-09-07T12:00:00.000Z:CREATED_TIME",
      "1000:any:2026-09-13T12:00:00.000Z:CREATED_TIME",
      "1000:any:2026-09-07T12:00:00.000Z:CREATED_TIME",
    ]);
    /*
     * The curated probe counts the curated rules over the last week, then
     * reads one record of the rule with the most detections by its id.
     */
    expect(
      transport.of("count").map((request: RecordedRequest): JSONObject => {
        return JSON.parse(request.body!) as JSONObject;
      }),
    ).toEqual([
      {
        interval: {
          startTime: "2026-09-07T12:00:00.000Z",
          endTime: "2026-09-14T12:00:00.000Z",
        },
      },
    ]);
    expect(transport.of("curated")).toHaveLength(1);
    expect(paramsOf(transport.of("curated")[0]!)).toEqual({
      ruleId: CURATED_RULE_ID,
      startTime: "2026-09-07T12:00:00.000Z",
      endTime: "2026-09-14T12:00:00.000Z",
      pageSize: "1",
      listBasis: "CREATED_TIME",
      alertState: "ALERTING",
    });
    expect(checkByKey(result.checks, "curated-detections-read").message).toBe(
      `Curated rule detections can be read by created time: 1 curated rule produced detections in the last 7 days (0 returned for a one-record probe of ${CURATED_RULE_ID}).`,
    );
    expect(
      transport.of("alerts").map((request: RecordedRequest): string => {
        return `${request.url.searchParams.get("alertListOptions.maxReturnedAlerts")}:${request.url.searchParams.get("includeNonAlertingDetections")}:${request.url.searchParams.get("timeRange.startTime")}`;
      }),
    ).toEqual([
      "1:ALERTS_FEATURE_PREFERENCE_DISABLED:2026-09-13T12:00:00.000Z",
      "1:ALERTS_FEATURE_PREFERENCE_DISABLED:2026-09-13T12:00:00.000Z",
      "1:ALERTS_FEATURE_PREFERENCE_DISABLED:2026-09-07T12:00:00.000Z",
      "1:ALERTS_FEATURE_PREFERENCE_ENABLED:2026-09-13T12:00:00.000Z",
      "1:ALERTS_FEATURE_PREFERENCE_ENABLED:2026-09-07T12:00:00.000Z",
    ]);
  });

  test("the test's request deadline reaches the token exchange", async () => {
    const transport: Transport = makeTransport({ token: never() });
    const connector: GoogleSecOpsConnector = new GoogleSecOpsConnector(
      transport.fetchImplementation,
    );

    const result: ConnectorTestResult = await connector.testConnection(
      secOpsSettings(),
      { requestTimeoutInMs: 50 },
    );

    expect(statusesOf(result.checks)).toEqual([
      "authentication:fail",
      "detections-available:skip",
    ]);
    expect(checkByKey(result.checks, "authentication").message).toBe(
      "Google SecOps token exchange timed out after 1 seconds with no response.",
    );
  });

  test("a token endpoint answering garbage fails authentication with the client's message", async () => {
    const transport: Transport = makeTransport({
      token: answer({ status: 200, body: "<html>proxy</html>" }),
    });

    const result: ConnectorTestResult = await new GoogleSecOpsConnector(
      transport.fetchImplementation,
    ).testConnection(secOpsSettings(), { requestTimeoutInMs: 20000 });

    const authentication: SecurityConnectorCheck = checkByKey(
      result.checks,
      "authentication",
    );
    expect(authentication).toMatchObject({
      status: "fail",
      message: "Google token exchange returned a non-JSON body.",
    });
    expect(transport.requests).toHaveLength(1);
  });
});
