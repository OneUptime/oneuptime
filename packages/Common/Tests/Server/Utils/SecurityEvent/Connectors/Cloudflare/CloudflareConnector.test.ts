import { describe, expect, jest, test } from "@jest/globals";
import CloudflareConnector, {
  CLOUDFLARE_ANALYTICS_READ_PERMISSION,
  CLOUDFLARE_ZONE_READ_PERMISSION,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Cloudflare/CloudflareConnector";
import {
  CloudflareApiError,
  CloudflareFailureKind,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Cloudflare/CloudflareClient";
import {
  ConnectorFetchOptions,
  ConnectorFetchResult,
  ConnectorTestResult,
  SecurityConnectorSettings,
  readConnectorFetchSummary,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../../Types/JSON";
import { SecurityConnectorCheck } from "../../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { ConnectorFieldChoice } from "../../../../../../Types/SecurityEvent/Connectors/ConnectorFieldChoices";
import SecurityEventConnectorProvider from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { EDGE_SAMPLE_INTERVAL_ATTRIBUTE } from "../../../../../../Types/SecurityEvent/EdgeAction";
import NormalizedSecurityEvent from "../../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  MANAGED_RULE_BLOCK,
  SKIP_ALLOWLISTED_MONITOR,
} from "../../../../../Utils/SecurityEvent/Connectors/CloudflareFixtures";
import CloudflareFakeApi, {
  ACCOUNT_ID,
  FakeRequest,
  FakeZone,
  OTHER_ACCOUNT_ID,
  TOKEN,
  ZONE_A,
  ZONE_B,
  ZONE_OTHER,
  graphQlError,
  json,
  restError,
} from "./CloudflareFakeApi";

/*
 * The Cloudflare connection against Cloudflare's API as recorded in
 * CloudflareFakeApi: a valid token, an invalid one and one missing each
 * permission, named; a token an account owns; the zones it reads, chosen or
 * all; firewall events read page by page after the last row, zone by zone in
 * turn, deduplicated, within the run's bounds; Cloudflare's rate limits (a
 * 429 waited out after its Retry-After, a longer one stopping the run); a
 * zone the token may not read not holding the others; what each plan
 * allows; the accounts and zones the form's pickers offer; and the token
 * never in a message.
 */

const NOW_MS: number = Date.now();
const HOUR_MS: number = 60 * 60 * 1000;
const WINDOW_START: Date = new Date(
  Math.floor((NOW_MS - 3 * HOUR_MS) / 1000) * 1000,
);
const WINDOW_END: Date = new Date(WINDOW_START.getTime() + HOUR_MS);

function at(seconds: number): string {
  return new Date(WINDOW_START.getTime() + seconds * 1000)
    .toISOString()
    .replace(".000Z", "Z");
}

function event(
  seconds: number,
  rayName: string,
  overrides: JSONObject = {},
): JSONObject {
  return {
    ...MANAGED_RULE_BLOCK,
    datetime: at(seconds),
    rayName,
    ...overrides,
  };
}

function zone(overrides: Partial<FakeZone> & { id: string }): FakeZone {
  return {
    name: overrides.id === ZONE_B ? "shop.example.com" : "example.com",
    plan: { name: "Pro Website", legacy_id: "pro" },
    events: [],
    ...overrides,
  };
}

function settings(
  config: JSONObject = { accountId: ACCOUNT_ID },
  secrets: JSONObject = { apiToken: TOKEN },
): SecurityConnectorSettings {
  return {
    provider: SecurityEventConnectorProvider.Cloudflare,
    config,
    secrets,
    alertingOnly: false,
  };
}

function options(overrides: Partial<ConnectorFetchOptions> = {}): ConnectorFetchOptions {
  return {
    maxRequests: 120,
    maxEvents: 20000,
    requestTimeoutInMs: 1000,
    sampleLimit: 5,
    ...overrides,
  };
}

interface Harness {
  api: CloudflareFakeApi;
  connector: CloudflareConnector;
  sleep: jest.Mock<(ms: number) => Promise<void>>;
}

function harness(zones: Array<FakeZone>): Harness {
  const api: CloudflareFakeApi = new CloudflareFakeApi(zones);
  const sleep: jest.Mock<(ms: number) => Promise<void>> = jest.fn(
    async (_ms: number): Promise<void> => {
      return undefined;
    },
  );
  const connector: CloudflareConnector = new CloudflareConnector(
    api.transport(),
    { sleep },
  );

  return { api, connector, sleep };
}

function check(
  result: ConnectorTestResult,
  key: string,
): SecurityConnectorCheck {
  const found: SecurityConnectorCheck | undefined = result.checks.find(
    (candidate: SecurityConnectorCheck): boolean => {
      return candidate.key === key;
    },
  );

  if (!found) {
    throw new Error(`No ${key} check in ${JSON.stringify(result.checks)}`);
  }

  return found;
}

function statuses(result: ConnectorTestResult): Record<string, string> {
  const map: Record<string, string> = {};

  for (const entry of result.checks) {
    map[entry.key] = entry.status;
  }

  return map;
}

async function fetchWindow(
  connector: CloudflareConnector,
  config: JSONObject = { accountId: ACCOUNT_ID },
  fetchOptions: ConnectorFetchOptions = options(),
): Promise<ConnectorFetchResult> {
  return connector.fetchEvents(
    settings(config),
    { startTime: WINDOW_START, endTime: WINDOW_END },
    fetchOptions,
  );
}

function rayNames(result: ConnectorFetchResult): Array<string> {
  return result.events.map((normalized: NormalizedSecurityEvent): string => {
    return String(normalized.attributes["cloudflare.ray_id"]);
  });
}

describe("CloudflareConnector - settings", () => {
  const connector: CloudflareConnector = new CloudflareConnector(
    async (): Promise<never> => {
      throw new Error("nothing is contacted");
    },
  );

  test("a token, an account and no zones is every zone of the account", () => {
    expect(() => {
      connector.validateSettings(settings());
    }).not.toThrow();
  });

  test.each([
    [{ apiToken: "" }, { accountId: ACCOUNT_ID }, "API token is required."],
    [
      { apiToken: `Bearer ${TOKEN}` },
      { accountId: ACCOUNT_ID },
      "without the 'Bearer' prefix",
    ],
    [
      { apiToken: "c2547eb745079dac9320b638f5e225cf483cc" },
      { accountId: ACCOUNT_ID },
      "looks like a Global API Key",
    ],
    [
      { apiToken: "has spaces in it and is not a token at all" },
      { accountId: ACCOUNT_ID },
      "the token value alone",
    ],
    [{ apiToken: TOKEN }, {}, "Account is required."],
    [{ apiToken: TOKEN }, { accountId: "acme" }, "Cloudflare account ID"],
    [
      { apiToken: TOKEN },
      { accountId: ACCOUNT_ID, zoneIds: "example.com" },
      "Cloudflare zone IDs",
    ],
  ])(
    "refuses %j with %j",
    (secrets: JSONObject, config: JSONObject, message: string) => {
      expect(() => {
        connector.validateSettings(settings(config, secrets));
      }).toThrow(message);
    },
  );

  test("a connection reads at most 50 zones", () => {
    const zoneIds: string = Array.from(
      { length: 51 },
      (_value: unknown, index: number): string => {
        return index.toString(16).padStart(32, "0");
      },
    ).join(",");

    expect(() => {
      connector.validateSettings(settings({ accountId: ACCOUNT_ID, zoneIds }));
    }).toThrow("at most 50 zones");
  });

  test("zone IDs are read whatever their case and the spaces around them", () => {
    expect(() => {
      connector.validateSettings(
        settings({
          accountId: ACCOUNT_ID.toUpperCase(),
          zoneIds: ` ${ZONE_A.toUpperCase()} , ${ZONE_B}`,
        }),
      );
    }).not.toThrow();
  });
});

describe("CloudflareConnector - Test Connection", () => {
  function twoZones(): Array<FakeZone> {
    return [
      zone({
        id: ZONE_A,
        plan: { name: "Free Website", legacy_id: "free" },
        events: [event(0, "a1")],
      }),
      zone({
        id: ZONE_B,
        plan: { name: "Business Website", legacy_id: "business" },
        events: [],
      }),
    ];
  }

  test("a valid token passes every check and says what each plan gives", async () => {
    const { api, connector } = harness(twoZones());
    // Within the last day, for the counts.
    api.zones[0]!.events = [
      { ...event(0, "a1"), datetime: new Date(NOW_MS - HOUR_MS).toISOString() },
      {
        ...event(0, "a2"),
        datetime: new Date(NOW_MS - HOUR_MS).toISOString(),
        sampleInterval: 10,
      },
    ];

    const result: ConnectorTestResult = await connector.testConnection(
      settings(),
      { requestTimeoutInMs: 1000 },
    );

    expect(statuses(result)).toEqual({
      authentication: "pass",
      zones: "pass",
      "read-permission": "pass",
      "plan-limits": "pass",
      "detections-available": "pass",
    });
    expect(check(result, "zones").message).toBe(
      "The API token reads 2 zones (every active zone of the account): example.com and shop.example.com.",
    );
    expect(check(result, "plan-limits").message).toBe(
      "example.com (Free): firewall events for 31 days, up to 30 days a query. shop.example.com (Business): firewall events for 31 days, up to 30 days a query.",
    );
    expect(check(result, "plan-limits").details).toEqual({
      zones: [
        {
          zone: "example.com",
          plan: "Free",
          firewallEvents: true,
          keepsDays: 31,
          queryReachesDays: 30,
          maxPageSize: 10000,
        },
        {
          zone: "shop.example.com",
          plan: "Business",
          firewallEvents: true,
          keepsDays: 31,
          queryReachesDays: 30,
          maxPageSize: 10000,
        },
      ],
    });
    // A sampled row stands for ten: the count is the sum of the sample intervals, said as about.
    expect(check(result, "detections-available").message).toBe(
      "About 11 firewall events in the last 24 hours and about 11 in the last 7 days. Cloudflare samples busy zones, so these counts are estimates.",
    );
    // Only reads: nothing but GETs and GraphQL queries.
    for (const request of api.requests) {
      expect(["GET", "POST"]).toContain(request.method);

      if (request.method === "POST") {
        expect(request.path.endsWith("/graphql")).toBe(true);
        expect(request.queryText.trim().startsWith("query ")).toBe(true);
      }
    }
  });

  test("an invalid token fails on the first check and names what to check; nothing else runs", async () => {
    const { api, connector } = harness(twoZones());
    api.acceptedToken = "another-token-0123456789abcdefghijkl";

    const result: ConnectorTestResult = await connector.testConnection(
      settings(),
      { requestTimeoutInMs: 1000 },
    );

    expect(statuses(result)).toEqual({
      authentication: "fail",
      zones: "skip",
      "read-permission": "skip",
      "plan-limits": "skip",
      "detections-available": "skip",
    });
    expect(check(result, "authentication").message).toContain(
      "Invalid API Token (1000)",
    );
    expect(check(result, "authentication").remediation).toContain(
      "not a Global API Key",
    );
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  test("a token without Zone > Zone > Read is told to add it", async () => {
    const { api, connector } = harness(twoZones());
    api.canListZones = false;

    const result: ConnectorTestResult = await connector.testConnection(
      settings(),
      { requestTimeoutInMs: 1000 },
    );

    expect(statuses(result)).toMatchObject({
      authentication: "pass",
      zones: "fail",
      "read-permission": "skip",
    });
    expect(check(result, "zones").message).toContain(
      "Unauthorized to access requested resource (9109)",
    );
    expect(check(result, "zones").remediation).toContain(
      CLOUDFLARE_ZONE_READ_PERMISSION,
    );
  });

  test("a token without Zone > Analytics > Read on one zone names the permission and the zone", async () => {
    const zones: Array<FakeZone> = twoZones();
    zones[1]!.analytics = false;
    const { connector } = harness(zones);

    const result: ConnectorTestResult = await connector.testConnection(
      settings(),
      { requestTimeoutInMs: 1000 },
    );

    expect(statuses(result)).toMatchObject({
      zones: "pass",
      "read-permission": "fail",
      "plan-limits": "skip",
      "detections-available": "skip",
    });
    expect(check(result, "read-permission").message).toBe(
      `The API token cannot read the analytics of shop.example.com: it lacks ${CLOUDFLARE_ANALYTICS_READ_PERMISSION} there.`,
    );
    expect(check(result, "read-permission").details).toEqual({
      missingPermission: CLOUDFLARE_ANALYTICS_READ_PERMISSION,
      zones: ["shop.example.com"],
    });
  });

  test("a token the account owns is verified on the account's own endpoint", async () => {
    const { api, connector } = harness(twoZones());
    api.isAccountOwnedToken = true;

    const result: ConnectorTestResult = await connector.testConnection(
      settings(),
      { requestTimeoutInMs: 1000, skipAvailability: true },
    );

    expect(check(result, "authentication").status).toBe("pass");
    expect(check(result, "authentication").details).toEqual({
      tokenOwner: "account",
    });
    expect(
      api.requests.map((request: FakeRequest): string => {
        return request.path;
      }),
    ).toContain(`/client/v4/accounts/${ACCOUNT_ID}/tokens/verify`);
    // A queued test skips the counts.
    expect(
      result.checks.map((entry: SecurityConnectorCheck): string => {
        return entry.key;
      }),
    ).not.toContain("detections-available");
  });

  test("a token about to expire is a warning that says to roll it", async () => {
    const { api, connector } = harness(twoZones());
    api.token = {
      status: "active",
      expiresOn: new Date(NOW_MS + 3 * 24 * HOUR_MS).toISOString(),
    };

    const result: ConnectorTestResult = await connector.testConnection(
      settings(),
      { requestTimeoutInMs: 1000, skipAvailability: true },
    );

    expect(check(result, "authentication").status).toBe("warn");
    expect(check(result, "authentication").remediation).toContain(
      "Roll the token",
    );
  });

  test("a disabled token fails and says it is disabled", async () => {
    const { api, connector } = harness(twoZones());
    api.token = { status: "disabled" };

    const result: ConnectorTestResult = await connector.testConnection(
      settings(),
      { requestTimeoutInMs: 1000 },
    );

    expect(check(result, "authentication")).toMatchObject({
      status: "fail",
      message: "Cloudflare knows the API token, but it is disabled.",
    });
    expect(check(result, "zones").status).toBe("skip");
  });

  test("a chosen zone the token no longer reads is named", async () => {
    const { connector } = harness(twoZones());

    const result: ConnectorTestResult = await connector.testConnection(
      settings({ accountId: ACCOUNT_ID, zoneIds: `${ZONE_A},${ZONE_OTHER}` }),
      { requestTimeoutInMs: 1000 },
    );

    expect(check(result, "zones").status).toBe("fail");
    expect(check(result, "zones").message).toContain(ZONE_OTHER);
  });

  test("an account with no zone the token reads says how to fix the token", async () => {
    const { connector } = harness([]);

    const result: ConnectorTestResult = await connector.testConnection(
      settings(),
      { requestTimeoutInMs: 1000 },
    );

    expect(check(result, "zones").status).toBe("fail");
    expect(check(result, "zones").remediation).toContain("Zone Resources");
  });

  test("a zone whose plan has no firewall events is a warning, not a failure", async () => {
    const zones: Array<FakeZone> = twoZones();
    zones[1]!.settings = { enabled: false };
    const { connector } = harness(zones);

    const result: ConnectorTestResult = await connector.testConnection(
      settings(),
      { requestTimeoutInMs: 1000, skipAvailability: true },
    );

    expect(check(result, "plan-limits").status).toBe("warn");
    expect(check(result, "plan-limits").message).toContain(
      "Cloudflare does not offer firewall events through its API for shop.example.com",
    );
  });

  test("a quiet week is a warning, with what to check", async () => {
    const { api, connector } = harness(twoZones());
    api.zones[0]!.events = [];

    const result: ConnectorTestResult = await connector.testConnection(
      settings(),
      { requestTimeoutInMs: 1000 },
    );

    expect(check(result, "detections-available").status).toBe("warn");
    expect(check(result, "detections-available").remediation).toContain(
      "proxied",
    );
  });

  test("an invalid setting fails before anything is contacted", async () => {
    const { api, connector } = harness(twoZones());

    const result: ConnectorTestResult = await connector.testConnection(
      settings({ accountId: "nope" }),
      { requestTimeoutInMs: 1000 },
    );

    expect(check(result, "authentication").status).toBe("fail");
    expect(api.requests).toHaveLength(0);
  });
});

describe("CloudflareConnector - reading firewall events", () => {
  test("pages through a zone after the last row read, in order, each event once", async () => {
    const { api, connector } = harness([
      zone({
        id: ZONE_A,
        settings: { maxPageSize: 2 },
        // Three rows in one second: the next page goes on by Ray ID, then match index.
        events: [
          event(10, "r3"),
          event(5, "r1", { matchIndex: 1, action: "log" }),
          event(5, "r1"),
          event(5, "r2"),
          event(20, "r4"),
        ],
      }),
    ]);

    const result: ConnectorFetchResult = await fetchWindow(connector);

    expect(rayNames(result)).toEqual(["r1", "r1", "r2", "r3", "r4"]);
    expect(result.complete).toBe(true);
    expect(result.fetchedCount).toBe(5);

    const pages: Array<FakeRequest> = api.sent("OneUptimeFirewallEvents");
    expect(pages).toHaveLength(3);
    expect(pages[0]!.variables["filter"]).toEqual({
      datetime_geq: WINDOW_START.toISOString(),
      datetime_lt: WINDOW_END.toISOString(),
    });
    expect((pages[1]!.variables["filter"] as JSONObject)["OR"]).toEqual([
      { datetime_gt: at(5) },
      { datetime: at(5), rayName_gt: "r1" },
      { datetime: at(5), rayName: "r1", matchIndex_gt: 1 },
    ]);
    expect(pages[0]!.variables["limit"]).toBe(2);
    expect(pages[0]!.queryText).toContain(
      "orderBy: [datetime_ASC, rayName_ASC, matchIndex_ASC]",
    );
    expect(pages[0]!.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
  });

  test("reads zones in turn, one page each, so a busy zone cannot spend the run before a quiet one", async () => {
    const { api, connector } = harness([
      zone({
        id: ZONE_A,
        settings: { maxPageSize: 1 },
        events: [event(1, "a1"), event(2, "a2"), event(3, "a3")],
      }),
      zone({ id: ZONE_B, settings: { maxPageSize: 1 }, events: [] }),
    ]);

    const result: ConnectorFetchResult = await fetchWindow(connector);

    expect(
      api.sent("OneUptimeFirewallEvents").map((request: FakeRequest): string => {
        return String(request.variables["zoneTag"]);
      }),
    ).toEqual([ZONE_A, ZONE_B, ZONE_A, ZONE_A, ZONE_A]);
    expect(rayNames(result)).toEqual(["a1", "a2", "a3"]);
    expect(result.details).toEqual({
      readsEveryZone: true,
      zonesRead: ["example.com · Pro", "shop.example.com · Pro"],
      letThroughWithoutAttack: 0,
      sampledEvents: 0,
      estimatedRequests: 3,
    });
  });

  test("a row Cloudflare hands back twice is imported once", async () => {
    const { api, connector } = harness([
      zone({
        id: ZONE_A,
        settings: { maxPageSize: 2 },
        events: [event(1, "a1"), event(2, "a2"), event(3, "a3")],
      }),
    ]);
    // Page two starts again at the window start: a1 and a2 again, then the last page.
    api.ignoresAfterFilter = true;

    const result: ConnectorFetchResult = await fetchWindow(connector);

    expect(rayNames(result)).toEqual(["a1", "a2"]);
    expect(result.fetchedCount).toBe(2);
    expect(result.complete).toBe(false);
    expect(result.warnings.join(" ")).toContain(
      "returned the same page of example.com's firewall events twice",
    );
  });

  test("only the chosen zones are read", async () => {
    const { api, connector } = harness([
      zone({ id: ZONE_A, events: [event(1, "a1")] }),
      zone({ id: ZONE_B, events: [event(1, "b1")] }),
    ]);

    const result: ConnectorFetchResult = await fetchWindow(connector, {
      accountId: ACCOUNT_ID,
      zoneIds: ZONE_B,
    });

    expect(rayNames(result)).toEqual(["b1"]);
    expect(
      api.sent("OneUptimeFirewallEvents").map((request: FakeRequest): string => {
        return String(request.variables["zoneTag"]);
      }),
    ).toEqual([ZONE_B]);
  });

  test("every zone means every active zone: a pending zone has no traffic through Cloudflare yet", async () => {
    const { api, connector } = harness([
      zone({ id: ZONE_A, events: [event(1, "a1")] }),
      zone({ id: ZONE_B, status: "pending", events: [event(1, "b1")] }),
    ]);

    await fetchWindow(connector);

    expect(api.sent("OneUptimeFirewallEvents")).toHaveLength(1);
  });

  test("requests a rule of the customer's own let through with nothing of an attack in them are left out, and counted", async () => {
    const { connector } = harness([
      zone({
        id: ZONE_A,
        events: [
          event(1, "a1"),
          { ...SKIP_ALLOWLISTED_MONITOR, datetime: at(2), rayName: "m1" },
          { ...SKIP_ALLOWLISTED_MONITOR, datetime: at(3), rayName: "m2" },
        ],
      }),
    ]);

    const result: ConnectorFetchResult = await fetchWindow(connector);

    expect(rayNames(result)).toEqual(["a1"]);
    expect(result.fetchedCount).toBe(3);
    expect(result.details).toMatchObject({ letThroughWithoutAttack: 2 });
    expect(
      result.checks?.find((entry: SecurityConnectorCheck): boolean => {
        return entry.key === "let-through";
      })?.message,
    ).toBe(
      "2 requests that a skip or allow rule of yours let through carried no attack, and were left out.",
    );
  });

  test("keeps how many requests the sampled rows stand for", async () => {
    const { connector } = harness([
      zone({
        id: ZONE_A,
        events: [event(1, "a1", { sampleInterval: 10 }), event(2, "a2")],
      }),
    ]);

    const result: ConnectorFetchResult = await fetchWindow(connector);

    expect(result.details).toMatchObject({
      sampledEvents: 1,
      estimatedRequests: 11,
    });
    expect(result.events[0]!.attributes[EDGE_SAMPLE_INTERVAL_ATTRIBUTE]).toBe(
      "10",
    );
  });

  test("a row that is not a firewall event is rejected, never imported", async () => {
    const { connector } = harness([
      zone({
        id: ZONE_A,
        events: [event(1, "a1"), { datetime: at(2), rayName: "x" }],
      }),
    ]);

    const result: ConnectorFetchResult = await fetchWindow(connector);

    expect(rayNames(result)).toEqual(["a1"]);
    expect(result.rejectedCount).toBe(1);
  });

  test("reads only the fields the zone's plan has, as many as one query may name", async () => {
    const { api, connector } = harness([
      zone({
        id: ZONE_A,
        settings: {
          maxNumberOfFields: 15,
          availableFields: [
            "datetime",
            "rayName",
            "matchIndex",
            "action",
            "source",
            "ruleId",
            "clientIP",
            "clientRequestHTTPHost",
            "clientRequestHTTPMethodName",
            "clientRequestPath",
            "clientRequestQuery",
            "userAgent",
            "sampleInterval",
            "clientCountryName",
            "clientAsn",
            "description",
            "botScore",
          ],
        },
        events: [event(1, "a1")],
      }),
    ]);

    await fetchWindow(connector);

    const queryText: string = api.sent("OneUptimeFirewallEvents")[0]!.queryText;
    expect(queryText).toContain("clientAsn");
    expect(queryText).not.toContain("description");
    expect(queryText).not.toContain("botScore");
    expect(queryText).not.toContain("wafAttackScoreClass");
  });

  test("a window longer than the plan's longest query is read in pieces", async () => {
    const { api, connector } = harness([
      zone({
        id: ZONE_A,
        settings: { maxDuration: 1800 },
        events: [event(60, "a1"), event(2400, "a2")],
      }),
    ]);

    const result: ConnectorFetchResult = await fetchWindow(connector);

    expect(rayNames(result)).toEqual(["a1", "a2"]);
    expect(
      api
        .sent("OneUptimeFirewallEvents")
        .map((request: FakeRequest): JSONObject => {
          return request.variables["filter"] as JSONObject;
        }),
    ).toEqual([
      {
        datetime_geq: WINDOW_START.toISOString(),
        datetime_lt: new Date(WINDOW_START.getTime() + 1800000).toISOString(),
      },
      {
        datetime_geq: new Date(WINDOW_START.getTime() + 1800000).toISOString(),
        datetime_lt: WINDOW_END.toISOString(),
      },
    ]);
  });

  test("the part of a window older than the plan keeps is said, not asked for", async () => {
    const { api, connector } = harness([
      zone({
        id: ZONE_A,
        // The window starts three hours ago; the plan reaches back two and a half.
        settings: { notOlderThan: 9000 },
        events: [event(60, "too-old"), event(3000, "a1")],
      }),
    ]);

    const result: ConnectorFetchResult = await fetchWindow(connector);

    expect(rayNames(result)).toEqual(["a1"]);
    expect(result.warnings.join(" ")).toContain(
      "Cloudflare keeps example.com's firewall events for 3 hours; the part of the window before",
    );
    const filter: JSONObject = api.sent("OneUptimeFirewallEvents")[0]!
      .variables["filter"] as JSONObject;
    expect(new Date(String(filter["datetime_geq"])).getTime()).toBeGreaterThan(
      WINDOW_START.getTime(),
    );
  });
});

describe("CloudflareConnector - Cloudflare's rate limits", () => {
  test("a 429 with a short Retry-After is waited out and asked again", async () => {
    const { api, connector, sleep } = harness([
      zone({ id: ZONE_A, events: [event(1, "a1")] }),
    ]);
    api.script({
      matches: (request: FakeRequest): boolean => {
        return request.operation === "OneUptimeFirewallEvents";
      },
      response: restError(429, 971, "Please wait and consider throttling your request speed", {
        "retry-after": "2",
      }),
      times: 1,
    });

    const result: ConnectorFetchResult = await fetchWindow(connector);

    expect(sleep).toHaveBeenCalledWith(2000);
    expect(rayNames(result)).toEqual(["a1"]);
    expect(result.complete).toBe(true);
    expect(api.sent("OneUptimeFirewallEvents")).toHaveLength(2);
    // Both sends count against the run's request budget.
    expect(result.requestCount).toBe(api.requests.length);
  });

  test("a long Retry-After before every zone was read fails the run, so the cursor holds", async () => {
    const { api, connector, sleep } = harness([
      zone({ id: ZONE_A, events: [event(1, "a1")] }),
    ]);
    api.script({
      matches: (request: FakeRequest): boolean => {
        return request.operation === "OneUptimeFirewallEvents";
      },
      response: restError(429, 971, "Too many requests", {
        "retry-after": "300",
      }),
      times: 5,
    });

    const error: unknown = await fetchWindow(connector).catch(
      (thrown: unknown): unknown => {
        return thrown;
      },
    );

    expect(error).toBeInstanceOf(CloudflareApiError);
    expect((error as CloudflareApiError).kind).toBe(
      CloudflareFailureKind.RateLimited,
    );
    expect((error as CloudflareApiError).message).toContain(
      "Cloudflare asked to wait 300 seconds",
    );
    // Never waited five minutes, and never asked again while told to wait.
    expect(sleep).not.toHaveBeenCalled();
    expect(api.sent("OneUptimeFirewallEvents")).toHaveLength(1);
    expect(readConnectorFetchSummary(error)).toMatchObject({
      requestCount: api.requests.length,
    });
  });

  test("a rate limit after every zone was read once resumes from the oldest zone not finished", async () => {
    const { api, connector } = harness([
      zone({
        id: ZONE_A,
        settings: { maxPageSize: 2 },
        events: [event(10, "a1"), event(20, "a2"), event(30, "a3")],
      }),
      zone({ id: ZONE_B, events: [event(5, "b1")] }),
    ]);
    // GraphQL's own budget answer: a 200 that holds the error, asked to wait five minutes.
    let eventPages: number = 0;
    api.script({
      matches: (request: FakeRequest): boolean => {
        if (request.operation !== "OneUptimeFirewallEvents") {
          return false;
        }

        eventPages += 1;
        return eventPages === 3;
      },
      response: graphQlError(
        "rate limiter budget depleted, try again after 5 minutes",
      ),
      times: 1,
    });

    const result: ConnectorFetchResult = await fetchWindow(connector);

    expect(rayNames(result)).toEqual(["a1", "a2", "b1"]);
    expect(result.complete).toBe(false);
    expect(result.resumeAfter?.toISOString()).toBe(
      new Date(WINDOW_START.getTime() + 20000).toISOString(),
    );
    expect(result.warnings.join(" ")).toContain(
      "Cloudflare's rate limit stopped the read (it asked to wait 300 seconds).",
    );
  });

  test("a 503 Cloudflare says is too busy is asked again after a backoff", async () => {
    const { api, connector, sleep } = harness([
      zone({ id: ZONE_A, events: [event(1, "a1")] }),
    ]);
    api.script({
      matches: (request: FakeRequest): boolean => {
        return request.operation === "OneUptimeFirewallEvents";
      },
      response: graphQlError(
        "too many queries in progress, please try again later",
        503,
      ),
      times: 1,
    });

    const result: ConnectorFetchResult = await fetchWindow(connector);

    expect(sleep).toHaveBeenCalledWith(2000);
    expect(rayNames(result)).toEqual(["a1"]);
  });
});

describe("CloudflareConnector - the run's bounds and unreadable zones", () => {
  test("stopped by the request budget, it resumes from the oldest last-read time of the zones it did not finish", async () => {
    const { connector } = harness([
      zone({
        id: ZONE_A,
        settings: { maxPageSize: 1 },
        events: [event(10, "a1"), event(20, "a2"), event(30, "a3")],
      }),
      zone({
        id: ZONE_B,
        settings: { maxPageSize: 1 },
        events: [event(15, "b1"), event(25, "b2")],
      }),
    ]);

    // One zone list, one settings read, then four pages: a1, b1, a2, b2.
    const result: ConnectorFetchResult = await fetchWindow(
      connector,
      { accountId: ACCOUNT_ID },
      options({ maxRequests: 6 }),
    );

    expect(rayNames(result)).toEqual(["a1", "b1", "a2", "b2"]);
    expect(result.complete).toBe(false);
    expect(result.resumeAfter?.toISOString()).toBe(
      new Date(WINDOW_START.getTime() + 20000).toISOString(),
    );
    expect(result.warnings.join(" ")).toContain(
      "Stopped after 6 requests with firewall events still unread.",
    );
  });

  test("stopped by the event bound, it resumes after the last event it read", async () => {
    const { connector } = harness([
      zone({
        id: ZONE_A,
        events: [event(10, "a1"), event(20, "a2"), event(30, "a3")],
      }),
    ]);

    const result: ConnectorFetchResult = await fetchWindow(
      connector,
      { accountId: ACCOUNT_ID },
      options({ maxEvents: 2 }),
    );

    expect(rayNames(result)).toEqual(["a1", "a2"]);
    expect(result.complete).toBe(false);
    expect(result.resumeAfter?.toISOString()).toBe(
      new Date(WINDOW_START.getTime() + 20000).toISOString(),
    );
  });

  test("a zone the token may not read is named and skipped, and the others are imported", async () => {
    const { connector } = harness([
      zone({ id: ZONE_A, events: [event(1, "a1")] }),
      zone({ id: ZONE_B, analytics: false, events: [event(1, "b1")] }),
    ]);

    const result: ConnectorFetchResult = await fetchWindow(connector);

    expect(rayNames(result)).toEqual(["a1"]);
    // Partial, so Last Error says it - and moving on past the window, so the other zones keep arriving.
    expect(result.complete).toBe(false);
    expect(result.resumeAfter?.toISOString()).toBe(WINDOW_END.toISOString());
    expect(result.warnings.join(" ")).toContain(
      `The API token cannot read the analytics of shop.example.com (it lacks ${CLOUDFLARE_ANALYTICS_READ_PERMISSION})`,
    );
    expect(result.warnings.join(" ")).toContain("Import this time range");
    expect(result.details).toMatchObject({
      unreadableZones: ["shop.example.com"],
    });
  });

  test("when no zone can be read, the run fails and names the permission", async () => {
    const { connector } = harness([
      zone({ id: ZONE_A, analytics: false }),
      zone({ id: ZONE_B, analytics: false }),
    ]);

    await expect(fetchWindow(connector)).rejects.toThrow(
      CLOUDFLARE_ANALYTICS_READ_PERMISSION,
    );
  });

  test("an invalid token fails the run, and the message never holds the token", async () => {
    const { api, connector } = harness([zone({ id: ZONE_A })]);
    api.acceptedToken = "some-other-token-value-0123456789";
    api.script({
      matches: (): boolean => {
        return true;
      },
      response: restError(400, 6003, `Invalid request headers: ${TOKEN}`),
      times: 1,
    });

    const error: unknown = await fetchWindow(connector).catch(
      (thrown: unknown): unknown => {
        return thrown;
      },
    );

    expect((error as CloudflareApiError).kind).toBe(
      CloudflareFailureKind.InvalidToken,
    );
    expect((error as Error).message).not.toContain(TOKEN);
  });

  test("an account with more zones than one connection reads fails with what to do", async () => {
    const zones: Array<FakeZone> = Array.from(
      { length: 51 },
      (_value: unknown, index: number): FakeZone => {
        return zone({
          id: index.toString(16).padStart(32, "0"),
          name: `zone-${index}.example.com`,
        });
      },
    );
    const { connector } = harness(zones);

    await expect(fetchWindow(connector)).rejects.toThrow(
      "choose up to 50 zones",
    );
  });

  test("a chosen zone that is gone is said, and the rest are still read", async () => {
    const { connector } = harness([zone({ id: ZONE_A, events: [event(1, "a1")] })]);

    const result: ConnectorFetchResult = await fetchWindow(connector, {
      accountId: ACCOUNT_ID,
      zoneIds: `${ZONE_A},${ZONE_OTHER}`,
    });

    expect(rayNames(result)).toEqual(["a1"]);
    expect(result.complete).toBe(false);
    expect(result.resumeAfter?.toISOString()).toBe(WINDOW_END.toISOString());
    expect(result.warnings.join(" ")).toContain(ZONE_OTHER);
  });

  test("an account with no active zone fails the run rather than read nothing quietly", async () => {
    const { connector } = harness([]);

    await expect(fetchWindow(connector)).rejects.toThrow(BadDataException);
  });
});

describe("CloudflareConnector - the form's account and zone pickers", () => {
  test("offers the accounts of the zones the token reads, and each zone with its plan and account", async () => {
    const { connector } = harness([
      zone({ id: ZONE_B, name: "shop.example.com" }),
      zone({
        id: ZONE_A,
        name: "example.com",
        plan: { name: "Enterprise Website", legacy_id: "enterprise" },
      }),
      zone({
        id: ZONE_OTHER,
        name: "agency.example.net",
        accountId: OTHER_ACCOUNT_ID,
        accountName: "Agency",
      }),
    ]);

    const choices: Record<string, Array<ConnectorFieldChoice>> =
      await connector.listFieldChoices(
        settings({}, { apiToken: TOKEN }),
        { requestTimeoutInMs: 1000 },
      );

    expect(choices["accountId"]).toEqual([
      { value: ACCOUNT_ID, label: "Acme Corp" },
      { value: OTHER_ACCOUNT_ID, label: "Agency" },
    ]);
    expect(choices["zoneIds"]).toEqual([
      {
        value: ZONE_OTHER,
        label: "agency.example.net",
        description: "Pro",
        parentValue: OTHER_ACCOUNT_ID,
      },
      {
        value: ZONE_A,
        label: "example.com",
        description: "Enterprise",
        parentValue: ACCOUNT_ID,
      },
      {
        value: ZONE_B,
        label: "shop.example.com",
        description: "Pro",
        parentValue: ACCOUNT_ID,
      },
    ]);
  });

  test("an invalid token is said in words a person can act on", async () => {
    const { api, connector } = harness([zone({ id: ZONE_A })]);
    api.acceptedToken = "another-token-0123456789abcdefghijkl";

    await expect(
      connector.listFieldChoices(settings({}), { requestTimeoutInMs: 1000 }),
    ).rejects.toThrow(
      "Cloudflare did not accept the API token. Check that you pasted the whole token and that it is still active.",
    );
  });

  test("a token that cannot list zones is told which permission to add", async () => {
    const { api, connector } = harness([zone({ id: ZONE_A })]);
    api.canListZones = false;

    await expect(
      connector.listFieldChoices(settings({}), { requestTimeoutInMs: 1000 }),
    ).rejects.toThrow(CLOUDFLARE_ZONE_READ_PERMISSION);
  });

  test("a token that reads no zone says so", async () => {
    const { connector } = harness([]);

    await expect(
      connector.listFieldChoices(settings({}), { requestTimeoutInMs: 1000 }),
    ).rejects.toThrow("The API token reads no zone.");
  });

  test("lists every page of zones", async () => {
    const zones: Array<FakeZone> = Array.from(
      { length: 120 },
      (_value: unknown, index: number): FakeZone => {
        return zone({
          id: index.toString(16).padStart(32, "0"),
          name: `zone-${String(index).padStart(3, "0")}.example.com`,
        });
      },
    );
    const { api, connector } = harness(zones);

    const choices: Record<string, Array<ConnectorFieldChoice>> =
      await connector.listFieldChoices(settings({}), {
        requestTimeoutInMs: 1000,
      });

    expect(choices["zoneIds"]).toHaveLength(120);
    expect(
      api.requests.filter((request: FakeRequest): boolean => {
        return request.path.endsWith("/zones");
      }),
    ).toHaveLength(3);
  });
});

describe("CloudflareConnector - a 200 Cloudflare answers with something else", () => {
  test("an unrecognized zones answer fails rather than read as no zones", async () => {
    const { api, connector } = harness([zone({ id: ZONE_A })]);
    api.script({
      matches: (request: FakeRequest): boolean => {
        return request.path.endsWith("/zones");
      },
      response: json(200, { success: true, result: { not: "a list" } }),
      times: 1,
    });

    await expect(fetchWindow(connector)).rejects.toThrow(
      "Cloudflare zones request returned an unrecognized response",
    );
  });
});
