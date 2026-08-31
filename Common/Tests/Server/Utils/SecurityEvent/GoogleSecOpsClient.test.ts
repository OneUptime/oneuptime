import { generateKeyPairSync } from "crypto";
import jwt from "jsonwebtoken";
import GoogleSecOpsClient, {
  FetchAlertsResult,
  FetchLike,
  FetchResponseLike,
} from "../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsClient";
import APIException from "../../../../Types/Exception/ApiException";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The SecOps client is the trust boundary between customer-supplied
 * connection config and outbound Google API calls. These tests pin the
 * request construction end-to-end against an injected fetch — the
 * JWT-bearer token exchange (a real RS256 signature, verified by
 * decoding), the Bearer-authenticated alerts call, token caching — and
 * the tolerant response parsing that keeps tenant-shape drift from
 * turning into dropped alerts.
 */

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

/*
 * token_uri has to be a real Google host now. It arrives inside
 * customer-supplied service-account JSON and is the address this client
 * POSTs a signed assertion for their service account to, so an arbitrary
 * host there is a credential-exfiltration primitive rather than a
 * configuration choice — the client allowlists it at construction. The
 * fetch is injected, so nothing here touches the network either way.
 */
const TOKEN_URI: string = "https://oauth2.googleapis.com/token";

const SERVICE_ACCOUNT_JSON: string = JSON.stringify({
  client_email: "poller@example.iam.gserviceaccount.com",
  private_key: privateKey,
  token_uri: TOKEN_URI,
});

const INSTANCE: string =
  "projects/my-project/locations/us/instances/3f0a-instance";

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | undefined;
}

function makeFetch(responses: Array<{ status: number; body: string }>): {
  fetchImplementation: FetchLike;
  requests: Array<RecordedRequest>;
} {
  const requests: Array<RecordedRequest> = [];
  let callIndex: number = 0;

  const fetchImplementation: FetchLike = (
    url: string,
    init: {
      method: string;
      headers: Record<string, string>;
      body?: string | undefined;
    },
  ): Promise<FetchResponseLike> => {
    requests.push({
      url,
      method: init.method,
      headers: init.headers,
      body: init.body,
    });

    const response: { status: number; body: string } =
      responses[Math.min(callIndex, responses.length - 1)]!;
    callIndex++;

    return Promise.resolve({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      text: (): Promise<string> => {
        return Promise.resolve(response.body);
      },
    });
  };

  return { fetchImplementation, requests };
}

function tokenResponse(): { status: number; body: string } {
  return {
    status: 200,
    body: JSON.stringify({ access_token: "test-token", expires_in: 3600 }),
  };
}

describe("GoogleSecOpsClient validation", () => {
  test("accepts real region prefixes and rejects garbage", () => {
    expect(() => {
      return GoogleSecOpsClient.validateRegion("us");
    }).not.toThrow();
    expect(() => {
      return GoogleSecOpsClient.validateRegion("europe");
    }).not.toThrow();

    for (const bad of ["", "US", "us_", "us/../etc", "us east"]) {
      expect(() => {
        return GoogleSecOpsClient.validateRegion(bad);
      }).toThrow(BadDataException);
    }
  });

  test("accepts the documented instance resource name shape only", () => {
    expect(() => {
      return GoogleSecOpsClient.validateInstanceResourceName(INSTANCE);
    }).not.toThrow();

    for (const bad of [
      "",
      "instances/abc",
      "projects/p/instances/i",
      "projects/p/locations/l/instances/i/extra",
    ]) {
      expect(() => {
        return GoogleSecOpsClient.validateInstanceResourceName(bad);
      }).toThrow(BadDataException);
    }
  });

  test("parseServiceAccountJson requires client_email and private_key, defaults token_uri", () => {
    expect(() => {
      return GoogleSecOpsClient.parseServiceAccountJson("not json");
    }).toThrow(BadDataException);

    expect(() => {
      return GoogleSecOpsClient.parseServiceAccountJson(
        JSON.stringify({ client_email: "a@b.c" }),
      );
    }).toThrow(BadDataException);

    const withoutTokenUri: string = JSON.stringify({
      client_email: "a@b.c",
      private_key: privateKey,
    });

    expect(
      GoogleSecOpsClient.parseServiceAccountJson(withoutTokenUri).tokenUri,
    ).toBe("https://oauth2.googleapis.com/token");
  });
});

