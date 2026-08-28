import { generateKeyPairSync } from "crypto";
import GoogleSecOpsConnection from "../../../../Models/DatabaseModels/GoogleSecOpsConnection";
import GoogleSecOpsConnectionService from "../../../../Server/Services/GoogleSecOpsConnectionService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../../Server/Services/SecurityEventService";
import logger from "../../../../Server/Utils/Logger";
import { MAX_CONNECTOR_ERROR_MESSAGE_LENGTH } from "../../../../Server/Utils/SecurityEvent/ConnectorErrorMessage";
import GoogleSecOpsClient, {
  FetchLike,
  FetchResponseLike,
} from "../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsClient";
import GoogleSecOpsPoller from "../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsPoller";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What `Last Error` on a Google SecOps connection actually means.
 *
 * The connections page and the integration doc both used to tell operators
 * that Last Error "carries verbatim whatever the Chronicle API returned"
 * and that a populated value means "the poll ran and Chronicle rejected
 * it". Neither was true. pollAllDueConnections has exactly one catch block,
 * and everything the poll can throw funnels through it: the OAuth token
 * exchange against the service account's own token_uri (which happens
 * before Chronicle is contacted at all), Chronicle's own rejection, the
 * client's non-JSON-body guard, pollConnection's missing-field guard, and
 * a telemetry-store write that fails AFTER a completely successful
 * Chronicle fetch. Told "Chronicle rejected it", an operator staring at a
 * ClickHouse outage would open a ticket with Google support.
 *
 * Both texts have been rewritten around a three-way split keyed on the
 * message prefix:
 *
 *   1. `Google token exchange failed (HTTP ...)` — the credential was
 *      rejected at Google's OAuth endpoint, before Chronicle.
 *   2. `Google SecOps alerts fetch failed (HTTP ...)` — Chronicle itself
 *      rejected the request.
 *   3. anything else — the alerts came back and the failure was on
 *      OneUptime's side.
 *
 * This file pins that split so it stays true. Every case is driven through
 * pollAllDueConnections with the REAL GoogleSecOpsClient over an injected
 * transport, so the asserted string is the one an operator would read off
 * the row rather than one this test invented. The two Google prefixes are
 * likewise derived — the client is driven to failure with an empty body,
 * which makes the message it throws be precisely its own prefix — so
 * editing the template in GoogleSecOpsClient moves the expectation with it
 * instead of silently invalidating a pasted literal.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const INSTANCE_RESOURCE_NAME: string =
  "projects/my-project/locations/us/instances/3f0a-instance";

/*
 * Google's real OAuth endpoint, and the point of taxonomy bucket 1: this
 * host is not Chronicle, and a failure here happens before a single byte
 * is sent to Chronicle.
 */
const GOOGLE_TOKEN_URI: string = "https://oauth2.googleapis.com/token";

/*
 * A real RS256 key, because the client genuinely signs a JWT assertion on
 * the way to the token endpoint; a fake key would fail inside jwt.sign and
 * produce a completely different error than the one under test.
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

/*
 * The statuses used both to DERIVE each prefix and to provoke each
 * failure, so the derived prefix and the produced message agree on the
 * HTTP status embedded in them.
 */
const TOKEN_EXCHANGE_FAILURE_STATUS: number = 401;
const ALERTS_FETCH_FAILURE_STATUS: number = 403;

/*
 * The bucket-3 failure the review surfaced: a telemetry-store write that
 * blows up after Chronicle already answered. Shaped like a real ClickHouse
 * error, which echoes the statement back.
 */
const CLICKHOUSE_OUTAGE_MESSAGE: string =
  "Code: 210. DB::NetException: Connection refused (clickhouse:9000). " +
  "(NETWORK_ERROR) (version 24.3.1.1) while executing INSERT INTO " +
  "oneuptime.SecurityEvent (projectId, time, classUid, ruleName) FORMAT JSONEachRow";

interface StubbedResponse {
  status: number;
  body: string;
}

interface RecordedRequest {
  url: string;
  method: string;
}

// The shape of one updateOneById call, for readable assertions.
interface ConnectionUpdateCall {
  id: ObjectID;
  data: JSONObject;
}

