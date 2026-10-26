import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { FakeResponse } from "../LlmObservability/FakeProviderApi";
import AwsCloudConnector from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudConnector";
import { AssumedRoleCache } from "../../../../Server/Utils/CloudConnection/Aws/AwsSts";
import AwsServerIdentity from "../../../../Server/Utils/CloudConnection/Aws/AwsServerIdentity";
import {
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudInventoryItem,
  CloudInventoryResult,
  CloudReadBudget,
  CloudReadResult,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudRelationshipKind } from "../../../../Types/Cloud/CloudInventory";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionSetupScope } from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import {
  FAKE_ACCOUNT_ID,
  FakeAws,
  FakeMetric,
  awsError,
  createFakeAws,
} from "./FakeAwsApi";

/*
 * An AWS account's inventory and a whole AWS Organization, against a fake
 * AWS: every listed type in every Region the account's metrics live in
 * (and us-east-1 for CloudFront), each resource the one its metrics name,
 * a type the role may not list said once and never taken for empty, ECS
 * services listed inside their clusters - and an organization read through
 * the same role, by name, in each of its accounts, a member without it a
 * warning rather than the read's failure.
 */

const PROJECT: string = "11111111-1111-4111-8111-111111111111";
const ACCESS_KEY_ID: string = "AKIAIOSFODNN7EXAMPLE";
const SECRET: string = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const MANAGEMENT: string = "123456789012";
const MEMBER: string = "210987654321";
const NO_ROLE: string = "333333333333";
const ROLE_ARN: string = `arn:aws:iam::${MANAGEMENT}:role/OneUptimeReadOnly-5f3a9c1e`;
const NOW: Date = new Date("2026-10-21T12:07:00Z");
const WINDOW_END_S: number = Date.UTC(2026, 9, 21, 11, 55) / 1000;

const connector: AwsCloudConnector = new AwsCloudConnector();

function keySettings(config: JSONObject = {}): CloudConnectionSettings {
  return {
    provider: CloudProvider.AWS,
    projectId: PROJECT,
    config: {
      authMethod: CloudConnectionAuthMethod.AwsAccessKey,
      accessKeyId: ACCESS_KEY_ID,
      ...config,
    },
    secrets: { secretAccessKey: SECRET },
  };
}

function organizationSettings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.AWS,
    projectId: PROJECT,
    config: {
      authMethod: CloudConnectionAuthMethod.AwsRole,
      roleArn: ROLE_ARN,
      readScope: CloudConnectionSetupScope.Organization,
    },
    secrets: {},
  };
}

function inventoryOptions(
  fake: FakeAws,
  state: CloudConnectionPullState,
  maxRequests: number = 1500,
): Parameters<NonNullable<AwsCloudConnector["readInventory"]>>[1] {
  return {
    transport: fake.transport,
    now: () => {
      return NOW;
    },
    sleep: async () => {},
    state,
    connectionId: "33333333-3333-4333-8333-333333333333",
    budget: new CloudReadBudget({ maxRequests, maxDurationMs: 60000 }),
  };
}

function readOptions(
  fake: FakeAws,
  state: CloudConnectionPullState = {},
): Parameters<AwsCloudConnector["read"]>[1] {
  return {
    transport: fake.transport,
    now: () => {
      return NOW;
    },
    sleep: async () => {},
    state,
    serviceName: "Amazon Web Services",
    connectionId: "33333333-3333-4333-8333-333333333333",
    maxRequests: 3000,
    maxDurationMs: 60000,
  };
}

function cpu(instanceId: string): Array<FakeMetric> {
  return [
    {
      namespace: "AWS/EC2",
      metricName: "CPUUtilization",
      dimensions: [["InstanceId", instanceId]],
      values: [[WINDOW_END_S - 3600, 40]],
    },
  ];
}

const CLUSTER_ARN: string = `arn:aws:ecs:eu-west-1:${FAKE_ACCOUNT_ID}:cluster/orders`;

