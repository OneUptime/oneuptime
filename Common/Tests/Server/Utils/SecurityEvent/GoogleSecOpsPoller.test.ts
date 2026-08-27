import GoogleSecOpsConnection from "../../../../Models/DatabaseModels/GoogleSecOpsConnection";
import GoogleSecOpsConnectionService from "../../../../Server/Services/GoogleSecOpsConnectionService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../../Server/Services/SecurityEventService";
import GoogleSecOpsClient from "../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsClient";
import GoogleSecOpsPoller from "../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsPoller";
import { MAX_CONNECTOR_ERROR_MESSAGE_LENGTH } from "../../../../Server/Utils/SecurityEvent/ConnectorErrorMessage";
import logger from "../../../../Server/Utils/Logger";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { getMaxLengthFromTableColumnType } from "../../../../Types/Database/ColumnLength";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import APIException from "../../../../Types/Exception/ApiException";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The poller is the managed half of the Google SecOps connector: it turns
 * customer connections into Detection Finding rows on a cursor. These
 * tests pin the cursor-window arithmetic (overlap, stale-cursor cap), the
 * normalization hand-off, and the error bookkeeping — the behaviors that
 * decide whether alerts get lost, duplicated, or silently stop flowing.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

function makeConnection(): GoogleSecOpsConnection {
  const connection: GoogleSecOpsConnection = new GoogleSecOpsConnection();
  connection._id = CONNECTION_ID.toString();
  connection.projectId = PROJECT_ID;
  connection.name = "Prod tenant";
  connection.region = "us";
  connection.instanceResourceName =
    "projects/p/locations/us/instances/instance-1";
  connection.serviceAccountJson = "{}"; // never parsed — client is injected.
  connection.pollIntervalInMinutes = 5;
  return connection;
}

function makeServiceMetadata(): TelemetryServiceMetadata {
  return {
    serviceName: "Google SecOps",
    primaryEntityId: new ObjectID("33333333-3333-4333-8333-333333333333"),
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  };
}

function makeFakeClient(alerts: Array<JSONObject>): {
  client: GoogleSecOpsClient;
  calls: Array<{ startTime: Date; endTime: Date }>;
} {
  const calls: Array<{ startTime: Date; endTime: Date }> = [];

  const client: GoogleSecOpsClient = {
    fetchDetectionAlerts: (data: {
      startTime: Date;
      endTime: Date;
    }): Promise<Array<JSONObject>> => {
      calls.push({ startTime: data.startTime, endTime: data.endTime });
      return Promise.resolve(alerts);
    },
  } as unknown as GoogleSecOpsClient;

  return { client, calls };
}