describe("GoogleSecOpsClient.extractAlerts", () => {
  test("accepts a bare array, filtering non-objects", () => {
    expect(
      GoogleSecOpsClient.extractAlerts([{ id: "a" }, "junk", 4, null]),
    ).toEqual([{ id: "a" }]);
  });

  test("accepts alerts and detections envelopes", () => {
    expect(GoogleSecOpsClient.extractAlerts({ alerts: [{ id: "a" }] })).toEqual(
      [{ id: "a" }],
    );
    expect(
      GoogleSecOpsClient.extractAlerts({ detections: [{ id: "d" }] }),
    ).toEqual([{ id: "d" }]);
  });

  /*
   * extractAlerts is the legacy top-level fallback, and it is reached only
   * after parseAlertsBody has already recognized the body. So [] here means
   * "this recognized shape carried nothing", and is safe.
   *
   * It is emphatically NOT the client's answer to an unrecognized body.
   * That used to be exactly what it was, and it is the bug the rewrite
   * exists for: a body the client could not read came back as zero alerts,
   * the poller read zero alerts as a healthy quiet window, and the cursor
   * advanced past alerts nobody had ever seen. The second half of this test
   * pins where that decision actually lives now, so this file cannot be
   * read as evidence that an unknown body is harmless.
   */
  test("returns [] for a recognized shape that carried nothing, while the body gate refuses it outright", () => {
    expect(GoogleSecOpsClient.extractAlerts({ nope: true })).toEqual([]);
    expect(GoogleSecOpsClient.extractAlerts("junk")).toEqual([]);
    expect(GoogleSecOpsClient.extractAlerts(null)).toEqual([]);

    expect(() => {
      return GoogleSecOpsClient.parseAlertsBody(JSON.stringify({ nope: true }));
    }).toThrow(APIException);
  });
});

