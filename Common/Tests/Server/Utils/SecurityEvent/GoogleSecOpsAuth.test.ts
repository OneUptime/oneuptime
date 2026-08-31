import { generateKeyPairSync } from "crypto";
import jwt from "jsonwebtoken";
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
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The service-account half of the SecOps client: the RS256 assertion it
 * signs, the token it caches, and what it does when Google refuses the
 * token it is holding.
 *
 * The existing client suite only `jwt.decode`s the assertion and throws
 * the public key from generateKeyPairSync away, so an assertion carrying
 * `alg: "none"` and no signature at all satisfies every claim assertion it
 * makes. Everything here that reads a claim reads it out of
 * `jwt.verify(assertion, publicKey, { algorithms: ["RS256"] })`, so the
 * claims are only ever asserted on a body whose signature was checked
 * against the key the credential actually carries.
 *
 * Anything that turns on elapsed time drives a spied Date.now rather than
 * the wall clock, because the cache boundaries under test are an hour
 * apart and one of them is exactly on the slack edge.
 */

/*
 * Module scope on purpose: a real 2048-bit key, generated once. jwt.sign
 * genuinely parses this, so a placeholder string fails inside the signer
 * long before any assertion in this file runs.
 */
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const CLIENT_EMAIL: string = "poller@example.iam.gserviceaccount.com";

/* Google's real OAuth host: token_uri is allowlisted, so a stand-in fails validation. */
const TOKEN_URI: string = "https://oauth2.googleapis.com/token";

const SERVICE_ACCOUNT_JSON: string = JSON.stringify({
  client_email: CLIENT_EMAIL,
  private_key: privateKey,
  token_uri: TOKEN_URI,
});

const INSTANCE: string =
  "projects/my-project/locations/us/instances/3f0a-instance";

const CHRONICLE_SCOPE: string =
  "https://www.googleapis.com/auth/cloud-platform";

/*
 * The three auth constants this file pins. They are duplicated rather than
 * exported from the client because a test that imported them would move
 * with any edit to them and stop being a check on anything.
 */
const TOKEN_LIFETIME_IN_SECONDS: number = 3600;
const TOKEN_EXPIRY_SLACK_IN_SECONDS: number = 60;
const TOKEN_CLOCK_SKEW_IN_SECONDS: number = 60;

const BASE_TIME_IN_MS: number = new Date("2026-08-21T09:00:00.000Z").getTime();
const WINDOW_START_ISO: string = "2026-08-21T09:00:00.000Z";
const WINDOW_END_ISO: string = "2026-08-21T10:00:00.000Z";

const UNAUTHENTICATED_BODY: string = JSON.stringify({
  error: {
    code: 401,
    status: "UNAUTHENTICATED",
    message: "Request had invalid authentication credentials.",
  },
});

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

interface Transport {
  fetchImplementation: FetchLike;
  requests: Array<RecordedRequest>;
}

interface StubbedEndpoints {
  token: Array<StubbedResponse>;
  alerts: Array<StubbedResponse>;
}

/*
 * Routed by host and queued per endpoint rather than by call ordinal: the
 * 401 path issues a second token exchange in the middle of the alerts
 * sequence, so ordinal routing cannot express "the second token" and "the
 * second alerts attempt" at the same time. Each queue repeats its last
 * entry, so a queue of one is "answer this way every time".
 */
