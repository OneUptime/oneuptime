import SecurityEventConnection from "../../../../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionRun from "../../../../../../Models/DatabaseModels/SecurityEventConnectionRun";
import Semaphore, {
  SemaphoreLockTimeoutError,
} from "../../../../../../Server/Infrastructure/Semaphore";
import ProjectService from "../../../../../../Server/Services/ProjectService";
import SecurityEventConnectionRunService from "../../../../../../Server/Services/SecurityEventConnectionRunService";
import SecurityEventConnectionService from "../../../../../../Server/Services/SecurityEventConnectionService";
import SecurityEventService from "../../../../../../Server/Services/SecurityEventService";
import SecurityEventConnectionPoller, {
  PollerOverrides,
  SECURITY_EVENT_SOURCE_LOCK_NAMESPACE,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionPoller";
import SecurityEventConnectionRunExecutor from "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionRunExecutor";
import SecurityEventConnectorRegistry from "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry";
import { MAX_CONNECTOR_ERROR_MESSAGE_LENGTH } from "../../../../../../Server/Utils/SecurityEvent/ConnectorErrorMessage";
import SecurityEventDedupe from "../../../../../../Server/Utils/SecurityEvent/SecurityEventDedupe";
import { getMaxLengthFromTableColumnType } from "../../../../../../Types/Database/ColumnLength";
import { TableColumnMetadata } from "../../../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../../../Types/Database/TableColumnType";
import LIMIT_MAX from "../../../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../../../Types/Date";
import { JSONObject } from "../../../../../../Types/JSON";
import ObjectID from "../../../../../../Types/ObjectID";
import { SecurityEventConnectionRunResult } from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import SecurityEventConnectorProvider from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { getJestSpyOn } from "../../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  INSTANCE,
  SERVICE_ACCOUNT_JSON,
} from "./GoogleSecOpsConnectorFixtures";
import {
  CONNECTION_ID,
  ConnectionUpdate,
  GoogleSecOpsTenant,
  MINUTE_MS,
  PROJECT_ID,
  PollPersistence,
  TenantReply,
  TenantRequest,
  googleError,
  lastUpdate,
  requestWindow,
  secOpsConnection,
  storedResult,
  stubPollPersistence,
} from "./GoogleSecOpsPollingFixtures";

/*
 * The scheduled loop, the source lock, the in-lock reload and the run
 * executor around a Google SecOps poll: the REAL SecurityEventConnectionPoller
 * (pollAllDueConnections, pollConnection, executeConnection) and
 * SecurityEventConnectionRunExecutor with the REAL GoogleSecOpsConnector over
 * a simulated tenant.
 *
 * pollAllDueConnections calls this.pollConnection(connection) with no
 * overrides, so, as the retired Google SecOps suites did, a test that needs
 * the simulated tenant under a full tick spies on pollConnection and hands
 * straight back to the real, decorated implementation with the tenant's
 * connector attached. Everything inside it - the lock, the window, the three
 * passes, the insert, the bookkeeping write - still runs for real. The tests
 * of the in-lock reload and the run executor use no overrides at all: the
 * registry hands out the tenant's connector and the row is reloaded from a
 * stubbed service read.
 *
 * One bookkeeping rule changed with the move, and several tests below say
 * so: a poll that fails is booked on the row by the poll itself, and the
 * loop only stamps failures the poll could not record.
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
const CONNECTION_ID_ONE: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CONNECTION_ID_TWO: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const CONNECTION_ID_THREE: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const CONNECTION_ID_FOUR: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const CONNECTION_ID_FIVE: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";

/*
 * Captured at import time, before any spy replaces it, so a spy on
 * pollConnection can delegate back to the real implementation.
 */
const realPollConnection: (
  connection: SecurityEventConnection,
  overrides?: PollerOverrides | undefined,
) => Promise<number> = SecurityEventConnectionPoller.pollConnection.bind(
  SecurityEventConnectionPoller,
);

let tenant: GoogleSecOpsTenant;
let persistence: PollPersistence;

beforeEach(() => {
  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  persistence = stubPollPersistence();
  tenant = new GoogleSecOpsTenant();
});

afterEach(() => {
  jest.restoreAllMocks();
  (
    SecurityEventConnectorRegistry.getConnector as unknown as jest.Mock
  ).mockReset();
});

// A detection created and detected inside a CURSOR poll's window.
function addRecentDetection(id: string): void {
  tenant.add({
    id,
    createdMs: NOW.getTime() - 2 * MINUTE_MS,
    detectionMs: NOW.getTime() - 3 * MINUTE_MS,
  });
}

