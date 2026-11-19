import { describe, expect, test } from "@jest/globals";
import EsperApiClient, {
  ESPER_MIN_REQUESTS_PER_SECOND,
  ESPER_REQUESTS_PER_SECOND,
  EsperList,
  EsperPage,
  MAX_RATE_LIMIT_RETRIES,
  buildEsperQuery,
  readEsperError,
  unwrapContent,
} from "../../../../Server/Utils/DeviceManagement/Esper/EsperApiClient";
import { DeviceManagementBudgetSpent } from "../../../../Server/Utils/DeviceManagement/DeviceManagementTypes";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { JSONObject } from "../../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import { ESPER_TENANT, buildEsperDevice } from "./EsperFixtures";
import {
  FAKE_ESPER_API_KEY,
  FakeEsperApi,
  FakeEsperRequest,
  TestClock,
  createFakeEsperApi,
  createTestClock,
} from "./FakeEsperApi";

/*
 * The one way OneUptime talks to Esper's API, against a fake of it that
 * answers as Esper's API reference documents: the tenant's host only, the
 * key as a bearer token, lists paged with absolute `next` links in Esper's
 * envelope or bare, a 429 waited out (as Retry-After says, or with a
 * back-off and jitter), a server error retried, and every refusal turned
 * into an error that names the call and never carries the key.
 */

const START: Date = new Date("2026-11-19T12:00:00.000Z");

function devices(count: number): Array<JSONObject> {
  const list: Array<JSONObject> = [];

  for (let index: number = 0; index < count; index++) {
    list.push(
      buildEsperDevice({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        name: `ESP-ID-${String(index).padStart(5, "0")}`,
      }),
    );
  }

  return list;
}

function setUp(
  options: {
    count?: number;
    maxPageSize?: number;
    apiKey?: string;
    maxRequests?: number;
    random?: () => number;
  } = {},
): { clock: TestClock; api: FakeEsperApi; client: EsperApiClient } {
  const clock: TestClock = createTestClock(START);
  const api: FakeEsperApi = createFakeEsperApi({
    devices: devices(options.count ?? 3),
    now: clock.now,
    maxPageSize: options.maxPageSize,
  });
  const client: EsperApiClient = new EsperApiClient({
    apiKey: options.apiKey ?? FAKE_ESPER_API_KEY,
    tenant: ESPER_TENANT,
    transport: api.transport,
    now: clock.now,
    sleep: clock.sleep,
    random:
      options.random ||
      ((): number => {
        return 0.5;
      }),
    maxRequests: options.maxRequests,
  });

  return { clock, api, client };
}

describe("where a request goes", () => {
  test("only to the tenant's API host, over HTTPS, with the key as a bearer token", async () => {
    const { api, client } = setUp();

    await client.get("/user_info/", "", "user info request");

    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]!.url).toBe(
      "https://acme-api.esper.cloud/api/user_info/",
    );
    expect(api.requests[0]!.headers["Authorization"]).toBe(
      `Bearer ${FAKE_ESPER_API_KEY}`,
    );
  });

  test("a URL outside the tenant's API is never sent the key", () => {
    const { client } = setUp();

    expect(
      client.isAllowedUrl("https://acme-api.esper.cloud/api/v2/devices/"),
    ).toBe(true);
    expect(
      client.isAllowedUrl("http://acme-api.esper.cloud/api/v2/devices/"),
    ).toBe(false);
    expect(
      client.isAllowedUrl("https://evil-api.esper.cloud/api/v2/devices/"),
    ).toBe(false);
    expect(
      client.isAllowedUrl("https://acme-api.esper.cloud.evil.com/api/"),
    ).toBe(false);
    expect(
      client.isAllowedUrl("https://user:pass@acme-api.esper.cloud/api/x"),
    ).toBe(false);
    expect(client.isAllowedUrl("https://acme-api.esper.cloud:8443/api/x")).toBe(
      false,
    );
    expect(client.isAllowedUrl("https://acme-api.esper.cloud/other/x")).toBe(
      false,
    );
    expect(client.isAllowedUrl("not a url")).toBe(false);
  });

  test("a next page on another host is refused, and never read", async () => {
    const { api, client } = setUp();

    api.fault("/api/v2/devices/", [
      {
        status: 200,
        body: {
          code: 200,
          message: "success",
          content: {
            count: 2,
            next: "https://attacker.example.com/api/v2/devices/?offset=1",
            previous: null,
            results: [devices(1)[0]],
          },
        },
      },
    ]);

    await expect(
      client.getAll("/v2/devices/", "", "device list request", 10),
    ).rejects.toThrow(/outside the tenant's API/);
    expect(
      api.requests.some((request: FakeEsperRequest): boolean => {
        return request.url.includes("attacker.example.com");
      }),
    ).toBe(false);
  });

  test("a query keeps the parameters in order and leaves empty ones out", () => {
    expect(
      buildEsperQuery([
        ["platform", "ANDROID"],
        ["limit", 1000],
        ["search", ""],
        ["offset", undefined],
        ["last_seen_gt", "2026-11-19T11:00:00Z"],
      ]),
    ).toBe(
      "?platform=ANDROID&limit=1000&last_seen_gt=2026-11-19T11%3A00%3A00Z",
    );
    expect(buildEsperQuery([])).toBe("");
  });
});

