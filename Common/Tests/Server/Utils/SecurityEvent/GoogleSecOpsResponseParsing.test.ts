import { generateKeyPairSync } from "crypto";
import logger from "../../../../Server/Utils/Logger";
import GoogleSecOpsClient, {
  FetchAlertsResult,
  FetchInitLike,
  FetchLike,
  FetchResponseLike,
} from "../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsClient";
import APIException from "../../../../Types/Exception/ApiException";
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
 * legacyFetchAlertsView is a server-STREAMING method: its 200 body is a
 * JSON array of FetchAlertsViewResponse chunks and the alerts sit two
 * levels down at chunk.alerts.alerts[]. Google's REST reference documents
 * the streamed message and never the stream envelope, so a parser written
 * from that page looks for a top-level `alerts` array — which against a
 * real response is an object, not an array, and yields zero alerts for
 * every well-formed body.
 *
 * That is why this file exists, and why the rule it pins is stated as a
 * prohibition rather than a feature: an empty alert list may only ever be
 * reported for a body the parser RECOGNIZED and that genuinely carried no
 * alerts. Everything else throws. The poller reads an empty result as a
 * healthy quiet window and writes its cursor forward past it, so a
 * tolerant parse of an unrecognized shape is silent, permanent data loss.
 */

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

/*
 * The token_uri has to be a real Google host: the client allowlists it at
 * construction time, so a made-up host fails in the constructor and never
 * reaches the parsing under test here.
 */
const GOOGLE_TOKEN_URI: string = "https://oauth2.googleapis.com/token";

const SERVICE_ACCOUNT_JSON: string = JSON.stringify({
  client_email: "poller@example.iam.gserviceaccount.com",
  private_key: privateKey,
  token_uri: GOOGLE_TOKEN_URI,
});

const INSTANCE_RESOURCE_NAME: string =
  "projects/my-project/locations/us/instances/3f0a-instance";

const CHRONICLE_ORIGIN: string = "https://us-chronicle.googleapis.com";

const WINDOW_START_ISO: string = "2026-08-21T09:00:00.000Z";
const WINDOW_END_ISO: string = "2026-08-21T10:00:00.000Z";

/*
 * One canonical body, used both against parseAlertsBody directly and
 * through a stubbed transport, so the two paths cannot drift apart.
 */
const CANONICAL_BODY: string = JSON.stringify([
  {
    alerts: {
      alerts: [
        { id: "alert-1", ruleName: "Brute force" },
        { id: "alert-2", ruleName: "Impossible travel" },
      ],
    },
    complete: true,
    progress: 1,
    baselineAlertsCount: 2,
    filteredAlertsCount: 2,
  },
]);

interface StubbedResponse {
  status: number;
  body: string;
}

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/*
 * Routed by URL rather than by call order so a test can prove the body it
 * asserts on came back from Chronicle and not from the OAuth endpoint.
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
    init: FetchInitLike,
  ): Promise<FetchResponseLike> => {
    requests.push({ url: url, method: init.method, headers: init.headers });

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

function okTokenResponse(): StubbedResponse {
  return {
    status: 200,
    body: JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
  };
}

function makeClient(alertsBody: string): {
  client: GoogleSecOpsClient;
  requests: Array<RecordedRequest>;
} {
  const { fetchImplementation, requests } = makeFetch({
    token: okTokenResponse(),
    alerts: { status: 200, body: alertsBody },
  });

  const client: GoogleSecOpsClient = new GoogleSecOpsClient({
    region: "us",
    instanceResourceName: INSTANCE_RESOURCE_NAME,
    serviceAccountJson: SERVICE_ACCOUNT_JSON,
    fetchImplementation: fetchImplementation,
  });

  return { client: client, requests: requests };
}

/*
 * Refusals are asserted as "threw AND produced no result", never as
 * "threw": the failure mode being guarded against is a parser that returns
 * an empty list, so the absence of a return value is half the assertion.
 */
interface ParseOutcome {
  result: FetchAlertsResult | null;
  error: Error | null;
}