function loadConnections(connections: Array<SecurityEventConnection>): void {
  getJestSpyOn(SecurityEventConnectionService, "findBy").mockResolvedValue(
    connections as never,
  );
}

// Every due connection is polled through the real poll with the tenant attached.
function pollThroughTenant(): ReturnType<typeof getJestSpyOn> {
  return getJestSpyOn(
    SecurityEventConnectionPoller,
    "pollConnection",
  ).mockImplementation(((
    connection: SecurityEventConnection,
  ): Promise<number> => {
    return realPollConnection(connection, tenant.overrides());
  }) as never);
}

function polledIds(spy: ReturnType<typeof getJestSpyOn>): Array<string> {
  return spy.mock.calls.map((call: Array<unknown>): string => {
    return String((call[0] as SecurityEventConnection)._id);
  });
}

function failTokenExchange(): void {
  tenant.scripts.token = (): TenantReply => {
    return {
      status: 401,
      body: JSON.stringify({
        error: "invalid_grant",
        error_description: "Invalid JWT Signature.",
      }),
    };
  };
}

/*
 * The declared max for SecurityEventConnection.lastError, straight off the
 * model: undefined for the unbounded text column. A bound here is what made
 * the retired poller's recovery write throw on a long Google error.
 */
function lastErrorMaxLength(): number | undefined {
  const metadata: TableColumnMetadata =
    new SecurityEventConnection().getTableColumnMetadata("lastError");
  return getMaxLengthFromTableColumnType(metadata.type);
}

