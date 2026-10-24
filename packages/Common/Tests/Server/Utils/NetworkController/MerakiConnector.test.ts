import MerakiConnector, {
  REMEDIATION_API_ACCESS,
  REMEDIATION_KEY,
  REMEDIATION_RATE_LIMITED,
  REMEDIATION_UNREACHABLE,
  TEST_MAX_REQUESTS,
  readOrganizations,
} from "../../../../Server/Utils/NetworkController/Meraki/MerakiConnector";
import NetworkControllerConnectorRegistry from "../../../../Server/Utils/NetworkController/NetworkControllerConnectorRegistry";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import { MerakiRegion } from "../../../../Types/NetworkController/MerakiRegion";
import { NetworkControllerConfig } from "../../../../Types/NetworkController/NetworkControllerConnectionSettings";
import {
  MAX_TEST_ORGANIZATIONS,
  NetworkControllerTestResult,
} from "../../../../Types/NetworkController/NetworkControllerConnectionTest";
import NetworkControllerProvider from "../../../../Types/NetworkController/NetworkControllerProvider";
import {
  FAKE_API_KEY,
  FakeMerakiApi,
  FakeMerakiOptions,
  FakeMerakiOrganization,
  FakeMerakiRequest,
  TestClock,
  buildBranchOrganization,
  createFakeMerakiApi,
  createTestClock,
  merakiError,
} from "./FakeMerakiApi";
import { describe, expect, test } from "@jest/globals";

/*
 * "Test" on a Meraki connection, against the fake dashboard API: a few
 * read-only calls that say whether the key works, which organizations it
 * reads and - for the one picked - how many networks and appliances a read
 * covers; when it does not work, why, and what to do. Never a throw, never
 * the key in what it says, and never more than a handful of calls however
 * large the organization.
 */

const START: Date = new Date("2026-10-24T12:00:00.000Z");

interface Env {
  clock: TestClock;
  api: FakeMerakiApi;
}

function environment(options: Partial<FakeMerakiOptions> = {}): Env {
  const clock: TestClock = createTestClock(START);
  const api: FakeMerakiApi = createFakeMerakiApi({
    organizations: [
      buildBranchOrganization({ id: "549236", name: "Acme Retail", count: 5 }),
    ],
    now: clock.now,
    ...options,
  });

  return { clock, api };
}

function config(
  overrides: Partial<NetworkControllerConfig> = {},
): NetworkControllerConfig {
  return {
    region: MerakiRegion.Global,
    organizationId: "",
    organizationName: "",
    readIntervalInMinutes: 5,
    ...overrides,
  };
}

async function runTest(
  env: Env,
  overrides: Partial<NetworkControllerConfig> = {},
  apiKey: string = FAKE_API_KEY,
): Promise<NetworkControllerTestResult> {
  return await new MerakiConnector().testConnection(
    { apiKey, config: config(overrides) },
    {
      transport: env.api.transport,
      now: env.clock.now,
      sleep: env.clock.sleep,
    },
  );
}

function organization(
  id: string,
  name: string,
  count: number,
): FakeMerakiOrganization {
  return buildBranchOrganization({ id, name, count });
}