describe("GoogleSecOpsPoller.pollConnection", () => {
  let insertedRows: Array<JSONObject>;

  beforeEach(() => {
    insertedRows = [];

    getJestSpyOn(
      OTelIngestService,
      "telemetryServiceFromName",
    ).mockResolvedValue(makeServiceMetadata() as never);

    getJestSpyOn(SecurityEventService, "insertJsonRows").mockImplementation(((
      rows: Array<JSONObject>,
    ): Promise<void> => {
      insertedRows.push(...rows);
      return Promise.resolve();
    }) as never);

    getJestSpyOn(
      GoogleSecOpsConnectionService,
      "updateOneById",
    ).mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("ingests fetched alerts as Detection Finding rows and advances the cursor", async () => {
    const connection: GoogleSecOpsConnection = makeConnection();
    const { client } = makeFakeClient([
      {
        id: "alert-1",
        detection: [{ ruleName: "Brute force", severity: "HIGH" }],
      },
    ]);

    const ingested: number = await GoogleSecOpsPoller.pollConnection(
      connection,
      client,
    );

    expect(ingested).toBe(1);
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]!["classUid"]).toBe(2004);
    expect(insertedRows[0]!["className"]).toBe("Detection Finding");
    expect(insertedRows[0]!["ruleName"]).toBe("Brute force");
    expect(insertedRows[0]!["projectId"]).toBe(PROJECT_ID.toString());

    expect(GoogleSecOpsConnectionService.updateOneById).toHaveBeenCalledTimes(
      1,
    );
    const updateArgs: JSONObject = (
      GoogleSecOpsConnectionService.updateOneById as unknown as jest.Mock
    ).mock.calls[0]![0] as JSONObject;
    const updateData: JSONObject = updateArgs["data"] as JSONObject;
    expect(typeof updateData["cursor"]).toBe("string");
    expect(updateData["lastError"]).toBeNull();
  });

  test("first poll (no cursor) looks back the default window; cursor polls overlap by a minute", async () => {
    const connection: GoogleSecOpsConnection = makeConnection();
    const { client, calls } = makeFakeClient([]);

    await GoogleSecOpsPoller.pollConnection(connection, client);

    expect(calls).toHaveLength(1);
    const firstWindowMinutes: number =
      (calls[0]!.endTime.getTime() - calls[0]!.startTime.getTime()) /
      (60 * 1000);
    expect(Math.round(firstWindowMinutes)).toBe(15);

    /*
     * Second poll with a cursor five minutes ago: window starts one
     * overlap-minute before the cursor.
     */
    const cursorDate: Date = new Date(Date.now() - 5 * 60 * 1000);
    connection.cursor = cursorDate.toISOString();

    await GoogleSecOpsPoller.pollConnection(connection, client);

    expect(calls).toHaveLength(2);
    const overlapMs: number =
      cursorDate.getTime() - calls[1]!.startTime.getTime();
    expect(Math.round(overlapMs / (60 * 1000))).toBe(1);
  });

  test("a stale cursor is capped at the maximum lookback", async () => {
    const connection: GoogleSecOpsConnection = makeConnection();
    connection.cursor = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { client, calls } = makeFakeClient([]);

    await GoogleSecOpsPoller.pollConnection(connection, client);

    const windowMinutes: number =
      (calls[0]!.endTime.getTime() - calls[0]!.startTime.getTime()) /
      (60 * 1000);
    expect(Math.round(windowMinutes)).toBe(24 * 60);
  });

  test("an unparseable alert is skipped without failing the batch", async () => {
    const connection: GoogleSecOpsConnection = makeConnection();

    /*
     * The normalizer is tolerant by design, so simulate a poison alert by
     * making the first normalization throw via a hostile getter.
     */
    const poison: JSONObject = {};
    Object.defineProperty(poison, "detection", {
      get: (): never => {
        throw new Error("poison alert");
      },
      enumerable: true,
    });

    const { client } = makeFakeClient([
      poison,
      { id: "ok", detection: [{ ruleName: "Fine", severity: "LOW" }] },
    ]);

    const ingested: number = await GoogleSecOpsPoller.pollConnection(
      connection,
      client,
    );

    expect(ingested).toBe(1);
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]!["ruleName"]).toBe("Fine");
  });

  test("no alerts: no service resolution, no insert, cursor still advances", async () => {
    const connection: GoogleSecOpsConnection = makeConnection();
    const { client } = makeFakeClient([]);

    const ingested: number = await GoogleSecOpsPoller.pollConnection(
      connection,
      client,
    );

    expect(ingested).toBe(0);
    expect(OTelIngestService.telemetryServiceFromName).not.toHaveBeenCalled();
    expect(SecurityEventService.insertJsonRows).not.toHaveBeenCalled();
    expect(GoogleSecOpsConnectionService.updateOneById).toHaveBeenCalledTimes(
      1,
    );
  });
});

