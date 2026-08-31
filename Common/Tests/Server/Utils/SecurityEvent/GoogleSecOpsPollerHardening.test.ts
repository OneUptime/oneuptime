import { generateKeyPairSync } from "crypto";
import GoogleSecOpsConnection from "../../../../Models/DatabaseModels/GoogleSecOpsConnection";
import GoogleSecOpsConnectionService from "../../../../Server/Services/GoogleSecOpsConnectionService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../../Server/Services/SecurityEventService";
import logger from "../../../../Server/Utils/Logger";
import GoogleSecOpsClient, {
  FetchAlertsResult,
  FetchLike,
  FetchResponseLike,
} from "../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsClient";
import GoogleSecOpsPoller from "../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsPoller";
import ThreatIntelEnricher, {
  EnrichmentResult,
} from "../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import GoogleSecOpsAlertNormalizer from "../../../../Utils/SecurityEvent/GoogleSecOpsAlertNormalizer";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The cursor is the only thing standing between a broken Google SecOps
 * poll and permanent, silent data loss.
 *
 * legacyFetchAlertsView is a server-streaming method whose 200 body is an
 * array of chunks with the alerts two levels down at chunk.alerts.alerts[].
 * The client used to look for a top-level `alerts` array, find nothing,
 * and return [] — and the poller read [] as "a quiet window", advanced the
 * cursor past it, and cleared lastError. Every tick, for every tenant, a
 * totally broken connector was byte-identical in the database to a healthy
 * one with nothing to report.
 *
 * So the behaviors pinned here are the ones that decide whether a failure
 * is recoverable: which outcomes may move the cursor forward, which must
 * hold it where it is, what the poll window resolves to when the stored
 * cursor cannot be trusted, and whether the number of events actually
 * ingested is observable from outside the process at all.
 *
 * Everything runs through the real GoogleSecOpsClient over an injected
 * transport wherever the response shape is the thing under test, so the
 * chunk envelope these tests assert on is the one Chronicle sends.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const INSTANCE_RESOURCE_NAME: string =
  "projects/my-project/locations/us/instances/3f0a-instance";

// Not Chronicle: the transport below routes on this to tell the two apart.
const GOOGLE_TOKEN_URI: string = "https://oauth2.googleapis.com/token";

/*
 * A real RS256 key, because the client genuinely signs a JWT assertion on
 * the way to the token endpoint and validates the PEM at construction; a
 * fake key fails there instead of at the behavior under test.
 */
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const SERVICE_ACCOUNT_JSON: string = JSON.stringify({
  client_email: "poller@example.iam.gserviceaccount.com",
  private_key: privateKey,
  token_uri: GOOGLE_TOKEN_URI,
});

const MINUTE_IN_MS: number = 60 * 1000;
const HOUR_IN_MS: number = 60 * MINUTE_IN_MS;
const DAY_IN_MS: number = 24 * HOUR_IN_MS;

const DETECTION_FINDING_CLASS_UID: number = 2004;

/*
 * Captured at import time, before any spy replaces it.
 * pollAllDueConnections calls `this.pollConnection(connection)` with no
 * client override, so putting an injected transport under a full tick
 * means spying on pollConnection and delegating straight back to the real
 * implementation with a client attached. Everything inside it — the
 * window arithmetic, the alert gate, the insert, the bookkeeping write —
 * still runs for real.
 */
const originalPollConnection: (
  connection: GoogleSecOpsConnection,
  clientOverride?: GoogleSecOpsClient | undefined,
) => Promise<number> =
  GoogleSecOpsPoller.pollConnection.bind(GoogleSecOpsPoller);

interface StubbedResponse {
  status: number;
  body: string;
}

interface RecordedRequest {
  url: string;
  method: string;
}

interface RecordedWindow {
  startTime: Date;
  endTime: Date;
}

// The shape of one updateOneById call, for readable assertions.
interface ConnectionUpdateCall {
  id: ObjectID;
  data: JSONObject;
}

interface CapturedLogs {
  info: Array<string>;
  warn: Array<string>;
  error: Array<string>;
  debug: Array<string>;
}

interface PollHarness {
  updates: Array<ConnectionUpdateCall>;
  insertedBatches: Array<Array<JSONObject>>;
  logs: CapturedLogs;
  telemetrySpy: ReturnType<typeof getJestSpyOn>;
  insertSpy: ReturnType<typeof getJestSpyOn>;
  enricherSpy: ReturnType<typeof getJestSpyOn>;
}

