import SecurityEventConnection from "../../../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionRun from "../../../../../Models/DatabaseModels/SecurityEventConnectionRun";
import Queue from "../../../../../Server/Infrastructure/Queue";
import SecurityEventConnectionRunService from "../../../../../Server/Services/SecurityEventConnectionRunService";
import logger from "../../../../../Server/Utils/Logger";
import SecurityEventConnectionTester, {
  CONNECTION_TEST_REQUEST_TIMEOUT_IN_MS,
} from "../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionTester";
import SecurityEventConnectorRegistry from "../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry";
import {
  ConnectorTestOptions,
  SecurityConnectorSettings,
  SecurityEventConnector,
} from "../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import SecurityEventDedupe from "../../../../../Server/Utils/SecurityEvent/SecurityEventDedupe";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  ConnectorPlatformStatus,
  SecurityConnectorCheck,
  SecurityConnectorTestReport,
} from "../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
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
 * The synchronous "Test connection" for the Security Event Connections
 * framework. It composes three things the customer needs answered in
 * order - can the source be reached, is OneUptime itself running, is this
 * connection's schedule healthy - and records the answer in run history.
 * The provider half is a fake connector; the platform half is either an
 * override or the real ConnectorPlatformHealth over a fake queue, so the
 * storage probe's routing through the dedupe lookup is observable.
 */

jest.mock(
  "../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry",
  () => {
    return {
      __esModule: true,
      default: { getConnector: jest.fn() },
    };
  },
);

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROVIDER: SecurityEventConnectorProvider =
  SecurityEventConnectorProvider.MicrosoftSentinel;
const DEFINITION: SecurityEventConnectorDefinition =
  getSecurityEventConnectorDefinition(PROVIDER)!;
const SECRET_VALUE: string = "sentinel-client-secret-7c6b5a";
const MINUTE_MS: number = 60 * 1000;

const SETTINGS: SecurityConnectorSettings = {
  provider: PROVIDER,
  config: {
    tenantId: "00000000-0000-4000-8000-000000000001",
    clientId: "00000000-0000-4000-8000-000000000002",
    subscriptionId: "00000000-0000-4000-8000-000000000003",
    resourceGroup: "rg-security",
    workspaceName: "la-security",
    cloud: "public",
  },
  secrets: { clientSecret: SECRET_VALUE },
  alertingOnly: true,
};

const HEALTHY_PLATFORM: ConnectorPlatformStatus = {
  workerConsumers: 2,
  schedulerRegistered: true,
  schedulerNextRunAt: "2026-09-10T12:01:00.000Z",
  queueWaiting: 0,
  queueFailed: 0,
  storageReachable: true,
};

function check(
  key: string,
  status: SecurityConnectorCheck["status"],
  message: string = `${key} ${status}`,
): SecurityConnectorCheck {
  return { key, name: `Check ${key}`, status, durationMs: 1, message };
}

interface FakeConnector {
  connector: SecurityEventConnector;
  testCalls: Array<{
    settings: SecurityConnectorSettings;
    options: ConnectorTestOptions;
  }>;
  validateCalls: Array<SecurityConnectorSettings>;
}

function makeFakeConnector(script: {
  checks?: Array<SecurityConnectorCheck> | Error | undefined;
  validate?: Error | undefined;
}): FakeConnector {
  const fake: FakeConnector = {
    connector: {
      provider: PROVIDER,
      validateSettings: (settings: SecurityConnectorSettings): void => {
        fake.validateCalls.push(settings);
        if (script.validate) {
          throw script.validate;
        }
      },
      testConnection: (
        settings: SecurityConnectorSettings,
        options: ConnectorTestOptions,
      ): Promise<Array<SecurityConnectorCheck>> => {
        fake.testCalls.push({ settings, options });
        if (script.checks instanceof Error) {
          return Promise.reject(script.checks);
        }
        return Promise.resolve(script.checks || []);
      },
      fetchEvents: (): Promise<never> => {
        return Promise.reject(new Error("fetchEvents must not run in a test"));
      },
    },
    testCalls: [],
    validateCalls: [],
  };

  return fake;
}