describe("GoogleSecOpsPoller.pollAllDueConnections", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("polls due connections, skips not-yet-due ones, and records lastError on failure", async () => {
    const dueConnection: GoogleSecOpsConnection = makeConnection();

    const notDueConnection: GoogleSecOpsConnection = makeConnection();
    notDueConnection._id = "44444444-4444-4444-8444-444444444444";
    notDueConnection.lastPolledAt = new Date();

    getJestSpyOn(GoogleSecOpsConnectionService, "findBy").mockResolvedValue([
      dueConnection,
      notDueConnection,
    ] as never);

    const updateSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      GoogleSecOpsConnectionService,
      "updateOneById",
    ).mockResolvedValue(undefined as never);

    const pollSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      GoogleSecOpsPoller,
      "pollConnection",
    ).mockRejectedValue(new Error("token exchange failed") as never);

    await GoogleSecOpsPoller.pollAllDueConnections();

    // Only the due connection was polled...
    expect(pollSpy).toHaveBeenCalledTimes(1);

    // ...and its failure was recorded as lastError.
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const updateArgs: JSONObject = updateSpy.mock.calls[0]![0] as JSONObject;
    const updateData: JSONObject = updateArgs["data"] as JSONObject;
    expect(updateData["lastError"]).toContain("token exchange failed");
  });
});

/*
 * The silent-connector outage.
 *
 * A customer's connector stopped polling and its row read lastPolledAt =
 * null AND lastError = null, unchanged for hours: the two columns that
 * exist to explain an outage were exactly the ones the outage prevented
 * from being written.
 *
 * pollAllDueConnections used to call updateOneById bare inside its catch
 * block. lastError was declared TableColumnType.LongText — varchar(500) —
 * while GoogleSecOpsClient builds an HTTP failure as a 46 character prefix
 * plus up to 500 characters of echoed response body, so 546 characters.
 * DatabaseService.checkMaxLengthOfFields rejects any value longer than the
 * column's declared max with a BadDataException, so the recovery write
 * threw, the throw escaped the catch block and took the whole for-loop
 * with it, nothing was stamped, and every connection still due in that
 * tick was skipped. Every minute, forever, in silence.
 *
 * The stub below applies the same length rule the real write path applies,
 * read off the live column metadata rather than a hardcoded 500 — so if
 * lastError is ever re-narrowed to a bounded varchar, these tests fail
 * again for the original reason.
 */

const CONNECTION_ID_ONE: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CONNECTION_ID_TWO: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const CONNECTION_ID_THREE: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

// The exact prefix GoogleSecOpsClient puts in front of an echoed body.
const SECOPS_FETCH_ERROR_PREFIX: string =
  "Google SecOps alerts fetch failed (HTTP 403): ";

// The shape of one updateOneById call, for readable assertions.
type ConnectionUpdateCall = {
  id: ObjectID;
  data: JSONObject;
};

function updateCall(
  spy: ReturnType<typeof getJestSpyOn>,
  index: number,
): ConnectionUpdateCall {
  return spy.mock.calls[index]![0] as ConnectionUpdateCall;
}

/*
 * A connection that has never been polled: lastPolledAt stays unset, which
 * is both the customer's exact state and the always-due case.
 */
function makeDueConnection(id: string): GoogleSecOpsConnection {
  const connection: GoogleSecOpsConnection = makeConnection();
  connection._id = id;
  return connection;
}

/*
 * The real failure, rebuilt from GoogleSecOpsClient's own template:
 *   `Google SecOps alerts fetch failed (HTTP ${status}): ${responseText.slice(0, 500)}`
 * A 403 from the Chronicle API returns a JSON error blob far longer than
 * the 500 characters the client keeps, so this is the worst case the
 * poller can be handed: 46 + 500 = 546 characters.
 */
function makeLongFetchError(): APIException {
  const responseText: string = JSON.stringify({
    error: {
      code: 403,
      status: "PERMISSION_DENIED",
      message: `Caller does not have permission 'chronicle.legacies.legacyFetchAlertsView'. ${"grant the Chronicle API Viewer role on the instance. ".repeat(
        20,
      )}`,
    },
  });

  return new APIException(
    `${SECOPS_FETCH_ERROR_PREFIX}${responseText.slice(0, 500)}`,
  );
}