function makeFetch(responses: StubbedEndpoints): Transport {
  const requests: Array<RecordedRequest> = [];
  let tokenCallIndex: number = 0;
  let alertsCallIndex: number = 0;

  const fetchImplementation: FetchLike = (
    url: string,
    init: FetchInitLike,
  ): Promise<FetchResponseLike> => {
    requests.push({
      url: url,
      method: init.method,
      headers: init.headers,
      body: init.body,
    });

    const isTokenCall: boolean = url === TOKEN_URI;
    const queue: Array<StubbedResponse> = isTokenCall
      ? responses.token
      : responses.alerts;
    const index: number = isTokenCall ? tokenCallIndex++ : alertsCallIndex++;
    const response: StubbedResponse = queue[
      Math.min(index, queue.length - 1)
    ] as StubbedResponse;

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

function makeClient(responses: StubbedEndpoints): {
  client: GoogleSecOpsClient;
  requests: Array<RecordedRequest>;
} {
  const { fetchImplementation, requests } = makeFetch(responses);

  const client: GoogleSecOpsClient = new GoogleSecOpsClient({
    region: "us",
    instanceResourceName: INSTANCE,
    serviceAccountJson: SERVICE_ACCOUNT_JSON,
    fetchImplementation: fetchImplementation,
  });

  return { client: client, requests: requests };
}

function fetchWindow(client: GoogleSecOpsClient): Promise<FetchAlertsResult> {
  return client.fetchDetectionAlerts({
    startTime: new Date(WINDOW_START_ISO),
    endTime: new Date(WINDOW_END_ISO),
  });
}

function tokenResponse(fields: JSONObject): StubbedResponse {
  return { status: 200, body: JSON.stringify(fields) };
}

/* The streaming envelope, so the auth paths end at a genuinely parseable body. */
function alertsResponse(alertIds: Array<string>): StubbedResponse {
  return {
    status: 200,
    body: JSON.stringify([
      {
        alerts: {
          alerts: alertIds.map((id: string): JSONObject => {
            return { id: id };
          }),
        },
        complete: true,
        progress: 1,
      },
    ]),
  };
}

function tokenRequests(
  requests: Array<RecordedRequest>,
): Array<RecordedRequest> {
  return requests.filter((request: RecordedRequest): boolean => {
    return request.url === TOKEN_URI;
  });
}

function alertsRequests(
  requests: Array<RecordedRequest>,
): Array<RecordedRequest> {
  return requests.filter((request: RecordedRequest): boolean => {
    return request.url !== TOKEN_URI;
  });
}

/*
 * Which minted token each Chronicle call actually carried. This is the
 * only observable difference between "the cache was reused" and "a fresh
 * token was fetched and then used", which several tests below turn on.
 */
function bearerTokens(requests: Array<RecordedRequest>): Array<string> {
  return alertsRequests(requests).map((request: RecordedRequest): string => {
    return request.headers["Authorization"] || "";
  });
}

function assertionFrom(request: RecordedRequest): string {
  const params: URLSearchParams = new URLSearchParams(request.body || "");

  return params.get("assertion") || "";
}

/*
 * Verify, never decode. Passing the public key and pinning the algorithm
 * is what makes every claim assertion downstream of it meaningful: an
 * assertion signed with alg "none", with the wrong key, or with a tampered
 * payload fails here rather than sailing through.
 */
function verifiedAssertion(request: RecordedRequest): JSONObject {
  return jwt.verify(assertionFrom(request), publicKey, {
    algorithms: ["RS256"],
    // Read through the same Date.now the client signed against.
    clockTimestamp: Math.floor(Date.now() / 1000),
  }) as unknown as JSONObject;
}

function assertionHeader(request: RecordedRequest): JSONObject {
  const decoded: JSONObject = jwt.decode(assertionFrom(request), {
    complete: true,
  }) as unknown as JSONObject;

  return decoded["header"] as JSONObject;
}

interface FakeClock {
  advanceBy: (milliseconds: number) => void;
}

/*
 * Closure-scoped rather than a module-level `now`, so no test can inherit
 * another's clock position.
 */
function installFakeClock(baseTimeInMs: number): FakeClock {
  let nowInMs: number = baseTimeInMs;

  getJestSpyOn(Date, "now").mockImplementation(((): number => {
    return nowInMs;
  }) as never);

  return {
    advanceBy: (milliseconds: number): void => {
      nowInMs = nowInMs + milliseconds;
    },
  };
}

async function captureRejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected GoogleSecOpsClient to reject, but it resolved.");
}

/* Capture logger.warn without letting it reach the telemetry logger. */
function captureWarnings(): Array<string> {
  const warnings: Array<string> = [];

  getJestSpyOn(logger, "warn").mockImplementation(((message: string): void => {
    warnings.push(String(message));
  }) as never);

  return warnings;
}

describe("GoogleSecOpsClient JWT assertion", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("signs an RS256 assertion that verifies against the service account's own public key", async () => {
    const { client, requests } = makeClient({
      token: [tokenResponse({ access_token: "token-1", expires_in: 3600 })],
      alerts: [alertsResponse(["alert-1"])],
    });

    await fetchWindow(client);

    const tokenCalls: Array<RecordedRequest> = tokenRequests(requests);
    expect(tokenCalls).toHaveLength(1);

    const payload: JSONObject = verifiedAssertion(
      tokenCalls[0] as RecordedRequest,
    );

    expect(payload["iss"]).toBe(CLIENT_EMAIL);
    expect(payload["aud"]).toBe(TOKEN_URI);
    expect(payload["scope"]).toBe(CHRONICLE_SCOPE);
  });

  test("declares RS256 in the JOSE header rather than relying on the verifier's default", async () => {
    const { client, requests } = makeClient({
      token: [tokenResponse({ access_token: "token-1", expires_in: 3600 })],
      alerts: [alertsResponse(["alert-1"])],
    });

    await fetchWindow(client);

    const header: JSONObject = assertionHeader(
      tokenRequests(requests)[0] as RecordedRequest,
    );

    expect(header["alg"]).toBe("RS256");
    expect(header["typ"]).toBe("JWT");
  });

  test("posts exactly the JWT-bearer grant form to token_uri", async () => {
    const { client, requests } = makeClient({
      token: [tokenResponse({ access_token: "token-1", expires_in: 3600 })],
      alerts: [alertsResponse(["alert-1"])],
    });

    await fetchWindow(client);

    const tokenRequest: RecordedRequest = tokenRequests(
      requests,
    )[0] as RecordedRequest;

    expect(tokenRequest.url).toBe(TOKEN_URI);
    expect(tokenRequest.method).toBe("POST");
    expect(Object.keys(tokenRequest.headers).sort()).toEqual(["Content-Type"]);
    expect(tokenRequest.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );

    const params: URLSearchParams = new URLSearchParams(
      tokenRequest.body || "",
    );

    expect(Array.from(params.keys()).sort()).toEqual([
      "assertion",
      "grant_type",
    ]);
    expect(params.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
  });

  test("backdates iat by the clock-skew allowance and keeps exp - iat at exactly 3600", async () => {
    installFakeClock(BASE_TIME_IN_MS);

    const { client, requests } = makeClient({
      token: [tokenResponse({ access_token: "token-1", expires_in: 3600 })],
      alerts: [alertsResponse(["alert-1"])],
    });

    await fetchWindow(client);

    const nowInSeconds: number = Math.floor(BASE_TIME_IN_MS / 1000);
    const payload: JSONObject = verifiedAssertion(
      tokenRequests(requests)[0] as RecordedRequest,
    );

    const issuedAt: number = payload["iat"] as number;
    const expiresAt: number = payload["exp"] as number;

    expect(issuedAt).toBe(nowInSeconds - TOKEN_CLOCK_SKEW_IN_SECONDS);
    expect(expiresAt - issuedAt).toBe(TOKEN_LIFETIME_IN_SECONDS);

    /*
     * The skew is spent shortening the token, not extending it: 3600 is
     * Google's hard maximum measured from the receiving clock, so exp must
     * still land at or inside now + 3600.
     */
    expect(expiresAt).toBeLessThan(nowInSeconds + TOKEN_LIFETIME_IN_SECONDS);
  });
});

describe("GoogleSecOpsClient access token caching", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an expires_in inside the 60 second slack is already expired, one outside it is reused", async () => {
    installFakeClock(BASE_TIME_IN_MS);

    const insideSlack: {
      client: GoogleSecOpsClient;
      requests: Array<RecordedRequest>;
    } = makeClient({
      token: [
        tokenResponse({
          access_token: "token-1",
          expires_in: TOKEN_EXPIRY_SLACK_IN_SECONDS - 30,
        }),
        tokenResponse({
          access_token: "token-2",
          expires_in: TOKEN_EXPIRY_SLACK_IN_SECONDS - 30,
        }),
      ],
      alerts: [alertsResponse(["alert-1"])],
    });

    await fetchWindow(insideSlack.client);
    await fetchWindow(insideSlack.client);

    expect(tokenRequests(insideSlack.requests)).toHaveLength(2);
    expect(bearerTokens(insideSlack.requests)).toEqual([
      "Bearer token-1",
      "Bearer token-2",
    ]);

    // Same clock, same two calls, lifetime moved just outside the slack.
    const outsideSlack: {
      client: GoogleSecOpsClient;
      requests: Array<RecordedRequest>;
    } = makeClient({
      token: [
        tokenResponse({
          access_token: "token-3",
          expires_in: TOKEN_EXPIRY_SLACK_IN_SECONDS + 30,
        }),
        tokenResponse({
          access_token: "token-4",
          expires_in: TOKEN_EXPIRY_SLACK_IN_SECONDS + 30,
        }),
      ],
      alerts: [alertsResponse(["alert-1"])],
    });

    await fetchWindow(outsideSlack.client);
    await fetchWindow(outsideSlack.client);

    expect(tokenRequests(outsideSlack.requests)).toHaveLength(1);
    expect(bearerTokens(outsideSlack.requests)).toEqual([
      "Bearer token-3",
      "Bearer token-3",
    ]);
  });

  test("an absent expires_in caches for 3600 seconds, and re-mints once the slack window opens", async () => {
    const clock: FakeClock = installFakeClock(BASE_TIME_IN_MS);

    const { client, requests } = makeClient({
      token: [
        tokenResponse({ access_token: "token-1" }),
        tokenResponse({ access_token: "token-2" }),
      ],
      alerts: [alertsResponse(["alert-1"])],
    });

    await fetchWindow(client);
    expect(tokenRequests(requests)).toHaveLength(1);

    // One second short of the slack edge: still the first token.
    clock.advanceBy(
      (TOKEN_LIFETIME_IN_SECONDS - TOKEN_EXPIRY_SLACK_IN_SECONDS - 1) * 1000,
    );
    await fetchWindow(client);
    expect(tokenRequests(requests)).toHaveLength(1);

    // On the edge: a second exchange, and the new token is the one sent.
    clock.advanceBy(1000);
    await fetchWindow(client);
    expect(tokenRequests(requests)).toHaveLength(2);

    expect(bearerTokens(requests)).toEqual([
      "Bearer token-1",
      "Bearer token-1",
      "Bearer token-2",
    ]);
  });

  test("an unusable expires_in is never cached and never becomes NaN", async () => {
    installFakeClock(BASE_TIME_IN_MS);

    const warnings: Array<string> = captureWarnings();

    /*
     * Zero and negatives are nonsense lifetimes; the strings are what a
     * proxy or a proto3 int64 rendering can put there. All five have to
     * land in the same place — mint a fresh token next time — rather than
     * an hour of caching a dead token or a NaN expiry.
     */
    const unusableValues: Array<string | number> = [
      0,
      -30,
      "0",
      "not-a-number",
      "NaN",
    ];

    for (const unusable of unusableValues) {
      const { client, requests } = makeClient({
        token: [
          tokenResponse({ access_token: "token-1", expires_in: unusable }),
          tokenResponse({ access_token: "token-2", expires_in: unusable }),
        ],
        alerts: [alertsResponse(["alert-1"])],
      });

      warnings.length = 0;

      await fetchWindow(client);
      await fetchWindow(client);

      expect(tokenRequests(requests)).toHaveLength(2);
      expect(bearerTokens(requests)).toEqual([
        "Bearer token-1",
        "Bearer token-2",
      ]);

      // Refusing to cache is a decision worth logging, once per exchange.
      expect(warnings).toHaveLength(2);
    }
  });

  test("a numeric-string expires_in is coerced and cached rather than treated as unusable", async () => {
    installFakeClock(BASE_TIME_IN_MS);

    const warnings: Array<string> = captureWarnings();

    const { client, requests } = makeClient({
      token: [
        tokenResponse({ access_token: "token-1", expires_in: "1800" }),
        tokenResponse({ access_token: "token-2", expires_in: "1800" }),
      ],
      alerts: [alertsResponse(["alert-1"])],
    });

    await fetchWindow(client);
    await fetchWindow(client);

    expect(tokenRequests(requests)).toHaveLength(1);
    expect(bearerTokens(requests)).toEqual([
      "Bearer token-1",
      "Bearer token-1",
    ]);
    expect(warnings).toHaveLength(0);
  });
});

