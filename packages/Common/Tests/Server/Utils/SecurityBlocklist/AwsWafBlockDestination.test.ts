import CloudConnection from "../../../../Models/DatabaseModels/CloudConnection";
import SecurityBlock from "../../../../Models/DatabaseModels/SecurityBlock";
import SecurityBlockCloudWaf from "../../../../Models/DatabaseModels/SecurityBlockCloudWaf";
import SecurityBlockEnforcement from "../../../../Models/DatabaseModels/SecurityBlockEnforcement";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import CloudConnectionService from "../../../../Server/Services/CloudConnectionService";
import SecurityBlockCloudWafService from "../../../../Server/Services/SecurityBlockCloudWafService";
import SecurityBlockEnforcementService from "../../../../Server/Services/SecurityBlockEnforcementService";
import SecurityBlockService from "../../../../Server/Services/SecurityBlockService";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import AwsWafBlocklistGroup from "../../../../Server/Utils/CloudConnection/Aws/AwsWafBlocklist";
import { CloudConnectionSettings } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import AwsWafBlockDestination, {
  AwsWafBlockDestinationSource,
} from "../../../../Server/Utils/SecurityBlocklist/AwsWafBlockDestination";
import SecurityBlockDestination from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestination";
import SecurityBlockDestinations from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestinations";
import SecurityBlocklistReconciler, {
  SecurityBlocklistPassResult,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityBlocklistReconciler";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  AwsWafArn,
  AwsWafScope,
  getAwsWafBlocklistRuleNames,
  getAwsWafBlocklistSets,
  parseAwsWafArn,
} from "../../../../Types/CloudConnection/AwsWafBlocklist";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { getAwsExternalIdForProject } from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
  SecurityBlockSource,
  SecurityBlockState,
  SecurityBlockValue,
  readSecurityBlockValue,
} from "../../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityBlockClientAddress,
  SecurityBlockCloudWafStatus,
} from "../../../../Types/SecurityBlocklist/SecurityBlockCloudWaf";
import {
  SecurityBlockDestinationProvider,
  SecurityBlockEnforcementState,
  getSecurityBlockEnforcementSummary,
} from "../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import InMemoryLocks from "../../TestingUtils/InMemoryLocks";
import {
  FAKE_WAF_ACCOUNT_ID,
  FakeAwsWaf,
  FakeWafIpSet,
  FakeWafWebAcl,
  WAF_ERRORS,
  bumpIpSet,
  bumpWebAcl,
  createFakeAwsWaf,
} from "../CloudConnection/FakeAwsWaf";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * THE BLOCKLIST ENFORCED IN AWS WAF (#10344), end to end: the reconciler
 * (SecurityBlocklistReconciler) driving AWS WAF web ACLs as destinations,
 * against AWS WAF as it answers (FakeAwsWaf) - the blocks and their rows
 * held in memory behind the services, each pass made at a moment the test
 * names.
 *
 * What is pinned is the issue's "done when": a block lands in OneUptime's
 * IP set and is Enforced at AWS WAF (prod-alb) within a pass; it expires
 * and lifts cleanly; a forwarded-address web ACL works; a web ACL kept in
 * code waits for its rule and is enforced once it is there. And what keeps
 * it true: drift (an address or the rule taken away at AWS) put back, one
 * write a set a pass, a full set saying so of each block it could not
 * take, no free priority said and never worked around, two web ACLs
 * sharing one region's sets, a destination that cannot be read saying so.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CASE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const EXTERNAL_ID: string = getAwsExternalIdForProject(PROJECT_ID.toString());
const RULES: { block: string; challenge: string } =
  getAwsWafBlocklistRuleNames(EXTERNAL_ID);
const SETS: ReturnType<typeof getAwsWafBlocklistSets> =
  getAwsWafBlocklistSets(EXTERNAL_ID);
const REGION: string = "eu-west-1";

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

function setName(key: string): string {
  return SETS.find((set: { key: string }): boolean => {
    return set.key === key;
  })!.name;
}

// ---------- The project's blocks, rows and web ACLs, as the database holds them ----------

let blocks: Map<string, SecurityBlock>;
let rows: Map<string, SecurityBlockEnforcement>;
let cloudWafWrites: Array<{ id: string; data: JSONObject }>;
let feedItems: Array<JSONObject>;
let locks: InMemoryLocks;
let rowsCreated: number;
let fake: FakeAwsWaf;
let clock: number;

function copy<T extends SecurityBlock | SecurityBlockEnforcement>(
  model: T,
  empty: T,
): T {
  return Object.assign(empty, model);
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
    securityCase.caseNumberWithPrefix = "CASE-42";
    block.securityCaseId = CASE_ID;
    block.securityCase = securityCase;
  }

  blocks.set(block.id!.toString(), block);

  return block;
}

