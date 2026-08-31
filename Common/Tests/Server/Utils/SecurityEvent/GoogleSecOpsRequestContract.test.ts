import { generateKeyPairSync } from "crypto";
import GoogleSecOpsClient, {
  FetchAlertsResult,
  FetchInitLike,
  FetchLike,
  FetchResponseLike,
  GoogleServiceAccountCredentials,
} from "../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsClient";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * The wire contract of the alerts request, asserted by parsing.
 *
 * This connector shipped broken for one reason: the only request coverage
 * that existed was `toContain` on the path prefix and on the encoded ISO
 * timestamp, and both stay green under ANY parameter rename. A query
 * string carrying `pageSize` — a parameter this endpoint does not have —
 * passed every test run and 400'd at Google's transcoder in production.
 * So nothing here matches a substring of a URL: every parameter assertion
 * goes through `new URL(...).searchParams` and pins the SORTED KEY LIST,
 * which fails on an extra, a renamed, or a missing key alike.
 *
 * The second half pins the validation standing between a customer-supplied
 * connection row and an outbound request — the region allowlist, the
 * region/location cross-check, the token_uri host pin, the service-account
 * parse and the instance-name shape. Each of those used to admit something
 * that either could not work or should never have been reachable.
 */

/*
 * Google's real OAuth endpoint. It is also the routing key for the
 * injected transport below: the token exchange and the Chronicle call are
 * told apart by host, never by call order, so a test asserting on "the
 * alerts request" cannot accidentally be asserting on the token POST.
 */
const GOOGLE_TOKEN_URI: string = "https://oauth2.googleapis.com/token";

/*
 * A real RS256 key, because the client genuinely signs a JWT assertion
 * before it ever reaches Chronicle; a fake key fails inside jwt.sign and
 * the request under test is never built.
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

const INSTANCE: string =
  "projects/my-project/locations/us/instances/3f0a-instance";

const ACCESS_TOKEN: string = "ya29.test-access-token";

const WINDOW_START: Date = new Date("2026-08-21T09:00:00.000Z");
const WINDOW_END: Date = new Date("2026-08-21T10:00:00.000Z");

/*
 * The whole parameter set, sorted. Kept as one constant so every request
 * test asserts the same closed list rather than each one checking the
 * subset it happens to care about.
 */
const EXPECTED_QUERY_KEYS: Array<string> = [
  "alertListOptions.maxReturnedAlerts",
  "timeRange.endTime",
  "timeRange.startTime",
];

/*
 * The 22 documented {region}-chronicle.googleapis.com prefixes. Written
 * out rather than imported because the point is to pin the set against the
 * documentation, not against whatever the module currently holds.
 */
const DOCUMENTED_REGION_PREFIXES: Array<string> = [
  "us",
  "eu",
  "europe",
  "africa-south1",
  "asia-east1",
  "asia-northeast1",
  "asia-northeast3",
  "asia-south1",
  "asia-southeast1",
  "asia-southeast2",
  "australia-southeast1",
  "europe-central2",
  "europe-west12",
  "europe-west2",
  "europe-west3",
  "europe-west6",
  "europe-west9",
  "me-central1",
  "me-central2",
  "me-west1",
  "northamerica-northeast2",
  "southamerica-east1",
];

interface StubbedResponse {
  status: number;
  body: string;
}

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function okTokenResponse(): StubbedResponse {
  return {
    status: 200,
    body: JSON.stringify({ access_token: ACCESS_TOKEN, expires_in: 3600 }),
  };
}

/*
 * The canonical streaming envelope: an array of one chunk with the alerts
 * two levels down at alerts.alerts[]. complete is set so no test on this
 * path trips the partial-window warning and turns into log noise.
 */
function okAlertsResponse(): StubbedResponse {
  return {
    status: 200,
    body: JSON.stringify([
      {
        alerts: { alerts: [{ id: "alert-1" }] },
        complete: true,
        progress: 1,
      },
    ]),
  };
}

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

