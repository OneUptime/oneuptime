import SecurityBlock from "../../../../Models/DatabaseModels/SecurityBlock";
import SecurityBlockCloudWaf from "../../../../Models/DatabaseModels/SecurityBlockCloudWaf";
import SecurityBlockEnforcement from "../../../../Models/DatabaseModels/SecurityBlockEnforcement";
import SecurityBlockCloudWafService from "../../../../Server/Services/SecurityBlockCloudWafService";
import SecurityBlockEnforcementService from "../../../../Server/Services/SecurityBlockEnforcementService";
import SecurityBlockService from "../../../../Server/Services/SecurityBlockService";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import AzureArm from "../../../../Server/Utils/CloudConnection/Azure/AzureArm";
import AzureWafPolicyBlocklist from "../../../../Server/Utils/CloudConnection/Azure/AzureWafBlocklist";
import CloudArmorApi from "../../../../Server/Utils/CloudConnection/Gcp/CloudArmorApi";
import CloudArmorPolicyBlocklist from "../../../../Server/Utils/CloudConnection/Gcp/CloudArmorBlocklist";
import AzureWafBlockDestination from "../../../../Server/Utils/SecurityBlocklist/AzureWafBlockDestination";
import CloudArmorBlockDestination from "../../../../Server/Utils/SecurityBlocklist/CloudArmorBlockDestination";
import SecurityBlockDestination from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestination";
import SecurityBlockDestinations from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestinations";
import SecurityBlocklistReconciler from "../../../../Server/Utils/SecurityBlocklist/SecurityBlocklistReconciler";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  AzureWafPolicyRef,
  parseAzureWafPolicyId,
  readAzureWafRuleDetails,
} from "../../../../Types/CloudConnection/AzureWafBlocklist";
import {
  CloudArmorPolicyRef,
  parseCloudArmorPolicyId,
  readCloudArmorRuleDetails,
} from "../../../../Types/CloudConnection/CloudArmorBlocklist";
import { getCloudWafProjectSuffix } from "../../../../Types/CloudConnection/CloudWafRuleSlots";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityBlockAction,
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
import {
  SecurityBlockReason,
  fillSecurityBlockReason,
  readSecurityBlockReason,
} from "../../../../Types/SecurityBlocklist/SecurityBlockReason";
import InMemoryLocks from "../../TestingUtils/InMemoryLocks";
import {
  FAKE_AZURE_CLIENT,
  FAKE_AZURE_SECRET,
  FAKE_AZURE_TENANT,
  FAKE_FRONT_DOOR_POLICY_ID,
  FAKE_GATEWAY_POLICY_ID,
  FakeAzureWafArm,
  createFakeAzureWafArm,
  recordedFrontDoorPolicy,
  recordedGatewayPolicy,
} from "../CloudConnection/FakeAzureWafArm";
import {
  FAKE_ARMOR_POLICY_ID,
  FAKE_GCP_KEY,
  FakeCloudArmor,
  createFakeCloudArmor,
} from "../CloudConnection/FakeCloudArmor";
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
 * THE BLOCKLIST ENFORCED IN AZURE WAF (#10348) AND CLOUD ARMOR (#10349),
 * end to end: the reconciler driving a picked policy as a destination,
 * against Resource Manager and Compute Engine as they answer
 * (FakeAzureWafArm, FakeCloudArmor) - the blocks and their rows held in
 * memory behind the services, each pass made at a moment the test names.
 *
 * Pinned: a block is Enforced at Azure WAF (prod-waf) or Cloud Armor
 * (prod-lb) within a pass; a Front Door write is Pending until its
 * provisioning succeeds, then Applied; an IPv6 block is not applied on
 * Application Gateway, and a challenge nowhere, each saying why in a
 * sentence the Dashboard words in the reader's language; a block that ends
 * comes out; a rule turned off by hand leaves its blocks not enforced and
 * the policy Changed by Hand; and neither destination says it can
 * challenge (#10350's contract).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SUFFIX: string = getCloudWafProjectSuffix(PROJECT_ID.toString());

const NOW: Date = new Date("2026-11-22T10:42:00.000Z");
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

let blocks: Map<string, SecurityBlock>;
let rows: Map<string, SecurityBlockEnforcement>;
let locks: InMemoryLocks;
let rowsCreated: number;
let makeDestinations: () => Array<SecurityBlockDestination>;

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
}): void {
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
  blocks.set(block.id!.toString(), block);
}

function setState(index: number, state: SecurityBlockState): void {
  blocks.get(blockId(index).toString())!.state = state;
}

