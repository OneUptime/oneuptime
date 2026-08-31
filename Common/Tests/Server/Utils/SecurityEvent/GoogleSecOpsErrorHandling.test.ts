import { generateKeyPairSync } from "crypto";
import logger from "../../../../Server/Utils/Logger";
import GoogleSecOpsClient, {
  FetchAlertsResult,
  FetchLike,
  FetchResponseLike,
} from "../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsClient";
import APIException from "../../../../Types/Exception/ApiException";
import { JSONObject } from "../../../../Types/JSON";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The ways a Google SecOps poll fails without the HTTP status saying so,
 * and the ways it fails when the status does.
 *
 * legacyFetchAlertsView is a server-streaming method, and it reports a
 * rejected query IN BAND: HTTP 200, with validSnapshotQuery /
 * validBaselineQuery / queryValidationErrors / runtimeErrors carrying the
 * complaint — and, because the terminal google.rpc.Status is appended as
 * the stream's last element, sometimes with an error sitting behind
 * perfectly good alert data. A parser that trusts response.ok reports
 * every one of those as a healthy poll that found nothing, and the poller
 * then advances its cursor past the window it never read.
 *
 * The other half of this file is the HTTP error contract an operator
 * actually reads off `Last Error`: both body shapes (this host wraps its
 * errors in the stream's array envelope, an error rejected at the edge
 * does not), the ErrorInfo.reason branches that turn a status code into an
 * instruction, and the 500-character echo that the integration doc and the
 * connections page both quote verbatim.
 *
 * It closes with the exact 400 a customer hit in production. Google's
 * authn runs BEFORE HTTP transcoding — a live probe returns 401, not that
 * 400, for the same bad parameter without credentials — so the reported
 * body is affirmative proof the service account worked and the request
 * shape was ours. Anything that reads it as a credential problem sends the
 * customer to regenerate a key that was never broken.
 */

/*
 * A real RS256 key: the client genuinely signs a JWT assertion on the way
 * to the token endpoint, and a fake key fails inside jwt.sign with an
 * error that has nothing to do with what these tests are pinning.
 */
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const GOOGLE_TOKEN_URI: string = "https://oauth2.googleapis.com/token";

const SERVICE_ACCOUNT_JSON: string = JSON.stringify({
  client_email: "poller@example.iam.gserviceaccount.com",
  private_key: privateKey,
  token_uri: GOOGLE_TOKEN_URI,
});

const INSTANCE: string =
  "projects/my-project/locations/us/instances/3f0a-instance";

const WINDOW_START: Date = new Date("2026-08-21T09:00:00.000Z");
const WINDOW_END: Date = new Date("2026-08-21T10:00:00.000Z");

/*
 * The figure the integration doc and the connections page both print, and
 * the width the lastError column is sized against.
 */
const BODY_ECHO_LIMIT: number = 500;

/*
 * The HTTP-shaped opening the connections page's taxonomy splits on. An
 * in-band rejection arrives on a 200 and must not wear it.
 */
const HTTP_FAILURE_PREFIX_PATTERN: RegExp = /failed \(HTTP \d+\)/;

// The scope the client asks for; the scope-insufficient hint must name it.
const CHRONICLE_SCOPE: string =
  "https://www.googleapis.com/auth/cloud-platform";

/*
 * Verbatim, byte for byte, the body the customer's connection recorded.
 * String.raw so the escaped quotes around "pageSize" survive into the
 * fixture as escaped quotes rather than being unescaped by TypeScript —
 * the point of the fixture is that it is the real wire bytes.
 */
const PRODUCTION_ERROR_BODY: string = String.raw`[{"error":{"code":400,"message":"Invalid JSON payload received. Unknown name \"pageSize\": Cannot bind query parameter. Field 'pageSize' could not be found in request message.","status":"INVALID_ARGUMENT","details":[{"@type":"type.googleapis.com/google.rpc.BadRequest","fieldViolations":[{"description":"Invalid JSON payload received. Unknown name \"pageSize\": Cannot bind query parameter."}]}]}}]`;

interface StubbedResponse {
  status: number;
  body: string;
}

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | undefined;
}

interface CapturedLogs {
  warnings: Array<string>;
  errors: Array<string>;
}

interface AlertsFailure {
  error: Error;
  requests: Array<RecordedRequest>;
}