interface PollRun {
  client: GoogleSecOpsClient;
  requests: Array<RecordedRequest>;
  updates: Array<ConnectionUpdateCall>;
  insertedBatches: Array<Array<JSONObject>>;
}

/*
 * Captured at import time, before any spy replaces it. pollAllDueConnections
 * calls `this.pollConnection(connection)` with no client override, so the
 * only way to put an injected transport under a full end-to-end tick is to
 * spy on pollConnection and delegate straight back to the real, decorated
 * implementation with a client attached. Everything inside pollConnection —
 * the guard, the window arithmetic, the normalizer, the insert, the
 * bookkeeping write — still runs for real.
 */
const originalPollConnection: (
  connection: GoogleSecOpsConnection,
  clientOverride?: GoogleSecOpsClient | undefined,
) => Promise<number> =
  GoogleSecOpsPoller.pollConnection.bind(GoogleSecOpsPoller);

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

function okTokenResponse(): StubbedResponse {
  return {
    status: 200,
    body: JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
  };
}

/*
 * One alert that the normalizer turns into a Detection Finding row, so the
 * telemetry-store path is genuinely reached with something to write.
 */
function alertsResponseWithOneAlert(): StubbedResponse {
  return {
    status: 200,
    body: JSON.stringify({
      alerts: [
        {
          id: "alert-1",
          detection: [{ ruleName: "Brute force", severity: "HIGH" }],
        },
      ],
    }),
  };
}

/*
 * Transport routed by URL rather than by call order, so a test can assert
 * which Google endpoint was actually reached — the difference between
 * taxonomy bucket 1 and bucket 2.
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

function makeClient(responses: {
  token: StubbedResponse;
  alerts: StubbedResponse;
}): { client: GoogleSecOpsClient; requests: Array<RecordedRequest> } {
  const { fetchImplementation, requests } = makeFetch(responses);

  const client: GoogleSecOpsClient = new GoogleSecOpsClient({
    region: "us",
    instanceResourceName: INSTANCE_RESOURCE_NAME,
    serviceAccountJson: SERVICE_ACCOUNT_JSON,
    fetchImplementation: fetchImplementation,
  });

  return { client: client, requests: requests };
}

/*
 * Drive the real client to failure and hand back the message it threw.
 * This is the derivation primitive: whatever GoogleSecOpsClient's error
 * templates say today, that is what these tests assert against.
 */
async function messageThrownByClient(responses: {
  token: StubbedResponse;
  alerts: StubbedResponse;
}): Promise<string> {
  const { client } = makeClient(responses);

  try {
    await client.fetchDetectionAlerts({
      startTime: new Date("2026-08-21T09:00:00.000Z"),
      endTime: new Date("2026-08-21T10:00:00.000Z"),
    });
  } catch (error) {
    return (error as Error).message;
  }

  throw new Error(
    "GoogleSecOpsClient was expected to throw for this response fixture.",
  );
}

/*
 * The prefixes, derived rather than pasted.
 *
 * Both client templates are `<prefix>${responseText.slice(0, 500)}`, so
 * driving the failure with an EMPTY response body makes the thrown message
 * be exactly the prefix — trailing ": " and embedded HTTP status included.
 */
let tokenExchangePrefix: string = "";
let alertsFetchPrefix: string = "";

/*
 * The status-free half of each prefix ("Google token exchange failed",
 * "Google SecOps alerts fetch failed"), split off structurally at the
 * " (HTTP" the client itself inserts. This is what the rewritten guidance
 * asks operators to read, and what the cross-check classifies on.
 */
let tokenExchangeFamily: string = "";
let alertsFetchFamily: string = "";

// The client's own non-JSON guard message, likewise taken from the client.
let nonJsonBodyMessage: string = "";

// pollConnection's missing-field guard message, taken from the poller.
let missingFieldMessage: string = "";

function familyOf(prefix: string): string {
  const httpMarkerIndex: number = prefix.indexOf(" (HTTP");

  if (httpMarkerIndex === -1) {
    return prefix.trim();
  }

  return prefix.slice(0, httpMarkerIndex);
}

