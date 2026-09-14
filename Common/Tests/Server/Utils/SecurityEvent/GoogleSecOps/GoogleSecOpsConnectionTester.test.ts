import GoogleSecOpsConnection from "../../../../../Models/DatabaseModels/GoogleSecOpsConnection";
import GoogleSecOpsConnectionRun from "../../../../../Models/DatabaseModels/GoogleSecOpsConnectionRun";
import GoogleSecOpsConnectionRunService from "../../../../../Server/Services/GoogleSecOpsConnectionRunService";
import logger from "../../../../../Server/Utils/Logger";
import ConnectorPlatformHealth from "../../../../../Server/Utils/SecurityEvent/Connectors/ConnectorPlatformHealth";
import GoogleSecOpsClient, {
  FetchAlertsResult,
  SearchDetectionsResult,
} from "../../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsClient";
import GoogleSecOpsConnectionTester, {
  GOOGLE_SECOPS_CONNECTION_TEST_TIMEOUT_IN_MS,
} from "../../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsConnectionTester";
import SecurityEventDedupe from "../../../../../Server/Utils/SecurityEvent/SecurityEventDedupe";
import APIException from "../../../../../Types/Exception/ApiException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  ConnectorPlatformStatus,
  SecurityConnectorCheck,
  SecurityConnectorTestReport,
} from "../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { getJestSpyOn } from "../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The synchronous Google SecOps connection test. It answers the question
 * "connected, but nothing ingests" as a checklist: can Google be reached,
 * can each of the three poll passes read, is there anything to import
 * under the saved scope — and, crucially, under the OTHER scope — and are
 * OneUptime's workers, scheduler and storage alive. These tests pin the
 * check keys and order, the status folding, the both-scope availability
 * probe, the curated-rule degradation, redaction, the run-history row for
 * a saved connection, and that unsaved settings touch nothing.
 */

const NOW: Date = new Date("2026-09-14T12:00:00.000Z");
const DAY_MS: number = 24 * 60 * 60 * 1000;
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const HEALTHY_PLATFORM: ConnectorPlatformStatus = {
  workerConsumers: 2,
  schedulerRegistered: true,
  schedulerNextRunAt: "2026-09-14T12:01:00.000Z",
  queueWaiting: 0,
  queueFailed: 0,
  storageReachable: true,
};

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
 * nothing anywhere, alerts and detections has five rule detections in the
 * last week".
 */
interface ScopeFixture {
  alerts24h?: number | undefined;
  alerts7d?: number | undefined;
  rules24h?: Array<JSONObject> | undefined;
  rules7d?: Array<JSONObject> | undefined;
  rules7dHasMore?: boolean | undefined;
}

interface Fixture {
  alertsOnly?: ScopeFixture | undefined;
  alertsAndDetections?: ScopeFixture | undefined;
  curatedError?: Error | undefined;
  ruleError?: Error | undefined;
  alertsError?: Error | undefined;
  authError?: Error | undefined;
}

interface FakeClient {
  client: GoogleSecOpsClient;
  searchCalls: Array<SearchCall>;
  alertsCalls: Array<AlertsCall>;
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

  const scopeOf: (alertingOnly: boolean) => ScopeFixture = (
    alertingOnly: boolean,
  ): ScopeFixture => {
    return (
      (alertingOnly ? fixture.alertsOnly : fixture.alertsAndDetections) || {}
    );
  };