describe("GoogleSecOpsClient token response failures", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a 200 with no usable access_token throws APIException before Chronicle is contacted", async () => {
    const bodies: Array<string> = [
      JSON.stringify({ expires_in: 3600 }),
      JSON.stringify({ access_token: "", expires_in: 3600 }),
      JSON.stringify({ access_token: null, expires_in: 3600 }),
      JSON.stringify({}),
    ];

    for (const body of bodies) {
      const { client, requests } = makeClient({
        token: [{ status: 200, body: body }],
        alerts: [alertsResponse(["alert-1"])],
      });

      const error: Error = await captureRejection(fetchWindow(client));

      expect(error).toBeInstanceOf(APIException);
      expect(tokenRequests(requests)).toHaveLength(1);
      // A credential we never resolved must not reach Chronicle at all.
      expect(alertsRequests(requests)).toHaveLength(0);
    }
  });

  test("a 200 token body that is not a JSON object throws APIException, not a raw SyntaxError", async () => {
    /*
     * The first is a captive portal or SSO interstitial answering 200,
     * which is what made this a JSON.parse crash outside the failure
     * taxonomy rather than a reportable connector error.
     */
    const bodies: Array<string> = [
      "<!doctype html><html><body>Sign in to continue</body></html>",
      "[]",
      '"an-access-token"',
      "null",
      "",
    ];

    for (const body of bodies) {
      const { client, requests } = makeClient({
        token: [{ status: 200, body: body }],
        alerts: [alertsResponse(["alert-1"])],
      });

      const error: Error = await captureRejection(fetchWindow(client));

      expect(error).toBeInstanceOf(APIException);
      expect(error).not.toBeInstanceOf(SyntaxError);
      expect(alertsRequests(requests)).toHaveLength(0);
    }
  });

  test("a 401 from the token endpoint is not retried", async () => {
    const { client, requests } = makeClient({
      token: [{ status: 401, body: UNAUTHENTICATED_BODY }],
      alerts: [alertsResponse(["alert-1"])],
    });

    const error: Error = await captureRejection(fetchWindow(client));

    expect(error).toBeInstanceOf(APIException);
    /*
     * The single-retry allowance belongs to the alerts call. A credential
     * Google rejects at the OAuth endpoint is rejected, and re-signing the
     * same key would only double the rate against a rate limiter.
     */
    expect(tokenRequests(requests)).toHaveLength(1);
    expect(alertsRequests(requests)).toHaveLength(0);
  });
});