function makeSavedConnection(
  overrides: Partial<SecurityEventConnection> = {},
): SecurityEventConnection {
  const connection: SecurityEventConnection = new SecurityEventConnection();
  connection._id = CONNECTION_ID.toString();
  connection.projectId = PROJECT_ID;
  connection.name = "Sentinel production";
  connection.provider = PROVIDER;
  connection.isEnabled = true;
  connection.pollIntervalInMinutes = 5;
  connection.createdAt = new Date(Date.now() - 60 * MINUTE_MS);
  connection.lastPolledAt = new Date(Date.now() - MINUTE_MS);
  connection.lastSuccessfulPollAt = new Date(Date.now() - MINUTE_MS);
  connection.secrets = JSON.stringify(SETTINGS.secrets);
  Object.assign(connection, overrides);
  return connection;
}

function keysAndStatuses(report: SecurityConnectorTestReport): Array<string> {
  return report.checks.map((item: SecurityConnectorCheck): string => {
    return `${item.key}:${item.status}`;
  });
}

function findCheck(
  report: SecurityConnectorTestReport,
  key: string,
): SecurityConnectorCheck {
  const found: SecurityConnectorCheck | undefined = report.checks.find(
    (candidate: SecurityConnectorCheck): boolean => {
      return candidate.key === key;
    },
  );
  expect({ key, found: found !== undefined }).toEqual({ key, found: true });
  return found!;
}

let createdRuns: Array<SecurityEventConnectionRun>;

beforeEach(() => {
  createdRuns = [];
  getJestSpyOn(
    SecurityEventConnectionRunService,
    "findOneBy",
  ).mockResolvedValue(null as never);
  getJestSpyOn(SecurityEventConnectionRunService, "create").mockImplementation(
    ((data: {
      data: SecurityEventConnectionRun;
    }): Promise<SecurityEventConnectionRun> => {
      createdRuns.push(data.data);
      return Promise.resolve(data.data);
    }) as never,
  );
  getJestSpyOn(SecurityEventDedupe, "findExistingEventUids").mockResolvedValue(
    new Set() as never,
  );
  getJestSpyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  (
    SecurityEventConnectorRegistry.getConnector as unknown as jest.Mock
  ).mockReset();
});