function rowOf(index: number): SecurityBlockEnforcement | undefined {
  const destination: SecurityBlockDestination = makeDestinations()[0]!;

  return Array.from(rows.values()).find(
    (row: SecurityBlockEnforcement): boolean => {
      return (
        sameId(row.securityBlockId, blockId(index)) &&
        row.destinationKey === destination.key
      );
    },
  );
}

function reasonOf(row: SecurityBlockEnforcement | undefined): string {
  const reason: SecurityBlockReason | null = readSecurityBlockReason(
    row?.errorReason,
  );

  return reason ? fillSecurityBlockReason(reason) : "";
}

function wafRow(data: {
  cloudProvider: CloudProvider;
  wafId: string;
  name: string;
  clientAddress?: SecurityBlockClientAddress | undefined;
}): SecurityBlockCloudWaf {
  const row: SecurityBlockCloudWaf = new SecurityBlockCloudWaf();

  row._id = "cccccccc-cccc-4ccc-8ccc-000000000001";
  row.projectId = PROJECT_ID;
  row.cloudConnectionId = CONNECTION_ID;
  row.cloudProvider = data.cloudProvider;
  row.wafId = data.wafId;
  row.name = data.name;
  row.clientAddress = data.clientAddress || SecurityBlockClientAddress.SourceIp;
  row.status = SecurityBlockCloudWafStatus.Checking;

  return row;
}

// An Azure WAF policy picked, and the destination each pass makes of it from its row.
function enforceInAzure(data: {
  fake: FakeAzureWafArm;
  id: string;
  name: string;
}): SecurityBlockCloudWaf {
  const row: SecurityBlockCloudWaf = wafRow({
    cloudProvider: CloudProvider.Azure,
    wafId: data.id,
    name: data.name,
  });
  const policy: AzureWafPolicyRef = parseAzureWafPolicyId(data.id)!;

  makeDestinations = (): Array<SecurityBlockDestination> => {
    return [
      new AzureWafBlockDestination({
        row,
        policy,
        keeper: new AzureWafPolicyBlocklist({
          arm: new AzureArm({
            tenantId: FAKE_AZURE_TENANT,
            clientId: FAKE_AZURE_CLIENT,
            clientSecret: FAKE_AZURE_SECRET,
            cloud: "public",
            transport: data.fake.transport,
            sleep: async (): Promise<void> => {
              return undefined;
            },
          }),
          policy,
          displayName: data.name,
          projectSuffix: SUFFIX,
          clientAddress: row.clientAddress as SecurityBlockClientAddress,
          details: readAzureWafRuleDetails(row.ruleDetails),
        }),
        now: (): Date => {
          return NOW;
        },
      }),
    ];
  };

  return row;
}

function enforceInCloudArmor(fake: FakeCloudArmor): SecurityBlockCloudWaf {
  const row: SecurityBlockCloudWaf = wafRow({
    cloudProvider: CloudProvider.GCP,
    wafId: FAKE_ARMOR_POLICY_ID,
    name: "prod-lb",
  });
  const policy: CloudArmorPolicyRef = parseCloudArmorPolicyId(
    FAKE_ARMOR_POLICY_ID,
  )!;

  makeDestinations = (): Array<SecurityBlockDestination> => {
    return [
      new CloudArmorBlockDestination({
        row,
        policy,
        keeper: new CloudArmorPolicyBlocklist({
          api: new CloudArmorApi({
            serviceAccountJson: FAKE_GCP_KEY,
            transport: fake.transport,
            sleep: async (): Promise<void> => {
              return undefined;
            },
          }),
          policy,
          displayName: "prod-lb",
          projectSuffix: SUFFIX,
          clientAddress: row.clientAddress as SecurityBlockClientAddress,
          details: readCloudArmorRuleDetails(row.ruleDetails),
        }),
        now: (): Date => {
          return NOW;
        },
      }),
    ];
  };

  return row;
}

async function pass(minutes: number): Promise<void> {
  await SecurityBlocklistReconciler.reconcileProject({
    projectId: PROJECT_ID,
    now: at(minutes),
  });
}