function makeClient(overrides?: {
  region?: string | undefined;
  instanceResourceName?: string | undefined;
}): { client: GoogleSecOpsClient; requests: Array<RecordedRequest> } {
  const { fetchImplementation, requests } = makeFetch({
    token: okTokenResponse(),
    alerts: okAlertsResponse(),
  });

  const client: GoogleSecOpsClient = new GoogleSecOpsClient({
    region: overrides?.region || "us",
    instanceResourceName: overrides?.instanceResourceName || INSTANCE,
    serviceAccountJson: SERVICE_ACCOUNT_JSON,
    fetchImplementation: fetchImplementation,
  });

  return { client: client, requests: requests };
}

/*
 * For the tests that only construct a client. A transport that throws on
 * use proves construction really is offline, so a validation assertion can
 * never be satisfied by a round trip nobody noticed.
 */
function neverCalledFetch(): FetchLike {
  return (): Promise<FetchResponseLike> => {
    throw new Error(
      "This test constructs a client only; no HTTP request was expected.",
    );
  };
}

/*
 * The Chronicle request, isolated from the token exchange by host. Throws
 * rather than returning the wrong one, so a routing mistake in the harness
 * can never be read as a passing request-shape assertion.
 */
function alertsRequestIn(requests: Array<RecordedRequest>): RecordedRequest {
  const chronicleRequests: Array<RecordedRequest> = requests.filter(
    (request: RecordedRequest): boolean => {
      return request.url !== GOOGLE_TOKEN_URI;
    },
  );

  if (chronicleRequests.length !== 1) {
    throw new Error(
      `Expected exactly one Chronicle request, recorded ${chronicleRequests.length}.`,
    );
  }

  return chronicleRequests[0]!;
}

function queryParamsOf(request: RecordedRequest): URLSearchParams {
  return new URL(request.url).searchParams;
}

function sortedQueryKeysOf(request: RecordedRequest): Array<string> {
  const keys: Array<string> = [];

  queryParamsOf(request).forEach((_value: string, key: string): void => {
    keys.push(key);
  });

  return keys.sort();
}

/*
 * The query string as it actually goes on the wire, before URLSearchParams
 * decodes it. Encoding is load-bearing in both directions: the transcoder
 * binds on the literal field path, so the `.` must survive as a `.`, while
 * the `:` in an RFC 3339 timestamp must not survive as a `:`.
 */
function rawQueryPairsOf(request: RecordedRequest): Map<string, string> {
  const search: string = new URL(request.url).search;
  const query: string = search.startsWith("?") ? search.slice(1) : search;
  const pairs: Map<string, string> = new Map<string, string>();

  if (!query) {
    return pairs;
  }

  for (const pair of query.split("&")) {
    const separatorIndex: number = pair.indexOf("=");

    pairs.set(
      separatorIndex === -1 ? pair : pair.slice(0, separatorIndex),
      separatorIndex === -1 ? "" : pair.slice(separatorIndex + 1),
    );
  }

  return pairs;
}

function sortedKeysOf(pairs: Map<string, string>): Array<string> {
  const keys: Array<string> = [];

  pairs.forEach((_value: string, key: string): void => {
    keys.push(key);
  });

  return keys.sort();
}

function errorThrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }

  throw new Error("Expected this call to throw, and it returned instead.");
}

function messageThrownBy(run: () => unknown): string {
  return (errorThrownBy(run) as Error).message;
}

function serviceAccountJsonWith(fields: Record<string, unknown>): string {
  return JSON.stringify({
    client_email: "poller@example.iam.gserviceaccount.com",
    private_key: privateKey,
    ...fields,
  });
}

