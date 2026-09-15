import SecurityEventConnection from "../../../../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionService from "../../../../../../Server/Services/SecurityEventConnectionService";
import SecurityEventService from "../../../../../../Server/Services/SecurityEventService";
import GoogleSecOpsClient from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import GoogleSecOpsConnector from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsConnector";
import SecurityEventConnectionPoller, {
  PollerOverrides,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionPoller";
import SecurityEventConnectorRegistry from "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry";
import { SecurityConnectorSettings } from "../../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import OneUptimeDate from "../../../../../../Types/Date";
import { JSONObject } from "../../../../../../Types/JSON";
import { SecurityConnectorCheck } from "../../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { SecurityEventConnectionRunResult } from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import { getJestSpyOn } from "../../../../../Spy";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  INSTANCE,
  SERVICE_ACCOUNT_JSON,
  TOKEN_URI,
  secOpsSettings,
} from "./GoogleSecOpsConnectorFixtures";
import {
  API_ORIGIN,
  CONNECTION_ID,
  ConnectionUpdate,
  GoogleSecOpsTenant,
  MINUTE_MS,
  PollPersistence,
  TenantReply,
  TenantRequest,
  findCheck,
  secOpsConnection,
  storedResult,
  streamReply,
  stubPollPersistence,
} from "./GoogleSecOpsPollingFixtures";

/*
 * What Last Error on a Google SecOps connection actually means, now that its
 * polls run through the shared loop.
 *
 * Everything a poll can throw funnels into the same lastError: the OAuth
 * token exchange against the service account's own token_uri (before
 * Chronicle is contacted at all), Chronicle's own HTTP rejection, a
 * rejection Chronicle sends inside an HTTP 200, the client's non-JSON-body
 * guard, a setting the connector refuses, and a telemetry-store write that
 * fails AFTER a completely successful fetch. The integration doc and the
 * in-product help split them on the message prefix:
 *
 *   1. `Google token exchange failed (HTTP ...)` - the credential was
 *      rejected at Google's OAuth endpoint, before Chronicle.
 *   2. `Google SecOps alerts fetch failed (HTTP ...)` - Chronicle itself
 *      rejected the request.
 *   3. anything else - the detections came back (or were never asked for)
 *      and the failure was on OneUptime's side or inside a 200.
 *
 * Every case is driven through pollAllDueConnections with the REAL shared
 * poller, the REAL GoogleSecOpsConnector and the REAL GoogleSecOpsClient over
 * a simulated tenant, so the asserted string is the one an operator reads off
 * the row, whole and redacted. The Google prefixes and the guard messages are
 * derived from the client and the connector themselves, so editing a template
 * moves the expectation with it instead of silently invalidating a literal.
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

const NOW: Date = new Date("2026-09-10T12:00:00.000Z");
const CURSOR: string = "2026-09-10T11:55:00.000Z";

/*
 * The statuses used both to DERIVE each prefix and to provoke each failure,
 * so the derived prefix and the produced message agree on the status.
 */
const TOKEN_EXCHANGE_FAILURE_STATUS: number = 401;
const ALERTS_FETCH_FAILURE_STATUS: number = 403;

/*
 * The bucket-3 failure the review surfaced: a telemetry-store write that
 * blows up after Chronicle already answered, shaped like a real ClickHouse
 * error, which echoes the statement back.
 */
const CLICKHOUSE_OUTAGE_MESSAGE: string =
  "Code: 210. DB::NetException: Connection refused (clickhouse:9000). " +
  "(NETWORK_ERROR) (version 24.3.1.1) while executing INSERT INTO " +
  "oneuptime.SecurityEvent (projectId, time, classUid, ruleName) FORMAT JSONEachRow";

const HTML_GATEWAY_PAGE: string = "<html><body>502 Bad Gateway</body></html>";

