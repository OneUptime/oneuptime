import { afterEach, describe, expect, jest, test } from "@jest/globals";
import GoogleSecOpsClient, {
  FetchAlertsResult,
  SearchDetectionsResult,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import GoogleSecOpsConnector from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsConnector";
import {
  ConnectorFetchOptions,
  ConnectorFetchPurpose,
  ConnectorFetchResult,
  ConnectorFetchWindow,
  readConnectorChecks,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import APIException from "../../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  SecurityConnectorCheck,
  SecurityConnectorSample,
} from "../../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import GoogleSecOpsAlertNormalizer from "../../../../../../Utils/SecurityEvent/GoogleSecOpsAlertNormalizer";
import { contentHashEventUid } from "../../../../../../Utils/SecurityEvent/NormalizerHelpers";
import { getJestSpyOn } from "../../../../../Spy";
import {
  AlertsCall,
  ClientFactoryCall,
  ConnectorHarness,
  FakeClient,
  SearchCall,
  checkByKey,
  connectorWith,
  detection,
  fetchOptions,
  fetched,
  makeFakeClient,
  page,
  poisonDetection,
  rejectionOf,
  secOpsSettings,
  statusesOf,
} from "./GoogleSecOpsConnectorFixtures";

/*
 * GoogleSecOpsConnector.fetchEvents: the three-pass read the retired
 * GoogleSecOpsPoller ran, as a connector. One window is read as rule
 * detections by created time, curated rule detections by created time and
 * the alerts view by detection time, and unioned by Collection.id. These
 * tests pin the pass requests (bases, scope, page sizes), the union, the
 * per-pass checks and their wording, the split budgets (20 shared search
 * pages, 16 alerts-view requests, the wall clock, and the poller's total
 * request and record bounds), the alerts view's midpoint splitting, the
 * curated-rule degradation, the failed-pass checks attached to a thrown
 * error, the diagnostics details, samples and creation lag. The cursor,
 * ingest and row bookkeeping around it belong to the generic poller.
 */

const WINDOW: ConnectorFetchWindow = {
  startTime: new Date("2026-09-14T11:54:00.000Z"),
  endTime: new Date("2026-09-14T12:00:00.000Z"),
};
const DAY_WINDOW: ConnectorFetchWindow = {
  startTime: new Date("2026-09-13T12:00:00.000Z"),
  endTime: new Date("2026-09-14T12:00:00.000Z"),
};

async function fetchWith(
  fake: FakeClient,
  overrides: {
    options?: Partial<ConnectorFetchOptions> | undefined;
    alertingOnly?: boolean | undefined;
    window?: ConnectorFetchWindow | undefined;
  } = {},
): Promise<ConnectorFetchResult> {
  return connectorWith(fake.client).connector.fetchEvents(
    secOpsSettings({ alertingOnly: overrides.alertingOnly }),
    overrides.window || WINDOW,
    fetchOptions(overrides.options),
  );
}

function uidsOf(result: ConnectorFetchResult): Array<string> {
  return result.events
    .map((event: NormalizedSecurityEvent): string => {
      return event.eventUid;
    })
    .sort();
}

function endlessPages(id: string): Array<SearchDetectionsResult> {
  return [page([detection(id)], { nextPageToken: "again" })];
}

describe("GoogleSecOpsConnector.fetchEvents passes", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a poll reads three passes over one window and unions them by Collection.id", async () => {
    const fake: FakeClient = makeFakeClient({
      rule: [page([detection("a"), detection("b")])],
      curated: [page([detection("b"), detection("c")])],
      alerts: [fetched([detection("c"), detection("d")])],
    });

    const result: ConnectorFetchResult = await fetchWith(fake);

    expect(uidsOf(result)).toEqual(["a", "b", "c", "d"]);
    expect(result).toMatchObject({
      fetchedCount: 4,
      rejectedCount: 0,
      failedCount: 0,
      complete: true,
      requestCount: 3,
      warnings: [],
    });
    expect(result.checks).toEqual([
      {
        key: "read-rule-detections",
        name: "Read rule detections by created time",
        status: "pass",
        durationMs: expect.any(Number),
        message: "2 rule detections returned for the window by created time.",
      },
      {
        key: "read-curated-detections",
        name: "Read curated rule detections by created time",
        status: "pass",
        durationMs: expect.any(Number),
        message:
          "2 curated rule detections returned for the window by created time.",
      },
      {
        key: "read-alerts-view",
        name: "Read alerts view by detection time",
        status: "pass",
        durationMs: expect.any(Number),
        message:
          "2 alerts returned by detection time. The configured Google SecOps instance is reachable and allows reading detections.",
      },
    ]);
    expect(result.details).toEqual({
      basis: "created-time",
      sourceCounts: { ruleDetections: 2, curatedDetections: 2, alertsView: 2 },
      creationLag: { measured: 4, lateCount: 0, maxLagMinutes: 2 },
      includeNonAlertingDetections: false,
    });
    for (const event of result.events) {
      expect(event.vendorName).toBe("Google");
      expect(event.productName).toBe("Google SecOps");
    }
  });

  /*
   * Google's searches return newest first, so a bounded read has no
   * "everything before here was read" point; the poller narrows instead.
   */
  test("never names a resume point, even when a bound stopped the read", async () => {
    const complete: ConnectorFetchResult = await fetchWith(makeFakeClient({}));
    const stopped: ConnectorFetchResult = await fetchWith(
      makeFakeClient({ rule: endlessPages("endless") }),
    );

    expect(complete.resumeAfter).toBeUndefined();
    expect(stopped.complete).toBe(false);
    expect(stopped.resumeAfter).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(stopped, "resumeAfter")).toBe(
      false,
    );
  });

  test("a poll's search passes ask for created time, the saved scope, full pages and the right route", async () => {
    const fake: FakeClient = makeFakeClient({});

    await fetchWith(fake);

    expect(fake.searchCalls).toHaveLength(2);
    expect(fake.searchCalls[0]).toMatchObject({
      listBasis: "CREATED_TIME",
      alertingOnly: true,
      pageSize: 1000,
      curated: false,
    });
    expect(fake.searchCalls[0]!.pageToken).toBeUndefined();
    expect(fake.searchCalls[1]).toMatchObject({
      listBasis: "CREATED_TIME",
      alertingOnly: true,
      pageSize: 1000,
      curated: true,
    });
    for (const call of fake.searchCalls) {
      expect(call.startTime).toEqual(WINDOW.startTime);
      expect(call.endTime).toEqual(WINDOW.endTime);
    }
    expect(fake.alertsCalls).toHaveLength(1);
    expect(fake.alertsCalls[0]).toEqual({
      startTime: WINDOW.startTime,
      endTime: WINDOW.endTime,
      maxAlerts: 1000,
      includeNonAlertingDetections: false,
    });
  });

  test("a fetch with no purpose reads like a poll", async () => {
    const fake: FakeClient = makeFakeClient({});

    const result: ConnectorFetchResult = await fetchWith(fake, {
      options: { purpose: undefined },
    });

    expect(
      fake.searchCalls.map((call: SearchCall): string => {
        return call.listBasis;
      }),
    ).toEqual(["CREATED_TIME", "CREATED_TIME"]);
    expect(result.details).toMatchObject({ basis: "created-time" });
    expect(checkByKey(result.checks, "read-rule-detections").name).toBe(
      "Read rule detections by created time",
    );
  });

  test.each(["preview", "backfill"] as Array<ConnectorFetchPurpose>)(
    "a %s reads the search passes by both bases and reports the detection-time basis",
    async (purpose: ConnectorFetchPurpose) => {
      const fake: FakeClient = makeFakeClient({
        rule: [page([detection("x")])],
      });

      const result: ConnectorFetchResult = await fetchWith(fake, {
        options: { purpose },
      });

      expect(
        fake.searchCalls.map((call: SearchCall): string => {
          return `${call.curated ? "curated" : "rule"}:${call.listBasis}`;
        }),
      ).toEqual([
        "rule:CREATED_TIME",
        "rule:DETECTION_TIME",
        "curated:CREATED_TIME",
        "curated:DETECTION_TIME",
      ]);
      expect(result.details).toMatchObject({
        basis: "detection-time",
        sourceCounts: {
          ruleDetections: 2,
          curatedDetections: 0,
          alertsView: 0,
        },
      });
      // The same record read by both bases is one record.
      expect(result.fetchedCount).toBe(1);
      expect(result.requestCount).toBe(5);
      expect(statusesOf(result.checks)).toEqual([
        "read-rule-detections:pass",
        "read-curated-detections:pass",
        "read-alerts-view:pass",
      ]);
      expect(checkByKey(result.checks, "read-rule-detections")).toMatchObject({
        name: "Read rule detections by created and detection time",
        message:
          "2 rule detections returned for the window by created and detection time.",
      });
      expect(checkByKey(result.checks, "read-curated-detections").name).toBe(
        "Read curated rule detections by created and detection time",
      );
      expect(checkByKey(result.checks, "read-alerts-view").name).toBe(
        "Read alerts view by detection time",
      );
    },
  );

  test("each basis follows its own page tokens under the shared page budget", async () => {
    const fake: FakeClient = makeFakeClient({
      rule: [
        page([detection("p1")], { nextPageToken: "t1" }),
        page([detection("p2")]),
      ],
    });

    const result: ConnectorFetchResult = await fetchWith(fake, {
      options: { purpose: "backfill" },
    });

    expect(
      fake.searchCalls
        .filter((call: SearchCall): boolean => {
          return call.curated !== true;
        })
        .map((call: SearchCall): string => {
          return `${call.listBasis}:${call.pageToken || "-"}`;
        }),
    ).toEqual([
      "CREATED_TIME:-",
      "CREATED_TIME:t1",
      "DETECTION_TIME:-",
      "DETECTION_TIME:t1",
    ]);
    expect(result.fetchedCount).toBe(2);
    expect(result.requestCount).toBe(7);
  });

  test.each([
    [true, true, false],
    [false, false, true],
  ])(
    "alertingOnly %s sends alertingOnly %s to the searches and includeNonAlertingDetections %s to the alerts view",
    async (
      alertingOnly: boolean,
      searchAlertingOnly: boolean,
      includeNonAlertingDetections: boolean,
    ) => {
      const fake: FakeClient = makeFakeClient({});

      const result: ConnectorFetchResult = await fetchWith(fake, {
        alertingOnly,
      });

      expect(
        fake.searchCalls.map((call: SearchCall): boolean => {
          return call.alertingOnly;
        }),
      ).toEqual([searchAlertingOnly, searchAlertingOnly]);
      expect(
        fake.alertsCalls.map((call: AlertsCall): boolean | undefined => {
          return call.includeNonAlertingDetections;
        }),
      ).toEqual([includeNonAlertingDetections]);
      expect(result.details).toMatchObject({ includeNonAlertingDetections });
    },
  );

  test("nextPageToken is followed and the token is forwarded", async () => {
    const fake: FakeClient = makeFakeClient({
      rule: [
        page([detection("p1")], { nextPageToken: "t1" }),
        page([detection("p2")], { nextPageToken: "t2" }),
        page([detection("p3")]),
      ],
    });

    const result: ConnectorFetchResult = await fetchWith(fake);

    expect(
      fake.searchCalls
        .filter((call: SearchCall): boolean => {
          return call.curated !== true;
        })
        .map((call: SearchCall): string | undefined => {
          return call.pageToken;
        }),
    ).toEqual([undefined, "t1", "t2"]);
    expect(result).toMatchObject({
      complete: true,
      fetchedCount: 3,
      requestCount: 5,
      details: expect.objectContaining({
        sourceCounts: {
          ruleDetections: 3,
          curatedDetections: 0,
          alertsView: 0,
        },
      }),
    });
    expect(checkByKey(result.checks, "read-rule-detections").message).toBe(
      "3 rule detections returned for the window by created time.",
    );
  });

  /*
   * A record with no id is identified by a hash of its content, so the
   * connector must hand Google's object to the normalizer exactly as read:
   * adding a field would give it a new identifier and re-import it.
   */
  test("a record with no id is unioned by its content hash and reaches the normalizer untouched", async () => {
    const noId: JSONObject = {
      type: "RULE_DETECTION",
      detectionTime: "2026-09-14T11:00:00.000Z",
      createdTime: "2026-09-14T11:02:00.000Z",
      detection: [{ ruleName: "No id rule", severity: "LOW" }],
    };
    const fromSearch: JSONObject = JSON.parse(JSON.stringify(noId));
    const fromAlerts: JSONObject = JSON.parse(JSON.stringify(noId));
    const normalize: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      GoogleSecOpsAlertNormalizer,
      "normalize",
    );
    const fake: FakeClient = makeFakeClient({
      rule: [page([fromSearch])],
      alerts: [fetched([fromAlerts])],
    });

    const result: ConnectorFetchResult = await fetchWith(fake);

    expect(result.fetchedCount).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.eventUid).toBe(contentHashEventUid(noId));
    expect(normalize).toHaveBeenCalledTimes(1);
    // The later copy of the same record wins the union slot.
    expect(normalize.mock.calls[0]![0]).toBe(fromAlerts);
    expect(fromSearch).toEqual(noId);
    expect(fromAlerts).toEqual(noId);
  });

  test("an object that cannot even be inspected is kept under its own key without hiding the records beside it", async () => {
    const uninspectable: () => JSONObject = (): JSONObject => {
      const record: JSONObject = {};
      Object.defineProperty(record, "id", {
        get: (): never => {
          throw new Error("unreadable");
        },
        enumerable: true,
      });
      return record;
    };
    const fake: FakeClient = makeFakeClient({
      rule: [page([uninspectable(), uninspectable(), detection("valid")])],
    });

    const result: ConnectorFetchResult = await fetchWith(fake);

    expect(result.fetchedCount).toBe(3);
    expect(uidsOf(result)).toEqual(["valid"]);
    expect(result.rejectedCount + result.failedCount).toBe(2);
    expect(result.complete).toBe(true);
  });

  /*
   * Rejected objects are permanently unrecognizable and failed ones are for
   * the poller to retry; both are only counted here. The poller owns the
   * warnings about them and folds failures into completeness, so the
   * connector's own complete flag describes its bounds alone.
   */
  test("unrecognized records are rejected and records that throw are failed, without touching completeness", async () => {
    const fake: FakeClient = makeFakeClient({
      rule: [
        page([
          { arbitrary: "envelope" },
          poisonDetection("poison"),
          detection("ok"),
        ]),
      ],
      alerts: [fetched([{ progress: 0.5, complete: false }])],
    });

    const result: ConnectorFetchResult = await fetchWith(fake);

    expect(result).toMatchObject({
      fetchedCount: 4,
      rejectedCount: 2,
      failedCount: 1,
      complete: true,
      warnings: [],
    });
    expect(uidsOf(result)).toEqual(["ok"]);
    expect(result.samples).toHaveLength(1);
  });

  test("rejects unusable settings before building a client or contacting anything", async () => {
    const fake: FakeClient = makeFakeClient({});
    const harness: ConnectorHarness = connectorWith(fake.client);

    const error: unknown = await rejectionOf(
      harness.connector.fetchEvents(
        secOpsSettings({ config: { region: "mars" } }),
        WINDOW,
        fetchOptions(),
      ),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      "Region must be a Google SecOps regional prefix like 'us' or 'europe'.",
    );
    expect(harness.factoryCalls).toHaveLength(0);
    expect(fake.searchCalls).toHaveLength(0);
  });

  test("builds the client with the fetch's request deadline", async () => {
    const fake: FakeClient = makeFakeClient({});
    const harness: ConnectorHarness = connectorWith(fake.client);

    await harness.connector.fetchEvents(
      secOpsSettings(),
      WINDOW,
      fetchOptions({ requestTimeoutInMs: 4321 }),
    );

    expect(harness.factoryCalls).toEqual([
      expect.objectContaining({
        region: "us",
        requestTimeoutInMs: 4321,
      }) as unknown as ClientFactoryCall,
    ]);
  });
});