function setState(index: number, state: SecurityBlockState): void {
  blocks.get(blockId(index).toString())!.state = state;
}

function rowOf(
  index: number,
  destination: SecurityBlockDestination,
): SecurityBlockEnforcement | undefined {
  return Array.from(rows.values()).find(
    (row: SecurityBlockEnforcement): boolean => {
      return (
        sameId(row.securityBlockId, blockId(index)) &&
        row.destinationKey === destination.key
      );
    },
  );
}

function stateOf(
  index: number,
  destination: SecurityBlockDestination,
): SecurityBlockEnforcementState | undefined {
  return rowOf(index, destination)?.state as
    | SecurityBlockEnforcementState
    | undefined;
}

function settings(wafBlocklist: string = "rule"): CloudConnectionSettings {
  return {
    provider: CloudProvider.AWS,
    projectId: PROJECT_ID.toString(),
    config: {
      authMethod: CloudConnectionAuthMethod.AwsAccessKey,
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      wafBlocklist,
    },
    secrets: { secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
  };
}

function cloudWafRow(data: {
  index: number;
  acl: FakeWafWebAcl;
  clientAddress?: SecurityBlockClientAddress | undefined;
}): SecurityBlockCloudWaf {
  const row: SecurityBlockCloudWaf = new SecurityBlockCloudWaf();

  row._id = `cccccccc-cccc-4ccc-8ccc-${String(data.index).padStart(12, "0")}`;
  row.projectId = PROJECT_ID;
  row.cloudConnectionId = CONNECTION_ID;
  row.cloudProvider = CloudProvider.AWS;
  row.wafId = data.acl.webAcl["ARN"] as string;
  row.name = data.acl.webAcl["Name"] as string;
  row.region = REGION;
  row.clientAddress = data.clientAddress || SecurityBlockClientAddress.SourceIp;
  row.status = SecurityBlockCloudWafStatus.Checking;

  return row;
}

const groups: Map<string, AwsWafBlocklistGroup> = new Map();

// A destination of a web ACL, its group shared with every other of its account, scope and Region.
function destinationOf(data: {
  row: SecurityBlockCloudWaf;
  addsRule?: boolean | undefined;
}): AwsWafBlockDestination {
  const webAcl: AwsWafArn = parseAwsWafArn(data.row.wafId)!;
  const lockKey: string = AwsWafBlocklistGroup.getLockKey({
    projectId: PROJECT_ID.toString(),
    accountId: webAcl.accountId,
    region: webAcl.region,
    scope: webAcl.scope,
  });
  let group: AwsWafBlocklistGroup | undefined = groups.get(lockKey);

  if (!group) {
    group = new AwsWafBlocklistGroup({
      settings: settings(data.addsRule === false ? "code" : "rule"),
      connectionId: CONNECTION_ID,
      externalId: EXTERNAL_ID,
      accountId: webAcl.accountId,
      region: webAcl.region,
      scope: webAcl.scope,
      options: {
        transport: fake.transport,
        now: (): Date => {
          return new Date(clock);
        },
        sleep: async (milliseconds: number): Promise<void> => {
          clock += milliseconds;
        },
      },
    });
    groups.set(lockKey, group);
  }

  return new AwsWafBlockDestination({
    row: data.row,
    webAcl,
    group,
    addsRule: data.addsRule !== false,
    lockKey,
    now: (): Date => {
      return new Date(clock);
    },
  });
}

// The destinations a pass is given: new ones each pass, as the source makes them.
let makeDestinations: () => Array<SecurityBlockDestination>;

async function pass(minutes: number): Promise<SecurityBlocklistPassResult> {
  clock = at(minutes).getTime();
  groups.clear();

  return await SecurityBlocklistReconciler.reconcileProject({
    projectId: PROJECT_ID,
    now: at(minutes),
  });
}

function ipSet(key: string, region: string = REGION): FakeWafIpSet | undefined {
  return fake.getIpSet(region, "REGIONAL", setName(key));
}

function writesOf(action: string): number {
  return fake.actions().filter((name: string): boolean => {
    return name === action;
  }).length;
}

function customerRule(name: string, priority: number): JSONObject {
  return {
    Name: name,
    Priority: priority,
    Action: { Block: {} },
    Statement: { GeoMatchStatement: { CountryCodes: ["KP"] } },
    VisibilityConfig: {
      SampledRequestsEnabled: true,
      CloudWatchMetricsEnabled: true,
      MetricName: name,
    },
  };
}

beforeEach(() => {
  blocks = new Map();
  rows = new Map();
  cloudWafWrites = [];
  feedItems = [];
  rowsCreated = 0;
  fake = createFakeAwsWaf();
  clock = NOW.getTime();
  groups.clear();

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
      .sort((left: SecurityBlock, right: SecurityBlock): number => {
        return left.createdAt!.getTime() - right.createdAt!.getTime();
      })
      .map((block: SecurityBlock): SecurityBlock => {
        return copy(block, new SecurityBlock());
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
        return copy(block, new SecurityBlock());
      });
  }) as never);

  jest
    .spyOn(SecurityBlockEnforcementService, "findForReconcile")
    .mockImplementation((async (): Promise<Array<SecurityBlockEnforcement>> => {
      return Array.from(rows.values()).map(
        (row: SecurityBlockEnforcement): SecurityBlockEnforcement => {
          return copy(row, new SecurityBlockEnforcement());
        },
      );
    }) as never);

  jest
    .spyOn(SecurityBlockEnforcementService, "create")
    .mockImplementation((async (
      args: unknown,
    ): Promise<SecurityBlockEnforcement> => {
      rowsCreated++;

      const row: SecurityBlockEnforcement = copy(
        (args as { data: SecurityBlockEnforcement }).data,
        new SecurityBlockEnforcement(),
      );

      row._id = `eeeeeeee-eeee-4eee-8eee-${String(rowsCreated).padStart(12, "0")}`;
      rows.set(row._id, row);

      return copy(row, new SecurityBlockEnforcement());
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
    .spyOn(SecurityBlockCloudWafService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (args: unknown): Promise<void> => {
      const data: { id: ObjectID; data: JSONObject } = args as {
        id: ObjectID;
        data: JSONObject;
      };

      cloudWafWrites.push({ id: data.id.toString(), data: data.data });
    }) as never);

  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockImplementation((async (args: unknown): Promise<void> => {
      feedItems.push(args as JSONObject);
    }) as never);

  SecurityBlockDestinations.setSourcesForTests([
    {
      provider: SecurityBlockDestinationProvider.AwsWaf,
      findForProject: async (): Promise<Array<SecurityBlockDestination>> => {
        return makeDestinations();
      },
    },
  ]);
});