/*
 * The single rule the rewritten docs and the in-product help both hang on:
 * does this message open with a prefix naming a Google request?
 */
function carriesGoogleRequestPrefix(message: string): boolean {
  return (
    message.startsWith(tokenExchangeFamily) ||
    message.startsWith(alertsFetchFamily)
  );
}

beforeAll(async () => {
  tokenExchangePrefix = await messageThrownByClient({
    token: { status: TOKEN_EXCHANGE_FAILURE_STATUS, body: "" },
    alerts: okTokenResponse(),
  });

  alertsFetchPrefix = await messageThrownByClient({
    token: okTokenResponse(),
    alerts: { status: ALERTS_FETCH_FAILURE_STATUS, body: "" },
  });

  nonJsonBodyMessage = await messageThrownByClient({
    token: okTokenResponse(),
    alerts: { status: 200, body: "<html><body>502 Bad Gateway</body></html>" },
  });

  tokenExchangeFamily = familyOf(tokenExchangePrefix);
  alertsFetchFamily = familyOf(alertsFetchPrefix);

  /*
   * Derived by calling the real pollConnection with an incomplete row. The
   * guard fires before any client is constructed, so no transport and no
   * service stubs are involved.
   */
  const incomplete: GoogleSecOpsConnection = makeConnection();
  delete incomplete.region;

  let guardThrew: boolean = false;

  try {
    await originalPollConnection(incomplete, undefined);
  } catch (error) {
    guardThrew = true;
    missingFieldMessage = (error as Error).message;
  }

  if (!guardThrew) {
    throw new Error(
      "pollConnection was expected to reject an incomplete connection.",
    );
  }
});

/*
 * One full tick: findBy returns exactly this connection, the poll runs the
 * real pollConnection against the injected transport, and every write is
 * captured instead of performed.
 */
async function runPollTick(options: {
  connection: GoogleSecOpsConnection;
  responses: { token: StubbedResponse; alerts: StubbedResponse };
  insertJsonRows?: ((rows: Array<JSONObject>) => Promise<void>) | undefined;
}): Promise<PollRun> {
  const updates: Array<ConnectionUpdateCall> = [];
  const insertedBatches: Array<Array<JSONObject>> = [];

  getJestSpyOn(GoogleSecOpsConnectionService, "findBy").mockResolvedValue([
    options.connection,
  ] as never);

  getJestSpyOn(
    GoogleSecOpsConnectionService,
    "updateOneById",
  ).mockImplementation(((call: ConnectionUpdateCall): Promise<void> => {
    updates.push(call);
    return Promise.resolve();
  }) as never);

  getJestSpyOn(OTelIngestService, "telemetryServiceFromName").mockResolvedValue(
    makeServiceMetadata() as never,
  );

  getJestSpyOn(SecurityEventService, "insertJsonRows").mockImplementation(((
    rows: Array<JSONObject>,
  ): Promise<void> => {
    insertedBatches.push(rows);

    if (options.insertJsonRows) {
      return options.insertJsonRows(rows);
    }

    return Promise.resolve();
  }) as never);

  const { client, requests } = makeClient(options.responses);

  getJestSpyOn(GoogleSecOpsPoller, "pollConnection").mockImplementation(((
    connection: GoogleSecOpsConnection,
  ): Promise<number> => {
    return originalPollConnection(connection, client);
  }) as never);

  await GoogleSecOpsPoller.pollAllDueConnections();

  return {
    client: client,
    requests: requests,
    updates: updates,
    insertedBatches: insertedBatches,
  };
}

/*
 * The one value an operator reads off the row. Every case asserts that a
 * single bookkeeping write happened and that it stamped lastPolledAt —
 * a failure with no stamp is the silent-connector outage all over again.
 */
function recordedLastError(run: PollRun): string {
  expect(run.updates).toHaveLength(1);
  expect(run.updates[0]!.id.toString()).toBe(CONNECTION_ID.toString());
  expect(run.updates[0]!.data["lastPolledAt"]).toBeInstanceOf(Date);

  const lastError: unknown = run.updates[0]!.data["lastError"];
  expect(typeof lastError).toBe("string");

  // Whatever it says, it must still fit the column the clamp exists for.
  expect((lastError as string).length).toBeLessThanOrEqual(
    MAX_CONNECTOR_ERROR_MESSAGE_LENGTH,
  );

  return lastError as string;
}

