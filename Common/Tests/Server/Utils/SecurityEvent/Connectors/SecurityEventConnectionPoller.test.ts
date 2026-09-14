import SecurityEventConnection from "../../../../../Models/DatabaseModels/SecurityEventConnection";
import Semaphore, {
  SemaphoreLockTimeoutError,
} from "../../../../../Server/Infrastructure/Semaphore";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventConnectionService from "../../../../../Server/Services/SecurityEventConnectionService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import logger from "../../../../../Server/Utils/Logger";
import ConnectorErrorMessage from "../../../../../Server/Utils/SecurityEvent/ConnectorErrorMessage";
import SecurityEventConnectionPoller, {
  DEFAULT_INITIAL_LOOKBACK_IN_MINUTES,
  MAX_DIAGNOSTIC_SAMPLES,
  MAX_EVENTS_PER_RUN,
  MAX_FETCH_REQUESTS,
  MAX_LOOKBACK_IN_MINUTES,
  MAX_RANGE_MS,
  POLL_REQUEST_TIMEOUT_IN_MS,
  PollerOverrides,
  RecordedConnectionPollFailure,
  SECURITY_EVENT_SOURCE_LOCK_NAMESPACE,
  WINDOW_OVERLAP_IN_MINUTES,
} from "../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionPoller";
import SecurityEventConnectorRegistry from "../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry";
import {
  ConnectorFetchOptions,
  ConnectorFetchResult,
  ConnectorFetchWindow,
  ConnectorTestOptions,
  SecurityConnectorSettings,
  SecurityEventConnector,
} from "../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import SecurityEventDedupe from "../../../../../Server/Utils/SecurityEvent/SecurityEventDedupe";
import ThreatIntelEnricher from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { SecurityConnectorCheck } from "../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import {
  SecurityEventConnectionRunOptions,
  SecurityEventConnectionRunResult,
} from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../../Types/SecurityEvent/OcsfSeverity";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
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
 * The generic poll loop behind every Security Event Connection, tested
 * with a fake connector injected through PollerOverrides so nothing here
 * depends on any one provider's HTTP behaviour. What is pinned is the
 * part that decides whether records are lost, duplicated or silently stop
 * flowing: the window arithmetic, when the cursor may move, how failures
 * are booked onto the connection row, the dedupe hand-off and the
 * source lock.
 *
 * The registry is mocked out so importing the poller does not drag every
 * provider connector (and its HTTP client) into this suite.
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
const SECOND_CONNECTION_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const PROVIDER: SecurityEventConnectorProvider =
  SecurityEventConnectorProvider.OktaSystemLog;
const DEFINITION: SecurityEventConnectorDefinition =
  getSecurityEventConnectorDefinition(PROVIDER)!;
const SECRET_VALUE: string = "ssws-token-9f8e7d6c5b4a";
const MINUTE_MS: number = 60 * 1000;

const SETTINGS: SecurityConnectorSettings = {
  provider: PROVIDER,
  config: { orgUrl: "https://acme.okta.com" },
  secrets: { apiToken: SECRET_VALUE },
  alertingOnly: true,
};

function makeConnection(
  overrides: Partial<SecurityEventConnection> = {},
): SecurityEventConnection {
  const connection: SecurityEventConnection = new SecurityEventConnection();
  connection._id = CONNECTION_ID.toString();
  connection.projectId = PROJECT_ID;
  connection.name = "Okta production";
  connection.provider = PROVIDER;
  connection.config = SETTINGS.config;
  connection.secrets = JSON.stringify(SETTINGS.secrets);
  connection.alertingOnly = true;
  connection.pollIntervalInMinutes = 5;
  connection.isEnabled = true;
  Object.assign(connection, overrides);
  return connection;
}

function makeServiceMetadata(): TelemetryServiceMetadata {
  return {
    serviceName: DEFINITION.productName,
    primaryEntityId: new ObjectID("33333333-3333-4333-8333-333333333333"),
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  };
}

function makeEvent(
  eventUid: string,
  time: Date = new Date(Date.now() - 10 * MINUTE_MS),
): NormalizedSecurityEvent {
  return {
    time,
    eventUid,
    categoryUid: 3,
    categoryName: "Identity & Access Management",
    classUid: 3002,
    className: "Authentication",
    activityName: "Logon",
    severityId: 1,
    severityName: OcsfSeverity.Informational,
    statusName: "Success",
    message: `Login ${eventUid}`,
    // Deliberately wrong: the poller must overwrite these from the catalog.
    vendorName: "connector-said-vendor",
    productName: "connector-said-product",
    ruleId: "",
    ruleName: "",
    mitreTactics: [],
    mitreTechniques: [],
    principalUser: "alice@example.com",
    principalHost: "",
    principalIp: "203.0.113.5",
    principalProcess: "",
    targetUser: "",
    targetHost: "",
    targetIp: "",
    targetPort: 0,
    targetResource: "",
    observables: ["alice@example.com", "203.0.113.5"],
    attributes: { "okta.eventType": "user.session.start" },
  };
}

function makeFetchResult(
  events: Array<NormalizedSecurityEvent>,
  overrides: Partial<ConnectorFetchResult> = {},
): ConnectorFetchResult {
  return {
    events,
    fetchedCount: events.length,
    rejectedCount: 0,
    failedCount: 0,
    complete: true,
    requestCount: 1,
    warnings: [],
    samples: events.map(
      (
        event: NormalizedSecurityEvent,
      ): { id: string; title: string; severity: string } => {
        return { id: event.eventUid, title: event.message, severity: "Info" };
      },
    ),
    ...overrides,
  };
}

interface FakeConnector {
  connector: SecurityEventConnector;
  fetchCalls: Array<{
    settings: SecurityConnectorSettings;
    window: ConnectorFetchWindow;
    options: ConnectorFetchOptions;
  }>;
  testCalls: Array<{
    settings: SecurityConnectorSettings;
    options: ConnectorTestOptions;
  }>;
  validateCalls: Array<SecurityConnectorSettings>;
}

/*
 * A connector whose every entry point is scripted: `fetch` is either the
 * result to resolve or the error to throw, `checks` is what testConnection
 * answers, `validate` is what validateSettings throws.
 */
function makeFakeConnector(script: {
  fetch?: ConnectorFetchResult | Error | undefined;
  checks?: Array<SecurityConnectorCheck> | undefined;
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
        return Promise.resolve(script.checks || []);
      },
      fetchEvents: (
        settings: SecurityConnectorSettings,
        window: ConnectorFetchWindow,
        options: ConnectorFetchOptions,
      ): Promise<ConnectorFetchResult> => {
        fake.fetchCalls.push({ settings, window, options });
        if (script.fetch instanceof Error) {
          return Promise.reject(script.fetch);
        }
        return Promise.resolve(script.fetch || makeFetchResult([]));
      },
    },
    fetchCalls: [],
    testCalls: [],
    validateCalls: [],
  };

  return fake;
}

function overridesFor(fake: FakeConnector): PollerOverrides {
  return { connector: fake.connector, settings: SETTINGS };
}

