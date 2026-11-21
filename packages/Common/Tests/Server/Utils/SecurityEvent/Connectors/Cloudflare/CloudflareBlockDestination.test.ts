import SecurityBlock from "../../../../../../Models/DatabaseModels/SecurityBlock";
import SecurityBlockEnforcement from "../../../../../../Models/DatabaseModels/SecurityBlockEnforcement";
import SecurityCase from "../../../../../../Models/DatabaseModels/SecurityCase";
import BaseModel from "../../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "../../../../../../Server/Services/DatabaseService";
import SecurityBlockEnforcementService from "../../../../../../Server/Services/SecurityBlockEnforcementService";
import SecurityBlockService from "../../../../../../Server/Services/SecurityBlockService";
import SecurityCaseFeedService from "../../../../../../Server/Services/SecurityCaseFeedService";
import SecurityEventConnectionService from "../../../../../../Server/Services/SecurityEventConnectionService";
import SecurityProtectedEntityService from "../../../../../../Server/Services/SecurityProtectedEntityService";
import SecurityProtectedEntity from "../../../../../../Models/DatabaseModels/SecurityProtectedEntity";
import CloudflareBlockDestinations, {
  CLOUDFLARE_BLOCKING_CHECK_INTERVAL_IN_MS,
  CloudflareBlockDestination,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Cloudflare/CloudflareBlockDestination";
import CloudflareConnector from "../../../../../../Server/Utils/SecurityEvent/Connectors/Cloudflare/CloudflareConnector";
import {
  ConnectorTestResult,
  SecurityConnectorSettings,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import SecurityBlockDestinations from "../../../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestinations";
import SecurityBlocklistReconciler from "../../../../../../Server/Utils/SecurityBlocklist/SecurityBlocklistReconciler";
import { JSONObject } from "../../../../../../Types/JSON";
import ObjectID from "../../../../../../Types/ObjectID";
import { SecurityConnectorCheck } from "../../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import SecurityEventConnectorProvider from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  CLOUDFLARE_BLOCK_RULE_REFS,
  CloudflareBlockingStatus,
  CloudflareRuleState,
  readCloudflareBlockingStatus,
} from "../../../../../../Types/SecurityBlocklist/CloudflareBlocking";
import {
  SecurityBlockAction,
  SecurityBlockSource,
  SecurityBlockState,
  SecurityBlockValue,
  readSecurityBlockValue,
} from "../../../../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityBlockDestinationProvider,
  SecurityBlockEnforcementState,
} from "../../../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import InMemoryLocks from "../../../../TestingUtils/InMemoryLocks";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../../../../TestingUtils/InMemoryRepository";
import CloudflareBlockingFakeApi, {
  FakeRule,
} from "./CloudflareBlockingFakeApi";
import {
  ACCOUNT_ID,
  FakeRequest,
  TOKEN,
  ZONE_A,
  ZONE_B,
  restError,
} from "./CloudflareFakeApi";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// A destination that is down is logged as it is reported; the tests read the rows instead.
jest.mock("../../../../../../Server/Utils/Logger");