async function tokenExchangeFailureRun(): Promise<PollRun> {
  return runPollTick({
    connection: makeConnection(),
    responses: {
      token: {
        status: TOKEN_EXCHANGE_FAILURE_STATUS,
        body: JSON.stringify({
          error: "invalid_grant",
          error_description: "Invalid JWT Signature.",
        }),
      },
      alerts: alertsResponseWithOneAlert(),
    },
  });
}

async function alertsFetchFailureRun(): Promise<PollRun> {
  return runPollTick({
    connection: makeConnection(),
    responses: {
      token: okTokenResponse(),
      alerts: {
        status: ALERTS_FETCH_FAILURE_STATUS,
        body: JSON.stringify({
          error: {
            code: ALERTS_FETCH_FAILURE_STATUS,
            status: "PERMISSION_DENIED",
            message:
              "Caller does not have permission 'chronicle.legacies.legacyFetchAlertsView'.",
          },
        }),
      },
    },
  });
}

async function telemetryStoreFailureRun(): Promise<PollRun> {
  return runPollTick({
    connection: makeConnection(),
    responses: {
      token: okTokenResponse(),
      alerts: alertsResponseWithOneAlert(),
    },
    insertJsonRows: (): Promise<void> => {
      return Promise.reject(new Error(CLICKHOUSE_OUTAGE_MESSAGE));
    },
  });
}

async function nonJsonBodyRun(): Promise<PollRun> {
  return runPollTick({
    connection: makeConnection(),
    responses: {
      token: okTokenResponse(),
      alerts: {
        status: 200,
        body: "<html><body>502 Bad Gateway</body></html>",
      },
    },
  });
}

async function missingFieldRun(): Promise<PollRun> {
  const incomplete: GoogleSecOpsConnection = makeConnection();
  delete incomplete.region;

  return runPollTick({
    connection: incomplete,
    responses: {
      token: okTokenResponse(),
      alerts: alertsResponseWithOneAlert(),
    },
  });
}

