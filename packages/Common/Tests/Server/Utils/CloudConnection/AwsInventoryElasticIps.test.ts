import { describe, expect, test } from "@jest/globals";
import { FakeResponse } from "../LlmObservability/FakeProviderApi";
import AwsCloudConnector from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudConnector";
import { AwsListedResource } from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudControl";
import {
  AwsInventoryContext,
  AwsInventoryType,
  ELASTIC_IP,
  NAT_GATEWAY,
  addAwsNatGatewayAddresses,
  buildAwsInventoryItem,
  getAwsInventoryRowTypes,
  getAwsInventoryType,
  getElasticIpAddress,
  getElasticIpAllocationId,
  getNatGatewayAllocationIds,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsInventoryCatalog";
import {
  CloudConnectionSettings,
  CloudInventoryItem,
  CloudInventoryResult,
  CloudReadBudget,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { flattenCloudProperties } from "../../../../Types/Cloud/CloudInventory";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  getCloudResourceTypeDescriptor,
  isInventoryOnlyCloudResourceType,
} from "../../../../Types/Cloud/CloudResourceCatalog";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  AWS_READ_ONLY_ACTIONS,
  isAwsActionGranted,
} from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { JSONObject } from "../../../../Types/JSON";
import {
  FAKE_ACCOUNT_ID,
  FakeAws,
  awsError,
  createFakeAws,
} from "./FakeAwsApi";

/*
 * WHERE A PROJECT'S AWS TRAFFIC LEAVES FROM (#10504): the account's Elastic
 * IPs, listed through Cloud Control as resources of their own with their
 * address as an endpoint, and each NAT gateway's public addresses - the
 * Elastic IPs its allocations name - kept on its row. The blocklist reads
 * both (SecurityProtectedAddresses' cloud resources) and never blocks them.
 * The fixtures are what Cloud Control answers for each type.
 */

const context: AwsInventoryContext = {
  accountId: FAKE_ACCOUNT_ID,
  region: "eu-west-1",
};

function listed(
  identifier: string,
  properties: JSONObject = {},
): AwsListedResource {
  return { identifier, properties };
}

function type(name: string): AwsInventoryType {
  const found: AwsInventoryType | null = getAwsInventoryType(name);

  if (!found) {
    throw new Error(`no inventory type ${name}`);
  }

  return found;
}

function item(name: string, resource: AwsListedResource): CloudInventoryItem {
  const built: CloudInventoryItem | null = buildAwsInventoryItem(
    type(name),
    resource,
    context,
  );

  if (!built) {
    throw new Error(`${name} ${resource.identifier} made no item`);
  }

  return built;
}

// As Cloud Control lists one: by its address and allocation together.
const NAT_EIP: AwsListedResource = listed("34.240.10.20|eipalloc-0nat", {
  PublicIp: "34.240.10.20",
  AllocationId: "eipalloc-0nat",
  Domain: "vpc",
  NetworkBorderGroup: "eu-west-1",
  PublicIpv4Pool: "amazon",
  Tags: [{ Key: "Name", Value: "nat-a-eip" }],
});

const SECONDARY_EIP: AwsListedResource = listed(
  "34.240.10.21|eipalloc-0second",
  { PublicIp: "34.240.10.21", AllocationId: "eipalloc-0second" },
);

const INSTANCE_EIP: AwsListedResource = listed(
  "52.18.1.9|eipalloc-0web",
  {
    PublicIp: "52.18.1.9",
    AllocationId: "eipalloc-0web",
    InstanceId: "i-0web",
  },
);

const NAT_A: AwsListedResource = listed("nat-0aaa", {
  NatGatewayId: "nat-0aaa",
  ConnectivityType: "public",
  SubnetId: "subnet-0pub",
  VpcId: "vpc-0abc",
  AllocationId: "eipalloc-0nat",
  SecondaryAllocationIds: ["eipalloc-0second"],
  PrivateIpAddress: "10.0.0.12",
});