describe("a key that works", () => {
  test("reading one organization: it is picked, and what a read covers is counted", async () => {
    const env: Env = environment();
    const result: NetworkControllerTestResult = await runTest(env);

    expect(result).toEqual({
      provider: NetworkControllerProvider.Meraki,
      status: "pass",
      message: "Reads 5 networks and 5 appliances in Acme Retail.",
      organizations: [{ id: "549236", name: "Acme Retail" }],
      organizationId: "549236",
      networkCount: 5,
      applianceCount: 5,
      durationMs: expect.any(Number),
    });
    expect(
      env.api.requests.map((request: FakeMerakiRequest) => {
        return request.url.pathname;
      }),
    ).toEqual([
      "/api/v1/organizations",
      "/api/v1/organizations/549236/networks",
      "/api/v1/organizations/549236/devices",
    ]);
    expect(
      env.api.requests[2]!.url.searchParams.getAll("productTypes[]"),
    ).toEqual(["appliance"]);
  });

  test("reading several: they are listed to pick from, with nothing counted yet", async () => {
    const env: Env = environment({
      organizations: [
        organization("549236", "Acme Retail", 5),
        organization("777001", "Acme Warehouses", 2),
      ],
    });

    const result: NetworkControllerTestResult = await runTest(env);

    expect(result.status).toBe("pass");
    expect(result.message).toBe(
      "The key reads 2 organizations. Pick the one to read.",
    );
    expect(result.organizations).toEqual([
      { id: "549236", name: "Acme Retail" },
      { id: "777001", name: "Acme Warehouses" },
    ]);
    expect(result.organizationId).toBeUndefined();
    expect(result.networkCount).toBeUndefined();
    expect(env.api.requests).toHaveLength(1);
  });

  test("with one picked, that one is counted", async () => {
    const env: Env = environment({
      organizations: [
        organization("549236", "Acme Retail", 5),
        organization("777001", "Acme Warehouses", 2),
      ],
    });

    const result: NetworkControllerTestResult = await runTest(env, {
      organizationId: "777001",
    });

    expect(result.message).toBe(
      "Reads 2 networks and 2 appliances in Acme Warehouses.",
    );
    expect(result.organizationId).toBe("777001");
  });

  test("a large organization is counted to three pages, then 'or more' - within a handful of calls", async () => {
    const env: Env = environment({
      organizations: [organization("549236", "Acme Retail", 40)],
      maxPerPage: 10,
    });

    const result: NetworkControllerTestResult = await runTest(env);

    expect(result.message).toBe(
      "Reads 30 or more networks and 30 or more appliances in Acme Retail.",
    );
    expect(env.api.requests.length).toBeLessThanOrEqual(TEST_MAX_REQUESTS);
  });

  test("at most a hundred organizations are listed", async () => {
    const env: Env = environment({
      organizations: Array.from(
        { length: 150 },
        (_: unknown, index: number) => {
          return organization(String(100000 + index), `Customer ${index}`, 0);
        },
      ),
    });

    const result: NetworkControllerTestResult = await runTest(env);

    expect(result.organizations).toHaveLength(MAX_TEST_ORGANIZATIONS);
    expect(result.message).toBe(
      "The key reads 150 organizations. Pick the one to read.",
    );
  });

  test("the region's own API host is asked, nothing else", async () => {
    const env: Env = environment({ apiHost: "api.meraki.in" });

    const result: NetworkControllerTestResult = await runTest(env, {
      region: MerakiRegion.India,
    });

    expect(result.status).toBe("pass");
    expect(
      new Set(
        env.api.requests.map((request: FakeMerakiRequest) => {
          return request.url.hostname;
        }),
      ),
    ).toEqual(new Set(["api.meraki.in"]));
  });
});

describe("an organization a read would find little in", () => {
  test("no networks yet: a warning", async () => {
    const env: Env = environment({
      organizations: [organization("549236", "Fresh Start", 0)],
    });

    const result: NetworkControllerTestResult = await runTest(env);

    expect(result.status).toBe("warn");
    expect(result.message).toBe(
      "Fresh Start has no networks yet: there is no traffic to read.",
    );
    expect(result.networkCount).toBe(0);
  });

  test("no MX or Z appliance: a warning that only applications and clients are shown", async () => {
    const wireless: FakeMerakiOrganization = organization(
      "549236",
      "Wireless Only",
      3,
    );
    wireless.appliances = [];
    const env: Env = environment({ organizations: [wireless] });

    const result: NetworkControllerTestResult = await runTest(env);

    expect(result.status).toBe("warn");
    expect(result.message).toBe(
      "Reads 3 networks in Wireless Only. It has no MX or Z appliance, so there is no uplink usage: only applications and clients are shown.",
    );
    expect(result.applianceCount).toBe(0);
  });
});