function makeConnection(): GoogleSecOpsConnection {
  const connection: GoogleSecOpsConnection = new GoogleSecOpsConnection();
  connection._id = CONNECTION_ID.toString();
  connection.projectId = PROJECT_ID;
  connection.name = "Prod tenant";
  connection.region = "us";
  connection.instanceResourceName = INSTANCE_RESOURCE_NAME;
  connection.serviceAccountJson = SERVICE_ACCOUNT_JSON;
  connection.pollIntervalInMinutes = 5;
  // lastPolledAt left unset: never polled, therefore always due.
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

/*
 * One alert with its matched UDM sample event, so the finding row carries
 * the entities the detection fired on rather than an empty shell.
 */
function alertOne(): JSONObject {
  return {
    id: "alert-1",
    type: "RULE_DETECTION",
    detectionTime: "2026-08-21T09:30:00.000Z",
    detection: [
      {
        ruleName: "Suspicious PowerShell",
        ruleId: "ru_1a2b",
        severity: "HIGH",
        alertState: "ALERTING",
      },
    ],
    collectionElements: [
      {
        label: "e1",
        references: [
          {
            event: {
              metadata: {
                eventType: "PROCESS_LAUNCH",
                eventTimestamp: "2026-08-21T09:29:58.000Z",
              },
              principal: {
                hostname: "workstation-14",
                ip: ["10.1.2.3"],
                user: { userid: "jsmith" },
              },
              target: { ip: ["203.0.113.9"], port: 443 },
            },
          },
        ],
      },
    ],
  };
}

function alertTwo(): JSONObject {
  return {
    id: "alert-2",
    type: "RULE_DETECTION",
    detectionTime: "2026-08-21T09:31:00.000Z",
    detection: [
      {
        ruleName: "Impossible travel",
        ruleId: "ru_9z8y",
        severity: "CRITICAL",
      },
    ],
  };
}

/*
 * A FetchAlertsViewResponse chunk. Not an alert — it is the envelope the
 * alerts arrive inside, and the client's own gate is what keeps it out of
 * the alerts array in the first place.
 */
function streamChunk(): JSONObject {
  return { progress: 0.5, complete: false };
}

function okTokenResponse(): StubbedResponse {
  return {
    status: 200,
    body: JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
  };
}

/*
 * Transport routed by URL rather than by call order, so a test can read
 * the window off the Chronicle request without counting calls.
 */
function makeFetch(responses: {
  token: StubbedResponse;
  alerts: StubbedResponse;
}): {
  fetchImplementation: FetchLike;
  requests: Array<RecordedRequest>;
} {
  const requests: Array<RecordedRequest> = [];

  const fetchImplementation: FetchLike = (
    url: string,
    init: {
      method: string;
      headers: Record<string, string>;
      body?: string | undefined;
    },
  ): Promise<FetchResponseLike> => {
    requests.push({ url: url, method: init.method });

    const response: StubbedResponse =
      url === GOOGLE_TOKEN_URI ? responses.token : responses.alerts;

    return Promise.resolve({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      text: (): Promise<string> => {
        return Promise.resolve(response.body);
      },
    });
  };

  return { fetchImplementation: fetchImplementation, requests: requests };
}

function makeClient(alerts: StubbedResponse): {
  client: GoogleSecOpsClient;
  requests: Array<RecordedRequest>;
} {
  const { fetchImplementation, requests } = makeFetch({
    token: okTokenResponse(),
    alerts: alerts,
  });

  const client: GoogleSecOpsClient = new GoogleSecOpsClient({
    region: "us",
    instanceResourceName: INSTANCE_RESOURCE_NAME,
    serviceAccountJson: SERVICE_ACCOUNT_JSON,
    fetchImplementation: fetchImplementation,
  });

  return { client: client, requests: requests };
}

/* A 200 whose body is the real streaming envelope. */
function streamingResponse(chunks: Array<JSONObject>): StubbedResponse {
  return { status: 200, body: JSON.stringify(chunks) };
}

function alertsRequestOf(requests: Array<RecordedRequest>): RecordedRequest {
  const alertsRequests: Array<RecordedRequest> = requests.filter(
    (request: RecordedRequest): boolean => {
      return request.url !== GOOGLE_TOKEN_URI;
    },
  );

  expect(alertsRequests).toHaveLength(1);

  return alertsRequests[0]!;
}

function windowSentTo(requests: Array<RecordedRequest>): {
  startTime: string;
  endTime: string;
} {
  const params: URLSearchParams = new URL(alertsRequestOf(requests).url)
    .searchParams;

  return {
    startTime: params.get("timeRange.startTime") || "",
    endTime: params.get("timeRange.endTime") || "",
  };
}

/*
 * What the client hands back for a window that parsed cleanly. Used where
 * the response SHAPE is not the thing under test.
 */
function stubbedFetchResult(alerts: Array<JSONObject>): FetchAlertsResult {
  return {
    alerts: alerts,
    complete: true,
    progress: 1,
    truncatedByCount: false,
    truncatedByBytes: false,
    baselineAlertsCount: alerts.length,
    filteredAlertsCount: alerts.length,
    chunkCount: 1,
  };
}

function makeStubClient(result: FetchAlertsResult): {
  client: GoogleSecOpsClient;
  windows: Array<RecordedWindow>;
} {
  const windows: Array<RecordedWindow> = [];

  const client: GoogleSecOpsClient = {
    fetchDetectionAlerts: (data: {
      startTime: Date;
      endTime: Date;
    }): Promise<FetchAlertsResult> => {
      windows.push({ startTime: data.startTime, endTime: data.endTime });
      return Promise.resolve(result);
    },
  } as unknown as GoogleSecOpsClient;

  return { client: client, windows: windows };
}

/*
 * A client that fails the way a normalizer fault does not: the alerts
 * never arrive at all.
 */
function makeThrowingStubClient(error: Error): GoogleSecOpsClient {
  return {
    fetchDetectionAlerts: (): Promise<FetchAlertsResult> => {
      return Promise.reject(error);
    },
  } as unknown as GoogleSecOpsClient;
}

function textOf(body: unknown): string {
  if (typeof body === "string") {
    return body;
  }

  if (body instanceof Error) {
    return body.message;
  }

  return String(body);
}

function captureLogs(): CapturedLogs {
  const logs: CapturedLogs = { info: [], warn: [], error: [], debug: [] };

  const levels: Array<"info" | "warn" | "error" | "debug"> = [
    "info",
    "warn",
    "error",
    "debug",
  ];

  for (const level of levels) {
    getJestSpyOn(logger, level).mockImplementation(((body: unknown): void => {
      logs[level].push(textOf(body));
      return undefined;
    }) as never);
  }

  return logs;
}

/*
 * Poller lines name the connection; the client's own warnings do not. That
 * is the seam these tests use to assert on what the POLLER said.
 */
function linesAboutConnection(lines: Array<string>): Array<string> {
  return lines.filter((line: string): boolean => {
    return line.includes(CONNECTION_ID.toString());
  });
}

/*
 * Every write the poll would perform, captured instead of performed.
 * Called per test rather than in a beforeEach so no two tests can share a
 * spy or the order they were installed in.
 */
function stubPollPath(): PollHarness {
  const updates: Array<ConnectionUpdateCall> = [];
  const insertedBatches: Array<Array<JSONObject>> = [];

  const telemetrySpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
    OTelIngestService,
    "telemetryServiceFromName",
  ).mockResolvedValue(makeServiceMetadata() as never);

  const insertSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
    SecurityEventService,
    "insertJsonRows",
  ).mockImplementation(((rows: Array<JSONObject>): Promise<void> => {
    insertedBatches.push(rows);
    return Promise.resolve();
  }) as never);

  getJestSpyOn(
    GoogleSecOpsConnectionService,
    "updateOneById",
  ).mockImplementation(((call: ConnectionUpdateCall): Promise<void> => {
    updates.push(call);
    return Promise.resolve();
  }) as never);

  /*
   * Enrichment reaches ClickHouse for its per-project indicator probe and
   * swallows its own failures, so leaving it live would make every test
   * here depend on a database being absent in exactly the right way.
   */
  const enricherSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
    ThreatIntelEnricher,
    "enrichNormalizedEvents",
  ).mockResolvedValue({ eventsMatched: 0, valuesLookedUp: 0 } as never);

  return {
    updates: updates,
    insertedBatches: insertedBatches,
    logs: captureLogs(),
    telemetrySpy: telemetrySpy,
    insertSpy: insertSpy,
    enricherSpy: enricherSpy,
  };
}