describe("SecurityEventConnectionTester.test - provider checks", () => {
  test("a passing connector produces configuration, provider and platform checks in order", async () => {
    const fake: FakeConnector = makeFakeConnector({
      checks: [
        check("authentication", "pass"),
        check("read-permission", "pass"),
        check("detections-available", "pass"),
      ],
    });

    const report: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: SETTINGS,
        connectorOverride: fake.connector,
        platformOverride: HEALTHY_PLATFORM,
      });

    expect(report.provider).toBe(PROVIDER);
    expect(report.status).toBe("pass");
    expect(keysAndStatuses(report)).toEqual([
      "configuration:pass",
      "authentication:pass",
      "read-permission:pass",
      "detections-available:pass",
      "worker-consumers:pass",
      "scheduler:pass",
      "storage:pass",
    ]);
    expect(findCheck(report, "configuration").message).toBe(
      `The ${DEFINITION.title} configuration and credentials are present and well formed.`,
    );
    expect(report.platform).toEqual(HEALTHY_PLATFORM);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(report.completedAt)).toBeGreaterThanOrEqual(
      Date.parse(report.startedAt),
    );
    expect(fake.validateCalls).toEqual([SETTINGS]);
    // The registry is bypassed when a connector is injected.
    expect(SecurityEventConnectorRegistry.getConnector).not.toHaveBeenCalled();
  });

  test("the connector is asked with the test timeout by default and a custom one when given", async () => {
    const fake: FakeConnector = makeFakeConnector({});

    await SecurityEventConnectionTester.test({
      settings: SETTINGS,
      connectorOverride: fake.connector,
      platformOverride: HEALTHY_PLATFORM,
    });
    await SecurityEventConnectionTester.test({
      settings: SETTINGS,
      connectorOverride: fake.connector,
      platformOverride: HEALTHY_PLATFORM,
      requestTimeoutInMs: 5000,
    });

    expect(CONNECTION_TEST_REQUEST_TIMEOUT_IN_MS).toBe(20 * 1000);
    expect(fake.testCalls).toEqual([
      {
        settings: SETTINGS,
        options: { requestTimeoutInMs: CONNECTION_TEST_REQUEST_TIMEOUT_IN_MS },
      },
      { settings: SETTINGS, options: { requestTimeoutInMs: 5000 } },
    ]);
  });

  test("without an override the connector comes from the registry", async () => {
    const fake: FakeConnector = makeFakeConnector({
      checks: [check("authentication", "pass")],
    });
    (
      SecurityEventConnectorRegistry.getConnector as unknown as jest.Mock
    ).mockReturnValue(fake.connector);

    const report: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: SETTINGS,
        platformOverride: HEALTHY_PLATFORM,
      });

    expect(SecurityEventConnectorRegistry.getConnector).toHaveBeenCalledWith(
      PROVIDER,
    );
    expect(report.status).toBe("pass");
    expect(fake.testCalls).toHaveLength(1);
  });

  test("a configuration failure short-circuits the provider checks with a skip and contacts nothing", async () => {
    const fake: FakeConnector = makeFakeConnector({
      validate: new BadDataException(
        `Client secret rejected: client_secret=${SECRET_VALUE}`,
      ),
      checks: [check("authentication", "pass")],
    });

    const report: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: SETTINGS,
        connectorOverride: fake.connector,
        platformOverride: HEALTHY_PLATFORM,
      });

    expect(report.status).toBe("fail");
    expect(keysAndStatuses(report)).toEqual([
      "configuration:fail",
      "authentication:skip",
      "worker-consumers:pass",
      "scheduler:pass",
      "storage:pass",
    ]);
    expect(fake.testCalls).toHaveLength(0);

    const configuration: SecurityConnectorCheck = findCheck(
      report,
      "configuration",
    );
    expect(configuration.message).toContain("Client secret rejected");
    expect(configuration.message).not.toContain(SECRET_VALUE);
    expect(configuration.remediation).toContain("Nothing was contacted");

    const skipped: SecurityConnectorCheck = findCheck(report, "authentication");
    expect(skipped.name).toBe(`Check access to ${DEFINITION.title}`);
    expect(skipped.message).toBe(
      "Skipped because the configuration check failed.",
    );
    expect(JSON.stringify(report)).not.toContain(SECRET_VALUE);
  });

  test("a registry miss (unknown provider) is a configuration failure with the raw provider as title", async () => {
    (
      SecurityEventConnectorRegistry.getConnector as unknown as jest.Mock
    ).mockImplementation(() => {
      throw new BadDataException(
        "No connector is registered for security event provider: mystery",
      );
    });

    const report: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: {
          ...SETTINGS,
          provider: "mystery" as SecurityEventConnectorProvider,
        },
        platformOverride: HEALTHY_PLATFORM,
      });

    expect(report.provider).toBe("mystery");
    expect(report.status).toBe("fail");
    expect(findCheck(report, "configuration").message).toContain(
      "No connector is registered",
    );
    expect(findCheck(report, "authentication").name).toBe(
      "Check access to mystery",
    );
  });

  test("a connector that throws instead of reporting becomes a provider-error check, redacted", async () => {
    const fake: FakeConnector = makeFakeConnector({
      checks: new Error(
        `Sentinel token exchange failed (HTTP 401): client_secret=${SECRET_VALUE}`,
      ),
    });

    const report: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: SETTINGS,
        connectorOverride: fake.connector,
        platformOverride: HEALTHY_PLATFORM,
      });

    expect(report.status).toBe("fail");
    const providerError: SecurityConnectorCheck = findCheck(
      report,
      "provider-error",
    );
    expect(providerError.status).toBe("fail");
    expect(providerError.name).toBe(`Check access to ${DEFINITION.title}`);
    expect(providerError.message).toContain("Sentinel token exchange failed");
    expect(providerError.message).not.toContain(SECRET_VALUE);
    expect(JSON.stringify(report)).not.toContain(SECRET_VALUE);
  });

  test("provider checks are appended verbatim, including warnings, and fold into the verdict", async () => {
    const fake: FakeConnector = makeFakeConnector({
      checks: [
        check("authentication", "pass"),
        check("read-permission", "pass"),
        check(
          "detections-available",
          "warn",
          "No incidents were created in the last 7 days.",
        ),
      ],
    });

    const report: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: SETTINGS,
        connectorOverride: fake.connector,
        platformOverride: HEALTHY_PLATFORM,
      });

    expect(report.status).toBe("warn");
    expect(findCheck(report, "detections-available")).toEqual(
      check(
        "detections-available",
        "warn",
        "No incidents were created in the last 7 days.",
      ),
    );
  });
});

