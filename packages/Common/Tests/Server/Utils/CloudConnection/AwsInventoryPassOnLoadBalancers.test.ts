import { describe, expect, test } from "@jest/globals";
import AwsCloudConnector from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudConnector";
import {
  AwsCloudControlOptions,
  AwsListedResource,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudControl";
import {
  AwsInventoryContext,
  AwsInventoryType,
  addAwsPassOnLoadBalancerFacts,
  buildAwsInventoryItem,
  doesAwsTargetGroupKeepClientIp,
  getAwsInventoryType,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsInventoryCatalog";
import {
  AWS_PRESERVE_CLIENT_IP_ATTRIBUTE,
  AWS_TARGET_GROUP_ATTRIBUTES_READ_PER_REGION,
  ELASTIC_LOAD_BALANCING_V2_API_VERSION,
  addTargetGroupAttributes,
  canTargetGroupDropClientIp,
  describeTargetGroupAttributes,
  readTargetGroupAttributesAnswer,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsTargetGroupAttributes";
import {
  CloudConnectionSettings,
  CloudInventoryItem,
  CloudInventoryResult,
  CloudReadBudget,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import {
  AWS_PASS_ON_PROPERTIES,
  AwsClientIpPreservation,
  PassOnLoadBalancerKind,
  PassOnLoadBalancerReading,
  PassOnReason,
  readAwsPassOnLoadBalancer,
} from "../../../../Utils/SecurityEvent/PassOnLoadBalancers";
import { FAKE_ACCOUNT_ID, FakeAws, createFakeAws } from "./FakeAwsApi";

/*
 * #11389: WHETHER AN AWS LOAD BALANCER PASSES ON WHAT A CLIENT WROTE.
 *
 * A Network Load Balancer whose target group has client IP preservation off
 * connects to its targets from its own private addresses, in its subnets,
 * and passes on the X-Forwarded-For the client wrote. Cloud Control lists a
 * target group without its attributes, so the inventory asks Elastic Load
 * Balancing for them (DescribeTargetGroupAttributes) - only of the target
 * groups whose preservation can be off: a Network Load Balancer's, over
 * TCP or TLS, to instances or IP addresses - and keeps on each load
 * balancer's record whether it keeps the client's address, which target
 * groups do not, and its subnets' ranges. A Classic Load Balancer with a
 * TCP listener passes on as well. The answers are AWS's, as recorded.
 */

const REGION: string = "eu-west-1";

const context: AwsInventoryContext = {
  accountId: FAKE_ACCOUNT_ID,
  region: REGION,
};

const NLB_ARN: string = `arn:aws:elasticloadbalancing:${REGION}:${FAKE_ACCOUNT_ID}:loadbalancer/net/tcp-ingress/50dc6c495c0c9188`;
const PRESERVING_NLB_ARN: string = `arn:aws:elasticloadbalancing:${REGION}:${FAKE_ACCOUNT_ID}:loadbalancer/net/game/6a1f0c7e9d2b4c11`;
const DUALSTACK_NLB_ARN: string = `arn:aws:elasticloadbalancing:${REGION}:${FAKE_ACCOUNT_ID}:loadbalancer/net/edge-v6/7b2e1d8f0a3c5d22`;
const ALB_ARN: string = `arn:aws:elasticloadbalancing:${REGION}:${FAKE_ACCOUNT_ID}:loadbalancer/app/web/8c3f2e9a1b4d6e33`;

function targetGroupArn(name: string): string {
  return `arn:aws:elasticloadbalancing:${REGION}:${FAKE_ACCOUNT_ID}:targetgroup/${name}/9d4a3f0b2c5e7f44`;
}

function listed(
  identifier: string,
  properties: Record<string, unknown> = {},
): AwsListedResource {
  return { identifier, properties: properties as JSONObject };
}

// A target group as Cloud Control lists it: no attributes.
function targetGroup(
  name: string,
  data: {
    protocol?: string;
    targetType?: string;
    loadBalancers?: Array<string>;
    attributes?: Array<{ Key: string; Value: string }>;
  },
): AwsListedResource {
  return listed(targetGroupArn(name), {
    TargetGroupArn: targetGroupArn(name),
    TargetGroupName: name,
    Protocol: data.protocol === undefined ? "TCP" : data.protocol,
    ...(data.targetType === undefined ? {} : { TargetType: data.targetType }),
    LoadBalancerArns: data.loadBalancers || [NLB_ARN],
    ...(data.attributes ? { TargetGroupAttributes: data.attributes } : {}),
  });
}

function preserve(value: string): Array<{ Key: string; Value: string }> {
  return [
    { Key: "deregistration_delay.timeout_seconds", Value: "300" },
    { Key: AWS_PRESERVE_CLIENT_IP_ATTRIBUTE, Value: value },
    { Key: "proxy_protocol_v2.enabled", Value: "false" },
  ];
}

describe("which target groups are asked whether they keep the client's address", () => {
  test("a Network Load Balancer's, over TCP or TLS, to instances or IP addresses", () => {
    for (const data of [
      { protocol: "TCP", targetType: "ip" },
      { protocol: "TLS", targetType: "ip" },
      { protocol: "TCP", targetType: "instance" },
      { protocol: "tcp", targetType: "IP" },
      // Instances when it does not say.
      { protocol: "TCP" },
    ]) {
      expect(canTargetGroupDropClientIp(targetGroup("ingress", data))).toBe(
        true,
      );
    }
  });

  test("never one that always keeps it: UDP, QUIC, an Application Load Balancer target, or another load balancer's", () => {
    for (const data of [
      { protocol: "UDP", targetType: "ip" },
      { protocol: "TCP_UDP", targetType: "instance" },
      { protocol: "QUIC", targetType: "ip" },
      { protocol: "TCP_QUIC", targetType: "ip" },
      { protocol: "TCP", targetType: "alb" },
      { protocol: "TCP", targetType: "lambda" },
      { protocol: "HTTP", targetType: "ip", loadBalancers: [ALB_ARN] },
      { protocol: "TCP", targetType: "ip", loadBalancers: [ALB_ARN] },
      { protocol: "TCP", targetType: "ip", loadBalancers: [] },
      { protocol: "", targetType: "ip" },
    ]) {
      expect(canTargetGroupDropClientIp(targetGroup("other", data))).toBe(
        false,
      );
    }
  });
});

describe("Elastic Load Balancing's answer", () => {
  // DescribeTargetGroupAttributes, as AWS answers it.
  const ANSWER: string = `<DescribeTargetGroupAttributesResponse xmlns="http://elasticloadbalancing.amazonaws.com/doc/2015-12-01/">
  <DescribeTargetGroupAttributesResult>
    <Attributes>
      <member>
        <Value>false</Value>
        <Key>stickiness.enabled</Key>
      </member>
      <member>
        <Value>300</Value>
        <Key>deregistration_delay.timeout_seconds</Key>
      </member>
      <member>
        <Value>false</Value>
        <Key>preserve_client_ip.enabled</Key>
      </member>
      <member>
        <Value>false</Value>
        <Key>proxy_protocol_v2.enabled</Key>
      </member>
    </Attributes>
  </DescribeTargetGroupAttributesResult>
  <ResponseMetadata>
    <RequestId>54618294-f3a8-11e5-bb98-57195a6eb84a</RequestId>
  </ResponseMetadata>
</DescribeTargetGroupAttributesResponse>`;

  test("is read as Cloud Control's model would hold it", () => {
    expect(readTargetGroupAttributesAnswer(ANSWER)).toEqual([
      { Key: "stickiness.enabled", Value: "false" },
      { Key: "deregistration_delay.timeout_seconds", Value: "300" },
      { Key: AWS_PRESERVE_CLIENT_IP_ATTRIBUTE, Value: "false" },
      { Key: "proxy_protocol_v2.enabled", Value: "false" },
    ]);
  });

  test("an answer with no attributes, or none it can read, holds none", () => {
    expect(
      readTargetGroupAttributesAnswer(
        "<DescribeTargetGroupAttributesResponse><DescribeTargetGroupAttributesResult><Attributes/></DescribeTargetGroupAttributesResult></DescribeTargetGroupAttributesResponse>",
      ),
    ).toEqual([]);
    expect(
      readTargetGroupAttributesAnswer(
        "<DescribeTargetGroupAttributesResponse><DescribeTargetGroupAttributesResult><Attributes><member><Value>true</Value></member></Attributes></DescribeTargetGroupAttributesResult></DescribeTargetGroupAttributesResponse>",
      ),
    ).toEqual([]);
  });
});

describe("whether a target group keeps the client's address", () => {
  test("as its preserve_client_ip.enabled says", () => {
    expect(
      doesAwsTargetGroupKeepClientIp(
        targetGroup("ingress", { targetType: "ip", attributes: preserve("true") }),
      ),
    ).toBe(true);
    expect(
      doesAwsTargetGroupKeepClientIp(
        targetGroup("ingress", {
          targetType: "instance",
          attributes: preserve("false"),
        }),
      ),
    ).toBe(false);
    expect(
      doesAwsTargetGroupKeepClientIp(
        targetGroup("ingress", { targetType: "ip", attributes: preserve("TRUE") }),
      ),
    ).toBe(true);
  });

  test("left at its default: instances keep it, IP addresses do not", () => {
    expect(
      doesAwsTargetGroupKeepClientIp(
        targetGroup("instances", { targetType: "instance", attributes: [] }),
      ),
    ).toBe(true);
    expect(
      doesAwsTargetGroupKeepClientIp(
        targetGroup("instances", { attributes: [] }),
      ),
    ).toBe(true);
    expect(
      doesAwsTargetGroupKeepClientIp(
        targetGroup("pods", { targetType: "ip", attributes: [] }),
      ),
    ).toBe(false);
  });

  test("one whose attributes were not read is not known: null", () => {
    expect(
      doesAwsTargetGroupKeepClientIp(targetGroup("pods", { targetType: "ip" })),
    ).toBeNull();
    expect(
      doesAwsTargetGroupKeepClientIp(
        listed(targetGroupArn("pods"), {
          Protocol: "TCP",
          TargetType: "ip",
          LoadBalancerArns: [NLB_ARN],
          TargetGroupAttributes: "preserve_client_ip.enabled=false",
        }),
      ),
    ).toBeNull();
  });

  test("one that always keeps it does, read or not", () => {
    for (const data of [
      { protocol: "UDP", targetType: "ip" },
      { protocol: "TCP", targetType: "alb" },
      { protocol: "HTTP", targetType: "ip", loadBalancers: [ALB_ARN] },
    ]) {
      expect(doesAwsTargetGroupKeepClientIp(targetGroup("other", data))).toBe(
        true,
      );
    }
  });
});

function type(name: string): AwsInventoryType {
  const found: AwsInventoryType | null = getAwsInventoryType(name);

  if (!found) {
    throw new Error(`no inventory type ${name}`);
  }

  return found;
}

const SUBNETS: Array<AwsListedResource> = [
  listed("subnet-0aaa", {
    SubnetId: "subnet-0aaa",
    CidrBlock: "10.0.1.0/24",
    Ipv6CidrBlocks: ["2a05:d018:1:a00::/64"],
    VpcId: "vpc-0abc",
  }),
  listed("subnet-0bbb", {
    SubnetId: "subnet-0bbb",
    CidrBlock: "10.0.2.0/24",
    VpcId: "vpc-0abc",
  }),
];

// The Region's load balancers, built as the inventory builds them.
function loadBalancers(
  resources: Array<{ type: string; resource: AwsListedResource }>,
): {
  items: Array<CloudInventoryItem>;
  listedByItem: Map<CloudInventoryItem, AwsListedResource>;
} {
  const items: Array<CloudInventoryItem> = [];
  const listedByItem: Map<CloudInventoryItem, AwsListedResource> = new Map();

  for (const entry of resources) {
    const item: CloudInventoryItem = buildAwsInventoryItem(
      type(entry.type),
      entry.resource,
      context,
    )!;

    items.push(item);
    listedByItem.set(item, entry.resource);
  }

  return { items, listedByItem };
}

function nlb(
  arn: string,
  name: string,
  properties: Record<string, unknown> = {},
): { type: string; resource: AwsListedResource } {
  return {
    type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
    resource: listed(arn, {
      LoadBalancerArn: arn,
      LoadBalancerName: name,
      Type: "network",
      Scheme: "internet-facing",
      IpAddressType: "ipv4",
      DNSName: `${name}-1.elb.${REGION}.amazonaws.com`,
      Subnets: ["subnet-0aaa", "subnet-0bbb"],
      ...properties,
    }),
  };
}

function factsOf(item: CloudInventoryItem): JSONObject {
  const properties: JSONObject = item.properties;
  const facts: JSONObject = {};

  for (const key of Object.values(AWS_PASS_ON_PROPERTIES)) {
    if (properties[key] !== undefined) {
      facts[key] = properties[key]!;
    }
  }

  return facts;
}

describe("the facts kept on a load balancer's record", () => {
  test("a Network Load Balancer one of whose target groups drops the client's address: Off, naming it, and its subnets' ranges", () => {
    const { items, listedByItem } = loadBalancers([nlb(NLB_ARN, "tcp-ingress")]);

    addAwsPassOnLoadBalancerFacts({
      items,
      listedByItem,
      targetGroups: [
        targetGroup("ingress-ip", { targetType: "ip", attributes: preserve("false") }),
        targetGroup("ingress-instances", {
          targetType: "instance",
          attributes: preserve("true"),
        }),
        targetGroup("dns", { protocol: "UDP", targetType: "ip" }),
      ],
      areTargetGroupsListed: true,
      subnets: SUBNETS,
    });

    expect(factsOf(items[0]!)).toEqual({
      [AWS_PASS_ON_PROPERTIES.clientIpPreservation]: AwsClientIpPreservation.Off,
      [AWS_PASS_ON_PROPERTIES.targetGroupsWithoutClientIp]: ["ingress-ip"],
      [AWS_PASS_ON_PROPERTIES.subnetCidrBlocks]: [
        "10.0.1.0/24",
        "2a05:d018:1:a00::/64",
        "10.0.2.0/24",
      ],
    });
    // The record keeps what it said before, beside them.
    expect(items[0]!.properties["Type"]).toBe("network");
  });

  test("one whose every target group keeps it: On", () => {
    const { items, listedByItem } = loadBalancers([nlb(NLB_ARN, "tcp-ingress")]);

    addAwsPassOnLoadBalancerFacts({
      items,
      listedByItem,
      targetGroups: [
        targetGroup("ingress-instances", {
          targetType: "instance",
          attributes: preserve("true"),
        }),
        targetGroup("ingress-ip", { targetType: "ip", attributes: preserve("true") }),
        targetGroup("ingress-alb", { targetType: "alb" }),
      ],
      areTargetGroupsListed: true,
      subnets: SUBNETS,
    });

    expect(
      items[0]!.properties[AWS_PASS_ON_PROPERTIES.clientIpPreservation],
    ).toBe(AwsClientIpPreservation.On);
    expect(
      items[0]!.properties[AWS_PASS_ON_PROPERTIES.targetGroupsWithoutClientIp],
    ).toBeUndefined();
  });

  test("one with a target group whose attributes were not read, or whose target groups were not all listed: Unknown", () => {
    for (const data of [
      {
        targetGroups: [targetGroup("pods", { targetType: "ip" })],
        areTargetGroupsListed: true,
      },
      {
        targetGroups: [
          targetGroup("ingress-instances", {
            targetType: "instance",
            attributes: preserve("true"),
          }),
        ],
        areTargetGroupsListed: false,
      },
    ]) {
      const { items, listedByItem } = loadBalancers([nlb(NLB_ARN, "tcp-ingress")]);

      addAwsPassOnLoadBalancerFacts({
        items,
        listedByItem,
        subnets: SUBNETS,
        ...data,
      });

      expect(
        items[0]!.properties[AWS_PASS_ON_PROPERTIES.clientIpPreservation],
      ).toBe(AwsClientIpPreservation.Unknown);
    }
  });

  test("one that drops it in one target group and is unread in another: Off, which says more", () => {
    const { items, listedByItem } = loadBalancers([nlb(NLB_ARN, "tcp-ingress")]);

    addAwsPassOnLoadBalancerFacts({
      items,
      listedByItem,
      targetGroups: [
        targetGroup("pods", { targetType: "ip" }),
        targetGroup("ingress-ip", { targetType: "ip", attributes: preserve("false") }),
      ],
      areTargetGroupsListed: true,
      subnets: SUBNETS,
    });

    expect(factsOf(items[0]!)).toEqual(
      expect.objectContaining({
        [AWS_PASS_ON_PROPERTIES.clientIpPreservation]:
          AwsClientIpPreservation.Off,
        [AWS_PASS_ON_PROPERTIES.targetGroupsWithoutClientIp]: ["ingress-ip"],
      }),
    );
  });

  test("a target group of another load balancer says nothing of this one", () => {
    const { items, listedByItem } = loadBalancers([
      nlb(NLB_ARN, "tcp-ingress"),
      nlb(PRESERVING_NLB_ARN, "game"),
    ]);

    addAwsPassOnLoadBalancerFacts({
      items,
      listedByItem,
      targetGroups: [
        targetGroup("ingress-ip", { targetType: "ip", attributes: preserve("false") }),
        targetGroup("game-instances", {
          targetType: "instance",
          loadBalancers: [PRESERVING_NLB_ARN],
          attributes: preserve("true"),
        }),
      ],
      areTargetGroupsListed: true,
      subnets: SUBNETS,
    });

    expect(
      items.map((item: CloudInventoryItem): unknown => {
        return item.properties[AWS_PASS_ON_PROPERTIES.clientIpPreservation];
      }),
    ).toEqual([AwsClientIpPreservation.Off, AwsClientIpPreservation.On]);
  });

  test("a subnet the Region's listing did not hold is named unread", () => {
    const { items, listedByItem } = loadBalancers([
      nlb(NLB_ARN, "tcp-ingress", {
        Subnets: ["subnet-0aaa", "subnet-0ccc"],
      }),
    ]);

    addAwsPassOnLoadBalancerFacts({
      items,
      listedByItem,
      targetGroups: [],
      areTargetGroupsListed: true,
      subnets: SUBNETS,
    });

    expect(factsOf(items[0]!)).toEqual(
      expect.objectContaining({
        [AWS_PASS_ON_PROPERTIES.subnetCidrBlocks]: [
          "10.0.1.0/24",
          "2a05:d018:1:a00::/64",
        ],
        [AWS_PASS_ON_PROPERTIES.unreadSubnets]: ["subnet-0ccc"],
      }),
    );
  });

  test("a Classic Load Balancer is given its subnets' ranges; an Application Load Balancer nothing", () => {
    const { items, listedByItem } = loadBalancers([
      {
        type: "AWS::ElasticLoadBalancing::LoadBalancer",
        resource: listed("legacy", {
          LoadBalancerName: "legacy",
          Scheme: "internet-facing",
          Subnets: ["subnet-0bbb"],
          Listeners: ["TCP:443 -> TCP:8443"],
        }),
      },
      {
        type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
        resource: listed(ALB_ARN, {
          LoadBalancerArn: ALB_ARN,
          LoadBalancerName: "web",
          Type: "application",
          Subnets: ["subnet-0aaa"],
        }),
      },
    ]);

    addAwsPassOnLoadBalancerFacts({
      items,
      listedByItem,
      targetGroups: [],
      areTargetGroupsListed: true,
      subnets: SUBNETS,
    });

    expect(factsOf(items[0]!)).toEqual({
      [AWS_PASS_ON_PROPERTIES.subnetCidrBlocks]: ["10.0.2.0/24"],
    });
    expect(factsOf(items[1]!)).toEqual({});
  });
});

// The fake answers as AWS does; keys AWS no longer takes are refused as it refuses them.
function options(fake: FakeAws, budget?: CloudReadBudget): AwsCloudControlOptions {
  return {
    transport: fake.transport,
    credentials: {
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    },
    region: REGION,
    sleep: async () => {},
    budget,
  };
}

describe("asking Elastic Load Balancing", () => {
  test("one target group's attributes, by the 2015-12-01 Query API", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        [REGION]: {
          metrics: [],
          targetGroupAttributes: {
            [targetGroupArn("ingress-ip")]: preserve("false"),
          },
        },
      },
    });

    expect(
      await describeTargetGroupAttributes(
        options(fake),
        targetGroupArn("ingress-ip"),
      ),
    ).toEqual(preserve("false"));
    expect(fake.targetGroupAttributeCalls).toEqual([
      { region: REGION, targetGroupArn: targetGroupArn("ingress-ip") },
    ]);
    expect(ELASTIC_LOAD_BALANCING_V2_API_VERSION).toBe("2015-12-01");
  });

  test("only of the target groups that can drop the client's address, each written onto it", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        [REGION]: {
          metrics: [],
          targetGroupAttributes: {
            [targetGroupArn("ingress-ip")]: preserve("false"),
            [targetGroupArn("ingress-instances")]: preserve("true"),
          },
        },
      },
    });
    const groups: Array<AwsListedResource> = [
      targetGroup("ingress-ip", { targetType: "ip" }),
      targetGroup("ingress-instances", { targetType: "instance" }),
      targetGroup("dns", { protocol: "UDP", targetType: "ip" }),
      targetGroup("web", {
        protocol: "HTTP",
        targetType: "ip",
        loadBalancers: [ALB_ARN],
      }),
    ];

    await expect(
      addTargetGroupAttributes({ options: options(fake), targetGroups: groups }),
    ).resolves.toEqual({ budgetSpent: false });

    expect(
      fake.targetGroupAttributeCalls.map(
        (call: { targetGroupArn: string }): string => {
          return call.targetGroupArn;
        },
      ),
    ).toEqual([targetGroupArn("ingress-ip"), targetGroupArn("ingress-instances")]);
    expect(groups[0]!.properties["TargetGroupAttributes"]).toEqual(
      preserve("false"),
    );
    expect(groups[1]!.properties["TargetGroupAttributes"]).toEqual(
      preserve("true"),
    );
    expect(groups[2]!.properties["TargetGroupAttributes"]).toBeUndefined();
    expect(groups[3]!.properties["TargetGroupAttributes"]).toBeUndefined();
  });

  test("one AWS refuses is left without them, and the rest are still asked", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        [REGION]: {
          metrics: [],
          targetGroupAttributes: {
            [targetGroupArn("ingress-instances")]: preserve("true"),
          },
        },
      },
    });
    const groups: Array<AwsListedResource> = [
      // AWS answers TargetGroupNotFound: deleted since it was listed.
      targetGroup("gone", { targetType: "ip" }),
      targetGroup("ingress-instances", { targetType: "instance" }),
    ];

    await addTargetGroupAttributes({
      options: options(fake),
      targetGroups: groups,
    });

    expect(groups[0]!.properties["TargetGroupAttributes"]).toBeUndefined();
    expect(doesAwsTargetGroupKeepClientIp(groups[0]!)).toBeNull();
    expect(groups[1]!.properties["TargetGroupAttributes"]).toEqual(
      preserve("true"),
    );
  });

  test("a credential AWS no longer takes stops the listing", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        [REGION]: {
          metrics: [],
          targetGroupAttributes: {
            [targetGroupArn("ingress-ip")]: {
              status: 403,
              body: `<ErrorResponse xmlns="http://elasticloadbalancing.amazonaws.com/doc/2015-12-01/"><Error><Type>Sender</Type><Code>InvalidClientTokenId</Code><Message>The security token included in the request is invalid.</Message></Error></ErrorResponse>`,
            },
          },
        },
      },
    });

    let thrown: unknown = undefined;

    try {
      await addTargetGroupAttributes({
        options: options(fake),
        targetGroups: [targetGroup("ingress-ip", { targetType: "ip" })],
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LlmProviderError);
    expect((thrown as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Authentication,
    );
  });

  test("no more are asked than one Region's read allows", async () => {
    const answers: Record<string, Array<{ Key: string; Value: string }>> = {};
    const groups: Array<AwsListedResource> = [];

    for (let index: number = 0; index < AWS_TARGET_GROUP_ATTRIBUTES_READ_PER_REGION + 3; index++) {
      const group: AwsListedResource = targetGroup(`group-${index}`, {
        targetType: "ip",
      });

      answers[targetGroupArn(`group-${index}`)] = preserve("true");
      groups.push(group);
    }

    const fake: FakeAws = createFakeAws({
      regions: { [REGION]: { metrics: [], targetGroupAttributes: answers } },
    });

    await addTargetGroupAttributes({ options: options(fake), targetGroups: groups });

    expect(fake.targetGroupAttributeCalls).toHaveLength(
      AWS_TARGET_GROUP_ATTRIBUTES_READ_PER_REGION,
    );
    expect(
      doesAwsTargetGroupKeepClientIp(groups[groups.length - 1]!),
    ).toBeNull();
  });

  test("a read whose budget runs out says so, and asks no more", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        [REGION]: {
          metrics: [],
          targetGroupAttributes: {
            [targetGroupArn("one")]: preserve("true"),
            [targetGroupArn("two")]: preserve("true"),
          },
        },
      },
    });
    const budget: CloudReadBudget = new CloudReadBudget({
      maxRequests: 1,
      maxDurationMs: 60000,
    });

    await expect(
      addTargetGroupAttributes({
        options: options(fake, budget),
        targetGroups: [
          targetGroup("one", { targetType: "ip" }),
          targetGroup("two", { targetType: "ip" }),
        ],
      }),
    ).resolves.toEqual({ budgetSpent: true });
    expect(fake.targetGroupAttributeCalls).toHaveLength(1);
  });
});