afterEach(() => {
  SecurityBlockDestinations.resetSourcesForTests();
  jest.restoreAllMocks();
});

// One regional web ACL, its row, and the destination each pass makes of it.
function enforceIn(
  data: {
    rules?: Array<JSONObject> | undefined;
    addsRule?: boolean | undefined;
    clientAddress?: SecurityBlockClientAddress | undefined;
  } = {},
): { acl: FakeWafWebAcl; row: SecurityBlockCloudWaf; key: string } {
  const acl: FakeWafWebAcl = fake.addWebAcl({
    region: REGION,
    scope: "REGIONAL",
    name: "prod-alb",
    rules: data.rules,
  });
  const row: SecurityBlockCloudWaf = cloudWafRow({
    index: 1,
    acl,
    clientAddress: data.clientAddress,
  });

  makeDestinations = (): Array<SecurityBlockDestination> => {
    return [destinationOf({ row, addsRule: data.addsRule })];
  };

  return { acl, row, key: AwsWafBlockDestination.getKey(row) };
}

function destinationNow(): SecurityBlockDestination {
  return makeDestinations()[0]!;
}

describe("a block from a case", () => {
  test("lands in OneUptime's IP set within a pass, and is Enforced at AWS WAF (prod-alb)", async () => {
    enforceIn({ rules: [customerRule("geo", 10)] });
    addBlock({ index: 1, value: "35.205.11.131", hasCase: true });

    const result: SecurityBlocklistPassResult = await pass(1);

    expect(result).toEqual({ destinations: 1, skipped: 0, failed: 0 });
    expect(ipSet("block-ipv4")!.addresses).toEqual(["35.205.11.131/32"]);

    const row: SecurityBlockEnforcement = rowOf(1, destinationNow())!;

    expect(row.state).toBe(SecurityBlockEnforcementState.Applied);
    expect(row.destinationName).toBe("AWS WAF (prod-alb)");
    expect(row.provider).toBe(SecurityBlockDestinationProvider.AwsWaf);
    expect(row.connectionId?.toString()).toBe(CONNECTION_ID.toString());
    expect(row.providerRef).toBe(setName("block-ipv4"));
    expect(row.lastConfirmedAt).toEqual(at(1));
    expect(getSecurityBlockEnforcementSummary([row], at(1))).toEqual({
      isEnforced: true,
      enforcedAt: ["AWS WAF (prod-alb)"],
      notEnforcedAt: [],
    });

    // OneUptime's rule, below the customer's first, blocking the sets.
    expect(
      fake.getRules(REGION, "REGIONAL", "prod-alb").map((rule: JSONObject) => {
        return [rule["Name"], rule["Priority"]];
      }),
    ).toEqual([
      ["geo", 10],
      [RULES.block, 8],
      [RULES.challenge, 9],
    ]);

    // The case hears it once.
    expect(
      feedItems.filter((item: JSONObject): boolean => {
        return String(item["feedInfoInMarkdown"]).includes(
          "AWS WAF (prod-alb)",
        );
      }),
    ).toHaveLength(1);

    // And the web ACL's row says it is enforcing.
    expect(cloudWafWrites[cloudWafWrites.length - 1]!.data["status"]).toBe(
      SecurityBlockCloudWafStatus.Enforcing,
    );
  });

  test("IPv6 addresses and ranges, and challenges, go to their own sets", async () => {
    enforceIn();
    addBlock({ index: 1, value: "2001:db8::7" });
    addBlock({ index: 2, value: "2001:db8:1::/48" });
    addBlock({
      index: 3,
      value: "198.51.100.0/24",
      action: SecurityBlockAction.Challenge,
    });

    await pass(5);

    expect(ipSet("block-ipv6")!.addresses).toEqual([
      "2001:db8::7/128",
      "2001:db8:1::/48",
    ]);
    expect(ipSet("challenge-ipv4")!.addresses).toEqual(["198.51.100.0/24"]);
    expect(ipSet("block-ipv4")!.addresses).toEqual([]);

    for (const index of [1, 2, 3]) {
      expect(stateOf(index, destinationNow())).toBe(
        SecurityBlockEnforcementState.Applied,
      );
    }
  });

  test("a pass that changes nothing writes nothing to AWS WAF", async () => {
    enforceIn();
    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(1);

    const updates: number = writesOf("UpdateIPSet") + writesOf("UpdateWebACL");

    await pass(2);

    expect(writesOf("UpdateIPSet") + writesOf("UpdateWebACL")).toBe(updates);
    expect(stateOf(1, destinationNow())).toBe(
      SecurityBlockEnforcementState.Applied,
    );
  });
});