/*
 * The declared max for GoogleSecOpsConnection.lastError, straight off the
 * model: 500 while the column was LongText, undefined now that it is
 * VeryLongText. This is the number DatabaseService.checkMaxLengthOfFields
 * consults before every write.
 */
function lastErrorMaxLength(): number | undefined {
  const metadata: TableColumnMetadata =
    new GoogleSecOpsConnection().getTableColumnMetadata("lastError");
  return getMaxLengthFromTableColumnType(metadata.type);
}

/*
 * updateOneById stubbed to fail the way the database fails: reject an
 * over-long lastError exactly as checkMaxLengthOfFields does. A stub that
 * always resolves would swallow the very overflow that took the poller
 * down, and the regression could not be reproduced at this level at all.
 */
function stubUpdateOneByIdWithColumnLengthCheck(): ReturnType<
  typeof getJestSpyOn
> {
  return getJestSpyOn(
    GoogleSecOpsConnectionService,
    "updateOneById",
  ).mockImplementation(((call: ConnectionUpdateCall): Promise<void> => {
    const lastError: unknown = call.data["lastError"];
    const maxLength: number | undefined = lastErrorMaxLength();

    if (
      typeof lastError === "string" &&
      maxLength !== undefined &&
      lastError.length > maxLength
    ) {
      return Promise.reject(
        new BadDataException(
          `lastError length cannot be more than ${maxLength} characters`,
        ),
      );
    }

    return Promise.resolve();
  }) as never);
}