describe("GoogleSecOpsConnector.fetchEvents failures", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([400, 403, 404])(
    "a curated pass answering HTTP %s is a warning and the fetch continues",
    async (status: number) => {
      const fake: FakeClient = makeFakeClient({
        rule: [page([detection("r")])],
        curated: [
          new APIException(
            `Google SecOps detections search failed (HTTP ${status}): {"error":{"code":${status}}}`,
          ),
        ],
        alerts: [fetched([detection("v")])],
      });

      const result: ConnectorFetchResult = await fetchWith(fake);

      expect(result.complete).toBe(true);
      expect(uidsOf(result)).toEqual(["r", "v"]);
      expect(result.warnings).toEqual([
        `Curated rule detections could not be read (HTTP ${status}); this tenant may not have curated rule access. Rule detections and the alerts view were still read.`,
      ]);
      expect(checkByKey(result.checks, "read-curated-detections")).toEqual({
        key: "read-curated-detections",
        name: "Read curated rule detections by created time",
        status: "warn",
        durationMs: expect.any(Number),
        message: `Google SecOps detections search failed (HTTP ${status}): {"error":{"code":${status}}}`,
        remediation:
          "Curated (Google-authored) rule detections need that entitlement on the tenant. Nothing to fix unless you expect curated detections to be imported.",
        details: { httpStatus: status },
      });
      expect(statusesOf(result.checks)).toEqual([
        "read-rule-detections:pass",
        "read-curated-detections:warn",
        "read-alerts-view:pass",
      ]);
      expect(result.details).toMatchObject({
        sourceCounts: {
          ruleDetections: 1,
          curatedDetections: 0,
          alertsView: 1,
        },
      });
      expect(fake.alertsCalls).toHaveLength(1);
    },
  );

  test.each([401, 429, 500, 503])(
    "a curated pass answering HTTP %s throws the original error with the passes that ran attached",
    async (status: number) => {
      const original: APIException = new APIException(
        `Google SecOps detections search failed (HTTP ${status}): {"error":{"code":${status}}}`,
      );
      const fake: FakeClient = makeFakeClient({
        rule: [page([detection("r")])],
        curated: [original],
      });

      const error: unknown = await rejectionOf(fetchWith(fake));

      expect(error).toBe(original);
      expect((error as Error).message).toBe(
        `Google SecOps detections search failed (HTTP ${status}): {"error":{"code":${status}}}`,
      );
      const checks: Array<SecurityConnectorCheck> | undefined =
        readConnectorChecks(error);
      expect(statusesOf(checks)).toEqual([
        "read-rule-detections:pass",
        "read-curated-detections:fail",
      ]);
      expect(checkByKey(checks, "read-curated-detections")).toMatchObject({
        name: "Read curated rule detections by created time",
        message: `Google SecOps detections search failed (HTTP ${status}): {"error":{"code":${status}}}`,
      });
      expect(fake.alertsCalls).toHaveLength(0);
    },
  );

  test.each([
    "Google SecOps detections search returned a non-JSON body.",
    "Google SecOps detections search timed out after 60 seconds with no response.",
    'Google SecOps detections search returned an unrecognized response shape: {"nope":true}',
  ])(
    "a curated pass failing with no HTTP status (%s) fails like any other pass",
    async (message: string) => {
      const original: APIException = new APIException(message);
      const fake: FakeClient = makeFakeClient({ curated: [original] });

      const error: unknown = await rejectionOf(fetchWith(fake));

      expect(error).toBe(original);
      expect((error as Error).message).toBe(message);
      expect(statusesOf(readConnectorChecks(error))).toEqual([
        "read-rule-detections:pass",
        "read-curated-detections:fail",
      ]);
    },
  );

  test("a rule pass failure names its own pass and nothing after it runs", async () => {
    const original: APIException = new APIException(
      "Google SecOps detections search failed (HTTP 403): denied",
    );
    const fake: FakeClient = makeFakeClient({ rule: [original] });

    const error: unknown = await rejectionOf(fetchWith(fake));

    expect(error).toBe(original);
    expect(error).toBeInstanceOf(APIException);
    expect(readConnectorChecks(error)).toEqual([
      {
        key: "read-rule-detections",
        name: "Read rule detections by created time",
        status: "fail",
        durationMs: expect.any(Number),
        message: "Google SecOps detections search failed (HTTP 403): denied",
      },
    ]);
    expect(fake.searchCalls).toHaveLength(1);
    expect(fake.alertsCalls).toHaveLength(0);
  });

  test("a token exchange failing on the first request is the rule pass's failure", async () => {
    const original: APIException = new APIException(
      'Google token exchange failed (HTTP 401): {"error":"invalid_grant"}',
    );
    const fake: FakeClient = makeFakeClient({ rule: [original] });

    const error: unknown = await rejectionOf(fetchWith(fake));

    expect(
      (error as Error).message.startsWith(
        "Google token exchange failed (HTTP 401): ",
      ),
    ).toBe(true);
    expect(statusesOf(readConnectorChecks(error))).toEqual([
      "read-rule-detections:fail",
    ]);
  });

  test("an alerts-view failure carries both search passes and its own failed check", async () => {
    const original: APIException = new APIException(
      "Google SecOps alerts fetch failed (HTTP 403): permission denied",
    );
    const fake: FakeClient = makeFakeClient({
      rule: [page([detection("r")])],
      curated: [page([detection("c")])],
      alerts: [original],
    });

    const error: unknown = await rejectionOf(fetchWith(fake));

    expect(error).toBe(original);
    const checks: Array<SecurityConnectorCheck> | undefined =
      readConnectorChecks(error);
    expect(statusesOf(checks)).toEqual([
      "read-rule-detections:pass",
      "read-curated-detections:pass",
      "read-alerts-view:fail",
    ]);
    expect(checkByKey(checks, "read-alerts-view")).toMatchObject({
      name: "Read alerts view by detection time",
      message:
        "Google SecOps alerts fetch failed (HTTP 403): permission denied",
    });
  });

  test("a failed pass of a preview is named after both bases", async () => {
    const fake: FakeClient = makeFakeClient({
      curated: [
        new APIException(
          'Google SecOps detections search failed (HTTP 500): {"error":{"code":500}}',
        ),
      ],
    });

    const error: unknown = await rejectionOf(
      fetchWith(fake, { options: { purpose: "preview" } }),
    );

    expect(
      checkByKey(readConnectorChecks(error), "read-curated-detections").name,
    ).toBe("Read curated rule detections by created and detection time");
  });

  test("an alerts-view failure after a curated warning keeps the warning check", async () => {
    const fake: FakeClient = makeFakeClient({
      curated: [
        new APIException(
          'Google SecOps detections search failed (HTTP 403): {"error":{"code":403}}',
        ),
      ],
      alerts: [
        new APIException(
          "Google SecOps alerts fetch returned a non-JSON body.",
        ),
      ],
    });

    const error: unknown = await rejectionOf(fetchWith(fake));

    expect(statusesOf(readConnectorChecks(error))).toEqual([
      "read-rule-detections:pass",
      "read-curated-detections:warn",
      "read-alerts-view:fail",
    ]);
  });

  test("the failed check is redacted and kept whole while the thrown error is left exactly as the client wrote it", async () => {
    const message: string = `Google SecOps alerts fetch failed (HTTP 400): {"error":{"private_key":"-----BEGIN PRIVATE KEY-----leaked"}} ${"detail ".repeat(200)}tail`;
    const original: APIException = new APIException(message);
    const fake: FakeClient = makeFakeClient({ alerts: [original] });

    const error: unknown = await rejectionOf(fetchWith(fake));

    expect((error as Error).message).toBe(message);
    const failed: SecurityConnectorCheck = checkByKey(
      readConnectorChecks(error),
      "read-alerts-view",
    );
    expect(failed.message).not.toContain("leaked");
    expect(failed.message.endsWith("tail")).toBe(true);
    expect(failed.message).not.toContain("(truncated)");
  });

  test("the attached checks stay off the error's enumerable properties", async () => {
    const original: APIException = new APIException(
      "Google SecOps detections search failed (HTTP 403): denied",
    );

    const error: unknown = await rejectionOf(
      fetchWith(makeFakeClient({ rule: [original] })),
    );

    expect(Object.keys(error as object)).not.toContain(
      "oneuptimeConnectorChecks",
    );
    expect(readConnectorChecks(error)).toHaveLength(1);
  });

  test("a rejection that is not an Error object is rethrown as it was", async () => {
    const client: GoogleSecOpsClient = {
      searchDetections: (): Promise<SearchDetectionsResult> => {
        return Promise.reject("socket hang up");
      },
    } as unknown as GoogleSecOpsClient;

    const error: unknown = await rejectionOf(
      connectorWith(client).connector.fetchEvents(
        secOpsSettings(),
        WINDOW,
        fetchOptions(),
      ),
    );

    expect(error).toBe("socket hang up");
    expect(readConnectorChecks(error)).toBeUndefined();
  });
});