describe("a key that does not work", () => {
  test("refused: says the dashboard did not accept it, and how to get it again", async () => {
    const env: Env = environment();

    const result: NetworkControllerTestResult = await runTest(
      env,
      {},
      "not-the-key-0123456789abcdef01234567",
    );

    expect(result).toMatchObject({
      status: "fail",
      message:
        "The Meraki dashboard (dashboard.meraki.com) did not accept this API key.",
      remediation: REMEDIATION_KEY,
      failureKind: LlmConnectionFailureKind.Authentication,
      organizations: [],
    });
  });

  test("a key of another region's dashboard is refused, naming the dashboard asked", async () => {
    const env: Env = environment({ apiHost: "api.meraki.ca" });

    const result: NetworkControllerTestResult = await runTest(
      env,
      {
        region: MerakiRegion.Canada,
      },
      "a-key-from-the-global-dashboard-0123456",
    );

    expect(result.message).toBe(
      "The Meraki dashboard (dashboard.meraki.ca) did not accept this API key.",
    );
  });

  test("reading no organization", async () => {
    const env: Env = environment({ organizations: [] });

    const result: NetworkControllerTestResult = await runTest(env);

    expect(result.status).toBe("fail");
    expect(result.message).toBe(
      "This API key can read no Meraki organization.",
    );
    expect(result.failureKind).toBe(LlmConnectionFailureKind.Permission);
  });

  test("not reading the organization picked", async () => {
    const env: Env = environment();

    const result: NetworkControllerTestResult = await runTest(env, {
      organizationId: "777001",
    });

    expect(result).toMatchObject({
      status: "fail",
      message: "This API key cannot read the organization 777001.",
      remediation: REMEDIATION_API_ACCESS,
      organizations: [{ id: "549236", name: "Acme Retail" }],
    });
  });

  test("API access turned off for the organization", async () => {
    const closed: FakeMerakiOrganization = organization(
      "549236",
      "Acme Retail",
      5,
    );
    closed.isApiEnabled = false;
    const env: Env = environment({ organizations: [closed] });

    const result: NetworkControllerTestResult = await runTest(env);

    expect(result).toMatchObject({
      status: "fail",
      message: "API access is turned off for Acme Retail.",
      remediation: REMEDIATION_API_ACCESS,
      failureKind: LlmConnectionFailureKind.Permission,
      organizationId: "549236",
    });
    expect(env.api.requests).toHaveLength(1);
  });
});

describe("when Meraki cannot answer", () => {
  test("rate limited: try again in a minute", async () => {
    const env: Env = environment({
      scripted: {
        "/api/v1/organizations": [
          merakiError(429, "API rate limit exceeded", { "retry-after": "120" }),
        ],
      },
    });

    const result: NetworkControllerTestResult = await runTest(env);

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(LlmConnectionFailureKind.RateLimited);
    expect(result.remediation).toBe(REMEDIATION_RATE_LIMITED);
  });

  test("unreachable: check this OneUptime can reach it", async () => {
    const env: Env = environment({ dropped: { "/api/v1/organizations": 2 } });

    const result: NetworkControllerTestResult = await runTest(env);

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(LlmConnectionFailureKind.Unavailable);
    expect(result.remediation).toBe(REMEDIATION_UNREACHABLE);
  });

  test("a failure counting the organization keeps the organizations it listed", async () => {
    const env: Env = environment({
      scripted: {
        "/api/v1/organizations/549236/devices": [
          merakiError(403, "Forbidden for this administrator"),
        ],
      },
    });

    const result: NetworkControllerTestResult = await runTest(env);

    expect(result).toMatchObject({
      status: "fail",
      message:
        "Meraki answered the list of appliances with HTTP 403: Forbidden for this administrator",
      remediation: REMEDIATION_API_ACCESS,
      failureKind: LlmConnectionFailureKind.Permission,
      organizations: [{ id: "549236", name: "Acme Retail" }],
      organizationId: "549236",
    });
  });

  test("whatever Meraki says, the result never holds the key", async () => {
    const env: Env = environment({
      scripted: {
        "/api/v1/organizations/549236/networks": [
          merakiError(400, `Key ${FAKE_API_KEY} has no access`),
        ],
      },
    });

    const result: NetworkControllerTestResult = await runTest(env);

    expect(result.status).toBe("fail");
    expect(JSON.stringify(result)).not.toContain(FAKE_API_KEY);
    expect(result.message).toContain("[REDACTED]");
  });
});

describe("reading the organizations Meraki lists", () => {
  test("each once, named by its ID when it has no name, with whether its API is on", () => {
    expect(
      readOrganizations([
        { id: "1", name: "One", api: { enabled: true } },
        { id: "2", name: "", api: { enabled: false } },
        { id: "3", name: "Three" },
        { id: "1", name: "Again" },
        { name: "No ID" },
        null,
        "4",
      ]),
    ).toEqual([
      { id: "1", name: "One", isApiEnabled: true },
      { id: "2", name: "2", isApiEnabled: false },
      { id: "3", name: "Three", isApiEnabled: true },
    ]);
  });
});

describe("the registry", () => {
  test("Meraki's connector is the one for Meraki", () => {
    expect(
      NetworkControllerConnectorRegistry.getConnector(
        NetworkControllerProvider.Meraki,
      ).provider,
    ).toBe(NetworkControllerProvider.Meraki);
  });

  test("a controller it does not know is refused", () => {
    expect(() => {
      return NetworkControllerConnectorRegistry.getConnector("unifi");
    }).toThrow("Controller must be 'meraki'.");
  });
});
