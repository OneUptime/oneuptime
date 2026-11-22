import CloudflareBlocking, {
  CloudflareAccountReading,
  getCloudflareRuleInput,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Cloudflare/CloudflareBlocking";
import CloudflareClient from "../../../../../../Server/Utils/SecurityEvent/Connectors/Cloudflare/CloudflareClient";
import {
  SecurityBlockEntry,
  SecurityBlockHeldItem,
  SecurityBlockWriteResult,
} from "../../../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestination";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../../Server/Utils/DataSource/HttpFetch";
import ObjectID from "../../../../../../Types/ObjectID";
import { SecurityConnectorCheck } from "../../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import {
  CLOUDFLARE_BLOCK_LIST_NAMES,
  CLOUDFLARE_BLOCK_RULE_DESCRIPTION,
  CLOUDFLARE_BLOCK_RULE_REFS,
  CloudflareAccessRulesReason,
  CloudflareActionStatus,
  CloudflareBlockingMechanism,
  CloudflareBlockingStatus,
  CloudflarePlan,
  CloudflareRuleState,
  CloudflareZoneStatus,
  getCloudflareBlockListDescription,
} from "../../../../../../Types/SecurityBlocklist/CloudflareBlocking";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
} from "../../../../../../Types/SecurityBlocklist/SecurityBlock";
import CloudflareBlockingFakeApi, {
  FakeList,
  FakeRule,
} from "./CloudflareBlockingFakeApi";
import {
  ACCOUNT_ID,
  FakeRequest,
  FakeZone,
  TOKEN,
  ZONE_A,
  ZONE_B,
  json,
  restError,
} from "./CloudflareFakeApi";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * BLOCKING AT CLOUDFLARE (#10343), against Cloudflare's API as it answers
 * (CloudflareBlockingFakeApi): the lists and the custom rules OneUptime sets
 * up, the plan's fallback to IP Access Rules, the item operations and their
 * polling, the read back, drift (a rule deleted, turned off or edited by
 * hand, an item removed by hand), taking it all away, and the write
 * permissions - with rate limits, permission errors, a pending bulk
 * operation and a list that is full. Nothing waits: the client's and the
 * operations' sleeps are recorded, not slept.
 */

const PROJECT_ID: string = "10343000-0000-4000-8000-000000000001";
const OTHER_PROJECT_ID: string = "10343000-0000-4000-8000-000000000002";
const NOW: Date = new Date("2026-11-21T10:42:00.000Z");

const PRO: { name: string; legacy_id: string } = {
  name: "Pro Website",
  legacy_id: "pro",
};
const FREE: { name: string; legacy_id: string } = {
  name: "Free Website",
  legacy_id: "free",
};

function zone(id: string, name: string, plan = PRO): FakeZone {
  return { id, name, plan };
}

let api: CloudflareBlockingFakeApi;
let sleeps: Array<number>;
let clock: number;

function blocking(options?: {
  blockZoneIds?: Array<string>;
  projectId?: string;
}): CloudflareBlocking {
  return new CloudflareBlocking({
    client: new CloudflareClient({
      apiToken: TOKEN,
      transport: api.transport(),
      requestTimeoutInMs: 20000,
      sleep: async (ms: number): Promise<void> => {
        sleeps.push(ms);
      },
      now: (): number => {
        return clock;
      },
    }),
    scope: {
      projectId: options?.projectId || PROJECT_ID,
      accountId: ACCOUNT_ID,
      readZoneIds: [],
      blockZoneIds: options?.blockZoneIds || [],
    },
    now: (): Date => {
      return new Date(clock);
    },
    sleep: async (ms: number): Promise<void> => {
      sleeps.push(ms);
      clock += ms;
    },
  });
}

function entry(
  value: string,
  action: SecurityBlockAction = SecurityBlockAction.Block,
): SecurityBlockEntry {
  return {
    securityBlockId: ObjectID.generate(),
    indicatorType: value.includes("/")
      ? SecurityBlockIndicatorType.IpRange
      : SecurityBlockIndicatorType.IpAddress,
    value,
    action,
    expiresAt: new Date("2026-11-22T10:42:00.000Z"),
    comment: "OneUptime case CASE-123 until 2026-11-22 10:42 UTC",
  };
}

function actionOf(
  status: CloudflareBlockingStatus,
  action: SecurityBlockAction,
): CloudflareActionStatus {
  return status.actions.find((candidate: CloudflareActionStatus): boolean => {
    return candidate.action === action;
  })!;
}

function zoneOf(
  status: CloudflareBlockingStatus,
  zoneId: string,
): CloudflareZoneStatus {
  return status.zones.find((candidate: CloudflareZoneStatus): boolean => {
    return candidate.id === zoneId;
  })!;
}

// What was sent to Cloudflare that changes something.
function writes(): Array<string> {
  return api.requests
    .filter((request: FakeRequest): boolean => {
      return request.method !== "GET";
    })
    .map((request: FakeRequest): string => {
      return `${request.method} ${request.path.replace(/^\/client\/v4/, "")}`;
    });
}

beforeEach(() => {
  api = new CloudflareBlockingFakeApi([
    zone(ZONE_A, "example.com"),
    zone(ZONE_B, "shop.example.com"),
  ]);
  api.operationPolls = 1;
  sleeps = [];
  clock = NOW.getTime();
});

describe("setting blocking up", () => {
  test("makes the two lists, named as OneUptime's project's, and one rule per list in each zone, first in the phase, never replacing a phase", async () => {
    // example.com has rules of the customer's own; shop.example.com has none yet.
    const customers: FakeRule = api.addCustomerRule(ZONE_A, {
      action: "skip",
      expression: '(http.request.uri.path eq "/health")',
    });

    const status: CloudflareBlockingStatus = await blocking().setUp({
      previous: null,
      requestedAt: "2026-11-21T10:41:00.000Z",
    });

    // The lists, described as this project's.
    for (const action of [
      SecurityBlockAction.Block,
      SecurityBlockAction.Challenge,
    ]) {
      const list: FakeList | undefined = api.listNamed(
        CLOUDFLARE_BLOCK_LIST_NAMES[action],
      );
      expect(list?.kind).toBe("ip");
      expect(list?.description).toBe(
        getCloudflareBlockListDescription(PROJECT_ID),
      );
      expect(actionOf(status, action).choice.mechanism).toBe(
        CloudflareBlockingMechanism.List,
      );
      expect(actionOf(status, action).listId).toBe(list?.id);
      expect(actionOf(status, action).isInPlace).toBe(true);
    }

    // In the zone with rules: each of OneUptime's added on its own, first; the customer's kept, after them.
    const zoneARules: Array<FakeRule> = api.rulesets.get(ZONE_A)!.rules;
    expect(
      zoneARules.map((rule: FakeRule): string => {
        return rule.ref;
      }),
    ).toEqual([
      CLOUDFLARE_BLOCK_RULE_REFS[SecurityBlockAction.Challenge],
      CLOUDFLARE_BLOCK_RULE_REFS[SecurityBlockAction.Block],
      customers.ref,
    ]);

    const blockRule: FakeRule = api.ruleWithRef(
      ZONE_A,
      CLOUDFLARE_BLOCK_RULE_REFS[SecurityBlockAction.Block],
    )!;
    expect(blockRule).toEqual(
      expect.objectContaining({
        action: "block",
        expression: "(ip.src in $oneuptime_block)",
        description: CLOUDFLARE_BLOCK_RULE_DESCRIPTION,
        enabled: true,
      }),
    );
    expect(
      api.ruleWithRef(
        ZONE_A,
        CLOUDFLARE_BLOCK_RULE_REFS[SecurityBlockAction.Challenge],
      ),
    ).toEqual(
      expect.objectContaining({
        action: "managed_challenge",
        expression: "(ip.src in $oneuptime_challenge)",
      }),
    );

    // The zone without an entry point: made with OneUptime's two rules (a 404, then POST /rulesets).
    expect(
      api.rulesets.get(ZONE_B)!.rules.map((rule: FakeRule): string => {
        return rule.ref;
      }),
    ).toEqual([
      CLOUDFLARE_BLOCK_RULE_REFS[SecurityBlockAction.Block],
      CLOUDFLARE_BLOCK_RULE_REFS[SecurityBlockAction.Challenge],
    ]);

    // Each rule added on its own, first in the phase; the phase never replaced.
    const adds: Array<FakeRequest> = api.requests.filter(
      (request: FakeRequest): boolean => {
        return request.method === "POST" && request.path.endsWith("/rules");
      },
    );
    expect(adds).toHaveLength(2);
    expect(api.replacements).toEqual([]);
    expect(writes()).toEqual([
      `POST /accounts/${ACCOUNT_ID}/rules/lists`,
      `POST /accounts/${ACCOUNT_ID}/rules/lists`,
      `POST /zones/${ZONE_A}/rulesets/${api.rulesets.get(ZONE_A)!.id}/rules`,
      `POST /zones/${ZONE_A}/rulesets/${api.rulesets.get(ZONE_A)!.id}/rules`,
      `POST /zones/${ZONE_B}/rulesets`,
    ]);

    // What the status says.
    expect(status.setupDoneFor).toBe("2026-11-21T10:41:00.000Z");
    expect(status.plan).toBe(CloudflarePlan.Pro);
    expect(status.accountId).toBe(ACCOUNT_ID);
    expect(zoneOf(status, ZONE_A)).toEqual(
      expect.objectContaining({
        name: "example.com",
        plan: CloudflarePlan.Pro,
        rulesUsed: 3,
        rulesLimit: 20,
      }),
    );

    for (const zoneId of [ZONE_A, ZONE_B]) {
      expect(
        zoneOf(status, zoneId).rules.map(
          (rule: { action: string; state: string }) => {
            return `${rule.action}:${rule.state}`;
          },
        ),
      ).toEqual(["Block:Enforcing", "Challenge:Enforcing"]);
    }

    expect(status.usage).toEqual({ items: 0, limit: 10000 });
  });

  test("on Free with its one list unused, Block takes the list and Challenge goes to IP Access Rules, and setup says what the rule takes", async () => {
    api = new CloudflareBlockingFakeApi([zone(ZONE_A, "example.com", FREE)]);

    const reading: CloudflareAccountReading = await blocking().readAccount();
    const status: CloudflareBlockingStatus = await blocking().setUp({
      previous: null,
    });

    expect(actionOf(status, SecurityBlockAction.Block).choice).toEqual({
      mechanism: CloudflareBlockingMechanism.List,
    });
    expect(actionOf(status, SecurityBlockAction.Challenge).choice).toEqual({
      mechanism: CloudflareBlockingMechanism.AccessRules,
      reason: CloudflareAccessRulesReason.NoListLeft,
      plan: CloudflarePlan.Free,
      lists: 1,
    });
    expect(api.listNamed("oneuptime_block")).toBeDefined();
    expect(api.listNamed("oneuptime_challenge")).toBeUndefined();
    // One rule only: Challenge has no list for a rule to read.
    expect(
      api.rulesets.get(ZONE_A)!.rules.map((rule: FakeRule): string => {
        return rule.ref;
      }),
    ).toEqual([CLOUDFLARE_BLOCK_RULE_REFS[SecurityBlockAction.Block]]);
    // Two mechanisms: no single limit to count against.
    expect(status.usage.limit).toBeNull();

    expect(
      CloudflareBlocking.describeSetupPlan(
        reading,
        CloudflareBlocking.chooseMechanisms(reading),
      ),
    ).toBe(
      "Blocks go to the list oneuptime_block, with a custom rule in each zone. Challenges go to IP Access Rules: the account's plan has one list, and none is left. On example.com's Free plan, OneUptime's rule takes 1 of its 5 custom rules.",
    );
  });

  test("on Free whose one list the customer uses, both go to IP Access Rules, and nothing is made", async () => {
    api = new CloudflareBlockingFakeApi([zone(ZONE_A, "example.com", FREE)]);
    api.addCustomerList("office", ["198.51.100.7"]);

    const status: CloudflareBlockingStatus = await blocking().setUp({
      previous: null,
    });

    for (const action of [
      SecurityBlockAction.Block,
      SecurityBlockAction.Challenge,
    ]) {
      expect(actionOf(status, action).choice.mechanism).toBe(
        CloudflareBlockingMechanism.AccessRules,
      );
      expect(actionOf(status, action).choice.reason).toBe(
        CloudflareAccessRulesReason.NoListLeft,
      );
    }

    expect(writes()).toEqual([]);
    expect(status.zones[0]?.rules).toEqual([]);
    expect(status.usage.limit).toBe(50000);
  });

  test("a zone with no custom rule to spare sends both actions to IP Access Rules, naming the zone", async () => {
    api = new CloudflareBlockingFakeApi([zone(ZONE_A, "example.com", FREE)]);

    for (let index: number = 0; index < 5; index++) {
      api.addCustomerRule(ZONE_A, {
        expression: `(ip.src eq 192.0.2.${index + 1})`,
      });
    }

    const status: CloudflareBlockingStatus = await blocking().setUp({
      previous: null,
    });

    expect(actionOf(status, SecurityBlockAction.Block).choice).toEqual({
      mechanism: CloudflareBlockingMechanism.AccessRules,
      reason: CloudflareAccessRulesReason.NoRuleLeft,
      zoneName: "example.com",
      rulesUsed: 5,
      rulesLimit: 5,
    });
    expect(writes()).toEqual([]);
  });

  test("a list with OneUptime's name that another project made is never taken over", async () => {
    api.lists.push({
      id: api.id("d0"),
      name: "oneuptime_block",
      description: getCloudflareBlockListDescription(OTHER_PROJECT_ID),
      kind: "ip",
      items: [
        {
          id: api.id("d1"),
          ip: "203.0.113.9",
          comment: "OneUptime case CASE-9 until lifted",
        },
      ],
    });

    await expect(blocking().setUp({ previous: null })).rejects.toThrow(
      "oneuptime_block already exists in this Cloudflare account, and another OneUptime project or a person made it",
    );
    expect(writes()).toEqual([]);
    expect(api.listNamed("oneuptime_block")!.items).toHaveLength(1);
  });

  test("a missing Zone WAF permission stops the setup and names it, and the zone", async () => {
    api.permissions.delete("waf");

    await expect(blocking().setUp({ previous: null })).rejects.toThrow(
      "The API token cannot read the custom rules of example.com: give it Zone > Zone WAF > Edit on that zone.",
    );
  });

  test("a missing Account Filter Lists permission stops the setup and names it", async () => {
    api.permissions.delete("lists");

    await expect(blocking().setUp({ previous: null })).rejects.toThrow(
      "The API token cannot read the account's lists: give it Account > Account Filter Lists > Edit.",
    );
    expect(writes()).toEqual([]);
  });

  test("a rule write the zone has no room for says so, naming the zone", async () => {
    api = new CloudflareBlockingFakeApi([zone(ZONE_A, "example.com", FREE)]);
    // Chosen while the zone had room, then filled by hand before the rule was added.
    const reading: CloudflareAccountReading = await blocking().readAccount();
    const previous: CloudflareBlockingStatus = blocking().describe({
      reading,
      mechanisms: CloudflareBlocking.chooseMechanisms(reading),
      previous: null,
    });

    for (let index: number = 0; index < 5; index++) {
      api.addCustomerRule(ZONE_A, {});
    }

    await expect(
      blocking().setUp({ previous: { ...previous, zones: [] } }),
    ).rejects.toThrow(
      "example.com has no custom rule left for OneUptime's rule. Delete a custom rule you no longer use in Cloudflare, then select Put It Back.",
    );
  });

  test("a short rate limit is waited out and asked again; a long one fails the setup", async () => {
    api.script({
      matches: (request: FakeRequest): boolean => {
        return (
          request.method === "POST" && request.path.endsWith("/rules/lists")
        );
      },
      response: restError(
        429,
        971,
        "Please wait and consider throttling your request speed",
        {
          "retry-after": "2",
        },
      ),
      times: 1,
    });

    await blocking().setUp({ previous: null });
    expect(api.listNamed("oneuptime_block")).toBeDefined();
    expect(sleeps).toContain(2000);

    api = new CloudflareBlockingFakeApi([zone(ZONE_A, "example.com")]);
    api.script({
      matches: (request: FakeRequest): boolean => {
        return request.method === "POST";
      },
      response: restError(
        429,
        971,
        "Please wait and consider throttling your request speed",
        {
          "retry-after": "300",
        },
      ),
      times: 10,
    });

    await expect(blocking().setUp({ previous: null })).rejects.toThrow(
      "HTTP 429",
    );
  });

  test("reads the addresses the zones' own skip rules let through, to offer to protect them", async () => {
    api.addCustomerRule(ZONE_A, {
      action: "skip",
      expression:
        "(ip.src in {203.0.113.7 198.51.100.0/24}) or (ip.src eq 2001:DB8::1)",
    });
    // Not a skip, a negation, and a list: none is an address the customer lets through.
    api.addCustomerRule(ZONE_A, {
      action: "block",
      expression: "(ip.src in {192.0.2.50})",
    });
    api.addCustomerRule(ZONE_A, {
      action: "skip",
      expression: "not ip.src in {192.0.2.60} and ip.src in $partners",
    });

    const status: CloudflareBlockingStatus = await blocking().setUp({
      previous: null,
    });

    expect(zoneOf(status, ZONE_A).skipAddresses).toEqual([
      "203.0.113.7",
      "198.51.100.0/24",
      "2001:db8::1",
    ]);
    expect(zoneOf(status, ZONE_B).skipAddresses).toBeUndefined();
  });

  test("blocks in the chosen zones only, and takes OneUptime's rules out of a zone no longer chosen", async () => {
    const first: CloudflareBlockingStatus = await blocking().setUp({
      previous: null,
    });

    const narrowed: CloudflareBlockingStatus = await blocking({
      blockZoneIds: [ZONE_B],
    }).setUp({ previous: first });

    expect(
      narrowed.zones.map((candidate: CloudflareZoneStatus): string => {
        return candidate.id;
      }),
    ).toEqual([ZONE_B]);
    expect(
      api.ruleWithRef(
        ZONE_A,
        CLOUDFLARE_BLOCK_RULE_REFS[SecurityBlockAction.Block],
      ),
    ).toBeUndefined();
    expect(
      api.ruleWithRef(
        ZONE_B,
        CLOUDFLARE_BLOCK_RULE_REFS[SecurityBlockAction.Block],
      ),
    ).toBeDefined();
  });
});

describe("the blocks it holds", () => {
  let status: CloudflareBlockingStatus;

  beforeEach(async () => {
    status = await blocking().setUp({ previous: null });
    api.requests = [];
  });

  test("adds each action's blocks to its list in one bulk operation, polled until it completes, with each block's comment", async () => {
    const results: Array<SecurityBlockWriteResult> = await blocking().add(
      [
        entry("35.205.11.131"),
        entry("198.51.100.0/24"),
        entry("2001:db8::7", SecurityBlockAction.Challenge),
      ],
      status,
    );

    expect(results).toEqual([
      {
        value: "35.205.11.131",
        action: SecurityBlockAction.Block,
        isDone: true,
      },
      {
        value: "198.51.100.0/24",
        action: SecurityBlockAction.Block,
        isDone: true,
      },
      {
        value: "2001:db8::7",
        action: SecurityBlockAction.Challenge,
        isDone: true,
      },
    ]);
    expect(api.listNamed("oneuptime_block")!.items).toEqual([
      expect.objectContaining({
        ip: "35.205.11.131",
        comment: "OneUptime case CASE-123 until 2026-11-22 10:42 UTC",
      }),
      expect.objectContaining({ ip: "198.51.100.0/24" }),
    ]);
    expect(api.listNamed("oneuptime_challenge")!.items).toEqual([
      expect.objectContaining({ ip: "2001:db8::7" }),
    ]);

    // One operation an action, each polled: pending, then completed.
    expect(
      api.requests
        .filter((request: FakeRequest): boolean => {
          return request.path.includes("/bulk_operations/");
        })
        .map((request: FakeRequest): string => {
          return request.method;
        }),
    ).toEqual(["GET", "GET", "GET", "GET"]);
    expect(api.replacements).toEqual([]);
  });

  test("reads back only OneUptime's items, as blocks are written, by their item ids", async () => {
    await blocking().add(
      [entry("35.205.11.131"), entry("2001:DB8:0:0::7")],
      status,
    );
    // An item someone added by hand to OneUptime's list: not OneUptime's to read, nor to remove.
    api.listNamed("oneuptime_block")!.items.push({
      id: api.id("h0"),
      ip: "192.0.2.99",
      comment: "Added by hand",
    });

    const held: Array<SecurityBlockHeldItem> =
      await blocking().readHeld(status);

    expect(held).toEqual([
      {
        value: "35.205.11.131",
        action: SecurityBlockAction.Block,
        providerRef: api.listNamed("oneuptime_block")!.items[0]!.id,
      },
      {
        value: "2001:db8::7",
        action: SecurityBlockAction.Block,
        providerRef: api.listNamed("oneuptime_block")!.items[1]!.id,
      },
    ]);
  });

  test("reads every page of a list after the cursor", async () => {
    const list: FakeList = api.listNamed("oneuptime_block")!;

    for (let index: number = 0; index < 1203; index++) {
      list.items.push({
        id: api.id("p0"),
        ip: `10.${Math.floor(index / 256)}.${index % 256}.1`,
        comment: "OneUptime case CASE-1 until lifted",
      });
    }

    const held: Array<SecurityBlockHeldItem> =
      await blocking().readHeld(status);

    expect(held).toHaveLength(1203);
    expect(
      api.requests.filter((request: FakeRequest): boolean => {
        return request.path.endsWith(`/rules/lists/${list.id}/items`);
      }),
    ).toHaveLength(3);
  });

  test("removes blocks by their item ids, leaving the items someone added by hand", async () => {
    await blocking().add(
      [entry("35.205.11.131"), entry("198.51.100.7")],
      status,
    );
    api.listNamed("oneuptime_block")!.items.push({
      id: api.id("h0"),
      ip: "192.0.2.99",
      comment: "Added by hand",
    });

    const held: Array<SecurityBlockHeldItem> =
      await blocking().readHeld(status);
    const results: Array<SecurityBlockWriteResult> = await blocking().remove(
      held.slice(0, 1),
      status,
    );

    expect(results).toEqual([
      {
        value: "35.205.11.131",
        action: SecurityBlockAction.Block,
        isDone: true,
      },
    ]);
    expect(
      api.listNamed("oneuptime_block")!.items.map((item: { ip: string }) => {
        return item.ip;
      }),
    ).toEqual(["198.51.100.7", "192.0.2.99"]);
  });

  test("waits for another bulk operation of the account to finish, then writes", async () => {
    api.foreignOperationPolls = 3;

    const results: Array<SecurityBlockWriteResult> = await blocking().add(
      [entry("35.205.11.131")],
      status,
    );

    expect(results[0]?.isDone).toBe(true);
    expect(api.listNamed("oneuptime_block")!.items).toHaveLength(1);
    // Two waits inside the client, then one of its own.
    expect(sleeps.length).toBeGreaterThan(0);
  });

  test("another bulk operation that never finishes fails the write, saying Cloudflare runs one at a time", async () => {
    api.foreignOperationPolls = 1000;

    await expect(
      blocking().add([entry("35.205.11.131")], status),
    ).rejects.toThrow("Cloudflare runs one at a time");
    expect(api.listNamed("oneuptime_block")!.items).toEqual([]);
  });

  test("a list that is full refuses its blocks, each saying so", async () => {
    // A Pro account holds 10,000 items across its lists; the customer's own use 9,999.
    api.addCustomerList(
      "office",
      Array.from({ length: 9999 }, (_: unknown, index: number): string => {
        return `10.1.${Math.floor(index / 256)}.${index % 256}`;
      }),
    );

    const results: Array<SecurityBlockWriteResult> = await blocking().add(
      [entry("35.205.11.131"), entry("35.205.11.132")],
      status,
    );

    for (const result of results) {
      expect(result.isDone).toBe(false);
      expect(result.error).toBe(
        "oneuptime_block is full: your Cloudflare plan holds no more list items. exceeded maximum number of list items for this account",
      );
    }
  });

  test("a missing Account Filter Lists permission is the destination's failure, naming the permission", async () => {
    api.permissions.delete("lists");

    await expect(
      blocking().add([entry("35.205.11.131")], status),
    ).rejects.toThrow(
      "The API token cannot change the lists: give it Account > Account Filter Lists > Edit.",
    );
  });

  test("an operation still running after the wait is left to run: the read back says what it did", async () => {
    api.operationPolls = 1000;

    const results: Array<SecurityBlockWriteResult> = await blocking().add(
      [entry("35.205.11.131")],
      status,
    );

    expect(results[0]?.isDone).toBe(true);
    expect(await blocking().readHeld(status)).toEqual([]);
  });
});

describe("IP Access Rules, where lists cannot be used", () => {
  let status: CloudflareBlockingStatus;

  beforeEach(async () => {
    api = new CloudflareBlockingFakeApi([zone(ZONE_A, "example.com", FREE)]);
    api.addCustomerList("office");
    status = await blocking().setUp({ previous: null });
  });

  test("adds one rule a block, with its action's mode and the block's note, and reads back only OneUptime's", async () => {
    api.accessRules.push({
      id: api.id("x0"),
      mode: "block",
      notes: "Scraper we saw in March",
      target: "ip",
      value: "192.0.2.200",
    });

    const results: Array<SecurityBlockWriteResult> = await blocking().add(
      [
        entry("35.205.11.131"),
        entry("2001:db8::7"),
        entry("198.51.100.0/24"),
        entry("203.0.113.8", SecurityBlockAction.Challenge),
      ],
      status,
    );

    expect(
      results.map((result: SecurityBlockWriteResult): boolean => {
        return result.isDone;
      }),
    ).toEqual([true, true, true, true]);
    expect(
      api.accessRules
        .slice(1)
        .map(
          (rule: {
            mode: string;
            target: string;
            value: string;
            notes: string;
          }) => {
            return `${rule.mode} ${rule.target} ${rule.value} | ${rule.notes}`;
          },
        ),
    ).toEqual([
      "block ip 35.205.11.131 | OneUptime case CASE-123 until 2026-11-22 10:42 UTC",
      "block ip6 2001:db8::7 | OneUptime case CASE-123 until 2026-11-22 10:42 UTC",
      "block ip_range 198.51.100.0/24 | OneUptime case CASE-123 until 2026-11-22 10:42 UTC",
      "managed_challenge ip 203.0.113.8 | OneUptime case CASE-123 until 2026-11-22 10:42 UTC",
    ]);

    const held: Array<SecurityBlockHeldItem> =
      await blocking().readHeld(status);

    expect(
      held.map((item: SecurityBlockHeldItem): string => {
        return `${item.action} ${item.value}`;
      }),
    ).toEqual([
      "Block 35.205.11.131",
      "Block 2001:db8::7",
      "Block 198.51.100.0/24",
      "Challenge 203.0.113.8",
    ]);

    await blocking().remove(held.slice(0, 2), status);

    expect(
      api.accessRules.map((rule: { value: string }): string => {
        return rule.value;
      }),
    ).toEqual(["192.0.2.200", "198.51.100.0/24", "203.0.113.8"]);
  });
});

describe("drift: what changed at Cloudflare is reported, never put back behind the person's back", () => {
  let status: CloudflareBlockingStatus;

  beforeEach(async () => {
    status = await blocking().setUp({ previous: null });
    await blocking().add([entry("35.205.11.131")], status);
    api.requests = [];
  });

  test("a rule turned off: its zone says so, and its blocks are held but not in force there", async () => {
    api.ruleWithRef(
      ZONE_A,
      CLOUDFLARE_BLOCK_RULE_REFS[SecurityBlockAction.Block],
    )!.enabled = false;

    const checked: CloudflareBlockingStatus = await blocking().check(status);

    expect(writes()).toEqual([]);
    expect(
      zoneOf(checked, ZONE_A).rules.find((rule: { action: string }) => {
        return rule.action === SecurityBlockAction.Block;
      })?.state,
    ).toBe(CloudflareRuleState.TurnedOff);
    expect(await blocking().readHeld(checked)).toEqual([
      expect.objectContaining({
        value: "35.205.11.131",
        notInForceReason:
          "Your rule in example.com was turned off: blocks there are not enforced",
      }),
    ]);
  });

  test("a rule deleted, and one edited by hand, are each reported, and named together", async () => {
    const ruleset: { rules: Array<FakeRule> } = api.rulesets.get(ZONE_A)!;
    ruleset.rules = ruleset.rules.filter((rule: FakeRule): boolean => {
      return rule.ref !== CLOUDFLARE_BLOCK_RULE_REFS[SecurityBlockAction.Block];
    });
    api.ruleWithRef(
      ZONE_B,
      CLOUDFLARE_BLOCK_RULE_REFS[SecurityBlockAction.Block],
    )!.action = "log";

    const checked: CloudflareBlockingStatus = await blocking().check(status);

    expect(writes()).toEqual([]);

    const blockRule: (zoneId: string) => string | undefined = (
      zoneId: string,
    ): string | undefined => {
      return zoneOf(checked, zoneId).rules.find(
        (rule: { action: string }): boolean => {
          return rule.action === SecurityBlockAction.Block;
        },
      )?.state;
    };

    expect(blockRule(ZONE_A)).toBe(CloudflareRuleState.Deleted);
    expect(blockRule(ZONE_B)).toBe(CloudflareRuleState.Changed);
    expect((await blocking().readHeld(checked))[0]?.notInForceReason).toBe(
      "Your rules in example.com and shop.example.com are not in place: blocks there are not enforced",
    );
  });

  test("an expression edited by hand is a rule changed", async () => {
    api.ruleWithRef(
      ZONE_A,
      CLOUDFLARE_BLOCK_RULE_REFS[SecurityBlockAction.Challenge],
    )!.expression = '(ip.src in $oneuptime_challenge and http.host eq "x")';

    const checked: CloudflareBlockingStatus = await blocking().check(status);

    expect(
      zoneOf(checked, ZONE_A).rules.find((rule: { action: string }) => {
        return rule.action === SecurityBlockAction.Challenge;
      })?.state,
    ).toBe(CloudflareRuleState.Changed);
  });

  test("a list item removed by hand is simply not held: the reconciler adds it again", async () => {
    api.listNamed("oneuptime_block")!.items = [];

    expect(await blocking().readHeld(await blocking().check(status))).toEqual(
      [],
    );
  });

  test("a list deleted by hand is not in place, and says so", async () => {
    // Cloudflare keeps a list a rule refers to: the rules go first, then the list.
    for (const zoneId of [ZONE_A, ZONE_B]) {
      api.rulesets.get(zoneId)!.rules = [];
    }
    api.lists = api.lists.filter((list: FakeList): boolean => {
      return list.name !== "oneuptime_block";
    });

    const checked: CloudflareBlockingStatus = await blocking().check(status);

    expect(actionOf(checked, SecurityBlockAction.Block).isInPlace).toBe(false);
    expect(writes()).toEqual([]);
  });

  test("Put It Back turns the rule on again, writes it as OneUptime wrote it, and adds the one deleted", async () => {
    api.ruleWithRef(
      ZONE_A,
      CLOUDFLARE_BLOCK_RULE_REFS[SecurityBlockAction.Block],
    )!.enabled = false;
    api.ruleWithRef(
      ZONE_A,
      CLOUDFLARE_BLOCK_RULE_REFS[SecurityBlockAction.Challenge],
    )!.action = "log";
    const ruleset: { rules: Array<FakeRule> } = api.rulesets.get(ZONE_B)!;
    ruleset.rules = [];

    const checked: CloudflareBlockingStatus = await blocking().check(status);
    const putBack: CloudflareBlockingStatus = await blocking().setUp({
      previous: checked,
      zoneIds: [ZONE_A],
      requestedAt: "2026-11-21T11:00:00.000Z",
    });

    // Only the zone asked: shop.example.com stays as it is.
    expect(
      zoneOf(putBack, ZONE_A).rules.map((rule: { state: string }) => {
        return rule.state;
      }),
    ).toEqual([CloudflareRuleState.Enforcing, CloudflareRuleState.Enforcing]);
    expect(
      zoneOf(putBack, ZONE_B).rules.map((rule: { state: string }) => {
        return rule.state;
      }),
    ).toEqual([CloudflareRuleState.Deleted, CloudflareRuleState.Deleted]);
    expect(
      writes().filter((write: string): boolean => {
        return write.startsWith("PATCH");
      }),
    ).toHaveLength(2);
    expect(putBack.setupDoneFor).toBe("2026-11-21T11:00:00.000Z");

    const everywhere: CloudflareBlockingStatus = await blocking().setUp({
      previous: putBack,
      requestedAt: "2026-11-21T11:05:00.000Z",
    });

    expect(
      zoneOf(everywhere, ZONE_B).rules.map((rule: { state: string }) => {
        return rule.state;
      }),
    ).toEqual([CloudflareRuleState.Enforcing, CloudflareRuleState.Enforcing]);
  });

  test("a zone added to the account since is set up by the check, as blocking is on in every zone", async () => {
    const ZONE_C: string = "cccccccccccccccccccccccccccccccc";
    api.zones.push(zone(ZONE_C, "blog.example.com"));

    const checked: CloudflareBlockingStatus = await blocking().check(status);

    expect(
      zoneOf(checked, ZONE_C).rules.map((rule: { state: string }) => {
        return rule.state;
      }),
    ).toEqual([CloudflareRuleState.Enforcing, CloudflareRuleState.Enforcing]);
  });

  test("the mechanisms chosen at setup stay, whatever room appears since", async () => {
    api = new CloudflareBlockingFakeApi([zone(ZONE_A, "example.com", FREE)]);
    api.addCustomerList("office");
    const onAccessRules: CloudflareBlockingStatus = await blocking().setUp({
      previous: null,
    });
    // The customer deletes their list: a list would fit now.
    api.lists = [];

    const checked: CloudflareBlockingStatus =
      await blocking().check(onAccessRules);

    expect(actionOf(checked, SecurityBlockAction.Block).choice.mechanism).toBe(
      CloudflareBlockingMechanism.AccessRules,
    );
  });
});

describe("taking it all away", () => {
  test("removes OneUptime's rules, items, lists and IP Access Rules, and nothing of the customer's", async () => {
    const customersRule: FakeRule = api.addCustomerRule(ZONE_A, {
      action: "skip",
      expression: "(ip.src in {203.0.113.7})",
    });
    const customersList: FakeList = api.addCustomerList("office", [
      "198.51.100.7",
    ]);
    api.accessRules.push({
      id: api.id("x0"),
      mode: "block",
      notes: "Scraper we saw in March",
      target: "ip",
      value: "192.0.2.200",
    });

    const status: CloudflareBlockingStatus = await blocking().setUp({
      previous: null,
    });
    await blocking().add(
      [
        entry("35.205.11.131"),
        entry("203.0.113.8", SecurityBlockAction.Challenge),
      ],
      status,
    );
    // One left from when the account had no list to spare.
    api.accessRules.push({
      id: api.id("o0"),
      mode: "managed_challenge",
      notes: "OneUptime case CASE-7 until 2026-11-22 10:42 UTC",
      target: "ip",
      value: "203.0.113.50",
    });

    expect(api.listNamed("oneuptime_block")!.items).toHaveLength(1);
    expect(api.listNamed("oneuptime_challenge")!.items).toHaveLength(1);
    expect(api.accessRules).toHaveLength(2);

    const removal: { isDone: boolean; left: number; keptLists: Array<string> } =
      await blocking().tearDown({ previous: status, budgetInMs: 60000 });

    expect(removal).toEqual({ isDone: true, left: 0, keptLists: [] });
    expect(api.listNamed("oneuptime_block")).toBeUndefined();
    expect(api.listNamed("oneuptime_challenge")).toBeUndefined();
    expect(api.lists).toEqual([customersList]);
    expect(api.rulesets.get(ZONE_A)!.rules).toEqual([customersRule]);
    expect(api.rulesets.get(ZONE_B)!.rules).toEqual([]);
    expect(
      api.accessRules.map((rule: { notes: string }): string => {
        return rule.notes;
      }),
    ).toEqual(["Scraper we saw in March"]);
    expect(api.replacements).toEqual([]);
  });

  test("a list someone added an address to by hand is left, and said to be", async () => {
    const status: CloudflareBlockingStatus = await blocking().setUp({
      previous: null,
    });
    await blocking().add([entry("35.205.11.131")], status);
    api.listNamed("oneuptime_block")!.items.push({
      id: api.id("h0"),
      ip: "192.0.2.99",
      comment: "Added by hand",
    });

    const removal: { isDone: boolean; left: number; keptLists: Array<string> } =
      await blocking().tearDown({ previous: status, budgetInMs: 60000 });

    expect(removal.keptLists).toEqual(["oneuptime_block"]);
    expect(
      api.listNamed("oneuptime_block")!.items.map((item: { ip: string }) => {
        return item.ip;
      }),
    ).toEqual(["192.0.2.99"]);
    // Its rules are OneUptime's, and go.
    expect(api.rulesets.get(ZONE_A)!.rules).toEqual([]);
  });

  test("many IP Access Rules are taken away across passes, within each pass's budget", async () => {
    api = new CloudflareBlockingFakeApi([zone(ZONE_A, "example.com", FREE)]);
    api.addCustomerList("office");
    const status: CloudflareBlockingStatus = await blocking().setUp({
      previous: null,
    });

    for (let index: number = 0; index < 5; index++) {
      api.accessRules.push({
        id: api.id("o0"),
        mode: "block",
        notes: "OneUptime case CASE-1 until lifted",
        target: "ip",
        value: `203.0.113.${index + 1}`,
      });
    }

    // Each request takes a second of the budget: two fit in the pass.
    const transport: ReturnType<typeof api.transport> = api.transport();
    const slow: CloudflareBlocking = new CloudflareBlocking({
      client: new CloudflareClient({
        apiToken: TOKEN,
        transport: async (
          request: DataSourceHttpRequest,
        ): Promise<DataSourceHttpResponse> => {
          clock += 1000;
          return transport(request);
        },
        requestTimeoutInMs: 20000,
      }),
      scope: {
        projectId: PROJECT_ID,
        accountId: ACCOUNT_ID,
        readZoneIds: [],
        blockZoneIds: [],
      },
      now: (): Date => {
        return new Date(clock);
      },
    });

    const first: { isDone: boolean; left: number } = await slow.tearDown({
      previous: status,
      budgetInMs: 6000,
    });

    expect(first.isDone).toBe(false);
    expect(first.left).toBeGreaterThan(0);
    expect(api.accessRules.length).toBe(first.left);

    const second: { isDone: boolean; left: number } = await slow.tearDown({
      previous: status,
      budgetInMs: 60000,
    });

    expect(second).toEqual(expect.objectContaining({ isDone: true, left: 0 }));
    expect(api.accessRules).toEqual([]);
  });
});

describe("whether the token may write: asked without writing", () => {
  function checkNamed(
    checks: Array<SecurityConnectorCheck>,
    key: string,
  ): SecurityConnectorCheck | undefined {
    return checks.find((check: SecurityConnectorCheck): boolean => {
      return check.key === key;
    });
  }

  test("with every permission, each check passes, and nothing is made", async () => {
    const { checks } = await blocking().checkWriteAccess();

    expect(
      checks.map((check: SecurityConnectorCheck): string => {
        return `${check.key}:${check.status}`;
      }),
    ).toEqual([
      "blocking-setup:pass",
      "blocking-lists:pass",
      "blocking-rules:pass",
    ]);
    expect(checkNamed(checks, "blocking-setup")?.message).toBe(
      "Blocks go to the list oneuptime_block, with a custom rule in each zone. Challenges go to the list oneuptime_challenge, with a custom rule in each zone.",
    );
    // Probes ask for nothing a write can come of.
    expect(api.lists).toEqual([]);
    expect(api.rulesets.size).toBe(0);
    expect(api.accessRules).toEqual([]);
  });

  test("a token without Account Filter Lists Edit fails its check, naming the permission", async () => {
    // It reads the lists (Read), and may not write them.
    api.script({
      matches: (request: FakeRequest): boolean => {
        return (
          request.method === "POST" && request.path.endsWith("/rules/lists")
        );
      },
      response: restError(403, 10000, "Authentication error"),
      times: 1,
    });

    const { checks } = await blocking().checkWriteAccess();

    expect(checkNamed(checks, "blocking-lists")).toEqual(
      expect.objectContaining({
        status: "fail",
        message: "The API token lacks Account > Account Filter Lists > Edit.",
        remediation:
          "Edit the token in Cloudflare and add Account > Account Filter Lists > Edit, or paste a new token that has it.",
      }),
    );
  });

  test("a token without Zone WAF Edit on one zone fails, naming the zone", async () => {
    api.script({
      matches: (request: FakeRequest): boolean => {
        return (
          request.method === "POST" &&
          request.path.includes(`/zones/${ZONE_B}/rulesets`)
        );
      },
      response: restError(403, 10000, "Authentication error"),
      times: 1,
    });

    const { checks } = await blocking().checkWriteAccess();

    expect(checkNamed(checks, "blocking-rules")).toEqual(
      expect.objectContaining({
        status: "fail",
        message:
          "The API token cannot change the custom rules of shop.example.com: it lacks Zone > Zone WAF > Edit there.",
      }),
    );
  });

  test("on a plan that needs IP Access Rules, their permission is checked too", async () => {
    api = new CloudflareBlockingFakeApi([zone(ZONE_A, "example.com", FREE)]);
    api.permissions.delete("accessRules");

    const { checks } = await blocking().checkWriteAccess();

    expect(checkNamed(checks, "blocking-access-rules")).toEqual(
      expect.objectContaining({
        status: "fail",
        message:
          "The API token lacks Account > Account Firewall Access Rules > Edit.",
      }),
    );
  });

  test("a check Cloudflare could not answer says it cannot tell, and never passes", async () => {
    api.script({
      matches: (request: FakeRequest): boolean => {
        return (
          request.method === "POST" && request.path.endsWith("/rules/lists")
        );
      },
      response: json(503, {
        success: false,
        errors: [{ code: 1, message: "Service Unavailable" }],
      }),
      times: 10,
    });

    const { checks } = await blocking().checkWriteAccess();

    expect(checkNamed(checks, "blocking-lists")?.status).toBe("warn");
    expect(checkNamed(checks, "blocking-lists")?.message).toContain(
      "OneUptime could not tell whether the API token has Account > Account Filter Lists > Edit",
    );
  });

  test("a list another project made fails the setup check before anything is turned on", async () => {
    api.lists.push({
      id: api.id("d0"),
      name: "oneuptime_challenge",
      description: getCloudflareBlockListDescription(OTHER_PROJECT_ID),
      kind: "ip",
      items: [],
    });

    const { checks } = await blocking().checkWriteAccess();

    expect(checkNamed(checks, "blocking-setup")?.status).toBe("fail");
  });

  test("each rule written is the one OneUptime expects to read back", () => {
    for (const action of [
      SecurityBlockAction.Block,
      SecurityBlockAction.Challenge,
    ]) {
      expect(getCloudflareRuleInput(action)).toEqual({
        ref: CLOUDFLARE_BLOCK_RULE_REFS[action],
        action:
          action === SecurityBlockAction.Block ? "block" : "managed_challenge",
        expression: `(ip.src in $${CLOUDFLARE_BLOCK_LIST_NAMES[action]})`,
        description: CLOUDFLARE_BLOCK_RULE_DESCRIPTION,
        enabled: true,
      });
    }
  });
});