function onlyUpdate(harness: PollHarness): JSONObject {
  expect(harness.updates).toHaveLength(1);
  expect(harness.updates[0]!.id.toString()).toBe(CONNECTION_ID.toString());

  return harness.updates[0]!.data;
}

function rowsByEventUid(rows: Array<JSONObject>): Map<string, JSONObject> {
  const byUid: Map<string, JSONObject> = new Map<string, JSONObject>();

  for (const row of rows) {
    byUid.set(String(row["eventUid"]), row);
  }

  return byUid;
}

describe("GoogleSecOpsPoller over a real streaming response", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a chunk-array body becomes Detection Finding rows, deduped across chunks", async () => {
    const harness: PollHarness = stubPollPath();

    /*
     * Three chunks the way Chronicle streams them: alerts nested at
     * chunk.alerts.alerts[], a later chunk restating an earlier alert, and
     * a terminal chunk carrying only the completion flags.
     */
    const { client } = makeClient(
      streamingResponse([
        { progress: 0.25, alerts: { alerts: [alertOne()] } },
        { progress: 0.75, alerts: { alerts: [alertOne(), alertTwo()] } },
        {
          progress: 1,
          complete: true,
          baselineAlertsCount: 2,
          filteredAlertsCount: 2,
        },
      ]),
    );

    const ingested: number = await GoogleSecOpsPoller.pollConnection(
      makeConnection(),
      client,
    );

    // Two alerts, not three: the restated alert-1 is one alert, not two.
    expect(ingested).toBe(2);
    expect(harness.insertedBatches).toHaveLength(1);

    const rows: Array<JSONObject> = harness.insertedBatches[0]!;
    expect(rows).toHaveLength(2);

    const byUid: Map<string, JSONObject> = rowsByEventUid(rows);
    expect(Array.from(byUid.keys()).sort()).toEqual(["alert-1", "alert-2"]);

    const first: JSONObject = byUid.get("alert-1")!;
    expect(first["classUid"]).toBe(DETECTION_FINDING_CLASS_UID);
    expect(first["className"]).toBe("Detection Finding");
    expect(first["vendorName"]).toBe("Google");
    expect(first["productName"]).toBe("Google SecOps");
    expect(first["projectId"]).toBe(PROJECT_ID.toString());
    expect(first["ruleName"]).toBe("Suspicious PowerShell");
    expect(first["ruleId"]).toBe("ru_1a2b");
    expect(first["severityName"]).toBe("High");
    expect(first["severityId"]).toBe(4);
    expect(first["statusName"]).toBe("ALERTING");

    // The matched UDM sample event is what puts entities on the finding.
    expect(first["principalHost"]).toBe("workstation-14");
    expect(first["principalIp"]).toBe("10.1.2.3");
    expect(first["principalUser"]).toBe("jsmith");
    expect(first["targetIp"]).toBe("203.0.113.9");
    expect(first["observables"]).toEqual(
      expect.arrayContaining(["jsmith", "workstation-14", "10.1.2.3"]),
    );

    const second: JSONObject = byUid.get("alert-2")!;
    expect(second["ruleName"]).toBe("Impossible travel");
    expect(second["severityName"]).toBe("Critical");
    expect(second["classUid"]).toBe(DETECTION_FINDING_CLASS_UID);

    const written: JSONObject = onlyUpdate(harness);
    expect(Object.keys(written).sort()).toEqual([
      "cursor",
      "lastError",
      "lastPolledAt",
    ]);
    expect(written["lastError"]).toBeNull();
  });

  test("the cursor written is exactly the endTime the fetch was made with", async () => {
    const harness: PollHarness = stubPollPath();

    const { client, requests } = makeClient(
      streamingResponse([
        { alerts: { alerts: [alertOne()] } },
        { complete: true, progress: 1 },
      ]),
    );

    await GoogleSecOpsPoller.pollConnection(makeConnection(), client);

    const sent: { startTime: string; endTime: string } = windowSentTo(requests);

    // The parameter really is an ISO instant, not some other rendering.
    expect(new Date(sent.endTime).toISOString()).toBe(sent.endTime);

    const written: JSONObject = onlyUpdate(harness);
    expect(written["cursor"]).toBe(sent.endTime);
    expect((written["lastPolledAt"] as Date).toISOString()).toBe(sent.endTime);

    // ...and the window it closes really did start earlier than it ends.
    expect(new Date(sent.startTime).getTime()).toBeLessThan(
      new Date(sent.endTime).getTime(),
    );
  });

  test("a recognized response carrying no alerts advances the cursor and clears lastError", async () => {
    const harness: PollHarness = stubPollPath();

    // A quiet window: recognized chunk fields, zero alerts, complete.
    const { client, requests } = makeClient(
      streamingResponse([{ complete: true, progress: 1 }]),
    );

    const ingested: number = await GoogleSecOpsPoller.pollConnection(
      makeConnection(),
      client,
    );

    expect(ingested).toBe(0);
    expect(harness.telemetrySpy).not.toHaveBeenCalled();
    expect(harness.insertSpy).not.toHaveBeenCalled();

    const written: JSONObject = onlyUpdate(harness);
    expect(Object.keys(written).sort()).toEqual([
      "cursor",
      "lastError",
      "lastPolledAt",
    ]);
    expect(written["cursor"]).toBe(windowSentTo(requests).endTime);
    expect(written["lastError"]).toBeNull();

    /*
     * The count that separates this from the failure below has to be
     * readable somewhere; "quiet" and "broken" looked identical for as
     * long as it was not.
     */
    const quietWindowLine: RegExp = /fetched 0 alerts and ingested 0/;
    const counted: Array<string> = linesAboutConnection(
      harness.logs.debug,
    ).filter((line: string): boolean => {
      return quietWindowLine.test(line);
    });
    expect(counted).toHaveLength(1);
  });

  test("truncation flags surface as warnings without failing the poll", async () => {
    const harness: PollHarness = stubPollPath();

    /*
     * Chronicle capped the result server side. There is no pagination on
     * this endpoint, so the dropped alerts are gone — the poll still
     * succeeded, and the operator still has to be told.
     */
    const { client, requests } = makeClient(
      streamingResponse([
        {
          alerts: { alerts: [alertOne()] },
          tooManyAlerts: true,
          memoryLimitExceeded: true,
          complete: true,
          progress: 1,
        },
      ]),
    );

    const ingested: number = await GoogleSecOpsPoller.pollConnection(
      makeConnection(),
      client,
    );

    expect(ingested).toBe(1);
    expect(harness.insertedBatches).toHaveLength(1);
    expect(harness.insertedBatches[0]!).toHaveLength(1);

    const written: JSONObject = onlyUpdate(harness);
    expect(written["cursor"]).toBe(windowSentTo(requests).endTime);
    expect(written["lastError"]).toBeNull();

    const warnings: Array<string> = linesAboutConnection(harness.logs.warn);

    // Both truncations named, both against the window they happened in.
    const truncatedByCountLine: RegExp = /no pagination/i;
    const truncatedByBytesLine: RegExp = /memory limit/i;

    const byCount: Array<string> = warnings.filter((line: string): boolean => {
      return truncatedByCountLine.test(line);
    });
    const byBytes: Array<string> = warnings.filter((line: string): boolean => {
      return truncatedByBytesLine.test(line);
    });

    expect(byCount).toHaveLength(1);
    expect(byBytes).toHaveLength(1);
    expect(byCount[0]!).toContain(windowSentTo(requests).endTime);
    expect(byBytes[0]!).toContain(windowSentTo(requests).endTime);
  });
});