function parseOutcome(bodyText: string): ParseOutcome {
  try {
    return {
      result: GoogleSecOpsClient.parseAlertsBody(bodyText),
      error: null,
    };
  } catch (error) {
    return { result: null, error: error as Error };
  }
}

async function fetchOutcome(client: GoogleSecOpsClient): Promise<ParseOutcome> {
  try {
    return {
      result: await client.fetchDetectionAlerts({
        startTime: new Date(WINDOW_START_ISO),
        endTime: new Date(WINDOW_END_ISO),
      }),
      error: null,
    };
  } catch (error) {
    return { result: null, error: error as Error };
  }
}

function idsOf(alerts: Array<JSONObject>): Array<string> {
  return alerts.map((alert: JSONObject): string => {
    return String(alert["id"] || "");
  });
}

function chronicleRequests(
  requests: Array<RecordedRequest>,
): Array<RecordedRequest> {
  return requests.filter((request: RecordedRequest): boolean => {
    return request.url.startsWith(CHRONICLE_ORIGIN);
  });
}

beforeEach(() => {
  /*
   * Several fixtures deliberately end without complete=true, which the
   * client warns about. Silenced so a real failure is the only thing in
   * the output.
   */
  getJestSpyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);
  getJestSpyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GoogleSecOpsClient.parseAlertsBody stream envelope", () => {
  test("reads the canonical single chunk from alerts.alerts, not from a top-level array", () => {
    const result: FetchAlertsResult =
      GoogleSecOpsClient.parseAlertsBody(CANONICAL_BODY);

    expect(result.alerts).toEqual([
      { id: "alert-1", ruleName: "Brute force" },
      { id: "alert-2", ruleName: "Impossible travel" },
    ]);
    expect(result.chunkCount).toBe(1);
    expect(result.complete).toBe(true);
    expect(result.progress).toBe(1);
    expect(result.baselineAlertsCount).toBe(2);
    expect(result.filteredAlertsCount).toBe(2);
    expect(result.truncatedByCount).toBe(false);
    expect(result.truncatedByBytes).toBe(false);
  });

  test("tolerates a bare unary object instead of the array envelope", () => {
    const result: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(
      JSON.stringify({
        alerts: { alerts: [{ id: "alert-1" }] },
        complete: true,
        progress: 1,
      }),
    );

    expect(idsOf(result.alerts)).toEqual(["alert-1"]);
    expect(result.chunkCount).toBe(1);
    expect(result.complete).toBe(true);
  });

  test("a chunk omitting complete and progress parses with proto3 scalar defaults", () => {
    // Both are proto3 scalars: false / 0 are serialized by omitting the key.
    const result: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(
      JSON.stringify([{ alerts: { alerts: [{ id: "alert-1" }] } }]),
    );

    expect(idsOf(result.alerts)).toEqual(["alert-1"]);
    expect(result.complete).toBe(false);
    expect(result.progress).toBe(0);
    expect(result.baselineAlertsCount).toBe(0);
    expect(result.filteredAlertsCount).toBe(0);
  });

  test("an absent scalar in a later chunk does not overwrite one an earlier chunk carried", () => {
    /*
     * "Last chunk that CARRIES the key", not "last chunk". Reading absence
     * as present-and-false would turn a completed stream into a partial
     * one the moment a trailing chunk omitted the flag.
     */
    const result: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(
      JSON.stringify([
        { complete: true, progress: 1, baselineAlertsCount: 7 },
        { alerts: { alerts: [{ id: "alert-1" }] } },
      ]),
    );

    expect(result.complete).toBe(true);
    expect(result.progress).toBe(1);
    expect(result.baselineAlertsCount).toBe(7);
    expect(result.chunkCount).toBe(2);
  });

  test("counts arriving as proto3 int64 strings are read as numbers", () => {
    const result: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(
      JSON.stringify([
        {
          alerts: { alerts: [{ id: "alert-1" }] },
          complete: true,
          baselineAlertsCount: "1200",
          filteredAlertsCount: "34",
        },
      ]),
    );

    expect(result.baselineAlertsCount).toBe(1200);
    expect(result.filteredAlertsCount).toBe(34);
  });

  test("repairs concatenated objects that were never joined into an array", () => {
    const body: string =
      JSON.stringify({
        alerts: { alerts: [{ id: "alert-1" }] },
        progress: 0.5,
      }) +
      "\n" +
      JSON.stringify({
        alerts: { alerts: [{ id: "alert-2" }] },
        complete: true,
        progress: 1,
      });

    const result: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(body);

    expect(idsOf(result.alerts)).toEqual(["alert-1", "alert-2"]);
    expect(result.chunkCount).toBe(2);
    expect(result.complete).toBe(true);
    expect(result.progress).toBe(1);
  });

  test("repairs a trailing comma before a closing bracket", () => {
    const result: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(
      '[{"alerts":{"alerts":[{"id":"alert-1"},]},"complete":true},]',
    );

    expect(idsOf(result.alerts)).toEqual(["alert-1"]);
    expect(result.chunkCount).toBe(1);
    expect(result.complete).toBe(true);
  });
});