describe("GoogleSecOpsClient 401 on the alerts call", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("clears the cached token, retries once with a freshly minted one, and caches the replacement", async () => {
    installFakeClock(BASE_TIME_IN_MS);

    const { client, requests } = makeClient({
      token: [
        tokenResponse({ access_token: "token-1", expires_in: 3600 }),
        tokenResponse({ access_token: "token-2", expires_in: 3600 }),
      ],
      alerts: [
        { status: 401, body: UNAUTHENTICATED_BODY },
        alertsResponse(["alert-1", "alert-2"]),
        alertsResponse(["alert-3"]),
      ],
    });

    const first: FetchAlertsResult = await fetchWindow(client);

    expect(first.alerts).toEqual([{ id: "alert-1" }, { id: "alert-2" }]);
    expect(first.complete).toBe(true);

    expect(tokenRequests(requests)).toHaveLength(2);
    expect(alertsRequests(requests)).toHaveLength(2);

    /*
     * token-1 was cached for an hour and would have been reused; the
     * second Bearer is the whole point of clearing the cache first.
     */
    expect(bearerTokens(requests)).toEqual([
      "Bearer token-1",
      "Bearer token-2",
    ]);

    // The retry re-sends the same request, not a re-derived window.
    const attempts: Array<RecordedRequest> = alertsRequests(requests);
    expect((attempts[1] as RecordedRequest).url).toBe(
      (attempts[0] as RecordedRequest).url,
    );
    expect((attempts[1] as RecordedRequest).method).toBe("GET");

    const second: FetchAlertsResult = await fetchWindow(client);

    expect(second.alerts).toEqual([{ id: "alert-3" }]);
    // The replacement token is cached like any other: still two exchanges.
    expect(tokenRequests(requests)).toHaveLength(2);
    expect(alertsRequests(requests)).toHaveLength(3);
    expect(bearerTokens(requests)[2]).toBe("Bearer token-2");
  });

  test("a 401 on the retry is surfaced, not retried again", async () => {
    installFakeClock(BASE_TIME_IN_MS);

    const { client, requests } = makeClient({
      token: [
        tokenResponse({ access_token: "token-1", expires_in: 3600 }),
        tokenResponse({ access_token: "token-2", expires_in: 3600 }),
      ],
      alerts: [{ status: 401, body: UNAUTHENTICATED_BODY }],
    });

    const error: Error = await captureRejection(fetchWindow(client));

    expect(error).toBeInstanceOf(APIException);
    expect(tokenRequests(requests)).toHaveLength(2);
    expect(alertsRequests(requests)).toHaveLength(2);
    expect(bearerTokens(requests)).toEqual([
      "Bearer token-1",
      "Bearer token-2",
    ]);
  });

  test("a non-401 alerts failure does not touch the cached token", async () => {
    installFakeClock(BASE_TIME_IN_MS);

    const { client, requests } = makeClient({
      token: [
        tokenResponse({ access_token: "token-1", expires_in: 3600 }),
        tokenResponse({ access_token: "token-2", expires_in: 3600 }),
      ],
      alerts: [{ status: 403, body: "permission denied" }],
    });

    const error: Error = await captureRejection(fetchWindow(client));

    expect(error).toBeInstanceOf(APIException);
    // One exchange, one attempt: 403 is a verdict on the caller, not the token.
    expect(tokenRequests(requests)).toHaveLength(1);
    expect(alertsRequests(requests)).toHaveLength(1);
  });
});
