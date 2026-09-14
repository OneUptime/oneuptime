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
  DEFAULT_CURSOR_OVERLAP_IN_MINUTES,
  DEFAULT_INITIAL_LOOKBACK_IN_MINUTES,
  MAX_CHUNK_MINUTES,
  MAX_DIAGNOSTIC_SAMPLES,
  MAX_EVENTS_PER_RUN,
  MAX_FETCH_REQUESTS,
  MAX_RANGE_MS,
  MIN_CHUNK_MINUTES,
  POLL_REQUEST_TIMEOUT_IN_MS,
  PollerOverrides,
  RecordedConnectionPollFailure,
  SECURITY_EVENT_SOURCE_LOCK_NAMESPACE,
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
import OneUptimeDate from "../../../../../Types/Date";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { SecurityConnectorCheck } from "../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import {
  SecurityEventConnectionRunOptions,
  SecurityEventConnectionRunResult,
} from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import SecurityEventConnectorProvider, {
  AllSecurityEventConnectorProviders,
} from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
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
/*
 * Okta's catalog overlap (15 minutes) is deliberately not the default, so
 * the window tests below prove the poller uses the provider's own value.
 */
const OVERLAP_MINUTES: number = DEFINITION.cursorOverlapInMinutes;

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
  test("the first window is a full day and the adaptive chunk runs from one minute to a day", () => {
    expect(DEFAULT_INITIAL_LOOKBACK_IN_MINUTES).toBe(24 * 60);
    expect(MAX_CHUNK_MINUTES).toBe(24 * 60);
    expect(MIN_CHUNK_MINUTES).toBe(1);
    expect(DEFAULT_CURSOR_OVERLAP_IN_MINUTES).toBe(1);
    expect(MAX_RANGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(OVERLAP_MINUTES).not.toBe(DEFAULT_CURSOR_OVERLAP_IN_MINUTES);
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
    expect(window.progressFrom?.toISOString()).toBe(
      window.startTime.toISOString(),
    );
    expect(window.chunkMinutes).toBe(MAX_CHUNK_MINUTES);
    expect(window.overlapInMinutes).toBe(OVERLAP_MINUTES);
  });

  test("a cursor poll starts the provider's overlap before the cursor and ends now", () => {
    const cursor: Date = new Date(NOW.getTime() - 5 * MINUTE_MS);
    const window: ReturnType<typeof SecurityEventConnectionPoller.getWindow> =
      SecurityEventConnectionPoller.getWindow(
        makeConnection({ cursor: cursor.toISOString() }),
        { type: "poll" },
        NOW,
      );

    expect(window.startTime.toISOString()).toBe(
      new Date(cursor.getTime() - OVERLAP_MINUTES * MINUTE_MS).toISOString(),
    );
    expect(window.endTime.toISOString()).toBe(NOW.toISOString());
    expect(window.hasUsableCursor).toBe(true);
    expect(window.warnings).toEqual([]);
    // The chunk counts only the new ground past the cursor, not the overlap.
    expect(window.progressFrom?.toISOString()).toBe(cursor.toISOString());
    expect(window.chunkMinutes).toBe(5);
  });

  test("a stale cursor is caught up in 24 hour chunks past the cursor with a warning", () => {
    /*
     * Review finding F1 correction: the chunk is measured from the cursor,
     * so a catch-up window is a day plus the overlap long (it used to be
     * exactly a day from the window start).
     */
    const cursor: Date = new Date(NOW.getTime() - 7 * 24 * 60 * MINUTE_MS);
    const window: ReturnType<typeof SecurityEventConnectionPoller.getWindow> =
      SecurityEventConnectionPoller.getWindow(
        makeConnection({ cursor: cursor.toISOString() }),
        { type: "poll" },
        NOW,
      );

    expect(window.hasUsableCursor).toBe(true);
    expect(window.endTime.getTime() - window.startTime.getTime()).toBe(
      (MAX_CHUNK_MINUTES + OVERLAP_MINUTES) * MINUTE_MS,
    );
    expect(window.endTime.toISOString()).toBe(
      new Date(cursor.getTime() + MAX_CHUNK_MINUTES * MINUTE_MS).toISOString(),
    );
    expect(window.endTime.getTime()).toBeLessThan(NOW.getTime());
    expect(window.chunkMinutes).toBe(MAX_CHUNK_MINUTES);
    expect(window.warnings).toEqual([
      "Catching up from the saved cursor in 24 hour windows. Later records will be fetched by subsequent polls.",
    ]);
  });

  test("a cursor exactly one chunk behind is not chunked", () => {
    // Review finding F1 correction: the chunk end is cursor + 24h, so a cursor exactly a day old lands it on now.
    const cursor: Date = new Date(
      NOW.getTime() - MAX_CHUNK_MINUTES * MINUTE_MS,
    );
    const window: ReturnType<typeof SecurityEventConnectionPoller.getWindow> =
      SecurityEventConnectionPoller.getWindow(
        makeConnection({ cursor: cursor.toISOString() }),
        { type: "poll" },
        NOW,
      );

    expect(window.endTime.toISOString()).toBe(NOW.toISOString());
    expect(window.warnings).toEqual([]);
    expect(window.chunkMinutes).toBe(MAX_CHUNK_MINUTES);
  });

  test("the chunk comes from the previous poll's nextChunkMinutes and is measured from the cursor", () => {
    const cursor: Date = new Date(NOW.getTime() - 3 * 24 * 60 * MINUTE_MS);
    const window: ReturnType<typeof SecurityEventConnectionPoller.getWindow> =
      SecurityEventConnectionPoller.getWindow(
        makeConnection({
          cursor: cursor.toISOString(),
          lastPollResult: { nextChunkMinutes: 90 },
        }),
        { type: "poll" },
        NOW,
      );

    expect(window.startTime.toISOString()).toBe(
      new Date(cursor.getTime() - OVERLAP_MINUTES * MINUTE_MS).toISOString(),
    );
    expect(window.endTime.toISOString()).toBe(
      new Date(cursor.getTime() + 90 * MINUTE_MS).toISOString(),
    );
    expect(window.chunkMinutes).toBe(90);
    expect(window.warnings).toEqual([
      "Catching up from the saved cursor in 90 minute windows. Later records will be fetched by subsequent polls.",
    ]);
  });

  test("a chunk no longer than the overlap still ends after the cursor, so the cursor can always move forward", () => {
    /*
     * Review finding F1 correction: measured from the window start, a one
     * minute chunk with a 15 minute overlap would end 14 minutes BEFORE the
     * cursor, and neither a complete read nor a forced advance could move
     * the cursor forward again.
     */
    const cursor: Date = new Date(NOW.getTime() - 3 * 24 * 60 * MINUTE_MS);
    const window: ReturnType<typeof SecurityEventConnectionPoller.getWindow> =
      SecurityEventConnectionPoller.getWindow(
        makeConnection({
          cursor: cursor.toISOString(),
          lastPollResult: { nextChunkMinutes: MIN_CHUNK_MINUTES },
        }),
        { type: "poll" },
        NOW,
      );

    expect(OVERLAP_MINUTES).toBeGreaterThan(MIN_CHUNK_MINUTES);
    expect(window.endTime.getTime()).toBe(
      cursor.getTime() + MIN_CHUNK_MINUTES * MINUTE_MS,
    );
    expect(window.endTime.getTime()).toBeGreaterThan(cursor.getTime());
    expect(window.chunkMinutes).toBe(MIN_CHUNK_MINUTES);
  });

  test("a chunk longer than the time since the cursor ends now and records the minutes used, rounded up", () => {
    const cursor: Date = new Date(NOW.getTime() - 4.5 * MINUTE_MS);
    const window: ReturnType<typeof SecurityEventConnectionPoller.getWindow> =
      SecurityEventConnectionPoller.getWindow(
        makeConnection({
          cursor: cursor.toISOString(),
          lastPollResult: { nextChunkMinutes: 720 },
        }),
        { type: "poll" },
        NOW,
      );

    expect(window.endTime.toISOString()).toBe(NOW.toISOString());
    expect(window.chunkMinutes).toBe(5);
    expect(window.warnings).toEqual([]);
  });

  test("without a usable cursor a narrowed chunk is measured from the start of the default window", () => {
    const window: ReturnType<typeof SecurityEventConnectionPoller.getWindow> =
      SecurityEventConnectionPoller.getWindow(
        makeConnection({
          cursor: "yesterday-ish",
          lastPollResult: { nextChunkMinutes: 30 },
        }),
        { type: "poll" },
        NOW,
      );

    const expectedStart: number =
      NOW.getTime() - DEFAULT_INITIAL_LOOKBACK_IN_MINUTES * MINUTE_MS;
    expect(window.hasUsableCursor).toBe(false);
    expect(window.startTime.getTime()).toBe(expectedStart);
    expect(window.endTime.getTime()).toBe(expectedStart + 30 * MINUTE_MS);
    expect(window.chunkMinutes).toBe(30);
    expect(window.warnings).toEqual([
      "The saved cursor is unreadable; polling the default 24 hour window.",
      "Catching up from the start of the default 24 hour window in 30 minute windows. Later records will be fetched by subsequent polls.",
    ]);
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
    // Only scheduled polls carry a chunk.
    expect(window.chunkMinutes).toBeUndefined();
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
      // The user's range is never cut into chunks.
      expect(window.chunkMinutes).toBeUndefined();
      expect(window.warnings).toEqual([]);
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

  test.each<[string, JSONObject | null | undefined, number]>([
    ["no previous poll", undefined, MAX_CHUNK_MINUTES],
    ["a null result", null, MAX_CHUNK_MINUTES],
    ["a result without the field", { status: "success" }, MAX_CHUNK_MINUTES],
    ["the minimum", { nextChunkMinutes: MIN_CHUNK_MINUTES }, MIN_CHUNK_MINUTES],
    ["a narrowed chunk", { nextChunkMinutes: 90 }, 90],
    ["the maximum", { nextChunkMinutes: MAX_CHUNK_MINUTES }, MAX_CHUNK_MINUTES],
    ["zero", { nextChunkMinutes: 0 }, MAX_CHUNK_MINUTES],
    ["a negative value", { nextChunkMinutes: -5 }, MAX_CHUNK_MINUTES],
    [
      "more than a day",
      { nextChunkMinutes: MAX_CHUNK_MINUTES + 1 },
      MAX_CHUNK_MINUTES,
    ],
    ["a fraction", { nextChunkMinutes: 2.5 }, MAX_CHUNK_MINUTES],
    ["a string", { nextChunkMinutes: "90" }, MAX_CHUNK_MINUTES],
    ["NaN", { nextChunkMinutes: Number.NaN }, MAX_CHUNK_MINUTES],
    [
      "infinity",
      { nextChunkMinutes: Number.POSITIVE_INFINITY },
      MAX_CHUNK_MINUTES,
    ],
  ])(
    "the chunk limit read from %s",
    (
      _label: string,
      lastPollResult: JSONObject | null | undefined,
      expected: number,
    ) => {
      expect(
        SecurityEventConnectionPoller.getChunkLimitInMinutes(lastPollResult),
      ).toBe(expected);
    },
  );

  test("every catalog provider's own overlap is used, and an unknown provider gets the default", () => {
    for (const provider of AllSecurityEventConnectorProviders) {
      expect({
        provider,
        overlap:
          SecurityEventConnectionPoller.getCursorOverlapInMinutes(provider),
      }).toEqual({
        provider,
        overlap:
          getSecurityEventConnectorDefinition(provider)!.cursorOverlapInMinutes,
      });
    }

    expect(
      SecurityEventConnectionPoller.getCursorOverlapInMinutes("not-a-provider"),
    ).toBe(DEFAULT_CURSOR_OVERLAP_IN_MINUTES);
    expect(
      SecurityEventConnectionPoller.getCursorOverlapInMinutes(undefined),
    ).toBe(DEFAULT_CURSOR_OVERLAP_IN_MINUTES);
  });

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
        /*
         * Review finding F1: the adaptive chunk lives in lastPollResult, so
         * the in-lock reload must select it or every poll restarts at a day.
         */
        select: expect.objectContaining({
          secrets: true,
          cursor: true,
          lastPollResult: true,
        }),
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
    // A complete first poll read its whole day, so the next chunk stays a day.
    expect(result.chunkMinutes).toBe(MAX_CHUNK_MINUTES);
    expect(result.nextChunkMinutes).toBe(MAX_CHUNK_MINUTES);
    expect(result.forcedAdvance).toBeUndefined();
    expect(result.overlapFloor).toBeUndefined();
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
      new Date(cursor.getTime() - OVERLAP_MINUTES * MINUTE_MS).toISOString(),
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

  test("an incomplete fetch that cannot resume holds the cursor, halves the next chunk, records the warnings and is 'partial'", async () => {
    // Review finding F1: holding alone re-read the same window forever; the next window must be narrower.
    const cursor: Date = new Date(Date.now() - 3 * 24 * 60 * MINUTE_MS);
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([makeEvent("evt-1")], {
        complete: false,
        requestCount: MAX_FETCH_REQUESTS,
        warnings: ["Stopped after 20 requests; the window was not fully read."],
      }),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection({
          cursor: cursor.toISOString(),
          lastPollResult: { nextChunkMinutes: 90 },
        }),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(result.status).toBe("partial");
    expect(result.complete).toBe(false);
    expect(result.ingestedCount).toBe(1);
    expect(result.chunkMinutes).toBe(90);
    expect(result.nextChunkMinutes).toBe(45);
    expect(result.forcedAdvance).toBeUndefined();
    expect(result.warnings).toEqual([
      "Catching up from the saved cursor in 90 minute windows. Later records will be fetched by subsequent polls.",
      "Stopped after 20 requests; the window was not fully read.",
      "This window holds more records than one poll can read; the next poll reads a 45 minute window from the same starting point.",
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("the next poll reads a 45 minute window"),
    );

    const written: ConnectionUpdateCall = updateCall();
    // The cursor key is absent, so the stored cursor stays where it was.
    expect("cursor" in written.data).toBe(false);
    expect(written.data["lastSuccessfulPollAt"]).toBeUndefined();
    expect(written.data["lastEventIngestedAt"]).toBeInstanceOf(Date);
    expect(written.data["lastError"]).toBe(result.warnings.join(" "));
    expect(written.data["lastPolledAt"]).toBeInstanceOf(Date);
    expect(
      (written.data["lastPollResult"] as JSONObject)["nextChunkMinutes"],
    ).toBe(45);
  });

  test("an incomplete fetch with no warning text still explains what the next poll does", async () => {
    // Review finding F1: the old fallback promised a retry of "the same window", which is what pinned polling.
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([], { complete: false }),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection({
          cursor: new Date(Date.now() - 3 * 24 * 60 * MINUTE_MS).toISOString(),
          lastPollResult: { nextChunkMinutes: 10 },
        }),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(result.nextChunkMinutes).toBe(5);
    expect(updateCall().data["lastError"]).toBe(
      "Catching up from the saved cursor in 10 minute windows. Later records will be fetched by subsequent polls. This window holds more records than one poll can read; the next poll reads a 5 minute window from the same starting point.",
    );
  });

  test("an incomplete first poll anchors the cursor one overlap into the window and halves the day", async () => {
    // Review finding F1: the anchor makes the next window start at the same instant, and the halved chunk makes it shorter.
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
    expect(result.chunkMinutes).toBe(MAX_CHUNK_MINUTES);
    expect(result.nextChunkMinutes).toBe(MAX_CHUNK_MINUTES / 2);
    const written: ConnectionUpdateCall = updateCall();
    const anchor: string = new Date(
      new Date(result.windowStart).getTime() + OVERLAP_MINUTES * MINUTE_MS,
    ).toISOString();
    expect(written.data["cursor"]).toBe(anchor);
    expect(written.data["lastSuccessfulPollAt"]).toBeUndefined();

    // The next poll starts where this one did and reads half a day past the anchor.
    const next: ReturnType<typeof SecurityEventConnectionPoller.getWindow> =
      SecurityEventConnectionPoller.getWindow(
        makeConnection({
          cursor: anchor,
          lastPollResult: JSON.parse(JSON.stringify(result)) as JSONObject,
        }),
        { type: "poll" },
        new Date(new Date(result.windowEnd).getTime() + 5 * MINUTE_MS),
      );
    expect(next.startTime.toISOString()).toBe(result.windowStart);
    expect(next.endTime.getTime()).toBe(
      new Date(anchor).getTime() + (MAX_CHUNK_MINUTES / 2) * MINUTE_MS,
    );
  });

  test("a complete poll doubles the chunk it used, capped at a day", async () => {
    const cursor: Date = new Date(Date.now() - 3 * 24 * 60 * MINUTE_MS);

    for (const [used, expected] of [
      [45, 90],
      [720, MAX_CHUNK_MINUTES],
      [MAX_CHUNK_MINUTES, MAX_CHUNK_MINUTES],
    ] as Array<[number, number]>) {
      const fake: FakeConnector = makeFakeConnector({});
      const result: SecurityEventConnectionRunResult =
        await SecurityEventConnectionPoller.executeConnection(
          makeConnection({
            cursor: cursor.toISOString(),
            lastPollResult: { nextChunkMinutes: used },
          }),
          { type: "poll" },
          overridesFor(fake),
        );

      expect({ used, chunk: result.chunkMinutes }).toEqual({
        used,
        chunk: used,
      });
      expect({ used, next: result.nextChunkMinutes }).toEqual({
        used,
        next: expected,
      });
      expect(result.windowEnd).toBe(
        new Date(cursor.getTime() + used * MINUTE_MS).toISOString(),
      );
    }
  });

  test("a poll that stops on a bound after real progress resumes from resumeAfter and keeps the chunk", async () => {
    const cursor: Date = new Date(Date.now() - 3 * 24 * 60 * MINUTE_MS);
    const resumeAfter: Date = new Date(cursor.getTime() + 20 * MINUTE_MS);
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([makeEvent("evt-1", resumeAfter)], {
        complete: false,
        resumeAfter,
      }),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection({
          cursor: cursor.toISOString(),
          lastPollResult: { nextChunkMinutes: 60 },
        }),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(result.status).toBe("partial");
    expect(result.chunkMinutes).toBe(60);
    expect(result.nextChunkMinutes).toBe(60);
    expect(result.forcedAdvance).toBeUndefined();
    expect(result.warnings).toContain(
      `This poll stopped before the end of its window after reading records created up to ${resumeAfter.toISOString()}; the next poll resumes from there.`,
    );
    const written: ConnectionUpdateCall = updateCall();
    expect(written.data["cursor"]).toBe(resumeAfter.toISOString());
    expect(written.data["lastSuccessfulPollAt"]).toBeUndefined();
    expect(written.data["lastError"]).toContain(resumeAfter.toISOString());
  });

  test.each<[string, (cursor: Date, windowEnd: Date) => Date]>([
    [
      "inside the overlap",
      (cursor: Date): Date => {
        return new Date(cursor.getTime() - 5 * MINUTE_MS);
      },
    ],
    [
      "exactly on the previous cursor",
      (cursor: Date): Date => {
        return cursor;
      },
    ],
    [
      "after the window end",
      (_cursor: Date, windowEnd: Date): Date => {
        return new Date(windowEnd.getTime() + MINUTE_MS);
      },
    ],
    [
      "that is not a valid date",
      (): Date => {
        return new Date("not a date");
      },
    ],
  ])(
    "a resumeAfter %s is not progress: the cursor holds and the chunk halves",
    async (_label: string, pick: (cursor: Date, windowEnd: Date) => Date) => {
      const cursor: Date = new Date(Date.now() - 3 * 24 * 60 * MINUTE_MS);
      const windowEnd: Date = new Date(cursor.getTime() + 60 * MINUTE_MS);
      const fake: FakeConnector = makeFakeConnector({
        fetch: makeFetchResult([], {
          complete: false,
          resumeAfter: pick(cursor, windowEnd),
        }),
      });

      const result: SecurityEventConnectionRunResult =
        await SecurityEventConnectionPoller.executeConnection(
          makeConnection({
            cursor: cursor.toISOString(),
            lastPollResult: { nextChunkMinutes: 60 },
          }),
          { type: "poll" },
          overridesFor(fake),
        );

      expect(result.windowEnd).toBe(windowEnd.toISOString());
      expect(result.nextChunkMinutes).toBe(30);
      expect("cursor" in updateCall().data).toBe(false);
    },
  );

  test("a one-minute window that still cannot be read is skipped past with a loud lastError and an overlap floor", async () => {
    const cursor: Date = new Date(Date.now() - 3 * 24 * 60 * MINUTE_MS);
    const windowEnd: Date = new Date(cursor.getTime() + MINUTE_MS);
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([makeEvent("evt-1", cursor)], {
        complete: false,
        warnings: ["Stopped after 20 requests; the window was not fully read."],
      }),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection({
          cursor: cursor.toISOString(),
          lastPollResult: { nextChunkMinutes: MIN_CHUNK_MINUTES },
        }),
        { type: "poll" },
        overridesFor(fake),
      );

    const forcedMessage: string = `More records were created in the one minute from ${cursor.toISOString()} to ${windowEnd.toISOString()} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.`;
    expect(result.status).toBe("partial");
    expect(result.complete).toBe(false);
    expect(result.forcedAdvance).toBe(true);
    expect(result.chunkMinutes).toBe(MIN_CHUNK_MINUTES);
    expect(result.nextChunkMinutes).toBe(MIN_CHUNK_MINUTES);
    expect(result.overlapFloor).toBe(windowEnd.toISOString());
    expect(result.warnings[0]).toBe(forcedMessage);

    const written: ConnectionUpdateCall = updateCall();
    expect(written.data["cursor"]).toBe(windowEnd.toISOString());
    expect(String(written.data["lastError"]).startsWith(forcedMessage)).toBe(
      true,
    );
    expect(written.data["lastSuccessfulPollAt"]).toBeUndefined();
  });

  test("a window after a forced advance starts at the overlap floor until the overlap no longer reaches it", () => {
    const floor: Date = new Date("2026-09-10T08:00:00.000Z");
    const now: Date = new Date("2026-09-10T12:00:00.000Z");
    const windowFor: (
      cursor: Date,
      overlapFloor: string | undefined,
    ) => ReturnType<typeof SecurityEventConnectionPoller.getWindow> = (
      cursor: Date,
      overlapFloor: string | undefined,
    ): ReturnType<typeof SecurityEventConnectionPoller.getWindow> => {
      return SecurityEventConnectionPoller.getWindow(
        makeConnection({
          cursor: cursor.toISOString(),
          lastPollResult: {
            nextChunkMinutes: 2,
            ...(overlapFloor ? { overlapFloor } : {}),
          },
        }),
        { type: "poll" },
        now,
      );
    };

    // Right after the forced advance the cursor is the floor: no overlap at all.
    const atFloor: ReturnType<typeof SecurityEventConnectionPoller.getWindow> =
      windowFor(floor, floor.toISOString());
    expect(atFloor.startTime.toISOString()).toBe(floor.toISOString());
    expect(atFloor.overlapFloor?.toISOString()).toBe(floor.toISOString());

    // Part of the overlap past the floor is still re-read.
    const inside: ReturnType<typeof SecurityEventConnectionPoller.getWindow> =
      windowFor(new Date(floor.getTime() + 5 * MINUTE_MS), floor.toISOString());
    expect(inside.startTime.toISOString()).toBe(floor.toISOString());
    expect(inside.overlapFloor?.toISOString()).toBe(floor.toISOString());

    // Once cursor - overlap reaches the floor it no longer clamps and is dropped.
    const reached: ReturnType<typeof SecurityEventConnectionPoller.getWindow> =
      windowFor(
        new Date(floor.getTime() + OVERLAP_MINUTES * MINUTE_MS),
        floor.toISOString(),
      );
    expect(reached.startTime.toISOString()).toBe(floor.toISOString());
    expect(reached.overlapFloor).toBeUndefined();

    // A floor later than the cursor, or unreadable, is ignored.
    for (const bad of [
      new Date(floor.getTime() + 60 * MINUTE_MS).toISOString(),
      "not a date",
    ]) {
      const ignored: ReturnType<
        typeof SecurityEventConnectionPoller.getWindow
      > = windowFor(floor, bad);
      expect(ignored.startTime.toISOString()).toBe(
        new Date(floor.getTime() - OVERLAP_MINUTES * MINUTE_MS).toISOString(),
      );
      expect(ignored.overlapFloor).toBeUndefined();
    }
  });

  test("a poll clamped by the overlap floor resumes past the cursor even though the window starts later, and floors the next poll at the resume point", async () => {
    const cursor: Date = new Date(Date.now() - 3 * 24 * 60 * MINUTE_MS);
    const floor: Date = new Date(cursor.getTime() - 5 * MINUTE_MS);
    const resumeAfter: Date = new Date(cursor.getTime() + 2 * MINUTE_MS);
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([], { complete: false, resumeAfter }),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection({
          cursor: cursor.toISOString(),
          lastPollResult: {
            nextChunkMinutes: 10,
            overlapFloor: floor.toISOString(),
          },
        }),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(fake.fetchCalls[0]!.window.startTime.toISOString()).toBe(
      floor.toISOString(),
    );
    /*
     * A resume floors the next poll at the resume point itself: during a
     * backlog the overlap would only re-read what this poll just read.
     */
    expect(result.overlapFloor).toBe(resumeAfter.toISOString());
    /*
     * resumeAfter is 2 minutes past the cursor but earlier than window
     * start + overlap (10 minutes past it): it is still real progress.
     */
    expect(updateCall().data["cursor"]).toBe(resumeAfter.toISOString());
    // A resumed poll keeps the chunk it was given, not the stretch it read.
    expect(result.nextChunkMinutes).toBe(10);
  });

  test("a caught-up complete poll never shrinks the chunk it was given", async () => {
    // Given a full day but only 5 minutes of new ground up to now.
    const cursor: Date = new Date(Date.now() - 5 * MINUTE_MS);
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([], { complete: true }),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection({
          cursor: cursor.toISOString(),
          lastPollResult: { nextChunkMinutes: 1440 },
        }),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(result.chunkMinutes).toBeLessThanOrEqual(6);
    expect(result.nextChunkMinutes).toBe(1440);
  });

  test("a complete poll after narrowing doubles back from the stretch it read", async () => {
    const cursor: Date = new Date(Date.now() - 3 * 24 * 60 * MINUTE_MS);
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([], { complete: true }),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection({
          cursor: cursor.toISOString(),
          lastPollResult: { nextChunkMinutes: 90 },
        }),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(result.chunkMinutes).toBe(90);
    expect(result.nextChunkMinutes).toBe(180);
  });

  test("a caught-up failed poll keeps the chunk it was given", async () => {
    const cursor: Date = new Date(Date.now() - 5 * MINUTE_MS);
    const fake: FakeConnector = makeFakeConnector({
      fetch: new Error("Okta System Log events request failed (HTTP 500)"),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection({
          cursor: cursor.toISOString(),
          lastPollResult: { nextChunkMinutes: 1440 },
        }),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(result.status).toBe("failed");
    expect(result.nextChunkMinutes).toBe(1440);
  });

  test("a request that timed out on a wide window narrows the next one instead of retrying it forever", async () => {
    const cursor: Date = new Date(Date.now() - 3 * 24 * 60 * MINUTE_MS);
    const fake: FakeConnector = makeFakeConnector({
      fetch: new Error(
        "Splunk Enterprise Security search did not complete: timeout of 60000ms exceeded",
      ),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection({
          cursor: cursor.toISOString(),
          lastPollResult: { nextChunkMinutes: 1440 },
        }),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(result.status).toBe("failed");
    expect(result.nextChunkMinutes).toBe(720);
    expect(
      result.warnings.some((warning: string): boolean => {
        return warning.includes("did not answer in time");
      }),
    ).toBe(true);
    // The cursor is held: nothing in the window was read.
    expect(updateCall().data["cursor"]).toBeUndefined();
  });

  test("a failed fetch records a redacted error, a failure check named after the phase, and holds a usable cursor and its chunk", async () => {
    const cursor: Date = new Date(Date.now() - 3 * 24 * 60 * MINUTE_MS);
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

    // Review finding F1: a failure is not a volume signal, so the chunk is unchanged.
    expect(result.chunkMinutes).toBe(MAX_CHUNK_MINUTES);
    expect(result.nextChunkMinutes).toBe(MAX_CHUNK_MINUTES);
    expect(result.forcedAdvance).toBeUndefined();

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
        new Date(result.windowStart).getTime() + OVERLAP_MINUTES * MINUTE_MS,
      ).toISOString(),
    );
  });

  test("a failed poll keeps a narrowed chunk and carries the overlap floor unchanged", async () => {
    const cursor: Date = new Date(Date.now() - 3 * 24 * 60 * MINUTE_MS);
    const floor: Date = new Date(cursor.getTime() - MINUTE_MS);
    const fake: FakeConnector = makeFakeConnector({
      fetch: new Error("Okta system log read failed (HTTP 503): unavailable"),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection({
          cursor: cursor.toISOString(),
          lastPollResult: {
            nextChunkMinutes: 22,
            overlapFloor: floor.toISOString(),
          },
        }),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(result.status).toBe("failed");
    expect(result.chunkMinutes).toBe(22);
    expect(result.nextChunkMinutes).toBe(22);
    expect(result.overlapFloor).toBe(floor.toISOString());
    expect("cursor" in updateCall().data).toBe(false);
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

  test("normalization failures hold the cursor for retry, narrow the next window and fail the read check", async () => {
    /*
     * Review finding F1: holding alone would pin polling behind a record
     * that never normalizes; the window now narrows around it instead.
     */
    const cursor: Date = new Date(Date.now() - 3 * 24 * 60 * MINUTE_MS);
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([makeEvent("evt-1")], {
        fetchedCount: 3,
        failedCount: 2,
        requestCount: 2,
        // A complete fetch has nothing to resume from, even if a connector says so.
        resumeAfter: new Date(cursor.getTime() + 30 * MINUTE_MS),
      }),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection({
          cursor: cursor.toISOString(),
          lastPollResult: { nextChunkMinutes: 60 },
        }),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(result.status).toBe("partial");
    expect(result.complete).toBe(false);
    expect(result.failedCount).toBe(2);
    // The recognizable record is still imported; only the cursor holds.
    expect(result.ingestedCount).toBe(1);
    expect(result.nextChunkMinutes).toBe(30);
    expect(result.warnings).toContain(
      "2 records could not be normalized and were not imported.",
    );
    expect(result.warnings).toContain(
      "Some records in this window could not be normalized; the next poll reads a 30 minute window from the same starting point to retry them.",
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

  test("a one-minute window whose records still fail to normalize is skipped past, naming the failures", async () => {
    const cursor: Date = new Date(Date.now() - 3 * 24 * 60 * MINUTE_MS);
    const windowEnd: Date = new Date(cursor.getTime() + MINUTE_MS);
    const fake: FakeConnector = makeFakeConnector({
      fetch: makeFetchResult([], { fetchedCount: 4, failedCount: 4 }),
    });

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection({
          cursor: cursor.toISOString(),
          lastPollResult: { nextChunkMinutes: MIN_CHUNK_MINUTES },
        }),
        { type: "poll" },
        overridesFor(fake),
      );

    expect(result.forcedAdvance).toBe(true);
    expect(result.warnings[0]).toBe(
      `4 records created in the one minute from ${cursor.toISOString()} to ${windowEnd.toISOString()} could not be normalized. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to retry them.`,
    );
    const written: ConnectionUpdateCall = updateCall();
    expect(written.data["cursor"]).toBe(windowEnd.toISOString());
    expect(String(written.data["lastError"])).toContain(
      "could not be normalized. Polling moved past this minute",
    );
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
    // The adaptive chunk belongs to scheduled polls only.
    expect(result.chunkMinutes).toBeUndefined();
    expect(result.nextChunkMinutes).toBeUndefined();
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
    // Neither the cursor nor lastPollResult (which carries the chunk) is touched.
    expect(Object.keys(written.data)).toEqual(["lastEventIngestedAt"]);
    expect(result.chunkMinutes).toBeUndefined();
    expect(result.nextChunkMinutes).toBeUndefined();
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

/*
 * Review finding F1, end to end: many scheduled polls in a row against a
 * fake source that holds more records than one run can read. The fake
 * honours maxRequests and maxEvents with a fixed page size, filters on
 * creation time with an inclusive start and exclusive end, and either
 * reads in ascending creation order and reports resumeAfter (Okta, AWS,
 * Sentinel, Falcon, Elastic, Splunk) or returns newest first and cannot
 * resume. Each poll feeds the next one the cursor and lastPollResult it
 * wrote, the clock moves five minutes per poll, and storage dedupes by id,
 * exactly as the real connection row and ClickHouse would.
 */
const SIMULATED_PAGE_SIZE: number = 25;
const SIMULATED_RUN_CAPACITY: number = SIMULATED_PAGE_SIZE * MAX_FETCH_REQUESTS;
const SIMULATED_POLL_INTERVAL_IN_MINUTES: number = 5;

interface SourceRecord {
  uid: string;
  createdAt: Date;
}

interface SimulatedSource {
  records: Array<SourceRecord>;
  order: "ascending" | "newestFirst";
  failNext?: Error | undefined;
  fetchWindows: Array<ConnectorFetchWindow>;
}

interface SimulationState {
  now: Date;
  cursor: string | undefined;
  lastPollResult: JSONObject | undefined;
  lastError: string | null | undefined;
  imported: Set<string>;
  insertedCount: number;
}

interface SimulatedPoll {
  index: number;
  cursorBefore: string | undefined;
  result: SecurityEventConnectionRunResult;
  written: JSONObject;
}

function makeSimulatedConnector(
  source: SimulatedSource,
  provider: SecurityEventConnectorProvider,
): SecurityEventConnector {
  return {
    provider,
    validateSettings: (): void => {
      return;
    },
    testConnection: (): Promise<Array<SecurityConnectorCheck>> => {
      return Promise.resolve([]);
    },
    fetchEvents: (
      _settings: SecurityConnectorSettings,
      window: ConnectorFetchWindow,
      options: ConnectorFetchOptions,
    ): Promise<ConnectorFetchResult> => {
      source.fetchWindows.push(window);

      if (source.failNext) {
        const failure: Error = source.failNext;
        source.failNext = undefined;
        return Promise.reject(failure);
      }

      const matching: Array<SourceRecord> = source.records
        .filter((record: SourceRecord): boolean => {
          return (
            record.createdAt >= window.startTime &&
            record.createdAt < window.endTime
          );
        })
        .sort((left: SourceRecord, right: SourceRecord): number => {
          return (
            left.createdAt.getTime() - right.createdAt.getTime() ||
            left.uid.localeCompare(right.uid)
          );
        });

      if (source.order === "newestFirst") {
        matching.reverse();
      }

      const read: Array<SourceRecord> = [];
      let requestCount: number = 0;

      while (
        requestCount < options.maxRequests &&
        read.length < matching.length &&
        read.length < options.maxEvents
      ) {
        requestCount++;
        read.push(
          ...matching.slice(
            read.length,
            Math.min(read.length + SIMULATED_PAGE_SIZE, options.maxEvents),
          ),
        );
      }

      const complete: boolean = read.length === matching.length;
      const last: SourceRecord | undefined = read[read.length - 1];

      return Promise.resolve(
        makeFetchResult(
          read.map((record: SourceRecord): NormalizedSecurityEvent => {
            return makeEvent(record.uid, record.createdAt);
          }),
          {
            complete,
            requestCount: Math.max(1, requestCount),
            warnings: complete
              ? []
              : [
                  `Stopped after ${requestCount} requests; the window was not fully read.`,
                ],
            samples: [],
            resumeAfter:
              !complete && source.order === "ascending" && last
                ? last.createdAt
                : undefined,
          },
        ),
      );
    },
  };
}

function startSimulation(
  now: Date,
  cursor: string | undefined = undefined,
): SimulationState {
  const state: SimulationState = {
    now,
    cursor,
    lastPollResult: undefined,
    lastError: undefined,
    imported: new Set(),
    insertedCount: 0,
  };

  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(state.now.getTime());
  });
  getJestSpyOn(SecurityEventDedupe, "findExistingEventUids").mockImplementation(
    ((query: { ids: Array<string> }): Promise<Set<string>> => {
      return Promise.resolve(
        new Set(
          query.ids.filter((id: string): boolean => {
            return state.imported.has(id);
          }),
        ),
      );
    }) as never,
  );
  getJestSpyOn(SecurityEventService, "insertJsonRows").mockImplementation(((
    rows: Array<JSONObject>,
  ): Promise<void> => {
    for (const row of rows) {
      state.imported.add(row["eventUid"] as string);
    }
    state.insertedCount += rows.length;
    return Promise.resolve();
  }) as never);

  return state;
}

async function runScheduledPolls(data: {
  state: SimulationState;
  source: SimulatedSource;
  provider: SecurityEventConnectorProvider;
  maxPolls: number;
  beforePoll?: ((index: number) => void) | undefined;
  until: (poll: SimulatedPoll) => boolean;
}): Promise<Array<SimulatedPoll>> {
  const connector: SecurityEventConnector = makeSimulatedConnector(
    data.source,
    data.provider,
  );
  const updateSpy: jest.Mock =
    SecurityEventConnectionService.updateOneById as unknown as jest.Mock;
  const polls: Array<SimulatedPoll> = [];

  for (let index: number = 0; index < data.maxPolls; index++) {
    data.beforePoll?.(index);

    const cursorBefore: string | undefined = data.state.cursor;
    const callsBefore: number = updateSpy.mock.calls.length;
    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        makeConnection({
          provider: data.provider,
          // exactOptionalPropertyTypes: only set what the row actually holds.
          ...(data.state.cursor !== undefined
            ? { cursor: data.state.cursor }
            : {}),
          ...(data.state.lastPollResult !== undefined
            ? { lastPollResult: data.state.lastPollResult }
            : {}),
        }),
        { type: "poll" },
        {
          connector,
          settings: { ...SETTINGS, provider: data.provider },
        },
      );

    expect(updateSpy.mock.calls.length).toBe(callsBefore + 1);
    const written: JSONObject = (
      updateSpy.mock.calls[callsBefore]![0] as ConnectionUpdateCall
    ).data;

    const writtenCursor: unknown = written["cursor"];

    if (typeof writtenCursor === "string") {
      // The F1 invariant: a cursor written after a cursor is strictly later.
      if (cursorBefore !== undefined) {
        expect({
          poll: index,
          advanced: Date.parse(writtenCursor) > Date.parse(cursorBefore),
        }).toEqual({ poll: index, advanced: true });
      }
      data.state.cursor = writtenCursor;
    }

    // A jsonb round trip, as the next reload would return it.
    data.state.lastPollResult = JSON.parse(
      JSON.stringify(written["lastPollResult"]),
    ) as JSONObject;
    data.state.lastError = written["lastError"] as string | null;

    const poll: SimulatedPoll = { index, cursorBefore, result, written };
    polls.push(poll);
    data.state.now = new Date(
      data.state.now.getTime() + SIMULATED_POLL_INTERVAL_IN_MINUTES * MINUTE_MS,
    );

    if (data.until(poll)) {
      break;
    }
  }

  return polls;
}

// The most scheduled polls in a row that left the cursor where it was.
function longestCursorHold(polls: Array<SimulatedPoll>): number {
  let longest: number = 0;
  let current: number = 0;

  for (const poll of polls) {
    current = typeof poll.written["cursor"] === "string" ? 0 : current + 1;
    longest = Math.max(longest, current);
  }

  return longest;
}

function allImported(
  state: SimulationState,
  records: Array<SourceRecord>,
): boolean {
  return records.every((record: SourceRecord): boolean => {
    return state.imported.has(record.uid);
  });
}

function minutesAfter(time: Date, minutes: number): Date {
  return new Date(time.getTime() + minutes * MINUTE_MS);
}

// log2(MAX / MIN) halvings, then the forced advance.
const MAX_POLLS_WITHOUT_CURSOR_MOVE: number =
  Math.ceil(Math.log2(MAX_CHUNK_MINUTES / MIN_CHUNK_MINUTES)) + 1;

describe("SecurityEventConnectionPoller - scheduled polls against a source larger than one run (review finding F1)", () => {
  const NOW: Date = new Date("2026-09-14T12:00:00.000Z");

  test("an ascending source that reports resumeAfter imports every record, including ones created while it catches up", async () => {
    const state: SimulationState = startSimulation(NOW);
    const source: SimulatedSource = {
      records: [],
      order: "ascending",
      fetchWindows: [],
    };
    const backlogStart: Date = minutesAfter(NOW, -20 * 60);

    // Eight hours of backlog, five records a minute: almost five runs' worth.
    for (let index: number = 0; index < 2400; index++) {
      source.records.push({
        uid: `backlog-${index}`,
        createdAt: new Date(backlogStart.getTime() + index * 12 * 1000),
      });
    }
    expect(source.records.length).toBeGreaterThan(4 * SIMULATED_RUN_CAPACITY);

    const polls: Array<SimulatedPoll> = await runScheduledPolls({
      state,
      source,
      provider: PROVIDER,
      maxPolls: 20,
      beforePoll: (index: number): void => {
        if (index === 0) {
          return;
        }

        // Ten records created since the previous poll.
        for (let arrival: number = 0; arrival < 10; arrival++) {
          source.records.push({
            uid: `arrival-${index}-${arrival}`,
            createdAt: new Date(
              state.now.getTime() -
                SIMULATED_POLL_INTERVAL_IN_MINUTES * MINUTE_MS +
                arrival * 30 * 1000,
            ),
          });
        }
      },
      until: (poll: SimulatedPoll): boolean => {
        return poll.result.complete && allImported(state, source.records);
      },
    });

    expect(polls.length).toBeLessThanOrEqual(8);
    expect(polls[polls.length - 1]!.result.status).toBe("success");
    expect(state.imported.size).toBe(source.records.length);
    // The overlap re-reads are deduplicated: every record is written once.
    expect(state.insertedCount).toBe(source.records.length);

    // Every poll before the last resumed, so the cursor moved every time.
    for (const poll of polls.slice(0, -1)) {
      expect({
        poll: poll.index,
        status: poll.result.status,
        cursor: poll.written["cursor"],
        nextChunkMinutes: poll.result.nextChunkMinutes,
      }).toEqual({
        poll: poll.index,
        status: "partial",
        cursor: expect.any(String),
        // A resumed poll keeps the chunk it was given (a full day here).
        nextChunkMinutes: 1440,
      });
      expect(
        poll.result.warnings.some((warning: string): boolean => {
          return warning.includes("the next poll resumes from there");
        }),
      ).toBe(true);
    }

    expect(longestCursorHold(polls)).toBe(0);
    expect(
      polls.some((poll: SimulatedPoll): boolean => {
        return poll.result.forcedAdvance === true;
      }),
    ).toBe(false);
    expect(state.lastError).toBeNull();
  });

  test("a source that cannot resume narrows by halves around a burst, moves past it, then doubles back to a day", async () => {
    const provider: SecurityEventConnectorProvider =
      SecurityEventConnectorProvider.MicrosoftDefenderXdr;
    // The chunk arithmetic below assumes a one minute overlap.
    expect(
      getSecurityEventConnectorDefinition(provider)!.cursorOverlapInMinutes,
    ).toBe(1);
    const cursor: Date = new Date("2026-09-11T12:00:00.000Z");
    const state: SimulationState = startSimulation(NOW, cursor.toISOString());
    const source: SimulatedSource = {
      records: [
        { uid: "early", createdAt: minutesAfter(cursor, 10) },
        { uid: "late", createdAt: minutesAfter(cursor, 300) },
      ],
      order: "newestFirst",
      fetchWindows: [],
    };

    // 600 records in ten minutes: more than one run, less than one run per five minutes.
    for (let index: number = 0; index < 600; index++) {
      source.records.push({
        uid: `burst-${index}`,
        createdAt: new Date(minutesAfter(cursor, 90).getTime() + index * 1000),
      });
    }
    expect(source.records.length).toBeGreaterThan(SIMULATED_RUN_CAPACITY);

    const polls: Array<SimulatedPoll> = await runScheduledPolls({
      state,
      source,
      provider,
      maxPolls: 20,
      until: (): boolean => {
        return false;
      },
    });

    expect(
      polls.map((poll: SimulatedPoll): number | undefined => {
        return poll.result.chunkMinutes;
      }),
    ).toEqual([
      1440, 720, 360, 180, 90, 180, 90, 45, 22, 11, 5, 10, 20, 40, 80, 160, 320,
      640, 1280, 1440,
    ]);
    expect(
      polls.map((poll: SimulatedPoll): number | undefined => {
        return poll.result.nextChunkMinutes;
      }),
    ).toEqual([
      720, 360, 180, 90, 180, 90, 45, 22, 11, 5, 10, 20, 40, 80, 160, 320, 640,
      1280, 1440, 1440,
    ]);
    expect(
      polls.map((poll: SimulatedPoll): string => {
        return poll.result.status;
      }),
    ).toEqual([
      "partial",
      "partial",
      "partial",
      "partial",
      "success",
      "partial",
      "partial",
      "partial",
      "partial",
      "partial",
      "success",
      "success",
      "empty",
      "empty",
      "empty",
      "success",
      "empty",
      "empty",
      "empty",
      "empty",
    ]);
    expect(polls[0]!.result.warnings).toContain(
      "This window holds more records than one poll can read; the next poll reads a 720 minute window from the same starting point.",
    );
    // The first narrowed window reads from the same start, half as far.
    expect(source.fetchWindows[1]!.startTime.toISOString()).toBe(
      source.fetchWindows[0]!.startTime.toISOString(),
    );
    expect(source.fetchWindows[1]!.endTime.toISOString()).toBe(
      minutesAfter(cursor, 720).toISOString(),
    );

    expect(longestCursorHold(polls)).toBeLessThanOrEqual(
      MAX_POLLS_WITHOUT_CURSOR_MOVE,
    );
    expect(
      polls.some((poll: SimulatedPoll): boolean => {
        return poll.result.forcedAdvance === true;
      }),
    ).toBe(false);
    expect(allImported(state, source.records)).toBe(true);
    expect(state.insertedCount).toBe(source.records.length);
    expect(state.lastError).toBeNull();
  });

  test.each<["ascending" | "newestFirst", number]>([
    // Identical timestamps: an ascending reader cannot resume inside the burst.
    ["ascending", 0],
    ["newestFirst", 50],
  ])(
    "a one-minute burst larger than one run (%s source, 30 minute overlap) forces exactly one advance, then newer records import",
    async (order: "ascending" | "newestFirst", spacingInMs: number) => {
      const provider: SecurityEventConnectorProvider =
        SecurityEventConnectorProvider.AwsSecurityHub;
      expect(
        getSecurityEventConnectorDefinition(provider)!.cursorOverlapInMinutes,
      ).toBe(30);
      const cursor: Date = new Date("2026-09-11T12:00:00.000Z");
      const burstMinute: Date = minutesAfter(cursor, 60);
      const state: SimulationState = startSimulation(NOW, cursor.toISOString());
      const source: SimulatedSource = {
        records: [],
        order,
        fetchWindows: [],
      };

      for (let index: number = 0; index < 700; index++) {
        source.records.push({
          uid: `burst-${index}`,
          createdAt: new Date(burstMinute.getTime() + index * spacingInMs),
        });
      }

      /*
       * Records created right after the burst minute sit inside the next
       * polls' 30 minute overlap: without the overlap floor every one of
       * those polls would overflow on the burst again and skip them.
       */
      const after: Array<SourceRecord> = [];
      for (let minute: number = 61; minute < 91; minute++) {
        after.push({
          uid: `after-${minute}`,
          createdAt: minutesAfter(cursor, minute),
        });
      }
      for (let minute: number = 120; minute < 170; minute++) {
        after.push({
          uid: `later-${minute}`,
          createdAt: minutesAfter(cursor, minute),
        });
      }
      source.records.push(...after);

      const polls: Array<SimulatedPoll> = await runScheduledPolls({
        state,
        source,
        provider,
        maxPolls: 40,
        until: (poll: SimulatedPoll): boolean => {
          // A newest-first reader imports the later records early, so also wait for the cursor to pass them.
          return (
            poll.result.complete &&
            allImported(state, after) &&
            Date.parse(state.cursor || "") >=
              minutesAfter(cursor, 170).getTime()
          );
        },
      });

      const forced: Array<SimulatedPoll> = polls.filter(
        (poll: SimulatedPoll): boolean => {
          return poll.result.forcedAdvance === true;
        },
      );
      expect(forced).toHaveLength(1);

      const forcedPoll: SimulatedPoll = forced[0]!;
      const floor: Date = minutesAfter(burstMinute, 1);
      const forcedMessage: string = `More records were created in the one minute from ${burstMinute.toISOString()} to ${floor.toISOString()} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.`;
      expect(forcedPoll.cursorBefore).toBe(burstMinute.toISOString());
      expect(forcedPoll.result.chunkMinutes).toBe(MIN_CHUNK_MINUTES);
      expect(forcedPoll.written["cursor"]).toBe(floor.toISOString());
      expect(forcedPoll.result.overlapFloor).toBe(floor.toISOString());
      expect(
        String(forcedPoll.written["lastError"]).startsWith(forcedMessage),
      ).toBe(true);

      // No window after the forced advance reaches back over the burst minute.
      for (const window of source.fetchWindows.slice(forcedPoll.index + 1)) {
        expect(window.startTime.getTime()).toBeGreaterThanOrEqual(
          floor.getTime(),
        );
      }

      // The next poll reads its minute and the chunk starts doubling again.
      const nextPoll: SimulatedPoll = polls[forcedPoll.index + 1]!;
      expect(nextPoll.result.complete).toBe(true);
      expect(nextPoll.result.nextChunkMinutes).toBe(2 * MIN_CHUNK_MINUTES);

      // The floor is dropped once cursor - overlap no longer reaches it.
      const lastPoll: SimulatedPoll = polls[polls.length - 1]!;
      expect(lastPoll.result.overlapFloor).toBeUndefined();

      expect(longestCursorHold(polls)).toBeLessThanOrEqual(
        MAX_POLLS_WITHOUT_CURSOR_MOVE,
      );
      expect(allImported(state, after)).toBe(true);
      expect(lastPoll.result.complete).toBe(true);
      expect(state.lastError).toBeNull();
    },
  );

  test("a failed poll in the middle of narrowing leaves the chunk and the cursor exactly where they were", async () => {
    const provider: SecurityEventConnectorProvider =
      SecurityEventConnectorProvider.MicrosoftDefenderXdr;
    const cursor: Date = new Date("2026-09-11T12:00:00.000Z");
    const state: SimulationState = startSimulation(NOW, cursor.toISOString());
    const source: SimulatedSource = {
      records: [],
      order: "newestFirst",
      fetchWindows: [],
    };

    for (let index: number = 0; index < 600; index++) {
      source.records.push({
        uid: `burst-${index}`,
        createdAt: new Date(minutesAfter(cursor, 90).getTime() + index * 1000),
      });
    }

    const polls: Array<SimulatedPoll> = await runScheduledPolls({
      state,
      source,
      provider,
      maxPolls: 8,
      beforePoll: (index: number): void => {
        if (index === 2) {
          source.failNext = new Error(
            "Microsoft Graph request failed (HTTP 503): service unavailable",
          );
        }
      },
      until: (): boolean => {
        return false;
      },
    });

    const failed: SimulatedPoll = polls[2]!;
    expect(failed.result.status).toBe("failed");
    expect(failed.result.chunkMinutes).toBe(360);
    expect(failed.result.nextChunkMinutes).toBe(360);
    expect("cursor" in failed.written).toBe(false);
    expect(failed.written["lastError"]).toContain("HTTP 503");

    // The same sequence as without the failure, with the failed poll repeated.
    expect(
      polls.map((poll: SimulatedPoll): number | undefined => {
        return poll.result.chunkMinutes;
      }),
    ).toEqual([1440, 720, 360, 360, 180, 90, 180, 90]);
    expect(source.fetchWindows[3]!.startTime.toISOString()).toBe(
      source.fetchWindows[2]!.startTime.toISOString(),
    );
    expect(source.fetchWindows[3]!.endTime.toISOString()).toBe(
      source.fetchWindows[2]!.endTime.toISOString(),
    );
  });
});