// A query Chronicle refused inside an HTTP 200, the way its stream reports it.
const IN_BAND_REJECTION: Array<JSONObject> = [
  {
    validSnapshotQuery: false,
    queryValidationErrors: [
      { errorText: "snapshotQuery could not be parsed at position 0" },
    ],
    complete: true,
    progress: 1,
  },
];

// The separator the client puts between its prefix and the echoed body.
const PREFIX_END_MARKER: string = "): ";

interface PollRun {
  tenant: GoogleSecOpsTenant;
  updates: Array<ConnectionUpdate>;
  insertedBatches: Array<Array<JSONObject>>;
}

/*
 * Captured at import time, before any spy replaces it, so a spy on
 * pollConnection can hand the due connection straight back to the real poll
 * with the simulated tenant attached.
 */
const realPollConnection: (
  connection: SecurityEventConnection,
  overrides?: PollerOverrides | undefined,
) => Promise<number> = SecurityEventConnectionPoller.pollConnection.bind(
  SecurityEventConnectionPoller,
);

/*
 * Drive the real client to failure against a tenant and hand back the
 * message it threw: whatever GoogleSecOpsClient's templates say today.
 */
async function messageThrownByClient(
  configure: (tenant: GoogleSecOpsTenant) => void,
): Promise<string> {
  const probe: GoogleSecOpsTenant = new GoogleSecOpsTenant();
  configure(probe);
  const client: GoogleSecOpsClient = new GoogleSecOpsClient({
    region: "us",
    instanceResourceName: INSTANCE,
    serviceAccountJson: SERVICE_ACCOUNT_JSON,
    fetchImplementation: probe.fetch,
  });

  try {
    await client.fetchDetectionAlerts({
      startTime: new Date(NOW.getTime() - 5 * MINUTE_MS),
      endTime: NOW,
    });
  } catch (error) {
    return (error as Error).message;
  }

  throw new Error(
    "GoogleSecOpsClient was expected to throw for this tenant script.",
  );
}

/*
 * Both client templates open `<family> (HTTP <status>): `, and everything
 * after that marker belongs to the failure rather than the taxonomy: the
 * echoed body and the operator hint behind it.
 */
function prefixOf(message: string): string {
  const markerIndex: number = message.indexOf(PREFIX_END_MARKER);

  if (markerIndex === -1) {
    throw new Error(
      `GoogleSecOpsClient no longer opens its HTTP failures with "<family> (HTTP <status>): ": ${message}`,
    );
  }

  return message.slice(0, markerIndex + PREFIX_END_MARKER.length);
}

// The status-free half of a prefix, split at the " (HTTP" the client inserts.
function familyOf(prefix: string): string {
  const httpMarkerIndex: number = prefix.indexOf(" (HTTP");
  return httpMarkerIndex === -1
    ? prefix.trim()
    : prefix.slice(0, httpMarkerIndex);
}

let tokenExchangePrefix: string = "";
let alertsFetchPrefix: string = "";
let tokenExchangeFamily: string = "";
let alertsFetchFamily: string = "";
let nonJsonBodyMessage: string = "";
let inBandRejectionMessage: string = "";
let missingFieldMessage: string = "";

/*
 * The single rule the docs and the in-product help hang on: does this
 * message open with a prefix naming a Google request?
 */
function carriesGoogleRequestPrefix(message: string): boolean {
  return (
    message.startsWith(tokenExchangeFamily) ||
    message.startsWith(alertsFetchFamily)
  );
}

function settingsWithoutRegion(): SecurityConnectorSettings {
  return secOpsSettings({ config: { region: "" } });
}