describe("GoogleSecOpsConnector.fetchEvents budgets", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function useClock(): {
    advance: (ms: number) => void;
    set: (ms: number) => void;
  } {
    const realNow: number = Date.now();
    let elapsedMs: number = 0;
    getJestSpyOn(Date, "now").mockImplementation((): number => {
      return realNow + elapsedMs;
    });
    return {
      advance: (ms: number): void => {
        elapsedMs += ms;
      },
      set: (ms: number): void => {
        elapsedMs = ms;
      },
    };
  }

  test("the search passes share a 20 page budget and the alerts view keeps its own", async () => {
    const fake: FakeClient = makeFakeClient({ rule: endlessPages("endless") });

    const result: ConnectorFetchResult = await fetchWith(fake);

    expect(fake.searchCalls).toHaveLength(20);
    expect(
      fake.searchCalls.every((call: SearchCall): boolean => {
        return call.curated === false;
      }),
    ).toBe(true);
    // The alerts view still ran on its own budget.
    expect(fake.alertsCalls).toHaveLength(1);
    expect(result.requestCount).toBe(21);
    expect(result.complete).toBe(false);
    expect(checkByKey(result.checks, "read-rule-detections")).toMatchObject({
      status: "warn",
      message:
        "20 rule detections returned for the window by created time. The pass was stopped by the request budget after 20 requests.",
    });
    expect(checkByKey(result.checks, "read-curated-detections")).toMatchObject({
      status: "skip",
      message:
        "Not run: stopped by the request budget after 0 requests. The search passes share one page budget and it was spent before this pass started.",
    });
    expect(checkByKey(result.checks, "read-alerts-view").status).toBe("pass");
    expect(result.warnings).toEqual([
      "Read rule detections by created time was stopped by the request budget after 20 requests.",
      "Read curated rule detections by created time was stopped by the request budget after 0 requests.",
    ]);
  });

  test("a preview's two bases share the same 20 pages", async () => {
    const fake: FakeClient = makeFakeClient({ rule: endlessPages("endless") });

    const result: ConnectorFetchResult = await fetchWith(fake, {
      options: { purpose: "preview" },
    });

    // The created-time basis spends every page; detection time never starts.
    expect(fake.searchCalls).toHaveLength(20);
    expect(
      fake.searchCalls.every((call: SearchCall): boolean => {
        return call.listBasis === "CREATED_TIME";
      }),
    ).toBe(true);
    expect(checkByKey(result.checks, "read-rule-detections").message).toBe(
      "20 rule detections returned for the window by created and detection time. The pass was stopped by the request budget after 20 requests.",
    );
  });

  test("the alerts view stops at its own 16 requests while the searches still read", async () => {
    const fake: FakeClient = makeFakeClient({
      rule: [
        page(
          Array.from(
            { length: 1000 },
            (_value: unknown, index: number): JSONObject => {
              return detection(`rule-${index}`);
            },
          ),
          { nextPageToken: "second" },
        ),
        page([detection("rule-1000")]),
      ],
      alerts: [fetched([detection("burst")], { truncatedByCount: true })],
    });

    const result: ConnectorFetchResult = await fetchWith(fake, {
      window: DAY_WINDOW,
    });

    expect(fake.alertsCalls).toHaveLength(16);
    expect(result.requestCount).toBe(19);
    expect(result.complete).toBe(false);
    expect(result.details).toMatchObject({
      sourceCounts: {
        ruleDetections: 1001,
        curatedDetections: 0,
        alertsView: 16,
      },
    });
    expect(statusesOf(result.checks)).toEqual([
      "read-rule-detections:pass",
      "read-curated-detections:pass",
      "read-alerts-view:warn",
    ]);
    expect(checkByKey(result.checks, "read-alerts-view").message).toBe(
      "16 alerts returned by detection time. The pass was stopped by the request budget after 16 requests.",
    );
    expect(result.warnings).toEqual([
      "Google limited the alerts view response for 2026-09-13T12:00:00.000Z to 2026-09-14T12:00:00.000Z, so it was split into smaller windows 16 times.",
      "Read alerts view by detection time was stopped by the request budget after 16 requests.",
    ]);
  });

  test("a pass the time budget never let start is skipped and named", async () => {
    const clock: { advance: (ms: number) => void } = useClock();
    const fake: FakeClient = makeFakeClient({
      rule: [
        (): SearchDetectionsResult => {
          // The rule pass is slow enough to spend the whole four minutes.
          clock.advance(5 * 60 * 1000);
          return page([detection("slow")]);
        },
      ],
    });

    const result: ConnectorFetchResult = await fetchWith(fake);

    expect(fake.searchCalls).toHaveLength(1);
    expect(fake.alertsCalls).toHaveLength(0);
    expect(checkByKey(result.checks, "read-rule-detections").status).toBe(
      "pass",
    );
    for (const key of ["read-curated-detections", "read-alerts-view"]) {
      expect(checkByKey(result.checks, key)).toMatchObject({
        status: "skip",
        message: "Not run: the poll time budget was spent.",
      });
    }
    expect(result.warnings).toEqual([
      "Read curated rule detections by created time was not run: the poll time budget was spent.",
      "Read alerts view by detection time was not run: the poll time budget was spent.",
    ]);
    expect(result.complete).toBe(false);
    // What was read is still returned for import.
    expect(uidsOf(result)).toEqual(["slow"]);
  });

  test("a pass the time budget stops part way names how far it got", async () => {
    const clock: { advance: (ms: number) => void } = useClock();
    const fake: FakeClient = makeFakeClient({
      rule: [
        page([detection("first")], { nextPageToken: "t1" }),
        (): SearchDetectionsResult => {
          clock.advance(5 * 60 * 1000);
          return page([detection("second")], { nextPageToken: "t2" });
        },
      ],
    });

    const result: ConnectorFetchResult = await fetchWith(fake);

    expect(fake.searchCalls).toHaveLength(2);
    expect(checkByKey(result.checks, "read-rule-detections")).toMatchObject({
      status: "warn",
      message:
        "2 rule detections returned for the window by created time. The pass was stopped by the poll time budget after 2 requests.",
    });
    expect(result.warnings[0]).toBe(
      "Read rule detections by created time was stopped by the poll time budget after 2 requests.",
    );
    expect(result.complete).toBe(false);
  });

  test("the wall clock is options.maxDurationMs when one is given", async () => {
    const clock: { advance: (ms: number) => void } = useClock();
    const fake: FakeClient = makeFakeClient({
      rule: [
        (): SearchDetectionsResult => {
          clock.advance(1500);
          return page([]);
        },
      ],
    });

    const result: ConnectorFetchResult = await fetchWith(fake, {
      options: { maxDurationMs: 1000 },
    });

    expect(statusesOf(result.checks)).toEqual([
      "read-rule-detections:pass",
      "read-curated-detections:skip",
      "read-alerts-view:skip",
    ]);
  });

  test.each([undefined, 0, Number.NaN, -5])(
    "a maxDurationMs of %s falls back to four minutes",
    async (maxDurationMs: number | undefined) => {
      const clock: { set: (ms: number) => void } = useClock();
      const fake: FakeClient = makeFakeClient({
        rule: [
          (): SearchDetectionsResult => {
            clock.set(4 * 60 * 1000 - 1);
            return page([]);
          },
        ],
        curated: [
          (): SearchDetectionsResult => {
            clock.set(4 * 60 * 1000);
            return page([]);
          },
        ],
      });

      const result: ConnectorFetchResult = await fetchWith(fake, {
        options: { maxDurationMs },
      });

      expect(statusesOf(result.checks)).toEqual([
        "read-rule-detections:pass",
        "read-curated-detections:pass",
        "read-alerts-view:skip",
      ]);
      expect(fake.alertsCalls).toHaveLength(0);
    },
  );

  test("maxRequests caps the requests of every pass together", async () => {
    const fake: FakeClient = makeFakeClient({ rule: endlessPages("endless") });

    const result: ConnectorFetchResult = await fetchWith(fake, {
      options: { maxRequests: 3 },
    });

    expect(fake.searchCalls).toHaveLength(3);
    expect(fake.alertsCalls).toHaveLength(0);
    expect(result.requestCount).toBe(3);
    expect(result.complete).toBe(false);
    expect(checkByKey(result.checks, "read-rule-detections")).toMatchObject({
      status: "warn",
      message:
        "3 rule detections returned for the window by created time. The pass was stopped by the per-run request limit after 3 requests.",
    });
    for (const key of ["read-curated-detections", "read-alerts-view"]) {
      expect(checkByKey(result.checks, key)).toMatchObject({
        status: "skip",
        message:
          "Not run: stopped by the per-run request limit after 0 requests. The earlier passes used every request this run allows.",
      });
    }
    expect(result.warnings).toEqual([
      "Read rule detections by created time was stopped by the per-run request limit after 3 requests.",
      "Read curated rule detections by created time was stopped by the per-run request limit after 0 requests.",
      "Read alerts view by detection time was stopped by the per-run request limit after 0 requests.",
    ]);
  });

  test("the poller's single-list default of 20 requests leaves the alerts view unread, and says so", async () => {
    const fake: FakeClient = makeFakeClient({ rule: endlessPages("endless") });

    const result: ConnectorFetchResult = await fetchWith(fake, {
      options: { maxRequests: 20 },
    });

    expect(result.requestCount).toBe(20);
    expect(fake.alertsCalls).toHaveLength(0);
    expect(checkByKey(result.checks, "read-alerts-view").message).toBe(
      "Not run: stopped by the per-run request limit after 0 requests. The earlier passes used every request this run allows.",
    );
  });

  test.each([undefined, Number.NaN, 0])(
    "a maxRequests of %s falls back to the connector's own budget",
    async (maxRequests: number | undefined) => {
      const fake: FakeClient = makeFakeClient({
        rule: endlessPages("endless"),
      });

      const result: ConnectorFetchResult = await fetchWith(fake, {
        options: { maxRequests: maxRequests as number },
      });

      expect(result.requestCount).toBe(21);
    },
  );

  test("maxEvents stops collecting mid-page with complete=false and names the record limit", async () => {
    const fake: FakeClient = makeFakeClient({
      rule: [page([detection("a"), detection("b"), detection("c")])],
    });

    const result: ConnectorFetchResult = await fetchWith(fake, {
      options: { maxEvents: 2 },
    });

    expect(result.fetchedCount).toBe(2);
    expect(uidsOf(result)).toEqual(["a", "b"]);
    expect(result.complete).toBe(false);
    expect(fake.searchCalls).toHaveLength(1);
    expect(fake.alertsCalls).toHaveLength(0);
    expect(checkByKey(result.checks, "read-rule-detections")).toMatchObject({
      status: "warn",
      message:
        "3 rule detections returned for the window by created time. The pass was stopped by the per-run record limit after 1 request.",
    });
    for (const key of ["read-curated-detections", "read-alerts-view"]) {
      expect(checkByKey(result.checks, key)).toMatchObject({
        status: "skip",
        message:
          "Not run: stopped by the per-run record limit after 0 requests. The earlier passes collected every record this run allows.",
      });
    }
    expect(result.warnings[0]).toBe(
      "Read rule detections by created time was stopped by the per-run record limit after 1 request.",
    );
  });

  test("a record already collected never counts against maxEvents, while a full union stops the passes after it", async () => {
    const fake: FakeClient = makeFakeClient({
      rule: [page([detection("a"), detection("b"), detection("a")])],
    });

    const result: ConnectorFetchResult = await fetchWith(fake, {
      options: { maxEvents: 2 },
    });

    expect(result.fetchedCount).toBe(2);
    // The repeated record did not hit the bound, so the rule pass read everything.
    expect(checkByKey(result.checks, "read-rule-detections")).toMatchObject({
      status: "pass",
      message: "3 rule detections returned for the window by created time.",
    });
    // A later pass could add records, so it does not start once the bound is reached.
    expect(checkByKey(result.checks, "read-curated-detections")).toMatchObject({
      status: "skip",
      message:
        "Not run: stopped by the per-run record limit after 0 requests. The earlier passes collected every record this run allows.",
    });
    expect(fake.searchCalls).toHaveLength(1);
    expect(result.complete).toBe(false);
  });

  test("an alerts-view response that crosses maxEvents stops the alerts view", async () => {
    const fake: FakeClient = makeFakeClient({
      rule: [page([detection("a")])],
      alerts: [
        fetched([detection("b"), detection("c"), detection("d")], {
          truncatedByCount: true,
        }),
      ],
    });

    const result: ConnectorFetchResult = await fetchWith(fake, {
      options: { maxEvents: 3 },
      window: DAY_WINDOW,
    });

    expect(result.fetchedCount).toBe(3);
    expect(fake.alertsCalls).toHaveLength(1);
    expect(result.complete).toBe(false);
    expect(checkByKey(result.checks, "read-alerts-view")).toMatchObject({
      status: "warn",
      message:
        "3 alerts returned by detection time. The pass was stopped by the per-run record limit after 1 request.",
    });
    // A stopped alerts view does not also report the split it never made.
    expect(result.warnings).toEqual([
      "Read alerts view by detection time was stopped by the per-run record limit after 1 request.",
    ]);
  });

  test.each([undefined, Number.NaN, 0])(
    "a maxEvents of %s falls back to the connector's own record bound",
    async (maxEvents: number | undefined) => {
      const fake: FakeClient = makeFakeClient({
        rule: [page([detection("a"), detection("b")])],
      });

      const result: ConnectorFetchResult = await fetchWith(fake, {
        options: { maxEvents: maxEvents as number },
      });

      expect(result.fetchedCount).toBe(2);
      expect(result.complete).toBe(true);
    },
  );
});