describe("lists", () => {
  test("every page is read through Esper's next links, out of its envelope", async () => {
    const { api, client } = setUp({ count: 7, maxPageSize: 3 });

    const list: EsperList = await client.getAll(
      "/v2/devices/",
      buildEsperQuery([["limit", 1000]]),
      "device list request",
      10,
    );

    expect(list.items).toHaveLength(7);
    expect(list.count).toBe(7);
    expect(list.isTruncated).toBe(false);
    expect(api.requestsTo("/api/v2/devices/")).toHaveLength(3);
  });

  test("a list cut at maxPages says so", async () => {
    const { client } = setUp({ count: 7, maxPageSize: 3 });

    const list: EsperList = await client.getAll(
      "/v2/devices/",
      "",
      "device list request",
      2,
    );

    expect(list.items).toHaveLength(6);
    expect(list.isTruncated).toBe(true);
  });

  test("a bare list (the enterprise routes) reads the same as a wrapped one", () => {
    const bare: JSONObject = { count: 1, next: null, results: [{ id: "a" }] };

    expect(unwrapContent(bare)).toBe(bare);
    expect(unwrapContent({ code: 200, message: "", content: bare })).toBe(bare);
    expect(unwrapContent([1, 2])).toEqual([1, 2]);
  });

  test("an answer that is not a list fails, naming the call", async () => {
    const { api, client } = setUp();

    api.fault("/api/v2/devices/", [
      {
        status: 200,
        body: { code: 200, message: "success", content: { count: 1 } },
      },
    ]);

    await expect(
      client.getAll("/v2/devices/", "", "device list request", 10),
    ).rejects.toThrow(/device list request with something that is not a list/);
  });

  test("an empty page ends the list, whatever its next link says", async () => {
    const { api, client } = setUp();

    api.fault("/api/v2/devices/", [
      {
        status: 200,
        body: {
          code: 200,
          message: "success",
          content: {
            count: 5,
            next: "https://acme-api.esper.cloud/api/v2/devices/?offset=5",
            previous: null,
            results: [],
          },
        },
      },
    ]);

    const list: EsperList = await client.getAll(
      "/v2/devices/",
      "",
      "device list request",
      10,
    );

    expect(list.items).toEqual([]);
    expect(api.requestsTo("/api/v2/devices/")).toHaveLength(1);
  });

  test("the read's budget spent part way: what was read, said to be cut short, when asked for", async () => {
    const { client } = setUp({ count: 7, maxPageSize: 3, maxRequests: 2 });

    const list: EsperList = await client.getAll(
      "/v2/devices/",
      "",
      "device list request",
      10,
      { stopWhenBudgetSpent: true },
    );

    expect(list.items).toHaveLength(6);
    expect(list.isTruncated).toBe(true);
    expect(list.isBudgetSpent).toBe(true);
  });

  test("...and thrown when not", async () => {
    const { client } = setUp({ count: 7, maxPageSize: 3, maxRequests: 2 });

    await expect(
      client.getAll("/v2/devices/", "", "device list request", 10),
    ).rejects.toBeInstanceOf(DeviceManagementBudgetSpent);
    expect(client.getRequestCount()).toBe(2);
  });
});