beforeAll(async () => {
  tokenExchangePrefix = prefixOf(
    await messageThrownByClient((probe: GoogleSecOpsTenant): void => {
      probe.scripts.token = (): TenantReply => {
        return { status: TOKEN_EXCHANGE_FAILURE_STATUS, body: "" };
      };
    }),
  );
  alertsFetchPrefix = prefixOf(
    await messageThrownByClient((probe: GoogleSecOpsTenant): void => {
      probe.scripts.alerts = (): TenantReply => {
        return { status: ALERTS_FETCH_FAILURE_STATUS, body: "" };
      };
    }),
  );
  nonJsonBodyMessage = await messageThrownByClient(
    (probe: GoogleSecOpsTenant): void => {
      probe.scripts.alerts = (): TenantReply => {
        return { status: 200, body: HTML_GATEWAY_PAGE };
      };
    },
  );
  inBandRejectionMessage = await messageThrownByClient(
    (probe: GoogleSecOpsTenant): void => {
      probe.scripts.alerts = (): TenantReply => {
        return streamReply(IN_BAND_REJECTION);
      };
    },
  );
  tokenExchangeFamily = familyOf(tokenExchangePrefix);
  alertsFetchFamily = familyOf(alertsFetchPrefix);

  /*
   * Derived from the real connector: the field-titled rejection its
   * validateSettings throws before any client is built.
   */
  try {
    new GoogleSecOpsConnector().validateSettings(settingsWithoutRegion());
  } catch (error) {
    missingFieldMessage = (error as Error).message;
  }

  if (!missingFieldMessage) {
    throw new Error(
      "GoogleSecOpsConnector was expected to reject settings without a region.",
    );
  }
});

let persistence: PollPersistence;

beforeEach(() => {
  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  persistence = stubPollPersistence();
});

afterEach(() => {
  jest.restoreAllMocks();
  (
    SecurityEventConnectorRegistry.getConnector as unknown as jest.Mock
  ).mockReset();
});

/*
 * One full tick: findBy returns exactly one connection with a saved cursor,
 * its poll runs the real pollConnection against a fresh tenant, and every
 * write is captured instead of performed.
 */
async function runPollTick(options: {
  configure?: ((tenant: GoogleSecOpsTenant) => void) | undefined;
  settings?: SecurityConnectorSettings | undefined;
  insertJsonRows?: ((rows: Array<JSONObject>) => Promise<void>) | undefined;
}): Promise<PollRun> {
  const tenant: GoogleSecOpsTenant = new GoogleSecOpsTenant();

  if (options.configure) {
    options.configure(tenant);
  }

  const updatesBefore: number = persistence.updates.length;
  const batchesBefore: number = persistence.insertedBatches.length;

  getJestSpyOn(SecurityEventConnectionService, "findBy").mockResolvedValue([
    secOpsConnection({ cursor: CURSOR }),
  ] as never);
  getJestSpyOn(SecurityEventService, "insertJsonRows").mockImplementation(((
    rows: Array<JSONObject>,
  ): Promise<void> => {
    persistence.insertedBatches.push(rows);
    return options.insertJsonRows
      ? options.insertJsonRows(rows)
      : Promise.resolve();
  }) as never);
  getJestSpyOn(
    SecurityEventConnectionPoller,
    "pollConnection",
  ).mockImplementation(((
    connection: SecurityEventConnection,
  ): Promise<number> => {
    return realPollConnection(
      connection,
      tenant.overrides(options.settings || secOpsSettings()),
    );
  }) as never);

  await SecurityEventConnectionPoller.pollAllDueConnections();

  return {
    tenant,
    updates: persistence.updates.slice(updatesBefore),
    insertedBatches: persistence.insertedBatches.slice(batchesBefore),
  };
}

/*
 * The one value an operator reads off the row. Every case asserts that a
 * single bookkeeping write happened and that it stamped lastPolledAt - a
 * failure with no stamp is the silent-connector outage all over again.
 */
function recordedLastError(run: PollRun): string {
  expect(run.updates).toHaveLength(1);
  expect(run.updates[0]!.id.toString()).toBe(CONNECTION_ID.toString());
  expect(run.updates[0]!.data["lastPolledAt"]).toBeInstanceOf(Date);

  const lastError: unknown = run.updates[0]!.data["lastError"];
  expect(typeof lastError).toBe("string");
  expect((lastError as string).trim().length).toBeGreaterThan(0);

  // The stored run carries the same full, redacted message.
  expect(storedResult(run.updates[0]!.data).error).toBe(lastError);

  return lastError as string;
}