describe("SecurityEventConnectionTester.test - platform checks", () => {
  test("platform checks come from the override and a dead worker pool fails the report", async () => {
    const fake: FakeConnector = makeFakeConnector({
      checks: [check("authentication", "pass")],
    });

    const report: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: SETTINGS,
        connectorOverride: fake.connector,
        platformOverride: {
          ...HEALTHY_PLATFORM,
          workerConsumers: 0,
          schedulerRegistered: false,
          storageReachable: null,
        },
      });

    expect(report.status).toBe("fail");
    expect(findCheck(report, "worker-consumers").status).toBe("fail");
    expect(findCheck(report, "worker-consumers").remediation).toContain(
      "DISABLE_QUEUE_WORKERS=false",
    );
    expect(findCheck(report, "scheduler").status).toBe("fail");
    expect(findCheck(report, "storage").status).toBe("warn");
    expect(report.platform?.workerConsumers).toBe(0);
  });

  test("without an override the storage probe runs the same dedupe lookup the poller runs, scoped to the connection", async () => {
    getJestSpyOn(Queue, "getQueue").mockReturnValue({
      getWorkersCount: (): Promise<number> => {
        return Promise.resolve(1);
      },
      getJobSchedulers: (): Promise<Array<{ id: string }>> => {
        return Promise.resolve([
          { id: "SecurityEvents-PollSecurityEventConnections" },
        ]);
      },
      getWaitingCount: (): Promise<number> => {
        return Promise.resolve(0);
      },
      getFailedCount: (): Promise<number> => {
        return Promise.resolve(0);
      },
    } as never);
    const fake: FakeConnector = makeFakeConnector({
      checks: [check("authentication", "pass")],
    });

    const report: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: SETTINGS,
        connection: makeSavedConnection(),
        connectorOverride: fake.connector,
      });

    expect(SecurityEventDedupe.findExistingEventUids).toHaveBeenCalledTimes(1);
    expect(SecurityEventDedupe.findExistingEventUids).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      vendorName: DEFINITION.vendorName,
      productName: DEFINITION.productName,
      ids: ["oneuptime-connection-test-probe"],
    });
    expect(report.platform).toEqual({
      workerConsumers: 1,
      schedulerRegistered: true,
      queueWaiting: 0,
      queueFailed: 0,
      storageReachable: true,
    });
    expect(findCheck(report, "storage").status).toBe("pass");
    expect(report.status).toBe("pass");
  });

  test("an unsaved test probes storage under a throwaway project id, never a null one", async () => {
    getJestSpyOn(Queue, "getQueue").mockImplementation((): never => {
      throw new Error("Redis is not configured");
    });
    const fake: FakeConnector = makeFakeConnector({});

    await SecurityEventConnectionTester.test({
      settings: SETTINGS,
      connectorOverride: fake.connector,
    });

    const call: { projectId: ObjectID } = (
      SecurityEventDedupe.findExistingEventUids as unknown as jest.Mock
    ).mock.calls[0]![0] as { projectId: ObjectID };
    expect(call.projectId).toBeInstanceOf(ObjectID);
    expect(ObjectID.isValidUUID(call.projectId.toString())).toBe(true);
  });

  test("a dedupe lookup that throws fails the storage check with the ClickHouse remediation", async () => {
    getJestSpyOn(Queue, "getQueue").mockImplementation((): never => {
      throw new Error("Redis is not configured");
    });
    getJestSpyOn(
      SecurityEventDedupe,
      "findExistingEventUids",
    ).mockRejectedValue(new Error("Cluster oneuptime not found") as never);
    const fake: FakeConnector = makeFakeConnector({
      checks: [check("authentication", "pass")],
    });

    const report: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: SETTINGS,
        connectorOverride: fake.connector,
      });

    expect(report.status).toBe("fail");
    expect(report.platform?.storageReachable).toBe(false);
    const storage: SecurityConnectorCheck = findCheck(report, "storage");
    expect(storage.status).toBe("fail");
    expect(storage.remediation).toContain("CLICKHOUSE_");
    // Redis being down is "unknown", not a failure of the source.
    expect(findCheck(report, "worker-consumers").status).toBe("warn");
    expect(findCheck(report, "scheduler").status).toBe("warn");
  });

  test("a platform override skips every real probe", async () => {
    const getQueue: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      Queue,
      "getQueue",
    );
    const fake: FakeConnector = makeFakeConnector({});

    await SecurityEventConnectionTester.test({
      settings: SETTINGS,
      connectorOverride: fake.connector,
      platformOverride: HEALTHY_PLATFORM,
    });

    expect(getQueue).not.toHaveBeenCalled();
    expect(SecurityEventDedupe.findExistingEventUids).not.toHaveBeenCalled();
  });
});

