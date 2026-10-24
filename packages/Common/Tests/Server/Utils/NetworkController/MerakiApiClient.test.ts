import MerakiApiClient, {
  MAX_RATE_LIMIT_RETRIES,
  MAX_REDIRECTS,
  MERAKI_REQUESTS_PER_SECOND,
  MerakiBudgetSpent,
  MerakiList,
  MerakiPage,
  buildMerakiQuery,
  readMerakiErrors,
  readRetryAfterSeconds,
} from "../../../../Server/Utils/NetworkController/Meraki/MerakiApiClient";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import {
  MerakiRegion,
  MerakiRegionDefinition,
  getMerakiRegion,
} from "../../../../Types/NetworkController/MerakiRegion";
import {
  FAKE_API_KEY,
  FakeMerakiApi,
  FakeMerakiRequest,
  TestClock,
  buildBranchOrganization,
  createFakeMerakiApi,
  createTestClock,
  merakiError,
} from "./FakeMerakiApi";
import { describe, expect, test } from "@jest/globals";

/*
 * Every request OneUptime makes to the Meraki dashboard API, against a
 * faithful fake of it: where the key goes (the region's hosts only, in the
 * header Meraki asks for), how fast (paced to a share of the organization's
 * 10 requests a second, slower after a 429), how a 429, a server error, a
 * dropped connection and a redirect are handled, how a list is paged, and
 * what a failure says (Meraki's own reason, never the key).
 */

const START: Date = new Date("2026-10-24T12:00:00.000Z");
const GLOBAL: MerakiRegionDefinition = getMerakiRegion(
  MerakiRegion.Global,
) as MerakiRegionDefinition;

interface Setup {
  clock: TestClock;
  api: FakeMerakiApi;
  client: MerakiApiClient;
}

function setup(
  options: Partial<Parameters<typeof createFakeMerakiApi>[0]> = {},
  clientOptions: Partial<ConstructorParameters<typeof MerakiApiClient>[0]> = {},
): Setup {
  const clock: TestClock = createTestClock(START);
  const api: FakeMerakiApi = createFakeMerakiApi({
    organizations: [
      buildBranchOrganization({ id: "549236", name: "Acme", count: 5 }),
    ],
    now: clock.now,
    ...options,
  });
  const client: MerakiApiClient = new MerakiApiClient({
    apiKey: FAKE_API_KEY,
    region: GLOBAL,
    transport: api.transport,
    now: clock.now,
    sleep: clock.sleep,
    ...clientOptions,
  });

  return { clock, api, client };
}

async function failure(promise: Promise<unknown>): Promise<LlmProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LlmProviderError);
    return error as LlmProviderError;
  }

  throw new Error("expected the call to fail");
}

describe("what a request carries", () => {
  test("the key as Meraki asks for it, to the region's API host, over HTTPS", async () => {
    const { api, client } = setup();

    await client.get("/organizations/549236", "", "organization");

    expect(api.requests).toHaveLength(1);
    const sent: FakeMerakiRequest = api.requests[0]!;
    expect(sent.url.origin).toBe("https://api.meraki.com");
    expect(sent.url.pathname).toBe("/api/v1/organizations/549236");
    expect(sent.request.method).toBe("GET");
    expect(sent.request.headers?.["Authorization"]).toBe(
      `Bearer ${FAKE_API_KEY}`,
    );
    expect(sent.request.headers?.["Accept"]).toBe("application/json");
  });

  test("asks the transport for every status, so it can read a 429 and a redirect itself", async () => {
    const { api, client } = setup();

    await client.get("/organizations", "", "list of organizations");

    expect(api.requests[0]!.request.acceptAnyStatus).toBe(true);
  });

  test("lists in query strings the way Meraki takes them", () => {
    expect(
      buildMerakiQuery([
        ["perPage", 1000],
        ["productTypes[]", "appliance"],
        ["t0", "2026-10-24T10:00:00.000Z"],
        ["skip", undefined],
        ["empty", ""],
      ]),
    ).toBe(
      "?perPage=1000&productTypes%5B%5D=appliance&t0=2026-10-24T10%3A00%3A00.000Z",
    );
    expect(buildMerakiQuery([])).toBe("");
  });
});