  const client: GoogleSecOpsClient = {
    testAuthentication: jest.fn(async (): Promise<void> => {
      if (fixture.authError) {
        throw fixture.authError;
      }
    }),
    searchDetections: jest.fn(
      async (call: SearchCall): Promise<SearchDetectionsResult> => {
        searchCalls.push(call);
        if (call.curated) {
          if (fixture.curatedError) {
            throw fixture.curatedError;
          }
          return { detections: [], nextPageToken: null, truncated: false };
        }
        if (fixture.ruleError) {
          throw fixture.ruleError;
        }
        const scope: ScopeFixture = scopeOf(call.alertingOnly);
        const detections: Array<JSONObject> = isWeek(call)
          ? scope.rules7d || []
          : scope.rules24h || [];
        return {
          detections: detections.slice(0, call.pageSize || 1000),
          nextPageToken: isWeek(call) && scope.rules7dHasMore ? "more" : null,
          truncated: false,
        };
      },
    ),
    fetchDetectionAlerts: jest.fn(
      async (call: AlertsCall): Promise<FetchAlertsResult> => {
        alertsCalls.push(call);
        if (fixture.alertsError) {
          throw fixture.alertsError;
        }
        const scope: ScopeFixture = scopeOf(
          call.includeNonAlertingDetections !== true,
        );
        const count: number = isWeek(call)
          ? scope.alerts7d || 0
          : scope.alerts24h || 0;
        return {
          alerts: count > 0 ? [detection("alerts-view-sample")] : [],
          complete: true,
          progress: 1,
          truncatedByCount: false,
          truncatedByBytes: false,
          baselineAlertsCount: count,
          filteredAlertsCount: count,
          chunkCount: 1,
        };
      },
    ),
  } as unknown as GoogleSecOpsClient;

  return { client, searchCalls, alertsCalls };
}

function savedConnection(
  changes: Partial<GoogleSecOpsConnection> = {},
): GoogleSecOpsConnection {
  const item: GoogleSecOpsConnection = new GoogleSecOpsConnection();
  item._id = CONNECTION_ID.toString();
  item.projectId = PROJECT_ID;
  item.region = "us";
  item.instanceResourceName = "projects/p/locations/us/instances/i";
  item.serviceAccountJson = "{}";
  item.isEnabled = true;
  item.pollIntervalInMinutes = 5;
  item.createdAt = new Date(NOW.getTime() - 60 * 60 * 1000);
  item.lastPolledAt = new Date(NOW.getTime() - 60 * 1000);
  item.lastSuccessfulPollAt = new Date(NOW.getTime() - 60 * 1000);
  Object.assign(item, changes);
  return item;
}

function unsavedConnection(): GoogleSecOpsConnection {
  const item: GoogleSecOpsConnection = new GoogleSecOpsConnection();
  item.projectId = PROJECT_ID;
  item.region = "us";
  item.instanceResourceName = "projects/p/locations/us/instances/i";
  item.serviceAccountJson = "{}";
  return item;
}

function keysOf(report: SecurityConnectorTestReport): Array<string> {
  return report.checks.map((check: SecurityConnectorCheck): string => {
    return check.key;
  });
}

function checkKeyed(
  report: SecurityConnectorTestReport,
  key: string,
): SecurityConnectorCheck {
  return report.checks.find((check: SecurityConnectorCheck): boolean => {
    return check.key === key;
  })!;
}