describe("GoogleSecOpsClient alerts request parameters", () => {
  test("sends exactly the three documented field paths and nothing else", async () => {
    const { client, requests } = makeClient();

    const result: FetchAlertsResult = await client.fetchDetectionAlerts({
      startTime: WINDOW_START,
      endTime: WINDOW_END,
    });

    /*
     * The call genuinely completed against the canonical envelope, so what
     * follows is the shape of a request Chronicle answered, not the shape
     * of one that fell over half-built.
     */
    expect(result.alerts).toEqual([{ id: "alert-1" }]);
    expect(result.complete).toBe(true);

    // One token exchange, one Chronicle call, nothing else on the wire.
    expect(requests).toHaveLength(2);
    expect(
      requests.filter((request: RecordedRequest): boolean => {
        return request.url === GOOGLE_TOKEN_URI;
      }),
    ).toHaveLength(1);

    expect(sortedQueryKeysOf(alertsRequestIn(requests))).toEqual(
      EXPECTED_QUERY_KEYS,
    );
  });

  test("pins both ends of the window as RFC 3339 instants, read back by name", async () => {
    const { client, requests } = makeClient();

    await client.fetchDetectionAlerts({
      startTime: WINDOW_START,
      endTime: WINDOW_END,
    });

    const params: URLSearchParams = queryParamsOf(alertsRequestIn(requests));

    expect(params.get("timeRange.startTime")).toBe("2026-08-21T09:00:00.000Z");
    expect(params.get("timeRange.endTime")).toBe("2026-08-21T10:00:00.000Z");
  });

  test("defaults maxReturnedAlerts to 1000 and honours an explicit ceiling without adding a parameter", async () => {
    const defaultRun: {
      client: GoogleSecOpsClient;
      requests: Array<RecordedRequest>;
    } = makeClient();

    await defaultRun.client.fetchDetectionAlerts({
      startTime: WINDOW_START,
      endTime: WINDOW_END,
    });

    expect(
      queryParamsOf(alertsRequestIn(defaultRun.requests)).get(
        "alertListOptions.maxReturnedAlerts",
      ),
    ).toBe("1000");

    const cappedRun: {
      client: GoogleSecOpsClient;
      requests: Array<RecordedRequest>;
    } = makeClient();

    await cappedRun.client.fetchDetectionAlerts({
      startTime: WINDOW_START,
      endTime: WINDOW_END,
      maxAlerts: 50,
    });

    const cappedRequest: RecordedRequest = alertsRequestIn(cappedRun.requests);

    expect(
      queryParamsOf(cappedRequest).get("alertListOptions.maxReturnedAlerts"),
    ).toBe("50");

    /*
     * A ceiling is a value, not an extra knob. This endpoint has no
     * pagination of any kind, so nothing about asking for fewer alerts may
     * introduce a second parameter.
     */
    expect(sortedQueryKeysOf(cappedRequest)).toEqual(EXPECTED_QUERY_KEYS);
  });

  test("never sends pageSize, snapshotQuery or baselineQuery", async () => {
    const { client, requests } = makeClient();

    await client.fetchDetectionAlerts({
      startTime: WINDOW_START,
      endTime: WINDOW_END,
      maxAlerts: 25,
    });

    const request: RecordedRequest = alertsRequestIn(requests);
    const params: URLSearchParams = queryParamsOf(request);

    /*
     * First, that there is a query string at all. Every assertion below is
     * an absence check, and absence checks pass just as happily against a
     * URL that lost its parameters entirely.
     */
    expect(sortedQueryKeysOf(request)).toEqual(EXPECTED_QUERY_KEYS);

    /*
     * The regression tripwire. `pageSize` has no rename target — this
     * endpoint has no pageSize, no pageToken and no nextPageToken — so its
     * presence in any form is the exact production 400 coming back.
     */
    expect(params.has("pageSize")).toBe(false);
    expect(params.has("pageToken")).toBe(false);

    /*
     * Spec conflict C2, open and deliberately unsettled here. The reference
     * doc prefixes snapshotQuery with `Required.`, but that is a
     * field_behavior annotation the HTTP transcoder does not enforce, and
     * this service validates queries in-band (validSnapshotQuery /
     * queryValidationErrors) instead of rejecting them. We omit it, because
     * the only concrete catch-all candidate is Google's own SDK default
     * `feedback_summary.status != "CLOSED"`, which silently drops every
     * CLOSED alert — trading a loud, testable 400 for permanent invisible
     * data loss. Omission fails loudly if it turns out to be enforced.
     *
     * Settling this needs one live call against a real tenant, with and
     * without the parameter, comparing HTTP status and baselineAlertsCount.
     * Until that runs, this assertion is the record of the decision and the
     * first line to change if the tenant disagrees.
     */
    expect(params.has("snapshotQuery")).toBe(false);

    /*
     * baselineQuery exists only to reuse a cached baseline across repeated
     * requests, and a single-pass poller has nothing to reuse.
     */
    expect(params.has("baselineQuery")).toBe(false);

    /*
     * The two enum-valued preferences, which take AlertsFeaturePreference
     * strings rather than booleans: sending either as true/false produces
     * the same class of 400 being fixed here.
     */
    expect(params.has("enableCache")).toBe(false);
    expect(params.has("includeNonAlertingDetections")).toBe(false);
  });
});

