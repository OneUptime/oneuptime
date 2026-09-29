import { generateKeyPairSync } from "crypto";
import GoogleSecOpsClient, {
  CuratedRuleDetectionCount,
  FetchInitLike,
  FetchLike,
  FetchResponseLike,
  SearchDetectionsResult,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import APIException from "../../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * The curated half of the created-time read, at the wire.
 *
 * legacySearchCuratedDetections takes "Required. The specific Curated Rule
 * ID to list detections for" and documents no wildcard. The connector used
 * to send ruleId=- there, which Google does not reject: it answers HTTP 200
 * with no detections, so every curated detection was silently never
 * imported. The client now refuses a curated search without one real
 * curated rule id, and countAllCuratedRuleSetDetections is how the connector
 * learns which ids to search.
 * https://docs.cloud.google.com/chronicle/docs/reference/rest/v1alpha/projects.locations.instances.legacy/legacySearchCuratedDetections
 * https://docs.cloud.google.com/chronicle/docs/reference/rest/v1alpha/projects.locations.instances/countAllCuratedRuleSetDetections
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
const API_BASE: string = `https://us-chronicle.googleapis.com/v1alpha/${INSTANCE}`;
const START: Date = new Date("2026-09-08T12:00:00.000Z");
const END: Date = new Date("2026-09-15T12:00:00.000Z");

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

interface Transport {
  client: GoogleSecOpsClient;
  requests: Array<RecordedRequest>;
  chronicle: () => Array<RecordedRequest>;
}

function makeClient(responses: {
  token?: Array<StubbedResponse> | undefined;
  chronicle: Array<StubbedResponse>;
}): Transport {
  const requests: Array<RecordedRequest> = [];
  let tokenIndex: number = 0;
  let chronicleIndex: number = 0;
  const tokenQueue: Array<StubbedResponse> = responses.token || [
    {
      status: 200,
      body: JSON.stringify({ access_token: "token-1", expires_in: 3600 }),
    },
  ];

  const fetchImplementation: FetchLike = (
    url: string,
    init: FetchInitLike,
  ): Promise<FetchResponseLike> => {
    requests.push({
      url,
      method: init.method,
      headers: init.headers,
      body: init.body,
    });

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
  });

  return {
    client,
    requests,
    chronicle: (): Array<RecordedRequest> => {
      return requests.filter((request: RecordedRequest): boolean => {
        return request.url !== GOOGLE_TOKEN_URI;
      });
    },
  };
}

function ok(body: unknown): StubbedResponse {
  return { status: 200, body: JSON.stringify(body) };
}

function ruleName(ruleId: string): string {
  return `projects/my-project/locations/us/instances/3f0a-instance/curatedRules/${ruleId}`;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the promise to reject.");
}