describe("GoogleSecOpsConnector.fetchEvents alerts view and truncation", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const truncations: Array<[string, Partial<FetchAlertsResult>]> = [
    ["truncatedByCount", { truncatedByCount: true }],
    ["truncatedByBytes", { truncatedByBytes: true }],
    ["a filtered count above what was returned", { filteredAlertsCount: 2 }],
    ["a baseline count above what was returned", { baselineAlertsCount: 2 }],
  ];

  test.each(truncations)(
    "%s splits the window at its midpoint into contiguous halves and unions the records",
    async (_label: string, flags: Partial<FetchAlertsResult>) => {
      const fake: FakeClient = makeFakeClient({
        alerts: [
          fetched([detection("a")], flags),
          fetched([detection("a")]),
          fetched([detection("b")]),
        ],
      });

      const result: ConnectorFetchResult = await fetchWith(fake);

      expect(fake.alertsCalls).toHaveLength(3);
      const [whole, first, second] = fake.alertsCalls;
      const midpoint: number = Math.floor(
        (WINDOW.startTime.getTime() + WINDOW.endTime.getTime()) / 2,
      );
      expect(first!.startTime).toEqual(whole!.startTime);
      expect(first!.endTime.getTime()).toBe(midpoint);
      expect(second!.startTime.getTime()).toBe(midpoint);
      expect(second!.endTime).toEqual(whole!.endTime);
      expect(result).toMatchObject({
        complete: true,
        fetchedCount: 2,
        requestCount: 5,
        details: expect.objectContaining({
          sourceCounts: {
            ruleDetections: 0,
            curatedDetections: 0,
            alertsView: 3,
          },
        }),
      });
      expect(checkByKey(result.checks, "read-alerts-view").status).toBe("pass");
      expect(result.warnings).toEqual([
        "Google limited the alerts view response for 2026-09-14T11:54:00.000Z to 2026-09-14T12:00:00.000Z, so it was split into smaller windows 1 time.",
      ]);
    },
  );

  test("a one-second window that is still truncated is reported unread, once", async () => {
    const twoSeconds: ConnectorFetchWindow = {
      startTime: new Date("2026-09-14T11:59:58.000Z"),
      endTime: new Date("2026-09-14T12:00:00.000Z"),
    };
    const fake: FakeClient = makeFakeClient({
      alerts: [fetched([detection("burst")], { truncatedByCount: true })],
    });

    const result: ConnectorFetchResult = await fetchWith(fake, {
      window: twoSeconds,
    });

    // The two-second window splits once; both one-second halves stay truncated.
    expect(fake.alertsCalls).toHaveLength(3);
    expect(result.complete).toBe(false);
    expect(result.warnings).toEqual([
      "Google still truncated a one-second window of the alerts view, so some alerts in it were not read.",
      "Google limited the alerts view response for 2026-09-14T11:59:58.000Z to 2026-09-14T12:00:00.000Z, so it was split into smaller windows 1 time.",
    ]);
    expect(checkByKey(result.checks, "read-alerts-view")).toMatchObject({
      status: "warn",
      message:
        "3 alerts returned by detection time. Google did not return part of the window.",
    });
  });

  test("an alerts-view stream that never completed leaves the window unread without splitting", async () => {
    const fake: FakeClient = makeFakeClient({
      alerts: [fetched([detection("partial")], { complete: false })],
    });

    const result: ConnectorFetchResult = await fetchWith(fake);

    expect(fake.alertsCalls).toHaveLength(1);
    expect(result.complete).toBe(false);
    expect(result.warnings).toEqual([
      "Google ended an alerts view response without confirming it was complete.",
    ]);
    expect(checkByKey(result.checks, "read-alerts-view")).toMatchObject({
      status: "warn",
      message:
        "1 alerts returned by detection time. Google did not return part of the window.",
    });
    // What arrived is still returned for import.
    expect(uidsOf(result)).toEqual(["partial"]);
  });

  test("a search page truncated by size leaves the window unread and says so once", async () => {
    const fake: FakeClient = makeFakeClient({
      rule: [
        page([detection("t1")], { truncated: true, nextPageToken: "more" }),
        page([detection("t2")], { truncated: true }),
      ],
      curated: [page([detection("c1")], { truncated: true })],
    });

    const result: ConnectorFetchResult = await fetchWith(fake);

    expect(result.complete).toBe(false);
    expect(uidsOf(result)).toEqual(["c1", "t1", "t2"]);
    expect(result.warnings).toEqual([
      "Google truncated a page of rule detections by size for 2026-09-14T11:54:00.000Z to 2026-09-14T12:00:00.000Z, so part of the window was not read.",
      "Google truncated a page of curated rule detections by size for 2026-09-14T11:54:00.000Z to 2026-09-14T12:00:00.000Z, so part of the window was not read.",
    ]);
    expect(checkByKey(result.checks, "read-rule-detections")).toMatchObject({
      status: "warn",
      message:
        "2 rule detections returned for the window by created time. Google did not return part of the window.",
    });
    expect(checkByKey(result.checks, "read-curated-detections").status).toBe(
      "warn",
    );
  });

  test("an alerts-view window read in several requests is still one pass check", async () => {
    const fake: FakeClient = makeFakeClient({
      alerts: [
        fetched([detection("a")], { truncatedByBytes: true }),
        fetched([detection("b")], { truncatedByBytes: true }),
        fetched([detection("c")]),
        fetched([detection("d")]),
      ],
    });

    const result: ConnectorFetchResult = await fetchWith(fake);

    expect(fake.alertsCalls).toHaveLength(5);
    expect(
      result.checks!.filter((check: SecurityConnectorCheck): boolean => {
        return check.key === "read-alerts-view";
      }),
    ).toHaveLength(1);
    expect(result.warnings).toEqual([
      "Google limited the alerts view response for 2026-09-14T11:54:00.000Z to 2026-09-14T12:00:00.000Z, so it was split into smaller windows 2 times.",
    ]);
  });
});