/*
 * Routed by URL rather than by call order, because the 401 path re-mints a
 * token mid-fetch and a positional recorder would hand the retry the wrong
 * fixture.
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
    requests.push({
      url: url,
      method: init.method,
      headers: init.headers,
      body: init.body,
    });

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
    instanceResourceName: INSTANCE,
    serviceAccountJson: SERVICE_ACCOUNT_JSON,
    fetchImplementation: fetchImplementation,
  });

  return { client: client, requests: requests };
}

function okTokenResponse(): StubbedResponse {
  return {
    status: 200,
    body: JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
  };
}

function alertsRequestsIn(
  requests: Array<RecordedRequest>,
): Array<RecordedRequest> {
  return requests.filter((request: RecordedRequest): boolean => {
    return request.url !== GOOGLE_TOKEN_URI;
  });
}

function tokenRequestsIn(
  requests: Array<RecordedRequest>,
): Array<RecordedRequest> {
  return requests.filter((request: RecordedRequest): boolean => {
    return request.url === GOOGLE_TOKEN_URI;
  });
}

// Drive the real client to failure and hand back what an operator would read.
async function alertsFailure(alerts: StubbedResponse): Promise<AlertsFailure> {
  const { client, requests } = makeClient({
    token: okTokenResponse(),
    alerts: alerts,
  });

  try {
    await client.fetchDetectionAlerts({
      startTime: WINDOW_START,
      endTime: WINDOW_END,
    });
  } catch (error) {
    return { error: error as Error, requests: requests };
  }

  throw new Error(
    "GoogleSecOpsClient was expected to reject this alerts response.",
  );
}

function parseFailure(
  bodyText: string,
  maxReturnedAlerts?: number | undefined,
): Error {
  try {
    GoogleSecOpsClient.parseAlertsBody(bodyText, maxReturnedAlerts);
  } catch (error) {
    return error as Error;
  }

  throw new Error(
    "GoogleSecOpsClient.parseAlertsBody was expected to throw for this body.",
  );
}

/*
 * Fresh arrays per call, so no test can observe another test's logs; the
 * afterEach restore puts the real logger back either way.
 */
function captureLogs(): CapturedLogs {
  const warnings: Array<string> = [];
  const errors: Array<string> = [];

  getJestSpyOn(logger, "warn").mockImplementation(((message: unknown): void => {
    warnings.push(String(message));
  }) as never);

  getJestSpyOn(logger, "error").mockImplementation(((
    message: unknown,
  ): void => {
    errors.push(String(message));
  }) as never);

  return { warnings: warnings, errors: errors };
}

function errorInfoDetail(
  reason: string,
  metadata?: JSONObject | undefined,
): JSONObject {
  const detail: JSONObject = {
    "@type": "type.googleapis.com/google.rpc.ErrorInfo",
    reason: reason,
    domain: "chronicle.googleapis.com",
  };

  if (metadata) {
    detail["metadata"] = metadata;
  }

  return detail;
}

function badRequestDetail(description: string): JSONObject {
  return {
    "@type": "type.googleapis.com/google.rpc.BadRequest",
    fieldViolations: [{ description: description }],
  };
}

function googleError(data: {
  code: number;
  status: string;
  message: string;
  details?: Array<JSONObject> | undefined;
}): JSONObject {
  const error: JSONObject = {
    code: data.code,
    message: data.message,
    status: data.status,
  };

  if (data.details) {
    error["details"] = data.details;
  }

  return error;
}

// The two wire shapes: the edge answers bare, the streaming method wraps.
function bareErrorBody(error: JSONObject): string {
  return JSON.stringify({ error: error });
}

function streamErrorBody(error: JSONObject): string {
  return JSON.stringify([{ error: error }]);
}

function hintForErrorInfo(data: {
  httpStatus: number;
  rpcStatus: string;
  reason: string;
  metadata?: JSONObject | undefined;
}): string {
  return GoogleSecOpsClient.describeHttpFailure(
    data.httpStatus,
    streamErrorBody(
      googleError({
        code: data.httpStatus,
        status: data.rpcStatus,
        message: `Request rejected: ${data.reason}.`,
        details: [errorInfoDetail(data.reason, data.metadata)],
      }),
    ),
  );
}

const IAM_RESOURCE: string =
  "projects/my-project/locations/us/instances/3f0a-instance";