describe("pacing", () => {
  test("requests start at most three a second", async () => {
    const { api, client } = setup();

    for (let index: number = 0; index < 7; index++) {
      await client.get("/organizations", "", "list of organizations");
    }

    const times: Array<number> = api.requests.map(
      (request: FakeMerakiRequest) => {
        return request.atMs;
      },
    );

    for (let index: number = 1; index < times.length; index++) {
      expect(times[index]! - times[index - 1]!).toBeGreaterThanOrEqual(
        Math.floor(1000 / MERAKI_REQUESTS_PER_SECOND),
      );
    }

    // Seven requests take two seconds at three a second: never a burst.
    expect(times[times.length - 1]! - times[0]!).toBeGreaterThanOrEqual(1990);
    expect(client.getRequestCount()).toBe(7);
  });
});

describe("a 429", () => {
  test("waits what Retry-After says, slows down and tries again", async () => {
    const { api, client, clock } = setup({
      scripted: {
        "/api/v1/organizations/549236": [
          merakiError(429, "API rate limit exceeded for organization", {
            "retry-after": "2",
          }),
        ],
      },
    });

    const page: MerakiPage = await client.get(
      "/organizations/549236",
      "",
      "organization",
    );

    expect(page.status).toBe(200);
    expect(api.callsTo("/api/v1/organizations/549236")).toHaveLength(2);
    expect(clock.sleeps).toContain(2000);
    expect(client.wasRateLimited()).toBe(true);
    expect(client.getRequestsPerSecond()).toBe(1.5);
  });

  test("without a Retry-After, backs off by itself", async () => {
    const { clock, client } = setup({
      scripted: {
        "/api/v1/organizations/549236": [
          merakiError(429, "API rate limit exceeded"),
        ],
      },
    });

    await client.get("/organizations/549236", "", "organization");

    expect(clock.sleeps).toContain(2000);
  });

  test("an HTTP-date Retry-After counts too", () => {
    expect(readRetryAfterSeconds("Sat, 24 Oct 2026 12:00:30 GMT", START)).toBe(
      30,
    );
    expect(readRetryAfterSeconds("5", START)).toBe(5);
    expect(readRetryAfterSeconds("soon", START)).toBeNull();
    expect(readRetryAfterSeconds(undefined, START)).toBeNull();
  });

  test("gives up after three, saying it was asked to slow down", async () => {
    const answers: Array<ReturnType<typeof merakiError>> = Array.from(
      { length: MAX_RATE_LIMIT_RETRIES + 1 },
      () => {
        return merakiError(429, "API rate limit exceeded", {
          "retry-after": "1",
        });
      },
    );
    const { api, client } = setup({
      scripted: { "/api/v1/organizations/549236": answers },
    });

    const error: LlmProviderError = await failure(
      client.get("/organizations/549236", "", "organization"),
    );

    expect(error.kind).toBe(LlmConnectionFailureKind.RateLimited);
    expect(error.message).toContain("slow down");
    expect(api.callsTo("/api/v1/organizations/549236")).toHaveLength(
      MAX_RATE_LIMIT_RETRIES + 1,
    );
  });

  test("a Retry-After longer than a minute ends the request at once", async () => {
    const { api, client, clock } = setup({
      scripted: {
        "/api/v1/organizations/549236": [
          merakiError(429, "slow down", { "retry-after": "3600" }),
        ],
      },
    });

    const error: LlmProviderError = await failure(
      client.get("/organizations/549236", "", "organization"),
    );

    expect(error.kind).toBe(LlmConnectionFailureKind.RateLimited);
    expect(error.retryAfterSeconds).toBe(3600);
    expect(api.callsTo("/api/v1/organizations/549236")).toHaveLength(1);
    expect(
      clock.sleeps.some((ms: number) => {
        return ms >= 3600_000;
      }),
    ).toBe(false);
  });

  test("the pace never drops below one request a second", async () => {
    const { client } = setup({
      scripted: {
        "/api/v1/organizations/549236": [
          merakiError(429, "x", { "retry-after": "0" }),
          merakiError(429, "x", { "retry-after": "0" }),
          merakiError(429, "x", { "retry-after": "0" }),
        ],
      },
    });

    await client.get("/organizations/549236", "", "organization");

    expect(client.getRequestsPerSecond()).toBe(1);
  });
});

