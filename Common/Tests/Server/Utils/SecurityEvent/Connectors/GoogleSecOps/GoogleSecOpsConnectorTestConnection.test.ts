import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import GoogleSecOpsClient, {
  FetchAlertsResult,
  SearchDetectionsResult,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import GoogleSecOpsConnector from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsConnector";
import { ConnectorTestResult } from "../../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import OneUptimeDate from "../../../../../../Types/Date";
import APIException from "../../../../../../Types/Exception/ApiException";
import { JSONObject } from "../../../../../../Types/JSON";
import { SecurityConnectorCheck } from "../../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { getJestSpyOn } from "../../../../../Spy";
import {
  ClientFactoryCall,
  ConnectorHarness,
  checkByKey,
  connectorWith,
  poisonDetection,
  secOpsSettings,
  statusesOf,
} from "./GoogleSecOpsConnectorFixtures";

/*
 * GoogleSecOpsConnector.testConnection: the provider half of "Test
 * connection", ported from the retired GoogleSecOpsConnectionTester. It
 * answers "connected, but nothing ingests" as checks: can Google be
 * reached, can each of the three poll passes read, and is there anything to
 * import under the saved Data to import selection AND under the other one.
 * These tests pin the check keys, order, wording and gating, the both-scope
 * availability probe and its counts, the curated-rule degradation, the
 * samples, redaction, the queued-test skip, and that it never throws.
 * Configuration, platform and schedule checks belong to the shared tester.
 */

const NOW: Date = new Date("2026-09-14T12:00:00.000Z");
const DAY_MS: number = 24 * 60 * 60 * 1000;

interface SearchCall {
  startTime: Date;
  endTime: Date;
  listBasis: string;
  alertingOnly: boolean;
  pageSize?: number | undefined;
  curated?: boolean | undefined;
}

interface AlertsCall {
  startTime: Date;
  endTime: Date;
  maxAlerts?: number | undefined;
  includeNonAlertingDetections?: boolean | undefined;
}

/*
 * Availability per scope and range, so a test can say "alerts only has
 * nothing anywhere, alerts and detections has three rule detections in the
 * last week".
 */
interface ScopeFixture {
  alerts24h?: number | undefined;
  alerts7d?: number | undefined;
  rules24h?: Array<JSONObject> | undefined;
  rules7d?: Array<JSONObject> | undefined;
  rules7dHasMore?: boolean | undefined;
  rules7dTruncated?: boolean | undefined;
}

interface Fixture {
  alertsOnly?: ScopeFixture | undefined;
  alertsAndDetections?: ScopeFixture | undefined;
  authError?: Error | undefined;
  ruleError?: Error | undefined;
  curatedError?: Error | undefined;
  alertsError?: Error | undefined;
  // Fails the availability probes only (week-long reads).
  weekError?: Error | undefined;
  alertsIncomplete?: boolean | undefined;
  ruleProbeRecord?: JSONObject | undefined;
  alertsResult?: ((call: AlertsCall) => FetchAlertsResult) | undefined;
}

interface FakeClient {
  client: GoogleSecOpsClient;
  searchCalls: Array<SearchCall>;
  alertsCalls: Array<AlertsCall>;
  authCalls: Array<string>;
}

function detection(id: string): JSONObject {
  return {
    id,
    type: "RULE_DETECTION",
    createdTime: "2026-09-14T11:02:00.000Z",
    detectionTime: "2026-09-14T11:00:00.000Z",
    detection: [{ ruleName: `Rule ${id}`, severity: "HIGH" }],
  };
}

function isWeek(call: { startTime: Date; endTime: Date }): boolean {
  return call.endTime.getTime() - call.startTime.getTime() > 2 * DAY_MS;
}

function makeClient(fixture: Fixture): FakeClient {
  const searchCalls: Array<SearchCall> = [];
  const alertsCalls: Array<AlertsCall> = [];
  const authCalls: Array<string> = [];

  const scopeOf: (alertingOnly: boolean) => ScopeFixture = (
    alertingOnly: boolean,
  ): ScopeFixture => {
    return (
      (alertingOnly ? fixture.alertsOnly : fixture.alertsAndDetections) || {}
    );
  };

  const client: GoogleSecOpsClient = {
    testAuthentication: async (): Promise<void> => {
      authCalls.push("auth");
      if (fixture.authError) {
        throw fixture.authError;
      }
    },
    searchDetections: async (
      call: SearchCall,
    ): Promise<SearchDetectionsResult> => {
      searchCalls.push(call);
      if (isWeek(call) && fixture.weekError) {
        throw fixture.weekError;
      }
      if (call.curated) {
        if (fixture.curatedError) {
          throw fixture.curatedError;
        }
        return { detections: [], nextPageToken: null, truncated: false };
      }
      if (fixture.ruleError) {
        throw fixture.ruleError;
      }
      if (call.pageSize === 1) {
        return {
          detections: [fixture.ruleProbeRecord || detection("probe")],
          nextPageToken: null,
          truncated: false,
        };
      }
      const scope: ScopeFixture = scopeOf(call.alertingOnly);
      const detections: Array<JSONObject> = isWeek(call)
        ? scope.rules7d || []
        : scope.rules24h || [];
      return {
        detections: detections.slice(0, call.pageSize || 1000),
        nextPageToken: isWeek(call) && scope.rules7dHasMore ? "more" : null,
        truncated: isWeek(call) && scope.rules7dTruncated === true,
      };
    },
    fetchDetectionAlerts: async (
      call: AlertsCall,
    ): Promise<FetchAlertsResult> => {
      alertsCalls.push(call);
      if (isWeek(call) && fixture.weekError) {
        throw fixture.weekError;
      }
      if (fixture.alertsError) {
        throw fixture.alertsError;
      }
      if (fixture.alertsResult) {
        return fixture.alertsResult(call);
      }
      const scope: ScopeFixture = scopeOf(
        call.includeNonAlertingDetections !== true,
      );
      const count: number = isWeek(call)
        ? scope.alerts7d || 0
        : scope.alerts24h || 0;
      return {
        alerts: count > 0 ? [detection("alerts-view-sample")] : [],
        complete: fixture.alertsIncomplete !== true,
        progress: 1,
        truncatedByCount: false,
        truncatedByBytes: false,
        baselineAlertsCount: count,
        filteredAlertsCount: count,
        chunkCount: 1,
      };
    },
  } as unknown as GoogleSecOpsClient;

  return { client, searchCalls, alertsCalls, authCalls };
}

async function runTest(
  fake: FakeClient,
  options: {
    alertingOnly?: boolean | undefined;
    skipAvailability?: boolean | undefined;
    requestTimeoutInMs?: number | undefined;
  } = {},
): Promise<ConnectorTestResult> {
  const harness: ConnectorHarness = connectorWith(fake.client);
  return harness.connector.testConnection(
    secOpsSettings({ alertingOnly: options.alertingOnly }),
    {
      requestTimeoutInMs: options.requestTimeoutInMs || 20000,
      ...(options.skipAvailability !== undefined
        ? { skipAvailability: options.skipAvailability }
        : {}),
    },
  );
}

function keysOf(result: ConnectorTestResult): Array<string> {
  return result.checks.map((check: SecurityConnectorCheck): string => {
    return check.key;
  });
}

describe("GoogleSecOpsConnector.testConnection", () => {
  beforeEach(() => {
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a healthy tenant passes every provider check in order and returns counts and samples", async () => {
    const fake: FakeClient = makeClient({
      alertsOnly: {
        alerts24h: 3,
        alerts7d: 12,
        rules24h: [detection("r1"), detection("r2")],
        rules7d: [detection("r1"), detection("r2"), detection("r3")],
      },
      ruleProbeRecord: detection("r1"),
    });

    const result: ConnectorTestResult = await runTest(fake);

    expect(Array.isArray(result)).toBe(false);
    expect(statusesOf(result.checks)).toEqual([
      "authentication:pass",
      "rule-detections-read:pass",
      "curated-detections-read:pass",
      "alerts-view-read:pass",
      "detections-available:pass",
    ]);
    expect(
      result.checks.map((check: SecurityConnectorCheck): string => {
        return check.name;
      }),
    ).toEqual([
      "Authenticate with Google",
      "Read rule detections",
      "Read curated rule detections",
      "Read the alerts view",
      "Detections available to import",
    ]);
    expect(checkByKey(result.checks, "authentication").message).toBe(
      "Google accepted the service account credentials.",
    );
    expect(checkByKey(result.checks, "rule-detections-read")).toMatchObject({
      message:
        "Rule detections can be read by created time (1 returned for a one-record probe over the last 24 hours).",
      details: { returned: 1 },
    });
    expect(checkByKey(result.checks, "curated-detections-read")).toMatchObject({
      message:
        "Curated rule detections can be read by created time (0 returned for a one-record probe over the last 24 hours).",
      details: { returned: 0 },
    });
    expect(checkByKey(result.checks, "alerts-view-read")).toMatchObject({
      message:
        "The alerts view can be read by detection time (3 matched in the last 24 hours).",
      details: { baselineAlertsCount: 3, complete: true },
    });

    const counts: JSONObject = {
      scope: "alerts-only",
      alertsViewLast24h: 3,
      alertsViewLast7d: 12,
      ruleDetectionsCreatedLast24h: "2",
      ruleDetectionsCreatedLast7d: "3",
      hasMoreLast7d: false,
      otherScope: {
        scope: "alerts-and-detections",
        alertsViewLast24h: 0,
        alertsViewLast7d: 0,
        ruleDetectionsCreatedLast24h: "0",
        ruleDetectionsCreatedLast7d: "0",
        hasMoreLast7d: false,
      },
    };
    expect(result.counts).toEqual(counts);
    expect(checkByKey(result.checks, "detections-available")).toMatchObject({
      message:
        "With the saved Data to import (Alerts only): last 24 hours 2 rule detections created and 3 alerts in the alerts view; last 7 days 3 and 12.",
      details: counts,
    });
    expect(
      checkByKey(result.checks, "detections-available").remediation,
    ).toBeUndefined();

    expect(result.samples).toEqual([
      {
        id: "r1",
        title: "Rule r1",
        severity: "High",
        createdTime: "2026-09-14T11:02:00.000Z",
        eventTime: "2026-09-14T11:00:00.000Z",
      },
      {
        id: "alerts-view-sample",
        title: "Rule alerts-view-sample",
        severity: "High",
        createdTime: "2026-09-14T11:02:00.000Z",
        eventTime: "2026-09-14T11:00:00.000Z",
      },
    ]);
    expect(fake.authCalls).toEqual(["auth"]);
  });

  test("the read probes ask for one record each over the last 24 hours by created time", async () => {
    const fake: FakeClient = makeClient({});

    await runTest(fake);

    const [rule, curated] = fake.searchCalls;
    expect(rule).toMatchObject({
      listBasis: "CREATED_TIME",
      alertingOnly: true,
      pageSize: 1,
      curated: false,
    });
    expect(rule!.startTime.toISOString()).toBe("2026-09-13T12:00:00.000Z");
    expect(rule!.endTime).toEqual(NOW);
    expect(curated).toMatchObject({
      listBasis: "CREATED_TIME",
      alertingOnly: true,
      pageSize: 1,
      curated: true,
    });
    expect(curated!.startTime.toISOString()).toBe("2026-09-13T12:00:00.000Z");
    expect(fake.alertsCalls[0]).toMatchObject({
      maxAlerts: 1,
      includeNonAlertingDetections: false,
    });
    expect(fake.alertsCalls[0]!.startTime.toISOString()).toBe(
      "2026-09-13T12:00:00.000Z",
    );
    expect(fake.alertsCalls[0]!.endTime).toEqual(NOW);
  });

  test("availability is probed under BOTH scopes over 24 hours and 7 days, one page each", async () => {
    const fake: FakeClient = makeClient({});

    await runTest(fake);

    // Three read probes (2 searches, 1 alerts view) plus 4 probes per scope.
    const availabilitySearches: Array<SearchCall> = fake.searchCalls.slice(2);
    const availabilityAlerts: Array<AlertsCall> = fake.alertsCalls.slice(1);
    expect(availabilitySearches).toHaveLength(4);
    expect(availabilityAlerts).toHaveLength(4);
    expect(
      availabilitySearches.map((call: SearchCall): string => {
        return `${call.alertingOnly ? "alerts-only" : "both"}:${isWeek(call) ? "7d" : "24h"}:${call.pageSize}:${call.curated === true}`;
      }),
    ).toEqual([
      "alerts-only:24h:1000:false",
      "alerts-only:7d:1000:false",
      "both:24h:1000:false",
      "both:7d:1000:false",
    ]);
    expect(
      availabilityAlerts.map((call: AlertsCall): string => {
        return `${call.includeNonAlertingDetections ? "both" : "alerts-only"}:${isWeek(call) ? "7d" : "24h"}:${call.maxAlerts}`;
      }),
    ).toEqual([
      "alerts-only:24h:1",
      "alerts-only:7d:1",
      "both:24h:1",
      "both:7d:1",
    ]);
    for (const call of availabilitySearches) {
      expect(call.listBasis).toBe("CREATED_TIME");
      expect(call.endTime).toEqual(NOW);
      expect([
        "2026-09-13T12:00:00.000Z",
        "2026-09-07T12:00:00.000Z",
      ]).toContain(call.startTime.toISOString());
    }
  });

  test("Detections selected reads both alert states everywhere and names that selection", async () => {
    const fake: FakeClient = makeClient({
      alertsAndDetections: { alerts24h: 2, alerts7d: 4 },
    });

    const result: ConnectorTestResult = await runTest(fake, {
      alertingOnly: false,
    });

    expect(fake.searchCalls[0]!.alertingOnly).toBe(false);
    expect(fake.searchCalls[1]!.alertingOnly).toBe(false);
    expect(fake.alertsCalls[0]!.includeNonAlertingDetections).toBe(true);
    // The saved scope is probed first, then the other one.
    expect(
      fake.searchCalls.slice(2).map((call: SearchCall): boolean => {
        return call.alertingOnly;
      }),
    ).toEqual([false, false, true, true]);
    expect(checkByKey(result.checks, "detections-available")).toMatchObject({
      status: "pass",
      message:
        "With the saved Data to import (Alerts and Detections selected): last 24 hours 0 rule detections created and 2 alerts in the alerts view; last 7 days 0 and 4.",
    });
    expect(result.counts).toMatchObject({
      scope: "alerts-and-detections",
      otherScope: expect.objectContaining({ scope: "alerts-only" }),
    });
  });

  test("nothing under the saved scope but something under the other scope warns about alerting", async () => {
    const fake: FakeClient = makeClient({
      alertsOnly: {},
      alertsAndDetections: {
        rules7d: [detection("d1"), detection("d2"), detection("d3")],
      },
    });

    const result: ConnectorTestResult = await runTest(fake);

    const availability: SecurityConnectorCheck = checkByKey(
      result.checks,
      "detections-available",
    );
    expect(availability.status).toBe("warn");
    expect(availability.message).toBe(
      "Nothing is available with the saved Data to import (Alerts only) in the last 7 days, but 3 rule detections and 0 alerts-view records exist with Alerts and Detections selected.",
    );
    expect(availability.remediation).toBe(
      "Your rules create detections but alerting is not enabled on them. Edit the connection and select Detections under Data to import, or enable alerting on the rules in Google SecOps.",
    );
    expect(JSON.stringify(result)).not.toMatch(/switch the scope/i);
    expect(result.counts).toMatchObject({
      scope: "alerts-only",
      ruleDetectionsCreatedLast7d: "0",
      otherScope: expect.objectContaining({
        scope: "alerts-and-detections",
        ruleDetectionsCreatedLast7d: "3",
      }),
    });
    expect(availability.details).toEqual(result.counts);
  });

  test("records only under Alerts only while Detections is selected warn with their own remediation", async () => {
    const fake: FakeClient = makeClient({
      alertsOnly: { alerts7d: 2 },
      alertsAndDetections: {},
    });

    const result: ConnectorTestResult = await runTest(fake, {
      alertingOnly: false,
    });

    expect(checkByKey(result.checks, "detections-available")).toMatchObject({
      status: "warn",
      message:
        "Nothing is available with the saved Data to import (Alerts and Detections selected) in the last 7 days, but 0 rule detections and 2 alerts-view records exist with Alerts only.",
      remediation:
        "Reading Alerts only returned records that reading Alerts and Detections did not; re-run the test, and if it persists inspect the tenant's alerting configuration.",
    });
  });

  test("nothing under either scope says so and stays a warning", async () => {
    const fake: FakeClient = makeClient({});

    const result: ConnectorTestResult = await runTest(fake);

    expect(checkByKey(result.checks, "detections-available")).toMatchObject({
      status: "warn",
      message:
        "No detections were created in the last 7 days. Polling will import new detections as Google creates them.",
      remediation:
        "Check that your rules are enabled and run on a schedule in Google SecOps. A quiet tenant is not a connector fault.",
    });
    expect(result.counts).toMatchObject({
      alertsViewLast7d: 0,
      ruleDetectionsCreatedLast7d: "0",
    });
  });

  test("a full page with a next page token is reported as 1000+", async () => {
    const many: Array<JSONObject> = Array.from(
      { length: 1000 },
      (_value: unknown, index: number): JSONObject => {
        return detection(`many-${index}`);
      },
    );
    const fake: FakeClient = makeClient({
      alertsOnly: { rules24h: many, rules7d: many, rules7dHasMore: true },
    });

    const result: ConnectorTestResult = await runTest(fake);

    expect(result.counts).toMatchObject({
      ruleDetectionsCreatedLast24h: "1000+",
      ruleDetectionsCreatedLast7d: "1000+",
      hasMoreLast7d: true,
    });
    expect(checkByKey(result.checks, "detections-available").status).toBe(
      "pass",
    );
  });

  test("a page truncated by size is bounded and has more; a short page is counted exactly", async () => {
    const fake: FakeClient = makeClient({
      alertsOnly: {
        rules24h: [detection("a"), detection("b")],
        rules7d: [detection("a")],
        rules7dTruncated: true,
      },
    });

    const result: ConnectorTestResult = await runTest(fake);

    expect(result.counts).toMatchObject({
      ruleDetectionsCreatedLast24h: "2",
      ruleDetectionsCreatedLast7d: "1000+",
      hasMoreLast7d: true,
    });
  });

  test("the alerts-view count is the largest of its matched counts and what it returned", async () => {
    const fake: FakeClient = makeClient({
      alertsResult: (call: AlertsCall): FetchAlertsResult => {
        const week: boolean = isWeek(call);
        return {
          alerts: [detection("only-one")],
          complete: true,
          progress: 1,
          truncatedByCount: false,
          truncatedByBytes: false,
          baselineAlertsCount: week ? 0 : 7,
          filteredAlertsCount: week ? 0 : 3,
          chunkCount: 1,
        };
      },
    });

    const result: ConnectorTestResult = await runTest(fake);

    // 24 hours: max(7, 3, 1); 7 days: no counts, so the returned record.
    expect(result.counts).toMatchObject({
      alertsViewLast24h: 7,
      alertsViewLast7d: 1,
    });
    expect(checkByKey(result.checks, "detections-available").status).toBe(
      "pass",
    );
  });

  test.each([400, 403, 404])(
    "curated detections answering HTTP %s is a warning that does not stop the availability probe",
    async (status: number) => {
      const fake: FakeClient = makeClient({
        alertsOnly: { alerts24h: 1, alerts7d: 1 },
        curatedError: new APIException(
          `Google SecOps detections search failed (HTTP ${status}): {"error":{"code":${status}}}`,
        ),
      });

      const result: ConnectorTestResult = await runTest(fake);

      expect(checkByKey(result.checks, "curated-detections-read")).toEqual({
        key: "curated-detections-read",
        name: "Read curated rule detections",
        status: "warn",
        durationMs: expect.any(Number),
        message: `Curated rule detections are not readable on this tenant (HTTP ${status}). Polling continues with rule detections and the alerts view.`,
        remediation:
          "Curated (Google-authored) rule detections need that entitlement on the tenant. Nothing to fix unless you expect curated detections to be imported.",
        details: {
          httpStatus: status,
          error: `Google SecOps detections search failed (HTTP ${status}): {"error":{"code":${status}}}`,
        },
      });
      expect(checkByKey(result.checks, "detections-available").status).toBe(
        "pass",
      );
    },
  );

  /*
   * The curated read never gates availability: a tenant whose curated route
   * is broken still has rule detections and alerts to count. The retired
   * tester's test of this case was named "skips the availability probe" but
   * never asserted it; this pins what the code does.
   */
  test.each([401, 429, 500])(
    "curated detections answering HTTP %s fails that check while availability still runs",
    async (status: number) => {
      const fake: FakeClient = makeClient({
        alertsOnly: { alerts24h: 1, alerts7d: 1 },
        curatedError: new APIException(
          `Google SecOps detections search failed (HTTP ${status}): {"error":{"code":${status}}}`,
        ),
      });

      const result: ConnectorTestResult = await runTest(fake);

      expect(
        checkByKey(result.checks, "curated-detections-read"),
      ).toMatchObject({
        status: "fail",
        message: `Google SecOps detections search failed (HTTP ${status}): {"error":{"code":${status}}}`,
        remediation:
          "Grant roles/chronicle.viewer on the instance to the service account (it includes chronicle.legacies.legacySearchDetections and legacySearchCuratedDetections), and confirm the instance resource name and region.",
      });
      expect(checkByKey(result.checks, "detections-available").status).toBe(
        "pass",
      );
      expect(result.counts).toBeDefined();
    },
  );

  test("a curated read that times out carries no HTTP status and fails the check", async () => {
    const fake: FakeClient = makeClient({
      curatedError: new APIException(
        "Google SecOps detections search timed out after 20 seconds with no response.",
      ),
    });

    const result: ConnectorTestResult = await runTest(fake);

    expect(checkByKey(result.checks, "curated-detections-read")).toMatchObject({
      status: "fail",
      message:
        "Google SecOps detections search timed out after 20 seconds with no response.",
    });
  });

  test("a rule-detections read failure fails its check, still runs the other reads, and skips availability", async () => {
    const fake: FakeClient = makeClient({
      ruleError: new APIException(
        "Google SecOps detections search failed (HTTP 403): denied",
      ),
      alertsOnly: { alerts24h: 1, alerts7d: 1 },
    });

    const result: ConnectorTestResult = await runTest(fake);

    expect(statusesOf(result.checks)).toEqual([
      "authentication:pass",
      "rule-detections-read:fail",
      "curated-detections-read:pass",
      "alerts-view-read:pass",
      "detections-available:skip",
    ]);
    expect(checkByKey(result.checks, "rule-detections-read")).toMatchObject({
      message: "Google SecOps detections search failed (HTTP 403): denied",
      remediation: expect.stringContaining("roles/chronicle.viewer"),
    });
    expect(checkByKey(result.checks, "detections-available").message).toBe(
      "Skipped because a read check failed; fix that first and test again.",
    );
    expect(fake.alertsCalls).toHaveLength(1);
    expect(fake.searchCalls).toHaveLength(2);
    expect(result.counts).toBeUndefined();
    // The alerts-view probe still supplies a sample.
    expect(result.samples).toEqual([
      expect.objectContaining({ id: "alerts-view-sample" }),
    ]);
  });

  test("an alerts-view read failure fails its check and skips availability", async () => {
    const fake: FakeClient = makeClient({
      alertsError: new APIException(
        "Google SecOps alerts fetch failed (HTTP 403): permission denied",
      ),
    });

    const result: ConnectorTestResult = await runTest(fake);

    expect(statusesOf(result.checks)).toEqual([
      "authentication:pass",
      "rule-detections-read:pass",
      "curated-detections-read:pass",
      "alerts-view-read:fail",
      "detections-available:skip",
    ]);
    expect(checkByKey(result.checks, "alerts-view-read")).toMatchObject({
      message:
        "Google SecOps alerts fetch failed (HTTP 403): permission denied",
      remediation:
        "Grant roles/chronicle.viewer on the instance to the service account (it includes chronicle.legacies.legacyFetchAlertsView), and confirm the instance resource name and region.",
    });
    expect(fake.searchCalls).toHaveLength(2);
    expect(fake.alertsCalls).toHaveLength(1);
  });

  test("an alerts-view stream that did not complete is a warning, and availability still runs", async () => {
    const fake: FakeClient = makeClient({
      alertsIncomplete: true,
      alertsOnly: { alerts24h: 1, alerts7d: 1 },
    });

    const result: ConnectorTestResult = await runTest(fake);

    expect(checkByKey(result.checks, "alerts-view-read")).toMatchObject({
      status: "warn",
      message:
        "The alerts view answered but the stream ended without confirming it was complete. Reads work; a complete read is not confirmed.",
      details: { baselineAlertsCount: 1, complete: false },
    });
    expect(checkByKey(result.checks, "detections-available").status).toBe(
      "pass",
    );
  });

  test("an authentication failure is redacted and skips every read", async () => {
    const fake: FakeClient = makeClient({
      authError: new APIException(
        'Google token exchange failed (HTTP 400): {"error":"invalid_grant","private_key":"-----BEGIN PRIVATE KEY-----leaked"}',
      ),
    });

    const result: ConnectorTestResult = await runTest(fake);

    expect(keysOf(result)).toEqual(["authentication", "detections-available"]);
    expect(checkByKey(result.checks, "authentication")).toMatchObject({
      status: "fail",
      message: expect.stringContaining(
        "Google token exchange failed (HTTP 400)",
      ),
      remediation:
        "The token exchange happens at Google's OAuth endpoint before Chronicle is contacted. Re-download the service account key, confirm it belongs to the project the instance is bound to, and check this host's clock.",
    });
    expect(JSON.stringify(result)).not.toContain("leaked");
    expect(checkByKey(result.checks, "detections-available")).toMatchObject({
      status: "skip",
      message: "Skipped because authentication failed.",
    });
    expect(fake.searchCalls).toHaveLength(0);
    expect(fake.alertsCalls).toHaveLength(0);
    expect(result.counts).toBeUndefined();
    expect(result.samples).toBeUndefined();
  });

  test("an authentication error longer than the storage clamp is kept whole", async () => {
    const long: string = `Google token exchange failed (HTTP 400): ${"x".repeat(1500)}-tail`;
    const fake: FakeClient = makeClient({ authError: new APIException(long) });

    const result: ConnectorTestResult = await runTest(fake);

    expect(checkByKey(result.checks, "authentication").message).toBe(long);
  });

  test("unusable settings fail authentication with the configuration remediation and contact nothing", async () => {
    const factoryCalls: Array<ClientFactoryCall> = [];
    const connector: GoogleSecOpsConnector = new GoogleSecOpsConnector(
      undefined,
      (call: ClientFactoryCall): GoogleSecOpsClient => {
        factoryCalls.push(call);
        return makeClient({}).client;
      },
    );

    const result: ConnectorTestResult = await connector.testConnection(
      secOpsSettings({ config: { region: "us-central1" } }),
      { requestTimeoutInMs: 20000 },
    );

    expect(statusesOf(result.checks)).toEqual([
      "authentication:fail",
      "detections-available:skip",
    ]);
    expect(checkByKey(result.checks, "authentication")).toMatchObject({
      name: "Authenticate with Google",
      message:
        "Region must be a Google SecOps regional prefix like 'us' or 'europe'.",
      remediation:
        "Correct the highlighted setting and test again. Nothing was contacted.",
    });
    expect(checkByKey(result.checks, "detections-available").message).toBe(
      "Skipped because the configuration is not usable.",
    );
    expect(factoryCalls).toHaveLength(0);
  });

  test("a counting probe that fails leaves the reads intact and warns", async () => {
    const fake: FakeClient = makeClient({
      weekError: new APIException(
        'Google SecOps alerts fetch failed (HTTP 429): {"error":{"code":429}}',
      ),
    });

    const result: ConnectorTestResult = await runTest(fake);

    expect(statusesOf(result.checks)).toEqual([
      "authentication:pass",
      "rule-detections-read:pass",
      "curated-detections-read:pass",
      "alerts-view-read:pass",
      "detections-available:warn",
    ]);
    expect(checkByKey(result.checks, "detections-available")).toMatchObject({
      message:
        'Could not count the detections available to import: Google SecOps alerts fetch failed (HTTP 429): {"error":{"code":429}}',
      remediation:
        "Reads work, so polling can proceed; re-run the test to retry the counts.",
    });
    expect(
      checkByKey(result.checks, "detections-available").details,
    ).toBeUndefined();
    expect(result.counts).toBeUndefined();
  });

  /*
   * A queued test run (the worker's test) only needs to know that access
   * works; eight more probes at the worker's deadline could outlive its job.
   */
  test("skipAvailability skips the counts once the reads pass, and keeps the samples", async () => {
    const fake: FakeClient = makeClient({
      alertsOnly: { alerts24h: 1, alerts7d: 1 },
    });

    const result: ConnectorTestResult = await runTest(fake, {
      skipAvailability: true,
    });

    expect(statusesOf(result.checks)).toEqual([
      "authentication:pass",
      "rule-detections-read:pass",
      "curated-detections-read:pass",
      "alerts-view-read:pass",
      "detections-available:skip",
    ]);
    expect(checkByKey(result.checks, "detections-available")).toMatchObject({
      name: "Detections available to import",
      message:
        "Skipped in a queued test run: availability is only counted by the synchronous Test connection.",
    });
    expect(fake.searchCalls).toHaveLength(2);
    expect(fake.alertsCalls).toHaveLength(1);
    expect(result.counts).toBeUndefined();
    expect(result.samples).toHaveLength(2);
  });

  test("skipAvailability false counts as usual", async () => {
    const fake: FakeClient = makeClient({
      alertsOnly: { alerts24h: 1, alerts7d: 1 },
    });

    const result: ConnectorTestResult = await runTest(fake, {
      skipAvailability: false,
    });

    expect(checkByKey(result.checks, "detections-available").status).toBe(
      "pass",
    );
    expect(fake.alertsCalls).toHaveLength(5);
  });

  test("skipAvailability never hides a failed read or a failed authentication", async () => {
    const readFailure: ConnectorTestResult = await runTest(
      makeClient({
        ruleError: new APIException(
          "Google SecOps detections search failed (HTTP 403): denied",
        ),
      }),
      { skipAvailability: true },
    );
    expect(checkByKey(readFailure.checks, "detections-available").message).toBe(
      "Skipped because a read check failed; fix that first and test again.",
    );

    const authFailure: ConnectorTestResult = await runTest(
      makeClient({
        authError: new APIException(
          "Google token exchange failed (HTTP 401): {}",
        ),
      }),
      { skipAvailability: true },
    );
    expect(checkByKey(authFailure.checks, "detections-available").message).toBe(
      "Skipped because authentication failed.",
    );
  });

  test("builds the client from the resolved settings with the requested deadline", async () => {
    const fake: FakeClient = makeClient({});
    const harness: ConnectorHarness = connectorWith(fake.client);

    await harness.connector.testConnection(
      secOpsSettings({ config: { region: " us " } }),
      { requestTimeoutInMs: 1234 },
    );

    expect(harness.factoryCalls).toHaveLength(1);
    expect(harness.factoryCalls[0]).toMatchObject({
      region: "us",
      instanceResourceName:
        "projects/test-project/locations/us/instances/test-instance",
      requestTimeoutInMs: 1234,
    });
    expect(harness.factoryCalls[0]!.serviceAccountJson).toContain(
      "client_email",
    );
  });

  test("samples come only from records the normalizer recognizes, and are redacted", async () => {
    const fake: FakeClient = makeClient({
      ruleProbeRecord: {
        id: 'id {"private_key":"-----BEGIN PRIVATE KEY-----leaked-id"}',
        type: "RULE_DETECTION",
        detection: [
          {
            ruleName:
              'Rule {"private_key":"-----BEGIN PRIVATE KEY-----leaked-title"}',
          },
        ],
      },
      alertsResult: (): FetchAlertsResult => {
        return {
          alerts: [{ arbitrary: "envelope" }],
          complete: true,
          progress: 1,
          truncatedByCount: false,
          truncatedByBytes: false,
          baselineAlertsCount: 0,
          filteredAlertsCount: 0,
          chunkCount: 1,
        };
      },
    });

    const result: ConnectorTestResult = await runTest(fake);

    expect(result.samples).toHaveLength(1);
    expect(JSON.stringify(result.samples)).not.toContain("leaked");
    expect(result.samples![0]!.createdTime).toBeUndefined();
    expect(result.samples![0]!.eventTime).toBeUndefined();
  });

  test("a probe record that throws while being read gives no sample and does not fail the test", async () => {
    const fake: FakeClient = makeClient({
      ruleProbeRecord: poisonDetection("poison"),
    });

    const result: ConnectorTestResult = await runTest(fake);

    expect(checkByKey(result.checks, "rule-detections-read").status).toBe(
      "pass",
    );
    expect(result.samples).toBeUndefined();
  });

  test("never throws: a client that throws synchronously becomes failed checks", async () => {
    const throwing: GoogleSecOpsClient = {
      testAuthentication: (): Promise<void> => {
        throw new Error("synchronous auth failure");
      },
    } as unknown as GoogleSecOpsClient;
    const authResult: ConnectorTestResult = await connectorWith(
      throwing,
    ).connector.testConnection(secOpsSettings(), { requestTimeoutInMs: 1000 });
    expect(statusesOf(authResult.checks)).toEqual([
      "authentication:fail",
      "detections-available:skip",
    ]);
    expect(checkByKey(authResult.checks, "authentication").message).toBe(
      "synchronous auth failure",
    );

    const readsThrow: GoogleSecOpsClient = {
      testAuthentication: async (): Promise<void> => {},
      searchDetections: (): Promise<SearchDetectionsResult> => {
        throw new Error("synchronous search failure");
      },
      fetchDetectionAlerts: (): Promise<FetchAlertsResult> => {
        throw new Error("synchronous alerts failure");
      },
    } as unknown as GoogleSecOpsClient;
    const readResult: ConnectorTestResult = await connectorWith(
      readsThrow,
    ).connector.testConnection(secOpsSettings(), { requestTimeoutInMs: 1000 });
    expect(statusesOf(readResult.checks)).toEqual([
      "authentication:pass",
      "rule-detections-read:fail",
      "curated-detections-read:fail",
      "alerts-view-read:fail",
      "detections-available:skip",
    ]);

    const factoryThrows: GoogleSecOpsConnector = new GoogleSecOpsConnector(
      undefined,
      (): GoogleSecOpsClient => {
        throw new Error("factory failure");
      },
    );
    const factoryResult: ConnectorTestResult =
      await factoryThrows.testConnection(secOpsSettings(), {
        requestTimeoutInMs: 1000,
      });
    expect(statusesOf(factoryResult.checks)).toEqual([
      "authentication:fail",
      "detections-available:skip",
    ]);
    expect(checkByKey(factoryResult.checks, "authentication").message).toBe(
      "factory failure",
    );
  });

  test("every check carries a non-negative duration and no remediation when it passed", async () => {
    const fake: FakeClient = makeClient({
      alertsOnly: { alerts24h: 1, alerts7d: 1 },
    });

    const result: ConnectorTestResult = await runTest(fake);

    for (const check of result.checks) {
      expect(check.durationMs).toBeGreaterThanOrEqual(0);
      if (check.status === "pass") {
        expect(check.remediation).toBeUndefined();
      }
    }
  });
});