const IAM_PERMISSION: string = "chronicle.legacies.legacyFetchAlertsView";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GoogleSecOpsClient in-band validation errors on an HTTP 200", () => {
  test("validSnapshotQuery:false throws and carries the query parse error Chronicle reported", () => {
    const parseError: string =
      "line 1:12 mismatched input 'AND' expecting {'(', VALUE}";

    const thrown: Error = parseFailure(
      JSON.stringify([
        {
          validSnapshotQuery: false,
          queryValidationErrors: [{ errorText: parseError }],
          complete: true,
        },
      ]),
    );

    expect(thrown).toBeInstanceOf(APIException);
    expect(thrown.message).toContain("validSnapshotQuery=false");
    expect(thrown.message).toContain(parseError);

    /*
     * The failure taxonomy the connections page is written against splits
     * on the HTTP-shaped prefixes. This one carries no HTTP status because
     * there was no HTTP failure, and must not be dressed up as one.
     */
    expect(HTTP_FAILURE_PREFIX_PATTERN.test(thrown.message)).toBe(false);
  });

  test("a validation entry with no known text field is rendered as JSON, never as [object Object]", () => {
    const thrown: Error = parseFailure(
      JSON.stringify([
        {
          validSnapshotQuery: false,
          queryValidationErrors: [{ code: 3, detail: "unparseable predicate" }],
          complete: true,
        },
      ]),
    );

    expect(thrown.message).toContain("unparseable predicate");
    expect(thrown.message).toContain("detail");
    expect(thrown.message).not.toContain("[object Object]");
  });

  test("validBaselineQuery:false throws on its own and is not conflated with the snapshot query", () => {
    const thrown: Error = parseFailure(
      JSON.stringify([{ validBaselineQuery: false, complete: true }]),
    );

    expect(thrown).toBeInstanceOf(APIException);
    expect(thrown.message).toContain("validBaselineQuery=false");
    expect(thrown.message).not.toContain("validSnapshotQuery=false");
  });

  test("non-empty runtimeErrors throw, deduped across chunks, and the alerts ahead of them are not returned", async () => {
    const runtimeError: string =
      "Rule 'ur_ttp_brute_force' failed at runtime: field udm.principal.ip not found";

    /*
     * The same error restated in a later chunk, because a cumulative chunk
     * repeats the whole list — concatenating would print it twice.
     */
    const body: string = JSON.stringify([
      {
        alerts: { alerts: [{ id: "a-1" }] },
        runtimeErrors: [runtimeError],
      },
      { runtimeErrors: [runtimeError], complete: true },
    ]);

    const thrown: Error = parseFailure(body);

    expect(thrown).toBeInstanceOf(APIException);
    expect(thrown.message.split(runtimeError).length - 1).toBe(1);

    // Through the real transport too: a 200 that carries this never resolves.
    const failure: AlertsFailure = await alertsFailure({
      status: 200,
      body: body,
    });

    expect(failure.error).toBeInstanceOf(APIException);
    expect(failure.error.message).toContain(runtimeError);
  });

  test("empty error arrays and true validity flags are a healthy response, not a rejection", () => {
    const result: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(
      JSON.stringify([
        {
          alerts: { alerts: [{ id: "a-1" }] },
          validSnapshotQuery: true,
          validBaselineQuery: true,
          queryValidationErrors: [],
          runtimeErrors: [],
          complete: true,
          progress: 1,
        },
      ]),
    );

    expect(result.alerts).toEqual([{ id: "a-1" }]);
    expect(result.complete).toBe(true);
  });
});