describe("a block that ends", () => {
  test("is taken out of the set when it is lifted, and its row says Removed", async () => {
    enforceIn();
    addBlock({ index: 1, value: "35.205.11.131" });
    addBlock({ index: 2, value: "35.205.11.132" });

    await pass(1);
    setState(1, SecurityBlockState.Lifted);
    await pass(2);

    expect(ipSet("block-ipv4")!.addresses).toEqual(["35.205.11.132/32"]);
    expect(stateOf(1, destinationNow())).toBe(
      SecurityBlockEnforcementState.Removed,
    );
    expect(stateOf(2, destinationNow())).toBe(
      SecurityBlockEnforcementState.Applied,
    );
  });

  test("one ending and another beginning in one pass are one write of the set", async () => {
    enforceIn();
    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(1);

    const before: number = writesOf("UpdateIPSet");

    setState(1, SecurityBlockState.Expired);
    addBlock({ index: 2, value: "35.205.11.140" });
    await pass(2);

    expect(writesOf("UpdateIPSet") - before).toBe(1);
    expect(ipSet("block-ipv4")!.addresses).toEqual(["35.205.11.140/32"]);
  });
});

describe("drift", () => {
  test("an address someone took out of the set at AWS is put back on the next pass", async () => {
    enforceIn();
    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(1);
    bumpIpSet(ipSet("block-ipv4")!, []);
    await pass(2);

    expect(ipSet("block-ipv4")!.addresses).toEqual(["35.205.11.131/32"]);
    expect(stateOf(1, destinationNow())).toBe(
      SecurityBlockEnforcementState.Applied,
    );
  });

  test("OneUptime's rule taken out of the web ACL is put back, and the customer's rules are left as they are", async () => {
    const { acl } = enforceIn({ rules: [customerRule("geo", 10)] });

    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(1);
    bumpWebAcl(acl, [customerRule("geo", 10), customerRule("rate", 4)]);
    await pass(2);

    expect(
      fake.getRules(REGION, "REGIONAL", "prod-alb").map((rule: JSONObject) => {
        return [rule["Name"], rule["Priority"]];
      }),
    ).toEqual([
      ["geo", 10],
      ["rate", 4],
      [RULES.block, 2],
      [RULES.challenge, 3],
    ]);
    expect(stateOf(1, destinationNow())).toBe(
      SecurityBlockEnforcementState.Applied,
    );
  });

  test("an address of OneUptime's someone added at AWS that no block wants is taken away; the customer's own sets are never read", async () => {
    enforceIn();
    fake.addIpSet({
      region: REGION,
      scope: "REGIONAL",
      name: "customer-allowlist",
      version: "IPV4",
      addresses: ["203.0.113.0/24"],
    });
    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(1);
    bumpIpSet(ipSet("block-ipv4")!, ["35.205.11.131/32", "198.51.100.9/32"]);
    await pass(2);

    expect(ipSet("block-ipv4")!.addresses).toEqual(["35.205.11.131/32"]);
    expect(
      fake.getIpSet(REGION, "REGIONAL", "customer-allowlist")!.addresses,
    ).toEqual(["203.0.113.0/24"]);
    expect(
      fake.calls.filter((call: { action: string; body: JSONObject }) => {
        return call.body["Name"] === "customer-allowlist";
      }),
    ).toEqual([]);
  });
});