// Which step the failed run names, off the stored lastPollResult.
function failedStepOf(run: PollRun): string {
  const result: SecurityEventConnectionRunResult = storedResult(
    run.updates[0]!.data,
  );
  const failure: SecurityConnectorCheck = findCheck(result.checks, "failure");
  return failure.name;
}

function hasCursorKey(run: PollRun): boolean {
  return Object.prototype.hasOwnProperty.call(run.updates[0]!.data, "cursor");
}

async function tokenExchangeFailureRun(): Promise<PollRun> {
  return runPollTick({
    configure: (tenant: GoogleSecOpsTenant): void => {
      tenant.add({
        id: "alert-1",
        createdMs: NOW.getTime() - 2 * MINUTE_MS,
        detectionMs: NOW.getTime() - 3 * MINUTE_MS,
      });
      tenant.scripts.token = (): TenantReply => {
        return {
          status: TOKEN_EXCHANGE_FAILURE_STATUS,
          body: JSON.stringify({
            error: "invalid_grant",
            error_description: "Invalid JWT Signature.",
          }),
        };
      };
    },
  });
}

async function alertsFetchFailureRun(): Promise<PollRun> {
  return runPollTick({
    configure: (tenant: GoogleSecOpsTenant): void => {
      tenant.scripts.alerts = (): TenantReply => {
        return {
          status: ALERTS_FETCH_FAILURE_STATUS,
          body: JSON.stringify({
            error: {
              code: ALERTS_FETCH_FAILURE_STATUS,
              status: "PERMISSION_DENIED",
              message:
                "Caller does not have permission 'chronicle.legacies.legacyFetchAlertsView'.",
            },
          }),
        };
      };
    },
  });
}

async function inBandRejectionRun(): Promise<PollRun> {
  return runPollTick({
    configure: (tenant: GoogleSecOpsTenant): void => {
      tenant.scripts.alerts = (): TenantReply => {
        return streamReply(IN_BAND_REJECTION);
      };
    },
  });
}

async function telemetryStoreFailureRun(): Promise<PollRun> {
  return runPollTick({
    configure: (tenant: GoogleSecOpsTenant): void => {
      tenant.add({
        id: "alert-1",
        createdMs: NOW.getTime() - 2 * MINUTE_MS,
        detectionMs: NOW.getTime() - 3 * MINUTE_MS,
      });
    },
    insertJsonRows: (): Promise<void> => {
      return Promise.reject(new Error(CLICKHOUSE_OUTAGE_MESSAGE));
    },
  });
}

async function nonJsonBodyRun(): Promise<PollRun> {
  return runPollTick({
    configure: (tenant: GoogleSecOpsTenant): void => {
      tenant.scripts.alerts = (): TenantReply => {
        return { status: 200, body: HTML_GATEWAY_PAGE };
      };
    },
  });
}

async function missingFieldRun(): Promise<PollRun> {
  return runPollTick({ settings: settingsWithoutRegion() });
}

