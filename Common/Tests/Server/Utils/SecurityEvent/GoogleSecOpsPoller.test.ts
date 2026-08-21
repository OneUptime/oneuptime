import GoogleSecOpsConnection from "../../../../Models/DatabaseModels/GoogleSecOpsConnection";
import GoogleSecOpsConnectionService from "../../../../Server/Services/GoogleSecOpsConnectionService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../../Server/Services/SecurityEventService";
import GoogleSecOpsClient from "../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsClient";
import GoogleSecOpsPoller from "../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsPoller";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
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

function makeFakeClient(
  alerts: Array<JSONObject>,
): {
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

    getJestSpyOn(OTelIngestService, "telemetryServiceFromName").mockResolvedValue(
      makeServiceMetadata() as never,
    );

    getJestSpyOn(SecurityEventService, "insertJsonRows").mockImplementation(
      ((rows: Array<JSONObject>): Promise<void> => {
        insertedRows.push(...rows);
        return Promise.resolve();
      }) as never,
    );

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

    expect(
      GoogleSecOpsConnectionService.updateOneById,
    ).toHaveBeenCalledTimes(1);
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

    // Second poll with a cursor five minutes ago: window starts one
    // overlap-minute before the cursor.
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