/*
 * THE BLOCKLIST ENFORCED AT CLOUDFLARE (#10343), end to end but for the
 * database and Cloudflare: the reconciler (#10338) drives the Cloudflare
 * destination of a connection with blocking on, which calls Cloudflare's API
 * as it answers (CloudflareBlockingFakeApi). The project's blocks, their
 * enforcement rows and the connection are held in memory behind the services
 * the reconciler and the destination read and write, and each pass is made at
 * a moment the test names.
 *
 * What is pinned: a block made from a case is in oneuptime_block and Applied
 * within one pass, its chip says Cloudflare, and its case hears it; a lifted
 * one leaves the list; an item removed by hand comes back; a rule turned off
 * at Cloudflare makes every block there say so, and its case hears it once,
 * until Put It Back; Cloudflare's rate limit and a missing permission say why
 * on each block; turning blocking off takes away everything OneUptime added
 * when asked, and nothing when not.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10343000-0000-4000-8000-0000000000aa",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "10343000-0000-4000-8000-0000000000cc",
);
const CASE_ID: ObjectID = new ObjectID("10343000-0000-4000-8000-0000000000ca");
const CASE_NUMBER: string = "CASE-42";

const NOW: Date = new Date("2026-11-21T10:42:00.000Z");
const MINUTE: number = 60 * 1000;
const DAY: number = 24 * 60 * MINUTE;

function at(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * MINUTE);
}

function blockId(index: number): ObjectID {
  return new ObjectID(
    `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, "0")}`,
  );
}

function sameId(left: unknown, right: unknown): boolean {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

let api: CloudflareBlockingFakeApi;
let connections: InMemoryTable;
let blocks: Map<string, SecurityBlock>;
let rows: Map<string, SecurityBlockEnforcement>;
let rowsCreated: number;
let feedItems: Array<JSONObject>;
let locks: InMemoryLocks;
let clock: number;

function connectionRow(blockingSettings: JSONObject): StoredRow {
  return {
    _id: CONNECTION_ID.toString(),
    projectId: PROJECT_ID.toString(),
    name: "Production Cloudflare",
    provider: SecurityEventConnectorProvider.Cloudflare,
    config: { accountId: ACCOUNT_ID },
    secrets: JSON.stringify({ apiToken: TOKEN }),
    alertingOnly: true,
    isEnabled: true,
    blockingSettings,
    blockingStatus: null,
  };
}

function setBlocking(blockingSettings: JSONObject): void {
  connections.rows[0]!["blockingSettings"] = blockingSettings;
}

function storedStatus(): CloudflareBlockingStatus {
  return readCloudflareBlockingStatus(connections.rows[0]!["blockingStatus"])!;
}

function addBlock(data: {
  index: number;
  value: string;
  action?: SecurityBlockAction | undefined;
  hasCase?: boolean | undefined;
}): SecurityBlock {
  const read: SecurityBlockValue = readSecurityBlockValue(data.value)!;
  const block: SecurityBlock = new SecurityBlock();

  block._id = blockId(data.index).toString();
  block.projectId = PROJECT_ID;
  block.value = read.value;
  block.indicatorType = read.indicatorType;
  block.action = data.action || SecurityBlockAction.Block;
  block.state = SecurityBlockState.Active;
  block.source = SecurityBlockSource.Person;
  block.createdAt = at(data.index);
  block.expiresAt = new Date(at(data.index).getTime() + DAY);

  if (data.hasCase) {
    const securityCase: SecurityCase = new SecurityCase();
    securityCase._id = CASE_ID.toString();
    securityCase.caseNumberWithPrefix = CASE_NUMBER;
    block.securityCaseId = CASE_ID;
    block.securityCase = securityCase;
  }

  blocks.set(block.id!.toString(), block);

  return block;
}

function rowOf(index: number): SecurityBlockEnforcement | undefined {
  return Array.from(rows.values()).find(
    (row: SecurityBlockEnforcement): boolean => {
      return sameId(row.securityBlockId, blockId(index));
    },
  );
}

async function pass(minutes: number): Promise<void> {
  clock = at(minutes).getTime();
  await SecurityBlocklistReconciler.reconcileProject({
    projectId: PROJECT_ID,
    now: at(minutes),
  });
}

function timelineLines(): Array<string> {
  return feedItems.map((item: JSONObject): string => {
    return String(item["feedInfoInMarkdown"] || "");
  });
}

function oneUptimeBlockRule(zoneId: string): FakeRule {
  return api.ruleWithRef(
    zoneId,
    CLOUDFLARE_BLOCK_RULE_REFS[SecurityBlockAction.Block],
  )!;
}

beforeEach(() => {
  clock = NOW.getTime();
  api = new CloudflareBlockingFakeApi([
    {
      id: ZONE_A,
      name: "example.com",
      plan: { name: "Pro Website", legacy_id: "pro" },
    },
    {
      id: ZONE_B,
      name: "shop.example.com",
      plan: { name: "Pro Website", legacy_id: "pro" },
    },
  ]);
  api.operationPolls = 0;

  CloudflareBlockDestinations.setOptionsForTests({
    transport: api.transport(),
    sleep: async (): Promise<void> => {
      return undefined;
    },
    now: (): Date => {
      return new Date(clock);
    },
  });
  SecurityBlockDestinations.resetSourcesForTests();

  connections = useInMemoryTable(
    SecurityEventConnectionService as unknown as DatabaseService<BaseModel>,
    [
      connectionRow({
        isEnabled: true,
        zoneIds: [],
        turnedOnAt: at(-1).toISOString(),
        setupRequestedAt: at(-1).toISOString(),
      }),
    ],
  );

  blocks = new Map();
  rows = new Map();
  rowsCreated = 0;
  feedItems = [];
  locks = new InMemoryLocks();
  locks.install();

  jest.spyOn(SecurityBlockService, "findBy").mockImplementation((async (
    args: unknown,
  ): Promise<Array<SecurityBlock>> => {
    const query: JSONObject = (args as { query: JSONObject }).query;

    return Array.from(blocks.values())
      .filter((block: SecurityBlock): boolean => {
        return (
          sameId(block.projectId, query["projectId"]) &&
          (query["state"] === undefined || block.state === query["state"])
        );
      })
      .map((block: SecurityBlock): SecurityBlock => {
        return Object.assign(new SecurityBlock(), block);
      });
  }) as never);

  jest.spyOn(SecurityBlockService, "findByIds").mockImplementation((async (
    args: unknown,
  ): Promise<Array<SecurityBlock>> => {
    return (args as { ids: Array<ObjectID> }).ids
      .map((id: ObjectID): SecurityBlock | undefined => {
        return blocks.get(id.toString());
      })
      .filter((block: SecurityBlock | undefined): block is SecurityBlock => {
        return Boolean(block);
      })
      .map((block: SecurityBlock): SecurityBlock => {
        return Object.assign(new SecurityBlock(), block);
      });
  }) as never);

  jest
    .spyOn(SecurityBlockEnforcementService, "findForReconcile")
    .mockImplementation((async (
      args: unknown,
    ): Promise<Array<SecurityBlockEnforcement>> => {
      const data: { activeBlockIds: Array<ObjectID> } = args as {
        activeBlockIds: Array<ObjectID>;
      };

      return Array.from(rows.values())
        .filter((row: SecurityBlockEnforcement): boolean => {
          return (
            row.state !== SecurityBlockEnforcementState.Removed ||
            data.activeBlockIds.some((id: ObjectID): boolean => {
              return sameId(id, row.securityBlockId);
            })
          );
        })
        .map((row: SecurityBlockEnforcement): SecurityBlockEnforcement => {
          return Object.assign(new SecurityBlockEnforcement(), row);
        });
    }) as never);

  jest
    .spyOn(SecurityBlockEnforcementService, "create")
    .mockImplementation((async (
      args: unknown,
    ): Promise<SecurityBlockEnforcement> => {
      const row: SecurityBlockEnforcement = Object.assign(
        new SecurityBlockEnforcement(),
        (args as { data: SecurityBlockEnforcement }).data,
      );
      rowsCreated++;
      row._id = `eeeeeeee-eeee-4eee-8eee-${String(rowsCreated).padStart(12, "0")}`;
      rows.set(row._id, row);
      return row;
    }) as never);

  jest
    .spyOn(SecurityBlockEnforcementService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (args: unknown): Promise<void> => {
      const data: { id: ObjectID; data: JSONObject } = args as {
        id: ObjectID;
        data: JSONObject;
      };
      const row: SecurityBlockEnforcement | undefined = rows.get(
        data.id.toString(),
      );

      if (row) {
        Object.assign(row, data.data);
      }
    }) as never);

  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockImplementation((async (args: unknown): Promise<void> => {
      feedItems.push(args as JSONObject);
    }) as never);
});

afterEach(() => {
  CloudflareBlockDestinations.setOptionsForTests(null);
  SecurityBlockDestinations.resetSourcesForTests();
  jest.restoreAllMocks();
});

describe("a block made from a case, with blocking on", () => {
  test("is in oneuptime_block and Applied within one pass, enforced at Cloudflare, and its case hears it", async () => {
    addBlock({ index: 1, value: "35.205.11.131", hasCase: true });

    await pass(2);

    const row: SecurityBlockEnforcement = rowOf(1)!;
    expect(row.state).toBe(SecurityBlockEnforcementState.Applied);
    expect(row.destinationName).toBe("Cloudflare");
    expect(row.destinationKey).toBe(`Cloudflare:${CONNECTION_ID.toString()}`);
    expect(row.provider).toBe(SecurityBlockDestinationProvider.Cloudflare);
    expect(row.connectionId?.toString()).toBe(CONNECTION_ID.toString());
    expect(row.lastConfirmedAt).toEqual(at(2));
    expect(row.providerRef).toBe(
      api.listNamed("oneuptime_block")!.items[0]!.id,
    );

    expect(api.listNamed("oneuptime_block")!.items).toEqual([
      expect.objectContaining({
        ip: "35.205.11.131",
        comment: "OneUptime case CASE-42 until 2026-11-22 10:43 UTC",
      }),
    ]);
    // Set up on the same pass: the lists, and a rule in each zone.
    expect(oneUptimeBlockRule(ZONE_A).enabled).toBe(true);
    expect(oneUptimeBlockRule(ZONE_B).enabled).toBe(true);

    expect(timelineLines()).toEqual([
      "🛡️ The block on `35.205.11.131` is enforced at Cloudflare.",
    ]);

    // What OneUptime found is kept on the connection.
    const status: CloudflareBlockingStatus = storedStatus();
    expect(status.setupDoneFor).toBe(at(-1).toISOString());
    expect(status.usage).toEqual({ items: 1, limit: 10000 });
  });

  test("blocking turned on with nothing blocked yet: the pass sets Cloudflare up all the same", async () => {
    await pass(0);

    expect(api.listNamed("oneuptime_block")).toBeDefined();
    expect(api.listNamed("oneuptime_challenge")).toBeDefined();
    expect(oneUptimeBlockRule(ZONE_A)).toBeDefined();
    expect(storedStatus().setupDoneFor).toBe(at(-1).toISOString());
    expect(rows.size).toBe(0);
  });

  test("a lifted block leaves the list within one pass, and its row says Removed", async () => {
    addBlock({ index: 1, value: "35.205.11.131" });
    await pass(2);

    blocks.get(blockId(1).toString())!.state = SecurityBlockState.Lifted;
    await pass(3);

    expect(api.listNamed("oneuptime_block")!.items).toEqual([]);
    expect(rowOf(1)?.state).toBe(SecurityBlockEnforcementState.Removed);
  });

  test("an item removed at Cloudflare by hand is put back on the next pass", async () => {
    addBlock({ index: 1, value: "35.205.11.131" });
    await pass(2);

    api.listNamed("oneuptime_block")!.items = [];
    await pass(3);

    expect(
      api.listNamed("oneuptime_block")!.items.map((item: { ip: string }) => {
        return item.ip;
      }),
    ).toEqual(["35.205.11.131"]);
    expect(rowOf(1)?.state).toBe(SecurityBlockEnforcementState.Applied);
  });

  test("a challenge goes to oneuptime_challenge", async () => {
    addBlock({
      index: 1,
      value: "2001:db8::7",
      action: SecurityBlockAction.Challenge,
    });

    await pass(2);

    expect(api.listNamed("oneuptime_challenge")!.items).toEqual([
      expect.objectContaining({ ip: "2001:db8::7" }),
    ]);
    expect(rowOf(1)?.state).toBe(SecurityBlockEnforcementState.Applied);
  });

  test("a block that does not fit says the lists are full, and the oldest keeps its place", async () => {
    api.addCustomerList(
      "office",
      Array.from({ length: 9999 }, (_: unknown, index: number): string => {
        return `10.1.${Math.floor(index / 256)}.${index % 256}`;
      }),
    );
    addBlock({ index: 1, value: "35.205.11.131" });
    addBlock({ index: 2, value: "35.205.11.132" });

    await pass(3);

    expect(rowOf(1)?.state).toBe(SecurityBlockEnforcementState.Applied);
    expect(rowOf(2)?.state).toBe(SecurityBlockEnforcementState.Failed);
    expect(rowOf(2)?.error).toBe(
      "Not applied: Cloudflare's lists are full: your plan holds 10,000 list items, and your own lists use 9,999",
    );
  });
});

describe("drift: a rule turned off at Cloudflare", () => {
  beforeEach(async () => {
    addBlock({ index: 1, value: "35.205.11.131", hasCase: true });
    await pass(2);
    feedItems = [];
    oneUptimeBlockRule(ZONE_A).enabled = false;
  });

  test("within a few minutes, every active block's Cloudflare enforcement says so, and its case hears it once", async () => {
    // A minute later the setup is not read again yet.
    await pass(3);
    expect(rowOf(1)?.state).toBe(SecurityBlockEnforcementState.Applied);

    await pass(2 + CLOUDFLARE_BLOCKING_CHECK_INTERVAL_IN_MS / MINUTE);

    expect(rowOf(1)?.state).toBe(SecurityBlockEnforcementState.Failed);
    expect(rowOf(1)?.error).toBe(
      "Your rule in example.com was turned off: blocks there are not enforced",
    );
    expect(timelineLines()).toEqual([
      "⚠️ The block on `35.205.11.131` is not enforced at Cloudflare. Your rule in example.com was turned off: blocks there are not enforced",
    ]);

    // The connection says the same.
    expect(
      storedStatus()
        .zones.find((zone: { id: string }): boolean => {
          return zone.id === ZONE_A;
        })
        ?.rules.find((rule: { action: string }): boolean => {
          return rule.action === SecurityBlockAction.Block;
        })?.state,
    ).toBe(CloudflareRuleState.TurnedOff);

    // Nothing was put back behind the person's back, and the case heard it once.
    await pass(10);
    expect(oneUptimeBlockRule(ZONE_A).enabled).toBe(false);
    expect(timelineLines()).toHaveLength(1);
  });

  test("Put It Back turns the rule on again, and the block is enforced once more", async () => {
    await pass(6);
    expect(rowOf(1)?.state).toBe(SecurityBlockEnforcementState.Failed);

    setBlocking({
      isEnabled: true,
      zoneIds: [],
      setupRequestedAt: at(7).toISOString(),
      setupZoneIds: [ZONE_A],
    });
    await pass(7);

    expect(oneUptimeBlockRule(ZONE_A).enabled).toBe(true);
    expect(rowOf(1)?.state).toBe(SecurityBlockEnforcementState.Applied);
    expect(rowOf(1)?.error || null).toBeNull();
    expect(storedStatus().setupDoneFor).toBe(at(7).toISOString());
  });
});

describe("when Cloudflare refuses", () => {
  test("its rate limit stops the write: each block says why, and waits its retry", async () => {
    addBlock({ index: 1, value: "35.205.11.131" });
    api.script({
      matches: (request: FakeRequest): boolean => {
        return request.method === "POST" && request.path.endsWith("/items");
      },
      response: restError(
        429,
        971,
        "Please wait and consider throttling your request speed",
        { "retry-after": "300" },
      ),
      times: 5,
    });

    await pass(2);

    expect(rowOf(1)?.state).toBe(SecurityBlockEnforcementState.Pending);
    expect(rowOf(1)?.error).toContain("Could not write to Cloudflare");
    expect(rowOf(1)?.error).toContain("HTTP 429");
    expect(rowOf(1)?.retryAt).toEqual(at(3));
  });

  test("a token that cannot change the lists: each block says which permission is missing, and so does the connection", async () => {
    api.permissions.delete("lists");
    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(2);

    expect(rowOf(1)?.state).toBe(SecurityBlockEnforcementState.Pending);
    expect(rowOf(1)?.error).toContain(
      "Cloudflare is not ready to hold blocks: The API token cannot read the account's lists: give it Account > Account Filter Lists > Edit.",
    );
    expect(
      (connections.rows[0]!["blockingStatus"] as JSONObject)["error"],
    ).toContain("give it Account > Account Filter Lists > Edit");
  });
});

describe("turning blocking off", () => {
  beforeEach(async () => {
    addBlock({ index: 1, value: "35.205.11.131" });
    await pass(2);
    expect(api.listNamed("oneuptime_block")!.items).toHaveLength(1);
  });

  test("with removal asked: the next pass takes away everything OneUptime added, and the block is no longer enforced there", async () => {
    setBlocking({
      isEnabled: false,
      zoneIds: [],
      removalRequestedAt: at(3).toISOString(),
    });

    await pass(4);

    expect(rowOf(1)?.state).toBe(SecurityBlockEnforcementState.Removed);
    expect(rowOf(1)?.error).toBe(
      "Cloudflare no longer enforces the blocklist.",
    );
    expect(api.lists).toEqual([]);
    expect(api.rulesets.get(ZONE_A)!.rules).toEqual([]);
    expect(api.rulesets.get(ZONE_B)!.rules).toEqual([]);
    expect(
      (connections.rows[0]!["blockingStatus"] as JSONObject)["removalDoneFor"],
    ).toBe(at(3).toISOString());

    // Done is done: a later pass takes nothing more.
    const requests: number = api.requests.length;
    await pass(6);
    expect(api.requests.length).toBe(requests);
  });

  test("keeping them: nothing is taken away from Cloudflare", async () => {
    setBlocking({ isEnabled: false, zoneIds: [] });

    await pass(4);

    expect(rowOf(1)?.state).toBe(SecurityBlockEnforcementState.Removed);
    expect(api.listNamed("oneuptime_block")!.items).toHaveLength(1);
    expect(oneUptimeBlockRule(ZONE_A)).toBeDefined();
  });

  test("a removal that fails is tried again later, and says why", async () => {
    setBlocking({
      isEnabled: false,
      zoneIds: [],
      removalRequestedAt: at(3).toISOString(),
    });
    api.permissions.delete("waf");

    await pass(4);

    expect(
      (connections.rows[0]!["blockingStatus"] as JSONObject)["error"],
    ).toContain(
      "OneUptime could not take its lists and rules away from Cloudflare yet",
    );
    expect(api.listNamed("oneuptime_block")).toBeDefined();

    // Waits its retry, then tries again.
    api.permissions.add("waf");
    await pass(5);
    expect(api.listNamed("oneuptime_block")).toBeDefined();

    await pass(10);
    expect(api.lists).toEqual([]);
  });
});

describe("the zones' skip rules", () => {
  test("the addresses they let through are offered to protect, but not those a Protected Entity already holds", async () => {
    api.addCustomerRule(ZONE_A, {
      action: "skip",
      expression: "(ip.src in {203.0.113.7 198.51.100.0/24})",
    });

    const protectedEntity: SecurityProtectedEntity =
      new SecurityProtectedEntity();
    protectedEntity._id = "10343000-0000-4000-8000-0000000000ef";
    protectedEntity.value = "203.0.113.0/24";
    protectedEntity.description = "Office";
    jest
      .spyOn(SecurityProtectedEntityService, "findBy")
      .mockResolvedValue([protectedEntity]);

    await pass(0);

    expect(
      storedStatus().zones.find((zone: { id: string }): boolean => {
        return zone.id === ZONE_A;
      })?.skipAddresses,
    ).toEqual(["198.51.100.0/24"]);
  });

  test("when the protected list cannot be read, every one is offered still", async () => {
    api.addCustomerRule(ZONE_A, {
      action: "skip",
      expression: "(ip.src eq 203.0.113.7)",
    });
    jest
      .spyOn(SecurityProtectedEntityService, "findBy")
      .mockRejectedValue(new Error("database is down"));

    await pass(0);

    expect(
      storedStatus().zones.find((zone: { id: string }): boolean => {
        return zone.id === ZONE_A;
      })?.skipAddresses,
    ).toEqual(["203.0.113.7"]);
  });
});

describe("the destinations of a project", () => {
  test("one a Cloudflare connection with blocking on, named with the connection when there are two, locked by the account", async () => {
    connections.rows.push({
      ...connectionRow({ isEnabled: true, zoneIds: [ZONE_B] }),
      _id: "10343000-0000-4000-8000-0000000000dd",
      name: "Shop",
    });
    // A connection that only reads is no destination.
    connections.rows.push({
      ...connectionRow({ isEnabled: false, zoneIds: [] }),
      _id: "10343000-0000-4000-8000-0000000000ee",
      name: "Reads only",
    });

    const found: Array<CloudflareBlockDestination> =
      await CloudflareBlockDestinations.findForProject(PROJECT_ID);

    expect(
      found.map((destination: CloudflareBlockDestination): string => {
        return destination.name;
      }),
    ).toEqual(["Cloudflare (Production Cloudflare)", "Cloudflare (Shop)"]);
    // Both write the same account's lists: one lock between them.
    expect(found[0]!.lockKey).toBe(`Cloudflare:account:${ACCOUNT_ID}`);
    expect(found[1]!.lockKey).toBe(found[0]!.lockKey);
    expect(found[0]!.key).not.toBe(found[1]!.key);
  });

  test("the projects with Cloudflare blocking work are found in one read of the connections", async () => {
    const asked: Array<[string, Array<unknown>]> = [];

    jest
      .spyOn(SecurityEventConnectionService, "getRepository")
      .mockReturnValue({
        manager: {
          query: async (
            sql: string,
            parameters: Array<unknown>,
          ): Promise<Array<JSONObject>> => {
            asked.push([sql, parameters]);
            return [
              { projectId: PROJECT_ID.toString() },
              { projectId: "not-an-id" },
            ];
          },
        },
      } as never);

    const found: Array<ObjectID> =
      await CloudflareBlockDestinations.findProjectIdsWithWork(1000);

    expect(
      found.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([PROJECT_ID.toString()]);

    const [sql, parameters] = asked[0]!;
    expect(parameters).toEqual([
      SecurityEventConnectorProvider.Cloudflare,
      1000,
    ]);
    expect(sql).toContain(`"blockingSettings"->>'isEnabled' = 'true'`);
    expect(sql).toContain(`"blockingSettings"->>'removalRequestedAt'`);
    expect(sql).toContain(`"deletedAt" IS NULL`);
  });
});

describe("the opt-in: write access is asked for only while blocking is on", () => {
  function settings(blocking: boolean): SecurityConnectorSettings {
    return {
      provider: SecurityEventConnectorProvider.Cloudflare,
      config: { accountId: ACCOUNT_ID },
      secrets: { apiToken: TOKEN },
      alertingOnly: true,
      ...(blocking
        ? { blocking: { projectId: PROJECT_ID.toString(), zoneIds: [] } }
        : {}),
    };
  }

  async function checkKeys(blocking: boolean): Promise<Array<string>> {
    const result: ConnectorTestResult = (await new CloudflareConnector(
      api.transport(),
      {
        sleep: async (): Promise<void> => {
          return undefined;
        },
      },
    ).testConnection(settings(blocking), {
      requestTimeoutInMs: 20000,
      skipAvailability: true,
    })) as ConnectorTestResult;

    return result.checks.map((check: SecurityConnectorCheck): string => {
      return `${check.key}:${check.status}`;
    });
  }

  test("a connection that only reads is never asked for more than its two read permissions", async () => {
    api.permissions.clear();

    expect(await checkKeys(false)).toEqual([
      "authentication:pass",
      "zones:pass",
      "read-permission:pass",
      "plan-limits:pass",
    ]);
    // Not one write, nor one read of what blocking needs.
    expect(
      api.requests.filter((request: FakeRequest): boolean => {
        return (
          request.method !== "GET" ||
          request.path.includes("/rules/") ||
          request.path.includes("/rulesets")
        );
      }),
    ).toEqual([
      expect.objectContaining({ operation: "OneUptimeFirewallEventSettings" }),
    ]);
  });

  test("with blocking on, Test Connection checks the write permissions blocking needs, and names a missing one", async () => {
    expect(await checkKeys(true)).toEqual([
      "authentication:pass",
      "zones:pass",
      "read-permission:pass",
      "plan-limits:pass",
      "blocking-setup:pass",
      "blocking-lists:pass",
      "blocking-rules:pass",
    ]);

    api.script({
      matches: (request: FakeRequest): boolean => {
        return (
          request.method === "POST" &&
          request.path.includes(`/zones/${ZONE_A}/`)
        );
      },
      response: restError(403, 10000, "Authentication error"),
      times: 1,
    });

    expect(await checkKeys(true)).toContain("blocking-rules:fail");
  });
});