describe("a web ACL behind another proxy or CDN", () => {
  test("blocks by the last X-Forwarded-For address, and is enforced", async () => {
    enforceIn({ clientAddress: SecurityBlockClientAddress.XForwardedFor });
    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(1);

    expect(stateOf(1, destinationNow())).toBe(
      SecurityBlockEnforcementState.Applied,
    );
    expect(
      JSON.stringify(fake.getRules(REGION, "REGIONAL", "prod-alb")),
    ).toContain(
      '"IPSetForwardedIPConfig":{"HeaderName":"X-Forwarded-For","FallbackBehavior":"NO_MATCH","Position":"LAST"}',
    );
  });
});

describe("a web ACL its team keeps in code", () => {
  test("gets OneUptime's sets, and its blocks wait - not enforced - until the team's rule blocks them, then are", async () => {
    const { acl } = enforceIn({ addsRule: false });

    addBlock({ index: 1, value: "35.205.11.131" });

    await pass(1);

    expect(ipSet("block-ipv4")!.addresses).toEqual(["35.205.11.131/32"]);
    expect(writesOf("UpdateWebACL")).toBe(0);
    expect(stateOf(1, destinationNow())).toBe(
      SecurityBlockEnforcementState.Pending,
    );
    expect(
      getSecurityBlockEnforcementSummary([rowOf(1, destinationNow())!], at(1))
        .isEnforced,
    ).toBe(false);
    expect(cloudWafWrites[cloudWafWrites.length - 1]!.data["status"]).toBe(
      SecurityBlockCloudWafStatus.WaitingForRule,
    );

    // The team adds the rule in Terraform, referencing OneUptime's sets.
    const reference: (key: string) => JSONObject = (key: string) => {
      return { IPSetReferenceStatement: { ARN: ipSet(key)!.arn } };
    };

    bumpWebAcl(acl, [
      {
        Name: "oneuptime-blocklist",
        Priority: 0,
        Action: { Block: {} },
        Statement: {
          OrStatement: {
            Statements: [reference("block-ipv4"), reference("block-ipv6")],
          },
        },
        VisibilityConfig: {
          SampledRequestsEnabled: true,
          CloudWatchMetricsEnabled: true,
          MetricName: "oneuptime-blocklist",
        },
      },
      {
        Name: "oneuptime-challenge",
        Priority: 1,
        Action: { Challenge: {} },
        Statement: {
          OrStatement: {
            Statements: [
              reference("challenge-ipv4"),
              reference("challenge-ipv6"),
            ],
          },
        },
        VisibilityConfig: {
          SampledRequestsEnabled: true,
          CloudWatchMetricsEnabled: true,
          MetricName: "oneuptime-challenge",
        },
      },
    ]);

    await pass(2);

    expect(stateOf(1, destinationNow())).toBe(
      SecurityBlockEnforcementState.Applied,
    );
    expect(cloudWafWrites[cloudWafWrites.length - 1]!.data["status"]).toBe(
      SecurityBlockCloudWafStatus.Enforcing,
    );
    expect(writesOf("UpdateWebACL")).toBe(0);
  });
});