describe("SecurityEventConnectionTester.test - schedule check", () => {
  test("an unsaved connection gets no schedule check and no run row", async () => {
    const fake: FakeConnector = makeFakeConnector({});

    const report: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: SETTINGS,
        connectorOverride: fake.connector,
        platformOverride: HEALTHY_PLATFORM,
      });

    expect(
      report.checks.some((item: SecurityConnectorCheck): boolean => {
        return item.key === "connection-schedule";
      }),
    ).toBe(false);
    expect(SecurityEventConnectionRunService.findOneBy).not.toHaveBeenCalled();
    expect(SecurityEventConnectionRunService.create).not.toHaveBeenCalled();
  });

  test("a saved connection gets a schedule check read off its row and pending runs", async () => {
    const fake: FakeConnector = makeFakeConnector({
      checks: [check("authentication", "pass")],
    });
    const lastEventIngestedAt: Date = new Date(Date.now() - 3 * MINUTE_MS);

    const report: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: SETTINGS,
        connection: makeSavedConnection({ lastEventIngestedAt }),
        connectorOverride: fake.connector,
        platformOverride: HEALTHY_PLATFORM,
      });

    expect(SecurityEventConnectionRunService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          securityEventConnectionId: CONNECTION_ID,
        }),
        props: { isRoot: true },
      }),
    );
    const schedule: SecurityConnectorCheck = findCheck(
      report,
      "connection-schedule",
    );
    expect(schedule.status).toBe("pass");
    expect(schedule.message).toContain(
      `last event imported ${lastEventIngestedAt.toISOString()}`,
    );
    expect(report.checks[report.checks.length - 1]!.key).toBe(
      "connection-schedule",
    );
  });

  test("a queued run nobody picked up fails the schedule check", async () => {
    const pendingCreatedAt: Date = new Date(Date.now() - 10 * MINUTE_MS);
    getJestSpyOn(
      SecurityEventConnectionRunService,
      "findOneBy",
    ).mockResolvedValue({
      id: new ObjectID("33333333-3333-4333-8333-333333333333"),
      createdAt: pendingCreatedAt,
    } as never);
    const fake: FakeConnector = makeFakeConnector({
      checks: [check("authentication", "pass")],
    });

    const report: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: SETTINGS,
        connection: makeSavedConnection(),
        connectorOverride: fake.connector,
        platformOverride: HEALTHY_PLATFORM,
      });

    expect(report.status).toBe("fail");
    const schedule: SecurityConnectorCheck = findCheck(
      report,
      "connection-schedule",
    );
    expect(schedule.status).toBe("fail");
    expect(schedule.message).toContain(pendingCreatedAt.toISOString());
  });

  test("a disabled connection warns in the schedule check", async () => {
    const fake: FakeConnector = makeFakeConnector({
      checks: [check("authentication", "pass")],
    });

    const report: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: SETTINGS,
        connection: makeSavedConnection({ isEnabled: false }),
        connectorOverride: fake.connector,
        platformOverride: HEALTHY_PLATFORM,
      });

    expect(report.status).toBe("warn");
    expect(findCheck(report, "connection-schedule").status).toBe("warn");
  });

  test("a stored lastError surfaces in the schedule check", async () => {
    const fake: FakeConnector = makeFakeConnector({
      checks: [check("authentication", "pass")],
    });

    const report: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: SETTINGS,
        connection: makeSavedConnection({
          lastError: "Sentinel incidents read failed (HTTP 403): forbidden",
        }),
        connectorOverride: fake.connector,
        platformOverride: HEALTHY_PLATFORM,
      });

    expect(findCheck(report, "connection-schedule").message).toBe(
      "The last poll attempt failed: Sentinel incidents read failed (HTTP 403): forbidden",
    );
  });

  test("a failed pending-run read is logged and the schedule check still comes from the row", async () => {
    getJestSpyOn(
      SecurityEventConnectionRunService,
      "findOneBy",
    ).mockRejectedValue(new Error("database unavailable") as never);
    const fake: FakeConnector = makeFakeConnector({
      checks: [check("authentication", "pass")],
    });

    const report: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: SETTINGS,
        connection: makeSavedConnection(),
        connectorOverride: fake.connector,
        platformOverride: HEALTHY_PLATFORM,
      });

    expect(findCheck(report, "connection-schedule").status).toBe("pass");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not read pending runs"),
    );
  });
});