describe("GoogleSecOpsClient.parseAlertsBody accumulation across chunks", () => {
  test("unions disjoint ids across chunks", () => {
    const result: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(
      JSON.stringify([
        { alerts: { alerts: [{ id: "a" }, { id: "b" }] }, progress: 0.5 },
        { alerts: { alerts: [{ id: "c" }] }, complete: true, progress: 1 },
      ]),
    );

    expect(idsOf(result.alerts)).toEqual(["a", "b", "c"]);
    expect(result.chunkCount).toBe(2);
  });

  test("dedupes ids repeated across chunks instead of counting them twice", () => {
    /*
     * The C3 pin. No Google page states whether chunk.alerts is cumulative
     * or incremental, and the cumulative reading is the more likely one:
     * each chunk restates the whole top-N. Under a blind push the window
     * below would ingest five Detection Finding rows for three real
     * alerts, and every duplicate would be a separate, alertable finding.
     * The dedupe-by-id union is correct under either reading.
     */
    const result: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(
      JSON.stringify([
        { alerts: { alerts: [{ id: "a" }, { id: "b" }] }, progress: 0.5 },
        {
          alerts: { alerts: [{ id: "a" }, { id: "b" }, { id: "c" }] },
          complete: true,
          progress: 1,
        },
      ]),
    );

    expect(result.alerts).toHaveLength(3);
    expect(idsOf(result.alerts)).toEqual(["a", "b", "c"]);
  });

  test("a mutated copy of an id in a later chunk wins", () => {
    // Cumulative chunks refresh what they restate; the freshest state wins.
    const result: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(
      JSON.stringify([
        {
          alerts: {
            alerts: [{ id: "a", alertState: "OPEN", severity: "LOW" }],
          },
        },
        {
          alerts: {
            alerts: [{ id: "a", alertState: "CLOSED", severity: "HIGH" }],
          },
          complete: true,
        },
      ]),
    );

    expect(result.alerts).toEqual([
      { id: "a", alertState: "CLOSED", severity: "HIGH" },
    ]);
  });

  test("alerts with no usable id are never collapsed into one another", () => {
    /*
     * A missing id and an empty-string id both fall back to a positional
     * key. Keying them all on "" would silently discard every id-less
     * alert but the last one in the window.
     */
    const result: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(
      JSON.stringify([
        {
          alerts: {
            alerts: [
              { ruleName: "r1" },
              { ruleName: "r2" },
              { id: "", ruleName: "r3" },
            ],
          },
        },
        {
          alerts: {
            alerts: [{ ruleName: "r1" }, { id: "", ruleName: "r4" }],
          },
          complete: true,
        },
      ]),
    );

    expect(result.alerts).toEqual([
      { ruleName: "r1" },
      { ruleName: "r2" },
      { id: "", ruleName: "r3" },
      { ruleName: "r1" },
      { id: "", ruleName: "r4" },
    ]);
  });
});