function check(
  key: string,
  status: SecurityConnectorCheck["status"],
  message: string = `${key} ${status}`,
): SecurityConnectorCheck {
  return { key, name: `Check ${key}`, status, durationMs: 1, message };
}

type ConnectionUpdateCall = { id: ObjectID; data: JSONObject };

function updateCall(index: number = 0): ConnectionUpdateCall {
  const spy: jest.Mock =
    SecurityEventConnectionService.updateOneById as unknown as jest.Mock;
  expect(spy.mock.calls.length).toBeGreaterThan(index);
  return spy.mock.calls[index]![0] as ConnectionUpdateCall;
}

function findCheck(
  result: SecurityEventConnectionRunResult,
  key: string,
): SecurityConnectorCheck {
  const found: SecurityConnectorCheck | undefined = result.checks.find(
    (candidate: SecurityConnectorCheck): boolean => {
      return candidate.key === key;
    },
  );
  expect({ key, found: found !== undefined }).toEqual({ key, found: true });
  return found!;
}

let insertedRows: Array<JSONObject>;
let insertOptions: Array<unknown>;
let existingUids: Set<string>;
let dedupeCalls: Array<{
  projectId: ObjectID;
  vendorName: string;
  productName: string;
  ids: Array<string>;
}>;

beforeEach(() => {
  insertedRows = [];
  insertOptions = [];
  existingUids = new Set();
  dedupeCalls = [];

  getJestSpyOn(Semaphore, "lock").mockResolvedValue({});
  getJestSpyOn(Semaphore, "release").mockResolvedValue(undefined);
  getJestSpyOn(SecurityEventDedupe, "findExistingEventUids").mockImplementation(
    ((data: {
      projectId: ObjectID;
      vendorName: string;
      productName: string;
      ids: Array<string>;
    }): Promise<Set<string>> => {
      dedupeCalls.push(data);
      return Promise.resolve(existingUids);
    }) as never,
  );
  getJestSpyOn(OTelIngestService, "telemetryServiceFromName").mockResolvedValue(
    makeServiceMetadata() as never,
  );
  getJestSpyOn(ThreatIntelEnricher, "enrichNormalizedEvents").mockResolvedValue(
    {
      eventsMatched: 0,
    } as never,
  );
  getJestSpyOn(SecurityEventService, "insertJsonRows").mockImplementation(((
    rows: Array<JSONObject>,
    options: unknown,
  ): Promise<void> => {
    insertedRows.push(...rows);
    insertOptions.push(options);
    return Promise.resolve();
  }) as never);
  getJestSpyOn(
    SecurityEventConnectionService,
    "updateOneById",
  ).mockResolvedValue(undefined as never);
  getJestSpyOn(
    SecurityEventConnectionService,
    "getConnectorSettings",
  ).mockResolvedValue(SETTINGS as never);
  // Every run logs its warnings; failures log their errors. Keep the output quiet.
  getJestSpyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);
  getJestSpyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
  getJestSpyOn(logger, "info").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  (
    SecurityEventConnectorRegistry.getConnector as unknown as jest.Mock
  ).mockReset();
});