describe("GoogleSecOpsClient.countCuratedRuleDetections request", () => {
  test("POSTs the interval as JSON to :countAllCuratedRuleSetDetections with the bearer token", async () => {
    const transport: Transport = makeClient({ chronicle: [ok({})] });

    await transport.client.countCuratedRuleDetections({
      startTime: START,
      endTime: END,
    });

    const [request] = transport.chronicle();
    expect(transport.chronicle()).toHaveLength(1);
    expect(request!.method).toBe("POST");
    // A custom method on the instance itself, not a legacy: route.
    expect(request!.url).toBe(`${API_BASE}:countAllCuratedRuleSetDetections`);
    expect(new URL(request!.url).search).toBe("");
    expect(request!.headers).toMatchObject({
      Authorization: "Bearer token-1",
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(request!.body || "")).toEqual({
      interval: {
        startTime: "2026-09-08T12:00:00.000Z",
        endTime: "2026-09-15T12:00:00.000Z",
      },
    });
  });

  test("a 401 re-mints the token once and retries the same POST", async () => {
    const transport: Transport = makeClient({
      token: [
        ok({ access_token: "token-1", expires_in: 3600 }),
        ok({ access_token: "token-2", expires_in: 3600 }),
      ],
      chronicle: [
        { status: 401, body: "" },
        ok({
          curatedRuleCounts: [{ curatedRule: ruleName("ur_a"), count: 2 }],
        }),
      ],
    });

    const counts: Array<CuratedRuleDetectionCount> =
      await transport.client.countCuratedRuleDetections({
        startTime: START,
        endTime: END,
      });

    expect(counts).toEqual([{ ruleId: "ur_a", count: 2 }]);
    const chronicle: Array<RecordedRequest> = transport.chronicle();
    expect(chronicle).toHaveLength(2);
    expect(chronicle[0]!.headers["Authorization"]).toBe("Bearer token-1");
    expect(chronicle[1]!.headers["Authorization"]).toBe("Bearer token-2");
    expect(chronicle[1]!.body).toBe(chronicle[0]!.body);
  });

  test.each([400, 403, 404, 429, 500])(
    "HTTP %s throws the curated counts prefix with a status the connector can read back",
    async (status: number) => {
      const transport: Transport = makeClient({
        chronicle: [
          {
            status,
            body: JSON.stringify({
              error: { code: status, message: "nope", status: "X" },
            }),
          },
        ],
      });

      const error: unknown = await rejectionOf(
        transport.client.countCuratedRuleDetections({
          startTime: START,
          endTime: END,
        }),
      );

      expect(error).toBeInstanceOf(APIException);
      expect((error as Error).message).toMatch(
        new RegExp(
          `^Google SecOps curated rule detection counts failed \\(HTTP ${status}\\): `,
        ),
      );
      expect(GoogleSecOpsClient.readHttpStatus(error)).toBe(status);
    },
  );
});

describe("GoogleSecOpsClient.parseCuratedRuleCountsBody", () => {
  test("a quiet tenant's bare {} is no curated rule, not an error", () => {
    expect(GoogleSecOpsClient.parseCuratedRuleCountsBody("{}")).toEqual([]);
  });

  test("reads the rule id off each curatedRule name, merges precisions, drops zero counts and orders by id", () => {
    const body: string = JSON.stringify({
      curatedRuleSetCounts: [
        { curatedRuleSet: "projects/p/.../curatedRuleSets/set-1", count: 9 },
      ],
      curatedRuleCounts: [
        { curatedRule: ruleName("ur_zeta"), precision: "BROAD", count: 1 },
        { curatedRule: ruleName("ur_alpha"), precision: "PRECISE", count: 3 },
        { curatedRule: ruleName("ur_alpha"), precision: "BROAD", count: 2 },
        { curatedRule: ruleName("ur_silent"), precision: "PRECISE", count: 0 },
        // proto3 may render a count as a string.
        { curatedRule: ruleName("ur_mid"), count: "4" },
      ],
    });

    expect(GoogleSecOpsClient.parseCuratedRuleCountsBody(body)).toEqual([
      { ruleId: "ur_alpha", count: 5 },
      { ruleId: "ur_mid", count: 4 },
      { ruleId: "ur_zeta", count: 1 },
    ]);
  });

  test("skips entries that cannot name a curated rule instead of searching them", () => {
    const body: string = JSON.stringify({
      curatedRuleCounts: [
        { count: 3 },
        { curatedRule: 42, count: 3 },
        { curatedRule: "", count: 3 },
        { curatedRule: `${ruleName("")}`, count: 3 },
        // A wildcard must never come back out as a rule id to search.
        { curatedRule: ruleName("-"), count: 3 },
        "not an object",
        { curatedRule: ruleName("ur_ok"), count: 1 },
      ],
    });

    expect(GoogleSecOpsClient.parseCuratedRuleCountsBody(body)).toEqual([
      { ruleId: "ur_ok", count: 1 },
    ]);
  });

  test.each([
    ["an empty body", "", "returned an empty body"],
    ["a non-JSON body", "<html>proxy</html>", "returned a non-JSON body"],
    ["an array", "[]", "returned an unrecognized response shape"],
    [
      "another endpoint's answer",
      JSON.stringify({ detections: [] }),
      "returned an unrecognized response shape",
    ],
    [
      "an in-band error",
      JSON.stringify({ error: { code: 500, message: "boom" } }),
      "returned an error in the response",
    ],
  ])(
    "refuses %s rather than reading it as no curated rule fired",
    (_label: string, body: string, expected: string) => {
      let thrown: unknown = null;

      try {
        GoogleSecOpsClient.parseCuratedRuleCountsBody(body);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(APIException);
      expect((thrown as Error).message).toContain(
        `Google SecOps curated rule detection counts ${expected}`,
      );
    },
  );
});

describe("GoogleSecOpsClient.searchDetections rule ids", () => {
  test("regression: a curated search without a rule id is refused before anything is sent", async () => {
    const transport: Transport = makeClient({ chronicle: [ok({})] });

    const error: unknown = await rejectionOf(
      transport.client.searchDetections({
        startTime: START,
        endTime: END,
        listBasis: "CREATED_TIME",
        alertingOnly: false,
        curated: true,
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toContain("has no wildcard");
    // Not even a token exchange: nothing left the process.
    expect(transport.requests).toHaveLength(0);
  });

  test.each([
    "-",
    "ur_rule@-",
    " ",
    "ur_a/../b",
    "ur_a?x=1",
    "ur_a&pageSize=1",
  ])("a curated search refuses the rule id %j", async (ruleId: string) => {
    const transport: Transport = makeClient({ chronicle: [ok({})] });

    const error: unknown = await rejectionOf(
      transport.client.searchDetections({
        startTime: START,
        endTime: END,
        listBasis: "CREATED_TIME",
        alertingOnly: false,
        curated: true,
        ruleId,
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(transport.requests).toHaveLength(0);
  });

  test("a curated search sends exactly the curated rule id it was given", async () => {
    const transport: Transport = makeClient({
      chronicle: [
        ok({ curatedDetections: [{ id: "de_1", type: "RULE_DETECTION" }] }),
      ],
    });

    const result: SearchDetectionsResult =
      await transport.client.searchDetections({
        startTime: START,
        endTime: END,
        listBasis: "CREATED_TIME",
        alertingOnly: false,
        curated: true,
        ruleId: "ur_ttp_GCP_MassSecretDeletion",
      });

    const url: URL = new URL(transport.chronicle()[0]!.url);
    expect(url.pathname).toBe(
      `/v1alpha/${INSTANCE}/legacy:legacySearchCuratedDetections`,
    );
    expect(url.searchParams.getAll("ruleId")).toEqual([
      "ur_ttp_GCP_MassSecretDeletion",
    ]);
    expect(Array.from(url.searchParams.keys()).sort()).toEqual([
      "endTime",
      "listBasis",
      "pageSize",
      "ruleId",
      "startTime",
    ]);
    expect(result.detections).toHaveLength(1);
  });

  test("a rule search still reads every rule through the documented wildcard", async () => {
    const transport: Transport = makeClient({ chronicle: [ok({})] });

    await transport.client.searchDetections({
      startTime: START,
      endTime: END,
      listBasis: "CREATED_TIME",
      alertingOnly: true,
    });

    const url: URL = new URL(transport.chronicle()[0]!.url);
    expect(url.pathname).toBe(
      `/v1alpha/${INSTANCE}/legacy:legacySearchDetections`,
    );
    expect(url.searchParams.get("ruleId")).toBe("-");
    expect(url.searchParams.get("alertState")).toBe("ALERTING");
  });
});