describe("GoogleSecOpsClient truncation, completeness and the C3 self-check", () => {
  test("tooManyAlerts warns and sets truncatedByCount without throwing away the alerts it did return", () => {
    const logs: CapturedLogs = captureLogs();

    const result: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(
      JSON.stringify([
        {
          alerts: { alerts: [{ id: "a-1" }, { id: "a-2" }] },
          tooManyAlerts: true,
          // proto3 renders int64 as a JSON string; the counts arrive quoted.
          baselineAlertsCount: "12000",
          filteredAlertsCount: "12000",
          complete: true,
          progress: 1,
        },
      ]),
      2,
    );

    expect(result.alerts).toEqual([{ id: "a-1" }, { id: "a-2" }]);
    expect(result.truncatedByCount).toBe(true);
    expect(result.truncatedByBytes).toBe(false);
    expect(result.complete).toBe(true);
    expect(result.baselineAlertsCount).toBe(12000);
    expect(result.filteredAlertsCount).toBe(12000);
    expect(result.chunkCount).toBe(1);

    expect(logs.warnings).toHaveLength(1);
    expect(logs.warnings[0]!).toContain("tooManyAlerts");
    expect(logs.errors).toEqual([]);
  });

  test("memoryLimitExceeded warns and sets truncatedByBytes without throwing", () => {
    const logs: CapturedLogs = captureLogs();

    const result: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(
      JSON.stringify([
        {
          alerts: { alerts: [{ id: "a-1" }] },
          memoryLimitExceeded: true,
          complete: true,
          progress: 1,
        },
      ]),
    );

    expect(result.alerts).toHaveLength(1);
    expect(result.truncatedByBytes).toBe(true);
    expect(result.truncatedByCount).toBe(false);

    expect(logs.warnings).toHaveLength(1);
    expect(logs.warnings[0]!).toContain("memoryLimitExceeded");
    expect(logs.errors).toEqual([]);
  });

  test("a stream that ends without complete:true warns and reports complete:false rather than throwing", () => {
    const logs: CapturedLogs = captureLogs();

    const result: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(
      JSON.stringify([{ alerts: { alerts: [{ id: "a-1" }] }, progress: 0.5 }]),
    );

    expect(result.complete).toBe(false);
    expect(result.progress).toBe(0.5);
    expect(result.alerts).toHaveLength(1);

    expect(logs.warnings).toHaveLength(1);
    expect(logs.warnings[0]!).toContain("complete=true");
    expect(logs.errors).toEqual([]);
  });

  test("a stream that does end with complete:true says nothing at all", () => {
    const logs: CapturedLogs = captureLogs();

    const result: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(
      JSON.stringify([
        { alerts: { alerts: [{ id: "a-1" }] }, complete: true, progress: 1 },
      ]),
    );

    expect(result.complete).toBe(true);
    expect(logs.warnings).toEqual([]);
    expect(logs.errors).toEqual([]);
  });

  /*
   * C3: no Google page says whether chunk.alerts is cumulative or
   * incremental. The union is correct either way, so the only way the
   * accumulated total can exceed the ceiling we asked for is if the dedupe
   * key stopped identifying restated alerts — which is an answer to the
   * doc question, logged where production can see it.
   */
  test("accumulating past maxReturnedAlerts logs an error naming both counts, and stops exactly at the ceiling", () => {
    const body: string = JSON.stringify([
      { alerts: { alerts: [{ id: "a-1" }, { id: "a-2" }] } },
      {
        alerts: { alerts: [{ id: "a-1" }, { id: "a-2" }, { id: "a-3" }] },
        complete: true,
        progress: 1,
      },
    ]);

    const atCeiling: CapturedLogs = captureLogs();
    const withinCeiling: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(
      body,
      3,
    );

    expect(withinCeiling.alerts).toHaveLength(3);
    expect(atCeiling.errors).toEqual([]);
    expect(atCeiling.warnings).toEqual([]);

    const overCeiling: CapturedLogs = captureLogs();
    const overrun: FetchAlertsResult = GoogleSecOpsClient.parseAlertsBody(
      body,
      2,
    );

    // The overrun is reported, never thrown: the alerts themselves are real.
    expect(overrun.alerts).toHaveLength(3);
    expect(overCeiling.errors).toHaveLength(1);
    expect(overCeiling.errors[0]!).toContain(String(overrun.alerts.length));
    expect(overCeiling.errors[0]!).toContain("2");
    expect(overCeiling.warnings).toEqual([]);
  });
});

describe("GoogleSecOpsClient errors appended to a 200 stream", () => {
  const streamError: JSONObject = googleError({
    code: 13,
    status: "INTERNAL",
    message: "Backend rule engine terminated the stream.",
  });

  const goodChunks: Array<JSONObject> = [
    { alerts: { alerts: [{ id: "a-1" }] } },
    { alerts: { alerts: [{ id: "a-2" }] }, complete: true, progress: 1 },
  ];

  test("the same chunks without a terminal error resolve, so the control is real", async () => {
    const { client } = makeClient({
      token: okTokenResponse(),
      alerts: { status: 200, body: JSON.stringify(goodChunks) },
    });

    const result: FetchAlertsResult = await client.fetchDetectionAlerts({
      startTime: WINDOW_START,
      endTime: WINDOW_END,
    });

    expect(result.alerts).toEqual([{ id: "a-1" }, { id: "a-2" }]);
    expect(result.chunkCount).toBe(2);
  });

  test("a google.rpc.Status appended after good alert data throws instead of being masked by it", async () => {
    const body: string = JSON.stringify([
      ...goodChunks,
      { error: streamError },
    ]);

    const thrown: Error = parseFailure(body);

    expect(thrown).toBeInstanceOf(APIException);
    expect(thrown.message).toContain("13");
    expect(thrown.message).toContain("INTERNAL");
    expect(thrown.message).toContain(
      "Backend rule engine terminated the stream.",
    );

    const failure: AlertsFailure = await alertsFailure({
      status: 200,
      body: body,
    });

    expect(failure.error).toBeInstanceOf(APIException);
  });

  test("the scan reaches an error at any index, not just the first element", () => {
    // Index 1 of 2, behind a chunk that carries no alerts at all.
    const thrown: Error = parseFailure(
      JSON.stringify([{ progress: 0.25 }, { error: streamError }]),
    );

    expect(thrown).toBeInstanceOf(APIException);
    expect(thrown.message).toContain(
      "Backend rule engine terminated the stream.",
    );
  });
});