describe("SecurityEventConnectionPoller constants", () => {
  test("the first window is a full day and catch-up chunks are a day with a minute of overlap", () => {
    expect(DEFAULT_INITIAL_LOOKBACK_IN_MINUTES).toBe(24 * 60);
    expect(MAX_LOOKBACK_IN_MINUTES).toBe(24 * 60);
    expect(WINDOW_OVERLAP_IN_MINUTES).toBe(1);
    expect(MAX_RANGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test("every fetch is bounded in requests, records and time", () => {
    expect(MAX_FETCH_REQUESTS).toBeGreaterThan(0);
    expect(MAX_EVENTS_PER_RUN).toBeGreaterThan(0);
    expect(POLL_REQUEST_TIMEOUT_IN_MS).toBeGreaterThan(0);
    expect(MAX_DIAGNOSTIC_SAMPLES).toBeGreaterThan(0);
  });
});

describe("SecurityEventConnectionPoller.getWindow", () => {
  const NOW: Date = new Date("2026-09-10T12:00:00.000Z");

  test("a first poll (no cursor) looks back the default 24 hours", () => {
    const window: ReturnType<typeof SecurityEventConnectionPoller.getWindow> =
      SecurityEventConnectionPoller.getWindow(
        makeConnection(),
        { type: "poll" },
        NOW,
      );

    expect(window.endTime.toISOString()).toBe(NOW.toISOString());
    expect(window.startTime.toISOString()).toBe(
      new Date(
        NOW.getTime() - DEFAULT_INITIAL_LOOKBACK_IN_MINUTES * MINUTE_MS,
      ).toISOString(),
    );
    expect(window.hasUsableCursor).toBe(false);
    expect(window.warnings).toEqual([]);
  });

  test("a cursor poll starts one minute before the cursor and ends now", () => {
    const cursor: Date = new Date(NOW.getTime() - 5 * MINUTE_MS);
    const window: ReturnType<typeof SecurityEventConnectionPoller.getWindow> =
      SecurityEventConnectionPoller.getWindow(
        makeConnection({ cursor: cursor.toISOString() }),
        { type: "poll" },
        NOW,
      );

    expect(window.startTime.toISOString()).toBe(
      new Date(
        cursor.getTime() - WINDOW_OVERLAP_IN_MINUTES * MINUTE_MS,
      ).toISOString(),
    );
    expect(window.endTime.toISOString()).toBe(NOW.toISOString());
    expect(window.hasUsableCursor).toBe(true);
    expect(window.warnings).toEqual([]);
  });

  test("a stale cursor is caught up in 24 hour chunks with a warning", () => {
    const cursor: Date = new Date(NOW.getTime() - 7 * 24 * 60 * MINUTE_MS);
    const window: ReturnType<typeof SecurityEventConnectionPoller.getWindow> =
      SecurityEventConnectionPoller.getWindow(
        makeConnection({ cursor: cursor.toISOString() }),
        { type: "poll" },
        NOW,
      );

    expect(window.hasUsableCursor).toBe(true);
    expect(window.endTime.getTime() - window.startTime.getTime()).toBe(
      MAX_LOOKBACK_IN_MINUTES * MINUTE_MS,
    );
    expect(window.endTime.getTime()).toBeLessThan(NOW.getTime());
    expect(window.warnings).toHaveLength(1);
    expect(window.warnings[0]).toContain("Catching up");
  });

  test("a cursor exactly one chunk behind is not chunked", () => {
    /*
     * The chunk end is start + 24h where start is cursor - 1 minute, so a
     * cursor 24h - 1min old lands the chunk end exactly on now.
     */
    const cursor: Date = new Date(
      NOW.getTime() -
        (MAX_LOOKBACK_IN_MINUTES - WINDOW_OVERLAP_IN_MINUTES) * MINUTE_MS,
    );
    const window: ReturnType<typeof SecurityEventConnectionPoller.getWindow> =
      SecurityEventConnectionPoller.getWindow(
        makeConnection({ cursor: cursor.toISOString() }),
        { type: "poll" },
        NOW,
      );

    expect(window.endTime.toISOString()).toBe(NOW.toISOString());
    expect(window.warnings).toEqual([]);
  });

  test("an unreadable cursor falls back to the default window with a warning", () => {
    const window: ReturnType<typeof SecurityEventConnectionPoller.getWindow> =
      SecurityEventConnectionPoller.getWindow(
        makeConnection({ cursor: "yesterday-ish" }),
        { type: "poll" },
        NOW,
      );

    expect(window.hasUsableCursor).toBe(false);
    expect(window.endTime.toISOString()).toBe(NOW.toISOString());
    expect(window.startTime.toISOString()).toBe(
      new Date(
        NOW.getTime() - DEFAULT_INITIAL_LOOKBACK_IN_MINUTES * MINUTE_MS,
      ).toISOString(),
    );
    expect(window.warnings).toHaveLength(1);
    expect(window.warnings[0]).toContain("unreadable");
  });

  test("a future cursor falls back to the default window with a warning", () => {
    const window: ReturnType<typeof SecurityEventConnectionPoller.getWindow> =
      SecurityEventConnectionPoller.getWindow(
        makeConnection({
          cursor: new Date(NOW.getTime() + 60 * MINUTE_MS).toISOString(),
        }),
        { type: "poll" },
        NOW,
      );

    expect(window.hasUsableCursor).toBe(false);
    expect(window.warnings).toHaveLength(1);
    expect(window.warnings[0]).toContain("in the future");
  });

  test("a test run reads the last 24 hours and ignores the cursor", () => {
    const window: ReturnType<typeof SecurityEventConnectionPoller.getWindow> =
      SecurityEventConnectionPoller.getWindow(
        makeConnection({
          cursor: new Date(NOW.getTime() - 5 * MINUTE_MS).toISOString(),
        }),
        { type: "test" },
        NOW,
      );

    expect(window.hasUsableCursor).toBe(false);
    expect(window.endTime.getTime() - window.startTime.getTime()).toBe(
      24 * 60 * MINUTE_MS,
    );
    expect(window.warnings).toEqual([]);
  });

  test.each(["preview", "backfill"])(
    "a %s run uses exactly the requested range",
    (type: string) => {
      const startTime: string = "2026-09-08T00:00:00.000Z";
      const endTime: string = "2026-09-09T00:00:00.000Z";
      const window: ReturnType<typeof SecurityEventConnectionPoller.getWindow> =
        SecurityEventConnectionPoller.getWindow(
          makeConnection({
            cursor: new Date(NOW.getTime() - 5 * MINUTE_MS).toISOString(),
          }),
          {
            type: type as SecurityEventConnectionRunOptions["type"],
            startTime,
            endTime,
          },
          NOW,
        );

      expect(window.startTime.toISOString()).toBe(startTime);
      expect(window.endTime.toISOString()).toBe(endTime);
      expect(window.hasUsableCursor).toBe(false);
    },
  );

  test("an end up to a minute in the future is tolerated for clock skew", () => {
    const window: ReturnType<typeof SecurityEventConnectionPoller.getWindow> =
      SecurityEventConnectionPoller.getWindow(
        makeConnection(),
        {
          type: "preview",
          startTime: new Date(NOW.getTime() - 60 * MINUTE_MS).toISOString(),
          endTime: new Date(NOW.getTime() + 59 * 1000).toISOString(),
        },
        NOW,
      );

    expect(window.endTime.getTime()).toBeGreaterThan(NOW.getTime());
  });

  test.each<[string, Partial<SecurityEventConnectionRunOptions>]>([
    ["no range at all", {}],
    ["an unparseable start", { startTime: "soon", endTime: NOW.toISOString() }],
    [
      "an unparseable end",
      {
        startTime: new Date(NOW.getTime() - 60 * MINUTE_MS).toISOString(),
        endTime: "later",
      },
    ],
    [
      "start equal to end",
      { startTime: NOW.toISOString(), endTime: NOW.toISOString() },
    ],
    [
      "start after end",
      {
        startTime: NOW.toISOString(),
        endTime: new Date(NOW.getTime() - 60 * MINUTE_MS).toISOString(),
      },
    ],
    [
      "an end more than a minute in the future",
      {
        startTime: new Date(NOW.getTime() - 60 * MINUTE_MS).toISOString(),
        endTime: new Date(NOW.getTime() + 2 * MINUTE_MS).toISOString(),
      },
    ],
    [
      "a range longer than seven days",
      {
        startTime: new Date(NOW.getTime() - MAX_RANGE_MS - 1000).toISOString(),
        endTime: NOW.toISOString(),
      },
    ],
  ])(
    "rejects a preview/backfill range with %s",
    (_label: string, range: Partial<SecurityEventConnectionRunOptions>) => {
      for (const type of ["preview", "backfill"] as Array<
        SecurityEventConnectionRunOptions["type"]
      >) {
        expect(() => {
          SecurityEventConnectionPoller.getWindow(
            makeConnection(),
            { type, ...range },
            NOW,
          );
        }).toThrow(BadDataException);
        expect(() => {
          SecurityEventConnectionPoller.getWindow(
            makeConnection(),
            { type, ...range },
            NOW,
          );
        }).toThrow("Select a valid past time range of at most seven days.");
      }
    },
  );

  test("a range of exactly seven days is accepted", () => {
    expect(() => {
      SecurityEventConnectionPoller.getWindow(
        makeConnection(),
        {
          type: "backfill",
          startTime: new Date(NOW.getTime() - MAX_RANGE_MS).toISOString(),
          endTime: NOW.toISOString(),
        },
        NOW,
      );
    }).not.toThrow();
  });
});

describe("SecurityEventConnectionPoller.executeConnection - validation", () => {
  test.each<[string, (connection: SecurityEventConnection) => void]>([
    [
      "id",
      (connection: SecurityEventConnection): void => {
        delete connection._id;
      },
    ],
    [
      "projectId",
      (connection: SecurityEventConnection): void => {
        delete connection.projectId;
      },
    ],
    [
      "provider",
      (connection: SecurityEventConnection): void => {
        delete connection.provider;
      },
    ],
  ])(
    "refuses a connection missing its %s before touching the lock",
    async (
      _field: string,
      strip: (connection: SecurityEventConnection) => void,
    ) => {
      const fake: FakeConnector = makeFakeConnector({});
      const connection: SecurityEventConnection = makeConnection();
      strip(connection);

      await expect(
        SecurityEventConnectionPoller.executeConnection(
          connection,
          { type: "poll" },
          overridesFor(fake),
        ),
      ).rejects.toThrow("missing id, projectId or provider");
      expect(Semaphore.lock).not.toHaveBeenCalled();
      expect(fake.fetchCalls).toHaveLength(0);
    },
  );

  test("a provider outside the catalog is refused and the lock is released", async () => {
    const fake: FakeConnector = makeFakeConnector({});

    await expect(
      SecurityEventConnectionPoller.executeConnection(
        makeConnection({
          provider: "google-secops" as SecurityEventConnectorProvider,
        }),
        { type: "poll" },
        overridesFor(fake),
      ),
    ).rejects.toThrow("unsupported provider");
    expect(Semaphore.lock).toHaveBeenCalledTimes(1);
    expect(Semaphore.release).toHaveBeenCalledTimes(1);
    expect(SecurityEventConnectionService.updateOneById).not.toHaveBeenCalled();
  });
});

describe("SecurityEventConnectionPoller.executeConnection - source lock", () => {
  test.each(["poll", "backfill"])(
    "a %s run holds the project:provider source lock and releases it",
    async (type: string) => {
      const fake: FakeConnector = makeFakeConnector({});
      const options: SecurityEventConnectionRunOptions =
        type === "backfill"
          ? {
              type: "backfill",
              startTime: new Date(Date.now() - 60 * MINUTE_MS).toISOString(),
              endTime: new Date(Date.now() - 30 * MINUTE_MS).toISOString(),
            }
          : { type: "poll" };

      await SecurityEventConnectionPoller.executeConnection(
        makeConnection(),
        options,
        overridesFor(fake),
      );

      expect(Semaphore.lock).toHaveBeenCalledTimes(1);
      expect(Semaphore.lock).toHaveBeenCalledWith({
        namespace: SECURITY_EVENT_SOURCE_LOCK_NAMESPACE,
        key: `${PROJECT_ID.toString()}:${PROVIDER}`,
        lockTimeout: 30000,
        acquireTimeout: 10000,
        retryInterval: 100,
      });
      expect(Semaphore.release).toHaveBeenCalledTimes(1);
      expect(fake.fetchCalls).toHaveLength(1);
    },
  );

  test.each(["test", "preview"])(
    "a %s run never takes the source lock, so it cannot wait behind an import",
    async (type: string) => {
      const fake: FakeConnector = makeFakeConnector({});
      const options: SecurityEventConnectionRunOptions =
        type === "preview"
          ? {
              type: "preview",
              startTime: new Date(Date.now() - 60 * MINUTE_MS).toISOString(),
              endTime: new Date(Date.now() - 30 * MINUTE_MS).toISOString(),
            }
          : { type: "test" };

      await SecurityEventConnectionPoller.executeConnection(
        makeConnection(),
        options,
        overridesFor(fake),
      );

      expect(Semaphore.lock).not.toHaveBeenCalled();
      expect(Semaphore.release).not.toHaveBeenCalled();
    },
  );

  test("a lock timeout becomes a readable 'still running' error and touches nothing", async () => {
    getJestSpyOn(Semaphore, "lock").mockRejectedValue(
      new SemaphoreLockTimeoutError("acquire timed out") as never,
    );
    const fake: FakeConnector = makeFakeConnector({});

    const promise: Promise<SecurityEventConnectionRunResult> =
      SecurityEventConnectionPoller.executeConnection(
        makeConnection(),
        { type: "poll" },
        overridesFor(fake),
      );

    await expect(promise).rejects.toBeInstanceOf(BadDataException);
    await expect(promise).rejects.toThrow(
      /^Another poll or import for this source is still running/,
    );
    expect(fake.fetchCalls).toHaveLength(0);
    expect(Semaphore.release).not.toHaveBeenCalled();
    // lastError is left alone: contention is not a broken connection.
    expect(SecurityEventConnectionService.updateOneById).not.toHaveBeenCalled();
  });

  test("any other lock failure propagates as is", async () => {
    getJestSpyOn(Semaphore, "lock").mockRejectedValue(
      new Error("Redis unavailable") as never,
    );
    const fake: FakeConnector = makeFakeConnector({});

    await expect(
      SecurityEventConnectionPoller.executeConnection(
        makeConnection(),
        { type: "poll" },
        overridesFor(fake),
      ),
    ).rejects.toThrow("Redis unavailable");
    expect(fake.fetchCalls).toHaveLength(0);
  });

  test("a release failure is logged and does not fail the run", async () => {
    getJestSpyOn(Semaphore, "release").mockRejectedValue(
      new Error("lock already expired") as never,
    );
    const fake: FakeConnector = makeFakeConnector({});

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection(),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(result.status).toBe("empty");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not release source lock"),
    );
  });

  test("without overrides the connection is re-read under the lock, scoped to its project", async () => {
    const reloaded: SecurityEventConnection = makeConnection();
    getJestSpyOn(
      SecurityEventConnectionService,
      "findOneById",
    ).mockResolvedValue(reloaded as never);
    const fake: FakeConnector = makeFakeConnector({});
    (
      SecurityEventConnectorRegistry.getConnector as unknown as jest.Mock
    ).mockReturnValue(fake.connector);

    await SecurityEventConnectionPoller.executeConnection(makeConnection(), {
      type: "poll",
    });

    expect(SecurityEventConnectionService.findOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: CONNECTION_ID,
        select: expect.objectContaining({ secrets: true, cursor: true }),
        props: { isRoot: true },
      }),
    );
    expect(SecurityEventConnectorRegistry.getConnector).toHaveBeenCalledWith(
      PROVIDER,
    );
    expect(
      SecurityEventConnectionService.getConnectorSettings,
    ).toHaveBeenCalledWith(reloaded);
    expect(fake.fetchCalls).toHaveLength(1);
  });

  test.each<[string, SecurityEventConnection | null]>([
    ["deleted", null],
    [
      "moved to another project",
      makeConnection({
        projectId: new ObjectID("55555555-5555-4555-8555-555555555555"),
      }),
    ],
  ])(
    "a connection %s while waiting for the lock is refused",
    async (_label: string, reloaded: SecurityEventConnection | null) => {
      getJestSpyOn(
        SecurityEventConnectionService,
        "findOneById",
      ).mockResolvedValue(reloaded as never);

      await expect(
        SecurityEventConnectionPoller.executeConnection(makeConnection(), {
          type: "poll",
        }),
      ).rejects.toThrow("no longer exists in this project");
      expect(Semaphore.release).toHaveBeenCalledTimes(1);
    },
  );
});

