import CloudConnection from "../../../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import SecurityBlockCloudWaf from "../../../../Models/DatabaseModels/SecurityBlockCloudWaf";
import CloudConnectionService from "../../../../Server/Services/CloudConnectionService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import SecurityBlockCloudWafService from "../../../../Server/Services/SecurityBlockCloudWafService";
import SecurityBlockEnforcementService from "../../../../Server/Services/SecurityBlockEnforcementService";
import { CloudConnectionSettings } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { setAzureWafCallOptionsForTests } from "../../../../Server/Utils/SecurityBlocklist/AzureWafBlockDestination";
import { setCloudArmorCallOptionsForTests } from "../../../../Server/Utils/SecurityBlocklist/CloudArmorBlockDestination";
import SecurityBlockCloudWafs, {
  SecurityBlockCloudWafAccess,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockCloudWafs";
import SecurityBlocklistJobs from "../../../../Server/Utils/SecurityBlocklist/SecurityBlocklistJobs";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { getCloudWafProjectSuffix } from "../../../../Types/CloudConnection/CloudWafRuleSlots";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityBlockClientAddress,
  SecurityBlockCloudWafLeftItem,
  SecurityBlockCloudWafLeftKind,
  SecurityBlockCloudWafStatus,
} from "../../../../Types/SecurityBlocklist/SecurityBlockCloudWaf";
import { SecurityBlockEnforcementState } from "../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import {
  fillSecurityBlockReason,
  readSecurityBlockReason,
} from "../../../../Types/SecurityBlocklist/SecurityBlockReason";
import InMemoryLocks from "../../TestingUtils/InMemoryLocks";
import {
  FAKE_AZURE_CLIENT,
  FAKE_AZURE_SECRET,
  FAKE_AZURE_SUBSCRIPTION,
  FAKE_AZURE_TENANT,
  FAKE_GATEWAY_POLICY_ID,
  FakeAzureWafArm,
  createFakeAzureWafArm,
  recordedGatewayPolicy,
} from "../CloudConnection/FakeAzureWafArm";
import {
  FAKE_ARMOR_POLICY_ID,
  FAKE_GCP_KEY,
  FAKE_GCP_SERVICE_ACCOUNT_EMAIL,
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
 * CHECK AGAIN, PUT IT BACK, REMOVE AND THE ACCESS CHECK, FOR AN AZURE WAF
 * OR CLOUD ARMOR POLICY (#10348, #10349) - SecurityBlockCloudWafs -
 * against Resource Manager and Compute as they answer (FakeAzureWafArm,
 * FakeCloudArmor), the rows, the inventory and the connection in memory.
 *
 * A check reads the policy (and sets a Cloud Armor policy up) and records
 * where it stands, what the cloud refused included, never as an error.
 * Put It Back writes OneUptime's rules changed by hand again and has the
 * blocks they turned down tried at once. Remove takes OneUptime's rules
 * out and nothing else - a Cloud Armor project's address groups only once
 * no other policy uses them - or, from OneUptime only, names what stays.
 * The access check asks the cloud, writing nothing, and gives the lines.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const SUFFIX: string = getCloudWafProjectSuffix(PROJECT_ID.toString());

let azure: FakeAzureWafArm;
let armor: FakeCloudArmor;
let provider: CloudProvider;
let rows: Map<string, SecurityBlockCloudWaf>;
let resource: CloudResource | null;
let deleted: Array<string>;
let retried: Array<JSONObject>;
let locks: InMemoryLocks;

function sameId(left: unknown, right: unknown): boolean {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function picked(data: {
  index: number;
  cloudProvider: CloudProvider;
  wafId: string;
  name: string;
}): SecurityBlockCloudWaf {
  const row: SecurityBlockCloudWaf = new SecurityBlockCloudWaf();

  row._id = `cccccccc-cccc-4ccc-8ccc-${String(data.index).padStart(12, "0")}`;
  row.projectId = PROJECT_ID;
  row.cloudConnectionId = CONNECTION_ID;
  row.cloudProvider = data.cloudProvider;
  row.wafId = data.wafId;
  row.name = data.name;
  row.clientAddress = SecurityBlockClientAddress.SourceIp;
  row.status = SecurityBlockCloudWafStatus.Checking;
  rows.set(row._id, row);

  return row;
}

function settings(): CloudConnectionSettings {
  return provider === CloudProvider.Azure
    ? {
        provider: CloudProvider.Azure,
        projectId: PROJECT_ID.toString(),
        config: {
          authMethod: CloudConnectionAuthMethod.AzureClientSecret,
          tenantId: FAKE_AZURE_TENANT,
          clientId: FAKE_AZURE_CLIENT,
          cloud: "public",
          subscriptionIds: FAKE_AZURE_SUBSCRIPTION,
          wafBlocklist: "rule",
        },
        secrets: { clientSecret: FAKE_AZURE_SECRET },
      }
    : {
        provider: CloudProvider.GCP,
        projectId: PROJECT_ID.toString(),
        config: {
          authMethod: CloudConnectionAuthMethod.GcpServiceAccountKey,
          wafBlocklist: "rule",
        },
        secrets: { serviceAccountJson: FAKE_GCP_KEY },
      };
}

async function check(
  row: SecurityBlockCloudWaf,
): Promise<SecurityBlockCloudWaf> {
  return await SecurityBlockCloudWafs.check({
    projectId: PROJECT_ID,
    cloudWafId: new ObjectID(row._id!),
  });
}

async function remove(
  row: SecurityBlockCloudWaf,
  keepInCloud: boolean = false,
): Promise<{ leftInCloud: Array<SecurityBlockCloudWafLeftItem> }> {
  return await SecurityBlockCloudWafs.remove({
    projectId: PROJECT_ID,
    cloudWafId: new ObjectID(row._id!),
    keepInCloud,
  });
}

beforeEach(() => {
  azure = createFakeAzureWafArm({
    policies: [
      {
        id: FAKE_GATEWAY_POLICY_ID,
        kind: "gateway",
        policy: recordedGatewayPolicy(),
      },
    ],
  });
  armor = createFakeCloudArmor();
  provider = CloudProvider.Azure;
  rows = new Map();
  resource = null;
  deleted = [];
  retried = [];
  locks = new InMemoryLocks();
  locks.install();

  setAzureWafCallOptionsForTests({
    transport: azure.transport,
    sleep: async (): Promise<void> => {
      return undefined;
    },
  });
  setCloudArmorCallOptionsForTests({
    transport: armor.transport,
    sleep: async (): Promise<void> => {
      return undefined;
    },
  });

  jest
    .spyOn(SecurityBlockCloudWafService, "findOneBy")
    .mockImplementation((async (
      args: unknown,
    ): Promise<SecurityBlockCloudWaf | null> => {
      const query: JSONObject = (args as { query: JSONObject }).query;
      const row: SecurityBlockCloudWaf | undefined = Array.from(
        rows.values(),
      ).find((candidate: SecurityBlockCloudWaf): boolean => {
        return (
          sameId(candidate._id, query["_id"]) &&
          sameId(candidate.projectId, query["projectId"])
        );
      });

      return row ? Object.assign(new SecurityBlockCloudWaf(), row) : null;
    }) as never);

  jest
    .spyOn(SecurityBlockCloudWafService, "findForProject")
    .mockImplementation((async (): Promise<Array<SecurityBlockCloudWaf>> => {
      return Array.from(rows.values()).map(
        (row: SecurityBlockCloudWaf): SecurityBlockCloudWaf => {
          return Object.assign(new SecurityBlockCloudWaf(), row);
        },
      );
    }) as never);

  jest
    .spyOn(SecurityBlockCloudWafService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (args: unknown): Promise<void> => {
      const data: { id: ObjectID; data: JSONObject } = args as {
        id: ObjectID;
        data: JSONObject;
      };
      const row: SecurityBlockCloudWaf | undefined = rows.get(
        data.id.toString(),
      );

      if (row) {
        Object.assign(row, data.data);
      }
    }) as never);

  jest
    .spyOn(SecurityBlockCloudWafService, "deleteOneBy")
    .mockImplementation((async (args: unknown): Promise<void> => {
      const id: string = String(
        (args as { query: JSONObject }).query["_id"],
      ).toLowerCase();

      rows.delete(id);
      deleted.push(id);
    }) as never);

  jest
    .spyOn(SecurityBlockEnforcementService, "updateBy")
    .mockImplementation((async (args: unknown): Promise<number> => {
      retried.push(args as JSONObject);
      return 0;
    }) as never);

  jest.spyOn(CloudConnectionService, "findOneBy").mockImplementation((async (
    args: unknown,
  ): Promise<CloudConnection | null> => {
    const query: JSONObject = (args as { query: JSONObject }).query;

    if (
      !sameId(query["_id"], CONNECTION_ID) ||
      !sameId(query["projectId"], PROJECT_ID)
    ) {
      return null;
    }

    const connection: CloudConnection = new CloudConnection();
    connection._id = CONNECTION_ID.toString();
    connection.projectId = PROJECT_ID;
    connection.provider = provider;
    connection.config = { wafBlocklist: "rule" };

    return connection;
  }) as never);

  jest
    .spyOn(CloudConnectionService, "getConnectorSettings")
    .mockImplementation((async (): Promise<CloudConnectionSettings> => {
      return settings();
    }) as never);

  jest.spyOn(CloudResourceService, "findOneBy").mockImplementation((async (
    args: unknown,
  ): Promise<CloudResource | null> => {
    const query: JSONObject = (args as { query: JSONObject }).query;

    return resource &&
      sameId(query["_id"], resource._id) &&
      sameId(query["projectId"], PROJECT_ID)
      ? resource
      : null;
  }) as never);

  jest
    .spyOn(SecurityBlocklistJobs, "queueReconcile")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  setAzureWafCallOptionsForTests(undefined);
  setCloudArmorCallOptionsForTests(undefined);
  jest.restoreAllMocks();
});

function inventoried(data: {
  cloudProvider: CloudProvider;
  providerResourceId: string;
  name: string;
}): void {
  resource = new CloudResource();
  resource._id = RESOURCE_ID.toString();
  resource.name = data.name;
  resource.cloudProvider = data.cloudProvider;
  resource.providerResourceId = data.providerResourceId;
  resource.cloudConnectionId = CONNECTION_ID;
}

describe("an Azure WAF policy", () => {
  test("Check Again reads it and records it enforcing, with what OneUptime keeps of it, and the blocklist is reconciled at once", async () => {
    const row: SecurityBlockCloudWaf = picked({
      index: 1,
      cloudProvider: CloudProvider.Azure,
      wafId: FAKE_GATEWAY_POLICY_ID,
      name: "prod-waf",
    });

    const checked: SecurityBlockCloudWaf = await check(row);

    expect(checked.status).toBe(SecurityBlockCloudWafStatus.Enforcing);
    expect(rows.get(row._id!)!.ruleDetails).toEqual(
      expect.objectContaining({
        kind: "applicationGateway",
        matchVariable: "RemoteAddr",
        addressesPerRule: 600,
        rules: [],
      }),
    );
    // A check writes nothing to the policy.
    expect(azure.puts(FAKE_GATEWAY_POLICY_ID)).toHaveLength(0);
    expect(SecurityBlocklistJobs.queueReconcile).toHaveBeenCalledWith(
      PROJECT_ID,
    );
  });

  test("a policy the connection may not read is the policy's status, in the reader's words, not an error", async () => {
    const row: SecurityBlockCloudWaf = picked({
      index: 1,
      cloudProvider: CloudProvider.Azure,
      wafId: FAKE_GATEWAY_POLICY_ID,
      name: "prod-waf",
    });

    azure.failReads(403, {
      error: { code: "AuthorizationFailed", message: "no read" },
    });

    const checked: SecurityBlockCloudWaf = await check(row);

    expect(checked.status).toBe(SecurityBlockCloudWafStatus.Failed);
    expect(
      fillSecurityBlockReason(
        readSecurityBlockReason(rows.get(row._id!)!.statusReason)!,
      ),
    ).toBe(
      "OneUptime may not read prod-waf: the connection has no Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies/read there. Grant it with the lines the Add WAF dialog shows for the policy, then select Check Again.",
    );
  });

  test("Put It Back turns OneUptime's rule on again, and the blocks it turned down are tried at once", async () => {
    const row: SecurityBlockCloudWaf = picked({
      index: 1,
      cloudProvider: CloudProvider.Azure,
      wafId: FAKE_GATEWAY_POLICY_ID,
      name: "prod-waf",
    });

    // OneUptime's rule, as a pass wrote it, then turned off by hand.
    azure.writeBehind(FAKE_GATEWAY_POLICY_ID, (policy: JSONObject): void => {
      (
        (policy["properties"] as JSONObject)["customRules"] as Array<JSONObject>
      ).push({
        name: `OneUptime${SUFFIX}Block1`,
        priority: 1,
        ruleType: "MatchRule",
        action: "Block",
        state: "Disabled",
        matchConditions: [
          {
            matchVariables: [{ variableName: "RemoteAddr" }],
            operator: "IPMatch",
            negationConditon: false,
            matchValues: ["35.205.11.131"],
            transforms: [],
          },
        ],
      });
    });

    await check(row);
    expect(rows.get(row._id!)!.status).toBe(
      SecurityBlockCloudWafStatus.Drifted,
    );

    const back: SecurityBlockCloudWaf = await SecurityBlockCloudWafs.putBack({
      projectId: PROJECT_ID,
      cloudWafId: new ObjectID(row._id!),
    });

    expect(back.status).toBe(SecurityBlockCloudWafStatus.Enforcing);
    expect(
      azure
        .customRules(FAKE_GATEWAY_POLICY_ID)
        .find((rule: JSONObject): boolean => {
          return rule["name"] === `OneUptime${SUFFIX}Block1`;
        })!["state"],
    ).toBe("Enabled");
    expect(retried).toHaveLength(1);
    expect(retried[0]!["query"]).toEqual({
      projectId: PROJECT_ID,
      destinationKey: `AzureWaf:${row._id}`,
      state: SecurityBlockEnforcementState.Failed,
    });
    expect(retried[0]!["data"]).toEqual({ retryAt: null, failedAttempts: 0 });
  });

  test("Remove takes OneUptime's rules out and nothing else, then the row; from OneUptime only, it names the rules left", async () => {
    const row: SecurityBlockCloudWaf = picked({
      index: 1,
      cloudProvider: CloudProvider.Azure,
      wafId: FAKE_GATEWAY_POLICY_ID,
      name: "prod-waf",
    });

    azure.writeBehind(FAKE_GATEWAY_POLICY_ID, (policy: JSONObject): void => {
      (
        (policy["properties"] as JSONObject)["customRules"] as Array<JSONObject>
      ).push({
        name: `OneUptime${SUFFIX}Block1`,
        priority: 1,
        ruleType: "MatchRule",
        action: "Block",
        state: "Enabled",
        matchConditions: [
          {
            matchVariables: [{ variableName: "RemoteAddr" }],
            operator: "IPMatch",
            negationConditon: false,
            matchValues: ["35.205.11.131"],
            transforms: [],
          },
        ],
      });
    });
    await check(row);

    expect((await remove(row)).leftInCloud).toEqual([]);
    expect(
      azure.customRules(FAKE_GATEWAY_POLICY_ID).map((rule: JSONObject) => {
        return rule["name"];
      }),
    ).toEqual(["BlockBadBots", "AllowOffice"]);
    expect(deleted).toEqual([row._id]);

    // From OneUptime only: nothing written, each rule OneUptime wrote named.
    const kept: SecurityBlockCloudWaf = picked({
      index: 2,
      cloudProvider: CloudProvider.Azure,
      wafId: FAKE_GATEWAY_POLICY_ID,
      name: "prod-waf",
    });

    kept.ruleDetails = {
      kind: "applicationGateway",
      matchVariable: "RemoteAddr",
      addressesPerRule: 600,
      maxRules: 10,
      rules: [
        {
          index: 1,
          name: `OneUptime${SUFFIX}Block1`,
          priority: 1,
          values: ["35.205.11.131"],
        },
      ],
      nextIndex: 2,
      drift: [],
      freePriorities: [],
      isWaitingForPriority: false,
      policy: {
        isEnabled: true,
        mode: "Prevention",
        isAttached: true,
        provisioningState: "Succeeded",
        skuName: "",
      },
    };

    const puts: number = azure.puts(FAKE_GATEWAY_POLICY_ID).length;

    expect((await remove(kept, true)).leftInCloud).toEqual([
      {
        kind: SecurityBlockCloudWafLeftKind.Rule,
        name: `OneUptime${SUFFIX}Block1`,
        webAcl: "prod-waf",
      },
    ]);
    expect(azure.puts(FAKE_GATEWAY_POLICY_ID)).toHaveLength(puts);
  });

  test("when Azure refuses, nothing is removed - not the row - and it says what to do", async () => {
    const row: SecurityBlockCloudWaf = picked({
      index: 1,
      cloudProvider: CloudProvider.Azure,
      wafId: FAKE_GATEWAY_POLICY_ID,
      name: "prod-waf",
    });

    azure.writeBehind(FAKE_GATEWAY_POLICY_ID, (policy: JSONObject): void => {
      (
        (policy["properties"] as JSONObject)["customRules"] as Array<JSONObject>
      ).push({
        name: `OneUptime${SUFFIX}Block1`,
        priority: 1,
        ruleType: "MatchRule",
        action: "Block",
        state: "Enabled",
        matchConditions: [
          {
            matchVariables: [{ variableName: "RemoteAddr" }],
            operator: "IPMatch",
            negationConditon: false,
            matchValues: ["35.205.11.131"],
            transforms: [],
          },
        ],
      });
    });
    azure.failNextPut(403, {
      error: { code: "AuthorizationFailed", message: "no write" },
    });

    await expect(remove(row)).rejects.toThrow(
      "OneUptime could not take its rules out of prod-waf:",
    );
    expect(rows.has(row._id!)).toBe(true);
    expect(deleted).toEqual([]);
  });

  test("the access check asks Azure what the app may do at the policy, and gives the lines that grant it on that policy alone", async () => {
    inventoried({
      cloudProvider: CloudProvider.Azure,
      providerResourceId: FAKE_GATEWAY_POLICY_ID.toLowerCase(),
      name: "prod-waf",
    });
    azure.setPermissions([
      { actions: ["Microsoft.Network/*/read"], notActions: [] },
    ]);

    const access: SecurityBlockCloudWafAccess =
      await SecurityBlockCloudWafs.checkAccess({
        projectId: PROJECT_ID,
        cloudResourceId: RESOURCE_ID,
      });

    expect(access.isGranted).toBe(false);
    expect(access.shell).toBe("azure");
    expect(access.checks).toEqual([
      {
        permission:
          "Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies/read",
        isGranted: true,
      },
      {
        permission:
          "Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies/write",
        isGranted: false,
      },
    ]);
    expect(access.command).toContain(`--assignee "${FAKE_AZURE_CLIENT}"`);
    expect(access.command).toContain(`--scope "${FAKE_GATEWAY_POLICY_ID}"`);
    expect(access.command).toContain('--role "OneUptime WAF Blocklist"');
    expect(azure.puts(FAKE_GATEWAY_POLICY_ID)).toHaveLength(0);
  });

  test("a policy not in the inventory, or another project's, is refused before the cloud is asked", async () => {
    await expect(
      SecurityBlockCloudWafs.checkAccess({
        projectId: PROJECT_ID,
        cloudResourceId: RESOURCE_ID,
      }),
    ).rejects.toThrow("That policy is not in your cloud inventory any more.");
    expect(azure.requests).toHaveLength(0);
  });
});

describe("a Cloud Armor policy", () => {
  beforeEach(() => {
    provider = CloudProvider.GCP;
  });

  test("Check Again sets it up - the mode picked from the project's tier - and records it enforcing", async () => {
    const row: SecurityBlockCloudWaf = picked({
      index: 1,
      cloudProvider: CloudProvider.GCP,
      wafId: FAKE_ARMOR_POLICY_ID,
      name: "prod-lb",
    });

    const checked: SecurityBlockCloudWaf = await check(row);

    expect(checked.status).toBe(SecurityBlockCloudWafStatus.Enforcing);
    expect(rows.get(row._id!)!.ruleDetails).toEqual(
      expect.objectContaining({ mode: "rules", tier: "CA_STANDARD" }),
    );
  });

  test("Remove keeps the project's address groups while another of its policies uses them, and deletes them with the last", async () => {
    armor.setTier("CA_ENTERPRISE_PAYGO");

    const first: SecurityBlockCloudWaf = picked({
      index: 1,
      cloudProvider: CloudProvider.GCP,
      wafId: FAKE_ARMOR_POLICY_ID,
      name: "prod-lb",
    });

    await check(first);

    // Another policy of the project, in address groups mode too.
    const second: SecurityBlockCloudWaf = picked({
      index: 2,
      cloudProvider: CloudProvider.GCP,
      wafId: "projects/acme-prod/global/securityPolicies/staging-lb",
      name: "staging-lb",
    });

    second.ruleDetails = {
      ...(rows.get(first._id!)!.ruleDetails as JSONObject),
    };

    expect((await remove(first)).leftInCloud).toEqual([]);
    expect(armor.group(`oneuptime-${SUFFIX}-block-ipv4`)).toBeDefined();
    expect(armor.ruleAt(FAKE_ARMOR_POLICY_ID, 0)).toBeUndefined();

    // From OneUptime only, the last one: its rule and the groups are named as left.
    expect((await remove(second, true)).leftInCloud).toEqual([
      {
        kind: SecurityBlockCloudWafLeftKind.PriorityRule,
        name: "priority 0",
        webAcl: "staging-lb",
        priority: 0,
      },
      {
        kind: SecurityBlockCloudWafLeftKind.AddressGroup,
        name: `oneuptime-${SUFFIX}-block-ipv4`,
      },
      {
        kind: SecurityBlockCloudWafLeftKind.AddressGroup,
        name: `oneuptime-${SUFFIX}-block-ipv6`,
      },
    ]);
  });

  test("the access check asks testIamPermissions on the policy's project, and gives the lines that grant the role there", async () => {
    inventoried({
      cloudProvider: CloudProvider.GCP,
      providerResourceId: FAKE_ARMOR_POLICY_ID,
      name: "prod-lb",
    });
    armor.setGranted(["compute.securityPolicies.get"]);

    const access: SecurityBlockCloudWafAccess =
      await SecurityBlockCloudWafs.checkAccess({
        projectId: PROJECT_ID,
        cloudResourceId: RESOURCE_ID,
      });

    expect(access.isGranted).toBe(false);
    expect(access.shell).toBe("gcp");
    expect(access.checks[0]).toEqual({
      permission: "compute.securityPolicies.get",
      isGranted: true,
    });
    expect(access.command).toContain(
      `--member "serviceAccount:${FAKE_GCP_SERVICE_ACCOUNT_EMAIL}"`,
    );
    expect(access.command).toContain(
      "--role projects/acme-prod/roles/oneuptimeCloudArmorBlocklist",
    );
  });
});