beforeEach(() => {
  delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
  delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
  AssumedRoleCache.clear();
  AwsServerIdentity.clearCache();
});

afterEach(() => {
  delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
  delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
});

function giveOneUptimeAnAwsIdentity(): void {
  process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"] = "AKIAONEUPTIMESERVER1";
  process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"] =
    "oneuptime-server-secret";
}

describe("an account's inventory", () => {
  test("lists every type in each Region its metrics live in, and CloudFront in us-east-1, named by the account's alias", async () => {
    const fake: FakeAws = createFakeAws({
      accountAlias: "acme-production",
      regions: {
        "eu-west-1": {
          metrics: [],
          resources: {
            "AWS::EC2::Instance": [
              {
                Identifier: "i-0abc",
                Properties: {
                  InstanceType: "m5.large",
                  Tags: [{ Key: "Name", Value: "web-1" }],
                },
              },
            ],
            "AWS::ECS::Cluster": [
              {
                Identifier: "orders",
                Properties: { ClusterName: "orders", Arn: CLUSTER_ARN },
              },
            ],
            "AWS::ECS::Service": [
              {
                Identifier: "svc",
                Properties: {
                  ServiceName: "api",
                  Cluster: CLUSTER_ARN,
                },
              },
            ],
          },
        },
        "us-east-1": {
          metrics: [],
          resources: {
            "AWS::CloudFront::Distribution": [
              {
                Identifier: "E2ABC",
                Properties: { DomainName: "d1.cloudfront.net" },
              },
            ],
          },
        },
      },
    });

    const result: CloudInventoryResult = await connector.readInventory(
      keySettings(),
      inventoryOptions(fake, {
        accounts: [FAKE_ACCOUNT_ID],
        activePairs: ["eu-west-1|AWS/EC2"],
      }),
    );

    expect(result.accounts).toEqual([
      { accountId: FAKE_ACCOUNT_ID, name: "acme-production" },
    ]);
    expect(
      result.items.map((item: CloudInventoryItem): string => {
        return `${item.resource.resourceType} ${item.resource.region} ${item.displayName || ""}`;
      }),
    ).toEqual([
      "AWS::EC2::Instance eu-west-1 web-1",
      "AWS::ECS::Cluster eu-west-1 ",
      "AWS::ECS::Service eu-west-1 api",
      "AWS::CloudFront::Distribution us-east-1 ",
    ]);

    // CloudFront only where its metrics are.
    expect(
      fake.cloudControlCalls.filter((call: { typeName: string }): boolean => {
        return call.typeName === "AWS::CloudFront::Distribution";
      }),
    ).toEqual([expect.objectContaining({ region: "us-east-1" })]);

    // Services inside each cluster, by the cluster's ARN.
    expect(
      fake.cloudControlCalls.filter((call: { typeName: string }): boolean => {
        return call.typeName === "AWS::ECS::Service";
      }),
    ).toEqual([
      expect.objectContaining({
        region: "eu-west-1",
        resourceModel: JSON.stringify({ Cluster: CLUSTER_ARN }),
      }),
    ]);

    const service: CloudInventoryItem = result.items.find(
      (item: CloudInventoryItem): boolean => {
        return item.resource.resourceType === "AWS::ECS::Service";
      },
    )!;
    expect(service.relationships[0]).toEqual({
      kind: CloudRelationshipKind.PartOf,
      target: CLUSTER_ARN,
      targetType: "AWS::ECS::Cluster",
    });

    // Every type answered in every Region it was asked in: listed in full, Region by Region.
    expect(result.complete).toBe(true);
    expect(
      result.completelyListed.map(
        (entry: { accountId: string; regions?: Array<string> | undefined }) => {
          return `${entry.accountId} ${(entry.regions || []).join(",")}`;
        },
      ),
    ).toEqual([`${FAKE_ACCOUNT_ID} eu-west-1`, `${FAKE_ACCOUNT_ID} us-east-1`]);
    expect(result.completelyListed[0]!.resourceTypes).toContain(
      "AWS::EC2::Instance",
    );
    expect(result.completelyListed[0]!.resourceTypes).not.toContain(
      "AWS::ElasticLoadBalancingV2::TargetGroup",
    );
    // CloudFront is listed in us-east-1 alone.
    expect(result.completelyListed[0]!.resourceTypes).not.toContain(
      "AWS::CloudFront::Distribution",
    );
    expect(result.completelyListed[1]!.resourceTypes).toContain(
      "AWS::CloudFront::Distribution",
    );
  });

  test("a Region the connection names that the account has not opted in to is skipped with a warning, not a failed read", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": { metrics: [] },
        "eu-west-1": {
          metrics: [],
          resources: {
            "AWS::Lambda::Function": [
              { Identifier: "resize", Properties: { Runtime: "nodejs22.x" } },
            ],
          },
        },
        // af-south-1 is not there: it answers as an unknown credential.
      },
    });

    const result: CloudInventoryResult = await connector.readInventory(
      keySettings({ regions: "eu-west-1, af-south-1" }),
      inventoryOptions(fake, { accounts: [FAKE_ACCOUNT_ID] }),
    );

    expect(result.items).toHaveLength(1);
    expect(result.warnings).toContain(
      "Could not list the resources in af-south-1: the Region is not enabled for the account.",
    );
    expect(
      result.completelyListed.map(
        (entry: { regions?: Array<string> | undefined }): string => {
          return (entry.regions || []).join(",");
        },
      ),
    ).toEqual(["eu-west-1", "us-east-1"]);
  });

  test("a credential refused in the home Region is refused: the listing fails", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "eu-west-1": { metrics: [] },
        // us-east-1 is not there: it answers as an unknown credential.
      },
    });

    await expect(
      connector.readInventory(
        keySettings({ regions: "eu-west-1" }),
        inventoryOptions(fake, { accounts: [FAKE_ACCOUNT_ID] }),
      ),
    ).rejects.toThrow("security token");
  });

  test("a GovCloud account's global types are listed in GovCloud's home Region, never us-east-1", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-gov-west-1": { metrics: [] },
        "us-gov-east-1": { metrics: [] },
      },
    });

    const result: CloudInventoryResult = await connector.readInventory(
      keySettings({ regions: "us-gov-east-1" }),
      inventoryOptions(fake, { accounts: [FAKE_ACCOUNT_ID] }),
    );

    expect(
      Array.from(
        new Set(
          fake.cloudControlCalls.map((call: { region: string }): string => {
            return call.region;
          }),
        ),
      ).sort(),
    ).toEqual(["us-gov-east-1", "us-gov-west-1"]);
    expect(
      fake.cloudControlCalls.filter((call: { typeName: string }): boolean => {
        return call.typeName === "AWS::CloudFront::Distribution";
      }),
    ).toEqual([expect.objectContaining({ region: "us-gov-west-1" })]);
    expect(result.complete).toBe(true);
  });

  test("a type the role may not list is said once, with what to do - and is never taken for empty", async () => {
    const refused: FakeResponse = awsError(
      403,
      "AccessDeniedException",
      "User is not authorized to perform: cloudformation:ListResources",
    );
    const fake: FakeAws = createFakeAws({
      regions: {
        "eu-west-1": {
          metrics: [],
          resourceErrors: { "AWS::RDS::DBInstance": refused },
        },
        "us-east-1": {
          metrics: [],
          resourceErrors: { "AWS::RDS::DBInstance": refused },
        },
      },
    });

    const result: CloudInventoryResult = await connector.readInventory(
      keySettings(),
      inventoryOptions(fake, {
        accounts: [FAKE_ACCOUNT_ID],
        activePairs: ["eu-west-1|AWS/EC2"],
      }),
    );

    expect(
      result.warnings.filter((warning: string): boolean => {
        return warning.includes("AWS::RDS::DBInstance");
      }),
    ).toEqual([
      "The role may not list AWS::RDS::DBInstance. Run the setup command again to allow it.",
    ]);
    expect(result.completelyListed[0]!.resourceTypes).not.toContain(
      "AWS::RDS::DBInstance",
    );
    expect(result.completelyListed[0]!.resourceTypes).toContain(
      "AWS::EC2::Instance",
    );
  });

  test("a type Cloud Control cannot list in a Region is listed - as nothing - not failed", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": {
          metrics: [],
          resourceErrors: {
            "AWS::AppRunner::Service": awsError(
              400,
              "UnsupportedActionException",
              "Resource type AWS::AppRunner::Service does not support LIST action",
            ),
          },
        },
      },
    });

    const result: CloudInventoryResult = await connector.readInventory(
      keySettings(),
      inventoryOptions(fake, { accounts: [FAKE_ACCOUNT_ID] }),
    );

    expect(result.warnings).toEqual([]);
    expect(result.completelyListed[0]!.resourceTypes).toContain(
      "AWS::AppRunner::Service",
    );
  });

  test("a spent budget stops the listing part way: the types not reached are not listed in full", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: [] } },
    });

    const result: CloudInventoryResult = await connector.readInventory(
      keySettings(),
      inventoryOptions(fake, { accounts: [FAKE_ACCOUNT_ID] }, 3),
    );

    expect(result.complete).toBe(false);
    // The three types it reached, listed to their last page: only those may archive.
    expect(result.completelyListed).toEqual([
      {
        accountId: FAKE_ACCOUNT_ID,
        regions: ["us-east-1"],
        resourceTypes: [
          "AWS::EC2::Instance",
          "AWS::EC2::Volume",
          "AWS::EC2::VPC",
        ],
      },
    ]);
  });

  test("Regions the connection names are listed, whatever the metrics found", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": { metrics: [] },
        "ap-south-1": { metrics: [] },
      },
    });

    await connector.readInventory(
      keySettings({ regions: "ap-south-1" }),
      inventoryOptions(fake, { accounts: [FAKE_ACCOUNT_ID] }),
    );

    expect(
      Array.from(
        new Set(
          fake.cloudControlCalls.map((call: { region: string }): string => {
            return call.region;
          }),
        ),
      ).sort(),
    ).toEqual(["ap-south-1", "us-east-1"]);
  });
});