describe("GoogleSecOpsClient.parseAlertsBody recognized shapes carrying no alerts", () => {
  test("a recognized chunk with no alerts returns an empty list without throwing", () => {
    const result: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(
      JSON.stringify([{ complete: true }]),
    );

    expect(result.alerts).toEqual([]);
    expect(result.complete).toBe(true);
    expect(result.chunkCount).toBe(1);
  });

  test("alerts present but alerts.alerts absent is a recognized empty window", () => {
    // Both levels of the AlertList nesting are omitted when empty.
    const result: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(
      JSON.stringify([{ alerts: {}, complete: true }]),
    );

    expect(result.alerts).toEqual([]);
    expect(result.complete).toBe(true);
  });

  test("non-object entries inside alerts.alerts are filtered rather than fatal", () => {
    const result: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(
      JSON.stringify([
        {
          alerts: {
            alerts: [{ id: "alert-1" }, "junk", 42, null, [{ id: "nested" }]],
          },
          complete: true,
        },
      ]),
    );

    expect(result.alerts).toEqual([{ id: "alert-1" }]);
  });
});

describe("GoogleSecOpsClient.parseAlertsBody legacy top-level shapes", () => {
  test("a top-level alerts array still works", () => {
    const result: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(
      JSON.stringify({ alerts: [{ id: "legacy-1" }, { id: "legacy-2" }] }),
    );

    expect(idsOf(result.alerts)).toEqual(["legacy-1", "legacy-2"]);
  });

  test("a top-level detections array still works", () => {
    const result: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(
      JSON.stringify({ detections: [{ id: "det-1" }] }),
    );

    expect(idsOf(result.alerts)).toEqual(["det-1"]);
  });

  test("an empty alerts array does not shadow a populated detections array", () => {
    /*
     * The first-array-wins bug: the old loop returned on the first
     * array-valued key rather than the first non-empty one, so this body
     * reported zero alerts and dropped the detections.
     */
    const result: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(
      JSON.stringify({ alerts: [], detections: [{ id: "det-1" }] }),
    );

    expect(idsOf(result.alerts)).toEqual(["det-1"]);
  });
});