describe("server errors and dropped connections", () => {
  test("a 500 is tried twice more, then fails as Meraki being unavailable", async () => {
    const { api, client } = setup({
      scripted: {
        "/api/v1/organizations/549236": [
          merakiError(500, "Internal error"),
          merakiError(502, "Bad gateway"),
          merakiError(503, "Service unavailable"),
        ],
      },
    });

    const error: LlmProviderError = await failure(
      client.get("/organizations/549236", "", "organization"),
    );

    expect(error.kind).toBe(LlmConnectionFailureKind.Unavailable);
    expect(error.statusCode).toBe(503);
    expect(error.message).toBe(
      "Meraki answered the organization with HTTP 503: Service unavailable",
    );
    expect(api.callsTo("/api/v1/organizations/549236")).toHaveLength(3);
  });

  test("a 500 that clears on retry is a success", async () => {
    const { client } = setup({
      scripted: {
        "/api/v1/organizations/549236": [merakiError(500, "Internal error")],
      },
    });

    expect(
      (await client.get("/organizations/549236", "", "organization")).status,
    ).toBe(200);
  });

  test("a dropped connection is tried once more", async () => {
    const { api, client } = setup({
      dropped: { "/api/v1/organizations/549236": 1 },
    });

    expect(
      (await client.get("/organizations/549236", "", "organization")).status,
    ).toBe(200);
    expect(api.callsTo("/api/v1/organizations/549236")).toHaveLength(2);
  });

  test("two dropped connections fail the call, without the key in the message", async () => {
    const { client } = setup({
      dropped: { "/api/v1/organizations/549236": 2 },
    });

    const error: LlmProviderError = await failure(
      client.get("/organizations/549236", "", "organization"),
    );

    expect(error.kind).toBe(LlmConnectionFailureKind.Unavailable);
    expect(error.message).toContain("socket hang up");
    expect(error.message).not.toContain(FAKE_API_KEY);
  });
});

describe("other answers", () => {
  test.each([
    [401, "Invalid API key", LlmConnectionFailureKind.Authentication],
    [403, "API access is not enabled", LlmConnectionFailureKind.Permission],
    [404, "Organization not found", LlmConnectionFailureKind.Settings],
    [400, "Bad request", LlmConnectionFailureKind.Other],
  ])(
    "HTTP %i fails at once, naming the call and Meraki's reason",
    async (status: number, reason: string, kind: LlmConnectionFailureKind) => {
      const { api, client } = setup({
        scripted: {
          "/api/v1/organizations/549236": [merakiError(status, reason)],
        },
      });

      const error: LlmProviderError = await failure(
        client.get("/organizations/549236", "", "organization"),
      );

      expect(error.kind).toBe(kind);
      expect(error.message).toBe(
        `Meraki answered the organization with HTTP ${status}: ${reason}`,
      );
      expect(api.callsTo("/api/v1/organizations/549236")).toHaveLength(1);
    },
  );

  test("a wrong key is refused by Meraki and says so", async () => {
    const { client } = setup({ apiKey: "a-different-key-0123456789abcdef" });

    const error: LlmProviderError = await failure(
      client.get("/organizations", "", "list of organizations"),
    );

    expect(error.kind).toBe(LlmConnectionFailureKind.Authentication);
  });

  test("an answer that echoes the key never shows it", async () => {
    const { client } = setup({
      scripted: {
        "/api/v1/organizations/549236": [
          merakiError(400, `The key ${FAKE_API_KEY} is not valid here`),
        ],
      },
    });

    const error: LlmProviderError = await failure(
      client.get("/organizations/549236", "", "organization"),
    );

    expect(error.message).not.toContain(FAKE_API_KEY);
    expect(error.message).toContain("[REDACTED]");
    expect(error.responseBody || "").not.toContain(FAKE_API_KEY);
  });

  test("Meraki's errors array is read, else the start of the body", () => {
    expect(
      readMerakiErrors({
        statusCode: 400,
        bodyText: "",
        bodyJson: { errors: ["first", "", 5, "second"] },
      }),
    ).toBe("first second");
    expect(
      readMerakiErrors({
        statusCode: 502,
        bodyText: "<html>Bad gateway</html>",
        bodyJson: undefined,
      }),
    ).toBe("<html>Bad gateway</html>");
  });
});