describe("GoogleSecOpsClient.fetchDetectionAlerts", () => {
  function makeClient(responses: Array<{ status: number; body: string }>): {
    client: GoogleSecOpsClient;
    requests: Array<RecordedRequest>;
  } {
    const { fetchImplementation, requests } = makeFetch(responses);

    const client: GoogleSecOpsClient = new GoogleSecOpsClient({
      region: "us",
      instanceResourceName: INSTANCE,
      serviceAccountJson: SERVICE_ACCOUNT_JSON,
      fetchImplementation,
    });

    return { client, requests };
  }

  test("exchanges a signed JWT assertion for a token, then calls the alerts view with Bearer auth", async () => {
    const { client, requests } = makeClient([
      tokenResponse(),
      { status: 200, body: JSON.stringify({ alerts: [{ id: "a-1" }] }) },
    ]);

    const result: FetchAlertsResult = await client.fetchDetectionAlerts({
      startTime: new Date("2026-08-21T09:00:00.000Z"),
      endTime: new Date("2026-08-21T10:00:00.000Z"),
    });

    expect(result.alerts).toEqual([{ id: "a-1" }]);

    /*
     * The counts and flags are the point of the return type: a bare array
     * could not tell the poller "the window was quiet" from "the window was
     * truncated" or "the stream ended early", and all three used to arrive
     * identically as [].
     */
    expect(result.truncatedByCount).toBe(false);
    expect(result.truncatedByBytes).toBe(false);
    expect(result.chunkCount).toBe(1);

    expect(requests).toHaveLength(2);

    // Token exchange: form-encoded JWT-bearer grant against token_uri.
    const tokenRequest: RecordedRequest = requests[0]!;
    expect(tokenRequest.url).toBe(TOKEN_URI);
    expect(tokenRequest.method).toBe("POST");
    expect(tokenRequest.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );

    const params: URLSearchParams = new URLSearchParams(
      tokenRequest.body || "",
    );
    expect(params.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );

    const assertion: JSONObject = jwt.decode(
      params.get("assertion") || "",
    ) as JSONObject;
    expect(assertion["iss"]).toBe("poller@example.iam.gserviceaccount.com");
    expect(assertion["aud"]).toBe(TOKEN_URI);
    expect(assertion["scope"]).toBe(
      "https://www.googleapis.com/auth/cloud-platform",
    );

    // Alerts call: regional base URL, instance path, window params, Bearer.
    const alertsRequest: RecordedRequest = requests[1]!;
    const alertsUrl: URL = new URL(alertsRequest.url);

    /*
     * Parsed, not substring-matched.
     *
     * This assertion used to be two toContain calls, and that is how the
     * production outage got out: the client was also sending a `pageSize`
     * the endpoint does not accept, Chronicle 400'd every poll with
     * "Unknown name pageSize", and both toContain calls went on passing,
     * because an extra parameter cannot make a substring stop appearing.
     * The whole query is pinned here, so an added, renamed or dropped
     * parameter fails rather than hides.
     */
    expect(`${alertsUrl.origin}${alertsUrl.pathname}`).toBe(
      `https://us-chronicle.googleapis.com/v1alpha/${INSTANCE}/legacy:legacyFetchAlertsView`,
    );

    expect([...alertsUrl.searchParams.keys()].sort()).toEqual([
      "alertListOptions.maxReturnedAlerts",
      "timeRange.endTime",
      "timeRange.startTime",
    ]);

    expect(alertsUrl.searchParams.get("timeRange.startTime")).toBe(
      "2026-08-21T09:00:00.000Z",
    );
    expect(alertsUrl.searchParams.get("timeRange.endTime")).toBe(
      "2026-08-21T10:00:00.000Z",
    );

    expect(alertsRequest.headers["Authorization"]).toBe("Bearer test-token");
  });

  test("caches the access token across calls", async () => {
    const { client, requests } = makeClient([
      tokenResponse(),
      { status: 200, body: JSON.stringify({ alerts: [] }) },
      { status: 200, body: JSON.stringify({ alerts: [] }) },
    ]);

    await client.fetchDetectionAlerts({
      startTime: new Date("2026-08-21T09:00:00.000Z"),
      endTime: new Date("2026-08-21T10:00:00.000Z"),
    });
    await client.fetchDetectionAlerts({
      startTime: new Date("2026-08-21T10:00:00.000Z"),
      endTime: new Date("2026-08-21T11:00:00.000Z"),
    });

    const tokenCalls: Array<RecordedRequest> = requests.filter(
      (request: RecordedRequest): boolean => {
        return request.url === TOKEN_URI;
      },
    );

    expect(tokenCalls).toHaveLength(1);
  });

  test("non-2xx token exchange and alerts responses throw APIException with the body snippet", async () => {
    const failingToken: { client: GoogleSecOpsClient } = makeClient([
      { status: 403, body: "permission denied" },
    ]);

    await expect(
      failingToken.client.fetchDetectionAlerts({
        startTime: new Date("2026-08-21T09:00:00.000Z"),
        endTime: new Date("2026-08-21T10:00:00.000Z"),
      }),
    ).rejects.toThrow(APIException);

    const failingAlerts: { client: GoogleSecOpsClient } = makeClient([
      tokenResponse(),
      { status: 500, body: "backend exploded" },
    ]);

    await expect(
      failingAlerts.client.fetchDetectionAlerts({
        startTime: new Date("2026-08-21T09:00:00.000Z"),
        endTime: new Date("2026-08-21T10:00:00.000Z"),
      }),
    ).rejects.toThrow(/backend exploded/);
  });

  test("constructor rejects bad region/instance/credentials up front", () => {
    expect(() => {
      return new GoogleSecOpsClient({
        region: "not a region",
        instanceResourceName: INSTANCE,
        serviceAccountJson: SERVICE_ACCOUNT_JSON,
      });
    }).toThrow(BadDataException);

    expect(() => {
      return new GoogleSecOpsClient({
        region: "us",
        instanceResourceName: "nope",
        serviceAccountJson: SERVICE_ACCOUNT_JSON,
      });
    }).toThrow(BadDataException);

    expect(() => {
      return new GoogleSecOpsClient({
        region: "us",
        instanceResourceName: INSTANCE,
        serviceAccountJson: "{}",
      });
    }).toThrow(BadDataException);
  });
});