describe("GoogleSecOpsPoller cursor durability", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * THE PIN. This is the failure that has to stay impossible.
   *
   * A body the client cannot recognize must throw rather than report zero
   * alerts, and the throw must leave the cursor exactly where it was. If
   * either half regresses — the client returning [] for an unknown shape,
   * or the poller advancing on the way past a failure — a connector that
   * reads nothing at all becomes indistinguishable from a quiet one, and
   * every alert in every skipped window is lost permanently.
   */
  test("an unrecognized response body leaves the cursor untouched and records lastError", async () => {
    const harness: PollHarness = stubPollPath();

    const storedCursor: string = new Date(
      Date.now() - 10 * MINUTE_IN_MS,
    ).toISOString();

    const connection: GoogleSecOpsConnection = makeConnection();
    connection.cursor = storedCursor;

    // HTTP 200, valid JSON, and not this endpoint's response.
    const { client } = makeClient({ status: 200, body: '{"nope":true}' });

    getJestSpyOn(GoogleSecOpsConnectionService, "findBy").mockResolvedValue([
      connection,
    ] as never);

    getJestSpyOn(GoogleSecOpsPoller, "pollConnection").mockImplementation(((
      polled: GoogleSecOpsConnection,
    ): Promise<number> => {
      return originalPollConnection(polled, client);
    }) as never);

    await expect(
      GoogleSecOpsPoller.pollAllDueConnections(),
    ).resolves.toBeUndefined();

    expect(harness.insertSpy).not.toHaveBeenCalled();

    const written: JSONObject = onlyUpdate(harness);

    /*
     * No `cursor` key at all. Not "the same cursor" — the failure path
     * must not be in the business of writing the column.
     */
    expect(Object.keys(written).sort()).toEqual(["lastError", "lastPolledAt"]);
    expect(written["lastPolledAt"]).toBeInstanceOf(Date);
    expect(connection.cursor).toBe(storedCursor);

    const lastError: unknown = written["lastError"];
    expect(typeof lastError).toBe("string");
    // The body is echoed, so the operator can see what came back.
    expect(lastError as string).toContain('{"nope":true}');
  });

  test("a fetch that throws before any alert arrives leaves the cursor untouched", async () => {
    const harness: PollHarness = stubPollPath();

    const connection: GoogleSecOpsConnection = makeConnection();

    getJestSpyOn(GoogleSecOpsConnectionService, "findBy").mockResolvedValue([
      connection,
    ] as never);

    getJestSpyOn(GoogleSecOpsPoller, "pollConnection").mockImplementation(((
      polled: GoogleSecOpsConnection,
    ): Promise<number> => {
      return originalPollConnection(
        polled,
        makeThrowingStubClient(new Error("socket hang up")),
      );
    }) as never);

    await GoogleSecOpsPoller.pollAllDueConnections();

    const written: JSONObject = onlyUpdate(harness);
    expect(Object.keys(written).sort()).toEqual(["lastError", "lastPolledAt"]);
    expect(written["lastError"]).toContain("socket hang up");
  });

  test("alerts that all fail to normalize hold the cursor rather than skipping the window", async () => {
    const harness: PollHarness = stubPollPath();

    /*
     * The normalizer is tolerant by design, so a poison alert has to be
     * built out of a hostile getter: the alerts are real as far as
     * Chronicle is concerned and unstorable as far as we are concerned,
     * which is the case where re-fetching the window is the only way the
     * data is ever recovered.
     */
    const poison: JSONObject = {};
    Object.defineProperty(poison, "detection", {
      get: (): never => {
        throw new Error("poison alert");
      },
      enumerable: true,
    });

    const alsoPoison: JSONObject = {};
    Object.defineProperty(alsoPoison, "detection", {
      get: (): never => {
        throw new Error("poison alert");
      },
      enumerable: true,
    });

    const { client } = makeStubClient(stubbedFetchResult([poison, alsoPoison]));

    const ingested: number = await GoogleSecOpsPoller.pollConnection(
      makeConnection(),
      client,
    );

    expect(ingested).toBe(0);
    expect(harness.insertSpy).not.toHaveBeenCalled();

    const written: JSONObject = onlyUpdate(harness);
    expect(Object.keys(written).sort()).toEqual(["lastError", "lastPolledAt"]);

    const heldCursorLine: RegExp = /normalized none of its 2 fetched alerts/;
    const held: Array<string> = linesAboutConnection(harness.logs.warn).filter(
      (line: string): boolean => {
        return heldCursorLine.test(line);
      },
    );
    expect(held).toHaveLength(1);
  });

  /*
   * THE OTHER PIN. A FetchAlertsViewResponse chunk is not an alert.
   *
   * GoogleSecOpsAlertNormalizer.normalize is a total function whose class,
   * category, vendor and product are constants, so ANY object handed to it
   * comes back as a plausible Detection Finding: severity Unknown, no
   * entities, message "Google SecOps detection". Stored, it is
   * indistinguishable in the UI from a real low-signal detection. The gate
   * in front of the normalizer is the only thing between an envelope chunk
   * and a fabricated security finding.
   */
  test("a stream chunk that reaches the poller produces no row", async () => {
    const harness: PollHarness = stubPollPath();

    /*
     * What the gate stands in front of. Handed the chunk directly, the
     * normalizer answers with a fully formed Detection Finding — this is
     * the row the poll below must not write, and the reason "it produced
     * no row" is a real property rather than an accident of the fixture.
     */
    const wouldBeStored: NormalizedSecurityEvent =
      GoogleSecOpsAlertNormalizer.normalize(streamChunk());
    expect(wouldBeStored.classUid).toBe(DETECTION_FINDING_CLASS_UID);
    expect(wouldBeStored.className).toBe("Detection Finding");
    expect(wouldBeStored.severityName).toBe(OcsfSeverity.Unknown);
    expect(wouldBeStored.message).toBe("Google SecOps detection");
    expect(GoogleSecOpsAlertNormalizer.isGoogleSecOpsAlert(streamChunk())).toBe(
      false,
    );

    const { client } = makeStubClient(
      stubbedFetchResult([streamChunk(), alertOne()]),
    );

    const ingested: number = await GoogleSecOpsPoller.pollConnection(
      makeConnection(),
      client,
    );

    expect(ingested).toBe(1);
    expect(harness.insertedBatches).toHaveLength(1);

    const rows: Array<JSONObject> = harness.insertedBatches[0]!;
    expect(rows).toHaveLength(1);
    expect(rows[0]!["eventUid"]).toBe("alert-1");

    /*
     * The fabricated row's fingerprint, from the defect report: a
     * content-hash eventUid, severity Unknown and the fallback message.
     */
    for (const row of rows) {
      expect(row["message"]).not.toBe("Google SecOps detection");
      expect(String(row["eventUid"]).startsWith("sha256:")).toBe(false);
      expect(row["severityName"]).not.toBe("Unknown");
    }

    const discardedLine: RegExp = /discarded 1 of 2/;
    const discarded: Array<string> = linesAboutConnection(
      harness.logs.warn,
    ).filter((line: string): boolean => {
      return discardedLine.test(line);
    });
    expect(discarded).toHaveLength(1);

    /*
     * A refusal is deterministic: re-fetching the window would refuse the
     * same object again forever, so unlike a normalization failure it must
     * not hold the cursor.
     */
    const written: JSONObject = onlyUpdate(harness);
    expect(Object.keys(written).sort()).toEqual([
      "cursor",
      "lastError",
      "lastPolledAt",
    ]);
  });
});

