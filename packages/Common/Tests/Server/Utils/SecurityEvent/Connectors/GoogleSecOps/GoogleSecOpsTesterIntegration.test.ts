import SecurityEventConnection from "../../../../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionRun from "../../../../../../Models/DatabaseModels/SecurityEventConnectionRun";
import SecurityEventConnectionRunService from "../../../../../../Server/Services/SecurityEventConnectionRunService";
import logger from "../../../../../../Server/Utils/Logger";
import ConnectorPlatformHealth from "../../../../../../Server/Utils/SecurityEvent/Connectors/ConnectorPlatformHealth";
import GoogleSecOpsClient from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import GoogleSecOpsConnector, {
  GoogleSecOpsClientFactory,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsConnector";
import SecurityEventConnectionTester, {
  CONNECTION_TEST_REQUEST_TIMEOUT_IN_MS,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionTester";
import SecurityEventConnectorRegistry from "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry";
import SecurityEventDedupe from "../../../../../../Server/Utils/SecurityEvent/SecurityEventDedupe";
import OneUptimeDate from "../../../../../../Types/Date";
import {
  ConnectorPlatformStatus,
  SecurityConnectorCheck,
  SecurityConnectorTestReport,
} from "../../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { getJestSpyOn } from "../../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { PRIVATE_KEY, secOpsSettings } from "./GoogleSecOpsConnectorFixtures";
import {
  CONNECTION_ID,
  DAY_MS,
  GoogleSecOpsTenant,
  HOUR_MS,
  MINUTE_MS,
  PROJECT_ID,
  TenantRequest,
  findCheck,
  secOpsConnection,
} from "./GoogleSecOpsPollingFixtures";

/*
 * The synchronous "Test connection" for a Google SecOps connection, now that
 * it is the shared SecurityEventConnectionTester: the REAL tester with the
 * REAL GoogleSecOpsConnector and GoogleSecOpsClient over a simulated tenant.
 *
 * It answers "connected, but nothing ingests" as a checklist: can Google be
 * reached, can each of the three poll passes read, is there anything to
 * import, and are OneUptime's workers, scheduler and storage alive. The
 * connector's own checks are pinned by its suites; these are the cases the
 * retired GoogleSecOpsConnectionTester suite pinned on the tester side - the
 * request deadline, the order the provider, platform and schedule checks land
 * in, the verdict, the run-history row, the storage probe's Google source
 * names, and that unsaved settings write nothing.
 *
 * Run history is stubbed exactly where the retired suite stubbed it; the
 * registry is mocked out as in the generic tester suite.
 */

jest.mock(
  "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry",
  () => {
    return {
      __esModule: true,
      default: { getConnector: jest.fn() },
    };
  },
);

const NOW: Date = new Date("2026-09-14T12:00:00.000Z");

const HEALTHY_PLATFORM: ConnectorPlatformStatus = {
  workerConsumers: 2,
  schedulerRegistered: true,
  schedulerNextRunAt: "2026-09-14T12:01:00.000Z",
  queueWaiting: 0,
  queueFailed: 0,
  storageReachable: true,
};

let tenant: GoogleSecOpsTenant;
let recordedRuns: Array<SecurityEventConnectionRun>;

function savedConnection(
  changes: Partial<SecurityEventConnection> = {},
): SecurityEventConnection {
  return secOpsConnection({
    createdAt: new Date(NOW.getTime() - HOUR_MS),
    lastPolledAt: new Date(NOW.getTime() - MINUTE_MS),
    lastSuccessfulPollAt: new Date(NOW.getTime() - MINUTE_MS),
    ...changes,
  });
}

function unsavedConnection(): SecurityEventConnection {
  const connection: SecurityEventConnection = secOpsConnection();
  delete connection._id;
  return connection;
}

function keysOf(report: SecurityConnectorTestReport): Array<string> {
  return report.checks.map((check: SecurityConnectorCheck): string => {
    return check.key;
  });
}

beforeEach(() => {
  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  recordedRuns = [];
  getJestSpyOn(
    SecurityEventConnectionRunService,
    "findOneBy",
  ).mockResolvedValue(null as never);
  getJestSpyOn(SecurityEventConnectionRunService, "create").mockImplementation(
    ((data: {
      data: SecurityEventConnectionRun;
    }): Promise<SecurityEventConnectionRun> => {
      recordedRuns.push(data.data);
      return Promise.resolve(data.data);
    }) as never,
  );
  getJestSpyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
  getJestSpyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);

  /*
   * Two rule detections created in the last day and one three days ago, all
   * alerting, so every read probe and both availability ranges find records.
   */
  tenant = new GoogleSecOpsTenant();
  tenant.add({
    id: "r1",
    createdMs: NOW.getTime() - HOUR_MS,
    detectionMs: NOW.getTime() - HOUR_MS - 2 * MINUTE_MS,
  });
  tenant.add({
    id: "r2",
    createdMs: NOW.getTime() - 2 * HOUR_MS,
    detectionMs: NOW.getTime() - 2 * HOUR_MS - 2 * MINUTE_MS,
  });
  tenant.add({
    id: "r3",
    createdMs: NOW.getTime() - 3 * DAY_MS,
    detectionMs: NOW.getTime() - 3 * DAY_MS - 2 * MINUTE_MS,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  (
    SecurityEventConnectorRegistry.getConnector as unknown as jest.Mock
  ).mockReset();
});

async function runTest(
  data: {
    connection?: SecurityEventConnection | undefined;
    platform?: ConnectorPlatformStatus | undefined;
    recordRun?: boolean | undefined;
  } = {},
): Promise<SecurityConnectorTestReport> {
  return SecurityEventConnectionTester.test({
    settings: secOpsSettings(),
    connection: data.connection,
    connectorOverride: tenant.connector(),
    ...(data.platform ? { platformOverride: data.platform } : {}),
    ...(data.recordRun !== undefined ? { recordRun: data.recordRun } : {}),
  });
}

describe("Google SecOps Test connection through the shared tester", () => {
  test("the per-request deadline for a test is 20 seconds, and it reaches the Google client", async () => {
    const deadlines: Array<number> = [];
    const factory: GoogleSecOpsClientFactory = (data: {
      region: string;
      instanceResourceName: string;
      serviceAccountJson: string;
      requestTimeoutInMs: number;
    }): GoogleSecOpsClient => {
      deadlines.push(data.requestTimeoutInMs);
      return new GoogleSecOpsClient({
        ...data,
        fetchImplementation: tenant.fetch,
      });
    };

    const report: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: secOpsSettings(),
        connection: savedConnection(),
        connectorOverride: new GoogleSecOpsConnector(undefined, factory),
        platformOverride: HEALTHY_PLATFORM,
      });

    expect(CONNECTION_TEST_REQUEST_TIMEOUT_IN_MS).toBe(20_000);
    // One client per test, built with the test's deadline, not the poll's minute.
    expect(deadlines).toEqual([20_000]);
    expect(report.status).toBe("pass");
  });

  test("a healthy saved connection passes every check, in order, and records a test run", async () => {
    const report: SecurityConnectorTestReport = await runTest({
      connection: savedConnection(),
      platform: HEALTHY_PLATFORM,
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
    /*
     * The retired tester named its first step after the connection's own
     * validation; the shared tester's is "Configuration", worded from the
     * catalog title.
     */
    expect(findCheck(report.checks, "configuration")).toMatchObject({
      name: "Configuration",
      status: "pass",
      message:
        "The Google SecOps configuration and credentials are present and well formed.",
    });
    // Counted over the simulated tenant, under both Data to import selections.
    expect(report.counts).toEqual({
      scope: "alerts-only",
      alertsViewLast24h: 2,
      alertsViewLast7d: 3,
      ruleDetectionsCreatedLast24h: "2",
      ruleDetectionsCreatedLast7d: "3",
      hasMoreLast7d: false,
      otherScope: {
        scope: "alerts-and-detections",
        alertsViewLast24h: 2,
        alertsViewLast7d: 3,
        ruleDetectionsCreatedLast24h: "2",
        ruleDetectionsCreatedLast7d: "3",
        hasMoreLast7d: false,
      },
    });
    // One sample per read probe that returned a record: the rule read and the alerts view.
    expect(report.samples).toEqual([
      {
        id: "r1",
        title: "Rule for r1",
        severity: "High",
        createdTime: new Date(NOW.getTime() - HOUR_MS).toISOString(),
        eventTime: new Date(
          NOW.getTime() - HOUR_MS - 2 * MINUTE_MS,
        ).toISOString(),
      },
      expect.objectContaining({ id: "r1" }),
    ]);
    expect(report.summary).toMatch(/workers and scheduler are running/);

    // One run-history row, of type test, never carrying credentials.
    expect(recordedRuns).toHaveLength(1);
    expect(recordedRuns[0]).toMatchObject({
      projectId: PROJECT_ID,
      securityEventConnectionId: CONNECTION_ID,
      type: "test",
      status: "success",
      request: { type: "test", synchronous: true },
    });
    expect(recordedRuns[0]!.completedAt).toBeInstanceOf(Date);
    const stored: string = JSON.stringify(recordedRuns[0]!.result);
    expect(stored).not.toContain("serviceAccountJson");
    expect(stored).not.toContain(PRIVATE_KEY.split("\n")[1]!);
    // The token exchange and every probe went to the tenant, and nothing else did.
    expect(
      tenant.requests.every((request: TenantRequest): boolean => {
        return request.route !== "unknown";
      }),
    ).toBe(true);
  });

  test("a platform failure fails the report even when Google is healthy", async () => {
    const report: SecurityConnectorTestReport = await runTest({
      connection: savedConnection(),
      platform: { ...HEALTHY_PLATFORM, workerConsumers: 0 },
    });

    expect(findCheck(report.checks, "authentication").status).toBe("pass");
    expect(findCheck(report.checks, "detections-available").status).toBe(
      "pass",
    );
    expect(findCheck(report.checks, "worker-consumers").status).toBe("fail");
    expect(report.status).toBe("fail");
    expect(report.summary).toMatch(/Background workers/);
    expect(recordedRuns[0]).toMatchObject({ status: "failed" });
  });

  test("the schedule check reads the connection row and the oldest pending run", async () => {
    const pending: SecurityEventConnectionRun =
      new SecurityEventConnectionRun();
    pending.createdAt = new Date(NOW.getTime() - 10 * MINUTE_MS);
    getJestSpyOn(
      SecurityEventConnectionRunService,
      "findOneBy",
    ).mockResolvedValue(pending as never);

    const report: SecurityConnectorTestReport = await runTest({
      connection: savedConnection(),
      platform: HEALTHY_PLATFORM,
    });

    /*
     * The retired tester queried GoogleSecOpsConnectionRun by
     * googleSecOpsConnectionId; runs now live on SecurityEventConnectionRun.
     */
    expect(SecurityEventConnectionRunService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          securityEventConnectionId: CONNECTION_ID,
        }),
        props: { isRoot: true },
      }),
    );
    expect(findCheck(report.checks, "connection-schedule")).toMatchObject({
      status: "fail",
      message: expect.stringContaining("no worker has picked it up"),
    });
    expect(report.status).toBe("fail");
  });

  /*
   * Review finding edit-form-test-ignores-edited-settings: the API tests the
   * edit form's unsaved values against the stored row and asks for no run
   * row, because a row would describe settings the connection does not have.
   * The saved connection's schedule is still reported.
   */
  test("a saved connection tested with unsaved edits records no run row", async () => {
    const report: SecurityConnectorTestReport = await runTest({
      connection: savedConnection(),
      platform: HEALTHY_PLATFORM,
      recordRun: false,
    });

    expect(report.status).toBe("pass");
    expect(keysOf(report)).toContain("connection-schedule");
    expect(SecurityEventConnectionRunService.create).not.toHaveBeenCalled();
    expect(recordedRuns).toHaveLength(0);
  });

  test("unsaved settings get no schedule check and write nothing", async () => {
    const report: SecurityConnectorTestReport = await runTest({
      connection: unsavedConnection(),
      platform: HEALTHY_PLATFORM,
    });

    expect(keysOf(report)).not.toContain("connection-schedule");
    expect(report.status).toBe("pass");
    expect(SecurityEventConnectionRunService.findOneBy).not.toHaveBeenCalled();
    expect(SecurityEventConnectionRunService.create).not.toHaveBeenCalled();
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
    ).mockResolvedValue(new Set() as never);

    const report: SecurityConnectorTestReport = await runTest({
      connection: savedConnection(),
    });

    expect(report.status).toBe("pass");
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
    getJestSpyOn(SecurityEventConnectionRunService, "create").mockRejectedValue(
      new Error("database unavailable") as never,
    );

    const report: SecurityConnectorTestReport = await runTest({
      connection: savedConnection(),
      platform: HEALTHY_PLATFORM,
    });

    expect(report.status).toBe("pass");
    expect(logger.error).toHaveBeenCalled();
    const logged: string = (logger.error as unknown as jest.Mock).mock.calls
      .map((call: Array<unknown>): string => {
        return String(call[0]);
      })
      .join(" ");
    // The log names the connection whose history could not be written.
    expect(logged).toContain(CONNECTION_ID.toString());
    expect(keysOf(report)).toContain("connection-schedule");
  });
});