describe("GoogleSecOpsClient alerts request transport", () => {
  test("GETs with no body, and carries only Accept and Bearer authorization", async () => {
    const { client, requests } = makeClient();

    await client.fetchDetectionAlerts({
      startTime: WINDOW_START,
      endTime: WINDOW_END,
    });

    const request: RecordedRequest = alertsRequestIn(requests);

    expect(request.method).toBe("GET");
    expect(request.body).toBeUndefined();

    /*
     * The closed header set, which is also how "no Content-Type on a
     * bodyless GET" is asserted without naming the header it must not send.
     */
    expect(Object.keys(request.headers).sort()).toEqual([
      "Accept",
      "Authorization",
    ]);
    expect(request.headers["Accept"]).toBe("application/json");
    expect(request.headers["Authorization"]).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  test("addresses the region's Chronicle host at the legacy alerts view, query after the path", async () => {
    const { client, requests } = makeClient();

    await client.fetchDetectionAlerts({
      startTime: WINDOW_START,
      endTime: WINDOW_END,
    });

    const url: URL = new URL(alertsRequestIn(requests).url);

    expect(url.origin).toBe("https://us-chronicle.googleapis.com");
    expect(url.pathname).toBe(
      `/v1alpha/${INSTANCE}/legacy:legacyFetchAlertsView`,
    );
    expect(url.search.startsWith("?")).toBe(true);

    // Nothing may fall off the end of the path into a fragment.
    expect(url.hash).toBe("");
  });

  test("leaves the dot in a field path literal and percent-encodes the colon in a timestamp", async () => {
    const { client, requests } = makeClient();

    await client.fetchDetectionAlerts({
      startTime: WINDOW_START,
      endTime: WINDOW_END,
    });

    const raw: Map<string, string> = rawQueryPairsOf(alertsRequestIn(requests));

    /*
     * Undecoded keys, compared against the same list the decoded keys are
     * compared against: identical means the `.` went out as a `.` rather
     * than as %2E, which is what the transcoder binds on.
     */
    expect(sortedKeysOf(raw)).toEqual(EXPECTED_QUERY_KEYS);

    expect(raw.get("timeRange.startTime")).toBe("2026-08-21T09%3A00%3A00.000Z");
    expect(raw.get("timeRange.endTime")).toBe("2026-08-21T10%3A00%3A00.000Z");
    expect(raw.get("alertListOptions.maxReturnedAlerts")).toBe("1000");
  });
});

describe("GoogleSecOpsClient.getApiBaseUrl", () => {
  test("builds the regional host and the v1alpha instance path for us and europe", () => {
    const usClient: GoogleSecOpsClient = new GoogleSecOpsClient({
      region: "us",
      instanceResourceName: INSTANCE,
      serviceAccountJson: SERVICE_ACCOUNT_JSON,
      fetchImplementation: neverCalledFetch(),
    });

    expect(usClient.getApiBaseUrl()).toBe(
      `https://us-chronicle.googleapis.com/v1alpha/${INSTANCE}`,
    );

    const europeInstance: string =
      "projects/my-project/locations/europe/instances/3f0a-instance";

    const europeClient: GoogleSecOpsClient = new GoogleSecOpsClient({
      region: "europe",
      instanceResourceName: europeInstance,
      serviceAccountJson: SERVICE_ACCOUNT_JSON,
      fetchImplementation: neverCalledFetch(),
    });

    expect(europeClient.getApiBaseUrl()).toBe(
      `https://europe-chronicle.googleapis.com/v1alpha/${europeInstance}`,
    );
  });
});

describe("GoogleSecOpsClient region allowlist", () => {
  test("accepts every documented prefix and builds that region's host from it", () => {
    expect(DOCUMENTED_REGION_PREFIXES).toHaveLength(22);

    for (const region of DOCUMENTED_REGION_PREFIXES) {
      expect(() => {
        return GoogleSecOpsClient.validateRegion(region);
      }).not.toThrow();

      const instanceResourceName: string = `projects/my-project/locations/${region}/instances/3f0a-instance`;

      const client: GoogleSecOpsClient = new GoogleSecOpsClient({
        region: region,
        instanceResourceName: instanceResourceName,
        serviceAccountJson: SERVICE_ACCOUNT_JSON,
        fetchImplementation: neverCalledFetch(),
      });

      expect(client.getApiBaseUrl()).toBe(
        `https://${region}-chronicle.googleapis.com/v1alpha/${instanceResourceName}`,
      );
    }
  });

  test("rejects regions that merely look plausible", () => {
    /*
     * *.googleapis.com is a DNS wildcard, so every one of these resolves to
     * a Google frontend and answers with an HTML 404 rather than an API
     * error. A shape regex would admit them all and turn a typo into a
     * parse failure; the allowlist is what makes it read as a bad region.
     */
    const rejected: Array<string> = [
      "",
      "US",
      "EU",
      "Europe",
      "us-central1",
      "use1",
      "us-",
      "us----",
      "us east",
      "us_",
      "us/../etc",
      "us.chronicle",
      // Real Google Cloud regions that Chronicle does not serve.
      "europe-west1",
      "asia-east2",
      "me-west2",
      "northamerica-northeast1",
    ];

    for (const region of rejected) {
      expect(() => {
        return GoogleSecOpsClient.validateRegion(region);
      }).toThrow(BadDataException);
    }
  });
});

describe("GoogleSecOpsClient region and instance location cross-check", () => {
  test("rejects a region that disagrees with the instance's locations segment", () => {
    const mismatched: Array<{ region: string; location: string }> = [
      { region: "us", location: "europe" },
      { region: "us", location: "eu" },
      { region: "europe", location: "us" },
      { region: "asia-south1", location: "asia-southeast1" },
      { region: "me-central1", location: "me-central2" },
    ];

    for (const pair of mismatched) {
      expect(() => {
        return new GoogleSecOpsClient({
          region: pair.region,
          instanceResourceName: `projects/my-project/locations/${pair.location}/instances/3f0a-instance`,
          serviceAccountJson: SERVICE_ACCOUNT_JSON,
          fetchImplementation: neverCalledFetch(),
        });
      }).toThrow(BadDataException);
    }
  });

  test("distinguishes an unsupported region from a region that disagrees with the instance", () => {
    /*
     * Both are BadDataException, and an operator only ever sees the text.
     * Two different misconfigurations must not read as the same one.
     */
    const unsupportedRegionMessage: string = messageThrownBy(
      (): GoogleSecOpsClient => {
        return new GoogleSecOpsClient({
          region: "us-central1",
          instanceResourceName: INSTANCE,
          serviceAccountJson: SERVICE_ACCOUNT_JSON,
          fetchImplementation: neverCalledFetch(),
        });
      },
    );

    const mismatchMessage: string = messageThrownBy((): GoogleSecOpsClient => {
      return new GoogleSecOpsClient({
        region: "us",
        instanceResourceName:
          "projects/my-project/locations/europe/instances/3f0a-instance",
        serviceAccountJson: SERVICE_ACCOUNT_JSON,
        fetchImplementation: neverCalledFetch(),
      });
    });

    expect(unsupportedRegionMessage.length).toBeGreaterThan(0);
    expect(mismatchMessage.length).toBeGreaterThan(0);
    expect(unsupportedRegionMessage).not.toBe(mismatchMessage);
  });

  test("treats eu and europe as one place, in both directions", () => {
    /*
     * europe-chronicle.googleapis.com is a documented live host while the
     * migration guide names the same multi-region's location code `eu`. A
     * strict identity check here rejects every valid EU tenant, so this is
     * a regression guard on real customers rather than an edge case.
     */
    const euRegionEuropeInstance: string =
      "projects/my-project/locations/europe/instances/3f0a-instance";

    const euClient: GoogleSecOpsClient = new GoogleSecOpsClient({
      region: "eu",
      instanceResourceName: euRegionEuropeInstance,
      serviceAccountJson: SERVICE_ACCOUNT_JSON,
      fetchImplementation: neverCalledFetch(),
    });

    // The host follows the region; the path keeps the instance verbatim.
    expect(euClient.getApiBaseUrl()).toBe(
      `https://eu-chronicle.googleapis.com/v1alpha/${euRegionEuropeInstance}`,
    );

    const europeRegionEuInstance: string =
      "projects/my-project/locations/eu/instances/3f0a-instance";

    const europeClient: GoogleSecOpsClient = new GoogleSecOpsClient({
      region: "europe",
      instanceResourceName: europeRegionEuInstance,
      serviceAccountJson: SERVICE_ACCOUNT_JSON,
      fetchImplementation: neverCalledFetch(),
    });

    expect(europeClient.getApiBaseUrl()).toBe(
      `https://europe-chronicle.googleapis.com/v1alpha/${europeRegionEuInstance}`,
    );
  });
});

describe("GoogleSecOpsClient service account token_uri", () => {
  test("accepts Google token endpoints and returns them unchanged", () => {
    const accepted: Array<string> = [
      "https://oauth2.googleapis.com/token",
      "https://accounts.google.com/o/oauth2/token",
      "https://us-chronicle.googleapis.com/token",
    ];

    for (const tokenUri of accepted) {
      const credentials: GoogleServiceAccountCredentials =
        GoogleSecOpsClient.parseServiceAccountJson(
          serviceAccountJsonWith({ token_uri: tokenUri }),
        );

      expect(credentials.tokenUri).toBe(tokenUri);
    }
  });

  test("defaults to Google's token endpoint when the field is absent or empty, and the default passes its own allowlist", () => {
    const absent: GoogleServiceAccountCredentials =
      GoogleSecOpsClient.parseServiceAccountJson(serviceAccountJsonWith({}));

    expect(absent.tokenUri).toBe("https://oauth2.googleapis.com/token");

    const empty: GoogleServiceAccountCredentials =
      GoogleSecOpsClient.parseServiceAccountJson(
        serviceAccountJsonWith({ token_uri: "" }),
      );

    expect(empty.tokenUri).toBe("https://oauth2.googleapis.com/token");
  });

  test("rejects a token_uri that is not an https URL on a Google host", () => {
    /*
     * The token endpoint is customer-supplied and the first 500 characters
     * of whatever answers it are echoed into lastError and rendered in the
     * dashboard. Unpinned, that is an exfiltration primitive rather than a
     * blind SSRF — hence the metadata address and the lookalike hosts.
     */
    const rejected: Array<string> = [
      "http://oauth2.googleapis.com/token",
      "http://169.254.169.254/latest/meta-data/",
      "ftp://oauth2.googleapis.com/token",
      "file:///etc/passwd",
      "https://attacker@oauth2.googleapis.com/token",
      "https://evil.example.com/token",
      // Suffix lookalikes: neither is a subdomain of googleapis.com.
      "https://evil-googleapis.com/token",
      "https://oauth2.googleapis.com.evil.example/token",
      // Not absolute at all.
      "oauth2.googleapis.com/token",
      "//oauth2.googleapis.com/token",
      "/token",
    ];

    for (const tokenUri of rejected) {
      expect(() => {
        return GoogleSecOpsClient.parseServiceAccountJson(
          serviceAccountJsonWith({ token_uri: tokenUri }),
        );
      }).toThrow(BadDataException);
    }
  });
});

describe("GoogleSecOpsClient service account JSON", () => {
  test("throws BadDataException, never a raw TypeError, for a root that is not an object", () => {
    /*
     * JSON.parse("null") succeeds, and the property reads that follow used
     * to throw a bare TypeError out of the public create/update API — a 500
     * where the caller's own input deserves a 400.
     */
    const nonObjectRoots: Array<string> = [
      "null",
      "[]",
      "[{}]",
      "42",
      '"a string"',
      "true",
    ];

    for (const serviceAccountJson of nonObjectRoots) {
      const thrown: unknown = errorThrownBy(
        (): GoogleServiceAccountCredentials => {
          return GoogleSecOpsClient.parseServiceAccountJson(serviceAccountJson);
        },
      );

      expect(thrown).toBeInstanceOf(BadDataException);
      expect(thrown).not.toBeInstanceOf(TypeError);
    }
  });

  test("surfaces the same BadDataException through the constructor", () => {
    const thrown: unknown = errorThrownBy((): GoogleSecOpsClient => {
      return new GoogleSecOpsClient({
        region: "us",
        instanceResourceName: INSTANCE,
        serviceAccountJson: "null",
        fetchImplementation: neverCalledFetch(),
      });
    });

    expect(thrown).toBeInstanceOf(BadDataException);
    expect(thrown).not.toBeInstanceOf(TypeError);
  });

  test("rejects non-string client_email and private_key instead of coercing them", () => {
    /*
     * String({}) is "[object Object]": non-empty, past every emptiness
     * check, and fatal an hour later inside jwt.sign on the cron.
     */
    const rejected: Array<string> = [
      JSON.stringify({ client_email: "a@b.c", private_key: {} }),
      JSON.stringify({ client_email: "a@b.c", private_key: 12345 }),
      JSON.stringify({ client_email: "a@b.c", private_key: null }),
      JSON.stringify({ client_email: {}, private_key: privateKey }),
      JSON.stringify({ client_email: 42, private_key: privateKey }),
      JSON.stringify({ private_key: privateKey }),
      JSON.stringify({ client_email: "a@b.c" }),
      "not json at all",
    ];

    for (const serviceAccountJson of rejected) {
      expect(() => {
        return GoogleSecOpsClient.parseServiceAccountJson(serviceAccountJson);
      }).toThrow(BadDataException);
    }
  });

  test("rejects a private_key that no PEM decoder can read", () => {
    /*
     * A double-escaped or truncated key saves cleanly today and fails an
     * hour later inside jwt.sign as an unwrapped OpenSSL decoder error, on
     * the cron — exactly the class of failure save-time validation exists
     * to prevent.
     */
    const unreadableKeys: Array<string> = [
      privateKey.replace(/\n/g, "\\n"),
      privateKey.slice(0, 120),
      "-----BEGIN PRIVATE KEY-----\nnot-base64\n-----END PRIVATE KEY-----\n",
      "[object Object]",
      "not a key at all",
      " ",
    ];

    for (const key of unreadableKeys) {
      expect(() => {
        return GoogleSecOpsClient.parseServiceAccountJson(
          serviceAccountJsonWith({ private_key: key }),
        );
      }).toThrow(BadDataException);
    }

    // The control: a real key still parses, and comes back byte-identical.
    const credentials: GoogleServiceAccountCredentials =
      GoogleSecOpsClient.parseServiceAccountJson(SERVICE_ACCOUNT_JSON);

    expect(credentials.privateKey).toBe(privateKey);
    expect(credentials.clientEmail).toBe(
      "poller@example.iam.gserviceaccount.com",
    );
  });
});

describe("GoogleSecOpsClient instance resource name", () => {
  test("accepts the documented four-segment shape only", () => {
    expect(() => {
      return GoogleSecOpsClient.validateInstanceResourceName(INSTANCE);
    }).not.toThrow();

    const rejected: Array<string> = [
      "",
      "instances/abc",
      "projects/p/instances/i",
      "projects/p/locations/l/instances/i/extra",
      "projects/p/locations/l/instances/",
      "projects//locations/l/instances/i",
    ];

    for (const name of rejected) {
      expect(() => {
        return GoogleSecOpsClient.validateInstanceResourceName(name);
      }).toThrow(BadDataException);
    }
  });

  test("rejects a name carrying URL syntax that would reshape the request", () => {
    /*
     * The host is fixed by getApiBaseUrl, so none of these is a URL
     * takeover — but `#` truncates the path and drops the entire query
     * string, `?` injects parameters ahead of the real ones, and `%` lets a
     * segment smuggle an encoded separator past this check. All three are
     * config-controlled request shaping.
     */
    const rejected: Array<string> = [
      "projects/my-project/locations/us/instances/3f0a#fragment",
      "projects/my-project/locations/us/instances/3f0a?alt=json",
      "projects/my-project/locations/us/instances/3f0a&alt=json",
      "projects/my-project/locations/us/instances/%23",
      "projects/my-project#/locations/us/instances/3f0a",
      "projects/my-project/locations/us/instances/3f0a instance",
    ];

    for (const name of rejected) {
      expect(() => {
        return GoogleSecOpsClient.validateInstanceResourceName(name);
      }).toThrow(BadDataException);

      expect(() => {
        return new GoogleSecOpsClient({
          region: "us",
          instanceResourceName: name,
          serviceAccountJson: SERVICE_ACCOUNT_JSON,
          fetchImplementation: neverCalledFetch(),
        });
      }).toThrow(BadDataException);
    }
  });

  test("percent-encodes each surviving segment losslessly into the request path", async () => {
    /*
     * The other half of the same defect: what the shape check does admit
     * still has to reach the wire as path segments rather than as syntax.
     */
    const oddInstance: string =
      "projects/my+project/locations/us/instances/3f0a+instance";

    const { client, requests } = makeClient({
      instanceResourceName: oddInstance,
    });

    await client.fetchDetectionAlerts({
      startTime: WINDOW_START,
      endTime: WINDOW_END,
    });

    const url: URL = new URL(alertsRequestIn(requests).url);

    expect(url.origin).toBe("https://us-chronicle.googleapis.com");
    expect(url.pathname).toBe(
      "/v1alpha/projects/my%2Bproject/locations/us/instances/3f0a%2Binstance/legacy:legacyFetchAlertsView",
    );

    const decodedPath: string = url.pathname
      .split("/")
      .map((segment: string): string => {
        return decodeURIComponent(segment);
      })
      .join("/");

    // Encoding happened, and it round-trips back to the configured name.
    expect(url.pathname).not.toBe(decodedPath);
    expect(decodedPath).toBe(
      `/v1alpha/${oddInstance}/legacy:legacyFetchAlertsView`,
    );

    // And none of it leaked into the query or off the end of the path.
    expect(sortedQueryKeysOf(alertsRequestIn(requests))).toEqual(
      EXPECTED_QUERY_KEYS,
    );
    expect(url.hash).toBe("");
  });
});