describe("GoogleSecOpsPoller ingest bookkeeping", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the ingested count is returned and matches the rows written", async () => {
    const harness: PollHarness = stubPollPath();

    const { client } = makeStubClient(
      stubbedFetchResult([alertOne(), alertTwo(), streamChunk()]),
    );

    const ingested: number = await GoogleSecOpsPoller.pollConnection(
      makeConnection(),
      client,
    );

    expect(ingested).toBe(2);
    expect(harness.insertedBatches[0]!).toHaveLength(ingested);

    const countedLine: RegExp = /fetched 3 alerts and ingested 2/;
    const counted: Array<string> = linesAboutConnection(
      harness.logs.debug,
    ).filter((line: string): boolean => {
      return countedLine.test(line);
    });
    expect(counted).toHaveLength(1);
  });

  test("a multi-alert batch is written in a single insert", async () => {
    const harness: PollHarness = stubPollPath();

    const { client } = makeStubClient(
      stubbedFetchResult([alertOne(), alertTwo()]),
    );

    await GoogleSecOpsPoller.pollConnection(makeConnection(), client);

    expect(harness.insertSpy).toHaveBeenCalledTimes(1);
    expect(harness.insertedBatches).toHaveLength(1);
    expect(harness.insertedBatches[0]!).toHaveLength(2);
  });

  test("threat intel is stamped on polled alerts before the rows are built", async () => {
    const harness: PollHarness = stubPollPath();

    const enrichCalls: Array<{
      projectId: ObjectID;
      events: Array<NormalizedSecurityEvent>;
    }> = [];

    /*
     * Replacing the implementation on the spy that is already installed,
     * rather than spying again — a second spy over the first would restore
     * to the first mock instead of the real method.
     */
    harness.enricherSpy.mockImplementation(((data: {
      projectId: ObjectID;
      events: Array<NormalizedSecurityEvent>;
    }): Promise<EnrichmentResult> => {
      enrichCalls.push(data);

      for (const event of data.events) {
        event.attributes["threat.matched"] = "true";
      }

      return Promise.resolve({
        eventsMatched: data.events.length,
        valuesLookedUp: 1,
      });
    }) as never);

    const { client } = makeStubClient(stubbedFetchResult([alertOne()]));

    await GoogleSecOpsPoller.pollConnection(makeConnection(), client);

    expect(enrichCalls).toHaveLength(1);
    expect(enrichCalls[0]!.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(enrichCalls[0]!.events).toHaveLength(1);
    expect(enrichCalls[0]!.events[0]!.classUid).toBe(
      DETECTION_FINDING_CLASS_UID,
    );

    /*
     * The stamp survives into the row, which is only true if enrichment
     * runs ahead of buildSecurityEventDbRow — the same seam HTTP ingest
     * uses, and the reason a stamped key is filterable at all.
     */
    const row: JSONObject = harness.insertedBatches[0]![0]!;
    const attributes: JSONObject = row["attributes"] as JSONObject;
    expect(attributes["threat.matched"]).toBe("true");
    expect(row["attributeKeys"] as Array<string>).toContain("threat.matched");
  });
});

