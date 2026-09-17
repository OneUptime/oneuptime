import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { CuratedRuleDetectionCount } from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import {
  GOOGLE_SECOPS_ALERTS_VIEW_REQUEST_BUDGET,
  GOOGLE_SECOPS_CURATED_REQUEST_BUDGET,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsConnector";
import {
  ConnectorFetchOptions,
  ConnectorFetchResult,
  ConnectorFetchWindow,
  readConnectorChecks,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import APIException from "../../../../../../Types/Exception/ApiException";
import { JSONObject } from "../../../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  AlertsCall,
  CountCall,
  FakeClient,
  SearchCall,
  checkByKey,
  connectorWith,
  detection,
  fetchOptions,
  fetched,
  makeFakeClient,
  page,
  rejectionOf,
  secOpsSettings,
  statusesOf,
} from "./GoogleSecOpsConnectorFixtures";

/*
 * The two reads that decide whether a Google SecOps tenant's alerts reach
 * OneUptime at all, pinned against a scripted client.
 *
 * Curated rule detections. legacySearchCuratedDetections documents no
 * wildcard, and the connector used to send ruleId=- to it. Google answers
 * that with an empty HTTP 200, so the pass reported "0 curated rule
 * detections" on every poll of a tenant whose alerts all came from curated
 * rule sets. The pass now asks countAllCuratedRuleSetDetections which
 * curated rules fired and searches each one by id.
 *
 * Late alerts. The alerts view filters on detection time only, and a
 * scheduled poll used to read it over its own few minutes, so an alert
 * Google made readable more than one poll after its detection time was
 * never seen. A scheduled poll now also sweeps the day before its window,
 * alerts only, best effort.
 */

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

// The customer's poll: a caught-up connection reading a few minutes.
const WINDOW: ConnectorFetchWindow = {
  startTime: new Date("2026-09-15T12:47:15.762Z"),
  endTime: new Date("2026-09-15T12:51:55.794Z"),
};
const DAY_WINDOW: ConnectorFetchWindow = {
  startTime: new Date("2026-09-14T12:51:55.794Z"),
  endTime: new Date("2026-09-15T12:51:55.794Z"),
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

function curatedCalls(fake: FakeClient): Array<SearchCall> {
  return fake.searchCalls.filter((call: SearchCall): boolean => {
    return call.curated === true;
  });
}

function rules(...ids: Array<string>): Array<CuratedRuleDetectionCount> {
  return ids.map((ruleId: string): CuratedRuleDetectionCount => {
    return { ruleId, count: 1 };
  });
}

function httpError(prefix: string, status: number): APIException {
  return new APIException(`${prefix} failed (HTTP ${status}): {"error":{}}`);
}

// A SOAR alert: only the alerts view knows it.
function soarAlert(
  id: string,
  detectionTime: string,
  createdTime: string,
): JSONObject {
  return {
    id,
    type: "SOAR_ALERT",
    detectionTime,
    createdTime,
    soarAlertMetadata: { sourceRule: `SOAR rule ${id}` },
  };
}

describe("GoogleSecOpsConnector curated rule detections", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("regression: the curated search never goes out without a real curated rule id", async () => {
    const fake: FakeClient = makeFakeClient({
      counts: [rules("ur_alpha", "ur_beta")],
      curated: [
        (call: SearchCall) => {
          return page([detection(`curated-${call.ruleId}`)]);
        },
      ],
    });

    const result: ConnectorFetchResult = await fetchWith(fake);

    expect(
      curatedCalls(fake).map((call: SearchCall): string | undefined => {
        return call.ruleId;
      }),
    ).toEqual(["ur_alpha", "ur_beta"]);
    for (const call of curatedCalls(fake)) {
      expect(call.ruleId).not.toBe("-");
    }
    expect(uidsOf(result)).toEqual(["curated-ur_alpha", "curated-ur_beta"]);
    expect(result.details).toMatchObject({
      sourceCounts: { curatedDetections: 2 },
      curatedRulesWithDetections: 2,
    });
    expect(checkByKey(result.checks, "read-curated-detections")).toMatchObject({
      status: "pass",
      message:
        "2 curated rule detections returned for the window by created time (2 of 2 curated rules with recent detections searched).",
    });
  });

  test("counts curated rules from a week before the window to its end, and searches each over the window itself", async () => {
    const fake: FakeClient = makeFakeClient({ counts: [rules("ur_alpha")] });

    await fetchWith(fake);

    expect(fake.countCalls).toEqual([
      {
        startTime: new Date(WINDOW.startTime.getTime() - 7 * DAY_MS),
        endTime: WINDOW.endTime,
      },
    ] as Array<CountCall>);
    expect(curatedCalls(fake)).toEqual([
      {
        startTime: WINDOW.startTime,
        endTime: WINDOW.endTime,
        listBasis: "CREATED_TIME",
        alertingOnly: true,
        pageSize: 1000,
        pageToken: undefined,
        curated: true,
        ruleId: "ur_alpha",
      },
    ]);
  });

  test("a preview searches every counted curated rule by created and by detection time", async () => {
    const fake: FakeClient = makeFakeClient({
      counts: [rules("ur_alpha", "ur_beta")],
    });

    await fetchWith(fake, {
      window: DAY_WINDOW,
      options: { purpose: "preview" },
    });

    expect(
      curatedCalls(fake).map((call: SearchCall): string => {
        return `${call.ruleId}:${call.listBasis}`;
      }),
    ).toEqual([
      "ur_alpha:CREATED_TIME",
      "ur_alpha:DETECTION_TIME",
      "ur_beta:CREATED_TIME",
      "ur_beta:DETECTION_TIME",
    ]);
    expect(fake.countCalls[0]).toEqual({
      startTime: new Date(DAY_WINDOW.startTime.getTime() - 7 * DAY_MS),
      endTime: DAY_WINDOW.endTime,
    });
  });

  test("follows each curated rule's own pages before moving to the next rule", async () => {
    const fake: FakeClient = makeFakeClient({
      counts: [rules("ur_alpha", "ur_beta")],
      curated: [
        (call: SearchCall) => {
          if (call.ruleId === "ur_alpha" && !call.pageToken) {
            return page([detection("a1")], { nextPageToken: "p2" });
          }

          return page([detection(`${call.ruleId}-${call.pageToken || "p1"}`)]);
        },
      ],
    });

    const result: ConnectorFetchResult = await fetchWith(fake);

    expect(
      curatedCalls(fake).map((call: SearchCall): string => {
        return `${call.ruleId}:${call.pageToken || ""}`;
      }),
    ).toEqual(["ur_alpha:", "ur_alpha:p2", "ur_beta:"]);
    expect(uidsOf(result)).toEqual(["a1", "ur_alpha-p2", "ur_beta-p1"]);
  });

  test("no curated rule fired: the count is the only curated request and the pass still passes", async () => {
    const fake: FakeClient = makeFakeClient({ counts: [[]] });

    const result: ConnectorFetchResult = await fetchWith(fake);

    expect(curatedCalls(fake)).toEqual([]);
    expect(fake.countCalls).toHaveLength(1);
    expect(checkByKey(result.checks, "read-curated-detections")).toMatchObject({
      status: "pass",
      message:
        "0 curated rule detections returned for the window by created time (0 of 0 curated rules with recent detections searched).",
    });
    expect(result.complete).toBe(true);
    expect(result.details).toMatchObject({ curatedRulesWithDetections: 0 });
  });

  test.each([400, 403, 404])(
    "curated counts answering HTTP %s degrade the pass to a warning and the other passes still import",
    async (status: number) => {
      const fake: FakeClient = makeFakeClient({
        counts: [
          httpError("Google SecOps curated rule detection counts", status),
        ],
        rule: [page([detection("rule-1")])],
        alerts: [fetched([detection("alert-1")])],
      });

      const result: ConnectorFetchResult = await fetchWith(fake);

      expect(curatedCalls(fake)).toEqual([]);
      expect(uidsOf(result)).toEqual(["alert-1", "rule-1"]);
      expect(checkByKey(result.checks, "read-curated-detections").status).toBe(
        "warn",
      );
      expect(result.warnings).toContain(
        `Curated rule detections could not be read (HTTP ${status}); this tenant may not have curated rule access. Rule detections and the alerts view were still read.`,
      );
      expect(result.complete).toBe(true);
    },
  );

  test.each([401, 429, 500, 503])(
    "curated counts answering HTTP %s fail the fetch under the curated pass's name",
    async (status: number) => {
      const original: APIException = httpError(
        "Google SecOps curated rule detection counts",
        status,
      );
      const fake: FakeClient = makeFakeClient({ counts: [original] });

      const error: unknown = await rejectionOf(fetchWith(fake));

      expect(error).toBe(original);
      expect(statusesOf(readConnectorChecks(error))).toEqual([
        "read-rule-detections:pass",
        "read-curated-detections:fail",
      ]);
    },
  );

  test("one curated rule the search cannot find is a warning and the remaining curated rules are still read", async () => {
    const fake: FakeClient = makeFakeClient({
      counts: [rules("ur_alpha", "ur_gone", "ur_omega")],
      curated: [
        (call: SearchCall) => {
          if (call.ruleId === "ur_gone") {
            throw httpError("Google SecOps detections search", 404);
          }

          return page([detection(`curated-${call.ruleId}`)]);
        },
      ],
    });

    const result: ConnectorFetchResult = await fetchWith(fake);

    expect(uidsOf(result)).toEqual(["curated-ur_alpha", "curated-ur_omega"]);
    expect(result.warnings).toContain(
      "Detections of curated rule ur_gone could not be read (HTTP 404); the other curated rules were still read.",
    );
    // Skipped detections are never a green check, but they do not hold the cursor.
    expect(checkByKey(result.checks, "read-curated-detections")).toMatchObject({
      status: "warn",
      message:
        "2 curated rule detections returned for the window by created time (3 of 3 curated rules with recent detections searched, 1 could not be read). Google did not return part of the window.",
    });
    expect(result.complete).toBe(true);
  });

  test("a curated rule search failing with HTTP 500 fails the fetch rather than skipping the rule", async () => {
    const original: APIException = httpError(
      "Google SecOps detections search",
      500,
    );
    const fake: FakeClient = makeFakeClient({
      counts: [rules("ur_alpha", "ur_beta")],
      curated: [original],
    });

    const error: unknown = await rejectionOf(fetchWith(fake));

    expect(error).toBe(original);
    expect(curatedCalls(fake)).toHaveLength(1);
  });

  /*
   * Review finding: the number of active curated rules does not shrink with
   * the window, so a curated pass that runs out between rules must not mark
   * the fetch incomplete. The poller would halve the window down to one
   * minute and then force-advance a minute per poll for good.
   */
  test("more active curated rules than the curated budget is a warning between rules, and the fetch stays complete", async () => {
    const ruleCount: number = GOOGLE_SECOPS_CURATED_REQUEST_BUDGET + 50;
    const ruleIds: Array<string> = Array.from(
      { length: ruleCount },
      (_value: unknown, index: number): string => {
        return `ur_rule_${String(index).padStart(3, "0")}`;
      },
    );
    const fake: FakeClient = makeFakeClient({
      counts: [rules(...ruleIds)],
      rule: [page([detection("rule")])],
    });

    const result: ConnectorFetchResult = await fetchWith(fake);

    const searched: number = GOOGLE_SECOPS_CURATED_REQUEST_BUDGET - 1;
    const notStarted: number = ruleCount - searched;
    // One request of the curated budget went to the count.
    expect(curatedCalls(fake)).toHaveLength(searched);
    expect(result.complete).toBe(true);
    expect(checkByKey(result.checks, "read-curated-detections")).toMatchObject({
      status: "warn",
      message: `0 curated rule detections returned for the window by created time (${searched} of ${ruleCount} curated rules with recent detections searched). The pass was stopped by the request budget after ${GOOGLE_SECOPS_CURATED_REQUEST_BUDGET} requests.`,
    });
    expect(result.warnings).toContain(
      `${notStarted} of ${ruleCount} curated rules with recent detections were not searched in this poll because the curated pass reached the request budget; their detections created in this window were not imported. The rules with the most detections were searched first.`,
    );
    // The rule pass and the alerts view still read.
    expect(
      fake.searchCalls.filter((call: SearchCall): boolean => {
        return call.curated !== true;
      }),
    ).toHaveLength(1);
    expect(fake.alertsCalls.length).toBeGreaterThan(0);
    expect(uidsOf(result)).toEqual(["rule"]);
  });

  test("searches the curated rules with the most detections first", async () => {
    const fake: FakeClient = makeFakeClient({
      counts: [
        [
          { ruleId: "ur_a_quiet", count: 1 },
          { ruleId: "ur_b_busy", count: 50 },
          { ruleId: "ur_c_mid", count: 7 },
          { ruleId: "ur_d_mid", count: 7 },
        ],
      ],
    });

    await fetchWith(fake);

    expect(
      curatedCalls(fake).map((call: SearchCall): string | undefined => {
        return call.ruleId;
      }),
    ).toEqual(["ur_b_busy", "ur_c_mid", "ur_d_mid", "ur_a_quiet"]);
  });

  test("the curated pass starts no further curated rule once most of the poll's time is spent, so the alerts view still runs", async () => {
    let nowMs: number = Date.parse("2026-09-15T12:52:00.000Z");
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return nowMs;
    });
    const fake: FakeClient = makeFakeClient({
      counts: [rules("ur_one", "ur_two", "ur_three")],
      curated: [
        (call: SearchCall) => {
          // Each curated search takes 70% of a one second poll budget.
          nowMs += 700;
          return page([detection(`curated-${call.ruleId}`)]);
        },
      ],
      alerts: [fetched([detection("alert")])],
    });

    const result: ConnectorFetchResult = await fetchWith(fake, {
      options: { maxDurationMs: 1000 },
    });

    expect(
      curatedCalls(fake).map((call: SearchCall): string | undefined => {
        return call.ruleId;
      }),
    ).toEqual(["ur_one"]);
    expect(result.warnings).toContain(
      "2 of 3 curated rules with recent detections were not searched in this poll because the curated pass reached the poll time budget; their detections created in this window were not imported. The rules with the most detections were searched first.",
    );
    // The window's alerts view read still ran and the fetch is complete.
    expect(fake.alertsCalls[0]).toMatchObject({
      startTime: WINDOW.startTime,
      endTime: WINDOW.endTime,
    });
    expect(uidsOf(result)).toContain("alert");
    expect(uidsOf(result)).toContain("curated-ur_one");
    expect(checkByKey(result.checks, "read-alerts-view").status).toBe("pass");
    expect(result.complete).toBe(true);
  });

  test("a curated rule whose own pages exhaust the curated budget still makes the fetch incomplete, since a shorter window has fewer pages", async () => {
    const fake: FakeClient = makeFakeClient({
      counts: [rules("ur_noisy")],
      curated: [page([detection("noisy")], { nextPageToken: "again" })],
    });

    const result: ConnectorFetchResult = await fetchWith(fake);

    expect(curatedCalls(fake)).toHaveLength(
      GOOGLE_SECOPS_CURATED_REQUEST_BUDGET - 1,
    );
    expect(result.complete).toBe(false);
    expect(checkByKey(result.checks, "read-curated-detections").status).toBe(
      "warn",
    );
  });
});