describe("rate limits", () => {
  test("a 429 with Retry-After waits as long as asked, halves the pace, and tries again", async () => {
    const { api, client, clock } = setUp();

    api.fault("/api/user_info/", [
      {
        status: 429,
        headers: { "retry-after": "7" },
        body: { message: "Too many requests." },
      },
    ]);

    const page: EsperPage = await client.get(
      "/user_info/",
      "",
      "user info request",
    );

    expect(page.status).toBe(200);
    expect(clock.sleeps).toContain(7000);
    expect(client.wasRateLimited()).toBe(true);
    expect(client.getRequestsPerSecond()).toBe(ESPER_REQUESTS_PER_SECOND / 2);
    expect(api.requestsTo("/api/user_info/")).toHaveLength(2);
  });

  test("a 429 without Retry-After backs off exponentially, with jitter", async () => {
    const { api, client, clock } = setUp({
      random: (): number => {
        return 0;
      },
    });

    api.fault("/api/user_info/", [
      { status: 429, body: {} },
      { status: 429, body: {} },
      { status: 429, body: {} },
    ]);

    await client.get("/user_info/", "", "user info request");

    // 2^n seconds times a jitter of 0.5 (random 0): 1 s, 2 s, 4 s.
    expect(
      clock.sleeps.filter((sleep: number): boolean => {
        return sleep >= 1000;
      }),
    ).toEqual([1000, 2000, 4000]);
  });

  test("the jitter spreads each wait between half and one and a half times it", () => {
    const low: EsperApiClient = setUp({
      random: (): number => {
        return 0;
      },
    }).client;
    const high: EsperApiClient = setUp({
      random: (): number => {
        return 1;
      },
    }).client;

    expect(low.backoffMs(3)).toBe(4000);
    expect(high.backoffMs(3)).toBe(12000);
    // Capped at 30 s, before the jitter, however many times it was refused.
    expect(high.backoffMs(20)).toBe(45000);
    expect(low.backoffMs(20)).toBe(15000);
  });

  test("the pace never halves below its floor", async () => {
    const { api, client } = setUp();

    for (let round: number = 0; round < 3; round++) {
      api.fault("/api/user_info/", [
        { status: 429, headers: { "retry-after": "1" } },
        { status: 429, headers: { "retry-after": "1" } },
      ]);
      await client.get("/user_info/", "", "user info request");
    }

    expect(client.getRequestsPerSecond()).toBe(ESPER_MIN_REQUESTS_PER_SECOND);
  });

  test("still refused after MAX_RATE_LIMIT_RETRIES: a rate-limit error that says so", async () => {
    const { api, client } = setUp();

    api.fault(
      "/api/user_info/",
      new Array(MAX_RATE_LIMIT_RETRIES + 1).fill({
        status: 429,
        headers: { "retry-after": "2" },
        body: { message: "Too many requests." },
      }),
    );

    const error: unknown = await client
      .get("/user_info/", "", "user info request")
      .catch((caught: unknown) => {
        return caught;
      });

    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as LlmProviderError).kind).toBe(
      LlmConnectionFailureKind.RateLimited,
    );
    expect((error as LlmProviderError).message).toMatch(
      /slow down \(HTTP 429\)/,
    );
    expect(api.requestsTo("/api/user_info/")).toHaveLength(
      MAX_RATE_LIMIT_RETRIES + 1,
    );
  });

  test("a Retry-After longer than a read waits ends the call at once", async () => {
    const { api, client, clock } = setUp();

    api.fault("/api/user_info/", [
      { status: 429, headers: { "retry-after": "3600" } },
    ]);

    const error: unknown = await client
      .get("/user_info/", "", "user info request")
      .catch((caught: unknown) => {
        return caught;
      });

    expect((error as LlmProviderError).kind).toBe(
      LlmConnectionFailureKind.RateLimited,
    );
    expect((error as LlmProviderError).retryAfterSeconds).toBe(3600);
    expect(
      clock.sleeps.every((sleep: number): boolean => {
        return sleep < 60 * 1000;
      }),
    ).toBe(true);
  });

  test("requests are paced: one at a time, 1/requestsPerSecond apart", async () => {
    const { api, client } = setUp();

    for (let index: number = 0; index < 4; index++) {
      await client.get("/user_info/", "", "user info request");
    }

    const times: Array<number> = api.requests.map(
      (request: FakeEsperRequest): number => {
        return request.at.getTime();
      },
    );

    for (let index: number = 1; index < times.length; index++) {
      expect(times[index]! - times[index - 1]!).toBeGreaterThanOrEqual(
        1000 / ESPER_REQUESTS_PER_SECOND,
      );
    }
  });
});