describe("GoogleSecOpsPoller poll window arithmetic", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * Runs one poll and hands back the window it asked Chronicle for. The
   * caller installs the stubs once; this only reads.
   */
  async function pollWindow(
    cursor: string | undefined,
  ): Promise<RecordedWindow> {
    const connection: GoogleSecOpsConnection = makeConnection();

    if (cursor !== undefined) {
      connection.cursor = cursor;
    }

    const { client, windows } = makeStubClient(stubbedFetchResult([]));

    await GoogleSecOpsPoller.pollConnection(connection, client);

    expect(windows).toHaveLength(1);

    return windows[0]!;
  }

  function durationInMs(window: RecordedWindow): number {
    return window.endTime.getTime() - window.startTime.getTime();
  }

  test("an unreadable cursor polls the default window, not the 24 hour maximum", async () => {
    stubPollPath();

    /*
     * Derived rather than pasted: a first poll IS the default window and a
     * week-old cursor IS the maximum, so the two bounds move with the
     * constants instead of going stale against them.
     */
    const firstPoll: RecordedWindow = await pollWindow(undefined);
    const stale: RecordedWindow = await pollWindow(
      new Date(Date.now() - 7 * DAY_IN_MS).toISOString(),
    );
    const garbage: RecordedWindow = await pollWindow("garbage");

    expect(durationInMs(firstPoll)).toBe(15 * MINUTE_IN_MS);
    expect(durationInMs(stale)).toBe(DAY_IN_MS);

    /*
     * An unreadable cursor means "no usable cursor", which is what a first
     * poll means. It used to share a branch with a stale cursor and open
     * the full 24 hours — the widest blast radius for the least
     * trustworthy input, re-ingesting a day as duplicates.
     */
    expect(durationInMs(garbage)).toBe(durationInMs(firstPoll));
    expect(durationInMs(garbage)).not.toBe(durationInMs(stale));
  });

  test("an unreadable cursor is reported, quoting the value that could not be read", async () => {
    const harness: PollHarness = stubPollPath();

    await pollWindow("2026-13-45T99:99:99Z");

    const warnings: Array<string> = linesAboutConnection(
      harness.logs.warn,
    ).filter((line: string): boolean => {
      return line.includes(JSON.stringify("2026-13-45T99:99:99Z"));
    });

    expect(warnings).toHaveLength(1);
  });

  test("a cursor in the future never produces an inverted time range", async () => {
    const harness: PollHarness = stubPollPath();

    const firstPoll: RecordedWindow = await pollWindow(undefined);

    // Clock skew on the writer, or a restored backup.
    const future: RecordedWindow = await pollWindow(
      new Date(Date.now() + HOUR_IN_MS).toISOString(),
    );

    expect(future.startTime.getTime()).toBeLessThan(future.endTime.getTime());
    expect(durationInMs(future)).toBe(durationInMs(firstPoll));

    expect(linesAboutConnection(harness.logs.warn).length).toBeGreaterThan(0);
  });

  test("a stale cursor is truncated to the cap and the skipped gap is stated", async () => {
    const harness: PollHarness = stubPollPath();

    const stale: RecordedWindow = await pollWindow(
      new Date(Date.now() - 7 * DAY_IN_MS).toISOString(),
    );

    expect(durationInMs(stale)).toBe(DAY_IN_MS);

    /*
     * The alerts between the cursor and the cap are skipped and will never
     * be fetched again. Truncating silently is how a connector comes back
     * from an outage looking healthy with a day of detections missing, so
     * the warning has to name the boundary the poll actually resumed from.
     */
    const warnings: Array<string> = linesAboutConnection(
      harness.logs.warn,
    ).filter((line: string): boolean => {
      return line.includes(stale.startTime.toISOString());
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]!).toMatch(/skipped/i);
  });
});