beforeEach(() => {
  blocks = new Map();
  rows = new Map();
  rowsCreated = 0;
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
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockResolvedValue(undefined as never);

  SecurityBlockDestinations.setSourcesForTests([
    {
      provider: SecurityBlockDestinationProvider.AzureWaf,
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

function gatewayFake(): FakeAzureWafArm {
  return createFakeAzureWafArm({
    policies: [
      {
        id: FAKE_GATEWAY_POLICY_ID,
        kind: "gateway",
        policy: recordedGatewayPolicy(),
      },
    ],
  });
}

describe("Azure WAF", () => {
  test("a block lands in OneUptime's rule within a pass, and is Enforced at Azure WAF (prod-waf); the policy's row says it enforces", async () => {
    const fake: FakeAzureWafArm = gatewayFake();
    const row: SecurityBlockCloudWaf = enforceInAzure({
      fake,
      id: FAKE_GATEWAY_POLICY_ID,
      name: "prod-waf",
    });

    addBlock({ index: 1, value: "35.205.11.131" });
    await pass(1);

    const enforcement: SecurityBlockEnforcement = rowOf(1)!;

    expect(enforcement.state).toBe(SecurityBlockEnforcementState.Applied);
    expect(enforcement.destinationName).toBe("Azure WAF (prod-waf)");
    expect(enforcement.provider).toBe(SecurityBlockDestinationProvider.AzureWaf);
    expect(enforcement.providerRef).toBe(`OneUptime${SUFFIX}Block1`);
    expect(getSecurityBlockEnforcementSummary([enforcement], at(1))).toEqual({
      isEnforced: true,
      enforcedAt: ["Azure WAF (prod-waf)"],
      notEnforcedAt: [],
    });
    expect(row.status).toBe(SecurityBlockCloudWafStatus.Enforcing);
    expect(makeDestinations()[0]!.canChallenge).toBe(false);

    // The customer's rules, as they were.
    expect(
      fake
        .customRules(FAKE_GATEWAY_POLICY_ID)
        .filter((rule: JSONObject): boolean => {
          return !String(rule["name"]).startsWith("OneUptime");
        })
        .map((rule: JSONObject): string => {
          return String(rule["name"]);
        }),
    ).toEqual(["BlockBadBots", "AllowOffice"]);

    // A pass with nothing new writes nothing.
    await pass(2);
    expect(fake.puts(FAKE_GATEWAY_POLICY_ID)).toHaveLength(1);
  });

  test("an IPv6 block is not applied on Application Gateway, and a challenge is not applied anywhere, each saying why", async () => {
    const fake: FakeAzureWafArm = gatewayFake();

    enforceInAzure({ fake, id: FAKE_GATEWAY_POLICY_ID, name: "prod-waf" });
    addBlock({ index: 1, value: "2001:db8::7" });
    addBlock({
      index: 2,
      value: "198.51.100.0/24",
      action: SecurityBlockAction.Challenge,
    });
    await pass(1);

    expect(rowOf(1)!.state).toBe(SecurityBlockEnforcementState.Failed);
    expect(reasonOf(rowOf(1))).toBe(
      "Not applied: Application Gateway matches IPv4 addresses only, so it cannot block 2001:db8::7.",
    );
    expect(rowOf(2)!.state).toBe(SecurityBlockEnforcementState.Failed);
    expect(reasonOf(rowOf(2))).toBe(
      "Not applied: Azure WAF cannot challenge: it can only block.",
    );
    expect(fake.puts(FAKE_GATEWAY_POLICY_ID)).toHaveLength(0);
  });

  test("on Front Door, a block is Pending while Azure applies the policy, and Applied once its provisioning succeeds", async () => {
    const fake: FakeAzureWafArm = createFakeAzureWafArm({
      policies: [
        {
          id: FAKE_FRONT_DOOR_POLICY_ID,
          kind: "frontDoor",
          policy: recordedFrontDoorPolicy(),
        },
      ],
      frontDoorApplyingReads: 1,
    });
    const row: SecurityBlockCloudWaf = enforceInAzure({
      fake,
      id: FAKE_FRONT_DOOR_POLICY_ID,
      name: "edgewaf",
    });

    addBlock({ index: 1, value: "2001:db8::7" });
    await pass(1);

    expect(rowOf(1)!.state).toBe(SecurityBlockEnforcementState.Pending);
    expect(row.status).toBe(SecurityBlockCloudWafStatus.Applying);

    await pass(2);

    expect(rowOf(1)!.state).toBe(SecurityBlockEnforcementState.Applied);
    expect(row.status).toBe(SecurityBlockCloudWafStatus.Enforcing);
    expect(fake.puts(FAKE_FRONT_DOOR_POLICY_ID)).toHaveLength(1);
  });

  test("a block that ends comes out of OneUptime's rule, and its row says Removed", async () => {
    const fake: FakeAzureWafArm = gatewayFake();

    enforceInAzure({ fake, id: FAKE_GATEWAY_POLICY_ID, name: "prod-waf" });
    addBlock({ index: 1, value: "35.205.11.131" });
    addBlock({ index: 2, value: "35.205.11.132" });
    await pass(1);
    setState(1, SecurityBlockState.Lifted);
    await pass(2);

    expect(rowOf(1)!.state).toBe(SecurityBlockEnforcementState.Removed);
    expect(rowOf(2)!.state).toBe(SecurityBlockEnforcementState.Applied);

    const ours: JSONObject | undefined = fake
      .customRules(FAKE_GATEWAY_POLICY_ID)
      .find((rule: JSONObject): boolean => {
        return rule["name"] === `OneUptime${SUFFIX}Block1`;
      });

    expect(
      ((ours!["matchConditions"] as Array<JSONObject>)[0]!["matchValues"] as Array<string>),
    ).toEqual(["35.205.11.132"]);
  });

  test("OneUptime's rule turned off by hand: its blocks not enforced, why, and the policy Changed by Hand - never turned on again behind the person's back", async () => {
    const fake: FakeAzureWafArm = gatewayFake();
    const row: SecurityBlockCloudWaf = enforceInAzure({
      fake,
      id: FAKE_GATEWAY_POLICY_ID,
      name: "prod-waf",
    });

    addBlock({ index: 1, value: "35.205.11.131" });
    await pass(1);
    fake.writeBehind(FAKE_GATEWAY_POLICY_ID, (policy: JSONObject): void => {
      (
        ((policy["properties"] as JSONObject)["customRules"] as Array<JSONObject>).find(
          (rule: JSONObject): boolean => {
            return rule["name"] === `OneUptime${SUFFIX}Block1`;
          },
        ) as JSONObject
      )["state"] = "Disabled";
    });
    await pass(2);
    await pass(3);

    expect(rowOf(1)!.state).toBe(SecurityBlockEnforcementState.Failed);
    expect(reasonOf(rowOf(1))).toBe(
      `OneUptime's rule OneUptime${SUFFIX}Block1 in prod-waf was turned off by hand, so the blocks it holds are not enforced. Select Put It Back to turn it on again.`,
    );
    expect(row.status).toBe(SecurityBlockCloudWafStatus.Drifted);
    expect(
      fake
        .customRules(FAKE_GATEWAY_POLICY_ID)
        .find((rule: JSONObject): boolean => {
          return rule["name"] === `OneUptime${SUFFIX}Block1`;
        })!["state"],
    ).toBe("Disabled");
  });
});

describe("Cloud Armor", () => {
  test("a block lands in OneUptime's rule within a pass, and is Enforced at Cloud Armor (prod-lb)", async () => {
    const fake: FakeCloudArmor = createFakeCloudArmor();
    const row: SecurityBlockCloudWaf = enforceInCloudArmor(fake);

    addBlock({ index: 1, value: "35.205.11.131" });
    addBlock({ index: 2, value: "2001:db8::7" });
    await pass(1);

    for (const index of [1, 2]) {
      const enforcement: SecurityBlockEnforcement = rowOf(index)!;

      expect(enforcement.state).toBe(SecurityBlockEnforcementState.Applied);
      expect(enforcement.destinationName).toBe("Cloud Armor (prod-lb)");
      expect(enforcement.provider).toBe(
        SecurityBlockDestinationProvider.CloudArmor,
      );
      expect(enforcement.providerRef).toBe("priority 0");
    }

    expect(row.status).toBe(SecurityBlockCloudWafStatus.Enforcing);
    expect(makeDestinations()[0]!.canChallenge).toBe(false);
  });

  test("with Cloud Armor Enterprise, a block lands in the project's address group, held by it", async () => {
    const fake: FakeCloudArmor = createFakeCloudArmor({
      tier: "CA_ENTERPRISE_PAYGO",
    });

    enforceInCloudArmor(fake);
    addBlock({ index: 1, value: "35.205.11.131" });
    await pass(1);

    expect(rowOf(1)!.state).toBe(SecurityBlockEnforcementState.Applied);
    expect(rowOf(1)!.providerRef).toBe(`oneuptime-${SUFFIX}-block-ipv4`);
    expect(fake.group(`oneuptime-${SUFFIX}-block-ipv4`)!.items).toEqual([
      "35.205.11.131/32",
    ]);
  });

  test("a challenge is not applied, saying why, and a block that ends comes out", async () => {
    const fake: FakeCloudArmor = createFakeCloudArmor();

    enforceInCloudArmor(fake);
    addBlock({ index: 1, value: "35.205.11.131" });
    addBlock({
      index: 2,
      value: "198.51.100.0/24",
      action: SecurityBlockAction.Challenge,
    });
    await pass(1);

    expect(reasonOf(rowOf(2))).toBe(
      "Not applied: Cloud Armor cannot challenge: it can only block.",
    );

    setState(1, SecurityBlockState.Expired);
    await pass(2);

    expect(rowOf(1)!.state).toBe(SecurityBlockEnforcementState.Removed);
    expect(fake.ruleAt(FAKE_ARMOR_POLICY_ID, 0)).toBeUndefined();
  });
});