describe("an organization", () => {
  test("is read through a role only", () => {
    expect(() => {
      connector.validateSettings(
        keySettings({ readScope: CloudConnectionSetupScope.Organization }),
      );
    }).toThrow(BadDataException);
  });

  test("a member account is read through the same role, by name, in that account; the management account through its own", () => {
    expect(
      connector.settingsForAccount(organizationSettings(), MEMBER).config[
        "roleArn"
      ],
    ).toBe(`arn:aws:iam::${MEMBER}:role/OneUptimeReadOnly-5f3a9c1e`);
    expect(
      connector.settingsForAccount(organizationSettings(), MANAGEMENT),
    ).toEqual(organizationSettings());
    expect(
      connector.settingsForAccount(
        {
          ...organizationSettings(),
          config: {
            ...organizationSettings().config,
            roleArn: `arn:aws-us-gov:iam::${MANAGEMENT}:role/path/Reader`,
          },
        },
        MEMBER,
      ).config["roleArn"],
    ).toBe(`arn:aws-us-gov:iam::${MEMBER}:role/path/Reader`);
  });

  test("every account is read, each with its own state; a member without the role is a warning, not the read's failure", async () => {
    giveOneUptimeAnAwsIdentity();

    const fake: FakeAws = createFakeAws({
      account: MANAGEMENT,
      organizationAccounts: [
        { Id: MANAGEMENT, Name: "Management", Status: "ACTIVE" },
        { Id: MEMBER, Name: "Production", Status: "ACTIVE" },
        { Id: NO_ROLE, Name: "Sandbox", Status: "ACTIVE" },
        { Id: "444444444444", Name: "Closed", Status: "SUSPENDED" },
      ],
      refusedRoles: [`arn:aws:iam::${NO_ROLE}:role/OneUptimeReadOnly-5f3a9c1e`],
      regions: { "eu-west-1": { metrics: cpu("i-0abc") } },
    });

    const result: CloudReadResult = await connector.read(
      {
        ...organizationSettings(),
        config: { ...organizationSettings().config, regions: "eu-west-1" },
      },
      readOptions(fake),
    );

    expect(fake.organizationsCalls).toHaveLength(1);
    expect(result.accounts.sort()).toEqual([MEMBER, MANAGEMENT].sort());

    // Each account's instance is a resource of that account.
    expect(
      result.resources
        .map((entry: { resource: { accountId: string } }): string => {
          return entry.resource.accountId;
        })
        .sort(),
    ).toEqual([MEMBER, MANAGEMENT].sort());

    expect(
      result.warnings.some((warning: string): boolean => {
        return warning.startsWith(`Could not sign in to Sandbox (${NO_ROLE})`);
      }),
    ).toBe(true);
    // A suspended account is not even tried.
    expect(
      fake.assumedRoles.some((role: string): boolean => {
        return role.includes("444444444444");
      }),
    ).toBe(false);

    const state: CloudConnectionPullState = result.nextState;
    expect(Object.keys(state.accountStates || {}).sort()).toEqual(
      [MANAGEMENT, MEMBER, NO_ROLE].sort(),
    );
    expect(state.organizationAccounts).toEqual([
      { id: MANAGEMENT, name: "Management" },
      { id: MEMBER, name: "Production" },
      { id: NO_ROLE, name: "Sandbox" },
    ]);

    // The next read, within a day, does not list the organization again.
    await connector.read(
      {
        ...organizationSettings(),
        config: { ...organizationSettings().config, regions: "eu-west-1" },
      },
      readOptions(fake, state),
    );

    expect(fake.organizationsCalls).toHaveLength(1);
  });

  test("an account's State says whether it is read: Status, which AWS retired, only when State is absent", async () => {
    giveOneUptimeAnAwsIdentity();

    const fake: FakeAws = createFakeAws({
      account: MANAGEMENT,
      organizationAccounts: [
        { Id: MANAGEMENT, Name: "Management", State: "ACTIVE" },
        // No Status at all, as AWS answers since 9 September 2026.
        { Id: MEMBER, Name: "Production", State: "ACTIVE" },
        { Id: "444444444444", Name: "Suspended", State: "SUSPENDED" },
        { Id: "555555555555", Name: "Closing", State: "PENDING_CLOSURE" },
        { Id: "666666666666", Name: "Closed", State: "CLOSED" },
        { Id: "777777777777", Name: "New", State: "PENDING_ACTIVATION" },
        // An older answer, with Status alone.
        { Id: "888888888888", Name: "Old answer", Status: "SUSPENDED" },
      ],
      regions: { "eu-west-1": { metrics: cpu("i-0abc") } },
    });

    const result: CloudReadResult = await connector.read(
      {
        ...organizationSettings(),
        config: { ...organizationSettings().config, regions: "eu-west-1" },
      },
      readOptions(fake),
    );

    expect(result.nextState.organizationAccounts).toEqual([
      { id: MANAGEMENT, name: "Management" },
      { id: MEMBER, name: "Production" },
    ]);
    expect(
      fake.assumedRoles.filter((role: string): boolean => {
        return (
          role.includes("444444444444") ||
          role.includes("555555555555") ||
          role.includes("666666666666") ||
          role.includes("777777777777") ||
          role.includes("888888888888")
        );
      }),
    ).toEqual([]);
  });

  test("an organization of more accounts than one connection reads says so, and reads the first fifty", async () => {
    giveOneUptimeAnAwsIdentity();

    const accounts: Array<{ Id: string; Name: string; State: string }> = [];

    for (let index: number = 0; index < 60; index++) {
      accounts.push({
        Id: String(100000000000 + index),
        Name: `Account ${index}`,
        State: "ACTIVE",
      });
    }

    const fake: FakeAws = createFakeAws({
      account: MANAGEMENT,
      organizationAccounts: accounts,
      regions: { "eu-west-1": { metrics: [] } },
    });

    const result: CloudReadResult = await connector.read(
      {
        ...organizationSettings(),
        config: { ...organizationSettings().config, regions: "eu-west-1" },
      },
      readOptions(fake),
    );

    expect(result.nextState.organizationAccounts).toHaveLength(50);
    expect(result.nextState.organizationAccountCount).toBe(60);
    expect(result.warnings[0]).toBe(
      "The organization has 60 accounts: this connection reads the first 50. Connect the others with a connection of their own.",
    );
  });

  test("the account read least recently is read first, so a read that stops at its limit reaches the rest next time", async () => {
    giveOneUptimeAnAwsIdentity();

    const fake: FakeAws = createFakeAws({
      account: MANAGEMENT,
      regions: { "eu-west-1": { metrics: cpu("i-0abc") } },
    });
    const state: CloudConnectionPullState = {
      organizationAccounts: [
        { id: MANAGEMENT, name: "Management" },
        { id: MEMBER, name: "Production" },
      ],
      organizationListedAt: NOW.toISOString(),
      accountStates: {
        [MANAGEMENT]: {
          accounts: [MANAGEMENT],
          metricsReadAt: new Date(NOW.getTime() - 60000).toISOString(),
        },
        // Never read: it goes first.
        [MEMBER]: { accounts: [MEMBER] },
      },
    };

    const result: CloudReadResult = await connector.read(
      {
        ...organizationSettings(),
        config: { ...organizationSettings().config, regions: "eu-west-1" },
      },
      readOptions(fake, state),
    );

    expect(fake.assumedRoles[0]).toContain(MEMBER);
    // Both read now: each marked, for next time.
    expect(result.nextState.accountStates?.[MEMBER]?.metricsReadAt).toBe(
      NOW.toISOString(),
    );
    expect(result.nextState.accountStates?.[MANAGEMENT]?.metricsReadAt).toBe(
      NOW.toISOString(),
    );
  });

  test("its inventory lists each account through its role, named as Organizations names it", async () => {
    giveOneUptimeAnAwsIdentity();

    const fake: FakeAws = createFakeAws({
      account: MANAGEMENT,
      accountAlias: "an-alias",
      regions: {
        "us-east-1": {
          metrics: [],
          resources: {
            "AWS::Lambda::Function": [
              { Identifier: "resize", Properties: { Runtime: "nodejs22.x" } },
            ],
          },
        },
      },
    });

    const result: CloudInventoryResult = await connector.readInventory(
      organizationSettings(),
      inventoryOptions(fake, {
        organizationAccounts: [
          { id: MANAGEMENT, name: "Management" },
          { id: MEMBER, name: "Production" },
        ],
        accountStates: {
          [MANAGEMENT]: { accounts: [MANAGEMENT] },
          [MEMBER]: { accounts: [MEMBER] },
        },
      }),
    );

    expect(result.accounts).toEqual([
      { accountId: MANAGEMENT, name: "Management" },
      { accountId: MEMBER, name: "Production" },
    ]);
    expect(
      result.items.map((item: CloudInventoryItem): string => {
        return item.resource.accountId;
      }),
    ).toEqual([MANAGEMENT, MEMBER]);
    expect(
      Array.from(
        new Set(
          fake.cloudControlCalls.map((call: { account: string }): string => {
            return call.account;
          }),
        ),
      ).sort(),
    ).toEqual([MANAGEMENT, MEMBER].sort());
  });
});