describe("GoogleSecOpsClient.describeHttpFailure", () => {
  test("reads the same error out of the array envelope and the bare object, and appends behind the echo", () => {
    const unauthenticated: JSONObject = googleError({
      code: 401,
      status: "UNAUTHENTICATED",
      message: "Request had invalid authentication credentials.",
    });

    const bare: string = GoogleSecOpsClient.describeHttpFailure(
      401,
      bareErrorBody(unauthenticated),
    );
    const wrapped: string = GoogleSecOpsClient.describeHttpFailure(
      401,
      streamErrorBody(unauthenticated),
    );

    expect(bare).not.toBe("");
    expect(bare).toBe(wrapped);

    // The hint is only ever appended to the tail of the echoed body.
    expect(bare.startsWith(" — ")).toBe(true);

    const denied: JSONObject = googleError({
      code: 403,
      status: "PERMISSION_DENIED",
      message: "Permission denied.",
      details: [
        errorInfoDetail("IAM_PERMISSION_DENIED", {
          resource: IAM_RESOURCE,
          permission: IAM_PERMISSION,
        }),
      ],
    });

    expect(
      GoogleSecOpsClient.describeHttpFailure(403, bareErrorBody(denied)),
    ).toBe(
      GoogleSecOpsClient.describeHttpFailure(403, streamErrorBody(denied)),
    );
  });

  test("an error at a non-zero index is found, and the elements ahead of it change nothing", () => {
    const denied: JSONObject = googleError({
      code: 403,
      status: "PERMISSION_DENIED",
      message: "Permission denied.",
      details: [
        errorInfoDetail("IAM_PERMISSION_DENIED", {
          resource: IAM_RESOURCE,
          permission: IAM_PERMISSION,
        }),
      ],
    });

    const behindData: string = GoogleSecOpsClient.describeHttpFailure(
      403,
      JSON.stringify([{ progress: 0.5 }, { error: denied }]),
    );

    expect(behindData).toContain(IAM_RESOURCE);
    expect(behindData).toBe(
      GoogleSecOpsClient.describeHttpFailure(403, streamErrorBody(denied)),
    );
  });

  test("IAM_PERMISSION_DENIED renders the resource and permission Google named, not a fixed pair", () => {
    const reported: string = hintForErrorInfo({
      httpStatus: 403,
      rpcStatus: "PERMISSION_DENIED",
      reason: "IAM_PERMISSION_DENIED",
      metadata: { resource: IAM_RESOURCE, permission: IAM_PERMISSION },
    });

    expect(reported).toContain(IAM_RESOURCE);
    expect(reported).toContain(IAM_PERMISSION);

    const otherTenant: string = hintForErrorInfo({
      httpStatus: 403,
      rpcStatus: "PERMISSION_DENIED",
      reason: "IAM_PERMISSION_DENIED",
      metadata: {
        resource: "projects/other/locations/europe/instances/9c11-instance",
        permission: "chronicle.legacies.legacyGetAlert",
      },
    });

    expect(otherTenant).toContain(
      "projects/other/locations/europe/instances/9c11-instance",
    );
    expect(otherTenant).toContain("chronicle.legacies.legacyGetAlert");
    expect(otherTenant).not.toContain(IAM_RESOURCE);

    // Metadata is optional on ErrorInfo; the hint must survive its absence.
    const withoutMetadata: string = hintForErrorInfo({
      httpStatus: 403,
      rpcStatus: "PERMISSION_DENIED",
      reason: "IAM_PERMISSION_DENIED",
    });

    expect(withoutMetadata).not.toBe("");
    expect(withoutMetadata).not.toContain(IAM_RESOURCE);
  });

  test("ACCESS_TOKEN_SCOPE_INSUFFICIENT names the Chronicle scope and is distinct from the other credential reasons", () => {
    const scopeInsufficient: string = hintForErrorInfo({
      httpStatus: 403,
      rpcStatus: "PERMISSION_DENIED",
      reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
    });

    expect(scopeInsufficient).toContain(CHRONICLE_SCOPE);

    const expired: string = hintForErrorInfo({
      httpStatus: 401,
      rpcStatus: "UNAUTHENTICATED",
      reason: "ACCESS_TOKEN_EXPIRED",
    });
    const missing: string = hintForErrorInfo({
      httpStatus: 401,
      rpcStatus: "UNAUTHENTICATED",
      reason: "CREDENTIALS_MISSING",
    });

    for (const hint of [scopeInsufficient, expired, missing]) {
      expect(hint).not.toBe("");
    }

    /*
     * Three reasons that all mean "the token is wrong" and all need a
     * different fix — collapsing any two of them is the failure this
     * assertion exists to catch.
     */
    const distinct: Set<string> = new Set<string>([
      scopeInsufficient,
      expired,
      missing,
    ]);
    expect(distinct.size).toBe(3);
  });

  test("the reason beats the status, and an unrecognized reason is still surfaced verbatim", () => {
    const statusOnly: string = GoogleSecOpsClient.describeHttpFailure(401, "");
    const withReason: string = hintForErrorInfo({
      httpStatus: 401,
      rpcStatus: "UNAUTHENTICATED",
      reason: "ACCESS_TOKEN_EXPIRED",
    });

    expect(statusOnly).not.toBe("");
    expect(withReason).not.toBe(statusOnly);

    const novelReason: string = hintForErrorInfo({
      httpStatus: 403,
      rpcStatus: "PERMISSION_DENIED",
      reason: "CHRONICLE_TENANT_SUSPENDED",
    });

    expect(novelReason).toContain("CHRONICLE_TENANT_SUSPENDED");
  });

  test("429 is classified as RESOURCE_EXHAUSTED, and RATE_LIMIT_EXCEEDED names the quota Google reported", () => {
    const statusOnly: string = GoogleSecOpsClient.describeHttpFailure(
      429,
      "Quota exceeded.",
    );

    expect(statusOnly).toContain("RESOURCE_EXHAUSTED");

    const quotaMetric: string =
      "chronicle.googleapis.com/legacy_fetch_alerts_requests";
    const quotaLimit: string = "LegacyFetchAlertsRequestsPerUserPerHour";

    const withQuota: string = hintForErrorInfo({
      httpStatus: 429,
      rpcStatus: "RESOURCE_EXHAUSTED",
      reason: "RATE_LIMIT_EXCEEDED",
      metadata: { quota_metric: quotaMetric, quota_limit: quotaLimit },
    });

    expect(withQuota).toContain(quotaMetric);
    expect(withQuota).toContain(quotaLimit);
    expect(withQuota).not.toBe(statusOnly);
  });

  test("the three 400s are told apart: unknown field, missing required field, and an opaque rejection", () => {
    const unknownField: string = GoogleSecOpsClient.describeHttpFailure(
      400,
      PRODUCTION_ERROR_BODY,
    );

    const missingRequired: string = GoogleSecOpsClient.describeHttpFailure(
      400,
      streamErrorBody(
        googleError({
          code: 400,
          status: "INVALID_ARGUMENT",
          message:
            "Invalid JSON payload received. Missing required field 'snapshotQuery'.",
          details: [badRequestDetail("Required field is missing.")],
        }),
      ),
    );

    const opaque: string = GoogleSecOpsClient.describeHttpFailure(
      400,
      "Bad Request",
    );

    for (const hint of [unknownField, missingRequired, opaque]) {
      expect(hint).not.toBe("");
    }

    /*
     * All three are OneUptime bugs, but the fix differs: stop sending a
     * field, start sending one, or go and read the transcoder's complaint.
     */
    const distinct: Set<string> = new Set<string>([
      unknownField,
      missingRequired,
      opaque,
    ]);
    expect(distinct.size).toBe(3);
  });
});