describe("failures", () => {
  test("a refused key is an authentication failure that names the call", async () => {
    const { client } = setUp({ apiKey: "wrong-key-0123456789" });

    const error: unknown = await client
      .get("/user_info/", "", "user info request")
      .catch((caught: unknown) => {
        return caught;
      });

    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as LlmProviderError).kind).toBe(
      LlmConnectionFailureKind.Authentication,
    );
    expect((error as LlmProviderError).statusCode).toBe(401);
    expect((error as LlmProviderError).message).toMatch(
      /user info request with HTTP 401: Invalid token\./,
    );
  });

  test("403 is a permission failure, 404 a setting", async () => {
    const { api, client } = setUp();

    api.fault("/api/user_info/", [
      { status: 403, body: { detail: "You do not have permission." } },
      { status: 404, body: { code: 404, message: "Not found.", content: {} } },
    ]);

    const forbidden: unknown = await client
      .get("/user_info/", "", "user info request")
      .catch((caught: unknown) => {
        return caught;
      });
    const missing: unknown = await client
      .get("/user_info/", "", "user info request")
      .catch((caught: unknown) => {
        return caught;
      });

    expect((forbidden as LlmProviderError).kind).toBe(
      LlmConnectionFailureKind.Permission,
    );
    expect((forbidden as LlmProviderError).message).toContain(
      "You do not have permission.",
    );
    expect((missing as LlmProviderError).kind).toBe(
      LlmConnectionFailureKind.Settings,
    );
  });

  test("a server error is tried again, a little", async () => {
    const { api, client } = setUp();

    api.fault("/api/user_info/", [{ status: 502 }, { status: 503 }]);

    const page: EsperPage = await client.get(
      "/user_info/",
      "",
      "user info request",
    );

    expect(page.status).toBe(200);
    expect(api.requestsTo("/api/user_info/")).toHaveLength(3);
  });

  test("a server error that persists is reported as Esper being unavailable", async () => {
    const { api, client } = setUp();

    api.fault("/api/user_info/", [
      { status: 500 },
      { status: 500 },
      { status: 500 },
    ]);

    const error: unknown = await client
      .get("/user_info/", "", "user info request")
      .catch((caught: unknown) => {
        return caught;
      });

    expect((error as LlmProviderError).kind).toBe(
      LlmConnectionFailureKind.Unavailable,
    );
  });

  test("a dropped connection is tried once more", async () => {
    const { api, client } = setUp();

    api.fault("/api/user_info/", ["throw"]);

    const page: EsperPage = await client.get(
      "/user_info/",
      "",
      "user info request",
    );

    expect(page.status).toBe(200);
  });

  test("a connection that keeps dropping fails as unreachable, without the key", async () => {
    const { api, client } = setUp();

    api.fault("/api/user_info/", ["throw", "throw"]);

    const error: unknown = await client
      .get("/user_info/", "", "user info request")
      .catch((caught: unknown) => {
        return caught;
      });

    expect((error as LlmProviderError).kind).toBe(
      LlmConnectionFailureKind.Unavailable,
    );
    expect((error as LlmProviderError).message).not.toContain(
      FAKE_ESPER_API_KEY,
    );
  });

  test("the key never reaches an error, even when Esper echoes it back", async () => {
    const { api, client } = setUp();

    api.fault("/api/user_info/", [
      {
        status: 400,
        body: { message: `Bad token ${FAKE_ESPER_API_KEY} was given.` },
      },
    ]);

    const error: unknown = await client
      .get("/user_info/", "", "user info request")
      .catch((caught: unknown) => {
        return caught;
      });

    expect((error as LlmProviderError).message).not.toContain(
      FAKE_ESPER_API_KEY,
    );
    expect((error as LlmProviderError).message).toContain("[REDACTED]");
  });

  test("Esper's error body is read in each of its shapes", () => {
    const read: (body: unknown) => string = (body: unknown): string => {
      return readEsperError({
        statusCode: 400,
        bodyText: typeof body === "string" ? body : JSON.stringify(body),
        bodyJson: typeof body === "string" ? undefined : body,
      });
    };

    expect(
      read({ errors: ["One.", "Two."], message: "Bad.", status: 400 }),
    ).toBe("Bad. One. Two.");
    expect(read({ code: 401, message: "Invalid token.", content: {} })).toBe(
      "Invalid token.",
    );
    expect(read({ detail: "Not allowed." })).toBe("Not allowed.");
    expect(read("<html>Bad Gateway</html>")).toBe("<html>Bad Gateway</html>");
  });

  test("a redirect to the tenant's own API is followed; one elsewhere is refused", async () => {
    const { api, client } = setUp();

    api.fault("/api/user_info", [
      {
        status: 301,
        headers: { location: "https://acme-api.esper.cloud/api/user_info/" },
      },
    ]);

    expect(
      (await client.get("/user_info", "", "user info request")).status,
    ).toBe(200);

    api.fault("/api/user_info/", [
      {
        status: 302,
        headers: { location: "https://elsewhere.example.com/api/" },
      },
    ]);

    await expect(
      client.get("/user_info/", "", "user info request"),
    ).rejects.toThrow(/outside the tenant's API/);
  });
});