/*
 * An account's inventory, read through the fake as the connector reads it:
 * Cloud Control's load balancers, target groups and subnets, then the
 * attributes of the target groups that can drop the client's address.
 */
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

function cloudControl(resource: AwsListedResource): {
  Identifier: string;
  Properties: JSONObject;
} {
  return { Identifier: resource.identifier, Properties: resource.properties };
}

// What Security Events reads of an item, as it is stored.
function readStored(item: CloudInventoryItem): PassOnLoadBalancerReading | null {
  return readAwsPassOnLoadBalancer({
    cloudResourceType: item.resource.resourceType,
    providerResourceId: item.resource.providerResourceId,
    name: item.displayName || item.resource.name,
    cloudProperties: item.properties,
    cloudEndpoints: item.endpoints,
    cloudRelationships: item.relationships,
    where: "Production AWS",
  });
}

describe("an account's inventory, against a fake AWS", () => {
  async function readAccount(): Promise<{
    fake: FakeAws;
    loadBalancers: Map<string, CloudInventoryItem>;
  }> {
    const fake: FakeAws = createFakeAws({
      regions: {
        [REGION]: {
          metrics: [],
          resources: {
            "AWS::ElasticLoadBalancingV2::LoadBalancer": [
              cloudControl(nlb(NLB_ARN, "tcp-ingress").resource),
              cloudControl(nlb(PRESERVING_NLB_ARN, "game").resource),
              cloudControl(
                nlb(DUALSTACK_NLB_ARN, "edge-v6", { IpAddressType: "dualstack" })
                  .resource,
              ),
              cloudControl(
                listed(ALB_ARN, {
                  LoadBalancerArn: ALB_ARN,
                  LoadBalancerName: "web",
                  Type: "application",
                  Scheme: "internet-facing",
                  DNSName: `web-1.${REGION}.elb.amazonaws.com`,
                  Subnets: ["subnet-0aaa"],
                }),
              ),
            ],
            "AWS::ElasticLoadBalancingV2::TargetGroup": [
              cloudControl(targetGroup("ingress-ip", { targetType: "ip" })),
              cloudControl(
                targetGroup("game-instances", {
                  targetType: "instance",
                  loadBalancers: [PRESERVING_NLB_ARN],
                }),
              ),
              cloudControl(
                targetGroup("game-voice", {
                  protocol: "UDP",
                  targetType: "ip",
                  loadBalancers: [PRESERVING_NLB_ARN],
                }),
              ),
              cloudControl(
                targetGroup("edge-instances", {
                  targetType: "instance",
                  loadBalancers: [DUALSTACK_NLB_ARN],
                }),
              ),
              cloudControl(
                targetGroup("web", {
                  protocol: "HTTP",
                  targetType: "ip",
                  loadBalancers: [ALB_ARN],
                }),
              ),
            ],
            "AWS::EC2::Subnet": SUBNETS.map(cloudControl),
          },
          targetGroupAttributes: {
            [targetGroupArn("ingress-ip")]: preserve("false"),
            [targetGroupArn("game-instances")]: preserve("true"),
            [targetGroupArn("edge-instances")]: preserve("true"),
          },
        },
        "us-east-1": { metrics: [] },
      },
    });

    const result: CloudInventoryResult = await connector.readInventory(
      keySettings(),
      {
        transport: fake.transport,
        now: () => {
          return new Date("2026-11-28T12:07:00Z");
        },
        sleep: async () => {},
        state: {
          accounts: [FAKE_ACCOUNT_ID],
          activePairs: [`${REGION}|AWS/EC2`],
        },
        connectionId: "33333333-3333-4333-8333-333333333333",
        budget: new CloudReadBudget({ maxRequests: 1500, maxDurationMs: 60000 }),
      },
    );

    const loadBalancers: Map<string, CloudInventoryItem> = new Map();

    for (const item of result.items) {
      if (item.resource.resourceType === "AWS::ElasticLoadBalancingV2::LoadBalancer") {
        loadBalancers.set(item.displayName || item.resource.name, item);
      }
    }

    return { fake, loadBalancers };
  }

  test("asks for the attributes of the Network Load Balancers' TCP target groups alone", async () => {
    const { fake } = await readAccount();

    expect(
      fake.targetGroupAttributeCalls
        .map((call: { targetGroupArn: string }): string => {
          return call.targetGroupArn;
        })
        .sort(),
    ).toEqual(
      [
        targetGroupArn("ingress-ip"),
        targetGroupArn("game-instances"),
        targetGroupArn("edge-instances"),
      ].sort(),
    );
    // Never as a classic load balancer listing.
    for (const call of fake.classicLoadBalancerCalls) {
      expect(call.params["Action"]).not.toBe("DescribeTargetGroupAttributes");
    }
  });

  test("a Network Load Balancer that drops the client's address passes on what it wrote, from its subnets", async () => {
    const { loadBalancers } = await readAccount();

    expect(readStored(loadBalancers.get("tcp-ingress")!)).toEqual({
      kind: PassOnLoadBalancerKind.AwsNetworkLoadBalancer,
      name: "tcp-ingress",
      where: "Production AWS",
      reasons: [PassOnReason.ClientIpNotPreserved],
      targetGroups: ["ingress-ip"],
      ranges: ["10.0.1.0/24", "2a05:d018:1:a00::/64", "10.0.2.0/24"],
      areRangesIncomplete: false,
    });
  });

  test("one that keeps it, over TCP and UDP alike, passes nothing on", async () => {
    const { loadBalancers } = await readAccount();

    expect(
      loadBalancers.get("game")!.properties[
        AWS_PASS_ON_PROPERTIES.clientIpPreservation
      ],
    ).toBe(AwsClientIpPreservation.On);
    expect(readStored(loadBalancers.get("game")!)).toBeNull();
  });

  test("a dualstack one passes on whatever its target groups keep", async () => {
    const { loadBalancers } = await readAccount();

    expect(readStored(loadBalancers.get("edge-v6")!)?.reasons).toEqual([
      PassOnReason.Dualstack,
    ]);
  });

  test("an Application Load Balancer is given no such facts, and passes nothing on", async () => {
    const { loadBalancers } = await readAccount();

    expect(
      loadBalancers.get("web")!.properties[
        AWS_PASS_ON_PROPERTIES.clientIpPreservation
      ],
    ).toBeUndefined();
    expect(readStored(loadBalancers.get("web")!)).toBeNull();
  });
});