describe("Google SecOps connections in the scheduled loop", () => {
  test("polls due connections, skips not-yet-due ones, and a failed poll's lastError is recorded", async () => {
    const due: SecurityEventConnection = secOpsConnection({ cursor: CURSOR });
    const notDue: SecurityEventConnection = secOpsConnection({
      _id: CONNECTION_ID_TWO,
      cursor: CURSOR,
      lastPolledAt: NOW,
    });
    loadConnections([due, notDue]);
    failTokenExchange();
    const pollSpy: ReturnType<typeof getJestSpyOn> = pollThroughTenant();

    await SecurityEventConnectionPoller.pollAllDueConnections();

    // Only the due connection was polled...
    expect(polledIds(pollSpy)).toEqual([CONNECTION_ID.toString()]);
    /*
     * ...and its failure was recorded as lastError. The retired loop wrote
     * it in its catch block; the shared poll books it on the row itself and
     * the loop does not stamp it a second time.
     */
    expect(persistence.updates).toHaveLength(1);
    expect(persistence.updates[0]!.id.toString()).toBe(
      CONNECTION_ID.toString(),
    );
    expect(persistence.updates[0]!.data["lastError"]).toContain(
      "Google token exchange failed (HTTP 401)",
    );
  });

  test("a Google error longer than 1000 characters is recorded whole and redacted, not swallowed with the whole tick", async () => {
    const tail: string = "grant-roles-chronicle-viewer-on-the-instance";
    const body: string = JSON.stringify({
      error: {
        code: 403,
        status: "PERMISSION_DENIED",
        message: `Caller does not have permission 'chronicle.legacies.legacyFetchAlertsView'. ${"grant the Chronicle API Viewer role on the instance. ".repeat(30)}${tail}`,
        client_secret: "long-error-client-secret",
      },
    });
    tenant.scripts.alerts = (): TenantReply => {
      return { status: 403, body };
    };
    loadConnections([secOpsConnection({ cursor: CURSOR })]);
    pollThroughTenant();

    /*
     * The premises: this message is longer than both the old LongText column
     * (500) and the 1000 character clamp, and lastError has no declared max
     * left for a write to trip over.
     */
    expect(body.length).toBeGreaterThan(MAX_CONNECTOR_ERROR_MESSAGE_LENGTH);
    expect(body.length).toBeGreaterThan(
      getMaxLengthFromTableColumnType(TableColumnType.LongText)!,
    );
    expect(lastErrorMaxLength()).toBeUndefined();

    await expect(
      SecurityEventConnectionPoller.pollAllDueConnections(),
    ).resolves.toBeUndefined();

    expect(persistence.updates).toHaveLength(1);
    const written: JSONObject = persistence.updates[0]!.data;
    const lastError: string = written["lastError"] as string;
    expect(
      lastError.startsWith("Google SecOps alerts fetch failed (HTTP 403): "),
    ).toBe(true);
    /*
     * The retired loop clamped a stored message to 1000 characters. The
     * shared poll keeps the whole redacted diagnostic, so the tail Google
     * support asks for is still there.
     */
    expect(lastError.length).toBeGreaterThan(
      MAX_CONNECTOR_ERROR_MESSAGE_LENGTH,
    );
    expect(lastError).toContain(tail);
    expect(lastError).not.toContain("(truncated)");
    expect(lastError).toContain('"client_secret":"[REDACTED]"');
    expect(lastError).not.toContain("long-error-client-secret");
    // The stamp that says "this connector was attempted" is set.
    expect(written["lastPolledAt"]).toBeInstanceOf(Date);
  });

  test("a rejected bookkeeping write does not abandon the connections behind it", async () => {
    loadConnections([
      secOpsConnection({ _id: CONNECTION_ID_ONE, cursor: CURSOR }),
      secOpsConnection({ _id: CONNECTION_ID_TWO, cursor: CURSOR }),
      secOpsConnection({ _id: CONNECTION_ID_THREE, cursor: CURSOR }),
    ]);
    failTokenExchange();
    /*
     * The first connection's writes fail for a reason that has nothing to do
     * with message length - a deadlock, a dropped connection.
     */
    const updateSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityEventConnectionService,
      "updateOneById",
    ).mockImplementation(((call: ConnectionUpdate): Promise<void> => {
      if (call.id.toString() === CONNECTION_ID_ONE) {
        return Promise.reject(new Error("deadlock detected"));
      }
      persistence.updates.push(call);
      return Promise.resolve();
    }) as never);
    const pollSpy: ReturnType<typeof getJestSpyOn> = pollThroughTenant();

    await expect(
      SecurityEventConnectionPoller.pollAllDueConnections(),
    ).resolves.toBeUndefined();

    /*
     * The heart of the fix: a single unlucky row does not silence every
     * other connector in the project.
     */
    expect(pollSpy).toHaveBeenCalledTimes(3);
    /*
     * Connection one: the poll's own write rejects, so the loop's
     * recordFailure tries once more and swallows that too. Connections two
     * and three are booked by their polls. The retired loop made exactly one
     * write per connection, all from its catch block.
     */
    expect(
      updateSpy.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as ConnectionUpdate).id.toString();
      }),
    ).toEqual([
      CONNECTION_ID_ONE,
      CONNECTION_ID_ONE,
      CONNECTION_ID_TWO,
      CONNECTION_ID_THREE,
    ]);
    // The two survivors got their failure recorded, not just attempted.
    expect(persistence.updates).toHaveLength(2);
    for (const update of persistence.updates) {
      expect(update.data["lastError"]).toContain(
        "Google token exchange failed",
      );
    }
  });

  test("a bookkeeping write that throws synchronously is survived too", async () => {
    loadConnections([
      secOpsConnection({ _id: CONNECTION_ID_ONE, cursor: CURSOR }),
      secOpsConnection({ _id: CONNECTION_ID_TWO, cursor: CURSOR }),
    ]);
    failTokenExchange();
    /*
     * Not every failure arrives as a rejected promise: argument validation
     * and a torn-down connection pool both throw before any promise exists.
     */
    const updateSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityEventConnectionService,
      "updateOneById",
    ).mockImplementation(((): Promise<void> => {
      throw new Error("connection terminated unexpectedly");
    }) as never);
    const pollSpy: ReturnType<typeof getJestSpyOn> = pollThroughTenant();

    await expect(
      SecurityEventConnectionPoller.pollAllDueConnections(),
    ).resolves.toBeUndefined();

    expect(pollSpy).toHaveBeenCalledTimes(2);
    /*
     * Two writes per connection now: the poll's own booking, then the loop's
     * recordFailure for the error that booking threw. The retired loop made
     * one.
     */
    expect(updateSpy).toHaveBeenCalledTimes(4);
  });

  test("scheduling is unchanged: inside-interval skipped, overdue polled, never-polled always polled", async () => {
    const notDue: SecurityEventConnection = secOpsConnection({
      _id: CONNECTION_ID_ONE,
      pollIntervalInMinutes: 5,
      lastPolledAt: new Date(NOW.getTime() - 2 * MINUTE_MS),
    });
    const overdue: SecurityEventConnection = secOpsConnection({
      _id: CONNECTION_ID_TWO,
      pollIntervalInMinutes: 5,
      lastPolledAt: new Date(NOW.getTime() - 10 * MINUTE_MS),
    });
    // A brand new connection that has never polled.
    const neverPolled: SecurityEventConnection = secOpsConnection({
      _id: CONNECTION_ID_THREE,
    });
    loadConnections([notDue, overdue, neverPolled]);
    const pollSpy: ReturnType<typeof getJestSpyOn> = pollThroughTenant();

    await SecurityEventConnectionPoller.pollAllDueConnections();

    expect(polledIds(pollSpy)).toEqual([
      CONNECTION_ID_TWO,
      CONNECTION_ID_THREE,
    ]);
    /*
     * On the success path the loop itself writes nothing: every write is a
     * poll's own booking, carrying its lastPollResult.
     */
    expect(
      persistence.updates.map((update: ConnectionUpdate): string => {
        return update.id.toString();
      }),
    ).toEqual([CONNECTION_ID_TWO, CONNECTION_ID_THREE]);
    for (const update of persistence.updates) {
      expect(update.data["lastPollResult"]).toBeDefined();
    }
  });

  test("a connection with no id is not written to and does not stop the loop", async () => {
    const withoutId: SecurityEventConnection = secOpsConnection({
      cursor: CURSOR,
    });
    delete withoutId._id;
    const withId: SecurityEventConnection = secOpsConnection({
      _id: CONNECTION_ID_TWO,
      cursor: CURSOR,
    });
    loadConnections([withoutId, withId]);
    tenant.scripts.alerts = (): TenantReply => {
      return googleError(
        403,
        "PERMISSION_DENIED",
        "Caller does not have permission 'chronicle.legacies.legacyFetchAlertsView'.",
      );
    };
    const pollSpy: ReturnType<typeof getJestSpyOn> = pollThroughTenant();

    await expect(
      SecurityEventConnectionPoller.pollAllDueConnections(),
    ).resolves.toBeUndefined();

    // Both attempted; the id-less one simply has nothing to stamp.
    expect(pollSpy).toHaveBeenCalledTimes(2);
    expect(persistence.updates).toHaveLength(1);
    expect(persistence.updates[0]!.id.toString()).toBe(CONNECTION_ID_TWO);
    expect(persistence.updates[0]!.data["lastError"]).toContain("HTTP 403");
  });

  test("an unusable pollIntervalInMinutes is clamped rather than making a connection always due", async () => {
    const justPolledAt: Date = new Date(NOW.getTime() - 30 * 1000);
    /*
     * Thirty seconds is the discriminating gap: every clamped interval is at
     * least a minute, so these three are still inside their window. Unclamped,
     * 0 or a negative interval would hammer Chronicle every tick.
     */
    const zero: SecurityEventConnection = secOpsConnection({
      _id: CONNECTION_ID_ONE,
      pollIntervalInMinutes: 0,
      lastPolledAt: justPolledAt,
    });
    const negative: SecurityEventConnection = secOpsConnection({
      _id: CONNECTION_ID_TWO,
      pollIntervalInMinutes: -10,
      lastPolledAt: justPolledAt,
    });
    const missing: SecurityEventConnection = secOpsConnection({
      _id: CONNECTION_ID_THREE,
      lastPolledAt: justPolledAt,
    });
    delete missing.pollIntervalInMinutes;
    // The controls: one genuinely overdue, one never polled.
    const overdue: SecurityEventConnection = secOpsConnection({
      _id: CONNECTION_ID_FOUR,
      pollIntervalInMinutes: 5,
      lastPolledAt: new Date(NOW.getTime() - 10 * MINUTE_MS),
    });
    const neverPolled: SecurityEventConnection = secOpsConnection({
      _id: CONNECTION_ID_FIVE,
    });
    delete neverPolled.pollIntervalInMinutes;
    loadConnections([zero, negative, missing, overdue, neverPolled]);
    const pollSpy: ReturnType<typeof getJestSpyOn> = pollThroughTenant();

    await SecurityEventConnectionPoller.pollAllDueConnections();

    expect(polledIds(pollSpy)).toEqual([
      CONNECTION_ID_FOUR,
      CONNECTION_ID_FIVE,
    ]);
  });

  test("the ingested count of every polled connection is logged, not dropped", async () => {
    for (let index: number = 0; index < 7; index++) {
      addRecentDetection(`detection-${index}`);
    }
    loadConnections([secOpsConnection({ cursor: CURSOR })]);
    pollThroughTenant();

    await SecurityEventConnectionPoller.pollAllDueConnections();

    /*
     * The one number that distinguishes "polling healthy but quiet" from
     * "polling silently broken".
     */
    const reported: Array<number> = persistence.logs.info
      .filter((line: string): boolean => {
        return line.includes(CONNECTION_ID.toString());
      })
      .map((line: string): number => {
        const match: RegExpMatchArray | null = line.match(/ingested (\d+)/);
        return match ? Number(match[1]) : -1;
      })
      .filter((count: number): boolean => {
        return count >= 0;
      });
    expect(reported).toEqual([7]);
  });

  test("only enabled connections are loaded, and the fields a poll needs are reloaded inside the source lock", async () => {
    // What the tick's select returns: scheduling fields, no settings, no cursor.
    const scheduled: SecurityEventConnection = secOpsConnection();
    delete scheduled.config;
    delete scheduled.secrets;
    const findBySpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityEventConnectionService,
      "findBy",
    ).mockResolvedValue([scheduled] as never);
    const findOneByIdSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityEventConnectionService,
      "findOneById",
    ).mockResolvedValue(secOpsConnection({ cursor: CURSOR }) as never);
    (
      SecurityEventConnectorRegistry.getConnector as unknown as jest.Mock
    ).mockReturnValue(tenant.connector());

    // No pollConnection spy: the loop's own pollConnection runs, with no overrides.
    await SecurityEventConnectionPoller.pollAllDueConnections();

    expect(findBySpy).toHaveBeenCalledTimes(1);
    const args: JSONObject = findBySpy.mock.calls[0]![0] as JSONObject;
    expect(args["query"]).toEqual({ isEnabled: true });
    expect(args["skip"]).toBe(0);
    expect(args["limit"]).toBe(LIMIT_MAX);
    expect(args["props"]).toEqual({ isRoot: true });
    const select: JSONObject = args["select"] as JSONObject;
    for (const field of [
      "_id",
      "projectId",
      "provider",
      "pollIntervalInMinutes",
      "lastPolledAt",
    ]) {
      expect(select[field]).toBe(true);
    }

    /*
     * The retired loop selected region, instance, key, cursor and
     * lastPollResult up front. The shared loop selects only what scheduling
     * needs and reloads the rest inside the source lock, so a poll never
     * reads a cursor another poll moved while it waited.
     */
    const reload: JSONObject = findOneByIdSpy.mock.calls[0]![0] as JSONObject;
    const reloadSelect: JSONObject = reload["select"] as JSONObject;
    for (const field of [
      "_id",
      "projectId",
      "provider",
      "config",
      "secrets",
      "alertingOnly",
      "cursor",
      // F1: the previous result carries the next catch-up chunk length.
      "lastPollResult",
      "pollIntervalInMinutes",
    ]) {
      expect(reloadSelect[field]).toBe(true);
    }
    expect(requestWindow(tenant.requestsTo("alerts")[0]!).startTime).toBe(
      "2026-09-10T11:54:00.000Z",
    );
    expect(lastUpdate(persistence)["cursor"]).toBe(NOW.toISOString());
  });

  test("a fetch that throws before any detection arrives leaves the cursor untouched", async () => {
    tenant.scripts.alerts = (): Error => {
      return new Error("socket hang up");
    };
    loadConnections([secOpsConnection({ cursor: CURSOR })]);
    pollThroughTenant();

    await SecurityEventConnectionPoller.pollAllDueConnections();

    const written: JSONObject = lastUpdate(persistence);
    expect(written["lastPollResult"]).toEqual(
      expect.objectContaining({ complete: false, status: "failed" }),
    );
    expect(written["lastSuccessfulPollAt"]).toBeUndefined();
    expect(written["lastError"]).toContain("socket hang up");
    /*
     * With a saved cursor there is no cursor key at all. (A first poll with
     * no cursor now writes an anchor on failure, so the next poll does not
     * restart a day earlier; the retired poller wrote nothing.)
     */
    expect(written).not.toHaveProperty("cursor");
    expect(SecurityEventService.insertJsonRows).not.toHaveBeenCalled();
  });
});