describe("GoogleSecOpsPoller.pollAllDueConnections scheduling", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeDueConnection(id: string): GoogleSecOpsConnection {
    const connection: GoogleSecOpsConnection = makeConnection();
    connection._id = id;
    return connection;
  }

  function polledIds(spy: ReturnType<typeof getJestSpyOn>): Array<string> {
    return spy.mock.calls.map((call: Array<unknown>): string => {
      return String((call[0] as GoogleSecOpsConnection)._id);
    });
  }

  test("an unusable pollIntervalInMinutes is clamped rather than making a connection always due", async () => {
    stubPollPath();

    const justPolledAt: Date = new Date(Date.now() - 30 * 1000);

    /*
     * Thirty seconds is the discriminating gap: every clamped interval is
     * at least a minute, so all three of these are still inside their
     * window. Unclamped, 0 makes the connection due the instant it was
     * polled and a negative interval puts its next poll ten minutes in the
     * past — both would hammer Chronicle every tick.
     */
    const zero: GoogleSecOpsConnection = makeDueConnection(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    );
    zero.pollIntervalInMinutes = 0;
    zero.lastPolledAt = justPolledAt;

    const negative: GoogleSecOpsConnection = makeDueConnection(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    );
    negative.pollIntervalInMinutes = -10;
    negative.lastPolledAt = justPolledAt;

    const missing: GoogleSecOpsConnection = makeDueConnection(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    );
    delete missing.pollIntervalInMinutes;
    missing.lastPolledAt = justPolledAt;

    // The controls: one genuinely overdue, one never polled.
    const overdue: GoogleSecOpsConnection = makeDueConnection(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
    );
    overdue.pollIntervalInMinutes = 5;
    overdue.lastPolledAt = new Date(Date.now() - 10 * MINUTE_IN_MS);

    const neverPolled: GoogleSecOpsConnection = makeDueConnection(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
    );
    delete neverPolled.pollIntervalInMinutes;

    getJestSpyOn(GoogleSecOpsConnectionService, "findBy").mockResolvedValue([
      zero,
      negative,
      missing,
      overdue,
      neverPolled,
    ] as never);

    const pollSpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      GoogleSecOpsPoller,
      "pollConnection",
    ).mockResolvedValue(0 as never);

    await GoogleSecOpsPoller.pollAllDueConnections();

    expect(polledIds(pollSpy)).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
    ]);
  });

  test("the ingested count of every polled connection is logged, not dropped", async () => {
    const harness: PollHarness = stubPollPath();

    getJestSpyOn(GoogleSecOpsConnectionService, "findBy").mockResolvedValue([
      makeConnection(),
    ] as never);

    getJestSpyOn(GoogleSecOpsPoller, "pollConnection").mockResolvedValue(
      7 as never,
    );

    await GoogleSecOpsPoller.pollAllDueConnections();

    /*
     * The one number that distinguishes "polling healthy but quiet" from
     * "polling silently broken". pollConnection returned it and the caller
     * used to throw it away.
     */
    const reported: Array<number> = linesAboutConnection(harness.logs.info)
      .map((line: string): number => {
        const match: RegExpMatchArray | null = line.match(/ingested (\d+)/);
        return match ? Number(match[1]) : -1;
      })
      .filter((count: number): boolean => {
        return count >= 0;
      });

    expect(reported).toEqual([7]);
  });

  test("only enabled connections are loaded, with every field the poll needs", async () => {
    stubPollPath();

    const findBySpy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      GoogleSecOpsConnectionService,
      "findBy",
    ).mockResolvedValue([] as never);

    await GoogleSecOpsPoller.pollAllDueConnections();

    expect(findBySpy).toHaveBeenCalledTimes(1);

    const args: JSONObject = findBySpy.mock.calls[0]![0] as JSONObject;

    expect(args["query"]).toEqual({ isEnabled: true });
    expect(args["skip"]).toBe(0);
    expect(args["limit"]).toBe(LIMIT_MAX);
    expect(args["props"]).toEqual({ isRoot: true });

    /*
     * Every column pollConnection reads. A field dropped here fails the
     * connection's own guard at poll time, which reads as a broken
     * credential rather than a missing select.
     */
    const select: JSONObject = args["select"] as JSONObject;

    for (const field of [
      "_id",
      "projectId",
      "region",
      "instanceResourceName",
      "serviceAccountJson",
      "pollIntervalInMinutes",
      "lastPolledAt",
      "cursor",
    ]) {
      expect(select[field]).toBe(true);
    }
  });
});