describe("SecurityEventConnectionPoller.executeConnection - poll", () => {
  test("a complete poll imports the events, advances the cursor to the window end and stamps every timestamp", async () => {
    const eventTime: Date = new Date(Date.now() - 10 * MINUTE_MS);
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([
        makeEvent("evt-1", eventTime),
        makeEvent("evt-2", new Date(eventTime.getTime() + MINUTE_MS)),
      ]),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection(),
        { type: "poll", runId: "run-1" },
        overridesFor(fake),
      );

    expect(result.status).toBe("success");
    expect(result.type).toBe("poll");
    expect(result.provider).toBe(PROVIDER);
    expect(result.runId).toBe("run-1");
    expect(result.complete).toBe(true);
    expect(result.fetchedCount).toBe(2);
    expect(result.ingestedCount).toBe(2);
    expect(result.duplicateCount).toBe(0);
    expect(result.requestCount).toBe(1);
    expect(result.error).toBeUndefined();
    expect(result.eventTimeStart).toBe(eventTime.toISOString());
    expect(result.eventTimeEnd).toBe(
      new Date(eventTime.getTime() + MINUTE_MS).toISOString(),
    );
    expect(
      result.checks.map((item: SecurityConnectorCheck): string => {
        return `${item.key}:${item.status}`;
      }),
    ).toEqual(["configuration:pass", "read:pass", "import:pass"]);
    expect(findCheck(result, "import").message).toBe(
      "2 imported; 0 already imported.",
    );

    expect(SecurityEventConnectionService.updateOneById).toHaveBeenCalledTimes(
      1,
    );
    const written: ConnectionUpdateCall = updateCall();
    expect(written.id.toString()).toBe(CONNECTION_ID.toString());
    expect(written.data["cursor"]).toBe(result.windowEnd);
    expect(written.data["lastError"]).toBeNull();
    expect(written.data["lastPolledAt"]).toEqual(new Date(result.completedAt));
    expect(written.data["lastSuccessfulPollAt"]).toEqual(
      new Date(result.completedAt),
    );
    expect(written.data["lastEventIngestedAt"]).toEqual(
      new Date(result.completedAt),
    );
    expect(written.data["lastPollResult"]).toBe(result);
  });

  test("fetch is asked for the poll window with every bound and the poll timeout", async () => {
    const fake: FakeConnector = makeFakeConnector({});
    const cursor: Date = new Date(Date.now() - 5 * MINUTE_MS);

    await SecurityEventConnectionPoller.executeConnection(
      makeConnection({ cursor: cursor.toISOString() }),
      { type: "poll" },
      overridesFor(fake),
    );

    expect(fake.validateCalls).toEqual([SETTINGS]);
    expect(fake.fetchCalls).toHaveLength(1);
    const call: FakeConnector["fetchCalls"][number] = fake.fetchCalls[0]!;
    expect(call.settings).toBe(SETTINGS);
    expect(call.window.startTime.toISOString()).toBe(
      new Date(
        cursor.getTime() - WINDOW_OVERLAP_IN_MINUTES * MINUTE_MS,
      ).toISOString(),
    );
    expect(call.window.endTime.getTime()).toBeGreaterThan(cursor.getTime());
    expect(call.options).toEqual({
      maxRequests: MAX_FETCH_REQUESTS,
      maxEvents: MAX_EVENTS_PER_RUN,
      requestTimeoutInMs: POLL_REQUEST_TIMEOUT_IN_MS,
      sampleLimit: MAX_DIAGNOSTIC_SAMPLES,
    });
  });

  test("a poll that reads nothing is 'empty', writes nothing to storage and still advances the cursor", async () => {
    const fake: FakeConnector = makeFakeConnector({});

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection(),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(result.status).toBe("empty");
    expect(result.complete).toBe(true);
    expect(SecurityEventDedupe.findExistingEventUids).not.toHaveBeenCalled();
    expect(OTelIngestService.telemetryServiceFromName).not.toHaveBeenCalled();
    expect(SecurityEventService.insertJsonRows).not.toHaveBeenCalled();
    expect(findCheck(result, "import").message).toBe(
      "0 imported; 0 already imported.",
    );

    const written: ConnectionUpdateCall = updateCall();
    expect(written.data["cursor"]).toBe(result.windowEnd);
    expect(written.data["lastSuccessfulPollAt"]).toBeInstanceOf(Date);
    expect(written.data["lastEventIngestedAt"]).toBeUndefined();
    expect(written.data["lastError"]).toBeNull();
  });

  test("an incomplete fetch holds the cursor, records the warnings and is 'partial'", async () => {
    const cursor: Date = new Date(Date.now() - 5 * MINUTE_MS);
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([makeEvent("evt-1")], {
        complete: false,
        requestCount: MAX_FETCH_REQUESTS,
        warnings: ["Stopped after 20 requests; the window was not fully read."],
      }),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection({ cursor: cursor.toISOString() }),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(result.status).toBe("partial");
    expect(result.complete).toBe(false);
    expect(result.ingestedCount).toBe(1);
    expect(result.warnings).toContain(
      "Stopped after 20 requests; the window was not fully read.",
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("the window was not fully read"),
    );

    const written: ConnectionUpdateCall = updateCall();
    // The cursor key is absent, so the stored cursor stays where it was.
    expect("cursor" in written.data).toBe(false);
    expect(written.data["lastSuccessfulPollAt"]).toBeUndefined();
    expect(written.data["lastEventIngestedAt"]).toBeInstanceOf(Date);
    expect(written.data["lastError"]).toContain(
      "the window was not fully read",
    );
    expect(written.data["lastPolledAt"]).toBeInstanceOf(Date);
  });

  test("an incomplete fetch with no warning text still explains why the cursor held", async () => {
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([], { complete: false }),
    });

    await SecurityEventConnectionPoller.executeConnection(
      makeConnection({
        cursor: new Date(Date.now() - 5 * MINUTE_MS).toISOString(),
      }),
      { type: "poll" },
      overridesFor(fake),
    );

    expect(updateCall().data["lastError"]).toBe(
      "Poll incomplete; retrying the same window.",
    );
  });

  test("an incomplete first poll anchors the cursor one minute into the window instead of re-reading a day forever", async () => {
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([makeEvent("evt-1")], { complete: false }),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection(),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(result.status).toBe("partial");
    const written: ConnectionUpdateCall = updateCall();
    expect(written.data["cursor"]).toBe(
      new Date(
        new Date(result.windowStart).getTime() +
          WINDOW_OVERLAP_IN_MINUTES * MINUTE_MS,
      ).toISOString(),
    );
    expect(written.data["lastSuccessfulPollAt"]).toBeUndefined();
  });

  test("a failed fetch records a redacted error, a failure check named after the phase, and holds a usable cursor", async () => {
    const cursor: Date = new Date(Date.now() - 5 * MINUTE_MS);
    const fake: FakeConnector = makeFakeConnector({
      fetch: new Error(
        `Okta system log read failed (HTTP 401): client_secret=${SECRET_VALUE} rejected`,
      ),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection({ cursor: cursor.toISOString() }),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(result.status).toBe("failed");
    expect(result.complete).toBe(false);
    expect(result.error).toContain("Okta system log read failed (HTTP 401)");
    expect(result.error).not.toContain(SECRET_VALUE);
    expect(result.error).toContain("[REDACTED]");

    const failure: SecurityConnectorCheck = findCheck(result, "failure");
    expect(failure.status).toBe("fail");
    expect(failure.name).toBe(
      `Read ${DEFINITION.importedRecordName}s from ${DEFINITION.title}`,
    );
    expect(failure.message).toBe(result.error);
    expect(JSON.stringify(result)).not.toContain(SECRET_VALUE);

    expect(SecurityEventService.insertJsonRows).not.toHaveBeenCalled();
    const written: ConnectionUpdateCall = updateCall();
    expect("cursor" in written.data).toBe(false);
    expect(written.data["lastError"]).toBe(result.error);
    expect(written.data["lastSuccessfulPollAt"]).toBeUndefined();
    expect(written.data["lastPolledAt"]).toBeInstanceOf(Date);
  });

  test("a failed first poll still anchors a cursor so the next poll does not restart from a day ago", async () => {
    const fake: FakeConnector = makeFakeConnector({
      fetch: new Error("Okta system log read failed (HTTP 503): unavailable"),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection(),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(result.status).toBe("failed");
    expect(updateCall().data["cursor"]).toBe(
      new Date(
        new Date(result.windowStart).getTime() +
          WINDOW_OVERLAP_IN_MINUTES * MINUTE_MS,
      ).toISOString(),
    );
  });

  test("an unreadable saved cursor is replaced by an anchored one after a failed poll", async () => {
    const fake: FakeConnector = makeFakeConnector({
      fetch: new Error("boom"),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection({ cursor: "garbage" }),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(
      result.warnings.some((warning: string): boolean => {
        return warning.includes("unreadable");
      }),
    ).toBe(true);
    expect(typeof updateCall().data["cursor"]).toBe("string");
  });

  test("a validateSettings failure fails the run in the configuration phase without fetching", async () => {
    const fake: FakeConnector = makeFakeConnector({
      validate: new BadDataException("Okta organization URL must use https."),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection(),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(result.status).toBe("failed");
    expect(result.error).toBe("Okta organization URL must use https.");
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]!.key).toBe("failure");
    expect(result.checks[0]!.name).toBe("Validate configuration");
    expect(fake.fetchCalls).toHaveLength(0);
    expect(updateCall().data["lastError"]).toBe(
      "Okta organization URL must use https.",
    );
  });

  test("rejected records warn but do not hold the cursor", async () => {
    const cursor: Date = new Date(Date.now() - 5 * MINUTE_MS);
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([makeEvent("evt-1")], {
        fetchedCount: 4,
        rejectedCount: 3,
      }),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection({ cursor: cursor.toISOString() }),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(result.status).toBe("success");
    expect(result.complete).toBe(true);
    expect(result.rejectedCount).toBe(3);
    expect(result.ingestedCount).toBe(1);
    expect(result.warnings).toContain(
      `3 returned records were discarded because they do not look like ${DEFINITION.title} ${DEFINITION.importedRecordName}s.`,
    );

    const read: SecurityConnectorCheck = findCheck(result, "read");
    expect(read.status).toBe("warn");
    expect(read.message).toBe(
      `1 ${DEFINITION.importedRecordName}s recognized; 3 rejected; 0 failed; 1 request.`,
    );

    const written: ConnectionUpdateCall = updateCall();
    expect(written.data["cursor"]).toBe(result.windowEnd);
    expect(written.data["lastSuccessfulPollAt"]).toBeInstanceOf(Date);
    expect(written.data["lastError"]).toBeNull();
  });

  test("normalization failures hold the cursor for retry and fail the read check", async () => {
    const cursor: Date = new Date(Date.now() - 5 * MINUTE_MS);
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([makeEvent("evt-1")], {
        fetchedCount: 3,
        failedCount: 2,
        requestCount: 2,
      }),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection({ cursor: cursor.toISOString() }),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(result.status).toBe("partial");
    expect(result.complete).toBe(false);
    expect(result.failedCount).toBe(2);
    // The recognizable record is still imported; only the cursor holds.
    expect(result.ingestedCount).toBe(1);
    expect(result.warnings).toContain(
      "2 records could not be normalized. The poll cursor is held for retry.",
    );

    const read: SecurityConnectorCheck = findCheck(result, "read");
    expect(read.status).toBe("fail");
    expect(read.message).toBe(
      `1 ${DEFINITION.importedRecordName}s recognized; 0 rejected; 2 failed; 2 requests.`,
    );

    const written: ConnectionUpdateCall = updateCall();
    expect("cursor" in written.data).toBe(false);
    expect(written.data["lastSuccessfulPollAt"]).toBeUndefined();
    expect(written.data["lastError"]).toContain("could not be normalized");
  });

  test("diagnostic samples are capped and warnings from the connector are kept", async () => {
    const events: Array<NormalizedSecurityEvent> = [];
    for (let index: number = 0; index < MAX_DIAGNOSTIC_SAMPLES + 5; index++) {
      events.push(makeEvent(`evt-${index}`));
    }
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult(events, {
        warnings: ["Some records were truncated by the source."],
      }),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection(),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(result.samples).toHaveLength(MAX_DIAGNOSTIC_SAMPLES);
    expect(result.warnings).toEqual([
      "Some records were truncated by the source.",
    ]);
    expect(result.ingestedCount).toBe(MAX_DIAGNOSTIC_SAMPLES + 5);
  });
});

describe("SecurityEventConnectionPoller.executeConnection - ingest", () => {
  test("rows carry the catalog vendor/product, the connection attributes and the project", async () => {
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([makeEvent("evt-1")]),
    });

    await SecurityEventConnectionPoller.executeConnection(
      makeConnection(),
      { type: "poll" },
      overridesFor(fake),
    );

    expect(insertedRows).toHaveLength(1);
    const row: JSONObject = insertedRows[0]!;
    expect(row["vendorName"]).toBe(DEFINITION.vendorName);
    expect(row["productName"]).toBe(DEFINITION.productName);
    expect(row["projectId"]).toBe(PROJECT_ID.toString());
    expect(row["eventUid"]).toBe("evt-1");
    expect(row["classUid"]).toBe(3002);

    const attributes: JSONObject = row["attributes"] as JSONObject;
    expect(attributes["oneuptime.security_connection.id"]).toBe(
      CONNECTION_ID.toString(),
    );
    expect(attributes["oneuptime.security_connection.provider"]).toBe(PROVIDER);
    expect(attributes["okta.eventType"]).toBe("user.session.start");
    expect(JSON.stringify(row)).not.toContain(SECRET_VALUE);
  });

  test("the insert asks ClickHouse for a synchronous, replicated acknowledgement", async () => {
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([makeEvent("evt-1")]),
    });

    await SecurityEventConnectionPoller.executeConnection(
      makeConnection(),
      { type: "poll" },
      overridesFor(fake),
    );

    expect(SecurityEventService.insertJsonRows).toHaveBeenCalledTimes(1);
    expect(insertOptions).toEqual([
      { clickhouseSettings: { async_insert: 0, insert_distributed_sync: 1 } },
    ]);
  });

  test("the telemetry service is resolved by product name and events are enriched before insert", async () => {
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([makeEvent("evt-1")]),
    });

    await SecurityEventConnectionPoller.executeConnection(
      makeConnection(),
      { type: "poll" },
      overridesFor(fake),
    );

    expect(OTelIngestService.telemetryServiceFromName).toHaveBeenCalledWith({
      serviceName: DEFINITION.productName,
      projectId: PROJECT_ID,
    });
    expect(ThreatIntelEnricher.enrichNormalizedEvents).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      events: [expect.objectContaining({ eventUid: "evt-1" })],
    });
  });

  test("dedupes against storage by vendor/product and within the batch", async () => {
    existingUids = new Set(["evt-stored"]);
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([
        makeEvent("evt-stored"),
        makeEvent("evt-new"),
        makeEvent("evt-new"),
        makeEvent("evt-other"),
      ]),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection(),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(dedupeCalls).toHaveLength(1);
    expect(dedupeCalls[0]).toEqual({
      projectId: PROJECT_ID,
      vendorName: DEFINITION.vendorName,
      productName: DEFINITION.productName,
      // The in-batch duplicate is removed before the lookup.
      ids: ["evt-stored", "evt-new", "evt-other"],
    });
    expect(result.duplicateCount).toBe(2);
    expect(result.ingestedCount).toBe(2);
    expect(
      insertedRows.map((row: JSONObject): string => {
        return row["eventUid"] as string;
      }),
    ).toEqual(["evt-new", "evt-other"]);
    expect(findCheck(result, "import").message).toBe(
      "2 imported; 2 already imported.",
    );
  });

  test("a batch that is entirely duplicates writes nothing and does not stamp lastEventIngestedAt", async () => {
    existingUids = new Set(["evt-1", "evt-2"]);
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([makeEvent("evt-1"), makeEvent("evt-2")]),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection(),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(result.status).toBe("success");
    expect(result.ingestedCount).toBe(0);
    expect(result.duplicateCount).toBe(2);
    expect(result.eventTimeStart).toBeUndefined();
    expect(SecurityEventService.insertJsonRows).not.toHaveBeenCalled();
    expect(OTelIngestService.telemetryServiceFromName).not.toHaveBeenCalled();
    const written: ConnectionUpdateCall = updateCall();
    expect(written.data["cursor"]).toBe(result.windowEnd);
    expect(written.data["lastEventIngestedAt"]).toBeUndefined();
  });

  test("a dedupe lookup failure fails the run in the import phase and holds the cursor", async () => {
    getJestSpyOn(
      SecurityEventDedupe,
      "findExistingEventUids",
    ).mockRejectedValue(
      new Error("Duplicate lookup exceeded its time limit.") as never,
    );
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([makeEvent("evt-1")]),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection({
          cursor: new Date(Date.now() - 5 * MINUTE_MS).toISOString(),
        }),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(result.status).toBe("failed");
    expect(findCheck(result, "failure").name).toBe("Import records");
    expect(SecurityEventService.insertJsonRows).not.toHaveBeenCalled();
    expect("cursor" in updateCall().data).toBe(false);
  });
});