describe("the Google SecOps source lock", () => {
  test("a busy source lock is reported in words and does not read Google", async () => {
    getJestSpyOn(Semaphore, "lock").mockRejectedValue(
      new SemaphoreLockTimeoutError(
        "Acquire SecurityEventConnectionSource lock timeout",
      ) as never,
    );

    await expect(
      SecurityEventConnectionPoller.executeConnection(
        secOpsConnection({ cursor: CURSOR }),
        { type: "poll" },
        tenant.overrides(),
      ),
    ).rejects.toThrow(
      "Another poll or import for this source is still running in this project. This run was skipped; polling continues on the next scheduled tick.",
    );
    expect(tenant.requests).toHaveLength(0);
    expect(persistence.updates).toHaveLength(0);
  });

  test("any other lock failure is passed through unchanged", async () => {
    getJestSpyOn(Semaphore, "lock").mockRejectedValue(
      new Error("Redis client is not connected") as never,
    );

    await expect(
      SecurityEventConnectionPoller.executeConnection(
        secOpsConnection({ cursor: CURSOR }),
        { type: "poll" },
        tenant.overrides(),
      ),
    ).rejects.toThrow("Redis client is not connected");
    expect(tenant.requests).toHaveLength(0);
  });

  test("poll and backfill share the same project source lock across connections", async () => {
    const other: SecurityEventConnection = secOpsConnection({
      _id: "33333333-3333-4333-8333-333333333333",
    });

    await SecurityEventConnectionPoller.executeConnection(
      secOpsConnection({ cursor: CURSOR }),
      { type: "poll" },
      tenant.overrides(),
    );
    await SecurityEventConnectionPoller.executeConnection(
      other,
      {
        type: "backfill",
        startTime: "2026-09-09T00:00:00.000Z",
        endTime: NOW.toISOString(),
      },
      tenant.overrides(),
    );

    const calls: Array<Array<unknown>> = getJestSpyOn(Semaphore, "lock").mock
      .calls;
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      /*
       * The retired poller locked GoogleSecOpsSource on the project id
       * alone. The shared key is the project plus the provider, which is
       * also the dedupe scope, so two Google SecOps connections in one
       * project still serialize.
       */
      expect(call[0]).toMatchObject({
        namespace: SECURITY_EVENT_SOURCE_LOCK_NAMESPACE,
        key: `${PROJECT_ID.toString()}:${SecurityEventConnectorProvider.GoogleSecOps}`,
      });
    }
    expect(Semaphore.release).toHaveBeenCalledTimes(2);
  });

  test("a lock acquisition failure prevents the fetch and every write", async () => {
    getJestSpyOn(Semaphore, "lock").mockRejectedValue(
      new Error("lock unavailable") as never,
    );

    await expect(
      SecurityEventConnectionPoller.executeConnection(
        secOpsConnection({ cursor: CURSOR }),
        { type: "poll" },
        tenant.overrides(),
      ),
    ).rejects.toThrow("lock unavailable");
    expect(tenant.requests).toHaveLength(0);
    expect(persistence.updates).toHaveLength(0);
    expect(Semaphore.release).not.toHaveBeenCalled();
  });

  test("a lock release error preserves the completed import result", async () => {
    getJestSpyOn(Semaphore, "release").mockRejectedValue(
      new Error("Redis unavailable") as never,
    );
    addRecentDetection("alert-1");

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        secOpsConnection({ cursor: CURSOR }),
        { type: "poll" },
        tenant.overrides(),
      );

    expect(result).toMatchObject({ status: "success", ingestedCount: 1 });
    expect(lastUpdate(persistence)["cursor"]).toBe(NOW.toISOString());
    expect(persistence.logs.error.join(" ")).toContain(
      "could not release source lock",
    );
  });

  test("concurrent imports from different connections remain serialized through durable insertion", async () => {
    let held: boolean = false;
    const waiting: Array<() => void> = [];
    getJestSpyOn(Semaphore, "lock").mockImplementation(
      (async (): Promise<JSONObject> => {
        if (held) {
          await new Promise<void>((resolve: () => void): void => {
            waiting.push(resolve);
          });
        }
        held = true;
        return {};
      }) as never,
    );
    getJestSpyOn(Semaphore, "release").mockImplementation(
      (async (): Promise<void> => {
        held = false;
        waiting.shift()?.();
      }) as never,
    );
    const insertHeld: Array<boolean> = [];
    getJestSpyOn(SecurityEventService, "insertJsonRows").mockImplementation(((
      rows: Array<JSONObject>,
      options: JSONObject,
    ): Promise<void> => {
      insertHeld.push(held);
      expect(options).toMatchObject({
        clickhouseSettings: { async_insert: 0, insert_distributed_sync: 1 },
      });
      for (const row of rows) {
        persistence.stored.add(String(row["eventUid"]));
      }
      return Promise.resolve();
    }) as never);
    addRecentDetection("alert-1");
    const other: SecurityEventConnection = secOpsConnection({
      _id: "33333333-3333-4333-8333-333333333333",
    });

    const results: Array<SecurityEventConnectionRunResult> = await Promise.all([
      SecurityEventConnectionPoller.executeConnection(
        secOpsConnection({ cursor: CURSOR }),
        { type: "poll" },
        tenant.overrides(),
      ),
      SecurityEventConnectionPoller.executeConnection(
        other,
        {
          type: "backfill",
          startTime: "2026-09-10T11:00:00.000Z",
          endTime: NOW.toISOString(),
        },
        tenant.overrides(),
      ),
    ]);

    expect(
      results.map((result: SecurityEventConnectionRunResult): number => {
        return result.ingestedCount;
      }),
    ).toEqual([1, 0]);
    expect(results[1]!.duplicateCount).toBe(1);
    // The one insert happened while its run still held the source lock.
    expect(insertHeld).toEqual([true]);
    expect(SecurityEventService.insertJsonRows).toHaveBeenCalledTimes(1);
  });
});