describe("GoogleSecOpsPoller lastError failure taxonomy", () => {
  beforeEach(() => {
    // Every test here drives an expected failure down the logging path.
    getJestSpyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the derived prefixes really are prefixes, and really do differ", () => {
    /*
     * Guards the derivation itself. If GoogleSecOpsClient ever stops
     * putting a distinguishable, status-bearing prefix in front of the
     * echoed body, the whole taxonomy the guidance promises collapses and
     * this is where it shows up first.
     */
    expect(tokenExchangePrefix.length).toBeGreaterThan(0);
    expect(alertsFetchPrefix.length).toBeGreaterThan(0);
    expect(tokenExchangePrefix).not.toBe(alertsFetchPrefix);

    // The statuses used to provoke each failure are inside each prefix.
    expect(tokenExchangePrefix).toContain(
      String(TOKEN_EXCHANGE_FAILURE_STATUS),
    );
    expect(alertsFetchPrefix).toContain(String(ALERTS_FETCH_FAILURE_STATUS));

    /*
     * Neither family is a prefix of the other, so "read the prefix first"
     * is an unambiguous instruction rather than a coin flip.
     */
    expect(tokenExchangeFamily.startsWith(alertsFetchFamily)).toBe(false);
    expect(alertsFetchFamily.startsWith(tokenExchangeFamily)).toBe(false);
  });

  /*
   * Bucket 1. The credential is rejected at oauth2.googleapis.com — the
   * token_uri out of the customer's own service-account JSON — before a
   * single request is made to Chronicle. This is exactly why the rewritten
   * guidance tells operators to read the prefix first: the old text sent
   * whoever saw this to Chronicle's permissions, when the key itself is
   * what Google refused.
   */
  test("a token-exchange failure is recorded under the token-exchange prefix, before Chronicle is contacted", async () => {
    const run: PollRun = await tokenExchangeFailureRun();
    const lastError: string = recordedLastError(run);

    expect(lastError.startsWith(tokenExchangePrefix)).toBe(true);
    expect(lastError.startsWith(alertsFetchPrefix)).toBe(false);

    // The echoed OAuth body rides along behind the prefix.
    expect(lastError).toContain("invalid_grant");

    /*
     * The load-bearing half: only Google's OAuth host was called. Nothing
     * went to the Chronicle base URL, so "Chronicle rejected it" would
     * have been a flatly false thing to tell this operator.
     */
    expect(run.requests).toHaveLength(1);
    expect(run.requests[0]!.url).toBe(GOOGLE_TOKEN_URI);
    expect(
      run.requests.some((request: RecordedRequest): boolean => {
        return request.url.startsWith(run.client.getApiBaseUrl());
      }),
    ).toBe(false);

    // Nothing was ingested, so the cursor must not have moved.
    expect(run.insertedBatches).toHaveLength(0);
    expect(
      Object.prototype.hasOwnProperty.call(run.updates[0]!.data, "cursor"),
    ).toBe(false);
  });

  /*
   * Bucket 2: the only case the old text described correctly. The token
   * exchange succeeded, the request reached Chronicle, and Chronicle said
   * no.
   */
  test("an alerts-fetch failure is recorded under the alerts-fetch prefix", async () => {
    const run: PollRun = await alertsFetchFailureRun();
    const lastError: string = recordedLastError(run);

    expect(lastError.startsWith(alertsFetchPrefix)).toBe(true);
    expect(lastError.startsWith(tokenExchangePrefix)).toBe(false);
    expect(lastError).toContain("PERMISSION_DENIED");

    // Token endpoint first, then Chronicle: the failure is genuinely theirs.
    expect(run.requests).toHaveLength(2);
    expect(run.requests[0]!.url).toBe(GOOGLE_TOKEN_URI);
    expect(run.requests[1]!.url.startsWith(run.client.getApiBaseUrl())).toBe(
      true,
    );

    expect(run.insertedBatches).toHaveLength(0);
    expect(
      Object.prototype.hasOwnProperty.call(run.updates[0]!.data, "cursor"),
    ).toBe(false);
  });

  /*
   * Bucket 3, and the reason the guidance was rewritten at all.
   *
   * Chronicle answered perfectly: the token was issued, the alerts came
   * back, the normalizer produced a row. The poll then died writing that
   * row to the telemetry store — a OneUptime-side outage that lands in
   * lastError through the same catch block as everything above. An
   * operator told "the poll ran and Chronicle rejected it" would take a
   * ClickHouse outage to Google support.
   */
  test("a telemetry-store failure is recorded with NO Google prefix, and does not advance the cursor", async () => {
    const run: PollRun = await telemetryStoreFailureRun();
    const lastError: string = recordedLastError(run);

    // The alerts really did arrive — both Google calls succeeded...
    expect(run.requests).toHaveLength(2);
    expect(run.requests[0]!.url).toBe(GOOGLE_TOKEN_URI);
    expect(run.requests[1]!.url.startsWith(run.client.getApiBaseUrl())).toBe(
      true,
    );

    // ...and a row was built and handed to the store before it blew up.
    expect(run.insertedBatches).toHaveLength(1);
    expect(run.insertedBatches[0]).toHaveLength(1);
    expect(run.insertedBatches[0]![0]!["className"]).toBe("Detection Finding");

    // The third bullet's promise, stated exactly.
    expect(carriesGoogleRequestPrefix(lastError)).toBe(false);
    expect(lastError).toContain("clickhouse");
    expect(lastError).toBe(CLICKHOUSE_OUTAGE_MESSAGE);

    /*
     * And the durability half. pollConnection writes lastPolledAt, cursor
     * and a cleared lastError together at the very end, so a throw from
     * insertJsonRows skips all three; the catch block's bookkeeping write
     * carries lastPolledAt and lastError only. The cursor therefore stays
     * where it was and the same window is re-fetched next tick, which is
     * the correct outcome for alerts that were never durably ingested.
     */
    expect(
      Object.prototype.hasOwnProperty.call(run.updates[0]!.data, "cursor"),
    ).toBe(false);
    expect(Object.keys(run.updates[0]!.data).sort()).toEqual([
      "lastError",
      "lastPolledAt",
    ]);
  });

  /*
   * The client's own non-JSON guard. Chronicle returned a 2xx with an HTML
   * error page in it — a proxy or gateway between the poller and Chronicle
   * is the usual cause — so there is no HTTP status to prefix with and the
   * message carries neither Google request prefix.
   */
  test("a non-JSON alerts body reaches lastError with no HTTP-status prefix", async () => {
    const run: PollRun = await nonJsonBodyRun();
    const lastError: string = recordedLastError(run);

    // Byte-for-byte the client's own guard message, derived from it above.
    expect(lastError).toBe(nonJsonBodyMessage);

    // No status-bearing prefix, because there was no failing status.
    expect(lastError.startsWith(tokenExchangePrefix)).toBe(false);
    expect(lastError.startsWith(alertsFetchPrefix)).toBe(false);
    expect(lastError).not.toContain("(HTTP");

    // The request did reach Chronicle; the body it returned was unusable.
    expect(run.requests).toHaveLength(2);
    expect(run.insertedBatches).toHaveLength(0);
  });

  /*
   * pollConnection's own precondition. A connection row missing region (or
   * projectId, or credentials) never reaches Google at all, and its
   * message is written by the poller rather than by any API — so it is a
   * OneUptime-side message by construction.
   */
  test("the missing-field guard is recorded through the same path when a row is incomplete", async () => {
    const run: PollRun = await missingFieldRun();
    const lastError: string = recordedLastError(run);

    // Exactly the guard's own text, derived from the poller in beforeAll.
    expect(lastError).toBe(missingFieldMessage);
    expect(carriesGoogleRequestPrefix(lastError)).toBe(false);

    /*
     * The trap in this one. The guard's own wording opens with the words
     * "Google SecOps", so an operator skimming for "does this start with
     * something about Google" can misfile it as a Chronicle problem — it
     * is not, and no request ever left the process. Only the full request
     * prefixes classify correctly, which is why the guidance names them in
     * full rather than saying "a Google-looking message".
     */
    expect(lastError.startsWith("Google")).toBe(true);
    expect(lastError.startsWith(alertsFetchFamily)).toBe(false);
    expect(lastError.startsWith(tokenExchangeFamily)).toBe(false);

    // Not one request left the process.
    expect(run.requests).toHaveLength(0);
    expect(run.insertedBatches).toHaveLength(0);
  });

  /*
   * The cross-check that turns the docs' three-way split from an assertion
   * into a verified property: run every failure the catch block can see,
   * collect what each one actually stored, and check the classification in
   * one place.
   *
   * Note the non-JSON-body row. It originates at Chronicle, yet it carries
   * no Google request prefix, so the guidance's rule files it under
   * "anything else" alongside the genuinely OneUptime-side failures. It is
   * still distinguishable — it names the alerts fetch and carries no HTTP
   * status — but it is the one case where "anything else means the alerts
   * came back fine" over-reaches, and it is pinned here so that stays
   * visible rather than being discovered by an operator.
   */
  test("exactly the HTTP failures at Google carry a Google prefix; the OneUptime-side ones do not", async () => {
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
        label: "telemetry store rejected the write after a good fetch",
        lastError: recordedLastError(await telemetryStoreFailureRun()),
        expectedGooglePrefix: false,
      },
      {
        label: "connection row missing required fields",
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
          expectedGooglePrefix: boolean;
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
          lastError: string;
          expectedGooglePrefix: boolean;
        }): { label: string; carriesGooglePrefix: boolean } => {
          return {
            label: item.label,
            carriesGooglePrefix: item.expectedGooglePrefix,
          };
        },
      ),
    );

    /*
     * And the messages are all distinct, so the taxonomy is actually
     * partitioning five different failures rather than collapsing some of
     * them into one indistinguishable string.
     */
    const distinct: Set<string> = new Set(
      cases.map((item: { lastError: string }): string => {
        return item.lastError;
      }),
    );
    expect(distinct.size).toBe(cases.length);
  });
});