describe("what AWS WAF cannot take", () => {
  test("no free priority below the customer's first rule: not applied, saying so, and no rule of the customer's touched", async () => {
    enforceIn({ rules: [customerRule("first", 0)] });
    addBlock({ index: 1, value: "35.205.11.131", hasCase: true });

    await pass(1);

    const row: SecurityBlockEnforcement = rowOf(1, destinationNow())!;

    expect(row.state).toBe(SecurityBlockEnforcementState.Failed);
    expect(row.error).toBe(
      "Not applied: prod-alb has no free priority below its first rule (priority 0) for OneUptime's two rules, and OneUptime never renumbers your rules. Free two priorities below it, and OneUptime adds them there.",
    );
    expect(writesOf("UpdateWebACL")).toBe(0);
    expect(fake.getRules(REGION, "REGIONAL", "prod-alb")).toEqual([
      customerRule("first", 0),
    ]);
    expect(cloudWafWrites[cloudWafWrites.length - 1]!.data["status"]).toBe(
      SecurityBlockCloudWafStatus.NoFreePriority,
    );
    expect(
      feedItems.filter((item: JSONObject): boolean => {
        return String(item["feedInfoInMarkdown"]).includes("prod-alb");
      }),
    ).toHaveLength(1);
  });

  test("addresses in OneUptime's set that no block wants - left from before its rule was put back - are taken away once the rule blocks the set", async () => {
    enforceIn();
    fake.addIpSet({
      region: REGION,
      scope: "REGIONAL",
      name: setName("block-ipv4"),
      version: "IPV4",
      addresses: ["198.51.100.1/32", "198.51.100.2/32"],
    });
    addBlock({ index: 1, value: "35.205.11.1" });

    await pass(1);

    // No rule blocked the set before this pass: its rule is added, and the block applied.
    expect(stateOf(1, destinationNow())).toBe(
      SecurityBlockEnforcementState.Applied,
    );

    await pass(2);

    expect(ipSet("block-ipv4")!.addresses).toEqual(["35.205.11.1/32"]);
  });

  test("a set AWS calls full says of each block it could not take that it is full, and tries again later", async () => {
    fake = createFakeAwsWaf({ maxAddresses: 1 });
    enforceIn();
    fake.addIpSet({
      region: REGION,
      scope: "REGIONAL",
      name: setName("block-ipv4"),
      version: "IPV4",
    });
    addBlock({ index: 1, value: "35.205.11.1" });
    addBlock({ index: 2, value: "35.205.11.2" });

    await pass(1);

    for (const index of [1, 2]) {
      const row: SecurityBlockEnforcement = rowOf(index, destinationNow())!;

      expect(row.state).toBe(SecurityBlockEnforcementState.Failed);
      expect(row.error).toBe(
        `Not applied: the AWS WAF IP set ${setName("block-ipv4")} is full (10,000)`,
      );
      expect(row.retryAt).toEqual(new Date(at(1).getTime() + MINUTE));
    }
  });

  test("a web ACL OneUptime may not read says so on every block, and is tried again later", async () => {
    enforceIn();
    fake.failNext("GetWebACL", WAF_ERRORS.denied("wafv2:GetWebACL"), 5);
    addBlock({ index: 1, value: "35.205.11.131" });

    const result: SecurityBlocklistPassResult = await pass(1);

    expect(result.failed).toBe(1);

    const row: SecurityBlockEnforcement = rowOf(1, destinationNow())!;

    expect(row.state).toBe(SecurityBlockEnforcementState.Pending);
    expect(row.error).toBe(
      "Could not read AWS WAF (prod-alb): AWS refused wafv2:GetWebACL on web ACL prod-alb: the access key may not call it. Run the connection's setup command again: its read-only policy grants it.",
    );
    expect(row.retryAt).toEqual(new Date(at(1).getTime() + MINUTE));
  });
});