describe("SecurityEventConnectionTester.test - summary", () => {
  test("a passing report says everything is reachable and running", async () => {
    const fake: FakeConnector = makeFakeConnector({
      checks: [check("authentication", "pass")],
    });

    const report: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: SETTINGS,
        connectorOverride: fake.connector,
        platformOverride: HEALTHY_PLATFORM,
      });

    expect(report.summary).toBe(
      `${DEFINITION.title} is reachable, credentials are accepted, records can be read, and OneUptime's workers and scheduler are running.`,
    );
  });

  test("a warning report names the checks that need attention, singular and plural", async () => {
    const one: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: SETTINGS,
        connectorOverride: makeFakeConnector({
          checks: [check("detections-available", "warn")],
        }).connector,
        platformOverride: HEALTHY_PLATFORM,
      });
    const two: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: SETTINGS,
        connectorOverride: makeFakeConnector({
          checks: [check("detections-available", "warn")],
        }).connector,
        platformOverride: { ...HEALTHY_PLATFORM, workerConsumers: null },
      });

    expect(one.summary).toBe(
      `${DEFINITION.title} is reachable and readable. 1 check needs attention: Check detections-available.`,
    );
    expect(two.summary).toBe(
      `${DEFINITION.title} is reachable and readable. 2 checks need attention: Check detections-available, Background workers.`,
    );
  });

  test("a failing report counts and names the failed checks, singular and plural", async () => {
    const one: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: SETTINGS,
        connectorOverride: makeFakeConnector({
          checks: [check("authentication", "fail")],
        }).connector,
        platformOverride: HEALTHY_PLATFORM,
      });
    const two: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: SETTINGS,
        connectorOverride: makeFakeConnector({
          checks: [check("authentication", "fail"), check("read", "warn")],
        }).connector,
        platformOverride: { ...HEALTHY_PLATFORM, storageReachable: false },
      });

    expect(one.summary).toBe(
      "1 check failed: Check authentication. Follow the remediation under each failed check.",
    );
    expect(two.summary).toBe(
      "2 checks failed: Check authentication, Security event storage. Follow the remediation under each failed check.",
    );
  });
});