describe("Google SecOps lastError failure taxonomy through the shared poller", () => {
  test("the derived prefixes really are prefixes, and really do differ", () => {
    expect(tokenExchangePrefix.length).toBeGreaterThan(0);
    expect(alertsFetchPrefix.length).toBeGreaterThan(0);
    expect(tokenExchangePrefix).not.toBe(alertsFetchPrefix);

    // Each derivation stopped at the marker rather than swallowing a body or hint.
    expect(tokenExchangePrefix.endsWith(PREFIX_END_MARKER)).toBe(true);
    expect(alertsFetchPrefix.endsWith(PREFIX_END_MARKER)).toBe(true);
    expect(tokenExchangePrefix.indexOf(PREFIX_END_MARKER)).toBe(
      tokenExchangePrefix.length - PREFIX_END_MARKER.length,
    );
    expect(alertsFetchPrefix.indexOf(PREFIX_END_MARKER)).toBe(
      alertsFetchPrefix.length - PREFIX_END_MARKER.length,
    );
    expect(tokenExchangePrefix).toContain(
      String(TOKEN_EXCHANGE_FAILURE_STATUS),
    );
    expect(alertsFetchPrefix).toContain(String(ALERTS_FETCH_FAILURE_STATUS));

    // Neither family is a prefix of the other, so "read the prefix first" is unambiguous.
    expect(tokenExchangeFamily.startsWith(alertsFetchFamily)).toBe(false);
    expect(alertsFetchFamily.startsWith(tokenExchangeFamily)).toBe(false);
  });

  /*
   * Bucket 1. The credential is rejected at oauth2.googleapis.com, the
   * token_uri from the customer's own key, before a single request reaches
   * Chronicle.
   */
  test("a token-exchange failure is recorded under the token-exchange prefix, before Chronicle is contacted", async () => {
    const run: PollRun = await tokenExchangeFailureRun();
    const lastError: string = recordedLastError(run);

    expect(lastError.startsWith(tokenExchangePrefix)).toBe(true);
    expect(lastError.startsWith(alertsFetchPrefix)).toBe(false);
    // The echoed OAuth body rides along behind the prefix.
    expect(lastError).toContain("invalid_grant");

    // Only Google's OAuth host was called; nothing went to Chronicle.
    expect(run.tenant.requests).toHaveLength(1);
    expect(run.tenant.requests[0]!.url.toString()).toBe(TOKEN_URI);
    expect(
      run.tenant.requests.some((request: TenantRequest): boolean => {
        return request.url.origin === API_ORIGIN;
      }),
    ).toBe(false);
    /*
     * The first pass is the one that asked for the token, so the failed run
     * names it. The retired poller's run named no pass for a poll failure.
     */
    expect(failedStepOf(run)).toBe("Read rule detections by created time");

    // Nothing was ingested, so the cursor must not have moved.
    expect(run.insertedBatches).toHaveLength(0);
    expect(hasCursorKey(run)).toBe(false);
  });

  // Bucket 2: the token was issued, the request reached Chronicle, and Chronicle said no.
  test("a Chronicle HTTP failure is recorded under the alerts-fetch prefix", async () => {
    const run: PollRun = await alertsFetchFailureRun();
    const lastError: string = recordedLastError(run);

    expect(lastError.startsWith(alertsFetchPrefix)).toBe(true);
    expect(lastError.startsWith(tokenExchangePrefix)).toBe(false);
    expect(lastError).toContain("PERMISSION_DENIED");

    /*
     * Token endpoint first, then Chronicle three times (the two quiet search
     * passes, then the alerts view that failed): the failure is theirs.
     */
    expect(
      run.tenant.requests.map((request: TenantRequest): string => {
        return request.route;
      }),
    ).toEqual(["token", "search", "curated", "alerts"]);
    expect(run.tenant.requests[3]!.url.origin).toBe(API_ORIGIN);
    expect(failedStepOf(run)).toBe("Read alerts view by detection time");

    expect(run.insertedBatches).toHaveLength(0);
    expect(hasCursorKey(run)).toBe(false);
  });

  /*
   * A malformed query comes back as HTTP 200 with the complaint in the
   * body. It originates at Chronicle but carries no status-bearing prefix,
   * so the guidance files it under "anything else"; its own wording names
   * the rejection.
   */
  test("a query Chronicle rejects inside an HTTP 200 fails the poll with its own wording and no HTTP-status prefix", async () => {
    const run: PollRun = await inBandRejectionRun();
    const lastError: string = recordedLastError(run);

    expect(lastError).toBe(inBandRejectionMessage);
    expect(lastError).toContain(
      "snapshotQuery could not be parsed at position 0",
    );
    expect(lastError.startsWith(tokenExchangePrefix)).toBe(false);
    expect(lastError.startsWith(alertsFetchPrefix)).toBe(false);
    expect(lastError).not.toContain("(HTTP");
    expect(run.tenant.requests).toHaveLength(4);
    expect(failedStepOf(run)).toBe("Read alerts view by detection time");
    expect(run.insertedBatches).toHaveLength(0);
    expect(hasCursorKey(run)).toBe(false);
  });

  /*
   * Bucket 3, and the reason the guidance was rewritten at all: Chronicle
   * answered perfectly, the normalizer produced a row, and the poll died
   * writing it to the telemetry store.
   */
  test("a telemetry-store failure is recorded with NO Google prefix, and does not advance the cursor", async () => {
    const run: PollRun = await telemetryStoreFailureRun();
    const lastError: string = recordedLastError(run);

    // The detection really did arrive: every Google call succeeded...
    expect(
      run.tenant.requests.map((request: TenantRequest): string => {
        return request.route;
      }),
    ).toEqual(["token", "search", "curated", "alerts"]);

    // ...and a row was built and handed to the store before it blew up.
    expect(run.insertedBatches).toHaveLength(1);
    expect(run.insertedBatches[0]).toHaveLength(1);
    expect(run.insertedBatches[0]![0]!["className"]).toBe("Detection Finding");

    expect(carriesGoogleRequestPrefix(lastError)).toBe(false);
    expect(lastError).toContain("clickhouse");
    expect(lastError).toBe(CLICKHOUSE_OUTAGE_MESSAGE);
    expect(failedStepOf(run)).toBe("Import records");

    /*
     * A failed import keeps the saved cursor and persists its diagnostics,
     * so the same window is retried with the original failure visible.
     */
    expect(hasCursorKey(run)).toBe(false);
    expect(Object.keys(run.updates[0]!.data).sort()).toEqual([
      "lastError",
      "lastPollResult",
      "lastPolledAt",
    ]);
  });

  /*
   * The client's own non-JSON guard: a proxy between the poller and
   * Chronicle answered 2xx with an HTML page, so there is no status to
   * prefix with.
   */
  test("a non-JSON alerts body reaches lastError with no HTTP-status prefix", async () => {
    const run: PollRun = await nonJsonBodyRun();
    const lastError: string = recordedLastError(run);

    // Byte for byte the client's own guard message, derived from it above.
    expect(lastError).toBe(nonJsonBodyMessage);
    expect(lastError.startsWith(tokenExchangePrefix)).toBe(false);
    expect(lastError.startsWith(alertsFetchPrefix)).toBe(false);
    expect(lastError).not.toContain("(HTTP");

    // The request did reach Chronicle; the body it returned was unusable.
    expect(run.tenant.requests).toHaveLength(4);
    expect(run.insertedBatches).toHaveLength(0);
  });

  /*
   * A setting the connector refuses never reaches Google, and its message is
   * written by OneUptime rather than any API.
   */
  test("a missing setting is recorded through the same path, names the field, and sends nothing", async () => {
    const run: PollRun = await missingFieldRun();
    const lastError: string = recordedLastError(run);

    // Exactly the connector's own rejection, derived from it in beforeAll.
    expect(lastError).toBe(missingFieldMessage);
    expect(carriesGoogleRequestPrefix(lastError)).toBe(false);
    /*
     * The retired poller's guard ("Google SecOps connection is missing id,
     * projectId, region, instance, or credentials") opened with the words
     * "Google SecOps", which an operator skimming for a Google prefix could
     * misfile as a Chronicle problem. The connector's rejection opens with
     * the form's field title instead, so that trap is gone.
     */
    expect(lastError.startsWith("Region")).toBe(true);
    expect(lastError.startsWith("Google")).toBe(false);
    expect(failedStepOf(run)).toBe("Validate configuration");

    // Not one request left the process.
    expect(run.tenant.requests).toHaveLength(0);
    expect(run.insertedBatches).toHaveLength(0);
  });

  test("a long Chronicle rejection reaches lastError whole and redacted, never clamped", async () => {
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
              access_token: "nested-taxonomy-token-123",
              resource: INSTANCE,
            }),
          },
        ],
        access_token: "taxonomy-access-token",
        private_key: "taxonomy-private-key-material",
        supportReference: tail,
      },
    });

    const run: PollRun = await runPollTick({
      configure: (tenant: GoogleSecOpsTenant): void => {
        tenant.scripts.alerts = (): TenantReply => {
          return { status: 400, body };
        };
      },
    });
    const lastError: string = recordedLastError(run);

    // Both the old 500 character client slice and the 1000 character clamp would cut this.
    expect(body.indexOf(tail)).toBeGreaterThan(1000);
    expect(lastError.startsWith(alertsFetchFamily)).toBe(true);
    expect(lastError).toContain("(HTTP 400)");
    expect(lastError.length).toBeGreaterThan(1000);
    expect(lastError).toContain(tail);
    expect(lastError).toContain(INSTANCE);
    expect(lastError).toContain('"access_token":"[REDACTED]"');
    expect(lastError).toContain('"private_key":"[REDACTED]"');
    expect(lastError).not.toContain("taxonomy-access-token");
    expect(lastError).not.toContain("nested-taxonomy-token-123");
    expect(lastError).not.toContain("taxonomy-private-key-material");
    expect(lastError).not.toContain("(truncated)");
    // The failed pass's check carries the same whole message.
    expect(
      findCheck(storedResult(run.updates[0]!.data).checks, "failure").message,
    ).toBe(lastError);
  });

  /*
   * The cross-check that turns the three-way split from an assertion into a
   * verified property: run every failure a poll can record, collect what
   * each one stored, and classify them in one place. The in-band 200
   * rejection and the non-JSON body originate at Chronicle yet carry no
   * Google request prefix; they are pinned here so that stays visible.
   */
  test("exactly the HTTP failures at Google carry a Google prefix; the others do not", async () => {
    const cases: Array<{
      label: string;
      lastError: string;
      expectedGooglePrefix: boolean;
    }> = [
      {
        label: "token exchange rejected at Google OAuth",
        lastError: recordedLastError(await tokenExchangeFailureRun()),
        expectedGooglePrefix: true,
      },
      {
        label: "alerts fetch rejected by Chronicle",
        lastError: recordedLastError(await alertsFetchFailureRun()),
        expectedGooglePrefix: true,
      },
      {
        label: "query rejected by Chronicle inside an HTTP 200",
        lastError: recordedLastError(await inBandRejectionRun()),
        expectedGooglePrefix: false,
      },
      {
        label: "telemetry store rejected the write after a good fetch",
        lastError: recordedLastError(await telemetryStoreFailureRun()),
        expectedGooglePrefix: false,
      },
      {
        label: "connection settings missing a required field",
        lastError: recordedLastError(await missingFieldRun()),
        expectedGooglePrefix: false,
      },
      {
        label: "non-JSON body from the alerts endpoint",
        lastError: recordedLastError(await nonJsonBodyRun()),
        expectedGooglePrefix: false,
      },
    ];

    expect(
      cases.map(
        (item: {
          label: string;
          lastError: string;
        }): { label: string; carriesGooglePrefix: boolean } => {
          return {
            label: item.label,
            carriesGooglePrefix: carriesGoogleRequestPrefix(item.lastError),
          };
        },
      ),
    ).toEqual(
      cases.map(
        (item: {
          label: string;
          expectedGooglePrefix: boolean;
        }): { label: string; carriesGooglePrefix: boolean } => {
          return {
            label: item.label,
            carriesGooglePrefix: item.expectedGooglePrefix,
          };
        },
      ),
    );

    // All distinct, so the taxonomy partitions six failures rather than collapsing some.
    const distinct: Set<string> = new Set(
      cases.map((item: { lastError: string }): string => {
        return item.lastError;
      }),
    );
    expect(distinct.size).toBe(cases.length);
  });
});