describe("web ACLs that share a Region's sets", () => {
  test("a block written once to the shared set is enforced at both, and each has its own rule", async () => {
    const first: FakeWafWebAcl = fake.addWebAcl({
      region: REGION,
      scope: "REGIONAL",
      name: "prod-alb",
    });
    const second: FakeWafWebAcl = fake.addWebAcl({
      region: REGION,
      scope: "REGIONAL",
      name: "api-gateway",
    });
    const rowA: SecurityBlockCloudWaf = cloudWafRow({ index: 1, acl: first });
    const rowB: SecurityBlockCloudWaf = cloudWafRow({ index: 2, acl: second });

    makeDestinations = (): Array<SecurityBlockDestination> => {
      return [destinationOf({ row: rowA }), destinationOf({ row: rowB })];
    };

    const [a, b] = makeDestinations() as [
      SecurityBlockDestination,
      SecurityBlockDestination,
    ];

    // One writer of the sets at a time.
    expect(a.lockKey).toBe(b.lockKey);
    expect(a.key).not.toBe(b.key);

    addBlock({ index: 1, value: "35.205.11.131" });
    await pass(1);

    expect(stateOf(1, a)).toBe(SecurityBlockEnforcementState.Applied);
    expect(stateOf(1, b)).toBe(SecurityBlockEnforcementState.Applied);
    expect(ipSet("block-ipv4")!.addresses).toEqual(["35.205.11.131/32"]);
    expect(writesOf("UpdateWebACL")).toBe(2);
    expect(
      fake
        .getRules(REGION, "REGIONAL", "api-gateway")
        .map((rule: JSONObject) => {
          return rule["Name"];
        }),
    ).toEqual([RULES.block, RULES.challenge]);
  });
});

describe("CloudFront's web ACLs", () => {
  test("are enforced in us-east-1, scope CLOUDFRONT", async () => {
    const acl: FakeWafWebAcl = fake.addWebAcl({
      region: "us-east-1",
      scope: "CLOUDFRONT",
      name: "site-cdn",
    });
    const row: SecurityBlockCloudWaf = cloudWafRow({ index: 1, acl });

    row.region = "us-east-1";
    makeDestinations = (): Array<SecurityBlockDestination> => {
      return [destinationOf({ row })];
    };

    expect(parseAwsWafArn(row.wafId)!.scope).toBe(AwsWafScope.CloudFront);

    addBlock({ index: 1, value: "35.205.11.131" });
    await pass(1);

    expect(stateOf(1, destinationNow())).toBe(
      SecurityBlockEnforcementState.Applied,
    );
    expect(destinationNow().name).toBe("AWS WAF (site-cdn)");
    expect(
      fake.getIpSet("us-east-1", "CLOUDFRONT", setName("block-ipv4"))!
        .addresses,
    ).toEqual(["35.205.11.131/32"]);
  });
});