describe("GoogleSecOpsConnector.fetchEvents samples and creation lag", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a sample carries the rule name as title, both times and the alert state", async () => {
    const fake: FakeClient = makeFakeClient({
      rule: [
        page([
          detection("alerting"),
          detection("quiet", {
            detection: [
              {
                ruleName: "Quiet rule",
                alertState: "NOT_ALERTING",
                severity: "LOW",
              },
            ],
          }),
          detection("legacy-quiet", {
            detection: [{ ruleName: "Legacy", alertState: "NON_ALERTING" }],
          }),
          detection("boolean", {
            detection: [{ ruleName: "Boolean", alerting: true }],
          }),
          detection("unknown-state", {
            detection: [{ ruleName: "Unknown", alertState: "SOMETHING" }],
          }),
          {
            id: "snake",
            type: "RULE_DETECTION",
            detection_time: "2026-09-14T10:00:00.000Z",
            created_time: "2026-09-14T10:30:00.000Z",
            detection: [{ ruleName: "Snake rule", alert_state: "ALERTING" }],
          },
          {
            id: "telemetry",
            type: "TELEMETRY_ALERT",
            detectionTime: "2026-09-14T11:30:00.000Z",
          },
        ]),
      ],
    });

    const result: ConnectorFetchResult = await fetchWith(fake);
    const byId: Map<string, SecurityConnectorSample> = new Map(
      result.samples.map(
        (
          sample: SecurityConnectorSample,
        ): [string, SecurityConnectorSample] => {
          return [sample.id, sample];
        },
      ),
    );

    expect(byId.get("alerting")).toEqual({
      id: "alerting",
      title: "Rule for alerting",
      severity: "High",
      createdTime: "2026-09-14T11:02:00.000Z",
      eventTime: "2026-09-14T11:00:00.000Z",
      isAlert: true,
    });
    expect(byId.get("quiet")).toMatchObject({
      title: "Quiet rule",
      severity: "Low",
      isAlert: false,
    });
    expect(byId.get("legacy-quiet")!.isAlert).toBe(false);
    expect(byId.get("boolean")!.isAlert).toBe(true);
    expect(
      Object.prototype.hasOwnProperty.call(
        byId.get("unknown-state"),
        "isAlert",
      ),
    ).toBe(false);
    expect(byId.get("snake")).toMatchObject({
      title: "Snake rule",
      createdTime: "2026-09-14T10:30:00.000Z",
      eventTime: "2026-09-14T10:00:00.000Z",
      isAlert: true,
    });
    // A collection with no rule keeps the finding's message as its title.
    expect(byId.get("telemetry")).toMatchObject({
      title: "Google SecOps telemetry alert",
      eventTime: "2026-09-14T11:30:00.000Z",
    });
    expect(byId.get("telemetry")!.createdTime).toBeUndefined();
  });

  test.each([
    [25, 30, 25],
    [0, 5, 0],
    [2.9, 5, 2],
    [-1, 5, 0],
  ])(
    "a sampleLimit of %s over %s records keeps %s samples",
    async (sampleLimit: number, records: number, expected: number) => {
      const fake: FakeClient = makeFakeClient({
        rule: [
          page(
            Array.from(
              { length: records },
              (_value: unknown, index: number): JSONObject => {
                return detection(`d-${index}`);
              },
            ),
          ),
        ],
      });

      const result: ConnectorFetchResult = await fetchWith(fake, {
        options: { sampleLimit },
      });

      expect(result.events).toHaveLength(records);
      expect(result.samples).toHaveLength(expected);
    },
  );

  test("samples are redacted and never carry the source payload", async () => {
    const fake: FakeClient = makeFakeClient({
      rule: [
        page([
          detection(
            'leak {"private_key":"-----BEGIN PRIVATE KEY-----leaked-id"}',
            {
              private_key: "source-private-key",
              detection: [
                {
                  ruleName:
                    'Rule {"private_key":"-----BEGIN PRIVATE KEY-----leaked-title"}',
                },
              ],
            },
          ),
        ]),
      ],
    });

    const result: ConnectorFetchResult = await fetchWith(fake);

    expect(result.samples).toHaveLength(1);
    const text: string = JSON.stringify(result.samples);
    expect(text).not.toContain("leaked-id");
    expect(text).not.toContain("leaked-title");
    expect(text).not.toContain("source-private-key");
  });

  test("creation lag is measured over the union and a lag beyond the poll interval explains the created-time basis", async () => {
    const fake: FakeClient = makeFakeClient({
      rule: [
        page([
          detection("late", {
            detectionTime: "2026-09-14T08:00:00.000Z",
            createdTime: "2026-09-14T11:00:00.000Z",
          }),
          detection("prompt", {
            detectionTime: "2026-09-14T11:00:00.000Z",
            createdTime: "2026-09-14T11:02:00.000Z",
          }),
          detection("no-created", { createdTime: undefined }),
        ]),
      ],
      // The same late record again from the alerts view is measured once.
      alerts: [
        fetched([
          detection("late", {
            detectionTime: "2026-09-14T08:00:00.000Z",
            createdTime: "2026-09-14T11:00:00.000Z",
          }),
        ]),
      ],
    });

    const result: ConnectorFetchResult = await fetchWith(fake, {
      options: { pollIntervalInMinutes: 5 },
    });

    expect(result.details).toMatchObject({
      creationLag: { measured: 2, lateCount: 1, maxLagMinutes: 180 },
    });
    expect(result.warnings).toEqual([
      "1 of 2 detections were created more than 6 minutes after their detection time (up to 180 minutes). This is why the connector polls by created time: a cursor over detection time would already have moved past them.",
    ]);
    // Informational: the fetch is still complete.
    expect(result.complete).toBe(true);
  });

  const thresholds: Array<[number | undefined, number, boolean]> = [
    [undefined, 6, true],
    [0, 6, true],
    [5, 6, true],
    [30, 31, false],
    [-4, 2, true],
  ];

  test.each(thresholds)(
    "a pollIntervalInMinutes of %s gives a %s minute threshold (a 7 minute lag is late: %s)",
    async (
      pollIntervalInMinutes: number | undefined,
      threshold: number,
      late: boolean,
    ) => {
      const fake: FakeClient = makeFakeClient({
        rule: [
          page([
            detection("seven", {
              detectionTime: "2026-09-14T11:00:00.000Z",
              createdTime: "2026-09-14T11:07:00.000Z",
            }),
          ]),
        ],
      });

      const result: ConnectorFetchResult = await fetchWith(fake, {
        options: { pollIntervalInMinutes },
      });

      expect(result.details).toMatchObject({
        creationLag: { measured: 1, lateCount: late ? 1 : 0, maxLagMinutes: 7 },
      });
      expect(result.warnings).toEqual(
        late
          ? [
              `1 of 1 detections were created more than ${threshold} minutes after their detection time (up to 7 minutes). This is why the connector polls by created time: a cursor over detection time would already have moved past them.`,
            ]
          : [],
      );
    },
  );

  test("creation lag reads snake_case times, ignores unparseable ones and never goes negative", async () => {
    const fake: FakeClient = makeFakeClient({
      rule: [
        page([
          {
            id: "snake",
            type: "RULE_DETECTION",
            detection_time: "2026-09-14T11:00:00.000Z",
            created_time: "2026-09-14T11:01:00.000Z",
            detection: [{ ruleName: "Snake" }],
          },
          detection("garbage", { createdTime: "not a time" }),
          detection("created-before-detected", {
            detectionTime: "2026-09-14T11:05:00.000Z",
            createdTime: "2026-09-14T11:00:00.000Z",
          }),
        ]),
      ],
    });

    const result: ConnectorFetchResult = await fetchWith(fake);

    expect(result.details).toMatchObject({
      creationLag: { measured: 2, lateCount: 0, maxLagMinutes: 1 },
    });
    expect(result.warnings).toEqual([]);
  });

  test("an empty window measures nothing and returns empty diagnostics", async () => {
    const result: ConnectorFetchResult = await fetchWith(makeFakeClient({}));

    expect(result).toMatchObject({
      events: [],
      fetchedCount: 0,
      samples: [],
      complete: true,
      requestCount: 3,
    });
    expect(result.details).toEqual({
      basis: "created-time",
      sourceCounts: { ruleDetections: 0, curatedDetections: 0, alertsView: 0 },
      creationLag: { measured: 0, lateCount: 0, maxLagMinutes: 0 },
      includeNonAlertingDetections: false,
    });
  });

  test("the default connector builds a real client, so settings are the only input", async () => {
    // No fetch implementation and no factory: a real client over global fetch.
    const connector: GoogleSecOpsConnector = new GoogleSecOpsConnector();
    const error: unknown = await rejectionOf(
      connector.fetchEvents(
        secOpsSettings({ secrets: { serviceAccountJson: "{" } }),
        WINDOW,
        fetchOptions(),
      ),
    );

    expect((error as Error).message).toBe(
      "Service account JSON is not valid JSON.",
    );
  });
});