describe("SecurityEventConnectionPoller.executeConnection - test, preview and backfill", () => {
  test("a test run validates, runs the connector's checks with the poll timeout and never fetches, imports or writes", async () => {
    const fake: FakeConnector = makeFakeConnector({
      checks: [
        check("authentication", "pass"),
        check("read-permission", "pass"),
      ],
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection(),
        { type: "test" },
        overridesFor(fake),
      );

    expect(result.status).toBe("success");
    expect(result.complete).toBe(true);
    expect(fake.testCalls).toEqual([
      {
        settings: SETTINGS,
        options: { requestTimeoutInMs: POLL_REQUEST_TIMEOUT_IN_MS },
      },
    ]);
    expect(fake.fetchCalls).toHaveLength(0);
    expect(
      result.checks.map((item: SecurityConnectorCheck): string => {
        return item.key;
      }),
    ).toEqual(["configuration", "authentication", "read-permission"]);
    expect(SecurityEventService.insertJsonRows).not.toHaveBeenCalled();
    expect(SecurityEventConnectionService.updateOneById).not.toHaveBeenCalled();
  });

  test("a test run fails when any provider check fails, naming the check", async () => {
    const fake: FakeConnector = makeFakeConnector({
      checks: [
        check("authentication", "pass"),
        check("read-permission", "fail", "HTTP 403 from the API."),
        check("detections-available", "warn"),
      ],
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection(),
        { type: "test" },
        overridesFor(fake),
      );

    expect(result.status).toBe("failed");
    expect(result.error).toBe("Check read-permission: HTTP 403 from the API.");
    // The provider's checks are kept so the reader sees which one failed.
    expect(
      result.checks.map((item: SecurityConnectorCheck): string => {
        return `${item.key}:${item.status}`;
      }),
    ).toEqual([
      "configuration:pass",
      "authentication:pass",
      "read-permission:fail",
      "detections-available:warn",
      "failure:fail",
    ]);
    expect(findCheck(result, "failure").name).toBe(
      `Check access to ${DEFINITION.title}`,
    );
  });

  test("a preview fetches the requested range but never dedupes, inserts or updates the connection", async () => {
    const startTime: string = new Date(
      Date.now() - 120 * MINUTE_MS,
    ).toISOString();
    const endTime: string = new Date(Date.now() - 60 * MINUTE_MS).toISOString();
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([makeEvent("evt-1"), makeEvent("evt-2")]),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection(),
        { type: "preview", startTime, endTime },
        overridesFor(fake),
      );

    expect(result.status).toBe("success");
    expect(result.fetchedCount).toBe(2);
    expect(result.ingestedCount).toBe(0);
    expect(result.windowStart).toBe(startTime);
    expect(result.windowEnd).toBe(endTime);
    expect(fake.fetchCalls[0]!.window.startTime.toISOString()).toBe(startTime);
    expect(fake.fetchCalls[0]!.window.endTime.toISOString()).toBe(endTime);
    expect(
      result.checks.map((item: SecurityConnectorCheck): string => {
        return item.key;
      }),
    ).toEqual(["configuration", "read"]);
    expect(SecurityEventDedupe.findExistingEventUids).not.toHaveBeenCalled();
    expect(SecurityEventService.insertJsonRows).not.toHaveBeenCalled();
    expect(SecurityEventConnectionService.updateOneById).not.toHaveBeenCalled();
  });

  test("an empty preview is 'empty'", async () => {
    const fake: FakeConnector = makeFakeConnector({});

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection(),
        {
          type: "preview",
          startTime: new Date(Date.now() - 120 * MINUTE_MS).toISOString(),
          endTime: new Date(Date.now() - 60 * MINUTE_MS).toISOString(),
        },
        overridesFor(fake),
      );

    expect(result.status).toBe("empty");
  });

  test("a backfill imports the range and stamps only lastEventIngestedAt, leaving the cursor alone", async () => {
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([makeEvent("evt-1")]),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection({
          cursor: new Date(Date.now() - 5 * MINUTE_MS).toISOString(),
        }),
        {
          type: "backfill",
          startTime: new Date(Date.now() - 120 * MINUTE_MS).toISOString(),
          endTime: new Date(Date.now() - 60 * MINUTE_MS).toISOString(),
        },
        overridesFor(fake),
      );

    expect(result.status).toBe("success");
    expect(result.ingestedCount).toBe(1);
    expect(insertedRows).toHaveLength(1);
    expect(SecurityEventConnectionService.updateOneById).toHaveBeenCalledTimes(
      1,
    );
    const written: ConnectionUpdateCall = updateCall();
    expect(Object.keys(written.data)).toEqual(["lastEventIngestedAt"]);
    expect(written.data["lastEventIngestedAt"]).toEqual(
      new Date(result.completedAt),
    );
  });

  test("a backfill that imports nothing does not touch the connection row", async () => {
    existingUids = new Set(["evt-1"]);
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([makeEvent("evt-1")]),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection(),
        {
          type: "backfill",
          startTime: new Date(Date.now() - 120 * MINUTE_MS).toISOString(),
          endTime: new Date(Date.now() - 60 * MINUTE_MS).toISOString(),
        },
        overridesFor(fake),
      );

    expect(result.duplicateCount).toBe(1);
    expect(SecurityEventConnectionService.updateOneById).not.toHaveBeenCalled();
  });
});