describe("GoogleSecOpsClient.parseAlertsBody bodies it must refuse", () => {
  test("an unrecognized shape throws and never reports zero alerts", () => {
    /*
     * The most important assertion in this change. A [] here is
     * indistinguishable from a genuinely quiet window: the poller records
     * a healthy poll, advances lastPolledAt past the window, and every
     * alert in it is lost with nothing written to lastError. The parser
     * must refuse a body it did not recognize, not summarize it as empty.
     */
    const unary: ParseOutcome = parseOutcome(JSON.stringify({ nope: true }));

    expect(unary.error).toBeInstanceOf(APIException);
    expect(unary.result).toBeNull();

    const wrapped: ParseOutcome = parseOutcome(
      JSON.stringify([{ nope: true }, { alsoNope: 1 }]),
    );

    expect(wrapped.error).toBeInstanceOf(APIException);
    expect(wrapped.result).toBeNull();

    /*
     * And the contrast that makes the refusal meaningful: a body that IS
     * recognized and carries nothing returns, rather than throwing.
     */
    const recognized: ParseOutcome = parseOutcome(
      JSON.stringify([{ complete: true }]),
    );

    expect(recognized.error).toBeNull();
    expect(recognized.result?.alerts).toEqual([]);
  });

  test("an empty array has no recognized chunk and throws", () => {
    const outcome: ParseOutcome = parseOutcome("[]");

    expect(outcome.error).toBeInstanceOf(APIException);
    expect(outcome.result).toBeNull();
  });

  test("a JSON root that is not an object or array throws", () => {
    for (const root of ['"junk"', "null", "42", "true"]) {
      const outcome: ParseOutcome = parseOutcome(root);

      expect(outcome.error).toBeInstanceOf(APIException);
      expect(outcome.result).toBeNull();
    }
  });

  test("text that is not JSON at all throws the non-JSON body exception", () => {
    const outcome: ParseOutcome = parseOutcome("not json at all");

    expect(outcome.error).toBeInstanceOf(APIException);
    expect(outcome.result).toBeNull();
  });

  test("an HTML body from a mistyped region throws APIException, not a raw SyntaxError", () => {
    /*
     * googleapis.com is a DNS wildcard, so a bad region prefix resolves to
     * a Google frontend that answers with an HTML 404. An unwrapped
     * SyntaxError escapes the failure taxonomy the operator guidance is
     * written against.
     */
    const outcome: ParseOutcome = parseOutcome(
      '<!DOCTYPE html>\n<html lang="en">\n<head><title>Error 404 (Not Found)</title></head>\n<body><p>The requested URL was not found on this server.</p></body>\n</html>\n',
    );

    expect(outcome.error).toBeInstanceOf(APIException);
    expect(outcome.error).not.toBeInstanceOf(SyntaxError);
    expect(outcome.result).toBeNull();
  });

  test("an empty or whitespace-only body throws", () => {
    for (const body of ["", "   ", "\n\t "]) {
      const outcome: ParseOutcome = parseOutcome(body);

      expect(outcome.error).toBeInstanceOf(APIException);
      expect(outcome.result).toBeNull();
    }
  });

  test("the three refusal kinds are distinguishable from one another", () => {
    /*
     * Derived rather than pasted: whatever the templates say, an operator
     * reading lastError has to be able to tell "Chronicle sent nothing"
     * from "Chronicle sent a web page" from "Chronicle sent JSON we do not
     * understand", because the three have different fixes.
     */
    const outcomes: Array<ParseOutcome> = [
      parseOutcome(""),
      parseOutcome("<html><body>404</body></html>"),
      parseOutcome(JSON.stringify({ nope: true })),
    ];

    const messages: Array<string> = outcomes.map(
      (outcome: ParseOutcome): string => {
        expect(outcome.error).toBeInstanceOf(APIException);

        return String(outcome.error?.message || "");
      },
    );

    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
    }

    expect(new Set(messages).size).toBe(3);
  });
});

describe("GoogleSecOpsClient.fetchDetectionAlerts response parsing", () => {
  test("returns the parsed stream envelope from a live-shaped 200", async () => {
    const { client, requests } = makeClient(CANONICAL_BODY);

    const result: FetchAlertsResult = await client.fetchDetectionAlerts({
      startTime: new Date(WINDOW_START_ISO),
      endTime: new Date(WINDOW_END_ISO),
    });

    expect(idsOf(result.alerts)).toEqual(["alert-1", "alert-2"]);
    expect(result.complete).toBe(true);
    expect(result.progress).toBe(1);
    expect(result.chunkCount).toBe(1);
    expect(result.truncatedByCount).toBe(false);
    expect(result.truncatedByBytes).toBe(false);

    // The parsed body came back from Chronicle, not from the token endpoint.
    const alertsCalls: Array<RecordedRequest> = chronicleRequests(requests);
    expect(alertsCalls).toHaveLength(1);
    expect(alertsCalls[0]!.method).toBe("GET");
    expect(alertsCalls[0]!.headers["Authorization"]).toBe("Bearer test-token");
  });

  test("a 200 carrying an unrecognized shape rejects instead of resolving empty", async () => {
    /*
     * The same refusal as the unit case, asserted at the boundary the
     * poller actually calls: a resolved empty result here is what advances
     * the cursor past unread alerts.
     */
    const { client } = makeClient(JSON.stringify({ nope: true }));

    const outcome: ParseOutcome = await fetchOutcome(client);

    expect(outcome.error).toBeInstanceOf(APIException);
    expect(outcome.result).toBeNull();
  });

  test("a 200 with an empty body rejects instead of resolving empty", async () => {
    const { client } = makeClient("");

    const outcome: ParseOutcome = await fetchOutcome(client);

    expect(outcome.error).toBeInstanceOf(APIException);
    expect(outcome.result).toBeNull();
  });
});