describe("an Elastic IP", () => {
  test("is a resource of its own, identified by its allocation, named by its address, its address an endpoint", () => {
    const built: CloudInventoryItem = item(ELASTIC_IP, INSTANCE_EIP);

    expect(built.resource.resourceType).toBe(ELASTIC_IP);
    expect(built.resource.name).toBe("eipalloc-0web");
    expect(built.displayName).toBe("52.18.1.9");
    expect(built.resource.providerResourceId).toBe(
      `arn:aws:ec2:eu-west-1:${FAKE_ACCOUNT_ID}:elastic-ip/eipalloc-0web`,
    );
    expect(built.endpoints).toEqual(["52.18.1.9"]);
    expect(built.properties).toEqual({
      PublicIp: "52.18.1.9",
      AllocationId: "eipalloc-0web",
      InstanceId: "i-0web",
    });
  });

  test("its Name tag names it, as an instance's does", () => {
    expect(item(ELASTIC_IP, NAT_EIP).displayName).toBe("nat-a-eip");
  });

  test("is read from the identifier Cloud Control lists it by when its properties leave a part out", () => {
    const bare: AwsListedResource = listed("3.250.7.7|eipalloc-0bare");

    expect(getElasticIpAddress(bare)).toBe("3.250.7.7");
    expect(getElasticIpAllocationId(bare)).toBe("eipalloc-0bare");
    expect(item(ELASTIC_IP, bare).endpoints).toEqual(["3.250.7.7"]);

    // An address with no allocation (EC2-Classic) is named by its address.
    expect(getElasticIpAllocationId(listed("3.250.7.8"))).toBe("3.250.7.8");
  });

  test("is listed as a resource with no metrics of its own, quietly when an older role may not list it", () => {
    expect(getAwsInventoryRowTypes()).toContain(ELASTIC_IP);
    expect(type(ELASTIC_IP).metrics).toBeUndefined();
    expect(type(ELASTIC_IP).quietWhenRefused).toBe(true);
    expect(isInventoryOnlyCloudResourceType(CloudProvider.AWS, ELASTIC_IP)).toBe(
      true,
    );
    expect(
      getCloudResourceTypeDescriptor(CloudProvider.AWS, ELASTIC_IP)?.label,
    ).toBe("Elastic IP");
  });

  test("the role the setup command makes may list them: Cloud Control's read of AWS::EC2::EIP calls ec2:DescribeAddresses", () => {
    expect(AWS_READ_ONLY_ACTIONS).toContain("ec2:DescribeAddresses");
    expect(isAwsActionGranted("ec2:DescribeNatGateways")).toBe(true);
  });
});

describe("a NAT gateway's public addresses", () => {
  test("are the Elastic IPs its allocations name: its own and its secondary ones, as endpoints and as PublicIps", () => {
    const nat: CloudInventoryItem = item(NAT_GATEWAY, NAT_A);
    const eips: Array<AwsListedResource> = [NAT_EIP, SECONDARY_EIP, INSTANCE_EIP];
    const items: Array<CloudInventoryItem> = [nat];

    addAwsNatGatewayAddresses({
      items,
      elasticIps: eips,
      listedByItem: new Map([[nat, NAT_A]]),
    });

    expect(nat.endpoints).toEqual(["34.240.10.20", "34.240.10.21"]);
    expect(nat.properties["PublicIps"]).toEqual([
      "34.240.10.20",
      "34.240.10.21",
    ]);
    /*
     * The protected addresses read a row's endpoints, address by address;
     * its properties, shown on its page, list them on one line.
     */
    expect(flattenCloudProperties(nat.properties)["PublicIps"]).toBe(
      "34.240.10.20, 34.240.10.21",
    );
    expect(nat.properties["AllocationId"]).toBe("eipalloc-0nat");
  });

  test("a regional NAT gateway's addresses are those of every Availability Zone's allocations", () => {
    expect(
      getNatGatewayAllocationIds({
        AvailabilityMode: "regional",
        AvailabilityZoneAddresses: [
          { AvailabilityZone: "eu-west-1a", AllocationIds: ["eipalloc-0a"] },
          {
            AvailabilityZone: "eu-west-1b",
            AllocationIds: ["eipalloc-0b", "eipalloc-0c"],
          },
        ],
      }),
    ).toEqual(["eipalloc-0a", "eipalloc-0b", "eipalloc-0c"]);
  });

  test("a private NAT gateway, and one whose Elastic IPs were not listed, keeps the row it had", () => {
    const privateNat: AwsListedResource = listed("nat-0private", {
      ConnectivityType: "private",
      SubnetId: "subnet-0priv",
      PrivateIpAddress: "10.0.5.5",
    });
    const nat: CloudInventoryItem = item(NAT_GATEWAY, privateNat);
    const publicNat: CloudInventoryItem = item(NAT_GATEWAY, NAT_A);

    addAwsNatGatewayAddresses({
      items: [nat],
      elasticIps: [NAT_EIP],
      listedByItem: new Map([[nat, privateNat]]),
    });
    addAwsNatGatewayAddresses({
      items: [publicNat],
      elasticIps: [],
      listedByItem: new Map([[publicNat, NAT_A]]),
    });

    expect(nat.endpoints).toEqual([]);
    expect(nat.properties["PublicIps"]).toBeUndefined();
    expect(publicNat.endpoints).toEqual([]);
    expect(publicNat.properties["PublicIps"]).toBeUndefined();
  });
});