describe("the Google SecOps row reloaded inside the source lock", () => {
  test("production reloads the cursor, scope and poll interval inside the source lock", async () => {
    const current: SecurityEventConnection = secOpsConnection({
      cursor: "2026-09-10T11:58:00.000Z",
      // Detections selected under Data to import since the tick loaded the row.
      alertingOnly: false,
      pollIntervalInMinutes: 30,
    });
    getJestSpyOn(
      SecurityEventConnectionService,
      "findOneById",
    ).mockImplementation((async (): Promise<SecurityEventConnection> => {
      expect(Semaphore.lock).toHaveBeenCalledTimes(1);
      return current;
    }) as never);
    const settingsSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityEventConnectionService,
      "getConnectorSettings",
    );
    (
      SecurityEventConnectorRegistry.getConnector as unknown as jest.Mock
    ).mockReturnValue(tenant.connector());
    tenant.add({
      id: "late",
      createdMs: Date.parse("2026-09-10T11:59:00.000Z"),
      detectionMs: Date.parse("2026-09-10T11:39:00.000Z"),
      alerting: false,
    });

    // The caller's stale snapshot: an older cursor, alerts only, every 5 minutes.
    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        secOpsConnection({ cursor: CURSOR }),
        { type: "poll" },
      );

    expect(result.windowStart).toBe("2026-09-10T11:57:00.000Z");
    // The settings are decrypted from the reloaded row, not the snapshot.
    expect(settingsSpy).toHaveBeenCalledWith(current);
    expect(
      tenant.requestsTo("search").every((request: TenantRequest): boolean => {
        return request.url.searchParams.get("alertState") === null;
      }),
    ).toBe(true);
    expect(
      tenant
        .requestsTo("alerts")[0]!
        .url.searchParams.get("includeNonAlertingDetections"),
    ).toBe("ALERTS_FEATURE_PREFERENCE_ENABLED");
    expect(result.providerDetails?.["includeNonAlertingDetections"]).toBe(true);
    // Twenty minutes late is within the reloaded 30 minute interval.
    expect(result.providerDetails?.["creationLag"]).toMatchObject({
      measured: 1,
      lateCount: 0,
    });
    expect(result.ingestedCount).toBe(1);
    expect(Semaphore.release).toHaveBeenCalledTimes(1);
    // The next chunk length lives on the previous result, so it is reloaded too.
    expect(
      (
        getJestSpyOn(SecurityEventConnectionService, "findOneById").mock
          .calls[0]![0] as JSONObject
      )["select"],
    ).toMatchObject({
      cursor: true,
      lastPollResult: true,
      alertingOnly: true,
      pollIntervalInMinutes: true,
    });
  });

  test("the run executor loads the previous poll result with the connection, and its chunk reaches the Google requests", async () => {
    const runId: ObjectID = new ObjectID(
      "33333333-3333-4333-8333-333333333333",
    );
    const run: SecurityEventConnectionRun = new SecurityEventConnectionRun();
    run.id = runId;
    run.projectId = PROJECT_ID;
    run.securityEventConnectionId = CONNECTION_ID;
    run.type = "poll";
    run.status = "queued";
    run.request = { type: "poll" };
    const stored: SecurityEventConnection = new SecurityEventConnection();
    stored._id = CONNECTION_ID.toString();
    stored.projectId = PROJECT_ID;
    stored.provider = SecurityEventConnectorProvider.GoogleSecOps;
    stored.config = { region: "us", instanceResourceName: INSTANCE };
    stored.secrets = JSON.stringify({
      serviceAccountJson: SERVICE_ACCOUNT_JSON,
    });
    stored.alertingOnly = true;
    stored.isEnabled = true;
    stored.pollIntervalInMinutes = 5;
    stored.cursor = "2026-09-08T00:00:00.000Z";
    stored.lastPollResult = { type: "poll", nextChunkMinutes: 90 };

    getJestSpyOn(ProjectService, "findOneById").mockResolvedValue({
      id: PROJECT_ID,
    } as never);
    getJestSpyOn(
      SecurityEventConnectionRunService,
      "findOneById",
    ).mockResolvedValue(run as never);
    const runUpdates: Array<JSONObject> = [];
    getJestSpyOn(
      SecurityEventConnectionRunService,
      "updateOneById",
    ).mockImplementation(((call: JSONObject): Promise<void> => {
      runUpdates.push(call["data"] as JSONObject);
      return Promise.resolve();
    }) as never);
    const findOneBySpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityEventConnectionService,
      "findOneBy",
    ).mockResolvedValue(stored as never);
    getJestSpyOn(
      SecurityEventConnectionService,
      "findOneById",
    ).mockResolvedValue(stored as never);
    (
      SecurityEventConnectorRegistry.getConnector as unknown as jest.Mock
    ).mockReturnValue(tenant.connector());

    await SecurityEventConnectionRunExecutor.executeRun(runId);

    /*
     * Review finding alerts-view-budget-pins-cursor-forever (F1): a poll's
     * window length comes from lastPollResult.nextChunkMinutes, so the row
     * handed to the poller must include it alongside the cursor.
     */
    expect(findOneBySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { _id: CONNECTION_ID.toString(), projectId: PROJECT_ID },
        select: expect.objectContaining({
          cursor: true,
          lastPollResult: true,
          pollIntervalInMinutes: true,
        }),
      }),
    );
    /*
     * The 90 minute chunk reached every request Google received: the rule
     * search and the window's own alerts-view read take it as their window,
     * the curated rule counts reach a week further back to name the curated
     * rules worth searching (this tenant has none), and the scheduled poll's
     * late-alert sweep reads the day before the window.
     */
    expect(
      tenant.requests
        .filter((candidate: TenantRequest): boolean => {
          return candidate.route !== "token";
        })
        .map((candidate: TenantRequest): string => {
          return candidate.route;
        }),
    ).toEqual(["search", "curatedCounts", "alerts", "alerts"]);
    expect(requestWindow(tenant.requestsTo("search")[0]!)).toEqual({
      startTime: "2026-09-07T23:59:00.000Z",
      endTime: "2026-09-08T01:30:00.000Z",
    });
    expect(
      JSON.parse(tenant.requestsTo("curatedCounts")[0]!.body || "{}"),
    ).toEqual({
      interval: {
        startTime: "2026-08-31T23:59:00.000Z",
        endTime: "2026-09-08T01:30:00.000Z",
      },
    });
    expect(
      tenant
        .requestsTo("alerts")
        .map(
          (request: TenantRequest): { startTime: string; endTime: string } => {
            return requestWindow(request);
          },
        ),
    ).toEqual([
      {
        startTime: "2026-09-07T23:59:00.000Z",
        endTime: "2026-09-08T01:30:00.000Z",
      },
      {
        startTime: "2026-09-07T01:30:00.000Z",
        endTime: "2026-09-07T23:59:00.000Z",
      },
    ]);
    // The run row carries the poll's result, and the connection its cursor.
    const finished: JSONObject = runUpdates[runUpdates.length - 1]!;
    expect(finished["status"]).toBe("empty");
    expect(
      (finished["result"] as unknown as SecurityEventConnectionRunResult).runId,
    ).toBe(runId.toString());
    expect(lastUpdate(persistence)["cursor"]).toBe("2026-09-08T01:30:00.000Z");
    expect(storedResult(lastUpdate(persistence)).nextChunkMinutes).toBe(180);
  });

  test("a stored row that fails validation is recorded as a configuration failure without contacting Google", async () => {
    getJestSpyOn(
      SecurityEventConnectionService,
      "findOneById",
    ).mockResolvedValue(
      secOpsConnection({
        cursor: CURSOR,
        config: { region: "us-central1", instanceResourceName: INSTANCE },
      }) as never,
    );
    (
      SecurityEventConnectorRegistry.getConnector as unknown as jest.Mock
    ).mockReturnValue(tenant.connector());

    const result: SecurityEventConnectionRunResult =
      await SecurityEventConnectionPoller.executeConnection(
        secOpsConnection({ cursor: CURSOR }),
        { type: "poll" },
      );

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/^Region/);
    expect(tenant.requests).toHaveLength(0);
    expect(lastUpdate(persistence)["lastError"]).toBe(result.error);
    expect(lastUpdate(persistence)).not.toHaveProperty("cursor");
    expect(SecurityEventDedupe.findExistingEventUids).not.toHaveBeenCalled();
  });
});