describe("SecurityEventConnectionTester.test - run history", () => {
  test("a saved connection records a synchronous test run carrying the report, never the secrets", async () => {
    const fake: FakeConnector = makeFakeConnector({
      checks: [check("authentication", "pass")],
    });

    const report: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: SETTINGS,
        connection: makeSavedConnection(),
        connectorOverride: fake.connector,
        platformOverride: HEALTHY_PLATFORM,
      });

    expect(SecurityEventConnectionRunService.create).toHaveBeenCalledWith({
      data: expect.any(SecurityEventConnectionRun),
      props: { isRoot: true },
    });
    expect(createdRuns).toHaveLength(1);
    const run: SecurityEventConnectionRun = createdRuns[0]!;
    expect(run.projectId).toEqual(PROJECT_ID);
    expect(run.securityEventConnectionId).toEqual(CONNECTION_ID);
    expect(run.type).toBe("test");
    expect(run.status).toBe("success");
    expect(run.startedAt).toEqual(new Date(report.startedAt));
    expect(run.completedAt).toEqual(new Date(report.completedAt));
    expect(run.request).toEqual({ type: "test", synchronous: true });
    expect(run.result).toBe(report);
    expect(run.error).toBe("");
    expect(JSON.stringify(run.result)).not.toContain(SECRET_VALUE);
    expect(JSON.stringify(run.request)).not.toContain(SECRET_VALUE);
  });

  test("a failed test is recorded as a failed run whose error is the summary", async () => {
    const fake: FakeConnector = makeFakeConnector({
      checks: [
        check(
          "authentication",
          "fail",
          `Token exchange failed (HTTP 401): client_secret=${SECRET_VALUE}`,
        ),
      ],
    });

    const report: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: SETTINGS,
        connection: makeSavedConnection(),
        connectorOverride: fake.connector,
        platformOverride: HEALTHY_PLATFORM,
      });

    expect(report.status).toBe("fail");
    const run: SecurityEventConnectionRun = createdRuns[0]!;
    expect(run.status).toBe("failed");
    expect(run.error).toBe(report.summary);
    /*
     * The connector's own message is stored as the connector wrote it; the
     * connector is responsible for redacting its checks (the tester only
     * redacts what it catches). Pin that the summary never repeats it.
     */
    expect(run.error).not.toContain(SECRET_VALUE);
  });

  test("a warning test is recorded as a successful run", async () => {
    const fake: FakeConnector = makeFakeConnector({
      checks: [check("detections-available", "warn")],
    });

    await SecurityEventConnectionTester.test({
      settings: SETTINGS,
      connection: makeSavedConnection(),
      connectorOverride: fake.connector,
      platformOverride: HEALTHY_PLATFORM,
    });

    expect(createdRuns[0]!.status).toBe("success");
    expect(createdRuns[0]!.error).toBe("");
  });

  test("a connection with an id but no project is not recorded", async () => {
    const fake: FakeConnector = makeFakeConnector({});
    const orphan: SecurityEventConnection = makeSavedConnection();
    delete orphan.projectId;

    await SecurityEventConnectionTester.test({
      settings: SETTINGS,
      connection: orphan,
      connectorOverride: fake.connector,
      platformOverride: HEALTHY_PLATFORM,
    });

    expect(SecurityEventConnectionRunService.create).not.toHaveBeenCalled();
  });

  test("a failed run-history write is logged and the report is still returned", async () => {
    getJestSpyOn(SecurityEventConnectionRunService, "create").mockRejectedValue(
      new Error("database unavailable") as never,
    );
    const fake: FakeConnector = makeFakeConnector({
      checks: [check("authentication", "pass")],
    });

    const report: SecurityConnectorTestReport =
      await SecurityEventConnectionTester.test({
        settings: SETTINGS,
        connection: makeSavedConnection(),
        connectorOverride: fake.connector,
        platformOverride: HEALTHY_PLATFORM,
      });

    expect(report.status).toBe("pass");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not record the test run"),
    );
  });
});