describe("GoogleSecOpsClient HTTP failures as the operator reads them", () => {
  test("an array-wrapped 403 is echoed whole and carries the IAM guidance on its tail", async () => {
    const denied: JSONObject = googleError({
      code: 403,
      status: "PERMISSION_DENIED",
      message: "The caller does not have permission.",
      details: [
        errorInfoDetail("IAM_PERMISSION_DENIED", {
          resource: IAM_RESOURCE,
          permission: IAM_PERMISSION,
        }),
      ],
    });

    const body: string = streamErrorBody(denied);
    const guidance: string = GoogleSecOpsClient.describeHttpFailure(403, body);

    const failure: AlertsFailure = await alertsFailure({
      status: 403,
      body: body,
    });

    expect(failure.error).toBeInstanceOf(APIException);
    expect(failure.error.message).toContain("HTTP 403");

    // The whole body, so error.code and error.status reach the operator.
    expect(failure.error.message).toContain(body);

    // ...and the guidance naming the exact grant to make, behind it.
    expect(failure.error.message.endsWith(guidance)).toBe(true);
    expect(guidance).toContain(IAM_PERMISSION);
    expect(guidance).toContain(IAM_RESOURCE);

    // A 403 is final: only the 401 branch re-mints a token and retries.
    expect(alertsRequestsIn(failure.requests)).toHaveLength(1);
    expect(tokenRequestsIn(failure.requests)).toHaveLength(1);
  });

  test("a bare 401 gets the same treatment as the wrapped shape, after one fresh-token retry", async () => {
    const unauthenticated: JSONObject = googleError({
      code: 401,
      status: "UNAUTHENTICATED",
      message:
        "Request had invalid authentication credentials. Expected OAuth 2 access token.",
    });

    const body: string = bareErrorBody(unauthenticated);

    /*
     * Derived from the ARRAY-WRAPPED spelling of the same error, so the
     * end-to-end assertion below is the both-shapes claim proven through
     * the real transport rather than restated against the same input.
     */
    const guidance: string = GoogleSecOpsClient.describeHttpFailure(
      401,
      streamErrorBody(unauthenticated),
    );

    const failure: AlertsFailure = await alertsFailure({
      status: 401,
      body: body,
    });

    expect(failure.error).toBeInstanceOf(APIException);
    expect(failure.error.message).toContain("HTTP 401");
    expect(failure.error.message).toContain(body);

    expect(guidance).not.toBe("");
    expect(failure.error.message.endsWith(guidance)).toBe(true);

    // A token revoked mid-lifetime deserves exactly one retry, not a loop.
    expect(alertsRequestsIn(failure.requests)).toHaveLength(2);
    expect(tokenRequestsIn(failure.requests)).toHaveLength(2);
  });

  test("a 429 reaches the operator classified as RESOURCE_EXHAUSTED with a back-off instruction", async () => {
    const body: string = streamErrorBody(
      googleError({
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message: "Quota exceeded for quota metric 'Legacy fetch alerts'.",
      }),
    );

    const guidance: string = GoogleSecOpsClient.describeHttpFailure(429, body);
    const failure: AlertsFailure = await alertsFailure({
      status: 429,
      body: body,
    });

    expect(failure.error.message).toContain("HTTP 429");
    expect(failure.error.message).toContain(body);
    expect(failure.error.message.endsWith(guidance)).toBe(true);

    // The classification has to come from the guidance, not from the echo.
    expect(guidance).toContain("RESOURCE_EXHAUSTED");
  });

  test("a long body is echoed to exactly the first 500 characters and no further", async () => {
    const head: string = `${"A".repeat(BODY_ECHO_LIMIT - 1)}Z`;
    const tailMarker: string = "TAIL-BEYOND-THE-ECHO-LIMIT";

    const failure: AlertsFailure = await alertsFailure({
      status: 500,
      body: `${head}${tailMarker}${"B".repeat(600)}`,
    });

    /*
     * The echo is the tail of the message for a 500 (no guidance branch
     * applies), so slicing from the body's first byte isolates it exactly.
     */
    const echoed: string = failure.error.message.slice(
      failure.error.message.indexOf("A"),
    );

    expect(echoed).toHaveLength(BODY_ECHO_LIMIT);
    expect(echoed).toBe(head);
    expect(failure.error.message).not.toContain(tailMarker);
  });
});