describe("GoogleSecOpsConnector late-alert sweep", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a scheduled poll sweeps the alerts view over the day before its window, alerts only", async () => {
    const fake: FakeClient = makeFakeClient({});

    const result: ConnectorFetchResult = await fetchWith(fake, {
      alertingOnly: false,
    });

    expect(fake.alertsCalls).toEqual([
      {
        startTime: WINDOW.startTime,
        endTime: WINDOW.endTime,
        maxAlerts: 1000,
        includeNonAlertingDetections: true,
      },
      {
        startTime: new Date(WINDOW.endTime.getTime() - DAY_MS),
        endTime: WINDOW.startTime,
        maxAlerts: 1000,
        includeNonAlertingDetections: false,
      },
    ] as Array<AlertsCall>);
    expect(statusesOf(result.checks)).toEqual([
      "read-rule-detections:pass",
      "read-curated-detections:pass",
      "read-alerts-view:pass",
      "read-late-alerts-view:pass",
    ]);
    expect(checkByKey(result.checks, "read-late-alerts-view")).toMatchObject({
      name: "Read late alerts by detection time",
      message:
        "0 alerts returned with a detection time from 2026-09-14T12:51:55.794Z to 2026-09-15T12:47:15.762Z, before the window, so alerts Google made readable after their detection time are imported.",
    });
    expect(result.details).toMatchObject({
      sourceCounts: { alertsView: 0, lateAlertsView: 0 },
    });
  });

  test("regression: an alert readable only after the poll that covered its detection time is imported by a later poll", async () => {
    // Detected three hours ago, made readable a minute ago.
    const lateAlert: JSONObject = soarAlert(
      "soar-late",
      "2026-09-15T09:50:00.000Z",
      "2026-09-15T12:50:55.000Z",
    );
    const fake: FakeClient = makeFakeClient({
      counts: [[]],
      alerts: [
        (call: AlertsCall) => {
          const detectedMs: number = Date.parse(
            String(lateAlert["detectionTime"]),
          );
          const inWindow: boolean =
            detectedMs >= call.startTime.getTime() &&
            detectedMs < call.endTime.getTime();

          return fetched(inWindow ? [lateAlert] : []);
        },
      ],
    });

    const result: ConnectorFetchResult = await fetchWith(fake);

    expect(uidsOf(result)).toEqual(["soar-late"]);
    expect(result.complete).toBe(true);
    expect(result.details).toMatchObject({
      sourceCounts: { alertsView: 0, lateAlertsView: 1 },
    });
    // A sweep-only record does not count as a late-created detection.
    expect(result.details).toMatchObject({
      creationLag: { measured: 0, lateCount: 0, maxLagMinutes: 0 },
    });
    expect(result.warnings).toEqual([]);
  });

  test("a first poll, whose window already reaches back a day, does not sweep", async () => {
    const fake: FakeClient = makeFakeClient({});

    const result: ConnectorFetchResult = await fetchWith(fake, {
      window: DAY_WINDOW,
    });

    expect(fake.alertsCalls).toHaveLength(1);
    expect(
      result.checks!.some((check: { key: string }): boolean => {
        return check.key === "read-late-alerts-view";
      }),
    ).toBe(false);
    expect(
      (result.details as JSONObject)["sourceCounts"] as JSONObject,
    ).not.toHaveProperty("lateAlertsView");
  });

  test.each(["preview", "backfill"] as const)(
    "a %s reads exactly the range a person picked and does not sweep",
    async (purpose: "preview" | "backfill") => {
      const fake: FakeClient = makeFakeClient({});

      await fetchWith(fake, { options: { purpose } });

      expect(fake.alertsCalls).toEqual([
        {
          startTime: WINDOW.startTime,
          endTime: WINDOW.endTime,
          maxAlerts: 1000,
          includeNonAlertingDetections: false,
        },
      ] as Array<AlertsCall>);
    },
  );

  test.each([
    ["an HTTP 500", httpError("Google SecOps alerts fetch", 500)],
    [
      "a timeout",
      new APIException(
        "Google SecOps alerts fetch timed out after 60 seconds with no response.",
      ),
    ],
  ])(
    "a sweep failing with %s is a warning; the poll keeps what it read and stays complete",
    async (_label: string, failure: APIException) => {
      const fake: FakeClient = makeFakeClient({
        rule: [page([detection("rule-1")])],
        alerts: [fetched([detection("alert-1")]), failure],
      });

      const result: ConnectorFetchResult = await fetchWith(fake);

      expect(uidsOf(result)).toEqual(["alert-1", "rule-1"]);
      expect(result.complete).toBe(true);
      expect(checkByKey(result.checks, "read-late-alerts-view")).toMatchObject({
        status: "warn",
        message: failure.message,
      });
      expect(result.warnings).toEqual([
        `The late-alert sweep of the alerts view could not be read, so alerts Google made readable more than one poll after their detection time may be missing from this poll: ${failure.message}`,
      ]);
    },
  );

  test("a sweep Google keeps truncating splits newest first until its budget is spent, without making the poll incomplete", async () => {
    const fake: FakeClient = makeFakeClient({
      alerts: [
        fetched([]),
        (call: AlertsCall) => {
          return fetched([detection(`late-${call.endTime.toISOString()}`)], {
            baselineAlertsCount: 5000,
            filteredAlertsCount: 5000,
            truncatedByCount: true,
          });
        },
      ],
    });

    const result: ConnectorFetchResult = await fetchWith(fake);

    const sweepCalls: Array<AlertsCall> = fake.alertsCalls.slice(1);
    expect(sweepCalls).toHaveLength(
      GOOGLE_SECOPS_ALERTS_VIEW_REQUEST_BUDGET - 1,
    );
    // After the first split the newer half is read before the older one.
    expect(sweepCalls[1]!.endTime).toEqual(WINDOW.startTime);
    expect(sweepCalls[1]!.startTime.getTime()).toBeGreaterThan(
      sweepCalls[0]!.startTime.getTime(),
    );
    expect(result.complete).toBe(true);
    expect(checkByKey(result.checks, "read-late-alerts-view").status).toBe(
      "warn",
    );
    expect(result.warnings).toContain(
      `Read late alerts by detection time was stopped by the request budget after ${GOOGLE_SECOPS_ALERTS_VIEW_REQUEST_BUDGET - 1} requests.`,
    );
  });

  test("the sweep cannot hide a truncated poll window: that read still makes the poll incomplete", async () => {
    const fake: FakeClient = makeFakeClient({
      alerts: [
        fetched([detection("window")], {
          baselineAlertsCount: 2,
          filteredAlertsCount: 2,
        }),
      ],
    });

    const result: ConnectorFetchResult = await fetchWith(fake, {
      window: {
        startTime: WINDOW.startTime,
        endTime: new Date(WINDOW.startTime.getTime() + 1000),
      },
    });

    expect(result.complete).toBe(false);
    expect(checkByKey(result.checks, "read-alerts-view").status).toBe("warn");
  });

  test("a record the sweep and a created-time pass both return is measured for creation lag once, as the pass's", async () => {
    const late: JSONObject = detection("shared", {
      detectionTime: "2026-09-15T09:00:00.000Z",
      createdTime: "2026-09-15T12:49:00.000Z",
    });
    const fake: FakeClient = makeFakeClient({
      counts: [[]],
      rule: [page([late])],
      alerts: [fetched([]), fetched([late])],
    });

    const result: ConnectorFetchResult = await fetchWith(fake);

    expect(uidsOf(result)).toEqual(["shared"]);
    expect(result.details).toMatchObject({
      creationLag: { measured: 1, lateCount: 1 },
    });
  });
});