describe("redirects", () => {
  test("to the organization's shard: followed, with the key", async () => {
    const { api, client } = setup({
      shardHosts: ["n123.meraki.com"],
      scripted: {
        "/api/v1/organizations/549236": [
          {
            status: 308,
            headers: {
              location: "https://n123.meraki.com/api/v1/organizations/549236",
            },
          },
        ],
      },
    });

    const page: MerakiPage = await client.get(
      "/organizations/549236",
      "",
      "organization",
    );

    expect(page.status).toBe(200);
    expect(
      api.requests.map((request: FakeMerakiRequest) => {
        return request.url.hostname;
      }),
    ).toEqual(["api.meraki.com", "n123.meraki.com"]);
    expect(api.requests[1]!.request.headers?.["Authorization"]).toBe(
      `Bearer ${FAKE_API_KEY}`,
    );
  });

  test("a relative Location is resolved on the host that answered", async () => {
    const { api, client } = setup({
      scripted: {
        "/api/v1/organizations/549236": [
          {
            status: 302,
            headers: { location: "/api/v1/organizations/549236?again=1" },
          },
        ],
      },
    });

    await client.get("/organizations/549236", "", "organization");

    expect(api.requests[1]!.url.toString()).toBe(
      "https://api.meraki.com/api/v1/organizations/549236?again=1",
    );
  });

  test.each([
    ["https://evil.example/api/v1/organizations"],
    ["https://api.meraki.com.evil.example/api/v1/organizations"],
    ["http://n123.meraki.com/api/v1/organizations"],
    ["https://n123.meraki.com:8443/api/v1/organizations"],
    ["https://user:pass@n123.meraki.com/api/v1/organizations"],
    ["https://n123.meraki.com/admin"],
    ["https://api.meraki.cn/api/v1/organizations"],
  ])("to %s: refused, and nothing is sent there", async (location: string) => {
    const { api, client } = setup({
      scripted: {
        "/api/v1/organizations/549236": [
          { status: 307, headers: { location } },
        ],
      },
    });

    const error: LlmProviderError = await failure(
      client.get("/organizations/549236", "", "organization"),
    );

    expect(error.message).toContain("outside the Meraki dashboard API");
    expect(api.requests).toHaveLength(1);
  });

  test("a redirect loop stops after three hops", async () => {
    const loop: Array<{ status: number; headers: Record<string, string> }> =
      Array.from({ length: MAX_REDIRECTS + 2 }, () => {
        return {
          status: 302,
          headers: {
            location: "https://api.meraki.com/api/v1/organizations/549236",
          },
        };
      });
    const { api, client } = setup({
      scripted: { "/api/v1/organizations/549236": loop },
    });

    const error: LlmProviderError = await failure(
      client.get("/organizations/549236", "", "organization"),
    );

    expect(error.message).toContain("could not follow");
    expect(api.requests).toHaveLength(MAX_REDIRECTS + 1);
  });

  test("a redirect without a Location fails", async () => {
    const { client } = setup({
      scripted: { "/api/v1/organizations/549236": [{ status: 301 }] },
    });

    expect(
      (await failure(client.get("/organizations/549236", "", "organization")))
        .statusCode,
    ).toBe(301);
  });
});