describe("GoogleSecOpsPoller.pollAllDueConnections error bookkeeping", () => {
  beforeEach(() => {
    // Every test here drives an expected failure down the logging path.
    getJestSpyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a >500 character SecOps error is recorded, not swallowed with the whole tick", async () => {
    const connection: GoogleSecOpsConnection =
      makeDueConnection(CONNECTION_ID_ONE);

    const error: APIException = makeLongFetchError();

    /*
     * Guards the premise of the regression: this message really is longer
     * than the 500 characters the old LongText column allowed. If the
     * fixture ever shrinks below that, the test below stops proving
     * anything and this assertion says so.
     */
    expect(error.message.length).toBeGreaterThan(
      getMaxLengthFromTableColumnType(TableColumnType.LongText)!,
    );

    /*
     * ...and the other half of the premise: lastError is now an unbounded
     * text column, so the stub below has no bound left to reject against.
     * While it was LongText this was 500 and the write died on it.
     */
    expect(lastErrorMaxLength()).toBeUndefined();

    getJestSpyOn(GoogleSecOpsConnectionService, "findBy").mockResolvedValue([
      connection,
    ] as never);

    const updateSpy: ReturnType<typeof getJestSpyOn> =
      stubUpdateOneByIdWithColumnLengthCheck();

    getJestSpyOn(GoogleSecOpsPoller, "pollConnection").mockRejectedValue(
      error as never,
    );

    /*
     * Pre-fix this rejected: the 546 character message overflowed
     * varchar(500), checkMaxLengthOfFields threw a BadDataException out of
     * the bare updateOneById, and the throw escaped the catch block.
     */
    await expect(
      GoogleSecOpsPoller.pollAllDueConnections(),
    ).resolves.toBeUndefined();

    // Pre-fix nothing was written at all — both columns stayed null.
    expect(updateSpy).toHaveBeenCalledTimes(1);

    const written: JSONObject = updateCall(updateSpy, 0).data;
    const lastError: string = written["lastError"] as string;

    expect(typeof lastError).toBe("string");
    expect(lastError.length).toBeGreaterThan(0);
    expect(lastError.length).toBeLessThanOrEqual(
      MAX_CONNECTOR_ERROR_MESSAGE_LENGTH,
    );
    expect(lastError).toContain(SECOPS_FETCH_ERROR_PREFIX.trim());

    // 546 is under the 1000 character clamp, so the body survives whole.
    expect(lastError).toBe(error.message);

    /*
     * And the stamp that says "this connector was attempted" — the field
     * whose null value made the outage invisible — is set.
     */
    expect(written["lastPolledAt"]).toBeInstanceOf(Date);
  });

  test("a rejected bookkeeping write does not abandon the connections behind it", async () => {
    const first: GoogleSecOpsConnection = makeDueConnection(CONNECTION_ID_ONE);
    const second: GoogleSecOpsConnection = makeDueConnection(CONNECTION_ID_TWO);
    const third: GoogleSecOpsConnection =
      makeDueConnection(CONNECTION_ID_THREE);

    getJestSpyOn(GoogleSecOpsConnectionService, "findBy").mockResolvedValue([
      first,
      second,
      third,
    ] as never);

    /*
     * The first connection's stamp fails for a reason that has nothing to
     * do with message length — a deadlock, a dropped connection. The
     * column widening alone does not save the loop from this; only running
     * the write inside its own try/catch does.
     */
    const updateSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      GoogleSecOpsConnectionService,
      "updateOneById",
    ).mockImplementation(((call: ConnectionUpdateCall): Promise<void> => {
      if (call.id.toString() === CONNECTION_ID_ONE) {
        return Promise.reject(new Error("deadlock detected"));
      }
      return Promise.resolve();
    }) as never);

    const pollSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      GoogleSecOpsPoller,
      "pollConnection",
    ).mockRejectedValue(new Error("token exchange failed") as never);

    await expect(
      GoogleSecOpsPoller.pollAllDueConnections(),
    ).resolves.toBeUndefined();

    /*
     * The heart of the fix. Pre-fix the first connection's rejected write
     * escaped the loop, so pollConnection was called ONCE and connections
     * two and three were never attempted — a single unlucky row silenced
     * every other connector in the project, every tick.
     */
    expect(pollSpy).toHaveBeenCalledTimes(3);

    expect(updateSpy).toHaveBeenCalledTimes(3);
    expect([
      updateCall(updateSpy, 0).id.toString(),
      updateCall(updateSpy, 1).id.toString(),
      updateCall(updateSpy, 2).id.toString(),
    ]).toEqual([CONNECTION_ID_ONE, CONNECTION_ID_TWO, CONNECTION_ID_THREE]);

    // The two survivors got their failure recorded, not just attempted.
    expect(updateCall(updateSpy, 1).data["lastError"]).toContain(
      "token exchange failed",
    );
    expect(updateCall(updateSpy, 2).data["lastError"]).toContain(
      "token exchange failed",
    );
  });

  test("a bookkeeping write that throws synchronously is survived too", async () => {
    const first: GoogleSecOpsConnection = makeDueConnection(CONNECTION_ID_ONE);
    const second: GoogleSecOpsConnection = makeDueConnection(CONNECTION_ID_TWO);

    getJestSpyOn(GoogleSecOpsConnectionService, "findBy").mockResolvedValue([
      first,
      second,
    ] as never);

    /*
     * Not every failure arrives as a rejected promise: argument
     * validation and a torn-down connection pool both throw before any
     * promise exists. Pre-fix this escaped the catch block identically.
     */
    const updateSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      GoogleSecOpsConnectionService,
      "updateOneById",
    ).mockImplementation(((): Promise<void> => {
      throw new Error("connection terminated unexpectedly");
    }) as never);

    const pollSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      GoogleSecOpsPoller,
      "pollConnection",
    ).mockRejectedValue(new Error("token exchange failed") as never);

    await expect(
      GoogleSecOpsPoller.pollAllDueConnections(),
    ).resolves.toBeUndefined();

    expect(pollSpy).toHaveBeenCalledTimes(2);
    expect(updateSpy).toHaveBeenCalledTimes(2);
  });

  /*
   * Scheduling is not part of the fix, but it is the behavior the fix runs
   * inside — so pin it, so that hardening the catch block cannot quietly
   * change which connections a tick visits.
   */
  test("scheduling is unchanged: inside-interval skipped, overdue polled, never-polled always polled", async () => {
    const now: number = Date.now();

    const notDue: GoogleSecOpsConnection = makeDueConnection(CONNECTION_ID_ONE);
    notDue.pollIntervalInMinutes = 5;
    notDue.lastPolledAt = new Date(now - 2 * 60 * 1000); // due in 3 minutes.

    const overdue: GoogleSecOpsConnection =
      makeDueConnection(CONNECTION_ID_TWO);
    overdue.pollIntervalInMinutes = 5;
    overdue.lastPolledAt = new Date(now - 10 * 60 * 1000); // due 5 ago.

    // The customer's row: a brand new connection that has never polled.
    const neverPolled: GoogleSecOpsConnection =
      makeDueConnection(CONNECTION_ID_THREE);

    getJestSpyOn(GoogleSecOpsConnectionService, "findBy").mockResolvedValue([
      notDue,
      overdue,
      neverPolled,
    ] as never);

    const updateSpy: ReturnType<typeof getJestSpyOn> =
      stubUpdateOneByIdWithColumnLengthCheck();

    const pollSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      GoogleSecOpsPoller,
      "pollConnection",
    ).mockResolvedValue(0 as never);

    await GoogleSecOpsPoller.pollAllDueConnections();

    expect(pollSpy).toHaveBeenCalledTimes(2);
    expect(
      pollSpy.mock.calls.map((call: Array<unknown>): string | undefined => {
        return (call[0] as GoogleSecOpsConnection)._id;
      }),
    ).toEqual([CONNECTION_ID_TWO, CONNECTION_ID_THREE]);

    /*
     * On the success path the loop itself writes nothing — pollConnection
     * owns its own bookkeeping — so the catch block never ran.
     */
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("a connection with no id is not written to and does not stop the loop", async () => {
    const withoutId: GoogleSecOpsConnection =
      makeDueConnection(CONNECTION_ID_ONE);
    delete withoutId._id;

    const withId: GoogleSecOpsConnection = makeDueConnection(CONNECTION_ID_TWO);

    getJestSpyOn(GoogleSecOpsConnectionService, "findBy").mockResolvedValue([
      withoutId,
      withId,
    ] as never);

    const updateSpy: ReturnType<typeof getJestSpyOn> =
      stubUpdateOneByIdWithColumnLengthCheck();

    const pollSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      GoogleSecOpsPoller,
      "pollConnection",
    ).mockRejectedValue(makeLongFetchError() as never);

    await expect(
      GoogleSecOpsPoller.pollAllDueConnections(),
    ).resolves.toBeUndefined();

    // Both attempted; the id-less one simply has nothing to stamp.
    expect(pollSpy).toHaveBeenCalledTimes(2);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateCall(updateSpy, 0).id.toString()).toBe(CONNECTION_ID_TWO);
  });

  /*
   * The other half of the contract, unchanged by the fix: a poll that
   * works still clears the error and moves the cursor forward. Widening
   * the column and rerouting the catch block must not leave a stale
   * lastError sitting on a healthy connection.
   */
  test("the success path still clears lastError and advances the cursor", async () => {
    const connection: GoogleSecOpsConnection = makeConnection();
    const staleCursor: Date = new Date(Date.now() - 30 * 60 * 1000);
    connection.cursor = staleCursor.toISOString();

    const { client } = makeFakeClient([]);

    const updateSpy: ReturnType<typeof getJestSpyOn> =
      stubUpdateOneByIdWithColumnLengthCheck();

    const ingested: number = await GoogleSecOpsPoller.pollConnection(
      connection,
      client,
    );

    expect(ingested).toBe(0);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    const written: JSONObject = updateCall(updateSpy, 0).data;

    expect(written["lastError"]).toBeNull();
    expect(written["lastPolledAt"]).toBeInstanceOf(Date);
    expect(new Date(written["cursor"] as string).getTime()).toBeGreaterThan(
      staleCursor.getTime(),
    );
  });
});