describe("SecurityEventConnectionPoller.pollConnection", () => {
  test("returns the ingested count of a poll", async () => {
    getJestSpyOn(
      SecurityEventConnectionPoller,
      "executeConnection",
    ).mockResolvedValue({
      status: "success",
      ingestedCount: 7,
    } as never);

    await expect(
      SecurityEventConnectionPoller.pollConnection(makeConnection()),
    ).resolves.toBe(7);
    expect(
      SecurityEventConnectionPoller.executeConnection,
    ).toHaveBeenCalledWith(
      expect.any(SecurityEventConnection),
      { type: "poll" },
      undefined,
    );
  });

  test("a failed poll (already booked on the row) surfaces as a RecordedConnectionPollFailure", async () => {
    getJestSpyOn(
      SecurityEventConnectionPoller,
      "executeConnection",
    ).mockResolvedValue({
      status: "failed",
      ingestedCount: 0,
      error: "Okta token rejected (HTTP 401).",
    } as never);

    const promise: Promise<number> =
      SecurityEventConnectionPoller.pollConnection(makeConnection());

    await expect(promise).rejects.toBeInstanceOf(RecordedConnectionPollFailure);
    await expect(promise).rejects.toThrow("Okta token rejected (HTTP 401).");
  });
});

describe("SecurityEventConnectionPoller.pollAllDueConnections", () => {
  test("polls due and never-polled connections and skips those inside their interval", async () => {
    const now: number = Date.now();
    const notDue: SecurityEventConnection = makeConnection({
      lastPolledAt: new Date(now - 2 * MINUTE_MS),
    });
    const overdue: SecurityEventConnection = makeConnection({
      _id: SECOND_CONNECTION_ID.toString(),
      lastPolledAt: new Date(now - 10 * MINUTE_MS),
    });
    const neverPolled: SecurityEventConnection = makeConnection({
      _id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    });
    getJestSpyOn(SecurityEventConnectionService, "findBy").mockResolvedValue([
      notDue,
      overdue,
      neverPolled,
    ] as never);
    const pollSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityEventConnectionPoller,
      "pollConnection",
    ).mockResolvedValue(0 as never);

    await SecurityEventConnectionPoller.pollAllDueConnections();

    expect(SecurityEventConnectionService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { isEnabled: true },
        props: { isRoot: true },
      }),
    );
    expect(
      pollSpy.mock.calls.map((call: Array<unknown>): string | undefined => {
        return (call[0] as SecurityEventConnection)._id;
      }),
    ).toEqual([
      SECOND_CONNECTION_ID.toString(),
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    ]);
    // Successful polls own their bookkeeping; the loop writes nothing.
    expect(SecurityEventConnectionService.updateOneById).not.toHaveBeenCalled();
  });

  test("a zero or missing interval is treated as at least one minute", async () => {
    const connection: SecurityEventConnection = makeConnection({
      pollIntervalInMinutes: 0,
      lastPolledAt: new Date(Date.now() - 30 * 1000),
    });
    getJestSpyOn(SecurityEventConnectionService, "findBy").mockResolvedValue([
      connection,
    ] as never);
    const pollSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityEventConnectionPoller,
      "pollConnection",
    ).mockResolvedValue(0 as never);

    await SecurityEventConnectionPoller.pollAllDueConnections();

    // Polled 30 seconds ago with a "0" interval read as 5 minutes: not due.
    expect(pollSpy).not.toHaveBeenCalled();
  });

  test("an unexpected failure is stamped on the row through recordFailure, redacted, and the loop continues", async () => {
    const first: SecurityEventConnection = makeConnection();
    const second: SecurityEventConnection = makeConnection({
      _id: SECOND_CONNECTION_ID.toString(),
    });
    getJestSpyOn(SecurityEventConnectionService, "findBy").mockResolvedValue([
      first,
      second,
    ] as never);
    const recordSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      ConnectorErrorMessage,
      "recordFailure",
    );
    const pollSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityEventConnectionPoller,
      "pollConnection",
    ).mockRejectedValue(
      new Error(
        `Okta token exchange failed (HTTP 401): client_secret=${SECRET_VALUE}`,
      ) as never,
    );

    await expect(
      SecurityEventConnectionPoller.pollAllDueConnections(),
    ).resolves.toBeUndefined();

    expect(pollSpy).toHaveBeenCalledTimes(2);
    expect(recordSpy).toHaveBeenCalledTimes(2);
    expect(recordSpy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        label: expect.stringContaining(CONNECTION_ID.toString()),
      }),
    );
    expect(SecurityEventConnectionService.updateOneById).toHaveBeenCalledTimes(
      2,
    );
    const written: ConnectionUpdateCall = updateCall();
    expect(written.id.toString()).toBe(CONNECTION_ID.toString());
    expect(written.data["lastPolledAt"]).toBeInstanceOf(Date);
    expect(written.data["lastError"]).toContain("Okta token exchange failed");
    expect(written.data["lastError"]).not.toContain(SECRET_VALUE);
    expect(updateCall(1).id.toString()).toBe(SECOND_CONNECTION_ID.toString());
  });

  test("a failure the poll already recorded on the row is not stamped a second time", async () => {
    getJestSpyOn(SecurityEventConnectionService, "findBy").mockResolvedValue([
      makeConnection(),
      makeConnection({ _id: SECOND_CONNECTION_ID.toString() }),
    ] as never);
    const pollSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityEventConnectionPoller,
      "pollConnection",
    ).mockRejectedValue(
      new RecordedConnectionPollFailure("already on the row") as never,
    );

    await SecurityEventConnectionPoller.pollAllDueConnections();

    expect(pollSpy).toHaveBeenCalledTimes(2);
    expect(SecurityEventConnectionService.updateOneById).not.toHaveBeenCalled();
  });

  test("a rejected bookkeeping write does not abandon the connections behind it", async () => {
    getJestSpyOn(SecurityEventConnectionService, "findBy").mockResolvedValue([
      makeConnection(),
      makeConnection({ _id: SECOND_CONNECTION_ID.toString() }),
    ] as never);
    const updateSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityEventConnectionService,
      "updateOneById",
    ).mockRejectedValue(new Error("deadlock detected") as never);
    const pollSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityEventConnectionPoller,
      "pollConnection",
    ).mockRejectedValue(new Error("token exchange failed") as never);

    await expect(
      SecurityEventConnectionPoller.pollAllDueConnections(),
    ).resolves.toBeUndefined();

    expect(pollSpy).toHaveBeenCalledTimes(2);
    expect(updateSpy).toHaveBeenCalledTimes(2);
  });

  test("a connection without an id is attempted but nothing is stamped", async () => {
    const withoutId: SecurityEventConnection = makeConnection();
    delete withoutId._id;
    getJestSpyOn(SecurityEventConnectionService, "findBy").mockResolvedValue([
      withoutId,
    ] as never);
    getJestSpyOn(
      SecurityEventConnectionPoller,
      "pollConnection",
    ).mockRejectedValue(new Error("boom") as never);

    await SecurityEventConnectionPoller.pollAllDueConnections();

    expect(SecurityEventConnectionService.updateOneById).not.toHaveBeenCalled();
  });
});
