import { generateKeyPairSync } from "crypto";
import GoogleSecOpsClient, {
  FetchAlertsResult,
  FetchInitLike,
  FetchLike,
  FetchResponseLike,
  SearchDetectionsResult,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import logger from "../../../../../../Server/Utils/Logger";
import { getJestSpyOn } from "../../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The wire contract of the created-time detections search, asserted by
 * parsing. Nothing here matches a substring of a URL: every parameter
 * assertion goes through `new URL(...).searchParams` and pins the SORTED
 * KEY LIST, which fails on an extra, a renamed, or a missing key alike —
 * the same discipline that caught the alerts view's `pageSize` regression.
 *
 * Contract, from Google's reference pages:
 *   GET {base}/legacy:legacySearchDetections
 *     ?ruleId=-&startTime&endTime&listBasis&pageSize[&alertState][&pageToken]
 *   → { detections: Collection[], nextPageToken, respTooLargeDetectionsTruncated }
 * and legacy:legacySearchCuratedDetections with `curatedDetections`, whose
 * ruleId names ONE curated rule (ur_...): that route documents no wildcard,
 * and answers a "-" with an empty 200 rather than with every curated rule.
 * https://docs.cloud.google.com/chronicle/docs/reference/rest/v1alpha/projects.locations.instances.legacy/legacySearchDetections
 * https://docs.cloud.google.com/chronicle/docs/reference/rest/v1alpha/projects.locations.instances.legacy/legacySearchCuratedDetections
 */

const GOOGLE_TOKEN_URI: string = "https://oauth2.googleapis.com/token";

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
// The only kind of ruleId legacySearchCuratedDetections accepts.
const CURATED_RULE_ID: string = "ur_ttp_search_detections_rule";
const START: Date = new Date("2026-09-13T12:00:00.000Z");
const END: Date = new Date("2026-09-14T12:00:00.000Z");

interface StubbedResponse {
  status: number;
  body: string;
}

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

interface Transport {
  client: GoogleSecOpsClient;
  requests: Array<RecordedRequest>;
}

function tokenResponse(): StubbedResponse {
  return {
    status: 200,
    body: JSON.stringify({ access_token: ACCESS_TOKEN, expires_in: 3600 }),
  };
}

/*
 * Routed by host and queued per endpoint: the 401 path re-mints a token in
 * the middle of the search sequence, so ordinal routing cannot express
 * "the second token" and "the second search" at once. Each queue repeats
 * its last entry.
 */
function makeClient(
  responses: {
    token?: Array<StubbedResponse> | undefined;
    chronicle: Array<StubbedResponse>;
  },
  options: { requestTimeoutInMs?: number | undefined } = {},
): Transport {
  const requests: Array<RecordedRequest> = [];
  let tokenIndex: number = 0;
  let chronicleIndex: number = 0;
  const tokenQueue: Array<StubbedResponse> = responses.token || [
    tokenResponse(),
  ];

  const fetchImplementation: FetchLike = (
    url: string,
    init: FetchInitLike,
  ): Promise<FetchResponseLike> => {
    requests.push({ url, method: init.method, headers: init.headers });

    const isToken: boolean = url === GOOGLE_TOKEN_URI;
    const queue: Array<StubbedResponse> = isToken
      ? tokenQueue
      : responses.chronicle;
    const index: number = isToken ? tokenIndex++ : chronicleIndex++;
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

  const client: GoogleSecOpsClient = new GoogleSecOpsClient({
    region: "us",
    instanceResourceName: INSTANCE,
    serviceAccountJson: SERVICE_ACCOUNT_JSON,
    fetchImplementation,
    requestTimeoutInMs: options.requestTimeoutInMs,
  });

  return { client, requests };
}

function chronicleRequests(requests: Array<RecordedRequest>): Array<URL> {
  return requests
    .filter((request: RecordedRequest): boolean => {
      return request.url !== GOOGLE_TOKEN_URI;
    })
    .map((request: RecordedRequest): URL => {
      return new URL(request.url);
    });
}

function sortedKeys(url: URL): Array<string> {
  return Array.from(url.searchParams.keys()).sort();
}

function collection(id: string): Record<string, unknown> {
  return {
    id,
    type: "RULE_DETECTION",
    createdTime: "2026-09-14T10:05:00.000Z",
    detectionTime: "2026-09-14T09:00:00.000Z",
    detection: [{ ruleName: "Hourly rule", alertState: "ALERTING" }],
  };
}

describe("GoogleSecOpsClient.searchDetections request contract", () => {
  beforeEach(() => {
    getJestSpyOn(logger, "warn").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("alerting-only searches send exactly the documented keys, with alertState=ALERTING", async () => {
    const { client, requests } = makeClient({
      chronicle: [{ status: 200, body: "{}" }],
    });

    await client.searchDetections({
      startTime: START,
      endTime: END,
      listBasis: "CREATED_TIME",
      alertingOnly: true,
    });

    const [url] = chronicleRequests(requests);
    expect(url).toBeDefined();
    expect(url!.origin).toBe("https://us-chronicle.googleapis.com");
    expect(url!.pathname).toBe(
      `/v1alpha/${INSTANCE}/legacy:legacySearchDetections`,
    );
    expect(sortedKeys(url!)).toEqual([
      "alertState",
      "endTime",
      "listBasis",
      "pageSize",
      "ruleId",
      "startTime",
    ]);
    expect(url!.searchParams.get("ruleId")).toBe("-");
    expect(url!.searchParams.get("alertState")).toBe("ALERTING");
    expect(url!.searchParams.get("listBasis")).toBe("CREATED_TIME");
    expect(url!.searchParams.get("pageSize")).toBe("1000");
    expect(url!.searchParams.get("startTime")).toBe(START.toISOString());
    expect(url!.searchParams.get("endTime")).toBe(END.toISOString());
  });

  test("alerts-and-detections searches omit alertState entirely", async () => {
    const { client, requests } = makeClient({
      chronicle: [{ status: 200, body: "{}" }],
    });

    await client.searchDetections({
      startTime: START,
      endTime: END,
      listBasis: "DETECTION_TIME",
      alertingOnly: false,
    });

    const [url] = chronicleRequests(requests);
    expect(sortedKeys(url!)).toEqual([
      "endTime",
      "listBasis",
      "pageSize",
      "ruleId",
      "startTime",
    ]);
    expect(url!.searchParams.get("listBasis")).toBe("DETECTION_TIME");
  });

  test("the curated variant uses its own route and the same parameters, with one curated rule id in ruleId", async () => {
    const { client, requests } = makeClient({
      chronicle: [{ status: 200, body: "{}" }],
    });

    await client.searchDetections({
      startTime: START,
      endTime: END,
      listBasis: "CREATED_TIME",
      alertingOnly: true,
      curated: true,
      ruleId: CURATED_RULE_ID,
    });

    const [url] = chronicleRequests(requests);
    expect(url!.pathname).toBe(
      `/v1alpha/${INSTANCE}/legacy:legacySearchCuratedDetections`,
    );
    expect(sortedKeys(url!)).toEqual([
      "alertState",
      "endTime",
      "listBasis",
      "pageSize",
      "ruleId",
      "startTime",
    ]);
    /*
     * The wildcard the rule route uses is not a curated rule id. Google
     * answers "-" here with an empty 200, so sending it imported no curated
     * detection at all until the caller started naming the rule.
     */
    expect(url!.searchParams.get("ruleId")).toBe(CURATED_RULE_ID);
  });

  test("a curated search with no curated rule id is refused before anything is sent", async () => {
    const { client, requests } = makeClient({
      chronicle: [{ status: 200, body: "{}" }],
    });

    await expect(
      client.searchDetections({
        startTime: START,
        endTime: END,
        listBasis: "CREATED_TIME",
        alertingOnly: true,
        curated: true,
      }),
    ).rejects.toThrow(
      "A curated rule detections search needs one curated rule id (ur_...); legacySearchCuratedDetections has no wildcard.",
    );

    // Not even the token exchange: nothing was contacted.
    expect(requests).toEqual([]);
  });

  test("a page token is forwarded verbatim and pageSize is clamped to 1000", async () => {
    const { client, requests } = makeClient({
      chronicle: [{ status: 200, body: "{}" }],
    });

    await client.searchDetections({
      startTime: START,
      endTime: END,
      listBasis: "CREATED_TIME",
      alertingOnly: false,
      pageSize: 5000,
      pageToken: "CgQ=abc",
    });

    const [url] = chronicleRequests(requests);
    expect(sortedKeys(url!)).toEqual([
      "endTime",
      "listBasis",
      "pageSize",
      "pageToken",
      "ruleId",
      "startTime",
    ]);
    expect(url!.searchParams.get("pageToken")).toBe("CgQ=abc");
    expect(url!.searchParams.get("pageSize")).toBe("1000");
  });

  test.each([0, -1, Number.NaN, undefined])(
    "an unusable pageSize %p falls back to the default",
    async (pageSize: number | undefined) => {
      const { client, requests } = makeClient({
        chronicle: [{ status: 200, body: "{}" }],
      });

      await client.searchDetections({
        startTime: START,
        endTime: END,
        listBasis: "CREATED_TIME",
        alertingOnly: true,
        pageSize,
      });

      expect(chronicleRequests(requests)[0]!.searchParams.get("pageSize")).toBe(
        "1000",
      );
    },
  );

  test("the request is an authenticated GET asking for JSON", async () => {
    const { client, requests } = makeClient({
      chronicle: [{ status: 200, body: "{}" }],
    });

    await client.searchDetections({
      startTime: START,
      endTime: END,
      listBasis: "CREATED_TIME",
      alertingOnly: true,
    });

    const request: RecordedRequest = requests.find(
      (item: RecordedRequest): boolean => {
        return item.url !== GOOGLE_TOKEN_URI;
      },
    )!;
    expect(request.method).toBe("GET");
    expect(Object.keys(request.headers).sort()).toEqual([
      "Accept",
      "Authorization",
    ]);
    expect(request.headers["Authorization"]).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(request.headers["Accept"]).toBe("application/json");
  });

  test("the token exchange happens before Chronicle is contacted", async () => {
    const { client, requests } = makeClient({
      chronicle: [{ status: 200, body: "{}" }],
    });

    await client.searchDetections({
      startTime: START,
      endTime: END,
      listBasis: "CREATED_TIME",
      alertingOnly: true,
    });

    expect(
      requests.map((request: RecordedRequest): string => {
        return request.url === GOOGLE_TOKEN_URI ? "token" : "chronicle";
      }),
    ).toEqual(["token", "chronicle"]);
  });
});

describe("GoogleSecOpsClient.searchDetections response parsing", () => {
  beforeEach(() => {
    getJestSpyOn(logger, "warn").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads detections, the next page token and the truncation flag", async () => {
    const { client } = makeClient({
      chronicle: [
        {
          status: 200,
          body: JSON.stringify({
            detections: [collection("de_1"), collection("de_2")],
            nextPageToken: "next-1",
            respTooLargeDetectionsTruncated: true,
          }),
        },
      ],
    });

    const result: SearchDetectionsResult = await client.searchDetections({
      startTime: START,
      endTime: END,
      listBasis: "CREATED_TIME",
      alertingOnly: true,
    });

    expect(
      result.detections.map((item: Record<string, unknown>): unknown => {
        return item["id"];
      }),
    ).toEqual(["de_1", "de_2"]);
    expect(result.nextPageToken).toBe("next-1");
    expect(result.truncated).toBe(true);
  });

  test("reads curatedDetections from the curated route", async () => {
    const { client } = makeClient({
      chronicle: [
        {
          status: 200,
          body: JSON.stringify({ curatedDetections: [collection("cu_1")] }),
        },
      ],
    });

    const result: SearchDetectionsResult = await client.searchDetections({
      startTime: START,
      endTime: END,
      listBasis: "CREATED_TIME",
      alertingOnly: true,
      curated: true,
      ruleId: CURATED_RULE_ID,
    });

    expect(result.detections).toHaveLength(1);
    expect(result.nextPageToken).toBeNull();
    expect(result.truncated).toBe(false);
  });

  test("a bare {} is a quiet window, not an error", async () => {
    const { client } = makeClient({ chronicle: [{ status: 200, body: "{}" }] });

    const result: SearchDetectionsResult = await client.searchDetections({
      startTime: START,
      endTime: END,
      listBasis: "CREATED_TIME",
      alertingOnly: true,
    });

    expect(result).toEqual({
      detections: [],
      nextPageToken: null,
      truncated: false,
    });
  });

  test.each([
    ["", "Google SecOps detections search returned an empty body."],
    [
      "<html><body>502 Bad Gateway</body></html>",
      "Google SecOps detections search returned a non-JSON body.",
    ],
    [
      '{"nope":true}',
      "Google SecOps detections search returned an unrecognized response shape",
    ],
    [
      "[]",
      "Google SecOps detections search returned an unrecognized response shape",
    ],
    [
      '{"error":{"code":13,"message":"internal"}}',
      "Google SecOps detections search returned an error in the response",
    ],
  ])(
    "a 200 whose body is %p throws rather than reporting zero detections",
    async (body: string, expectedPrefix: string) => {
      const { client } = makeClient({ chronicle: [{ status: 200, body }] });

      await expect(
        client.searchDetections({
          startTime: START,
          endTime: END,
          listBasis: "CREATED_TIME",
          alertingOnly: true,
        }),
      ).rejects.toThrow(expectedPrefix);
    },
  );
});

describe("GoogleSecOpsClient.searchDetections failures", () => {
  beforeEach(() => {
    getJestSpyOn(logger, "warn").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a 401 re-mints the token once and retries the same search", async () => {
    const { client, requests } = makeClient({
      chronicle: [
        { status: 401, body: JSON.stringify({ error: { code: 401 } }) },
        { status: 200, body: JSON.stringify({ detections: [] }) },
      ],
    });

    const result: SearchDetectionsResult = await client.searchDetections({
      startTime: START,
      endTime: END,
      listBasis: "CREATED_TIME",
      alertingOnly: true,
    });

    expect(result.detections).toEqual([]);
    expect(
      requests.filter((request: RecordedRequest): boolean => {
        return request.url === GOOGLE_TOKEN_URI;
      }),
    ).toHaveLength(2);
    const searches: Array<URL> = chronicleRequests(requests);
    expect(searches).toHaveLength(2);
    expect(searches[0]!.toString()).toBe(searches[1]!.toString());
  });

  test.each([403, 429, 500, 503])(
    "HTTP %s carries the status in the documented prefix and the status is readable back",
    async (status: number) => {
      const { client } = makeClient({
        chronicle: [
          {
            status,
            body: JSON.stringify({ error: { code: status, message: "no" } }),
          },
        ],
      });

      let thrown: Error | null = null;

      try {
        await client.searchDetections({
          startTime: START,
          endTime: END,
          listBasis: "CREATED_TIME",
          alertingOnly: true,
        });
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown).not.toBeNull();
      expect(
        thrown!.message.startsWith(
          `Google SecOps detections search failed (HTTP ${status}): `,
        ),
      ).toBe(true);
      expect(GoogleSecOpsClient.readHttpStatus(thrown)).toBe(status);
    },
  );

  test("a persistent 401 is reported as the search failing, after exactly one retry", async () => {
    const { client, requests } = makeClient({
      chronicle: [{ status: 401, body: "" }],
    });

    await expect(
      client.searchDetections({
        startTime: START,
        endTime: END,
        listBasis: "CREATED_TIME",
        alertingOnly: true,
      }),
    ).rejects.toThrow("Google SecOps detections search failed (HTTP 401)");
    expect(chronicleRequests(requests)).toHaveLength(2);
  });

  test("the IAM hint names the search permissions the viewer role includes", async () => {
    const { client } = makeClient({
      chronicle: [
        {
          status: 403,
          body: JSON.stringify({
            error: {
              code: 403,
              status: "PERMISSION_DENIED",
              message: "denied",
              details: [
                {
                  "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                  reason: "IAM_PERMISSION_DENIED",
                  metadata: {
                    permission: "chronicle.legacies.legacySearchDetections",
                    resource: INSTANCE,
                  },
                },
              ],
            },
          }),
        },
      ],
    });

    await expect(
      client.searchDetections({
        startTime: START,
        endTime: END,
        listBasis: "CREATED_TIME",
        alertingOnly: true,
      }),
    ).rejects.toThrow(
      /lacks chronicle\.legacies\.legacySearchDetections on .*roles\/chronicle\.viewer/,
    );
  });

  test("credentials echoed in an error body are redacted from the message", async () => {
    const { client } = makeClient({
      chronicle: [
        {
          status: 400,
          body: JSON.stringify({
            error: {
              code: 400,
              message: "bad",
              private_key: "-----BEGIN PRIVATE KEY-----leaked",
              access_token: "ya29.leaked-token",
            },
          }),
        },
      ],
    });

    let thrown: Error | null = null;

    try {
      await client.searchDetections({
        startTime: START,
        endTime: END,
        listBasis: "CREATED_TIME",
        alertingOnly: true,
      });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown!.message).toContain("[REDACTED]");
    expect(thrown!.message).not.toContain("leaked");
    expect(thrown!.message).not.toContain(ACCESS_TOKEN);
  });

  test("a search that never answers times out on the configured deadline", async () => {
    const requests: Array<RecordedRequest> = [];
    const fetchImplementation: FetchLike = (
      url: string,
      init: FetchInitLike,
    ): Promise<FetchResponseLike> => {
      requests.push({ url, method: init.method, headers: init.headers });

      if (url === GOOGLE_TOKEN_URI) {
        const token: StubbedResponse = tokenResponse();
        return Promise.resolve({
          ok: true,
          status: token.status,
          text: (): Promise<string> => {
            return Promise.resolve(token.body);
          },
        });
      }

      return new Promise<FetchResponseLike>((): void => {
        // Never settles; only the client's own deadline can end this.
      });
    };

    const client: GoogleSecOpsClient = new GoogleSecOpsClient({
      region: "us",
      instanceResourceName: INSTANCE,
      serviceAccountJson: SERVICE_ACCOUNT_JSON,
      fetchImplementation,
      requestTimeoutInMs: 50,
    });

    await expect(
      client.searchDetections({
        startTime: START,
        endTime: END,
        listBasis: "CREATED_TIME",
        alertingOnly: true,
      }),
    ).rejects.toThrow(
      "Google SecOps detections search timed out after 1 seconds with no response.",
    );
  });
});

describe("GoogleSecOpsClient.fetchDetectionAlerts incomplete-stream retry", () => {
  beforeEach(() => {
    getJestSpyOn(logger, "warn").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stream(chunks: Array<Record<string, unknown>>): StubbedResponse {
    return { status: 200, body: JSON.stringify(chunks) };
  }

  test("a stream that ends without complete=true is re-issued and the completed answer wins", async () => {
    const { client, requests } = makeClient({
      chronicle: [
        stream([{ alerts: { alerts: [collection("a-1")] }, progress: 0.4 }]),
        stream([
          { alerts: { alerts: [collection("a-1"), collection("a-2")] } },
          { complete: true, progress: 1, baselineAlertsCount: 2 },
        ]),
      ],
    });

    const result: FetchAlertsResult = await client.fetchDetectionAlerts({
      startTime: START,
      endTime: END,
    });

    expect(result.complete).toBe(true);
    expect(result.alerts).toHaveLength(2);
    const urls: Array<URL> = chronicleRequests(requests);
    expect(urls).toHaveLength(2);
    // The very same GET, not a narrowed or re-parameterized one.
    expect(urls[0]!.toString()).toBe(urls[1]!.toString());
  });

  test("the re-issue is bounded to two retries and the last partial result is returned", async () => {
    const { client, requests } = makeClient({
      chronicle: [
        stream([{ alerts: { alerts: [collection("a-1")] }, progress: 0.4 }]),
      ],
    });

    const result: FetchAlertsResult = await client.fetchDetectionAlerts({
      startTime: START,
      endTime: END,
    });

    expect(result.complete).toBe(false);
    expect(result.alerts).toHaveLength(1);
    expect(chronicleRequests(requests)).toHaveLength(3);
  });

  test("a completed stream is not re-issued", async () => {
    const { client, requests } = makeClient({
      chronicle: [stream([{ complete: true, progress: 1 }])],
    });

    const result: FetchAlertsResult = await client.fetchDetectionAlerts({
      startTime: START,
      endTime: END,
    });

    expect(result.complete).toBe(true);
    expect(chronicleRequests(requests)).toHaveLength(1);
  });
});