describe("GoogleSecOpsConnectionTester", () => {
  let recordedRuns: Array<GoogleSecOpsConnectionRun>;

  beforeEach(() => {
    recordedRuns = [];
    getJestSpyOn(
      GoogleSecOpsConnectionRunService,
      "findOneBy",
    ).mockResolvedValue(null);
    getJestSpyOn(GoogleSecOpsConnectionRunService, "create").mockImplementation(
      ((data: {
        data: GoogleSecOpsConnectionRun;
      }): Promise<GoogleSecOpsConnectionRun> => {
        recordedRuns.push(data.data);
        return Promise.resolve(data.data);
      }) as never,
    );
    getJestSpyOn(logger, "error").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the per-request deadline for a test is 20 seconds", () => {
    expect(GOOGLE_SECOPS_CONNECTION_TEST_TIMEOUT_IN_MS).toBe(20_000);
  });

  test("a healthy saved connection passes every check, in order, and records a test run", async () => {
    const fake: FakeClient = makeClient({
      alertsOnly: {
        alerts24h: 3,
        alerts7d: 12,
        rules24h: [detection("r1"), detection("r2")],
        rules7d: [detection("r1"), detection("r2"), detection("r3")],
      },
    });

    const report: SecurityConnectorTestReport =
      await GoogleSecOpsConnectionTester.test({
        connection: savedConnection(),
        clientOverride: fake.client,
        platformOverride: HEALTHY_PLATFORM,
        now: NOW,
      });

    expect(report.provider).toBe("google-secops");
    expect(report.status).toBe("pass");
    expect(keysOf(report)).toEqual([
      "configuration",
      "authentication",
      "rule-detections-read",
      "curated-detections-read",
      "alerts-view-read",
      "detections-available",
      "worker-consumers",
      "scheduler",
      "storage",
      "connection-schedule",
    ]);
    expect(report.counts).toMatchObject({
      scope: "alerts-only",
      alertsViewLast24h: 3,
      alertsViewLast7d: 12,
      ruleDetectionsCreatedLast24h: "2",
      ruleDetectionsCreatedLast7d: "3",
      hasMoreLast7d: false,
    });
    expect(report.samples).toEqual([
      expect.objectContaining({
        id: "r1",
        title: "Rule r1",
        severity: "High",
        createdTime: "2026-09-14T11:02:00.000Z",
        eventTime: "2026-09-14T11:00:00.000Z",
      }),
      expect.objectContaining({ id: "alerts-view-sample" }),
    ]);
    expect(report.summary).toMatch(/workers and scheduler are running/);

    // One run-history row, of type test, never carrying credentials.
    expect(recordedRuns).toHaveLength(1);
    expect(recordedRuns[0]).toMatchObject({
      projectId: PROJECT_ID,
      googleSecOpsConnectionId: CONNECTION_ID,
      type: "test",
      status: "success",
      request: { type: "test", synchronous: true },
    });
    expect(recordedRuns[0]!.completedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(recordedRuns[0]!.result)).not.toContain(
      "serviceAccountJson",
    );
  });

  test("the read probes ask for one record each over the last 24 hours by created time", async () => {
    const fake: FakeClient = makeClient({});

    await GoogleSecOpsConnectionTester.test({
      connection: savedConnection(),
      clientOverride: fake.client,
      platformOverride: HEALTHY_PLATFORM,
      now: NOW,
    });

    const [rule, curated] = fake.searchCalls;
    expect(rule).toMatchObject({
      listBasis: "CREATED_TIME",
      alertingOnly: true,
      pageSize: 1,
      curated: false,
    });
    expect(rule!.startTime.toISOString()).toBe("2026-09-13T12:00:00.000Z");
    expect(rule!.endTime).toEqual(NOW);
    expect(curated).toMatchObject({ pageSize: 1, curated: true });
    expect(fake.alertsCalls[0]).toMatchObject({
      maxAlerts: 1,
      includeNonAlertingDetections: false,
    });
  });

  test("availability is probed under BOTH scopes over 24 hours and 7 days, one page each", async () => {
    const fake: FakeClient = makeClient({});

    await GoogleSecOpsConnectionTester.test({
      connection: savedConnection(),
      clientOverride: fake.client,
      platformOverride: HEALTHY_PLATFORM,
      now: NOW,
    });

    // Three read probes (2 searches, 1 alerts view) plus 4 probes per scope.
    const availabilitySearches: Array<SearchCall> = fake.searchCalls.slice(2);
    const availabilityAlerts: Array<AlertsCall> = fake.alertsCalls.slice(1);
    expect(availabilitySearches).toHaveLength(4);
    expect(availabilityAlerts).toHaveLength(4);
    expect(
      availabilitySearches.map((call: SearchCall): string => {
        return `${call.alertingOnly ? "alerts-only" : "both"}:${isWeek(call) ? "7d" : "24h"}:${call.pageSize}`;
      }),
    ).toEqual([
      "alerts-only:24h:1000",
      "alerts-only:7d:1000",
      "both:24h:1000",
      "both:7d:1000",
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
    expect(
      availabilitySearches.every((call: SearchCall): boolean => {
        return call.listBasis === "CREATED_TIME";
      }),
    ).toBe(true);
  });

  test("nothing under the saved scope but something under the other scope warns about alerting", async () => {
    const fake: FakeClient = makeClient({
      alertsOnly: {},
      alertsAndDetections: {
        rules7d: [detection("d1"), detection("d2"), detection("d3")],
      },
    });

    const report: SecurityConnectorTestReport =
      await GoogleSecOpsConnectionTester.test({
        connection: savedConnection(),
        clientOverride: fake.client,
        platformOverride: HEALTHY_PLATFORM,
        now: NOW,
      });

    const availability: SecurityConnectorCheck = checkKeyed(
      report,
      "detections-available",
    );
    expect(availability.status).toBe("warn");
    /*
     * Vocabulary (F6): the form shows a Data to import group with a
     * Detections checkbox, not an "Alerts and detections" scope, so the
     * guidance names the control that ships.
     */
    expect(availability.message).toBe(
      "Nothing is available with the saved Data to import (Alerts only) in the last 7 days, but 3 rule detections and 0 alerts-view records exist with Alerts and Detections selected.",
    );
    expect(availability.remediation).toBe(
      "Your rules create detections but alerting is not enabled on them. Edit the connection and select Detections under Data to import, or enable alerting on the rules in Google SecOps.",
    );
    expect(JSON.stringify(report)).not.toMatch(/switch the scope/i);
    expect(report.counts).toMatchObject({
      scope: "alerts-only",
      ruleDetectionsCreatedLast7d: "0",
      otherScope: expect.objectContaining({
        scope: "alerts-and-detections",
        ruleDetectionsCreatedLast7d: "3",
      }),
    });
    expect(report.status).toBe("warn");
    expect(report.summary).toMatch(/Detections available to import/);
    expect(recordedRuns[0]!.status).toBe("success");
  });

  test("a connection that already imports Detections names that selection in its counts message", async () => {
    const fake: FakeClient = makeClient({
      alertsAndDetections: { alerts24h: 2, alerts7d: 4 },
    });

    const report: SecurityConnectorTestReport =
      await GoogleSecOpsConnectionTester.test({
        connection: savedConnection({ includeNonAlertingDetections: true }),
        clientOverride: fake.client,
        platformOverride: HEALTHY_PLATFORM,
        now: NOW,
      });

    expect(checkKeyed(report, "detections-available")).toMatchObject({
      status: "pass",
      message: expect.stringMatching(
        /^With the saved Data to import \(Alerts and Detections selected\): /,
      ),
    });
  });

  test("nothing under either scope says so and stays a warning", async () => {
    const fake: FakeClient = makeClient({});

    const report: SecurityConnectorTestReport =
      await GoogleSecOpsConnectionTester.test({
        connection: savedConnection(),
        clientOverride: fake.client,
        platformOverride: HEALTHY_PLATFORM,
        now: NOW,
      });

    expect(checkKeyed(report, "detections-available")).toMatchObject({
      status: "warn",
      message:
        "No detections were created in the last 7 days. Polling will import new detections as Google creates them.",
    });
    expect(report.status).toBe("warn");
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

    const report: SecurityConnectorTestReport =
      await GoogleSecOpsConnectionTester.test({
        connection: savedConnection(),
        clientOverride: fake.client,
        platformOverride: HEALTHY_PLATFORM,
        now: NOW,
      });

    expect(report.counts).toMatchObject({
      ruleDetectionsCreatedLast24h: "1000+",
      ruleDetectionsCreatedLast7d: "1000+",
      hasMoreLast7d: true,
    });
    expect(checkKeyed(report, "detections-available").status).toBe("pass");
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

      const report: SecurityConnectorTestReport =
        await GoogleSecOpsConnectionTester.test({
          connection: savedConnection(),
          clientOverride: fake.client,
          platformOverride: HEALTHY_PLATFORM,
          now: NOW,
        });

      expect(checkKeyed(report, "curated-detections-read")).toMatchObject({
        status: "warn",
        details: expect.objectContaining({ httpStatus: status }),
      });
      expect(checkKeyed(report, "detections-available").status).toBe("pass");
      expect(report.status).toBe("warn");
    },
  );

  test("curated detections answering HTTP 500 fails the check and skips the availability probe", async () => {
    const fake: FakeClient = makeClient({
      curatedError: new APIException(
        'Google SecOps detections search failed (HTTP 500): {"error":{"code":500}}',
      ),
    });

    const report: SecurityConnectorTestReport =
      await GoogleSecOpsConnectionTester.test({
        connection: savedConnection(),
        clientOverride: fake.client,
        platformOverride: HEALTHY_PLATFORM,
        now: NOW,
      });

    expect(checkKeyed(report, "curated-detections-read").status).toBe("fail");
    expect(report.status).toBe("fail");
    expect(recordedRuns[0]).toMatchObject({ status: "failed" });
    expect(recordedRuns[0]!.error).toMatch(/Read curated rule detections/);
  });

  test("a rule-detections read failure fails the report, still runs the other reads, and skips availability", async () => {
    const fake: FakeClient = makeClient({
      ruleError: new APIException(
        "Google SecOps detections search failed (HTTP 403): denied",
      ),
    });

    const report: SecurityConnectorTestReport =
      await GoogleSecOpsConnectionTester.test({
        connection: savedConnection(),
        clientOverride: fake.client,
        platformOverride: HEALTHY_PLATFORM,
        now: NOW,
      });

    expect(checkKeyed(report, "rule-detections-read")).toMatchObject({
      status: "fail",
      remediation: expect.stringContaining("roles/chronicle.viewer"),
    });
    expect(checkKeyed(report, "alerts-view-read").status).toBe("pass");
    expect(checkKeyed(report, "detections-available").status).toBe("skip");
    expect(report.status).toBe("fail");
    expect(fake.alertsCalls).toHaveLength(1);
  });

  test("an authentication failure is redacted, skips every read, and fails the report", async () => {
    const fake: FakeClient = makeClient({
      authError: new APIException(
        'Google token exchange failed (HTTP 400): {"error":"invalid_grant","private_key":"-----BEGIN PRIVATE KEY-----leaked"}',
      ),
    });

    const report: SecurityConnectorTestReport =
      await GoogleSecOpsConnectionTester.test({
        connection: savedConnection(),
        clientOverride: fake.client,
        platformOverride: HEALTHY_PLATFORM,
        now: NOW,
      });

    expect(keysOf(report)).toEqual([
      "configuration",
      "authentication",
      "detections-available",
      "worker-consumers",
      "scheduler",
      "storage",
      "connection-schedule",
    ]);
    expect(checkKeyed(report, "authentication")).toMatchObject({
      status: "fail",
      message: expect.stringContaining(
        "Google token exchange failed (HTTP 400)",
      ),
    });
    expect(JSON.stringify(report)).not.toContain("leaked");
    expect(checkKeyed(report, "detections-available").status).toBe("skip");
    expect(fake.searchCalls).toHaveLength(0);
    expect(fake.alertsCalls).toHaveLength(0);
    expect(report.status).toBe("fail");
  });

  test("a malformed configuration fails before anything is contacted", async () => {
    const report: SecurityConnectorTestReport =
      await GoogleSecOpsConnectionTester.test({
        connection: savedConnection({ region: "us-central1" }),
        platformOverride: HEALTHY_PLATFORM,
        now: NOW,
      });

    expect(checkKeyed(report, "configuration")).toMatchObject({
      status: "fail",
      message: expect.stringMatching(/Region must be/),
    });
    expect(checkKeyed(report, "authentication").status).toBe("skip");
    expect(report.status).toBe("fail");
    expect(recordedRuns[0]).toMatchObject({ type: "test", status: "failed" });
  });

  test("a platform failure fails the report even when Google is healthy", async () => {
    const fake: FakeClient = makeClient({
      alertsOnly: { alerts24h: 1, alerts7d: 1 },
    });

    const report: SecurityConnectorTestReport =
      await GoogleSecOpsConnectionTester.test({
        connection: savedConnection(),
        clientOverride: fake.client,
        platformOverride: { ...HEALTHY_PLATFORM, workerConsumers: 0 },
        now: NOW,
      });

    expect(checkKeyed(report, "worker-consumers").status).toBe("fail");
    expect(report.status).toBe("fail");
    expect(report.summary).toMatch(/Background workers/);
  });

  test("the schedule check reads the connection row and the oldest pending run", async () => {
    const pending: GoogleSecOpsConnectionRun = new GoogleSecOpsConnectionRun();
    pending.createdAt = new Date(NOW.getTime() - 10 * 60 * 1000);
    getJestSpyOn(
      GoogleSecOpsConnectionRunService,
      "findOneBy",
    ).mockResolvedValue(pending);
    const fake: FakeClient = makeClient({
      alertsOnly: { alerts24h: 1, alerts7d: 1 },
    });

    const report: SecurityConnectorTestReport =
      await GoogleSecOpsConnectionTester.test({
        connection: savedConnection(),
        clientOverride: fake.client,
        platformOverride: HEALTHY_PLATFORM,
        now: NOW,
      });

    expect(GoogleSecOpsConnectionRunService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          googleSecOpsConnectionId: CONNECTION_ID,
        }),
        props: { isRoot: true },
      }),
    );
    expect(checkKeyed(report, "connection-schedule")).toMatchObject({
      status: "fail",
      message: expect.stringContaining("no worker has picked it up"),
    });
  });

  /*
   * Review finding edit-form-test-ignores-edited-settings: the API overlays
   * the edit form's unsaved values onto the stored row and asks for no run
   * row, because a row would describe settings the connection does not
   * have. The saved connection's schedule is still reported.
   */
  test("a saved connection tested with unsaved edits records no run row", async () => {
    const fake: FakeClient = makeClient({
      alertsOnly: { alerts24h: 1, alerts7d: 1 },
    });

    const report: SecurityConnectorTestReport =
      await GoogleSecOpsConnectionTester.test({
        connection: savedConnection(),
        clientOverride: fake.client,
        platformOverride: HEALTHY_PLATFORM,
        now: NOW,
        recordRun: false,
      });

    expect(report.status).toBe("pass");
    expect(keysOf(report)).toContain("connection-schedule");
    expect(GoogleSecOpsConnectionRunService.create).not.toHaveBeenCalled();
    expect(recordedRuns).toHaveLength(0);
  });

  test("unsaved settings get no schedule check and write nothing", async () => {
    const fake: FakeClient = makeClient({
      alertsOnly: { alerts24h: 1, alerts7d: 1 },
    });

    const report: SecurityConnectorTestReport =
      await GoogleSecOpsConnectionTester.test({
        connection: unsavedConnection(),
        clientOverride: fake.client,
        platformOverride: HEALTHY_PLATFORM,
        now: NOW,
      });

    expect(keysOf(report)).not.toContain("connection-schedule");
    expect(report.status).toBe("pass");
    expect(GoogleSecOpsConnectionRunService.findOneBy).not.toHaveBeenCalled();
    expect(GoogleSecOpsConnectionRunService.create).not.toHaveBeenCalled();
  });

  test("the storage probe exercises the ClickHouse dedupe path with the Google source names", async () => {
    let capturedProbe: (() => Promise<boolean>) | undefined = undefined;
    getJestSpyOn(
      ConnectorPlatformHealth,
      "getPlatformStatus",
    ).mockImplementation(((data: {
      storageProbeOverride?: (() => Promise<boolean>) | undefined;
    }): Promise<ConnectorPlatformStatus> => {
      capturedProbe = data.storageProbeOverride;
      return Promise.resolve(HEALTHY_PLATFORM);
    }) as never);
    const dedupe: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityEventDedupe,
      "findExistingEventUids",
    ).mockResolvedValue(new Set());
    const fake: FakeClient = makeClient({
      alertsOnly: { alerts24h: 1, alerts7d: 1 },
    });

    await GoogleSecOpsConnectionTester.test({
      connection: savedConnection(),
      clientOverride: fake.client,
      now: NOW,
    });

    expect(capturedProbe).toBeDefined();
    await expect(capturedProbe!()).resolves.toBe(true);
    expect(dedupe).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      vendorName: "Google",
      productName: "Google SecOps",
      ids: ["oneuptime-connection-test-probe"],
    });
  });

  test("a failed run-history write is logged and does not fail the test", async () => {
    getJestSpyOn(GoogleSecOpsConnectionRunService, "create").mockRejectedValue(
      new Error("database unavailable"),
    );
    const fake: FakeClient = makeClient({
      alertsOnly: { alerts24h: 1, alerts7d: 1 },
    });

    const report: SecurityConnectorTestReport =
      await GoogleSecOpsConnectionTester.test({
        connection: savedConnection(),
        clientOverride: fake.client,
        platformOverride: HEALTHY_PLATFORM,
        now: NOW,
      });

    expect(report.status).toBe("pass");
    expect(logger.error).toHaveBeenCalled();
  });
});
