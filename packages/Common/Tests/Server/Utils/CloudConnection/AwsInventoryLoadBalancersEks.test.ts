import { describe, expect, test } from "@jest/globals";
import { FakeResponse } from "../LlmObservability/FakeProviderApi";
import AwsCloudConnector from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudConnector";
import { readClassicLoadBalancer } from "../../../../Server/Utils/CloudConnection/Aws/AwsClassicLoadBalancers";
import { AwsListedResource } from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudControl";
import {
  AWS_EKS_MAX_CLUSTERS_PER_REGION,
  readEksCluster,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsEksClusters";
import {
  AwsInventoryContext,
  AwsInventoryType,
  EKS_CLUSTER,
  buildAwsInventoryItem,
  getAwsInventoryType,
  getEksClusterOfNode,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsInventoryCatalog";
import {
  CloudConnectionSettings,
  CloudInventoryItem,
  CloudInventoryResult,
  CloudReadBudget,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { parseAwsXml } from "../../../../Server/Utils/CloudConnection/LiveRead/AwsXml";
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
import {
  AWS_READ_ONLY_ACTIONS,
  getAwsReadOnlyPolicyDocument,
  isAwsActionGranted,
} from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  FAKE_ACCOUNT_ID,
  FakeAws,
  awsError,
  createFakeAws,
  xmlOf,
} from "./FakeAwsApi";

/*
 * An AWS account's classic load balancers and EKS clusters (#9375), as a
 * Google Cloud project's load balancers (#9368) and GKE clusters (#9377):
 *
 *   - a classic load balancer, listed by Elastic Load Balancing's own API
 *     (Cloud Control lists none), is the row its AWS/ELB metrics name, and
 *     sends traffic to the instances registered with it;
 *   - an EKS cluster, listed by EKS's own API, runs in its subnets and VPC,
 *     is guarded by its security groups, and the instances and Auto
 *     Scaling groups of its node groups are part of it.
 *
 * The fixtures are the APIs' own answers: DescribeLoadBalancers' XML and
 * DescribeCluster's JSON.
 */

const context: AwsInventoryContext = {
  accountId: "123456789012",
  region: "eu-west-1",
};

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

const CLASSIC: string = "AWS::ElasticLoadBalancing::LoadBalancer";

const CLASSIC_MEMBER: JSONObject = {
  LoadBalancerName: "legacy-web",
  DNSName: "legacy-web-1234567890.eu-west-1.elb.amazonaws.com",
  CanonicalHostedZoneName: "legacy-web-1234567890.eu-west-1.elb.amazonaws.com",
  Scheme: "internet-facing",
  VPCId: "vpc-0abc",
  CreatedTime: "2019-04-01T10:00:00.000Z",
  Subnets: { member: ["subnet-0aaa", "subnet-0bbb"] },
  SecurityGroups: { member: ["sg-0elb"] },
  AvailabilityZones: { member: ["eu-west-1a", "eu-west-1b"] },
  Instances: {
    member: [{ InstanceId: "i-0web1" }, { InstanceId: "i-0web2" }],
  },
  HealthCheck: {
    Target: "HTTP:8080/health",
    Interval: 30,
    Timeout: 5,
  },
  ListenerDescriptions: {
    member: [
      {
        Listener: {
          Protocol: "HTTPS",
          LoadBalancerPort: 443,
          InstanceProtocol: "HTTP",
          InstancePort: 8080,
          SSLCertificateId:
            "arn:aws:acm:eu-west-1:123456789012:certificate/abc",
        },
        PolicyNames: { member: ["ELBSecurityPolicy-2016-08"] },
      },
      {
        Listener: {
          Protocol: "TCP",
          LoadBalancerPort: 22,
          InstancePort: 22,
        },
      },
    ],
  },
};

function classicListed(member: JSONObject = CLASSIC_MEMBER): AwsListedResource {
  return readClassicLoadBalancer(
    parseAwsXml(`<member>${xmlOf(member)}</member>`),
  )!;
}

const EKS_DESCRIBED: JSONObject = {
  name: "orders",
  arn: "arn:aws:eks:eu-west-1:123456789012:cluster/orders",
  version: "1.31",
  status: "ACTIVE",
  endpoint: "https://ABCDEF0123.gr7.eu-west-1.eks.amazonaws.com",
  platformVersion: "eks.12",
  roleArn: "arn:aws:iam::123456789012:role/eks-orders",
  resourcesVpcConfig: {
    vpcId: "vpc-0abc",
    subnetIds: ["subnet-0aaa", "subnet-0bbb"],
    securityGroupIds: ["sg-0control"],
    clusterSecurityGroupId: "sg-0cluster",
    endpointPublicAccess: false,
    endpointPrivateAccess: true,
    publicAccessCidrs: ["0.0.0.0/0"],
  },
  kubernetesNetworkConfig: {
    serviceIpv4Cidr: "172.20.0.0/16",
    ipFamily: "ipv4",
  },
  certificateAuthority: { data: "LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t" },
  identity: {
    oidc: {
      issuer: "https://oidc.eks.eu-west-1.amazonaws.com/id/ABCDEF0123",
    },
  },
  tags: { team: "orders", Name: "orders-prod" },
};

describe("a classic load balancer", () => {
  test("is read from DescribeLoadBalancers' member, in CloudFormation's names", () => {
    expect(classicListed()).toEqual({
      identifier: "legacy-web",
      properties: {
        LoadBalancerName: "legacy-web",
        DNSName: "legacy-web-1234567890.eu-west-1.elb.amazonaws.com",
        Scheme: "internet-facing",
        CanonicalHostedZoneName:
          "legacy-web-1234567890.eu-west-1.elb.amazonaws.com",
        CreatedTime: "2019-04-01T10:00:00.000Z",
        VpcId: "vpc-0abc",
        HealthCheck: { Target: "HTTP:8080/health" },
        Subnets: ["subnet-0aaa", "subnet-0bbb"],
        SecurityGroups: ["sg-0elb"],
        AvailabilityZones: ["eu-west-1a", "eu-west-1b"],
        Instances: ["i-0web1", "i-0web2"],
        Listeners: ["HTTPS:443 -> HTTP:8080", "TCP:22 -> TCP:22"],
      },
    });
  });

  test("a member with no name is none", () => {
    expect(
      readClassicLoadBalancer(
        parseAwsXml("<member><DNSName>x</DNSName></member>"),
      ),
    ).toBeNull();
  });

  test("is the row its AWS/ELB metrics name: by its name, in its Region", () => {
    const balancer: CloudInventoryItem = item(CLASSIC, classicListed());

    expect(balancer.resource).toEqual(
      expect.objectContaining({
        resourceType: CLASSIC,
        name: "legacy-web",
        providerResourceId:
          "arn:aws:elasticloadbalancing:eu-west-1:123456789012:loadbalancer/legacy-web",
      }),
    );
    expect(balancer.displayName).toBe("legacy-web");
    expect(balancer.endpoints).toEqual([
      "legacy-web-1234567890.eu-west-1.elb.amazonaws.com",
    ]);
  });

  test("keeps how it is set up, never its certificate", () => {
    const balancer: CloudInventoryItem = item(CLASSIC, classicListed());

    expect(balancer.properties).toEqual({
      Scheme: "internet-facing",
      DNSName: "legacy-web-1234567890.eu-west-1.elb.amazonaws.com",
      VpcId: "vpc-0abc",
      AvailabilityZones: ["eu-west-1a", "eu-west-1b"],
      Subnets: ["subnet-0aaa", "subnet-0bbb"],
      SecurityGroups: ["sg-0elb"],
      Listeners: ["HTTPS:443 -> HTTP:8080", "TCP:22 -> TCP:22"],
      "HealthCheck.Target": "HTTP:8080/health",
    });
    expect(JSON.stringify(balancer.properties)).not.toContain("certificate");
  });

  test("sends traffic to its instances, runs in its subnets and VPC, behind its security group", () => {
    expect(item(CLASSIC, classicListed()).relationships).toEqual([
      {
        kind: CloudRelationshipKind.RunsIn,
        target: "subnet-0aaa",
        targetType: "AWS::EC2::Subnet",
      },
      {
        kind: CloudRelationshipKind.RunsIn,
        target: "subnet-0bbb",
        targetType: "AWS::EC2::Subnet",
      },
      {
        kind: CloudRelationshipKind.RunsIn,
        target: "vpc-0abc",
        targetType: "AWS::EC2::VPC",
      },
      {
        kind: CloudRelationshipKind.ProtectedBy,
        target: "sg-0elb",
        targetType: "AWS::EC2::SecurityGroup",
      },
      {
        kind: CloudRelationshipKind.RoutesTo,
        target: "arn:aws:ec2:eu-west-1:123456789012:instance/i-0web1",
        targetType: "AWS::EC2::Instance",
      },
      {
        kind: CloudRelationshipKind.RoutesTo,
        target: "arn:aws:ec2:eu-west-1:123456789012:instance/i-0web2",
        targetType: "AWS::EC2::Instance",
      },
    ]);
  });

  test("an EC2-Classic one, with no VPC, subnets or instances, has no relationships", () => {
    expect(
      item(
        CLASSIC,
        classicListed({
          LoadBalancerName: "old",
          DNSName: "old.elb.amazonaws.com",
        }),
      ).relationships,
    ).toEqual([]);
  });
});

describe("an EKS cluster", () => {
  test("is read from DescribeCluster, keeping no certificate authority, OIDC issuer or role", () => {
    const cluster: AwsListedResource = readEksCluster(EKS_DESCRIBED)!;

    expect(cluster).toEqual({
      identifier: "orders",
      properties: {
        Name: "orders",
        Arn: "arn:aws:eks:eu-west-1:123456789012:cluster/orders",
        Version: "1.31",
        Status: "ACTIVE",
        Endpoint: "https://ABCDEF0123.gr7.eu-west-1.eks.amazonaws.com",
        PlatformVersion: "eks.12",
        ResourcesVpcConfig: {
          SubnetIds: ["subnet-0aaa", "subnet-0bbb"],
          SecurityGroupIds: ["sg-0control"],
          VpcId: "vpc-0abc",
          ClusterSecurityGroupId: "sg-0cluster",
          EndpointPublicAccess: false,
          EndpointPrivateAccess: true,
        },
        KubernetesNetworkConfig: {
          ServiceIpv4Cidr: "172.20.0.0/16",
          IpFamily: "ipv4",
        },
        Tags: { team: "orders", Name: "orders-prod" },
      },
    });
    expect(JSON.stringify(cluster)).not.toContain("LS0tLS1CRUdJTi");
    expect(JSON.stringify(cluster)).not.toContain("oidc");
    expect(JSON.stringify(cluster)).not.toContain("role/eks-orders");
  });

  test("an answer with no cluster name is none", () => {
    expect(readEksCluster({})).toBeNull();
    expect(readEksCluster({ name: 3 } as unknown as JSONObject)).toBeNull();
  });

  test("is identified by its name, as its ARN says, and named by its Name tag", () => {
    const cluster: CloudInventoryItem = item(
      EKS_CLUSTER,
      readEksCluster(EKS_DESCRIBED)!,
    );

    expect(cluster.resource).toEqual(
      expect.objectContaining({
        provider: CloudProvider.AWS,
        resourceType: EKS_CLUSTER,
        name: "orders",
        providerResourceId: "arn:aws:eks:eu-west-1:123456789012:cluster/orders",
        identityKey:
          "aws|123456789012|eu-west-1|aws::eks::cluster|clustername=orders",
      }),
    );
    expect(cluster.displayName).toBe("orders-prod");
    expect(cluster.tags).toEqual({ team: "orders", Name: "orders-prod" });
    expect(cluster.endpoints).toEqual([
      "abcdef0123.gr7.eu-west-1.eks.amazonaws.com",
    ]);
  });

  test("keeps its version, status and network, and runs in its subnets and VPC behind its security groups", () => {
    const cluster: CloudInventoryItem = item(
      EKS_CLUSTER,
      readEksCluster(EKS_DESCRIBED)!,
    );

    expect(cluster.properties).toEqual({
      Version: "1.31",
      Status: "ACTIVE",
      PlatformVersion: "eks.12",
      Endpoint: "https://ABCDEF0123.gr7.eu-west-1.eks.amazonaws.com",
      "ResourcesVpcConfig.VpcId": "vpc-0abc",
      "ResourcesVpcConfig.SubnetIds": ["subnet-0aaa", "subnet-0bbb"],
      "ResourcesVpcConfig.SecurityGroupIds": ["sg-0control"],
      "ResourcesVpcConfig.ClusterSecurityGroupId": "sg-0cluster",
      "ResourcesVpcConfig.EndpointPublicAccess": false,
      "ResourcesVpcConfig.EndpointPrivateAccess": true,
      "KubernetesNetworkConfig.ServiceIpv4Cidr": "172.20.0.0/16",
      "KubernetesNetworkConfig.IpFamily": "ipv4",
    });
    expect(cluster.relationships).toEqual([
      {
        kind: CloudRelationshipKind.RunsIn,
        target: "subnet-0aaa",
        targetType: "AWS::EC2::Subnet",
      },
      {
        kind: CloudRelationshipKind.RunsIn,
        target: "subnet-0bbb",
        targetType: "AWS::EC2::Subnet",
      },
      {
        kind: CloudRelationshipKind.RunsIn,
        target: "vpc-0abc",
        targetType: "AWS::EC2::VPC",
      },
      {
        kind: CloudRelationshipKind.ProtectedBy,
        target: "sg-0control",
        targetType: "AWS::EC2::SecurityGroup",
      },
      {
        kind: CloudRelationshipKind.ProtectedBy,
        target: "sg-0cluster",
        targetType: "AWS::EC2::SecurityGroup",
      },
    ]);
  });
});

describe("the nodes of an EKS cluster", () => {
  test.each([
    ["a managed node group's", { "eks:cluster-name": "orders" }],
    ["AWS's own tag", { "aws:eks:cluster-name": "orders" }],
    [
      "a self-managed node group's",
      { "kubernetes.io/cluster/orders": "owned" },
    ],
    ["a shared one's", { "kubernetes.io/cluster/orders": "shared" }],
    [
      "every tag, agreeing",
      {
        "eks:cluster-name": "orders",
        "kubernetes.io/cluster/orders": "owned",
      },
    ],
  ])(
    "%s tag names the cluster",
    (_name: string, tags: Record<string, string>) => {
      expect(getEksClusterOfNode(tags, context)).toBe(
        "arn:aws:eks:eu-west-1:123456789012:cluster/orders",
      );
    },
  );

  test.each([
    ["no tag", {}],
    ["another value", { "kubernetes.io/cluster/orders": "maybe" }],
    [
      "tags that disagree",
      {
        "eks:cluster-name": "orders",
        "kubernetes.io/cluster/payments": "owned",
      },
    ],
    ["an empty name", { "eks:cluster-name": "  " }],
  ])("%s names none", (_name: string, tags: Record<string, string>) => {
    expect(getEksClusterOfNode(tags, context)).toBe("");
  });

  test("an instance and an Auto Scaling group of a node group are part of the cluster", () => {
    const tags: Array<{ Key: string; Value: string }> = [
      { Key: "eks:cluster-name", Value: "orders" },
      { Key: "eks:nodegroup-name", Value: "general" },
    ];
    const partOf: unknown = {
      kind: CloudRelationshipKind.PartOf,
      target: "arn:aws:eks:eu-west-1:123456789012:cluster/orders",
      targetType: EKS_CLUSTER,
    };

    expect(
      item("AWS::EC2::Instance", {
        identifier: "i-0node",
        properties: { SubnetId: "subnet-0aaa", Tags: tags } as never,
      }).relationships,
    ).toContainEqual(partOf);
    expect(
      item("AWS::AutoScaling::AutoScalingGroup", {
        identifier: "eks-general-abc",
        properties: { VPCZoneIdentifier: ["subnet-0aaa"], Tags: tags } as never,
      }).relationships,
    ).toContainEqual(partOf);
    // An instance of no cluster is part of none.
    expect(
      item("AWS::EC2::Instance", {
        identifier: "i-0web",
        properties: {} as never,
      }).relationships,
    ).toEqual([]);
  });

  test("links resolve end to end: the cluster in its network, its nodes in it, the classic load balancer to its instances", () => {
    const items: Array<CloudInventoryItem> = [
      item("AWS::EC2::VPC", {
        identifier: "vpc-0abc",
        properties: {} as never,
      }),
      item("AWS::EC2::Subnet", {
        identifier: "subnet-0aaa",
        properties: { VpcId: "vpc-0abc" } as never,
      }),
      item("AWS::EC2::SecurityGroup", {
        identifier: "sg-0cluster",
        properties: { GroupName: "eks-cluster", VpcId: "vpc-0abc" } as never,
      }),
      item(EKS_CLUSTER, readEksCluster(EKS_DESCRIBED)!),
      item("AWS::EC2::Instance", {
        identifier: "i-0node",
        properties: {
          SubnetId: "subnet-0aaa",
          Tags: [
            { Key: "Name", Value: "node-1" },
            { Key: "eks:cluster-name", Value: "orders" },
          ],
        } as never,
      }),
      item("AWS::EC2::Instance", {
        identifier: "i-0web1",
        properties: { Tags: [{ Key: "Name", Value: "web-1" }] } as never,
      }),
      item(
        CLASSIC,
        classicListed({
          LoadBalancerName: "legacy-web",
          Instances: { member: [{ InstanceId: "i-0web1" }] },
        }),
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
        "AWS::EC2::Subnet:subnet-0aaa runs-in AWS::EC2::VPC:vpc-0abc",
        "AWS::EC2::SecurityGroup:eks-cluster runs-in AWS::EC2::VPC:vpc-0abc",
        "AWS::EKS::Cluster:orders-prod runs-in AWS::EC2::Subnet:subnet-0aaa",
        "AWS::EKS::Cluster:orders-prod runs-in AWS::EC2::VPC:vpc-0abc",
        "AWS::EKS::Cluster:orders-prod protected-by AWS::EC2::SecurityGroup:eks-cluster",
        "AWS::EC2::Instance:node-1 runs-in AWS::EC2::Subnet:subnet-0aaa",
        "AWS::EC2::Instance:node-1 part-of AWS::EKS::Cluster:orders-prod",
        "AWS::ElasticLoadBalancing::LoadBalancer:legacy-web routes-to AWS::EC2::Instance:web-1",
      ].sort(),
    );
  });
});

describe("the catalog and the role", () => {
  test("an EKS cluster is listed only; a classic load balancer is the row its metrics name", () => {
    expect(
      isInventoryOnlyCloudResourceType(CloudProvider.AWS, EKS_CLUSTER),
    ).toBe(true);
    expect(
      getCloudResourceTypeDescriptor(CloudProvider.AWS, EKS_CLUSTER)?.label,
    ).toBe("EKS Cluster");
    expect(type(EKS_CLUSTER).metrics).toBeUndefined();
    expect(type(EKS_CLUSTER).quietWhenRefused).toBe(true);
    expect(isInventoryOnlyCloudResourceType(CloudProvider.AWS, CLASSIC)).toBe(
      false,
    );
    expect(type(CLASSIC).metrics?.namespace(classicListed())).toBe("AWS/ELB");
  });

  test("the role may list EKS clusters and classic load balancers, and still fits an access key's user", () => {
    for (const action of [
      "eks:ListClusters",
      "eks:DescribeCluster",
      "elasticloadbalancing:DescribeLoadBalancers",
    ]) {
      expect({ action, granted: isAwsActionGranted(action) }).toEqual({
        action,
        granted: true,
      });
    }

    expect(AWS_READ_ONLY_ACTIONS).not.toContain("eks:ListNodegroups");
    expect(getAwsReadOnlyPolicyDocument().length).toBeLessThanOrEqual(2048);
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

function eksCluster(name: string): JSONObject {
  return {
    ...EKS_DESCRIBED,
    name,
    arn: `arn:aws:eks:eu-west-1:${FAKE_ACCOUNT_ID}:cluster/${name}`,
    tags: {},
  };
}

describe("an account's inventory, against a fake AWS", () => {
  test("lists each Region's classic load balancers and EKS clusters, page by page, each listed in full", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "eu-west-1": {
          metrics: [],
          classicLoadBalancers: [CLASSIC_MEMBER],
          eksClusters: [eksCluster("orders"), eksCluster("payments")],
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
          return `${entry.resource.resourceType} ${entry.resource.name}`;
        }),
    ).toEqual([
      `${CLASSIC} legacy-web`,
      `${EKS_CLUSTER} orders`,
      `${EKS_CLUSTER} payments`,
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.completelyListed[0]!.resourceTypes).toEqual(
      expect.arrayContaining([CLASSIC, EKS_CLUSTER]),
    );

    // The names, then each cluster described.
    expect(
      fake.eksCalls
        .filter((call: { region: string }): boolean => {
          return call.region === "eu-west-1";
        })
        .map((call: { path: string }): string => {
          return call.path;
        }),
    ).toEqual(["/clusters", "/clusters/orders", "/clusters/payments"]);
    expect(
      fake.classicLoadBalancerCalls.find((call: { region: string }) => {
        return call.region === "eu-west-1";
      })?.params,
    ).toEqual(
      expect.objectContaining({
        Action: "DescribeLoadBalancers",
        Version: "2012-06-01",
        PageSize: "400",
      }),
    );
  });

  test("a Region of more EKS clusters than are described is not listed in full", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "eu-west-1": {
          metrics: [],
          eksClusters: Array.from(
            { length: AWS_EKS_MAX_CLUSTERS_PER_REGION + 1 },
            (_value: unknown, index: number): JSONObject => {
              return eksCluster(`c${String(index).padStart(3, "0")}`);
            },
          ),
        },
        "us-east-1": { metrics: [] },
      },
    });

    const result: CloudInventoryResult = await readInventory(fake);

    expect(
      result.items.filter((entry: CloudInventoryItem): boolean => {
        return entry.resource.resourceType === EKS_CLUSTER;
      }),
    ).toHaveLength(AWS_EKS_MAX_CLUSTERS_PER_REGION);
    expect(result.completelyListed[0]!.resourceTypes).not.toContain(
      EKS_CLUSTER,
    );
  });

  test("a role set up before EKS clusters were listed is not warned about, and nothing of them is taken for gone", async () => {
    const refused: FakeResponse = {
      status: 403,
      body: JSON.stringify({
        message:
          "User: arn:aws:iam::123456789012:user/OneUptimeReadOnly is not authorized to perform: eks:ListClusters",
      }),
    };
    const fake: FakeAws = createFakeAws({
      regions: {
        "eu-west-1": { metrics: [], eksError: refused },
        "us-east-1": { metrics: [], eksError: refused },
      },
    });

    const result: CloudInventoryResult = await readInventory(fake);

    expect(result.warnings).toEqual([]);

    for (const entry of result.completelyListed) {
      expect(entry.resourceTypes).not.toContain(EKS_CLUSTER);
      expect(entry.resourceTypes).toContain(CLASSIC);
    }
  });

  test("a refused classic load balancer listing is quiet too", async () => {
    const refused: FakeResponse = awsError(
      403,
      "AccessDenied",
      "User is not authorized to perform: elasticloadbalancing:DescribeLoadBalancers",
    );
    const fake: FakeAws = createFakeAws({
      regions: {
        "eu-west-1": { metrics: [], classicLoadBalancerError: refused },
        "us-east-1": { metrics: [], classicLoadBalancerError: refused },
      },
    });

    const result: CloudInventoryResult = await readInventory(fake);

    expect(result.warnings).toEqual([]);
    expect(result.completelyListed[0]!.resourceTypes).not.toContain(CLASSIC);
  });
});