const connector: AwsCloudConnector = new AwsCloudConnector();

function keySettings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.AWS,
    projectId: "11111111-1111-4111-8111-111111111111",
    config: {
      authMethod: CloudConnectionAuthMethod.AwsAccessKey,
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    },
    secrets: { secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
  };
}

async function readInventory(fake: FakeAws): Promise<CloudInventoryResult> {
  return await connector.readInventory(keySettings(), {
    transport: fake.transport,
    now: () => {
      return new Date("2026-11-21T12:07:00Z");
    },
    sleep: async () => {},
    state: { accounts: [FAKE_ACCOUNT_ID], activePairs: ["eu-west-1|AWS/EC2"] },
    connectionId: "33333333-3333-4333-8333-333333333333",
    budget: new CloudReadBudget({ maxRequests: 1500, maxDurationMs: 60000 }),
  });
}

function asCloudControl(
  resource: AwsListedResource,
): { Identifier: string; Properties: JSONObject } {
  return { Identifier: resource.identifier, Properties: resource.properties };
}

describe("an account's inventory, against a fake AWS", () => {
  test("lists the Region's Elastic IPs, and gives each NAT gateway its public addresses", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "eu-west-1": {
          metrics: [],
          resources: {
            [ELASTIC_IP]: [
              asCloudControl(NAT_EIP),
              asCloudControl(SECONDARY_EIP),
              asCloudControl(INSTANCE_EIP),
            ],
            [NAT_GATEWAY]: [asCloudControl(NAT_A)],
          },
        },
        "us-east-1": { metrics: [] },
      },
    });

    const result: CloudInventoryResult = await readInventory(fake);
    const inRegion: Array<CloudInventoryItem> = result.items.filter(
      (entry: CloudInventoryItem): boolean => {
        return entry.resource.region === "eu-west-1";
      },
    );

    expect(
      inRegion
        .filter((entry: CloudInventoryItem): boolean => {
          return entry.resource.resourceType === ELASTIC_IP;
        })
        .map((entry: CloudInventoryItem): Array<string> => {
          return entry.endpoints;
        }),
    ).toEqual([["34.240.10.20"], ["34.240.10.21"], ["52.18.1.9"]]);

    const nat: CloudInventoryItem = inRegion.find(
      (entry: CloudInventoryItem): boolean => {
        return entry.resource.resourceType === NAT_GATEWAY;
      },
    )!;

    expect(nat.endpoints).toEqual(["34.240.10.20", "34.240.10.21"]);
    expect(result.completelyListed[0]!.resourceTypes).toEqual(
      expect.arrayContaining([ELASTIC_IP, NAT_GATEWAY]),
    );
    // Listed through Cloud Control, whose read of an Elastic IP calls ec2:DescribeAddresses.
    expect(
      fake.cloudControlCalls.map((call: { typeName: string }): string => {
        return call.typeName;
      }),
    ).toContain(ELASTIC_IP);
  });

  test("a role set up before they were listed is not warned about, nothing of them is taken for gone, and its NAT gateways keep the rows they had", async () => {
    const refused: FakeResponse = awsError(
      403,
      "AccessDeniedException",
      "User is not authorized to perform: ec2:DescribeAddresses",
    );
    const fake: FakeAws = createFakeAws({
      regions: {
        "eu-west-1": {
          metrics: [],
          resources: { [NAT_GATEWAY]: [asCloudControl(NAT_A)] },
          resourceErrors: { [ELASTIC_IP]: refused },
        },
        "us-east-1": {
          metrics: [],
          resourceErrors: { [ELASTIC_IP]: refused },
        },
      },
    });

    const result: CloudInventoryResult = await readInventory(fake);

    expect(
      result.warnings.filter((warning: string): boolean => {
        return warning.includes("EIP") || warning.includes("Elastic");
      }),
    ).toEqual([]);

    for (const entry of result.completelyListed) {
      expect(entry.resourceTypes).not.toContain(ELASTIC_IP);
    }

    const nat: CloudInventoryItem = result.items.find(
      (entry: CloudInventoryItem): boolean => {
        return entry.resource.resourceType === NAT_GATEWAY;
      },
    )!;

    expect(nat.endpoints).toEqual([]);
  });
});