describe("the source", () => {
  test("makes a destination of each web ACL the project picked, those of one account, scope and Region sharing a lock", async () => {
    const first: FakeWafWebAcl = fake.addWebAcl({
      region: REGION,
      scope: "REGIONAL",
      name: "prod-alb",
    });
    const second: FakeWafWebAcl = fake.addWebAcl({
      region: REGION,
      scope: "REGIONAL",
      name: "api-gateway",
    });
    const cdn: FakeWafWebAcl = fake.addWebAcl({
      region: "us-east-1",
      scope: "CLOUDFRONT",
      name: "site-cdn",
    });
    const gone: SecurityBlockCloudWaf = cloudWafRow({ index: 4, acl: first });

    gone.cloudConnectionId = new ObjectID(
      "55555555-5555-4555-8555-555555555555",
    );

    jest
      .spyOn(SecurityBlockCloudWafService, "findForProject")
      .mockResolvedValue([
        cloudWafRow({ index: 1, acl: first }),
        cloudWafRow({ index: 2, acl: second }),
        cloudWafRow({ index: 3, acl: cdn }),
        gone,
      ]);

    const connection: CloudConnection = new CloudConnection();
    connection._id = CONNECTION_ID.toString();
    connection.projectId = PROJECT_ID;
    connection.provider = CloudProvider.AWS;
    connection.config = settings("rule").config;

    jest
      .spyOn(CloudConnectionService, "findBy")
      .mockResolvedValue([connection]);
    jest
      .spyOn(CloudConnectionService, "getConnectorSettings")
      .mockResolvedValue(settings("rule"));

    const destinations: Array<SecurityBlockDestination> =
      await new AwsWafBlockDestinationSource().findForProject(PROJECT_ID);

    expect(
      destinations.map((destination: SecurityBlockDestination) => {
        return destination.name;
      }),
    ).toEqual([
      "AWS WAF (prod-alb)",
      "AWS WAF (api-gateway)",
      "AWS WAF (site-cdn)",
    ]);
    expect(destinations[0]!.lockKey).toBe(destinations[1]!.lockKey);
    expect(destinations[0]!.lockKey).not.toBe(destinations[2]!.lockKey);
    expect(destinations[0]!.lockKey).toBe(
      `AwsWaf:${PROJECT_ID.toString()}:${FAKE_WAF_ACCOUNT_ID}:REGIONAL:${REGION}`,
    );
    expect(destinations[0]!.provider).toBe(
      SecurityBlockDestinationProvider.AwsWaf,
    );
    expect(destinations[0]!.connectionId?.toString()).toBe(
      CONNECTION_ID.toString(),
    );
    // Reading what the project picked calls no cloud: the reconciler's pass does.
    expect(fake.calls).toEqual([]);
  });

  test("holds every address and range a block may be, IPv4 and IPv6, blocked or challenged", () => {
    const { row } = enforceIn();
    const destination: AwsWafBlockDestination = destinationOf({ row });

    for (const value of [
      "35.205.11.131",
      "35.205.11.0/24",
      "2001:db8::7",
      "2001:db8::/48",
    ]) {
      for (const action of [
        SecurityBlockAction.Block,
        SecurityBlockAction.Challenge,
      ]) {
        expect(
          destination.supports({
            indicatorType: SecurityBlockIndicatorType.IpAddress,
            action,
            value,
          }),
        ).toEqual({ isSupported: true });
      }
    }

    expect(
      destination.supports({
        indicatorType: SecurityBlockIndicatorType.IpAddress,
        action: SecurityBlockAction.Block,
        value: "not-an-address",
      }),
    ).toEqual({
      isSupported: false,
      reason: "AWS WAF holds IPv4 and IPv6 addresses and ranges only",
    });
  });

  test("its capacity is its sets': 10,000 addresses each", async () => {
    const { row } = enforceIn();

    expect(await destinationOf({ row }).capacity()).toEqual({
      limit: 40000,
      fullReason: "the AWS WAF IP sets are full (10,000 addresses each)",
    });
  });
});
