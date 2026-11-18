import { describe, expect, test } from "@jest/globals";
import { FakeResponse } from "../LlmObservability/FakeProviderApi";
import AwsCloudConnector from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudConnector";
import { AwsListedResource } from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudControl";
import {
  AwsInventoryContext,
  AwsInventoryType,
  buildAwsInventoryItem,
  getAwsInventoryRowTypes,
  getAwsInventoryType,
  securityGroupRules,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsInventoryCatalog";
import {
  CloudConnectionSettings,
  CloudInventoryItem,
  CloudInventoryResult,
  CloudReadBudget,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { CloudRelationshipKind } from "../../../../Types/Cloud/CloudInventory";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CloudResourceLink,
  getCloudResourceLinks,
} from "../../../../Types/Cloud/CloudResourceIndex";
import {
  getCloudResourceTypeDescriptor,
  isInventoryOnlyCloudResourceType,
} from "../../../../Types/Cloud/CloudResourceCatalog";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { AWS_READ_ONLY_ACTIONS } from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import ObjectID from "../../../../Types/ObjectID";
import {
  FAKE_ACCOUNT_ID,
  FakeAws,
  awsError,
  createFakeAws,
} from "./FakeAwsApi";

/*
 * An AWS account's network, listed through Cloud Control (#9375), as a
 * Google Cloud project's is (#9365): its subnets and security groups are
 * Cloud Resources of their own, each in its VPC, so an instance, a load
 * balancer, a function or a database is drawn in its subnet and Connected
 * Resources says which security groups guard it. The fixtures are the
 * properties CloudFormation describes each type by, as Cloud Control
 * returns them.
 */

const context: AwsInventoryContext = {
  accountId: "123456789012",
  region: "eu-west-1",
};

const SUBNET: string = "AWS::EC2::Subnet";
const SECURITY_GROUP: string = "AWS::EC2::SecurityGroup";
const VPC: string = "AWS::EC2::VPC";

function listed(
  identifier: string,
  properties: Record<string, unknown> = {},
): AwsListedResource {
  return { identifier, properties: properties as never };
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

const SUBNET_A: AwsListedResource = listed("subnet-0aaa", {
  SubnetId: "subnet-0aaa",
  VpcId: "vpc-0abc",
  CidrBlock: "10.0.1.0/24",
  AvailabilityZone: "eu-west-1a",
  AvailabilityZoneId: "euw1-az1",
  MapPublicIpOnLaunch: false,
  Tags: [{ Key: "Name", Value: "private-a" }],
});

const WEB_SG: AwsListedResource = listed("sg-0web", {
  GroupId: "sg-0web",
  GroupName: "web",
  GroupDescription: "HTTPS from anywhere, SSH from the bastion",
  VpcId: "vpc-0abc",
  SecurityGroupIngress: [
    { IpProtocol: "tcp", FromPort: 443, ToPort: 443, CidrIp: "0.0.0.0/0" },
    {
      IpProtocol: "tcp",
      FromPort: 22,
      ToPort: 22,
      SourceSecurityGroupId: "sg-0bastion",
    },
  ],
  SecurityGroupEgress: [{ IpProtocol: "-1", CidrIp: "0.0.0.0/0" }],
});

describe("a subnet", () => {
  test("is identified by its id, in its Region, and named by its Name tag", () => {
    const subnet: CloudInventoryItem = item(SUBNET, SUBNET_A);

    expect(subnet.resource).toEqual(
      expect.objectContaining({
        provider: CloudProvider.AWS,
        resourceType: SUBNET,
        name: "subnet-0aaa",
        providerResourceId:
          "arn:aws:ec2:eu-west-1:123456789012:subnet/subnet-0aaa",
        accountId: "123456789012",
        region: "eu-west-1",
        identityKey:
          "aws|123456789012|eu-west-1|aws::ec2::subnet|subnetid=subnet-0aaa",
      }),
    );
    expect(subnet.displayName).toBe("private-a");
  });

  test("keeps its range, zone and whether it hands out public addresses, and runs in its VPC", () => {
    const subnet: CloudInventoryItem = item(SUBNET, SUBNET_A);

    expect(subnet.properties).toEqual({
      CidrBlock: "10.0.1.0/24",
      AvailabilityZone: "eu-west-1a",
      AvailabilityZoneId: "euw1-az1",
      MapPublicIpOnLaunch: false,
      VpcId: "vpc-0abc",
    });
    expect(subnet.relationships).toEqual([
      {
        kind: CloudRelationshipKind.RunsIn,
        target: "vpc-0abc",
        targetType: VPC,
      },
    ]);
  });

  test("a GovCloud subnet's ARN is GovCloud's", () => {
    expect(
      buildAwsInventoryItem(type(SUBNET), SUBNET_A, {
        accountId: "123456789012",
        region: "us-gov-west-1",
      })!.resource.providerResourceId,
    ).toBe("arn:aws-us-gov:ec2:us-gov-west-1:123456789012:subnet/subnet-0aaa");
  });
});

describe("a security group", () => {
  test("is identified by its id and named by its group name", () => {
    const group: CloudInventoryItem = item(SECURITY_GROUP, WEB_SG);

    expect(group.resource).toEqual(
      expect.objectContaining({
        resourceType: SECURITY_GROUP,
        name: "sg-0web",
        providerResourceId:
          "arn:aws:ec2:eu-west-1:123456789012:security-group/sg-0web",
        identityKey:
          "aws|123456789012|eu-west-1|aws::ec2::securitygroup|groupid=sg-0web",
      }),
    );
    expect(group.displayName).toBe("web");
  });

  test("its Name tag wins over its group name", () => {
    expect(
      item(
        SECURITY_GROUP,
        listed("sg-0web", {
          GroupName: "web",
          Tags: [{ Key: "Name", Value: "web servers" }],
        }),
      ).displayName,
    ).toBe("web servers");
  });

  test("keeps its rules as one line each, and runs in its VPC", () => {
    const group: CloudInventoryItem = item(SECURITY_GROUP, WEB_SG);

    expect(group.properties).toEqual({
      GroupName: "web",
      GroupDescription: "HTTPS from anywhere, SSH from the bastion",
      VpcId: "vpc-0abc",
      inbound: ["tcp:443 from 0.0.0.0/0", "tcp:22 from sg-0bastion"],
      outbound: ["all to 0.0.0.0/0"],
    });
    expect(group.relationships).toEqual([
      {
        kind: CloudRelationshipKind.RunsIn,
        target: "vpc-0abc",
        targetType: VPC,
      },
    ]);
  });

  test("a group with no rules keeps none, and the raw rule lists are never kept", () => {
    const group: CloudInventoryItem = item(
      SECURITY_GROUP,
      listed("sg-0empty", { GroupName: "empty", VpcId: "vpc-0abc" }),
    );

    expect(group.properties).toEqual({
      GroupName: "empty",
      VpcId: "vpc-0abc",
    });
    expect(Object.keys(item(SECURITY_GROUP, WEB_SG).properties)).not.toContain(
      "SecurityGroupIngress",
    );
  });
});

describe("securityGroupRules", () => {
  test.each([
    [
      "a port",
      { IpProtocol: "tcp", FromPort: 443, ToPort: 443, CidrIp: "0.0.0.0/0" },
      "from",
      "tcp:443 from 0.0.0.0/0",
    ],
    [
      "a range",
      { IpProtocol: "udp", FromPort: 8000, ToPort: 8100, CidrIp: "10.0.0.0/8" },
      "from",
      "udp:8000-8100 from 10.0.0.0/8",
    ],
    [
      "every protocol",
      { IpProtocol: "-1", FromPort: -1, ToPort: -1, CidrIp: "10.0.0.0/8" },
      "from",
      "all from 10.0.0.0/8",
    ],
    [
      "ICMP of any type",
      { IpProtocol: "icmp", FromPort: -1, ToPort: -1, CidrIpv6: "::/0" },
      "from",
      "icmp from ::/0",
    ],
    [
      "from another group",
      {
        IpProtocol: "tcp",
        FromPort: 5432,
        ToPort: 5432,
        SourceSecurityGroupId: "sg-0app",
      },
      "from",
      "tcp:5432 from sg-0app",
    ],
    [
      "from a prefix list",
      {
        IpProtocol: "tcp",
        FromPort: 443,
        ToPort: 443,
        SourcePrefixListId: "pl-0abc",
      },
      "from",
      "tcp:443 from pl-0abc",
    ],
    [
      "to another group",
      {
        IpProtocol: "tcp",
        FromPort: 5432,
        ToPort: 5432,
        DestinationSecurityGroupId: "sg-0db",
      },
      "to",
      "tcp:5432 to sg-0db",
    ],
    [
      "no peer",
      { IpProtocol: "tcp", FromPort: 80, ToPort: 80 },
      "from",
      "tcp:80",
    ],
  ])("%s", (_name: string, rule: unknown, peer: unknown, expected: string) => {
    expect(securityGroupRules([rule], peer as "from" | "to")).toEqual([
      expected,
    ]);
  });

  test("what is not a list of rules is no rules", () => {
    expect(securityGroupRules(undefined, "from")).toEqual([]);
    expect(securityGroupRules("tcp:22", "from")).toEqual([]);
    expect(securityGroupRules([null, "x", []], "to")).toEqual([]);
  });
});

describe("what runs in the network, drawn in it", () => {
  test("an instance in its subnet in its VPC, guarded by its security groups; a load balancer in its subnets behind its group", () => {
    const items: Array<CloudInventoryItem> = [
      item(
        VPC,
        listed("vpc-0abc", {
          CidrBlock: "10.0.0.0/16",
          Tags: [{ Key: "Name", Value: "production" }],
        }),
      ),
      item(SUBNET, SUBNET_A),
      item(
        SUBNET,
        listed("subnet-0bbb", {
          VpcId: "vpc-0abc",
          Tags: [{ Key: "Name", Value: "public-b" }],
        }),
      ),
      item(SECURITY_GROUP, WEB_SG),
      item(
        SECURITY_GROUP,
        listed("sg-0alb", { GroupName: "alb", VpcId: "vpc-0abc" }),
      ),
      item(
        "AWS::EC2::Instance",
        listed("i-0web", {
          SubnetId: "subnet-0aaa",
          VpcId: "vpc-0abc",
          SecurityGroupIds: ["sg-0web"],
          Tags: [{ Key: "Name", Value: "web-1" }],
        }),
      ),
      item(
        "AWS::ElasticLoadBalancingV2::LoadBalancer",
        listed(
          "arn:aws:elasticloadbalancing:eu-west-1:123456789012:loadbalancer/app/checkout/50dc6c495c0c9188",
          {
            Type: "application",
            LoadBalancerName: "checkout",
            Subnets: ["subnet-0bbb"],
            SecurityGroups: ["sg-0alb"],
          },
        ),
      ),
    ];
    const ids: Map<CloudInventoryItem, ObjectID> = new Map(
      items.map((entry: CloudInventoryItem) => {
        return [entry, ObjectID.generate()];
      }),
    );
    const nameOf: Map<string, string> = new Map(
      items.map((entry: CloudInventoryItem) => {
        return [
          ids.get(entry)!.toString(),
          `${entry.resource.resourceType}:${entry.displayName || entry.resource.name}`,
        ];
      }),
    );
    const links: Array<CloudResourceLink> = getCloudResourceLinks(
      items.map((entry: CloudInventoryItem) => {
        return {
          id: ids.get(entry)!,
          name: entry.resource.name,
          providerResourceId: entry.resource.providerResourceId,
          type: entry.resource.resourceType,
          relationships: entry.relationships,
        };
      }),
    );

    expect(
      links
        .map((link: CloudResourceLink): string => {
          return `${nameOf.get(link.fromId)} ${link.kind} ${nameOf.get(link.toId)}`;
        })
        .sort(),
    ).toEqual(
      [
        "AWS::EC2::Subnet:private-a runs-in AWS::EC2::VPC:production",
        "AWS::EC2::Subnet:public-b runs-in AWS::EC2::VPC:production",
        "AWS::EC2::SecurityGroup:web runs-in AWS::EC2::VPC:production",
        "AWS::EC2::SecurityGroup:alb runs-in AWS::EC2::VPC:production",
        "AWS::EC2::Instance:web-1 runs-in AWS::EC2::Subnet:private-a",
        "AWS::EC2::Instance:web-1 runs-in AWS::EC2::VPC:production",
        "AWS::EC2::Instance:web-1 protected-by AWS::EC2::SecurityGroup:web",
        "AWS::ElasticLoadBalancingV2::LoadBalancer:checkout runs-in AWS::EC2::Subnet:public-b",
        "AWS::ElasticLoadBalancingV2::LoadBalancer:checkout protected-by AWS::EC2::SecurityGroup:alb",
      ].sort(),
    );
  });
});

describe("the catalog and the role", () => {
  test("subnets and security groups are listed as resources with no metrics of their own", () => {
    for (const name of [SUBNET, SECURITY_GROUP]) {
      expect(getAwsInventoryRowTypes()).toContain(name);
      expect(type(name).metrics).toBeUndefined();
      expect(type(name).quietWhenRefused).toBe(true);
      expect(isInventoryOnlyCloudResourceType(CloudProvider.AWS, name)).toBe(
        true,
      );
    }

    expect(
      getCloudResourceTypeDescriptor(CloudProvider.AWS, SUBNET)?.label,
    ).toBe("VPC Subnet");
    expect(
      getCloudResourceTypeDescriptor(CloudProvider.AWS, SECURITY_GROUP)?.label,
    ).toBe("Security Group");
  });

  test("the role may read them, and every load balancer's setup with one Describe", () => {
    expect(AWS_READ_ONLY_ACTIONS).toEqual(
      expect.arrayContaining([
        "ec2:DescribeSubnets",
        "ec2:DescribeSecurityGroups",
        "elasticloadbalancing:Describe*",
      ]),
    );
    expect(
      AWS_READ_ONLY_ACTIONS.filter((action: string): boolean => {
        return action.startsWith("elasticloadbalancing:");
      }),
    ).toEqual(["elasticloadbalancing:Describe*"]);
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
      return new Date("2026-11-17T12:07:00Z");
    },
    sleep: async () => {},
    state: { accounts: [FAKE_ACCOUNT_ID], activePairs: ["eu-west-1|AWS/EC2"] },
    connectionId: "33333333-3333-4333-8333-333333333333",
    budget: new CloudReadBudget({ maxRequests: 1500, maxDurationMs: 60000 }),
  });
}

describe("an account's inventory, against a fake AWS", () => {
  test("lists the Region's subnets and security groups through Cloud Control, each listed in full", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "eu-west-1": {
          metrics: [],
          resources: {
            [SUBNET]: [
              {
                Identifier: "subnet-0aaa",
                Properties: {
                  SubnetId: "subnet-0aaa",
                  VpcId: "vpc-0abc",
                  CidrBlock: "10.0.1.0/24",
                },
              },
            ],
            [SECURITY_GROUP]: [
              {
                Identifier: "sg-0web",
                Properties: {
                  GroupId: "sg-0web",
                  GroupName: "web",
                  VpcId: "vpc-0abc",
                  SecurityGroupIngress: [
                    {
                      IpProtocol: "tcp",
                      FromPort: 443,
                      ToPort: 443,
                      CidrIp: "0.0.0.0/0",
                    },
                  ],
                },
              },
            ],
          },
        },
        "us-east-1": { metrics: [] },
      },
    });

    const result: CloudInventoryResult = await readInventory(fake);

    expect(
      result.items
        .filter((entry: CloudInventoryItem): boolean => {
          return entry.resource.region === "eu-west-1";
        })
        .map((entry: CloudInventoryItem): string => {
          return `${entry.resource.resourceType} ${entry.resource.name} ${entry.displayName || ""}`;
        }),
    ).toEqual([`${SUBNET} subnet-0aaa `, `${SECURITY_GROUP} sg-0web web`]);
    expect(result.completelyListed[0]!.resourceTypes).toEqual(
      expect.arrayContaining([SUBNET, SECURITY_GROUP]),
    );
  });

  test("a role set up before they were listed is not warned about, and nothing of them is taken for gone", async () => {
    const refused: FakeResponse = awsError(
      403,
      "AccessDeniedException",
      "User is not authorized to perform: ec2:DescribeSecurityGroups",
    );
    const fake: FakeAws = createFakeAws({
      regions: {
        "eu-west-1": {
          metrics: [],
          resourceErrors: { [SUBNET]: refused, [SECURITY_GROUP]: refused },
        },
        "us-east-1": {
          metrics: [],
          resourceErrors: { [SUBNET]: refused, [SECURITY_GROUP]: refused },
        },
      },
    });

    const result: CloudInventoryResult = await readInventory(fake);

    expect(
      result.warnings.filter((warning: string): boolean => {
        return warning.includes("Subnet") || warning.includes("SecurityGroup");
      }),
    ).toEqual([]);

    for (const entry of result.completelyListed) {
      expect(entry.resourceTypes).not.toContain(SUBNET);
      expect(entry.resourceTypes).not.toContain(SECURITY_GROUP);
      expect(entry.resourceTypes).toContain("AWS::EC2::Instance");
    }
  });
});