describe("the pageSize 400 reported from production", () => {
  test("the reported body is a transcoder error: BadRequest details and no ErrorInfo", () => {
    const parsed: Array<JSONObject> = JSON.parse(
      PRODUCTION_ERROR_BODY,
    ) as Array<JSONObject>;

    expect(Array.isArray(parsed)).toBe(true);

    const error: JSONObject = parsed[0]!["error"] as JSONObject;
    expect(error["code"]).toBe(400);
    expect(error["status"]).toBe("INVALID_ARGUMENT");

    const detailTypes: Array<string> = (
      error["details"] as Array<JSONObject>
    ).map((detail: JSONObject): string => {
      return String(detail["@type"]);
    });

    expect(detailTypes).toEqual(["type.googleapis.com/google.rpc.BadRequest"]);

    /*
     * AIP-193 requires a service-generated error to carry ErrorInfo. This
     * one carries none, which is what proves it came from the HTTP
     * transcoder rather than from Chronicle — and authn runs ahead of
     * transcoding, so the customer's credentials had already been accepted.
     */
    expect(
      detailTypes.some((type: string): boolean => {
        return type.endsWith("google.rpc.ErrorInfo");
      }),
    ).toBe(false);
  });

  test("it is classified as a OneUptime request-shape bug, never as a credential or permission problem", () => {
    const hint: string = GoogleSecOpsClient.describeHttpFailure(
      400,
      PRODUCTION_ERROR_BODY,
    );

    expect(hint).not.toBe("");
    expect(hint).toMatch(/OneUptime/);
    expect(hint).toMatch(/not a credential or permission problem/i);

    /*
     * The message an operator is sent to must not be any of the ones that
     * would have them regenerate a key or edit an IAM binding.
     */
    const credentialGuidance: Array<string> = [
      GoogleSecOpsClient.describeHttpFailure(401, ""),
      GoogleSecOpsClient.describeHttpFailure(403, ""),
      hintForErrorInfo({
        httpStatus: 401,
        rpcStatus: "UNAUTHENTICATED",
        reason: "CREDENTIALS_MISSING",
      }),
      hintForErrorInfo({
        httpStatus: 401,
        rpcStatus: "UNAUTHENTICATED",
        reason: "ACCESS_TOKEN_EXPIRED",
      }),
      hintForErrorInfo({
        httpStatus: 403,
        rpcStatus: "PERMISSION_DENIED",
        reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
      }),
      hintForErrorInfo({
        httpStatus: 403,
        rpcStatus: "PERMISSION_DENIED",
        reason: "IAM_PERMISSION_DENIED",
        metadata: { resource: IAM_RESOURCE, permission: IAM_PERMISSION },
      }),
    ];

    for (const guidance of credentialGuidance) {
      expect(guidance).not.toBe("");
    }

    expect(credentialGuidance).not.toContain(hint);
  });

  test("end to end the customer's body reaches Last Error verbatim with the actionable hint appended", async () => {
    const guidance: string = GoogleSecOpsClient.describeHttpFailure(
      400,
      PRODUCTION_ERROR_BODY,
    );

    const failure: AlertsFailure = await alertsFailure({
      status: 400,
      body: PRODUCTION_ERROR_BODY,
    });

    expect(failure.error).toBeInstanceOf(APIException);
    expect(failure.error.message).toContain("HTTP 400");

    // 398 bytes, so the echo carries the whole thing under the 500 cap.
    expect(failure.error.message).toContain(PRODUCTION_ERROR_BODY);

    expect(guidance).not.toBe("");
    expect(failure.error.message.endsWith(guidance)).toBe(true);
  });

  test("the request the client now builds carries no pageSize, so this 400 cannot recur", async () => {
    const { client, requests } = makeClient({
      token: okTokenResponse(),
      alerts: {
        status: 200,
        body: JSON.stringify([
          { alerts: { alerts: [{ id: "a-1" }] }, complete: true, progress: 1 },
        ]),
      },
    });

    const result: FetchAlertsResult = await client.fetchDetectionAlerts({
      startTime: WINDOW_START,
      endTime: WINDOW_END,
    });

    expect(result.alerts).toHaveLength(1);

    const params: URLSearchParams = new URL(alertsRequestsIn(requests)[0]!.url)
      .searchParams;

    expect(params.has("pageSize")).toBe(false);

    /*
     * The whole key set, not just the absent one: the bug shipped because
     * the existing assertions matched on the encoded ISO value, which
     * stays green no matter what the key around it is called.
     */
    expect(Array.from(params.keys()).sort()).toEqual([
      "alertListOptions.maxReturnedAlerts",
      "timeRange.endTime",
      "timeRange.startTime",
    ]);
  });
});