describe("paging a list", () => {
  test("follows next links until the last page", async () => {
    const { api, client } = setup({
      organizations: [
        buildBranchOrganization({ id: "549236", name: "Acme", count: 7 }),
      ],
      maxPerPage: 3,
    });

    const list: MerakiList = await client.getAll(
      "/organizations/549236/networks",
      buildMerakiQuery([["perPage", 1000]]),
      "list of networks",
      10,
    );

    expect(list.items).toHaveLength(7);
    expect(list.isTruncated).toBe(false);
    expect(api.callsTo("/api/v1/organizations/549236/networks")).toHaveLength(
      3,
    );
  });

  test("stops at maxPages and says the list was cut", async () => {
    const { client } = setup({
      organizations: [
        buildBranchOrganization({ id: "549236", name: "Acme", count: 10 }),
      ],
      maxPerPage: 2,
    });

    const list: MerakiList = await client.getAll(
      "/organizations/549236/networks",
      "",
      "list of networks",
      2,
    );

    expect(list.items).toHaveLength(4);
    expect(list.isTruncated).toBe(true);
  });

  test("a next link off Meraki's API is never followed", async () => {
    const { api, client } = setup({
      scripted: {
        "/api/v1/organizations/549236/networks": [
          {
            status: 200,
            body: [{ id: "L_1", name: "One" }],
            headers: {
              link: "<https://collector.attacker.example/api/v1/steal?page=2>; rel=next",
            },
          },
        ],
      },
    });

    const error: LlmProviderError = await failure(
      client.getAll(
        "/organizations/549236/networks",
        "",
        "list of networks",
        5,
      ),
    );

    expect(error.message).toContain(
      "next page outside the Meraki dashboard API",
    );
    expect(api.requests).toHaveLength(1);
  });

  test("a page that is not a list is a failure naming the call", async () => {
    const { client } = setup({
      scripted: {
        "/api/v1/organizations/549236/networks": [
          { status: 200, body: { items: [] } },
        ],
      },
    });

    const error: LlmProviderError = await failure(
      client.getAll(
        "/organizations/549236/networks",
        "",
        "list of networks",
        5,
      ),
    );

    expect(error.message).toBe(
      "Meraki answered the list of networks with something that is not a list (HTTP 200).",
    );
  });
});

describe("the read's budget", () => {
  test("a request past maxRequests is not sent", async () => {
    const { api, client } = setup({}, { maxRequests: 2 });

    await client.get("/organizations", "", "list of organizations");
    await client.get("/organizations", "", "list of organizations");

    await expect(
      client.get("/organizations", "", "list of organizations"),
    ).rejects.toBeInstanceOf(MerakiBudgetSpent);
    expect(api.requests).toHaveLength(2);
  });

  test("a request past the deadline is not sent", async () => {
    const { api, client, clock } = setup(
      {},
      { deadlineMs: START.getTime() + 1000 },
    );

    await client.get("/organizations", "", "list of organizations");
    clock.advance(5000);

    await expect(
      client.get("/organizations", "", "list of organizations"),
    ).rejects.toBeInstanceOf(MerakiBudgetSpent);
    expect(api.requests).toHaveLength(1);
  });

  test("every hop of a redirect counts", async () => {
    const { client } = setup({
      shardHosts: ["n123.meraki.com"],
      scripted: {
        "/api/v1/organizations/549236": [
          {
            status: 308,
            headers: {
              location: "https://n123.meraki.com/api/v1/organizations/549236",
            },
          },
        ],
      },
    });

    await client.get("/organizations/549236", "", "organization");

    expect(client.getRequestCount()).toBe(2);
  });
});

describe("the URLs the key may go to", () => {
  const client: MerakiApiClient = setup().client;

  test.each([
    ["https://api.meraki.com/api/v1/organizations", true],
    ["https://n7.meraki.com/api/v1/x", true],
    ["https://api.meraki.com:443/api/v1/x", true],
    ["https://api.meraki.com/api/v2/x", false],
    ["https://api.meraki.com/apiv1", false],
    ["ftp://api.meraki.com/api/v1/x", false],
    ["not a url", false],
  ])("%s: %p", (url: string, allowed: boolean) => {
    expect(client.isAllowedUrl(url)).toBe(allowed);
  });
});
